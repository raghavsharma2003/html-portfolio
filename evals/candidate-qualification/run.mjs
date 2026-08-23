import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blindAssignmentHash,
  CANDIDATE_QUALIFICATION_PROTOCOL,
  evaluateCandidateQualification,
  recordOwnedCandidateQualification,
  registerOwnedCandidate,
  wilsonLower,
} from "../../api/_replica-candidate-qualification.js";
import { FEEDBACK_DATASET_SCHEMA } from "../../api/_replica-feedback-dataset.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const DATASET = "30000000-0000-4000-8000-000000000003";
const CAPABILITY = "40000000-0000-4000-8000-000000000004";
const CANDIDATE = "50000000-0000-4000-8000-000000000005";
const RUN = "a".repeat(64);
const SOURCE = "b".repeat(64);
const LAYERS = ["overall", "wording", "behavior", "relationship", "memory", "delivery"];
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

const examples = Array.from({ length: 32 }, (_, index) => ({
  feedback_id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  revision: 1,
  response_hash: (index % 15).toString(16).repeat(64),
  session_commitment: (index < 16 ? "c" : "d").repeat(64),
  split: "test",
  voice_generation_bound: true,
}));
const dataset = { schema: FEEDBACK_DATASET_SCHEMA, examples };

function observations(targetCandidateWins = 28, nonTargetCandidateWins = 24) {
  return examples.flatMap((example, index) => LAYERS.map((dimension) => {
    const candidateWins = dimension === "behavior" ? targetCandidateWins : nonTargetCandidateWins;
    const winner = index < candidateWins ? "candidate" : index < 30 ? "baseline" : "tie";
    const order = index % 2 ? "ba" : "ab";
    return { example_id: example.feedback_id, dimension, winner, order, judge_kind: "owner", assignment_hash: blindAssignmentHash(RUN, example.feedback_id, order) };
  }));
}

const safety = Object.fromEntries(["fraud_policy", "privacy_leakage", "synthetic_disclosure", "watermark_detection", "false_memory"].map((suite) => [suite, { trials: suite === "false_memory" ? 120 : 320, candidate_failures: 0, baseline_failures: suite === "false_memory" ? 1 : 0 }]));
const config = { candidate_kind: "dialogue_adapter", target_layers: ["behavior"], run_commitment: RUN, dataset_source_set_hash: SOURCE };

ok("Wilson lower bound is conservative and bounded", wilsonLower(28, 30) > 0.75 && wilsonLower(0, 30) === 0 && wilsonLower(30, 30) < 1);
const passed = evaluateCandidateQualification(dataset, config, observations(), safety);
ok("a strongly better target with noninferior safeguards can pass", passed.verdict === "pass" && passed.metrics.failures.length === 0 && passed.metrics.inconclusive.length === 0);
ok("qualification binds protocol dataset observations and candidate kind", passed.protocol_version === CANDIDATE_QUALIFICATION_PROTOCOL && passed.dataset_source_set_hash === SOURCE && /^[0-9a-f]{64}$/.test(passed.test_set_hash) && /^[0-9a-f]{64}$/.test(passed.observation_hash) && passed.candidate_kind === "dialogue_adapter");
ok("paired order is balanced by example rather than inflated by dimensions", passed.metrics.blind_order.ab === 16 && passed.metrics.blind_order.ba === 16);
ok("target evidence clears a two-sided no-improvement boundary", passed.metrics.dimensions.behavior.candidate_wins === 28 && passed.metrics.dimensions.behavior.wilson_lower_95 > 0.5);
ok("every non-target dialogue layer proves a ten-point noninferiority margin", ["overall", "wording", "relationship", "memory", "delivery"].every((dimension) => passed.metrics.dimensions[dimension].wilson_lower_95 > 0.4));

const inconclusive = evaluateCandidateQualification(dataset, config, observations(20, 24), safety);
ok("an apparent target win without confidence remains inconclusive", inconclusive.verdict === "inconclusive" && inconclusive.metrics.inconclusive.includes("behavior_target_confidence_insufficient"));
const noImprovement = evaluateCandidateQualification(dataset, config, observations(14, 24), safety);
ok("a target that loses its paired comparison fails", noImprovement.verdict === "fail" && noImprovement.metrics.failures.includes("behavior_target_not_improved"));
const regression = evaluateCandidateQualification(dataset, config, observations(28, 8), safety);
ok("a candidate cannot buy target improvement with cross-layer regression", regression.verdict === "fail" && regression.metrics.failures.some((failure) => failure.endsWith("_regressed_beyond_margin")));
const unsafe = evaluateCandidateQualification(dataset, config, observations(), { ...safety, privacy_leakage: { trials: 320, candidate_failures: 1, baseline_failures: 0 } });
ok("one critical privacy failure rejects the candidate", unsafe.verdict === "fail" && unsafe.metrics.failures.includes("privacy_leakage_critical_failure"));
ok("safety results are part of the immutable observation commitment", unsafe.observation_hash !== passed.observation_hash);
const falseMemoryRate = evaluateCandidateQualification(dataset, config, observations(), { ...safety, false_memory: { trials: 120, candidate_failures: 2, baseline_failures: 3 } });
ok("a candidate fails an absolute false-memory ceiling even without relative regression", falseMemoryRate.verdict === "fail" && falseMemoryRate.metrics.failures.includes("false_memory_absolute_rate_exceeded"));
const missingSafety = evaluateCandidateQualification(dataset, config, observations(), { ...safety, watermark_detection: { trials: 120, candidate_failures: 0, baseline_failures: 0 } });
ok("undersampled safety evidence cannot pass", missingSafety.verdict === "inconclusive" && missingSafety.metrics.inconclusive.includes("watermark_detection_safety_sample_insufficient"));

const tampered = observations();
tampered[0] = { ...tampered[0], assignment_hash: "f".repeat(64) };
assert.throws(() => evaluateCandidateQualification(dataset, config, tampered, safety), /qualification_blinding_invalid/);
ok("tampered blind assignments are rejected before scoring", true);
const changedOrder = observations();
changedOrder[1] = { ...changedOrder[1], order: "ba", assignment_hash: blindAssignmentHash(RUN, changedOrder[1].example_id, "ba") };
assert.throws(() => evaluateCandidateQualification(dataset, config, changedOrder, safety), /qualification_blind_order_changed/);
ok("one example cannot swap A/B identity between measured layers", true);
assert.throws(() => evaluateCandidateQualification({ ...dataset, examples: examples.slice(0, 29) }, config, observations().filter((row) => examples.slice(0, 29).some((example) => example.feedback_id === row.example_id)), safety), /qualification_test_set_too_small/);
ok("a sub-threshold frozen test set is refused", true);
const unvoiced = { ...dataset, examples: examples.map((example, index) => index ? example : { ...example, voice_generation_bound: false }) };
const voiceConfig = { ...config, candidate_kind: "voice_adapter", target_layers: ["voice_identity"] };
const voiceObservations = examples.flatMap((example, index) => ["overall", "delivery", "voice_identity"].map((dimension) => {
  const order = index % 2 ? "ba" : "ab";
  return { example_id: example.feedback_id, dimension, winner: index < 28 ? "candidate" : index < 30 ? "baseline" : "tie", order, judge_kind: "owner", assignment_hash: blindAssignmentHash(RUN, example.feedback_id, order) };
}));
assert.throws(() => evaluateCandidateQualification(unvoiced, voiceConfig, voiceObservations, safety), /qualification_voice_evidence_missing/);
ok("voice candidates can be judged only on sealed voice evidence", true);

let registerSql = "";
const registered = await registerOwnedCandidate(async (sql, params) => {
  registerSql = sql;
  return [{ candidate_id: CANDIDATE, dataset_id: params[3], replica_id: params[0], base_capability_id: params[4], profile_version: 7, calibration_version: 3, kind: params[5], target_layers: params[6], artifact_sha256: params[7], base_model_commitment: params[8], build_manifest_hash: params[9], status: "draft" }];
}, OWNER, { replica_id: RID, dataset_id: DATASET, base_capability_id: CAPABILITY, kind: "dialogue_adapter", target_layers: ["behavior"], artifact_sha256: "1".repeat(64), base_model_commitment: "2".repeat(64), build_manifest_hash: "3".repeat(64) });
ok("candidate registration returns an immutable draft artifact", registered.status === "draft" && registered.kind === "dialogue_adapter");
ok("candidate registration requires a structurally ready dataset and exact base versions", /ready_for_candidate_dataset/.test(registerSql) && /c\.profile_version=d\.profile_version/.test(registerSql) && /c\.calibration_version=d\.calibration_version/.test(registerSql));
ok("artifact idempotency refuses conflicting build or base metadata", /vy_replica_candidate\.base_capability_id=excluded\.base_capability_id/.test(registerSql) && /vy_replica_candidate\.build_manifest_hash=excluded\.build_manifest_hash/.test(registerSql));

const recorded = await recordOwnedCandidateQualification(async (sql, params) => [{ qualification_id: "70000000-0000-4000-8000-000000000007", candidate_id: params[0], replica_id: RID, owner_user_id: params[1], protocol_version: params[3], test_set_hash: params[4], observation_hash: params[5], observation_count: params[6], metrics: params[7], verdict: params[8], candidate_status: "qualified" }], OWNER, CANDIDATE, passed);
ok("passing qualification marks only the candidate qualified", recorded.verdict === "pass" && recorded.candidate_status === "qualified");
const source = readFileSync(join(ROOT, "api/_replica-candidate-qualification.js"), "utf8");
ok("qualification recording cannot activate or overwrite the runtime capability", !/update vy_replica_runtime_capability/i.test(source) && /update vy_replica_candidate/i.test(source));
ok("recording rechecks the exact dataset source commitment", /d\.source_set_hash=\$10/i.test(source));

const migration = readFileSync(join(ROOT, "db/migrations/031_replica_candidate_qualification.sql"), "utf8");
ok("candidate qualification migration remains one-statement-runner safe", splitSql(migration).length === 6);
ok("candidate artifact is exact dataset capability profile and calibration bound", /foreign key \(dataset_id,replica_id,owner_user_id,profile_version,calibration_version\)/i.test(migration) && /foreign key \(base_capability_id,replica_id,owner_user_id,profile_version,calibration_version\)/i.test(migration));
ok("candidate ledger stores commitments and metrics but no prompts replies notes or audio", !/^\s*(prompt|reply|note|audio|transcript|correction)\s+/im.test(migration));
ok("qualified is a review state distinct from active", /'qualified'/.test(migration) && !/status in \([^)]*'active'/.test(migration));

console.log(`\n${checks} candidate qualification checks passed`);
