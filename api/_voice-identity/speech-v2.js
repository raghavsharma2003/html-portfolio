import { validateIssuedVoiceContract } from "./issued-contract.js";
import { matchesIssuedNonceV2, IDENTITY_NONCE_V2 } from "./nonce-v2.js";
import { normalizeChallengeSpeech, transcriptOverlap } from "../_replica-voice-identity.js";

const OVERLAP_MIN = 0.60;
// These labels describe this wrapper and the existing bag-of-words F1 scorer.
// They are not recognition model revisions or an implemented identity policy.
const SCHEMA = "vyakti.identity-speech.v2";
const SCORER_VERSION = "challenge-word-f1/v1";

function scriptOf(normalized) {
  const scripts = new Set();
  for (const letter of normalized.match(/[\p{L}\p{M}]/gu) || []) {
    // Generic inherited accents do not identify a script. Script-specific
    // marks do, so a Devanagari vowel mark on Latin text is not silently lost.
    if (/\p{M}/u.test(letter) && /\p{Script=Inherited}/u.test(letter)) continue;
    scripts.add(/\p{Script=Devanagari}/u.test(letter) ? "Deva" :
      /\p{Script=Latin}/u.test(letter) ? "Latn" : "other");
  }
  return scripts.size === 0 ? "none" : scripts.size === 1 ? [...scripts][0] : "mixed";
}

// Speech evidence only. Caller must supply the separately persisted issuance
// commitment. A match does not establish the speaker, capture ancestry, lease,
// consent, reference compatibility or any identity/liveness acceptance.
//
// Conservative script policy: all recognized letters and script-specific marks must belong to the issued
// locale's script. Any mixed-script result (even Hindi plus English "Code"),
// other script or digit-only result is inconclusive after the mandatory nonce.
// This does not transliterate, infer language, normalize spoken number words,
// or claim the legacy word-overlap scorer understands Hindi/Hinglish meaning.
export function assessIssuedChallengeSpeechV2(envelope, expectedContractSha256, recognizedText) {
  const issued = validateIssuedVoiceContract(envelope, expectedContractSha256);
  return Object.freeze({
    schema: SCHEMA,
    contract_sha256: issued.contractSha256,
    issued_locale: issued.contract.issued_locale,
    normalizer_version: issued.contract.normalizer_version,
    ...measureChallengeSpeech({ nonce: issued.nonce, sentence: issued.sentence,
      locale: issued.contract.issued_locale }, recognizedText),
  });
}

export function measureChallengeSpeech({ nonce, sentence, locale }, recognizedText) {
  if (!['hi-IN', 'en-IN'].includes(locale) || typeof sentence !== 'string' || !sentence) {
    throw Object.assign(new Error('identity_speech_binding_invalid'), { code: 'identity_speech_binding_invalid' });
  }
  if (typeof recognizedText !== "string" || recognizedText.length > IDENTITY_NONCE_V2.max_recognized_code_units) {
    const code = "identity_speech_text_invalid";
    throw Object.assign(new Error(code), { code });
  }
  const nonceMatch = matchesIssuedNonceV2(nonce, recognizedText);
  // Actual existing scorer output is retained even on a failed nonce; it can
  // never override that failure. Do not replace an unmeasured score with zero.
  const normalized = normalizeChallengeSpeech(recognizedText);
  const { overlap, tokens } = transcriptOverlap(sentence, recognizedText);
  const expectedScript = locale === "hi-IN" ? "Deva" : "Latn";
  const observedScript = scriptOf(normalized);
  let outcome, reason;
  if (!nonceMatch) {
    outcome = "reject"; reason = "spoken_code_missing";
  } else if (observedScript !== expectedScript) {
    outcome = "inconclusive";
    reason = observedScript === "none" ? "speech_script_unrecognized" : "speech_script_mismatch";
  } else if (overlap < OVERLAP_MIN) {
    outcome = "reject"; reason = "sentence_not_read";
  } else {
    outcome = "speech_matched"; reason = "speech_matched";
  }
  return Object.freeze({
    nonce_parser_version: IDENTITY_NONCE_V2.version,
    scorer_version: SCORER_VERSION,
    transcript_overlap_min: OVERLAP_MIN,
    transcript_overlap: overlap,
    transcript_tokens: tokens,
    nonce_match: nonceMatch,
    expected_script: expectedScript,
    observed_script: observedScript,
    outcome,
    reason,
  });
}
