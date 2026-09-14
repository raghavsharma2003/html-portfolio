import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { launchSuiteBrowser } from "./rehearsal/browser.mjs";
import { boundedWaitMs } from "./lib/bounded-wait.mjs";

let checks = 0;
async function check(name, run) {
  await run();
  console.log(`ok ${++checks} - ${name}`);
}

function loadCommonJs(source, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Blob, File, ArrayBuffer, DataView, Float32Array, Uint8Array, Math, Error, ...globals });
  return exports;
}

const transferSource = readFileSync(new URL("../src/studio/recordingUpload.ts", import.meta.url), "utf8");
const { transferRecording } = loadCommonJs(transferSource);
const retained = new File(["same-private-bytes"], "sample.wav", { type: "audio/wav" });

const cloneSource = readFileSync(new URL("../src/studio/CloneExperience.tsx", import.meta.url), "utf8");
const cloneParsed = ts.createSourceFile("CloneExperience.tsx", cloneSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const mediaShapeSource = cloneParsed.statements.filter((node) =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(cloneParsed) === "RECORDING_MIME_BY_EXTENSION"))
  || (ts.isFunctionDeclaration(node) && node.name?.text === "normalizeRecordingFile")
).map((node) => node.getText(cloneParsed)).join("\n");
const { normalizeRecordingFile } = loadCommonJs(`${mediaShapeSource}\nexports.normalizeRecordingFile = normalizeRecordingFile;`);

await check("mobile video with a generic MIME type keeps video kind and canonical upload type", async () => {
  const original = new File(["camera bytes"], "phone-capture.mp4", { type: "application/octet-stream", lastModified: 123 });
  const normalized = normalizeRecordingFile(original);
  assert.equal(normalized.kind, "video");
  assert.equal(normalized.file.type, "video/mp4");
  assert.equal(normalized.file.lastModified, 123);
  assert.equal(await normalized.file.text(), "camera bytes");
  assert.equal(normalizeRecordingFile(new File(["audio"], "voice.webm", { type: "audio/webm" })).kind, "audio");
});

await check("actual Studio binds reconciliation, visible failure, retry retention and failed-state exit", async () => {
  assert.equal((cloneSource.match(/transferRecording\(\{/gu) || []).length, 2);
  assert(/upload\.phase === "failed"[\s\S]*?upload\.message[\s\S]*?retryRef\.current\.sample/.test(cloneSource));
  assert(/busy=\{revoking \|\| Boolean\(upload && upload\.phase !== "failed"\)\}/.test(cloneSource));
  assert(/if \(pending\?\.sample\.url\) URL\.revokeObjectURL\(pending\.sample\.url\)/.test(cloneSource), "workspace change explicitly clears the local preview");
});

await check("lost PUT response reconciles with the same source and upload intent", async () => {
  const transferError = new Error("Private upload connection failed");
  const calls = [];
  const outcome = await transferRecording({
    file: retained,
    sourceId: "source-current-user",
    uploadIntentId: "intent-stable",
    put: async (file) => { calls.push(["put", file]); throw transferError; },
    finalize: async (sourceId, intent) => { calls.push(["finalize", sourceId, intent]); },
    onProgress() {}, onReconciling() { calls.push(["reconciling"]); }, isActive: () => true,
  });
  assert.equal(outcome, "reconciled");
  assert.equal(calls[0][1], retained);
  assert.deepEqual(calls.slice(1), [["reconciling"], ["finalize", "source-current-user", "intent-stable"]]);
});

await check("missing storage object preserves the original error and File for retry", async () => {
  const transferError = new Error("Private storage rejected the upload (403)");
  const options = {
    file: retained, sourceId: "source-current-user", uploadIntentId: "intent-stable",
    put: async (file) => { assert.equal(file, retained); throw transferError; },
    finalize: async () => { throw new Error("Storage object was not found"); },
    onProgress() {}, onReconciling() {}, isActive: () => true,
  };
  await assert.rejects(transferRecording(options), (cause) => cause === transferError);
  const retried = await transferRecording({ ...options, put: async (file) => { assert.equal(file, retained); } });
  assert.equal(retried, "uploaded");
});

await check("inactive account switch does not send a reconciliation request", async () => {
  let finalized = 0;
  const transferError = new Error("connection changed");
  await assert.rejects(transferRecording({
    file: retained, sourceId: "source-current-user", uploadIntentId: "intent-stable",
    put: async () => { throw transferError; }, finalize: async () => { finalized++; },
    onProgress() {}, onReconciling() {}, isActive: () => false,
  }), (cause) => cause === transferError);
  assert.equal(finalized, 0);
});

const wavSource = readFileSync(new URL("../src/studio/wavCapture.ts", import.meta.url), "utf8");
const wav = loadCommonJs(wavSource);
const samples = Float32Array.from({ length: 24_000 }, (_, index) => Math.sin(index / 18) * 0.2);
const encoded = wav.encodeWav24kMono(samples, 24_000);

await check("actual WAV helper emits internally consistent 24 kHz mono PCM", async () => {
  const info = await wav.inspectPcmWav24kMono(encoded);
  assert.deepEqual({ ...info }, { sampleRate: 24_000, channels: 1, bitsPerSample: 16, frames: 24_000, durationMs: 1_000 });
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  bytes[40] = 0;
  await assert.rejects(wav.inspectPcmWav24kMono(new Blob([bytes], { type: "audio/wav" })), /playable/);
});

await check("Chromium decodes and reports metadata for the actual helper WAV", async () => {
  const body = Buffer.from(await encoded.arrayBuffer());
  const server = createServer((request, response) => {
    if (request.url === "/sample.wav") {
      response.setHeader("Content-Type", "audio/wav");
      response.end(body);
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end("<audio id='sample' preload='metadata' src='/sample.wav'></audio>");
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    browser = await launchSuiteBrowser("recording-upload-repair");
    const page = await browser.newPage();
    page.setDefaultTimeout(boundedWaitMs(15_000));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => Number.isFinite(document.querySelector("audio")?.duration));
    const result = await page.evaluate(async () => {
      const audio = document.querySelector("audio");
      const bytes = await (await fetch("/sample.wav")).arrayBuffer();
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(bytes.slice(0));
      await context.close();
      return { metadataDuration: audio.duration, decodedDuration: decoded.duration, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels };
    });
    assert(Math.abs(result.metadataDuration - 1) < 0.01);
    assert(Math.abs(result.decodedDuration - 1) < 0.01);
    assert.equal(result.channels, 1);
    assert(result.sampleRate >= 24_000, "browser may decode into its output context rate");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

console.log(`PASS ${checks} recording/upload repair groups; local bytes and synthetic transport failures only, no account, provider, or cloud mutation.`);
