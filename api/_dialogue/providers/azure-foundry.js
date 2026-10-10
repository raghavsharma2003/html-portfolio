import { foundryBudgetConfig } from "../../_provider-budget.js";
import { canonicalJson, sha256Hex } from "../../_provenance/contracts.js";
import { DIALOGUE_OUTPUT_SCHEMA, DIALOGUE_PROMPT } from "../contracts.js";
import { prepareProviderRevisionBinding, verifyProviderRevision } from "../provider-revision.js";

export const AZURE_DIALOGUE_API_VERSION = "2024-05-01-preview";

export class DialogueAdapterError extends Error {
  constructor(code, { retryable = false, status = 0 } = {}) {
    super(code);
    this.name = "DialogueAdapterError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function fail(code, options) {
  throw new DialogueAdapterError(code, options);
}

function endpoint(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { fail("dialogue_azure_config_missing"); }
  if (url.protocol !== "https:" || !/\.services\.ai\.azure\.com$/i.test(url.hostname) || url.username || url.password)
    fail("dialogue_azure_endpoint_invalid");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models/chat/completions`.replace(/\/+/g, "/");
  url.search = new URLSearchParams({ "api-version": AZURE_DIALOGUE_API_VERSION }).toString();
  return url;
}

function deadline(signal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("dialogue-timeout")), timeoutMs);
  const abort = () => controller.abort(signal.reason || new Error("dialogue-aborted"));
  if (signal?.aborted) abort();
  else signal?.addEventListener?.("abort", abort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => controller.signal.aborted && !signal?.aborted,
    close() { clearTimeout(timeout); signal?.removeEventListener?.("abort", abort); },
  };
}

function cancelBody(body) {
  // Cleanup must not replace the refusal or wait on an unbounded transport.
  try { Promise.resolve(body?.cancel()).catch(() => {}); } catch { /* best effort */ }
}

async function responseJson(response, signal, maxBytes = 512_000) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    cancelBody(response.body);
    fail("dialogue_azure_response_too_large", { retryable: true });
  }
  const reader = response.body?.getReader?.();
  if (!reader) fail("dialogue_azure_response_invalid");
  const chunks = [];
  let bytes = 0;
  const abort = () => cancelBody(reader);
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) { abort(); signal.throwIfAborted(); }
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        cancelBody(reader);
        fail("dialogue_azure_response_too_large", { retryable: true });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks, bytes).toString("utf8");
  try { return JSON.parse(text); } catch { fail("dialogue_azure_response_invalid"); }
}

function measuredUsage(usage) {
  if (!Number.isSafeInteger(usage?.prompt_tokens) || usage.prompt_tokens < 0
    || !Number.isSafeInteger(usage?.completion_tokens) || usage.completion_tokens < 0
    || usage.prompt_tokens + usage.completion_tokens <= 0)
    fail("dialogue_azure_usage_invalid");
  return { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens };
}

// Only this explicitly supported deployment changes dialect. Prices are supplied
// separately from Room/shared replies and claim extraction, never borrowed.
export function azureDialogueProtocol(model, env = process.env) {
  if (model !== "gpt-5.6-terra") return null;
  const expectedModel = "gpt-5.6-terra-2026-07-09";
  if (env.AZURE_FOUNDRY_DIALOGUE_RATE_MODEL !== model) fail("dialogue_azure_rate_model_mismatch");
  if (env.AZURE_FOUNDRY_DIALOGUE_EXPECTED_RESPONSE_MODEL !== expectedModel) fail("dialogue_azure_expected_model_required");
  const budgetEnv = Object.freeze({
    AZURE_REPLICA_BUDGET_ID: env.AZURE_REPLICA_BUDGET_ID,
    AZURE_REPLICA_APP_BUDGET_USD: env.AZURE_REPLICA_APP_BUDGET_USD,
    AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: env.AZURE_FOUNDRY_DIALOGUE_INPUT_USD_PER_MTOKENS,
    AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS: env.AZURE_FOUNDRY_DIALOGUE_OUTPUT_USD_PER_MTOKENS,
  });
  const rates = foundryBudgetConfig(budgetEnv);
  const rateCommitment = sha256Hex(canonicalJson({model, expectedModel, input:rates.input_usd_per_million, output:rates.output_usd_per_million}));
  return Object.freeze({expectedModel, budgetEnv, version:`terra-none-v1:${rateCommitment}`});
}

export function createAzureFoundryDialogueGenerator(options = {}) {
  const url = endpoint(options.endpoint);
  const model = String(options.model || "").trim();
  const apiKey = String(options.apiKey || "");
  if (!model || model.length > 120) fail("dialogue_azure_model_required");
  if (apiKey.length < 16) fail("dialogue_azure_auth_required");
  const protocol = azureDialogueProtocol(model, options.env);
  const fetchImpl = options.fetchImpl || fetch;
  if (typeof fetchImpl !== "function") fail("dialogue_azure_fetch_required");
  const timeoutMs = Math.max(5_000, Math.min(55_000, Number(options.timeoutMs) || 45_000));
  const revisionBinding = options.revisionBinding ? prepareProviderRevisionBinding({
    expectedResponseModel:options.revisionBinding.expected_response_model,
    endpoint:options.endpoint,deployment:model,
    baselineSnapshotHash:options.revisionBinding.baseline_snapshot_hash,
  }) : null;
  return Object.freeze({
    family: "dialogue",
    name: "azure-foundry-structured-output",
    version: `${AZURE_DIALOGUE_API_VERSION}:${DIALOGUE_PROMPT}${protocol ? ":" + protocol.version : ""}`,
    model,
    billing: Object.freeze({ meter: "azure_foundry_tokens", max_output_tokens: 700, ...(protocol ? {budget_env:protocol.budgetEnv} : {}) }),
    ...(revisionBinding ? {revision_binding:revisionBinding} : {}),
    async generate({ prompt, signal }) {
      if (signal?.aborted) fail("dialogue_aborted");
      const timer = deadline(signal, timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json", "api-key": apiKey },
          body: JSON.stringify({
            model,
            messages: prompt.messages,
            ...(protocol ? {max_completion_tokens:700, reasoning_effort:"none"} : {temperature:0.45, max_tokens:700}),
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "vyakti_replica_dialogue",
                description: "A private replica reply with a controlled delivery plan",
                strict: true,
                schema: DIALOGUE_OUTPUT_SCHEMA,
              },
            },
          }),
          signal: timer.signal,
        });
        if (timer.signal.aborted) { cancelBody(response.body); timer.signal.throwIfAborted(); }
        if (response.redirected || (Number(response.status) >= 300 && Number(response.status) < 400)) {
          cancelBody(response.body);
          fail("dialogue_azure_redirect_refused", { status: Number(response.status) || 0 });
        }
        if (!response.ok) {
          cancelBody(response.body);
          fail(`dialogue_azure_http_${Number(response.status) || "unknown"}`, {
            status: Number(response.status) || 0,
            retryable: [408, 409, 429].includes(Number(response.status)) || Number(response.status) >= 500,
          });
        }
        const payload = await responseJson(response, timer.signal);
        const usage = revisionBinding || protocol ? measuredUsage(payload?.usage) : null;
        if (protocol) {
          const refuse = code => { throw Object.assign(new DialogueAdapterError(code), {measured_usage:usage}); };
          if (payload.model !== protocol.expectedModel) refuse("dialogue_azure_response_model_mismatch");
          const reasoning = payload.usage?.completion_tokens_details?.reasoning_tokens;
          if (usage.output_tokens > 700 || (reasoning !== undefined && (!Number.isSafeInteger(reasoning) || reasoning < 0 || reasoning > usage.output_tokens))) refuse("dialogue_azure_completion_units_invalid");
          const fp = payload.system_fingerprint;
          if (fp != null && (typeof fp !== "string" || !/^fp_[A-Za-z0-9]{1,80}$/.test(fp))) refuse("dialogue_azure_fingerprint_invalid");
        }
        const providerIdentity = revisionBinding ? verifyProviderRevision(payload, revisionBinding, usage) : null;
        const choice = payload?.choices?.[0];
        if (!choice || choice.finish_reason !== "stop" || typeof choice.message?.content !== "string") {
          const error = new DialogueAdapterError("dialogue_azure_response_incomplete", { retryable: choice?.finish_reason === "length" });
          if(usage)error.measured_usage=usage;
          throw error;
        }
        return {
          output: choice.message.content,
          usage: usage || measuredUsage(payload?.usage),
          ...(providerIdentity ? {provider_identity:providerIdentity} : protocol ? {provider_identity:{response_model:payload.model,system_fingerprint:payload.system_fingerprint ?? null,fingerprint_status:payload.system_fingerprint == null ? "not_provided" : "provided"}} : {}),
        };
      } catch (error) {
        if(error?.measured_usage)throw error;
        if (error instanceof DialogueAdapterError) throw error;
        if (signal?.aborted) fail("dialogue_aborted");
        if (timer.timedOut()) fail("dialogue_azure_timeout", { retryable: true });
        fail("dialogue_azure_network_error", { retryable: true });
      } finally {
        timer.close();
      }
    },
  });
}
