// Azure Speech's short-audio REST lane for a live Mirror Call.
//
// Mirror Call records canonical 24 kHz mono PCM16 WAV because that same object
// is also the fidelity/provenance authority. Azure's short-audio REST endpoint
// accepts 16 kHz mono PCM16 WAV, so this provider creates an in-memory transport
// derivative only. The stored object and its SHA never change.
import { createHash } from "node:crypto";
import { probeEnrollmentWav } from "../../_audio/wav.js";
import { readPrivateReplicaObject } from "../../_replica-storage.js";
import { asrInput, asrResult, langHint } from "../contracts.js";
import { assertAzureServingOrigin } from "../../_model-serving-policy.js";

const NAME = "azure-speech-short";
const MODEL = "azure-speech-short-v1";
const MAX_DURATION_MS = 60_000;
const MAX_AUDIO_BYTES = 33_554_432;
const MAX_RESPONSE_BYTES = 1_048_576;
const PATH = "/stt/speech/recognition/conversation/cognitiveservices/v1";

function fail(code, status = 502, details) {
  throw Object.assign(new Error(code), { code, status, details });
}

function endpoint(value) {
  let url;
  try { url = new URL(String(value || "")); }
  catch { fail("azure_asr_short_endpoint_required", 503); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")) {
    fail("azure_asr_short_endpoint_invalid", 503);
  }
  return url.origin;
}

function dataChunk(bytes) {
  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", cursor, cursor + 4);
    const size = bytes.readUInt32LE(cursor + 4);
    const start = cursor + 8;
    const end = start + size;
    if (!Number.isSafeInteger(end) || end > bytes.length) fail("azure_asr_short_wav_invalid", 409);
    if (kind === "data") return { start, size };
    cursor = end + (size % 2);
  }
  fail("azure_asr_short_wav_invalid", 409);
}

function sinc(value) {
  if (Math.abs(value) < 1e-9) return 1;
  const angle = Math.PI * value;
  return Math.sin(angle) / angle;
}

/** Deterministic 24 kHz PCM16 -> 16 kHz PCM16 transport conversion.
 * A 33-tap Hamming-windowed sinc low-pass limits aliasing before downsampling.
 */
export function resample24kPcm16To16kWav(value, expectedDurationMs) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  const probe = probeEnrollmentWav(bytes, { expectedDurationMs });
  // Metadata can be absent or within the probe's rounding tolerance. Bound
  // actual PCM frames before allocating or resampling the transport audio.
  if (probe.frames * 1000 > probe.sampleRate * MAX_DURATION_MS) {
    fail("azure_asr_short_window_too_long", 413, {
      max_ms: MAX_DURATION_MS,
      duration_ms: probe.frames * 1000 / probe.sampleRate,
    });
  }
  const chunk = dataChunk(bytes);
  const inputFrames = chunk.size / 2;
  const outputFrames = Math.max(1, Math.round(inputFrames * 16_000 / 24_000));
  const output = Buffer.allocUnsafe(44 + outputFrames * 2);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(output.length - 8, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(16_000, 24);
  output.writeUInt32LE(32_000, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(outputFrames * 2, 40);

  const radius = 16;
  const cutoff = 0.31;
  for (let outIndex = 0; outIndex < outputFrames; outIndex++) {
    const position = outIndex * 24_000 / 16_000;
    const center = Math.floor(position);
    let sum = 0;
    let weightSum = 0;
    for (let sourceIndex = center - radius; sourceIndex <= center + radius; sourceIndex++) {
      if (sourceIndex < 0 || sourceIndex >= inputFrames) continue;
      const distance = position - sourceIndex;
      const window = 0.54 + 0.46 * Math.cos(Math.PI * distance / (radius + 1));
      const weight = 2 * cutoff * sinc(2 * cutoff * distance) * window;
      sum += bytes.readInt16LE(chunk.start + sourceIndex * 2) * weight;
      weightSum += weight;
    }
    const sample = weightSum ? Math.round(sum / weightSum) : 0;
    output.writeInt16LE(Math.max(-32_768, Math.min(32_767, sample)), 44 + outIndex * 2);
  }
  return Object.freeze({
    bytes: output,
    durationMs: Math.round(outputFrames * 1000 / 16_000),
    source: probe,
    transform: "pcm24k-to-pcm16k-windowed-sinc-v1",
  });
}

function boundAudioBytes(bytes, sha256, byteSize) {
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(byteSize) || byteSize < 1 ||
      typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256) || bytes.byteLength !== byteSize) {
    fail("azure_asr_short_audio_binding_invalid", 409);
  }
  if (byteSize > MAX_AUDIO_BYTES) fail("azure_asr_short_audio_too_large", 413);
  // Own a snapshot before any asynchronous work. The caller's canonical bytes
  // stay unchanged and cannot be substituted while the request is in flight.
  const source = Buffer.from(bytes);
  if (createHash("sha256").update(source).digest("hex") !== sha256) {
    fail("azure_asr_short_audio_binding_invalid", 409);
  }
  return source;
}

export function createAzureSpeechShortProvider(options = {}) {
  const origin = endpoint(options.endpoint || options.env?.AZURE_SPEECH_ENDPOINT || process.env.AZURE_SPEECH_ENDPOINT);
  assertAzureServingOrigin(origin, options.env || process.env);
  const apiKey = String(options.apiKey || options.env?.AZURE_SPEECH_KEY || process.env.AZURE_SPEECH_KEY || "");
  if (!apiKey) fail("azure_asr_short_key_required", 503);
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(options.timeoutMs || 60_000);
  const readAudio = options.readAudio || ((ref) => readPrivateReplicaObject({
    storageBucket: ref.storageBucket,
    objectPath: ref.storagePath,
  }, { fetchImpl, maxBytes: MAX_AUDIO_BYTES, timeoutMs }));

  async function transcribeVerifiedAudio(source, language, expectedDurationMs) {
    const transport = resample24kPcm16To16kWav(source, expectedDurationMs);
    // Byte/transform commitments only. MODEL is the adapter label, not an
    // immutable revision of Microsoft's hosted acoustic model.
    const audioCommitment = Object.freeze({
      inputSha256: createHash("sha256").update(source).digest("hex"),
      inputByteSize: source.length,
      inputSampleRate: transport.source.sampleRate,
      inputFrames: transport.source.frames,
      transportSha256: createHash("sha256").update(transport.bytes).digest("hex"),
      transportByteSize: transport.bytes.length,
      transportSampleRate: 16_000,
      transportFrames: transport.bytes.readUInt32LE(40) / 2,
      transform: transport.transform,
    });
    const url = new URL(`${origin}${PATH}`);
    url.searchParams.set("language", language);
    url.searchParams.set("format", "detailed");

    let response;
    try {
      response = await fetchImpl(url, {
        redirect: "error",
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey,
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
          Accept: "application/json",
        },
        body: transport.bytes,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { fail("azure_asr_short_unreachable", 503); }

    const responseBytes = Buffer.from(await response.arrayBuffer());
    if (!responseBytes.length || responseBytes.length > MAX_RESPONSE_BYTES) {
      fail("azure_asr_short_response_invalid");
    }
    let payload;
    try { payload = JSON.parse(responseBytes.toString("utf8")); }
    catch { fail("azure_asr_short_response_invalid"); }
    if (!response.ok) {
      fail(`azure_asr_short_http_${response.status}`, response.status === 429 ? 429 : 502);
    }
    const status = String(payload?.RecognitionStatus || "");
    const transcript = String(payload?.NBest?.[0]?.Display || payload?.DisplayText || "").trim();
    if (status !== "Success" || !transcript) fail("azure_asr_short_transcript_empty", 422);
    const result = asrResult({
      turns: [{ speaker: "SPEAKER_00", text: transcript, t0: 0, t1: expectedDurationMs || transport.durationMs }],
      provider: NAME,
      model: MODEL,
      languageCode: language,
      languageSource: "requested_hint",
      transcriptConfidence: payload?.NBest?.[0]?.Confidence ?? null,
    }, { name: NAME, model: MODEL });
    return { result, audioCommitment };
  }

  return Object.freeze({
    name: NAME,
    model: MODEL,
    maxDurationMs: MAX_DURATION_MS,
    async transcribe(rawRef, hint = "hi-IN") {
      const ref = asrInput(rawRef);
      const requestedLanguage = langHint(hint);
      const language = requestedLanguage === "auto" ? "hi-IN" : requestedLanguage;
      if (ref.durationMs && ref.durationMs > MAX_DURATION_MS) {
        fail("azure_asr_short_window_too_long", 413, { max_ms: MAX_DURATION_MS, duration_ms: ref.durationMs });
      }
      const object = await readAudio(ref);
      const source = boundAudioBytes(Buffer.from(object?.body || []), ref.sha256, ref.byteSize);
      const { result } = await transcribeVerifiedAudio(source, language, ref.durationMs || undefined);
      return result;
    },
    // Internal byte seam: caller authorization and capture-to-audio provenance
    // remain the caller's responsibility. No storage locator is fabricated.
    async transcribeBytes(input) {
      if (!new Set(["hi-IN", "en-IN"]).has(input?.locale)) fail("azure_asr_short_locale_required", 400);
      const source = boundAudioBytes(input?.bytes, input?.sha256, input?.byteSize);
      const { result, audioCommitment } = await transcribeVerifiedAudio(source, input.locale);
      return Object.freeze({ ...result, audioCommitment });
    },
  });
}
