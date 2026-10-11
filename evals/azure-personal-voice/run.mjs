import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAzurePersonalVoiceInput,
  azurePersonalVoiceConfig,
  createAzurePersonalVoiceProvider,
  parseAzurePersonalVoiceRef,
} from "../../api/_voice/providers/azure-personal-voice.js";
import { probeEnrollmentWav } from "../../api/_audio/wav.js";
import { SYNTHETIC_AUDIO_DISCLOSURE, VOICE_PCM_FORMAT, assertSynthesisResult } from "../../api/_voice/contracts.js";
import { createVoiceProvider } from "../../api/_voice/registry.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const CONSENT_SOURCE = "20000000-0000-4000-8000-000000000002";
const VOICE_SOURCE = "30000000-0000-4000-8000-000000000003";
const SPEAKER_PROFILE = "40000000-0000-4000-8000-000000000004";

function pcmWav(durationMs, options = {}) {
  const sampleRate = options.sampleRate || 24_000;
  const channels = options.channels || 1;
  const bits = options.bits || 16;
  const frames = Math.round(durationMs * sampleRate / 1000);
  const blockAlign = channels * bits / 8;
  const dataBytes = frames * blockAlign;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * blockAlign, 28);
  bytes.writeUInt16LE(blockAlign, 32);
  bytes.writeUInt16LE(bits, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(dataBytes, 40);
  if (bits === 16) {
    for (let frame = 0; frame < frames; frame++) {
      const sample = options.silence ? 0 : options.clipped ? (frame % 2 ? -32_768 : 32_767) : Math.round(Math.sin(frame * 0.071) * 7_000);
      for (let channel = 0; channel < channels; channel++) bytes.writeInt16LE(sample, 44 + (frame * channels + channel) * 2);
    }
  }
  return bytes;
}

const consentBytes = pcmWav(7_000);
const voiceBytes = pcmWav(60_000);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

const env = {
  AZURE_PERSONAL_VOICE_ENABLED: "true",
  AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED: "true",
  AZURE_PERSONAL_VOICE_ENDPOINT: "https://speech-resource.cognitiveservices.azure.com",
  AZURE_PERSONAL_VOICE_TTS_ENDPOINT: "https://southeastasia.tts.speech.microsoft.com",
  AZURE_PERSONAL_VOICE_KEY: "test-secret-key-with-enough-length",
  AZURE_PERSONAL_VOICE_PROJECT_ID: "vyakti-self-replica",
  AZURE_PERSONAL_VOICE_COMPANY_NAME: "Vyakti",
  AZURE_PERSONAL_VOICE_BASE_MODEL: "PhoenixV2Neural",
  SUPABASE_URL: "https://private.example",
};

assert.throws(() => azurePersonalVoiceConfig({ ...env, AZURE_PERSONAL_VOICE_ENABLED: "false" }), /azure_personal_voice_disabled/);
assert.throws(() => azurePersonalVoiceConfig({ ...env, AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED: "false" }), /azure_personal_voice_approval_required/);
assert.throws(() => azurePersonalVoiceConfig({ ...env, AZURE_PERSONAL_VOICE_BASE_MODEL: "PhoenixLatestNeural" }), /model_must_be_version_pinned/);
ok("production Azure voice requires an explicit enable flag, Limited Access approval and a pinned base model", true);

const probed = probeEnrollmentWav(consentBytes, { expectedDurationMs: 7_000 });
ok("enrollment WAV is byte-probed as exact 24 kHz mono PCM16 with measured signal and duration",
  probed.durationMs === 7_000 && probed.sampleRate === 24_000 && probed.channels === 1 && probed.rms > 0.1);
assert.throws(() => probeEnrollmentWav(Buffer.from("RIFF not actually a wave")), /wav_container_invalid/);
assert.throws(() => probeEnrollmentWav(pcmWav(100, { sampleRate: 16_000 })), /wav_format_unsupported/);
assert.throws(() => probeEnrollmentWav(pcmWav(100, { channels: 2 })), /wav_format_unsupported/);
assert.throws(() => probeEnrollmentWav(pcmWav(100, { silence: true })), /wav_signal_missing/);
assert.throws(() => probeEnrollmentWav(pcmWav(100, { clipped: true })), /wav_clipping_excessive/);
assert.throws(() => probeEnrollmentWav(pcmWav(100), { expectedDurationMs: 200 }), /wav_duration_mismatch/);
const trailing = Buffer.concat([pcmWav(100), Buffer.from("hidden")]);
assert.throws(() => probeEnrollmentWav(trailing), /wav_container_length_mismatch/);
ok("polyglot tails, fake headers, silence, clipping, wrong shape and false durations fail closed", true);

const input = {
  replicaId: RID,
  genomeVersion: 3,
  idempotencyKey: "voice-build-idempotency-0001",
  consent: {
    sourceId: CONSENT_SOURCE,
    signedReadUrl: "https://private.example/storage/v1/object/sign/vyakti-replica-private/consent.wav?token=opaque",
    sha256: digest(consentBytes),
    mime: "audio/wav",
    durationMs: 7_000,
    locale: "en-IN",
    voiceTalentName: "Self replica owner",
  },
  references: [{
    sourceId: VOICE_SOURCE,
    signedReadUrl: "https://private.example/storage/v1/object/sign/vyakti-replica-private/voice.wav?token=opaque",
    sha256: digest(voiceBytes),
    mime: "audio/wav",
    durationMs: 60_000,
  }],
};

const normalized = assertAzurePersonalVoiceInput(input);
ok("enrollment accepts only an explicit provider consent asset plus 30-90 seconds of clean target audio",
  normalized.consent.locale === "en-IN" && normalized.references[0].durationMs === 60_000);
assert.throws(() => assertAzurePersonalVoiceInput({ ...input, references: [{ ...input.references[0], durationMs: 20_000 }] }), /training_duration_invalid/);
assert.throws(() => assertAzurePersonalVoiceInput({ ...input, consent: { ...input.consent, sourceId: VOICE_SOURCE } }), /reference_duplicate/);
ok("short quality-demo enrollment and consent/training source reuse fail closed", true);

const events = [];
let lastSsml = "";
let lastConsentForm;
let lastProfileForm;
const azureVoice = { id: "", consentId: "", projectId: env.AZURE_PERSONAL_VOICE_PROJECT_ID, status: "Succeeded", speakerProfileId: SPEAKER_PROFILE };
const fetchImpl = async (url, init = {}) => {
  const target = new URL(url);
  if (target.origin === "https://private.example") {
    events.push(`private:${target.pathname.includes("consent") ? "consent" : "voice"}`);
    const bytes = target.pathname.includes("consent") ? consentBytes : voiceBytes;
    return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length), "content-type": "audio/wav" } });
  }
  if (target.pathname.includes("/customvoice/consents/") && init.method === "POST") {
    events.push("azure:consent");
    lastConsentForm = init.body;
    const id = target.pathname.split("/").at(-1);
    return Response.json({ id, projectId: env.AZURE_PERSONAL_VOICE_PROJECT_ID, status: "Succeeded" }, { status: 201 });
  }
  if (target.pathname.includes("/customvoice/personalvoices/") && init.method === "POST") {
    events.push("azure:profile");
    lastProfileForm = init.body;
    const id = target.pathname.split("/").at(-1);
    const consentId = String(init.body.get("consentId"));
    Object.assign(azureVoice, { id, consentId });
    return Response.json(azureVoice, { status: 201 });
  }
  if (target.pathname.includes("/customvoice/personalvoices/") && init.method === "GET") {
    events.push("azure:status");
    return Response.json(azureVoice);
  }
  if (target.pathname === "/cognitiveservices/v1" && init.method === "POST") {
    events.push("azure:synthesis");
    lastSsml = String(init.body);
    assert.equal(init.headers["X-Microsoft-OutputFormat"], "raw-24khz-16bit-mono-pcm");
    return new Response(Uint8Array.from([1, 2, 3, 4, 5, 6]), { status: 200, headers: { "content-type": "audio/l16" } });
  }
  if (init.method === "DELETE") {
    events.push(`azure:delete:${target.pathname.includes("personalvoices") ? "voice" : "consent"}`);
    return new Response(null, { status: 204 });
  }
  throw new Error(`unexpected fetch ${init.method || "GET"} ${url}`);
};

let trainingReservations = 0;
const budget = {
  async reserve(_db, request) {
    events.push(`budget:reserve:${request.operation}`);
    if (request.operation === "voice_training") trainingReservations++;
    return {
      reservation_id: `reservation-${request.operation}`,
      budget_id: "azure-replica-grant-v1",
      request_hash: request.inputCommitment,
      state: request.operation === "voice_training" && trainingReservations > 1 ? "settled" : "reserved",
      operation: request.operation,
      unit_kind: request.operation === "voice_training" ? "requests" : "characters",
      reserved_units: request.operation === "voice_training" ? 1 : Buffer.byteLength(request.text, "utf8"),
      reserved_microusd: 1,
      config: {},
    };
  },
  async begin(_db, reservation) { events.push(`budget:begin:${reservation.operation}`); },
  async settle(_db, reservation, usage) { events.push(`budget:settle:${reservation.operation}:${usage.units}`); },
  async release(_db, reservation) { events.push(`budget:release:${reservation.operation}`); },
  async uncertain(_db, reservation) { events.push(`budget:uncertain:${reservation.operation}`); },
};

const provider = createAzurePersonalVoiceProvider({ env, fetchImpl, db: async () => [], budget, sleep: async () => {} });
ok("Azure Personal Voice advertises both native training and synthesis meters",
  provider.billing.voice_training.meter === "azure_personal_voice_profiles" &&
  provider.billing.synthesis.meter === "azure_personal_voice_characters");

const created = await provider.createVoice(input);
const ref = parseAzurePersonalVoiceRef(created.providerRef);
ok("provider enrollment returns one opaque server-only handle and ready state", created.state === "ready" && ref.voiceId === azureVoice.id && ref.consentId === azureVoice.consentId);
ok("private audio is hash-verified before the paid provider reservation begins",
  events.indexOf("private:voice") < events.indexOf("budget:reserve:voice_training"));
ok("training spend is reserved and marked in-flight before the first Azure call",
  events.indexOf("budget:begin:voice_training") < events.indexOf("azure:consent") && events.indexOf("azure:consent") < events.indexOf("azure:profile"));
ok("successful profile creation settles exactly one native profile unit",
  events.includes("budget:settle:voice_training:1") && !events.some((event) => event.startsWith("budget:uncertain:voice_training")));
ok("Azure receives the exact provider consent metadata and only verified prompt files",
  lastConsentForm.get("companyName") === "Vyakti" && lastConsentForm.get("voiceTalentName") === "Self replica owner" &&
  lastProfileForm.getAll("audiodata").length === 1);
const mutatingCallsBeforeRetry = events.filter((event) => event === "azure:consent" || event === "azure:profile").length;
const retried = await provider.createVoice(input);
ok("a settled enrollment retry reuses the exact provider profile without a second paid mutation",
  retried.providerRef === created.providerRef &&
  events.filter((event) => event === "azure:consent" || event === "azure:profile").length === mutatingCallsBeforeRetry);

ok("status polling resolves the provider handle server-side", await provider.getVoiceStatus(created.providerRef) === "ready");
const synthesis = assertSynthesisResult(await provider.synthesizeStream({
  providerRef: created.providerRef,
  text: "Use <care> & honesty.",
  requestKey: "generation-idempotency-0001",
}));
let pcmBytes = 0;
for await (const chunk of synthesis.stream) pcmBytes += chunk.byteLength;
ok("synthesis emits the existing raw 24 kHz mono PCM contract", JSON.stringify(synthesis.format) === JSON.stringify(VOICE_PCM_FORMAT) && pcmBytes === 6);
ok("audible disclosure is inside the metered SSML and user text is XML escaped",
  synthesis.renderedText.startsWith(SYNTHETIC_AUDIO_DISCLOSURE) && lastSsml.includes("Use &lt;care&gt; &amp; honesty.") &&
  lastSsml.includes(SPEAKER_PROFILE));
ok("synthesis spend is reserved and in-flight before Azure and settled before delivery",
  events.indexOf("budget:begin:synthesis") < events.indexOf("azure:synthesis") && events.indexOf("azure:synthesis") < events.findIndex((event) => event.startsWith("budget:settle:synthesis")));

await provider.deleteVoice(created.providerRef);
ok("revocation deletes both the personal voice and its provider consent copy",
  events.includes("azure:delete:voice") && events.includes("azure:delete:consent"));

const badOrigin = await assert.rejects(provider.createVoice({
  ...input,
  idempotencyKey: "voice-build-idempotency-0002",
  references: [{ ...input.references[0], signedReadUrl: "https://attacker.invalid/voice.wav" }],
}), /azure_personal_voice_signed_url_invalid/);
void badOrigin;
ok("provider download refuses SSRF and any origin outside private replica storage", true);

const beforeCallEvents = [];
const beforeCallProvider = createAzurePersonalVoiceProvider({
  env,
  db: async () => [],
  sleep: async () => {},
  fetchImpl: async (url) => {
    const bytes = url.includes("consent") ? consentBytes : voiceBytes;
    if (!url.startsWith("https://private.example")) beforeCallEvents.push("azure");
    return new Response(bytes, { status: 200 });
  },
  budget: {
    async reserve() { beforeCallEvents.push("reserve"); return { state: "reserved", operation: "voice_training" }; },
    async begin() { beforeCallEvents.push("begin_failed"); throw new Error("begin_failed"); },
    async settle() {},
    async uncertain() { beforeCallEvents.push("uncertain"); },
    async release() { beforeCallEvents.push("released"); },
  },
});
await assert.rejects(beforeCallProvider.createVoice({ ...input, idempotencyKey: "voice-build-idempotency-0004" }), /begin_failed/);
ok("a failed in-flight acknowledgement releases the reservation before any Azure mutation",
  beforeCallEvents.includes("released") && !beforeCallEvents.includes("azure") && !beforeCallEvents.includes("uncertain"));

const ambiguousEvents = [];
const ambiguousProvider = createAzurePersonalVoiceProvider({
  env,
  db: async () => [],
  sleep: async () => {},
  fetchImpl: async (url) => {
    if (url.startsWith("https://private.example"))
      return new Response(url.includes("consent") ? consentBytes : voiceBytes, { status: 200 });
    ambiguousEvents.push("azure_started");
    throw new Error("connection_lost");
  },
  budget: {
    async reserve() { return { state: "reserved", operation: "voice_training" }; },
    async begin() { ambiguousEvents.push("began"); },
    async settle() {},
    async uncertain() { ambiguousEvents.push("uncertain"); },
    async release() { ambiguousEvents.push("released"); },
  },
});
await assert.rejects(ambiguousProvider.createVoice({ ...input, idempotencyKey: "voice-build-idempotency-0005" }), /azure_personal_voice_unreachable/);
ok("a connection loss after Azure mutation starts retains spend for reconciliation",
  ambiguousEvents.join("|") === "began|azure_started|uncertain");

const tamperEvents = [];
const tampered = createAzurePersonalVoiceProvider({
  env,
  db: async () => [],
  budget: { ...budget, async reserve(...args) { tamperEvents.push("reserved"); return budget.reserve(...args); } },
  sleep: async () => {},
  fetchImpl: async (url) => new Response(url.includes("consent") ? consentBytes : Buffer.from("tampered"), { status: 200 }),
});
await assert.rejects(tampered.createVoice({ ...input, idempotencyKey: "voice-build-idempotency-0003" }), /audio_hash_mismatch/);
ok("tampered private audio is rejected before any paid reservation or Azure request", tamperEvents.length === 0);

const disguisedBytes = Buffer.from("RIFF-not-a-real-wave");
const structureEvents = [];
const disguised = createAzurePersonalVoiceProvider({
  env,
  db: async () => [],
  budget: { ...budget, async reserve(...args) { structureEvents.push("reserved"); return budget.reserve(...args); } },
  sleep: async () => {},
  fetchImpl: async (url) => new Response(url.includes("consent") ? consentBytes : disguisedBytes, { status: 200 }),
});
await assert.rejects(disguised.createVoice({
  ...input,
  idempotencyKey: "voice-build-idempotency-0006",
  references: [{ ...input.references[0], sha256: digest(disguisedBytes) }],
}), /wav_container_invalid/);
ok("a hash-valid disguised media payload is rejected before budget reservation or Azure mutation", structureEvents.length === 0);

await assert.rejects(provider.synthesizeStream({ providerRef: created.providerRef, text: "Hello" }), /synthesis_request_key_required/);
ok("client text alone cannot mint a paid synthesis retry identity", true);

assert.throws(() => parseAzurePersonalVoiceRef("azure:voice-id"), /ref_invalid/);
assert.throws(() => createVoiceProvider("azure_personal_voice", { db: async () => [], env: { ...env, AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED: "false" } }), /approval_required/);
ok("registry cannot bypass provider approval and malformed provider references stay server errors", true);

const providerSource = readFileSync(join(ROOT, "api/_voice/providers/azure-personal-voice.js"), "utf8");
const routeSource = readFileSync(join(ROOT, "api/replica-speech.js"), "utf8");
ok("production runtime passes the budget database but no fake-provider authority", /createVoiceProvider\(profile\.provider, \{ db: q \}\)/.test(routeSource) && !/allowFake/.test(routeSource));
ok("provider uses the current Azure API and fixed raw PCM output contract", providerSource.includes('const API_VERSION = "2026-01-01"') && providerSource.includes("raw-24khz-16bit-mono-pcm"));
ok("no Azure key or speaker profile enters the client contract", !readFileSync(join(ROOT, "src/studio/types.ts"), "utf8").includes("speakerProfileId"));

console.log(`\n${checks} Azure Personal Voice checks passed`);
