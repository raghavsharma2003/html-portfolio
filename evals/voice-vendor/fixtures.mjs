// Recorded HTTP fixtures for the vendor voice arms.
//
// HONEST PROVENANCE, STATED FIRST. These are NOT captures of live vendor
// traffic. There is no ElevenLabs key in this environment and the owner's
// Sarvam key returns Payment Required (`context/measurements.md`), and the
// workstream that wrote them was told to spend no money. What is recorded here
// is each vendor's DOCUMENTED response shape, transcribed from the public API
// reference on 2026-09-03 and pinned in the provider modules' headers, with
// deterministic synthetic audio standing in for the audio bytes.
//
// So these fixtures can prove: request shape, response parsing, format
// normalisation, budget fencing, erasure, and every failure path. They cannot
// prove that the vendor answers this way today. The first live call is the
// thing that proves that, it costs money, and it is the owner's to authorise.
import { createHash } from "node:crypto";

export const SAMPLE_RATE = 24_000;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Deterministic speech-shaped PCM: enough structure to pass the WAV probe's
 *  signal checks (rms, peak, active ratio) without pretending to be speech. */
export function tonePcm(durationMs, { rate = SAMPLE_RATE, f0 = 190, amplitude = 0.22 } = {}) {
  const samples = Math.round(durationMs * rate / 1000);
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const t = index / rate;
    const envelope = 0.6 + 0.4 * Math.sin(2 * Math.PI * 3.1 * t);
    const value = amplitude * envelope * (
      Math.sin(2 * Math.PI * f0 * t) * 0.7 +
      Math.sin(2 * Math.PI * f0 * 2 * t) * 0.2 +
      Math.sin(2 * Math.PI * f0 * 3 * t) * 0.1
    );
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), index * 2);
  }
  return pcm;
}

export function wrapWav(pcm, rate = SAMPLE_RATE, channels = 1) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export const REFERENCE_WAV = wrapWav(tonePcm(12_000));
export const ELEVENLABS_VOICE_ID = "vy7QK2mZ4pLdX1sTnAe0";

function response(status, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
    async text() { return bytes.toString("utf8"); },
  };
}

/**
 * A fetch stand-in that answers ONLY the recorded exchanges and records every
 * call it saw. An unrecorded URL throws: a fixture that quietly answers a
 * request nobody wrote down is how a wrong endpoint passes a test.
 */
export function recordedFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const key = `${method} ${String(url)}`;
    calls.push({ key, url: String(url), method, init });
    for (const [pattern, handler] of routes) {
      if (pattern instanceof RegExp ? pattern.test(key) : key === pattern) {
        return handler({ url: String(url), init, response });
      }
    }
    throw Object.assign(new Error(`unrecorded_request:${key}`), { code: "unrecorded_request" });
  };
  impl.calls = calls;
  return impl;
}

export const elevenLabsRoutes = ({
  synthesisBody = tonePcm(2_400),
  synthesisContentType = "audio/pcm",
  synthesisStatus = 200,
  voiceCategory = "cloned",
} = {}) => [
  [/^POST https:\/\/api\.elevenlabs\.io\/v1\/voices\/add$/,
    ({ response: make }) => make(200, { voice_id: ELEVENLABS_VOICE_ID, requires_verification: false })],
  [/^POST https:\/\/api\.elevenlabs\.io\/v1\/voices\/pvc$/,
    ({ response: make }) => make(200, { voice_id: ELEVENLABS_VOICE_ID })],
  [/^POST https:\/\/api\.elevenlabs\.io\/v1\/voices\/pvc\/[^/]+\/samples$/,
    ({ response: make }) => make(200, { voice_id: ELEVENLABS_VOICE_ID })],
  [/^GET https:\/\/api\.elevenlabs\.io\/v1\/voices\/[^/?]+$/,
    ({ response: make }) => make(200, {
      voice_id: ELEVENLABS_VOICE_ID, category: voiceCategory, fine_tuning: { state: "fine_tuned" },
    })],
  [/^POST https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\//,
    ({ response: make }) => (synthesisStatus === 200
      ? make(200, synthesisBody, { "content-type": synthesisContentType })
      : make(synthesisStatus, { detail: "recorded failure" }))],
  [/^DELETE https:\/\/api\.elevenlabs\.io\/v1\/voices\//,
    ({ response: make }) => make(200, { status: "ok" })],
];

export const sarvamRoutes = ({ status = 200, audioWav = wrapWav(tonePcm(2_100)) } = {}) => [
  [/^POST https:\/\/api\.sarvam\.ai\/text-to-speech$/, ({ response: make }) => (status === 200
    ? make(200, { request_id: "sarvam-req-0001", audios: [audioWav.toString("base64")] })
    : make(status, { error: { message: "recorded failure" } }))],
];

/** The consent attestation shape a vendor clone requires. Hashes only. */
export const CONSENT_ATTESTATION = Object.freeze({
  statementSha256: "a".repeat(64),
  audioSha256: "b".repeat(64),
  templateVersion: "microsoft-personal-voice-consent/en-US/v1",
  providerConsentId: "3f1c9a20-59d1-4b7e-9f2a-7c5f0d3e6a11",
});
