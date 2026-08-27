import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { parseWav, wrapWav } from "../voice-listening-benchmark/lib.mjs";

export const MATCHED_PACK_CONTRACT = "vyakti-exact-text-owner-voice-pack/v1";
export const TRANSPORT_PROTOCOL = "vyakti-open-voice/v1";
export const SYNTHESIS_PATH = "/v1/synthesize";
export const SAMPLE_RATE = 24_000;
export const SEED = 31_001;
export const CLOUD_HARD_STOP_USD = 5;
export const ATTEMPT_RESERVATION_USD = 0.5;
export const REFERENCE_WINDOW = Object.freeze({ startMs: 0, durationMs: 12_000 });
export const INDICF5_PRONUNCIATION_NORMALIZATION = Object.freeze({
  contract: "vyakti-indicf5-pronunciation-normalizer/v1",
  domain: "chemistry",
  locale: "hi-IN",
  mode: "required",
});
export const INDICF5_VARIANTS = Object.freeze({
  UNNORMALIZED_BASELINE: "unnormalized_baseline",
  PRONUNCIATION_NORMALIZED: "pronunciation_normalized",
});

export const DISCLOSURES = Object.freeze({
  en: "This is an AI-generated voice replica.",
  hi: "यह एआई से बनाई गई आवाज़ की प्रतिकृति है।",
});

export const FROZEN_PROMPTS = Object.freeze({
  en: Object.freeze({
    id: "english-neutral-indian-classroom",
    language: "English",
    locale: "en-IN",
    script: "latin",
    body: "Today we will learn why balancing a chemical equation changes the coefficients but never the subscripts.",
  }),
  hi: Object.freeze({
    id: "reaction-definition-devanagari",
    language: "Hindi",
    locale: "hi-IN",
    script: "devanagari",
    body: "रासायनिक अभिक्रिया में पुराने बंध टूटते हैं और नए बंध बनते हैं। इसे केवल रंग बदलने से मत पहचानो।",
  }),
});

export const SCORE_AXES = Object.freeze([
  Object.freeze({ id: "owner_likeness", label: "Owner likeness", low: "clearly a different person", high: "sounds exactly like the real owner" }),
  Object.freeze({ id: "naturalness", label: "Naturalness and humanness", low: "robotic or synthetic", high: "ordinary human speech" }),
  Object.freeze({ id: "indian_accent", label: "Indian accent fit for this language", low: "foreign or unnatural accent", high: "native Indian English or Hindi" }),
  Object.freeze({ id: "pronunciation", label: "Pronunciation and intelligibility", low: "wrong or hard to understand", high: "every word is correct and clear" }),
]);

export const ARM_SPECS = Object.freeze({
  chatterbox: Object.freeze({
    id: "chatterbox",
    label: "Chatterbox multilingual v3",
    required: true,
    languages: Object.freeze(["en", "hi"]),
    model: "chatterbox-multilingual-v3",
    modelRevision: "5de7a54aa4e5e2baadb0182dde554908b48b85c2:5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18",
    modelCommitment: sha256("chatterbox-multilingual-v3:5de7a54aa4e5e2baadb0182dde554908b48b85c2:5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18"),
    envPrefix: "CHATTERBOX",
  }),
  qwen: Object.freeze({
    id: "qwen",
    label: "Qwen3-TTS 12 Hz 1.7B Base",
    required: true,
    languages: Object.freeze(["en"]),
    model: "qwen3-tts-12hz-1.7b-base",
    modelRevision: "fd4b254389122332181a7c3db7f27e918eec64e3",
    modelCommitment: "4b14752ab88a5d74ed160d7766e1802ab5890540802a1d829ab946214b75e8c5",
    envPrefix: "QWEN",
  }),
  voxcpm2: Object.freeze({
    id: "voxcpm2",
    label: "VoxCPM2",
    required: true,
    languages: Object.freeze(["en", "hi"]),
    model: "voxcpm2",
    modelRevision: "32279effe8c19989596f05d353d1447f51d9e915",
    modelCommitment: "1db180e1170e617297f9d005a3ad1c8555e23eada0e7d6cb47ca773e65b9fa9c",
    envPrefix: "VOXCPM2",
  }),
  indicf5: Object.freeze({
    id: "indicf5",
    label: "AI4Bharat IndicF5",
    required: false,
    languages: Object.freeze(["hi"]),
    model: "ai4bharat-indicf5",
    modelRevision: "ba85abedf18dc479a447eaa0eccbd76ab78a47d5",
    modelCommitment: "58394168701f51bd8b509470fe62f5db08cc5ded42b193ce4c08154db42795fa",
    envPrefix: "INDICF5",
  }),
  zonos2: Object.freeze({
    id: "zonos2",
    label: "ZONOS2",
    required: false,
    languages: Object.freeze(["en", "hi"]),
    model: "zonos2",
    modelRevision: "65f1e80f94b599d474bb6af9094a803dc52f60bd",
    envPrefix: "ZONOS2",
  }),
});

const SHA_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function decodeSecret(raw) {
  let bytes;
  try {
    bytes = /^[0-9a-f]{64,}$/i.test(String(raw || ""))
      ? Buffer.from(String(raw), "hex")
      : Buffer.from(String(raw || ""), "base64url");
  } catch {
    throw new Error("matched_pack_hmac_secret_invalid");
  }
  if (bytes.length < 32) throw new Error("matched_pack_hmac_secret_required");
  return bytes;
}

export function transportSignature(secret, ...parts) {
  return createHmac("sha256", secret).update(parts.join("\n")).digest("base64url");
}

export function signaturesEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}

export function cropReference(sourceWav, window = REFERENCE_WINDOW) {
  const parsed = parseWav(sourceWav);
  const start = Math.round((window.startMs / 1000) * SAMPLE_RATE);
  const count = Math.round((window.durationMs / 1000) * SAMPLE_RATE);
  if (window.startMs < 0 || window.durationMs < 6_000 || window.durationMs > 12_000 || start + count > parsed.samples) {
    throw new Error("matched_pack_reference_window_invalid");
  }
  return wrapWav(parsed.pcm.subarray(start * 2, (start + count) * 2));
}

function assertPromptContract() {
  if (!/[A-Za-z]/.test(FROZEN_PROMPTS.en.body) || /[\u0900-\u097f]/u.test(FROZEN_PROMPTS.en.body)) {
    throw new Error("matched_pack_english_prompt_invalid");
  }
  if (!/[\u0900-\u097f]/u.test(FROZEN_PROMPTS.hi.body) || /[A-Za-z]/.test(FROZEN_PROMPTS.hi.body)) {
    throw new Error("matched_pack_hindi_prompt_invalid");
  }
}

function validateArmIds(ids) {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length || unique.some((id) => !ARM_SPECS[id])) throw new Error("matched_pack_arm_selection_invalid");
  for (const spec of Object.values(ARM_SPECS).filter((item) => item.required)) {
    if (!unique.includes(spec.id)) throw new Error("matched_pack_required_arm_missing");
  }
  return unique;
}

export function buildPlan({
  sourceWav,
  referenceWav,
  referenceText,
  referenceTextEvidenceScope,
  consentReceiptSha256,
  replicaId,
  armIds = ["chatterbox", "qwen", "voxcpm2"],
  indicf5Variant = INDICF5_VARIANTS.PRONUNCIATION_NORMALIZED,
}) {
  assertPromptContract();
  const selected = validateArmIds(armIds);
  if (!Object.values(INDICF5_VARIANTS).includes(indicf5Variant)) throw new Error("matched_pack_indicf5_variant_invalid");
  const source = parseWav(sourceWav);
  const reference = parseWav(referenceWav);
  if (source.sampleRate !== SAMPLE_RATE || reference.durationMs !== REFERENCE_WINDOW.durationMs) throw new Error("matched_pack_reference_geometry_invalid");
  if (!String(referenceText || "").trim() || !["human_reviewed_exact", "asr_unreviewed"].includes(referenceTextEvidenceScope)) {
    throw new Error("matched_pack_reference_text_evidence_invalid");
  }
  if (!SHA_RE.test(String(consentReceiptSha256 || ""))) throw new Error("matched_pack_consent_receipt_invalid");
  if (!UUID_RE.test(String(replicaId || ""))) throw new Error("matched_pack_replica_id_invalid");
  const sourceSha256 = sha256(sourceWav);
  const referenceSha256 = sha256(referenceWav);
  const referenceTextSha256 = sha256(Buffer.from(referenceText));
  const promptRecords = Object.fromEntries(Object.entries(FROZEN_PROMPTS).map(([languageId, prompt]) => {
    const disclosure = DISCLOSURES[languageId];
    const fullText = `${disclosure} ${prompt.body}`;
    return [languageId, Object.freeze({
      ...prompt,
      languageId,
      disclosure,
      disclosureSha256: sha256(disclosure),
      bodySha256: sha256(prompt.body),
      fullText,
      fullTextSha256: sha256(fullText),
    })];
  }));
  const items = selected.flatMap((armId) => ARM_SPECS[armId].languages.map((languageId) => {
    const prompt = promptRecords[languageId];
    const evaluationVariant = armId === "indicf5" ? indicf5Variant : "default";
    return Object.freeze({
      id: sha256(`${MATCHED_PACK_CONTRACT}\n${armId}\n${evaluationVariant}\n${languageId}\n${prompt.fullTextSha256}`).slice(0, 24),
      armId,
      evaluationVariant,
      languageId,
      seed: SEED,
      promptId: prompt.id,
      bodySha256: prompt.bodySha256,
      disclosureSha256: prompt.disclosureSha256,
      fullTextSha256: prompt.fullTextSha256,
      referenceSha256,
      referenceTextSha256,
      consentReceiptSha256,
      expectedModel: ARM_SPECS[armId].model,
      expectedModelRevision: ARM_SPECS[armId].modelRevision,
      expectedModelCommitment: ARM_SPECS[armId].modelCommitment || "required_at_run",
      attemptReservationUsd: ATTEMPT_RESERVATION_USD,
    });
  }));
  const projectedAttemptReservationUsd = items.length * ATTEMPT_RESERVATION_USD;
  if (projectedAttemptReservationUsd > CLOUD_HARD_STOP_USD) throw new Error("matched_pack_cloud_hard_stop_exceeded");
  return Object.freeze({
    contract: MATCHED_PACK_CONTRACT,
    status: "planned_no_cloud_calls",
    seed: SEED,
    cloudHardStopUsd: CLOUD_HARD_STOP_USD,
    attemptReservationUsd: ATTEMPT_RESERVATION_USD,
    projectedAttemptReservationUsd,
    reference: Object.freeze({
      sourceSha256,
      sha256: referenceSha256,
      windowStartMs: REFERENCE_WINDOW.startMs,
      windowEndMs: REFERENCE_WINDOW.startMs + REFERENCE_WINDOW.durationMs,
      durationMs: reference.durationMs,
      sampleRate: reference.sampleRate,
      channels: reference.channels,
      bitsPerSample: reference.bitsPerSample,
      textSha256: referenceTextSha256,
      textEvidenceScope: referenceTextEvidenceScope,
    }),
    consentReceiptSha256,
    replicaId,
    prompts: Object.freeze(promptRecords),
    arms: Object.freeze(selected.map((id) => Object.freeze({
      ...ARM_SPECS[id],
      ...(id === "indicf5" ? {
        evaluationVariant: indicf5Variant,
        label: `${ARM_SPECS[id].label} (${indicf5Variant === INDICF5_VARIANTS.UNNORMALIZED_BASELINE ? "unnormalized baseline" : "pronunciation normalized"})`,
      } : { evaluationVariant: "default" }),
    }))),
    items: Object.freeze(items),
    comparisonCells: Object.freeze(Object.keys(promptRecords).map((languageId) => Object.freeze({
      languageId,
      bodySha256: promptRecords[languageId].bodySha256,
      fullTextSha256: promptRecords[languageId].fullTextSha256,
      armIds: Object.freeze(items.filter((item) => item.languageId === languageId).map((item) => item.armId)),
    }))),
  });
}

function chatterboxPayload(item, prompt, common) {
  const textPlanSha256 = sha256(canonical({
    contract: "vyakti-hindi-text-frontend/v1",
    languageId: item.languageId,
    disclosure: prompt.disclosure,
    body: prompt.body,
  }));
  return {
    ...common,
    model_arm: "general",
    text_frontend_contract: "vyakti-hindi-text-frontend/v1",
    text_plan_sha256: textPlanSha256,
    text_segment_index: 0,
    text_segment_count: 1,
    text_segment_semantic_indexes: [0],
    disclosure_text: prompt.disclosure,
    disclosure_language_id: item.languageId,
    conditioning_contract: "vyakti-voice-language-conditioning/v1",
    reference_language_mode: "latin_only",
    reference_language_evidence_scope: "unverified",
    text_language_mode: item.languageId === "hi" ? "devanagari" : "latin_only",
    requested_cfg_weight: 0.5,
    cfg_weight: item.languageId === "hi" ? 0 : 0.5,
    exaggeration: 0.5,
    temperature: 0.8,
  };
}

export function payloadForItem({ plan, item, referenceWav, referenceText, requestId, generationId }) {
  const prompt = plan.prompts[item.languageId];
  if (!prompt || sha256(referenceWav) !== plan.reference.sha256 || sha256(Buffer.from(referenceText)) !== plan.reference.textSha256) {
    throw new Error("matched_pack_payload_binding_invalid");
  }
  if (!UUID_RE.test(requestId) || !UUID_RE.test(generationId)) throw new Error("matched_pack_request_identity_invalid");
  const common = {
    request_id: requestId,
    generation_id: generationId,
    replica_id: plan.replicaId,
    language_id: item.languageId,
    text: prompt.fullText,
    reference_audio_base64: referenceWav.toString("base64"),
    reference_sha256: plan.reference.sha256,
    reference_source_sha256: plan.reference.sourceSha256,
    reference_window_start_ms: plan.reference.windowStartMs,
    reference_window_end_ms: plan.reference.windowEndMs,
    consent_receipt_sha256: plan.consentReceiptSha256,
    evaluation_scope: "verified_owner_identity",
    identity_scope: "verified_owner_self",
    release_eligible: true,
    seed: plan.seed,
  };
  if (item.armId === "chatterbox") return chatterboxPayload(item, prompt, common);
  if (item.armId === "qwen") return {
    ...common,
    reference_text: referenceText,
    reference_text_sha256: plan.reference.textSha256,
  };
  if (item.armId === "indicf5") return {
    ...common,
    ...(item.evaluationVariant === INDICF5_VARIANTS.PRONUNCIATION_NORMALIZED ? {
      text_sha256: item.fullTextSha256,
      pronunciation_normalization: INDICF5_PRONUNCIATION_NORMALIZATION,
    } : {}),
    reference_text: referenceText,
    reference_text_sha256: plan.reference.textSha256,
  };
  if (item.armId === "voxcpm2") return {
    ...common,
    clone_mode: "ultimate",
    reference_text: referenceText,
    reference_text_sha256: plan.reference.textSha256,
  };
  if (item.armId === "zonos2") return { ...common, clone_mode: "accurate_speaker_embedding" };
  throw new Error("matched_pack_arm_adapter_missing");
}

function exactOrFail(value, expected, code) {
  if (value !== expected) throw new Error(code);
}

function verifyIndicF5NormalizationReceipt({ payload, item, receipt }) {
  if (!receipt || receipt.contract !== INDICF5_PRONUNCIATION_NORMALIZATION.contract ||
      receipt.domain !== INDICF5_PRONUNCIATION_NORMALIZATION.domain ||
      receipt.locale !== INDICF5_PRONUNCIATION_NORMALIZATION.locale ||
      receipt.source_text_sha256 !== item.fullTextSha256 ||
      !SHA_RE.test(String(receipt.synthesis_text_sha256 || "")) ||
      !SHA_RE.test(String(receipt.audit_sha256 || "")) ||
      !Array.isArray(receipt.transformations) || !Array.isArray(receipt.warnings) ||
      !Number.isInteger(receipt.transformation_count) || receipt.transformation_count < 0 ||
      receipt.transformation_count > 64 || receipt.transformation_count !== receipt.transformations.length) {
    throw new Error("matched_pack_indicf5_pronunciation_receipt_invalid");
  }
  const sourceCodepoints = [...payload.text];
  const rebuilt = [];
  let cursor = 0;
  const coverage = { chemical_symbol_units: 0, numeral_units: 0, operator_units: 0 };
  for (let index = 0; index < receipt.transformations.length; index += 1) {
    const transformation = receipt.transformations[index];
    const start = transformation?.source_start_codepoint;
    const end = transformation?.source_end_codepoint;
    if (transformation?.sequence !== index + 1 || !Number.isInteger(start) || !Number.isInteger(end) ||
        start < cursor || end <= start || end > sourceCodepoints.length) {
      throw new Error("matched_pack_indicf5_pronunciation_span_invalid");
    }
    const source = sourceCodepoints.slice(start, end).join("");
    const synthesis = String(transformation.synthesis_text || "");
    if (!source || !synthesis || transformation.source_text !== source ||
        transformation.source_sha256 !== sha256(source) ||
        transformation.synthesis_sha256 !== sha256(synthesis)) {
      throw new Error("matched_pack_indicf5_pronunciation_transform_invalid");
    }
    const covered = transformation.covered_units;
    if (!covered || ![covered.chemical_symbols, covered.numerals, covered.operators]
      .every((value) => Number.isInteger(value) && value >= 0)) {
      throw new Error("matched_pack_indicf5_pronunciation_coverage_invalid");
    }
    coverage.chemical_symbol_units += covered.chemical_symbols;
    coverage.numeral_units += covered.numerals;
    coverage.operator_units += covered.operators;
    rebuilt.push(sourceCodepoints.slice(cursor, start).join(""), synthesis);
    cursor = end;
  }
  rebuilt.push(sourceCodepoints.slice(cursor).join(""));
  const synthesisText = rebuilt.join("");
  if (receipt.synthesis_text_sha256 !== sha256(synthesisText) ||
      receipt.changed !== (payload.text !== synthesisText) ||
      canonical(receipt.coverage) !== canonical(coverage)) {
    throw new Error("matched_pack_indicf5_pronunciation_binding_invalid");
  }
  const core = {
    contract: receipt.contract,
    domain: receipt.domain,
    locale: receipt.locale,
    source_text: payload.text,
    source_sha256: receipt.source_text_sha256,
    synthesis_text: synthesisText,
    synthesis_sha256: receipt.synthesis_text_sha256,
    changed: receipt.changed,
    transformation_count: receipt.transformation_count,
    transformations: receipt.transformations,
    coverage: receipt.coverage,
    warnings: receipt.warnings,
  };
  if (receipt.audit_sha256 !== sha256(canonical(core))) {
    throw new Error("matched_pack_indicf5_pronunciation_audit_invalid");
  }
  // The cross-provider cell is exact-text. A future prompt that needs a
  // pronunciation rewrite must get a separately labelled comparison cell.
  if (synthesisText !== payload.text || receipt.transformation_count !== 0) {
    throw new Error("matched_pack_indicf5_pronunciation_changes_exact_text");
  }
  return Object.freeze({
    contract: receipt.contract,
    auditSha256: receipt.audit_sha256,
    sourceTextSha256: receipt.source_text_sha256,
    synthesisTextSha256: receipt.synthesis_text_sha256,
    transformationCount: receipt.transformation_count,
    coverage: Object.freeze({ ...receipt.coverage }),
  });
}

export function verifyProviderResult({ plan, item, payload, result, responseSignatureVerified, expectedModelCommitment }) {
  if (responseSignatureVerified !== true) throw new Error("matched_pack_response_hmac_invalid");
  if (!SHA_RE.test(expectedModelCommitment || "")) throw new Error("matched_pack_expected_model_commitment_required");
  const prompt = plan.prompts[item.languageId];
  exactOrFail(payload.text, prompt.fullText, "matched_pack_result_text_request_drift");
  exactOrFail(sha256(payload.text), item.fullTextSha256, "matched_pack_result_text_hash_drift");
  exactOrFail(payload.seed, plan.seed, "matched_pack_result_seed_drift");
  exactOrFail(payload.reference_sha256, plan.reference.sha256, "matched_pack_result_reference_request_drift");
  exactOrFail(payload.consent_receipt_sha256, plan.consentReceiptSha256, "matched_pack_result_consent_request_drift");
  exactOrFail(result.request_id, payload.request_id, "matched_pack_result_request_drift");
  exactOrFail(result.reference_sha256, plan.reference.sha256, "matched_pack_result_reference_drift");
  exactOrFail(result.model, item.expectedModel, "matched_pack_result_model_drift");
  exactOrFail(result.model_commitment, expectedModelCommitment, "matched_pack_result_model_commitment_drift");
  let pronunciationNormalization = null;
  if (item.armId === "indicf5" && item.evaluationVariant === INDICF5_VARIANTS.PRONUNCIATION_NORMALIZED) {
    exactOrFail(payload.text_sha256, item.fullTextSha256, "matched_pack_indicf5_source_text_request_drift");
    if (!payload.pronunciation_normalization ||
        canonical(payload.pronunciation_normalization) !== canonical(INDICF5_PRONUNCIATION_NORMALIZATION)) {
      throw new Error("matched_pack_indicf5_pronunciation_request_drift");
    }
    exactOrFail(result.text_sha256, item.fullTextSha256, "matched_pack_indicf5_source_text_result_drift");
    pronunciationNormalization = verifyIndicF5NormalizationReceipt({
      payload,
      item,
      receipt: result.pronunciation_normalization_receipt,
    });
  } else if (item.armId === "indicf5") {
    if (item.evaluationVariant !== INDICF5_VARIANTS.UNNORMALIZED_BASELINE ||
        payload.text_sha256 !== undefined || payload.pronunciation_normalization !== undefined ||
        result.pronunciation_normalization_receipt !== undefined) {
      throw new Error("matched_pack_indicf5_baseline_variant_drift");
    }
  }
  if (item.armId !== "chatterbox") {
    exactOrFail(result.model_revision, item.expectedModelRevision, "matched_pack_result_model_revision_drift");
    exactOrFail(result.generation_id, payload.generation_id, "matched_pack_result_generation_drift");
    exactOrFail(result.consent_receipt_sha256, plan.consentReceiptSha256, "matched_pack_result_consent_drift");
    if (result.language_id !== undefined) exactOrFail(result.language_id, item.languageId, "matched_pack_result_language_drift");
    if (result.text_sha256 !== undefined) exactOrFail(result.text_sha256, item.fullTextSha256, "matched_pack_result_text_drift");
    if (result.generation_parameters?.seed !== undefined) exactOrFail(result.generation_parameters.seed, plan.seed, "matched_pack_result_seed_receipt_drift");
  } else {
    exactOrFail(result.disclosure_text, prompt.disclosure, "matched_pack_result_disclosure_drift");
    exactOrFail(result.disclosure_language_id, item.languageId, "matched_pack_result_disclosure_language_drift");
  }
  if (result.sample_rate !== SAMPLE_RATE || result.channels !== 1 || result.encoding !== "pcm_s16le") {
    throw new Error("matched_pack_result_geometry_invalid");
  }
  if (result.perth_watermark_verified !== true || !Number.isFinite(Number(result.perth_score)) || Number(result.perth_score) < 0.5) {
    throw new Error("matched_pack_result_perth_invalid");
  }
  const pcm = Buffer.from(String(result.audio_base64 || ""), "base64");
  if (!pcm.length || pcm.length % 2 !== 0 || sha256(pcm) !== result.output_sha256) throw new Error("matched_pack_result_output_invalid");
  const wav = wrapWav(pcm);
  return Object.freeze({
    contract: MATCHED_PACK_CONTRACT,
    itemId: item.id,
    armId: item.armId,
    evaluationVariant: item.evaluationVariant || "default",
    languageId: item.languageId,
    seed: plan.seed,
    requestId: payload.request_id,
    generationId: payload.generation_id,
    bodySha256: item.bodySha256,
    disclosureSha256: item.disclosureSha256,
    fullTextSha256: item.fullTextSha256,
    sourceSha256: plan.reference.sourceSha256,
    referenceSha256: plan.reference.sha256,
    referenceTextSha256: plan.reference.textSha256,
    referenceTextEvidenceScope: plan.reference.textEvidenceScope,
    consentReceiptSha256: plan.consentReceiptSha256,
    model: result.model,
    modelRevision: result.model_revision || item.expectedModelRevision,
    modelCommitment: result.model_commitment,
    outputPcmSha256: result.output_sha256,
    outputWavSha256: sha256(wav),
    sampleRate: result.sample_rate,
    channels: result.channels,
    encoding: result.encoding,
    durationMs: Number(result.duration_ms),
    perthWatermarkVerified: true,
    perthScore: Number(result.perth_score),
    responseHmacVerified: true,
    elapsedMs: Number(result.elapsed_ms),
    pronunciationNormalization,
    realTimeFactor: Number(result.real_time_factor),
    wav,
  });
}

export function reserveAttempt(ledger, itemId, limitUsd = CLOUD_HARD_STOP_USD) {
  if (!Number.isFinite(limitUsd) || limitUsd <= 0 || limitUsd > CLOUD_HARD_STOP_USD) throw new Error("matched_pack_cloud_limit_invalid");
  const prior = Array.isArray(ledger?.attempts) ? ledger.attempts : [];
  const reservedUsd = prior.reduce((sum, attempt) => sum + Number(attempt.reservedUsd || 0), 0);
  if (reservedUsd + ATTEMPT_RESERVATION_USD > limitUsd + 1e-9) throw new Error("matched_pack_cloud_hard_stop_exceeded");
  return Object.freeze({
    contract: MATCHED_PACK_CONTRACT,
    hardStopUsd: limitUsd,
    attempts: Object.freeze([...prior, Object.freeze({ itemId, reservedUsd: ATTEMPT_RESERVATION_USD, state: "reserved" })]),
  });
}
