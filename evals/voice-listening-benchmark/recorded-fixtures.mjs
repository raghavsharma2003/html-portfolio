// Synthetic tones and a deliberately non-authoritative fixture signature.
// This module is never imported by the CLI or production recorded-pack module.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { canonical, sha256, tonePcm, wrapWav } from "./lib.mjs";
import { RECORDED_PLAN, RECORDED_PACK, validateRecordedPlan } from "./recorded-pack.mjs";
const H = (value) => sha256(canonical(value));
const RUN = "10000000-0000-4000-8000-000000000001", SUBJECT = "20000000-0000-4000-8000-000000000001";
const sign = (value) => createHmac("sha256", "PUBLIC SYNTHETIC TEST FIXTURE, NOT AUTHORITY").update(canonical(value)).digest("hex");
function signed(value) { return Buffer.from(canonical({ value, signature: sign(value) })); }
function authority(ref) { return { subjectId: ref.subjectId, id: ref.id, purpose: ref.purpose, audioSha256: ref.audio.sha256, transcriptSha256: ref.transcript.sha256, preprocessingSha256: ref.preprocessingSha256 }; }
function protection(planSha256, attempt, outcome) { return { runId: attempt.runId, planSha256, attemptId: attempt.id, generationId: outcome.generationId, outputSha256: outcome.output.sha256, normalizationReceiptSha256: attempt.normalization.receipt.sha256 }; }
export function recordedFixture({ listeningDurationMs = 100, outputDurationMs = [100, 100] } = {}) {
  const media = new Map();
  const put = (path, bytes) => { media.set(path, bytes); return { path, sha256: sha256(bytes) }; };
  function ref(id, purpose, frequency) {
    const value = { id, subjectId: SUBJECT, purpose, audio: put(`private/${id}.wav`, wrapWav(tonePcm({ frequency, durationMs: purpose === "independent_listening" ? listeningDurationMs : 100 }))),
      transcript: { text: `Synthetic ${id} reference, never owner speech`, sha256: sha256(`Synthetic ${id} reference, never owner speech`) }, preprocessingSha256: H("unchanged synthetic fixture") };
    return { ...value, authority: put(`private/${id}-authority.json`, signed(authority(value))) };
  }
  const conditioning = ref("conditioning", "conditioning", 220), listening = ref("listening", "independent_listening", 330);
  const item = (id, language, text) => ({ id, language, text, textSha256: sha256(text), eligibleCandidateIds: ["candidate-a", "candidate-b"] });
  const corpus = { id: "synthetic-corpus", version: "v1", items: [item("hi-one", "hi", "यह केवल कृत्रिम परीक्षण है।"), item("en-one", "en-IN", "This is only a synthetic test.")] };
  const plan = { contract: RECORDED_PLAN, runId: RUN, corpus: { ...corpus, sha256: H(corpus) }, subject: { id: SUBJECT, conditioningReferences: [conditioning], listeningReference: listening },
    candidates: ["candidate-a", "candidate-b"].map((id) => ({ id, languages: ["hi", "en-IN"], identity: { modelSha256: H(id), tokenizerSha256: H("tokenizer"), vocoderSha256: H("vocoder"), adapterSha256: "none", runtimeImageSha256: H("image"), settingsSha256: H("settings") } })),
    conditioningGroups: [{ id: "matched", comparisonRecipeId: "same-conditioning-v1", comparisonKind: "weights_only", arms: ["candidate-a", "candidate-b"].map((candidateId) => ({ candidateId, referenceId: conditioning.id, referenceManifestSha256: H(conditioning), normalizationRecipeSha256: H("identity-normalization-v1") })) }], attempts: [], deliveryRecipe: "preserve_exact_protected_bytes/v1" };
  for (const item of corpus.items) for (const candidate of plan.candidates) {
    const id = `${item.id}-${candidate.id}`;
    const normalization = { sourceTextSha256: item.textSha256, synthesisText: item.text, synthesisTextSha256: item.textSha256, recipeSha256: H("identity-normalization-v1"), reconstructedTextSha256: item.textSha256 };
    plan.attempts.push({ id, runId: RUN, subjectId: SUBJECT, itemId: item.id, candidateId: candidate.id, conditioningGroupId: "matched", comparisonRecipeId: "same-conditioning-v1", listeningReferenceManifestSha256: H(listening), repeatIndex: 0,
      normalization: { ...normalization, receipt: put(`private/${id}-normalization.json`, Buffer.from(canonical(normalization))) } });
  }
  const planSha256 = validateRecordedPlan(plan).planSha256;
  const pack = { contract: RECORDED_PACK, runId: RUN, runPlanSha256: planSha256, corpusSha256: plan.corpus.sha256, outcomes: plan.attempts.map((attempt, index) => {
    const state = ["success", "success", "failed", "uncertain"][index];
    const outcome = { attemptId: attempt.id, runId: RUN, state, generationId: `30000000-0000-4000-8000-00000000000${index + 1}`,
      timing: { startedAt: "2026-09-08T00:00:00.000Z", endedAt: state === "uncertain" ? null : "2026-09-08T00:00:01.000Z" }, cost: { status: "unknown", microUsd: null } };
    if (state !== "success") return { ...outcome, failureCode: state === "failed" ? "synthetic_failure" : "synthetic_timeout" };
    outcome.output = put(`private/${attempt.id}.wav`, wrapWav(tonePcm({ frequency: 440 + index * 100, durationMs: outputDurationMs[index] })));
    outcome.delivery = { recipe: plan.deliveryRecipe, originalSha256: outcome.output.sha256, deliveredSha256: outcome.output.sha256, history: [] };
    outcome.protection = put(`private/${attempt.id}-protection.json`, signed(protection(planSha256, attempt, outcome)));
    return outcome;
  }) };
  let reads = 0, verificationCalls = 0;
  return { plan, pack, media, counters: () => ({ reads, verificationCalls }),
    readMedia: ({ path }) => { reads++; return media.get(path); },
    verifyEvidence: async ({ phase, binding, bindingSha256, materials }) => {
      verificationCalls++;
      if (phase === "evidence" && (binding.kind === "reference" || binding.outcome.state === "success")) {
        const receipt = JSON.parse((binding.kind === "reference" ? materials.authority : materials.protection).toString("utf8"));
        const expected = binding.kind === "reference" ? authority(binding.reference) : protection(binding.planSha256, binding.attempt, binding.outcome);
        assert.deepEqual(receipt.value, expected); assert.equal(receipt.signature, sign(expected));
      }
      return { bindingSha256, assurance: "synthetic_fixture_only" };
    },
  };
}
