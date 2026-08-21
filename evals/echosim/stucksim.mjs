// THE STUCK LISTENING LOOP — does she ever get the floor back in a noisy room?
//
// The owner: "bahot der tak listening wala loop chalne laga aur woh ussi mai
// phasi rhi ... this also happen when there is disturbance at my end."
//
// The correlation with disturbance is the diagnosis. The server ends his turn
// by HEARING a pause, and this client only uplinks a pause when the gate
// CLOSES. Sustained room noise above the listen bar pins the gate open, so no
// silence is ever sent, the VAD clock never advances, and she listens forever.
//
// exp1.mjs owns the acoustic floor and says nothing about this: its scenarios
// are seconds long and end while the gate is still legitimately open. This asks
// the one question the floor harness cannot — after MINUTES of noise, does the
// uplink ever go quiet?
//
// Both arms drive the REAL src/voice/liveCall.ts through run.mjs. Every
// assertion is read off `uplinkTrace`, i.e. the bytes that reached the socket,
// never off a variable inside the module.
import { runCall } from "./run.mjs";

const FORCE_MS = 700; // FORCE_SILENCE_MS in liveCall.ts
const STUCK_MS = 20_000; // STUCK_OPEN_MS in liveCall.ts

let fails = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ok    ${name}`);
  else {
    console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`);
    fails++;
  }
};

/** Longest unbroken run of zero-energy uplink, in ms, within [fromMs, toMs). */
function longestSilentRunMs(trace, fromMs = 0, toMs = Infinity) {
  let best = 0;
  let cur = 0;
  for (const u of trace) {
    if (u.t < fromMs || u.t >= toMs) continue;
    if (u.energyMs === 0) {
      cur += u.energyMs === 0 ? 1 : 0;
      best = Math.max(best, cur);
    } else cur = 0;
  }
  // ticks -> ms (one tick is ~85.3ms at 48k)
  return Math.round(best * 85.3);
}

// ── ARM A: a loud room, nobody speaking, half a minute ────────────────────
// roomRms 0.15 sits far above LISTEN_ABS_MAX (0.072), so the listen bar cannot
// adapt above it and the gate is pinned open by construction.
console.log("\n── 1. loud room: does the uplink ever go quiet? ──");
const loud = await runCall({
  couplingDb: -18,
  roomRms: 0.15,
  user: null,
  herDurS: 2,
  deliverS: 1,
  totalS: 32,
  seed: 11,
});

// The window starts AFTER her own turn. Measuring from 0 catches the mic hold
// during her 2s of speech — zero-energy uplink that is the hold ring working
// correctly, not a pause in the room. The first version of this assertion did
// exactly that and reported a 1,962ms "natural pause" that was her own turn.
const HER_TURN_ENDS_MS = 6_000;
const beforeWindow = longestSilentRunMs(loud.uplinkTrace, HER_TURN_ENDS_MS, STUCK_MS - 1500);
// Measured from the same post-her-turn window, NOT from 0. Measuring the whole
// call let her own mic hold satisfy this assertion, so it passed even with the
// watchdog disabled — a control that cannot fail is not a control.
const afterWindow = longestSilentRunMs(loud.uplinkTrace, HER_TURN_ENDS_MS);
const fired = loud.diag.filter((d) => d.event === "stuck_endpoint");

// The scenario must actually REPRODUCE the bug, or the fix below proves nothing.
check(
  "the room really does pin the gate (no natural pause once she stops)",
  beforeWindow < FORCE_MS,
  `longest silent run in [${HER_TURN_ENDS_MS}, ${STUCK_MS - 1500}) = ${beforeWindow}ms`,
);
check("the stuck watchdog fired", fired.length >= 1, JSON.stringify(fired.slice(0, 2)));
check(
  "and real silence reached the socket",
  afterWindow >= FORCE_MS - 100,
  `longest silent run after her turn = ${afterWindow}ms`,
);
// The forced silence must appear only after the threshold. Asserted on the
// uplink rather than on a timestamp inside the module: no silent run long
// enough to be a forced endpoint may exist in the window before it.
check(
  "no forced-length silence before the threshold",
  beforeWindow < FORCE_MS,
  `longest silent run in [${HER_TURN_ENDS_MS}, ${STUCK_MS - 1500}) = ${beforeWindow}ms`,
);

// ── ARM B: an ordinary room — the watchdog must stay asleep ───────────────
// The false-positive arm, and the one that matters: firing on a normal call
// would commit his turn early on every long sentence.
console.log("\n── 2. ordinary room: the watchdog must not fire ──");
const quiet = await runCall({
  couplingDb: -18,
  roomRms: 0.0025,
  user: null,
  herDurS: 2,
  deliverS: 1,
  totalS: 32,
  seed: 11,
});
const quietFired = quiet.diag.filter((d) => d.event === "stuck_endpoint");
check("no forced endpoint in a quiet room", quietFired.length === 0, JSON.stringify(quietFired));
check(
  "a quiet room reaches silence on its own",
  longestSilentRunMs(quiet.uplinkTrace) >= FORCE_MS,
  `longest silent run = ${longestSilentRunMs(quiet.uplinkTrace)}ms`,
);

console.log(
  fails ? `\n${fails} FAILURES` : "\nALL PASS — she gets the floor back in a room that never goes quiet",
);
process.exit(fails ? 1 : 0);
