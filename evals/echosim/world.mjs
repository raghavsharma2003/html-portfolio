// A virtual-clock browser just real enough to run src/voice/liveCall.ts.
//
// Everything the arbiter reads is real: her audio is actually "played" through
// a gain node whose automation is evaluated sample-accurately, and the mic
// buffer handed to onaudioprocess is RENDERED from that playback (scaled by a
// controlled coupling and delayed by an acoustic round trip) plus room noise
// plus whatever people are saying. So "she interrupted herself" is observed,
// not asserted.

export const SR_IN = 48000; // mic context
export const SR_OUT = 24000; // her PCM
export const TICK = 4096; // ScriptProcessor frame
export const TICK_MS = (TICK / SR_IN) * 1000; // 85.333ms

// ── virtual clock ────────────────────────────────────────────────────────
let NOW = 1_700_000_000_000;
let seq = 1;
let timers = new Map(); // id -> {at, fn, every}
export const clock = {
  now: () => NOW,
  /** Run every timer due at or before `t`, in order, then park the clock at t. */
  advanceTo(t) {
    for (;;) {
      let best = null;
      for (const [id, e] of timers) if (e.at <= t && (!best || e.at < best[1].at)) best = [id, e];
      if (!best) break;
      const [id, e] = best;
      NOW = e.at;
      if (e.every == null) timers.delete(id);
      else e.at = NOW + e.every;
      try {
        e.fn();
      } catch (err) {
        console.error("timer threw", err);
      }
    }
    NOW = t;
  },
};
function installClock() {
  const realNow = Date.now;
  globalThis.__realNow = realNow;
  Date.now = () => NOW;
  globalThis.setTimeout = (fn, ms = 0, ...a) => {
    const id = seq++;
    timers.set(id, { at: NOW + Math.max(0, ms), fn: () => fn(...a), every: null });
    return id;
  };
  globalThis.setInterval = (fn, ms = 0, ...a) => {
    const id = seq++;
    const p = Math.max(1, ms);
    timers.set(id, { at: NOW + p, fn: () => fn(...a), every: p });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.clearInterval = (id) => timers.delete(id);
}

// ── AudioParam with real linear-ramp evaluation ──────────────────────────
class Param {
  constructor(ctx, v) {
    this.ctx = ctx;
    this.base = { t: 0, v };
    this.ramp = null;
  }
  valueAt(t) {
    const r = this.ramp;
    if (!r) return this.base.v;
    if (t >= r.t) return r.v;
    if (t <= this.base.t) return this.base.v;
    const f = (t - this.base.t) / Math.max(1e-9, r.t - this.base.t);
    return this.base.v + (r.v - this.base.v) * f;
  }
  get value() {
    return this.valueAt(this.ctx.currentTime);
  }
  set value(v) {
    this.base = { t: this.ctx.currentTime, v };
    this.ramp = null;
  }
  cancelScheduledValues(t) {
    const v = this.valueAt(t);
    this.base = { t, v };
    this.ramp = null;
  }
  setValueAtTime(v, t) {
    this.base = { t, v };
    this.ramp = null;
  }
  linearRampToValueAtTime(v, t) {
    this.ramp = { t, v };
  }
}

class Src {
  constructor(ctx) {
    this.ctx = ctx;
    this.buffer = null;
    this.onended = null;
    this.at = 0;
    this.stopped = Infinity;
    this.live = false;
  }
  connect() {}
  disconnect() {}
  start(at) {
    this.at = at;
    this.live = true;
    this.ctx._sources.push(this);
  }
  stop() {
    this.stopped = Math.min(this.stopped, this.ctx.currentTime);
    this.live = false;
    if (this.onended) this.onended();
  }
}

class Ctx {
  constructor(t0) {
    this.t0 = t0;
    this.sampleRate = SR_IN;
    this.gains = [];
    this._sources = [];
    this.destination = { connect() {}, disconnect() {} };
  }
  get currentTime() {
    return (NOW - this.t0) / 1000;
  }
  createGain() {
    const g = { gain: new Param(this, 1), connect() {}, disconnect() {} };
    this.gains.push(g);
    return g;
  }
  createAnalyser() {
    return {
      fftSize: 256,
      smoothingTimeConstant: 0.6,
      connect() {},
      disconnect() {},
      getByteTimeDomainData(b) {
        b.fill(128);
      },
    };
  }
  createScriptProcessor() {
    const p = { onaudioprocess: null, connect() {}, disconnect() {} };
    this.proc = p;
    return p;
  }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
  createBuffer(_ch, len, sr) {
    const d = new Float32Array(len);
    return { length: len, sampleRate: sr, duration: len / sr, getChannelData: () => d };
  }
  createBufferSource() {
    return new Src(this);
  }
  close() {
    return Promise.resolve();
  }
  resume() {
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
  /** Post-gain sample of everything she is actually playing at outCtx-time t. */
  playedAt(t, gainNode) {
    let s = 0;
    for (const src of this._sources) {
      if (!src.buffer) continue;
      if (t < src.at || t >= src.at + src.buffer.duration || t >= src.stopped) continue;
      const i = Math.floor((t - src.at) * src.buffer.sampleRate);
      const d = src.buffer.getChannelData(0);
      if (i >= 0 && i < d.length) s += d[i];
    }
    return s * (gainNode ? gainNode.gain.valueAt(t) : 1);
  }
  reap(t) {
    this._sources = this._sources.filter(
      (s) => t < s.stopped && t < s.at + (s.buffer ? s.buffer.duration : 0) + 1,
    );
  }
}

// ── sockets, mic, token ──────────────────────────────────────────────────
class FakeWS {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.sent = [];
    FakeWS.last = this;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 5);
  }
  send(s) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  /** deliver a server frame */
  recv(obj) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}
FakeWS.OPEN = 1;

export function installWorld() {
  installClock();
  globalThis.WebSocket = FakeWS;
  globalThis.WebSocket.OPEN = 1;
  globalThis.Blob = class {};
  globalThis.atob = (b64) => Buffer.from(b64, "base64").toString("binary");
  globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
  globalThis.performance = { now: () => NOW };
  // /api/speech serves REAL generated WAVs (scratchpad/ackv2) when the harness
  // installs __ACKWAV, so the listening-sound arm plays her actual clips
  // through the real decode/trim/normalise path rather than a stand-in. Every
  // other fetch behaves exactly as before, and the baseline tree never calls
  // /api/speech at all, so this is additive.
  globalThis.fetch = async (url, init) => {
    if (typeof url === "string" && url.includes("/api/speech")) {
      let text = "";
      try {
        text = JSON.parse(init?.body ?? "{}").text ?? "";
      } catch {}
      const wav = globalThis.__ACKWAV?.(text);
      if (!wav) return { ok: false, status: 502 };
      return { ok: true, status: 200, arrayBuffer: async () => wav };
    }
    return { ok: true, json: async () => ({ token: "T", model: "m" }) };
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    },
  });
  const ctxs = [];
  globalThis.AudioContext = class extends Ctx {
    constructor() {
      super(NOW);
      ctxs.push(this);
    }
  };
  globalThis.__ctxs = ctxs;
  globalThis.AbortSignal = { timeout: () => ({}) };
  return { ctxs, FakeWS };
}

export { FakeWS };
