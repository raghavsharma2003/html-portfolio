// evals/time/his.mjs — HIS CLOCK's gate. WS-TIME.
//
// "again she dont have sense of my timeline too. with the understanding of how
//  much time has passed and in that how should be the progress from the last i
//  comunicated with her."
//
// The property under test, stated once: a thing he told her about, whose date
// falls inside the window since they last spoke, was AHEAD of him then and is
// BEHIND him now — so the right question is how it went, never whether he is
// ready. And the gap that computes that window never reaches the prompt.
//
//   node evals/time/his.mjs
import {
  SRC,
  bundle,
  checkHorizons,
  checkTimeBoundParity,
  checkGapUnrenderable,
  checkNoStateLeak,
  MONDAY_IST,
  HOUR,
  DAY,
} from "./_checks.mjs";

const BUNDLE = bundle(SRC, "his");
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

section("horizon resolution — was ahead, is now behind");
run("eight cases: behind / ahead / may-have-passed / dropped", checkHorizons(M));

section("the staleNote seed stays one mechanism, not two");
run("TIME_BOUND literal identical to api/memory.js's", checkTimeBoundParity());

section("G1 — the gap computes the window and never reaches the prompt");
run("HisFrame exposes no gap field; no rendered block names the silence", checkGapUnrenderable(M));
run("no rendered row carries her state or the gap", checkNoStateLeak(M));

section("the owner's scenario, end to end");
{
  // Monday: "presentation thursday". Friday: what should she ask?
  const monday = MONDAY_IST + 9 * HOUR;
  const friday = MONDAY_IST + 4 * DAY + 11 * HOUR;
  const facts = [
    { id: "1", name: "presentation", kind: "plan", summary: "big presentation on thursday", saidAt: monday, citations: [101] },
    { id: "2", name: "goa trip", kind: "plan", summary: "goa trip next month", saidAt: monday, citations: [101] },
  ];
  const f = M.hisClock({ now: friday, lastSpokeAt: monday, facts });
  const text = M.renderHisClock(f).text;
  console.log("\n" + text.split("\n").map((l) => `      ${l}`).join("\n") + "\n");
  ok("the thursday presentation is behind him", f.moved.some((n) => n.subject === "presentation"));
  ok("the trip is still ahead", f.ahead.some((n) => n.subject === "goa trip"));
  ok("the presentation note is cited", f.moved[0]?.cited === true);
  ok("nothing in the block mentions the four-day gap", !/\b4 days?\b|\bfour days?\b/i.test(text));

  // and the inverse: asked on WEDNESDAY, the presentation must still be ahead
  const wednesday = MONDAY_IST + 2 * DAY + 11 * HOUR;
  const g = M.hisClock({ now: wednesday, lastSpokeAt: monday, facts });
  ok("on wednesday the same presentation is still ahead, not behind", g.moved.length === 0 && g.ahead.length === 1);
}

section("empty-store behaviour");
{
  const now = MONDAY_IST + 4 * DAY;
  const f = M.hisClock({ now, lastSpokeAt: now - 9 * DAY, facts: [] });
  ok("no facts -> empty frame", f.moved.length === 0 && f.ahead.length === 0 && f.maybePassed.length === 0);
  ok("no facts -> zero bytes rendered", M.renderHisClock(f).text === "");
  const first = M.hisClock({ now, facts: [{ id: "x", name: "exam", kind: "event", summary: "exam on tuesday", saidAt: now - 20 * DAY }] });
  ok("unknown lastSpokeAt widens the window instead of failing closed", first.moved.length === 1);
}

console.log(failed ? `\n${failed} FAILURE(S) — ${passed} passed` : `\nall ${passed} checks passed`);
process.exit(failed ? 1 : 0);
