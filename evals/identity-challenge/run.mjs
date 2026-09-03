// WS-R2. Owner identity by speaker verification: the decision math, the
// anti-replay half, the fail-closed ladder, the SQL bindings, and the gate
// predicate.
//
// Offline, deterministic, $0, no GPU, no model, no network. Every embedding
// here is a fixture vector and every database call is a function that returns
// rows, which is exactly what the two seams in this workstream buy:
// `decideVoiceChallenge` is pure, and `createVoiceChallengeVerifier` is the
// only thing that talks to a service.
//
// The load-bearing check is the LAST one in section 4. It removes the
// transcript gate and shows the same replayed recording sailing through, which
// is the only way to demonstrate that the transcript half is what stops a
// replay rather than decoration next to the speaker score.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VOICE_CHALLENGE_POLICY,
  VOICE_CHALLENGE_POLICY_VERSION,
  basisIsContentFree,
  cancelOwnedVoiceChallenge,
  clientVoiceChallenge,
  completeVoiceChallenge,
  decideVoiceChallenge,
  expireVoiceChallenges,
  finalizeVoiceChallengeSource,
  issueOwnedVoiceChallenge,
  leaseNextVoiceChallenge,
  nonceSpoken,
  normalizeChallengeSpeech,
  retryVoiceChallenge,
  runVoiceChallengeSweep,
  transcriptOverlap,
  voiceChallengeLeaseHash,
  voiceChallengeSentence,
  voiceChallengeSentenceHash,
  voiceIdentityChallengeEnabled,
  createVoiceChallengeSource,
} from "../../api/_replica-voice-identity.js";
import { runtimeBlockers } from "../../api/_replica-runtime.js";
import { sourceUploadInput } from "../../api/_replica-source.js";
import { createVoiceChallengeVerifier } from "../../api/_voice-identity/verifier.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CHALLENGE = "10000000-0000-4000-8000-000000000001";
const RID = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const CAP_SOURCE = "40000000-0000-4000-8000-000000000004";
const TR_SOURCE = "50000000-0000-4000-8000-000000000005";
const REF_SOURCE = "60000000-0000-4000-8000-000000000006";
const TOKEN = "voice-identity-challenge-lease-token-longer-than-thirty-two";
const CAP_SHA = "a".repeat(64);
const TR_SHA = "b".repeat(64);
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

// ── fixture vectors ───────────────────────────────────────────────────────
// Unit vectors in a small space, the same technique evals/fidelity/run.mjs
// uses: `at(target, off, c)` names its own cosine, so a tier fixture is a dial
// rather than a magic array of decimals.
const DIM = 8;
const basis = (index) => Array.from({ length: DIM }, (_, i) => (i === index ? 1 : 0));
const unit = (v) => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); return v.map((x) => x / n); };
const at = (target, off, c) => unit(target.map((n, i) => c * n + Math.sqrt(1 - c * c) * off[i]));

const OWNER_VOICE = basis(0);
const OFF = basis(1);
// Two reference windows, which is the shape measurements.md#first-real-clone
// actually measured its 0.8869 owner-vs-owner ceiling with.
const REFERENCE = [OWNER_VOICE, at(OWNER_VOICE, OFF, 0.995)];
// A live reading by the owner. Scored against the reference pair this lands
// at about 0.88, which is where the real measurement sits.
const LIVE_OWNER = at(OWNER_VOICE, OFF, 0.877);
// A different human. There is no measured impostor distribution on this
// stack, which is the point of the comment beside the thresholds; this
// fixture only shows the ladder responds, it does NOT claim a real impostor
// scores here.
const STRANGER = at(OWNER_VOICE, OFF, 0.42);
const BORDERLINE = at(OWNER_VOICE, OFF, 0.735);

const ISSUED = voiceChallengeSentence(() => 0);
const SENTENCE = ISSUED.sentence;
const SENTENCE_HASH = voiceChallengeSentenceHash(SENTENCE);

// ── 1. the challenge itself ───────────────────────────────────────────────
ok("an issued challenge is a short plain sentence plus a spoken numeric code",
  SENTENCE.split(" ").length >= 9 && SENTENCE.split(" ").length <= 20 &&
  /Code(?: \d){6}\./.test(SENTENCE) && ISSUED.nonce.replace(/\D/g, "").length === 6);

// SHAPES, NEVER LINES (CLAUDE.md). A challenge bank is sentence-shaped by
// definition, so the mitigation is that no sentence in it is worth reciting:
// nothing about the product, no persona register, no proper nouns.
const moduleSource = readFileSync(join(ROOT, "api/_replica-voice-identity.js"), "utf8");
const bank = [...moduleSource.matchAll(/^  "([^"]+)",$/gm)].map((m) => m[1]);
ok("the sentence bank is real and every entry is 8 to 12 words",
  bank.length >= 8 && bank.every((line) => {
    const words = line.split(" ").length;
    return words >= 8 && words <= 12;
  }));
ok("no bank sentence is persona material a clone could usefully recite",
  bank.every((line) => !/\b(?:Vyakti|Meera|clone|replica|AI|teacher|student)\b/i.test(line)) &&
  bank.every((line) => !/[A-Z][a-z]+ [A-Z][a-z]+/.test(line)));
const drawn = new Set(Array.from({ length: 12 }, (_, i) => voiceChallengeSentence(() => i % 12).sentence));
ok("different draws produce different sentences rather than one fixed phrase", drawn.size > 1);

// ── 2. the comparison, and the script problem underneath it ───────────────
ok("an exact reading scores a perfect overlap", transcriptOverlap(SENTENCE, SENTENCE).overlap === 1);
ok("reading half the sentence does not reach the threshold",
  transcriptOverlap(SENTENCE, SENTENCE.split(" ").slice(0, 4).join(" ")).overlap
    < VOICE_CHALLENGE_POLICY.transcriptOverlapMin);
ok("padding the reading with unrelated speech lowers the bounded overlap",
  transcriptOverlap(SENTENCE, `${SENTENCE} ${"aur phir maine socha ki ".repeat(12)}`).overlap < 1);

// rejected.md#romanised-lexicon-meets-devanagari-asr, defect (a): stripping
// Mark_Nonspacing turns one Devanagari word into a run of bare consonants and
// a token count into fiction. `\p{M}` is kept, and this is the check that
// keeps it kept.
ok("Devanagari vowel marks survive normalization instead of shredding words",
  normalizeChallengeSpeech("मेरा नाम राघव है").split(" ").length === 4);
// The same entry's defect (b) is why the nonce is a separate mandatory gate:
// Sarvam returns Devanagari and transliterates the English half into it too,
// so a Latin-script bank sentence can come back with near-zero word overlap
// while the digits still match.
ok("Indic digits fold to ASCII so a correct reading is not refused over script",
  nonceSpoken("4 7 1 2 9 3", "कोड ४ ७ १ २ ९ ३ hai") &&
  nonceSpoken("4 7 1 2 9 3", "code 471293") &&
  !nonceSpoken("4 7 1 2 9 3", "कोड ४ ७ १ २ ९ ४ hai"));

// ── 3. the four decisions ─────────────────────────────────────────────────
function decide(over = {}, policy) {
  return decideVoiceChallenge({
    sentence: SENTENCE, sentenceHash: SENTENCE_HASH, nonce: ISSUED.nonce,
    referenceEmbeddings: REFERENCE, candidateEmbeddings: [LIVE_OWNER],
    recognizedText: SENTENCE, inputSha256: CAP_SHA, transcriptInputSha256: TR_SHA,
    verifier: "fixture", verifierVersion: "1", referenceGenomeVersion: 2, ...over,
  }, policy);
}

const accepted = decide();
ok("ACCEPT: a genuine owner reading the sentence clears 0.78 and verifies",
  accepted.decision === "accept" && accepted.verified &&
  accepted.similarity >= VOICE_CHALLENGE_POLICY.acceptAtOrAbove && !accepted.failureCode);

const review = decide({ candidateEmbeddings: [BORDERLINE] });
ok("REVIEW: between 0.70 and 0.78 the challenge is decided but does NOT verify",
  review.decision === "review" && review.verified === false && !review.failureCode &&
  review.similarity >= VOICE_CHALLENGE_POLICY.reviewAtOrAbove &&
  review.similarity < VOICE_CHALLENGE_POLICY.acceptAtOrAbove);

const rejected = decide({ candidateEmbeddings: [STRANGER] });
ok("REJECT: below the 0.70 activation floor the voice did not match",
  rejected.decision === "reject" && !rejected.verified &&
  rejected.failureCode === "voice_did_not_match");

ok("the three thresholds are the repo's own measured numbers, not invented ones",
  VOICE_CHALLENGE_POLICY.acceptAtOrAbove === 0.78 &&
  VOICE_CHALLENGE_POLICY.reviewAtOrAbove === 0.70 &&
  VOICE_CHALLENGE_POLICY.measuredOwnerCeiling === 0.8869 &&
  /measurements\.md#first-real-clone/.test(moduleSource));
ok("the file states in writing that false acceptance is unmeasured and what would fix it",
  /FALSE ACCEPTANCE IS UNMEASURED/.test(moduleSource) &&
  /NO DIFFERENT-SPEAKER CONTROL/.test(moduleSource) &&
  /impostor control set/.test(moduleSource));

// THRESHOLDS ARE DATA. The same score, two policies, two decisions, with no
// edit to the module. evals/fidelity/run.mjs makes the identical demand of
// api/_fidelity.js and for the identical reason: if this ever needs a code
// change to pass, a re-bench has stopped being a config change.
const strict = { ...VOICE_CHALLENGE_POLICY, version: "voice-identity-challenge/test-strict", acceptAtOrAbove: 0.95 };
const loose = { ...VOICE_CHALLENGE_POLICY, version: "voice-identity-challenge/test-loose", acceptAtOrAbove: 0.70 };
ok("raising the accept threshold turns the same recording from accept into review",
  decide({}, strict).decision === "review" && decide({ candidateEmbeddings: [BORDERLINE] }, loose).decision === "accept");
ok("the basis carries the policy version that produced it",
  decide({}, strict).basis.policy_version === "voice-identity-challenge/test-strict" &&
  accepted.basis.policy_version === VOICE_CHALLENGE_POLICY_VERSION);

// ── 4. anti-replay, and the negative control ──────────────────────────────
//
// A replayed recording of the owner IS the owner, so it passes the speaker
// check by construction. These are the cases that separate it from a live
// reading.
const replayed = decide({ recognizedText: "yeh meri purani recording hai aur ismein aaj ka code nahi hai" });
ok("REPLAY REFUSED: the owner's own old recording scores high on voice and still fails",
  replayed.similarity >= VOICE_CHALLENGE_POLICY.acceptAtOrAbove &&
  replayed.decision === "reject" && replayed.failureCode === "spoken_code_missing");

const wrongCode = decide({ recognizedText: SENTENCE.replace(/Code(?: \d){6}\./, "Code 9 1 8 2 7 3.") });
ok("a stale or guessed code fails even when every other word is correct",
  wrongCode.decision === "reject" && wrongCode.failureCode === "spoken_code_missing" &&
  wrongCode.transcriptOverlap > VOICE_CHALLENGE_POLICY.transcriptOverlapMin);

const wrongWords = decide({ recognizedText: `bilkul alag baat kar raha hoon ${ISSUED.nonce}` });
ok("saying only the digits is not reading the sentence",
  wrongWords.decision === "reject" && wrongWords.failureCode === "sentence_not_read");

const silent = decide({ recognizedText: "" });
ok("an empty transcript is a refusal, never an accept on the voice alone",
  silent.decision === "reject" && !silent.verified);

// THE NEGATIVE CONTROL. Remove the transcript half and the identical replayed
// recording is accepted. This is what makes the transcript gate load-bearing
// rather than decorative, and it is the check that fails if a future edit
// ever downgrades a missing transcript into "accept on the voice alone".
const withoutTranscriptGate = {
  ...VOICE_CHALLENGE_POLICY,
  version: "voice-identity-challenge/test-no-transcript",
  requireNonce: false,
  transcriptOverlapMin: 0,
};
const replayWithoutGate = decide(
  { recognizedText: "yeh meri purani recording hai aur ismein aaj ka code nahi hai" },
  withoutTranscriptGate,
);
ok("NEGATIVE CONTROL: with the transcript check removed the same replay is ACCEPTED",
  replayWithoutGate.decision === "accept" && replayWithoutGate.verified &&
  replayed.decision === "reject");

// ── 5. what a decision is allowed to remember ─────────────────────────────
ok("the durable basis is content-free: no transcript, no sentence, no vector",
  basisIsContentFree(accepted.basis) &&
  !JSON.stringify(accepted.basis).includes(SENTENCE) &&
  !/(transcript"|recognized_text|"sentence"|vector|embedding")/.test(
    JSON.stringify(accepted.basis).replace(/"transcript_(?:overlap|tokens|input_sha256|overlap_min)"/g, ""),
  ));
ok("the basis still carries both numbers and both thresholds, so a verdict can be audited",
  typeof accepted.basis.similarity === "number" &&
  typeof accepted.basis.transcript_overlap === "number" &&
  accepted.basis.nonce_match === true &&
  accepted.basis.accept_at_or_above === 0.78 && accepted.basis.review_at_or_above === 0.70);
assert.throws(() => decideVoiceChallenge({
  sentence: SENTENCE, sentenceHash: "0".repeat(64), nonce: ISSUED.nonce,
  referenceEmbeddings: REFERENCE, candidateEmbeddings: [LIVE_OWNER],
  recognizedText: SENTENCE, inputSha256: CAP_SHA, transcriptInputSha256: TR_SHA,
}), /sentence_binding_invalid/);
ok("a sentence that does not hash to the row's binding cannot be scored", true);
assert.throws(() => decide({ inputSha256: "not-a-hash" }), /input_hash_invalid/);
ok("evidence with no verified content hash cannot be scored", true);

const thin = decide({ referenceEmbeddings: [OWNER_VOICE] });
ok("one reference window is an anecdote and is refused, not scored",
  thin.decision === "reject" && thin.failureCode === "reference_evidence_insufficient");

// ── 6. the SQL bindings ───────────────────────────────────────────────────
let issueSql = "";
const issuedRow = await issueOwnedVoiceChallenge(async (sql, params) => {
  issueSql = sql;
  assert.equal(params[0], RID);
  return [{
    challenge_id: CHALLENGE, replica_id: RID, sentence: SENTENCE, state: "issued",
    decision: "", attempt: 1, captured_source_id: null, transcript_source_id: null,
    failure_code: "", similarity: null, issued_at: "2026-09-03T00:00:00.000Z",
    expires_at: "2026-09-03T00:03:00.000Z", decided_at: null, updated_at: "2026-09-03T00:00:00.000Z",
  }];
}, OWNER, RID, { sentence: SENTENCE, nonce: ISSUED.nonce, challengeId: CHALLENGE });
ok("issuing is owner-scoped, self-only, consent-fenced and rate-limited",
  issuedRow.challenge_id === CHALLENGE &&
  /r\.subject_mode='self'/.test(issueSql) &&
  /lifecycle not in \('revoked','purging'\)/.test(issueSql) &&
  /array\['capture','storage'\]/.test(issueSql) &&
  /attempts\.n < \$10::integer/.test(issueSql));
ok("a challenge cannot be issued before there is an enrolled voice to compare against",
  /from vy_replica_voice_genome g join owned/.test(issueSql) && /cross join genome/.test(issueSql));
ok("issuing a new sentence expires the previous one and queues its recording for deletion",
  /set state='expired',failure_code='challenge_superseded'/.test(issueSql) &&
  /vy_replica_source s set state='deleting'/.test(issueSql));
ok("only one challenge may be in flight at a time",
  /inflight\.state in \('captured','verifying'\)/.test(issueSql));

// The upload intake. Two roles, and each one is pinned to a kind.
ok("the source purpose is real and produces its own capture mode",
  sourceUploadInput({
    kind: "video", mime: "video/webm", byte_size: 900_000, sha256: CAP_SHA,
    contains_third_parties: false, purpose: "identity_challenge",
  }).captureMode === "identity_challenge");
assert.throws(() => sourceUploadInput({
  kind: "video", mime: "video/webm", byte_size: 900_000, sha256: CAP_SHA,
  contains_third_parties: true, purpose: "identity_challenge",
}), /only the verified subject/);
assert.throws(() => sourceUploadInput({
  kind: "document", mime: "application/pdf", byte_size: 900, sha256: CAP_SHA,
  contains_third_parties: false, purpose: "identity_challenge",
}), /must be audio or video/);
ok("a challenge clip must be audio or video and must contain only the owner", true);

let uploadSql = "";
await createVoiceChallengeSource(async (sql) => {
  uploadSql = sql;
  return [{ source_id: CAP_SOURCE, replica_id: RID, owner_user_id: OWNER, kind: "video",
    capture_mode: "identity_challenge", storage_bucket: "vyakti-replica-private",
    object_path: `${OWNER}/${RID}/${CAP_SOURCE}/original`, mime: "video/webm",
    byte_size: 900_000, sha256: CAP_SHA, state: "pending_upload", contains_third_parties: false,
    rejection_code: "", created_at: "x", updated_at: "x" }];
}, OWNER, RID, CHALLENGE, {
  role: "capture", kind: "video", mime: "video/webm", byte_size: 900_000,
  sha256: CAP_SHA, contains_third_parties: false,
}, { sourceId: CAP_SOURCE });
ok("an upload is authorized only against an unexpired issued challenge with that slot still empty",
  /ch\.state='issued' and ch\.expires_at>now\(\) and ch\.captured_source_id is null/.test(uploadSql) &&
  /'identity_challenge'/.test(uploadSql) && /cross join capture cross join storage_ok/.test(uploadSql));

let finalizeSql = "";
await finalizeVoiceChallengeSource(async (sql) => {
  finalizeSql = sql;
  return [{ source: { source_id: CAP_SOURCE, state: "quarantined" },
    challenge: { challenge_id: CHALLENGE, replica_id: RID, sentence: SENTENCE, state: "issued",
      decision: "", attempt: 1, captured_source_id: CAP_SOURCE, transcript_source_id: null,
      failure_code: "", similarity: null, issued_at: "x", expires_at: "y", decided_at: null, updated_at: "z" } }];
}, OWNER, RID, CHALLENGE, CAP_SOURCE,
{ byteSize: 900_000, mime: "video/webm", objectId: "obj", expectedByteSize: 900_000, expectedMime: "video/webm" });
ok("the challenge only becomes captured once BOTH artifacts are quarantined",
  /ready\.source_id=ch\.captured_source_id and ready\.state='quarantined'/.test(finalizeSql) &&
  /ready\.source_id=ch\.transcript_source_id and ready\.state='quarantined'/.test(finalizeSql) &&
  /then 'captured'/.test(finalizeSql));

// ── 7. the lease, the settlement, and THE GATE ────────────────────────────
ok("lease capabilities are one-way domain-separated hashes",
  /^[0-9a-f]{64}$/.test(voiceChallengeLeaseHash(TOKEN)) && !voiceChallengeLeaseHash(TOKEN).includes(TOKEN));

let leaseSql = "";
const lease = await leaseNextVoiceChallenge(async (sql, params) => {
  leaseSql = sql;
  assert.equal(params[0], voiceChallengeLeaseHash(TOKEN));
  return [{
    challenge_id: CHALLENGE, replica_id: RID, owner_user_id: OWNER, sentence: SENTENCE,
    sentence_hash: SENTENCE_HASH, nonce: ISSUED.nonce, captured_source_id: CAP_SOURCE,
    transcript_source_id: TR_SOURCE, verification_attempt: 1,
    verification_lease_expires_at: "2026-09-03T00:05:00.000Z",
    cap_kind: "video", cap_mime: "video/webm", cap_byte_size: 900_000, cap_sha256: CAP_SHA,
    cap_bucket: "vyakti-replica-private", cap_path: `${OWNER}/${RID}/${CAP_SOURCE}/original`,
    tr_kind: "audio", tr_mime: "audio/wav", tr_byte_size: 480_000, tr_sha256: TR_SHA,
    tr_bucket: "vyakti-replica-private", tr_path: `${OWNER}/${RID}/${TR_SOURCE}/original`,
    genome_version: 2,
    embedding_families: {
      "speechbrain-ecapa-voxceleb": REFERENCE.map((vector, i) => ({ evidence_id: `e${i}`, vector, confidence: 1 })),
      "speechbrain-xvector-voxceleb": [{ evidence_id: "x0", vector: basis(3), confidence: 1 }],
    },
    reference_source_ids: [REF_SOURCE],
  }];
}, { name: "fixture", version: "1", verify() {} }, { leaseToken: TOKEN });
ok("one atomic lease requires both quarantined self-only artifacts and an existing genome",
  lease.attempt === 1 && /for update of ch skip locked/.test(leaseSql) &&
  /cap\.kind='video'/.test(leaseSql) && /tr\.kind='audio'/.test(leaseSql) &&
  /contains_third_parties=false/.test(leaseSql) &&
  /from vy_replica_voice_genome g where g\.replica_id=ch\.replica_id/.test(leaseSql) &&
  /insert into vy_replica_voice_challenge_attempt/.test(leaseSql));
ok("expired work is reclaimed without ever storing the raw lease capability",
  /failure_code='lease_expired'/.test(leaseSql) && !leaseSql.includes(TOKEN));
ok("the reference is the owner's own genome, ECAPA only, x-vector left where it is",
  lease.referenceEmbeddings.length === 2 && lease.referenceGenomeVersion === 2 &&
  lease.referenceSourceId === REF_SOURCE &&
  JSON.stringify(lease.referenceEmbeddings) === JSON.stringify(REFERENCE));

let completeSql = "";
let completeParams = [];
const settled = await completeVoiceChallenge(async (sql, params) => {
  completeSql = sql;
  completeParams = params;
  return [{ challenge_id: CHALLENGE, state: "verified", decision: "accept" }];
}, { ...lease, verifierName: "fixture", verifierVersion: "1" }, accepted);
ok("settlement binds the live lease, the exact attempt and both content hashes",
  settled.state === "verified" &&
  /ch\.verification_lease_expires_at>now\(\)/.test(completeSql) &&
  /a\.outcome='running'/.test(completeSql) &&
  /cap\.sha256=\$11/.test(completeSql) && /tr\.sha256=\$12/.test(completeSql) &&
  /r\.subject_mode='self'/.test(completeSql));

// THE POINT OF THE WORKSTREAM. The same three columns, under the same guard,
// that api/_replica-liveness-verification.js writes when the Azure composite
// verifier passes.
const azureSettlement = readFileSync(join(ROOT, "api/_replica-liveness-verification.js"), "utf8");
ok("an accept writes the SAME vy_replica columns the Azure path would have written",
  /identity_verified_at=coalesce\(r\.identity_verified_at,now\(\)\)/.test(completeSql) &&
  /liveness_verified_at=coalesce\(r\.liveness_verified_at,now\(\)\)/.test(completeSql) &&
  /identity_expires_at=greatest/.test(completeSql) &&
  /identity_verified_at=coalesce/.test(azureSettlement) &&
  /liveness_verified_at=coalesce/.test(azureSettlement));
ok("a voice cannot establish an age, so the settlement keeps the Azure age guard",
  /r\.age_verified_at is not null/.test(completeSql) &&
  /r\.age_verified_at is not null/.test(azureSettlement));
ok("ONLY an accept opens the gate; review and reject write a row and nothing else",
  /where \$6='verified' and r\.replica_id=ch\.replica_id/.test(completeSql));
ok("raw evidence is queued for deletion on EVERY outcome, accept included",
  /evidence_sources as \(\s*update vy_replica_source s set state='deleting'/.test(completeSql));
// NO NEW BYPASS. Checked against CODE rather than the whole file, because the
// module's header explains at length what it replaces and naming
// REPLICA_SELF_TEST_MODE in that explanation is the opposite of a bypass.
// Line comments are stripped first, then the code body must contain exactly
// one environment read and it must be the documented flag.
const moduleCode = moduleSource
  .split("\n")
  .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
  .join("\n");
ok("no new bypass flag exists in the code: one env read, and it is the documented one",
  !/REPLICA_SELF_TEST_MODE/.test(moduleCode) &&
  [...moduleCode.matchAll(/env\??\.([A-Z_]+)/g)].every((m) => m[1] === "VOICE_IDENTITY_CHALLENGE") &&
  [...moduleCode.matchAll(/env\??\.([A-Z_]+)/g)].length === 1);
ok("the self-test path's owner-bound guard is untouched by this workstream",
  readFileSync(join(ROOT, "api/_replica-processing/self-test.js"), "utf8")
    .includes("REPLICA_SELF_TEST_MODE"));
ok("the persisted basis and the persisted decision cannot disagree",
  JSON.parse(completeParams[9]).decision === completeParams[6]);

// The gate itself, unchanged, reading the row.
function gateRow(extra = {}) {
  return {
    replica_id: RID, subject_mode: "self", lifecycle: "ready",
    subject_person_id: "70000000-0000-4000-8000-000000000007",
    account_person_matches: true, person_age_tier: "adult_verified",
    age_verified_at: "2026-09-01T00:00:00.000Z",
    inference_consent: true, profile_approved: true, calibration_approved: true,
    genome_approved: true, voice_ready: true, qualification_passed: 7, fidelity_qualified: true,
    ...extra,
  };
}
const beforeChallenge = runtimeBlockers(gateRow({
  identity_verified_at: null, liveness_verified_at: null, identity_expires_at: null,
}));
const afterAccept = runtimeBlockers(gateRow({
  identity_verified_at: "2026-09-03T00:05:00.000Z",
  liveness_verified_at: "2026-09-03T00:05:00.000Z",
  identity_expires_at: "2026-12-02T00:05:00.000Z",
}));
ok("before a challenge the two identity blockers are reported",
  beforeChallenge.includes("identity_verification_required") &&
  beforeChallenge.includes("liveness_verification_required"));
ok("after an accept the SAME unmodified gate reports neither, and nothing else changed",
  !afterAccept.includes("identity_verification_required") &&
  !afterAccept.includes("liveness_verification_required") && afterAccept.length === 0);
const noAge = runtimeBlockers(gateRow({
  identity_verified_at: "2026-09-03T00:05:00.000Z",
  liveness_verified_at: "2026-09-03T00:05:00.000Z",
  identity_expires_at: "2026-12-02T00:05:00.000Z",
  age_verified_at: null, person_age_tier: "unverified",
}));
ok("a perfect challenge still leaves adult verification outstanding",
  noAge.includes("adult_verification_required"));

// ── 8. expiry, cancellation and crash recovery ────────────────────────────
let expireSql = "";
const expiredCount = await expireVoiceChallenges(async (sql) => {
  expireSql = sql;
  return [{ expired_count: 3 }];
});
ok("EXPIRED CHALLENGE: an unread sentence times out and its recording is queued for deletion",
  expiredCount === 3 && /ch\.state='issued' and ch\.expires_at<=now\(\)/.test(expireSql) &&
  /failure_code='challenge_expired'/.test(expireSql) &&
  /vy_replica_source s set state='deleting'/.test(expireSql) &&
  /outcome='failed'/.test(expireSql));
ok("an expired sentence can never be settled, because settlement demands state 'verifying'",
  /ch\.state='verifying'/.test(completeSql));

let cancelSql = "";
await cancelOwnedVoiceChallenge(async (sql) => {
  cancelSql = sql;
  return [{ challenge_id: CHALLENGE, replica_id: RID, sentence: SENTENCE, state: "expired",
    decision: "", attempt: 1, captured_source_id: CAP_SOURCE, transcript_source_id: TR_SOURCE,
    failure_code: "owner_cancelled", similarity: null, issued_at: "x", expires_at: "y",
    decided_at: null, updated_at: "z" }];
}, OWNER, RID, CHALLENGE);
ok("the owner can withdraw at any point before a decision and the evidence goes",
  /failure_code='owner_cancelled'/.test(cancelSql) &&
  /ch\.state in \('issued','captured','verifying'\)/.test(cancelSql) &&
  /vy_replica_source s set state='deleting'/.test(cancelSql));

let retrySql = "";
await retryVoiceChallenge(async (sql) => {
  retrySql = sql;
  return [{ challenge_id: CHALLENGE }];
}, lease, { failureCode: "voice evidence not ready", retryAfterMs: 45_000 });
ok("an unreachable or cold service returns the challenge to the queue rather than failing it",
  /set state='captured'/.test(retrySql) && /outcome='retry'/.test(retrySql) &&
  /failure_code=\$7/.test(retrySql));

// ── 9. the sweep ──────────────────────────────────────────────────────────
const work = [
  { ...lease, challengeId: "a1000000-0000-4000-8000-000000000001" },
  { ...lease, challengeId: "a2000000-0000-4000-8000-000000000002" },
  { ...lease, challengeId: "a3000000-0000-4000-8000-000000000003" },
];
const outcomes = [];
const summary = await runVoiceChallengeSweep({
  db: async () => [],
  verifier: {
    name: "fixture", version: "1",
    async verify(item) {
      if (item.challengeId.startsWith("a3")) {
        throw Object.assign(new Error("cold"), { code: "voice_evidence_not_ready", retryable: true });
      }
      return {
        candidateEmbeddings: [item.challengeId.startsWith("a2") ? STRANGER : LIVE_OWNER],
        recognizedText: SENTENCE, inputSha256: CAP_SHA, transcriptInputSha256: TR_SHA,
      };
    },
  },
  maxJobs: 3,
  expire: async () => 0,
  lease: async () => work.shift() || null,
  complete: async (_db, item, verdict) => outcomes.push([item.challengeId.slice(0, 2), verdict.decision]),
  retry: async () => {},
});
ok("one sweep can accept, reject and retry independent challenges without widening authority",
  summary.accepted === 1 && summary.rejected === 1 && summary.retried === 1 &&
  outcomes.length === 2);

const lost = await runVoiceChallengeSweep({
  db: async () => [], maxJobs: 1, expire: async () => 0,
  verifier: { name: "fixture", version: "1", async verify() { throw new Error("late failure"); } },
  lease: async () => lease,
  retry: async () => { throw Object.assign(new Error("gone"), { code: "voice_challenge_lease_lost" }); },
});
ok("a withdrawal racing a verifier completion is discarded without failing the scheduled worker",
  lost.discarded === 1 && lost.retried === 0);

// ── 10. the live seam, exercised with fakes ───────────────────────────────
//
// The verifier is the only thing that talks to a service. Its two rules are
// checked here with injected doubles: a transcript failure must NEVER be
// downgraded into an accept on the voice alone, and both measurements must be
// about the two artifacts the lease named.
let sawEvidenceInput = null;
let sawAsrRef = null;
const verifier = createVoiceChallengeVerifier({
  env: {},
  evidence: {
    async measure(request) {
      sawEvidenceInput = request.inputs[0];
      return {
        embeddings: [
          { input_key: "input-1", family: "speechbrain-ecapa-voxceleb", vector: LIVE_OWNER, confidence: 1 },
          { input_key: "input-1", family: "speechbrain-xvector-voxceleb", vector: basis(4), confidence: 1 },
        ],
        confidence: 1, measurements: {}, quality: {},
      };
    },
  },
  asr: {
    async transcribe(ref) {
      sawAsrRef = ref;
      return { turns: [{ speaker: "SPEAKER_00", text: SENTENCE, t0: 0, t1: 10_000 }] };
    },
  },
});
const measured = await verifier.verify(lease);
ok("the verifier scores the camera clip and transcribes the WAV, each bound to its own hash",
  sawEvidenceInput.sha256 === CAP_SHA && sawAsrRef.sha256 === TR_SHA &&
  sawAsrRef.storagePath.endsWith(`${TR_SOURCE}/original`) &&
  measured.inputSha256 === CAP_SHA && measured.transcriptInputSha256 === TR_SHA);
ok("only the ECAPA family reaches the score, exactly as api/_fidelity.js does",
  measured.candidateEmbeddings.length === 1 &&
  JSON.stringify(measured.candidateEmbeddings[0]) === JSON.stringify(LIVE_OWNER));

const asrDown = createVoiceChallengeVerifier({
  env: {},
  evidence: { async measure() {
    return { embeddings: [
      { input_key: "input-1", family: "speechbrain-ecapa-voxceleb", vector: LIVE_OWNER, confidence: 1 },
      { input_key: "input-1", family: "speechbrain-xvector-voxceleb", vector: basis(4), confidence: 1 },
    ], confidence: 1, measurements: {}, quality: {} };
  } },
  asr: { async transcribe() { throw Object.assign(new Error("402"), { code: "asr_sync_http_402" }); } },
});
await assert.rejects(asrDown.verify(lease), (error) => error.code === "asr_sync_http_402");
ok("a flaky ASR propagates its exact code and is retried; it is NEVER downgraded into an accept on the voice alone",
  true);

// ── 11. the shipping seam and the durable schema ──────────────────────────
ok("the server half is off by default and reads exactly one variable",
  voiceIdentityChallengeEnabled({}) === false &&
  voiceIdentityChallengeEnabled({ VOICE_IDENTITY_CHALLENGE: "0" }) === false &&
  voiceIdentityChallengeEnabled({ VOICE_IDENTITY_CHALLENGE: "true" }) === false &&
  voiceIdentityChallengeEnabled({ VOICE_IDENTITY_CHALLENGE: "1" }) === true);

const handler = readFileSync(join(ROOT, "api/replica-voice-identity.js"), "utf8");
const sweepEndpoint = readFileSync(join(ROOT, "api/replica-voice-identity-sweep.js"), "utf8");
const studio = readFileSync(join(ROOT, "src/studio/VoiceIdentityChallenge.tsx"), "utf8");
const app = readFileSync(join(ROOT, "src/studio/StudioApp.tsx"), "utf8");
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
ok("an unflagged deployment cannot reach the endpoint at all",
  /voiceIdentityChallengeEnabled\(\)/.test(handler) && /not_found/.test(handler));
ok("the decider is scheduled and cron-authenticated, and an unconfigured deployment stays disabled",
  vercel.crons.some((cron) => cron.path === "/api/replica-voice-identity-sweep") &&
  sweepEndpoint.includes("timingSafeEqual") && sweepEndpoint.includes("disabled: true"));
ok("the studio band is behind its own flag and replaces the Azure cards rather than joining them",
  /VITE_VOICE_IDENTITY_CHALLENGE/.test(app) &&
  /VOICE_IDENTITY_UI \? \(/.test(app) && /<IdentityProofing/.test(app));
ok("the studio reuses wavCapture's encoder instead of writing a second one",
  /from "\.\/wavCapture"/.test(studio) && /encodeWav24kMono/.test(studio) &&
  !/function encodeWav\b/.test(studio));
ok("the studio states which side is holding the work and what a refusal means",
  studio.includes("Waiting on us") && studio.includes("Read this sentence out loud, on camera") &&
  /REASON: Record<string/.test(studio) && studio.includes("Age is verified separately"));

const migration = readFileSync(join(ROOT, "db/migrations/072_replica_voice_identity_challenge.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const erasure = readFileSync(join(ROOT, "api/_replica-full-erasure.js"), "utf8");
ok("the migration is splitter-safe, one statement per request, with no DO blocks",
  splitSql(migration).length >= 12 && !/\bdo \$/i.test(migration) &&
  !/references vy_replica\b/.test(migration));
ok("the canonical schema mirrors both durable tables and the new capture mode",
  schema.includes("vy_replica_voice_challenge") &&
  schema.includes("vy_replica_voice_challenge_attempt") &&
  schema.includes("'identity_challenge'"));
ok("both tables are deleted by name in the erasure job, child first",
  erasure.indexOf("delete from vy_replica_voice_challenge_attempt") > 0 &&
  erasure.indexOf("delete from vy_replica_voice_challenge_attempt")
    < erasure.indexOf("delete from vy_replica_voice_challenge x"));
ok("a client never sees the nonce, the basis or the lease",
  (() => {
    const view = clientVoiceChallenge({
      challenge_id: CHALLENGE, replica_id: RID, sentence: SENTENCE, state: "verified",
      decision: "accept", attempt: 1, captured_source_id: CAP_SOURCE, transcript_source_id: TR_SOURCE,
      failure_code: "", similarity: 0.88, issued_at: "x", expires_at: "y",
      decided_at: "z", updated_at: "w", nonce: ISSUED.nonce,
      decision_basis: { secret: true }, verification_lease_token_hash: "c".repeat(64),
    });
    return !("nonce" in view) && !("decision_basis" in view) &&
      !JSON.stringify(view).includes("c".repeat(64)) && view.similarity === 0.88;
  })());

console.log(`\n${checks} voice identity challenge checks passed`);
