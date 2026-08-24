import { PROCESSING_SCHEMA_VERSION, assertNoProviderVoiceReference, assertSha256, canonicalJson, sha256Hex } from "./contracts.js";

export const VOICE_GENOME_SCHEMA_VERSION = "voice-genome/v1";
export const PERSON_PROFILE_SCHEMA_VERSION = "person-profile/v1";

const TRANSITIONS = Object.freeze({
  queued: Object.freeze({ lease: "leased", fail: "failed" }),
  leased: Object.freeze({ start: "building", retry: "retry", fail: "failed" }),
  building: Object.freeze({ submit_review: "review", retry: "retry", fail: "failed" }),
  retry: Object.freeze({ lease: "leased", fail: "failed" }),
  review: Object.freeze({ revise: "building", approve: "approved", fail: "failed" }),
  approved: Object.freeze({ retire: "retired" }),
  failed: Object.freeze({}),
  retired: Object.freeze({}),
});

function accepted(rows) {
  return (rows || []).filter((row) => row.decision === "accepted" || row.status === "approved");
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function hashRef(row) {
  const hash = row.record_hash || row.manifest_hash || row.sha256 || sha256Hex({
    claim_id: row.claim_id,
    domain: row.domain,
    key: row.key,
    body: row.body,
    origin: row.origin,
    confidence: row.confidence,
    source_ids: uniqueSorted(row.source_ids || []),
  });
  return {
    source_ids: uniqueSorted(row.source_ids || (row.source_id ? [row.source_id] : [])),
    artifact_id: row.artifact_id || null,
    evidence_id: row.evidence_id || null,
    hash: assertSha256(hash, "accepted evidence hash"),
  };
}

export function acceptedSourceSetHash({ artifacts = [], evidence = [], claims = [] }) {
  const references = [...accepted(artifacts), ...accepted(evidence), ...accepted(claims)].map(hashRef);
  if (!references.length) throw new Error("an accepted evidence set is required");
  references.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  return sha256Hex({ schema_version: PROCESSING_SCHEMA_VERSION, references });
}

export function transitionModelBuild(build, event, facts = {}) {
  if (!build || !["voice_genome", "person_profile"].includes(build.build_kind)) throw new Error("valid model build required");
  const next = TRANSITIONS[build.state]?.[event];
  if (!next) throw new Error(`invalid model build transition ${build.state}:${event}`);
  if (event === "approve" && facts.readiness?.ready !== true) throw new Error("model build is not approval-ready");
  if (event === "submit_review") assertSha256(facts.manifest_hash, "build manifest hash");
  return Object.freeze({
    ...build,
    state: next,
    attempt: event === "lease" ? Number(build.attempt || 0) + 1 : Number(build.attempt || 0),
    manifest_hash: event === "submit_review" ? facts.manifest_hash : build.manifest_hash || "",
    failure_code: ["retry", "fail"].includes(event) ? String(facts.failure_code || "model_build_error") : "",
  });
}

export function buildVoiceGenomeDraft(input) {
  if (!Number.isInteger(input?.version) || input.version < 1) throw new Error("positive VoiceGenome version required");
  if (typeof input.builderVersion !== "string" || !input.builderVersion) throw new Error("builder version required");
  const evidence = accepted(input.evidence);
  const artifacts = accepted(input.artifacts);
  const embeddings = evidence.filter((row) => row.evidence_type === "voice_embedding");
  const measurements = evidence.filter((row) => row.evidence_type === "voice_measurement");
  const quality = evidence.filter((row) => row.evidence_type === "quality_measurement");
  const speakerSegments = evidence.filter((row) => row.evidence_type === "speaker_segment");
  if (new Set(embeddings.map((row) => row.value?.family)).size < 2) throw new Error("two independent embedding families required");
  if (!measurements.length || !quality.length || !speakerSegments.length) {
    throw new Error("voice measurements, quality evidence and speaker segments are required");
  }
  const sourceSetHash = acceptedSourceSetHash({ artifacts, evidence });
  const families = {};
  for (const row of embeddings.sort((a, b) => a.record_hash.localeCompare(b.record_hash))) {
    const family = String(row.value.family);
    (families[family] ||= []).push({
      evidence_id: row.evidence_id,
      vector: row.value.vector,
      confidence: row.confidence,
    });
  }
  const definition = {
    schema_version: VOICE_GENOME_SCHEMA_VERSION,
    version: input.version,
    builder_version: input.builderVersion,
    source_set_hash: sourceSetHash,
    status: "draft",
    references: {
      source_ids: uniqueSorted(evidence.map((row) => row.source_id)),
      artifact_ids: uniqueSorted(artifacts.map((row) => row.artifact_id)),
      enrollment_artifact_ids: uniqueSorted(artifacts.filter((row) =>
        row.stage === "enhance" && ["audio/wav", "audio/x-wav"].includes(String(row.mime || "").toLowerCase())
      ).map((row) => row.artifact_id)),
      evidence_ids: uniqueSorted(evidence.map((row) => row.evidence_id)),
      transform_lineage: artifacts.map((row) => ({
        artifact_id: row.artifact_id,
        parent_artifact_id: row.parent_artifact_id || null,
        input_sha256: row.input_sha256,
        sha256: row.sha256,
        transform: row.transform,
        adapter: row.adapter,
      })).sort((a, b) => a.artifact_id.localeCompare(b.artifact_id)),
    },
    speaker_identity: { embedding_families: families },
    acoustic_distributions: measurements.map((row) => ({
      evidence_id: row.evidence_id,
      confidence: row.confidence,
      measurements: row.value,
    })).sort((a, b) => a.evidence_id.localeCompare(b.evidence_id)),
    quality_envelope: quality.map((row) => ({
      evidence_id: row.evidence_id,
      confidence: row.confidence,
      measurements: row.value,
    })).sort((a, b) => a.evidence_id.localeCompare(b.evidence_id)),
    target_segments: speakerSegments.map((row) => ({
      evidence_id: row.evidence_id,
      start_ms: row.span.start_ms,
      end_ms: row.span.end_ms,
      speaker_key: row.value.speaker_key,
      target_likelihood: row.value.target_likelihood,
      confidence: row.confidence,
    })).sort((a, b) => a.evidence_id.localeCompare(b.evidence_id)),
    calibration: { status: "required", preference_layers: ["voice", "delivery", "language"] },
    exclusions: uniqueSorted(input.exclusions || []),
  };
  assertNoProviderVoiceReference(definition);
  return deepFreeze({
    source_set_hash: sourceSetHash,
    definition,
    manifest_hash: sha256Hex(definition),
    status: "draft",
  });
}

export function buildPersonProfileDraft(input) {
  if (!Number.isInteger(input?.version) || input.version < 1) throw new Error("positive profile version required");
  if (typeof input.builderVersion !== "string" || !input.builderVersion) throw new Error("builder version required");
  const claims = accepted(input.claims);
  if (!claims.length) throw new Error("approved cited claims required");
  for (const claim of claims) {
    if (!Array.isArray(claim.source_ids) || !claim.source_ids.length) throw new Error("profile claims must retain citations");
  }
  const sourceSetHash = acceptedSourceSetHash({ claims });
  const definition = {
    schema_version: PERSON_PROFILE_SCHEMA_VERSION,
    version: input.version,
    builder_version: input.builderVersion,
    source_set_hash: sourceSetHash,
    status: "draft",
    domains: Object.fromEntries(uniqueSorted(claims.map((claim) => claim.domain)).map((domain) => [
      domain,
      claims.filter((claim) => claim.domain === domain).map((claim) => ({
        claim_id: claim.claim_id,
        key: claim.key,
        body: claim.body,
        origin: claim.origin,
        confidence: claim.confidence,
        source_ids: uniqueSorted(claim.source_ids),
      })).sort((a, b) => String(a.claim_id).localeCompare(String(b.claim_id))),
    ])),
    calibration: { status: "required", preference_layers: ["behaviour", "memory", "relationship"] },
  };
  assertNoProviderVoiceReference(definition);
  return deepFreeze({ source_set_hash: sourceSetHash, definition, manifest_hash: sha256Hex(definition), status: "draft" });
}

export function voiceGenomeApprovalReadiness(input) {
  const issues = [];
  const definition = input?.draft?.definition;
  if (!definition || definition.schema_version !== VOICE_GENOME_SCHEMA_VERSION || input.draft.status !== "draft") {
    issues.push("valid_draft_required");
  }
  if (definition) {
    try { assertNoProviderVoiceReference(definition); } catch { issues.push("provider_bound_reference"); }
    if (Object.keys(definition.speaker_identity?.embedding_families || {}).length < 2) issues.push("embedding_family_coverage");
    if (!definition.acoustic_distributions?.length) issues.push("acoustic_distributions_missing");
    if (!definition.target_segments?.length) issues.push("target_segments_missing");
    if (!definition.references?.enrollment_artifact_ids?.length) issues.push("enrollment_artifacts_missing");
    if ((definition.references?.transform_lineage || []).some((entry) =>
      /fake/i.test(String(entry.adapter?.name || "")) || /(?:^|-)test$/.test(String(entry.adapter?.version || "")))) {
      issues.push("test_fixture_provenance");
    }
  }
  if (input?.integrityVerified !== true) issues.push("integrity_not_verified");
  if (input?.thirdPartyCleared !== true) issues.push("third_party_review_required");
  if (input?.ownerCalibrationApproved !== true) issues.push("owner_calibration_required");
  if (input?.heldOutEval?.verdict !== "pass" || input?.heldOutEval?.realEvidence !== true) issues.push("real_held_out_eval_required");
  return Object.freeze({ ready: issues.length === 0, issues: Object.freeze(issues) });
}
