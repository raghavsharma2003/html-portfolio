import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { azureSurfaceReply, azureSurfaceReplyConfig } from "../../api/_azure-surface-reply.js";
import { replyEngineCapability } from "../../api/_reply-engine-capability.js";
import { selfCheckServing } from "../../api/_self-check-serving.js";

const env = { VYAKTI_REPLY_PROVIDER: "azure_foundry",
  AZURE_FOUNDRY_REPLY_ENDPOINT: "https://fixture.services.ai.azure.com/",
  AZURE_FOUNDRY_REPLY_MODEL: "gpt-4.1-mini", AZURE_FOUNDRY_REPLY_API_KEY: "fixture-not-a-real-key",
  AZURE_REPLICA_APP_BUDGET_USD: "5",
  AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS: "0.4",
  AZURE_FOUNDRY_REPLY_OUTPUT_USD_PER_MTOKENS: "1.6" };
const compiled = { core: "Expert persona. Hindi allowed.", tail: "Private relationship memory." };
const turns = [{ role: "user", content: "Explain my next step" }];
let n = 0;
const ok = (name, value) => { assert.ok(value, name); console.log(`ok ${++n} - ${name}`); };
function ledger({ deny = false, failSettlement = false, failBegin = false, lostBeginAck = false,
  lostSettlementAck = false, settlementCommitted = false } = {}) {
  const calls = [];
  let row;
  const db = async (sql, p) => {
    calls.push({ sql, p });
    if (sql.includes("insert into vy_provider_budget")) return [];
    if (sql.includes("with budget as")) {
      row = { reservation_id: "fixture-reservation", budget_id: p[0], request_hash: p[7],
        reserved_microusd: p[10], state: "reserved" };
      return deny ? [] : [row];
    }
    if (sql.includes("set state='in_flight'")) {
      if (failBegin) return [];
      row.state = "in_flight";
      if (lostBeginAck) throw Error("lost_begin_ack");
      return [{ ...row }];
    }
    if (sql.includes("with settled as")) {
      if (failSettlement) return [];
      if (!lostSettlementAck || settlementCommitted) Object.assign(row, { state: "settled", actual_microusd: p[5] });
      if (lostSettlementAck) throw Error("lost_settlement_ack");
      return [{ budget_id: row.budget_id }];
    }
    if (sql.includes("reconcile_required")) { if (row?.state === "in_flight") row.state = "reconcile_required"; return []; }
    if (sql.includes("with released as")) { row.state = "released"; return []; }
    throw new Error("unexpected fixture query");
  };
  return { db, calls, state: () => row };
}
const response = (overrides = {}) => new Response(JSON.stringify({
  choices: [{ finish_reason: "stop", message: { content: "A useful expert reply" } }],
  usage: { prompt_tokens: 20, completion_tokens: 8 }, ...overrides,
}), { status: 200 });
const successful = ledger();
let sent;
const text = await azureSurfaceReply({ compiled, turns, env, db: successful.db, requestKey: "one-attempt",
  fetchImpl: async (url, init) => {
    assert.ok(successful.calls.at(-1).sql.includes("set state='in_flight'"));
    sent = { url: String(url), init, body: JSON.parse(init.body) };
    return response();
  } });
ok("text returns only after a real ledger settlement path", text === "A useful expert reply" &&
  successful.calls.at(-1).sql.includes("with settled as"));
ok("the verified Foundry inference route is explicit", sent.url ===
  "https://fixture.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview");
ok("compiled persona memory and turns retain exact text and ordering", sent.body.messages[0].content[0].text === compiled.core &&
  sent.body.messages[0].content[1].text === compiled.tail && sent.body.messages[1].content === turns[0].content);
ok("bounded output has no foreign provider controls and redirects cannot carry the key away",
  sent.body.max_tokens === 400 && sent.body.stream === false && sent.init.redirect === "error" &&
  !JSON.stringify(sent.body).includes("cache_control") && !sent.body.reasoning);
ok("usage is measured and price reservation is conservative", successful.calls.at(-1).p[3] === 20 &&
  successful.calls.at(-1).p[4] === 8 && successful.calls[1].p[10] >= successful.calls.at(-1).p[5]);
for (const input of [
  { ...env, AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS: undefined },
  { ...env, AZURE_FOUNDRY_REPLY_OUTPUT_USD_PER_MTOKENS: "0" },
  { ...env, AZURE_REPLICA_APP_BUDGET_USD: undefined },
  { ...env, AZURE_FOUNDRY_REPLY_ENDPOINT: "https://fixture.services.ai.azure.com.evil.test" },
  { ...env, AZURE_FOUNDRY_REPLY_ENDPOINT: "https://fixture.services.ai.azure.com/?key=x" },
  { ...env, AZURE_FOUNDRY_REPLY_ENDPOINT: "http://fixture.services.ai.azure.com/" },
  { ...env, AZURE_FOUNDRY_REPLY_MODEL: "" },
]) {
  let dispatched = false;
  await assert.rejects(azureSurfaceReply({ compiled, turns, env: input,
    db: async () => { dispatched = true; }, fetchImpl: async () => { dispatched = true; } }));
  assert.equal(dispatched, false);
  assert.equal(replyEngineCapability({ ...input, OPENROUTER_API_KEY: "fallback-present" }).available, false);
}
ok("seven unpriced or invalid Azure configurations refuse before database or network despite a fallback key", true);
for (const [name, fetchImpl, options] of [
  ["budget refusal", async () => { throw new Error("must not fetch"); }, { deny: true }],
  ["begin refusal", async () => { throw new Error("must not fetch"); }, { failBegin: true }],
  ["missing usage", async () => response({ usage: undefined }), {}],
  ["transport uncertainty", async () => { throw new Error("private upstream payload must not escape"); }, {}],
  ["HTTP refusal", async () => new Response("private upstream payload", { status: 429 }), {}],
  ["settlement failure", async () => response(), { failSettlement: true }],
  ["oversized response", async () => new Response("x".repeat(128_001)), {}],
]) {
  const state = ledger(options);
  let fetched = false;
  await assert.rejects(azureSurfaceReply({ compiled, turns, env, db: state.db,
    fetchImpl: async (...args) => { fetched = true; return fetchImpl(...args); } }),
    error => !error.message.includes("private upstream payload"));
  if (options.deny || options.failBegin) assert.equal(fetched, false);
  else assert.ok(state.calls.at(-1).sql.includes("state='reconcile_required'"));
  ok(`${name} cannot return unaccounted text or silently call another provider`, true);
}
const aborted = ledger();
await assert.rejects(azureSurfaceReply({ compiled, turns, env, db: aborted.db,
  signal: AbortSignal.abort(), fetchImpl: async () => assert.fail("aborted request fetched") }));
ok("a known pre-dispatch abort releases its reservation", aborted.calls.at(-1).sql.includes("with released as"));
ok("provider selection preserves OpenRouter by default and refuses unknown switches",
  replyEngineCapability({ OPENROUTER_KEY: "present" }).available &&
  !replyEngineCapability({ VYAKTI_REPLY_PROVIDER: "unknown", OPENROUTER_KEY: "present" }).available &&
  replyEngineCapability(env).available);
const source = readFileSync(new URL("../../api/_surface.js", import.meta.url), "utf8");
ok("the Azure adapter plugs into the existing shared brain, leaving the gate in place",
  source.includes('resolveReplyServingProvider(env)') && source.includes('provider === "azure_foundry"') &&
  source.includes("azureSurfaceReply({ compiled, turns, db: options.db || q, env,") && source.includes("export async function gatedReply"));
ok("configured models never silently inherit a different lane's rates", (() => {
  assert.throws(() => azureSurfaceReplyConfig({ ...env, AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS: undefined,
    AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: "0.01" })); return true;
})());
const terraEnv = { ...env, AZURE_FOUNDRY_REPLY_MODEL: "gpt-5.6-terra",
  AZURE_FOUNDRY_REPLY_RATE_MODEL: "gpt-5.6-terra",
  AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS: "2", AZURE_FOUNDRY_REPLY_OUTPUT_USD_PER_MTOKENS: "12" };
for (const patch of [{ AZURE_FOUNDRY_REPLY_RATE_MODEL: undefined },
  { AZURE_FOUNDRY_REPLY_RATE_MODEL: "gpt-4.1-mini" },
  { AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS: undefined },
  { AZURE_FOUNDRY_REPLY_OUTPUT_USD_PER_MTOKENS: undefined }]) {
  const invalid = { ...terraEnv, ...patch }; let calls = 0;
  await assert.rejects(azureSurfaceReply({ compiled, turns, env: invalid,
    db: async () => { calls++; }, fetchImpl: async () => { calls++; } }));
  assert.equal(calls, 0); assert.equal(replyEngineCapability(invalid).available, false);
  assert.equal(selfCheckServing(invalid).check.ok, false);
}
ok("Terra requires explicitly acknowledged model-specific rates before DB/network/readiness", true);
const readiness = selfCheckServing({ ...terraEnv, NEON_URL: "fixture-only" });
ok("Terra readiness names the rate binding and accepts configured rates without hardcoded price assumptions",
  readiness.check.ok && readiness.required.includes("AZURE_FOUNDRY_REPLY_RATE_MODEL") &&
  !selfCheckServing({ ...env, NEON_URL: "fixture-only" }).required.includes("AZURE_FOUNDRY_REPLY_RATE_MODEL") &&
  JSON.parse(readFileSync(new URL("../../api/_env-manifest.gen.json", import.meta.url), "utf8"))
    .find(row => row.name === "AZURE_FOUNDRY_REPLY_RATE_MODEL").required === false &&
  azureSurfaceReplyConfig({ ...terraEnv, AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS: "3" }).budgetEnv.AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS === "3");
const terraResponse = (patch = {}) => response({ model: "gpt-5.6-terra-2026-07-09", system_fingerprint: null,
  usage: { prompt_tokens: 4, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 8 } }, ...patch });
const terra = ledger(); let terraBody;
await azureSurfaceReply({ compiled, turns, env: terraEnv, db: terra.db,
  fetchImpl: async (_url, init) => { terraBody = JSON.parse(init.body); return terraResponse(); } });
ok("Terra sends400 total completion tokens with none effort and no conflicting token/temperature controls",
  terraBody.max_completion_tokens === 400 && terraBody.reasoning_effort === "none" &&
  !Object.hasOwn(terraBody, "max_tokens") && !Object.hasOwn(terraBody, "temperature") && terraBody.stream === false);
ok("null fingerprint is optional and reported reasoning is charged once inside completion usage",
  terra.state().state === "settled" && terra.state().actual_microusd === 248);
for (const patch of [{ model: undefined }, { model: "gpt-5.6-terra" }, { model: "gpt-4.1-mini-2025-04-14" },
  { choices: [{ finish_reason: "length", message: { content: "partial" } }] },
  { usage: { prompt_tokens: 4, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 21 } } }]) {
  const state = ledger();
  await assert.rejects(azureSurfaceReply({ compiled, turns, env: terraEnv, db: state.db, fetchImpl: async () => terraResponse(patch) }));
  assert.equal(state.state().state, "settled"); assert.equal(state.state().actual_microusd, 248);
  assert.equal(state.calls.filter(c => c.sql.includes("with settled as")).length, 1);
}
ok("Terra revision/content/reasoning-detail refusals preserve known usage and never settle twice", true);
const excessive = ledger();
await assert.rejects(azureSurfaceReply({ compiled: { core: "x".repeat(2000), tail: "" }, turns,
  env: terraEnv, db: excessive.db, fetchImpl: async () => terraResponse({ usage: { prompt_tokens: 4, completion_tokens: 401 } }) }),
  { code: "azure_reply_usage_contract_invalid" });
ok("a provider completion beyond400 is refused after its known cost settles within the reserved amount",
  excessive.state().state === "settled" && excessive.state().actual_microusd === 4820);
for (const selectedEnv of [env, terraEnv]) {
  const begin = ledger({ lostBeginAck: true }); let fetched = 0;
  await assert.rejects(azureSurfaceReply({ compiled, turns, env: selectedEnv, db: begin.db,
    fetchImpl: async () => { fetched++; return terraResponse(); } }));
  assert.equal(fetched, 0); assert.equal(begin.state().state, "in_flight");
  assert.ok(!begin.calls.some(c => c.sql.includes("with released as")));
  for (const committed of [false, true]) {
    const state = ledger({ lostSettlementAck: true, settlementCommitted: committed });
    await assert.rejects(azureSurfaceReply({ compiled, turns, env: selectedEnv, db: state.db, fetchImpl: async () => terraResponse() }));
    assert.equal(state.calls.filter(c => c.sql.includes("with settled as")).length, 1);
    assert.equal(state.state().state, committed ? "settled" : "reconcile_required");
  }
}
ok("both model paths retain unknown begin holds and never retry lost settlement acknowledgements", true);
console.log(`Azure shared reply: ${n} checks passed; no cloud calls or SQL type claims.`);
