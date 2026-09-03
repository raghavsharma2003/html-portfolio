// Owner identity by SPEAKER VERIFICATION (WS-R2).
//
// ── what this replaces, and why ───────────────────────────────────────────
// `runtimeBlockers` (api/_replica-runtime.js) refuses activation without
// `vy_replica.identity_verified_at` and `liveness_verified_at`. Exactly two
// things can write those today:
//
//   1. `completeLivenessVerification` — the Azure Document Intelligence +
//      Face Liveness stack (api/_replica-identity.js,
//      api/_replica-liveness*.js, services/azure-verifier, migrations
//      039-041). It has never been deployed and it needs two Microsoft
//      Limited Access approvals that nobody has.
//   2. `REPLICA_SELF_TEST_MODE` — a FLAG, owner-UUID-bound, for internal
//      testing only, and explicitly not a product path
//      (rejected.md#single-self-test-boolean-is-a-global-footgun).
//
// So the shipping product currently has no identity path at all. This module
// is the third one, built only out of things that already run in production:
// the owner speaks a sentence this server generated seconds ago, on camera,
// and two independent measurements have to agree that it was them and that it
// was now.
//
// ── the two measurements, and which one is which ──────────────────────────
// IDENTITY is speaker-embedding cosine similarity between the challenge clip
// and the owner's own enrollment reference, measured by the SAME deployed
// `voice-evidence` service and the SAME ECAPA family `api/_fidelity.js`
// already scores. `fidelityScore` is imported rather than reimplemented: two
// cosine implementations in one repo is two numbers that can disagree about
// what "same speaker" means.
//
// LIVENESS is the transcript. A replayed old recording of this person passes
// the speaker check by construction — it IS this person — and the only thing
// that separates it from a live reading is that it cannot contain a sentence
// and a numeric nonce that were generated after it was recorded. That is the
// whole anti-replay argument, and it is why the transcript half is not
// optional and why the eval has a negative control that removes it.
//
// ── what this does NOT prove, stated up front ─────────────────────────────
// NOT ADULTHOOD. A voice cannot establish an age. `age_verified_at` is
// written by the ID-document path (`completeOwnedIdentityCase`) and by
// nothing here, and the settlement below REQUIRES `age_verified_at is not
// null` exactly as the Azure liveness settlement does. A replica that has
// never had an age established still reports `adult_verification_required`
// after a perfect voice challenge, and that is correct.
//
// NOT A NAMED HUMAN. The Azure path binds the face to a government document
// and therefore to a legal identity. This binds the voice to the voice
// already enrolled on this account. It answers "is the person speaking now
// the person this replica was built from", which is precisely the question
// self-cloning-only asks (decisions.md#replica-self-only), and it does not
// answer "who, in the world, is that person".
//
// FALSE ACCEPTANCE IS UNMEASURED. See VOICE_CHALLENGE_POLICY below. This is
// the most important sentence in this file.
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import { embeddingVectors, fidelityScore, FIDELITY_EMBEDDING_FAMILY } from "./_fidelity.js";
import { privateObjectPath, sourceUploadInput, verifyStoredObject, clientSource } from "./_replica-source.js";
import { REPLICA_STORAGE_WRITE_BUCKET } from "./_replica-storage.js";

export const VOICE_CHALLENGE_POLICY_VERSION = "voice-identity-challenge/v1";

// ── THE THRESHOLDS ────────────────────────────────────────────────────────
//
// SPEAKER SIMILARITY. These are the repo's own numbers, not invented ones,
// and they come from `measurements.md#first-real-clone` (2026-08-26, WS-T,
// n = 1 subject, 2 independent end-to-end runs, spread 1e-6):
//
//   * the ceiling this metric reaches on this stack, owner vs owner across
//     DIFFERENT WINDOWS of the same recording:      mean 0.8869, p10 0.8795
//   * `api/_fidelity.js`'s activation floor:        0.70
//   * `api/_fidelity.js`'s warn band:               0.78
//
// The owner-vs-owner row is the one that matters here, because that is the
// comparison this module makes: a live window of the owner against reference
// windows of the owner. A genuine owner should land near 0.88, which is a
// full 0.10 above the accept threshold. So the FALSE-REJECT side of this gate
// has a measured margin.
//
// The FALSE-ACCEPT side does not, and this is the honest limit of the whole
// design: THIS REPOSITORY CONTAINS NO DIFFERENT-SPEAKER CONTROL. Nobody has
// ever measured what an impostor scores against a stranger's reference on
// this stack. 0.70 is therefore the floor `api/_fidelity.js` already uses,
// carried here because it is the only number in the building that was chosen
// with any evidence at all, and NOT because anyone has shown that an impostor
// scores below it. `api/_fidelity.js` says its own thresholds are
// "PROVISIONAL ... a threshold nobody measured is dogma with a decimal point
// on it", and every word of that applies here with more force, because the
// thing on the other side of this gate is a person's identity rather than a
// drift warning.
//
// WHAT REVERSES THIS: an impostor control set — N speakers scored against
// M other speakers' references through this exact path. If the impostor
// distribution overlaps 0.78, this gate is not safe at 0.78 and the policy
// version gets bumped rather than the constants quietly edited. Until that
// exists, `review` is a real outcome and not a formality: it is where a
// decision that nobody can defend numerically is supposed to land.
//
// TRANSCRIPT OVERLAP. Unmeasured, and marked as such. There is no bench in
// this repo for how much of a Hinglish sentence Sarvam returns verbatim, and
// there is a known, unresolved script problem sitting directly underneath
// this number: `rejected.md#romanised-lexicon-meets-devanagari-asr` measured
// a visibly bilingual transcript at code-switch ratio 0.000 because Sarvam
// returns DEVANAGARI and transliterates the English half into Devanagari too.
// `normalizeChallengeSpeech` below folds digits across scripts and keeps
// `\p{M}` so an abugida is not shredded into bare consonants, but it does NOT
// transliterate, so a Latin-script sentence read back in Devanagari would
// score near zero on words while still matching on the nonce. That is why
// the nonce is a SEPARATE, MANDATORY check and not just more tokens in the
// overlap: the anti-replay argument survives a total script mismatch, and the
// word overlap degrades into a review rather than a silent rejection.
export const VOICE_CHALLENGE_POLICY = Object.freeze({
  version: VOICE_CHALLENGE_POLICY_VERSION,
  family: FIDELITY_EMBEDDING_FAMILY,
  // Measured: measurements.md#first-real-clone. Accept at the warn band,
  // reject below the activation floor, review in between.
  acceptAtOrAbove: 0.78,
  reviewAtOrAbove: 0.70,
  // Recorded so a reader can see how much headroom a genuine owner has.
  measuredOwnerCeiling: 0.8869,
  // PROVISIONAL, unmeasured. See the block above.
  transcriptOverlapMin: 0.60,
  // The nonce is not scored, it is required. Digits generated after a
  // recording was made cannot be in that recording.
  requireNonce: true,
  // Two reference windows is the shape measurements.md#first-real-clone
  // actually measured the 0.8869 ceiling with. One is an anecdote.
  minReferenceWindows: 2,
  // How long an issued sentence stays speakable.
  challengeTtlMinutes: 3,
  // How long an accepted decision stands before the owner has to prove it
  // again. Matches LIVENESS_VERIFICATION_POLICY.biometricConsentDays so the
  // two identity paths expire on the same clock rather than on two.
  evidenceDays: 90,
  maxAttemptsPerDay: 10,
});

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;
// Everything a decision may durably remember. The transcript text, the
// sentence the owner spoke and every embedding vector are absent by
// construction, and `basisIsContentFree` refuses to persist a basis carrying
// anything else. Same law as api/_replica-liveness-verification.js's
// SAFE_RESULT_KEYS, for the same reason: a verification record is a place a
// person's biometrics go to live forever if nobody writes the whitelist down.
const SAFE_BASIS_KEYS = new Set([
  "policy_version", "verifier", "verifier_version", "embedding_family",
  "similarity", "similarity_p10", "similarity_worst",
  "reference_windows", "candidate_windows", "embedding_dimension",
  "transcript_overlap", "transcript_tokens", "nonce_match", "nonce_digits",
  "accept_at_or_above", "review_at_or_above", "transcript_overlap_min",
  "input_sha256", "transcript_input_sha256", "sentence_hash",
  "reference_genome_version", "decision", "failure_code",
]);

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

// ── the sentence bank ─────────────────────────────────────────────────────
//
// SHAPES, NEVER LINES. These are deliberately flat, concrete, unquotable
// statements about nothing: a bus, a window, tea, a train. Nothing here is
// persona material, nothing is in the register the product speaks in, and
// nothing is a sentence a clone could usefully recite if it ever leaked into
// a prompt. CLAUDE.md's first rule is that anything sentence-shaped in a
// prompt gets recited verbatim; a challenge bank is sentence-shaped by
// definition, so the mitigation is that the sentences are worth nothing.
//
// Each is 8 to 12 words before the nonce is appended, plain Hindi, English or
// Hinglish, and uses everyday high-frequency vocabulary so an ASR system has
// the best chance of returning it. No proper nouns: a name is the single
// worst thing for a word-overlap score and the single most likely thing for
// an ASR to spell three ways.
const SENTENCE_BANK = Object.freeze([
  "Subah ki chai thandi ho gayi aur maine phir garam ki",
  "The blue bus stopped near the market and waited for ten minutes",
  "Mera phone table par pada tha aur battery poori khatam thi",
  "She opened the window because the room had become too warm",
  "Aaj baarish hui to sadak par paani bhar gaya tha",
  "The train was late so we bought two cups of tea",
  "Kal raat mujhe neend nahi aayi aur maine kitaab padhi",
  "He counted the coins twice and put them back in the box",
  "Ghar ke bahar ek chhota kutta dhoop mein so raha tha",
  "The lights went out and we sat quietly for a while",
  "Maine darwaza band kiya aur chaabi apni jeb mein rakh li",
  "Someone left an umbrella on the last seat of the bus",
]);

/** Six digits, spoken aloud. Separated with spaces because a reader says them
 *  one at a time and an ASR returns them one at a time. */
function nonceDigits(pick) {
  return Array.from({ length: 6 }, () => String(pick(10))).join(" ");
}

/**
 * A fresh challenge: one bank sentence plus a spoken numeric nonce.
 * `pick` is injectable so the eval is deterministic.
 */
export function voiceChallengeSentence(pick = randomInt) {
  const sentence = SENTENCE_BANK[pick(SENTENCE_BANK.length)];
  const nonce = nonceDigits(pick);
  return Object.freeze({
    sentence: `${sentence}. Code ${nonce}.`,
    nonce,
  });
}

export function voiceChallengeSentenceHash(sentence) {
  return createHash("sha256").update(String(sentence)).digest("hex");
}

// ── comparison, and the script problem ────────────────────────────────────
//
// Devanagari (and every other abugida this product targets) writes vowels as
// combining marks, which are Unicode `Mark_Nonspacing`. Stripping them turns
// one word into a run of bare consonants and a token count into fiction —
// measured, on a real transcript, as 213 characters becoming 74 single-glyph
// "tokens" (rejected.md#romanised-lexicon-meets-devanagari-asr). So `\p{M}`
// is kept, deliberately, and that entry is the reason.
//
// Digits are folded to ASCII across scripts. Devanagari digits (०-९)
// and Arabic-Indic digits are what an Indic ASR may well return for a spoken
// number, and a nonce check that only understands 0-9 would refuse a correct
// reading for a reason that has nothing to do with the speaker.
const DIGIT_FOLD = [
  [0x0966, 0x096f], // Devanagari
  [0x0660, 0x0669], // Arabic-Indic
  [0x06f0, 0x06f9], // Extended Arabic-Indic
  [0x0be6, 0x0bef], // Tamil
  [0x0c66, 0x0c6f], // Telugu
  [0x0ce6, 0x0cef], // Kannada
  [0x09e6, 0x09ef], // Bengali
  [0x0a66, 0x0a6f], // Gurmukhi
  [0x0ae6, 0x0aef], // Gujarati
];

function foldDigits(input) {
  return Array.from(input).map((character) => {
    const code = character.codePointAt(0);
    for (const [start, end] of DIGIT_FOLD) {
      if (code >= start && code <= end) return String(code - start);
    }
    return character;
  }).join("");
}

export function normalizeChallengeSpeech(value) {
  const input = String(value ?? "").normalize("NFKC");
  if (input.length > 4_000) fail("voice_challenge_transcript_too_long", 422);
  return foldDigits(input)
    .toLocaleLowerCase("en-IN")
    // Digits spoken one at a time come back separated; join them so "1 2 3"
    // and "123" are the same nonce. Runs of digits only, never words.
    .replace(/(?<=\p{N})[\s,._-]+(?=\p{N})/gu, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Bag-of-words F1 between the issued sentence and what was heard. Symmetric
 *  on purpose: recall alone rewards a speaker who reads the sentence buried
 *  inside a minute of other speech, and precision alone rewards one who says
 *  three of its words and stops. */
export function transcriptOverlap(sentence, recognized) {
  const expected = normalizeChallengeSpeech(sentence).split(" ").filter(Boolean);
  const actual = normalizeChallengeSpeech(recognized).split(" ").filter(Boolean);
  if (!expected.length) fail("voice_challenge_sentence_empty", 500);
  if (!actual.length) return { overlap: 0, tokens: 0 };
  const available = new Map();
  for (const token of actual) available.set(token, (available.get(token) || 0) + 1);
  let matched = 0;
  for (const token of expected) {
    const count = available.get(token) || 0;
    if (count > 0) {
      matched += 1;
      available.set(token, count - 1);
    }
  }
  const precision = matched / actual.length;
  const recall = matched / expected.length;
  const overlap = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { overlap: Math.round(overlap * 1e6) / 1e6, tokens: actual.length };
}

/** Did the spoken nonce actually appear? Digit-script folded, whitespace
 *  collapsed. This is the half of the liveness argument that survives a total
 *  script mismatch between the bank and the ASR. */
export function nonceSpoken(nonce, recognized) {
  const digits = normalizeChallengeSpeech(nonce).replace(/\D/g, "");
  if (digits.length < 4) fail("voice_challenge_nonce_invalid", 500);
  return normalizeChallengeSpeech(recognized).replace(/\D/g, "").includes(digits);
}

export function basisIsContentFree(basis) {
  return basis && typeof basis === "object" && !Array.isArray(basis) &&
    Object.keys(basis).every((key) => SAFE_BASIS_KEYS.has(key)) &&
    !/"(?:transcript|recognized_text|sentence|vector|embedding|provider_ref|media_url)"\s*:/i
      .test(JSON.stringify(basis));
}

/**
 * The verdict. PURE: vectors and strings in, a decision out. No I/O, no
 * model, no network — the same seam `api/_fidelity.js` documents, and the
 * reason the whole thing is testable offline with fixtures.
 *
 * Order matters and is fail-closed. The transcript gates are checked BEFORE
 * the similarity is allowed to accept anything, because a high similarity on
 * a replayed recording is not evidence of a live person; it is evidence that
 * the recording is of the right person, which was never in doubt.
 */
export function decideVoiceChallenge(input, policy = VOICE_CHALLENGE_POLICY) {
  const sentence = String(input?.sentence || "");
  const nonce = String(input?.nonce || "");
  if (!sentence || !nonce) fail("voice_challenge_binding_missing", 500);
  if (voiceChallengeSentenceHash(sentence) !== String(input?.sentenceHash || "").toLowerCase()) {
    fail("voice_challenge_sentence_binding_invalid", 500);
  }
  const inputSha = String(input?.inputSha256 || "").toLowerCase();
  const transcriptSha = String(input?.transcriptInputSha256 || "").toLowerCase();
  if (!SHA256.test(inputSha) || !SHA256.test(transcriptSha)) fail("voice_challenge_input_hash_invalid", 503);

  const score = fidelityScore(
    embeddingVectors(input?.referenceEmbeddings, policy.family),
    embeddingVectors(input?.candidateEmbeddings, policy.family),
  );
  const { overlap, tokens } = transcriptOverlap(sentence, input?.recognizedText);
  const nonceMatch = nonceSpoken(nonce, input?.recognizedText);

  // Fail-closed ladder. Each rung names ONE reason, so a person told "not a
  // match" can be told which check said so.
  const failureCode =
    score.references < policy.minReferenceWindows ? "reference_evidence_insufficient" :
    policy.requireNonce && !nonceMatch ? "spoken_code_missing" :
    overlap < policy.transcriptOverlapMin ? "sentence_not_read" :
    score.mean < policy.reviewAtOrAbove ? "voice_did_not_match" :
    "";
  const decision = failureCode ? "reject"
    : score.mean >= policy.acceptAtOrAbove ? "accept"
      : "review";

  const basis = {
    policy_version: policy.version,
    verifier: String(input?.verifier || ""),
    verifier_version: String(input?.verifierVersion || ""),
    embedding_family: policy.family,
    similarity: score.mean,
    similarity_p10: score.p10,
    similarity_worst: score.worst,
    reference_windows: score.references,
    candidate_windows: score.windows,
    embedding_dimension: score.dimension,
    transcript_overlap: overlap,
    transcript_tokens: tokens,
    nonce_match: nonceMatch,
    nonce_digits: normalizeChallengeSpeech(nonce).replace(/\D/g, "").length,
    accept_at_or_above: policy.acceptAtOrAbove,
    review_at_or_above: policy.reviewAtOrAbove,
    transcript_overlap_min: policy.transcriptOverlapMin,
    input_sha256: inputSha,
    transcript_input_sha256: transcriptSha,
    sentence_hash: input.sentenceHash.toLowerCase(),
    reference_genome_version: Number(input?.referenceGenomeVersion) || null,
    decision,
    failure_code: failureCode,
  };
  if (!basisIsContentFree(basis)) fail("voice_challenge_basis_contains_sensitive_data", 500);
  return Object.freeze({
    decision,
    // Only `accept` writes the identity columns. `review` is a decided,
    // recorded outcome that does NOT open the gate — the honest place for a
    // number nobody can defend, given that false acceptance is unmeasured.
    verified: decision === "accept",
    failureCode,
    similarity: score.mean,
    transcriptOverlap: overlap,
    basis: Object.freeze(basis),
  });
}

export function voiceChallengeLeaseHash(token) {
  if (typeof token !== "string" || token.length < 32) fail("voice_challenge_lease_token_required", 500);
  return createHash("sha256").update(`replica-voice-challenge-lease:v1:${token}`).digest("hex");
}

/** The env seam. Default OFF so the deployed tree is byte-identical in
 *  behaviour until the main loop turns it on, exactly as asked. */
export function voiceIdentityChallengeEnabled(env = process.env) {
  return String(env?.VOICE_IDENTITY_CHALLENGE || "") === "1";
}

export function clientVoiceChallenge(row) {
  if (!row) return null;
  return {
    challenge_id: row.challenge_id,
    replica_id: row.replica_id,
    sentence: row.sentence,
    state: row.state,
    decision: row.decision || "",
    attempt: Number(row.attempt),
    captured_source_id: row.captured_source_id || null,
    transcript_source_id: row.transcript_source_id || null,
    failure_code: row.failure_code || "",
    // The score is shown to the owner. It is their own number about their own
    // voice, and hiding it would make "not a match" unanswerable.
    similarity: row.similarity == null ? null : Number(row.similarity),
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    decided_at: row.decided_at || null,
    updated_at: row.updated_at,
  };
}

const CHALLENGE_RETURNING = `challenge_id, replica_id, sentence, state, decision, attempt,
  captured_source_id, transcript_source_id, failure_code, similarity,
  issued_at, expires_at, decided_at, updated_at`;

// ── issue ─────────────────────────────────────────────────────────────────
//
// The eligibility predicate is deliberately the same shape the Azure liveness
// challenge uses, minus the identity-case join it cannot satisfy: a self
// replica, alive, with capture + storage consent, and no other challenge
// already in flight. It ALSO requires an existing voice genome, because there
// is nothing to compare a voice against until the owner has enrolled one —
// asking somebody to prove they are the voice in a reference that does not
// exist is the "waiting on you" blame inversion AGENTS.md names.
export async function issueOwnedVoiceChallenge(db, ownerUserId, id, options = {}) {
  const rid = replicaId(id);
  const issued = options.sentence
    ? { sentence: options.sentence, nonce: String(options.nonce || "") }
    : voiceChallengeSentence(options.pick);
  if (!issued.nonce) fail("voice_challenge_nonce_invalid", 500);
  const hash = voiceChallengeSentenceHash(issued.sentence);
  const challengeId = options.challengeId || randomUUID();
  const rows = await db(
    `with owned as (
       select r.replica_id, r.policy_version from vy_replica r
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
          and r.subject_mode='self' and r.policy_version=$5
          and r.lifecycle not in ('revoked','purging')
          and not exists (
            select 1 from vy_replica_voice_challenge inflight
             where inflight.replica_id=r.replica_id and inflight.owner_user_id=r.owner_user_id
               and inflight.state in ('captured','verifying')
          )
          and not exists (
            select 1 from unnest(array['capture','storage']::text[]) required(scope)
             where not exists (
               select 1 from vy_replica_consent c
                where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
                  and c.scope=required.scope and c.policy_version=r.policy_version
                  and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
             )
          )
     ), genome as (
       select g.version from vy_replica_voice_genome g join owned o on o.replica_id=g.replica_id
        order by g.version desc limit 1
     ), attempts as (
       select count(*)::integer as n from vy_replica_voice_challenge
        where replica_id=$1::uuid and owner_user_id=$2::uuid and issued_at>now()-interval '24 hours'
     ), expired as (
       update vy_replica_voice_challenge ch set state='expired',failure_code='challenge_superseded',
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        where ch.replica_id=$1::uuid and ch.owner_user_id=$2::uuid and ch.state='issued'
          and exists (select 1 from owned)
        returning ch.challenge_id,ch.captured_source_id,ch.transcript_source_id
     ), expired_sources as (
       update vy_replica_source s set state='deleting',updated_at=now()
        from expired e where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
          and s.source_id in (e.captured_source_id,e.transcript_source_id)
          and s.state in ('pending_upload','quarantined','rejected')
       -- RETURNING is mandatory here, not decorative: this CTE is SELECTed
       -- from below (the cross join on count(*) from expired_sources), and
       -- Postgres refuses a data-modifying WITH query that is read without
       -- one. 0A000, at execution time, every time. Caught offline by
       -- evals/sqlcast.mjs before it ever reached a database.
       returning s.source_id
     ), inserted as (
       insert into vy_replica_voice_challenge
         (challenge_id,replica_id,owner_user_id,sentence,sentence_hash,nonce,
          policy_version,challenge_policy,attempt,reference_genome_version,expires_at)
       select $3::uuid,owned.replica_id,$2::uuid,$4,$6,$7,owned.policy_version,$8,
              attempts.n+1,genome.version,now()+($9::integer*interval '1 minute')
         from owned cross join attempts cross join genome
         cross join (select count(*) from expired) cleared
         cross join (select count(*) from expired_sources) sources_cleared
        where attempts.n < $10::integer
       on conflict do nothing
       returning ${CHALLENGE_RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select $1::uuid,$2::uuid,'voice_identity.challenge.issue','voice_challenge',
              challenge_id::text,$5,'allowed',jsonb_build_object('attempt',attempt)
         from inserted
     )
     select * from inserted`,
    [rid, ownerUserId, challengeId, issued.sentence, REPLICA_POLICY_VERSION, hash, issued.nonce,
      VOICE_CHALLENGE_POLICY_VERSION, VOICE_CHALLENGE_POLICY.challengeTtlMinutes,
      VOICE_CHALLENGE_POLICY.maxAttemptsPerDay],
  );
  return clientVoiceChallenge(rows[0]);
}

export async function latestOwnedVoiceChallenge(db, ownerUserId, id) {
  const rid = replicaId(id);
  await db(
    `with expired as (
       update vy_replica_voice_challenge ch set state='expired',failure_code='challenge_expired',
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        where ch.replica_id=$1::uuid and ch.owner_user_id=$2::uuid
          and ch.state='issued' and ch.expires_at<=now()
        returning ch.challenge_id,ch.captured_source_id,ch.transcript_source_id
     ), sources as (
       update vy_replica_source s set state='deleting',updated_at=now()
        from expired e where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
          and s.source_id in (e.captured_source_id,e.transcript_source_id)
          and s.state in ('pending_upload','quarantined','rejected')
     ) select challenge_id from expired`,
    [rid, ownerUserId],
  );
  const rows = await db(
    `select ${CHALLENGE_RETURNING} from vy_replica_voice_challenge
      where replica_id=$1::uuid and owner_user_id=$2::uuid
      order by issued_at desc limit 1`,
    [rid, ownerUserId],
  );
  return clientVoiceChallenge(rows[0]);
}

export async function cancelOwnedVoiceChallenge(db, ownerUserId, id, challenge) {
  const rows = await db(
    `with cancelled as (
       update vy_replica_voice_challenge ch set state='expired',failure_code='owner_cancelled',
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        where ch.challenge_id=$3::uuid and ch.replica_id=$1::uuid and ch.owner_user_id=$2::uuid
          and ch.state in ('issued','captured','verifying')
        returning ch.*
     ), sources as (
       update vy_replica_source s set state='deleting',updated_at=now()
        from cancelled ch where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
          and s.source_id in (ch.captured_source_id,ch.transcript_source_id)
          and s.state in ('pending_upload','quarantined','rejected')
     ), attempts as (
       update vy_replica_voice_challenge_attempt a set outcome='failed',
              failure_code='owner_cancelled',finished_at=now()
        from cancelled ch where a.challenge_id=ch.challenge_id
          and a.attempt=ch.verification_attempt and a.outcome='running'
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'voice_identity.challenge.cancel','voice_challenge',
              challenge_id::text,policy_version,'allowed',
              jsonb_build_object('raw_erasure_queued',captured_source_id is not null)
         from cancelled
     ) select * from cancelled`,
    [replicaId(id), ownerUserId, replicaId(challenge)],
  );
  return clientVoiceChallenge(rows[0]);
}

// ── capture ───────────────────────────────────────────────────────────────
//
// TWO sources for one challenge, and the reason is a vendor fact rather than
// a preference. `role` is 'capture' (the camera recording, video/webm or
// video/mp4) or 'transcript' (a 24 kHz mono PCM16 WAV of the same microphone,
// encoded in the browser by src/studio/wavCapture.ts's exported encoder).
//
// The capture clip is what services/voice-evidence embeds: its adapter's
// ALLOWED_MIME already lists video/webm and video/mp4, so that path is
// established in code.
//
// The WAV is what Sarvam transcribes. Sarvam's synchronous endpoint is
// measured in this repo on AUDIO only (measurements.md#first-real-clone:
// 4 134 ms for 25 s, hard 30 s cap) and has NEVER been sent a video
// container. Handing it a webm on the launch path would be an unverified
// vendor assumption standing between an owner and their own product, and
// there is no ffmpeg on Vercel to demux one. Two artifacts from ONE
// getUserMedia stream costs an upload and removes the guess.
const CHALLENGE_ROLES = Object.freeze({
  capture: Object.freeze({
    column: "captured_source_id",
    kinds: new Set(["video"]),
    maxBytes: 52_428_800,
  }),
  transcript: Object.freeze({
    column: "transcript_source_id",
    kinds: new Set(["audio"]),
    mimes: new Set(["audio/wav", "audio/x-wav"]),
    maxBytes: 8_388_608,
  }),
});

export async function createVoiceChallengeSource(db, ownerUserId, id, challenge, value, options = {}) {
  const rid = replicaId(id);
  const cid = replicaId(challenge);
  const role = String(value?.role || "");
  const spec = CHALLENGE_ROLES[role];
  if (!spec) fail("voice_challenge_role_invalid", 400);
  const input = sourceUploadInput({ ...value, purpose: "identity_challenge" });
  if (!spec.kinds.has(input.kind)) fail("voice_challenge_kind_invalid", 400);
  if (spec.mimes && !spec.mimes.has(input.mime)) fail("voice_challenge_mime_invalid", 400);
  if (input.byteSize > spec.maxBytes) fail("voice_challenge_too_large", 413);
  if (input.containsThirdParties) fail("voice_challenge_must_be_self_only", 409);
  const sourceId = options.sourceId || randomUUID();
  const path = privateObjectPath(ownerUserId, rid, sourceId);
  const provenance = JSON.stringify({
    declaration: "client_sha256",
    sha256_status: "pending_server_verification",
    voice_challenge_id: cid,
    voice_challenge_role: role,
    filename_retained: false,
  });
  const rows = await db(
    `with challenge as (
       select ch.challenge_id, ch.replica_id, r.policy_version
         from vy_replica_voice_challenge ch
         join vy_replica r on r.replica_id=ch.replica_id and r.owner_user_id=ch.owner_user_id
        where ch.challenge_id=$3::uuid and ch.replica_id=$1::uuid and ch.owner_user_id=$2::uuid
          and ch.state='issued' and ch.expires_at>now() and ch.${spec.column} is null
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
     ), capture as (
       select c.consent_id from vy_replica_consent c join challenge ch on ch.replica_id=c.replica_id
        where c.owner_user_id=$2::uuid and c.scope='capture'
          and c.policy_version=ch.policy_version and c.revoked_at is null
          and (c.expires_at is null or c.expires_at>now())
        order by c.granted_at desc limit 1
     ), storage_ok as (
       select 1 from vy_replica_consent c join challenge ch on ch.replica_id=c.replica_id
        where c.owner_user_id=$2::uuid and c.scope='storage'
          and c.policy_version=ch.policy_version and c.revoked_at is null
          and (c.expires_at is null or c.expires_at>now()) limit 1
     ), inserted as (
       insert into vy_replica_source
         (source_id,replica_id,owner_user_id,consent_id,kind,capture_mode,
          storage_bucket,object_path,mime,byte_size,sha256,contains_third_parties,provenance)
       select $4::uuid,challenge.replica_id,$2::uuid,capture.consent_id,$5,'identity_challenge',
              $6,$7,$8,$9::int8,$10,false,$11::jsonb
         from challenge cross join capture cross join storage_ok
       returning source_id, replica_id, owner_user_id, kind, capture_mode, storage_bucket,
                 object_path, mime, byte_size, sha256, state, contains_third_parties,
                 rejection_code, created_at, updated_at
     ), attached as (
       update vy_replica_voice_challenge ch set ${spec.column}=inserted.source_id,updated_at=now()
         from inserted where ch.challenge_id=$3::uuid and ch.replica_id=$1::uuid
           and ch.owner_user_id=$2::uuid
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select $1::uuid,$2::uuid,'voice_identity.challenge.upload.create','source',source_id::text,
              (select policy_version from challenge),'allowed',
              jsonb_build_object('kind',kind,'byte_size',byte_size,'role',$12::text)
         from inserted
     )
     select * from inserted`,
    [rid, ownerUserId, cid, sourceId, input.kind, REPLICA_STORAGE_WRITE_BUCKET, path,
      input.mime, input.byteSize, input.sha256, provenance, role],
  );
  return rows[0] || null;
}

/**
 * Finalize ONE of the two uploads. The challenge only moves to `captured`
 * when BOTH are quarantined, because the verifier needs both and a challenge
 * that says "captured" with half its evidence would be leased and then fail
 * for a reason the owner cannot act on.
 */
export async function finalizeVoiceChallengeSource(db, ownerUserId, id, challenge, source, objectInfo) {
  const rid = replicaId(id);
  const cid = replicaId(challenge);
  const sid = replicaId(source);
  const verdict = verifyStoredObject(
    { byte_size: objectInfo.expectedByteSize, mime: objectInfo.expectedMime },
    objectInfo,
  );
  const sourceState = verdict.ok ? "quarantined" : "rejected";
  const facts = JSON.stringify({
    storage_metadata_verified: verdict.ok,
    storage_object_id: verdict.ok ? String(objectInfo.objectId || "").slice(0, 256) : "",
    sha256_status: "pending_server_verification",
  });
  const rows = await db(
    `with eligible as (
       select s.source_id
         from vy_replica_source s
         join vy_replica_voice_challenge ch
           on ch.replica_id=s.replica_id and ch.owner_user_id=s.owner_user_id
          and s.source_id in (ch.captured_source_id,ch.transcript_source_id)
        where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.source_id=$4::uuid
          and s.capture_mode='identity_challenge' and s.state='pending_upload'
          and ch.challenge_id=$3::uuid and ch.state='issued' and ch.expires_at>now()
     ), updated_source as (
       update vy_replica_source s
          set state=$5,rejection_code=$6,updated_at=now(),provenance=provenance||$7::jsonb
         from eligible e where s.source_id=e.source_id
       returning s.*
     ), updated_challenge as (
       update vy_replica_voice_challenge ch
          set state=case
                when $5<>'quarantined' then 'failed'
                when exists (
                  select 1 from vy_replica_source ready
                   where ready.source_id=ch.captured_source_id and ready.state='quarantined'
                ) and exists (
                  select 1 from vy_replica_source ready
                   where ready.source_id=ch.transcript_source_id and ready.state='quarantined'
                ) then 'captured'
                else ch.state end,
              decision=case when $5<>'quarantined' then 'reject' else ch.decision end,
              decided_at=case when $5<>'quarantined' then now() else ch.decided_at end,
              failure_code=case when $5<>'quarantined' then $6 else ch.failure_code end,
              updated_at=now()
        from updated_source s
        where ch.challenge_id=$3::uuid and ch.replica_id=$1::uuid and ch.owner_user_id=$2::uuid
        returning ch.*
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select $1::uuid,$2::uuid,'voice_identity.challenge.upload.finalize','voice_challenge',
              challenge_id::text,$8,case when $5='quarantined' then 'allowed' else 'denied' end,
              jsonb_build_object('reason_code',$6) from updated_challenge
     )
     select row_to_json(s) as source, row_to_json(ch) as challenge
       from updated_source s cross join updated_challenge ch`,
    [rid, ownerUserId, cid, sid, sourceState, verdict.code, facts, REPLICA_POLICY_VERSION],
  );
  const row = rows[0];
  if (!row) return null;
  return { source: row.source, challenge: clientVoiceChallenge(row.challenge) };
}

// ── verification ──────────────────────────────────────────────────────────

/**
 * Lease exactly one captured challenge, atomically, and hand back everything
 * the verifier needs: both private object locators and the owner's OWN
 * reference vectors, read straight out of the newest VoiceGenome definition.
 *
 * The reference comes from the genome rather than from a fresh scan of
 * evidence rows on purpose: the genome IS the owner's selected reference (its
 * `speaker_identity.embedding_families` is built only from ACCEPTED evidence,
 * see api/_replica-processing/builders.js), and scoring a challenge against
 * the exact reference the voice was built from is the binding that makes the
 * answer mean something. Any status is eligible, including `draft`, because
 * this gate runs BEFORE genome approval in the wizard.
 */
export async function leaseNextVoiceChallenge(db, verifier, options = {}) {
  if (typeof db !== "function") fail("voice_challenge_database_required", 500);
  const provider = String(verifier?.name || "").trim();
  const version = String(verifier?.version || "").trim();
  if (!provider || !version || typeof verifier?.verify !== "function") fail("voice_challenge_verifier_required", 503);
  const leaseToken = options.leaseToken || randomBytes(32).toString("hex");
  const leaseMs = Math.max(30_000, Math.min(600_000, Number(options.leaseMs || 300_000)));
  const rows = await db(
    `with candidate as (
       select ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.verification_attempt
         from vy_replica_voice_challenge ch
         join vy_replica r on r.replica_id=ch.replica_id and r.owner_user_id=ch.owner_user_id
         join vy_replica_source cap on cap.source_id=ch.captured_source_id
          and cap.replica_id=ch.replica_id and cap.owner_user_id=ch.owner_user_id
         join vy_replica_source tr on tr.source_id=ch.transcript_source_id
          and tr.replica_id=ch.replica_id and tr.owner_user_id=ch.owner_user_id
        where ((ch.state='captured' and ch.verification_next_attempt_at<=now()) or
               (ch.state='verifying' and (ch.verification_lease_expires_at is null
                                          or ch.verification_lease_expires_at<=now())))
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and cap.state='quarantined' and cap.capture_mode='identity_challenge'
          and cap.kind='video' and cap.contains_third_parties=false
          and tr.state='quarantined' and tr.capture_mode='identity_challenge'
          and tr.kind='audio' and tr.contains_third_parties=false
          and exists (
            select 1 from vy_replica_voice_genome g where g.replica_id=ch.replica_id
          )
        order by ch.verification_next_attempt_at,ch.issued_at limit 1 for update of ch skip locked
     ), expired as (
       update vy_replica_voice_challenge_attempt a set outcome='retry',failure_code='lease_expired',
              finished_at=now()
        from candidate c where a.challenge_id=c.challenge_id and a.attempt=c.verification_attempt
          and a.outcome='running'
     ), leased as (
       update vy_replica_voice_challenge ch set state='verifying',
              verification_attempt=ch.verification_attempt+1,verification_lease_token_hash=$1,
              verification_leased_at=now(),
              verification_lease_expires_at=now()+($4::integer*interval '1 millisecond'),
              updated_at=now()
        from candidate c where ch.challenge_id=c.challenge_id
       returning ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.sentence,ch.sentence_hash,
                 ch.nonce,ch.captured_source_id,ch.transcript_source_id,ch.verification_attempt,
                 ch.verification_lease_expires_at
     ), attempted as (
       insert into vy_replica_voice_challenge_attempt
         (challenge_id,replica_id,owner_user_id,attempt,verifier,verifier_version,outcome)
       select challenge_id,replica_id,owner_user_id,verification_attempt,$2,$3,'running' from leased
     )
     select l.*,
            cap.kind cap_kind,cap.mime cap_mime,cap.byte_size cap_byte_size,cap.sha256 cap_sha256,
            cap.storage_bucket cap_bucket,cap.object_path cap_path,
            tr.kind tr_kind,tr.mime tr_mime,tr.byte_size tr_byte_size,tr.sha256 tr_sha256,
            tr.storage_bucket tr_bucket,tr.object_path tr_path,
            g.version genome_version,
            g.definition->'speaker_identity'->'embedding_families' as embedding_families,
            g.definition->'references'->'source_ids' as reference_source_ids
       from leased l
       join vy_replica_source cap on cap.source_id=l.captured_source_id
        and cap.replica_id=l.replica_id and cap.owner_user_id=l.owner_user_id
       join vy_replica_source tr on tr.source_id=l.transcript_source_id
        and tr.replica_id=l.replica_id and tr.owner_user_id=l.owner_user_id
       join lateral (
         select x.version,x.definition from vy_replica_voice_genome x
          where x.replica_id=l.replica_id order by x.version desc limit 1
       ) g on true`,
    [voiceChallengeLeaseHash(leaseToken), provider, version, leaseMs],
  );
  const row = rows[0];
  if (!row) return null;
  const families = row.embedding_families && typeof row.embedding_families === "object"
    ? row.embedding_families
    : {};
  const referenceEmbeddings = Array.isArray(families[FIDELITY_EMBEDDING_FAMILY])
    ? families[FIDELITY_EMBEDDING_FAMILY].map((entry) => entry?.vector)
    : [];
  const referenceSourceIds = Array.isArray(row.reference_source_ids) ? row.reference_source_ids : [];
  return Object.freeze({
    leaseToken,
    challengeId: row.challenge_id,
    replicaId: row.replica_id,
    ownerUserId: row.owner_user_id,
    sentence: row.sentence,
    sentenceHash: row.sentence_hash,
    nonce: row.nonce,
    attempt: Number(row.verification_attempt),
    verifierName: provider,
    verifierVersion: version,
    leaseExpiresAt: row.verification_lease_expires_at,
    referenceGenomeVersion: Number(row.genome_version),
    referenceSourceId: referenceSourceIds[0] || null,
    referenceEmbeddings: Object.freeze(referenceEmbeddings),
    capture: Object.freeze({
      sourceId: row.captured_source_id,
      kind: row.cap_kind,
      mime: row.cap_mime,
      byteSize: Number(row.cap_byte_size),
      sha256: row.cap_sha256,
      storageBucket: row.cap_bucket,
      objectPath: row.cap_path,
    }),
    transcript: Object.freeze({
      sourceId: row.transcript_source_id,
      kind: row.tr_kind,
      mime: row.tr_mime,
      byteSize: Number(row.tr_byte_size),
      sha256: row.tr_sha256,
      storageBucket: row.tr_bucket,
      objectPath: row.tr_path,
    }),
  });
}

function requireSettlement(rows, code) {
  if (!rows?.[0]) fail(code, 409);
  return rows[0];
}

/**
 * Settle one leased challenge.
 *
 * The `replica` CTE is THE POINT OF THE WHOLE WORKSTREAM: it writes the same
 * three columns, under the same `age_verified_at is not null` guard, that
 * `completeLivenessVerification` writes when the Azure composite verifier
 * passes. `runtimeBlockers` and `activateOwnedRuntime` are untouched by this
 * change and cannot tell the two paths apart, which is exactly right — the
 * gate reads a row, and there is no second bypass to audit.
 *
 * Raw evidence is queued for deletion on EVERY outcome, accept included. The
 * challenge clip has done its whole job the moment the decision exists, and a
 * verification recording that outlives its verdict is a recording of a
 * person's face and voice sitting in a bucket for no reason.
 */
export async function completeVoiceChallenge(db, lease, verdict, options = {}) {
  if (!verdict || !basisIsContentFree(verdict.basis)) fail("voice_challenge_verdict_invalid", 500);
  if (verdict.basis.decision !== verdict.decision) fail("voice_challenge_verdict_invalid", 500);
  const state = verdict.verified ? "verified" : "failed";
  const evidenceDays = Number(options.evidenceDays || VOICE_CHALLENGE_POLICY.evidenceDays);
  const rows = await db(
    `with target as (
       select ch.challenge_id
         from vy_replica_voice_challenge ch
         join vy_replica r on r.replica_id=ch.replica_id and r.owner_user_id=ch.owner_user_id
         join vy_replica_source cap on cap.source_id=ch.captured_source_id
          and cap.replica_id=ch.replica_id and cap.owner_user_id=ch.owner_user_id
         join vy_replica_source tr on tr.source_id=ch.transcript_source_id
          and tr.replica_id=ch.replica_id and tr.owner_user_id=ch.owner_user_id
         join vy_replica_voice_challenge_attempt a on a.challenge_id=ch.challenge_id
          and a.attempt=ch.verification_attempt and a.outcome='running'
        where ch.challenge_id=$1::uuid and ch.replica_id=$2::uuid and ch.owner_user_id=$3::uuid
          and ch.state='verifying' and ch.verification_attempt=$4::int4
          and ch.verification_lease_token_hash=$5 and ch.verification_lease_expires_at>now()
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and cap.state='quarantined' and cap.capture_mode='identity_challenge' and cap.sha256=$11
          and tr.state='quarantined' and tr.capture_mode='identity_challenge' and tr.sha256=$12
          and a.verifier=$13 and a.verifier_version=$14
        for update of ch
     ), challenge as (
       update vy_replica_voice_challenge ch set state=$6,decision=$7,failure_code=$8,
              similarity=$9::float8,transcript_overlap=$15::float8,decision_basis=$10::jsonb,
              decided_at=now(),verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        from target t where ch.challenge_id=t.challenge_id returning ch.*
     ), evidence_sources as (
       update vy_replica_source s set state='deleting',updated_at=now()
        from challenge ch where s.replica_id=ch.replica_id and s.owner_user_id=ch.owner_user_id
          and s.source_id in (ch.captured_source_id,ch.transcript_source_id)
          and s.state in ('pending_upload','quarantined','rejected')
     ), replica as (
       update vy_replica r set identity_verified_at=coalesce(r.identity_verified_at,now()),
              liveness_verified_at=coalesce(r.liveness_verified_at,now()),
              identity_expires_at=greatest(coalesce(r.identity_expires_at,now()),
                                           now()+($16::integer*interval '1 day')),
              updated_at=now()
        from challenge ch
        where $6='verified' and r.replica_id=ch.replica_id and r.owner_user_id=ch.owner_user_id
          and r.age_verified_at is not null
       returning r.replica_id,r.owner_user_id
     ), attempted as (
       update vy_replica_voice_challenge_attempt a set outcome=$6,failure_code=$8,
              result=$10::jsonb,finished_at=now()
        from challenge ch where a.challenge_id=ch.challenge_id
          and a.attempt=ch.verification_attempt and a.outcome='running'
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'voice_identity.challenge.decide','voice_challenge',
              challenge_id::text,policy_version,
              case when $6='verified' then 'allowed' else 'denied' end,
              jsonb_build_object('decision',$7::text,'reason_code',$8::text,
                                 'challenge_policy',$17::text)
         from challenge
     ) select challenge_id,state,decision from challenge`,
    [lease.challengeId, lease.replicaId, lease.ownerUserId, lease.attempt,
      voiceChallengeLeaseHash(lease.leaseToken), state, verdict.decision, verdict.failureCode,
      verdict.similarity, JSON.stringify(verdict.basis), lease.capture.sha256,
      lease.transcript.sha256, lease.verifierName, lease.verifierVersion,
      verdict.transcriptOverlap, evidenceDays, VOICE_CHALLENGE_POLICY_VERSION],
  );
  return requireSettlement(rows, "voice_challenge_settlement_failed");
}

export async function retryVoiceChallenge(db, lease, input = {}) {
  const retryAfterMs = Math.max(30_000, Math.min(MAX_RETRY_MS, Number(input.retryAfterMs || 30_000)));
  const code = String(input.failureCode || input.error?.code || "voice_challenge_verifier_unavailable")
    .toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 80) || "voice_challenge_verifier_unavailable";
  const rows = await db(
    `with retried as (
       update vy_replica_voice_challenge ch set state='captured',failure_code=$7,
              verification_next_attempt_at=now()+($6::integer*interval '1 millisecond'),
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        where ch.challenge_id=$1::uuid and ch.replica_id=$2::uuid and ch.owner_user_id=$3::uuid
          and ch.state='verifying' and ch.verification_attempt=$4::int4
          and ch.verification_lease_token_hash=$5 and ch.verification_lease_expires_at>now()
       returning ch.challenge_id,ch.verification_attempt
     ), attempted as (
       update vy_replica_voice_challenge_attempt a set outcome='retry',failure_code=$7,finished_at=now()
        from retried r where a.challenge_id=r.challenge_id and a.attempt=r.verification_attempt
          and a.outcome='running'
     ) select challenge_id from retried`,
    [lease.challengeId, lease.replicaId, lease.ownerUserId, lease.attempt,
      voiceChallengeLeaseHash(lease.leaseToken), retryAfterMs, code],
  );
  return requireSettlement(rows, "voice_challenge_lease_lost");
}

export function voiceChallengeRetryDelayMs(attempt) {
  const safe = Math.max(1, Math.min(30, Number(attempt) || 1));
  return Math.min(MAX_RETRY_MS, 30_000 * (2 ** (safe - 1)));
}

/** Time out issued-but-never-captured challenges and half-captured ones, and
 *  queue their raw evidence for deletion. A challenge whose sentence has
 *  expired can never be settled, so leaving its recording in the bucket is
 *  just storage of a person's face with no purpose attached. */
export async function expireVoiceChallenges(db) {
  const rows = await db(
    `with expired as (
       update vy_replica_voice_challenge ch set state='expired',failure_code='challenge_expired',
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        where ch.state='issued' and ch.expires_at<=now()
        returning ch.challenge_id,ch.replica_id,ch.owner_user_id,
                  ch.captured_source_id,ch.transcript_source_id,ch.verification_attempt
     ), sources as (
       update vy_replica_source s set state='deleting',updated_at=now()
        from expired e where s.replica_id=e.replica_id and s.owner_user_id=e.owner_user_id
          and s.source_id in (e.captured_source_id,e.transcript_source_id)
          and s.state in ('pending_upload','quarantined','rejected')
     ), attempts as (
       update vy_replica_voice_challenge_attempt a set outcome='failed',
              failure_code='challenge_expired',finished_at=now()
        from expired e where a.challenge_id=e.challenge_id and a.attempt=e.verification_attempt
          and a.outcome='running'
     ) select count(*)::integer expired_count from expired`,
  );
  return Number(rows?.[0]?.expired_count || 0);
}

/**
 * One sweep tick.
 *
 * WAKE THEN SIGN is not implemented here and must not be: it belongs to the
 * voice-evidence adapter, which already does it (`awaitReady` on the
 * unauthenticated `/healthz` before any signature is minted, see
 * api/_replica-processing/providers/azure-voice-evidence.js and
 * rejected.md#hmac-skew-shorter-than-cold-start). What this loop contributes
 * is the OTHER half of that lesson: a cold service that does not come up
 * inside the adapter's ready budget raises a RETRYABLE error, so the tick
 * that woke it returns the challenge to the queue instead of failing it, and
 * the next tick five minutes later finds a warm service. The first attempt
 * paying for the wake is the design, not a bug to be worked around by
 * widening anybody's clock window.
 */
export async function runVoiceChallengeSweep(options = {}) {
  const db = options.db;
  const verifier = options.verifier;
  if (typeof db !== "function" || !verifier) fail("voice_challenge_worker_configuration_required", 500);
  const lease = options.lease || leaseNextVoiceChallenge;
  const complete = options.complete || completeVoiceChallenge;
  const retry = options.retry || retryVoiceChallenge;
  const expire = options.expire || expireVoiceChallenges;
  const decide = options.decide || decideVoiceChallenge;
  const maxJobs = Math.max(1, Math.min(4, Number(options.maxJobs || 1)));
  const summary = { expired: await expire(db), leased: 0, accepted: 0, review: 0, rejected: 0, retried: 0, discarded: 0 };
  while (summary.leased < maxJobs) {
    const claimed = await lease(db, verifier);
    if (!claimed) break;
    summary.leased += 1;
    try {
      const measured = await verifier.verify(claimed);
      const verdict = decide({
        sentence: claimed.sentence,
        sentenceHash: claimed.sentenceHash,
        nonce: claimed.nonce,
        referenceEmbeddings: claimed.referenceEmbeddings,
        referenceGenomeVersion: claimed.referenceGenomeVersion,
        candidateEmbeddings: measured.candidateEmbeddings,
        recognizedText: measured.recognizedText,
        inputSha256: measured.inputSha256,
        transcriptInputSha256: measured.transcriptInputSha256,
        verifier: claimed.verifierName,
        verifierVersion: claimed.verifierVersion,
      });
      await complete(db, claimed, verdict);
      if (verdict.decision === "accept") summary.accepted += 1;
      else if (verdict.decision === "review") summary.review += 1;
      else summary.rejected += 1;
    } catch (error) {
      try {
        await retry(db, claimed, { error, retryAfterMs: voiceChallengeRetryDelayMs(claimed.attempt) });
        summary.retried += 1;
      } catch (retryError) {
        if (retryError?.code !== "voice_challenge_lease_lost") throw retryError;
        summary.discarded += 1;
      }
    }
  }
  return Object.freeze(summary);
}

export { clientSource };
