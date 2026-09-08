// Microsoft API contract, verified 2026-09-06:
// https://learn.microsoft.com/en-us/rest/api/microsoftfoundry/model-inference/get-chat-completions/get-chat-completions?view=rest-microsoftfoundry-model-inference-2024-05-01-preview
// This adapter supplies model text only. The shared surface still compiles
// memory/persona, applies output gates and chooses the protected voice path.
import { randomUUID } from "node:crypto";
import {
  foundryBudgetConfig, reserveFoundrySpend, beginFoundrySpend,
  releaseFoundrySpendBeforeCall, settleFoundrySpend, markFoundrySpendUncertain,
} from "./_provider-budget.js";

const VERSION = "2024-05-01-preview";
const fail = (code) => { throw Object.assign(new Error(code), { code, status: 503 }); };
// Explicitly tested deployment dialect, not a prefix guess for all GPT models.
const MODEL_PROTOCOLS = Object.freeze({
  "gpt-5.6-terra": Object.freeze({ expectedModel: "gpt-5.6-terra-2026-07-09",
    completion: Object.freeze({ max_completion_tokens: 400, reasoning_effort: "none" }) }),
});

export function azureSurfaceReplyConfig(env = process.env) {
  let url;
  try { url = new URL(env.AZURE_FOUNDRY_REPLY_ENDPOINT || env.AZURE_FOUNDRY_ENDPOINT || ""); }
  catch { fail("azure_reply_endpoint_required"); }
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.services\.ai\.azure\.com$/i.test(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash ||
      !["/", "/models", "/models/"].includes(url.pathname)) fail("azure_reply_endpoint_invalid");
  url.pathname = "/models/chat/completions";
  url.search = `api-version=${VERSION}`;
  const model = String(env.AZURE_FOUNDRY_REPLY_MODEL || "").trim();
  const apiKey = String(env.AZURE_FOUNDRY_REPLY_API_KEY || env.AZURE_FOUNDRY_API_KEY || "").trim();
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(model)) fail("azure_reply_model_required");
  if (apiKey.length < 16) fail("azure_reply_auth_required");
  const protocol = Object.hasOwn(MODEL_PROTOCOLS, model) ? MODEL_PROTOCOLS[model] : undefined;
  // A model-only switch must not reuse the incumbent's rates accidentally.
  // The operator still supplies the verified rate card; prices are not eternal.
  if (protocol && env.AZURE_FOUNDRY_REPLY_RATE_MODEL !== model) fail("azure_reply_rate_model_mismatch");
  // Prices belong to this exact deployment, not to the independent claim or
  // structured-dialogue model. Reuse the ledger without borrowing its rates.
  const budgetEnv = {
    AZURE_REPLICA_BUDGET_ID: env.AZURE_REPLICA_BUDGET_ID,
    AZURE_REPLICA_APP_BUDGET_USD: env.AZURE_REPLICA_APP_BUDGET_USD,
    AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: env.AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS,
    AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS: env.AZURE_FOUNDRY_REPLY_OUTPUT_USD_PER_MTOKENS,
  };
  foundryBudgetConfig(budgetEnv);
  return { url, model, apiKey, budgetEnv, protocol };
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) fail("azure_reply_response_invalid");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 128_000) { await reader.cancel(); fail("azure_reply_response_too_large"); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail("azure_reply_response_invalid"); }
}

export async function azureSurfaceReply({ compiled, turns, db, env = process.env, fetchImpl = fetch,
  requestKey = randomUUID(), signal } = {}) {
  const config = azureSurfaceReplyConfig(env);
  const messages = [
    { role: "system", content: [
      { type: "text", text: compiled.core.slice(0, 64_000) },
      { type: "text", text: compiled.tail.slice(0, 24_000) },
    ] },
    ...turns.slice(-40),
  ];
  const adapter = { family: "surface_reply", name: "azure-foundry-shared-reply", version: VERSION,
    model: config.model, billing: { meter: "azure_foundry_tokens", max_output_tokens: 400 } };
  // No retry loop: every dispatched attempt owns a distinct durable receipt.
  // A caller reusing an uncertain request key must reconcile rather than pay twice.
  const reservation = await reserveFoundrySpend(db, {
    operation: "dialogue", requestKey, adapter, messages, env: config.budgetEnv,
  });
  if (signal?.aborted) {
    await releaseFoundrySpendBeforeCall(db, reservation, "azure_reply_aborted_before_call");
    fail("azure_reply_aborted_before_call");
  }
  try { await beginFoundrySpend(db, reservation); }
  catch (error) {
    // Do not release an ambiguous begin: another caller may already own it.
    throw error;
  }
  try {
    const response = await fetchImpl(config.url, {
      method: "POST", redirect: "error",
      headers: { "Content-Type": "application/json", "api-key": config.apiKey },
      body: JSON.stringify({ model: config.model, messages,
        ...(config.protocol?.completion || { max_tokens: 400 }), stream: false }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!response.ok) fail(`azure_reply_http_${Number(response.status) || "unknown"}`);
    const payload = await boundedJson(response);
    const usage = payload?.usage;
    if (!Number.isSafeInteger(usage?.prompt_tokens) || !Number.isSafeInteger(usage?.completion_tokens))
      fail("azure_reply_usage_missing");
    await settleFoundrySpend(db, reservation, {
      input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens,
    });
    if (config.protocol) {
      // Known usage settles before identity or semantic refusal. Completion
      // tokens already include reasoning; never charge the detail twice.
      if (payload?.model !== config.protocol.expectedModel) fail("azure_reply_revision_mismatch");
      const reasoning = usage.completion_tokens_details?.reasoning_tokens;
      if (usage.completion_tokens > 400 || (reasoning !== undefined &&
          (!Number.isSafeInteger(reasoning) || reasoning < 0 || reasoning > usage.completion_tokens))) {
        fail("azure_reply_usage_contract_invalid");
      }
      // system_fingerprint is optional on this API, including successful Terra
      // responses. No backend fingerprint or qualification claim is inferred.
    }
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason !== "stop" || typeof choice?.message?.content !== "string" ||
        !choice.message.content.trim()) fail("azure_reply_response_incomplete");
    return choice.message.content;
  } catch (error) {
    // Keep the reservation charged when delivery, usage or settlement is
    // uncertain. Neither an HTTP error nor a timeout proves no paid work ran.
    const code = /^azure_reply_|^provider_/.test(String(error?.code || ""))
      ? error.code : "azure_reply_transport_failed";
    await markFoundrySpendUncertain(db, reservation, code);
    fail(code);
  }
}
