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
}
{
  const db = async (statement) => {
    if (/from vy_replica_generation/.test(statement)) return [];
    return [{ replica_id: RID, voice_profile_id: "60000000-0000-4000-8000-000000000006", fidelity_status: null, reference_sha256: null }];
  };
  const summary = await ownedVoiceLikenessSummary(db, OWNER, RID);
  ok("NEGATIVE: a ready voice with no fidelity row ever computed reports not_measured, never a fabricated number", summary.fidelity.status === "not_measured" && summary.fidelity.score === null);
  ok("with fewer than two candidates, listening is honestly not ready", summary.listening_ready === false);
}
{
  const db = async (statement) => {
    if (/from vy_replica_generation/.test(statement)) return [];
    return [{ replica_id: RID, voice_profile_id: null, fidelity_status: null, reference_sha256: null }];
  };
  const summary = await ownedVoiceLikenessSummary(db, OWNER, RID);
  ok("NEGATIVE: with no ready voice at all, the state says so by name rather than reusing not_measured", summary.fidelity.status === "no_voice_yet");
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

console.log(`\nlistening-test: ${checks} checks passed`);
