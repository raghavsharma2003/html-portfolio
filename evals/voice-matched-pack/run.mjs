import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants as cryptoConstants, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  ARM_SPECS,
  CLOUD_HARD_STOP_USD,
  DISCLOSURES,
  FROZEN_PROMPTS,
  INDICF5_PRONUNCIATION_NORMALIZATION,
  INDICF5_VARIANTS,
  MATCHED_PACK_CONTRACT,
  PROTECTION_PATHS,
  SCORE_AXES,
  SEED,
  TRANSPORTS,
  VENDOR_CHARACTER_HARD_STOP,
  buildPlan,
  canonical,
  cropReference,
  isVendorArm,
  payloadForItem,
  reserveAttempt,
  reserveVendorCharacters,
  sha256,
  transportSignature,
  verifyProviderResult,
  verifyVendorResult,
} from "./contract.mjs";
import {
  exportStudioBundle,
  importStudioAnswerSheet,
  pathsFor,
  prepareHome,
  saveResult,
  sealHome,
  unsealHome,
  verifySealedHome,
} from "./pack.mjs";
import { wrapWav } from "../voice-listening-benchmark/lib.mjs";

let checks = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

function rejects(name, action, code) {
  assert.throws(action, (error) => error?.message === code || error?.message?.startsWith(`${code}:`), name);
  console.log(`ok ${++checks} - ${name}`);
}

function sineWav(durationMs, frequency = 220, amplitude = 0.08) {
  const samples = Math.round(durationMs * 24_000 / 1000);
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.sin(2 * Math.PI * frequency * index / 24_000) * amplitude;
    pcm.writeInt16LE(Math.round(value * 32767), index * 2);
  }
  return wrapWav(pcm);
}

const sourceWav = sineWav(13_000);
const referenceWav = cropReference(sourceWav);
const referenceText = "This is an unreviewed reference transcript hypothesis for the owner voice sample.";
const consentReceiptSha256 = "c".repeat(64);
const replicaId = "6aff3202-abbd-4ca6-976b-4009ed5af028";
const basePlan = buildPlan({
  sourceWav,
  referenceWav,
  referenceText,
  referenceTextEvidenceScope: "asr_unreviewed",
  consentReceiptSha256,
  replicaId,
});

ok("contract is versioned and budget is bounded", MATCHED_PACK_CONTRACT.endsWith("/v1") && CLOUD_HARD_STOP_USD === 5);
ok("one frozen English and one frozen Devanagari Hindi text exist", /[A-Za-z]/.test(FROZEN_PROMPTS.en.body) && !/[\u0900-\u097f]/u.test(FROZEN_PROMPTS.en.body)
  && /[\u0900-\u097f]/u.test(FROZEN_PROMPTS.hi.body) && !/[A-Za-z]/.test(FROZEN_PROMPTS.hi.body));
ok("localized disclosures have the same explicit semantic role", DISCLOSURES.en.includes("AI-generated voice replica") && DISCLOSURES.hi.includes("एआई") && DISCLOSURES.hi.includes("प्रतिकृति"));
ok("base plan has five requests and two exact-text cells", basePlan.items.length === 5 && basePlan.comparisonCells.length === 2);
ok("Qwen is English-only while Hindi still has two providers", basePlan.items.filter((item) => item.armId === "qwen").every((item) => item.languageId === "en")
  && basePlan.comparisonCells.find((cell) => cell.languageId === "hi").armIds.length === 2);
ok("all base requests bind one seed, reference, transcript and consent receipt", new Set(basePlan.items.map((item) => item.seed)).size === 1
  && basePlan.seed === SEED
  && new Set(basePlan.items.map((item) => item.referenceSha256)).size === 1
  && new Set(basePlan.items.map((item) => item.referenceTextSha256)).size === 1
  && new Set(basePlan.items.map((item) => item.consentReceiptSha256)).size === 1);
ok("all providers in a language share exact body, disclosure and full-text hashes", basePlan.comparisonCells.every((cell) => {
  const rows = basePlan.items.filter((item) => item.languageId === cell.languageId);
  return new Set(rows.map((item) => item.bodySha256)).size === 1
    && new Set(rows.map((item) => item.disclosureSha256)).size === 1
    && new Set(rows.map((item) => item.fullTextSha256)).size === 1;
}));
ok("optional IndicF5 and ZONOS2 adapters expand the same two cells", (() => {
  const value = buildPlan({ sourceWav, referenceWav, referenceText, referenceTextEvidenceScope: "asr_unreviewed", consentReceiptSha256, replicaId,
    armIds: ["chatterbox", "qwen", "voxcpm2", "indicf5", "zonos2"] });
  return value.items.length === 8 && value.comparisonCells.find((cell) => cell.languageId === "en").armIds.length === 4
    && value.comparisonCells.find((cell) => cell.languageId === "hi").armIds.length === 4
    && value.projectedAttemptReservationUsd === 4;
})());
ok("deployed four-arm pack prebinds every available runtime model manifest", ["chatterbox", "qwen", "voxcpm2", "indicf5"]
  .every((armId) => /^[0-9a-f]{64}$/.test(ARM_SPECS[armId].modelCommitment))
  && ARM_SPECS.zonos2.modelCommitment === undefined);
rejects("a required base arm cannot be silently omitted", () => buildPlan({ sourceWav, referenceWav, referenceText,
  referenceTextEvidenceScope: "asr_unreviewed", consentReceiptSha256, replicaId, armIds: ["chatterbox", "qwen"] }), "matched_pack_required_arm_missing");
rejects("a non-Devanagari or absent evidence shape cannot enter planning", () => buildPlan({ sourceWav, referenceWav, referenceText: "",
  referenceTextEvidenceScope: "asr_unreviewed", consentReceiptSha256, replicaId }), "matched_pack_reference_text_evidence_invalid");

function ids(index) {
  return {
    requestId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    generationId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  };
}

function unchangedIndicF5NormalizationReceipt(text) {
  const textSha256 = sha256(text);
  const coverage = { chemical_symbol_units: 0, numeral_units: 0, operator_units: 0 };
  const core = {
    contract: INDICF5_PRONUNCIATION_NORMALIZATION.contract,
    domain: INDICF5_PRONUNCIATION_NORMALIZATION.domain,
    locale: INDICF5_PRONUNCIATION_NORMALIZATION.locale,
    source_text: text,
    source_sha256: textSha256,
    synthesis_text: text,
    synthesis_sha256: textSha256,
    changed: false,
    transformation_count: 0,
    transformations: [],
    coverage,
    warnings: [],
  };
  return {
    contract: core.contract,
    domain: core.domain,
    locale: core.locale,
    source_text_sha256: core.source_sha256,
    synthesis_text_sha256: core.synthesis_sha256,
    changed: false,
    transformation_count: 0,
    transformations: [],
    coverage,
    warnings: [],
    audit_sha256: sha256(canonical(core)),
  };
}

function fakeResult(item, payload, index) {
  const pcm = sineWav(2_000 + index * 100, 240 + index * 25).subarray(44);
  const result = {
    request_id: payload.request_id,
    generation_id: payload.generation_id,
    replica_id: payload.replica_id,
    audio_base64: pcm.toString("base64"),
    output_sha256: sha256(pcm),
    sample_rate: 24_000,
    channels: 1,
    encoding: "pcm_s16le",
    duration_ms: pcm.length / 2 / 24,
    elapsed_ms: 1_000 + index,
    real_time_factor: 0.5,
    model: item.expectedModel,
    model_revision: item.expectedModelRevision,
    model_commitment: item.expectedModelCommitment === "required_at_run" ? sha256(`model:${item.armId}`) : item.expectedModelCommitment,
    reference_sha256: basePlan.reference.sha256,
    reference_text_sha256: basePlan.reference.textSha256,
    consent_receipt_sha256: basePlan.consentReceiptSha256,
    language_id: item.languageId,
    text_sha256: item.fullTextSha256,
    generation_parameters: { seed: basePlan.seed },
    perth_watermark_verified: true,
    perth_score: 0.91,
  };
  if (item.armId === "chatterbox") {
    delete result.generation_id;
    delete result.consent_receipt_sha256;
    delete result.language_id;
    delete result.text_sha256;
    result.text_frontend_contract = payload.text_frontend_contract;
    result.text_plan_sha256 = payload.text_plan_sha256;
    result.text_segment_index = payload.text_segment_index;
    result.text_segment_count = payload.text_segment_count;
    result.text_segment_semantic_indexes = payload.text_segment_semantic_indexes;
    result.disclosure_text = basePlan.prompts[item.languageId].disclosure;
    result.disclosure_language_id = item.languageId;
  }
  if (item.armId === "qwen") delete result.text_sha256;
  if (item.armId === "indicf5" && payload.pronunciation_normalization) {
    result.pronunciation_normalization_receipt = unchangedIndicF5NormalizationReceipt(payload.text);
  } else if (item.armId === "indicf5") {
    delete result.text_sha256;
  }
  return result;
}

function normalizedRow(plan, item, index) {
  const payload = payloadForItem({ plan, item, referenceWav, referenceText, ...ids(index) });
  const result = fakeResult(item, payload, index);
  const expectedModelCommitment = result.model_commitment;
  return {
    plan,
    item,
    payload,
    result,
    expectedModelCommitment,
    normalized: verifyProviderResult({ plan, item, payload, result, responseSignatureVerified: true, expectedModelCommitment }),
  };
}

const normalized = basePlan.items.map((item, index) => normalizedRow(basePlan, item, index));
ok("all five provider adapters normalize to one receipt contract", normalized.length === 5
  && normalized.every((row) => row.normalized.contract === MATCHED_PACK_CONTRACT && row.normalized.responseHmacVerified && row.normalized.perthWatermarkVerified));
ok("provider payloads carry exact full text and one seed", normalized.every(({ item, payload }) => payload.text === basePlan.prompts[item.languageId].fullText && payload.seed === SEED));
const normalizedIndicPlan = buildPlan({
  sourceWav, referenceWav, referenceText, referenceTextEvidenceScope: "asr_unreviewed", consentReceiptSha256, replicaId,
  armIds: ["chatterbox", "qwen", "voxcpm2", "indicf5"],
  indicf5Variant: INDICF5_VARIANTS.PRONUNCIATION_NORMALIZED,
});
const normalizedIndicItem = normalizedIndicPlan.items.find((item) => item.armId === "indicf5");
const indicf5Row = normalizedRow(normalizedIndicPlan, normalizedIndicItem, 20);
const baselineIndicPlan = buildPlan({
  sourceWav, referenceWav, referenceText, referenceTextEvidenceScope: "asr_unreviewed", consentReceiptSha256, replicaId,
  armIds: ["chatterbox", "qwen", "voxcpm2", "indicf5"],
  indicf5Variant: INDICF5_VARIANTS.UNNORMALIZED_BASELINE,
});
const baselineIndicItem = baselineIndicPlan.items.find((item) => item.armId === "indicf5");
const baselineIndicRow = normalizedRow(baselineIndicPlan, baselineIndicItem, 21);
const legacyBaselineIndicItem = { ...baselineIndicItem };
delete legacyBaselineIndicItem.evaluationVariant;
const legacyBaselinePayload = payloadForItem({
  plan: baselineIndicPlan,
  item: legacyBaselineIndicItem,
  referenceWav,
  referenceText,
  ...ids(22),
});
const legacyBaselineResult = fakeResult(legacyBaselineIndicItem, legacyBaselinePayload, 22);
const legacyBaselineNormalized = verifyProviderResult({
  plan: baselineIndicPlan,
  item: legacyBaselineIndicItem,
  payload: legacyBaselinePayload,
  result: legacyBaselineResult,
  responseSignatureVerified: true,
  expectedModelCommitment: legacyBaselineResult.model_commitment,
});
ok("reference-transcript models receive the same transcript bytes", [...normalized, indicf5Row, baselineIndicRow]
  .filter(({ item }) => ["qwen", "voxcpm2", "indicf5"].includes(item.armId))
  .every(({ payload, plan }) => payload.reference_text === referenceText && payload.reference_text_sha256 === plan.reference.textSha256));
ok("IndicF5 matched requests require source hashing and the bounded pronunciation contract",
  indicf5Row.payload.text_sha256 === indicf5Row.item.fullTextSha256 &&
  canonical(indicf5Row.payload.pronunciation_normalization) === canonical(INDICF5_PRONUNCIATION_NORMALIZATION) &&
  indicf5Row.normalized.pronunciationNormalization?.transformationCount === 0 &&
  indicf5Row.normalized.pronunciationNormalization?.sourceTextSha256 === indicf5Row.item.fullTextSha256 &&
  indicf5Row.normalized.pronunciationNormalization?.synthesisTextSha256 === indicf5Row.item.fullTextSha256);
ok("deployed IndicF5 r7 remains an explicitly unnormalized baseline",
  baselineIndicRow.item.evaluationVariant === INDICF5_VARIANTS.UNNORMALIZED_BASELINE &&
  baselineIndicPlan.arms.find((arm) => arm.id === "indicf5")?.label.includes("unnormalized baseline") &&
  baselineIndicRow.payload.text_sha256 === undefined &&
  baselineIndicRow.payload.pronunciation_normalization === undefined &&
  baselineIndicRow.normalized.pronunciationNormalization === null);
ok("a frozen pre-variant IndicF5 item remains the unnormalized baseline",
  legacyBaselinePayload.pronunciation_normalization === undefined &&
  legacyBaselineNormalized.evaluationVariant === INDICF5_VARIANTS.UNNORMALIZED_BASELINE &&
  legacyBaselineNormalized.pronunciationNormalization === null);
const indicContractPython = String.raw`
import json, sys
sys.path.insert(0, r"services/indicf5-runtime")
from contract import validate_payload
value = validate_payload(json.load(sys.stdin))
assert value["text_sha256"]
assert value["pronunciation_normalization"]["mode"] == "required"
print("indicf5-matched-contract-pass")
`;
const indicContract = spawnSync("python", ["-c", indicContractPython], {
  cwd: resolve("."),
  input: JSON.stringify(indicf5Row.payload),
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
  env: { ...process.env, PYTHONUTF8: "1" },
});
ok("the real IndicF5 Python contract accepts the matched provider payload",
  indicContract.status === 0 && indicContract.stdout.includes("indicf5-matched-contract-pass"));
ok("HMAC signing is deterministic and content-sensitive", (() => {
  const secret = Buffer.alloc(32, 7);
  const first = transportSignature(secret, "a", "b");
  return first === transportSignature(secret, "a", "b") && first !== transportSignature(secret, "a", "c");
})());

const first = normalized[0];
rejects("a missing response HMAC fails closed", () => verifyProviderResult({ ...first, responseSignatureVerified: false }), "matched_pack_response_hmac_invalid");
rejects("a model commitment mismatch fails closed", () => verifyProviderResult({ ...first, responseSignatureVerified: true, expectedModelCommitment: "0".repeat(64) }), "matched_pack_result_model_commitment_drift");
const firstRevisionBound = normalized.find((row) => row.item.armId !== "chatterbox");
rejects("a provider model revision mismatch fails closed", () => verifyProviderResult({ ...firstRevisionBound, responseSignatureVerified: true,
  result: { ...firstRevisionBound.result, model_revision: "0".repeat(40) } }), "matched_pack_result_model_revision_drift");
rejects("a response request id mismatch fails closed", () => verifyProviderResult({ ...first, responseSignatureVerified: true,
  result: { ...first.result, request_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" } }), "matched_pack_result_request_drift");
rejects("a Chatterbox response without text-plan disclosure fields fails closed", () => verifyProviderResult({
  ...first,
  responseSignatureVerified: true,
  result: { ...first.result, disclosure_text: undefined, disclosure_language_id: undefined },
}), "matched_pack_result_disclosure_drift");
rejects("a Chatterbox response with a changed text-plan receipt fails closed", () => verifyProviderResult({
  ...first,
  responseSignatureVerified: true,
  result: { ...first.result, text_plan_sha256: "0".repeat(64) },
}), "matched_pack_result_text_plan_drift");
rejects("a reference mismatch fails closed", () => verifyProviderResult({ ...first, responseSignatureVerified: true,
  result: { ...first.result, reference_sha256: "0".repeat(64) } }), "matched_pack_result_reference_drift");
rejects("a seed mismatch fails before accepting a provider receipt", () => verifyProviderResult({ ...first, responseSignatureVerified: true,
  payload: { ...first.payload, seed: SEED + 1 } }), "matched_pack_result_seed_drift");
rejects("a consent mismatch fails before accepting a provider receipt", () => verifyProviderResult({ ...first, responseSignatureVerified: true,
  payload: { ...first.payload, consent_receipt_sha256: "0".repeat(64) } }), "matched_pack_result_consent_request_drift");
rejects("a PerTh failure fails closed", () => verifyProviderResult({ ...first, responseSignatureVerified: true,
  result: { ...first.result, perth_watermark_verified: false } }), "matched_pack_result_perth_invalid");
rejects("a non-24 kHz output fails closed", () => verifyProviderResult({ ...first, responseSignatureVerified: true,
  result: { ...first.result, sample_rate: 48_000 } }), "matched_pack_result_geometry_invalid");
rejects("an output hash mismatch fails closed", () => verifyProviderResult({ ...first, responseSignatureVerified: true,
  result: { ...first.result, output_sha256: "0".repeat(64) } }), "matched_pack_result_output_invalid");
rejects("a missing IndicF5 pronunciation request contract fails closed", () => verifyProviderResult({
  ...indicf5Row,
  responseSignatureVerified: true,
  payload: { ...indicf5Row.payload, pronunciation_normalization: undefined },
}), "matched_pack_indicf5_pronunciation_request_drift");
rejects("a tampered IndicF5 pronunciation audit fails closed", () => verifyProviderResult({
  ...indicf5Row,
  responseSignatureVerified: true,
  result: {
    ...indicf5Row.result,
    pronunciation_normalization_receipt: {
      ...indicf5Row.result.pronunciation_normalization_receipt,
      audit_sha256: "0".repeat(64),
    },
  },
}), "matched_pack_indicf5_pronunciation_audit_invalid");

let ledger = { contract: MATCHED_PACK_CONTRACT, hardStopUsd: CLOUD_HARD_STOP_USD, attempts: [] };
for (let index = 0; index < 10; index += 1) ledger = reserveAttempt(ledger, `item-${index}`, CLOUD_HARD_STOP_USD);
ok("ten half-dollar attempts reach exactly the five-dollar hard stop", ledger.attempts.length === 10
  && ledger.attempts.reduce((sum, item) => sum + item.reservedUsd, 0) === 5);
rejects("an eleventh attempt cannot cross the five-dollar hard stop", () => reserveAttempt(ledger, "item-11", CLOUD_HARD_STOP_USD), "matched_pack_cloud_hard_stop_exceeded");
rejects("callers cannot raise the hard stop above five dollars", () => reserveAttempt({ attempts: [] }, "item", 5.01), "matched_pack_cloud_limit_invalid");

const temp = mkdtempSync(join(tmpdir(), "vyakti-matched-pack-"));
try {
  const homeA = join(temp, "run-a");
  const homeB = join(temp, "run-b");
  for (const target of [homeA, homeB]) {
    const paths = prepareHome({ home: target, plan: basePlan, referenceWav, referenceText });
    normalized.forEach((row) => saveResult(paths, row.normalized));
  }
  const sealedA = sealHome(homeA, Buffer.alloc(32, 1));
  const sealedB = sealHome(homeB, Buffer.alloc(32, 2));
  const verifiedA = verifySealedHome(homeA);
  const verifiedB = verifySealedHome(homeB);
  ok("sealing creates two real exact-text cross-provider cells", verifiedA.cells === 2 && verifiedA.stimuli === 5 && verifiedB.cells === 2);
  ok("every served WAV has one indistinguishable wire geometry", verifiedA.commonGeometry.split(":").length === 5);
  ok("a different sealed secret changes listener ids and order", readFileSync(join(sealedA.paths.served, "trials.json"), "utf8")
    !== readFileSync(join(sealedB.paths.served, "trials.json"), "utf8"));
  ok("the served tree contains no model, arm, consent, key or receipt mapping", (() => {
    const served = `${readFileSync(join(sealedA.paths.served, "manifest.json"))}${readFileSync(join(sealedA.paths.served, "trials.json"))}`.toLowerCase();
    return !["chatterbox", "qwen", "voxcpm", "consentreceipt", "modelcommitment", "runsecret"].some((value) => served.includes(value));
  })());
  rejects("unsealing without one accepted listener fails closed", () => unsealHome(homeA), "matched_pack_no_accepted_listener");
  ok("four independent score axes plus disclosure audibility are frozen", SCORE_AXES.map((axis) => axis.id).join(",")
    === "owner_likeness,naturalness,indian_accent,pronunciation");

  const studioBundlePath = join(homeA, "reports", "studio-bundle.json");
  const studioBundleResult = exportStudioBundle(homeA, studioBundlePath);
  const studioBundle = JSON.parse(readFileSync(studioBundlePath, "utf8"));
  const secondStudioBundlePath = join(homeA, "reports", "studio-bundle-second.json");
  exportStudioBundle(homeA, secondStudioBundlePath);
  const secondStudioBundle = JSON.parse(readFileSync(secondStudioBundlePath, "utf8"));
  const studioText = JSON.stringify({ manifest: studioBundle.manifest, trials: studioBundle.trials }).toLowerCase();
  ok("the Studio bundle carries every opaque clip and no private mapping",
    studioBundleResult.stimuli === Object.keys(studioBundle.stimuli).length &&
    Object.keys(studioBundle.stimuli).every((id) => /^[0-9a-f]{24}$/.test(id)) &&
    !["chatterbox", "qwen", "voxcpm", "indicf5", "zonos", "modelcommitment", "consentreceipt", '"correct"']
      .some((value) => studioText.includes(value)));
  ok("the Studio exporter keeps its reusable private report key only in the private pack tree",
    existsSync(sealedA.paths.studioReportSigningKey) &&
    readFileSync(sealedA.paths.studioReportSigningKey, "utf8").includes("PRIVATE KEY") &&
    !readFileSync(studioBundlePath, "utf8").includes("PRIVATE KEY") &&
    studioBundle.manifest.reportAttestation.keyId === secondStudioBundle.manifest.reportAttestation.keyId &&
    studioBundle.manifest.reportAttestation.keyId === studioBundle.manifest.reportAttestation.publicKeySha256);

  const privateKey = JSON.parse(readFileSync(sealedA.paths.key, "utf8"));
  const publicTrials = JSON.parse(readFileSync(join(sealedA.paths.served, "trials.json"), "utf8"));
  const privateTrials = new Map(privateKey.sequence.map((trial) => [trial.trialId, trial]));
  const studioAnswers = Object.fromEntries(publicTrials.sequence.map((trial) => [trial.trialId, trial.kind === "rating"
    ? { owner_likeness: 3, naturalness: 3, indian_accent: 3, pronunciation: 3, disclosure: "full", note: "" }
    : { choice: privateTrials.get(trial.trialId).correct }]));
  const studioSheetPath = join(homeA, "reports", "owner-studio-ratings.json");
  writeFileSync(studioSheetPath, JSON.stringify({
    contract: MATCHED_PACK_CONTRACT,
    runId: sealedA.paths.runId,
    listener: "owner-studio",
    startedAt: "2026-08-28T00:00:00.000Z",
    finishedAt: "2026-08-28T00:05:00.000Z",
    complete: true,
    answers: studioAnswers,
  }));
  const imported = importStudioAnswerSheet(homeA, studioSheetPath);
  ok("an attentive complete Studio sheet imports into the private answer lane", imported.accepted && imported.listener === "owner-studio");
  const studioUnsealed = unsealHome(homeA);
  ok("the accepted sheet unlocks a report bound to the original seal without promoting a winner",
    studioUnsealed.sealedKeySha256 === studioBundle.manifest.sealedKeySha256 &&
    studioUnsealed.overallWinner === null && studioUnsealed.cells.every((cell) => cell.winnerClaim === null));
  const { attestation, ...signedBody } = studioUnsealed;
  const verificationKey = createPublicKey({
    key: Buffer.from(studioBundle.manifest.reportAttestation.publicKeySpkiBase64, "base64"),
    format: "der",
    type: "spki",
  });
  const signature = Buffer.from(attestation.signatureBase64, "base64");
  const verifies = (body, key = verificationKey, candidate = signature) => cryptoVerify("sha256", Buffer.from(canonical(body)), {
    key,
    padding: cryptoConstants.RSA_PKCS1_PADDING,
  }, candidate);
  ok("the unsealed Studio report carries a valid private-pack signature", verifies(signedBody)
    && attestation.keyId === studioBundle.manifest.reportAttestation.keyId);
  ok("a one-bit report change fails the asymmetric attestation", !verifies({ ...signedBody, acceptedListeners: signedBody.acceptedListeners + 1 }));
  const studioBundleBPath = join(homeB, "reports", "studio-bundle.json");
  exportStudioBundle(homeB, studioBundleBPath);
  const studioBundleB = JSON.parse(readFileSync(studioBundleBPath, "utf8"));
  const wrongKey = createPublicKey({ key: Buffer.from(studioBundleB.manifest.reportAttestation.publicKeySpkiBase64, "base64"), format: "der", type: "spki" });
  ok("a different private pack public key cannot verify the report", !verifies(signedBody, wrongKey));
  ok("the unsealed report never carries private signing material", !JSON.stringify(studioUnsealed).includes("PRIVATE KEY")
    && typeof studioUnsealed.attestation?.signatureBase64 === "string");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

// ── vendor arms in the pack ──────────────────────────────────────────────────
// The arms that make `decisions.md#platform-north-star`'s reversal condition
// testable. Everything here is offline: no key, no vendor, no money.
const vendorPlan = buildPlan({
  sourceWav, referenceWav, referenceText, referenceTextEvidenceScope: "asr_unreviewed",
  consentReceiptSha256, replicaId,
  armIds: ["chatterbox", "qwen", "voxcpm2", "elevenlabs", "sarvam"],
});
ok("vendor arms join the same two exact-text cells without changing them",
  vendorPlan.comparisonCells.length === 2 &&
  vendorPlan.comparisonCells.every((cell) => cell.bodySha256 === basePlan.comparisonCells.find((base) => base.languageId === cell.languageId).bodySha256) &&
  vendorPlan.comparisonCells.find((cell) => cell.languageId === "hi").armIds.length === 4);
ok("a vendor item is labelled with its transport, protection path and whether it clones anyone",
  vendorPlan.items.filter((item) => isVendorArm(item.armId)).every((item) =>
    item.transport === TRANSPORTS.VENDOR_API && item.protectionPath === PROTECTION_PATHS.DELIVERY_AUDIOSEAL) &&
  vendorPlan.items.find((item) => item.armId === "sarvam").clonesTheOwner === false &&
  vendorPlan.items.find((item) => item.armId === "elevenlabs").clonesTheOwner === true);
ok("the self-hosted arms keep the transport and watermark they always had",
  vendorPlan.items.filter((item) => !isVendorArm(item.armId)).every((item) =>
    item.transport === TRANSPORTS.SIGNED_RUNTIME && item.protectionPath === PROTECTION_PATHS.RUNTIME_PERTH && item.billableCharacters === 0));
ok("the plan prices the vendor characters from list prices read on a stated date",
  vendorPlan.projectedVendorCharacters > 0 &&
  vendorPlan.projectedVendorCharacters === vendorPlan.items.reduce((sum, item) => sum + item.billableCharacters, 0) &&
  vendorPlan.projectedVendorCostUsd > 0 && vendorPlan.projectedVendorCostUsd < 0.2 &&
  vendorPlan.vendorListPricesUsdPerMillionCharacters.elevenlabs === 180);

function vendorRow(plan, item, index) {
  const spec = ARM_SPECS[item.armId];
  const payload = payloadForItem({ plan, item, referenceWav, referenceText, ...ids(index) });
  const pcm = sineWav(2_600 + index * 90, 200 + index * 21).subarray(44);
  const result = {
    request_id: payload.request_id,
    generation_id: payload.generation_id,
    model: spec.model,
    model_revision: spec.modelRevision,
    model_commitment: sha256(`vendor:${item.armId}`),
    language_id: item.languageId,
    seed: plan.seed,
    protection_path: spec.protectionPath,
    perth_watermark_verified: false,
    clones_the_owner: spec.clonesTheOwner === true,
    arm_category: spec.armCategory || "voice_clone",
    sample_rate: 24_000,
    channels: 1,
    encoding: "pcm_s16le",
    audio_base64: pcm.toString("base64"),
    output_sha256: sha256(pcm),
    duration_ms: pcm.length / 2 / 24,
    elapsed_ms: 900 + index,
    real_time_factor: 0.4,
    billed_characters: payload.billable_characters,
    resampled_to_24k: false,
  };
  return {
    plan, item, payload, result,
    transportProof: "tls_vendor_api",
    expectedModelCommitment: result.model_commitment,
    normalized: verifyVendorResult({
      plan, item, payload, result, transportProof: "tls_vendor_api", expectedModelCommitment: result.model_commitment,
    }),
  };
}

const vendorItems = vendorPlan.items.filter((item) => isVendorArm(item.armId));
const vendorRows = vendorItems.map((item, index) => vendorRow(vendorPlan, item, 40 + index));
ok("a vendor payload carries every cell binding and re-uploads no reference audio",
  vendorRows.every(({ payload, item }) => payload.text === vendorPlan.prompts[item.languageId].fullText &&
    payload.seed === SEED && payload.reference_sha256 === vendorPlan.reference.sha256 &&
    payload.consent_receipt_sha256 === consentReceiptSha256 &&
    payload.reference_audio_base64 === undefined));
ok("only the cloning vendor is told the reference was sent to it",
  vendorRows.find(({ item }) => item.armId === "elevenlabs").payload.reference_sent_to_vendor === true &&
  vendorRows.find(({ item }) => item.armId === "sarvam").payload.reference_sent_to_vendor === false);
ok("a verified vendor result records no HMAC and no PerTh, and says which path protects it",
  vendorRows.every(({ normalized }) => normalized.responseHmacVerified === false &&
    normalized.perthWatermarkVerified === false &&
    normalized.protectionPath === PROTECTION_PATHS.DELIVERY_AUDIOSEAL &&
    normalized.transportProof === "tls_vendor_api"));
ok("the base arm reaches the receipt labelled as a base arm",
  vendorRows.find(({ item }) => item.armId === "sarvam").normalized.armCategory === "indian_accent_base_voice" &&
  vendorRows.find(({ item }) => item.armId === "sarvam").normalized.clonesTheOwner === false);

const vendorFirst = vendorRows[0];
rejects("a vendor result that claims a PerTh watermark is refused as fabricated evidence",
  () => verifyVendorResult({ ...vendorFirst, result: { ...vendorFirst.result, perth_watermark_verified: true } }),
  "matched_pack_vendor_perth_claim_invalid");
rejects("a vendor result with no transport proof fails closed",
  () => verifyVendorResult({ ...vendorFirst, transportProof: "" }), "matched_pack_vendor_transport_invalid");
const sarvamRow = vendorRows.find(({ item }) => item.armId === "sarvam");
rejects("a base arm that reports itself as a clone is refused",
  () => verifyVendorResult({ ...sarvamRow, result: { ...sarvamRow.result, clones_the_owner: true } }),
  "matched_pack_vendor_arm_category_drift");
rejects("a vendor result that bills a different character count than the plan is refused",
  () => verifyVendorResult({ ...vendorFirst, result: { ...vendorFirst.result, billed_characters: 1 } }),
  "matched_pack_vendor_billing_drift");
rejects("a vendor arm cannot be pushed through the signed-runtime verifier",
  () => verifyProviderResult({ ...vendorFirst, responseSignatureVerified: true }),
  "matched_pack_vendor_arm_needs_vendor_verifier");
rejects("a self-hosted arm that lost its watermark is still refused",
  () => verifyProviderResult({ ...first, responseSignatureVerified: true,
    result: { ...first.result, perth_watermark_verified: false } }), "matched_pack_result_perth_invalid");

let vendorLedger = { contract: MATCHED_PACK_CONTRACT, hardStopUsd: CLOUD_HARD_STOP_USD, attempts: [], vendorAttempts: [] };
vendorLedger = reserveVendorCharacters(vendorLedger, "item-a", 200, 500);
vendorLedger = reserveVendorCharacters(vendorLedger, "item-b", 200, 500);
ok("the vendor character ledger reserves before each call and accumulates",
  vendorLedger.vendorAttempts.length === 2 &&
  vendorLedger.vendorAttempts.reduce((sum, attempt) => sum + attempt.reservedCharacters, 0) === 400);
rejects("a request that would cross the caller's character ceiling is refused before the call",
  () => reserveVendorCharacters(vendorLedger, "item-c", 200, 500), "matched_pack_vendor_character_stop_exceeded");
rejects("callers cannot raise the vendor character ceiling above the hard stop",
  () => reserveVendorCharacters({ vendorAttempts: [] }, "item", 10, VENDOR_CHARACTER_HARD_STOP + 1),
  "matched_pack_vendor_character_limit_invalid");

// ── the disclosure trim ──────────────────────────────────────────────────────
// `rejected.md#disclosure-announces-the-clone`: every arm opens by saying it is
// an AI voice replica, so a pack whose cells cross arms is unblinded by its own
// audio. These clips are shaped like a real one — a disclosure, the pause the
// trimmer looks for, then the target text.
function disclosureShapedPcm(index) {
  const parts = [
    sineWav(1_900, 210 + index * 9).subarray(44),
    Buffer.alloc(Math.round(0.30 * 24_000) * 2),
    sineWav(5_000, 190 + index * 11).subarray(44),
  ];
  return Buffer.concat(parts);
}
const trimTemp = mkdtempSync(join(tmpdir(), "vyakti-matched-trim-"));
try {
  const trimHome = join(trimTemp, "run-trim");
  const trimPaths = prepareHome({ home: trimHome, plan: basePlan, referenceWav, referenceText });
  basePlan.items.forEach((item, index) => {
    const payload = payloadForItem({ plan: basePlan, item, referenceWav, referenceText, ...ids(60 + index) });
    const pcm = disclosureShapedPcm(index);
    const result = { ...fakeResult(item, payload, index), audio_base64: pcm.toString("base64"), output_sha256: sha256(pcm), duration_ms: pcm.length / 2 / 24 };
    saveResult(trimPaths, verifyProviderResult({
      plan: basePlan, item, payload, result, responseSignatureVerified: true,
      expectedModelCommitment: result.model_commitment,
    }));
  });
  const trimmed = sealHome(trimHome, Buffer.alloc(32, 9), { trimDisclosure: true });
  const trimmedKey = JSON.parse(readFileSync(trimmed.paths.key, "utf8"));
  ok("sealing with the trim removes a plausible disclosure prefix from every candidate",
    trimmedKey.audioTreatment.disclosureTrimmed === true &&
    trimmedKey.stimuli.length === 5 &&
    trimmedKey.stimuli.every((stimulus) => stimulus.disclosureTrimmedMs >= 1_100 && stimulus.disclosureTrimmedMs <= 6_000));
  ok("the removed prefixes are written out for an ear check that touches no stimulus",
    existsSync(join(trimmed.paths.private, "trim-check.wav")) &&
    trimmedKey.audioTreatment.disclosureTrimCheckFile === "private/trim-check.wav");
  const trimVerified = verifySealedHome(trimHome);
  ok("a trimmed pack still serves one indistinguishable geometry for every clip",
    trimVerified.stimuli === 5 && trimVerified.commonGeometry.split(":").length === 5);
  ok("the trim check file is private and is not served",
    !readdirSync(trimmed.paths.stimuli).some((file) => file.includes("trim-check")));

  // FAIL CLOSED. A clip with no pause inside the window must stop the seal
  // rather than have its first syllable guessed away.
  const noPauseHome = join(trimTemp, "run-no-pause");
  const noPausePaths = prepareHome({ home: noPauseHome, plan: basePlan, referenceWav, referenceText });
  basePlan.items.forEach((item, index) => {
    const payload = payloadForItem({ plan: basePlan, item, referenceWav, referenceText, ...ids(80 + index) });
    const pcm = sineWav(7_200, 200).subarray(44);
    const result = { ...fakeResult(item, payload, index), audio_base64: pcm.toString("base64"), output_sha256: sha256(pcm), duration_ms: pcm.length / 2 / 24 };
    saveResult(noPausePaths, verifyProviderResult({
      plan: basePlan, item, payload, result, responseSignatureVerified: true,
      expectedModelCommitment: result.model_commitment,
    }));
  });
  rejects("a clip with no pause inside the disclosure window refuses to seal",
    () => sealHome(noPauseHome, Buffer.alloc(32, 10), { trimDisclosure: true }),
    "matched_pack_disclosure_cut_not_found");
  ok("the untrimmed seal is unchanged, so an existing pack keeps its shape",
    JSON.parse(readFileSync(sealHome(noPauseHome, Buffer.alloc(32, 11)).paths.key, "utf8")).audioTreatment.disclosureTrimmed === false);
} finally {
  rmSync(trimTemp, { recursive: true, force: true });
}

const guarded = spawnSync(process.execPath, [resolve("scripts/voice-matched-pack.mjs"), "run", "--home", resolve("scratchpad/definitely-not-a-pack")], {
  cwd: resolve("."),
  encoding: "utf8",
});
ok("the cloud command makes no call without exact explicit confirmation", guarded.status !== 0 && guarded.stderr.includes("matched_pack_cloud_confirmation_required"));

console.log(`voice exact-text matched pack: ${checks}/${checks} checks passed`);
console.log("cloud/model calls made by this suite: 0");
console.log("human listening: not started; no voice quality winner exists");
