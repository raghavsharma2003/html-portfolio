import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REVIEW_REASONS,
  clientEvidence,
  decideOwnedEvidence,
  ownedReviewStatus,
  queueOwnedVoiceGenome,
  safeEvidenceSummary,
  safeFacts,
} from "../../api/_replica-review.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const EID = "30000000-0000-4000-8000-000000000003";
const SOURCE = "40000000-0000-4000-8000-000000000004";
const ARTIFACT = "50000000-0000-4000-8000-000000000005";
const HASH = "a".repeat(64);
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

function evidence(type, index, extras = {}) {
  return {
    evidence_id: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
    replica_id: RID,
    owner_user_id: OWNER,
    source_id: SOURCE,
    artifact_id: ARTIFACT,
    evidence_type: type,
    span_start_ms: 0,
    span_end_ms: 1_000,
    confidence: 0.9,
    value: {},
    input_sha256: HASH,
    record_hash: String(index).padStart(64, "0"),
    adapter_family: "real-family",
    adapter_name: "real-adapter",
    adapter_version: "1.0",
    contains_third_parties: false,
    decision: "accepted",
    reason_code: "measurement_verified",
    reviewed_at: "2026-08-24T00:00:00.000Z",
    created_at: "2026-08-24T00:00:00.000Z",
    ...extras,
  };
}

const readyEvidence = [
  evidence("voice_embedding", 1, { value: { family: "ecapa", vector: [0.1, 0.2] } }),
  evidence("voice_embedding", 2, { value: { family: "wavlm", vector: [0.3, 0.4] } }),
  evidence("voice_measurement", 3, { value: { pitch_hz: { median: 142 }, private_note: "never return" } }),
  evidence("quality_measurement", 4, { value: { snr_db: 21.5 } }),
  evidence("speaker_segment", 5, { value: { target_likelihood: 0.98 } }),
  evidence("transcript_span", 6, { value: { text: "private transcript" }, reason_code: "segment_verified" }),
];

function dbFixture({ owned = true, evidenceRows = readyEvidence } = {}) {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    if (/select r\.replica_id,\s*r\.liveness_verified_at/i.test(sql) && !/with owned as/i.test(sql)) {
      return owned ? [{ replica_id: RID, liveness_verified_at: "2026-08-24T00:00:00.000Z", biometric_consent: true, training_consent: true }] : [];
    }
    if (/select e\.evidence_id,e\.source_id/i.test(sql)) return evidenceRows;
    if (/from vy_replica_source s join vy_replica r/i.test(sql)) return [];
    if (/from vy_replica_processing_job j/i.test(sql)) return [];
    if (/from vy_replica_processing_attempt a/i.test(sql)) return [];
    if (/from vy_replica_processing_artifact a/i.test(sql)) return [{
      artifact_id: ARTIFACT, source_id: SOURCE, parent_artifact_id: null, stage: "enhance",
      variant_key: "identity", mime: "audio/wav", byte_size: 48000, duration_ms: 1000,
      sha256: "b".repeat(64), input_sha256: HASH, transform_name: "enhance",
      transform_version: "1.0", adapter_family: "real-family", adapter_name: "real-enhancer",
      adapter_version: "1.0", created_at: "2026-08-24T00:00:00.000Z",
    }];
    if (/from vy_replica_model_build b/i.test(sql)) return [];
    if (/from vy_replica_voice_genome g/i.test(sql)) return [];
    if (/insert into vy_replica_processing_evidence_decision/i.test(sql)) {
      return owned ? [{ decision_id: RID, evidence_id: EID, decision: params[3], reason_code: params[4], created_at: "2026-08-24T00:00:00.000Z" }] : [];
    }
    if (/insert into vy_replica_model_build/i.test(sql)) {
      return owned ? [{ build_id: RID, build_kind: "voice_genome", target_version: 1, builder_version: "voice-genome-builder/v1", state: "queued", attempt: 0, failure_code: "", created_at: "2026-08-24T00:00:00.000Z", updated_at: "2026-08-24T00:00:00.000Z" }] : [];
    }
    throw new Error(`unexpected SQL: ${sql.slice(0, 100)}`);
  };
  return { db, calls };
}

const secretSummary = safeEvidenceSummary("voice_embedding", { family: "ecapa", vector: [0.1, 0.2, 0.3], transcript: "private words", provider_ref: "secret" });
ok("client evidence exposes vector dimensions but never the vector", secretSummary.family === "ecapa" && secretSummary.dimensions === 3 && !("vector" in secretSummary));
ok("client evidence does not expose transcript or provider reference", !("transcript" in secretSummary) && !("provider_ref" in secretSummary));
ok("attempt facts are allowlisted and bounded", JSON.stringify(safeFacts({ duration_ms: 10, credential: "x", segment_count: 2 })).includes("segment_count") && !JSON.stringify(safeFacts({ credential: "x" })).includes("credential"));
ok("non-finite measurements are discarded", !("snr_db" in safeEvidenceSummary("quality_measurement", { snr_db: Infinity })));
const client = clientEvidence(evidence("voice_embedding", 7, { value: { family: "ecapa", vector: Array(192).fill(0.2), transcript: "private" } }));
ok("client response is whitelist-built", !/(record_hash|input_sha256|vector|transcript|owner_user_id)/.test(JSON.stringify(client)));
ok("hidden transcript evidence cannot be decided in this review surface", clientEvidence(readyEvidence.at(-1)).reviewable === false);

const statusHarness = dbFixture();
const review = await ownedReviewStatus(statusHarness.db, OWNER, RID);
ok("owner status computes a ready VoiceGenome boundary from reviewed real evidence", review.voice_genome_readiness.ready && review.voice_genome_readiness.embedding_families === 2);
ok("every owner status query binds replica and verified owner", statusHarness.calls.every((call) => call.params[0] === RID && call.params[1] === OWNER));
ok("status never returns evidence hashes or raw values", !/(record_hash|input_sha256|private_note|vector)/.test(JSON.stringify(review)));
ok("cross-owner status resolves to not found", await ownedReviewStatus(dbFixture({ owned: false }).db, OWNER, RID) === null);

await assert.rejects(
  decideOwnedEvidence(dbFixture().db, OWNER, { replica_id: RID, evidence_id: EID, decision: "accepted", reason_code: "wrong_speaker" }),
  /valid decision/,
);
ok("decision and reason must belong to the same controlled vocabulary", REVIEW_REASONS.accepted.includes("matches_subject") && !REVIEW_REASONS.accepted.includes("wrong_speaker"));
const decisionHarness = dbFixture();
const decision = await decideOwnedEvidence(decisionHarness.db, OWNER, { replica_id: RID, evidence_id: EID, decision: "rejected", reason_code: "wrong_speaker" });
ok("owner decision is appended", decision?.decision === "rejected");
const decisionCall = decisionHarness.calls.find((call) => /insert into vy_replica_processing_evidence_decision/i.test(call.sql));
ok("decision insert persists replica and owner tuple from owned evidence", /\(evidence_id,replica_id,owner_user_id,decision/i.test(decisionCall.sql) && decisionCall.params[1] === OWNER);
ok("decision SQL only admits review-safe evidence types", /e\.evidence_type=any\(\$6::text\[\]\)/i.test(decisionCall.sql) && !decisionCall.params[5].includes("transcript_span"));
ok("evidence decisions fail fast instead of racing an in-flight immutable build snapshot",
  /pg_try_advisory_xact_lock/.test(decisionCall.sql) && /voice_genome_review/.test(decisionCall.sql));

const fakeRows = readyEvidence.map((row) => ({ ...row, adapter_name: "deterministic-fake" }));
await assert.rejects(queueOwnedVoiceGenome(dbFixture({ evidenceRows: fakeRows }).db, OWNER, RID), (error) => error?.message === "voice_genome_not_ready" && error?.details?.reviewed_real_evidence === 0);
ok("fixture or mock evidence can never queue a VoiceGenome", true);
const thirdPartyRows = readyEvidence.map((row) => ({ ...row, contains_third_parties: true }));
await assert.rejects(queueOwnedVoiceGenome(dbFixture({ evidenceRows: thirdPartyRows }).db, OWNER, RID), /voice_genome_not_ready/);
ok("third-party-bearing evidence can never queue a self VoiceGenome", true);

const queueHarness = dbFixture();
const build = await queueOwnedVoiceGenome(queueHarness.db, OWNER, RID);
ok("qualified evidence queues only a draft build", build.state === "queued" && !JSON.stringify(build).includes("approved"));
const queueCall = queueHarness.calls.find((call) => /insert into vy_replica_model_build/i.test(call.sql));
ok("queue serialization uses a per-replica advisory transaction lock", /pg_advisory_xact_lock/i.test(queueCall.sql));
ok("identical source sets are idempotent", /on conflict \(replica_id,build_kind,source_set_hash\)/i.test(queueCall.sql));
const changed = readyEvidence.map((row, index) => index === 0 ? { ...row, record_hash: "f".repeat(64) } : row);
const changedHarness = dbFixture({ evidenceRows: changed });
await queueOwnedVoiceGenome(changedHarness.db, OWNER, RID);
const changedCall = changedHarness.calls.find((call) => /insert into vy_replica_model_build/i.test(call.sql));
ok("source-set commitment changes when immutable evidence changes", queueCall.params[2] !== changedCall.params[2]);
const transcriptChanged = readyEvidence.map((row) => row.evidence_type === "transcript_span" ? { ...row, record_hash: "e".repeat(64) } : row);
const transcriptHarness = dbFixture({ evidenceRows: transcriptChanged });
await queueOwnedVoiceGenome(transcriptHarness.db, OWNER, RID);
const transcriptCall = transcriptHarness.calls.find((call) => /insert into vy_replica_model_build/i.test(call.sql));
ok("hidden transcript changes cannot alter VoiceGenome lineage", queueCall.params[2] === transcriptCall.params[2]);

const migration = readFileSync(join(ROOT, "db/migrations/020_replica_review_isolation.sql"), "utf8");
ok("review migration is split-safe", splitSql(migration).length === 10);
ok("decision schema carries composite evidence ownership", /foreign key \(evidence_id, replica_id, owner_user_id\)[\s\S]*references vy_replica_processing_evidence\(evidence_id, replica_id, owner_user_id\)/i.test(migration));
ok("database enforces reviewer equals owner", /check \(reviewer_user_id = owner_user_id\)/i.test(migration));
ok("database makes source-set queueing idempotent", /unique index if not exists vy_replica_model_build_source_set_ix[\s\S]*\(replica_id, build_kind, source_set_hash\)/i.test(migration));

const route = readFileSync(join(ROOT, "api/replica-review.js"), "utf8");
ok("HTTP route derives ownership from bearer authentication", /const user = await requireUser\(req\)/.test(route) && /user\.id/.test(route));
ok("HTTP route never reads a request owner id", !/body\.(?:owner|owner_user_id|user_id|device)/.test(route));
const studio = readFileSync(join(ROOT, "src/studio/ProcessingReview.tsx"), "utf8");
ok("Studio explicitly tells owners what remains withheld", /Raw transcripts, voice vectors, storage locations, provider references/.test(studio));

console.log(`\n${checks} replica review checks passed`);
