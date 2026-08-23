import { createHash } from "node:crypto";

export const PROCESSING_SCHEMA_VERSION = "replica-processing/v1";
export const PROCESSING_STAGES = Object.freeze([
  "integrity",
  "malware_scan",
  "media_probe",
  "diarize",
  "separate",
  "enhance",
  "transcribe",
  "pii_scan",
  "third_party_scan",
  "extract",
  "voice_quality",
  "visual_quality",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_PART = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const ADAPTER_METHOD = Object.freeze({
  integrity: "verify",
  malware_scan: "scan",
  media_probe: "probe",
  diarize: "diarize",
  separate: "separate",
  enhance: "enhance",
  transcribe: "transcribe",
  voice_quality: "measure",
});

function fail(message, code = "invalid_processing_contract") {
  throw new ProcessingContractError(message, { code });
}

function scalar(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  fail("canonical JSON accepts only finite JSON values", "invalid_canonical_json");
}

function normalizeJson(value, seen) {
  if (Array.isArray(value)) {
    if (seen.has(value)) fail("canonical JSON cannot contain cycles", "invalid_canonical_json");
    seen.add(value);
    const normalized = value.map((entry) => normalizeJson(entry, seen));
    seen.delete(value);
    return normalized;
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) fail("canonical JSON cannot contain cycles", "invalid_canonical_json");
    seen.add(value);
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) fail("canonical JSON cannot contain undefined", "invalid_canonical_json");
      normalized[key] = normalizeJson(value[key], seen);
    }
    seen.delete(value);
    return normalized;
  }
  return scalar(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export class ProcessingContractError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ProcessingContractError";
    this.code = options.code || "invalid_processing_contract";
    this.retryable = false;
  }
}

export class ProcessingAdapterError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ProcessingAdapterError";
    this.code = options.code || "processing_adapter_error";
    this.retryable = Boolean(options.retryable);
  }
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeJson(value, new Set()));
}

export function sha256Hex(value) {
  const bytes = typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value);
  return createHash("sha256").update(bytes).digest("hex");
}

export function stableUuid(value) {
  const hex = sha256Hex(value).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  const packed = hex.join("");
  return `${packed.slice(0, 8)}-${packed.slice(8, 12)}-${packed.slice(12, 16)}-${packed.slice(16, 20)}-${packed.slice(20)}`;
}

export function assertSha256(value, label = "sha256") {
  const clean = String(value || "").trim().toLowerCase();
  if (!SHA256.test(clean)) fail(`${label} must be a lowercase SHA-256`, "invalid_sha256");
  return clean;
}

export function assertProcessingSource(source) {
  if (!source || typeof source !== "object") fail("source required");
  for (const key of ["source_id", "replica_id", "owner_user_id"]) {
    if (!UUID.test(String(source[key] || ""))) fail(`valid source ${key} required`);
  }
  if (!["quarantined", "processing"].includes(source.state)) {
    fail("only quarantined or processing sources may be processed", "source_not_processable");
  }
  assertSha256(source.sha256, "source sha256");
  if (typeof source.object_path !== "string" || !source.object_path.endsWith("/original") || source.object_path.includes("://")) {
    fail("source must reference the private immutable original", "invalid_raw_object_path");
  }
  if (!source.storage_bucket || typeof source.storage_bucket !== "string") fail("private source bucket required");
  return source;
}

export function assertAdapter(adapter, stage) {
  const method = ADAPTER_METHOD[stage];
  if (!method) fail(`no adapter contract for ${stage}`, "unsupported_processing_stage");
  if (!adapter || typeof adapter !== "object") fail(`${stage} adapter required`, "missing_processing_adapter");
  for (const key of ["family", "name", "version"]) {
    if (!SAFE_PART.test(String(adapter[key] || ""))) fail(`${stage} adapter ${key} required`, "invalid_processing_adapter");
  }
  if (typeof adapter[method] !== "function") fail(`${stage} adapter missing ${method}`, "invalid_processing_adapter");
  return adapter;
}

export function adapterFacts(adapter) {
  return Object.freeze({ family: adapter.family, name: adapter.name, version: adapter.version });
}

export function derivedArtifactPath({ ownerUserId, replicaId, sourceId, transformVersion, stage, artifactId }) {
  for (const value of [ownerUserId, replicaId, sourceId, artifactId]) {
    if (!UUID.test(String(value || ""))) fail("derived paths require server UUIDs", "invalid_derived_object_path");
  }
  if (!SAFE_PART.test(String(transformVersion || "")) || !SAFE_PART.test(String(stage || ""))) {
    fail("derived path contains an unsafe transform component", "invalid_derived_object_path");
  }
  return `${ownerUserId}/${replicaId}/${sourceId}/derived/${transformVersion}/${stage}-${artifactId}`;
}

export function assertJob(job) {
  if (!job || !UUID.test(String(job.job_id || ""))) fail("valid processing job required");
  if (!PROCESSING_STAGES.includes(job.step)) fail("unknown processing job step", "unsupported_processing_stage");
  if (job.state !== "leased") fail("worker only accepts leased jobs", "job_not_leased");
  if (!Number.isInteger(Number(job.attempt)) || Number(job.attempt) < 1) fail("leased job attempt required");
  return job;
}

function boundedConfidence(value, label = "confidence") {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) fail(`${label} must be between 0 and 1`);
  return number;
}

function span(value) {
  if (value === null || value === undefined) return { start_ms: null, end_ms: null };
  const start = Number(value.start_ms);
  const end = Number(value.end_ms);
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(end) || end <= start) {
    fail("evidence span must be an increasing millisecond range", "invalid_evidence_span");
  }
  return { start_ms: start, end_ms: end };
}

export function createEvidenceRecord(input) {
  const evidenceTypes = new Set([
    "media_probe", "speaker_segment", "transcript_span", "language_span",
    "voice_embedding", "voice_measurement", "quality_measurement",
  ]);
  if (!evidenceTypes.has(input?.evidence_type)) fail("unsupported evidence type", "invalid_evidence_type");
  for (const key of ["replica_id", "owner_user_id", "source_id", "created_by_job_id"]) {
    if (!UUID.test(String(input?.[key] || ""))) fail(`valid evidence ${key} required`);
  }
  if (input.artifact_id != null && !UUID.test(String(input.artifact_id))) fail("valid evidence artifact_id required");
  const facts = adapterFacts(assertAdapter(input.adapter, input.adapter_stage));
  const basis = {
    schema_version: PROCESSING_SCHEMA_VERSION,
    replica_id: input.replica_id,
    owner_user_id: input.owner_user_id,
    source_id: input.source_id,
    artifact_id: input.artifact_id || null,
    created_by_job_id: input.created_by_job_id,
    evidence_type: input.evidence_type,
    span: span(input.span),
    confidence: boundedConfidence(input.confidence),
    value: normalizeJson(input.value, new Set()),
    input_sha256: assertSha256(input.input_sha256, "evidence input sha256"),
    adapter: facts,
  };
  const recordHash = sha256Hex(basis);
  return deepFreeze({
    ...basis,
    evidence_id: stableUuid(`evidence:${recordHash}`),
    record_hash: recordHash,
  });
}

export function createArtifactManifest(input) {
  for (const key of ["artifact_id", "replica_id", "owner_user_id", "source_id", "created_by_job_id"]) {
    if (!UUID.test(String(input?.[key] || ""))) fail(`valid artifact ${key} required`);
  }
  if (!new Set(["separate", "enhance", "transcribe", "voice_quality"]).has(input.stage)) {
    fail("unsupported artifact stage", "invalid_artifact_stage");
  }
  const expectedPrefix = `${input.owner_user_id}/${input.replica_id}/${input.source_id}/derived/`;
  if (typeof input.object_path !== "string" || !input.object_path.startsWith(expectedPrefix) || input.object_path.includes("://")) {
    fail("artifact must use the source's private derived path", "invalid_derived_object_path");
  }
  if (!Number.isSafeInteger(Number(input.byte_size)) || Number(input.byte_size) < 1) fail("artifact byte_size required");
  if (typeof input.mime !== "string" || !input.mime.includes("/")) fail("artifact MIME required");
  if (!SAFE_PART.test(String(input.variant_key || ""))) fail("safe artifact variant_key required");
  if (!SAFE_PART.test(String(input.transform_name || "")) || !SAFE_PART.test(String(input.transform_version || ""))) {
    fail("safe transform identity required");
  }
  const facts = adapterFacts(assertAdapter(input.adapter, input.adapter_stage));
  const basis = {
    schema_version: PROCESSING_SCHEMA_VERSION,
    artifact_id: input.artifact_id,
    replica_id: input.replica_id,
    owner_user_id: input.owner_user_id,
    source_id: input.source_id,
    parent_artifact_id: input.parent_artifact_id || null,
    created_by_job_id: input.created_by_job_id,
    stage: input.stage,
    variant_key: input.variant_key,
    storage_bucket: String(input.storage_bucket || ""),
    object_path: input.object_path,
    mime: input.mime,
    byte_size: Number(input.byte_size),
    duration_ms: input.duration_ms == null ? null : Number(input.duration_ms),
    sha256: assertSha256(input.sha256, "artifact sha256"),
    input_sha256: assertSha256(input.input_sha256, "artifact input sha256"),
    transform: {
      name: input.transform_name,
      version: input.transform_version,
      parameter_hash: assertSha256(input.parameter_hash, "transform parameter hash"),
    },
    adapter: facts,
    quality: normalizeJson(input.quality || {}, new Set()),
  };
  if (basis.duration_ms != null && (!Number.isInteger(basis.duration_ms) || basis.duration_ms < 0)) {
    fail("artifact duration_ms must be a non-negative integer");
  }
  const manifestHash = sha256Hex(basis);
  return deepFreeze({ ...basis, manifest_hash: manifestHash });
}

export function assertNoProviderVoiceReference(value) {
  const forbidden = /^(provider(_ref|_id)?|external_voice_id|voice_id|signed(_read)?_url)$/i;
  const visit = (entry) => {
    if (Array.isArray(entry)) return entry.forEach(visit);
    if (!entry || typeof entry !== "object") return;
    for (const [key, child] of Object.entries(entry)) {
      if (forbidden.test(key)) fail(`provider-bound field ${key} is forbidden in a portable model`, "provider_bound_model");
      visit(child);
    }
  };
  visit(value);
  return value;
}
