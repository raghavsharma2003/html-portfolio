import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { azureSurfaceReply, azureSurfaceReplyConfig } from "../../api/_azure-surface-reply.js";
import { replyEngineCapability } from "../../api/_reply-engine-capability.js";

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
function ledger({ deny = false, failSettlement = false, failBegin = false } = {}) {
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
    if (sql.includes("set state='in_flight'")) return failBegin ? [] : [{ ...row, state: "in_flight" }];
    if (sql.includes("with settled as")) return failSettlement ? [] : [{ budget_id: row.budget_id }];
    if (sql.includes("reconcile_required") || sql.includes("with released as")) return [];
    throw new Error("unexpected fixture query");
  };
  return { db, calls };
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
  source.includes('process.env.VYAKTI_REPLY_PROVIDER === "azure_foundry"') &&
  source.includes("azureSurfaceReply({ compiled, turns, db: q })") && source.includes("export async function gatedReply"));
ok("configured models never silently inherit a different lane's rates", (() => {
  assert.throws(() => azureSurfaceReplyConfig({ ...env, AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS: undefined,
    AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: "0.01" })); return true;
})());
console.log(`Azure shared reply: ${n} checks passed; no cloud calls or SQL type claims.`);
