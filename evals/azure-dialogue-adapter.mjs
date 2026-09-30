// Real adapter and private-dialogue service control flow, synthetic transports
// and database rows only. No Azure request, credentials, or SQL execution.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createAzureFoundryDialogueGenerator as create } from "../api/_dialogue/providers/azure-foundry.js";
import { createProductionDialogueGenerator, createProductionComparisonGenerator } from "../api/_dialogue/registry.js";
import { DIALOGUE_OUTPUT_SCHEMA, compileDialoguePrompt } from "../api/_dialogue/contracts.js";
import { REPLICA_POLICY_VERSION } from "../api/_replica.js";
import { canonicalJson, sha256Hex } from "../api/_provenance/contracts.js";
import { buildPrivateCorrectionArtifact, renderPrivateCorrectionCandidate } from "../api/_replica-correction-artifact.js";
import { materializationModel } from "../api/_replica-candidate-materializer.js";
import { prepareProviderRevisionBinding, verifyProviderRevision } from "../api/_dialogue/provider-revision.js";

const sourceUrl = new URL("../api/_dialogue/providers/azure-foundry.js", import.meta.url);
const source = readFileSync(sourceUrl, "utf8").replace(/\r\n/g, "\n");
// This service receives its database explicitly. Block the transitive default
// DB transport at import so tests need neither secret config nor live access.
const dbUrl = new URL("../api/_db.js", import.meta.url).href;
const recallUrl = new URL("../api/_recall-run.js", import.meta.url);
const recallVersion = readFileSync(recallUrl, "utf8").match(/export const RECALL_RUN_METHOD_VERSION = "[^"]+";/)?.[0];
assert.ok(recallVersion, "readiness's actual recall method constant is available");
const imports = registerHooks({ load(url, context, next) {
  if (url === dbUrl) return { format: "module", shortCircuit: true,
    source: "export async function q(){ throw new Error('unexpected default database transport'); }" };
  // Runtime imports this method constant through readiness. Its unrelated
  // recall-run inference implementation is never part of a dialogue test.
  if (url === recallUrl.href) return { format: "module", shortCircuit: true, source: recallVersion };
  return next(url, context);
} });
let generateOwnedDialogue;
try { ({ generateOwnedDialogue } = await import("../api/_replica-dialogue.js")); } finally { imports.deregister(); }
const settings = { endpoint: "https://synthetic.services.ai.azure.com", model: "synthetic-structured-model", apiKey: "synthetic-test-key-no-credentials" };
const output = { reply: "Synthetic source says 23 minutes solving, then 13 minutes reviewing.",
  delivery: { mode: "grounded", pace: "natural", intensity: 0.3, language_hint: "English", nonverbals: [] } };
const prompt = compileDialoguePrompt({ core: "Synthetic source: 23 minutes solving, then 13 reviewing.", relationship: "", history: [], message: "State the order and times." });
const payload = usage => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage });
const response = (...args) => new Response(JSON.stringify(payload(args.length ? args[0] : { prompt_tokens: 101, completion_tokens: 23 })));
let checks = 0;
function ok(name, value = true) { assert.ok(value, name); console.log(`ok ${++checks} - ${name}`); }
const reject = (run, code) => assert.rejects(run, e => e.code === code);
async function mutant(label, transform) {
  const changed = transform(source); assert.notEqual(changed, source, label + " changed actual adapter source");
  const absolute = changed.replace(/from "(\.[^"]+)"/g, (_, path) => `from ${JSON.stringify(new URL(path, sourceUrl).href)}`);
  return import(`data:text/javascript;base64,${Buffer.from(absolute + "\n// " + label).toString("base64")}`);
}
let request;
const normal = create({ ...settings, fetchImpl: async (url, init) => { request = { url: String(url), init }; return response(); } });
const result = await normal.generate({ prompt });
assert.deepEqual(result, { output: JSON.stringify(output), usage: { input_tokens: 101, output_tokens: 23 } });
const body = JSON.parse(request.init.body);
ok("normal Azure schema, messages, model and token ceiling are unchanged", body.model === settings.model && body.max_tokens === 700 && body.temperature === 0.45
  && body.response_format.json_schema.strict === true && JSON.stringify(body.response_format.json_schema.schema) === JSON.stringify(DIALOGUE_OUTPUT_SCHEMA)
  && JSON.stringify(body.messages) === JSON.stringify(prompt.messages) && normal.billing.max_output_tokens === 700);
ok("normal transport refuses redirects and keeps credentials out of URL/body", request.init.redirect === "error" && request.init.method === "POST"
  && request.init.headers["api-key"] === settings.apiKey && !request.url.includes(settings.apiKey) && !request.init.body.includes(settings.apiKey));
for (const [name, usage] of [
  ["missing usage", undefined], ["null usage", null], ["empty usage", {}], ["zero total usage", { prompt_tokens: 0, completion_tokens: 0 }],
  ...[undefined, null, "0", "12", "bad", -1, 1.25, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN].flatMap(value => [
    ["prompt " + typeof value + ":" + String(value), { prompt_tokens: value, completion_tokens: 23 }],
    ["completion " + typeof value + ":" + String(value), { prompt_tokens: 101, completion_tokens: value }],
  ]),
]) {
  let calls = 0;
  await reject(() => create({ ...settings, fetchImpl: async () => { calls++; return response(usage); } }).generate({ prompt }), "dialogue_azure_usage_invalid");
  ok("malformed reported units refuse without coercion: " + name, calls === 1);
}
const zero = await create({ ...settings, fetchImpl: async () => response({ prompt_tokens: 101, completion_tokens: 0 }) }).generate({ prompt });
ok("explicit integer zero is preserved; budget settlement laws remain responsible for total usage", zero.usage.input_tokens === 101 && zero.usage.output_tokens === 0);
await reject(() => create({ ...settings, fetchImpl: async () => new Response(JSON.stringify(payload({ prompt_tokens: 101, completion_tokens: 23 })).replace('"prompt_tokens":101', '"prompt_tokens":1e400')) }).generate({ prompt }), "dialogue_azure_usage_invalid");
ok("valid JSON with an overflowing numeric exponent cannot supply measured units");
const pre = new AbortController(); pre.abort(new Error("synthetic cancellation reason")); let preCalls = 0;
await reject(() => create({ ...settings, fetchImpl: async () => { preCalls++; return response(); } }).generate({ prompt, signal: pre.signal }), "dialogue_aborted");
ok("already-aborted caller cannot dispatch even when injected fetch ignores its signal", preCalls === 0);
const inFlight = new AbortController(); let transportSignal;
const interrupted = create({ ...settings, fetchImpl: async (_, init) => {
  transportSignal = init.signal;
  return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
} }).generate({ prompt, signal: inFlight.signal });
inFlight.abort(new Error("synthetic private cancellation")); await reject(() => interrupted, "dialogue_aborted");
ok("in-flight abort propagates to transport and returns only named refusal", transportSignal.aborted);

function streamed(chunks, headers) {
  let index = 0; const state = { reads: 0, cancelled: 0 };
  const stream = new ReadableStream({ pull(controller) {
    if (index === chunks.length) return controller.close();
    state.reads++; controller.enqueue(chunks[index++]);
  }, cancel() { state.cancelled++; } }, { highWaterMark: 0 });
  return { state, response: new Response(stream, { headers }) };
}
const validBytes = Buffer.from(JSON.stringify(payload({ prompt_tokens: 101, completion_tokens: 23 })));
const boundary = Buffer.concat([validBytes, Buffer.alloc(512_000 - validBytes.length, 32)]);
const exact = streamed([boundary.subarray(0, 17), boundary.subarray(17)]);
assert.deepEqual((await create({ ...settings, fetchImpl: async () => exact.response }).generate({ prompt })).usage, result.usage);
ok("exact existing 512000-byte boundary is accepted", exact.state.cancelled === 0);
const oversizedChunks = () => [Buffer.alloc(256_000, 32), Buffer.alloc(256_001, 32), Buffer.alloc(1_000, 32)];
for (const headers of [undefined, { "content-length": "1" }]) {
  const stream = streamed(oversizedChunks(), headers);
  await reject(() => create({ ...settings, fetchImpl: async () => stream.response }).generate({ prompt }), "dialogue_azure_response_too_large");
  ok("stream overflow cancels before reading the tail despite " + (headers ? "false length" : "absent length"), stream.state.reads === 2 && stream.state.cancelled === 1);
}
const declared = streamed([validBytes], { "content-length": "512001" });
await reject(() => create({ ...settings, fetchImpl: async () => declared.response }).generate({ prompt }), "dialogue_azure_response_too_large");
ok("oversized declared length cancels without reading bytes", declared.state.reads === 0 && declared.state.cancelled === 1);
const multilingualPayload = payload({ prompt_tokens: 101, completion_tokens: 23 });
multilingualPayload.choices[0].message.content = JSON.stringify({ ...output, reply: "पहले 23 मिनट, फिर 13 मिनट।" });
const utf8 = Buffer.from(JSON.stringify(multilingualPayload));
const multilingual = streamed(Array.from(utf8, byte => new Uint8Array([byte])));
ok("UTF-8 split across single-byte chunks preserves the exact Hindi output", (await create({ ...settings, fetchImpl: async () => multilingual.response }).generate({ prompt })).output === multilingualPayload.choices[0].message.content);
let fallbackRead = false;
await reject(() => create({ ...settings, fetchImpl: async () => ({ ok: true, status: 200, text: async () => { fallbackRead = true; return "{}"; } }) }).generate({ prompt }), "dialogue_azure_response_invalid");
ok("a non-streaming body cannot enter an unbounded text fallback", !fallbackRead);
let bodyCancelled = 0, startBody;
const bodyStarted = new Promise(resolve => { startBody = resolve; });
const stalled = new ReadableStream({ pull() { startBody(); }, cancel() { bodyCancelled++; } }, { highWaterMark: 0 });
const bodyAbort = new AbortController();
const stalledCall = create({ ...settings, fetchImpl: async () => new Response(stalled) }).generate({ prompt, signal: bodyAbort.signal });
await bodyStarted; bodyAbort.abort(); await reject(() => stalledCall, "dialogue_aborted");
ok("caller cancellation unblocks a stalled response reader and cancels its body", bodyCancelled === 1);

for (const status of [301, 302, 307, 308]) {
  let calls = 0;
  await reject(() => create({ ...settings, fetchImpl: async (_, init) => { calls++; assert.equal(init.redirect, "error"); return new Response("", { status, headers: { location: "https://outside.example.invalid" } }); } }).generate({ prompt }), "dialogue_azure_redirect_refused");
  ok("returned HTTP redirect has a named refusal without another adapter dispatch: " + status, calls === 1);
}
const followed = response(); Object.defineProperty(followed, "redirected", { value: true });
await reject(() => create({ ...settings, fetchImpl: async () => followed }).generate({ prompt }), "dialogue_azure_redirect_refused");
ok("defensive response metadata refuses an already-followed redirect");
for (const status of [400, 429, 503]) {
  let cancelled = 0;
  await assert.rejects(() => create({ ...settings, fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { status }) }).generate({ prompt }),
    e => e.code === `dialogue_azure_http_${status}` && e.retryable === (status !== 400));
  ok("HTTP classification is preserved and error body is cancelled: " + status, cancelled === 1);
}
const incomplete = payload({ prompt_tokens: 101, completion_tokens: 23 }); incomplete.choices[0].finish_reason = "length";
await assert.rejects(() => create({ ...settings, fetchImpl: async () => new Response(JSON.stringify(incomplete)) }).generate({ prompt }), e => e.code === "dialogue_azure_response_incomplete" && e.retryable);
ok("structured response incompleteness remains a named refusal");

const oldUsage = await mutant("former-usage-coercion", text => text.replace(/function measuredUsage\(usage\) \{[\s\S]*?\n\}/,
  `function measuredUsage(usage) { return { input_tokens: Math.max(0, Number(usage?.prompt_tokens) || 0), output_tokens: Math.max(0, Number(usage?.completion_tokens) || 0) }; }`));
ok("NEGATIVE CONTROL: former actual coercion fabricates zero missing input units", (await oldUsage.createAzureFoundryDialogueGenerator({ ...settings, fetchImpl: async () => response({ completion_tokens: 23 }) }).generate({ prompt })).usage.input_tokens === 0);
const noEntryAbort = await mutant("no-predispatch-abort", text => text.replace('      if (signal?.aborted) fail("dialogue_aborted");\n', ""));
let wronglyDispatched = 0;
await reject(() => noEntryAbort.createAzureFoundryDialogueGenerator({ ...settings, fetchImpl: async () => { wronglyDispatched++; return response(); } }).generate({ prompt, signal: pre.signal }), "dialogue_aborted");
ok("NEGATIVE CONTROL: listener propagation alone still dispatches a pre-aborted call", wronglyDispatched === 1);
const unbounded = await mutant("former-buffer-before-bound", text => text.replace(/async function responseJson\(response, signal, maxBytes = 512_000\) \{[\s\S]*?\n\}\n\nfunction measuredUsage/,
  `async function responseJson(response, signal, maxBytes = 512_000) { const text = await response.text(); if (Buffer.byteLength(text) > maxBytes) fail("dialogue_azure_response_too_large"); return JSON.parse(text); }\n\nfunction measuredUsage`));
const excess = streamed(oversizedChunks());
await reject(() => unbounded.createAzureFoundryDialogueGenerator({ ...settings, fetchImpl: async () => excess.response }).generate({ prompt }), "dialogue_azure_response_too_large");
ok("NEGATIVE CONTROL: former text buffering reads the entire oversized tail", excess.state.reads === 3 && excess.state.cancelled === 0);
const redirectsAllowed = await mutant("redirect-default", text => text.replace('          redirect: "error",\n', ""));
let redirectedDispatch = 0;
await redirectsAllowed.createAzureFoundryDialogueGenerator({ ...settings, fetchImpl: async (_, init) => { if (init.redirect !== "error") redirectedDispatch++; return response(); } }).generate({ prompt });
ok("NEGATIVE CONTROL: removing real fetch redirect option exposes default-follow dispatch", redirectedDispatch === 1);
// Drive the actual deadline callback without changing duration configuration or
// spending five real seconds in a deterministic unit test.
const timed = await mutant("controlled-clock", text => `let deadlineCallback; const setTimeout=callback=>{deadlineCallback=callback;return 0;}; const clearTimeout=()=>{};\n${text}\nexport function expireTestDeadline(){deadlineCallback();}`);
const timedCall = timed.createAzureFoundryDialogueGenerator({ ...settings, fetchImpl: async (_, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))) }).generate({ prompt });
timed.expireTestDeadline(); await assert.rejects(() => timedCall, e => e.code === "dialogue_azure_timeout" && e.retryable);
ok("actual deadline callback still distinguishes provider timeout from caller abort");

// Exercise the real private-dialogue -> adapter -> spend reconciliation seam.
// These are typed synthetic DB return rows, not authority or actual SQL proof.
const id = n => `${n}0000000-0000-4000-8000-000000000001`;
const row = { replica_id: id(1), owner_user_id: id(2), subject_person_id: id(3), agent_id: id(4), subject_mode: "self", lifecycle: "active", policy_version: REPLICA_POLICY_VERSION,
  age_verified_at: "2026-08-24T00:00:00Z", identity_verified_at: "2026-08-24T00:00:00Z", liveness_verified_at: "2026-08-24T00:00:00Z", identity_expires_at: "2031-08-24T00:00:00Z",
  agent_status: "active", capability_id: id(5), capability_state: "active", runtime_policy: "replica-runtime-v1", qualification_hash: "a".repeat(64),
  voice_profile_id: id(6), genome_version: 3, profile_version: 7, calibration_version: 2, provider: "azure", provider_ref: "synthetic-no-voice", model: "synthetic-voice", voice_status: "ready", capabilities: {}, genome_status: "approved",
  profile_status: "approved", profile_definition: { identity: { self_name: "Synthetic fixture" }, speech: { languages: ["English"] }, behavior: { turn_shape: "brief" } },
  calibration_status: "approved", calibration_definition: { schema: "vyakti.calibration.v1", builder: "calibration-builder/v1", strategies: [] },
  consent_id: id(9), consent_scope: "inference", consent_policy: REPLICA_POLICY_VERSION, consent_expires_at: "2031-08-24T00:00:00Z" };
const bindingHash = value => sha256Hex(canonicalJson(value));
const candidateRevision = prepareProviderRevisionBinding({ expectedResponseModel: "gpt-4.1-mini-2025-04-14",
  endpoint: "https://raghavsharma1729-compan-resource.services.ai.azure.com", deployment: "gpt-4.1-mini", baselineSnapshotHash: "b".repeat(64) });
const candidateAdapter = { family: "dialogue", name: "azure-foundry-structured-output", version: "synthetic-candidate-v1", model: "gpt-4.1-mini",
  billing: { meter: "azure_foundry_tokens", max_output_tokens: 700 }, revision_binding: candidateRevision, async generate() {} };
const candidateBase = { replica: { replica_id: row.replica_id }, capability: { capability_id: "a0000000-0000-4000-8000-000000000001" },
  personProfile: { definition: row.profile_definition }, calibration: { definition: row.calibration_definition }, candidateBinding: null };
const candidateArtifact = buildPrivateCorrectionArtifact(candidateBase, { status: "proposed", owner_approved: false, runtime_eligible: false,
  source_set_hash: "a".repeat(64), selections: [{ scenario_id: "delivery.turn_shape", strategy_id: "compact_observation" }] }).artifact;
const candidateIdentity = verifyProviderRevision({ model: candidateRevision.expected_response_model, system_fingerprint: "fp_fixture47" }, candidateRevision);
const candidateBindingRow = { activation_id: "b0000000-0000-4000-8000-000000000001", exposure: "owner_private_text", selection_kind: "qualified",
  candidate_id: "c0000000-0000-4000-8000-000000000001", qualification_binding: { base_capability_id: candidateBase.capability.capability_id,
    artifact_sha256: bindingHash(candidateArtifact), build_manifest_hash: "c".repeat(64) }, artifact_snapshot: candidateArtifact,
  core_hash: bindingHash(renderPrivateCorrectionCandidate(candidateBase, candidateArtifact).core),
  model_commitment: materializationModel(candidateAdapter, { AZURE_CORRECTION_BASE_MODEL_COMMITMENT: "b".repeat(64) }).commitment,
  base_model_commitment: "b".repeat(64), provider_revision_binding: candidateRevision, provider_identity: candidateIdentity };
async function service(factory, usage, options = {}) {
  const calls = [];
  let providerCalls = 0;
  const db = async (sql, params) => {
    calls.push({ sql, params });
    if (/select r\.replica_id,r\.owner_user_id/i.test(sql)) return [{ ...row, ...(options.candidate ? { capability_state: "private", candidate_binding_required: true } : {}) }];
    if (/^select h\.\* from vy_replica_candidate_activation/i.test(sql)) return options.candidate ? [candidateBindingRow] : [];
    if (/insert into vy_replica_runtime_session/i.test(sql)) return [{ session_id: id(7), replica_id: id(1), channel: "private_chat", state: "active" }];
    if (/from vy_rel_state|from vy_phrase|from vy_(?:pattern|ritual|currency|kin)|select recent\.ordinal/i.test(sql)) return [];
    if (/insert into vy_replica_dialogue_turn/i.test(sql)) return [{ turn_id: id(8), session_id: id(7), ordinal: 1 }];
    if (/assistant_log as/i.test(sql)) return options.finishDenied ? [] : [{ turn_id: id(8), session_id: id(7), ordinal: 1 }];
    if (/insert into vy_provider_budget/i.test(sql)) return [];
    if (/insert into vy_provider_spend/i.test(sql)) return [{ reservation_id: id(9), budget_id: params[0], request_hash: params[7], state: "reserved", reserved_microusd: params[10] }];
    if (/set state='in_flight'/i.test(sql)) {
      if (options.beginLostAcknowledgement) throw Object.assign(new Error("synthetic begin acknowledgement lost"), { code: "provider_start_ack_lost" });
      if (options.beginDenied) return [];
      return [{ reservation_id: id(9), state: "in_flight" }];
    }
    if (/with settled as/i.test(sql)) {
      if (options.settleLostAcknowledgement) throw Object.assign(new Error("synthetic settlement acknowledgement lost"), { code: "provider_settlement_ack_lost" });
      return [{ budget_id: "synthetic-dialogue-budget", state: "active" }];
    }
    if (/set state='released'|set state='reconcile_required'|update vy_replica_dialogue_turn set state/i.test(sql)) return [];
    throw new Error("unexpected synthetic service query");
  };
  let result, error;
  try { result = await generateOwnedDialogue(db, id(2), { replica_id: id(1), channel: "private_chat", message: "Synthetic question", trace_id: "synthetic-adapter-test" },
    factory({ ...settings, fetchImpl: async () => { providerCalls++; return response(usage); } })); } catch (cause) { error = cause; }
  return { calls, result, error, providerCalls };
}
const terraEnv={AZURE_REPLICA_BUDGET_ID:'synthetic-dialogue-budget',AZURE_REPLICA_APP_BUDGET_USD:'1',AZURE_FOUNDRY_DIALOGUE_RATE_MODEL:'gpt-5.6-terra',AZURE_FOUNDRY_DIALOGUE_EXPECTED_RESPONSE_MODEL:'gpt-5.6-terra-2026-07-09',AZURE_FOUNDRY_DIALOGUE_INPUT_USD_PER_MTOKENS:'2',AZURE_FOUNDRY_DIALOGUE_OUTPUT_USD_PER_MTOKENS:'12'};
const terraOptions={...settings,model:'gpt-5.6-terra',env:terraEnv};
for(const key of Object.keys(terraEnv).filter(x=>x.startsWith('AZURE_FOUNDRY_DIALOGUE_'))){
 const env={...terraEnv,[key]:undefined,AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS:'0.4',AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS:'1.6'};
 assert.throws(()=>create({...terraOptions,env}));
}
ok('Terra refuses missing dialogue-specific acknowledgment and rates despite populated generic mini rates');
assert.throws(()=>create({...terraOptions,env:{...terraEnv,AZURE_FOUNDRY_DIALOGUE_RATE_MODEL:'gpt-4.1-mini'}}),/rate_model_mismatch/);
assert.throws(()=>create({...terraOptions,env:{...terraEnv,AZURE_FOUNDRY_DIALOGUE_EXPECTED_RESPONSE_MODEL:'gpt-5.6-terra'}}),/expected_model_required/);
const priced=create(terraOptions),repriced=create({...terraOptions,env:{...terraEnv,AZURE_FOUNDRY_DIALOGUE_INPUT_USD_PER_MTOKENS:'3'}});
assert.notEqual(priced.version,repriced.version);assert.equal(priced.billing.budget_env.AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS,'2');
ok('Terra rate card enters immutable adapter identity; alternate explicit rates work without hardcoded price');
let terraBody;
const terraPayload={...payload({prompt_tokens:101,completion_tokens:23,completion_tokens_details:{reasoning_tokens:0}}),model:terraEnv.AZURE_FOUNDRY_DIALOGUE_EXPECTED_RESPONSE_MODEL,system_fingerprint:null};
const terraReply=await create({...terraOptions,fetchImpl:async(_,init)=>{terraBody=JSON.parse(init.body);return new Response(JSON.stringify(terraPayload));}}).generate({prompt});
assert.equal(terraBody.max_completion_tokens,700);assert.equal(terraBody.reasoning_effort,'none');assert(!('temperature'in terraBody));assert(!('max_tokens'in terraBody));assert.deepEqual(terraBody.response_format.json_schema.schema,DIALOGUE_OUTPUT_SCHEMA);assert.deepEqual(terraBody.messages,prompt.messages);
assert.equal(terraReply.provider_identity.fingerprint_status,'not_provided');assert.equal(terraReply.usage.output_tokens,23);
ok('ordinary Terra actual adapter preserves structured Meet prompt and700 total ceiling with optional fingerprint');
const mutableEnv={...terraEnv};const snap=create({...terraOptions,env:mutableEnv});mutableEnv.AZURE_FOUNDRY_DIALOGUE_OUTPUT_USD_PER_MTOKENS='99';assert.equal(snap.billing.budget_env.AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS,'12');assert.equal(snap.version,priced.version);
const registryEnv={...terraEnv,AZURE_FOUNDRY_ENDPOINT:'https://raghavsharma1729-compan-resource.services.ai.azure.com/',AZURE_FOUNDRY_API_KEY:settings.apiKey,AZURE_FOUNDRY_DIALOGUE_MODEL:'gpt-5.6-terra',
 AZURE_FOUNDRY_EXPECTED_RESPONSE_MODEL:'gpt-5.6-terra-2026-07-09',AZURE_CORRECTION_BASE_MODEL_COMMITMENT:'b'.repeat(64)};
const savedRegistryEnv=Object.fromEntries(Object.keys(registryEnv).map(k=>[k,process.env[k]]));
try{Object.assign(process.env,registryEnv);const registered=createProductionDialogueGenerator();assert.equal(registered.version,priced.version);assert.deepEqual(registered.billing.budget_env,priced.billing.budget_env);
 const comparison=createProductionComparisonGenerator();assert.equal(comparison.revision_binding.schema,'vyakti.azure-reported-revision.v2');assert.equal(comparison.model,'gpt-5.6-terra');}
finally{for(const [key,value]of Object.entries(savedRegistryEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;}
ok('actual production registry constructs the frozen model-specific rate binding without a provider call');

assert.throws(()=>materializationModel(priced,{AZURE_CORRECTION_BASE_MODEL_COMMITMENT:'b'.repeat(64)}),/materialization_provider_revision_required/);
const terraCompared=create({...terraOptions,endpoint:'https://raghavsharma1729-compan-resource.services.ai.azure.com/',revisionBinding:{expected_response_model:terraEnv.AZURE_FOUNDRY_DIALOGUE_EXPECTED_RESPONSE_MODEL,
 baseline_snapshot_hash:'b'.repeat(64)},fetchImpl:async()=>new Response(JSON.stringify(terraPayload))});
const terraComparedReply=await terraCompared.generate({prompt});
assert.equal(terraCompared.revision_binding.schema,'vyakti.azure-reported-revision.v2');
assert.equal(terraComparedReply.provider_identity.fingerprint_status,'not_provided');
assert.equal(materializationModel(terraCompared,{AZURE_CORRECTION_BASE_MODEL_COMMITMENT:'b'.repeat(64)}).pin,'b'.repeat(64));
assert.throws(()=>create({...terraOptions,revisionBinding:{expected_response_model:'gpt-4.1-mini-2025-04-14',baseline_snapshot_hash:'b'.repeat(64)}}),/provider_revision_expected_version_required/);
ok('Terra comparison requires its exact v2 dated-model binding and records explicit missing fingerprint');
const budgetEnv = { AZURE_REPLICA_BUDGET_ID: "synthetic-dialogue-budget", AZURE_REPLICA_APP_BUDGET_USD: "1", AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: "1", AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS: "1" };
const previousEnv = Object.fromEntries(Object.keys(budgetEnv).map(key => [key, process.env[key]]));
try {
  Object.assign(process.env, budgetEnv);
  const bad = await service(create, { completion_tokens: 23 });
  ok("real service keeps missing-usage spend uncertain and never persists a successful reply", bad.error?.code === "dialogue_azure_usage_invalid"
    && bad.calls.some(call => /set state='reconcile_required'/.test(call.sql)) && !bad.calls.some(call => /with settled as|assistant_log as/.test(call.sql)));
  const original = await service(oldUsage.createAzureFoundryDialogueGenerator, { completion_tokens: 23 });
  ok("NEGATIVE CONTROL: former coercion lets real service settle fabricated zero input units", original.result?.billing_state === "settled"
    && original.calls.find(call => /with settled as/.test(call.sql))?.params[3] === 0);
  const good = await service(create, { prompt_tokens: 101, completion_tokens: 23 });
  ok("real service still persists and settles valid structured transport output", !good.error && good.result?.billing_state === "settled"
    && good.calls.find(call => /with settled as/.test(call.sql))?.params[3] === 101);
  const lostBegin = await service(create, { prompt_tokens: 101, completion_tokens: 23 }, { beginLostAcknowledgement: true });
  ok("lost begin acknowledgement retains the reservation for reconciliation and never releases or dispatches",
    lostBegin.error?.code === "provider_start_ack_lost" && lostBegin.providerCalls === 0
    && lostBegin.calls.some(call => /set state='reconcile_required'/.test(call.sql))
    && !lostBegin.calls.some(call => /set state='released'/.test(call.sql)));
  const concurrentBegin = await service(create, { prompt_tokens: 101, completion_tokens: 23 }, { beginDenied: true });
  ok("concurrent denied begin cannot release a reservation another attempt may own",
    concurrentBegin.error?.code === "provider_spend_start_failed" && concurrentBegin.providerCalls === 0
    && concurrentBegin.calls.some(call => /set state='reconcile_required'/.test(call.sql))
    && !concurrentBegin.calls.some(call => /set state='released'/.test(call.sql)));
  const refusedUsage = { input_tokens: 37, output_tokens: 11 };
  const ordinaryRevisionRefusal = await service(() => ({
    family: "dialogue", name: "synthetic-ordinary-revision-refusal", version: "1", model: settings.model,
    billing: { meter: "azure_foundry_tokens", max_output_tokens: 700 },
    async generate() { throw Object.assign(new Error("synthetic wrong revision"), { code: "provider_revision_response_model_mismatch", measured_usage: refusedUsage }); },
  }));
  const ordinarySettlements = ordinaryRevisionRefusal.calls.filter(call => /with settled as/.test(call.sql));
  ok("ordinary dialogue refusal settles its trusted measured usage once without returning the refused answer",
    ordinaryRevisionRefusal.error?.code === "provider_revision_response_model_mismatch" && !ordinaryRevisionRefusal.result
    && ordinarySettlements.length === 1 && ordinarySettlements[0].params[3] === 37 && ordinarySettlements[0].params[4] === 11
    && !ordinaryRevisionRefusal.calls.some(call => /set state='released'|set state='reconcile_required'/.test(call.sql)));
  const invalidOutput = await service(() => ({
    family: "dialogue", name: "synthetic-ordinary-invalid-output", version: "1", model: settings.model,
    billing: { meter: "azure_foundry_tokens", max_output_tokens: 700 },
    async generate() { return { output: "not-json", usage: { input_tokens: 41, output_tokens: 13 } }; },
  }));
  const invalidOutputSettlements = invalidOutput.calls.filter(call => /with settled as/.test(call.sql));
  ok("ordinary post-response validation failure settles returned measured usage once and withholds output",
    !!invalidOutput.error && !invalidOutput.result && invalidOutputSettlements.length === 1
    && invalidOutputSettlements[0].params[3] === 41 && invalidOutputSettlements[0].params[4] === 13);
  const changedAuthority = await service(create, { prompt_tokens: 43, completion_tokens: 17 }, { finishDenied: true });
  const changedAuthoritySettlements = changedAuthority.calls.filter(call => /with settled as/.test(call.sql));
  ok("ordinary post-response authority loss settles returned measured usage once and withholds output",
    changedAuthority.error?.code === "dialogue_authorization_changed" && !changedAuthority.result
    && changedAuthoritySettlements.length === 1 && changedAuthoritySettlements[0].params[3] === 43 && changedAuthoritySettlements[0].params[4] === 17);
  const candidateSettlementUnknown = await service(() => ({ ...candidateAdapter,
    async generate() { return { output, usage: { input_tokens: 47, output_tokens: 19 }, provider_identity: candidateIdentity }; },
  }), undefined, { candidate: true, settleLostAcknowledgement: true, finishDenied: true });
  const candidateSettlementAttempts = candidateSettlementUnknown.calls.filter(call => /with settled as/.test(call.sql));
  ok("candidate settlement acknowledgement loss is never retried when later authority validation refuses",
    candidateSettlementUnknown.error?.code === "dialogue_authorization_changed" && !candidateSettlementUnknown.result
    && candidateSettlementAttempts.length === 1
    && candidateSettlementUnknown.calls.some(call => /set state='reconcile_required'/.test(call.sql))
    && !candidateSettlementUnknown.calls.some(call => /set state='released'/.test(call.sql)));
  const terraFactory=options=>create({...options,model:'gpt-5.6-terra',env:terraEnv,fetchImpl:async(...args)=>{await options.fetchImpl(...args);return new Response(JSON.stringify(terraPayload));}});
  const terraGood=await service(terraFactory);
  const terraSettlement=terraGood.calls.find(x=>/with settled as/.test(x.sql));
  assert.equal(terraGood.result.billing_state,'settled');assert.equal(terraSettlement.params[5],478);assert.equal(terraSettlement.params[4],23);
  ok('real private Meet settles scoped Terra2/12 once while generic1/1 config remains untouched');
  for(const [label,patch]of [['wrong dated model',{model:'gpt-5.6-terra'}],['length',{choices:[{finish_reason:'length',message:{content:'partial'}}]}],['malformed fingerprint',{system_fingerprint:42}],['invalid reasoning',{usage:{prompt_tokens:101,completion_tokens:23,completion_tokens_details:{reasoning_tokens:24}}}],['invalid structured output',{choices:[{finish_reason:'stop',message:{content:'not-json'}}]}]]){
    const refused=await service(options=>create({...options,model:'gpt-5.6-terra',env:terraEnv,fetchImpl:async(...args)=>{await options.fetchImpl(...args);return new Response(JSON.stringify({...terraPayload,...patch}));}}));
    assert(refused.error);assert(!refused.result);const settlements=refused.calls.filter(x=>/with settled as/.test(x.sql));assert.equal(settlements.length,1);assert.equal(settlements[0].params[5],478);assert(!refused.calls.some(x=>/assistant_log as|set state='released'/.test(x.sql)));
    ok('Terra '+label+' refusal settles known usage once before returning the error');
  }
  const terraLostBegin=await service(terraFactory,undefined,{beginLostAcknowledgement:true});assert.equal(terraLostBegin.providerCalls,0);assert(terraLostBegin.calls.some(x=>/reconcile_required/.test(x.sql)));assert(!terraLostBegin.calls.some(x=>/set state='released'/.test(x.sql)));
  const terraLostSettle=await service(terraFactory,undefined,{settleLostAcknowledgement:true});assert.equal(terraLostSettle.providerCalls,1);assert.equal(terraLostSettle.calls.filter(x=>/with settled as/.test(x.sql)).length,1);assert.equal(terraLostSettle.result.billing_state,'reconcile_required');
  ok('Terra retains unknown begin and settlement ACK behavior without dispatch retry or release');
  const reasoningIncluded=await service(options=>create({...options,model:'gpt-5.6-terra',env:terraEnv,fetchImpl:async(...args)=>{await options.fetchImpl(...args);return new Response(JSON.stringify({...terraPayload,usage:{prompt_tokens:101,completion_tokens:23,completion_tokens_details:{reasoning_tokens:7}}}));}}));
  assert.equal(reasoningIncluded.calls.find(x=>/with settled as/.test(x.sql)).params[5],478);
  ok('reported reasoning is part of total completion usage and never charged twice');

  const oldCandidate=await service(terraFactory,undefined,{candidate:true});assert(oldCandidate.error);assert.equal(oldCandidate.providerCalls,0);assert(!oldCandidate.calls.some(x=>/insert into vy_provider_spend/.test(x.sql)));
  ok('actual private Meet refuses old mini candidate binding before Terra reservation or dispatch');
} finally { for (const [key, value] of Object.entries(previousEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
console.log(`\n${checks} Azure dialogue adapter checks passed; synthetic HTTP/DB only`);
