// Gemini Live realtime call engine — true speech-to-speech. The mic streams
// 16kHz PCM up a WebSocket; her voice streams back as 24kHz PCM chunks that
// play with ~zero buffering; barge-in is server-side (an `interrupted` signal
// flushes local playback instantly). Auth is a single-use ephemeral token
// minted by /api/live-token — the Google key never reaches this code.
//
// The cascade engine (STT→LLM→TTS) remains the fallback: startLiveCall
// rejects or calls onEnded("failed"), and the caller falls back seamlessly.

import { attachAnalyser, detachAnalyser } from "./level";

const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export interface LiveSession {
  stop: () => void;
  setMuted: (m: boolean) => void;
  /** Speak an invisible directive (e.g. the pickup greeting trigger). */
  direct: (contextNote: string) => void;
  /**
   * Stream a screen frame (base64 JPEG) — realtime co-watching. Returns
   * whether the frame actually entered the socket: a caller may only tell
   * her to look at the screen when it did.
   */
  sendFrame: (b64Jpeg: string) => boolean;
  /**
   * Uplink pressure read from the socket queue's TROUGHS: 0 clear, 1
   * moderate, 2 heavy. Callers shed VIDEO against this (rate/quality) —
   * never audio.
   */
  congestion: () => 0 | 1 | 2;
  active: () => boolean;
}

export interface LiveCallOpts {
  base: string; // "" on web, absolute origin on the APK
  system: string;
  onState: (s: "listening" | "speaking") => void;
  onMyText: (t: string) => void; // finalized user transcript per turn
  onHerText: (t: string) => void; // finalized her transcript per turn
  onEnded: (reason: "failed" | "closed") => void;
  /** Connect-path timings, so remote telemetry can say WHERE the seconds go. */
  onTiming?: (t: { mintMs?: number; preminted?: boolean; readyMs?: number }) => void;
}

// ── uplink: what the socket queue is allowed to do to the call ──
// bufferedAmount is ONE counter for audio AND video, so every threshold here
// is stated in "seconds of mic audio". 16k PCM16 as base64+JSON runs
// ~43.5KB/s (a 4096-frame tick = 85ms = 2730 PCM bytes -> 3640 base64 chars
// + ~60 bytes of JSON ≈ 3.7KB per 85ms).
//
// DELIBERATELY NOT HERE ANY MORE: speech dropping. There is no backlog level
// at which a mic chunk carrying WORDS is discarded. Her hearing every word is
// the product; a "gracefully degraded" call that quietly eats syllables is
// just a broken call that hides it. A slow link now delays her instead of
// deafening her.
//
// The one thing a queue must never do is grow without bound: a socket that
// has stopped draining will happily accept minutes of audio and then deliver
// all of it at once, and she replays speech from most of a minute ago as if
// it were now (measured, 45s of stale audio). So there is exactly ONE hard
// ceiling, below — a stall backstop, not a quality knob. Nothing between
// "fine" and "the socket is dead" changes behaviour.
//
// 400_000 / 43_500 ≈ 9.2s of mic audio already waiting. Chosen to be
// unreachable on any link that can carry a call at all: a healthy socket sits
// near zero, a bad-but-usable one spikes to tens of KB and drains inside a
// second, and one 120KB video frame is still under a third of it. Getting
// here means the socket has accepted nothing for the better part of ten
// seconds, at which point the conversation is already over and the only
// question is whether she also shouts ten seconds of history when it comes
// back. It bounds that damage at ~9s instead of unbounded.
const STALL_CEILING = 400_000;
// Wordless chunks are a different matter and this stays exactly as it was.
// A gated chunk carries no words, only VAD continuity, so it sheds at the
// first sign of backlog. 8_000 / 43_500 ≈ 185ms of audio backlog (~2 mic
// ticks). ~60-70% of a call is gated, so this alone frees most of the uplink
// — and it costs nothing, because nothing was said in those chunks.
const SILENCE_CAP = 8_000;
// ...but silence is never shed to NOTHING. The server ends their turn by
// HEARING the pause: if a congested link suppressed every gated chunk, the
// stream would go dark the moment they stop talking, the VAD clock would
// stop advancing, and she would sit there listening forever — the exact
// "she never replies" failure this whole lane exists to prevent. So the
// pause right after words is untouchable (it is what commits the turn), and
// past that at least one chunk in SILENCE_KEEP always goes.
const SILENCE_ENDPOINT_MS = 700; // protected pause after the gate closes
const SILENCE_KEEP = 3; // heartbeat: ≥1 of every 3 gated chunks survives
// A pathological encode (~90KB of JPEG) would be ~2.8s of uplink on its own.
// This is the ONLY thing that can now refuse a frame: frames are no longer
// gated on how drained the socket is. Refusing a frame because ~185ms of
// backlog exists is how she goes blind mid-screen-share and then has nothing
// to say — the failure is silence, and it looks exactly like lag.
const FRAME_MAX_B64 = 120_000;
// ── congestion, measured at the TROUGHS (identical numbers on Android —
// see LiveWatchEngine.CONGEST_*) ──
// ADVISORY ONLY. Nothing inside this file reduces quality from it; it is
// computed so callers that still ask can display or log it.
// The counter's time-average is dominated by our own frame sawtooth, which
// says nothing about the link. Its MINIMUM over the last 8 mic ticks does:
// that is what the socket drains back down to between frames. > 6_000
// (≈140ms of audio) at the emptiest moment means the link never fully caught
// up; > 20_000 (≈460ms) means it is badly behind. Hysteresis down at 3_000
// (≈70ms) / 12_000 (≈275ms).
const CONGEST_UP_1 = 6_000;
const CONGEST_UP_2 = 20_000;
const CONGEST_DOWN_1 = 3_000;
const CONGEST_DOWN_2 = 12_000;
const TROUGH_RING = 8; // 8 mic ticks ≈ 680ms of history

/**
 * Mint the ephemeral token with two STAGGERED attempts inside one budget.
 * On a lossy mobile link a single lost SYN burns the entire ring window
 * (8s of retransmit backoff, then no live call at all); a second attempt
 * fired at 2.5s costs one request and wins the race outright when the
 * first one is stuck. First success wins — and the loser's in-flight fetch
 * is ABORTED, because /api/live-token hands out SINGLE-USE tokens: letting
 * the loser complete mints a second session credential nobody will ever
 * connect with. The stagger is also a ceiling, not a floor: if the first
 * attempt fails fast (refused, 5xx, DNS), the second starts immediately
 * instead of sleeping out 2.5s of an 8s budget on an already-dead request.
 */
// ── pre-minted token ────────────────────────────────────────────────────
// The mint is a full round trip to our server and on to Google. On a weak
// mobile link that is seconds, and it lands squarely on the call-start path
// where it becomes dead air. So it happens EARLY — while they are reading
// chat — and the call spends the cached token instead. Single-use: taking it
// clears it. The server issues a 9-minute start window; we keep a margin
// under that and fall back to a normal mint whenever the cache is cold.
const TOKEN_FRESH_MS = 7 * 60_000;
const PREWARM_RETRY_MS = 20_000; // a failing mint must not hammer the limiter
let pre: { token: string; model?: string; at: number } | null = null;
let preFlight: Promise<void> | null = null;
let preTried = 0;

/** Mint ahead of time (chat idle). Safe to call often — it self-throttles. */
export function prewarmLiveToken(base: string) {
  if (typeof fetch === "undefined") return;
  if (preFlight) return; // one in flight is enough
  if (pre && Date.now() - pre.at < TOKEN_FRESH_MS) return; // still good
  if (Date.now() - preTried < PREWARM_RETRY_MS) return; // backoff after a miss
  preTried = Date.now();
  preFlight = fetch(`${base}/api/live-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j?.token) pre = { token: j.token, model: j.model, at: Date.now() };
    })
    .catch(() => {})
    .finally(() => {
      preFlight = null;
    });
}

/** Take the pre-minted token if one is fresh. Single-use: this consumes it. */
function takePre() {
  if (pre && Date.now() - pre.at < TOKEN_FRESH_MS) {
    const t = pre;
    pre = null;
    return t;
  }
  pre = null;
  return null;
}

async function mintToken(base: string, budgetMs: number) {
  const t0 = Date.now();
  let won = false;
  const ctrls: AbortController[] = [];
  const attempt = async (gate?: Promise<void>) => {
    if (gate) {
      await gate;
      if (won) throw new Error("superseded"); // never mint a second token for nothing
    }
    const left = budgetMs - (Date.now() - t0);
    if (left <= 0) throw new Error("no live token");
    const ctrl = new AbortController();
    ctrls.push(ctrl);
    // one controller carries BOTH the remaining budget and the "the other
    // attempt won" abort, so a winner can always cancel the loser's request
    const budgetTimer = setTimeout(() => ctrl.abort(), left);
    try {
      const res = await fetch(`${base}/api/live-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("no live token");
      const j = await res.json();
      if (!j?.token) throw new Error("no live token");
      won = true;
      for (const c of ctrls) if (c !== ctrl) c.abort();
      return j as { token: string; model?: string };
    } finally {
      clearTimeout(budgetTimer);
    }
  };
  const first = attempt();
  // the second attempt starts at the stagger OR the moment the first gives
  // up, whichever comes first
  const gate = new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 2500);
    first.catch(() => {
      clearTimeout(t);
      resolve();
    });
  });
  try {
    return await Promise.any([first, attempt(gate)]);
  } catch {
    throw new Error("no live token"); // both attempts failed inside the budget
  }
}

export async function startLiveCall(opts: LiveCallOpts): Promise<LiveSession> {
  // 1. ephemeral token from our server (never the real key). A token minted
  // while they were in chat skips this round trip entirely; the next one is
  // minted in the background so the call after this is instant too.
  const tMint = Date.now();
  const warmed = takePre();
  const { token, model } = warmed ?? (await mintToken(opts.base, 8000));
  opts.onTiming?.({ mintMs: Date.now() - tMint, preminted: !!warmed });
  // refill for the NEXT call, but not now: a mint racing this session's own
  // handshake is exactly the contention this change exists to remove
  setTimeout(() => prewarmLiveToken(opts.base), 15_000);

  // 2. mic — echo cancellation on: she plays through the same phone's speaker
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  let ws: WebSocket | null = new WebSocket(`${WS_BASE}?access_token=${token}`);
  let dead = false;
  let muted = false;
  let ready = false;

  // ── uplink: mic → 16k PCM16 ──
  const inCtx = new AudioContext();
  const src = inCtx.createMediaStreamSource(stream);
  // ScriptProcessor still works everywhere (incl. Android WebView) and 4096
  // frames ≈ 85ms at 48k — fine granularity for realtime
  const proc = inCtx.createScriptProcessor(4096, 1, 1);
  const sink = inCtx.createGain();
  sink.gain.value = 0; // processor needs a destination; we never monitor the mic
  src.connect(proc);
  proc.connect(sink);
  sink.connect(inCtx.destination);
  attachAnalyser("you", inCtx, src); // presence UI reads YOUR real amplitude
  // ── adaptive noise gate: a fan/traffic hum must never read as "still
  // talking". Ambience is the sliding-window MINIMUM of the level (speech
  // always has inter-syllable dips that land in a 2.5s window), so the floor
  // converges on any room — loud or quiet — in ~2.5s, both directions. The
  // decision threshold is clamped to soft-speech level so it can never eat
  // the talker. A one-chunk pre-roll survives first syllables (the server's
  // prefixPadding only pads from RECEIVED audio, which pre-gate is silence).
  const chunkMs = (4096 / inCtx.sampleRate) * 1000; // actual, not assumed
  const winLen = Math.max(8, Math.round(2500 / chunkMs));
  const hangChunks = Math.max(2, Math.ceil(250 / chunkMs));
  const rmsWin: number[] = [];
  let gateLeft = 0;
  let prevPcm: Int16Array | null = null;
  let wasOpen = false;
  const endpointChunks = Math.ceil(SILENCE_ENDPOINT_MS / chunkMs);
  let gatedRun = 0; // consecutive gated (wordless) chunks
  proc.onaudioprocess = (e) => {
    if (dead || !ready || !ws || ws.readyState !== WebSocket.OPEN) return;
    const input = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    // the floor learns even while muted — the muted ring second is free room
    // calibration (web mute = "line not open yet", the audio is clean room)
    rmsWin.push(rms);
    if (rmsWin.length > winLen) rmsWin.shift();
    const noiseFloor = Math.min(0.04, Math.max(0.0015, Math.min(...rmsWin)));
    // ── the ONE buffered sample of this mic tick ──
    // Both readers (the advisory congestion trough and the silence-shed
    // decision) take this single value: the counter is sampled on the mic
    // clock and nowhere else, so the signal is evenly spaced and a tick that
    // happens to send twice (gate-open pre-roll) can't double-weight it.
    const buffered = ws.bufferedAmount;
    noteBuffered(buffered);
    if (muted) return;
    const thr = Math.min(Math.max(noiseFloor * 3, 0.01), 0.025);
    if (rms > thr) gateLeft = hangChunks;
    else if (gateLeft > 0) gateLeft--;
    const open = gateLeft > 0;
    if (open) gatedRun = 0;
    else gatedRun++;
    // WORDS ALWAYS GO. A chunk with the gate open is never dropped for
    // backpressure at any queue depth — only the stall backstop below can
    // stop it, and that means the socket is dead, not slow.
    //
    // A GATED chunk (no words in it) still sheds as soon as there is real
    // backlog: it costs nothing to lose and it is where the uplink is
    // actually recovered. The turn-ending pause is still untouchable (it is
    // what commits their turn) and the SILENCE_KEEP heartbeat still means the
    // stream never goes dark.
    const drop =
      !open &&
      buffered > SILENCE_CAP &&
      gatedRun > endpointChunks && // the turn-ending pause always goes
      gatedRun % SILENCE_KEEP !== 0; // and the stream never goes dark
    const ratio = inCtx.sampleRate / 16000;
    const outLen = Math.floor(input.length / ratio);
    const pcm = new Int16Array(outLen); // stays zeroed (silence) when gated
    if (open) {
      for (let i = 0; i < outLen; i++) {
        const s = input[Math.floor(i * ratio)];
        pcm[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
      }
      if (!wasOpen && prevPcm) {
        // closed→open: replay the previous chunk first so the syllable that
        // OPENED the gate arrives whole. Unconditional now — `drop` is false
        // by construction whenever the gate is open.
        sendPcm(prevPcm);
      }
    } else {
      // keep a real-audio pre-roll ready even while closed
      const p = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const s = input[Math.floor(i * ratio)];
        p[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
      }
      prevPcm = p;
    }
    wasOpen = open;
    if (open) prevPcm = null;
    if (!drop) sendPcm(pcm);
  };
  // ── uplink congestion, read from the TROUGHS of bufferedAmount ──
  // bufferedAmount is the browser's own count of bytes we handed the socket
  // that have not reached the network. Averaging it (an EMA) measures mostly
  // OUR OWN frame sawtooth: a 50KB frame every tier period gives a time
  // average near F²/2RT, so a perfectly healthy 2Mbps link reads "congested"
  // and the video tier oscillates for no reason. The MINIMUM across the last
  // TROUGH_RING mic ticks measures the link instead: if the socket drains a
  // frame before the next one is grabbed, the trough sits near 0 no matter
  // how big the bursts are; if it cannot, the troughs climb — and that is
  // congestion, by definition. Sampled ONLY on the mic clock (sendFrame must
  // never add a sample, or the signal becomes the sawtooth again).
  const troughRing = new Array<number>(TROUGH_RING).fill(0);
  let troughIdx = 0;
  let congestionLevel: 0 | 1 | 2 = 0;
  const noteBuffered = (buffered: number) => {
    troughRing[troughIdx] = buffered;
    troughIdx = (troughIdx + 1) % TROUGH_RING;
    let trough = troughRing[0];
    for (const v of troughRing) if (v < trough) trough = v;
    if (congestionLevel < 2 && trough > CONGEST_UP_2) congestionLevel = 2;
    else if (congestionLevel < 1 && trough > CONGEST_UP_1) congestionLevel = 1;
    else if (congestionLevel === 2 && trough < CONGEST_DOWN_2) congestionLevel = 1;
    else if (congestionLevel === 1 && trough < CONGEST_DOWN_1) congestionLevel = 0;
  };
  // pure sender: the sample and the shed decision both belong to the mic
  // tick, which is the only clock allowed to observe the socket.
  //
  // The one exception is the stall backstop, which lives HERE rather than in
  // the tick so that nothing — not a pre-roll replay, not a frame — can push
  // a dead socket past the ceiling. It is not a quality mechanism: on a link
  // that can carry the call it never fires, and when it does fire the call is
  // already gone. It only stops the queue turning into a nine-second delay
  // line that shouts stale speech at her when the socket wakes up.
  function sendPcm(pcm: Int16Array) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > STALL_CEILING) return;
    let bin = "";
    const bytes = new Uint8Array(pcm.buffer);
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    ws.send(
      JSON.stringify({
        realtimeInput: {
          audio: { data: btoa(bin), mimeType: "audio/pcm;rate=16000" },
        },
      }),
    );
  }

  // ── downlink: 24k PCM chunks → gapless WebAudio playback ──
  const outCtx = new AudioContext();
  // every chunk passes this bus, so the presence UI reads HER real amplitude
  const outBus = outCtx.createGain();
  attachAnalyser("her", outCtx, outBus);
  outBus.connect(outCtx.destination);
  let playhead = 0;
  let liveSources: AudioBufferSourceNode[] = [];
  let speakingUntil = 0;
  // ── fixed jitter lead ──
  // 30ms, always. This used to be an adaptive cushion that GREW to 320ms on a
  // jittery downlink to hide stutter, and that is a bad trade for this
  // product: it buys smoothness by making her answer up to 290ms later, on
  // exactly the calls that already feel slow, and it stays inflated for ten
  // more utterances after the jitter has passed. The whole point of this lane
  // is that she comes back fast; a scheduler that quietly adds a third of a
  // second is working against it.
  //
  // What we give up is stated plainly: on a genuinely jittery downlink her
  // voice will now STUTTER — a short gap mid-word when a chunk arrives after
  // the previous one has finished playing — instead of arriving late but
  // smooth. That is the deliberate call. Everything else about the scheduler
  // is unchanged: the playhead still anchors chunks back-to-back, so audio is
  // still gapless whenever the network delivers on time.
  const LEAD = 0.03;
  const playChunk = (b64: string) => {
    const raw = atob(b64);
    const n = raw.length / 2;
    if (!n) return;
    const buf = outCtx.createBuffer(1, n, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const lo = raw.charCodeAt(i * 2);
      const hi = raw.charCodeAt(i * 2 + 1);
      let v = (hi << 8) | lo;
      if (v >= 32768) v -= 65536;
      ch[i] = v / 32768;
    }
    const s = outCtx.createBufferSource();
    s.buffer = buf;
    s.connect(outBus);
    const now = outCtx.currentTime;
    // The playhead still anchors this chunk to the end of the last one, so a
    // stream that arrives on time plays gapless. If it arrived late the
    // playhead is already behind `now` and this chunk simply starts as soon
    // as it can — late, audibly, and without dragging every later reply.
    const at = Math.max(now + LEAD, playhead);
    s.start(at);
    playhead = at + buf.duration;
    speakingUntil = Math.max(speakingUntil, Date.now() + (playhead - outCtx.currentTime) * 1000);
    liveSources.push(s);
    s.onended = () => {
      liveSources = liveSources.filter((x) => x !== s);
    };
    opts.onState("speaking");
  };
  // Humans don't gate off mid-syllable when talked over — they trail off.
  // On barge-in her voice DISSOLVES over ~220ms, then the queue clears.
  const flushPlayback = () => {
    const doomed = liveSources;
    liveSources = [];
    playhead = 0;
    speakingUntil = 0;
    try {
      const t = outCtx.currentTime;
      outBus.gain.cancelScheduledValues(t);
      outBus.gain.setValueAtTime(outBus.gain.value, t);
      outBus.gain.linearRampToValueAtTime(0.0001, t + 0.22);
      setTimeout(() => {
        for (const s of doomed) {
          try {
            s.stop();
          } catch {
            /* already done */
          }
        }
        try {
          const t2 = outCtx.currentTime;
          outBus.gain.cancelScheduledValues(t2);
          outBus.gain.setValueAtTime(1, t2); // ready for her next turn
        } catch {
          /* ctx closed */
        }
      }, 240);
    } catch {
      for (const s of doomed) {
        try {
          s.stop();
        } catch {
          /* already done */
        }
      }
    }
    opts.onState("listening");
  };
  // she's "listening" again once the queued audio drains
  const stateTick = setInterval(() => {
    if (dead) return;
    if (speakingUntil && Date.now() > speakingUntil) {
      speakingUntil = 0;
      opts.onState("listening");
    }
  }, 250);

  // ── transcripts: accumulate per turn, flush on turnComplete ──
  let myBuf = "";
  let herBuf = "";
  const flushTexts = () => {
    if (myBuf.trim()) opts.onMyText(myBuf.trim());
    if (herBuf.trim()) opts.onHerText(herBuf.trim());
    myBuf = "";
    herBuf = "";
  };

  const teardown = (reason: "failed" | "closed") => {
    if (dead) return;
    dead = true;
    clearInterval(stateTick);
    flushTexts();
    try {
      proc.disconnect();
      src.disconnect();
    } catch {
      /* already gone */
    }
    stream.getTracks().forEach((t) => t.stop());
    detachAnalyser("her");
    detachAnalyser("you");
    inCtx.close().catch(() => {});
    outCtx.close().catch(() => {});
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    ws = null;
    // pre-setup failures surface as the startLiveCall rejection — notifying
    // onEnded too would make the caller run its mid-call takeover logic for
    // a session it never adopted
    if (ready) opts.onEnded(reason);
  };

  const opened = new Promise<void>((resolve, reject) => {
    if (!ws) return reject(new Error("no ws"));
    const failTimer = setTimeout(() => reject(new Error("live setup timeout")), 10_000);
    ws.onopen = () => {
      ws!.send(
        JSON.stringify({
          setup: {
            model,
            generationConfig: {
              responseModalities: ["AUDIO"],
              // she must SPEAK, not deliberate — thinking added seconds of
              // dead air before every reply (measured 3-5.5s vs ~0.9s)
              thinkingConfig: { thinkingBudget: 0 },
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
                languageCode: "hi-IN",
              },
            },
            systemInstruction: { parts: [{ text: opts.system }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                // default start sensitivity: HIGH made her stop dead for every
                // breath and "hmm" — a human keeps talking through those. Real
                // sustained speech still interrupts her (now with a dissolve).
                //
                // end HIGH: commit their turn from the SPEECH being complete,
                // not from the room going quiet — background noise was making
                // her wait forever ("how are you?" ...silence... while traffic
                // hums). If she ever jumps in early, they just talk over her —
                // human conversation self-corrects in that direction.
                endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
                // the client gate already spends ~250ms of hangover after the
                // words stop; the server silence budget comes down to match so
                // total commit stays ~550ms
                silenceDurationMs: 300,
                prefixPaddingMs: 60,
              },
            },
            contextWindowCompression: { slidingWindow: {} },
          },
        }),
      );
    };
    ws.onmessage = async (ev) => {
      let text: string;
      if (typeof ev.data === "string") text = ev.data;
      else if (ev.data instanceof Blob) text = await ev.data.text();
      else text = new TextDecoder().decode(ev.data as ArrayBuffer);
      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.setupComplete) {
        ready = true;
        clearTimeout(failTimer);
        opts.onTiming?.({ readyMs: Date.now() - tMint });
        resolve();
        opts.onState("listening");
        return;
      }
      const sc = msg.serverContent;
      if (!sc) return;
      if (sc.interrupted) {
        // user talked over her — kill local audio NOW (server already stopped)
        flushPlayback();
      }
      for (const p of sc.modelTurn?.parts ?? []) {
        if (p.inlineData?.data) playChunk(p.inlineData.data);
      }
      if (sc.inputTranscription?.text) myBuf += sc.inputTranscription.text;
      if (sc.outputTranscription?.text) herBuf += sc.outputTranscription.text;
      if (sc.turnComplete) flushTexts();
    };
    ws.onerror = () => {
      clearTimeout(failTimer);
      reject(new Error("live ws error"));
    };
    ws.onclose = () => {
      clearTimeout(failTimer);
      if (!ready) reject(new Error("live ws closed early"));
      else teardown("closed");
    };
  });

  try {
    await opened;
  } catch (e) {
    teardown("failed");
    throw e;
  }

  return {
    stop: () => teardown("closed"),
    setMuted: (m: boolean) => {
      muted = m;
    },
    direct: (contextNote: string) => {
      if (dead || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: "user", parts: [{ text: contextNote }] }],
            turnComplete: true,
          },
        }),
      );
    },
    sendFrame: (b64Jpeg: string) => {
      if (dead || !ready || !ws || ws.readyState !== WebSocket.OPEN) return false;
      // NOT sampled into the congestion signal: the reading we would take
      // here is the sawtooth we ourselves are about to create.
      //
      // A frame is no longer refused for backlog. It used to need a
      // near-drained socket, which meant that on the exact link where screen
      // share matters she stopped receiving frames, went blind, and then went
      // quiet — and being blind reads as lag just as much as being slow does.
      // Only two things can refuse a frame now: a pathological encode, and
      // the stall backstop (a socket that has taken nothing for ~9s).
      if (b64Jpeg.length > FRAME_MAX_B64) return false; // pathological encode
      if (ws.bufferedAmount > STALL_CEILING) return false; // socket is dead, not slow
      ws.send(
        JSON.stringify({
          realtimeInput: { video: { data: b64Jpeg, mimeType: "image/jpeg" } },
        }),
      );
      return true;
    },
    congestion: () => congestionLevel,
    active: () => !dead,
  };
}
