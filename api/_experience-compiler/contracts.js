import { canonicalJson, sha256Hex } from "../_provenance/contracts.js";

export const EXPERIENCE_COMPILER_REVISION = "experience-compiler-contract-v1";
export const EXPRESSION_MAX_TTL_MS = 24 * 60 * 60 * 1_000;

export const SOURCE_MODALITIES = Object.freeze([
  "audio",
  "call_audio",
  "conversation_turn",
  "document",
  "image",
  "link",
  "text",
  "video",
]);

export const OBSERVATION_KINDS = Object.freeze([
  "acoustic_measurement",
  "expression",
  "fact_signal",
  "persona_signal",
  "relation_signal",
  "speaker_attribution",
  "transcript",
  "voice_window",
]);

export const CANDIDATE_KINDS = Object.freeze(["fact", "persona", "relation", "voice"]);

const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;
const SAFE_KEY = /^[a-z][a-z0-9_]{1,63}$/;
const MODALITIES = new Set(SOURCE_MODALITIES);
const OBSERVATIONS = new Set(OBSERVATION_KINDS);
const CANDIDATES = new Set(CANDIDATE_KINDS);
const EPISTEMIC_STATUS = new Set(["observed", "inferred"]);
const SPAN_UNIT_BY_MODALITY = Object.freeze({
  audio: "audio_ms",
  call_audio: "audio_ms",
  conversation_turn: "utf8_bytes",
  document: "pages",
  image: "pixels",
  link: "utf8_bytes",
  text: "utf8_bytes",
  video: "video_ms",
});
const SOURCE_PURPOSES = new Set([
  "experience_observation",
  "persona_candidate",
  "relation_candidate",
  "voice_reference_selection",
]);

function fail(code, details = null) {
  const error = Object.assign(new Error(code), { code });
  if (details !== null) error.details = details;
  throw error;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plainClone(value, code = "invalid_structured_value") {
  try {
    return JSON.parse(canonicalJson(value));
  } catch {
    fail(code);
  }
}

function id(value, code) {
  const result = String(value || "");
  if (!SAFE_ID.test(result)) fail(code);
  return result;
}

function key(value, code) {
  const result = String(value || "");
  if (!SAFE_KEY.test(result)) fail(code);
  return result;
}

function hash(value, code) {
  const result = String(value || "");
  if (!SHA256.test(result)) fail(code);
  return result;
}

function iso(value, code) {
  const millis = Date.parse(String(value || ""));
  if (!Number.isFinite(millis)) fail(code);
  return new Date(millis).toISOString();
}

function optionalIso(value, code) {
  return value === null || value === undefined || value === "" ? null : iso(value, code);
}

function scope(input, codePrefix = "scope") {
  return {
    owner_id: id(input?.owner_id, `${codePrefix}_owner_required`),
    dyad_id: input?.dyad_id == null ? null : id(input.dyad_id, `${codePrefix}_dyad_invalid`),
  };
}

function finalize(basis, idField, prefix) {
  const recordHash = sha256Hex(canonicalJson(basis));
  return deepFreeze({
    ...basis,
    [idField]: `${prefix}_${recordHash}`,
    record_hash: recordHash,
  });
}

function verifyFinal(record, schema, idField, prefix, codePrefix) {
  if (!record || record.schema !== schema) fail(`${codePrefix}_schema_invalid`);
  const basis = plainClone(record, `${codePrefix}_shape_invalid`);
  delete basis[idField];
  delete basis.record_hash;
  const expected = sha256Hex(canonicalJson(basis));
  if (record.record_hash !== expected || record[idField] !== `${prefix}_${expected}`) fail(`${codePrefix}_commitment_mismatch`);
  return record;
}

function normalizeConsent(input, capturedAt) {
  const purposes = [...new Set((Array.isArray(input?.purposes) ? input.purposes : []).map(String))].sort();
  if (!purposes.length || purposes.some((purpose) => !SOURCE_PURPOSES.has(purpose))) fail("source_consent_purpose_invalid");
  const grantedAt = iso(input?.granted_at, "source_consent_time_invalid");
  const expiresAt = optionalIso(input?.expires_at, "source_consent_expiry_invalid");
  const revokedAt = optionalIso(input?.revoked_at, "source_consent_revocation_invalid");
  if (Date.parse(grantedAt) > Date.parse(capturedAt)) fail("source_consent_after_capture");
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(capturedAt)) fail("source_consent_expired_at_capture");
  if (revokedAt && Date.parse(revokedAt) <= Date.parse(capturedAt)) fail("source_consent_revoked_at_capture");
  const subject = String(input?.subject || "");
  if (!new Set(["owner", "participant", "uploader_only"]).has(subject)) fail("source_consent_subject_invalid");
  return {
    receipt_id: id(input?.receipt_id, "source_consent_receipt_required"),
    subject,
    purposes,
    granted_at: grantedAt,
    expires_at: expiresAt,
    revoked_at: revokedAt,
  };
}

export function createSource(input) {
  const sourceScope = scope(input?.scope, "source_scope");
  const modality = String(input?.modality || "");
  if (!MODALITIES.has(modality)) fail("source_modality_invalid");
  const capturedAt = iso(input?.captured_at, "source_capture_time_invalid");
  const byteLength = Number(input?.byte_length);
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) fail("source_byte_length_invalid");
  const speakerScope = String(input?.speaker_scope || "");
  if (!new Set(["owner", "other", "mixed", "unknown", "not_applicable"]).has(speakerScope)) fail("source_speaker_scope_invalid");
  const consent = normalizeConsent(input?.consent, capturedAt);
  if (!consent.purposes.includes("experience_observation")) fail("source_observation_consent_required");
  return finalize({
    schema: "vyakti.experience-source.v1",
    compiler_revision: EXPERIENCE_COMPILER_REVISION,
    scope: sourceScope,
    modality,
    content_sha256: hash(input?.content_sha256, "source_content_hash_invalid"),
    byte_length: byteLength,
    captured_at: capturedAt,
    speaker_scope: speakerScope,
    consent,
  }, "source_id", "src");
}

export function verifySource(source) {
  const verified = verifyFinal(source, "vyakti.experience-source.v1", "source_id", "src", "source");
  const rebuilt = createSource({
    scope: verified.scope,
    modality: verified.modality,
    content_sha256: verified.content_sha256,
    byte_length: verified.byte_length,
    captured_at: verified.captured_at,
    speaker_scope: verified.speaker_scope,
    consent: verified.consent,
  });
  if (rebuilt.record_hash !== verified.record_hash) fail("source_shape_invalid");
  return verified;
}

function normalizeSpan(source, input) {
  const unit = String(input?.unit || "");
  if (unit !== SPAN_UNIT_BY_MODALITY[source.modality]) fail("observation_span_unit_mismatch");
  const start = Number(input?.start);
  const end = Number(input?.end);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) fail("observation_span_invalid");
  const value = {
    unit,
    start,
    end,
    content_sha256: hash(input?.content_sha256, "observation_span_content_hash_invalid"),
  };
  return {
    ...value,
    span_hash: sha256Hex(canonicalJson({ source_id: source.source_id, source_hash: source.record_hash, ...value })),
  };
}

function normalizeCalibration(input) {
  const status = String(input?.status || "");
  if (!new Set(["calibrated", "uncalibrated"]).has(status)) fail("observation_calibration_status_invalid");
  const method = id(input?.method, "observation_calibration_method_required");
  const revision = id(input?.revision, "observation_calibration_revision_required");
  const sampleSize = Number(input?.sample_size);
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 0) fail("observation_calibration_sample_invalid");
  if (status === "calibrated") {
    if (sampleSize < 1) fail("observation_calibration_sample_required");
    return {
      status,
      method,
      revision,
      sample_size: sampleSize,
      dataset_hash: hash(input?.dataset_hash, "observation_calibration_dataset_hash_invalid"),
      measured_at: iso(input?.measured_at, "observation_calibration_time_invalid"),
    };
  }
  if (sampleSize !== 0 || input?.dataset_hash != null || input?.measured_at != null) fail("uncalibrated_observation_cannot_claim_measurement");
  return { status, method, revision, sample_size: 0, dataset_hash: null, measured_at: null };
}

function normalizeProducer(input) {
  return {
    kind: (() => {
      const value = String(input?.kind || "");
      if (!new Set(["direct_measurement", "model", "rules", "human_annotation"]).has(value)) fail("observation_producer_kind_invalid");
      return value;
    })(),
    name: id(input?.name, "observation_producer_name_required"),
    revision: id(input?.revision, "observation_producer_revision_required"),
    code_hash: hash(input?.code_hash, "observation_producer_hash_invalid"),
  };
}

function normalizeExpression(input, observedAt, expiresAt, observationScope) {
  if (!observationScope.dyad_id || !input?.turn_id) fail("expression_turn_and_dyad_scope_required");
  const expiryMs = Date.parse(String(expiresAt || ""));
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(expiryMs) || expiryMs <= observedMs || expiryMs - observedMs > EXPRESSION_MAX_TTL_MS) fail("expression_expiry_invalid");
  if (input?.claim_target !== "delivery_cue" || input?.interpretation !== "observer_interpretation" || input?.may_claim_inner_emotion !== false) {
    fail("inner_emotion_claim_forbidden");
  }
  return {
    turn_id: id(input.turn_id, "expression_turn_invalid"),
    claim_target: "delivery_cue",
    interpretation: "observer_interpretation",
    may_claim_inner_emotion: false,
  };
}

export function createObservation(input) {
  const source = verifySource(input?.source);
  const observationScope = scope(input?.scope, "observation_scope");
  if (canonicalJson(observationScope) !== canonicalJson(source.scope)) fail("observation_source_scope_mismatch");
  const modality = String(input?.modality || "");
  if (modality !== source.modality) fail("observation_source_modality_mismatch");
  const kind = String(input?.kind || "");
  if (!OBSERVATIONS.has(kind)) fail("observation_kind_invalid");
  const epistemicStatus = String(input?.epistemic_status || "");
  if (!EPISTEMIC_STATUS.has(epistemicStatus)) fail("observation_epistemic_status_required");
  const confidence = Number(input?.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) fail("observation_confidence_invalid");
  const observedAt = iso(input?.observed_at, "observation_time_invalid");
  const expiresAt = optionalIso(input?.expires_at, "observation_expiry_invalid");
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(observedAt)) fail("observation_expiry_invalid");
  const span = normalizeSpan(source, input?.span);
  const expression = kind === "expression"
    ? normalizeExpression(input?.expression, observedAt, expiresAt, observationScope)
    : null;
  if (kind !== "expression" && input?.expression != null) fail("expression_metadata_on_non_expression");
  return finalize({
    schema: "vyakti.experience-observation.v1",
    compiler_revision: EXPERIENCE_COMPILER_REVISION,
    source: {
      source_id: source.source_id,
      source_hash: source.record_hash,
      content_sha256: source.content_sha256,
      scope: source.scope,
      consent_receipt_id: source.consent.receipt_id,
      consent_subject: source.consent.subject,
      consent_purposes: source.consent.purposes,
      speaker_scope: source.speaker_scope,
    },
    span,
    modality,
    scope: observationScope,
    kind,
    epistemic_status: epistemicStatus,
    value: plainClone(input?.value, "observation_value_invalid"),
    confidence,
    calibration: normalizeCalibration(input?.calibration),
    producer: normalizeProducer(input?.producer),
    observed_at: observedAt,
    expires_at: expiresAt,
    expression,
  }, "observation_id", "obs");
}

export function verifyObservation(observation) {
  const verified = verifyFinal(observation, "vyakti.experience-observation.v1", "observation_id", "obs", "observation");
  if (!MODALITIES.has(verified.modality) || !OBSERVATIONS.has(verified.kind)) fail("observation_shape_invalid");
  if (verified.span?.unit !== SPAN_UNIT_BY_MODALITY[verified.modality]) fail("observation_span_unit_mismatch");
  if (!Number.isSafeInteger(verified.span?.start) || !Number.isSafeInteger(verified.span?.end) || verified.span.start < 0 || verified.span.end <= verified.span.start) fail("observation_span_invalid");
  hash(verified.span?.content_sha256, "observation_span_content_hash_invalid");
  id(verified.source?.source_id, "observation_source_id_invalid");
  hash(verified.source?.source_hash, "observation_source_hash_invalid");
  hash(verified.source?.content_sha256, "observation_source_content_hash_invalid");
  id(verified.source?.consent_receipt_id, "observation_source_consent_receipt_invalid");
  const verifiedScope = scope(verified.scope, "observation_scope");
  const sourceScope = scope(verified.source?.scope, "observation_source_scope");
  if (canonicalJson(verifiedScope) !== canonicalJson(sourceScope)) fail("observation_source_scope_mismatch");
  if (!Array.isArray(verified.source?.consent_purposes) || !verified.source.consent_purposes.includes("experience_observation") || verified.source.consent_purposes.some((purpose) => !SOURCE_PURPOSES.has(purpose))) fail("observation_source_consent_invalid");
  if (!new Set(["owner", "participant", "uploader_only"]).has(verified.source?.consent_subject)) fail("observation_source_consent_invalid");
  if (!new Set(["owner", "other", "mixed", "unknown", "not_applicable"]).has(verified.source?.speaker_scope)) fail("observation_source_speaker_scope_invalid");
  const expectedSpanHash = sha256Hex(canonicalJson({
    source_id: verified.source.source_id,
    source_hash: verified.source.source_hash,
    unit: verified.span.unit,
    start: verified.span.start,
    end: verified.span.end,
    content_sha256: verified.span.content_sha256,
  }));
  if (verified.span.span_hash !== expectedSpanHash) fail("observation_span_commitment_mismatch");
  if (!EPISTEMIC_STATUS.has(verified.epistemic_status)) fail("observation_epistemic_status_required");
  if (!Number.isFinite(verified.confidence) || verified.confidence < 0 || verified.confidence > 1) fail("observation_confidence_invalid");
  const observedAt = iso(verified.observed_at, "observation_time_invalid");
  const expiresAt = optionalIso(verified.expires_at, "observation_expiry_invalid");
  if (observedAt !== verified.observed_at || expiresAt !== verified.expires_at || (expiresAt && Date.parse(expiresAt) <= Date.parse(observedAt))) fail("observation_expiry_invalid");
  if (canonicalJson(normalizeCalibration(verified.calibration)) !== canonicalJson(verified.calibration)) fail("observation_calibration_shape_invalid");
  if (canonicalJson(normalizeProducer(verified.producer)) !== canonicalJson(verified.producer)) fail("observation_producer_shape_invalid");
  if (verified.kind === "expression") normalizeExpression(verified.expression, observedAt, expiresAt, verifiedScope);
  else if (verified.expression !== null) fail("expression_metadata_on_non_expression");
  return verified;
}

function evidenceRows(observations) {
  if (!Array.isArray(observations) || observations.length < 1 || observations.length > 64) fail("candidate_evidence_required");
  const rows = observations.map((item) => {
    const observation = verifyObservation(item);
    return {
      observation_id: observation.observation_id,
      observation_hash: observation.record_hash,
      source_id: observation.source.source_id,
      source_hash: observation.source.source_hash,
      span_hash: observation.span.span_hash,
      modality: observation.modality,
      kind: observation.kind,
      epistemic_status: observation.epistemic_status,
      scope: observation.scope,
      consent_receipt_id: observation.source.consent_receipt_id,
      consent_subject: observation.source.consent_subject,
      consent_purposes: observation.source.consent_purposes,
      speaker_scope: observation.source.speaker_scope,
    };
  }).sort((left, right) => left.observation_id.localeCompare(right.observation_id));
  if (new Set(rows.map((row) => row.observation_id)).size !== rows.length) fail("candidate_duplicate_evidence");
  return rows;
}

function assertNoInnerEmotionShape(value) {
  if (!value || typeof value !== "object") return;
  for (const [name, child] of Object.entries(value)) {
    if (/^(?:inner_emotion|internal_emotion|mental_state|emotion_diagnosis)$/i.test(name)) fail("inner_emotion_claim_forbidden");
    assertNoInnerEmotionShape(child);
  }
}

function normalizeProposal(kind, input, evidence) {
  const proposal = plainClone(input, "candidate_proposal_invalid");
  assertNoInnerEmotionShape(proposal);
  if (kind === "fact") {
    if (proposal.operation !== "upsert_fact" || !SAFE_KEY.test(String(proposal.key || "")) || !Object.hasOwn(proposal, "value")) fail("fact_candidate_proposal_invalid");
    const validFrom = optionalIso(proposal.valid_from, "fact_candidate_valid_time_invalid");
    const validTo = optionalIso(proposal.valid_to, "fact_candidate_valid_time_invalid");
    if (validFrom && validTo && Date.parse(validTo) <= Date.parse(validFrom)) fail("fact_candidate_valid_time_invalid");
    proposal.valid_from = validFrom;
    proposal.valid_to = validTo;
  } else if (kind === "relation") {
    if (proposal.operation !== "append_relation_event" || !SAFE_KEY.test(String(proposal.key || ""))) fail("relation_candidate_proposal_invalid");
  } else if (kind === "persona") {
    if (proposal.operation !== "set_persona_field" || !SAFE_KEY.test(String(proposal.field || ""))) fail("persona_candidate_proposal_invalid");
  } else {
    if (proposal.operation !== "select_voice_window") fail("voice_candidate_proposal_invalid");
    const selected = evidence.find((row) => row.observation_id === proposal.observation_id);
    if (!selected || selected.kind !== "voice_window" || !new Set(["audio", "call_audio", "video"]).has(selected.modality)) fail("voice_candidate_window_evidence_required");
    const duration = Number(proposal.duration_ms);
    if (!Number.isSafeInteger(duration) || duration < 1_000 || duration > 30_000) fail("voice_candidate_window_duration_invalid");
    if (selected.speaker_scope !== "owner" || selected.consent_subject !== "owner") fail("voice_candidate_owner_speaker_required");
    if (!selected.consent_purposes.includes("voice_reference_selection")) fail("voice_candidate_consent_scope_required");
    if (proposal.consent_receipt_id !== selected.consent_receipt_id) fail("voice_candidate_consent_receipt_mismatch");
    if (proposal.speaker_verification?.verdict !== "verified_owner") fail("voice_candidate_speaker_verification_required");
    id(proposal.speaker_verification?.receipt_id, "voice_candidate_speaker_receipt_required");
    id(proposal.speaker_verification?.verifier_revision, "voice_candidate_speaker_verifier_required");
    iso(proposal.speaker_verification?.checked_at, "voice_candidate_speaker_check_time_invalid");
  }
  return proposal;
}

function normalizeSupersession(previous, kind, candidateScope, createdAt) {
  if (previous == null) return null;
  const verified = verifyCandidate(previous);
  if (verified.kind !== kind || canonicalJson(verified.scope) !== canonicalJson(candidateScope)) fail("candidate_supersession_scope_mismatch");
  if (Date.parse(verified.created_at) >= Date.parse(createdAt)) fail("candidate_supersession_time_invalid");
  return { candidate_id: verified.candidate_id, candidate_hash: verified.record_hash };
}

export function createCandidate(input) {
  const kind = String(input?.kind || "");
  if (!CANDIDATES.has(kind)) fail("candidate_kind_invalid");
  const candidateScope = scope(input?.scope, "candidate_scope");
  if (kind === "relation" && !candidateScope.dyad_id) fail("relation_candidate_dyad_required");
  if (kind === "voice" && candidateScope.dyad_id) fail("voice_candidate_must_be_owner_scoped");
  const evidence = evidenceRows(input?.observations);
  if (evidence.some((row) => row.scope.owner_id !== candidateScope.owner_id)) fail("candidate_cross_owner_evidence_forbidden");
  if (kind === "relation" && evidence.some((row) => row.scope.dyad_id !== candidateScope.dyad_id)) fail("relation_candidate_cross_dyad_evidence_forbidden");
  const createdAt = iso(input?.created_at, "candidate_time_invalid");
  const proposal = normalizeProposal(kind, input?.proposal, evidence);
  const supersedes = normalizeSupersession(input?.supersedes_candidate, kind, candidateScope, createdAt);
  const evidenceRootHash = sha256Hex(canonicalJson(evidence));
  const candidate = finalize({
    schema: "vyakti.experience-candidate.v1",
    compiler_revision: EXPERIENCE_COMPILER_REVISION,
    kind,
    state: "proposed",
    scope: candidateScope,
    proposal,
    evidence,
    evidence_root_hash: evidenceRootHash,
    supersedes,
    created_at: createdAt,
  }, "candidate_id", "cand");
  if (supersedes?.candidate_id === candidate.candidate_id) fail("candidate_cannot_supersede_itself");
  return candidate;
}

export function verifyCandidate(candidate) {
  const verified = verifyFinal(candidate, "vyakti.experience-candidate.v1", "candidate_id", "cand", "candidate");
  if (!CANDIDATES.has(verified.kind) || verified.state !== "proposed") fail("candidate_state_invalid");
  const verifiedScope = scope(verified.scope, "candidate_scope");
  if (verified.kind === "relation" && !verifiedScope.dyad_id) fail("relation_candidate_dyad_required");
  if (verified.kind === "voice" && verifiedScope.dyad_id) fail("voice_candidate_must_be_owner_scoped");
  if (!Array.isArray(verified.evidence) || verified.evidence.length < 1 || verified.evidence.length > 64) fail("candidate_evidence_required");
  const ids = new Set();
  let previousId = null;
  for (const row of verified.evidence) {
    id(row?.observation_id, "candidate_evidence_observation_id_invalid");
    hash(row?.observation_hash, "candidate_evidence_observation_hash_invalid");
    id(row?.source_id, "candidate_evidence_source_id_invalid");
    hash(row?.source_hash, "candidate_evidence_source_hash_invalid");
    hash(row?.span_hash, "candidate_evidence_span_hash_invalid");
    if (!MODALITIES.has(row?.modality) || !OBSERVATIONS.has(row?.kind) || !EPISTEMIC_STATUS.has(row?.epistemic_status)) fail("candidate_evidence_shape_invalid");
    const rowScope = scope(row?.scope, "candidate_evidence_scope");
    if (rowScope.owner_id !== verifiedScope.owner_id) fail("candidate_cross_owner_evidence_forbidden");
    if (verified.kind === "relation" && rowScope.dyad_id !== verifiedScope.dyad_id) fail("relation_candidate_cross_dyad_evidence_forbidden");
    id(row?.consent_receipt_id, "candidate_evidence_consent_receipt_invalid");
    if (!Array.isArray(row?.consent_purposes) || row.consent_purposes.some((purpose) => !SOURCE_PURPOSES.has(purpose))) fail("candidate_evidence_consent_shape_invalid");
    if (!new Set(["owner", "participant", "uploader_only"]).has(row?.consent_subject)) fail("candidate_evidence_consent_shape_invalid");
    if (!new Set(["owner", "other", "mixed", "unknown", "not_applicable"]).has(row?.speaker_scope)) fail("candidate_evidence_speaker_scope_invalid");
    if (ids.has(row.observation_id)) fail("candidate_duplicate_evidence");
    if (previousId !== null && previousId.localeCompare(row.observation_id) > 0) fail("candidate_evidence_order_invalid");
    ids.add(row.observation_id);
    previousId = row.observation_id;
  }
  if (canonicalJson(normalizeProposal(verified.kind, verified.proposal, verified.evidence)) !== canonicalJson(verified.proposal)) fail("candidate_proposal_shape_invalid");
  if (verified.supersedes !== null) {
    id(verified.supersedes?.candidate_id, "candidate_supersession_id_invalid");
    hash(verified.supersedes?.candidate_hash, "candidate_supersession_hash_invalid");
    if (verified.supersedes.candidate_id === verified.candidate_id) fail("candidate_cannot_supersede_itself");
  }
  if (iso(verified.created_at, "candidate_time_invalid") !== verified.created_at) fail("candidate_time_invalid");
  if (sha256Hex(canonicalJson(verified.evidence)) !== verified.evidence_root_hash) fail("candidate_evidence_commitment_mismatch");
  return verified;
}

export function reviewCandidate(candidateInput, input) {
  const candidate = verifyCandidate(candidateInput);
  if (!Array.isArray(input?.prior_decisions)) fail("candidate_decision_history_required");
  for (const prior of input.prior_decisions) {
    const verified = verifyDecision(prior);
    if (verified.candidate_id === candidate.candidate_id && new Set(["accepted", "rejected", "edited"]).has(verified.action)) fail("candidate_already_decided");
  }
  const actorOwnerId = id(input?.actor_owner_id, "candidate_review_actor_required");
  if (actorOwnerId !== candidate.scope.owner_id) fail("candidate_review_owner_mismatch");
  if (input?.expected_candidate_hash !== candidate.record_hash) fail("candidate_review_stale_hash");
  const action = String(input?.action || "");
  if (!new Set(["accepted", "deferred", "edited", "rejected"]).has(action)) fail("candidate_review_action_invalid");
  let replacement = null;
  if (action === "edited") {
    if (input?.replacement_candidate == null) fail("candidate_edit_replacement_required");
    const value = verifyCandidate(input?.replacement_candidate);
    if (value.kind !== candidate.kind || canonicalJson(value.scope) !== canonicalJson(candidate.scope) ||
        value.supersedes?.candidate_id !== candidate.candidate_id || value.supersedes?.candidate_hash !== candidate.record_hash) {
      fail("candidate_edit_replacement_binding_mismatch");
    }
    replacement = { candidate_id: value.candidate_id, candidate_hash: value.record_hash };
  } else if (input?.replacement_candidate != null) {
    fail("unexpected_candidate_edit_replacement");
  }
  return finalize({
    schema: "vyakti.experience-candidate-decision.v1",
    compiler_revision: EXPERIENCE_COMPILER_REVISION,
    candidate_id: candidate.candidate_id,
    candidate_hash: candidate.record_hash,
    owner_id: candidate.scope.owner_id,
    action,
    replacement,
    actor_owner_id: actorOwnerId,
    rationale_code: key(input?.rationale_code, "candidate_review_rationale_required"),
    decided_at: iso(input?.decided_at, "candidate_review_time_invalid"),
  }, "decision_id", "dec");
}

export function verifyDecision(decision) {
  const verified = verifyFinal(decision, "vyakti.experience-candidate-decision.v1", "decision_id", "dec", "candidate_decision");
  id(verified.candidate_id, "candidate_decision_candidate_id_invalid");
  hash(verified.candidate_hash, "candidate_decision_candidate_hash_invalid");
  const ownerId = id(verified.owner_id, "candidate_decision_owner_invalid");
  if (id(verified.actor_owner_id, "candidate_decision_actor_invalid") !== ownerId) fail("candidate_decision_owner_mismatch");
  if (!new Set(["accepted", "deferred", "edited", "rejected"]).has(verified.action)) fail("candidate_review_action_invalid");
  if (verified.action === "edited") {
    id(verified.replacement?.candidate_id, "candidate_edit_replacement_id_invalid");
    hash(verified.replacement?.candidate_hash, "candidate_edit_replacement_hash_invalid");
  } else if (verified.replacement !== null) fail("unexpected_candidate_edit_replacement");
  key(verified.rationale_code, "candidate_review_rationale_required");
  if (iso(verified.decided_at, "candidate_review_time_invalid") !== verified.decided_at) fail("candidate_review_time_invalid");
  return verified;
}

function verifyMaterializationRecord(materialization) {
  const verified = verifyFinal(materialization, "vyakti.experience-materialization.v1", "materialization_id", "mat", "materialization");
  if (!CANDIDATES.has(verified.kind)) fail("materialization_kind_invalid");
  scope(verified.scope, "materialization_scope");
  id(verified.candidate_id, "materialization_candidate_id_invalid");
  hash(verified.candidate_hash, "materialization_candidate_hash_invalid");
  id(verified.decision_id, "materialization_decision_id_invalid");
  hash(verified.decision_hash, "materialization_decision_hash_invalid");
  hash(verified.evidence_root_hash, "materialization_evidence_hash_invalid");
  assertNoInnerEmotionShape(verified.proposal);
  if (verified.supersedes !== null) {
    id(verified.supersedes?.materialization_id, "materialization_supersession_id_invalid");
    hash(verified.supersedes?.materialization_hash, "materialization_supersession_hash_invalid");
  }
  if (verified.kind === "voice") {
    if (verified.authorization?.active !== true || verified.authorization?.purpose !== "voice_reference_selection") fail("voice_materialization_active_consent_required");
    id(verified.authorization?.owner_id, "voice_materialization_consent_owner_invalid");
    id(verified.authorization?.receipt_id, "voice_materialization_consent_receipt_invalid");
    iso(verified.authorization?.checked_at, "voice_materialization_consent_time_invalid");
  } else if (verified.authorization !== null) fail("unexpected_materialization_consent_shape");
  if (iso(verified.materialized_at, "materialization_time_invalid") !== verified.materialized_at) fail("materialization_time_invalid");
  return verified;
}

export function materializeCandidate(candidateInput, decisionInput, input) {
  const candidate = verifyCandidate(candidateInput);
  const decision = verifyDecision(decisionInput);
  if (!Array.isArray(input?.existing_materializations)) fail("materialization_history_required");
  const existing = input.existing_materializations.map(verifyMaterializationRecord);
  if (existing.some((row) => row.candidate_id === candidate.candidate_id)) fail("candidate_already_materialized");
  const actorOwnerId = id(input?.actor_owner_id, "materialization_actor_required");
  if (actorOwnerId !== candidate.scope.owner_id || actorOwnerId !== decision.owner_id) fail("materialization_owner_mismatch");
  if (input?.expected_candidate_hash !== candidate.record_hash || input?.expected_decision_hash !== decision.record_hash) fail("materialization_stale_commitment");
  if (decision.candidate_id !== candidate.candidate_id || decision.candidate_hash !== candidate.record_hash) fail("materialization_decision_binding_mismatch");
  if (decision.action !== "accepted") fail("materialization_acceptance_required");
  const materializedAt = iso(input?.materialized_at, "materialization_time_invalid");
  if (Date.parse(materializedAt) < Date.parse(decision.decided_at)) fail("materialization_before_decision");

  let supersedes = null;
  if (candidate.supersedes) {
    const previous = verifyMaterializationRecord(input?.superseded_materialization);
    if (previous.candidate_id !== candidate.supersedes.candidate_id || previous.candidate_hash !== candidate.supersedes.candidate_hash) {
      fail("materialization_supersession_binding_mismatch");
    }
    if (previous.kind !== candidate.kind || canonicalJson(previous.scope) !== canonicalJson(candidate.scope)) fail("materialization_supersession_scope_mismatch");
    if (existing.some((row) => row.supersedes?.materialization_id === previous.materialization_id)) fail("materialization_predecessor_already_superseded");
    supersedes = { materialization_id: previous.materialization_id, materialization_hash: previous.record_hash };
  } else if (input?.superseded_materialization != null) {
    fail("unexpected_materialization_supersession");
  }

  let authorization = null;
  if (candidate.kind === "voice") {
    const value = input?.active_consent;
    if (value?.active !== true || value?.purpose !== "voice_reference_selection") fail("voice_materialization_active_consent_required");
    if (value?.owner_id !== candidate.scope.owner_id || value?.receipt_id !== candidate.proposal.consent_receipt_id) fail("voice_materialization_consent_binding_mismatch");
    const checkedAt = iso(value?.checked_at, "voice_materialization_consent_time_invalid");
    if (Date.parse(checkedAt) > Date.parse(materializedAt)) fail("voice_materialization_consent_time_invalid");
    authorization = {
      owner_id: value.owner_id,
      receipt_id: value.receipt_id,
      purpose: value.purpose,
      active: true,
      checked_at: checkedAt,
    };
  } else if (input?.active_consent != null) {
    fail("unexpected_materialization_consent_shape");
  }

  return finalize({
    schema: "vyakti.experience-materialization.v1",
    compiler_revision: EXPERIENCE_COMPILER_REVISION,
    kind: candidate.kind,
    scope: candidate.scope,
    candidate_id: candidate.candidate_id,
    candidate_hash: candidate.record_hash,
    decision_id: decision.decision_id,
    decision_hash: decision.record_hash,
    evidence_root_hash: candidate.evidence_root_hash,
    proposal: candidate.proposal,
    supersedes,
    authorization,
    materialized_at: materializedAt,
  }, "materialization_id", "mat");
}

export function verifyMaterialization(materialization) {
  return verifyMaterializationRecord(materialization);
}
