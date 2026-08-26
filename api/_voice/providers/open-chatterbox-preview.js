import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { probeEnrollmentWav } from "../../_audio/wav.js";
import { canonicalJson, sha256Hex } from "../../_provenance/contracts.js";
import { SYNTHETIC_AUDIO_DISCLOSURE, VOICE_PCM_FORMAT, renderTextWithDisclosure } from "../contracts.js";

const PROTOCOL = "vyakti-open-voice/v1";
const PROVIDER_NAME = "open_chatterbox_multilingual_v3";
const SERVICE_MODEL_NAME = "chatterbox-multilingual-v3";
const MODEL_COMMITMENT = sha256Hex("chatterbox-multilingual-v3:5de7a54aa4e5e2baadb0182dde554908b48b85c2:5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGES = new Set(["ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh"]);
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
// Matches services/open-voice-runtime/app.py: an r=16 LoRA over the 120 T3
// attention projections is 3.93 M fp32 parameters = 15.8 MB.
const MAX_ADAPTER_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const ADAPTER_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/;

// What actually produced the audio. Mirrors `lora.synthesis_commitment` in
// services/open-voice-runtime/lora.py; the two are checked against each other
// on every adapted response, so a drift between them fails the call rather
// than silently issuing a receipt for a network that did not run.
function synthesisCommitment(adapterSha256) {
  return adapterSha256 ? sha256Hex(`${MODEL_COMMITMENT}:lora:${adapterSha256}`) : MODEL_COMMITMENT;
}

function fail(code, status = 503) {
  throw Object.assign(new Error(code), { code, status });
}

function secret(value) {
  const raw = String(value || "");
  let bytes;
  try { bytes = /^[0-9a-f]{64,}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64url"); }
  catch { fail("open_voice_hmac_secret_required"); }
  if (!bytes || bytes.length < 32) fail("open_voice_hmac_secret_required");
  return bytes;
}

export function openChatterboxConfig(env = process.env) {
  let origin;
  try { origin = new URL(String(env.AZURE_OPEN_VOICE_ORIGIN || "")); }
  catch { fail("open_voice_origin_required"); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
    fail("open_voice_origin_invalid");
  return Object.freeze({
    origin: origin.origin,
    transportSecret: secret(env.OPEN_VOICE_HMAC_SECRET),
  });
}

function signature(secretBytes, values) {
  return createHmac("sha256", secretBytes).update(values.join("\n")).digest("base64url");
}

function equal(left, right) {
  const one = Buffer.from(String(left || ""));
  const two = Buffer.from(String(right || ""));
  return one.length === two.length && one.length >= 32 && timingSafeEqual(one, two);
}

function number(value, low, high, code) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < low || result > high) fail(code, 400);
  return result;
}

function inputValue(raw) {
  const reference = Buffer.from(raw?.reference?.bytes || []);
  if (!reference.length || reference.length > MAX_REFERENCE_BYTES) fail("open_voice_reference_size_invalid", 413);
  const referenceSha256 = createHash("sha256").update(reference).digest("hex");
  if (raw.reference?.sha256 && raw.reference.sha256 !== referenceSha256) fail("open_voice_reference_hash_mismatch", 409);
  const probe = probeEnrollmentWav(reference, { expectedDurationMs: raw.reference?.durationMs });
  if (probe.durationMs < 5_000 || probe.durationMs > 90_000) fail("open_voice_reference_duration_invalid", 409);
  const language = String(raw?.languageId || "en").toLowerCase();
  if (!LANGUAGES.has(language)) fail("open_voice_language_not_supported", 400);
  const seed = Number(raw?.seed);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2_147_483_647) fail("open_voice_seed_invalid", 400);
  const renderedText = renderTextWithDisclosure(raw?.text);
  if (renderedText.length > 700) fail("open_voice_preview_text_too_large", 413);
  // The per-speaker adapter is optional and every check on it is the same
  // shape as the reference's: bounded, content-addressed, and rejected here
  // rather than at the GPU. Omitting it takes the pre-adapter code path.
  let adapter = null;
  if (raw?.adapter) {
    const bytes = Buffer.from(raw.adapter.bytes || []);
    if (!bytes.length || bytes.length > MAX_ADAPTER_BYTES) fail("open_voice_adapter_size_invalid", 413);
    const adapterSha256 = createHash("sha256").update(bytes).digest("hex");
    if (raw.adapter.sha256 && raw.adapter.sha256 !== adapterSha256) fail("open_voice_adapter_hash_mismatch", 409);
    const id = String(raw.adapter.id || "").toLowerCase();
    if (!ADAPTER_ID.test(id)) fail("open_voice_adapter_id_invalid", 400);
    adapter = Object.freeze({ id, bytes, sha256: adapterSha256 });
  }
  return Object.freeze({
    requestId: UUID.test(String(raw?.requestId || "")) ? String(raw.requestId).toLowerCase() : randomUUID(),
    reference,
    referenceSha256,
    referenceDurationMs: probe.durationMs,
    adapter,
    language,
    seed,
    renderedText,
    exaggeration: number(raw?.style?.exaggeration ?? 0.5, 0, 1.5, "open_voice_exaggeration_invalid"),
    cfgWeight: number(raw?.style?.cfgWeight ?? 0.5, 0, 1, "open_voice_cfg_weight_invalid"),
    temperature: number(raw?.style?.temperature ?? 0.8, 0.2, 1.5, "open_voice_temperature_invalid"),
  });
}

function byteStream(bytes, size = 11_520) {
  return (async function* () {
    for (let offset = 0; offset < bytes.length; offset += size) {
      yield new Uint8Array(bytes.subarray(offset, Math.min(bytes.length, offset + size)));
    }
  })();
}

async function remote(config, value, fetchImpl, signal) {
  const path = "/v1/synthesize";
  const payload = {
    request_id: value.requestId,
    text: value.renderedText,
    language_id: value.language,
    seed: value.seed,
    reference_audio_base64: value.reference.toString("base64"),
    reference_sha256: value.referenceSha256,
    exaggeration: value.exaggeration,
    cfg_weight: value.cfgWeight,
    temperature: value.temperature,
    ...(value.adapter ? {
      adapter_id: value.adapter.id,
      adapter_sha256: value.adapter.sha256,
      adapter_base64: value.adapter.bytes.toString("base64"),
    } : {}),
  };
  const body = Buffer.from(canonicalJson(payload));
  const bodyHash = sha256Hex(body);
  const timestamp = new Date().toISOString();
  const nonce = randomBytes(18).toString("base64url");
  let response;
  try {
    response = await fetchImpl(`${config.origin}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vyakti-Protocol": PROTOCOL,
        "X-Vyakti-Timestamp": timestamp,
        "X-Vyakti-Nonce": nonce,
        "X-Vyakti-Content-SHA256": bodyHash,
        "X-Vyakti-Signature": signature(config.transportSecret, [PROTOCOL, "POST", path, timestamp, nonce, bodyHash]),
      },
      body,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(210_000)]) : AbortSignal.timeout(210_000),
    });
  } catch { fail("open_voice_unreachable"); }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_RESPONSE_BYTES) fail("open_voice_response_size_invalid");
  const responseHash = sha256Hex(bytes);
  const expected = signature(config.transportSecret, [PROTOCOL, "response", path, nonce, String(response.status), responseHash]);
  if (!equal(response.headers.get("x-vyakti-response-signature"), expected)) fail("open_voice_response_signature_invalid");
  let result;
  try { result = JSON.parse(bytes.toString("utf8")); }
  catch { fail("open_voice_response_invalid"); }
  if (!response.ok) fail(String(result?.error || `open_voice_http_${response.status}`), response.status >= 500 ? 503 : 409);
  return result;
}

function verifiedResult(result, value) {
  if (String(result?.request_id || "").toLowerCase() !== value.requestId ||
      result?.reference_sha256 !== value.referenceSha256 ||
      Number(result?.reference_duration_ms) !== value.referenceDurationMs ||
      result?.model !== SERVICE_MODEL_NAME || result?.model_commitment !== MODEL_COMMITMENT ||
      result?.sample_rate !== VOICE_PCM_FORMAT.sampleRate || result?.channels !== VOICE_PCM_FORMAT.channels ||
      result?.encoding !== VOICE_PCM_FORMAT.encoding || result?.perth_watermark_verified !== true ||
      !Number.isFinite(Number(result?.perth_score)) || Number(result.perth_score) < 0.5) {
    fail("open_voice_response_binding_invalid");
  }
  // The adapter binding is checked with exactly the strictness of the model
  // binding above: the service must report back the same adapter it was sent,
  // and the commitment must be the one both sides derive independently. A
  // response that quietly dropped the adapter would otherwise be indistinguish-
  // able from a fine-tuned one — which is precisely the measurement error a
  // fine-tune-vs-zero-shot delta cannot survive.
  if ((result?.adapter_sha256 ?? null) !== (value.adapter?.sha256 ?? null) ||
      (result?.adapter_id ?? null) !== (value.adapter?.id ?? null) ||
      result?.synthesis_commitment !== synthesisCommitment(value.adapter?.sha256 || null)) {
    fail("open_voice_adapter_binding_invalid");
  }
  const pcm = Buffer.from(String(result.audio_base64 || ""), "base64");
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_RESPONSE_BYTES || sha256Hex(pcm) !== result.output_sha256)
    fail("open_voice_audio_binding_invalid");
  const expectedDuration = pcm.length / 2 / VOICE_PCM_FORMAT.sampleRate * 1000;
  if (Math.abs(Number(result.duration_ms) - expectedDuration) > 2 ||
      !Number.isFinite(Number(result.real_time_factor)) || Number(result.real_time_factor) <= 0)
    fail("open_voice_metrics_invalid");
  return Object.freeze({
    renderedText: value.renderedText,
    format: VOICE_PCM_FORMAT,
    stream: byteStream(pcm),
    receipt: Object.freeze({
      requestId: value.requestId,
      model: PROVIDER_NAME,
      modelCommitment: MODEL_COMMITMENT,
      adapterId: value.adapter?.id || null,
      adapterSha256: value.adapter?.sha256 || null,
      synthesisCommitment: synthesisCommitment(value.adapter?.sha256 || null),
      referenceSha256: value.referenceSha256,
      outputSha256: result.output_sha256,
      durationMs: Number(result.duration_ms),
      elapsedMs: Number(result.elapsed_ms),
      realTimeFactor: Number(result.real_time_factor),
      perthScore: Number(result.perth_score),
      perthWatermarkVerified: true,
    }),
  });
}

export function createOpenChatterboxPreviewProvider(options = {}) {
  const config = openChatterboxConfig(options.env || process.env);
  const fetchImpl = options.fetchImpl || fetch;
  return Object.freeze({
    name: PROVIDER_NAME,
    modelCommitment: MODEL_COMMITMENT,
    async synthesizePreview(raw) {
      const value = inputValue(raw);
      return verifiedResult(await remote(config, value, fetchImpl, raw?.signal), value);
    },
  });
}

export const OPEN_CHATTERBOX_MODEL_COMMITMENT = MODEL_COMMITMENT;
export const OPEN_CHATTERBOX_DISCLOSURE = SYNTHETIC_AUDIO_DISCLOSURE;
