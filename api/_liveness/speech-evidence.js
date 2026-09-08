import { validateModernCaptureContract } from './issued-contract.js';
import { getIssuedVoiceBank, getIssuedVoiceProfile } from '../_voice-identity/issued-contract.js';
import { measureChallengeSpeech } from '../_voice-identity/speech-v2.js';

// Bind ASR assessment to the actual modern issued phrase. Returned scalars
// contain no recognized speech, nonce, embeddings or identity verdict.
export function assessModernCaptureSpeech(envelope, expectedHash, recognizedText, now) {
  const issued = validateModernCaptureContract(envelope, expectedHash, now);
  const measured = measureChallengeSpeech({ nonce: issued.nonce, sentence: issued.phrase,
    locale: issued.contract.locale }, recognizedText);
  const bank = getIssuedVoiceBank(issued.contract.locale);
  const profile = getIssuedVoiceProfile();
  return Object.freeze({ schema: 'vyakti.modern-capture-speech.v1', contractSha256: issued.contractSha256,
    bankSha256: issued.contract.bankSha256, bankReviewStatus: bank.review_status,
    scorerVersion: measured.scorer_version, normalizerVersion: profile.decision.normalizer_version,
    thresholdStatus: profile.decision.thresholds_status, nonceParserVersion: measured.nonce_parser_version,
    wordOverlapMinimum: measured.transcript_overlap_min, wordOverlap: measured.transcript_overlap,
    wordCount: measured.transcript_tokens, nonceMatched: measured.nonce_match,
    expectedScript: measured.expected_script, observedScript: measured.observed_script,
    outcome: measured.outcome, reason: measured.reason, servable: false });
}
