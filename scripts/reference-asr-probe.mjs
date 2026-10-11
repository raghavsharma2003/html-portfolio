// Ephemeral Container Apps Job override used to transcribe the exact 12-second
// owner reference window without exporting the job's Sarvam credential.
import { createHash } from "node:crypto";

const BUCKET = "vyakti-replica-private";
const OBJECT_PATH = "reference/owner-voice-20260826.wav";
const SOURCE_SHA256 = "c242261b9caa779eb6ddeeda24623c11c2aec01f8f7acafe47970bc17a1cb9b6";
const SAMPLE_RATE = 24_000;
const WINDOW_SECONDS = 12;

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SARVAM_API_KEY"];
for (const name of required) if (!process.env[name]) throw new Error(`missing_${name.toLowerCase()}`);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const url = `${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${OBJECT_PATH.split("/").map(encodeURIComponent).join("/")}`;
const stored = await fetch(url, {
  headers: {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
  signal: AbortSignal.timeout(120_000),
});
if (!stored.ok) throw new Error(`reference_download_http_${stored.status}`);
const wav = Buffer.from(await stored.arrayBuffer());
if (sha256(wav) !== SOURCE_SHA256) throw new Error("owner_reference_commitment_mismatch");

function pcmFromWav(bytes) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("reference_wav_invalid");
  let offset = 12;
  let format;
  let pcm;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") format = {
      codec: bytes.readUInt16LE(body), channels: bytes.readUInt16LE(body + 2),
      rate: bytes.readUInt32LE(body + 4), width: bytes.readUInt16LE(body + 14),
    };
    if (id === "data") pcm = bytes.subarray(body, body + size);
    offset = body + size + (size % 2);
  }
  if (!format || !pcm || format.codec !== 1 || format.channels !== 1 ||
      format.rate !== SAMPLE_RATE || format.width !== 16) throw new Error("reference_wav_invalid");
  return pcm;
}

function wrapWav(pcm) {
  const out = Buffer.alloc(44 + pcm.length);
  out.write("RIFF", 0); out.writeUInt32LE(36 + pcm.length, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SAMPLE_RATE, 24); out.writeUInt32LE(SAMPLE_RATE * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36);
  out.writeUInt32LE(pcm.length, 40); pcm.copy(out, 44);
  return out;
}

const pcm = pcmFromWav(wav);
const windowBytes = WINDOW_SECONDS * SAMPLE_RATE * 2;
const stepBytes = SAMPLE_RATE * 2;
let winner;
for (let offset = 0; offset + windowBytes <= pcm.length; offset += stepBytes) {
  let sumSquares = 0;
  let clipped = 0;
  for (let cursor = offset; cursor < offset + windowBytes; cursor += 2) {
    const sample = pcm.readInt16LE(cursor) / 32768;
    sumSquares += sample * sample;
    if (Math.abs(sample) >= 0.99) clipped += 1;
  }
  const rms = Math.sqrt(sumSquares / (windowBytes / 2));
  const score = rms - clipped * 0.001;
  if (!winner || score > winner.score) winner = { offset, rms, clipped, score };
}
if (!winner) throw new Error("owner_reference_too_short");
const reference = wrapWav(pcm.subarray(winner.offset, winner.offset + windowBytes));

const form = new FormData();
form.append("file", new Blob([reference], { type: "audio/wav" }), "owner-reference.wav");
form.append("model", "saarika:v2.5");
form.append("language_code", "en-IN");
const response = await fetch("https://api.sarvam.ai/speech-to-text", {
  method: "POST",
  headers: { "api-subscription-key": process.env.SARVAM_API_KEY },
  body: form,
  signal: AbortSignal.timeout(180_000),
});
const value = await response.json();
if (!response.ok) throw new Error(`reference_asr_http_${response.status}`);
const transcript = String(value?.transcript || "").trim();
const hasInvalidControl = [...transcript].some((character) => character.codePointAt(0) < 32 && character !== "\n" && character !== "\t");
if (transcript.length < 12 || transcript.length > 2_000 || hasInvalidControl)
  throw new Error("reference_asr_hypothesis_invalid");

console.log(`VYAKTI_REFERENCE_ASR_RESULT ${JSON.stringify({
  transcript,
  evidence_scope: "asr_unreviewed",
  source_sha256: SOURCE_SHA256,
  reference_sha256: sha256(reference),
  reference_offset_ms: Math.round(winner.offset / 2 / SAMPLE_RATE * 1000),
  reference_duration_ms: WINDOW_SECONDS * 1000,
})}`);
