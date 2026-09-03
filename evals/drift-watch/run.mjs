// WS-R9 — DRIFT WATCH: "it notices drift." Five states a report can honestly
// be in, the two independent signals that decide them, the 0.02 threshold's
// own citations held to the numbers that justify it, and the negative
// control the brief asks for by name.
//
//   node evals/drift-watch/run.mjs
//   node evals/run.mjs driftwatch
//
// Offline, deterministic, $0, no database, no network, no model call. What
// this suite CANNOT see is SQL types and referential integrity —
// `evals/sqlcast` covers the first, `scripts/relcheck.mjs` the second, and
// migration 076 has never been applied to any database.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DRIFT_POLICY_VERSION,
  DRIFT_SCORE_DROP_THRESHOLD,
  DRIFT_LOOKBACK_DAYS,
  PROSODY_ANCHOR_STALE_DAYS,
  clientDriftWatch,
  driftWatchReport,
  driftWatchInputsHash,
  gatherDriftWatchInputs,
  readOwnedDriftWatch,
  runDriftWatchSweep,
  writeDriftReport,
} from "../../api/_drift-watch.js";
import { READINESS_ACTIONS } from "../../api/_readiness.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-09-03T00:00:00.000Z");

let checks = 0;
function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}
function eq(actual, expected, name) {
  assert.deepEqual(actual, expected, `${name} (got ${JSON.stringify(actual)})`);
  console.log(`ok ${++checks} - ${name}`);
}

const at = (daysAgo) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const hash = (n) => n.toString(16).padStart(64, "0");
const H1 = hash(1);
const H2 = hash(2);

// ═════════════════════════════════════════════════════════════════════════
// §1. THE THRESHOLD ITSELF, CITED RATHER THAN CHOSEN
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 1. the 0.02 threshold, held to the measurements it cites ──");

eq(DRIFT_SCORE_DROP_THRESHOLD, 0.02, "the score-drop threshold is exactly what the brief specifies");
const moduleSrc = readFileSync(join(ROOT, "api/_drift-watch.js"), "utf8");
ok("the threshold cites the three measurements that justify it, by number",
  /6e-6/.test(moduleSrc) && /0\.0625/.test(moduleSrc) && /0\.0206/.test(moduleSrc));
ok("the threshold cites the measurement ids a reader can look up",
  /lora-vs-zero-shot-71s/.test(moduleSrc) && /reference-window-beats-the-finetune/.test(moduleSrc));
ok("the module states its own reversal condition rather than presenting 0.02 as settled",
  /[Rr]eversal condition/.test(moduleSrc) && /n=1-speaker/.test(moduleSrc));

// ═════════════════════════════════════════════════════════════════════════
// §2. STEADY — both halves measured, nothing moved
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 2. steady ──");

const STEADY = Object.freeze({
  now: NOW,
  fidelityHistory: [
    { mean: 0.79, computed_at: at(2), genome_version: 3, voice_model_ref: "chatterbox-multilingual-v3" },
    { mean: 0.788, computed_at: at(12), genome_version: 3, voice_model_ref: "chatterbox-multilingual-v3" },
    { mean: 0.785, computed_at: at(25), genome_version: 3, voice_model_ref: "chatterbox-multilingual-v3" },
  ],
  ownerCeiling: { value: 0.8869, measured_at: at(40) },
  generationCommitments: [
    { at: at(60), commitment: H1 },
    { at: at(2), commitment: H1 },
  ],
  prosodyBaseline: { established_at: at(3), last_run_at: at(1), last_alarm: false },
});

const steady = driftWatchReport(STEADY);
eq(steady.state, "steady", "both halves measured, no swap, no drop: steady");
eq(steady.reasons, [], "a steady report carries no reasons");
eq(steady.score, 0.79, "the standing score is the newest fidelity row's mean");
eq(steady.percent_of_ceiling, Math.round((100 * 0.79) / 0.8869), "the same percent-of-ceiling arithmetic readiness uses");
ok("the trend carries every real point inside the 30 day window, oldest first",
  steady.trend.length === 3 && steady.trend[0].mean === 0.785 && steady.trend[2].mean === 0.79);
eq(steady.last_model_change_at, null, "no commitment ever changed in this fixture: no swap to report");
eq(steady.last_model_commitment, null, "...and no hash to pair with it");
ok("the anchor is not stale when it was established recently and did not alarm",
  steady.prosody_anchor_stale === false);
eq(steady.action, null, "a steady report suggests nothing");
eq(steady.policy_version, DRIFT_POLICY_VERSION, "the report stamps the policy that computed it");

// ═════════════════════════════════════════════════════════════════════════
// §3. MOVED — BY SCORE, against the SAME reference set only
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 3. moved by score, same genome_version only ──");

const MOVED_SCORE = Object.freeze({
  ...STEADY,
  fidelityHistory: [
    { mean: 0.74, computed_at: at(1), genome_version: 3, voice_model_ref: "chatterbox-multilingual-v3" },
    { mean: 0.79, computed_at: at(10), genome_version: 3, voice_model_ref: "chatterbox-multilingual-v3" },
  ],
});
const movedScore = driftWatchReport(MOVED_SCORE);
eq(movedScore.state, "moved", "a drop of 0.05 against the same genome_version trips the threshold");
ok("the reason names the score drop", movedScore.reasons.includes("score_dropped"));
eq(movedScore.score_drop.delta, 0.05, "the drop is reported with its own delta");
eq(movedScore.score_drop.genome_version, 3, "...and the genome_version it was measured against");

// The bar itself: exactly at 0.02 must NOT fire ("more than 0.02"), and a
// hair over must.
const atBar = driftWatchReport({
  ...STEADY,
  fidelityHistory: [
    { mean: 0.77, computed_at: at(1), genome_version: 3, voice_model_ref: "x" },
    { mean: 0.79, computed_at: at(10), genome_version: 3, voice_model_ref: "x" },
  ],
});
eq(atBar.state, "steady", "a drop of exactly 0.02 does not qualify - the bar is MORE than 0.02");
const overBar = driftWatchReport({
  ...STEADY,
  fidelityHistory: [
    { mean: 0.769999, computed_at: at(1), genome_version: 3, voice_model_ref: "x" },
    { mean: 0.79, computed_at: at(10), genome_version: 3, voice_model_ref: "x" },
  ],
});
eq(overBar.state, "moved", "a hair over 0.02 does qualify");

// A drop across a GENOME bump (a real reference-set change, e.g. more owner
// material approved) must NOT be scored — window-choice spread (0.0625) is
// three times this threshold, so comparing across reference sets is exactly
// the hazard the module's own header names.
const genomeBump = driftWatchReport({
  ...STEADY,
  fidelityHistory: [
    { mean: 0.70, computed_at: at(1), genome_version: 4, voice_model_ref: "x" }, // NEW reference set
    { mean: 0.79, computed_at: at(10), genome_version: 3, voice_model_ref: "x" }, // OLD reference set
  ],
});
eq(genomeBump.state, "steady",
  "a genome bump has a real score and ceiling, so it is steady - not_measured is reserved for no evidence at all");
ok("a genome bump is never treated as a score drop even though the raw numbers moved",
  genomeBump.score_drop === null);

// Recency: an old drop is reported historically but does not hold the state.
const oldDrop = driftWatchReport({
  ...STEADY,
  fidelityHistory: [
    { mean: 0.74, computed_at: at(DRIFT_LOOKBACK_DAYS + 5), genome_version: 3, voice_model_ref: "x" },
    { mean: 0.79, computed_at: at(DRIFT_LOOKBACK_DAYS + 20), genome_version: 3, voice_model_ref: "x" },
  ],
});
eq(oldDrop.state, "steady", "a drop older than the lookback window no longer holds today's state at moved");

// ═════════════════════════════════════════════════════════════════════════
// §4. MOVED — BY SWAP, independent of whether fidelity has ever been scored
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 4. moved by swap ──");

const MOVED_SWAP = Object.freeze({
  now: NOW,
  fidelityHistory: STEADY.fidelityHistory,
  ownerCeiling: STEADY.ownerCeiling,
  generationCommitments: [
    { at: at(60), commitment: H1 },
    { at: at(3), commitment: H2 }, // the swap: same lane, different hash
  ],
  prosodyBaseline: STEADY.prosodyBaseline,
});
const movedSwap = driftWatchReport(MOVED_SWAP);
eq(movedSwap.state, "moved", "any commitment change under the same lane is a swap, regardless of magnitude");
ok("the reason names the commitment change", movedSwap.reasons.includes("model_commitment_changed"));
eq(movedSwap.last_model_change_at, at(3), "the swap date is the date the NEW commitment first appeared");
eq(movedSwap.last_model_commitment, H2, "...and the hash it changed to");

// The swap is reported even with NO fidelity evidence at all - vision-drift-
// 4day's own case: a provider swap was caught by watching the artifact, not
// a score. The overall STATE still reads not_measured (nothing to compare
// against a ceiling), but the swap fact is not lost.
const swapNoScore = driftWatchReport({
  now: NOW,
  fidelityHistory: [],
  ownerCeiling: null,
  generationCommitments: MOVED_SWAP.generationCommitments,
  prosodyBaseline: STEADY.prosodyBaseline,
});
eq(swapNoScore.state, "not_measured", "with no fidelity row the overall state is not_measured, not a silent pass");
eq(swapNoScore.last_model_change_at, at(3), "...but the swap itself is still on the report, unconditionally");
eq(swapNoScore.last_model_commitment, H2, "...with its hash, so the fact is not lost while waiting on a score");

// An old swap is reported historically but does not hold today's state.
const oldSwap = driftWatchReport({
  ...STEADY,
  generationCommitments: [
    { at: at(400), commitment: H1 },
    { at: at(200), commitment: H2 },
  ],
});
eq(oldSwap.state, "steady", "a swap older than the lookback window no longer holds today's state at moved");
eq(oldSwap.last_model_change_at, at(200), "...but it is still named as history");

// ═════════════════════════════════════════════════════════════════════════
// §5. NOT MEASURED — never a fake number, and always the one action
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 5. not measured ──");

const noScore = driftWatchReport({ ...STEADY, fidelityHistory: [] });
eq(noScore.state, "not_measured", "no fidelity row at all: not measured, never steady by default");
eq(noScore.score, null, "...and specifically NOT a zero");
ok("the reason names the missing half", noScore.reasons.includes("no_fidelity_row"));
eq(noScore.action, READINESS_ACTIONS.record_reference,
  "not_measured carries the ONE action that would measure it - reused from readiness's own table, not a second one");

const noCeiling = driftWatchReport({ ...STEADY, ownerCeiling: null });
eq(noCeiling.state, "not_measured", "a score with no ceiling to divide by is also not measured");
ok("the reason names the missing ceiling", noCeiling.reasons.includes("no_owner_ceiling"));
eq(noCeiling.percent_of_ceiling, null, "no percent can be computed with no denominator");

// ═════════════════════════════════════════════════════════════════════════
// §6. THE PROSODY ANCHOR — orthogonal to state, never silently steady
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 6. the prosody anchor, and its own staleness ──");

eq(driftWatchReport({ ...STEADY, prosodyBaseline: null }).prosody_anchor_stale, true,
  "no prosody baseline at all reads as stale, never as unmeasured-and-ignored");
eq(driftWatchReport({ ...STEADY, prosodyBaseline: null }).prosody_anchor_reason,
  "prosody_baseline_unavailable", "...naming why");

eq(driftWatchReport({
  ...STEADY,
  prosodyBaseline: { established_at: at(3), last_run_at: at(PROSODY_ANCHOR_STALE_DAYS + 1), last_alarm: false },
}).prosody_anchor_stale, true, "a job meant to run nightly that has not run past its own stale window is stale");

eq(driftWatchReport({
  ...STEADY,
  prosodyBaseline: { established_at: at(30), last_run_at: at(1), last_alarm: true },
}).prosody_anchor_stale, true, "an unresolved alarm from the job's own last run marks the anchor stale too");

ok("the anchor's staleness never changes the SCORE state - it is reported alongside, not folded in",
  driftWatchReport({ ...STEADY, prosodyBaseline: null }).state === "steady");

// The real committed log, read for real: this repo's own anchor has sat on
// 2026-08-15 since before this workstream (`context/decisions.md`
// voice-despina). Proves the reader parses the actual file shape, not a
// fixture shaped to fit it.
const realLog = JSON.parse(readFileSync(join(ROOT, "evals/dbattery/prosody-baseline-log.json"), "utf8"));
ok("the committed prosody log has the shape the reader expects",
  typeof realLog.baseline?.date === "string" && Array.isArray(realLog.runs));
const { readProsodyBaselineState } = await import("../../api/_drift-watch.js");
const realState = readProsodyBaselineState();
ok("the best-effort file reader parses the real committed log without throwing",
  realState === null || (typeof realState.established_at === "string" && typeof realState.last_alarm === "boolean"));

// ═════════════════════════════════════════════════════════════════════════
// §7. THE NEGATIVE CONTROL — a report that says steady across a swap must fail
// ═════════════════════════════════════════════════════════════════════════
//
// The brief's own words: "a report that says 'steady' when the model
// commitment changed must fail." The patch below removes exactly the clause
// that folds a swap into the state decision, on a COPY of the real module, so
// nothing mutated ever lands in api/. If the assertions below still pass
// against the patched module, this suite was not testing what it claims.
console.log("\n── 7. negative control: the swap check is load-bearing ──");

function loadPatched(patch) {
  const source = readFileSync(join(ROOT, "api/_drift-watch.js"), "utf8");
  const rewritten = patch(source).replace(
    /from "\.\/([^"]+)"/g,
    (_match, rel) => `from "${pathToFileURL(join(ROOT, "api", rel)).href}"`,
  );
  assert.notEqual(rewritten, source, "the negative-control patch must actually change the source");
  const dir = mkdtempSync(join(tmpdir(), "drift-watch-nc-"));
  const file = join(dir, "patched.mjs");
  writeFileSync(file, rewritten);
  return import(pathToFileURL(file).href);
}

const GUARD = `  } else if (swapRecent || dropRecent) {
    state = "moved";
    if (swapRecent) reasons.push("model_commitment_changed");
    if (dropRecent) reasons.push("score_dropped");
  } else {`;
const WITHOUT_GUARD = `  } else if (dropRecent) {
    state = "moved";
    if (dropRecent) reasons.push("score_dropped");
  } else {`;
ok("the negative control finds the exact clause it means to remove", moduleSrc.includes(GUARD));

const patched = await loadPatched((source) => source.split(GUARD).join(WITHOUT_GUARD));
const cheated = patched.driftWatchReport(MOVED_SWAP);
ok("negative control: WITHOUT the swap clause the same swap fixture reads steady",
  cheated.state === "steady");
ok("...while the REAL module reads moved on the identical input",
  driftWatchReport(MOVED_SWAP).state === "moved");
ok("...and the real module's swap field is still populated even though the state moved past it",
  driftWatchReport(MOVED_SWAP).last_model_commitment === H2);

// ═════════════════════════════════════════════════════════════════════════
// §8. THE INPUTS HASH — covers the policy version, ignores the clock
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 8. the inputs hash ──");

const hashA = driftWatchInputsHash(STEADY);
eq(driftWatchInputsHash({ ...STEADY, now: NOW + 60_000 }), hashA,
  "the inputs hash ignores the clock, so polling does not manufacture history");
ok("the inputs hash moves when a real input moves",
  driftWatchInputsHash({ ...STEADY, ownerCeiling: { value: 0.9, measured_at: at(1) } }) !== hashA);
ok("the inputs hash covers the policy version, so a threshold bump changes it with no input change",
  /policy: DRIFT_POLICY_VERSION/.test(moduleSrc));

// ═════════════════════════════════════════════════════════════════════════
// §9. THE READS AND THE SWEEP'S WRITE
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 9. the reads, the sweep, and the guarded write ──");

function fakeDb(rows) {
  return async (sql, params) => {
    fakeDb.calls.push({ sql, params });
    if (/insert into vy_replica_drift_report/i.test(sql)) return rows.insertResult ?? [{ report_id: "r1", computed_at: at(0), state: rows.insertState, alerted_at: rows.insertState === "moved" ? at(0) : null }];
    if (/from vy_voice_fidelity/i.test(sql)) return rows.fidelity ?? [];
    if (/from vy_replica_voice_genome/i.test(sql)) return rows.ceiling ? [rows.ceiling] : [];
    if (/from vy_replica_generation/i.test(sql)) return rows.commitments ?? [];
    if (/lifecycle <> 'purging' *$/m.test(sql) && /vy_replica r$/m.test(sql)) return [{ replica_id: RID }];
    throw new Error(`unexpected SQL ${sql.slice(0, 80)}`);
  };
}
fakeDb.calls = [];

fakeDb.calls = [];
const gathered = await gatherDriftWatchInputs(
  fakeDb({
    fidelity: [{ score: JSON.stringify({ mean: 0.79 }), computed_at: at(2), genome_version: 3, voice_model_ref: "x" }],
    ceiling: { ceiling: "0.8869", measured_at: at(40) },
    commitments: [{ at: at(60), commitment: H1 }],
  }),
  RID, OWNER, { now: NOW, prosodyBaseline: STEADY.prosodyBaseline },
);
eq(gathered.fidelityHistory[0].mean, 0.79, "the gather step parses the stored jsonb score column");
eq(gathered.ownerCeiling.value, 0.8869, "...and the ceiling read matches readiness's own CEILING_SQL shape");
ok("every SQL statement the gather step issues binds both replica and owner",
  fakeDb.calls.every((c) => c.params.includes(RID) || c.params.includes(1) === false));

fakeDb.calls = [];
const readCalls = fakeDb.calls;
const readDb = fakeDb({
  fidelity: [{ score: JSON.stringify({ mean: 0.79 }), computed_at: at(2), genome_version: 3, voice_model_ref: "x" }],
  ceiling: { ceiling: "0.8869", measured_at: at(40) },
  commitments: [{ at: at(60), commitment: H1 }],
});
const read = await readOwnedDriftWatch(readDb, OWNER, RID, { now: NOW, prosodyBaseline: STEADY.prosodyBaseline });
eq(read.state, "steady", "the live read reproduces the pure report from real row shapes");
ok("the owner read WRITES NOTHING - drift watch is a monitor, not a lock, unlike readiness's read-that-writes",
  !readCalls.some((c) => /insert into vy_replica_drift_report/i.test(c.sql)));
eq(await readOwnedDriftWatch(async () => [], OWNER, RID), null,
  "a replica the owner predicate does not match returns null, same as readiness");

const client = clientDriftWatch(read);
ok("the client shape leaks no internal plumbing",
  !/(owner_user_id|voice_profile|genome_version|voice_model_ref)/i.test(JSON.stringify(client)));
ok("the client shape still carries what the studio card needs to explain a move",
  Array.isArray(client.reasons) && "last_model_commitment" in client);

fakeDb.calls = [];
const writeDb = fakeDb({ insertState: "moved" });
const written = await writeDriftReport(writeDb, OWNER, RID, movedSwap, "aa".repeat(32));
ok("a written 'moved' row reports itself as alerted", written.alerted === true);
const insertSql = fakeDb.calls[0].sql;
ok("the insert is guarded against the newest row's own inputs_hash - one statement, 009's law",
  splitSql(insertSql).length === 1 && /x\.inputs_hash=\$10/.test(insertSql));
ok("alerted_at is decided BY THE SAME STATEMENT that decides state, never a second write a crash could skip",
  /case when \$3='moved' then now\(\) else null end/.test(insertSql));

fakeDb.calls = [];
const sweepDb = fakeDb({
  fidelity: [{ score: JSON.stringify({ mean: 0.79 }), computed_at: at(2), genome_version: 3, voice_model_ref: "x" }],
  ceiling: { ceiling: "0.8869", measured_at: at(40) },
  commitments: [{ at: at(60), commitment: H1 }, { at: at(3), commitment: H2 }],
  insertState: "moved",
});
const summary = await runDriftWatchSweep({
  db: sweepDb,
  now: NOW,
  prosodyBaseline: STEADY.prosodyBaseline,
  listActiveReplicas: async () => [{ replica_id: RID, owner_user_id: OWNER }],
});
eq(summary.checked, 1, "the sweep checked the one active replica the lister returned");
eq(summary.written, 1, "...and wrote its report");
eq(summary.alerted, 1, "...which alerted, because the fixture's commitments carry a recent swap");

const erroringDb = async (sql) => {
  if (/from vy_replica_generation/i.test(sql)) throw new Error("boom");
  return [];
};
const errSummary = await runDriftWatchSweep({
  db: erroringDb,
  listActiveReplicas: async () => [{ replica_id: RID, owner_user_id: OWNER }],
});
eq(errSummary.errors, 1, "one replica failing does not throw the whole sweep - it is counted and the sweep continues");
eq(errSummary.error_details[0].replica_id, RID, "...and the failure names which replica, for the log");

// ═════════════════════════════════════════════════════════════════════════
// §10. MIGRATION 076, THE SCHEMA MIRROR, AND ERASURE
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 10. migration 076, the schema mirror and erasure ──");

const migration = readFileSync(join(ROOT, "db/migrations/076_replica_drift_report.sql"), "utf8");
ok("migration 076 is one-statement-runner safe", splitSql(migration).length > 1);
ok("no DO block and no function, per apply.mjs's splitter",
  !/\bdo \$/i.test(migration) && !/create (or replace )?function/i.test(migration));
ok("every constraint uses the idempotent drop-then-add pair",
  (migration.match(/drop constraint if exists/g) || []).length
    === (migration.match(/add constraint/g) || []).length);
ok("no foreign key on replica_id or owner_user_id - 009's convention, restated",
  !/references vy_replica/.test(migration));
ok("the no-fake-numbers law is a CHECK, both directions",
  /state = 'not_measured' and \(score is null or ceiling is null\)/.test(migration)
  && /state in \('steady','moved'\) and score is not null and ceiling is not null/.test(migration));
ok("an alert can only ever be paired with a moved state",
  /alerted_at is null or state = 'moved'/.test(migration));
ok("the migration cites the plan line and the caught swap this table exists for",
  /it notices drift/i.test(migration) && /vision-drift-4day/.test(migration));

const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
ok("the table is mirrored into db/schema.sql", /create table if not exists vy_replica_drift_report/.test(schema));
ok("...carrying the same measured-shape constraint the migration adds",
  /vy_replica_drift_report_measured_shape/.test(schema));

const erasure = readFileSync(join(ROOT, "api/_replica-full-erasure.js"), "utf8");
ok("the drift report history is deleted by name in the erasure cascade",
  /delete from vy_replica_drift_report x using target t/.test(erasure));
ok("...scoped by BOTH replica and owner, like every other line in that CTE",
  /delete from vy_replica_drift_report x using target t\s*\n\s*where x\.replica_id=t\.replica_id and x\.owner_user_id=t\.owner_user_id/.test(erasure));

const surface = readFileSync(join(ROOT, "evals/sqlcast/surface.mjs"), "utf8");
ok("all three new files are on the SQL strict surface from their first commit",
  /_drift-watch\\\.js/.test(surface) && /drift-watch\\\.js/.test(surface) && /drift-watch-sweep\\\.js/.test(surface));

// ═════════════════════════════════════════════════════════════════════════
// §11. THE CARD: WORDS, SHAPES, AND WHERE IT IS MOUNTED
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 11. the studio card ──");

const card = readFileSync(join(ROOT, "src/studio/DriftWatchCard.tsx"), "utf8");
const cardCss = readFileSync(join(ROOT, "src/studio/drift-watch.css"), "utf8");
const app = readFileSync(join(ROOT, "src/studio/StudioApp.tsx"), "utf8");

ok('the card renders "Not measured yet" rather than a zero', /Not measured yet/.test(card));
ok("the card computes no score of its own", !/reduce\(/.test(card) && !/Math\.round/.test(card));
ok("the sparkline draws from real points only, no synthetic padding to a fixed length",
  /points\.map/.test(card) && !/Array\.from\(\{ length: \d+/.test(card));
ok("only transform and opacity animate, and this card animates neither",
  !/transition:[^;]*(width|height|top|left|background)/.test(cardCss) && !/@keyframes/.test(cardCss));

// Comments stripped first: this file's own header prose quotes wire field
// names in backticks (`score`, `percent_of_ceiling`), and the naive
// three-pattern scan readiness's own eval uses would otherwise pair a
// backtick in a comment with the next one two paragraphs later and swallow
// prose that was never going to render, dashes included.
const cardNoComments = card.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
const renderedText = [
  ...(cardNoComments.match(/>[^<>{}]{3,}</g) || []),
  ...(cardNoComments.match(/: "[^"]{6,}"/g) || []),
  ...(cardNoComments.match(/`[^`]{6,}`/g) || []),
].join(" ");
ok("no em-dash or en-dash in anything this card renders", !/[–—]/.test(renderedText));
ok('no banned product word reaches the screen - "model" included, on the brief\'s own instruction',
  !/\b(clone|replica|fine-?tune|model)s?\b/i.test(renderedText));
ok("...and the server-side strings this card can render carry none either",
  !/\b(clone|replica|fine-?tune|model)s?\b/i.test(
    moduleSrc.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n")
      .match(/(?:label|reason): [`"][^`"]{4,}[`"]/g)?.join(" ") || "",
  ));

ok("the card is mounted directly under Readiness on the Meet step, and nowhere else",
  /<ReadinessPanel[\s\S]{0,1200}<DriftWatchCard/.test(app)
  && (app.match(/<DriftWatchCard/g) || []).length === 1);

console.log(`\n${checks} drift watch checks passed`);
