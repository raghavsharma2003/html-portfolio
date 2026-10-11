import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAzureSpeechShortProvider } from "../api/_asr/providers/azure-speech-short.js";

let checks = 0;
const pass = name => console.log(`ok ${++checks} - ${name}`);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function pcm(frames = 28_800) {
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVE", 8);
  bytes.write("fmt ", 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24_000, 24); bytes.writeUInt32LE(48_000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  bytes.fill(Buffer.from([0x40, 0x1f, 0xc0, 0xe0]), 44);
  return bytes;
}
const response = () => new Response(JSON.stringify({ RecognitionStatus: "Success",
  NBest: [{ Display: "Synthetic fixture transcript", Confidence: 0.9 }] }));
const baseOptions = { env: { VYAKTI_MODEL_SERVING: "azure_only" },
  endpoint: "https://fixture.cognitiveservices.azure.com", apiKey: "fixture-not-a-real-key" };
function harness(bytes, respond = response) {
  const state = { reads: 0, calls: [] };
  const provider = createAzureSpeechShortProvider({ ...baseOptions,
    readAudio: async () => { state.reads++; return { body: bytes }; },
    fetchImpl: async (url, init) => { state.calls.push({ url: new URL(url), init }); return respond(); },
  });
  return { state, provider };
}
const input = (bytes, locale = "hi-IN") => ({ bytes, sha256: hash(bytes), byteSize: bytes.length, locale });

for (const locale of ["hi-IN", "en-IN"]) {
  const bytes = pcm();
  const original = Buffer.from(bytes);
  const { state, provider } = harness(bytes);
  const result = await provider.transcribeBytes(input(bytes, locale));
  assert.equal(state.reads, 0);
  assert.equal(state.calls.length, 1);
  const { url, init } = state.calls[0];
  assert.equal(url.origin, baseOptions.endpoint);
  assert.equal(url.searchParams.get("language"), locale);
  assert.equal(url.searchParams.get("format"), "detailed");
  assert.equal(init.redirect, "error");
  assert.equal(init.headers["Content-Type"], "audio/wav; codecs=audio/pcm; samplerate=16000");
  assert.equal(result.languageCode, locale);
  assert.equal(result.languageSource, "requested_hint");
  assert.equal(result.languageProbability, null);
  assert.equal(result.turns[0].t1, 1_200);
  assert.deepEqual(bytes, original);
  assert.deepEqual(result.audioCommitment, {
    inputSha256: hash(original), inputByteSize: original.length, inputSampleRate: 24_000, inputFrames: 28_800,
    transportSha256: hash(init.body), transportByteSize: init.body.length,
    transportSampleRate: 16_000, transportFrames: 19_200, transform: "pcm24k-to-pcm16k-windowed-sinc-v1",
  });
  assert.equal(init.body.readUInt32LE(24), 16_000);
  assert.equal(init.body.readUInt16LE(22), 1);
  assert.equal(init.body.readUInt16LE(34), 16);
  assert.notEqual(result.audioCommitment.inputSha256, result.audioCommitment.transportSha256);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.audioCommitment));
  pass(`${locale} byte input uses no storage, preserves canonical bytes and binds the actual transport derivative`);
}

const viewBacking = Buffer.concat([Buffer.alloc(7), pcm(), Buffer.alloc(9)]);
const view = new Uint8Array(viewBacking.buffer, viewBacking.byteOffset + 7, viewBacking.length - 16);
const viewTest = harness(view);
const viewResult = await viewTest.provider.transcribeBytes({ bytes: view, sha256: hash(view), byteSize: view.byteLength, locale: "en-IN" });
assert.equal(viewResult.audioCommitment.inputByteSize, view.byteLength);
assert.equal(viewResult.audioCommitment.inputSha256, hash(view));
assert.equal(viewTest.state.reads, 0);
pass("Uint8Array views hash only their own canonical bytes, excluding backing-buffer prefixes");

for (const locale of [undefined, "auto", "unknown", "hi-in", "en-US", ""]) {
  const bytes = pcm();
  const test = harness(bytes);
  await assert.rejects(test.provider.transcribeBytes({ ...input(bytes), locale }), { code: "azure_asr_short_locale_required" });
  assert.equal(test.state.reads, 0); assert.equal(test.state.calls.length, 0);
}
pass("six absent or unsupported locales refuse without guessed language or I/O");
const source = pcm();
for (const [label, fields] of [
  ["missing SHA", { sha256: undefined }], ["wrong SHA", { sha256: "0".repeat(64) }],
  ["missing byte count", { byteSize: undefined }], ["wrong byte count", { byteSize: source.length - 1 }],
  ["string byte count", { byteSize: String(source.length) }], ["zero byte count", { byteSize: 0 }],
  ["URL instead of bytes", { bytes: "https://private.invalid/audio.wav" }],
]) {
  const test = harness(source);
  await assert.rejects(test.provider.transcribeBytes({ ...input(source), ...fields }), { code: "azure_asr_short_audio_binding_invalid" });
  assert.equal(test.state.reads, 0); assert.equal(test.state.calls.length, 0);
  pass(`${label} cannot dispatch or manufacture a commitment`);
}
const changed = pcm();
const changedInput = input(changed);
changed[80] ^= 1;
const changedTest = harness(changed);
await assert.rejects(changedTest.provider.transcribeBytes(changedInput), { code: "azure_asr_short_audio_binding_invalid" });
assert.equal(changedTest.state.calls.length, 0);
pass("canonical bytes changed after hashing are rejected before transport");

const oversize = pcm(24_000 * 60 + 1);
const overTest = harness(oversize);
await assert.rejects(overTest.provider.transcribeBytes(input(oversize)), { code: "azure_asr_short_window_too_long", status: 413 });
assert.equal(overTest.state.reads, 0); assert.equal(overTest.state.calls.length, 0);
pass("one decoded frame beyond sixty seconds cannot use the internal byte seam");
const malformed = Buffer.alloc(44);
const malformedTest = harness(malformed);
await assert.rejects(malformedTest.provider.transcribeBytes(input(malformed)), { code: "wav_container_invalid" });
assert.equal(malformedTest.state.calls.length, 0);
pass("a matching hash does not replace canonical PCM validation");

const storageSource = pcm();
const storageTest = harness(storageSource);
const storageResult = await storageTest.provider.transcribe({ storageBucket: "fixture-bucket",
  storagePath: "owner/replica/window.wav", sha256: hash(storageSource), mime: "audio/wav",
  byteSize: storageSource.length, durationMs: 1_200 }, "auto");
assert.equal(storageTest.state.reads, 1);
assert.equal(storageResult.languageCode, "hi-IN");
assert.equal(storageResult.languageSource, "requested_hint");
assert.equal(storageResult.languageProbability, null);
assert.equal("audioCommitment" in storageResult, false);
const directTest = harness(storageSource);
await directTest.provider.transcribeBytes(input(storageSource));
assert.deepEqual(storageTest.state.calls[0].init.body, directTest.state.calls[0].init.body);
pass("storage-backed API preserves its result and language semantics while sharing exact transport bytes");

const unavailable = harness(source, () => new Response(JSON.stringify({ error: "fixture" }), { status: 503 }));
await assert.rejects(unavailable.provider.transcribeBytes(input(source)), { code: "azure_asr_short_http_503" });
assert.equal(unavailable.state.calls.length, 1);
pass("provider failure returns no successful transcript or commitment result");
assert.throws(() => createAzureSpeechShortProvider({ ...baseOptions, endpoint: "https://external.example" }),
  { code: "model_serving_origin_denied" });
pass("strict Azure origin validation remains a prerequisite for the byte method");
console.log(`Azure ASR bytes: ${checks} checks passed; synthetic PCM and injected transport only, no cloud or model calls.`);
