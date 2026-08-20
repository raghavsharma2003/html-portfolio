// THE LISTENING SOUND, MEASURED — the same three questions exp6 / exp8 /
// endpoint.mjs ask of the audio floor, asked again in the one window the sound
// exists in.
//
// Why a new scenario rather than exp6's: the trigger requires ≥2500ms of user
// speech with `herSpeaking` false throughout (her own leak holds the listen
// gate open, so talk credited while she is audible would make her hum at her
// own echo). In exp6/exp8/endpoint she is talking for essentially the whole
// call, so the sound CANNOT fire there — verified, 0/8 — which is why those
// three come out bit-identical with the feature on and are reported as such
// rather than as evidence. This scenario gives her one turn, then a real
// silence with a 3400ms user turn inside it, which is where a person actually
// backchannels.
//
//   node expack.mjs <label> [flavour]
import { runCall } from "./run.mjs";
import { serveAckWavs } from "./ack.mjs";

const LABEL = process.argv[2] ?? "?";
serveAckWavs(process.argv[3] ?? "aoede");
const live = await import("./build/voice/liveCall.js");
if (live.prewarmAckClips) {
  globalThis.__DIAG = [];
  live.prewarmAckClips("");
  let warm = null;
  for (let i = 0; i < 2000 && !warm; i++) {
    await new Promise((r) => setImmediate(r));
    warm = (globalThis.__DIAG ?? []).find((d) => d.event === "ack_clips");
  }
  console.error("prewarm:", JSON.stringify(warm?.detail ?? "NEVER COMPLETED"));
}

const SEEDS = [11, 23, 37, 41, 59, 71, 89, 97];
const TURNS = [{ at: 0, durS: 6 }]; // one turn, then the silence a person talks into
const U_AT = 8000, U_MS = 3400, U_END = U_AT + U_MS;
const USER = { startMs: U_AT, durMs: U_MS, level: 0.25 };
const WIN = [U_END, U_END + 2600]; // the sound, its tail guard, and a beat after
const COUPLINGS = [-3, -6, -9, -12, -18];
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const inWin = (t) => t >= WIN[0] - 200 && t <= WIN[1];
const out = { label: LABEL, scenario: { herTurns: TURNS, user: USER, window: WIN } };

/** energy the server was actually sent inside the window (ms of speech-level audio) */
const winLeak = (r) => {
  let ms = 0;
  for (const u of r.uplinkTrace) if (u.t >= WIN[0] && u.t <= WIN[1]) ms += u.energyMs;
  return ms;
};
/** longest silence on the uplink inside the window — the VAD's clock */
const winGap = (r) => {
  let last = 0, g = 0;
  for (const e of r.sendLog) {
    if (e.t < WIN[0] || e.t > WIN[1] || !e.n) continue;
    if (last && e.t - last > g) g = e.t - last;
    last = e.t;
  }
  return g;
};

// ── 1. does it fire, where, and is it varied ──
{
  let fired = 0;
  const at = [], clips = new Map();
  let repeats = 0;
  const seen = [];
  for (const c of COUPLINGS) {
    for (const seed of SEEDS) {
      const r = await runCall({ couplingDb: c, seed, user: USER, herTurns: TURNS, deliverS: 2.5, totalS: 20 });
      const a = r.diag.filter((d) => d.event === "ack_emitted");
      if (a.length) { fired++; at.push(Math.round(a[0].t - U_END)); }
      // within ONE call only: lastAckIdx is per-session, so cross-run adjacency
      // is not a repeat and counting it would be measuring nothing
      let prev = null;
      for (const x of a) {
        const n = x.detail?.clip ?? "synth";
        clips.set(n, (clips.get(n) ?? 0) + 1);
        if (prev === n) repeats++;
        prev = n;
        seen.push(n);
      }
    }
  }
  out.fired = `${fired}/${COUPLINGS.length * SEEDS.length}`;
  out.afterUserStopsMsMed = at.length ? med(at) : null;
  out.clipMix = Object.fromEntries(clips);
  out.backToBackRepeats = repeats;
}

// ── 2. the floor, inside the window the sound owns ──
// NOBODY IS IN THE ROOM after the user stops. Anything the client releases, or
// uplinks with energy in it, in this window is the sound talking to the server
// as if it were a person — the exact failure the "during" placements produced.
out.selfInflicted = [];
for (const c of COUPLINGS) {
  let rel = 0; const leak = [], gap = [];
  for (const seed of SEEDS) {
    const r = await runCall({ couplingDb: c, seed, user: USER, herTurns: TURNS, deliverS: 2.5, totalS: 20 });
    if (r.diag.some((d) => d.event === "floor_release" && inWin(d.t))) rel++;
    leak.push(Math.round(winLeak(r)));
    gap.push(Math.round(winGap(r)));
  }
  out.selfInflicted.push({
    couplingDb: c,
    releaseInWindow: `${rel}/8`,
    leakMsMed: med(leak), leakMsMax: Math.max(...leak),
    heartbeatGapMax: Math.max(...gap), limitMs: 300,
  });
}

// ── 3. THEY START TALKING AGAIN 400ms after they stopped — inside the mic hold
// the sound created. The question is NOT whether a floor_release fires (with no
// sound there is nothing to release FROM, so the control is 0/8 by
// construction); it is whether the server still HEARS them. Measured as the
// milliseconds of speech-level audio that actually reached the socket in the
// 2.5s after they restart, against the same run with no sound made. ──
out.restartHeard = [];
for (const c of [-6, -12]) {
  for (const [name, lvl, dur] of [
    ["real talker 0.25, 2.5s", 0.25, 2500],
    ["quiet talker 0.10, 3s", 0.1, 3000],
    ["haan backchannel 450ms", 0.25, 450],
  ]) {
    const heard = [], gaps = [];
    let rel = 0;
    for (const seed of SEEDS) {
      const r = await runCall({
        couplingDb: c, seed, herTurns: TURNS, deliverS: 2.5, totalS: 22,
        user: { startMs: U_AT, durMs: U_MS, level: 0.25 },
        user2: { startMs: U_END + 400, durMs: dur, level: lvl },
      });
      const a = U_END + 400, b = a + 2500;
      let ms = 0;
      for (const u of r.uplinkTrace) if (u.t >= a && u.t <= b) ms += u.energyMs;
      heard.push(Math.round(ms));
      let last = 0, g = 0;
      for (const e of r.sendLog) {
        if (e.t < a || e.t > b || !e.n) continue;
        if (last && e.t - last > g) g = e.t - last;
        last = e.t;
      }
      gaps.push(Math.round(g));
      if (r.diag.some((d) => d.event === "floor_release" && d.t > U_END + 200)) rel++;
    }
    out.restartHeard.push({
      couplingDb: c, case: name,
      heardMsMed: med(heard), heardMsMin: Math.min(...heard),
      gapMax: Math.max(...gaps), releases: `${rel}/8`,
    });
  }
}

console.log(JSON.stringify(out, null, 1));
