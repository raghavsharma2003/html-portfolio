// Canonical evidence adapter for a successfully settled Mirror Call window.
//
// Mirror windows deliberately do not enter the eight-step enrollment DAG, so
// they have no processing job or derived artifact. The evidence table permits
// both references to be null for exactly this kind of source-bound observation.
// We still use the processing contract's canonical JSON, hashes and stable UUID
// so a retry produces the same immutable rows rather than another transcript.
//
// This adapter never creates `speaker_segment`. A browser microphone and an ASR
// speaker label are not proof that the speaker is the owner. The existing claim
// extractor therefore remains closed until a real owner-speaker measurement is
// stored and explicitly accepted through the existing evidence-review lane.
import {
  PROCESSING_SCHEMA_VERSION,
  assertSha256,
  canonicalJson,
  sha256Hex,
  stableUuid,
} from "./_replica-processing/contracts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ADAPTER_PART = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function fail(code) {
  throw Object.assign(new Error(code), { code, status: 409 });
}

function uuid(value, code) {
  const clean = String(value || "");
  if (!UUID.test(clean)) fail(code);
  return clean;
}

function adapterPart(value, code) {
  const original = String(value || "").trim().toLowerCase();
  const clean = original.replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!SAFE_ADAPTER_PART.test(clean)) fail(code);
  return clean;
}

function language(value) {
  const clean = String(value || "").trim();
  return /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(clean) ? clean : "und";
}

function confidence(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) fail("mirror_evidence_confidence_invalid");
  return number;
}

function evidenceRecord(input, evidenceType, value, evidenceConfidence) {
  const basis = {
    schema_version: PROCESSING_SCHEMA_VERSION,
    replica_id: input.replicaId,
    owner_user_id: input.ownerUserId,
    source_id: input.sourceId,
    artifact_id: null,
    created_by_job_id: null,
    evidence_type: evidenceType,
    span: { start_ms: 0, end_ms: input.durationMs },
    confidence: evidenceConfidence,
    value,
    input_sha256: input.inputSha256,
    adapter: input.adapter,
  };
  const recordHash = sha256Hex(canonicalJson(basis));
  return Object.freeze({
    ...basis,
    evidence_id: stableUuid(`evidence:${recordHash}`),
    record_hash: recordHash,
  });
}

/**
 * Build the only two durable observations current live ASR actually measures:
 * words and a language label. The transcript passed here must already be the
 * PII-scrubbed value that will be written to `vy_mirror_window`.
 */
export function createMirrorCanonicalEvidence(input) {
  const replicaId = uuid(input?.replicaId, "mirror_evidence_replica_invalid");
  const ownerUserId = uuid(input?.ownerUserId, "mirror_evidence_owner_invalid");
  const sourceId = uuid(input?.sourceId, "mirror_evidence_source_invalid");
  const sessionId = uuid(input?.sessionId, "mirror_evidence_session_invalid");
  const windowId = uuid(input?.windowId, "mirror_evidence_window_invalid");
  const seq = Number(input?.seq);
  const durationMs = Number(input?.durationMs);
  if (!Number.isSafeInteger(seq) || seq < 1) fail("mirror_evidence_seq_invalid");
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 30_000) {
    fail("mirror_evidence_duration_invalid");
  }
  const text = String(input?.transcript || "").trim();
  if (!text) fail("mirror_evidence_transcript_required");
  const inputSha256 = assertSha256(input?.inputSha256, "mirror evidence input sha256");
  const adapter = Object.freeze({
    family: "live-asr",
    name: adapterPart(input?.provider, "mirror_evidence_provider_invalid"),
    version: adapterPart(input?.model, "mirror_evidence_model_invalid"),
  });
  const languageCode = language(input?.languageCode);
  const transcriptConfidence = confidence(input?.transcriptConfidence);
  const languageSource = new Set(["provider_detected", "requested_hint", "unavailable"])
    .has(String(input?.languageSource || ""))
    ? String(input.languageSource)
    : "unavailable";
  const languageProbability = languageSource === "provider_detected"
    ? confidence(input?.languageProbability)
    : null;
  const provenance = Object.freeze({
    origin: "mirror_call",
    capture_stage: "post_asr_settlement",
    session_id: sessionId,
    window_id: windowId,
    source_id: sourceId,
    seq,
    speaker_verification: String(input?.speakerVerification || "unverified"),
    asr_provider: String(input?.provider || ""),
    asr_model: String(input?.model || ""),
  });
  const common = {
    replicaId,
    ownerUserId,
    sourceId,
    durationMs,
    inputSha256,
    adapter,
  };
  return Object.freeze([
    evidenceRecord(common, "transcript_span", {
      text,
      language: languageCode,
      words: [],
      epistemic_status: "observed",
      calibration: { status: "uncalibrated", method: "provider_transcript", revision: adapter.version },
      provenance,
    }, transcriptConfidence),
    evidenceRecord(common, "language_span", {
      language: languageCode,
      language_source: languageSource,
      language_probability: languageProbability,
      code_switch: null,
      epistemic_status: "observed",
      calibration: languageProbability === null
        ? { status: "uncalibrated", method: "provider_language", revision: adapter.version }
        : { status: "provider_reported", method: "provider_language", revision: adapter.version },
      provenance,
    }, languageProbability),
  ]);
}
