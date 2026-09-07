// Actual bundled client parser/callers, with HTTP responses supplied locally.
import assert from "node:assert/strict";
import { build } from "vite";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildFeedbackDatasetDefinition } from "../api/_replica-feedback-dataset.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const rid = "10000000-0000-4000-8000-000000000001", cap = "20000000-0000-4000-8000-000000000001";
const dataset = "30000000-0000-4000-8000-000000000001", time = "2026-09-07T00:00:00Z";
const row = { feedback_id: dataset, turn_id: dataset, session_id: dataset, revision: 1, profile_version: 1, calibration_version: 1,
  ratings: { wording: "exact" }, ratings_hash: "a".repeat(64), response_hash: "b".repeat(64) };
const definition = buildFeedbackDatasetDefinition([row], [], { replica_id: rid, capability_id: cap, profile_version: 1, calibration_version: 1 });
const review = { replica_id: rid, state: "collecting", can_build: true, binding: { capability_id: cap, profile_version: 1, calibration_version: 1 },
  source_set_hash: definition.source_set_hash, stats: definition.definition.stats, readiness: definition.readiness,
  dataset: null, changed_since_saved: false, checked_at: time };
const receipt = { dataset_id: dataset, version: 1, capability_id: cap, profile_version: 1, calibration_version: 1,
  source_set_hash: review.source_set_hash, status: "draft", created_at: time };
const output = await build({ root, configFile: false, logLevel: "silent", ssr: { noExternal: true },
  build: { ssr: root + "src/studio/feedbackApi.ts", write: false, minify: false, rolldownOptions: { output: { format: "cjs", codeSplitting: false } } } });
const code = output.output.find(item => item.type === "chunk" && item.isEntry).code;
let checks = 0, calls = [], response = { review };
const module = { exports: {} };
runInNewContext(code, { module, exports: module.exports, require: createRequire(import.meta.url), AbortSignal,
  fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => structuredClone(response) }; } });
const api = module.exports;
function ok(name, test) { test(); console.log(`ok ${++checks} - ${name}`); }
ok("actual built parser accepts current non-ready evidence", () => assert.equal(api.parseFeedbackDatasetReview(review, rid).readiness.ready_for_candidate_dataset, false));
for (const [name, mutate] of [
  ["wrong replica", r => { r.replica_id = cap; }],
  ["false readiness", r => { r.readiness.ready_for_candidate_dataset = true; }],
  ["false named ready", r => { r.state = "ready"; }],
  ["absent authority", r => { r.binding = null; }],
  ["newline capability", r => { r.binding.capability_id += "\n"; }],
  ["newline source hash", r => { r.source_set_hash += "\n"; }],
  ["negative counts", r => { r.stats.sessions = -1; }],
  ["missing readiness dimension", r => { delete r.stats.dimension_counts.memory; }],
  ["fake stale state", r => { r.state = "stale"; }],
  ["receipt wrong version", r => { r.dataset = { ...receipt, profile_version: 0 }; }],
  ["false unchanged receipt", r => { r.dataset = { ...receipt, source_set_hash: "f".repeat(64) }; }],
]) ok("reject " + name, () => { const bad = structuredClone(review); mutate(bad); assert.throws(() => api.parseFeedbackDatasetReview(bad, rid), e => e.status === 502); });
const controller = new AbortController();
await api.readFeedbackDatasetReview("synthetic-token", rid, controller.signal);
ok("real GET caller binds owner authorization and replica query", () => { assert.match(calls[0].url, /replica-feedback-dataset\?replica_id=/); assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-token"); assert.equal(calls[0].options.method, undefined); });
controller.abort();
ok("real GET cancellation survives the bounded timeout composition", () => assert.equal(calls[0].options.signal.aborted, true));
response = { review: { ...review, dataset: receipt } };
await api.prepareFeedbackDataset("synthetic-token", rid, review.source_set_hash);
ok("real POST submits only replica and exact reviewed hash", () => assert.deepEqual(JSON.parse(calls.at(-1).options.body), { replica_id: rid, expected_source_set_hash: review.source_set_hash }));
const before = calls.length;
await assert.rejects(() => api.prepareFeedbackDataset("synthetic-token", rid, ""), e => e.status === 400);
ok("missing reviewed hash never dispatches HTTP", () => assert.equal(calls.length, before));
response = { review };
await assert.rejects(() => api.prepareFeedbackDataset("synthetic-token", rid, review.source_set_hash), e => e.status === 502);
ok("HTTP success without a matching stored receipt is not UI success", () => assert.equal(calls.length, before + 1));
// Negative control executes actual built parser with its replica guard removed.
const mutant = code.replace("review.replica_id !== replicaId ||", "");
assert.notEqual(mutant, code);
const badModule = { exports: {} };
runInNewContext(mutant, { module: badModule, exports: badModule.exports, require: createRequire(import.meta.url), AbortSignal });
ok("negative control: missing actual replica guard admits a foreign response", () => assert.equal(badModule.exports.parseFeedbackDatasetReview({ ...review, replica_id: cap }, rid).replica_id, cap));
console.log(`\n${checks} built correction-client checks passed; no network or model calls`);
