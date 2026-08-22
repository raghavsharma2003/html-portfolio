// Scenario runner: one simulated call, one coupling level, one optional
// interferer. Drives the REAL liveCall.ts.

import { installWorld, clock, FakeWS, SR_IN, SR_OUT, TICK, TICK_MS } from "./world.mjs";
import { speech, noise, lin, rng as rngIR } from "./signal.mjs";

installWorld();
const { startLiveCall } = await import("./build/voice/liveCall.js");

const ACOUSTIC_DELAY_MS = 25;

/**
 * @param cfg.couplingDb   speaker→mic echo return loss, negative dB (-6 = loud)
 * @param cfg.herLevel     peak-20ms RMS of her voice at the speaker
 * @param cfg.roomRms      ambience
 * @param cfg.user         null | {startMs, durMs, level, seed}
 * @param cfg.herDurS      length of her turn
 * @param cfg.deliverS     how fast the server ships it (buffer lead)
 * @param cfg.totalS       sim length
 */
export async function runCall(cfg) {
  const {
    couplingDb = -12,
    herLevel = 0.25,
    roomRms = 0.0025,
    user = null,
    herDurS = 9,
    deliverS = 2.5,
    totalS = 12,
    seed = 11,
    serverInterrupts = true,
    rt60Ms = 260,
    backlog = 0,
    tailGain = 1.1,
  } = cfg;
  globalThis.__DIAG = [];
  globalThis.__ctxs.length = 0; // each run gets its own pair of contexts
  FakeWS.last = null;
  const events = [];
  const states = [];

  const yieldJobs = () => new Promise((r) => setImmediate(r));
  /** advance the virtual clock in 1ms steps, letting microtasks run between */
  const pump = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      clock.advanceTo(Math.min(end, Date.now() + 1));
      await yieldJobs();
    }
  };

  let sess = null;
  const started = startLiveCall({
    base: "",
    system: "s",
    onState: (s) => states.push({ t: Date.now(), s }),
    onMyText: () => {},
    onHerText: () => {},
    onEnded: (r) => events.push({ t: Date.now(), e: "ended", r }),
  }).then((s) => (sess = s));
  started.catch((e) => events.push({ e: "startfail", m: String(e) }));
  await pump(20); // fetch → ws construct → onopen
  const ws = FakeWS.last;
  if (!ws) throw new Error("no socket");
  ws.recv({ setupComplete: {} });
  await pump(20);
  await started;
  if (!sess) throw new Error("session never started");

  const ctxs = globalThis.__ctxs;
  const outCtx = ctxs.find((c) => !c.proc);
  const inCtx = ctxs.find((c) => c.proc);
  if (!outCtx || !inCtx) throw new Error("contexts not built");
  const outBus = outCtx.gains[0];
  const proc = inCtx.proc;
  if (!proc.onaudioprocess) throw new Error("no uplink tick");

  // ── material ──
  const room = noise(SR_IN, totalS + 1, roomRms, seed + 1);
  const usr = user ? speech(SR_IN, user.durMs / 1000, { level: user.level, f0: 118, seed: seed + 2 }) : null;
  // A SECOND thing the person does, after a gap — e.g. starting to talk again
  // 400ms after they stopped, which is inside the window the listening sound
  // holds the microphone for. Same voice, same room, its own start time.
  const user2 = cfg.user2 ?? null;
  const usr2 = user2 ? speech(SR_IN, user2.durMs / 1000, { level: user2.level, f0: 118, seed: seed + 5 }) : null;
  const coupling = lin(couplingDb);
  // STRAY PLAYBACK: audio that comes out of the same speaker but that the
  // arbiter knows nothing about — i.e. a clip played through a second
  // AudioContext (speech.ts's), the way playAck()/playBackchannel() do today.
  // It reaches the mic through the same room and the same coupling; the only
  // difference from her real voice is that herLevels/herEnv/speakingUntil
  // never saw it, so nothing protects against it.
  const stray = cfg.stray
    ? speech(SR_OUT, cfg.stray.durMs / 1000, { level: cfg.stray.level ?? 0.25, f0: 205, seed: seed + 77 })
    : null;
  // TRANSIENTS: a click, a chair scrape, a door, a keyboard, a cough. Loud,
  // broadband, and SHORT — the class of sound the floor arbiter's duration
  // rules exist to refuse. Rendered straight into the mic buffer (they are in
  // the room, not on the speaker), each with a raised-cosine envelope so it has
  // a real onset rather than a step discontinuity.
  //   cfg.bursts = [{ atMs, durMs, level }]
  const bursts = (cfg.bursts ?? []).map((b, i) => {
    const n = Math.round((SR_IN * b.durMs) / 1000);
    const a = noise(SR_IN, b.durMs / 1000, b.level ?? 0.3, seed + 101 + i * 7);
    for (let k = 0; k < n; k++) a[k] *= Math.pow(Math.sin((Math.PI * k) / n), 0.6);
    return { atMs: b.atMs, audio: a };
  });

  const t0 = Date.now();
  const CH = Math.round(SR_OUT * 0.2); // 200ms downlink chunks
  // Her turns. A real call is many turns and κ persists across them, so a
  // one-turn sim over-weights the pre-lock transient by a factor of the turn
  // count. Default: three turns with real gaps, like a conversation.
  const turns = (cfg.herTurns ?? [{ at: 0, durS: herDurS }]).map((t, i) => ({
    at: t.at,
    audio: speech(SR_OUT, t.durS, { level: herLevel, f0: 205, seed: seed + i * 13 }),
    sent: 0,
    done: false,
    started: false,
  }));
  let genDoneSent = false;
  const b64 = (a, from, len) => {
    const buf = Buffer.alloc(len * 2);
    for (let i = 0; i < len; i++) {
      let v = Math.round(Math.max(-1, Math.min(1, a[from + i])) * 32767);
      buf.writeInt16LE(v, i * 2);
    }
    return buf.toString("base64");
  };

  // server-side barge detection over what the client actually uplinks
  let uplinkSpeechMs = 0;
  let interruptAt = 0;
  let interruptedSent = false;
  let genInFlightServer = false;

  const micBuf = new Float32Array(TICK);
  const ticks = Math.floor((totalS * 1000) / TICK_MS);
  const herHist = new Float32Array((ticks + 2) * TICK);
  // room impulse response, normalised to unit power so `couplingDb` stays the
  // honest speaker→mic RMS coupling whatever the reverb does
  const IR = (() => {
    const R = rngIR(seed * 7 + 5);
    const taps = [{ d: Math.round((ACOUSTIC_DELAY_MS / 1000) * SR_IN), a: 1 }];
    if (rt60Ms > 0) {
      const nT = 40;
      for (let j = 1; j <= nT; j++) {
        const ms = ACOUSTIC_DELAY_MS + (j * rt60Ms) / nT;
        const a = Math.pow(10, (-3 * (ms - ACOUSTIC_DELAY_MS)) / rt60Ms) * (R() * 2 - 1) * tailGain;
        taps.push({ d: Math.round((ms / 1000) * SR_IN), a });
      }
    }
    let p = 0;
    for (const t of taps) p += t.a * t.a;
    const g = 1 / Math.sqrt(p);
    for (const t of taps) t.a *= g;
    return taps;
  })();
  const gainTrace = [];
  const sendLog = [];
  const uplinkTrace = [];
  const alignedByTick = [];
  let selfDuckTicks = 0;
  let herTicks = 0;
  let uplinkSpeechTotalMs = 0; // audio with real energy that reached the server
  let maxHard = 0;
  let maxSoft = 0;
  globalThis.__PROBE = (p) => {
    globalThis.__TAP?.(p);
    if (p.herSpeaking) {
      herTicks++;
      if (p.hard > maxHard) maxHard = p.hard;
      if (p.soft > maxSoft) maxSoft = p.soft;
    }
  };

  for (let k = 1; k <= ticks; k++) {
    const tickEnd = t0 + k * TICK_MS;
    // ── downlink pacing: ship each of her turns over `deliverS` ──
    for (const T of turns) {
      const el = tickEnd - t0 - T.at;
      if (el < 0 || T.done) continue;
      const want = Math.min(T.audio.length, Math.round((el / 1000 / deliverS) * T.audio.length));
      while (T.sent < want) {
        const len = Math.min(CH, T.audio.length - T.sent);
        ws.recv({
          serverContent: { modelTurn: { parts: [{ inlineData: { data: b64(T.audio, T.sent, len) } }] } },
        });
        genInFlightServer = true;
        T.started = true;
        T.sent += len;
      }
      if (T.started && T.sent >= T.audio.length) {
        ws.recv({ serverContent: { generationComplete: true } });
        ws.recv({ serverContent: { turnComplete: true } });
        genInFlightServer = false;
        T.done = true;
        genDoneSent = true;
      }
    }
    if (interruptAt && tickEnd >= interruptAt && !interruptedSent) {
      interruptedSent = true;
      ws.recv({ serverContent: { interrupted: true } });
    }

    // ── render the mic buffer for [tickEnd-TICK_MS, tickEnd) ──
    // Her post-gain playback goes into a history buffer first, then through a
    // room impulse response: a speakerphone couples through a ROOM, and the
    // reverb tail is what fills her own inter-word gaps with her own voice.
    const base = (k - 1) * TICK;
    for (let i = 0; i < TICK; i++) {
      const absMs = tickEnd - TICK_MS + (i / SR_IN) * 1000;
      let v = outCtx.playedAt((absMs - outCtx.t0) / 1000, outBus);
      if (stray) {
        const si = Math.floor(((absMs - t0 - cfg.stray.atMs) / 1000) * SR_OUT);
        if (si >= 0 && si < stray.length) v += stray[si];
      }
      herHist[base + i] = v;
    }
    for (let i = 0; i < TICK; i++) {
      const n = base + i;
      let e = 0;
      for (let j = 0; j < IR.length; j++) {
        const m = n - IR[j].d;
        if (m >= 0) e += IR[j].a * herHist[m];
      }
      let v = coupling * e;
      const absMs = tickEnd - TICK_MS + (i / SR_IN) * 1000;
      const ri = Math.floor(((absMs - t0) / 1000) * SR_IN);
      if (ri >= 0 && ri < room.length) v += room[ri];
      if (usr) {
        const ui = Math.floor(((absMs - t0 - user.startMs) / 1000) * SR_IN);
        if (ui >= 0 && ui < usr.length) v += usr[ui];
      }
      if (usr2) {
        const ui2 = Math.floor(((absMs - t0 - user2.startMs) / 1000) * SR_IN);
        if (ui2 >= 0 && ui2 < usr2.length) v += usr2[ui2];
      }
      for (let bi = 0; bi < bursts.length; bi++) {
        const B = bursts[bi];
        const k2 = Math.floor(((absMs - t0 - B.atMs) / 1000) * SR_IN);
        if (k2 >= 0 && k2 < B.audio.length) v += B.audio[k2];
      }
      micBuf[i] = v;
    }
    // GROUND TRUTH for the offline statistic study: her own post-gain output,
    // RMS over this same 85ms window, at a range of candidate acoustic lags.
    // Production would derive this from her own playback envelope; here it is
    // exact, so the statistic can be judged before anything is built on it.
    if (globalThis.__WANT_ALIGNED) {
      const lags = [];
      for (let Lms = 0; Lms <= 260; Lms += 20) {
        const off = Math.round((Lms / 1000) * SR_IN);
        let a = 0;
        for (let i = 0; i < TICK; i++) {
          const m = base + i - off;
          a += m >= 0 ? herHist[m] * herHist[m] : 0;
        }
        lags.push(Math.sqrt(a / TICK));
      }
      alignedByTick.push(lags);
    }
    clock.advanceTo(tickEnd);
    const gnow = outBus.gain.value;
    gainTrace.push(gnow);
    if (!user && gnow < 0.95) selfDuckTicks++;
    proc.onaudioprocess({
      inputBuffer: { sampleRate: SR_IN, length: TICK, getChannelData: () => micBuf },
    });
    // ── the server reacts to what it was actually sent ──
    const frames = ws.sent.splice(0);
    // when the socket is told it is backed up, the shed path runs
    if (backlog) ws.bufferedAmount = backlog;
    sendLog.push({ t: tickEnd - t0, n: frames.length });
    let energyMs = 0;
    for (const f of frames) {
      const j = JSON.parse(f);
      const d = j.realtimeInput?.audio?.data;
      if (!d) continue;
      const b = Buffer.from(d, "base64");
      let a = 0;
      const n = b.length / 2;
      for (let i2 = 0; i2 < n; i2++) {
        const s = b.readInt16LE(i2 * 2) / 32768;
        a += s * s;
      }
      if (Math.sqrt(a / Math.max(1, n)) > 0.008) energyMs += (n / 16000) * 1000;
    }
    uplinkTrace.push({ t: tickEnd - t0, energyMs, frames: frames.length });
    uplinkSpeechTotalMs += energyMs;
    if (energyMs > 20) uplinkSpeechMs += energyMs;
    else uplinkSpeechMs = Math.max(0, uplinkSpeechMs - TICK_MS);
    // the real server stops her ~230ms after it has heard ~150ms of speech —
    // but ONLY while it still has a turn to interrupt
    if (serverInterrupts && genInFlightServer && uplinkSpeechMs > 150 && !interruptAt) {
      interruptAt = Date.now() + 230;
    }
    await new Promise((r) => setImmediate(r));
  }
  const diag = globalThis.__DIAG.map((d) => ({ ...d, t: d.t - t0 }));
  try {
    sess.stop();
  } catch {}
  globalThis.__PROBE = null;
  return {
    diag,
    states,
    gainTrace,
    selfDuckTicks,
    herTicks,
    ticks,
    uplinkSpeechTotalMs,
    maxHard,
    maxSoft,
    alignedByTick,
    sendLog,
    uplinkTrace,
    // Did the SERVER decide to stop her, off the bytes this client actually
    // sent? A client that never releases the floor but leaks a backchannel to
    // the server has still cut her off — from the listener's side the two are
    // the same event, so the harness has to be able to see both.
    serverInterrupted: interruptAt > 0,
    serverInterruptMs: interruptAt ? interruptAt - t0 : null,
  };
}
