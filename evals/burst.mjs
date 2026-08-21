// The burst-wait policy (src/engine/burst.ts), against the CURRENT source
// (bundled by evals/run.mjs — run that, not this file directly).
//
// The reason this suite exists rather than a couple of inline asserts is the
// asymmetry the owner's own report describes: a wait that is too SHORT is loud
// (she answers mid-thought and it reads as not listening) and a wait that is
// too LONG is silent (it just feels slow, and nobody files that as a bug).
// The clamps are the whole safety story, so both of them get a case, and so
// does every rule about which gaps count as evidence.
import { burstWaitMs, recentUserGaps, BURST_DEFAULT_MS, BURST_MIN_MS, BURST_MAX_MS } from "./.bundle.mjs";

let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

// ── the wait itself ────────────────────────────────────────────────────────
// No rhythm yet must behave EXACTLY as the shipped constant did: a person with
// no history must not be a person with a new bug.
check("no samples -> default", burstWaitMs([]), BURST_DEFAULT_MS);
check("one sample is an anecdote -> default", burstWaitMs([900]), BURST_DEFAULT_MS);

// A fast typist: 1.6 x 300 = 480, below the floor, so the floor holds.
check("fast typist clamps to MIN", burstWaitMs([300, 280, 320]), BURST_MIN_MS);
// A deliberate typist: 1.6 x 2600 = 4160, above the ceiling. THIS is the case
// scene-hold-800 was about — without the clamp the slowest person waits longest.
check("deliberate typist clamps to MAX", burstWaitMs([2600, 2500, 2700]), BURST_MAX_MS);
// In band, the multiplier actually acts.
check("mid-band scales by the multiplier", burstWaitMs([1000, 1000]), 1600);
check("mid-band, odd count", burstWaitMs([800, 1000, 1200]), 1600);

// Median, not mean: one long pause inside a burst must not redefine the person.
// mean would be 1400 -> 2240; median is 400 -> clamped to the floor.
check("median resists a single outlier", burstWaitMs([400, 400, 400, 400, 5400]), BURST_MIN_MS);

// ── which gaps count as evidence ───────────────────────────────────────────
const T = (from, at, channel) => ({ from, at, channel });

// Consecutive messages of theirs only.
check(
  "consecutive user messages produce gaps",
  recentUserGaps([T("me", 0), T("me", 1000), T("me", 2200)]),
  [1000, 1200],
);

// A gap that spans HER reply is a conversational turn, not a burst. Folding it
// in would inflate the rhythm with exactly the pauses this must distinguish.
check(
  "a gap spanning her reply is not a burst gap",
  recentUserGaps([T("me", 0), T("her", 500), T("me", 9000)]),
  [],
);

// Beyond the ceiling they are done talking, not mid-burst.
check(
  "a gap over the ceiling is excluded",
  recentUserGaps([T("me", 0), T("me", 60_000)]),
  [],
);

// Spoken timing is a different clock.
check(
  "call turns are excluded",
  recentUserGaps([T("me", 0, "call"), T("me", 800, "call")]),
  [],
);

// Order is newest-last, so the caller reads it the way the transcript reads.
check(
  "gaps come back oldest-first",
  recentUserGaps([T("me", 0), T("me", 100), T("me", 900)]),
  [100, 800],
);

// Zero and negative deltas (clock skew, same-ms sends) must not enter.
check("non-positive gaps are excluded", recentUserGaps([T("me", 500), T("me", 500)]), []);

// ── the end-to-end shape the surface actually calls ────────────────────────
check(
  "a real fast burst -> floor",
  burstWaitMs(recentUserGaps([T("me", 0), T("me", 250), T("me", 500), T("me", 760)])),
  BURST_MIN_MS,
);
check(
  "a transcript with no user burst -> default",
  burstWaitMs(recentUserGaps([T("me", 0), T("her", 400), T("me", 9000), T("her", 9500)])),
  BURST_DEFAULT_MS,
);

console.log(fail ? `${fail} FAILURES` : `ALL ${17} PASS`);
process.exit(fail ? 1 : 0);
