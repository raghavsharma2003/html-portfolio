// Continuity of the small stuff — the ONE predicate in this workstream that
// is still eval-only, and the reason it is eval-only is worth reading before
// anyone "finishes the job" by shipping it.
//
// ── WHAT MOVED OUT OF THIS FILE, AND WHY ────────────────────────────────
//
// This file used to hold the actionable-identifier detector as well. It is now
// `src/engine/honesty.ts`, because the detector stopped being a description of
// a violation and became the thing that stops one: `brain.ts` runs it over
// every reply before the bytes leave the engine. A predicate that gates real
// output belongs in the shipped tree, and a SECOND copy of it beside the suite
// would be `age-tier-never-realtime` — the fork loses whatever is added after
// it, silently, and only a diff of two things nobody thinks of as the same
// thing would find out. So the copy was deleted rather than kept in step.
//
// ── WHY THE ACTIVITY RULE STAYED ────────────────────────────────────────
//
// The owner's other case: he asks what she is doing, she says something, he
// calls two minutes later and gets something unrelated. The failure is not
// that the second answer is wrong — it is that no human activity ends that
// fast and gets replaced by an unrelated one.
//
// This encodes exactly that and nothing more. It does NOT classify free text
// into activities; the fixtures carry the label, because a lexical activity
// classifier would be `vision-fab` with a keyword list — read part, assert the
// rest. What it gates is the RULE: given two labelled activity claims and the
// gap between them, is the switch physically plausible?
//
// It is therefore NOT on the output path and must not be wired to one until
// something can produce the labels honestly. Saying so here is cheaper than
// discovering it from a `sourceStatus: "wired"` field that nothing checks
// (`manifest-sourcestatus`).

/** Minimum plausible run of an activity, in minutes. Authored, coarse, and
 *  deliberately generous — the point is to catch a two-minute teleport, not
 *  to adjudicate whether a chapter takes 18 minutes or 25. */
export const MIN_MINUTES = {
  eating: 15,
  cooking: 20,
  reading: 20,
  watching: 20,
  bathing: 10,
  commuting: 15,
  working: 30,
  sleeping: 60,
  gym: 30,
  chores: 15,
  // The small-and-stable answer. It has no duration to violate because it
  // asserts nothing — which is the entire reason the persona now prefers it
  // when nothing has been established.
  nothing: 0,
};

/** Activities that can plausibly follow one another without a contradiction,
 *  because one contains or ends into the other. Everything not listed is an
 *  unrelated switch. */
const FOLLOWS = {
  cooking: ["eating", "chores", "nothing"],
  eating: ["chores", "nothing", "watching"],
  bathing: ["nothing", "commuting"],
  gym: ["bathing", "commuting", "nothing"],
  commuting: ["working", "nothing"],
  working: ["nothing", "eating", "commuting"],
  reading: ["nothing", "sleeping"],
  watching: ["nothing", "eating"],
  chores: ["nothing"],
  sleeping: ["nothing"],
  nothing: Object.keys(MIN_MINUTES),
};

/**
 * @param {{atMs:number, activity:string}[]} turns  her successive claims about
 *        what she is doing RIGHT NOW, in order, each labelled with a key of
 *        MIN_MINUTES.
 * @returns {{from:string,to:string,gapMin:number,needMin:number}[]} the
 *        implausible switches. Empty means her afternoon held together.
 */
export function activityBreaks(turns) {
  const out = [];
  for (let i = 1; i < turns.length; i++) {
    const a = turns[i - 1];
    const b = turns[i];
    if (a.activity === b.activity) continue;
    const gapMin = (b.atMs - a.atMs) / 60000;
    const need = MIN_MINUTES[a.activity] ?? 0;
    const ok = (FOLLOWS[a.activity] || []).includes(b.activity);
    // Two ways to be fine: enough time passed that the first thing could
    // have finished, or the second thing is what the first one ends into.
    if (gapMin >= need) continue;
    if (ok && gapMin >= need / 2) continue;
    out.push({ from: a.activity, to: b.activity, gapMin: Number(gapMin.toFixed(1)), needMin: need });
  }
  return out;
}
