import { createHash } from "node:crypto";
import { replicaId } from "./_replica.js";

const DECISIONS = new Set(["accepted", "rejected", "superseded"]);
const VOICE_REVIEW_TYPES = new Set([
  "media_probe",
  "speaker_segment",
  "language_span",
  "voice_embedding",
  "voice_measurement",
  "quality_measurement",
]);
export const REVIEW_REASONS = Object.freeze({
  accepted: ["matches_subject", "clean_identity_signal", "measurement_verified", "segment_verified"],
  rejected: ["wrong_speaker", "third_party_present", "poor_quality", "corrupt_or_incomplete", "synthetic_or_replayed", "privacy_risk"],
  superseded: ["better_variant_selected", "newer_measurement", "corrected_segmentation", "source_replaced"],
});

const SAFE_FACTS = new Set(["duration_ms", "sample_rate_hz", "channels", "candidate_count", "segment_count", "artifact_count", "evidence_count", "retry_count"]);
const SAFE_MEASUREMENTS = new Set([
  "duration_ms", "sample_rate_hz", "channels", "codec", "target_likelihood", "overlap", "family", "dimensions",
  "pitch_hz_median", "pitch_hz_p10", "pitch_hz_p90", "energy_db_median", "energy_db_p10", "energy_db_p90",
  "speaking_rate_syllables_s_median", "pause_ms_median", "snr_db", "clipping_ratio", "usable_target_speech_ms", "language",
]);

function scalar(value) {
  if (typeof value === "string") return value.length <= 160 ? value : value.slice(0, 160);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  return typeof value === "boolean" ? value : undefined;
}

export function safeFacts(value) {
  const output = {};
  if (!value || typeof value !== "object") return output;
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_FACTS.has(key)) continue;
    const clean = scalar(item);
    if (clean !== undefined) output[key] = clean;
  }
  return output;
}

export function safeEvidenceSummary(type, value) {
  if (!value || typeof value !== "object") return {};
  const flattened = {
    ...value,
    pitch_hz_median: value.pitch_hz?.median,
    pitch_hz_p10: value.pitch_hz?.p10,
    pitch_hz_p90: value.pitch_hz?.p90,
    energy_db_median: value.energy_db?.median,
    energy_db_p10: value.energy_db?.p10,
    energy_db_p90: value.energy_db?.p90,
    speaking_rate_syllables_s_median: value.speaking_rate_syllables_s?.median,
    pause_ms_median: value.pause_ms?.median,
    dimensions: Array.isArray(value.vector) ? value.vector.length : value.dimensions,
  };
  const allowedByType = {
    media_probe: ["duration_ms", "sample_rate_hz", "channels", "codec"],
    speaker_segment: ["target_likelihood", "overlap"],
    transcript_span: [],
    language_span: ["language"],
    voice_embedding: ["family", "dimensions"],
    voice_measurement: ["pitch_hz_median", "pitch_hz_p10", "pitch_hz_p90", "energy_db_median", "energy_db_p10", "energy_db_p90", "speaking_rate_syllables_s_median", "pause_ms_median"],
    quality_measurement: ["snr_db", "clipping_ratio", "usable_target_speech_ms"],
  };
  const output = {};
  for (const key of allowedByType[type] || []) {
    if (!SAFE_MEASUREMENTS.has(key)) continue;
    const clean = scalar(flattened[key]);
    if (clean !== undefined) output[key] = clean;
  }
  return output;
}

export function clientEvidence(row) {
  return {
    evidence_id: row.evidence_id,
    source_id: row.source_id,
    artifact_id: row.artifact_id || null,
    evidence_type: row.evidence_type,
    reviewable: VOICE_REVIEW_TYPES.has(row.evidence_type),
    span_start_ms: row.span_start_ms == null ? null : Number(row.span_start_ms),
    span_end_ms: row.span_end_ms == null ? null : Number(row.span_end_ms),
    confidence: row.confidence == null ? null : Number(row.confidence),
    provenance: { family: row.adapter_family, name: row.adapter_name, version: row.adapter_version },
    summary: safeEvidenceSummary(row.evidence_type, row.value),
    decision: row.decision || null,
    reason_code: row.reason_code || "",
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
  };
}

function isRealEvidence(row) {
  const provenance = `${row.adapter_family} ${row.adapter_name} ${row.adapter_version}`.toLowerCase();
  return !/(fake|fixture|test|mock)/.test(provenance) && !row.contains_third_parties;
}

function readiness(rows, replica) {
  const accepted = rows.filter((row) => row.decision === "accepted" && VOICE_REVIEW_TYPES.has(row.evidence_type) && isRealEvidence(row));
  const count = (type) => accepted.filter((row) => row.evidence_type === type).length;
  const families = new Set(accepted.filter((row) => row.evidence_type === "voice_embedding").map((row) => String(row.value?.family || "")).filter(Boolean));
  const blockers = [];
  if (!replica?.liveness_verified_at) blockers.push("liveness_verification_required");
  if (!replica?.biometric_consent) blockers.push("biometric_consent_required");
  if (!replica?.training_consent) blockers.push("training_consent_required");
  if (families.size < 2) blockers.push("two_independent_embedding_families_required");
  if (count("voice_measurement") < 1) blockers.push("reviewed_voice_measurement_required");
  if (count("quality_measurement") < 1) blockers.push("reviewed_quality_measurement_required");
  if (count("speaker_segment") < 1) blockers.push("reviewed_speaker_segment_required");
  return {
    ready: blockers.length === 0,
    blockers,
    reviewed_real_evidence: accepted.length,
    embedding_families: families.size,
    voice_measurements: count("voice_measurement"),
    quality_measurements: count("quality_measurement"),
    speaker_segments: count("speaker_segment"),
  };
}

const OWNED = `select r.replica_id, r.liveness_verified_at,
  exists(select 1 from vy_replica_consent c where c.replica_id=r.replica_id and c.owner_user_id=$2 and c.scope='biometric' and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())) biometric_consent,
  exists(select 1 from vy_replica_consent c where c.replica_id=r.replica_id and c.owner_user_id=$2 and c.scope='training' and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())) training_consent
  from vy_replica r where r.replica_id=$1 and r.owner_user_id=$2 and r.lifecycle not in ('revoked','purging')`;

const EVIDENCE_SQL = `with owned as (${OWNED}), latest as (
  select distinct on (d.evidence_id) d.evidence_id,d.decision,d.reason_code,d.created_at reviewed_at
  from vy_replica_processing_evidence_decision d order by d.evidence_id,d.created_at desc,d.decision_id desc)
 select e.evidence_id,e.source_id,e.artifact_id,e.evidence_type,e.span_start_ms,e.span_end_ms,e.confidence,e.value,e.input_sha256,e.record_hash,
  e.adapter_family,e.adapter_name,e.adapter_version,e.created_at,l.decision,l.reason_code,l.reviewed_at,s.contains_third_parties
 from vy_replica_processing_evidence e join owned o on o.replica_id=e.replica_id
 join vy_replica_source s on s.source_id=e.source_id and s.replica_id=e.replica_id and s.owner_user_id=$2
 left join latest l on l.evidence_id=e.evidence_id order by e.created_at desc limit 300`;

export async function ownedReviewStatus(db, ownerUserId, value) {
  const rid = replicaId(value);
  const [replicas, sources, jobs, attempts, artifacts, evidence, builds] = await Promise.all([
    db(OWNED, [rid, ownerUserId]),
    db(`select s.source_id,s.kind,s.capture_mode,s.mime,s.byte_size,s.duration_ms,s.state,s.contains_third_parties,s.rejection_code,s.created_at,s.updated_at from vy_replica_source s join vy_replica r on r.replica_id=s.replica_id and r.owner_user_id=$2 where s.replica_id=$1 and s.owner_user_id=$2 order by s.created_at desc limit 100`, [rid, ownerUserId]),
    db(`select j.job_id,j.source_id,j.step,j.revision,j.state,j.attempt,j.failure_code,j.next_attempt_at,j.created_at,j.updated_at from vy_replica_processing_job j join vy_replica r on r.replica_id=j.replica_id and r.owner_user_id=$2 where j.replica_id=$1 and j.owner_user_id=$2 order by j.created_at desc limit 500`, [rid, ownerUserId]),
    db(`select a.job_id,a.attempt,a.outcome,a.adapter_family,a.adapter_name,a.adapter_version,a.failure_code,a.facts,a.started_at,a.finished_at from vy_replica_processing_attempt a join vy_replica_processing_job j on j.job_id=a.job_id join vy_replica r on r.replica_id=j.replica_id and r.owner_user_id=$2 where j.replica_id=$1 and j.owner_user_id=$2 order by a.started_at desc limit 500`, [rid, ownerUserId]),
    db(`select a.artifact_id,a.source_id,a.parent_artifact_id,a.created_by_job_id,a.stage,a.variant_key,a.mime,a.byte_size,a.duration_ms,a.transform_name,a.transform_version,a.adapter_family,a.adapter_name,a.adapter_version,a.created_at from vy_replica_processing_artifact a join vy_replica r on r.replica_id=a.replica_id and r.owner_user_id=$2 where a.replica_id=$1 and a.owner_user_id=$2 order by a.created_at desc limit 500`, [rid, ownerUserId]),
    db(EVIDENCE_SQL, [rid, ownerUserId]),
    db(`select b.build_id,b.build_kind,b.target_version,b.builder_version,b.state,b.attempt,b.failure_code,b.created_at,b.updated_at from vy_replica_model_build b join vy_replica r on r.replica_id=b.replica_id and r.owner_user_id=$2 where b.replica_id=$1 and b.owner_user_id=$2 order by b.created_at desc limit 50`, [rid, ownerUserId]),
  ]);
  if (!replicas[0]) return null;
  return {
    replica_id: rid,
    sources: sources.map((row) => ({ ...row, byte_size: Number(row.byte_size), duration_ms: row.duration_ms == null ? null : Number(row.duration_ms) })),
    jobs: jobs.map((row) => ({ ...row, revision: Number(row.revision), attempt: Number(row.attempt) })),
    attempts: attempts.map((row) => ({ job_id: row.job_id, attempt: Number(row.attempt), outcome: row.outcome, provenance: { family: row.adapter_family, name: row.adapter_name, version: row.adapter_version }, failure_code: row.failure_code, facts: safeFacts(row.facts), started_at: row.started_at, finished_at: row.finished_at })),
    artifacts: artifacts.map((row) => ({ artifact_id: row.artifact_id, source_id: row.source_id, parent_artifact_id: row.parent_artifact_id || null, created_by_job_id: row.created_by_job_id || null, stage: row.stage, variant_key: row.variant_key, mime: row.mime, byte_size: Number(row.byte_size), duration_ms: row.duration_ms == null ? null : Number(row.duration_ms), transform: { name: row.transform_name, version: row.transform_version }, provenance: { family: row.adapter_family, name: row.adapter_name, version: row.adapter_version }, created_at: row.created_at })),
    evidence: evidence.map(clientEvidence),
    builds: builds.map((row) => ({ ...row, target_version: Number(row.target_version), attempt: Number(row.attempt) })),
    voice_genome_readiness: readiness(evidence, replicas[0]),
  };
}

export async function decideOwnedEvidence(db, ownerUserId, value) {
  const rid = replicaId(value.replica_id);
  const evidenceId = replicaId(value.evidence_id);
  const decision = String(value.decision || "");
  const reason = String(value.reason_code || "");
  if (!DECISIONS.has(decision) || !REVIEW_REASONS[decision].includes(reason)) throw Object.assign(new Error("valid decision and reason_code required"), { status: 400 });
  const rows = await db(`with owned as (select e.evidence_id,e.replica_id,e.owner_user_id from vy_replica_processing_evidence e join vy_replica r on r.replica_id=e.replica_id and r.owner_user_id=$2 join vy_replica_source s on s.source_id=e.source_id and s.replica_id=$1 and s.owner_user_id=$2 where e.evidence_id=$3 and e.replica_id=$1 and e.owner_user_id=$2 and e.evidence_type=any($6::text[])), inserted as (insert into vy_replica_processing_evidence_decision(evidence_id,replica_id,owner_user_id,decision,reason_code,reviewer_user_id) select evidence_id,replica_id,owner_user_id,$4,$5,$2 from owned returning decision_id,evidence_id,decision,reason_code,created_at) select * from inserted`, [rid, ownerUserId, evidenceId, decision, reason, [...VOICE_REVIEW_TYPES]]);
  return rows[0] || null;
}

export async function queueOwnedVoiceGenome(db, ownerUserId, value) {
  const rid = replicaId(value);
  const replicas = await db(OWNED, [rid, ownerUserId]);
  if (!replicas[0]) return null;
  const evidence = await db(EVIDENCE_SQL, [rid, ownerUserId]);
  const state = readiness(evidence, replicas[0]);
  if (!state.ready) throw Object.assign(new Error("voice_genome_not_ready"), { status: 409, details: state });
  const accepted = evidence.filter((row) => row.decision === "accepted" && VOICE_REVIEW_TYPES.has(row.evidence_type) && isRealEvidence(row));
  const sourceSetHash = createHash("sha256").update(JSON.stringify(accepted.map((row) => [
    row.evidence_id,
    row.source_id,
    row.artifact_id || null,
    row.evidence_type,
    row.input_sha256,
    row.record_hash,
  ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))))).digest("hex");
  const rows = await db(`with owned as (${OWNED}), locked as materialized (select o.replica_id,pg_advisory_xact_lock(hashtextextended(o.replica_id::text || ':voice_genome',0)) from owned o), candidate as (select l.replica_id,coalesce((select target_version from vy_replica_model_build where replica_id=$1 and build_kind='voice_genome' and source_set_hash=$3 order by target_version desc limit 1),(select coalesce(max(target_version)+1,1) from vy_replica_model_build where replica_id=$1 and build_kind='voice_genome')) target_version from locked l), inserted as (insert into vy_replica_model_build(replica_id,owner_user_id,build_kind,target_version,builder_version,source_set_hash,state) select c.replica_id,$2,'voice_genome',c.target_version,'voice-genome-builder/v1',$3,'queued' from candidate c on conflict (replica_id,build_kind,source_set_hash) do update set source_set_hash=excluded.source_set_hash returning build_id,build_kind,target_version,builder_version,state,attempt,failure_code,created_at,updated_at) select * from inserted`, [rid, ownerUserId, sourceSetHash]);
  return rows[0] ? { ...rows[0], target_version: Number(rows[0].target_version), attempt: Number(rows[0].attempt) } : null;
}
