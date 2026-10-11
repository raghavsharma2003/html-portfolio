import assert from "node:assert/strict";
import { buildIssuedVoiceContract, getIssuedVoiceProfile } from "../api/_voice-identity/issued-contract.js";
import { assessIssuedChallengeSpeechV2 } from "../api/_voice-identity/speech-v2.js";
import { transcriptOverlap } from "../api/_replica-voice-identity.js";

const INPUT = { challengeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", replicaId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ownerUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", locale: "hi-IN", sentenceItemId: "item-1",
  nonce: "0 1 2 3 4 5", referenceGenomeVersion: 2 };
const hindi = buildIssuedVoiceContract(INPUT), english = buildIssuedVoiceContract({ ...INPUT, locale: "en-IN" });
const assess = (issued, text) => assessIssuedChallengeSpeechV2(issued, issued.contractSha256, text);
let checks = 0;
const ok = (name, condition = true) => { assert.ok(condition, name); console.log(`ok ${++checks} - ${name}`); };

for (const issued of [hindi, english]) {
  const value = assess(issued, issued.sentence);
  assert.equal(value.outcome, "speech_matched"); assert.equal(value.reason, "speech_matched");
  assert.equal(value.nonce_match, true); assert.equal(value.transcript_overlap, 1);
  assert.equal(value.transcript_overlap_min, 0.60);
  assert.equal(value.contract_sha256, issued.contractSha256); assert.equal(value.issued_locale, issued.contract.issued_locale);
  assert.equal(value.observed_script, issued === hindi ? "Deva" : "Latn");
  assert.deepEqual([value.transcript_overlap, value.transcript_tokens], Object.values(transcriptOverlap(issued.sentence, issued.sentence)));
  ok(`${value.issued_locale}: real builder, strict nonce and existing F1 scorer produce speech-only match`);
}
for (const [name, text] of [
  ["Devanagari digit folding and final danda", hindi.sentence.replace("0 1 2 3 4 5.", "० १ २ ३ ४ ५।")],
  ["whitespace normalization", hindi.sentence.replaceAll(" ", "\t\n")],
  ["Unicode nonbreaking spaces", hindi.sentence.replaceAll(" ", "\u00a0")],
]) ok(name, assess(hindi, text).outcome === "speech_matched");
ok("English NFKC fullwidth digits preserve the exact recognized code", assess(english,
  english.sentence.replace("0 1 2 3 4 5", "０ １ ２ ３ ４ ５")).outcome === "speech_matched");

for (const [name, issued, text, script] of [
  ["Hindi issue with Latin transcription", hindi, english.sentence, "Latn"],
  ["English issue with Devanagari transcription", english, hindi.sentence, "Deva"],
  ["mixed Hindi and English code label", hindi, hindi.sentence.replace("कोड", "Code"), "mixed"],
  ["mixed English and Hindi extra word", english, `${english.sentence} नमस्ते`, "mixed"],
  ["Devanagari mark on Latin text", english, english.sentence.replace("blue", "blueा"), "mixed"],
  ["unrecognized script", hindi, "слово код 012345", "other"],
  ["digits only", hindi, "०१२३४५", "none"],
]) {
  const result = assess(issued, text);
  assert.equal(result.outcome, "inconclusive"); assert.equal(result.nonce_match, true);
  assert.equal(result.observed_script, script);
  assert.equal(result.reason, script === "none" ? "speech_script_unrecognized" : "speech_script_mismatch");
  ok(`${name} stays closed despite a valid nonce`);
}
for (const [issued, wrong] of [[hindi, "अलग शब्द गलत बात दूसरी कहानी नया दिन कोड 012345"],
  [english, "different words another story unrelated subject Code 012345"]]) {
  const result = assess(issued, wrong);
  assert.equal(result.outcome, "reject"); assert.equal(result.reason, "sentence_not_read");
  assert.equal(result.nonce_match, true); assert.ok(result.transcript_overlap < 0.60);
  assert.deepEqual([result.transcript_overlap, result.transcript_tokens], Object.values(transcriptOverlap(issued.sentence, wrong)));
  ok(`${issued.contract.issued_locale}: same-script wrong text is refused by the existing scorer`);
}
for (const [name, text] of [
  ["wrong nonce even with script mismatch", english.sentence.replace("0 1 2 3 4 5", "9 8 7 6 5 4")],
  ["missing nonce even with script mismatch", "The blue bus stopped near the market this morning"],
  ["word-spliced nonce", hindi.sentence.replace("0 1 2 3 4 5", "0 बात 1 बात 2 बात 3 बात 4 बात 5")],
  ["longer number nonce", hindi.sentence.replace("0 1 2 3 4 5", "90123456")],
  ["spoken number words", hindi.sentence.replace("0 1 2 3 4 5", "शून्य एक दो तीन चार पांच")],
  ["empty recognition", ""],
]) {
  const result = assess(hindi, text);
  assert.equal(result.outcome, "reject"); assert.equal(result.reason, "spoken_code_missing");
  assert.equal(result.nonce_match, false); ok(name);
}
const highOverlapWrongNonce = assess(hindi, hindi.sentence.replace("0 1 2 3 4 5", "9 8 7 6 5 4"));
ok("high word overlap cannot override a failed mandatory nonce",
  highOverlapWrongNonce.transcript_overlap >= 0.60 && highOverlapWrongNonce.outcome === "reject");

const tampered = JSON.parse(JSON.stringify(hindi)); tampered.contract.issued_locale = "en-IN";
assert.throws(() => assessIssuedChallengeSpeechV2(tampered, hindi.contractSha256, hindi.sentence), /identity_issued_binding_invalid/);
ok("altered issued contract fails before speech assessment");
assert.throws(() => assessIssuedChallengeSpeechV2(english, hindi.contractSha256, english.sentence), /identity_issued_expected_hash_invalid/);
ok("fully valid foreign contract cannot substitute for persisted challenge commitment");
assert.throws(() => assessIssuedChallengeSpeechV2(hindi, undefined, hindi.sentence), /identity_issued_expected_hash_invalid/);
ok("speech assessment cannot omit persisted issuance authority");
assert.throws(() => assessIssuedChallengeSpeechV2(tampered, hindi.contractSha256, { toString() { throw Error("must not coerce"); } }),
  /identity_issued_binding_invalid/);
ok("contract validation precedes transcript validation");
for (const text of [null, undefined, 12345, new String(hindi.sentence), "a".repeat(4001)]) {
  assert.throws(() => assess(hindi, text), /identity_speech_text_invalid/);
  ok("invalid or oversized transcript throws a content-free input error");
}
assert.throws(() => assess(hindi, "\ufdfa".repeat(250)), /voice_challenge_transcript_too_long/);
ok("existing normalization also bounds post-NFKC expansion");

const receipts = [assess(hindi, hindi.sentence), assess(hindi, english.sentence), assess(hindi, "")];
const expectedKeys = ["schema", "contract_sha256", "issued_locale", "nonce_parser_version", "normalizer_version", "scorer_version",
  "transcript_overlap_min", "transcript_overlap", "transcript_tokens", "nonce_match", "expected_script", "observed_script", "outcome", "reason"].sort();
for (const result of receipts) {
  assert.deepEqual(Object.keys(result).sort(), expectedKeys);
  assert.ok(Object.isFrozen(result)); assert.ok(Number.isFinite(result.transcript_overlap));
  assert.ok(Number.isInteger(result.transcript_tokens) && result.transcript_tokens >= 0);
  assert.equal(result.nonce_parser_version, "voice-identity-nonce/v2");
  assert.equal(result.normalizer_version, "challenge-speech-nfkc-digitfold/v1");
  assert.equal(result.scorer_version, "challenge-word-f1/v1");
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024);
  assert.ok(!JSON.stringify(result).includes(hindi.sentence) && !JSON.stringify(result).includes(INPUT.nonce));
  assert.equal("verified" in result || "identity_verified" in result || "recognizedText" in result, false);
}
ok("every outcome is a bounded frozen content-free speech receipt with no identity verdict");
ok("profile remains disabled and decision integration remains pending", getIssuedVoiceProfile().servable === false &&
  getIssuedVoiceProfile().prerequisites.nonce_decision_semantics_implemented === false);
console.log(`\n${checks} speech v2 checks passed (pure speech fixtures; no ASR, speaker or identity acceptance)`);
