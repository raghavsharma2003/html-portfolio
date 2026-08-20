// evals/time/her.mjs — HER CLOCK's gate. WS-TIME.
//
// What this suite proves, in the owner's own terms: "i ask her what she is
// doing... after 2 mint i call her and she will say completly random and
// unrelated thing and no timeline of her life at all."
//
//   node evals/time/her.mjs
import {
  SRC,
  bundle,
  checkAudit,
  checkTwoMinute,
  checkContinuity,
  checkDeterminism,
  checkTimezoneStable,
  checkBeatsOutrank,
  checkRenderShape,
  MONDAY_IST,
  HOUR,
  MIN,
  DAY,
  rows,
} from "./_checks.mjs";

const BUNDLE = bundle(SRC, "her");
const M = await import(BUNDLE);

let failed = 0;
let passed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};
const run = (name, r) => ok(`${name} (n=${r.n})`, r.problems.length === 0, r.problems.join(" | "));
const section = (s) => console.log(`\n── ${s} ──`);

section("authored day tables — G8 + recited-prompt");
run("auditNotes: no mood words, no sentence shapes, schedules total 1440", checkAudit(M));

section("the two-minute contradiction — the acceptance test");
run("same activity 4 minutes later, 15:02 vs 15:06, every day", checkTwoMinute(M));
run("continuity sweep: every minute of a week, slot never jumps", checkContinuity(M));

// the literal scenario, printed, because a number is not a demonstration
{
  const t = MONDAY_IST + 3 * DAY + 15 * HOUR + 2 * MIN;
  const a = M.herNow(t);
  const b = M.herNow(t + 4 * MIN);
  console.log(`      15:02 -> ${a.slot}: ${a.note}`);
  console.log(`      15:06 -> ${b.slot}: ${b.note}`);
  ok("printed pair is identical", a.note === b.note && a.slot === b.slot);
}
// and a boundary straddle, which is the case that could still contradict
{
  const t = MONDAY_IST + 3 * DAY + 13 * HOUR + 10 * MIN; // 13:10, lunch starts 13:15
  const a = M.herNow(t);
  const b = M.herNow(t + 4 * MIN);
  console.log(`      13:10 -> ${a.slot}: ${a.note}  [next: ${a.next}]`);
  console.log(`      13:14 -> ${b.slot}: ${b.note}`);
  ok("boundary straddle announces the next slot before crossing it", a.next !== null);
}

section("determinism");
run("same clock input twice -> byte-identical frame and render", checkDeterminism(M));
{
  const r = checkTimezoneStable(BUNDLE);
  run("byte-identical across four host timezones", r);
  console.log(`      digest ${r.digest.slice(0, 16)}`);
}

section("her real timeline outranks the clock shape");
run("vy_agent_life empty -> clock shape; populated -> beats win", checkBeatsOutrank(M));

section("render — recited-prompt shape-lint + budget");
{
  const r = checkRenderShape(M);
  run("every row telegraphic, every block inside budget", r);
  console.log(`      measured worst render ${r.worst} chars of ${M.TIME_FRAME_BUDGET} budget`);
  ok(
    `arithmetic worst case fits: her ${M.HER_DAY_WORST_CASE_CHARS}<=${M.HER_DAY_BUDGET}, ` +
      `his ${M.HIS_CLOCK_WORST_CASE_CHARS}<=${M.HIS_CLOCK_BUDGET}, ` +
      `sum ${M.HER_DAY_WORST_CASE_CHARS + M.HIS_CLOCK_WORST_CASE_CHARS + 2}<=${M.TIME_FRAME_BUDGET}`,
    M.HER_DAY_WORST_CASE_CHARS <= M.HER_DAY_BUDGET &&
      M.HIS_CLOCK_WORST_CASE_CHARS <= M.HIS_CLOCK_BUDGET &&
      M.HER_DAY_WORST_CASE_CHARS + M.HIS_CLOCK_WORST_CASE_CHARS + 2 <= M.TIME_FRAME_BUDGET,
  );
}
{
  const f = M.timeFrame({ now: MONDAY_IST + 3 * DAY + 15 * HOUR, lastSpokeAt: 0, facts: [] });
  console.log("\n" + M.renderHerDay(f.her).text.split("\n").map((l) => `      ${l}`).join("\n"));
  ok("her-day block renders on a turn with no facts and no beats", rows(M.renderHerDay(f.her).text).length >= 2);
}

console.log(failed ? `\n${failed} FAILURE(S) — ${passed} passed` : `\nall ${passed} checks passed`);
process.exit(failed ? 1 : 0);
