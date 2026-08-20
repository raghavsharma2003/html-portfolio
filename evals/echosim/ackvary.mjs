// Two sounds in one call, 20s apart — the only way to observe the no-repeat
// rule and the ACK_MIN_GAP_MS floor actually working, since a 20s scenario can
// only ever contain one.
import { runCall } from "./run.mjs";
import { serveAckWavs } from "./ack.mjs";
serveAckWavs("aoede");
const live = await import("./build/voice/liveCall.js");
globalThis.__DIAG = [];
live.prewarmAckClips("");
for (let i = 0; i < 2000; i++) {
  await new Promise((r) => setImmediate(r));
  if ((globalThis.__DIAG ?? []).some((d) => d.event === "ack_clips")) break;
}

// her turn, silence, they talk; twice, far enough apart to clear the 15s floor
const TURNS = [{ at: 0, durS: 6 }, { at: 22_000, durS: 5 }];
let calls = 0, twoAcks = 0, repeats = 0, tooClose = 0;
const seqs = [];
for (const seed of [11, 23, 37, 41, 59, 71, 89, 97]) {
  for (const c of [-6, -12]) {
    const r = await runCall({
      couplingDb: c, seed, herTurns: TURNS, deliverS: 2.5, totalS: 46,
      user: { startMs: 8000, durMs: 3400, level: 0.25 },
      user2: { startMs: 32_000, durMs: 3400, level: 0.25 },
    });
    calls++;
    const a = r.diag.filter((d) => d.event === "ack_emitted");
    if (a.length >= 2) twoAcks++;
    const names = a.map((x) => x.detail?.clip ?? "synth");
    seqs.push(names.join(" > "));
    for (let i = 1; i < a.length; i++) {
      if (names[i] === names[i - 1]) repeats++;
      if (a[i].t - a[i - 1].t < 15_000) tooClose++;
    }
  }
}
console.log(JSON.stringify({
  calls, callsWithTwoSounds: twoAcks,
  backToBackRepeats: repeats, soundsCloserThan15s: tooClose,
  sequences: [...new Set(seqs)],
}, null, 1));
