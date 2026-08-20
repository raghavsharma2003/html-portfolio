// EXPERIMENT 11 — the same question as exp10, paired per seed so the answer is
// the DELTA the backchannel causes and not the phrase gaps the talker already
// has. Same seed, same room, same user utterance; the only difference between
// the arms is the 450ms sound she makes at BC_AT.
//
//   registered      client-injected clip, registered with the echo apparatus
//                   (speakingUntil/herLevels/herEnv). serverInterrupts OFF,
//                   because a client-injected sound is not a model turn and
//                   there is nothing for the server to interrupt.
//   registeredSrv   the same clip delivered as a MODEL turn, i.e. what you get
//                   if you try to make her backchannel by prompting. The server
//                   VAD is live, so it can cancel her mid-sound.
//   stray           played through a second AudioContext the arbiter cannot
//                   see — exactly what speech.ts's playAck() does today.
//   after           registered clip, but 150ms AFTER they stop talking.
//
// Reported per arm, as a paired delta against the same seed's control run:
//   dSilenceMs   extra DIGITAL SILENCE the server received during their
//                utterance. Their words are not lost — the hold ring replays
//                them — but the server's endpointer counts this as pause.
//   dRunMs       change in the LONGEST unbroken silent run inside the
//                utterance. > 300ms total is a turn split (silenceDurationMs).
//   dHeardMs     change in energy-bearing uplink during the utterance. NEGATIVE
//                means their speech was delayed out of the window; POSITIVE
//                means something that is not them got in.
import { runCall } from "./run.mjs";

const SEEDS = [11, 23, 37, 41, 59, 71, 89, 97];
const U_START = 3000;
const U_DUR = 4000;
const U_END = U_START + U_DUR;
const BC_AT = U_START + 1500;
const BC_MS = 450;
const TICK = 85.3;
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

function stats(trace, from, to) {
  let run = 0;
  let worst = 0;
  let zeros = 0;
  let heard = 0;
  for (const p of trace) {
    if (p.t < from || p.t > to) continue;
    if (p.energyMs <= 0) {
      run += TICK;
      zeros += TICK;
      if (run > worst) worst = run;
    } else {
      run = 0;
      heard += p.energyMs;
    }
  }
  return { worst, zeros, heard };
}

const base = { user: { startMs: U_START, durMs: U_DUR, level: 0.25 }, totalS: 11, herTurns: [] };
const arms = {
  registered: { herTurns: [{ at: BC_AT, durS: BC_MS / 1000 }], deliverS: 0.1, serverInterrupts: false },
  registeredSrv: { herTurns: [{ at: BC_AT, durS: BC_MS / 1000 }], deliverS: 0.1 },
  stray: { stray: { atMs: BC_AT, durMs: BC_MS, level: 0.25 } },
  after: { herTurns: [{ at: U_END + 150, durS: BC_MS / 1000 }], deliverS: 0.1, serverInterrupts: false },
};

const rows = [];
for (const c of [-6, -12, -18]) {
  const ctl = {};
  for (const seed of SEEDS) {
    const r = await runCall({ couplingDb: c, seed, ...base });
    ctl[seed] = { ...stats(r.uplinkTrace, U_START, U_END + 400), total: r.uplinkSpeechTotalMs };
  }
  for (const [name, cfg] of Object.entries(arms)) {
    const dS = [], dR = [], dH = [], dT = [], runAbs = [];
    let rel = 0;
    for (const seed of SEEDS) {
      const r = await runCall({ couplingDb: c, seed, ...base, ...cfg });
      const s = stats(r.uplinkTrace, U_START, U_END + 400);
      dS.push(Math.round(s.zeros - ctl[seed].zeros));
      dR.push(Math.round(s.worst - ctl[seed].worst));
      dH.push(Math.round(s.heard - ctl[seed].heard));
      dT.push(Math.round(r.uplinkSpeechTotalMs - ctl[seed].total));
      runAbs.push(Math.round(s.worst));
      if (r.diag.some((d) => d.event === "floor_release")) rel++;
    }
    const row = {
      couplingDb: c,
      arm: name,
      dSilenceMs: med(dS),
      dRunMs: med(dR),
      runMsMax: Math.max(...runAbs),
      over300: `${runAbs.filter((x) => x > 300).length}/${SEEDS.length}`,
      dHeardMs: med(dH),
      dUplinkTotalMs: med(dT),
      floorRelease: `${rel}/${SEEDS.length}`,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
console.table(rows);
