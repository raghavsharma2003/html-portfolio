import { assertVoiceProvider } from "./contracts.js";
import {
  azurePersonalVoiceConfig,
  createAzurePersonalVoiceEraser,
  createAzurePersonalVoiceProvider,
} from "./providers/azure-personal-voice.js";
import { createFakeVoiceProvider } from "./providers/fake.js";
import {
  createOpenChatterboxPreviewProvider,
  openChatterboxConfig,
} from "./providers/open-chatterbox-preview.js";

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

export function createVoiceProvider(name, options = {}) {
  if (name === "fake" && options.allowFake === true) return assertVoiceProvider(createFakeVoiceProvider());
  if (name === VENDOR_VOICE_LANE) return assertVoiceProvider(createAzurePersonalVoiceProvider(options));
  throw new Error("voice_provider_unavailable");
}

// The synthesis lane. Separate from `createVoiceProvider` because the shapes
// genuinely differ (see the scope note above) — collapsing them would need
// `assertVoiceProvider` to accept a provider missing three of its four
// functions, which would weaken the check for every caller to make one caller
// shorter.
export function createVoiceSynthesisProvider(name, options = {}) {
  if (name === SELF_HOSTED_VOICE_LANE) return createOpenChatterboxPreviewProvider(options);
  throw new Error("voice_provider_unavailable");
}

export function createVoiceEraser(name, options = {}) {
  if (name === "fake" && options.allowFake === true) {
    const provider = createFakeVoiceProvider();
    return Object.freeze({ name: provider.name, deleteVoice: provider.deleteVoice });
  }
  if (name === VENDOR_VOICE_LANE) return createAzurePersonalVoiceEraser(options);
  throw new Error("voice_provider_unavailable");
}
