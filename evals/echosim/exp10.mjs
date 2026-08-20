// EXPERIMENT 10 — CAN SHE MAKE A SOUND WHILE THEY ARE TALKING?
//
// The owner's ask is backchanneling: "hmm", "haan", a small laugh WHILE the
// other person is still speaking. Three ways to do it on this architecture,
// measured against the one thing that decides whether it is safe — what the
// SERVER receives on the uplink while the user is mid-sentence.
//
//   REGISTERED   the clip goes through her own output bus, so speakingUntil /
//                herLevels / herEnv see it and the whole echo apparatus
//                protects against its leak. This is what a backchannel built
//                properly inside liveCall.ts would look like.
//   STRAY        the clip is played through a SECOND AudioContext the arbiter
//                knows nothing about — literally what calling speech.ts's
//                playAck()/playBackchannel() during a live call does today.
//   AFTER        the same registered clip, but placed in the gap AFTER they
//                stop talking instead of on top of them.
//
// THE NUMBER THAT DECIDES IT: silentRunMs. The server ends the user's turn by
// HEARING a pause — automaticActivityDetection.silenceDurationMs is 300. So a
// run of digital silence longer than 300ms, injected into the MIDDLE of a
// continuous utterance, splits that utterance into two turns: she answers the
// first half while they are still saying the second.
import { runCall } from "./run.mjs";

const SEEDS = [11, 23, 37, 41, 59, 71, 89, 97];
const U_START = 3000;
const U_DUR = 4000;
const U_END = U_START + U_DUR;
const BC_AT = U_START + 1500; // 1.5s into their sentence: a real backchannel spot
const BC_MS = 450; // "hmm" / "haan" — the length exp8 already uses for one
const TICK = 85.3;

const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

/** Longest run of zero-energy uplink strictly INSIDE their utterance. The
 *  first and last 400ms are excluded: the gate's own onset and its 250ms
 *  hangover are not a hole in the middle of a sentence. */
function silentRunMs(trace, from, to) {
  let run = 0;
  let worst = 0;
  for (const p of trace) {
    if (p.t < from || p.t > to) continue;
    if (p.energyMs <= 0) {
      run += TICK;
      if (run > worst) worst = run;
    } else run = 0;
  }
  return Math.round(worst);
}
/** How much of their speech actually reached the server during the utterance. */
function heardMs(trace, from, to) {
  let s = 0;
  for (const p of trace) if (p.t >= from && p.t <= to) s += p.energyMs;
  return Math.round(s);
}

const arms = {
  control: () => ({}),
  registered: () => ({ herTurns: [{ at: BC_AT, durS: BC_MS / 1000 }], deliverS: 0.1 }),
  stray: () => ({ stray: { atMs: BC_AT, durMs: BC_MS, level: 0.25 } }),
  after: () => ({ herTurns: [{ at: U_END + 150, durS: BC_MS / 1000 }], deliverS: 0.1 }),
};

const rows = [];
for (const c of [-6, -12]) {
  for (const [name, mk] of Object.entries(arms)) {
    const gaps = [];
    const heard = [];
    const leak = [];
    let rel = 0;
    for (const seed of SEEDS) {
      const r = await runCall({
        couplingDb: c,
        seed,
        user: { startMs: U_START, durMs: U_DUR, level: 0.25 },
        totalS: 11,
        herTurns: [],
        ...mk(),
      });
      gaps.push(silentRunMs(r.uplinkTrace, U_START + 400, U_END - 400));
      heard.push(heardMs(r.uplinkTrace, U_START, U_END + 400));
      leak.push(Math.round(r.uplinkSpeechTotalMs));
      if (r.diag.some((d) => d.event === "floor_release")) rel++;
    }
    const row = {
      couplingDb: c,
      arm: name,
      silentRunMsMed: med(gaps),
      silentRunMsMax: Math.max(...gaps),
      splitsTurn: `${gaps.filter((g) => g > 300).length}/${SEEDS.length}`,
      heardMsMed: med(heard),
      uplinkTotalMed: med(leak),
      floorRelease: `${rel}/${SEEDS.length}`,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
console.table(rows);
