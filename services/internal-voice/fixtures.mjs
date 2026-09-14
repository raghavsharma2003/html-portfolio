// Synthetic signed transport fixtures reused from evals/open-voice; no real inference.
import {createHash,createHmac} from 'node:crypto';
import {OPEN_CHATTERBOX_HINDI_PACK_COMMITMENT,OPEN_CHATTERBOX_BASE_PACK_COMMITMENT} from '../../api/_voice/providers/open-chatterbox-preview.js';
import {voiceLanguageConditioning} from '../../api/_voice/language-conditioning.js';
const SECRET='ab'.repeat(32);
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

function signedRuntimeStatus(url, init, { ready = true, status = ready ? 200 : 503, tamper = false } = {}) {
  const request = JSON.parse(Buffer.from(init.body).toString("utf8"));
  const result = ready ? { ready: true } : { error: "open_voice_runtime_warming" };
  const body = Buffer.from(JSON.stringify(result));
  const path = new URL(url).pathname;
  const responseSignature = tamper ? base64url(Buffer.alloc(32, 3)) : sign(Buffer.from(SECRET, "hex"), [
    "vyakti-open-voice/v1", "response", path, init.headers["X-Vyakti-Nonce"], String(status), digest(body),
  ]);
  return {
    request,
    response: new Response(body, { status, headers: { "X-Vyakti-Response-Signature": responseSignature } }),
  };
}


export {wav,signedResponse,signedRuntimeStatus};
