// #86 rupture_open — record vs stance, against the CURRENT src/engine/relstate.ts
// (bundled fresh via esbuild every run, same drift-proofing reasoning as
// evals/wsdepth-test-pure.mjs and evals/run.mjs itself — a frozen bundle
// passes forever while the source rots).
//
// context/rejected.md `rupture-never-closes` filed the defect this proves
// fixed: rupture_open conflated THE RECORD that a rupture happened
// (vy_rel_event, permanent) with HER CURRENT STANCE of holding it open
// (which used to never lapse — see that file for the two measured effects:
// the honorific re-advance bar held down forever, and the stage
// permanently capped at "warming"). This suite is offline, fixture-based,
// $0, no network, no DB — every input below is a hand-built RelState/
// RelEvent, nothing fetched.
//
// Three properties, one section each:
//   1. the RECORD survives a lapse untouched
//   2. the STANCE lapses on the chosen condition (time OR warm episodes)
//   3. an explicit NEW rupture re-opens — including the exact gap case
//      `rupture-never-closes` named: repair_state stuck at "open" forever
//      because no repair signal ever arrived.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const tmp = mkdtempSync(join(tmpdir(), "rupture-lapse-"));
const BUNDLE = join(tmp, "relstate.bundle.mjs");

execSync(
  `npx esbuild ${join(ROOT, "src/engine/relstate.ts")} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { stdio: "inherit", cwd: ROOT },
);

const {
  replaySnapshot,
  ruptureStance,
  ruptureRepairShift,
  stageForDims,
  renderRelSnapshot,
  initialRelState,
  RUPTURE_STANCE_LAPSE_DAYS,
  RUPTURE_STANCE_LAPSE_WARM_EPISODES,
} = await import(pathToFileURL(BUNDLE).href);

let failed = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
};
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, `got ${g} want ${w}`);
};

const PERSON = "rupture-lapse-fixture-person";
const days = (n) => n * 86_400_000;

// ─────────────────────────────────────────────────────────────────────────
// 1. THE RECORD SURVIVES LAPSE
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 1. record survives lapse ──");

const t0 = new Date("2026-06-01T12:00:00Z").getTime();
const ruptureEvent = {
  id: 1,
  person_id: PERSON,
  dim: "rupture",
  from_v: "closed",
  to_v: "open",
  direction: "advance",
  note: "conflict-shaped episode: rupture opens",
  citations: [101],
  at: new Date(t0).toISOString(),
};

// replaySnapshot is pure event-log -> state, no lapse anywhere in it —
// asserted directly, since it is the thing that WOULD be wrong if the
// record itself decayed.
const replayedAtOpen = replaySnapshot(PERSON, [ruptureEvent]);
ok("replay right after the event: rupture_open true", replayedAtOpen.rupture_open === true);

// The same event log, replayed as if 90 days had passed — replaySnapshot
// takes no `now` at all, so nothing about it CAN move with time. The event
// array itself is asserted unchanged (length, fields) after being fed
// through both replay and the (separately, below) lapsed stance read.
const replayedMuchLater = replaySnapshot(PERSON, [ruptureEvent]);
eq("replay is a pure fold: identical input -> byte-identical state", replayedMuchLater, replayedAtOpen);
ok(
  "the event itself is untouched (same fields, nothing zeroed/rewritten)",
  ruptureEvent.dim === "rupture" && ruptureEvent.to_v === "open" && ruptureEvent.citations.length === 1,
);

// The STANCE read is what changes with time — the record (the event array
// passed in) is never mutated by computing it, checked here by re-reading
// the same event object's fields after the stance call.
const stanceMuchLater = ruptureStance(
  { ruptureOpen: replayedMuchLater.rupture_open, repairState: replayedMuchLater.repair_state, lastMoveAt: ruptureEvent.at, warmEpisodesSince: 12 },
  new Date(t0 + days(90)),
);
eq("90 days later: stance reads settled", stanceMuchLater, "settled");
ok(
  "...but the record event is STILL the same object, unmutated by that read",
  ruptureEvent.to_v === "open" && ruptureEvent.at === new Date(t0).toISOString(),
);
// and replaying again confirms the persisted flag never silently flipped
const replayedAgain = replaySnapshot(PERSON, [ruptureEvent]);
eq("replay after a stance read is still byte-identical (record untouched)", replayedAgain, replayedAtOpen);

// ─────────────────────────────────────────────────────────────────────────
// 2. THE STANCE LAPSES ON THE CHOSEN CONDITION
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 2. stance lapses on the chosen condition ──");

const openedAt = new Date("2026-08-01T12:00:00Z").toISOString();

eq(
  "never ruptured: stance is 'none' regardless of time",
  ruptureStance({ ruptureOpen: false, repairState: "none", lastMoveAt: openedAt, warmEpisodesSince: 999 }, new Date("2027-01-01")),
  "none",
);
eq(
  "no timestamp on record: never guess a lapse, stays 'open'",
  ruptureStance({ ruptureOpen: true, repairState: "open", lastMoveAt: null, warmEpisodesSince: 999 }, new Date("2027-01-01")),
  "open",
);

// day-boundary, exact: RUPTURE_STANCE_LAPSE_DAYS
const justUnder = new Date(new Date(openedAt).getTime() + days(RUPTURE_STANCE_LAPSE_DAYS) - 3_600_000);
const justAtOrOver = new Date(new Date(openedAt).getTime() + days(RUPTURE_STANCE_LAPSE_DAYS));
eq(
  `${RUPTURE_STANCE_LAPSE_DAYS - 1}.96 days: still open`,
  ruptureStance({ ruptureOpen: true, repairState: "open", lastMoveAt: openedAt, warmEpisodesSince: 0 }, justUnder),
  "open",
);
eq(
  `exactly ${RUPTURE_STANCE_LAPSE_DAYS} days: settled`,
  ruptureStance({ ruptureOpen: true, repairState: "open", lastMoveAt: openedAt, warmEpisodesSince: 0 }, justAtOrOver),
  "settled",
);

// warm-episode boundary, exact — the OR condition, time still short
const soonAfter = new Date(new Date(openedAt).getTime() + days(2));
eq(
  `${RUPTURE_STANCE_LAPSE_WARM_EPISODES - 1} warm episodes, 2 days: still open`,
  ruptureStance({ ruptureOpen: true, repairState: "open", lastMoveAt: openedAt, warmEpisodesSince: RUPTURE_STANCE_LAPSE_WARM_EPISODES - 1 }, soonAfter),
  "open",
);
eq(
  `${RUPTURE_STANCE_LAPSE_WARM_EPISODES} warm episodes, 2 days: settled`,
  ruptureStance({ ruptureOpen: true, repairState: "open", lastMoveAt: openedAt, warmEpisodesSince: RUPTURE_STANCE_LAPSE_WARM_EPISODES }, soonAfter),
  "settled",
);

// downstream effect 1 (rejected.md): the stage cap. High trust, still-open
// (unlapsed) rupture must still cap at "warming"; the SAME trust once the
// rupture has lapsed must read its real trust band. `renderNow` fixes the
// clock so "unlapsed" vs "lapsed" is controlled by the fixture inputs, not
// by which calendar day this suite happens to run on.
const renderNow = new Date(new Date(openedAt).getTime() + days(2)); // 2 days after opening: nowhere near the 21-day lapse on its own
const highTrustState = { person_id: PERSON, honorific: "tu", cs_ratio: 0.5, cs_on_stress: "unknown", trust: 0.8, rupture_open: true, repair_state: "open", ritual_density: 0.3, pacing_gap_s: 3600, snapshot_ver: 1, updated_at: openedAt };
eq(
  "unlapsed open rupture at trust=0.8: stage still capped at warming",
  stageForDims(highTrustState, { lastRuptureMoveAt: openedAt, warmEpisodesSinceRupture: 0 }, renderNow),
  "warming",
);
eq(
  "lapsed (settled) rupture at trust=0.8: stage reflects real trust band, no longer capped",
  stageForDims(highTrustState, { lastRuptureMoveAt: openedAt, warmEpisodesSinceRupture: RUPTURE_STANCE_LAPSE_WARM_EPISODES }, renderNow),
  "close",
);
// legacy call shape (no meta, no now — real callers that predate this
// seam): must still read as unconditionally capped, exactly as before.
ok(
  "same dyad, legacy call shape (no meta, real wall clock): still an open rupture, still capped",
  stageForDims(highTrustState) === "warming" || stageForDims(highTrustState) === "new",
);

// downstream effect 2 (rejected.md): the rendered T2 line. Open renders
// exactly as before; settled renders visibly differently, and both are
// shapelint-clean (never sentence-shaped, never first-person).
const openRender = renderRelSnapshot(highTrustState, { lastHonorificMoveAt: null, lastRuptureMoveAt: openedAt, warmEpisodesSinceRupture: 0 }, renderNow);
const settledRender = renderRelSnapshot(highTrustState, { lastHonorificMoveAt: null, lastRuptureMoveAt: openedAt, warmEpisodesSinceRupture: RUPTURE_STANCE_LAPSE_WARM_EPISODES }, renderNow);
ok("open renders '(open)'", openRender.text.includes("repair: open (open)"));
ok("settled does NOT render '(open)' — the two must read differently", !settledRender.text.includes("repair: open (open)"));
ok("settled render mentions 'settled'", settledRender.text.includes("settled"));
ok("settled render is shapelint-clean", settledRender.lint.clean === true && settledRender.lint.violations === 0);
ok("open render is shapelint-clean", openRender.lint.clean === true && openRender.lint.violations === 0);
ok(
  "renderRelSnapshot with the old 1-field meta shape (no lastRuptureMoveAt) always reads open, never guesses settled",
  renderRelSnapshot(highTrustState, { lastHonorificMoveAt: null }, renderNow).text.includes("repair: open (open)"),
);

// ─────────────────────────────────────────────────────────────────────────
// 3. AN EXPLICIT NEW RUPTURE RE-OPENS
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 3. explicit new rupture re-opens ──");

// 3a. ordinary case, unaffected by this fix: a fully repaired dyad, brand
// new conflict — always re-opened, exactly as before.
const repaired = { ruptureOpen: false, repairState: "repaired" };
const reopenOrdinary = ruptureRepairShift(repaired, true, false);
ok("repaired dyad + new conflict: reopens", reopenOrdinary?.dim === "rupture" && reopenOrdinary?.ruptureOpen === true);

// 3b. the exact gap `rupture-never-closes` named: repair_state stuck at
// "open" forever (no repair signal ever came), stance has since lapsed,
// and a genuinely NEW, unrelated conflict arrives. Before this fix this
// matched no branch and was silently dropped.
const stuckOpen = { ruptureOpen: true, repairState: "open" };
const reopenAfterLapse = ruptureRepairShift(stuckOpen, true, false, /* stanceLapsed */ true);
ok(
  "stuck-open rupture, lapsed stance, new conflict: re-opens (this is the gap the ticket was filed for)",
  reopenAfterLapse !== null && reopenAfterLapse.dim === "rupture" && reopenAfterLapse.ruptureOpen === true,
);

// negative control: SAME stuck-open state, new conflict, but the stance has
// NOT lapsed yet — must still be the pre-fix no-move outcome. Without this
// control, "always re-open on conflictSignal" would pass 3b for the wrong
// reason (dropping stanceLapsed's gating entirely).
const noReopenUnlapsed = ruptureRepairShift(stuckOpen, true, false, /* stanceLapsed */ false);
ok("same stuck-open state, NOT lapsed: no move (still holding the same rupture, not a new one)", noReopenUnlapsed === null);

// negative control: stanceLapsed=true must never cause a spurious reopen
// when there is no actual new conflict this pass.
const noReopenNoConflict = ruptureRepairShift(stuckOpen, false, false, true);
ok("lapsed stance but no fresh conflict signal: no move", noReopenNoConflict === null);

// re-rupture mid-repair stays governed by repairState, not by lapse — a
// stale `stanceLapsed=true` must not suppress the existing regress branch.
const midRepair = { ruptureOpen: true, repairState: "repairing" };
const regress = ruptureRepairShift(midRepair, true, false, true);
eq("mid-repair re-rupture regresses to open regardless of stanceLapsed", regress?.dim, "repair");
eq("...", regress?.direction, "regress");

// an explicit repair signal must still be able to complete the cycle even
// after the stance already lapsed on its own — time settling the STANCE
// must never block the RECORD from later reflecting a real apology.
const stillCompletable = ruptureRepairShift(stuckOpen, false, true, true);
ok(
  "explicit repair signal after lapse still advances open -> repairing (lapse never blocks a real repair)",
  stillCompletable?.dim === "repair" && stillCompletable?.repairState === "repairing",
);

// sanity: initialRelState never starts with a rupture, so day-1 renders no
// stance at all (regression guard for the "none" branch)
eq("brand-new dyad: no rupture, no stance", ruptureStance({ ruptureOpen: initialRelState(PERSON).rupture_open, repairState: initialRelState(PERSON).repair_state, lastMoveAt: null, warmEpisodesSince: 0 }), "none");

console.log(failed ? `\n${failed} FAILURE(S)` : "\nall rupture record-vs-stance checks passed");
process.exit(failed ? 1 : 0);
