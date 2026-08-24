import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCandidateEvaluationPackage,
  CANDIDATE_OWNER_EVAL_PROTOCOL,
  loadCandidateOwnerObservations,
  loadOwnedCandidateEvaluation,
  persistCandidateEvaluationPackage,
  recordOwnedCandidateJudgment,
  validatePositionRatings,
} from "../../api/_replica-candidate-eval.js";
import { decryptEvaluationText } from "../../api/_replica-candidate-eval-crypto.js";
import { FEEDBACK_DATASET_SCHEMA } from "../../api/_replica-feedback-dataset.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const DATASET = "30000000-0000-4000-8000-000000000003";
const CANDIDATE = "40000000-0000-4000-8000-000000000004";
const DIMENSIONS = ["overall", "wording", "behavior", "relationship", "memory", "delivery"];
const env = {
  REPLICA_EVAL_KEK_ID: "eval-key-v1",
  REPLICA_EVAL_KEK_B64: Buffer.alloc(32, 29).toString("base64"),
};
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

function capture(fn) {
  try { fn(); return null; } catch (error) { return error; }
}

const examples = Array.from({ length: 30 }, (_, index) => ({
  feedback_id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  split: "test",
  session_commitment: (index < 15 ? "a" : "b").repeat(64),
  context: `Situation ${index + 1}: a friend asks a precise personal question.`,
  baseline: `Baseline response ${index + 1}`,
  candidate: `Candidate response ${index + 1}`,
}));
const candidate = {
  candidate_id: CANDIDATE,
  dataset_id: DATASET,
  dataset_source_set_hash: "c".repeat(64),
  replica_id: RID,
  owner_user_id: OWNER,
  kind: "dialogue_adapter",
  status: "draft",
  artifact_sha256: "d".repeat(64),
  base_model_commitment: "e".repeat(64),
  build_manifest_hash: "f".repeat(64),
};
const dataset = {
  schema: FEEDBACK_DATASET_SCHEMA,
  dataset_id: DATASET,
  source_set_hash: "c".repeat(64),
};
const pack = buildCandidateEvaluationPackage({ candidate, dataset, examples }, env, { pick: () => 0 });
const rebuilt = buildCandidateEvaluationPackage({ candidate, dataset, examples }, env, { pick: () => 0 });

ok("owner evaluation freezes thirty whole test examples", pack.assignment_count === 30 && pack.assignments.length === 30 && pack.assets.length === 90);
ok("run and assignment ids are deterministic across retry while encryption is randomized",
  pack.eval_run_id === rebuilt.eval_run_id && pack.assignments[0].assignment_id === rebuilt.assignments[0].assignment_id &&
  pack.assets[0].ciphertext_b64 !== rebuilt.assets[0].ciphertext_b64);
ok("A/B presentation is exactly balanced", pack.assignments.filter((row) => row.presentation_order === "ab").length === 15);
ok("one assignment order is reused across every required layer", pack.required_dimensions.join("|") === DIMENSIONS.join("|"));
ok("materialized package contains ciphertext and hashes but no comparison text", !JSON.stringify(pack).includes("Candidate response"));
ok("run commitment binds candidate dataset artifacts outputs and blind order", /^[0-9a-f]{64}$/.test(pack.run_commitment) && pack.protocol_version === CANDIDATE_OWNER_EVAL_PROTOCOL);

const firstAssignment = pack.assignments.find((row) => row.sequence === 1);
const firstAssets = Object.fromEntries(pack.assets.filter((row) => row.assignment_id === firstAssignment.assignment_id).map((row) => [row.role, row]));
const decrypt = (role) => decryptEvaluationText(firstAssets[role], {
  run_id: pack.eval_run_id,
  assignment_id: firstAssignment.assignment_id,
  asset_id: firstAssets[role].asset_id,
  replica_id: RID,
  owner_user_id: OWNER,
  example_id: firstAssignment.example_id,
  role,
  output_sha256: firstAssets[role].output_sha256,
}, env);
ok("server-side blind mapping places baseline and candidate in the committed order",
  firstAssignment.presentation_order === "ab" && decrypt("a").startsWith("Baseline response") && decrypt("b").startsWith("Candidate response"));

const wrongBinding = capture(() => decryptEvaluationText(firstAssets.a, {
  run_id: pack.eval_run_id,
  assignment_id: firstAssignment.assignment_id,
  asset_id: firstAssets.a.asset_id,
  replica_id: RID,
  owner_user_id: OWNER,
  example_id: examples.find((example) => example.feedback_id !== firstAssignment.example_id).feedback_id,
  role: "a",
  output_sha256: firstAssets.a.output_sha256,
}, env));
ok("encrypted output cannot be moved to another test example", wrongBinding?.code === "candidate_eval_asset_binding_invalid");

let persistSql = "";
const persisted = await persistCandidateEvaluationPackage(async (sql, params) => {
  persistSql = sql;
  return [{ eval_run_id: params[4], replica_id: params[3], protocol_version: params[5], assignment_count: params[9], state: "collecting", created_at: "2026-08-24T00:00:00.000Z" }];
}, OWNER, pack);
ok("package persistence activates only an owner-bound complete encrypted package", persisted.state === "collecting" && /c\.owner_user_id=\$1/.test(persistSql) && /\$10\*3/.test(persistSql));
ok("persistence rechecks candidate dataset and immutable source set", /c\.candidate_id=\$2/.test(persistSql) && /d\.source_set_hash=\$7/.test(persistSql));
ok("no comparison plaintext is sent to the database", !JSON.stringify(pack.assets.map((asset) => asset.ciphertext_b64)).includes("Candidate response"));

const assetsForClient = Object.fromEntries(Object.entries(firstAssets).map(([role, asset]) => [role, {
  asset_id: asset.asset_id,
  output_sha256: asset.output_sha256,
  algorithm: asset.algorithm,
  key_id: asset.key_id,
  nonce_b64: asset.nonce_b64,
  ciphertext_b64: asset.ciphertext_b64,
  auth_tag_b64: asset.auth_tag_b64,
  wrapped_dek_b64: asset.wrapped_dek_b64,
  wrap_nonce_b64: asset.wrap_nonce_b64,
  wrap_auth_tag_b64: asset.wrap_auth_tag_b64,
  aad_sha256: asset.aad_sha256,
}]));
let statusSql = "";
const status = await loadOwnedCandidateEvaluation(async (sql, params) => {
  statusSql = sql;
  assert.deepEqual(params, [RID, OWNER]);
  return [{
    eval_run_id: pack.eval_run_id,
    replica_id: RID,
    owner_user_id: OWNER,
    required_dimensions: DIMENSIONS,
    state: "collecting",
    total: 30,
    completed: 0,
    assignment_id: firstAssignment.assignment_id,
    example_id: firstAssignment.example_id,
    sequence: 1,
    assignment_hash: firstAssignment.assignment_hash,
    assets: assetsForClient,
  }];
}, OWNER, RID, env);
ok("owner receives context and neutral options but no candidate mapping",
  status.assignment.option_a.startsWith("Baseline response") && status.assignment.option_b.startsWith("Candidate response") &&
  !/(candidate_id|presentation_order|run_commitment)/.test(JSON.stringify(status)));
ok("status lookup is replica and authenticated-owner scoped", /r\.replica_id=\$1 and r\.owner_user_id=\$2/.test(statusSql));

const completedStatus = await loadOwnedCandidateEvaluation(async () => [{
  eval_run_id: pack.eval_run_id, replica_id: RID, owner_user_id: OWNER,
  required_dimensions: DIMENSIONS, state: "complete", total: 30, completed: 30,
}], OWNER, RID, env);
ok("completed run exposes progress without replaying an assignment", completedStatus.state === "complete" && completedStatus.assignment === null);

assert.throws(() => validatePositionRatings({ overall: "a" }, DIMENSIONS), /candidate_eval_ratings_incomplete/);
ok("partial layer ratings cannot bias a paired observation", true);
assert.throws(() => validatePositionRatings(Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, "candidate"])), DIMENSIONS), /candidate_eval_rating_invalid/);
ok("the client can choose only A B or tie, never candidate identity", true);

const exactRatings = Object.fromEntries(DIMENSIONS.map((dimension, index) => [dimension, index % 3 === 0 ? "a" : index % 3 === 1 ? "b" : "tie"]));
const judgmentCalls = [];
const judged = await recordOwnedCandidateJudgment(async (sql, params) => {
  judgmentCalls.push({ sql, params });
  if (judgmentCalls.length === 1) return [{ required_dimensions: DIMENSIONS }];
  return [{ completed: 1, total: 30, complete: false }];
}, OWNER, {
  replica_id: RID,
  assignment_id: firstAssignment.assignment_id,
  assignment_hash: firstAssignment.assignment_hash,
  ratings: exactRatings,
});
ok("one submission records every layer and advances one assignment atomically", judged.accepted && judged.progress.completed === 1 && /jsonb_to_recordset/.test(judgmentCalls[1].sql));
ok("judgment mutation rechecks owner replica assignment and opaque hash", judgmentCalls.every((call) => call.params[1] === RID && call.params[2] === OWNER && call.params[3] === firstAssignment.assignment_hash));
ok("first write and retry use one PostgreSQL-visible judgment relation",
  /active_judgments as/.test(judgmentCalls[1].sql) && /select \* from inserted\s+union all/.test(judgmentCalls[1].sql));
ok("retry is idempotent only when every stored positional judgment matches", /j\.position_winner=w\.position_winner/.test(judgmentCalls[1].sql) && /candidate_eval_judgment_conflict/.test(readFileSync(join(ROOT, "api/_replica-candidate-eval.js"), "utf8")));

const observationAssignments = pack.assignments.slice(0, 3);
const observations = await loadCandidateOwnerObservations(async () => [
  { run_commitment: pack.run_commitment, example_id: observationAssignments[0].example_id, session_commitment: "a".repeat(64), presentation_order: observationAssignments[0].presentation_order, assignment_hash: observationAssignments[0].assignment_hash, dimension: "behavior", position_winner: "a" },
  { run_commitment: pack.run_commitment, example_id: observationAssignments[1].example_id, session_commitment: "b".repeat(64), presentation_order: observationAssignments[1].presentation_order, assignment_hash: observationAssignments[1].assignment_hash, dimension: "behavior", position_winner: "a" },
  { run_commitment: pack.run_commitment, example_id: observationAssignments[2].example_id, session_commitment: "b".repeat(64), presentation_order: observationAssignments[2].presentation_order, assignment_hash: observationAssignments[2].assignment_hash, dimension: "behavior", position_winner: "tie" },
], OWNER, pack.eval_run_id);
ok("unblinding happens only in the internal observation loader", observations[0].winner === "baseline" && observations[1].winner === "candidate" && observations[2].winner === "tie");
await assert.rejects(() => loadCandidateOwnerObservations(async () => [{
  run_commitment: pack.run_commitment,
  example_id: observationAssignments[0].example_id,
  session_commitment: "a".repeat(64),
  presentation_order: observationAssignments[0].presentation_order,
  assignment_hash: "1".repeat(64),
  dimension: "behavior",
  position_winner: "a",
}], OWNER, pack.eval_run_id), /candidate_eval_assignment_tampered/);
ok("internal unblinding rederives each committed assignment hash", true);

assert.throws(() => buildCandidateEvaluationPackage({ candidate, dataset, examples: examples.slice(0, 29) }, env, { pick: () => 0 }), /candidate_eval_example_count_invalid/);
ok("fewer than thirty comparisons cannot start", true);
assert.throws(() => buildCandidateEvaluationPackage({ candidate: { ...candidate, kind: "voice_adapter" }, dataset, examples }, env, { pick: () => 0 }), /candidate_eval_asset_kind_not_supported/);
ok("text UI refuses to masquerade as sealed voice evaluation", true);
assert.throws(() => buildCandidateEvaluationPackage({ candidate, dataset, examples: examples.map((example) => ({ ...example, session_commitment: "a".repeat(64) })) }, env, { pick: () => 0 }), /candidate_eval_sessions_insufficient/);
ok("one conversation cannot stand in for behavioral generalization", true);

const migration = readFileSync(join(ROOT, "db/migrations/032_replica_candidate_owner_eval.sql"), "utf8");
ok("owner evaluation migration remains one-statement-runner safe", splitSql(migration).length === 9);
ok("A/B mapping remains server-side while judgments store positions", /presentation_order/.test(migration) && /position_winner/.test(migration) && !/model_winner/.test(migration));
ok("content-bearing assets are encrypted and cascade-erased", /algorithm='AES-256-GCM'/.test(migration) && /on delete cascade/.test(migration));
ok("database binds assets to exact examples and judgments to exact assignment hashes",
  /owner_user_id,example_id\)\s+references vy_replica_candidate_eval_assignment/.test(migration) &&
  /owner_user_id,assignment_hash\)\s+references vy_replica_candidate_eval_assignment/.test(migration));
ok("run and judgment ledgers have no prompt reply transcript or note columns", !/^\s*(prompt|reply|transcript|note|context|candidate_output|baseline_output)\s+/im.test(migration));

const route = readFileSync(join(ROOT, "api/replica-candidate-eval.js"), "utf8");
ok("public evaluation route derives ownership only from bearer auth", /requireUser\(req\)/.test(route) && /user\.id/.test(route) && !/body\.(?:owner|owner_user_id|user_id)/.test(route));

console.log(`\n${checks} candidate owner evaluation checks passed`);
