import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { buildCells, canonical, opaqueId, parseWav, sha256 } from "./lib.mjs";

export const RECORDED_PLAN = "vyakti-recorded-listening-plan/v1";
export const RECORDED_PACK = "vyakti-recorded-listening-pack/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const LANGUAGES = ["hi", "hi-Latn", "en-IN"];
const fail = (code) => { throw new Error(`recorded_${code}`); };
const requireThat = (ok, code) => { if (!ok) fail(code); };
const hash = (v) => typeof v === "string" && v.length === 64 && HASH.test(v);
const id = (v) => typeof v === "string" && ID.test(v);
const uuid = (v) => typeof v === "string" && v.length === 36 && UUID.test(v);
const text = (v, max = 8000) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v) && v.isWellFormed();
const digest = (value) => sha256(canonical(value));
function shape(value, required, optional = []) {
  requireThat(value && typeof value === "object" && !Array.isArray(value)
    && required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => [...required, ...optional].includes(key)), "shape_invalid");
}
function inventory(values, key, max = 1000) {
  requireThat(Array.isArray(values) && values.length > 0 && values.length <= max, "inventory_invalid");
  const keys = values.map((value) => value?.[key]);
  requireThat(keys.every(id) && new Set(keys).size === keys.length, "duplicate_or_invalid_id");
  return new Map(values.map((value) => [value[key], value]));
}
export function validateMediaDescriptor(value) {
  shape(value, ["path", "sha256"]);
  requireThat(text(value.path, 500) && !isAbsolute(value.path) && !/[\\:%?#]/u.test(value.path)
    && value.path.split("/").every((part) => part && part !== "." && part !== "..") && hash(value.sha256), "media_descriptor_invalid");
  return value;
}
function reference(value, subjectId, purpose) {
  shape(value, ["id", "subjectId", "purpose", "audio", "transcript", "preprocessingSha256", "authority"]);
  requireThat(id(value.id) && value.subjectId === subjectId && value.purpose === purpose && hash(value.preprocessingSha256), "reference_scope_invalid");
  validateMediaDescriptor(value.audio); validateMediaDescriptor(value.authority);
  shape(value.transcript, ["text", "sha256"]);
  requireThat(text(value.transcript.text) && sha256(value.transcript.text) === value.transcript.sha256, "reference_transcript_invalid");
}

// This validates declared bindings, never speaker authority or protection.
export function validateRecordedPlan(input) {
  let encoded;
  try { encoded = JSON.stringify(input); } catch { fail("plan_invalid"); }
  requireThat(typeof encoded === "string" && encoded.length <= 2_000_000, "plan_too_large");
  const plan = JSON.parse(encoded);
  shape(plan, ["contract", "runId", "corpus", "subject", "candidates", "conditioningGroups", "attempts", "deliveryRecipe"]);
  requireThat(plan.contract === RECORDED_PLAN && uuid(plan.runId), "plan_contract_invalid");
  requireThat(plan.deliveryRecipe === "preserve_exact_protected_bytes/v1", "delivery_recipe_unverified");
  shape(plan.corpus, ["id", "version", "items", "sha256"]);
  requireThat(id(plan.corpus.id) && id(plan.corpus.version), "corpus_invalid");
  const items = inventory(plan.corpus.items, "id");
  const candidates = inventory(plan.candidates, "id", 20);
  for (const item of items.values()) {
    shape(item, ["id", "language", "text", "textSha256", "eligibleCandidateIds"]);
    requireThat(LANGUAGES.includes(item.language) && text(item.text) && sha256(item.text) === item.textSha256, "corpus_text_invalid");
    requireThat(Array.isArray(item.eligibleCandidateIds) && item.eligibleCandidateIds.length > 0
      && new Set(item.eligibleCandidateIds).size === item.eligibleCandidateIds.length
      && item.eligibleCandidateIds.every((key) => candidates.has(key)), "corpus_candidate_invalid");
  }
  const { sha256: corpusHash, ...corpus } = plan.corpus;
  requireThat(hash(corpusHash) && digest(corpus) === corpusHash, "corpus_hash_mismatch");
  shape(plan.subject, ["id", "conditioningReferences", "listeningReference"]);
  requireThat(uuid(plan.subject.id), "single_subject_required");
  const references = inventory(plan.subject.conditioningReferences, "id", 20);
  for (const ref of references.values()) reference(ref, plan.subject.id, "conditioning");
  reference(plan.subject.listeningReference, plan.subject.id, "independent_listening");
  requireThat(!references.has(plan.subject.listeningReference.id)
    && [...references.values()].every((ref) => ref.audio.sha256 !== plan.subject.listeningReference.audio.sha256), "independent_reference_required");
  for (const candidate of candidates.values()) {
    shape(candidate, ["id", "languages", "identity"]);
    requireThat(Array.isArray(candidate.languages) && candidate.languages.length > 0 && new Set(candidate.languages).size === candidate.languages.length
      && candidate.languages.every((language) => LANGUAGES.includes(language)), "candidate_languages_invalid");
    shape(candidate.identity, ["modelSha256", "tokenizerSha256", "vocoderSha256", "adapterSha256", "runtimeImageSha256", "settingsSha256"]);
    requireThat(Object.entries(candidate.identity).every(([key, value]) => hash(value) || key === "adapterSha256" && value === "none"), "candidate_identity_invalid");
  }
  requireThat([...items.values()].every((item) => item.eligibleCandidateIds.every((key) => candidates.get(key).languages.includes(item.language))), "corpus_lane_ineligible");
  const groups = inventory(plan.conditioningGroups, "id", 30);
  for (const group of groups.values()) {
    shape(group, ["id", "comparisonRecipeId", "comparisonKind", "arms"]);
    requireThat(id(group.comparisonRecipeId) && ["weights_only", "pipeline"].includes(group.comparisonKind), "comparison_recipe_invalid");
    const arms = inventory(group.arms, "candidateId", 20);
    for (const arm of arms.values()) {
      shape(arm, ["candidateId", "referenceId", "referenceManifestSha256", "normalizationRecipeSha256"]);
      requireThat(candidates.has(arm.candidateId) && references.has(arm.referenceId)
        && digest(references.get(arm.referenceId)) === arm.referenceManifestSha256 && hash(arm.normalizationRecipeSha256), "conditioning_mapping_invalid");
    }
    if (group.comparisonKind === "weights_only") {
      requireThat(new Set(group.arms.map((arm) => `${arm.referenceManifestSha256}:${arm.normalizationRecipeSha256}`)).size === 1, "unequal_conditioning_requires_pipeline");
      requireThat(new Set(group.arms.map((arm) => {
        const { modelSha256, adapterSha256, ...pipeline } = candidates.get(arm.candidateId).identity;
        return canonical(pipeline);
      })).size === 1, "unequal_runtime_requires_pipeline");
    }
  }
  const attempts = inventory(plan.attempts, "id");
  const plannedCells = new Set();
  for (const attempt of attempts.values()) {
    shape(attempt, ["id", "runId", "subjectId", "itemId", "candidateId", "conditioningGroupId", "comparisonRecipeId", "listeningReferenceManifestSha256", "repeatIndex", "normalization"]);
    const item = items.get(attempt.itemId), candidate = candidates.get(attempt.candidateId), group = groups.get(attempt.conditioningGroupId);
    const arm = group?.arms.find((entry) => entry.candidateId === attempt.candidateId);
    requireThat(attempt.runId === plan.runId && attempt.subjectId === plan.subject.id, "attempt_scope_mismatch");
    requireThat(item && candidate && arm && item.eligibleCandidateIds.includes(candidate.id) && candidate.languages.includes(item.language), "attempt_candidate_or_lane_invalid");
    requireThat(attempt.comparisonRecipeId === group.comparisonRecipeId && attempt.listeningReferenceManifestSha256 === digest(plan.subject.listeningReference), "attempt_reference_or_recipe_mismatch");
    requireThat(Number.isInteger(attempt.repeatIndex) && attempt.repeatIndex >= 0 && attempt.repeatIndex < 100, "attempt_repeat_invalid");
    const cell = `${item.id}:${candidate.id}:${group.id}:${attempt.repeatIndex}`;
    requireThat(!plannedCells.has(cell), "duplicate_attempt_cell"); plannedCells.add(cell);
    const normal = attempt.normalization;
    shape(normal, ["sourceTextSha256", "synthesisText", "synthesisTextSha256", "recipeSha256", "reconstructedTextSha256", "receipt"]);
    requireThat(normal.sourceTextSha256 === item.textSha256 && text(normal.synthesisText)
      && normal.synthesisTextSha256 === sha256(normal.synthesisText) && normal.recipeSha256 === arm.normalizationRecipeSha256
      && normal.reconstructedTextSha256 === item.textSha256, "normalization_binding_invalid");
    validateMediaDescriptor(normal.receipt);
    const { receipt, ...commitment } = normal;
    requireThat(receipt.sha256 === digest(commitment), "normalization_receipt_mismatch");
  }
  for (const group of groups.values()) if (group.comparisonKind === "weights_only") {
    const texts = new Map();
    for (const attempt of attempts.values()) if (attempt.conditioningGroupId === group.id) {
      const key = `${attempt.itemId}:${attempt.repeatIndex}`;
      requireThat(!texts.has(key) || texts.get(key) === attempt.normalization.synthesisTextSha256, "unequal_text_requires_pipeline");
      texts.set(key, attempt.normalization.synthesisTextSha256);
    }
  }
  return Object.freeze({ plan, planSha256: digest(plan), authorityStatus: "unverified", humanListeningStatus: "not_started" });
}

export function validateRecordedPack(planInput, packInput) {
  const { plan, planSha256 } = validateRecordedPlan(planInput);
  let encoded;
  try { encoded = JSON.stringify(packInput); } catch { fail("pack_invalid"); }
  requireThat(typeof encoded === "string" && encoded.length <= 2_000_000, "pack_too_large");
  const pack = JSON.parse(encoded);
  shape(pack, ["contract", "runId", "runPlanSha256", "corpusSha256", "outcomes"]);
  requireThat(pack.contract === RECORDED_PACK && pack.runId === plan.runId && pack.runPlanSha256 === planSha256 && pack.corpusSha256 === plan.corpus.sha256, "pack_binding_mismatch");
  const outcomes = inventory(pack.outcomes, "attemptId");
  requireThat(outcomes.size === plan.attempts.length && plan.attempts.every((attempt) => outcomes.has(attempt.id)), "outcome_inventory_mismatch");
  for (const outcome of outcomes.values()) {
    shape(outcome, ["attemptId", "runId", "state", "generationId", "timing", "cost"], ["output", "protection", "delivery", "failureCode"]);
    requireThat(outcome.runId === plan.runId && uuid(outcome.generationId) && ["success", "failed", "uncertain"].includes(outcome.state), "outcome_invalid");
    shape(outcome.timing, ["startedAt", "endedAt"]);
    requireThat(typeof outcome.timing.startedAt === "string" && Number.isFinite(Date.parse(outcome.timing.startedAt))
      && (outcome.timing.endedAt === null && outcome.state === "uncertain" || typeof outcome.timing.endedAt === "string" && Date.parse(outcome.timing.endedAt) >= Date.parse(outcome.timing.startedAt)), "timing_invalid");
    shape(outcome.cost, ["status", "microUsd"]);
    requireThat(outcome.cost.status === "unknown" && outcome.cost.microUsd === null || outcome.cost.status === "recorded" && Number.isSafeInteger(outcome.cost.microUsd) && outcome.cost.microUsd >= 0, "cost_invalid");
    if (outcome.state !== "success") {
      requireThat(id(outcome.failureCode) && !Object.hasOwn(outcome, "output") && !Object.hasOwn(outcome, "protection") && !Object.hasOwn(outcome, "delivery"), "failed_attempt_has_audio");
    } else {
      requireThat(!Object.hasOwn(outcome, "failureCode"), "success_has_failure");
      validateMediaDescriptor(outcome.output); validateMediaDescriptor(outcome.protection);
      shape(outcome.delivery, ["recipe", "originalSha256", "deliveredSha256", "history"]);
      requireThat(outcome.delivery.recipe === plan.deliveryRecipe && outcome.delivery.originalSha256 === outcome.output.sha256
        && outcome.delivery.deliveredSha256 === outcome.output.sha256 && Array.isArray(outcome.delivery.history) && outcome.delivery.history.length === 0, "delivery_transform_unverified");
    }
  }
  requireThat(new Set(pack.outcomes.map((outcome) => outcome.generationId)).size === pack.outcomes.length, "duplicate_generation");
  return { plan, planSha256, pack };
}

// Neither historical pack booleans nor app-specific sealing adapters verify
// imported arbitrary speaker authority and protection. CLI cannot substitute a
// verifier. Future wiring needs an explicit, reviewed external evidence adapter.
export function unavailableRecordedVerifier() { fail("external_verification_unavailable"); }

export function readRecordedMedia(mediaRoot, descriptor) {
  validateMediaDescriptor(descriptor);
  try {
    const root = realpathSync(mediaRoot), file = realpathSync(resolve(root, descriptor.path));
    const rel = relative(root, file);
    requireThat(rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`), "media_outside_root");
    const stat = statSync(file);
    requireThat(stat.isFile() && stat.size <= 50_000_000, "media_size_invalid");
    const bytes = readFileSync(file);
    requireThat(bytes.length <= 50_000_000 && sha256(bytes) === descriptor.sha256, "media_hash_mismatch");
    return bytes;
  } catch (error) {
    if (error.message?.startsWith("recorded_")) throw error;
    fail("media_unavailable");
  }
}

// Explicit dependency injection is for verifier integration and offline tests;
// it is not authority. The CLI passes only unavailableRecordedVerifier.
export async function ingestRecordedPack(planInput, packInput, { readMedia, verifyEvidence = unavailableRecordedVerifier } = {}) {
  const { plan, planSha256, pack } = validateRecordedPack(planInput, packInput);
  const sessionBinding = digest({ planSha256, pack });
  const evidence = await verifyEvidence({ phase: "begin", bindingSha256: sessionBinding });
  requireThat(evidence?.bindingSha256 === sessionBinding && ["external_verified", "synthetic_fixture_only"].includes(evidence.assurance), "verification_binding_invalid");
  requireThat(typeof readMedia === "function", "media_reader_required");
  const read = (descriptor) => {
    const bytes = readMedia(descriptor);
    requireThat(Buffer.isBuffer(bytes) && bytes.length <= 50_000_000 && sha256(bytes) === descriptor.sha256, "media_hash_mismatch");
    return bytes;
  };
  const verify = async (binding, materials) => {
    const bindingSha256 = digest(binding);
    const result = await verifyEvidence({ phase: "evidence", binding, bindingSha256, materials });
    requireThat(result?.bindingSha256 === bindingSha256 && result.assurance === evidence.assurance, "verification_binding_invalid");
  };
  for (const ref of [...plan.subject.conditioningReferences, plan.subject.listeningReference]) {
    const audio = read(ref.audio), authority = read(ref.authority);
    parseWav(audio);
    await verify({ kind: "reference", runId: plan.runId, planSha256, reference: ref }, { audio, authority });
  }
  const stimuli = [];
  for (const attempt of plan.attempts) {
    const outcome = pack.outcomes.find((entry) => entry.attemptId === attempt.id);
    const normalizationReceipt = read(attempt.normalization.receipt);
    // Receipts contain the exact canonical normalization commitment; signatures
    // and semantic reconstruction still belong to the external verifier.
    const { receipt, ...normalization } = attempt.normalization;
    requireThat(normalizationReceipt.toString("utf8") === canonical(normalization), "normalization_receipt_mismatch");
    if (outcome.state !== "success") {
      await verify({ kind: "attempt", planSha256, attempt, outcome }, { normalizationReceipt });
      continue;
    }
    const bytes = read(outcome.output), protection = read(outcome.protection);
    // Independent listening speech and generated utterances need not have the
    // same duration. Validate the original format without changing any bytes.
    parseWav(bytes);
    await verify({ kind: "attempt", planSha256, attempt, outcome }, { bytes, protection, normalizationReceipt });
    const item = plan.corpus.items.find((entry) => entry.id === attempt.itemId);
    stimuli.push({ id: attempt.id, candidateId: attempt.candidateId, language: item.language, textSha256: item.textSha256,
      comparisonScope: { runId: plan.runId, planSha256, subjectId: attempt.subjectId, conditioningGroupId: attempt.conditioningGroupId,
        listeningReferenceManifestSha256: attempt.listeningReferenceManifestSha256, comparisonRecipeId: attempt.comparisonRecipeId } });
  }
  return { contract: RECORDED_PACK, planSha256, packSha256: digest(pack), assurance: evidence.assurance,
    humanListeningStatus: "not_rated", playbackStatus: "unavailable_prerequisite_only", plan, pack,
    cells: buildCells(stimuli, { scope: "recorded/v1" }).map((cell) => ({ ...cell,
      comparisonKind: plan.conditioningGroups.find((group) => group.id === stimuli.find((stimulus) => stimulus.id === cell.stimulusIds[0]).comparisonScope.conditioningGroupId).comparisonKind })) };
}

// Allow-list serialization: the private mapping, paths, text, identities,
// authority material and verifier evidence never enter the public summary.
export function recordedPublicSummary(validated, secret) {
  requireThat(Buffer.isBuffer(secret) && secret.length === 32, "seal_secret_invalid");
  const { plan, planSha256 } = validateRecordedPlan(validated.plan);
  const outcomes = validated.pack ? validateRecordedPack(plan, validated.pack).pack.outcomes : [];
  return {
    contract: "vyakti-recorded-listening-summary/v1", runId: opaqueId(secret, "recorded-run", plan.runId),
    planCommitment: opaqueId(secret, "plan", planSha256), authorityStatus: "unverified_for_playback",
    state: outcomes.length ? "not_rated" : "not_started", playbackStatus: "unavailable_prerequisite_only",
    attempts: plan.attempts.length, successful: outcomes.filter((entry) => entry.state === "success").length,
    failed: outcomes.filter((entry) => entry.state === "failed").length, uncertain: outcomes.filter((entry) => entry.state === "uncertain").length,
    notStarted: outcomes.length ? 0 : plan.attempts.length, rated: 0, winner: null,
  };
}
