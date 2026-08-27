import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPEN_CHATTERBOX_DISCLOSURES,
  OPEN_CHATTERBOX_BASE_PACK_COMMITMENT,
  OPEN_CHATTERBOX_HINDI_PACK_COMMITMENT,
  OPEN_CHATTERBOX_MODEL_COMMITMENT,
  createOpenChatterboxPreviewProvider,
  openChatterboxConfig,
} from "../../api/_voice/providers/open-chatterbox-preview.js";
import { voiceLanguageConditioning, voiceScriptMode } from "../../api/_voice/language-conditioning.js";
import { assertVoicePreviewAuthorization } from "../../api/_provenance/contracts.js";
import {
  beginOwnedVoicePreview,
  createNeonVoicePreviewLedger,
  voicePreviewMatchedSeed,
} from "../../api/_replica-voice-preview.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SECRET = "ab".repeat(32);
const ORIGIN = "https://open-voice.internal.example";
const IDS = {
  owner: "11111111-1111-4111-8111-111111111111",
  replica: "22222222-2222-4222-8222-222222222222",
  generation: "33333333-3333-4333-8333-333333333333",
  artifact: "44444444-4444-4444-8444-444444444444",
  source: "55555555-5555-4555-8555-555555555555",
  consent: "66666666-6666-4666-8666-666666666666",
};
let passed = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  passed++;
  console.log(`  PASS ${name}`);
}

function wav(seconds = 5) {
  const samples = 24_000 * seconds;
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++) {
    pcm.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 220 / 24_000) * 4_000), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(24_000, 24); header.writeUInt32LE(48_000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const base64url = (bytes) => Buffer.from(bytes).toString("base64url");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sign = (secret, values) => createHmac("sha256", secret).update(values.join("\n")).digest("base64url");

function signedResponse(url, init, mutate = (value) => value) {
  const request = JSON.parse(Buffer.from(init.body).toString("utf8"));
  const modelCommitment = request.model_arm === "hindi_v3"
    ? OPEN_CHATTERBOX_HINDI_PACK_COMMITMENT
    : OPEN_CHATTERBOX_BASE_PACK_COMMITMENT;
  const modelName = request.model_arm === "hindi_v3"
    ? "chatterbox-multilingual-hi-v3"
    : "chatterbox-multilingual-v3";
  const conditioning = voiceLanguageConditioning({
    languageId: request.language_id,
    referenceLanguageMode: request.reference_language_mode,
    referenceLanguageEvidenceScope: request.reference_language_evidence_scope,
    textLanguageMode: request.text_language_mode,
    requestedCfgWeight: request.requested_cfg_weight,
    disclosureLanguageId: request.disclosure_language_id,
  });
  const pcm = Buffer.alloc(48_000, 7 + Number(request.text_segment_index || 0));
  const result = mutate({
    request_id: request.request_id,
    audio_base64: pcm.toString("base64"),
    output_sha256: digest(pcm),
    sample_rate: 24_000,
    channels: 1,
    encoding: "pcm_s16le",
    duration_ms: 1_000,
    elapsed_ms: 500,
    real_time_factor: 0.5,
    reference_sha256: request.reference_sha256,
    reference_duration_ms: 5_000,
    model: modelName,
    model_commitment: modelCommitment,
    model_arm: request.model_arm,
    model_pack: modelName,
    model_pack_commitment: modelCommitment,
    reference_language_mode: conditioning.referenceLanguageMode,
    reference_language_evidence_scope: conditioning.referenceLanguageEvidenceScope,
    text_language_mode: conditioning.textLanguageMode,
    requested_cfg_weight: conditioning.requestedCfgWeight,
    effective_cfg_weight: conditioning.effectiveCfgWeight,
    quality_state: conditioning.qualityState,
    quality_warnings: conditioning.qualityWarnings,
    conditioning_contract: request.conditioning_contract,
    text_frontend_contract: request.text_frontend_contract,
    text_plan_sha256: request.text_plan_sha256,
    text_segment_index: request.text_segment_index,
    text_segment_count: request.text_segment_count,
    text_segment_semantic_indexes: request.text_segment_semantic_indexes,
    disclosure_text: request.disclosure_text,
    disclosure_language_id: request.disclosure_language_id,
    perth_watermark_verified: true,
    perth_score: 0.99,
    // Mirrors services/open-voice-runtime/app.py: adapter fields are echoed
    // only when one was sent, and the commitment collapses to the base model's
    // without one.
    ...(request.adapter_sha256 ? {
      adapter_id: request.adapter_id,
      adapter_sha256: request.adapter_sha256,
    } : {}),
    synthesis_commitment: request.adapter_sha256
      ? digest(Buffer.from(`${modelCommitment}:lora:${request.adapter_sha256}`))
      : modelCommitment,
  });
  const body = Buffer.from(JSON.stringify(result));
  const path = new URL(url).pathname;
  const responseSignature = sign(Buffer.from(SECRET, "hex"), [
    "vyakti-open-voice/v1", "response", path, init.headers["X-Vyakti-Nonce"], "200", digest(body),
  ]);
  return { request, response: new Response(body, { status: 200, headers: { "X-Vyakti-Response-Signature": responseSignature } }) };
}

assert.throws(() => openChatterboxConfig({ AZURE_OPEN_VOICE_ORIGIN: "http://unsafe", OPEN_VOICE_HMAC_SECRET: SECRET }), /open_voice_origin_invalid/);
assert.throws(() => openChatterboxConfig({ AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: "short" }), /open_voice_hmac_secret_required/);
ok("configuration requires HTTPS and a 256-bit transport secret", true);

const reference = wav();
let observed;
const observedSegments = [];
const provider = createOpenChatterboxPreviewProvider({
  env: { AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: SECRET },
  fetchImpl: async (url, init) => {
    const bodyHash = digest(init.body);
    const expected = sign(Buffer.from(SECRET, "hex"), [
      "vyakti-open-voice/v1", "POST", "/v1/synthesize", init.headers["X-Vyakti-Timestamp"],
      init.headers["X-Vyakti-Nonce"], bodyHash,
    ]);
    assert.equal(init.headers["X-Vyakti-Content-SHA256"], bodyHash);
    assert.equal(init.headers["X-Vyakti-Signature"], expected);
    const segment = signedResponse(url, init);
    observedSegments.push(segment);
    return segment.response;
  },
});
const result = await provider.synthesizePreview({
  text: "Namaste, main tumhari private calibration preview hoon.",
  languageId: "hi",
  seed: 42,
  reference: { bytes: reference, sha256: digest(reference), durationMs: 5_000, languageMode: "latin_only", languageEvidenceScope: "exact_reference" },
  style: { exaggeration: 0.6, cfgWeight: 0.4, temperature: 0.75 },
});
observed = observedSegments[0];
ok("every service request is exact-body HMAC authenticated", Boolean(observed));
ok("the private service receives no tenant or replica identifier", !Object.keys(observed.request).some((key) => /(owner|replica|email|provider_ref)/i.test(key)));
ok("the exact Hindi synthetic disclosure is rendered in Hindi before inference",
  observed.request.text.startsWith(`${OPEN_CHATTERBOX_DISCLOSURES.hi} `) &&
  observed.request.disclosure_language_id === "hi");
ok("reference bytes are content-addressed and bounded", observed.request.reference_sha256 === digest(reference));
ok("Hindi and deterministic evaluation controls cross the contract", observed.request.language_id === "hi" && observed.request.seed === 42);
ok("mixed Roman Hindi and unresolved English cross the provider as explicit ordered languages",
  observedSegments.map((segment) => segment.request.language_id).join(",") === "hi,en,hi" &&
  observedSegments.every((segment, index) => segment.request.text_segment_index === index &&
    segment.request.text_segment_count === observedSegments.length));
ok("Latin-only Hindi references force the official accent-transfer mitigation and emit an honest warning",
  observed.request.requested_cfg_weight === 0.4 && observed.request.cfg_weight === 0 &&
  result.receipt.qualityWarnings.includes("hindi_reference_latin_only_cfg_disabled"));
ok("script observations stay narrow and never label Latin text as detected English",
  voiceScriptMode("नमस्ते Raghav").mode === "mixed" &&
  voiceScriptMode("Namaste Raghav").mode === "latin_only" &&
  voiceScriptMode("123").mode === "unknown");
const chunks = [];
for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
const combinedPcm = Buffer.concat(chunks);
ok("verified language segments are concatenated in order as 24 kHz mono PCM",
  combinedPcm.length === 48_000 * observedSegments.length + 2_880 * (observedSegments.length - 1) &&
  result.format.sampleRate === 24_000 && result.receipt.synthesisSegments.length === observedSegments.length &&
  result.receipt.segmentJoin.contract === "vyakti-pcm-segment-join/v1" &&
  result.receipt.segmentJoin.gapMs === 60 &&
  observedSegments.every((_, index) => combinedPcm[index * (48_000 + 2_880)] === 7 + index) &&
  observedSegments.slice(1).every((_, index) => combinedPcm.subarray(48_000 + index * (48_000 + 2_880),
    48_000 + index * (48_000 + 2_880) + 2_880).every((byte) => byte === 0)));
ok("model, reference, output, latency and PerTh evidence remain bound",
  result.receipt.modelCommitment === OPEN_CHATTERBOX_MODEL_COMMITMENT && result.receipt.perthWatermarkVerified &&
  result.receipt.elapsedMs === 500 * observedSegments.length &&
  result.receipt.realTimeFactor === result.receipt.elapsedMs / result.receipt.durationMs);

let hindiArmObserved;
const hindiArmProvider = createOpenChatterboxPreviewProvider({
  env: {
    AZURE_OPEN_VOICE_ORIGIN: ORIGIN,
    OPEN_VOICE_HMAC_SECRET: SECRET,
    OPEN_VOICE_MODEL_ARM: "hindi_v3",
  },
  fetchImpl: async (url, init) => {
    hindiArmObserved = signedResponse(url, init);
    return hindiArmObserved.response;
  },
});
const hindiArmResult = await hindiArmProvider.synthesizePreview({
  text: "नमस्ते, यह निजी परीक्षण है।",
  languageId: "hi",
  seed: 43,
  reference: { bytes: reference, sha256: digest(reference), durationMs: 5_000, languageMode: "devanagari", languageEvidenceScope: "exact_reference" },
});
ok("the official Hindi pack is an explicit arm, not automatic routing from a Hindi tag",
  observed.request.model_arm === "general" && hindiArmObserved.request.model_arm === "hindi_v3" &&
  hindiArmResult.receipt.modelPack === "chatterbox-multilingual-hi-v3" &&
  hindiArmResult.receipt.modelCommitment === OPEN_CHATTERBOX_HINDI_PACK_COMMITMENT);
await assert.rejects(hindiArmProvider.synthesizePreview({
  text: "Private preview.", languageId: "en", seed: 1,
  reference: { bytes: reference, languageMode: "latin_only" },
}), /open_voice_hindi_arm_language_invalid/);
ok("the Hindi-specific arm refuses a non-Hindi request before waking the GPU", true);

const legacyRuntimeProvider = createOpenChatterboxPreviewProvider({
  env: { AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: SECRET },
  fetchImpl: async (url, init) => signedResponse(url, init, (value) => {
    for (const key of [
      "conditioning_contract", "model_arm", "model_pack", "model_pack_commitment",
      "reference_language_mode", "reference_language_evidence_scope", "text_language_mode",
      "requested_cfg_weight", "effective_cfg_weight", "quality_state", "quality_warnings",
      "text_frontend_contract", "text_plan_sha256", "text_segment_index", "text_segment_count",
      "text_segment_semantic_indexes", "disclosure_text", "disclosure_language_id",
    ]) delete value[key];
    return value;
  }).response,
});
await assert.rejects(legacyRuntimeProvider.synthesizePreview({
  text: "नमस्ते, यह रोलिंग डिप्लॉय परीक्षण है।", languageId: "hi", seed: 44,
  reference: { bytes: reference, languageMode: "latin_only", languageEvidenceScope: "source_transcript" },
  style: { cfgWeight: 0.65 },
}), /open_voice_response_binding_invalid/);
ok("the new web plane refuses a runtime that omits the bound text-plan receipt", true);

const badSignature = createOpenChatterboxPreviewProvider({
  env: { AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: SECRET },
  fetchImpl: async (url, init) => {
    const { response } = signedResponse(url, init);
    return new Response(await response.arrayBuffer(), { status: 200, headers: { "X-Vyakti-Response-Signature": base64url(Buffer.alloc(32, 3)) } });
  },
});
await assert.rejects(badSignature.synthesizePreview({ text: "Private preview.", languageId: "en", seed: 1, reference: { bytes: reference } }), /open_voice_response_signature_invalid/);
ok("unsigned or tampered service responses fail closed", true);

// ── per-speaker adapter seam (WS-U) ──────────────────────────────────────
// A zero-shot receipt must still carry the BASE commitment and no adapter, or
// every receipt written before adapters existed silently changes meaning.
ok("a request without an adapter sends no adapter field and commits to the base model",
  !Object.keys(observed.request).some((key) => key.startsWith("adapter_")) &&
  result.receipt.adapterSha256 === null &&
  result.receipt.synthesisCommitment === OPEN_CHATTERBOX_MODEL_COMMITMENT);

const adapterBytes = Buffer.alloc(4_096, 9);
const adapterSha = digest(adapterBytes);
let adapted;
const adaptedSegments = [];
const adapterProvider = createOpenChatterboxPreviewProvider({
  env: { AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: SECRET },
  fetchImpl: async (url, init) => {
    const segment = signedResponse(url, init);
    adaptedSegments.push(segment);
    return segment.response;
  },
});
const adaptedResult = await adapterProvider.synthesizePreview({
  text: "Namaste, main tumhari private calibration preview hoon.",
  languageId: "hi", seed: 42,
  reference: { bytes: reference, sha256: digest(reference), durationMs: 5_000 },
  adapter: { id: "owner-hinglish-71s", bytes: adapterBytes },
});
adapted = adaptedSegments[0];
ok("an adapter crosses the contract content-addressed, inside the signed body",
  adapted.request.adapter_sha256 === adapterSha &&
  Buffer.from(adapted.request.adapter_base64, "base64").equals(adapterBytes));
ok("an adapted request still carries the exact audible disclosure and no identifiers",
  adapted.request.text.startsWith(`${OPEN_CHATTERBOX_DISCLOSURES.hi} `) &&
  !Object.keys(adapted.request).some((key) => /(owner|replica|email|provider_ref)/i.test(key)));
ok("an adapted receipt commits to model AND adapter, not the base model alone",
  adaptedResult.receipt.adapterSha256 === adapterSha &&
  adaptedResult.receipt.synthesisCommitment === digest(Buffer.from(`${OPEN_CHATTERBOX_MODEL_COMMITMENT}:lora:${adapterSha}`)) &&
  adaptedResult.receipt.synthesisCommitment !== OPEN_CHATTERBOX_MODEL_COMMITMENT);

// The failure this exists for: a service that IGNORES the adapter returns
// perfectly good audio. Without this check a zero-shot clip would be scored as
// a fine-tuned one and the measured delta would be zero for the wrong reason.
const droppedAdapter = createOpenChatterboxPreviewProvider({
  env: { AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: SECRET },
  fetchImpl: async (url, init) => signedResponse(url, init, (value) => {
    delete value.adapter_id;
    delete value.adapter_sha256;
    value.synthesis_commitment = OPEN_CHATTERBOX_MODEL_COMMITMENT;
    return value;
  }).response,
});
await assert.rejects(droppedAdapter.synthesizePreview({
  text: "Private preview.", languageId: "en", seed: 1,
  reference: { bytes: reference }, adapter: { id: "owner-hinglish-71s", bytes: adapterBytes },
}), /open_voice_adapter_binding_invalid/);
ok("a service that silently ignores the adapter fails closed instead of returning zero-shot audio", true);

await assert.rejects(provider.synthesizePreview({
  text: "Private preview.", languageId: "en", seed: 1,
  reference: { bytes: reference }, adapter: { id: "NOT a valid id", bytes: adapterBytes },
}), /open_voice_adapter_id_invalid/);
await assert.rejects(provider.synthesizePreview({
  text: "Private preview.", languageId: "en", seed: 1,
  reference: { bytes: reference }, adapter: { id: "owner-hinglish-71s", bytes: adapterBytes, sha256: "0".repeat(64) },
}), /open_voice_adapter_hash_mismatch/);
ok("adapter identity and digest are validated before any GPU is woken", true);

const wrongModel = createOpenChatterboxPreviewProvider({
  env: { AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: SECRET },
  fetchImpl: async (url, init) => signedResponse(url, init, (value) => ({ ...value, model_commitment: "0".repeat(64) })).response,
});
await assert.rejects(wrongModel.synthesizePreview({ text: "Private preview.", languageId: "en", seed: 1, reference: { bytes: reference } }), /open_voice_response_binding_invalid/);
ok("an unpinned or swapped model response fails closed", true);

const wrongEvidence = createOpenChatterboxPreviewProvider({
  env: { AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: SECRET },
  fetchImpl: async (url, init) => signedResponse(url, init, (value) => ({ ...value, reference_duration_ms: 5_001, perth_score: 0.49 })).response,
});
await assert.rejects(wrongEvidence.synthesizePreview({ text: "Private preview.", languageId: "en", seed: 1, reference: { bytes: reference } }), /open_voice_response_binding_invalid/);
ok("misbound reference duration or weak watermark evidence fails closed", true);

const wrongSegmentReceipt = createOpenChatterboxPreviewProvider({
  env: { AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: SECRET },
  fetchImpl: async (url, init) => signedResponse(url, init, (value) => ({
    ...value,
    text_segment_index: value.text_segment_index + 1,
  })).response,
});
await assert.rejects(wrongSegmentReceipt.synthesizePreview({
  text: "Namaste main private preview hoon.", languageId: "hi", seed: 1,
  reference: { bytes: reference, languageMode: "mixed", languageEvidenceScope: "exact_reference" },
}), /open_voice_response_binding_invalid/);
ok("a runtime response that relabels one text segment fails closed before concatenation", true);

const previewAuthorization = {
  request: { generationId: IDS.generation, replicaId: IDS.replica, ownerUserId: IDS.owner, channel: "studio_preview", purpose: "voice_preview", policyVersion: "vyakti-replica-output-v1", traceId: "preview_12345678" },
  replica: { replica_id: IDS.replica, owner_user_id: IDS.owner, subject_mode: "self", lifecycle: "calibrating", policy_version: "replica-self-v1", age_verified_at: "2026-08-01T00:00:00.000Z", identity_verified_at: "2026-08-01T00:00:00.000Z", liveness_verified_at: "2026-08-01T00:00:00.000Z", identity_expires_at: "2030-01-01T00:00:00.000Z" },
  inferenceConsent: { consent_id: IDS.consent, replica_id: IDS.replica, owner_user_id: IDS.owner, scope: "inference", policy_version: "replica-self-v1", granted_at: "2026-08-01T00:00:00.000Z", expires_at: "2030-01-01T00:00:00.000Z", revoked_at: null },
  voiceGenome: { replica_id: IDS.replica, version: 4, status: "draft" },
  previewArtifact: { artifact_id: IDS.artifact, replica_id: IDS.replica, owner_user_id: IDS.owner, source_id: IDS.source, stage: "enhance", selection_decision: "selected", source_state: "ready", contains_third_parties: false, sha256: "a".repeat(64) },
};
const authorization = assertVoicePreviewAuthorization(previewAuthorization, new Date("2026-08-25T00:00:00.000Z"));
ok("draft preview authorization is owner, identity, consent, genome and artifact bound", authorization.voiceProfileId === IDS.artifact && authorization.genomeVersion === 4 && authorization.profileVersion === 0);
assert.throws(() => assertVoicePreviewAuthorization({ ...previewAuthorization, previewArtifact: { ...previewAuthorization.previewArtifact, selection_decision: "superseded" } }, new Date("2026-08-25T00:00:00.000Z")), /preview_artifact_not_eligible/);
assert.throws(() => assertVoicePreviewAuthorization({ ...previewAuthorization, voiceGenome: { ...previewAuthorization.voiceGenome, status: "approved" } }, new Date("2026-08-25T00:00:00.000Z")), /draft_voice_genome_required/);
ok("superseded artifacts and non-draft genomes cannot enter the preview corridor", true);

const matchedSeedInput = {
  replicaId: IDS.replica,
  genomeVersion: 4,
  languageId: "hi",
  textHash: "9".repeat(64),
};
const matchedSeed = voicePreviewMatchedSeed(matchedSeedInput);
ok("matched trials derive one positive seed from identity, genome, language and prompt", matchedSeed > 0 && matchedSeed === voicePreviewMatchedSeed(matchedSeedInput));
ok("changing the committed prompt changes the deterministic trial seed", matchedSeed !== voicePreviewMatchedSeed({ ...matchedSeedInput, textHash: "8".repeat(64) }));

let beginSql = "";
const textFrontendFixture = (inputSha256) => ({
  contract: "vyakti-hindi-text-frontend/v1",
  planSha256: "a".repeat(64),
  inputSha256,
  targetSha256: "b".repeat(64),
  disclosureLanguage: "hi",
  synthesisLanguages: ["hi"],
  synthesisSegmentCount: 1,
  transformationCount: 1,
  warnings: [],
});
const begun = await beginOwnedVoicePreview(async (sql) => {
  beginSql = sql;
  return [{
    generation_id: IDS.generation, replica_id: IDS.replica, owner_user_id: IDS.owner,
    genome_version: 4, channel: "studio_preview", purpose: "voice_preview", policy_version: "vyakti-replica-output-v1", trace_id: "preview_12345678",
    preview_model_commitment: OPEN_CHATTERBOX_MODEL_COMMITMENT,
    subject_mode: "self", lifecycle: "calibrating", replica_policy_version: "replica-self-v1",
    age_verified_at: "2026-08-01T00:00:00.000Z", identity_verified_at: "2026-08-01T00:00:00.000Z", liveness_verified_at: "2026-08-01T00:00:00.000Z", identity_expires_at: "2030-01-01T00:00:00.000Z",
    artifact_id: IDS.artifact, source_id: IDS.source, object_path: `${IDS.owner}/${IDS.replica}/${IDS.source}/derived/enhance.wav`, mime: "audio/wav", byte_size: reference.length, duration_ms: 5_000, sha256: digest(reference), stage: "enhance", selection_decision: "selected", source_state: "ready", contains_third_parties: false, genome_status: "draft",
    reference_language_mode: "mixed", transcript_span_count: 3, devanagari_chars: 42, latin_chars: 11,
    consent_id: IDS.consent, consent_scope: "inference", consent_policy_version: "replica-self-v1", consent_granted_at: "2026-08-01T00:00:00.000Z", consent_expires_at: "2030-01-01T00:00:00.000Z", consent_revoked_at: null,
  }];
}, IDS.owner, {
  replica_id: IDS.replica,
  genome_version: 4,
  trace_id: "preview_12345678",
  language_id: "hi",
  text_hash: "9".repeat(64),
  text_language_mode: "latin_only",
  text_frontend: textFrontendFixture("9".repeat(64)),
  style_key: "balanced",
});
ok("authorization is atomically inserted from the exact current draft and selected artifact", begun.reference.artifactId === IDS.artifact && /vg\.status='draft'/.test(beginSql) && /selected\.decision='selected'/.test(beginSql));
ok("reference selection uses owner-bound source transcript script evidence and prefers Hindi or mixed candidates",
  /e\.source_id=a\.source_id/.test(beginSql) && !/e\.artifact_id=a\.artifact_id/.test(beginSql) &&
  /e\.evidence_type='transcript_span'/.test(beginSql) && /reference_language_mode when 'mixed' then 0/.test(beginSql) &&
  begun.reference.languageMode === "mixed" && begun.reference.languageEvidenceScope === "source_transcript");
ok("the generation audit shape records observed reference/text script modes and effective CFG",
  /'text_language_mode',\$15::text/.test(beginSql) && /'reference_language_mode',reference_language_mode/.test(beginSql) &&
  /'reference_language_evidence_scope'/.test(beginSql) && /'conditioning_contract'/.test(beginSql) &&
  /'effective_cfg_weight'/.test(beginSql) && begun.voiceConditioning.qualityWarnings.includes("hindi_reference_mixed_script") &&
  begun.voiceConditioning.qualityWarnings.includes("reference_script_observed_at_source_scope"));
const noTranscriptBegun = await beginOwnedVoicePreview(async () => [{
  ...begun.generation,
  generation_id: "77777777-7777-4777-8777-777777777777",
  reference_language_mode: "unknown",
  transcript_span_count: 0,
  devanagari_chars: 0,
  latin_chars: 0,
}], IDS.owner, {
  replica_id: IDS.replica, genome_version: 4, trace_id: "preview_no_transcript",
  language_id: "hi", text_hash: "7".repeat(64), text_language_mode: "devanagari", style_key: "balanced",
  text_frontend: textFrontendFixture("7".repeat(64)),
});
ok("a production-shaped selected source with no transcript spans is unverified and CFG-disabled",
  noTranscriptBegun.reference.languageEvidenceScope === "unverified" &&
  noTranscriptBegun.reference.languageMode === "unknown" &&
  noTranscriptBegun.voiceConditioning.effectiveCfgWeight === 0 &&
  noTranscriptBegun.voiceConditioning.qualityState === "reference_language_unverified");
ok("the generation records the matched-trial seed used by synthesis", begun.previewSeed === matchedSeed && /preview_seed/.test(beginSql));
ok("preview issuance rechecks current inference, biometric and training grants", /scope='inference'/.test(beginSql) && /scope='biometric'/.test(beginSql) && /scope='training'/.test(beginSql));
ok("every preview consent must match the current replica policy", (beginSql.match(/policy_version=r\.policy_version/g) || []).length >= 2 && /c\.policy_version=\$7/.test(beginSql));

const ledgerSql = [];
const ledger = createNeonVoicePreviewLedger(async (sql) => { ledgerSql.push(sql); return [{ generation_id: IDS.generation, sequence: 0 }]; });
await ledger.open({ generationId: IDS.generation, replicaId: IDS.replica, ownerUserId: IDS.owner, disclosureScheme: "audible-prefix-v1", watermarkAlgorithm: "audioseal", provenanceStandard: "c2pa-2.4", watermarkTokenHash: "b".repeat(64) });
await ledger.appendSegment({ authorization, receipt: { sequence: 0, byte_offset: 0, byte_length: 2, segment_sha256: "c".repeat(64), previous_chain_sha256: "0".repeat(64), chain_sha256: "d".repeat(64), signature_algorithm: "ES256", signer_key_id: "key", chain_signature: "signature".repeat(8), issued_at: "2026-08-25T00:00:00.000Z" } });
await ledger.seal({ authorization, receipt: { envelope_sha256: "e".repeat(64), replica_commitment: "f".repeat(64), policy_version: "vyakti-replica-output-v1", channel: "studio_preview", disclosure_scheme: "audible-prefix-v1", disclosure_text_hash: "1".repeat(64), watermark_algorithm: "audioseal", watermark_token_hash: "2".repeat(64), detector_policy_hash: "3".repeat(64), provenance_standard: "c2pa-2.4", manifest_location: "external", signature_algorithm: "ES256", signer_key_id: "key", envelope_signature: "signature".repeat(8), issued_at: "2026-08-25T00:00:00.000Z" }, envelopeCanonical: JSON.stringify({ receipt: "x".repeat(180) }), audioHash: "4".repeat(64), watermarkTokenHash: "2".repeat(64), manifestHash: "5".repeat(64), segmentCount: 1, finalChainSha256: "6".repeat(64), sealedAt: "2026-08-25T00:00:00.000Z" });
ok("every protected preview segment rechecks revocation and latest artifact selection", ledgerSql.length === 3 && ledgerSql.every((sql) => /scope='inference'/.test(sql) && /newer\.created_at/.test(sql)));
ok("draft previews never depend on or mint an active runtime capability", ledgerSql.every((sql) => !/vy_replica_runtime_capability/.test(sql)));

const app = readFileSync(join(ROOT, "services/open-voice-runtime/app.py"), "utf8");
const docker = readFileSync(join(ROOT, "services/open-voice-runtime/Dockerfile"), "utf8");
const brokerDocker = readFileSync(join(ROOT, "services/open-voice-runtime/Dockerfile.broker"), "utf8");
const broker = readFileSync(join(ROOT, "services/open-voice-runtime/broker.py"), "utf8");
const fetchModels = readFileSync(join(ROOT, "services/open-voice-runtime/fetch_models.py"), "utf8");
const hindiPack = readFileSync(join(ROOT, "services/open-voice-runtime/hindi_pack.py"), "utf8");
const infra = readFileSync(join(ROOT, "services/open-voice-runtime/infra/main.bicep"), "utf8");
const migration = readFileSync(join(ROOT, "db/migrations/045_replica_voice_preview.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const handler = readFileSync(join(ROOT, "api/replica-voice-preview.js"), "utf8");
const studio = readFileSync(join(ROOT, "src/studio/VoicePreviewLab.tsx"), "utf8");
const advancedPreviewBindsTextFrontend = (source) =>
  /beginOwnedVoicePreview\(q, user\.id, \{[\s\S]{0,650}text_frontend:\s*textFrontend/.test(source);
ok("runtime source and checkpoint revisions are immutable", app.includes("5de7a54aa4e5e2baadb0182dde554908b48b85c2") && fetchModels.includes("5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18") && /FROM .*@sha256:[0-9a-f]{64}/.test(docker) && /FROM .*@sha256:[0-9a-f]{64}/.test(brokerDocker));
ok("runtime has no model-network dependency", docker.includes("HF_HUB_OFFLINE=1") && docker.includes("TRANSFORMERS_OFFLINE=1") && fetchModels.includes("revision=MODEL_REVISION"));
ok("the Hindi pack is revision-pinned and built as a single explicit arm",
  fetchModels.includes("82ca71273cc2a9ab19efdf8315f865c1a5af0ee7") &&
  fetchModels.includes('MODEL_ARM == "hindi_v3"') && docker.includes("ARG OPEN_VOICE_MODEL_ARM=general") &&
  !/application\.state\.models\s*=/.test(app));
ok("the Hindi loader mirrors the official pack's multilingual T3 and non-strict v3 S3Gen load",
  /T3\(T3Config\.multilingual\(\)\)/.test(hindiPack) && /s3gen_v3\.pt/.test(hindiPack) &&
  /strict=False/.test(hindiPack) && /t3_hi\.safetensors/.test(hindiPack) &&
  /OPEN_VOICE_HINDI_ALLOWED_MISSING_KEYS/.test(hindiPack) && /unapproved_unexpected/.test(hindiPack));
ok("the service requires CUDA and verifies PerTh before returning audio", /open_voice_cuda_required/.test(app) && /perth_watermark_verification_failed/.test(app));
ok("the runtime accepts the old app contract but the new app requires text-plan evidence",
  /if not modern_conditioning:/.test(app) && /legacy_app_language_contract_unverified/.test(app) &&
  /result\?\.text_frontend_contract !== "vyakti-hindi-text-frontend\/v1"/.test(
    readFileSync(join(ROOT, "api/_voice/providers/open-chatterbox-preview.js"), "utf8")));
ok("request logging is disabled and audio uses an auto-deleted temporary file", docker.includes("--no-access-log") && app.includes("NamedTemporaryFile"));
ok("Azure GPU deployment is private, digest-pinned, scale-to-zero and single-concurrency", /external:\s*false/.test(infra) && /contains\(image, '@sha256:'\)/.test(infra) && /minReplicas:\s*0/.test(infra) && /maxReplicas:\s*1/.test(infra) && /concurrentRequests:\s*'1'/.test(infra));
ok("Azure GPU resources use the workload profile and API-valid probe delays",
  /workloadProfileName:\s*'Consumption-GPU-NC8as-T4'/.test(infra) &&
  !/resources:\s*\{[^}]*\bgpu\s*:/.test(infra) &&
  !/initialDelaySeconds:\s*0\b/.test(infra) &&
  !/initialDelaySeconds:\s*(?:6[1-9]|[7-9]\d|\d{3,})\b/.test(infra));
ok("the isolated Hindi deployment allows only the two official reconstructed tokenizer buffers",
  /OPEN_VOICE_HINDI_ALLOWED_MISSING_KEYS/.test(infra) &&
  /modelArm == 'hindi_v3' \? 'tokenizer\._mel_filters,tokenizer\.window' : ''/.test(infra));
ok("the Hindi evaluation arm cannot reuse either production app name",
  /runtimeName = modelArm == 'hindi_v3' \? 'vyakti-open-voice-hi' : containerAppName/.test(infra) &&
  /admissionName = modelArm == 'hindi_v3' \? 'vyakti-open-voice-hi-gate' : brokerAppName/.test(infra) &&
  /name:\s*runtimeName/.test(infra) && /name:\s*admissionName/.test(infra));
ok("the startup probe leaves bounded headroom above the measured cold load",
  /type:\s*'Startup'[\s\S]{0,250}initialDelaySeconds:\s*10[\s\S]{0,120}periodSeconds:\s*60[\s\S]{0,120}failureThreshold:\s*10/.test(infra));
ok("a scale-to-zero CPU admission broker protects the private GPU from internet-triggered spend", /resource broker/.test(infra) && /external:\s*true/.test(infra) && /workloadProfileName:\s*'Consumption'/.test(infra) && /OPEN_VOICE_RUNTIME_ORIGIN/.test(infra) && broker.indexOf("body = await _admit(request)") < broker.indexOf("client.post"));
ok("admission and GPU responses remain end-to-end HMAC bound across cold starts",
  /runtime_response_signature_invalid/.test(broker) && /internal_nonce/.test(broker) &&
  /_internal_headers/.test(broker) && /open_voice_runtime_warming/.test(broker) &&
  /return _signed_response\(request, response_body, upstream\.status_code\)/.test(broker) &&
  brokerDocker.includes("--no-access-log"));
ok("preview rows are structurally distinct from qualified runtime generations", /purpose='voice_preview'/.test(migration) && /voice_profile_id is null/.test(migration) && /preview_model_commitment~/.test(migration));
ok("canonical schema carries the exact preview migration", schema.includes("vy_replica_generation_preview_shape") && schema.includes("vy_replica_generation_preview_artifact_fk"));
ok("the owner endpoint verifies private reference bytes before synthesis", /readPrivateReplicaObject/.test(handler) && /voice_preview_reference_binding_failed/.test(handler));
ok("both owner preview handlers pass observed text mode into atomic authorization before synthesis",
  /beginOwnedVoicePreview\(q, user\.id, \{[\s\S]{0,500}text_language_mode: textLanguageMode/.test(handler) &&
  /text_language_mode: textLanguageMode/.test(readFileSync(join(ROOT, "api/_voice/preview-panel.js"), "utf8")));
ok("the advanced preview route passes its audited text frontend into the atomic authorization",
  advancedPreviewBindsTextFrontend(handler));
ok("NEGATIVE CONTROL: omitting the advanced route text frontend is caught before release",
  !advancedPreviewBindsTextFrontend(handler.replaceAll(/\n\s*text_frontend:\s*textFrontend,/g, "")));
ok("no browser byte is returned before PerTh, AudioSeal, C2PA and ledger completion", /assertSynthesisResult/.test(handler) && /protectReplicaStream/.test(handler) && /await protectedAudio\.completion/.test(handler));
ok("Studio presents real loading, empty, error and protected-audio states", /generating/.test(studio) && /No draft can speak yet/.test(studio) && /role="alert"/.test(studio) && /<audio controls/.test(studio));
ok("new Studio copy contains no em dash or en dash", !/[—–]/.test(studio));

execFileSync("python", ["-m", "py_compile", "services/open-voice-runtime/app.py", "services/open-voice-runtime/broker.py", "services/open-voice-runtime/fetch_models.py", "services/open-voice-runtime/hindi_pack.py"], { cwd: ROOT, stdio: "pipe" });
ok("Python service sources compile", true);

console.log(`\nOpen voice runtime: ${passed} checks passed.`);
