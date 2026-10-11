import { canonicalJson, sha256Hex } from "../_replica-processing/contracts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const NONCE = /^[0-9]( [0-9]){5}$/;
const PROFILE_ID = "azure-shared-audio/v1";
const INPUT_KEYS = ["challengeId", "replicaId", "ownerUserId", "locale", "sentenceItemId", "nonce", "referenceGenomeVersion"];
const CONTRACT_KEYS = ["schema", "challenge_id", "replica_id", "owner_user_id", "issued_locale",
  "sentence_bank_version", "sentence_bank_sha256", "sentence_item_id", "sentence_hash", "nonce_sha256",
  "normalizer_version", "decision_policy_version", "verifier_profile", "verifier_profile_sha256", "reference_genome_version"];

function fail(part) {
  const code = `identity_issued_${part}_invalid`;
  throw Object.assign(new Error(code), { code });
}

function exact(value, fields, part) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(part);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== fields.length || actual.some((key) => typeof key !== "string" || !fields.includes(key))) fail(part);
  // Refuse accessors rather than running caller code while validating fields.
  if (actual.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"))) fail(part);
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function bank(locale, version, script, lines) {
  const descriptor = freeze({ version, locale, expected_script: script, owner_reviewed: false,
    review_status: "unreviewed-draft", items: lines.map((text, index) => ({ id: `item-${index + 1}`, text })) });
  return freeze({ ...descriptor, sha256: sha256Hex(canonicalJson(descriptor)) });
}

// Draft challenge material, not owner-reviewed copy or measured recognition
// fixtures. Any text, ordering, review status or semantic change needs a new
// bank version; previously issued contracts must retain their exact registry.
const BANKS = freeze({
  "en-IN": bank("en-IN", "identity-bank-en-latn/v1", "Latn", [
    "The blue bus stopped near the market this morning",
    "She opened the window because the room felt warm",
    "The train was late so we bought some tea",
    "He counted the coins and put them in the box",
    "The lights went out and we waited for a while",
    "Someone left an umbrella on the last bus seat",
  ]),
  "hi-IN": bank("hi-IN", "identity-bank-hi-deva/v1", "Deva", [
    "सुबह की चाय ठंडी हुई तो मैंने फिर गरम की",
    "मेरा फोन मेज पर था और उसकी बैटरी खत्म थी",
    "आज बारिश हुई तो सड़क पर काफी पानी भर गया",
    "कल रात नींद नहीं आई तो मैंने थोड़ी किताब पढ़ी",
    "घर के बाहर एक छोटा कुत्ता धूप में सो रहा था",
    "मैंने दरवाजा बंद किया और चाबी अपनी जेब में रखी",
  ]),
});

const TRANSFORM_PARAMETERS = freeze({ sample_rate_hz: 24000, channels: 1, sample_format: "pcm_s16le",
  max_frames: 720000, stream_policy: "one-video-one-audio", trim: false, pad: false, denoise: false });
const PROFILE_DESCRIPTOR = freeze({
  id: PROFILE_ID,
  servable: false,
  status: "prerequisite-only",
  prerequisites: {
    bank_owner_review: false,
    reference_model_compatibility: false,
    nonce_decision_semantics_implemented: false,
    issued_sql_and_lifecycle_binding: false,
    deployed_service_provenance: false,
    locale_replay_impostor_acceptance: false,
  },
  evidence: { schema: "vyakti.identity-audio.v1", operation: "identity_audio_v1", authority: "capture-only",
    max_capture_bytes: 33554432, stream_policy: "one-video-one-audio",
    containers: [{ mime: "video/webm", audio_codecs: ["opus"], video_codecs: ["vp8", "vp9"] },
      { mime: "video/mp4", audio_codecs: ["aac"], video_codecs: ["h264"] }],
    canonical: { mime: "audio/wav", sample_rate_hz: 24000, channels: 1, sample_format: "pcm_s16le", max_frames: 720000 },
    transform: { name: "capture-audio", version: "capture-to-pcm24k-v1", parameters: TRANSFORM_PARAMETERS,
      parameter_sha256: sha256Hex(canonicalJson(TRANSFORM_PARAMETERS)) } },
  speaker: { families: ["speechbrain-ecapa-voxceleb", "speechbrain-xvector-voxceleb"],
    expected_candidate_revisions: { "speechbrain-ecapa": "0f99f2d0ebe89ac095bcc5903c4dd8f72b367286",
      "speechbrain-xvector": "56895a2df401be4150a159f3a1c653f00051d477", "silero-vad": "6.2.1" },
    reference_revision_compatibility: "unproven" },
  asr: { provider: "azure-speech-short", adapter_version: "azure-speech-short-v1",
    rest_path: "/stt/speech/recognition/conversation/cognitiveservices/v1", response_format: "detailed",
    locale_authority: "issued_locale", locales: ["hi-IN", "en-IN"],
    expected_phrase_hints: false, managed_acoustic_model_revision: null,
    managed_acoustic_model_revision_status: "not-exposed-by-adapter",
    transport_sample_rate_hz: 16000, transform: "pcm24k-to-pcm16k-windowed-sinc-v1" },
  decision: { version: "voice-identity-challenge/v2", implementation_status: "pending",
    normalizer_version: "challenge-speech-nfkc-digitfold/v1", spoken_nonce_semantics: "pending-v2-parser",
    legacy_nonce_parser: "strips-nondigits-and-substring-matches", require_nonce: true, issued_nonce_digits: 6,
    accept_at_or_above: 0.78, review_at_or_above: 0.70, transcript_overlap_min: 0.60, min_reference_windows: 2,
    thresholds_status: "provisional-not-identity-calibrated", script_mismatch_semantics: "pending-closed-review",
    human_review_consumer: "not-established" },
});
const PROFILE = freeze({ ...PROFILE_DESCRIPTOR, sha256: sha256Hex(canonicalJson(PROFILE_DESCRIPTOR)) });

export function getIssuedVoiceBank(locale) {
  if (typeof locale !== "string" || !Object.hasOwn(BANKS, locale)) fail("locale");
  return BANKS[locale];
}

export function getIssuedVoiceProfile(profileId = PROFILE_ID) {
  if (profileId !== PROFILE_ID) fail("profile");
  return PROFILE;
}

// Internal server-owned fields only. No randomness, environment lookup, locale
// inference or serving authorization. The HTTP layer must not forward a client
// object into this function as authority for nonce, IDs, item or reference.
export function buildIssuedVoiceContract(input) {
  exact(input, INPUT_KEYS, "input");
  for (const key of ["challengeId", "replicaId", "ownerUserId"]) {
    if (typeof input[key] !== "string" || input[key].length !== 36 || !UUID.test(input[key])) fail("uuid");
  }
  if (typeof input.nonce !== "string" || input.nonce.length !== 11 || !NONCE.test(input.nonce)) fail("nonce");
  if (!Number.isSafeInteger(input.referenceGenomeVersion) || input.referenceGenomeVersion < 1 ||
      input.referenceGenomeVersion > 2147483647) fail("reference");
  const selectedBank = getIssuedVoiceBank(input.locale);
  if (typeof input.sentenceItemId !== "string") fail("item");
  const item = selectedBank.items.find((entry) => entry.id === input.sentenceItemId);
  if (!item) fail("item");
  const sentence = `${item.text}. ${input.locale === "hi-IN" ? "कोड" : "Code"} ${input.nonce}.`;
  const contract = {
    schema: "vyakti.identity-issued.v1", challenge_id: input.challengeId, replica_id: input.replicaId,
    owner_user_id: input.ownerUserId, issued_locale: input.locale,
    sentence_bank_version: selectedBank.version, sentence_bank_sha256: selectedBank.sha256, sentence_item_id: item.id,
    sentence_hash: sha256Hex(sentence), nonce_sha256: sha256Hex(input.nonce),
    normalizer_version: PROFILE.decision.normalizer_version, decision_policy_version: PROFILE.decision.version,
    verifier_profile: PROFILE.id, verifier_profile_sha256: PROFILE.sha256,
    reference_genome_version: input.referenceGenomeVersion,
  };
  return freeze({ sentence, nonce: input.nonce, contract, contractSha256: sha256Hex(canonicalJson(contract)) });
}

// Hashes are commitments, not signatures or proof of issuance. A worker must
// supply the independently persisted expected hash and compare its owner/lease
// tuple in SQL. Offline callers also supply their independently held commitment.
export function validateIssuedVoiceContract(envelope, expectedContractSha256) {
  exact(envelope, ["sentence", "nonce", "contract", "contractSha256"], "envelope");
  exact(envelope.contract, CONTRACT_KEYS, "contract");
  if (typeof envelope.sentence !== "string" || typeof envelope.nonce !== "string" ||
      typeof envelope.contractSha256 !== "string" || envelope.contractSha256.length !== 64 || !SHA.test(envelope.contractSha256)) fail("envelope");
  if (typeof expectedContractSha256 !== "string" || expectedContractSha256.length !== 64 || !SHA.test(expectedContractSha256) ||
      envelope.contractSha256 !== expectedContractSha256) fail("expected_hash");
  const c = envelope.contract;
  const rebuilt = buildIssuedVoiceContract({ challengeId: c.challenge_id, replicaId: c.replica_id,
    ownerUserId: c.owner_user_id, locale: c.issued_locale, sentenceItemId: c.sentence_item_id,
    nonce: envelope.nonce, referenceGenomeVersion: c.reference_genome_version });
  // Compare known scalars without coercion before canonicalizing caller data.
  // This also refuses unsupported schema, bank, policy and profile revisions.
  if (CONTRACT_KEYS.some((key) => c[key] !== rebuilt.contract[key])) fail("binding");
  if (envelope.sentence !== rebuilt.sentence || envelope.contractSha256 !== rebuilt.contractSha256) fail("binding");
  return rebuilt;
}
