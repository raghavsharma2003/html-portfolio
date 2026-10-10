import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  EXPRESSION_MAX_TTL_MS,
  createCandidate,
  createObservation,
  createSource,
  materializeCandidate,
  reviewCandidate,
  verifyCandidate,
  verifyDecision,
  verifyMaterialization,
  verifyObservation,
  verifySource,
} from "../../api/_experience-compiler/contracts.js";
import { canonicalJson, sha256Hex } from "../../api/_provenance/contracts.js";

let checks = 0;

function pass(name, detail = "") {
  checks++;
  console.log(`PASS  ${name}${detail ? `  ${detail}` : ""}`);
}

function ok(name, condition, detail = "") {
  assert.ok(condition, name);
  pass(name, detail);
}

function equal(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  pass(name);
}

function rejects(name, code, action) {
  assert.throws(action, (error) => error?.code === code, name);
  pass(name, code);
}

function hex(label) {
  return createHash("sha256").update(String(label)).digest("hex");
}

function recommit(record, idField, prefix, mutate) {
  const changed = JSON.parse(JSON.stringify(record));
  mutate(changed);
  delete changed[idField];
  delete changed.record_hash;
  changed.record_hash = sha256Hex(canonicalJson(changed));
  changed[idField] = `${prefix}_${changed.record_hash}`;
  return changed;
}

const BASE = Date.parse("2026-08-30T00:00:00.000Z");
const at = (offsetMs = 0) => new Date(BASE + offsetMs).toISOString();
const spanUnits = {
  audio: "audio_ms",
  call_audio: "audio_ms",
  conversation_turn: "utf8_bytes",
  document: "pages",
  image: "pixels",
  link: "utf8_bytes",
  text: "utf8_bytes",
  video: "video_ms",
};

function source(overrides = {}) {
  const modality = overrides.modality || "call_audio";
  const capturedAt = overrides.captured_at || at(0);
  return createSource({
    scope: { owner_id: "owner_alpha", dyad_id: "dyad_alpha_beta" },
    modality,
    content_sha256: hex(`source:${modality}`),
    byte_length: 480_044,
    captured_at: capturedAt,
    speaker_scope: "owner",
    consent: {
      receipt_id: "consent_alpha",
      subject: "owner",
      purposes: ["experience_observation", "persona_candidate", "relation_candidate", "voice_reference_selection"],
      granted_at: at(-1_000),
      expires_at: at(7 * 24 * 60 * 60 * 1_000),
      revoked_at: null,
    },
    ...overrides,
  });
}

function observation(sourceRecord, overrides = {}) {
  const kind = overrides.kind || "relation_signal";
  const isExpression = kind === "expression";
  const observedAt = overrides.observed_at || at(1_000);
  return createObservation({
    source: sourceRecord,
    scope: sourceRecord.scope,
    modality: sourceRecord.modality,
    kind,
    epistemic_status: overrides.epistemic_status || "inferred",
    value: overrides.value || { signal: "keeps_promises", strength: 0.8 },
    confidence: overrides.confidence ?? 0.8,
    calibration: overrides.calibration || {
      status: "calibrated",
      method: "consented_hinglish_holdout",
      revision: "r1",
      sample_size: 90,
      dataset_hash: hex("calibration-pack"),
      measured_at: at(-500),
    },
    producer: overrides.producer || {
      kind: "rules",
      name: "offline_fixture",
      revision: "r1",
      code_hash: hex("offline-fixture-r1"),
    },
    span: overrides.span || {
      unit: spanUnits[sourceRecord.modality],
      start: 0,
      end: sourceRecord.modality.includes("audio") ? 10_000 : 40,
      content_sha256: hex(`span:${sourceRecord.record_hash}`),
    },
    observed_at: observedAt,
    expires_at: isExpression ? at(1_000 + EXPRESSION_MAX_TTL_MS) : null,
    expression: isExpression ? {
      turn_id: "turn_alpha_001",
      claim_target: "delivery_cue",
      interpretation: "observer_interpretation",
      may_claim_inner_emotion: false,
    } : null,
    ...overrides,
  });
}

function relationCandidate(observations, overrides = {}) {
  return createCandidate({
    kind: "relation",
    scope: { owner_id: "owner_alpha", dyad_id: "dyad_alpha_beta" },
    observations,
    proposal: { operation: "append_relation_event", key: "promise_kept", value: { count: 1 } },
    created_at: at(2_000),
    ...overrides,
  });
}

function review(candidate, action = "accepted", overrides = {}) {
  return reviewCandidate(candidate, {
    prior_decisions: [],
    actor_owner_id: candidate.scope.owner_id,
    expected_candidate_hash: candidate.record_hash,
    action,
    rationale_code: action === "accepted" ? "owner_confirmed" : "owner_rejected",
    decided_at: at(3_000),
    ...overrides,
  });
}

function materialize(candidate, decision, overrides = {}) {
  return materializeCandidate(candidate, decision, {
    existing_materializations: [],
    actor_owner_id: candidate.scope.owner_id,
    expected_candidate_hash: candidate.record_hash,
    expected_decision_hash: decision.record_hash,
    materialized_at: at(4_000),
    ...overrides,
  });
}

console.log("\n-- immutable source and span commitments --");

const callSource = source();
const reorderedSource = createSource({
  consent: {
    revoked_at: null,
    expires_at: at(7 * 24 * 60 * 60 * 1_000),
    purposes: ["voice_reference_selection", "relation_candidate", "experience_observation", "persona_candidate"],
    subject: "owner",
    granted_at: at(-1_000),
    receipt_id: "consent_alpha",
  },
  speaker_scope: "owner",
  captured_at: at(0),
  byte_length: 480_044,
  content_sha256: hex("source:call_audio"),
  modality: "call_audio",
  scope: { dyad_id: "dyad_alpha_beta", owner_id: "owner_alpha" },
});
equal("source hashing is deterministic and key-order invariant", reorderedSource, callSource);
ok("source records are deeply frozen", Object.isFrozen(callSource) && Object.isFrozen(callSource.consent) && Object.isFrozen(callSource.consent.purposes));
equal("source verifier returns the committed record", verifySource(callSource), callSource);
const otherOwnerSource = source({ scope: { owner_id: "owner_gamma", dyad_id: "dyad_gamma_beta" } });
ok("the same bytes under another owner get a different source commitment", otherOwnerSource.record_hash !== callSource.record_hash);
rejects("an invalid raw source hash is refused", "source_content_hash_invalid", () => source({ content_sha256: "not-a-hash" }));
rejects("capture requires observation-purpose consent", "source_observation_consent_required", () => source({
  consent: {
    receipt_id: "consent_alpha",
    subject: "owner",
    purposes: ["relation_candidate"],
    granted_at: at(-1_000),
  },
}));

const relationObservation = observation(callSource);
equal("observation verifier returns the committed record", verifyObservation(relationObservation), relationObservation);
ok("observation binds source, source hash, exact span and span hash", Boolean(
  relationObservation.source.source_id && relationObservation.source.source_hash && relationObservation.span.content_sha256 && relationObservation.span.span_hash,
));
const movedSpan = observation(callSource, { span: { ...relationObservation.span, start: 1, end: 9_999, span_hash: undefined } });
ok("moving one span boundary changes observation and span commitments", movedSpan.span.span_hash !== relationObservation.span.span_hash && movedSpan.record_hash !== relationObservation.record_hash);
rejects("span units cannot disagree with source modality", "observation_span_unit_mismatch", () => observation(callSource, {
  span: { unit: "utf8_bytes", start: 0, end: 10, content_sha256: hex("wrong-unit") },
}));
rejects("observations cannot move across owners or dyads", "observation_source_scope_mismatch", () => observation(callSource, {
  scope: { owner_id: "owner_alpha", dyad_id: "dyad_other" },
}));
rejects("observation modality cannot be relabelled", "observation_source_modality_mismatch", () => observation(callSource, { modality: "video" }));

console.log("\n-- observed, inferred and expiring expression evidence --");

const directObservation = observation(callSource, {
  kind: "acoustic_measurement",
  epistemic_status: "observed",
  value: { duration_ms: 10_000 },
  confidence: 1,
  calibration: {
    status: "uncalibrated",
    method: "direct_duration_measurement",
    revision: "r1",
    sample_size: 0,
    dataset_hash: null,
    measured_at: null,
  },
  producer: {
    kind: "direct_measurement",
    name: "pcm_duration_reader",
    revision: "r1",
    code_hash: hex("pcm-reader-r1"),
  },
});
equal("direct evidence says observed and explicitly says uncalibrated", [directObservation.epistemic_status, directObservation.calibration.status], ["observed", "uncalibrated"]);
equal("derived evidence says inferred and carries calibration lineage", [relationObservation.epistemic_status, relationObservation.calibration.status, relationObservation.calibration.sample_size], ["inferred", "calibrated", 90]);
rejects("an inferred record cannot omit calibration", "observation_calibration_status_invalid", () => observation(callSource, { calibration: null }));
rejects("uncalibrated scores cannot carry a fake dataset measurement", "uncalibrated_observation_cannot_claim_measurement", () => observation(callSource, {
  calibration: {
    status: "uncalibrated",
    method: "unknown_calibration",
    revision: "r1",
    sample_size: 9,
    dataset_hash: hex("fake-calibration"),
    measured_at: at(0),
  },
}));

const expressionObservation = observation(callSource, { kind: "expression", value: { observer_label: "animated_delivery" } });
equal("expression is dyad and turn scoped", [expressionObservation.scope.dyad_id, expressionObservation.expression.turn_id], ["dyad_alpha_beta", "turn_alpha_001"]);
equal("expression uses the maximum allowed expiry without exceeding it", Date.parse(expressionObservation.expires_at) - Date.parse(expressionObservation.observed_at), EXPRESSION_MAX_TTL_MS);
equal("expression explicitly cannot claim inner emotion", expressionObservation.expression.may_claim_inner_emotion, false);
rejects("expression cannot live longer than 24 hours", "expression_expiry_invalid", () => observation(callSource, {
  kind: "expression",
  expires_at: at(1_000 + EXPRESSION_MAX_TTL_MS + 1),
}));
rejects("expression needs both turn and dyad scope", "expression_turn_and_dyad_scope_required", () => observation(callSource, {
  kind: "expression",
  expression: {
    claim_target: "delivery_cue",
    interpretation: "observer_interpretation",
    may_claim_inner_emotion: false,
  },
}));
rejects("expression cannot assert a person's inner emotion", "inner_emotion_claim_forbidden", () => observation(callSource, {
  kind: "expression",
  expression: {
    turn_id: "turn_alpha_001",
    claim_target: "inner_emotion",
    interpretation: "model_truth",
    may_claim_inner_emotion: true,
  },
}));

console.log("\n-- reviewable candidate kinds and evidence scope --");

const relation = relationCandidate([relationObservation]);
equal("relation candidates remain proposed", relation.state, "proposed");
equal("relation candidates bind one dyad", relation.scope.dyad_id, "dyad_alpha_beta");
equal("candidate evidence retains source, span and observation hashes", Object.keys(relation.evidence[0]).filter((name) => name.endsWith("_hash")).sort(), ["observation_hash", "source_hash", "span_hash"]);
equal("candidate verifier accepts the exact commitment", verifyCandidate(relation), relation);
rejects("relation candidates cannot omit a dyad", "relation_candidate_dyad_required", () => relationCandidate([relationObservation], {
  scope: { owner_id: "owner_alpha", dyad_id: null },
}));
const otherDyadSource = source({ scope: { owner_id: "owner_alpha", dyad_id: "dyad_alpha_delta" }, content_sha256: hex("other-dyad") });
const otherDyadObservation = observation(otherDyadSource);
rejects("relation evidence cannot cross dyads", "relation_candidate_cross_dyad_evidence_forbidden", () => relationCandidate([relationObservation, otherDyadObservation]));
rejects("candidate evidence cannot cross owners", "candidate_cross_owner_evidence_forbidden", () => relationCandidate([relationObservation, observation(otherOwnerSource)]));

const factObservation = observation(callSource, {
  kind: "fact_signal",
  value: { statement: "teaches chemistry on weekday mornings" },
});
const fact = createCandidate({
  kind: "fact",
  scope: { owner_id: "owner_alpha", dyad_id: null },
  observations: [factObservation],
  proposal: {
    operation: "upsert_fact",
    key: "chemistry_schedule",
    value: "weekday mornings",
    valid_from: at(0),
    valid_to: null,
  },
  created_at: at(2_000),
});
equal("fact candidates are source-cited proposals", [fact.kind, fact.state, fact.evidence[0].source_hash, fact.evidence[0].span_hash], ["fact", "proposed", factObservation.source.source_hash, factObservation.span.span_hash]);
rejects("fact validity cannot end before it starts", "fact_candidate_valid_time_invalid", () => createCandidate({
  kind: "fact",
  scope: { owner_id: "owner_alpha", dyad_id: null },
  observations: [factObservation],
  proposal: {
    operation: "upsert_fact",
    key: "chemistry_schedule",
    value: "weekday mornings",
    valid_from: at(10_000),
    valid_to: at(5_000),
  },
  created_at: at(2_000),
}));

const personaObservation = observation(callSource, { kind: "persona_signal", value: { phrase: "let us derive it" } });
const persona = createCandidate({
  kind: "persona",
  scope: { owner_id: "owner_alpha", dyad_id: null },
  observations: [personaObservation],
  proposal: { operation: "set_persona_field", field: "teaching_phrase", value: "let us derive it" },
  created_at: at(2_000),
});
equal("persona candidates are owner scoped and still only proposals", [persona.kind, persona.scope.dyad_id, persona.state], ["persona", null, "proposed"]);
rejects("candidate shapes cannot smuggle an inner-emotion field", "inner_emotion_claim_forbidden", () => createCandidate({
  kind: "persona",
  scope: { owner_id: "owner_alpha", dyad_id: null },
  observations: [personaObservation],
  proposal: { operation: "set_persona_field", field: "mood", inner_emotion: "sad" },
  created_at: at(2_000),
}));

const voiceObservation = observation(callSource, { kind: "voice_window", epistemic_status: "observed", value: { duration_ms: 10_000 } });
const voice = createCandidate({
  kind: "voice",
  scope: { owner_id: "owner_alpha", dyad_id: null },
  observations: [voiceObservation],
  proposal: {
    operation: "select_voice_window",
    observation_id: voiceObservation.observation_id,
    duration_ms: 10_000,
    consent_receipt_id: "consent_alpha",
    speaker_verification: {
      verdict: "verified_owner",
      receipt_id: "speaker_receipt_alpha",
      verifier_revision: "owner_speaker_v1",
      checked_at: at(1_500),
    },
  },
  created_at: at(2_000),
});
equal("voice candidate selects one bounded verified window", [voice.kind, voice.proposal.observation_id, voice.proposal.duration_ms], ["voice", voiceObservation.observation_id, 10_000]);
rejects("more duration cannot masquerade as voice learning", "voice_candidate_window_duration_invalid", () => createCandidate({
  kind: "voice",
  scope: { owner_id: "owner_alpha", dyad_id: null },
  observations: [voiceObservation],
  proposal: { ...voice.proposal, duration_ms: 31_000 },
  created_at: at(2_000),
}));
const unconsentedSource = source({
  content_sha256: hex("no-voice-consent"),
  consent: {
    receipt_id: "consent_observation_only",
    subject: "owner",
    purposes: ["experience_observation"],
    granted_at: at(-1_000),
  },
});
const unconsentedVoiceObservation = observation(unconsentedSource, { kind: "voice_window", epistemic_status: "observed" });
rejects("voice selection needs source-bound voice consent", "voice_candidate_consent_scope_required", () => createCandidate({
  kind: "voice",
  scope: { owner_id: "owner_alpha", dyad_id: null },
  observations: [unconsentedVoiceObservation],
  proposal: { ...voice.proposal, observation_id: unconsentedVoiceObservation.observation_id, consent_receipt_id: "consent_observation_only" },
  created_at: at(2_000),
}));
const otherSpeakerSource = source({ content_sha256: hex("other-speaker"), speaker_scope: "other" });
const otherSpeakerVoiceObservation = observation(otherSpeakerSource, { kind: "voice_window", epistemic_status: "observed" });
rejects("a third-party speaker window cannot become owner voice", "voice_candidate_owner_speaker_required", () => createCandidate({
  kind: "voice",
  scope: { owner_id: "owner_alpha", dyad_id: null },
  observations: [otherSpeakerVoiceObservation],
  proposal: { ...voice.proposal, observation_id: otherSpeakerVoiceObservation.observation_id },
  created_at: at(2_000),
}));

console.log("\n-- explicit review and guarded materialization --");

const accepted = review(relation);
equal("only the owner can create an accepted decision receipt", [accepted.action, accepted.actor_owner_id], ["accepted", "owner_alpha"]);
equal("decision verifier accepts the exact receipt", verifyDecision(accepted), accepted);
rejects("review requires the persisted decision history", "candidate_decision_history_required", () => reviewCandidate(relation, {
  actor_owner_id: "owner_alpha",
  expected_candidate_hash: relation.record_hash,
  action: "accepted",
  rationale_code: "owner_confirmed",
  decided_at: at(3_000),
}));
rejects("another owner cannot review the candidate", "candidate_review_owner_mismatch", () => review(relation, "accepted", { actor_owner_id: "owner_gamma" }));
rejects("a stale screen cannot review a changed candidate", "candidate_review_stale_hash", () => review(relation, "accepted", { expected_candidate_hash: hex("stale") }));
rejects("a candidate cannot receive a second terminal decision", "candidate_already_decided", () => review(relation, "rejected", { prior_decisions: [accepted] }));

const rejected = review(relation, "rejected");
rejects("a rejected candidate cannot materialize", "materialization_acceptance_required", () => materialize(relation, rejected));
const deferred = review(relation, "deferred", { rationale_code: "owner_will_review" });
rejects("a deferred candidate cannot materialize", "materialization_acceptance_required", () => materialize(relation, deferred));
const acceptedAfterDeferral = review(relation, "accepted", { prior_decisions: [deferred], decided_at: at(3_500) });
equal("deferral is non-terminal and preserves later owner acceptance", acceptedAfterDeferral.action, "accepted");
const relationMaterialization = materialize(relation, accepted);
equal("accepted candidate materialization binds candidate and decision", [relationMaterialization.candidate_hash, relationMaterialization.decision_hash], [relation.record_hash, accepted.record_hash]);
equal("materialization verifier accepts the exact record", verifyMaterialization(relationMaterialization), relationMaterialization);
rejects("materialization requires durable history for duplicate protection", "materialization_history_required", () => materializeCandidate(relation, accepted, {
  actor_owner_id: "owner_alpha",
  expected_candidate_hash: relation.record_hash,
  expected_decision_hash: accepted.record_hash,
  materialized_at: at(4_000),
}));
rejects("one candidate cannot materialize twice", "candidate_already_materialized", () => materialize(relation, accepted, { existing_materializations: [relationMaterialization] }));
rejects("a decision for another candidate cannot authorize this one", "materialization_decision_binding_mismatch", () => materialize(persona, accepted));

const acceptedVoice = review(voice);
rejects("voice materialization rechecks active consent", "voice_materialization_active_consent_required", () => materialize(voice, acceptedVoice));
const voiceMaterialization = materialize(voice, acceptedVoice, {
  active_consent: {
    owner_id: "owner_alpha",
    receipt_id: "consent_alpha",
    purpose: "voice_reference_selection",
    active: true,
    checked_at: at(3_500),
  },
});
equal("voice materialization commits the rechecked consent receipt", voiceMaterialization.authorization.receipt_id, "consent_alpha");
const acceptedFact = review(fact);
const factMaterialization = materialize(fact, acceptedFact);
equal("accepted fact materializes with its exact source evidence root", factMaterialization.evidence_root_hash, fact.evidence_root_hash);

const personaEdit = createCandidate({
  kind: "persona",
  scope: persona.scope,
  observations: [personaObservation],
  proposal: { operation: "set_persona_field", field: "teaching_phrase", value: "let us work it through" },
  created_at: at(6_000),
  supersedes_candidate: persona,
});
rejects("edit review requires an explicit superseding candidate", "candidate_edit_replacement_required", () => review(persona, "edited", { rationale_code: "owner_edited" }));
const editDecision = review(persona, "edited", { replacement_candidate: personaEdit, rationale_code: "owner_edited" });
equal("edit receipt binds the immutable replacement", editDecision.replacement, { candidate_id: personaEdit.candidate_id, candidate_hash: personaEdit.record_hash });
rejects("an edit decision cannot materialize the old candidate", "materialization_acceptance_required", () => materialize(persona, editDecision));

console.log("\n-- supersession and provenance --");

const newerObservation = observation(callSource, { value: { signal: "keeps_promises", strength: 0.95 }, observed_at: at(5_000) });
const replacement = relationCandidate([newerObservation], {
  proposal: { operation: "append_relation_event", key: "promise_kept", value: { count: 2 } },
  created_at: at(6_000),
  supersedes_candidate: relation,
});
equal("replacement candidate commits its predecessor id and hash", replacement.supersedes, { candidate_id: relation.candidate_id, candidate_hash: relation.record_hash });
const replacementDecision = review(replacement, "accepted", { decided_at: at(7_000) });
rejects("a replacement cannot materialize without its exact predecessor artifact", "materialization_schema_invalid", () => materialize(replacement, replacementDecision, { materialized_at: at(8_000) }));
const replacementMaterialization = materialize(replacement, replacementDecision, {
  existing_materializations: [relationMaterialization],
  superseded_materialization: relationMaterialization,
  materialized_at: at(8_000),
});
equal("materialized replacement commits predecessor materialization", replacementMaterialization.supersedes, {
  materialization_id: relationMaterialization.materialization_id,
  materialization_hash: relationMaterialization.record_hash,
});
const competingReplacement = relationCandidate([newerObservation], {
  proposal: { operation: "append_relation_event", key: "promise_kept", value: { count: 3 } },
  created_at: at(6_500),
  supersedes_candidate: relation,
});
const competingDecision = review(competingReplacement, "accepted", { decided_at: at(7_500) });
rejects("one predecessor cannot be superseded twice", "materialization_predecessor_already_superseded", () => materialize(competingReplacement, competingDecision, {
  existing_materializations: [relationMaterialization, replacementMaterialization],
  superseded_materialization: relationMaterialization,
  materialized_at: at(8_000),
}));
rejects("supersession cannot cross candidate kinds", "candidate_supersession_scope_mismatch", () => createCandidate({
  kind: "persona",
  scope: { owner_id: "owner_alpha", dyad_id: null },
  observations: [personaObservation],
  proposal: { operation: "set_persona_field", field: "teaching_phrase", value: "derive it" },
  created_at: at(6_000),
  supersedes_candidate: relation,
}));

console.log("\n-- tamper resistance and deterministic properties --");

const tamperedCandidate = JSON.parse(JSON.stringify(relation));
tamperedCandidate.proposal.value.count = 99;
rejects("candidate mutation is detected", "candidate_commitment_mismatch", () => verifyCandidate(tamperedCandidate));
const tamperedDecision = JSON.parse(JSON.stringify(accepted));
tamperedDecision.action = "rejected";
rejects("decision mutation is detected", "candidate_decision_commitment_mismatch", () => verifyDecision(tamperedDecision));
const forgedSpan = JSON.parse(JSON.stringify(relationObservation));
forgedSpan.span.span_hash = hex("forged-span");
const forgedBasis = { ...forgedSpan };
delete forgedBasis.observation_id;
delete forgedBasis.record_hash;
forgedSpan.record_hash = sha256Hex(canonicalJson(forgedBasis));
forgedSpan.observation_id = `obs_${forgedSpan.record_hash}`;
rejects("re-hashing a false span cannot hide the broken source/span edge", "observation_span_commitment_mismatch", () => verifyObservation(forgedSpan));
const forgedConfidence = recommit(relationObservation, "observation_id", "obs", (changed) => { changed.confidence = 2; });
rejects("a re-hashed observation still has to pass semantic validation", "observation_confidence_invalid", () => verifyObservation(forgedConfidence));
const forgedCandidateState = recommit(relation, "candidate_id", "cand", (changed) => { changed.state = "approved"; });
rejects("a re-hashed candidate cannot bypass the proposed-only state", "candidate_state_invalid", () => verifyCandidate(forgedCandidateState));
const forgedDecisionOwner = recommit(accepted, "decision_id", "dec", (changed) => { changed.actor_owner_id = "owner_gamma"; });
rejects("a re-hashed decision cannot separate actor from owner", "candidate_decision_owner_mismatch", () => verifyDecision(forgedDecisionOwner));
const forgedMaterialization = recommit(relationMaterialization, "materialization_id", "mat", (changed) => {
  changed.authorization = { active: true, purpose: "voice_reference_selection" };
});
rejects("a re-hashed non-voice materialization cannot carry voice authority", "unexpected_materialization_consent_shape", () => verifyMaterialization(forgedMaterialization));

const secondRelationObservation = observation(callSource, { value: { signal: "repair", strength: 0.7 }, observed_at: at(1_100) });
const ordered = relationCandidate([relationObservation, secondRelationObservation]);
const reversed = relationCandidate([secondRelationObservation, relationObservation]);
equal("evidence order cannot change a candidate commitment", reversed, ordered);
rejects("duplicate evidence is not counted twice", "candidate_duplicate_evidence", () => relationCandidate([relationObservation, relationObservation]));

let seed = 0x1729;
function random() {
  seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
  return seed / 0x1_0000_0000;
}

let unauthorizedMaterializations = 0;
const propertyTrials = 500;
for (let index = 0; index < propertyTrials; index++) {
  const suffix = String(index).padStart(3, "0");
  const trialSource = source({
    scope: { owner_id: `owner_${suffix}`, dyad_id: `dyad_${suffix}` },
    content_sha256: hex(`trial-source:${index}`),
    consent: {
      receipt_id: `consent_${suffix}`,
      subject: "owner",
      purposes: ["experience_observation", "relation_candidate"],
      granted_at: at(-1_000),
    },
  });
  const trialObservation = observation(trialSource, {
    value: { sample: index, score: Number(random().toFixed(6)) },
    observed_at: at(10_000 + index),
  });
  const trialCandidate = createCandidate({
    kind: "relation",
    scope: trialSource.scope,
    observations: [trialObservation],
    proposal: { operation: "append_relation_event", key: "trial_event", value: { sample: index } },
    created_at: at(20_000 + index),
  });
  const action = random() < 0.5 ? "accepted" : "rejected";
  const trialDecision = reviewCandidate(trialCandidate, {
    prior_decisions: [],
    actor_owner_id: trialSource.scope.owner_id,
    expected_candidate_hash: trialCandidate.record_hash,
    action,
    rationale_code: action === "accepted" ? "owner_confirmed" : "owner_rejected",
    decided_at: at(30_000 + index),
  });
  try {
    materializeCandidate(trialCandidate, trialDecision, {
      existing_materializations: [],
      actor_owner_id: trialSource.scope.owner_id,
      expected_candidate_hash: trialCandidate.record_hash,
      expected_decision_hash: trialDecision.record_hash,
      materialized_at: at(40_000 + index),
    });
    if (action !== "accepted") unauthorizedMaterializations++;
  } catch (error) {
    if (action === "accepted" || error?.code !== "materialization_acceptance_required") throw error;
  }
}
equal(`${propertyTrials} review/materialize trials never persisted a rejected proposal`, unauthorizedMaterializations, 0);

let commitmentCollisions = 0;
for (let index = 0; index < 500; index++) {
  const base = source({ content_sha256: hex(`collision-base:${index}`) });
  const changed = source({ content_sha256: hex(`collision-changed:${index}`) });
  if (base.record_hash === changed.record_hash) commitmentCollisions++;
}
equal("500 source-content mutations changed every source commitment", commitmentCollisions, 0);

console.log("\n-- adapter uses the existing truth substrate --");

const adapterNote = readFileSync(new URL("../../api/_experience-compiler/README.md", import.meta.url), "utf8");
ok("adapter note says this is not a new database", adapterNote.includes("not a new database or a second source of truth"));
for (const table of [
  "vy_replica_processing_evidence",
  "vy_replica_claim",
  "vy_replica_claim_citation",
  "vy_replica_claim_decision",
  "vy_replica_profile",
  "vy_mirror_window",
  "vy_mirror_conditioning",
  "vy_mirror_delta",
]) {
  ok(`adapter note maps ${table}`, adapterNote.includes(`\`${table}\``));
}

console.log(`\nexperience-compiler: ok (${checks} named checks, ${propertyTrials + 500} deterministic property trials)`);
