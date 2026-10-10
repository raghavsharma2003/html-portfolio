import { ProcessingAdapterError, canonicalJson, sha256Hex } from "../contracts.js";
import { probeEnrollmentWav } from "../../_audio/wav.js";

const SHA = /^[0-9a-f]{64}$/;
const SAFE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const FAMILIES = new Set(["speechbrain-ecapa-voxceleb", "speechbrain-xvector-voxceleb"]);
const PARAMETERS = Object.freeze({ sample_rate_hz: 24000, channels: 1, sample_format: "pcm_s16le",
  max_frames: 720000, stream_policy: "one-video-one-audio", trim: false, pad: false, denoise: false });
const MAX_WAV_BYTES = 44 + PARAMETERS.max_frames * 2;

function fail(part) {
  const code = `voice_evidence_identity_${part}_invalid`;
  throw new ProcessingAdapterError(code, { code, retryable: false });
}

function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value, expected, part) {
  if (!record(value) || Object.keys(value).sort().join(",") !== expected.split(",").sort().join(",")) fail(part);
}
function digest(value) { return typeof value === "string" && SHA.test(value); }
function confidence(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function freezeJson(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

// This validates an authenticated service claim, not identity or model accuracy.
// The returned body is a private decoded copy; callers must still bind consent,
// challenge lease, nonce, language and verification evidence before settlement.
export function validateIdentityAudio(value, input, challengeContractSha256) {
  keys(value, "schema,challenge_contract_sha256,parent_sha256,canonical,transform,speaker_input_sha256,embeddings,confidence,measurements,quality,model_revisions", "response");
  if (value.schema !== "vyakti.identity-audio.v1") fail("schema");
  if (!digest(value.parent_sha256) || value.parent_sha256 !== input.sha256) fail("parent");
  if (!digest(value.challenge_contract_sha256) || value.challenge_contract_sha256 !== challengeContractSha256) fail("contract");
  const audio = value.canonical;
  keys(audio, "audio_base64,sha256,byte_size,mime,sample_rate_hz,channels,sample_format,frames,duration_ms", "canonical");
  if (typeof audio.audio_base64 !== "string" || !audio.audio_base64.length ||
      audio.audio_base64.length > 4 * Math.ceil(MAX_WAV_BYTES / 3) ||
      !Number.isSafeInteger(audio.byte_size) || audio.byte_size < 46 || audio.byte_size > MAX_WAV_BYTES) fail("bytes");
  const body = Buffer.from(audio.audio_base64, "base64");
  if (body.length !== audio.byte_size || body.toString("base64") !== audio.audio_base64 ||
      !digest(audio.sha256) || sha256Hex(body) !== audio.sha256) fail("bytes");
  let probe;
  try { probe = probeEnrollmentWav(body); } catch { fail("wav"); }
  // The service uses Python wave's canonical 44-byte header, without auxiliary
  // chunks. The exact frame count rejects even one excess frame at 30 seconds.
  if (body.length !== 44 + probe.frames * 2 || body.toString("ascii", 12, 16) !== "fmt " ||
      body.readUInt32LE(16) !== 16 || body.toString("ascii", 36, 40) !== "data" ||
      probe.frames > PARAMETERS.max_frames || audio.mime !== "audio/wav" ||
      audio.sample_rate_hz !== 24000 || audio.channels !== 1 || audio.sample_format !== "pcm_s16le" ||
      audio.frames !== probe.frames || audio.duration_ms !== probe.frames * 1000 / 24000) fail("geometry");

  const transform = value.transform;
  keys(transform, "name,version,parameters,parameter_sha256,decoder,input_stream_index", "transform");
  if (transform.name !== "capture-audio" || transform.version !== "capture-to-pcm24k-v1" ||
      canonicalJson(transform.parameters) !== canonicalJson(PARAMETERS) ||
      !digest(transform.parameter_sha256) || sha256Hex(canonicalJson(transform.parameters)) !== transform.parameter_sha256 ||
      !Number.isSafeInteger(transform.input_stream_index) || transform.input_stream_index < 0) fail("transform");
  keys(transform.decoder, "ffmpeg,ffprobe", "decoder");
  for (const tool of ["ffmpeg", "ffprobe"]) {
    const revision = transform.decoder[tool];
    if (typeof revision !== "string" || !revision.startsWith(`${tool} version `) ||
        revision.length <= tool.length + 9 || revision.length > 512 || /[\r\n\x00]/.test(revision)) fail("decoder");
  }
  if (value.speaker_input_sha256 !== audio.sha256) fail("speaker_input");
  if (!Array.isArray(value.embeddings) || value.embeddings.length !== 2) fail("embeddings");
  const families = new Set();
  for (const embedding of value.embeddings) {
    keys(embedding, "input_key,family,vector,confidence", "embeddings");
    if (!FAMILIES.has(embedding.family) || families.has(embedding.family) || embedding.input_key !== input.input_key ||
        !Array.isArray(embedding.vector) || embedding.vector.length < 64 || embedding.vector.length > 2048 ||
        embedding.vector.some((number) => typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > 10) ||
        !embedding.vector.some((number) => number !== 0) || !confidence(embedding.confidence)) fail("embeddings");
    families.add(embedding.family);
  }
  const revisions = value.model_revisions;
  if (!record(revisions) || Object.keys(revisions).length > 16 ||
      !/^[0-9a-f]{40}$/.test(revisions["speechbrain-ecapa"] || "") ||
      !/^[0-9a-f]{40}$/.test(revisions["speechbrain-xvector"] || "") || !revisions["silero-vad"] ||
      Object.entries(revisions).some(([name, revision]) => !SAFE.test(name) || typeof revision !== "string" || !SAFE.test(revision))) fail("model_revisions");
  if (!confidence(value.confidence) || !record(value.measurements) || !record(value.quality)) fail("measurements");
  const { audio_base64: _encoded, ...geometry } = audio;
  return Object.freeze({ ...value, canonical: Object.freeze({ ...geometry, body }),
    transform: freezeJson(transform), embeddings: freezeJson(value.embeddings),
    measurements: freezeJson(value.measurements), quality: freezeJson(value.quality), model_revisions: freezeJson(revisions) });
}
