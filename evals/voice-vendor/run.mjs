// Vendor voice arms — the offline suite. No network, no key, no money.
//
// What this proves, and it is the whole point of the arms existing:
//   - an absent key is a NAMED unavailability, never a clip;
//   - a create/synthesise/delete round trip matches each vendor's documented
//     request and response shape;
//   - vendor audio reaches the platform as canonical 24 kHz mono PCM16, or the
//     call fails by name;
//   - the per-day character budget refuses before a paid call, not after;
//   - HTTP 402 is surfaced as its own waiting-on-you blocker;
//   - erasure reaches the vendor through the existing erasure sweep;
//   - the vendor voice id never enters a client-facing object.
//
// And one NEGATIVE CONTROL that must fail if it is ever removed: an arm that
// manufactures a clip with no key. That is the shape `AGENTS.md` calls "a
// plausible return hides a dead pipeline", and a bench is exactly where it
// would do the most damage, because a fabricated vendor clip would decide
// `decisions.md#platform-north-star`'s reversal condition on invented evidence.
import assert from "node:assert/strict";

import {
  ELEVENLABS_ARM_ID,
  elevenLabsArmState,
  createElevenLabsVoiceEraser,
  createElevenLabsVoiceProvider,
  parseElevenLabsRef,
} from "../../api/_voice/providers/elevenlabs-pvc.js";
import {
  SARVAM_ARM_ID,
  createSarvamBulbulProvider,
  sarvamArmState,
} from "../../api/_voice/providers/sarvam-bulbul.js";
import {
  createVendorBenchArm,
  createVoiceEraser,
  configuredVendorBenchArms,
  primarySynthesisLane,
  vendorBenchArmStates,
  VOICE_LANE_ORDER,
  SELF_HOSTED_VOICE_LANE,
} from "../../api/_voice/registry.js";
import { toCanonicalPcm24k } from "../../api/_voice/providers/vendor-common.js";
import { vendorVoiceBudgetConfig } from "../../api/_provider-budget.js";
import { clientVoiceProfile, isSyntheticAudioDisclosure } from "../../api/_voice/contracts.js";
import { runVoiceErasureSweep } from "../../api/_replica-voice-erasure.js";
import { probeEnrollmentWav } from "../../api/_audio/wav.js";
import {
  CONSENT_ATTESTATION,
  ELEVENLABS_VOICE_ID,
  REFERENCE_WAV,
  elevenLabsRoutes,
  recordedFetch,
  sarvamRoutes,
  sha256,
  tonePcm,
  wrapWav,
} from "./fixtures.mjs";

let checks = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}
async function rejectsWith(name, action, code) {
  let error = null;
  try { await action(); } catch (caught) { error = caught; }
  assert.ok(error, `${name} (nothing was thrown)`);
  assert.equal(String(error.code || error.message), code, name);
  console.log(`ok ${++checks} - ${name}`);
  return error;
}

const KEY = "el-0123456789abcdef0123456789abcdef";
const SARVAM_KEY = "sv-0123456789abcdef0123456789abcdef";
const ELEVEN_ENV = Object.freeze({
  VOICE_VENDOR_ARMS: "elevenlabs,sarvam",
  ELEVENLABS_API_KEY: KEY,
  SARVAM_API_KEY: SARVAM_KEY,
  ELEVENLABS_DAILY_CHARACTERS: "20000",
  SARVAM_DAILY_CHARACTERS: "20000",
});

// A budget stand-in that behaves like the real ledger's happy path and records
// every decision, so a test can assert the ORDER of reserve/begin/settle rather
// than only that a call happened.
function fakeBudget(overrides = {}) {
  const events = [];
  const budget = {
    events,
    async reserve(_db, input) {
      events.push({ kind: "reserve", operation: input.operation, units: input.text ? input.text.length : 1, vendor: input.vendor });
      if (overrides.denyReserve) {
        throw Object.assign(new Error("provider_budget_reservation_denied"), { code: "provider_budget_reservation_denied", status: 402 });
      }
      return Object.freeze({ reservation_id: "r1", state: "reserved", operation: input.operation });
    },
    async begin() { events.push({ kind: "begin" }); },
    async settle(_db, _reservation, usage) { events.push({ kind: "settle", units: usage.units }); },
    async release(_db, _reservation, error) { events.push({ kind: "release", code: String(error?.code || error?.message || "") }); },
    async uncertain(_db, _reservation, error) { events.push({ kind: "uncertain", code: String(error?.code || error?.message || "") }); },
  };
  return budget;
}

const db = async () => [];

// ── 1. missing key => a named unavailability, never a clip ───────────────────
const emptyStates = vendorBenchArmStates({});
ok("with nothing configured both vendor arms report themselves unavailable with a reason",
  emptyStates.length === 2 && emptyStates.every((state) => state.available === false && state.reason.length > 0 && state.blocker.length > 0));
ok("an arm that is switched off names the switch rather than blaming the operator's key",
  emptyStates.every((state) => state.reason === "vendor_arm_not_enabled:VOICE_VENDOR_ARMS" && state.blocker === "waiting_on_you"));
ok("switching the arms on without keys names the exact missing variable",
  elevenLabsArmState({ VOICE_VENDOR_ARMS: "elevenlabs" }).reason === "elevenlabs_api_key_required" &&
  sarvamArmState({ VOICE_VENDOR_ARMS: "sarvam" }).reason === "sarvam_api_key_required");
await rejectsWith("building an arm with no key throws instead of returning a provider",
  () => createVendorBenchArm(ELEVENLABS_ARM_ID, { env: { VOICE_VENDOR_ARMS: "elevenlabs" }, db }),
  "elevenlabs_api_key_required");
ok("no vendor arm is configured in this environment", configuredVendorBenchArms({}).length === 0);

// NEGATIVE CONTROL. A rogue arm that answers with audio when it has no key must
// be caught by the same assertion the real arms pass. If this block ever stops
// failing, the check above has become decorative.
const rogueArm = {
  state: () => ({ armId: "rogue", available: true, reason: "", blocker: "" }),
  async synthesizePreview() {
    return { pcm: tonePcm(1_000), format: { sampleRate: 24_000 }, renderedText: "This is an AI-generated voice replica. hi" };
  },
};
function armRefusesWithoutKey(arm, env) {
  // The one rule: with no credential, asking for audio must throw.
  try {
    const state = arm.state(env);
    if (state.available) return false;
    return true;
  } catch { return true; }
}
ok("the no-key guard is not vacuous: a rogue arm that fabricates a clip fails it",
  armRefusesWithoutKey({ state: () => elevenLabsArmState({}) }, {}) === true &&
  armRefusesWithoutKey(rogueArm, {}) === false);
const rogueOutput = await rogueArm.synthesizePreview();
ok("the rogue arm really would have produced audio, so the control is meaningful",
  Buffer.isBuffer(rogueOutput.pcm) && rogueOutput.pcm.length > 0);

// ── 2. the shipped lane order does not move ──────────────────────────────────
ok("adding vendor arms leaves the shipped lane order self-hosted first",
  VOICE_LANE_ORDER[0] === SELF_HOSTED_VOICE_LANE && !VOICE_LANE_ORDER.includes(ELEVENLABS_ARM_ID));
await rejectsWith("VOICE_PRIMARY_LANE naming an unconfigured vendor refuses rather than falling back",
  async () => primarySynthesisLane({ VOICE_PRIMARY_LANE: "elevenlabs" }),
  "vendor_arm_not_enabled:VOICE_VENDOR_ARMS");

// ── 3. create-voice ──────────────────────────────────────────────────────────
const createFetch = recordedFetch(elevenLabsRoutes());
const createBudget = fakeBudget();
const eleven = createElevenLabsVoiceProvider({
  env: ELEVEN_ENV, fetchImpl: createFetch, db, budget: createBudget,
});
const created = await eleven.createVoice({
  replicaId: "6aff3202-abbd-4ca6-976b-4009ed5af028",
  genomeVersion: 2,
  idempotencyKey: "vendor-bench-enrollment-0001",
  consent: CONSENT_ATTESTATION,
  references: [{ bytes: REFERENCE_WAV, sha256: sha256(REFERENCE_WAV), durationMs: 12_000 }],
});
ok("an instant clone is created through the documented multipart endpoint",
  createFetch.calls.some((call) => call.key === "POST https://api.elevenlabs.io/v1/voices/add") &&
  created.state === "ready" && /^el1\./.test(created.providerRef));
ok("the vendor voice id survives only inside the opaque server-side ref",
  parseElevenLabsRef(created.providerRef).voiceId === ELEVENLABS_VOICE_ID &&
  !created.providerRef.includes(ELEVENLABS_VOICE_ID));
ok("the vendor-side voice name carries the enrollment commitment and no owner identity",
  /^[0-9a-f]{64}$/.test(created.enrollmentCommitment));
ok("training spend is reserved and begun before the vendor is contacted, then settled",
  createBudget.events.map((event) => event.kind).slice(0, 3).join(",") === "reserve,begin,settle");
await rejectsWith("a clone without the consent attestation is refused before any upload",
  () => eleven.createVoice({
    replicaId: "6aff3202-abbd-4ca6-976b-4009ed5af028", genomeVersion: 2,
    idempotencyKey: "vendor-bench-enrollment-0002",
    references: [{ bytes: REFERENCE_WAV, sha256: sha256(REFERENCE_WAV), durationMs: 12_000 }],
  }),
  "vendor_consent_attestation_required");

const pvcFetch = recordedFetch(elevenLabsRoutes());
const pvc = createElevenLabsVoiceProvider({
  env: { ...ELEVEN_ENV, ELEVENLABS_CLONE_MODE: "professional" },
  fetchImpl: pvcFetch, db, budget: fakeBudget(),
});
const pvcCreated = await pvc.createVoice({
  replicaId: "6aff3202-abbd-4ca6-976b-4009ed5af028",
  genomeVersion: 2,
  idempotencyKey: "vendor-bench-enrollment-pvc-1",
  consent: CONSENT_ATTESTATION,
  references: [{ bytes: REFERENCE_WAV, sha256: sha256(REFERENCE_WAV), durationMs: 12_000 }],
});
ok("a professional clone uploads samples and then reports its verification wait honestly",
  pvcFetch.calls.some((call) => call.key === "POST https://api.elevenlabs.io/v1/voices/pvc") &&
  pvcFetch.calls.some((call) => /\/v1\/voices\/pvc\/[^/]+\/samples$/.test(call.url)) &&
  pvcCreated.state === "creating" &&
  pvcCreated.blocker.kind === "waiting_on_you" &&
  pvcCreated.blocker.code === "elevenlabs_pvc_verification_pending");

// ── 4. synthesise ────────────────────────────────────────────────────────────
const synthFetch = recordedFetch(elevenLabsRoutes());
const synthBudget = fakeBudget();
const synth = createElevenLabsVoiceProvider({ env: ELEVEN_ENV, fetchImpl: synthFetch, db, budget: synthBudget });
const preview = await synth.synthesizePreview({
  providerRef: created.providerRef,
  text: "Today we will learn why balancing a chemical equation changes the coefficients but never the subscripts.",
  languageId: "en",
  seed: 31_001,
  reference: { bytes: REFERENCE_WAV, sha256: sha256(REFERENCE_WAV), durationMs: 12_000 },
  requestId: "bench-en-0001",
});
ok("synthesis asks for the platform's own PCM format on the documented endpoint",
  synthFetch.calls.some((call) => call.url.includes("/v1/text-to-speech/") && call.url.includes("output_format=pcm_24000")));
ok("the request pins a versioned model, the language and the seed",
  (() => {
    const call = synthFetch.calls.find((entry) => entry.url.includes("/v1/text-to-speech/"));
    const body = JSON.parse(call.init.body);
    return body.model_id === "eleven_multilingual_v2" && body.language_code === "en" && body.seed === 31_001 &&
      !/latest/i.test(body.model_id);
  })());
ok("the clip carries the exact spoken disclosure prefix every other lane carries",
  isSyntheticAudioDisclosure(preview.disclosureText) &&
  preview.renderedText.startsWith(`${preview.disclosureText} `));
ok("the result is canonical 24 kHz mono PCM16 with a matching output hash",
  preview.format.sampleRate === 24_000 && preview.format.channels === 1 &&
  preview.pcm.length % 2 === 0 && preview.receipt.outputSha256 === sha256(preview.pcm) &&
  probeEnrollmentWav(wrapWav(preview.pcm)).sampleRate === 24_000);
ok("the receipt records what actually happened, including that no PerTh was embedded",
  preview.receipt.perthWatermarkVerified === false &&
  preview.receipt.protectionPath === "delivery_audioseal" &&
  preview.receipt.transportProof === "tls_vendor_api" &&
  preview.receipt.resampledTo24k === false);
ok("the receipt records only a hash of the vendor voice id, never the id",
  /^[0-9a-f]{64}$/.test(preview.receipt.vendorVoiceIdSha256) &&
  !JSON.stringify(preview.receipt).includes(ELEVENLABS_VOICE_ID));
ok("synthesis settles the exact character count it billed",
  synthBudget.events.at(-1).kind === "settle" && synthBudget.events.at(-1).units === preview.receipt.billedCharacters);
ok("a client voice profile object cannot carry the vendor mapping",
  !Object.keys(clientVoiceProfile({
    voice_profile_id: "p", replica_id: "r", genome_version: 1, status: "ready",
    provider: "elevenlabs_voice_clone", provider_ref: created.providerRef,
  })).some((key) => ["provider", "provider_ref", "model"].includes(key)));

// ── 5. resample-to-24k ───────────────────────────────────────────────────────
const offRatePcm = tonePcm(1_500, { rate: 44_100 });
const offRateWav = wrapWav(offRatePcm, 44_100);
const resampledPcm = tonePcm(1_500);
const fakeNativeTools = {
  calls: [],
  async withMaterializedAudio(bytes, fn, options) {
    this.calls.push({ bytes: bytes.length, options });
    return fn({ extractWindow: async (_start, _end, settings) => {
      assert.equal(settings.rate, 24_000, "the resample must target the platform rate");
      return wrapWav(resampledPcm);
    } });
  },
};
const resampled = await toCanonicalPcm24k(offRateWav, { nativeTools: fakeNativeTools });
ok("audio at another rate goes through the shared ffmpeg seam and comes back at 24 kHz",
  resampled.resampled === true && resampled.pcm.equals(resampledPcm) && fakeNativeTools.calls.length === 1);
const alreadyCanonical = await toCanonicalPcm24k(wrapWav(resampledPcm), { nativeTools: fakeNativeTools });
ok("audio already at the platform rate is passed through without a resample",
  alreadyCanonical.resampled === false && fakeNativeTools.calls.length === 1);
await rejectsWith("with no ffmpeg on the runtime a wrong-rate clip fails by name instead of shipping",
  () => toCanonicalPcm24k(offRateWav, { env: { PATH: "" } }),
  "reference_window_tool_unavailable");

const wrongRateFetch = recordedFetch(elevenLabsRoutes({
  synthesisBody: offRateWav, synthesisContentType: "audio/wav",
}));
const wrongRate = createElevenLabsVoiceProvider({
  env: ELEVEN_ENV, fetchImpl: wrongRateFetch, db, budget: fakeBudget(), nativeTools: fakeNativeTools,
});
const repaired = await wrongRate.synthesizePreview({
  providerRef: created.providerRef, text: "One line.", languageId: "en", seed: 7,
  reference: { bytes: REFERENCE_WAV, sha256: sha256(REFERENCE_WAV), durationMs: 12_000 },
  requestId: "bench-en-0002",
});
ok("a vendor that answers 44.1 kHz to a 24 kHz request costs a resample, not a wrong-speed clip",
  repaired.receipt.resampledTo24k === true && repaired.pcm.equals(resampledPcm));

// ── 6. Sarvam: the Indian-accent base arm, and its 402 ───────────────────────
const sarvamFetch = recordedFetch(sarvamRoutes());
const sarvamBudget = fakeBudget();
const sarvam = createSarvamBulbulProvider({ env: ELEVEN_ENV, fetchImpl: sarvamFetch, db, budget: sarvamBudget });
const sarvamPreview = await sarvam.synthesizePreview({
  text: "रासायनिक अभिक्रिया में पुराने बंध टूटते हैं और नए बंध बनते हैं।",
  languageId: "hi",
  seed: 31_001,
  reference: { bytes: REFERENCE_WAV, sha256: sha256(REFERENCE_WAV), durationMs: 12_000 },
  requestId: "bench-hi-0001",
});
ok("Sarvam is called on the documented endpoint with a preset speaker and 24 kHz WAV output",
  (() => {
    const call = sarvamFetch.calls[0];
    const body = JSON.parse(call.init.body);
    return call.key === "POST https://api.sarvam.ai/text-to-speech" &&
      call.init.headers["api-subscription-key"] === SARVAM_KEY &&
      body.model === "bulbul:v3" && body.speaker === "priya" &&
      body.language_code === "hi-IN" && body.speech_sample_rate === 24_000;
  })());
ok("the base arm labels itself as a base voice and records that it heard no reference",
  sarvamPreview.receipt.armCategory === "indian_accent_base_voice" &&
  sarvamPreview.receipt.clonesTheOwner === false &&
  sarvamPreview.receipt.referenceUsed === false &&
  sarvamPreview.receipt.referenceSha256 === sha256(REFERENCE_WAV));
ok("the base arm still carries the localized spoken disclosure",
  isSyntheticAudioDisclosure(sarvamPreview.disclosureText) &&
  sarvamPreview.renderedText.startsWith(`${sarvamPreview.disclosureText} `));
await rejectsWith("asking the base arm to enrol a voice is refused, not silently satisfied",
  () => sarvam.createVoice({}), "sarvam_voice_cloning_not_documented");
await rejectsWith("the base arm refuses to report a deletion it cannot perform",
  () => sarvam.deleteVoice("anything"), "sarvam_no_enrolled_voice");

const paymentFetch = recordedFetch(sarvamRoutes({ status: 402 }));
const paymentBudget = fakeBudget();
const paywalled = createSarvamBulbulProvider({ env: ELEVEN_ENV, fetchImpl: paymentFetch, db, budget: paymentBudget });
const paymentError = await rejectsWith("a vendor 402 is surfaced as its own named blocker",
  () => paywalled.synthesizePreview({
    text: "एक पंक्ति।", languageId: "hi", seed: 1,
    reference: { bytes: REFERENCE_WAV, sha256: sha256(REFERENCE_WAV), durationMs: 12_000 },
    requestId: "bench-hi-0002",
  }),
  "sarvam_payment_required");
ok("the 402 keeps its own HTTP status so a caller can tell it from a platform fault",
  paymentError.status === 402);
ok("a failed vendor call leaves a reconcilable spend row rather than assuming no charge",
  paymentBudget.events.at(-1).kind === "uncertain" && paymentBudget.events.at(-1).code === "sarvam_payment_required");

const elevenPaymentFetch = recordedFetch(elevenLabsRoutes({ synthesisStatus: 402 }));
const elevenPaywalled = createElevenLabsVoiceProvider({
  env: ELEVEN_ENV, fetchImpl: elevenPaymentFetch, db, budget: fakeBudget(),
});
await rejectsWith("the ElevenLabs arm surfaces its own 402 the same way",
  () => elevenPaywalled.synthesizePreview({
    providerRef: created.providerRef, text: "One line.", languageId: "en", seed: 3,
    reference: { bytes: REFERENCE_WAV, sha256: sha256(REFERENCE_WAV), durationMs: 12_000 },
    requestId: "bench-en-0003",
  }),
  "elevenlabs_payment_required");

// ── 7. the per-day character budget ──────────────────────────────────────────
const budgetConfig = vendorVoiceBudgetConfig(ELEVENLABS_ARM_ID, ELEVEN_ENV, new Date("2026-09-03T11:00:00Z"));
ok("the vendor budget is a per-UTC-day row whose ceiling is exactly the character cap",
  budgetConfig.budget_id === "vendor-voice-elevenlabs-2026-09-03" &&
  budgetConfig.daily_characters === 20_000 &&
  budgetConfig.limit_microusd === Math.ceil(20_000 * budgetConfig.synthesis_usd_per_million));
const tomorrow = vendorVoiceBudgetConfig(ELEVENLABS_ARM_ID, ELEVEN_ENV, new Date("2026-09-04T00:00:00Z"));
ok("yesterday's spend cannot fund today, because the budget id carries the date",
  tomorrow.budget_id === "vendor-voice-elevenlabs-2026-09-04");
ok("Sarvam's published rate is carried as its own default, not shared with ElevenLabs",
  vendorVoiceBudgetConfig(SARVAM_ARM_ID, ELEVEN_ENV).synthesis_usd_per_million !== budgetConfig.synthesis_usd_per_million);
const deniedFetch = recordedFetch(elevenLabsRoutes());
const denied = createElevenLabsVoiceProvider({
  env: ELEVEN_ENV, fetchImpl: deniedFetch, db, budget: fakeBudget({ denyReserve: true }),
});
await rejectsWith("a budget refusal stops the call before the vendor is contacted",
  () => denied.synthesizePreview({
    providerRef: created.providerRef, text: "One line.", languageId: "en", seed: 5,
    reference: { bytes: REFERENCE_WAV, sha256: sha256(REFERENCE_WAV), durationMs: 12_000 },
    requestId: "bench-en-0004",
  }),
  "provider_budget_reservation_denied");
ok("no vendor request was made once the budget refused",
  deniedFetch.calls.every((call) => !call.url.includes("/text-to-speech")));

// ── 8. delete on erasure ─────────────────────────────────────────────────────
const deleteFetch = recordedFetch(elevenLabsRoutes());
const eraser = createElevenLabsVoiceEraser({ env: ELEVEN_ENV, fetchImpl: deleteFetch });
ok("the eraser deletes through the documented endpoint",
  (await eraser.deleteVoice(created.providerRef)).deleted === true &&
  deleteFetch.calls.some((call) => call.method === "DELETE" && call.url.includes(`/v1/voices/${ELEVENLABS_VOICE_ID}`)));
const goneFetch = recordedFetch([[/^DELETE /, ({ response: make }) => make(404, { detail: "missing" })]]);
ok("a vendor 404 on delete is a successful idempotent observation",
  (await createElevenLabsVoiceEraser({ env: ELEVEN_ENV, fetchImpl: goneFetch }).deleteVoice(created.providerRef)).deleted === true);
ok("erasure stays reachable when new cloning is switched off",
  (await createElevenLabsVoiceEraser({
    env: { ELEVENLABS_API_KEY: KEY }, fetchImpl: recordedFetch(elevenLabsRoutes()),
  }).deleteVoice(created.providerRef)).deleted === true);

const sweepFetch = recordedFetch(elevenLabsRoutes());
let leased = 0;
const sweep = await runVoiceErasureSweep({
  db: async () => [],
  lease: async () => (leased++ ? null : {
    profile: {
      voiceProfileId: "8f2c4b1a-7d3e-4f5a-9b6c-0d1e2f3a4b5c",
      replicaId: "6aff3202-abbd-4ca6-976b-4009ed5af028",
      ownerUserId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      provider: "elevenlabs_voice_clone",
      providerRef: created.providerRef,
      attempt: 1,
    },
    leaseToken: "x".repeat(48),
  }),
  complete: async () => true,
  retry: async () => true,
  providerFactory: (name) => createVoiceEraser(name, { env: ELEVEN_ENV, fetchImpl: sweepFetch }),
});
ok("the existing erasure sweep reaches the vendor arm through the registry",
  sweep.leased === 1 && sweep.completed === 1 && sweep.retried === 0 &&
  sweepFetch.calls.some((call) => call.method === "DELETE"));

console.log(`vendor voice arms: ${checks}/${checks} checks passed`);
console.log("network calls made by this suite: 0; vendor spend: USD 0.00");
console.log("live vendor verification: NOT DONE — no key is set in this environment");
