// EXPERIMENT — NOISE-ROBUST BARGE-IN (onset confirmation + backchannel-ignore)
//
// exp1.mjs owns the acoustic floor: it asks whether her own voice can take the
// floor from her, as a function of coupling. It says nothing about the two
// remaining ways she gets cut off for nothing, because neither is in its
// scenarios:
//
//   (i)  A TRANSIENT — a click, a chair, a door, a cough, or a burst of her own
//        playback the arbiter never modelled. Loud, broadband, ~60-130ms. The
//        claim rule is a COUNT inside a window, so scattered transients can
//        fill the window without any one of them lasting long enough to be a
//        voice.
//   (ii) A BACKCHANNEL — "hmm", "haan", "accha". 300-500ms, a CONTINUER: it
//        means *keep going*. It is under the 550ms claim and so cannot take the
//        floor, but today it still ducks her for its whole length and its audio
//        stays in the hold ring until the unconditional turn-end flush hands it
//        to the server as if it were his turn — so she answers it.
//
// and one way she must NOT be made harder to interrupt:
//
//   (iii) A REAL BARGE-IN. Onset confirmation is only honest if it costs this
//         nothing: the promoted hits keep their ORIGINAL sub-frame indices, so
//         the claim lands in the window it always would have.
//
// EVERY number here is read off the real `src/voice/liveCall.ts` through
// `run.mjs` — `floor_release` is the client's own decision to cut her, and
// `serverInterrupted` is the server's, taken off the bytes this client actually
// put on the wire. Both count as a cut: from the listener's side they are the
// same event.
//
// ── HOW TO PRODUCE THE "BEFORE" ARM ──
//   git stash push src/voice/liveCall.ts
//   node evals/echosim/build.mjs && node evals/echosim/exp-barge.mjs
//   git stash pop
//   node evals/echosim/build.mjs && node evals/echosim/exp-barge.mjs
// (exp-barge.mjs and run.mjs are untouched by that stash, so both arms are the
// same harness driving two versions of the arbiter.)
//
// ── HOW TO SWEEP THE CONFIRMATION WINDOW ──
//   TUNE='{"ONSET_CONFIRM_MS":120}' node evals/echosim/build.mjs && node evals/echosim/exp-barge.mjs
import { runCall } from "./run.mjs";

const SEEDS = [11, 23, 37, 41, 59, 71, 89, 97];
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null);
const p90 = (a) =>
  a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.9))] : null;

// Her turn runs the whole scenario and the server is still generating through
// it (deliverS < herDurS but not by much), so a leak during her turn can still
// buy a real server-side interrupt — which is the failure being counted.
const HER = { herDurS: 9, deliverS: 6, totalS: 12 };

/** One cell: n calls, how many of them cut her off, and what it cost. */
async function cell(cfgs) {
  const c = { n: 0, clientCut: 0, serverCut: 0, duck: 0, herTicks: 0, leak: [], ignored: 0, dropped: 0 };
  for (const cfg of cfgs) {
    const r = await runCall(cfg);
    c.n++;
    if (r.diag.some((d) => d.event === "floor_release")) c.clientCut++;
    if (r.serverInterrupted) c.serverCut++;
    c.duck += r.selfDuckTicks;
    c.herTicks += r.herTicks;
    c.leak.push(Math.round(r.uplinkSpeechTotalMs));
    c.ignored += r.diag.filter((d) => d.event === "barge_ignored").length;
    c.dropped += r.diag.filter((d) => d.event === "barge_ring_drop").length;
  }
  return c;
}

// ── (i) TRANSIENTS AT HIGH COUPLING ───────────────────────────────────────
// Nobody is in the room. Every cut here is false by construction. The stray
// clip is playback through a second AudioContext (what playAck() does today),
// i.e. her own speaker reaching her own microphone with nothing protecting
// against it — the worst echo transient the device can produce.
console.log("\n── (i) transients + unmodelled playback, nobody in the room ──");
const TRANSIENTS = [
  { atMs: 1500, durMs: 70, level: 0.34 }, // a click
  { atMs: 3200, durMs: 110, level: 0.28 }, // a chair
  { atMs: 5000, durMs: 60, level: 0.4 }, // a key
  { atMs: 6800, durMs: 130, level: 0.26 }, // a cough
];
const ti = [];
for (const cdb of [-3, -6, -9, -12]) {
  const c = await cell(
    SEEDS.map((seed) => ({
      ...HER,
      couplingDb: cdb,
      seed,
      user: null,
      bursts: TRANSIENTS,
      stray: { atMs: 4000, durMs: 260, level: 0.22 },
    })),
  );
  ti.push({
    couplingDb: cdb,
    falseCut: `${c.clientCut}/${c.n}`,
    serverCut: `${c.serverCut}/${c.n}`,
    selfDuckPct: Math.round((100 * c.duck) / Math.max(1, c.herTicks)),
    leakMsMed: med(c.leak),
    leakMsMax: Math.max(...c.leak),
    ignoredPerCall: Math.round((10 * c.ignored) / c.n) / 10,
  });
}
console.table(ti);

// ── (ii) BACKCHANNELS DURING HER SPEECH ───────────────────────────────────
// Two continuers across one of her turns. NEITHER may cut her, and neither may
// reach the server — a backchannel that is uplinked is a backchannel she
// answers. `leakDeltaMs` is the honest measure of that: the same seed, the same
// coupling, the same room, run once with the continuers and once without. The
// difference is the audio the continuers put on the wire.
console.log("\n── (ii) two backchannels across her turn ──");
const BC1 = { startMs: 2500, durMs: 380, level: 0.22 }; // "haan"
const BC2 = { startMs: 5200, durMs: 320, level: 0.2 }; // "accha"
const tii = [];
for (const cdb of [-6, -12, -18]) {
  const c = await cell(
    SEEDS.map((seed) => ({ ...HER, couplingDb: cdb, seed, user: BC1, user2: BC2 })),
  );
  const base = await cell(SEEDS.map((seed) => ({ ...HER, couplingDb: cdb, seed, user: null })));
  tii.push({
    couplingDb: cdb,
    falseCut: `${c.clientCut}/${c.n}`,
    serverCut: `${c.serverCut}/${c.n}`,
    selfDuckPct: Math.round((100 * c.duck) / Math.max(1, c.herTicks)),
    leakMsMed: med(c.leak),
    controlLeakMed: med(base.leak),
    leakDeltaMs: med(c.leak) - med(base.leak),
    ignoredPerCall: Math.round((10 * c.ignored) / c.n) / 10,
    ringDrops: c.dropped,
  });
}
console.table(tii);

// ── (iii) GENUINE BARGE-INS — the price of all of the above ───────────────
// Identical to exp1's ARM B plus a quiet talker, which is the cell where any
// added strictness shows up first. `got` must stay 8/8 and `msMed` must not
// move: the promoted hits carry their original indices, so it should not.
console.log("\n── (iii) genuine barge-ins ──");
const tiii = [];
for (const [label, cdb, level] of [
  ["normal", -3, 0.25],
  ["normal", -6, 0.25],
  ["normal", -9, 0.25],
  ["normal", -12, 0.25],
  ["normal", -18, 0.25],
  ["quiet", -12, 0.1],
  ["quiet", -18, 0.1],
  ["quiet+transients", -12, 0.1],
]) {
  const lat = [];
  let got = 0;
  let n = 0;
  for (const seed of SEEDS) {
    const r = await runCall({
      ...HER,
      couplingDb: cdb,
      seed,
      user: { startMs: 3000, durMs: 2500, level },
      // the hard case: a real talker in a room that is also throwing
      // transients, i.e. confirmation has to reject some sounds and accept
      // another while both are live
      bursts: label === "quiet+transients" ? TRANSIENTS : undefined,
    });
    n++;
    const rel = r.diag.find((d) => d.event === "floor_release");
    if (rel) {
      got++;
      lat.push(Math.round(rel.t - 3000));
    }
  }
  tiii.push({
    talker: label,
    couplingDb: cdb,
    got: `${got}/${n}`,
    msMed: med(lat),
    msP90: p90(lat),
    msMax: lat.length ? Math.max(...lat) : null,
  });
}
console.table(tiii);
