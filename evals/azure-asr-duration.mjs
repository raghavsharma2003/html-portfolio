// Actual PCM probe/resampler/provider, synthetic audio and injected I/O only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as actual from "../api/_asr/providers/azure-speech-short.js";

let checks = 0;
const pass = (name) => console.log(`ok ${++checks} - ${name}`);
const RATE = 24_000;
const LIMIT_FRAMES = RATE * 60;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function pcm(frames) {
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(RATE, 24);
  bytes.writeUInt32LE(RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  // Alternating +/-8000 ensures a nonempty, unclipped, zero-mean signal.
  // This is a transport fixture, not speech or recognition evidence.
  bytes.fill(Buffer.from([0x40, 0x1f, 0xc0, 0xe0]), 44);
  return bytes;
}

function harness(module, source, duration = {}) {
  const originalHash = sha(source);
  const ref = { storageBucket: "fixture-bucket", storagePath: "owner/replica/window.wav",
    sha256: originalHash, mime: "audio/wav", byteSize: source.length, ...duration };
  const state = { reads: 0, requests: [] };
  const provider = module.createAzureSpeechShortProvider({
    env: { VYAKTI_MODEL_SERVING: "azure_only" },
    endpoint: "https://fixture.cognitiveservices.azure.com/", apiKey: "fixture-not-a-real-key",
    readAudio: async () => { state.reads++; return { body: source }; },
    fetchImpl: async (url, init) => {
      state.requests.push({ url: new URL(url), init });
      return new Response(JSON.stringify({ RecognitionStatus: "Success",
        NBest: [{ Display: "Synthetic transport fixture result", Confidence: 0.9 }] }));
    },
  });
  return { ref, state, provider, originalHash };
}

async function accepts(module, frames, duration = {}) {
  const source = pcm(frames);
  const test = harness(module, source, duration);
  const result = await test.provider.transcribe(test.ref, "en-IN");
  assert.equal(test.state.reads, 1);
  assert.equal(test.state.requests.length, 1);
  const { url, init } = test.state.requests[0];
  const transport = Buffer.from(init.body);
  assert.equal(url.origin, "https://fixture.cognitiveservices.azure.com");
  assert.equal(url.searchParams.get("language"), "en-IN");
  assert.equal(init.redirect, "error");
  assert.equal(transport.readUInt32LE(24), 16_000);
  assert.equal(transport.readUInt16LE(22), 1);
  assert.equal(transport.readUInt16LE(34), 16);
  const outputFrames = transport.readUInt32LE(40) / 2;
  assert.equal(outputFrames, Math.round(frames * 16_000 / RATE));
  assert.equal(sha(source), test.originalHash);
  assert.equal(result.provider, "azure-speech-short");
  return { test, outputFrames };
}

await accepts(actual, RATE * 1.2, { durationMs: 1_200 });
pass("valid short audio reaches the Azure-shaped transport with exact geometry and unchanged source");
const boundary = await accepts(actual, LIMIT_FRAMES);
assert.equal(boundary.outputFrames, 960_000);
pass("exactly sixty measured seconds dispatch once without duration metadata");

async function blocks(frames, duration, code = "azure_asr_short_window_too_long", expectedReads = 1) {
  const test = harness(actual, pcm(frames), duration);
  await assert.rejects(test.provider.transcribe(test.ref, "hi-IN"), (error) => {
    assert.equal(error.code, code);
    if (code === "azure_asr_short_window_too_long") assert.equal(error.status, 413);
    return true;
  });
  assert.equal(test.state.reads, expectedReads);
  assert.equal(test.state.requests.length, 0);
}

for (const [label, duration] of [
  ["omitted", {}], ["zero", { durationMs: 0 }], ["null", { durationMs: null }],
  ["empty", { durationMs: "" }], ["nonnumeric", { durationMs: "unknown" }],
  ["negative infinity", { durationMs: -Infinity }],
]) {
  await blocks(RATE * 61, duration);
  pass(`sixty-one measured seconds with ${label} metadata refuse before provider dispatch`);
}
await blocks(LIMIT_FRAMES + 1, {});
pass("one PCM frame over the limit refuses with omitted metadata");
await blocks(LIMIT_FRAMES + 1, { durationMs: 60_000 });
pass("one-frame excess refuses even when measured milliseconds round to the declared limit");
await blocks(LIMIT_FRAMES + 48, { durationMs: 60_000 });
pass("two-millisecond underreporting within probe drift tolerance cannot bypass the measured ceiling");
await blocks(RATE * 61, { durationMs: 59_000 }, "wav_duration_mismatch");
pass("larger metadata disagreement retains the existing mismatch refusal");
await blocks(RATE * 1.2, { durationMs: 60_001 }, "azure_asr_short_window_too_long", 0);
pass("declared over-limit metadata still refuses before private read");

const badHash = harness(actual, pcm(RATE * 1.2), { durationMs: 1_200 });
badHash.ref.sha256 = "0".repeat(64);
await assert.rejects(badHash.provider.transcribe(badHash.ref, "hi-IN"), { code: "azure_asr_short_audio_binding_invalid" });
assert.equal(badHash.state.requests.length, 0);
pass("hash mismatch remains a pre-dispatch integrity refusal");
const badWav = harness(actual, Buffer.alloc(44), {});
await assert.rejects(badWav.provider.transcribe(badWav.ref, "hi-IN"), { code: "wav_container_invalid" });
assert.equal(badWav.state.requests.length, 0);
pass("hash-matching invalid audio still fails the canonical probe");

// Execute deliberate defects in memory with the real imports and fake I/O.
// No temporary provider module, source overwrite or live network is needed.
const sourceUrl = new URL("../api/_asr/providers/azure-speech-short.js", import.meta.url);
const source = readFileSync(sourceUrl, "utf8");
const condition = "probe.frames * 1000 > probe.sampleRate * MAX_DURATION_MS";
assert.equal(source.split(condition).length, 2, "negative control requires one exact guard");
async function mutant(replacement) {
  const changed = source.replace(condition, replacement).replace(
    /from (["'])(\.{1,2}\/[^"']+)\1/g,
    (_, quote, relative) => `from ${JSON.stringify(new URL(relative, sourceUrl).href)}`,
  );
  return import(`data:text/javascript;base64,${Buffer.from(changed).toString("base64")}`);
}
const removed = await accepts(await mutant("false"), RATE * 61);
assert.ok(removed.outputFrames > 960_000);
pass("negative control: removing the frame guard dispatches an oversized payload through fake transport");
const rounded = await accepts(await mutant("probe.durationMs > MAX_DURATION_MS"), LIMIT_FRAMES + 1,
  { durationMs: 60_000 });
assert.equal(rounded.outputFrames, 960_001);
pass("negative control: rounded milliseconds alone dispatch one frame beyond Azure's duration ceiling");
console.log(`Azure ASR duration: ${checks} checks passed; synthetic PCM and injected I/O only, no cloud or model calls.`);
