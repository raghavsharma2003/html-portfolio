// Offline provider-boundary checks. Every transport and budget is injected;
// no config file, cloud credential, native process, or live service is used.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createElevenLabsVoiceProvider, elevenLabsArmState, elevenLabsVoiceConfig,
} from "../api/_voice/providers/elevenlabs-pvc.js";
import { createVoiceProvider, createVoiceSynthesisProvider, createVoiceEraser } from "../api/_voice/registry.js";
import { encodeVendorRef } from "../api/_voice/providers/vendor-common.js";
import { composeProcessingAdapters, selectTranscriptionLane } from "../api/_replica-processing/composition.js";
import { createAzureFastTranscriptionAdapter } from "../api/_replica-processing/providers/azure-fast-transcription.js";

let checks = 0;
function check(name, action) {
  action();
  console.log(`ok ${++checks} - ${name}`);
}
async function refuses(name, action, code) {
  await assert.rejects(async () => action(), { code });
  console.log(`ok ${++checks} - ${name}`);
}
let requests = 0;
let budgetCalls = 0;
const noFetch = async () => { requests += 1; throw new Error("unexpected transport"); };
const noBudget = async () => { budgetCalls += 1; throw new Error("unexpected budget"); };
const guardedEnv = new Proxy({ VYAKTI_MODEL_SERVING: "azure_only" }, {
  get(target, key) {
    if (key === "VYAKTI_MODEL_SERVING") return target[key];
    throw new Error(`must refuse before reading ${String(key)}`);
  },
});
const denied = "model_serving_provider_denied";
await refuses("ElevenLabs config refuses before credentials or arm flags", () => elevenLabsVoiceConfig(guardedEnv), denied);
check("strict stored-voice arm is a platform refusal before configuration", () => {
  assert.deepEqual(elevenLabsArmState(guardedEnv), {
    armId: "elevenlabs", available: false, reason: denied, blocker: "waiting_on_us",
  });
});
for (const [name, factory] of [
  ["direct voice factory", (options) => createElevenLabsVoiceProvider(options)],
  ["stored provider name", (options) => createVoiceProvider("elevenlabs_voice_clone", options)],
  ["stored provider alias", (options) => createVoiceProvider("elevenlabs", options)],
  ["preview synthesis factory", (options) => createVoiceSynthesisProvider("elevenlabs", options)],
]) {
  await refuses(`${name} refuses before credentials, budget, and fetch`,
    () => factory({ env: guardedEnv, db: noBudget, fetchImpl: noFetch }), denied);
}

const vendorEnv = {
  VOICE_VENDOR_ARMS: "elevenlabs", ELEVENLABS_API_KEY: "fixture-0123456789abcdef0123456789",
  ELEVENLABS_DAILY_CHARACTERS: "20000",
};
const mutableEnv = { ...vendorEnv };
const constructed = createElevenLabsVoiceProvider({
  env: mutableEnv, db: noBudget, fetchImpl: noFetch,
  budget: Object.fromEntries(["reserve", "begin", "settle", "release", "uncertain"].map((key) => [key, noBudget])),
});
mutableEnv.VYAKTI_MODEL_SERVING = "azure_only";
for (const method of ["createVoice", "synthesizeStream", "synthesizePreview"]) {
  await refuses(`already constructed ${method} refuses when strict mode becomes active`, () => constructed[method]({}), denied);
}
check("all denied voice calls made zero transport and budget calls", () => {
  assert.equal(requests, 0);
  assert.equal(budgetCalls, 0);
});

// Turning serving off must not strand a historical biometric object.
for (const status of [204, 404]) {
  const deletions = [];
  const eraser = createVoiceEraser("elevenlabs_voice_clone", {
    env: { VYAKTI_MODEL_SERVING: "azure_only", ELEVENLABS_API_KEY: vendorEnv.ELEVENLABS_API_KEY },
    fetchImpl: async (url, init) => { deletions.push({ url, init }); return new Response(null, { status }); },
  });
  const result = await eraser.deleteVoice(encodeVendorRef("el1", { voiceId: "voice12345678", cloneMode: "instant" }));
  check(`strict historical erasure remains reachable for HTTP ${status}`, () => {
    assert.equal(result.deleted, true);
    assert.equal(deletions.length, 1);
    assert.equal(deletions[0].url, "https://api.elevenlabs.io/v1/voices/voice12345678");
    assert.equal(deletions[0].init.method, "DELETE");
  });
}
check("non-strict stored provider remains constructible", () => {
  assert.equal(createVoiceProvider("elevenlabs_voice_clone", { env: vendorEnv, db: noBudget, fetchImpl: noFetch }).name,
    "elevenlabs_voice_clone");
});

const azure = { value: null, code: "asr_unconfigured" };
const sarvam = { value: { name: "sarvam" }, code: "" };
check("strict selector retains unavailable Azure and never reads vendor settings", () => {
  assert.equal(selectTranscriptionLane(guardedEnv, azure, sarvam), azure);
});
check("legacy selector still uses Sarvam only when Azure is absent", () => {
  assert.equal(selectTranscriptionLane({}, azure, sarvam), sarvam);
  assert.equal(selectTranscriptionLane({ AZURE_SPEECH_KEY: "partial" }, azure, sarvam), azure);
});
check("negative control: removing strict selector guard restores forbidden fallback", () => {
  const source = readFileSync(new URL("../api/_replica-processing/composition.js", import.meta.url), "utf8");
  const body = source.match(/export function selectTranscriptionLane\(env, azure, sarvam\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body?.includes("isAzureOnlyServing(env) ||"));
  const mutant = new Function("env", "azure", "sarvam", body.replace("isAzureOnlyServing(env) ||", ""));
  assert.throws(() => assert.equal(mutant({ VYAKTI_MODEL_SERVING: "azure_only" }, azure, sarvam), azure), assert.AssertionError);
});

const bytes = Buffer.from("private fixture audio bytes");
const input = { duration_ms: 1000, mime: "audio/wav", sha256: createHash("sha256").update(bytes).digest("hex") };
const calls = [];
let sarvamReads = 0;
function compose(settings, fetchImpl = noFetch) {
  const env = { VYAKTI_MODEL_SERVING: "azure_only", ...settings };
  Object.defineProperty(env, "SARVAM_API_KEY", { get() { sarvamReads += 1; return "fixture-sarvam-0123456789abcdef"; } });
  return composeProcessingAdapters({
    env, config: {}, storageConfigured: true,
    storage: { resolveInput: async () => ({ body: bytes, mime: "audio/wav", byteSize: bytes.length }) },
    nativeToolStatus: {}, nativeToolRunners: { scanBytes: async () => {}, probeBytes: async () => {} },
    fetchImpl,
  });
}
for (const [name, settings, code] of [
  ["missing Azure", {}, "asr_unconfigured"],
  ["Azure key only", { AZURE_SPEECH_KEY: "fixture-key-0123456789" }, "asr_unconfigured"],
  ["Azure endpoint only", { AZURE_SPEECH_ENDPOINT: "https://fixture.cognitiveservices.azure.com" }, "azure_asr_auth_config_invalid"],
  ["invalid Azure key", { AZURE_SPEECH_ENDPOINT: "https://fixture.cognitiveservices.azure.com", AZURE_SPEECH_KEY: "short" }, "azure_asr_auth_config_invalid"],
  ["vendor endpoint", { AZURE_SPEECH_ENDPOINT: "https://api.sarvam.ai" }, "model_serving_origin_denied"],
  ["lookalike endpoint", { AZURE_SPEECH_ENDPOINT: "https://fixture.cognitiveservices.azure.com.attacker.test" }, "model_serving_origin_denied"],
  ["non-TLS endpoint", { AZURE_SPEECH_ENDPOINT: "http://fixture.cognitiveservices.azure.com" }, "model_serving_origin_denied"],
  ["nondefault port", { AZURE_SPEECH_ENDPOINT: "https://fixture.cognitiveservices.azure.com:444" }, "model_serving_origin_denied"],
  ["invalid Speech path", { AZURE_SPEECH_ENDPOINT: "https://fixture.cognitiveservices.azure.com/wrong" }, "azure_asr_endpoint_invalid"],
]) {
  const result = compose(settings);
  assert.deepEqual(result.capabilities.transcribe, { available: false, code }, name);
  await refuses(`composed ${name} refuses with no fallback`, () => result.adapters.transcribe.transcribe({}), code);
}
check("strict worker refusals never constructed Sarvam or dispatched a request", () => {
  assert.equal(sarvamReads, 0);
  assert.equal(requests, 0);
});
const configured = compose({
  AZURE_SPEECH_ENDPOINT: "https://fixture.cognitiveservices.azure.com",
  AZURE_SPEECH_KEY: "fixture-key-0123456789",
}, async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 503 }); });
await refuses("configured Azure failure remains Azure failure without vendor retry", () => configured.adapters.transcribe.transcribe({
  source: {}, inputs: [input], billing: { beforeProviderRequest: async () => {} },
}), "azure_asr_http_503");
check("actual composed Azure request forbids redirects and never falls back", () => {
  assert.equal(configured.capabilities.transcribe.available, true);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).origin, "https://fixture.cognitiveservices.azure.com");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(sarvamReads, 0);
});
let authReads = 0;
await refuses("direct Fast Transcription rejects invalid strict origin before authentication", () => createAzureFastTranscriptionAdapter({
  env: { VYAKTI_MODEL_SERVING: "azure_only" }, endpoint: "https://api.sarvam.ai",
  get apiKey() { authReads += 1; throw new Error("credential read"); }, fetchImpl: noFetch,
}), "model_serving_origin_denied");
check("invalid direct origin made zero authentication or transport calls", () => {
  assert.equal(authReads, 0);
  assert.equal(requests, 0);
});
const legacyCalls = [];
const legacy = createAzureFastTranscriptionAdapter({
  env: {}, endpoint: "https://fixture.cognitiveservices.azure.com:444", apiKey: "fixture-key-0123456789",
  resolveInput: async () => ({ body: bytes, mime: "audio/wav" }),
  fetchImpl: async (url, init) => { legacyCalls.push({ url, init }); return new Response(null, { status: 503 }); },
});
await refuses("legacy Azure transport retains existing failure behavior", () => legacy.transcribe({
  source: {}, inputs: [input], billing: { beforeProviderRequest: async () => {} },
}), "azure_asr_http_503");
check("non-strict transport preserves existing port and redirect policy", () => {
  assert.equal(new URL(legacyCalls[0].url).port, "444");
  assert.equal(legacyCalls[0].init.redirect, undefined);
});
console.log(`\n${checks} Azure-only voice/worker checks passed (offline injected transport only).`);
