// WS-R155. "Sounds like you" and the listening test.
//
//   node evals/listening-test/run.mjs
//
// Offline, no database, no Azure. This suite proves three things: the pure
// verdict math (mean, winner, pair identity) is correct and matches the
// SEALED listening harness's own four-axis form rather than inventing a
// second scorer; the SQL `recordVoiceListeningVerdict` sends actually proves
// eligibility (sealed generations, matching content hashes, an approved
// person profile) through the real query text, the same way
// evals/voice-preference/run.mjs already proves its sibling; and the
// activation guard (law 4: "a losing candidate cannot become primary
// without an explicit override that is logged") is right on every branch,
// including the one that must refuse.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LISTENING_AXES,
  LISTENING_VERDICT_SCHEMA,
  buildListeningVerdictDefinition,
  decideVoiceActivation,
  guardOwnedVoiceActivation,
  latestVoiceListeningVerdict,
  listeningPairSha256,
  listeningRatingMean,
  listeningVerdictFromRatings,
  ownedVoiceListeningHistory,
  recordVoiceListeningVerdict,
  validateListeningRating,
} from "../../api/_replica-calibration.js";
import { ownedVoiceLikenessSummary } from "../../api/_replica-voice-preview.js";
import { OWNED_SEALED_GENERATION_AUDIO_SQL, ownedSealedGenerationAudio } from "../../api/_replica-generation-audio.js";
import { OWNED_PRIMARY_VOICE_REFERENCE_AUDIO_SQL, ownedPrimaryVoiceReferenceAudio } from "../../api/_replica-source-audio.js";
import { AXES as SEALED_HARNESS_AXES } from "../voice-listening-benchmark/lib.mjs";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
let checks = 0;
function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

const OWNER = "20000000-0000-4000-8000-000000000002";
const RID = "10000000-0000-4000-8000-000000000001";
const LEFT_GEN = "30000000-0000-4000-8000-000000000003";
const RIGHT_GEN = "40000000-0000-4000-8000-000000000004";
const CURRENT_GEN = "50000000-0000-4000-8000-000000000005";
const LEFT_SHA = "a".repeat(64);
const RIGHT_SHA = "b".repeat(64);
const REF_SHA = "c".repeat(64);
const PRIMARY_SOURCE = "70000000-0000-4000-8000-000000000007";

// ── 1. Axis parity with the sealed harness. "Never a second scorer" ────────
const sealedIds = [...SEALED_HARNESS_AXES.map((axis) => axis.id)].sort();
const oursIds = [...LISTENING_AXES].sort();
ok(
  "the listening test's four axes are exactly the sealed harness's four axes, by id",
  sealedIds.length === oursIds.length && sealedIds.every((id, index) => id === oursIds[index]),
);

// ── 2. validateListeningRating: the shape, and both a missing and an
// out-of-range axis as NEGATIVE controls. ───────────────────────────────────
const goodRating = { owner_likeness: 5, naturalness: 4, indian_accent: 3, pronunciation: 5 };
ok("a complete, in-range rating validates", (() => {
  const validated = validateListeningRating(goodRating);
  return LISTENING_AXES.every((axis) => validated[axis] === goodRating[axis]);
})());
assert.throws(() => validateListeningRating({ owner_likeness: 5, naturalness: 4, indian_accent: 3 }), /listening_rating_axes_invalid/);
ok("NEGATIVE: a rating missing one axis is refused", true);
assert.throws(() => validateListeningRating({ ...goodRating, naturalness: 6 }), /listening_rating_axes_invalid/);
ok("NEGATIVE: an out-of-range score (6, not 1..5) is refused", true);
assert.throws(() => validateListeningRating({ ...goodRating, extra_axis: 1 }), /listening_rating_axes_invalid/);
ok("NEGATIVE: an unrecognised extra axis is refused, not silently dropped", true);

// ── 3. Pure verdict math ────────────────────────────────────────────────────
ok("the mean is the simple average of the four axes", listeningRatingMean(goodRating) === (5 + 4 + 3 + 5) / 4);
{
  const left = { owner_likeness: 5, naturalness: 5, indian_accent: 5, pronunciation: 5 };
  const right = { owner_likeness: 3, naturalness: 3, indian_accent: 3, pronunciation: 3 };
  ok("a clear left win is called correctly", listeningVerdictFromRatings(left, right).winner === "left");
  ok("a clear right win is called correctly", listeningVerdictFromRatings(right, left).winner === "right");
  ok("equal means are a tie, never a forced pick", listeningVerdictFromRatings(left, left).winner === "tie");
}

// ── 4. Pair identity: order-independent in the two candidates, sensitive to
// the reference, and refuses degenerate input. ─────────────────────────────
const pairAB = listeningPairSha256({ leftSha256: LEFT_SHA, rightSha256: RIGHT_SHA, referenceSha256: REF_SHA });
const pairBA = listeningPairSha256({ leftSha256: RIGHT_SHA, rightSha256: LEFT_SHA, referenceSha256: REF_SHA });
ok("the pair identity does not depend on which candidate is passed as left", pairAB === pairBA && /^[0-9a-f]{64}$/.test(pairAB));
const pairDifferentRef = listeningPairSha256({ leftSha256: LEFT_SHA, rightSha256: RIGHT_SHA, referenceSha256: "d".repeat(64) });
ok("a different reference recording is a different pair", pairDifferentRef !== pairAB);
assert.throws(() => listeningPairSha256({ leftSha256: LEFT_SHA, rightSha256: LEFT_SHA, referenceSha256: REF_SHA }), /listening_distinct_candidates_required/);
ok("NEGATIVE: comparing a candidate against itself is refused", true);
assert.throws(() => listeningPairSha256({ leftSha256: "not-a-hash", rightSha256: RIGHT_SHA, referenceSha256: REF_SHA }), /listening_hash_invalid/);
ok("NEGATIVE: a malformed hash is refused before it can name a pair", true);

// ── 5. buildListeningVerdictDefinition: the stored shape ───────────────────
{
  const definition = buildListeningVerdictDefinition({
    order: "ba",
    left: { generationId: LEFT_GEN, audioSha256: LEFT_SHA, ratings: goodRating },
    right: { generationId: RIGHT_GEN, audioSha256: RIGHT_SHA, ratings: { owner_likeness: 2, naturalness: 2, indian_accent: 2, pronunciation: 2 } },
    referenceSha256: REF_SHA,
  });
  ok("the definition carries its own schema tag", definition.schema === LISTENING_VERDICT_SCHEMA);
  ok("an unrecognised order value falls back to ab, never silently to ba", buildListeningVerdictDefinition({ left: definition.left, right: definition.right, referenceSha256: REF_SHA }).order === "ab");
  ok("the higher-rated candidate wins the definition's own verdict", definition.winner === "left" && definition.left.mean > definition.right.mean);
}

// ── 6. recordVoiceListeningVerdict: the real SQL proves eligibility ────────
{
  let sql = "";
  let params = [];
  const fakeDb = async (statement, values) => {
    sql = statement; params = values;
    return [{
      replica_id: RID, version: 3, profile_version: 2, status: "approved",
      pair_sha256: pairAB, winner_artifact_id: LEFT_GEN, created_at: "2026-09-13T00:00:00.000Z",
    }];
  };
  const result = await recordVoiceListeningVerdict(fakeDb, OWNER, {
    replica_id: RID,
    order: "ab",
    reference_sha256: REF_SHA,
    left: { generation_id: LEFT_GEN, audio_sha256: LEFT_SHA, ratings: goodRating },
    right: { generation_id: RIGHT_GEN, audio_sha256: RIGHT_SHA, ratings: { owner_likeness: 2, naturalness: 2, indian_accent: 2, pronunciation: 2 } },
  });
  ok("a recorded verdict returns the winner side and its stored identity", result.winner === "left" && result.pair_sha256 === pairAB);
  ok("ownership is proved by subject_mode and an unrevoked lifecycle, not by the request body", /subject_mode='self'/.test(sql) && /lifecycle not in \('revoked','purging'\)/.test(sql));
  ok("only an APPROVED person profile can host a listening verdict", /status='approved'/.test(sql) && /order by version desc limit 1/.test(sql));
  ok("both candidates must be the owner's own sealed voice previews", /l\.state='sealed' and rgen\.state='sealed'/.test(sql) && /l\.purpose='voice_preview' and rgen\.purpose='voice_preview'/.test(sql));
  ok("the content hashes the client asserts are rechecked against the row, not trusted blind", /l\.audio_sha256=\$6 and rgen\.audio_sha256=\$7/.test(sql));
  ok("the two candidates must be genuinely distinct rows", /l\.generation_id<>rgen\.generation_id/.test(sql));
  ok("versioning shares the SAME advisory lock key personality calibration builds use, so the two writers cannot race a version number", /hashtextextended\(r\.replica_id::text\|\|':calibration_build',0\)/.test(sql));
  ok("the pair identity and the winning side are written as their own columns, not buried only in the jsonb definition", params.includes(pairAB) && params.includes(LEFT_GEN));
}

await assert.rejects(
  recordVoiceListeningVerdict(async () => [], OWNER, {
    replica_id: RID, reference_sha256: REF_SHA,
    left: { generation_id: LEFT_GEN, audio_sha256: LEFT_SHA, ratings: goodRating },
    right: { generation_id: LEFT_GEN, audio_sha256: LEFT_SHA, ratings: goodRating },
  }),
  /listening_distinct_candidates_required/,
);
ok("NEGATIVE: submitting the same generation as both candidates is refused before any SQL runs", true);

await assert.rejects(
  recordVoiceListeningVerdict(async () => [], OWNER, {
    replica_id: RID, reference_sha256: REF_SHA,
    left: { generation_id: LEFT_GEN, audio_sha256: LEFT_SHA, ratings: goodRating },
    right: { generation_id: RIGHT_GEN, audio_sha256: RIGHT_SHA, ratings: goodRating },
  }),
  /listening_candidates_ineligible_or_profile_unapproved/,
);
ok("NEGATIVE: a db that finds no eligible pair (unsealed, wrong purpose, unapproved profile) refuses with one named code", true);

// ── 7. Readers ───────────────────────────────────────────────────────────
{
  let sql = "";
  await latestVoiceListeningVerdict(async (statement) => { sql = statement; return []; }, OWNER, RID, pairAB);
  ok("the latest-verdict reader only ever reads APPROVED rows for the exact pair, newest first", /status='approved'/.test(sql) && /order by version desc limit 1/.test(sql));
}
{
  const rows = await ownedVoiceListeningHistory(async () => [{
    version: 4, winner_artifact_id: RIGHT_GEN, pair_sha256: pairAB, created_at: "2026-09-13T01:00:00.000Z",
    definition: JSON.stringify({ schema: LISTENING_VERDICT_SCHEMA, order: "ab", winner: "right", left: { mean: 2.5 }, right: { mean: 4 } }),
  }], OWNER, RID);
  ok("history rows are unpacked from the stored jsonb definition, not re-derived", rows.length === 1 && rows[0].winner === "right" && rows[0].right_mean === 4);
}

// ── 8. Law 4: activation reads the latest verdict; a loser needs a logged
// override. Pure decision first, then the DB-backed guard around it. ──────
ok("with no verdict on record, activation is allowed", decideVoiceActivation({ verdict: null, candidateGenerationId: LEFT_GEN }).allowed === true);
ok("a tied verdict blocks nobody", decideVoiceActivation({ verdict: { winner_artifact_id: null }, candidateGenerationId: LEFT_GEN }).allowed === true);
ok("the candidate that won its own verdict may activate", decideVoiceActivation({ verdict: { winner_artifact_id: LEFT_GEN }, candidateGenerationId: LEFT_GEN }).allowed === true);
{
  const blocked = decideVoiceActivation({ verdict: { winner_artifact_id: RIGHT_GEN }, candidateGenerationId: LEFT_GEN });
  ok("NEGATIVE, the law itself: a losing candidate is refused without an override", blocked.allowed === false && blocked.reason === "candidate_lost_latest_verdict");
}
{
  const overridden = decideVoiceActivation({ verdict: { winner_artifact_id: RIGHT_GEN }, candidateGenerationId: LEFT_GEN, override: true });
  ok("an explicit override lets a losing candidate through, and says so in the decision", overridden.allowed === true && overridden.overridden === true && overridden.blockedBy === RIGHT_GEN);
}

{
  // guardOwnedVoiceActivation: no current primary to compare against yet.
  const decision = await guardOwnedVoiceActivation(async () => { throw new Error("must not query the database"); }, OWNER, {
    replica_id: RID, candidate_generation_id: LEFT_GEN,
  });
  ok("with nothing to compare against, the guard allows activation without touching the database", decision.allowed === true && decision.reason === "no_verdict_on_record");
}
{
  // Candidate is already the current primary.
  const decision = await guardOwnedVoiceActivation(async () => { throw new Error("must not query the database"); }, OWNER, {
    replica_id: RID, candidate_generation_id: LEFT_GEN, current_generation_id: LEFT_GEN,
  });
  ok("activating the already-active voice is always allowed", decision.allowed === true && decision.reason === "candidate_is_current_primary");
}
{
  // Neither generation resolves (deleted, or never sealed).
  const decision = await guardOwnedVoiceActivation(async () => [], OWNER, {
    replica_id: RID, candidate_generation_id: LEFT_GEN, current_generation_id: CURRENT_GEN, reference_sha256: REF_SHA,
  });
  ok("an unresolvable generation fails open to allowed rather than blocking on a guess", decision.allowed === true && decision.reason === "candidate_or_current_unresolved");
}
{
  // The full path: both resolve, a real losing verdict is on record, no override -> refused.
  const auditInserts = [];
  const db = async (statement, values) => {
    if (/from vy_replica_generation/.test(statement)) {
      return [
        { generation_id: LEFT_GEN, audio_sha256: LEFT_SHA },
        { generation_id: CURRENT_GEN, audio_sha256: RIGHT_SHA },
      ];
    }
    if (/from vy_replica_calibration/.test(statement)) {
      return [{ version: 3, winner_artifact_id: CURRENT_GEN }];
    }
    if (/insert into vy_replica_audit/.test(statement)) { auditInserts.push({ statement, values }); return []; }
    throw new Error(`unexpected statement: ${statement}`);
  };
  const blocked = await guardOwnedVoiceActivation(db, OWNER, {
    replica_id: RID, candidate_generation_id: LEFT_GEN, current_generation_id: CURRENT_GEN, reference_sha256: REF_SHA,
  });
  ok("NEGATIVE, end to end: a real recorded loss blocks activation with no override, and logs nothing", blocked.allowed === false && blocked.reason === "candidate_lost_latest_verdict" && auditInserts.length === 0);

  const overridden = await guardOwnedVoiceActivation(db, OWNER, {
    replica_id: RID, candidate_generation_id: LEFT_GEN, current_generation_id: CURRENT_GEN, reference_sha256: REF_SHA, override: true,
  });
  ok("end to end with override: the same loss is now allowed", overridden.allowed === true && overridden.overridden === true);
  ok(
    "the override is LOGGED, by name, the moment it is used, naming which candidate it overrode",
    auditInserts.length === 1
      && auditInserts[0].statement.includes("voice.activation.override")
      && auditInserts[0].values.some((value) => typeof value === "string" && value.includes(CURRENT_GEN)),
  );
}

// ── 9. ownedVoiceLikenessSummary: the three honest states, never a
// fabricated number, plus candidate discovery and dedup. ──────────────────
{
  const db = async (statement) => {
    if (/from vy_replica_generation/.test(statement)) {
      return [
        { generation_id: LEFT_GEN, audio_sha256: LEFT_SHA, created_at: "2026-09-12T00:00:00.000Z" },
        { generation_id: LEFT_GEN, audio_sha256: LEFT_SHA, created_at: "2026-09-12T00:00:00.000Z" }, // a re-sealed duplicate byte-for-byte
        { generation_id: RIGHT_GEN, audio_sha256: RIGHT_SHA, created_at: "2026-09-11T00:00:00.000Z" },
      ];
    }
    if (/from vy_replica_calibration/.test(statement)) return [{ n: 3 }];
    return [{
      replica_id: RID, voice_profile_id: "60000000-0000-4000-8000-000000000006",
      fidelity_status: "pass", fidelity_score: { mean: 0.81, p10: 0.7, worst: 0.6, windows: 5 },
      fidelity_policy_version: "voice-fidelity/v1", fidelity_computed_at: "2026-09-10T00:00:00.000Z",
      fidelity_superseded_at: null, reference_sha256: REF_SHA,
    }];
  };
  const summary = await ownedVoiceLikenessSummary(db, OWNER, RID);
  ok("a measured, non-superseded fidelity row reports its real status and score", summary.fidelity.status === "pass" && summary.fidelity.score.mean === 0.81);
  ok("a duplicate audio hash across two rows counts as ONE candidate, not two", summary.listening_candidates.length === 2);
  ok("listening is ready once two distinct candidates and a reference hash all exist", summary.listening_ready === true && summary.reference_sha256 === REF_SHA);
  // WS-R179. The method behind the number: a real n, the sealed harness's
  // own four axes by id, and "measured" once at least one verdict exists.
  ok("the method reports a real verdict count and the sealed harness's own four axes, by id",
    summary.listening_method.measured === true && summary.listening_method.verdict_count === 3
    && JSON.stringify([...summary.listening_method.axes].sort()) === JSON.stringify(oursIds));
}
{
  const db = async (statement) => {
    if (/from vy_replica_generation/.test(statement)) return [];
    if (/from vy_replica_calibration/.test(statement)) return [{ n: 0 }];
    return [{ replica_id: RID, voice_profile_id: "60000000-0000-4000-8000-000000000006", fidelity_status: null, reference_sha256: null }];
  };
  const summary = await ownedVoiceLikenessSummary(db, OWNER, RID);
  ok("NEGATIVE: a ready voice with no fidelity row ever computed reports not_measured, never a fabricated number", summary.fidelity.status === "not_measured" && summary.fidelity.score === null);
  ok("with fewer than two candidates, listening is honestly not ready", summary.listening_ready === false);
  ok("NEGATIVE: zero recorded verdicts is honestly not measured, never a fabricated method claim", summary.listening_method.measured === false && summary.listening_method.verdict_count === 0);
}
{
  const db = async (statement) => {
    if (/from vy_replica_generation/.test(statement)) return [];
    if (/from vy_replica_calibration/.test(statement)) return [{ n: 0 }];
    return [{ replica_id: RID, voice_profile_id: null, fidelity_status: null, reference_sha256: null }];
  };
  const summary = await ownedVoiceLikenessSummary(db, OWNER, RID);
  ok("NEGATIVE: with no ready voice at all, the state says so by name rather than reusing not_measured", summary.fidelity.status === "no_voice_yet");
}
{
  // NEGATIVE, the decoupling itself: a real, measured fidelity score exists,
  // but the owner has never run a blind listening test. The method must
  // stay honestly "not measured" regardless of the OTHER, automated score
  // (`decisions.md#fidelity-score-is-0-100-only-at-the-display-layer`'s own
  // boundary: the listening method never claims to explain a number it did
  // not produce).
  const db = async (statement) => {
    if (/from vy_replica_generation/.test(statement)) return [];
    if (/from vy_replica_calibration/.test(statement)) return [{ n: 0 }];
    return [{
      replica_id: RID, voice_profile_id: "60000000-0000-4000-8000-000000000006",
      fidelity_status: "pass", fidelity_score: { mean: 0.9, p10: 0.8, worst: 0.7, windows: 6 },
      fidelity_policy_version: "voice-fidelity/v1", fidelity_computed_at: "2026-09-10T00:00:00.000Z",
      fidelity_superseded_at: null, reference_sha256: REF_SHA,
    }];
  };
  const summary = await ownedVoiceLikenessSummary(db, OWNER, RID);
  ok("NEGATIVE: a measured automatic fidelity score does not itself imply a measured listening method",
    summary.fidelity.status === "pass" && summary.listening_method.measured === false && summary.listening_method.verdict_count === 0);
}
{
  const summary = await ownedVoiceLikenessSummary(async () => [], OWNER, RID);
  ok("an owner who does not own this replica gets null, not an empty-but-shaped object", summary === null);
}

// ── 10. Migration 166, schema mirror, relcheck and door wiring ─────────────
const migrationText = readFileSync(join(ROOT, "db/migrations/166_voice_listening_verdict.sql"), "utf8");
ok("migration 166 adds exactly the two columns the brief names, both nullable", /add column if not exists pair_sha256 text/.test(migrationText) && /add column if not exists winner_artifact_id uuid/.test(migrationText));
ok("migration 166 statements are each independently idempotent (add column if not exists / create index if not exists), no DO block", /add column if not exists/.test(migrationText) && !/do \$/.test(migrationText));
{
  const statements = splitSql(migrationText);
  ok("migration 166 parses into standalone statements the Neon one-statement-per-request runner can replay", statements.filter((statement) => statement.trim()).length >= 3);
}
const schemaText = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
ok("schema.sql mirrors migration 166", schemaText.includes("166_voice_listening_verdict.sql") && schemaText.includes("winner_artifact_id uuid"));
const relcheckText = readFileSync(join(ROOT, "scripts/relcheck.mjs"), "utf8");
ok("relcheck proves winner_artifact_id resolves to the owner's own sealed generation, since no FK does", /winner_artifact_id/.test(relcheckText) && /g\.state='sealed'/.test(relcheckText));
const doorText = readFileSync(join(ROOT, "api/replica-calibration.js"), "utf8");
ok("the calibration door exposes both the new op and the composed read", doorText.includes('"listening_submit"') && doorText.includes("ownedVoiceLikenessSummary") && doorText.includes("ownedVoiceListeningHistory"));

// ── 11. WS-R163: the sealed-generation audio door ──────────────────────────
// The other open item WS-R155 left: no endpoint served a past sealed
// generation's bytes, so the listening test's players showed "not available
// yet". api/_replica-generation-audio.js#ownedSealedGenerationAudio is the
// decision; the SQL is the gate, so every clause below is asserted against
// the REAL query text, never a paraphrase of it.
ok("the audio SQL binds generation, replica and owner all three, and excludes a revoked or purging replica",
  /g\.generation_id=\$1::uuid and g\.replica_id=\$2::uuid and g\.owner_user_id=\$3::uuid/.test(OWNED_SEALED_GENERATION_AUDIO_SQL)
  && /r\.lifecycle not in \('revoked','purging'\)/.test(OWNED_SEALED_GENERATION_AUDIO_SQL));
ok("the audio SQL requires a SEALED voice_preview generation with a real, undeleted stored result",
  /g\.state='sealed' and g\.purpose='voice_preview'/.test(OWNED_SEALED_GENERATION_AUDIO_SQL)
  && /g\.preview_result_object_path<>'' and g\.preview_result_deleted_at is null/.test(OWNED_SEALED_GENERATION_AUDIO_SQL));

{
  const AUDIO_GEN = "60000000-0000-4000-8000-000000000061";
  const AUDIO_BYTES = Buffer.from("fixture-wav-bytes");
  let readCalls = [];
  const readObject = async (locator) => { readCalls.push(locator); return { mime: "audio/wav", body: AUDIO_BYTES, byteSize: AUDIO_BYTES.length }; };
  const db = async (sql, params) => {
    ok("the door queries through the real, asserted SQL text, not a paraphrase", sql === OWNED_SEALED_GENERATION_AUDIO_SQL);
    return [{
      generation_id: AUDIO_GEN, replica_id: RID, owner_user_id: OWNER,
      preview_result_storage_bucket: "vyakti-replica-private", preview_result_object_path: `${OWNER}/${RID}/derived/voice-preview/${AUDIO_GEN}.wav`,
    }];
  };
  const audio = await ownedSealedGenerationAudio(db, OWNER, RID, AUDIO_GEN, { readObject });
  ok("the owner's own sealed voice-preview generation streams back through the same signed-read seam uploads use",
    audio.mime === "audio/wav" && audio.body === AUDIO_BYTES && audio.byteSize === AUDIO_BYTES.length
    && readCalls.length === 1 && readCalls[0].storageBucket === "vyakti-replica-private" && readCalls[0].objectPath.includes(AUDIO_GEN));
}

// NEGATIVE CONTROLS. A db returning no row (as the real SQL's WHERE would
// for each of these) must refuse with the SAME honest 404, never a crash and
// never a distinguishable code an attacker could use to enumerate ids.
for (const [name, ownerArg, replicaArg, generationArg] of [
  ["another owner's generation", "90000000-0000-4000-8000-000000000099", RID, LEFT_GEN],
  ["a forged replica id", OWNER, "90000000-0000-4000-8000-000000000098", LEFT_GEN],
]) {
  await assert.rejects(
    () => ownedSealedGenerationAudio(async () => [], ownerArg, replicaArg, generationArg),
    (error) => error.code === "generation_audio_not_available" && error.status === 404,
  );
  ok(`NEGATIVE: ${name} refuses with the honest not-available code, not a distinguishable one`, true);
}
{
  // an unsealed generation, or one whose stored result was already swept by
  // the cleanup sweep: the real WHERE clause finds no row for either case,
  // proved directly rather than re-implemented here.
  await assert.rejects(
    () => ownedSealedGenerationAudio(async () => [], OWNER, RID, LEFT_GEN),
    (error) => error.code === "generation_audio_not_available" && error.status === 404,
  );
  ok("NEGATIVE: an unsealed generation or a swept result (no row from the real WHERE clause) refuses honestly", true);
}
await assert.rejects(
  () => ownedSealedGenerationAudio(async () => { throw new Error("must not query the database"); }, OWNER, RID, "not-a-uuid"),
  (error) => error.code === "valid_generation_id_required" && error.status === 400,
);
ok("NEGATIVE: a malformed generation id is refused before any query runs", true);
await assert.rejects(
  () => ownedSealedGenerationAudio(async () => { throw new Error("must not query the database"); }, "", RID, LEFT_GEN),
  (error) => error.code === "valid_owner_required" && error.status === 400,
);
ok("NEGATIVE: a signed-out caller (no resolvable owner id) is refused before any query runs, mirroring requireUser's own boundary at the door", true);

const audioDoorText = readFileSync(join(ROOT, "api/replica-generation-audio.js"), "utf8");
ok("the audio door is GET-only, owner-bearer, wrapped in withDoor, and never touches req.body (so it needs no new EXPECTED_DOORS entry)",
  /req\.method !== "GET"/.test(audioDoorText) && /requireUser\(req\)/.test(audioDoorText)
  && /export default withDoor\(/.test(audioDoorText) && !/req\.body/.test(audioDoorText));
ok("the audio door rate-limits both by IP and by authenticated owner, like every other owner-bearer door",
  /allow\(ipOf\(req\), "replica_generation_audio"/.test(audioDoorText) && /allow\(user\.id, "replica_generation_audio_user"/.test(audioDoorText));

// ── 12. WS-R179: the listening test against the person's own voice. The
// reference door serves the owner's own CURRENT primary voice recording,
// the exact same "the SQL is the gate" posture §11 above already proves for
// a sealed generation. ──────────────────────────────────────────────────
ok("the reference SQL binds replica and owner both, resolves the primary source through vy_replica_voice_reference, and excludes a revoked or purging replica",
  /vr\.replica_id=\$1::uuid and vr\.owner_user_id=\$2::uuid/.test(OWNED_PRIMARY_VOICE_REFERENCE_AUDIO_SQL)
  && /join vy_replica_source s on s\.source_id=vr\.source_id and s\.replica_id=vr\.replica_id and s\.owner_user_id=vr\.owner_user_id/.test(OWNED_PRIMARY_VOICE_REFERENCE_AUDIO_SQL)
  && /r\.lifecycle not in \('revoked','purging'\)/.test(OWNED_PRIMARY_VOICE_REFERENCE_AUDIO_SQL));
ok("the reference SQL requires the source to be READY and to contain no third party, the same floor migration 066's own backfill uses",
  /s\.state='ready'/.test(OWNED_PRIMARY_VOICE_REFERENCE_AUDIO_SQL) && /s\.contains_third_parties=false/.test(OWNED_PRIMARY_VOICE_REFERENCE_AUDIO_SQL));

{
  const REFERENCE_BYTES = Buffer.from("fixture-reference-wav-bytes");
  let readCalls = [];
  const readObject = async (locator) => { readCalls.push(locator); return { mime: "audio/wav", body: REFERENCE_BYTES, byteSize: REFERENCE_BYTES.length }; };
  const db = async (sql, params) => {
    ok("the reference door queries through the real, asserted SQL text, not a paraphrase", sql === OWNED_PRIMARY_VOICE_REFERENCE_AUDIO_SQL);
    ok("the reference door needs no generation id, only replica and owner -- the primary reference is unique per replica by construction", params.length === 2 && params[0] === RID && params[1] === OWNER);
    return [{ source_id: PRIMARY_SOURCE, replica_id: RID, owner_user_id: OWNER, storage_bucket: "vyakti-replica-private", object_path: `${OWNER}/${RID}/${PRIMARY_SOURCE}/original` }];
  };
  const audio = await ownedPrimaryVoiceReferenceAudio(db, OWNER, RID, { readObject });
  ok("the owner's own current primary voice recording streams back through the same signed-read seam WS-R163's generation door already uses",
    audio.mime === "audio/wav" && audio.body === REFERENCE_BYTES && audio.byteSize === REFERENCE_BYTES.length
    && readCalls.length === 1 && readCalls[0].storageBucket === "vyakti-replica-private" && readCalls[0].objectPath.includes(PRIMARY_SOURCE));
}

// NEGATIVE CONTROLS. A db returning no row (as the real SQL's WHERE would
// for each of these) must refuse with the SAME honest 404 -- never a crash
// and never a distinguishable code an attacker could use to enumerate ids.
await assert.rejects(
  () => ownedPrimaryVoiceReferenceAudio(async () => [], "90000000-0000-4000-8000-000000000099", RID),
  (error) => error.code === "reference_audio_not_available" && error.status === 404,
);
ok("NEGATIVE: another owner's recording (the real WHERE finds no row for a mismatched owner) refuses with the honest not-available code, not a distinguishable one", true);

await assert.rejects(
  () => ownedPrimaryVoiceReferenceAudio(async () => [], OWNER, "90000000-0000-4000-8000-000000000098"),
  (error) => error.code === "reference_audio_not_available" && error.status === 404,
);
ok("NEGATIVE: a forged replica id (the real WHERE finds no row) refuses with the honest not-available code", true);

await assert.rejects(
  // A non-primary source (or a primary that is still quarantined/processing,
  // or one that turns out to contain a third party) is exactly the case the
  // real WHERE clause's own state/contains_third_parties/join conditions
  // exclude -- proved directly rather than re-implemented here, the same
  // posture §11 already takes for an unsealed generation.
  () => ownedPrimaryVoiceReferenceAudio(async () => [], OWNER, RID),
  (error) => error.code === "reference_audio_not_available" && error.status === 404,
);
ok("NEGATIVE: a non-primary source, or a primary not yet state='ready' (no row from the real WHERE clause) refuses honestly", true);

await assert.rejects(
  () => ownedPrimaryVoiceReferenceAudio(async () => { throw new Error("must not query the database"); }, OWNER, "not-a-uuid"),
  (error) => error.code === "valid_replica_id_required" && error.status === 400,
);
ok("NEGATIVE: a malformed replica id is refused before any query runs", true);

await assert.rejects(
  () => ownedPrimaryVoiceReferenceAudio(async () => { throw new Error("must not query the database"); }, "", RID),
  (error) => error.code === "valid_owner_required" && error.status === 400,
);
ok("NEGATIVE: a signed-out caller (no resolvable owner id, mirroring requireUser's own boundary at the door) is refused before any query runs", true);

const referenceDoorText = readFileSync(join(ROOT, "api/replica-source-audio.js"), "utf8");
ok("the reference door is GET-only, owner-bearer, wrapped in withDoor, and never touches req.body (so it needs no new EXPECTED_DOORS entry, the same reasoning room-doors' own rule (a) already gives room-cohorts.js/room-embed.js/creators.js/sitemap.js)",
  /req\.method !== "GET"/.test(referenceDoorText) && /requireUser\(req\)/.test(referenceDoorText)
  && /export default withDoor\(/.test(referenceDoorText) && !/req\.body/.test(referenceDoorText));
ok("the reference door rate-limits both by IP and by authenticated owner, like every other owner-bearer door",
  /allow\(ipOf\(req\), "replica_source_audio"/.test(referenceDoorText) && /allow\(user\.id, "replica_source_audio_user"/.test(referenceDoorText));
ok("the reference door never re-synthesises or re-encodes -- it streams the exact object bytes back, watermark policy untouched",
  /res\.status\(200\)\.send\(audio\.body\)/.test(referenceDoorText));

// ── 13. The card's method text: the front end states the method rather
// than leaving the number unexplained (the brief's own "a score card nobody
// can explain"). Source-and-shape, the same posture evals/voice-preview-ui
// already takes for this exact file. ────────────────────────────────────
const panelText = readFileSync(join(ROOT, "src/studio/VoicePreviewPanel.tsx"), "utf8");
ok("the likeness card renders the method behind the number, keyed off the real listening_method field",
  /likeness\.listening_method\.measured/.test(panelText) && /likeness\.listening_method\.verdict_count/.test(panelText));
ok("the method text never claims a likeness number the panel itself did not produce (no banned unmeasured-quality words)",
  !/best|winner|indistinguishable|state.of.the.art/i.test(panelText));

const enCopyText = readFileSync(join(ROOT, "src/studio/copy.ts"), "utf8");
const hiCopyText = readFileSync(join(ROOT, "src/studio/hiCopy.ts"), "utf8");
for (const [name, text] of [["English", enCopyText], ["Hindi", hiCopyText]]) {
  ok(`the ${name} copy table carries both method templates (measured, with an {n} placeholder, and honestly not measured)`,
    /methodMeasuredTemplate:\s*"[^"]*\{n\}[^"]*"/.test(text) && /methodNotMeasured:\s*"[^"]+"/.test(text));
}
ok("neither method template uses an em dash or en dash (scripts/check-copy.mjs's own ban)",
  !/methodMeasuredTemplate:\s*"[^"]*[–—]/.test(enCopyText) && !/methodNotMeasured:\s*"[^"]*[–—]/.test(enCopyText)
  && !/methodMeasuredTemplate:\s*"[^"]*[–—]/.test(hiCopyText) && !/methodNotMeasured:\s*"[^"]*[–—]/.test(hiCopyText));

const calibrationApiText = readFileSync(join(ROOT, "src/studio/calibrationApi.ts"), "utf8");
ok("the studio fetches the reference recording through the same owner-bearer fetch shape as the candidate players, never through JSON parsing a WAV body",
  /export async function fetchReferenceAudio/.test(calibrationApiText) && /\/api\/replica-source-audio\?replica_id=/.test(calibrationApiText));

const listeningTestText = readFileSync(join(ROOT, "src/studio/ListeningTest.tsx"), "utf8");
ok("the listening test screen plays the reference recording beside the candidates, rendered outside the swapped left/right sample grid rather than as one of its slots",
  /fetchReferenceAudio/.test(listeningTestText) && /function ReferenceSample/.test(listeningTestText)
  && listeningTestText.indexOf("<ReferenceSample") > 0
  && listeningTestText.indexOf("<ReferenceSample") < listeningTestText.indexOf('<div className="lt-samples">'));

console.log(`\nlistening-test: ${checks} checks passed`);
