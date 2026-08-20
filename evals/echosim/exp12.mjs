// EXPERIMENT 12 — what the listening sound actually costs.
//
// A conversation, not a monologue: she talks, they answer at length, she
// replies. The murmur fires in the gap after they stop. Run twice — once
// against the production build, once against a build with ACK_MIN_USER_MS
// raised out of reach (the same code path, never triggered) — and diff.
//
//   node build.mjs                                        && node exp12.mjs on
//   TUNE='{"ACK_MIN_USER_MS":99999999}' node build.mjs    && node exp12.mjs off
//
// What has to hold:
//   leakMs        her own voice reaching the server MUST NOT RISE. This is the
//                 metric the echo work bought (6996 -> 1280ms at −6 dB) and the
//                 murmur is one more thing coming out of the same speaker.
//   silentRunMs   unchanged. The uplink inside their sentence must not gain a
//                 hole; the sound is placed after they stop precisely so it
//                 cannot.
//   heardMs       unchanged. Not one sample of their speech is displaced.
//   herEndMs      unchanged. Her audio must end at the same instant it would
//                 have — proof that `playhead` was not pushed, i.e. that her
//                 first word was not delayed.
//   bargeIn       unchanged. Nothing about the floor may have moved.
import { runCall } from "./run.mjs";

const ARM = process.argv[2] ?? "on";
const SEEDS = [11, 23, 37, 41, 59, 71, 89, 97];
const TICK = 85.3;
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

// she talks, they answer for 3s, she replies ~1.2s later — twice
const TURNS = [
  { at: 0, durS: 4 },
  { at: 10200, durS: 4 },
  { at: 20200, durS: 4 },
];
const U1 = { startMs: 6000, durMs: 3000 };
const U2 = { startMs: 16000, durMs: 3000 };

function win(trace, from, to) {
  let run = 0, worst = 0, heard = 0;
  for (const p of trace) {
    if (p.t < from || p.t > to) continue;
    if (p.energyMs <= 0) {
      run += TICK;
      if (run > worst) worst = run;
    } else {
      run = 0;
      heard += p.energyMs;
    }
  }
  return { worst: Math.round(worst), heard: Math.round(heard) };
}

const rows = [];
for (const c of [-6, -12, -18]) {
  const acks = [], leak = [], runs = [], heard = [], herEnd = [];
  for (const seed of SEEDS) {
    const r = await runCall({
      couplingDb: c,
      seed,
      user: U1,
      herTurns: TURNS,
      deliverS: 2.5,
      totalS: 26,
    });
    acks.push(r.diag.filter((d) => d.event === "ack_emitted").length);
    leak.push(Math.round(r.uplinkSpeechTotalMs));
    const w = win(r.uplinkTrace, U1.startMs, U1.startMs + U1.durMs);
    runs.push(w.worst);
    heard.push(w.heard);
    const last = [...r.states].reverse().find((s) => s.s === "listening");
    herEnd.push(last ? last.t : 0);
  }
  // barge-in must still land: they take the floor during her second turn
  let got = 0;
  const bms = [];
  for (const seed of SEEDS) {
    const r = await runCall({
      couplingDb: c,
      seed,
      user: { startMs: 11500, durMs: 2500, level: 0.25 },
      herTurns: TURNS,
      deliverS: 2.5,
      totalS: 26,
    });
    const rl = r.diag.find((d) => d.event === "floor_release" && d.t > 11000);
    if (rl) {
      got++;
      bms.push(Math.round(rl.t - 11500));
    }
  }
  const row = {
    arm: ARM,
    couplingDb: c,
    acksPerCall: med(acks),
    leakMsMed: med(leak),
    leakMsMax: Math.max(...leak),
    silentRunMsMed: med(runs),
    heardMsMed: med(heard),
    herEndMsMed: med(herEnd),
    bargeIn: `${got}/${SEEDS.length}`,
    bargeMsMed: bms.length ? med(bms) : null,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.table(rows);
