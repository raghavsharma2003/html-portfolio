// Sarvam Bulbul arm — the INDIAN-ACCENT BASE ARM, and it is not a clone.
//
// SAY THIS PLAINLY, BECAUSE THE NEXT AGENT WILL ASSUME OTHERWISE
// ---------------------------------------------------------------------------
// Sarvam's marketing for Bulbul v3 says it "supports voice cloning". Their
// public API reference does not: the documented text-to-speech call takes a
// `speaker` chosen from a fixed list of about forty preset voices, and there is
// no documented endpoint that creates a custom speaker from a reference
// recording. Read on 2026-09-03 across docs.sarvam.ai's API reference, the
// Bulbul model page and the endpoint list; the only cloning mentioned anywhere
// in the docs is inside the separate Dubbing product, which is not this.
//
// So this arm is implemented as what the documentation actually supports: a
// BASE arm with a fixed Indian-accent preset speaker. That is still worth
// benching, and it is worth benching for a measured reason.
// `rejected.md#azure-tts` is the entry: every measured axis said switch to
// Azure and the owner's ear said no, because the battery tested PRONUNCIATION
// and never tested ACCENT IDENTITY. A native Indian-accent base voice is the
// control that tells an owner-likeness score apart from an accent score. It
// can never win the owner-likeness axis, and a run that reported it as a clone
// would be measuring the wrong thing.
//
// If Sarvam later documents a custom-speaker endpoint, this file grows a
// `createVoice` and the arm changes category. Until then `createVoice` REFUSES
// with a named code rather than returning a preset speaker dressed as a clone.
//
// ENDPOINT, PINNED. Read from docs.sarvam.ai on 2026-09-03:
//   POST https://api.sarvam.ai/text-to-speech
//     header: api-subscription-key
//     body:   { text, language_code, speaker, model, pace,
//               speech_sample_rate, output_audio_codec }
//     limits: bulbul:v3 max 2500 characters; sample rates 8000/16000/22050/
//             24000/32000/44100/48000
//     -> { request_id, audios: [base64] }
//
// THE KEY THAT ANSWERS 402. `context/measurements.md` records that the owner's
// Sarvam key returned Payment Required. That is expected here and it is
// surfaced as its own named WAITING-ON-YOU blocker rather than a generic HTTP
// failure, because "your vendor account needs credit" and "our call is wrong"
// are different problems and only one of them is the owner's to fix.
import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "../../_provenance/contracts.js";
import {
  beginProviderSpend,
  markProviderSpendUncertain,
  releaseProviderSpendBeforeCall,
  reserveVendorVoiceSpend,
  settleVendorVoiceSpend,
  vendorVoiceBudgetConfig,
} from "../../_provider-budget.js";
import { VOICE_PCM_FORMAT } from "../contracts.js";
import {
  assertReferenceBytes,
  billableCharacters,
  byteStream,
  renderVendorText,
  sha256Bytes,
  toCanonicalPcm24k,
  vendorApiKey,
  vendorArmState,
  vendorFail,
  vendorOrigin,
  vendorSignal,
} from "./vendor-common.js";

export const SARVAM_ARM_ID = "sarvam";
export const SARVAM_PROVIDER_NAME = "sarvam_bulbul_base";
const PROVIDER_VERSION = "sarvam-bulbul/2026-09-03";
const MODELS = new Set(["bulbul:v3", "bulbul:v2"]);
const MAX_CHARACTERS = Object.freeze({ "bulbul:v3": 2_500, "bulbul:v2": 1_500 });
const LANGUAGE_CODES = Object.freeze({ hi: "hi-IN", en: "en-IN" });
// The documented v3 speaker list. Held here so a typo is a config error rather
// than a vendor 4xx halfway through a paid bench run.
const SPEAKERS = Object.freeze(new Set([
  "shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan", "simran", "kavya",
  "amit", "dev", "ishita", "shreya", "ratan", "varun", "manan", "sumit", "roopa", "kabir",
  "aayan", "ashutosh", "advait", "anand", "tanya", "tarun", "sunny", "mani", "gokul", "vijay",
  "shruti", "suhani", "mohit", "kavitha", "rehan", "soham", "rupali",
  "anushka", "manisha", "vidya", "arya", "abhilash", "karun", "hitesh",
]));
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;

export function sarvamBulbulConfig(env = process.env) {
  const key = vendorApiKey(env.SARVAM_API_KEY, "sarvam_api_key_required");
  const origin = vendorOrigin(env.SARVAM_BASE_URL, "https://api.sarvam.ai",
    [".sarvam.ai"], "sarvam_origin_invalid");
  const model = String(env.SARVAM_TTS_MODEL || "bulbul:v3").toLowerCase();
  if (!MODELS.has(model)) vendorFail("sarvam_model_invalid");
  const speaker = String(env.SARVAM_TTS_SPEAKER || "priya").toLowerCase();
  if (!SPEAKERS.has(speaker)) vendorFail("sarvam_speaker_invalid");
  const budget = vendorVoiceBudgetConfig(SARVAM_ARM_ID, env);
  return Object.freeze({ key, origin, model, speaker, budget, maxCharacters: MAX_CHARACTERS[model] });
}

export function sarvamArmState(env = process.env) {
  return vendorArmState(SARVAM_ARM_ID, env, sarvamBulbulConfig);
}

export function createSarvamBulbulProvider(options = {}) {
  const env = options.env || process.env;
  const config = sarvamBulbulConfig(env);
  const fetchImpl = options.fetchImpl || fetch;
  const nativeTools = options.nativeTools;
  const now = options.now || (() => new Date());
  const db = options.db;
  if (typeof db !== "function") vendorFail("provider_budget_db_required");
  const budget = options.budget || {
    reserve: reserveVendorVoiceSpend,
    begin: beginProviderSpend,
    settle: settleVendorVoiceSpend,
    release: releaseProviderSpendBeforeCall,
    uncertain: markProviderSpendUncertain,
  };
  const descriptor = Object.freeze({
    family: "sarvam",
    name: SARVAM_PROVIDER_NAME,
    version: PROVIDER_VERSION,
    model: config.model,
    billing: Object.freeze({
      voice_training: Object.freeze({ meter: "sarvam_voice_clones" }),
      synthesis: Object.freeze({ meter: "sarvam_characters" }),
    }),
  });

  async function speak({ renderedText, languageId, requestKey, commitment, signal }) {
    const languageCode = LANGUAGE_CODES[languageId];
    if (!languageCode) vendorFail("sarvam_language_not_supported", 400);
    const characters = billableCharacters(renderedText);
    if (characters > config.maxCharacters) vendorFail("sarvam_text_too_long", 413);
    const reservation = await budget.reserve(db, {
      vendor: SARVAM_ARM_ID,
      operation: "synthesis",
      requestKey,
      inputCommitment: commitment,
      adapter: descriptor,
      text: renderedText,
      env,
      now: now(),
    });
    let began = false;
    try {
      await budget.begin(db, reservation);
      began = true;
      let response;
      try {
        response = await fetchImpl(`${config.origin}/text-to-speech`, {
          method: "POST",
          headers: { "api-subscription-key": config.key, "content-type": "application/json" },
          body: JSON.stringify({
            text: renderedText,
            language_code: languageCode,
            speaker: config.speaker,
            model: config.model,
            pace: 1.0,
            speech_sample_rate: VOICE_PCM_FORMAT.sampleRate,
            output_audio_codec: "wav",
          }),
          signal: vendorSignal(signal, 120_000),
        });
      } catch { vendorFail("sarvam_unreachable"); }
      if (response.status === 402) vendorFail("sarvam_payment_required", 402);
      if (response.status === 401 || response.status === 403) vendorFail("sarvam_key_rejected", 402);
      if (!response.ok) vendorFail(`sarvam_http_${response.status}`, response.status >= 500 ? 503 : 409);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_RESPONSE_BYTES) vendorFail("sarvam_response_size_invalid");
      let parsed;
      try { parsed = JSON.parse(bytes.toString("utf8")); } catch { vendorFail("sarvam_response_invalid"); }
      const audio = Buffer.from(String(parsed?.audios?.[0] || ""), "base64");
      if (!audio.length) vendorFail("sarvam_response_audio_missing");
      // Sarvam is ASKED for 24 kHz WAV, and the answer is still parsed rather
      // than trusted. `speech_sample_rate` is a request, and a request that is
      // quietly ignored is exactly how an 8 kHz reference once wore a 24 kHz
      // label in this repo (`STATE.md`, 2026-08-27).
      const canonical = await toCanonicalPcm24k(audio, { env, nativeTools, signal });
      await budget.settle(db, reservation, { units: characters });
      return Object.freeze({
        pcm: canonical.pcm,
        resampled: canonical.resampled,
        characters,
        vendorRequestId: String(parsed?.request_id || ""),
      });
    } catch (error) {
      if (!began) await budget.release(db, reservation, error);
      else await budget.uncertain(db, reservation, error);
      throw error;
    }
  }

  function receiptFor({ commitment, renderedText, disclosureText, languageId, seed, result, requestId, referenceSha256, startedAt }) {
    const durationMs = result.pcm.length / 2 / VOICE_PCM_FORMAT.sampleRate * 1000;
    const elapsedMs = Date.now() - startedAt;
    return Object.freeze({
      requestId,
      arm: SARVAM_ARM_ID,
      model: SARVAM_PROVIDER_NAME,
      vendorModelId: config.model,
      // The category is on the receipt so no downstream reader has to guess.
      // A base arm entering a clone comparison without this label is the
      // `azure-tts` mistake with the arms swapped.
      armCategory: "indian_accent_base_voice",
      speaker: config.speaker,
      clonesTheOwner: false,
      modelCommitment: commitment,
      synthesisCommitment: commitment,
      // A base voice hears no reference. The field stays present and null so a
      // consumer cannot mistake "not conditioned on the owner" for "field
      // missing from an older receipt".
      referenceSha256,
      referenceUsed: false,
      languageId,
      seed,
      renderedText,
      disclosureText,
      outputSha256: sha256Bytes(result.pcm),
      durationMs,
      elapsedMs,
      realTimeFactor: durationMs > 0 ? elapsedMs / durationMs : null,
      billedCharacters: result.characters,
      resampledTo24k: result.resampled,
      vendorRequestId: result.vendorRequestId,
      perthWatermarkVerified: false,
      protectionPath: "delivery_audioseal",
      transportProof: "tls_vendor_api",
    });
  }

  return Object.freeze({
    ...descriptor,
    armId: SARVAM_ARM_ID,
    modelCommitment: sha256Hex(`${PROVIDER_VERSION}:${config.model}:${config.speaker}`),
    modelArm: "indian_accent_base_voice",
    clonesTheOwner: false,
    state: () => sarvamArmState(env),

    /**
     * Refused on purpose. There is no documented Sarvam endpoint that builds a
     * custom speaker from a reference recording, and returning a preset voice
     * from a call named `createVoice` would put a base arm into the clone lane
     * where nothing downstream could tell the difference.
     */
    async createVoice() {
      vendorFail("sarvam_voice_cloning_not_documented", 501);
    },

    async getVoiceStatus() {
      // A preset speaker is always there and there is nothing tenant-specific
      // to poll. This is a fact about the arm, not a cached optimism.
      return "ready";
    },

    async synthesizeStream({ text, languageId = "hi", seed = 0, signal, requestKey }) {
      if (typeof requestKey !== "string" || requestKey.length < 16) vendorFail("sarvam_synthesis_request_key_required", 400);
      const language = String(languageId).toLowerCase();
      const { renderedText, disclosureText } = renderVendorText(text, language);
      const commitment = sha256Hex(canonicalJson({
        protocol: PROVIDER_VERSION, model: config.model, speaker: config.speaker,
        language_id: language, seed, text_sha256: sha256Hex(renderedText),
      }));
      const startedAt = Date.now();
      const result = await speak({ renderedText, languageId: language, requestKey, commitment, signal });
      return Object.freeze({
        format: VOICE_PCM_FORMAT,
        renderedText,
        disclosureText,
        stream: byteStream(result.pcm),
        pcm: result.pcm,
        receipt: receiptFor({
          commitment, renderedText, disclosureText, languageId: language, seed,
          result, requestId: requestKey, referenceSha256: null, startedAt,
        }),
      });
    },

    /** The bench-facing shape, identical in contract to every other arm. */
    async synthesizePreview(raw) {
      // The reference is validated and then deliberately NOT sent. Validating
      // it keeps this arm inside the same evidence path as the clone arms (same
      // window, same hash on the receipt) while `referenceUsed: false` records
      // that the audio itself never left the platform for this arm.
      const reference = assertReferenceBytes(raw?.reference);
      const languageId = String(raw?.languageId || "hi").toLowerCase();
      const seed = Number(raw?.seed);
      if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2_147_483_647) vendorFail("sarvam_seed_invalid", 400);
      const requestId = String(raw?.requestId || randomUUID());
      const { renderedText, disclosureText } = renderVendorText(raw?.text, languageId);
      const commitment = sha256Hex(canonicalJson({
        protocol: PROVIDER_VERSION, model: config.model, speaker: config.speaker,
        language_id: languageId, seed, reference_sha256: reference.sha256,
        text_sha256: sha256Hex(renderedText),
      }));
      const startedAt = Date.now();
      const result = await speak({
        renderedText, languageId, requestKey: `sarvam-preview:${requestId}`, commitment, signal: raw?.signal,
      });
      return Object.freeze({
        renderedText,
        disclosureText,
        format: VOICE_PCM_FORMAT,
        stream: byteStream(result.pcm),
        pcm: result.pcm,
        receipt: receiptFor({
          commitment, renderedText, disclosureText, languageId, seed, result,
          requestId, referenceSha256: reference.sha256, startedAt,
        }),
      });
    },

    /**
     * There is no vendor-side biometric object for a preset speaker, so there
     * is nothing to delete and this refuses rather than answering "deleted".
     * An eraser that reports success for a deletion it did not perform is the
     * malware-scan-returns-clean defect wearing different clothes.
     */
    async deleteVoice() {
      vendorFail("sarvam_no_enrolled_voice", 409);
    },
  });
}
