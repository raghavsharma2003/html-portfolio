import { assertVoiceProvider } from "./contracts.js";
import {
  azurePersonalVoiceConfig,
  createAzurePersonalVoiceEraser,
  createAzurePersonalVoiceProvider,
} from "./providers/azure-personal-voice.js";
import {
  ELEVENLABS_ARM_ID,
  ELEVENLABS_PROVIDER_NAME,
  createElevenLabsVoiceEraser,
  createElevenLabsVoiceProvider,
  elevenLabsArmState,
} from "./providers/elevenlabs-pvc.js";
import { createFakeVoiceProvider } from "./providers/fake.js";
import {
  createOpenChatterboxPreviewProvider,
  openChatterboxConfig,
} from "./providers/open-chatterbox-preview.js";
import {
  SARVAM_ARM_ID,
  SARVAM_PROVIDER_NAME,
  createSarvamBulbulProvider,
  sarvamArmState,
} from "./providers/sarvam-bulbul.js";
import { VENDOR_ARMS_ENV, enabledVendorArms } from "./providers/vendor-common.js";

// ── Provider selection order ──────────────────────────────────────────────
// SPEC-GURUKUL.md §8.1 (owner reweight, 2026-08-26): "The self-hosted lane
// (`services/open-voice-runtime`, open weights on our own GPUs, fine-tuned per
// expert) is the PRIMARY voice path, not the fallback. Azure Personal Voice
// drops to optional; its Microsoft Limited Access application is no longer on
// the critical path."
//
// So the order below is self-hosted FIRST and vendor second, and it is the one
// place that order is written down. It is not a taste call and it is not
// permanent: `context/decisions.md#platform-north-star` records the exact
// reversal condition — *"Reverses if: the self-hosted lane's fidelity bench
// stays materially below the vendor lane after fine-tuning effort (then vendor
// becomes primary again and in-house stays the research track — measured, not
// assumed)."* The bench that decides it is `api/_fidelity.js` +
// `vy_voice_fidelity`; flipping this array back is the whole edit.
//
// HONEST SCOPE, do not read more into the order than is here. The two lanes do
// not yet cover the same surface:
//   - `open_chatterbox_multilingual_v3` is ZERO-SHOT. It implements
//     `synthesizePreview` only — there is no enrolled voice to create, poll or
//     delete, so it satisfies no part of `assertVoiceProvider`'s four-function
//     contract. It is primary for SYNTHESIS.
//   - `azure_personal_voice` is the only lane implementing the persistent
//     enrolled-voice lifecycle (createVoice/getVoiceStatus/synthesizeStream/
//     deleteVoice), so it remains the only lane `createVoiceProvider` can
//     return today.
// The gap is named rather than papered over: until the self-hosted runtime
// grows a persistent-profile surface, "primary" means primary in lane order and
// in the synthesis path, not that the enrolment path has moved. Nothing here
// silently falls back — every helper below fails closed with the same
// `voice_provider_unavailable` string the registry has always thrown, so a
// lane that is not configured is indistinguishable from a lane that does not
// exist.
export const SELF_HOSTED_VOICE_LANE = "open_chatterbox_multilingual_v3";
export const VENDOR_VOICE_LANE = "azure_personal_voice";
export const VOICE_LANE_ORDER = Object.freeze([SELF_HOSTED_VOICE_LANE, VENDOR_VOICE_LANE]);

const LANE_CONFIG = Object.freeze({
  [SELF_HOSTED_VOICE_LANE]: openChatterboxConfig,
  [VENDOR_VOICE_LANE]: azurePersonalVoiceConfig,
});

// A lane is "configured" when its own config function accepts the environment.
// The config functions are the authority — this never re-reads env var names,
// because a second copy of that list is a second thing to forget to update.
export function voiceLaneConfigured(lane, env = process.env) {
  const config = LANE_CONFIG[lane];
  if (!config) return false;
  try {
    config(env);
    return true;
  } catch {
    return false;
  }
}

export function configuredVoiceLanes(env = process.env) {
  return VOICE_LANE_ORDER.filter((lane) => voiceLaneConfigured(lane, env));
}

// The primary lane: first CONFIGURED lane in the order above. With both
// configured this is always the self-hosted one — that is the flip. With
// neither configured it throws rather than guessing, same as every other
// unavailable-provider path here.
export function primaryVoiceLane(env = process.env) {
  const [lane] = configuredVoiceLanes(env);
  if (!lane) throw new Error("voice_provider_unavailable");
  return lane;
}

// ── vendor BENCH arms ────────────────────────────────────────────────────────
// These are the arms that make `platform-north-star`'s reversal condition
// testable, and they are deliberately NOT in `VOICE_LANE_ORDER`. The shipped
// lane order above is unchanged by their existence: an operator who sets
// `ELEVENLABS_API_KEY` gets a bench arm and nothing else, and the studio panel
// keeps calling the self-hosted lane exactly as it did.
//
// One env var moves that, and only one: `VOICE_PRIMARY_LANE`. It is read here
// and nowhere else, it accepts only a lane this file already knows, and it
// throws rather than falling through if the lane it names is not configured —
// an operator who asks for a vendor primary and silently gets the self-hosted
// one has been told the opposite of the truth about what produced their audio.
export const VENDOR_BENCH_ARMS = Object.freeze([ELEVENLABS_ARM_ID, SARVAM_ARM_ID]);

const BENCH_ARM_STATE = Object.freeze({
  [ELEVENLABS_ARM_ID]: elevenLabsArmState,
  [SARVAM_ARM_ID]: sarvamArmState,
});

const BENCH_ARM_FACTORY = Object.freeze({
  [ELEVENLABS_ARM_ID]: createElevenLabsVoiceProvider,
  [SARVAM_ARM_ID]: createSarvamBulbulProvider,
});

/** Every bench arm and why it is or is not usable. Never a bare false. */
export function vendorBenchArmStates(env = process.env) {
  return Object.freeze(VENDOR_BENCH_ARMS.map((armId) => BENCH_ARM_STATE[armId](env)));
}

export function configuredVendorBenchArms(env = process.env) {
  return Object.freeze(vendorBenchArmStates(env).filter((state) => state.available).map((state) => state.armId));
}

/**
 * Build a vendor bench arm. Refuses unless the arm is BOTH switched on in
 * `VOICE_VENDOR_ARMS` and fully configured, and the refusal carries the arm's
 * own reason so a caller can print "waiting on you: ELEVENLABS_API_KEY" instead
 * of a generic unavailable.
 */
export function createVendorBenchArm(armId, options = {}) {
  const env = options.env || process.env;
  const factory = BENCH_ARM_FACTORY[armId];
  if (!factory) throw Object.assign(new Error("voice_provider_unavailable"), { code: "voice_provider_unavailable" });
  const state = BENCH_ARM_STATE[armId](env);
  if (!state.available) {
    throw Object.assign(new Error(state.reason), { code: state.reason, blocker: state.blocker, armId, status: 503 });
  }
  return factory({ ...options, env });
}

/**
 * The primary synthesis lane, honouring `VOICE_PRIMARY_LANE` when it names a
 * vendor arm. Default (unset) is the shipped order, self-hosted first.
 */
export function primarySynthesisLane(env = process.env) {
  const requested = String(env.VOICE_PRIMARY_LANE || "").trim().toLowerCase();
  if (!requested) return primaryVoiceLane(env);
  if (VENDOR_BENCH_ARMS.includes(requested)) {
    const state = BENCH_ARM_STATE[requested](env);
    if (!state.available) throw Object.assign(new Error(state.reason), { code: state.reason, blocker: state.blocker });
    return requested;
  }
  if (!VOICE_LANE_ORDER.includes(requested)) throw new Error("voice_primary_lane_unknown");
  if (!voiceLaneConfigured(requested, env)) throw new Error("voice_provider_unavailable");
  return requested;
}

export function createVoiceProvider(name, options = {}) {
  if (name === "fake" && options.allowFake === true) return assertVoiceProvider(createFakeVoiceProvider());
  if (name === VENDOR_VOICE_LANE) return assertVoiceProvider(createAzurePersonalVoiceProvider(options));
  // ElevenLabs is the only vendor bench arm with the full four-function
  // lifecycle, so it is the only one this door can return. Sarvam is a base
  // voice with nothing to enrol (see its own header) and asking for it here is
  // an error rather than a silent substitution.
  if (name === ELEVENLABS_ARM_ID || name === ELEVENLABS_PROVIDER_NAME) {
    return assertVoiceProvider(createVendorBenchArm(ELEVENLABS_ARM_ID, options));
  }
  throw new Error("voice_provider_unavailable");
}

// The synthesis lane. Separate from `createVoiceProvider` because the shapes
// genuinely differ (see the scope note above) — collapsing them would need
// `assertVoiceProvider` to accept a provider missing three of its four
// functions, which would weaken the check for every caller to make one caller
// shorter.
export function createVoiceSynthesisProvider(name, options = {}) {
  if (name === SELF_HOSTED_VOICE_LANE) return createOpenChatterboxPreviewProvider(options);
  if (VENDOR_BENCH_ARMS.includes(name)) return createVendorBenchArm(name, options);
  throw new Error("voice_provider_unavailable");
}

export function createVoiceEraser(name, options = {}) {
  if (name === "fake" && options.allowFake === true) {
    const provider = createFakeVoiceProvider();
    return Object.freeze({ name: provider.name, deleteVoice: provider.deleteVoice });
  }
  if (name === VENDOR_VOICE_LANE) return createAzurePersonalVoiceEraser(options);
  // The erasure sweep reads `vy_replica_voice_profile.provider`, so it names
  // the STORED provider string rather than the bench arm id. Erasure needs a
  // key and an origin and nothing else — it is reachable even when the arm is
  // switched off in `VOICE_VENDOR_ARMS`, because turning off new cloning must
  // never strand a biometric voice already held at a vendor.
  if (name === ELEVENLABS_PROVIDER_NAME || name === ELEVENLABS_ARM_ID) {
    return createElevenLabsVoiceEraser(options);
  }
  if (name === SARVAM_PROVIDER_NAME || name === SARVAM_ARM_ID) {
    // A preset speaker never created a vendor-side object, so there is nothing
    // this could delete. Refusing keeps `normalizeVoiceErasureFailure` honest:
    // the row retries and stays visible instead of being marked complete.
    throw Object.assign(new Error("sarvam_no_enrolled_voice"), { code: "sarvam_no_enrolled_voice" });
  }
  throw new Error("voice_provider_unavailable");
}

export { VENDOR_ARMS_ENV, enabledVendorArms };
