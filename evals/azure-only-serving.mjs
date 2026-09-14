import assert from "node:assert/strict";
import { isAzureOnlyServing, assertAzureServingOrigin, resolveReplyServingProvider } from "../api/_model-serving-policy.js";
import { replyEngineCapability } from "../api/_reply-engine-capability.js";
import { think } from "../api/_surface.js";
import { embedBatch, EMBED_DIM } from "../api/_embed.js";
import { createProductionClaimExtractor } from "../api/_claim-extraction/registry.js";
import { createExtractionBatch } from "../api/_claim-extraction/contracts.js";

let checks = 0;
const pass = (name) => console.log(`ok ${++checks} - ${name}`);
const strict = { VYAKTI_MODEL_SERVING: "azure_only" };
assert.equal(isAzureOnlyServing(strict), true);
assert.equal(isAzureOnlyServing({}), false);
assert.equal(resolveReplyServingProvider(strict), "azure_foundry");
assert.equal(resolveReplyServingProvider({}), "openrouter");
pass("strict default and legacy default are separate and explicit");

for (const origin of ["https://fixture.services.ai.azure.com/models", "https://fixture.openai.azure.com/openai/v1",
  "https://fixture.cognitiveservices.azure.com", "https://eastus.api.cognitive.microsoft.com",
  "https://fixture.region.azurecontainerapps.io", "https://fixture.azurewebsites.net", "https://eastus.stt.speech.microsoft.com"]) {
  assert.ok(assertAzureServingOrigin(origin, strict) instanceof URL);
}
pass("seven Azure origin families accept their API paths");
for (const origin of ["https://openrouter.ai", "http://fixture.openai.azure.com", "https://fixture.openai.azure.com.evil.test",
  "https://openai.azure.com", "https://user:private@fixture.openai.azure.com", "https://fixture.openai.azure.com:444",
  "https://fixture.azurecontainerapps.io.evil.test", "https://127.0.0.1", "https://fixture.openai.azure.com/#private", "invalid-private-input"]) {
  assert.throws(() => assertAzureServingOrigin(origin, strict), error =>
    error.code === "model_serving_origin_denied" && error.message === "model_serving_origin_denied");
}
assert.doesNotThrow(() => assertAzureServingOrigin("https://legacy.example.test", {}));
pass("ten hostile origins reject with content-free errors; non-mode policy preserves legacy");

const compiled = { core: "Fixture expert", tail: "Only fixture evidence" };
const turns = [{ role: "user", content: "Fixture question" }];
let calls = [];
const noNetwork = async (...args) => { calls.push(args); assert.fail("unexpected transport"); };
const noDb = async () => assert.fail("unexpected database");
const foreign = { OPENROUTER_API_KEY: "fixture-not-a-real-key" };
assert.equal(replyEngineCapability({ ...strict, ...foreign }).available, false);
assert.equal(await think(null, compiled, turns, { env: { ...strict, ...foreign }, fetchImpl: noNetwork, db: noDb }), "");
assert.equal(calls.length, 0);
pass("strict shared reply with missing Azure config cannot use a foreign key");
for (const requested of ["openrouter", "unknown"]) {
  const env = { ...strict, ...foreign, VYAKTI_REPLY_PROVIDER: requested };
  assert.equal(replyEngineCapability(env).available, false);
  assert.equal(await think(null, compiled, turns, { env, fetchImpl: noNetwork, db: noDb }), "");
}
assert.equal(calls.length, 0);
pass("retired reply overrides cannot select a foreign provider or reach transport");

const replyEnv = { ...strict, ...foreign,
  AZURE_FOUNDRY_ENDPOINT: "https://fixture.services.ai.azure.com/",
  AZURE_FOUNDRY_DIALOGUE_MODEL: "fixture-model", AZURE_FOUNDRY_API_KEY: "fixture-not-a-real-key",
  AZURE_REPLICA_APP_BUDGET_USD: "1", AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: "1",
  AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS: "1" };
// Test-only prices and ledger, never deployment configuration or accounting proof.
function ledger() {
  let row;
  return async (sql, p) => {
    if (sql.includes("insert into vy_provider_budget")) return [];
    if (sql.includes("with budget as")) {
      row = { reservation_id: "fixture-reservation", budget_id: p[0], request_hash: p[7], reserved_microusd: p[10], state: "reserved" };
      return [row];
    }
    if (sql.includes("set state='in_flight'")) return [{ ...row, state: "in_flight" }];
    if (sql.includes("with settled as")) return [{ budget_id: row.budget_id }];
    if (sql.includes("reconcile_required") || sql.includes("with released as")) return [];
    assert.fail("unexpected fixture ledger statement");
  };
}
const chatResponse = () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Fixture answer" } }],
  usage: { prompt_tokens: 3, completion_tokens: 2 } }));
calls = [];
assert.equal(replyEngineCapability(replyEnv).available, true);
assert.equal(await think(null, compiled, turns, { env: replyEnv, db: ledger(), fetchImpl: async (url, init) => {
  calls.push(String(url)); assert.equal(init.redirect, "error"); return chatResponse();
} }), "Fixture answer");
assert.deepEqual(calls, ["https://fixture.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview"]);
pass("actual shared reply calls Azure by default in strict mode and settles its fixture ledger");
calls = [];
await assert.rejects(think(null, compiled, turns, { env: replyEnv, db: ledger(), fetchImpl: async (url) => {
  calls.push(String(url)); throw new Error("private transport details");
} }), error => !error.message.includes("private transport details"));
assert.equal(calls.length, 1); assert.ok(calls[0].includes(".services.ai.azure.com/"));
pass("Azure reply failure does not retry through OpenRouter");
calls = [];
assert.equal(await think(null, compiled, turns, { env: foreign, db: noDb, fetchImpl: async (url) => {
  calls.push(String(url)); return chatResponse();
} }), "");
assert.deepEqual(calls, []);
pass("Room never falls back to the legacy OpenRouter reply outside strict mode");

const embeddingEnv = { ...strict, ...foreign, AZURE_ENDPOINT: "https://fixture.openai.azure.com/openai/v1",
  AZURE_API_KEY: "fixture-not-a-real-key" };
const vector = Array.from({ length: EMBED_DIM }, () => 0.125);
const embeddingResponse = () => new Response(JSON.stringify({ data: [{ index: 0, embedding: vector }], usage: { total_tokens: 2 } }));
calls = [];
assert.deepEqual(await embedBatch(["fixture"], { env: embeddingEnv, fetchImpl: async (url, init) => {
  calls.push(String(url)); assert.equal(init.redirect, "error"); return embeddingResponse();
} }), [vector]);
assert.deepEqual(calls, ["https://fixture.openai.azure.com/openai/v1/embeddings"]);
pass("strict embedding success uses the Azure transport and preserves vector shape");
for (const [name, env, fetchImpl, expectedCalls] of [
  ["no config", { ...strict, ...foreign }, noNetwork, 0],
  ["foreign endpoint", { ...embeddingEnv, AZURE_ENDPOINT: "https://openrouter.ai/api/v1" }, noNetwork, 0],
  ["HTTP failure", embeddingEnv, async (url) => { calls.push(String(url)); return new Response("", { status: 503 }); }, 1],
  ["network failure", embeddingEnv, async (url) => { calls.push(String(url)); throw new Error("fixture"); }, 1],
  ["invalid vector", embeddingEnv, async (url) => { calls.push(String(url)); return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] })); }, 1],
]) {
  calls = [];
  assert.deepEqual(await embedBatch(["fixture"], { env, fetchImpl }), [null]);
  assert.equal(calls.length, expectedCalls);
  assert.ok(calls.every(url => url.startsWith("https://fixture.openai.azure.com/")));
  pass(`strict embedding ${name} returns absent vector without foreign fallback`);
}
calls = [];
assert.deepEqual(await embedBatch(["fixture"], { env: foreign, fetchImpl: async (url) => {
  calls.push(String(url)); return embeddingResponse();
} }), [vector]);
assert.deepEqual(calls, ["https://openrouter.ai/api/v1/embeddings"]);
pass("legacy embedding fallback still works outside strict mode");

const claimForeign = { OPENROUTER_API_KEY: "fixture-not-a-real-key", OPENROUTER_CLAIM_MODEL: "fixture/model" };
calls = [];
assert.throws(() => createProductionClaimExtractor({ ...strict, ...claimForeign }, { fetchImpl: noNetwork }),
  { code: "claim_extractor_unavailable" });
assert.equal(calls.length, 0);
pass("strict claims refuse missing Azure configuration despite configured OpenRouter");
const claimEnv = { ...strict, ...claimForeign, AZURE_FOUNDRY_ENDPOINT: "https://fixture.services.ai.azure.com",
  AZURE_FOUNDRY_CLAIM_MODEL: "fixture-model", AZURE_FOUNDRY_API_KEY: "fixture-not-a-real-key" };
assert.throws(() => createProductionClaimExtractor({ ...claimEnv, AZURE_FOUNDRY_ENDPOINT: "https://fixture.services.ai.azure.com.evil.test" },
  { fetchImpl: noNetwork }), { code: "model_serving_origin_denied" });
pass("strict claim configuration rejects a deceptive Azure hostname before transport");
const batch = createExtractionBatch([{ evidence_id: "30000000-0000-4000-8000-000000000003",
  source_id: "40000000-0000-4000-8000-000000000004", span_start_ms: 0, span_end_ms: 6000,
  confidence: 0.91, input_sha256: "a".repeat(64), record_hash: "b".repeat(64), text: "I prefer short answers.", language: "en-IN" }]);
const claimResponse = () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"claims":[]}' } }],
  usage: { prompt_tokens: 3, completion_tokens: 2 } }));
calls = [];
const extractor = createProductionClaimExtractor(claimEnv, { fetchImpl: async (url, init) => {
  calls.push(String(url)); assert.equal(init.redirect, "error"); return claimResponse();
} });
const extracted = await extractor.extract({ batch });
assert.equal(extracted.output.proposals.length, 0);
assert.equal(calls.length, 1);
assert.equal(calls[0], "https://fixture.services.ai.azure.com/openai/v1/chat/completions");
pass("strict production claim factory dispatches through the real Azure adapter with redirect refusal");
calls = [];
await assert.rejects(createProductionClaimExtractor(claimEnv, { fetchImpl: async (url) => {
  calls.push(String(url)); return new Response("", { status: 503 });
} }).extract({ batch }), { code: "azure_foundry_http_503" });
assert.equal(calls.length, 1); assert.ok(calls[0].startsWith("https://fixture.services.ai.azure.com/"));
pass("Azure claim failure cannot retry through another provider");
calls = [];
await createProductionClaimExtractor(claimForeign, { fetchImpl: async (url) => {
  calls.push(String(url)); return claimResponse();
} }).extract({ batch });
assert.deepEqual(calls, ["https://openrouter.ai/api/v1/chat/completions"]);
pass("legacy claim factory still serves its explicit fixture outside strict mode");
console.log(`Azure-only serving: ${checks} checks passed; mocked transports and ledger only, no cloud calls.`);
