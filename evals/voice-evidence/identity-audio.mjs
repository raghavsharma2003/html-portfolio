import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createAzureVoiceEvidenceAdapters } from "../../api/_replica-processing/providers/azure-voice-evidence.js";
import { canonicalJson, sha256Hex } from "../../api/_replica-processing/contracts.js";

// Real PCM and real request/response HMACs, injected transport only. Synthetic
// vectors exercise contracts; they provide no speaker or identity accuracy.
const SECRET = Buffer.alloc(32, 29);
const PROTOCOL = "vyakti-voice-evidence/v1";
const CONTRACT = "a".repeat(64);
const CAPTURE = Buffer.from("opaque capture fixture; service decoding is tested separately");
const INPUT = { mime: "video/webm", sha256: sha256Hex(CAPTURE) };
const ENV = { VYAKTI_MODEL_SERVING: "azure_only", AZURE_VOICE_EVIDENCE_ORIGIN: "https://evidence.test.azurecontainerapps.io",
  AZURE_VOICE_EVIDENCE_HMAC_SECRET: SECRET.toString("base64url") };
const PARAMETERS = { sample_rate_hz: 24000, channels: 1, sample_format: "pcm_s16le", max_frames: 720000,
  stream_policy: "one-video-one-audio", trim: false, pad: false, denoise: false };
const sign = (...parts) => createHmac("sha256", SECRET).update(parts.join("\n")).digest("base64url");
let checks = 0;
const ok = (name) => console.log(`ok ${++checks} - ${name}`);
function wav(frames = 24000) {
  const body = Buffer.alloc(44 + frames * 2);
  body.write("RIFF"); body.writeUInt32LE(body.length - 8, 4); body.write("WAVEfmt ", 8);
  body.writeUInt32LE(16, 16); body.writeUInt16LE(1, 20); body.writeUInt16LE(1, 22);
  body.writeUInt32LE(24000, 24); body.writeUInt32LE(48000, 28); body.writeUInt16LE(2, 32);
  body.writeUInt16LE(16, 34); body.write("data", 36); body.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index++) body.writeInt16LE(index % 2 ? -8000 : 8000, 44 + index * 2);
  return body;
}
function canonical(body) {
  const frames = (body.length - 44) / 2;
  return { audio_base64: body.toString("base64"), sha256: sha256Hex(body), byte_size: body.length,
    mime: "audio/wav", sample_rate_hz: 24000, channels: 1, sample_format: "pcm_s16le", frames, duration_ms: frames * 1000 / 24000 };
}
function fixture(body = wav()) {
  return { schema: "vyakti.identity-audio.v1", challenge_contract_sha256: CONTRACT, parent_sha256: INPUT.sha256,
    canonical: canonical(body), transform: { name: "capture-audio", version: "capture-to-pcm24k-v1",
      parameters: { ...PARAMETERS }, parameter_sha256: sha256Hex(canonicalJson(PARAMETERS)),
      decoder: { ffmpeg: "ffmpeg version test-local-decoder", ffprobe: "ffprobe version test-local-decoder" }, input_stream_index: 1 },
    speaker_input_sha256: sha256Hex(body), embeddings: [
      { input_key: "input-1", family: "speechbrain-ecapa-voxceleb", vector: Array(192).fill(0.01), confidence: 0.5 },
      { input_key: "input-1", family: "speechbrain-xvector-voxceleb", vector: Array(512).fill(0.02), confidence: 0.5 }],
    confidence: 0.5, measurements: { test_only: true }, quality: { held_out_cross_source_calibration_required: true },
    model_revisions: { "speechbrain-ecapa": "0f99f2d0ebe89ac095bcc5903c4dd8f72b367286",
      "speechbrain-xvector": "56895a2df401be4150a159f3a1c653f00051d477", "silero-vad": "6.2.1",
      "speechbrain-sepformer-whamr16k": "21a5b500c6f52fddc387c5d9e5fb13ffd6f039c5", "deepfilternet": "deepfilternet3-enroll24k-v1" } };
}
function harness({ payload = fixture(), forged = false, resolverBody = CAPTURE } = {}) {
  const calls = { reads: 0, wake: 0, post: 0 };
  const adapter = createAzureVoiceEvidenceAdapters({ env: ENV,
    resolveInput: async ({ source, input }) => {
      calls.reads++; assert.equal(source.marker, "private-source"); assert.equal(input.sha256, INPUT.sha256);
      return { mime: input.mime, byteSize: resolverBody.length, body: resolverBody };
    },
    fetchImpl: async (url, init) => {
      assert.equal(new URL(url).origin, ENV.AZURE_VOICE_EVIDENCE_ORIGIN);
      assert.equal(init.redirect, "error");
      if (new URL(url).pathname === "/healthz") {
        calls.wake++; assert.equal(init.method, "GET"); assert.equal(init.body, undefined);
        return new Response("{}", { status: 200 });
      }
      calls.post++; assert.equal(calls.wake, 1, "wake precedes signed request");
      const h = new Headers(init.headers), path = "/v1/analyze", hash = sha256Hex(Buffer.from(init.body));
      assert.equal(h.get("x-vyakti-content-sha256"), hash);
      assert.equal(h.get("x-vyakti-signature"), sign(PROTOCOL, "POST", path, h.get("x-vyakti-timestamp"), h.get("x-vyakti-nonce"), hash));
      const request = JSON.parse(init.body);
      assert.deepEqual(Object.keys(request).sort(), ["challenge_contract_sha256", "inputs", "operation"]);
      assert.equal(request.operation, "identity_audio_v1"); assert.equal(request.challenge_contract_sha256, CONTRACT);
      assert.equal(request.inputs.length, 1); assert.equal(request.inputs[0].sha256, INPUT.sha256);
      assert.deepEqual(Buffer.from(request.inputs[0].audio_base64, "base64"), CAPTURE);
      assert.equal(/private-source|artifact_id|object_path/.test(JSON.stringify(request)), false);
      const body = Buffer.from(JSON.stringify(payload));
      return new Response(body, { status: 200, headers: { "X-Vyakti-Response-Signature": forged ? "forged" :
        sign(PROTOCOL, "response", path, h.get("x-vyakti-nonce"), "200", sha256Hex(body)) } });
    } });
  return { calls, derive: (overrides = {}) => adapter.identity_audio.derive({ source: { marker: "private-source" },
    inputs: [INPUT], challengeContractSha256: CONTRACT, ...overrides }) };
}

for (const [name, body] of [["real PCM", wav()], ["exact 30 seconds", wav(720000)], ["fractional millisecond", wav(24001)]]) {
  const original = Buffer.from(CAPTURE), payload = fixture(body), test = harness({ payload });
  const value = await test.derive();
  assert.deepEqual(value.canonical.body, body); assert.equal(value.canonical.audio_base64, undefined);
  assert.equal(value.canonical.sha256, sha256Hex(body)); assert.equal(value.speaker_input_sha256, sha256Hex(body));
  assert.deepEqual(value.model_revisions, payload.model_revisions);
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.canonical) && Object.isFrozen(value.embeddings[0].vector));
  assert.deepEqual(CAPTURE, original); assert.deepEqual(test.calls, { reads: 1, wake: 1, post: 1 });
  ok(`${name}: signed binding, actual bytes and model revision metadata preserved`);
}
const mutations = [
  ["schema", (p) => p.schema = "vyakti.identity-audio.v2"],
  ["swapped parent", (p) => p.parent_sha256 = "b".repeat(64)],
  ["swapped contract", (p) => p.challenge_contract_sha256 = "b".repeat(64)],
  ["unknown response field", (p) => p.transcript = "not accepted"],
  ["byte count", (p) => p.canonical.byte_size++],
  ["canonical hash", (p) => p.canonical.sha256 = "b".repeat(64)],
  ["noncanonical base64", (p) => p.canonical.audio_base64 += "\n"],
  ["oversize base64", (p) => p.canonical.audio_base64 = "A".repeat(1920061)],
  ["sample rate metadata", (p) => p.canonical.sample_rate_hz = 16000],
  ["frame metadata", (p) => p.canonical.frames++],
  ["duration metadata", (p) => p.canonical.duration_ms++],
  ["one frame over 30 seconds", (p) => { const b = wav(720001); p.canonical = canonical(b); p.speaker_input_sha256 = sha256Hex(b); }],
  ["actual stereo header", (p) => { const b = wav(); b.writeUInt16LE(2, 22); p.canonical = canonical(b); p.speaker_input_sha256 = sha256Hex(b); }],
  ["transform version", (p) => p.transform.version = "unpinned"],
  ["transform parameter hash", (p) => p.transform.parameter_sha256 = "b".repeat(64)],
  ["rehashed trimming transform", (p) => { p.transform.parameters.trim = true; p.transform.parameter_sha256 = sha256Hex(canonicalJson(p.transform.parameters)); }],
  ["missing decoder revision", (p) => delete p.transform.decoder.ffmpeg],
  ["negative stream index", (p) => p.transform.input_stream_index = -1],
  ["speaker bytes swapped", (p) => p.speaker_input_sha256 = INPUT.sha256],
  ["swapped embedding input", (p) => p.embeddings[0].input_key = "input-2"],
  ["duplicate family", (p) => p.embeddings[1].family = p.embeddings[0].family],
  ["short vector", (p) => p.embeddings[0].vector = [0.1]],
  ["null vector item", (p) => p.embeddings[0].vector[0] = null],
  ["nonfinite vector item", (p) => p.embeddings[0].vector[0] = Infinity],
  ["coerced vector item", (p) => p.embeddings[0].vector[0] = "0.1"],
  ["zero vector", (p) => p.embeddings[0].vector.fill(0)],
  ["coerced confidence", (p) => p.embeddings[0].confidence = "0.5"],
  ["missing model revisions", (p) => delete p.model_revisions],
  ["adapter label as model revision", (p) => p.model_revisions["speechbrain-ecapa"] = "adapter-v1"],
];
for (const [name, mutate] of mutations) {
  const payload = fixture(); mutate(payload); const test = harness({ payload });
  await assert.rejects(test.derive(), /voice_evidence_identity_/);
  assert.equal(test.calls.post, 1); ok(`authenticated response rejects ${name}`);
}
for (const [name, override] of [["missing contract", { challengeContractSha256: undefined }],
  ["uppercase contract", { challengeContractSha256: "A".repeat(64) }], ["zero captures", { inputs: [] }],
  ["two captures", { inputs: [INPUT, INPUT] }], ["audio-only input", { inputs: [{ ...INPUT, mime: "audio/wav" }] }]]) {
  const test = harness(); await assert.rejects(test.derive(override), /voice_evidence_identity_/);
  assert.deepEqual(test.calls, { reads: 0, wake: 0, post: 0 }); ok(`${name} rejected before private read or dispatch`);
}
const badInput = harness({ resolverBody: Buffer.from("substituted capture") });
await assert.rejects(badInput.derive(), /voice_evidence_input_integrity_mismatch/);
assert.deepEqual(badInput.calls, { reads: 1, wake: 0, post: 0 }); ok("capture rehash failure never wakes or dispatches");
const forged = harness({ forged: true });
await assert.rejects(forged.derive(), /voice_evidence_response_signature_invalid/);
ok("otherwise valid identity audio cannot bypass response seal verification");
console.log(`\n${checks} identity audio API checks passed (injected transport; no model or network calls)`);
