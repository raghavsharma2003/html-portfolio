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

// ── uplink backpressure thresholds (ws.bufferedAmount, bytes) ──
// bufferedAmount is ONE counter for audio AND video, so every threshold here
// is stated in "seconds of mic audio". 16k PCM16 as base64+JSON runs
// ~43.5KB/s (a 4096-frame tick = 85ms = 2730 PCM bytes -> 3640 base64 chars
// + ~60 bytes of JSON ≈ 3.7KB per 85ms).
//
// 48_000 / 43_500 ≈ 1.10s of mic audio already waiting.
const AUDIO_CAP = 48_000;
// ...but being over the cap for an INSTANT is not a stall: one 50KB frame
// alone exceeds it, and on any link that can carry the call at all it drains
// in 100-300ms — a delay the receiver's own buffer absorbs, where a dropped
// chunk is a hole in what she hears. So speech is shed only when the counter
// has stayed above the cap CONTINUOUSLY for this long, i.e. the uplink is
// genuinely not draining (600ms ≈ 7 mic ticks).
const AUDIO_SUSTAIN_MS = 600;
// Silence is different: a gated chunk carries no words, only VAD continuity,
// so it sheds at the first sign of backlog. 8_000 / 43_500 ≈ 185ms of audio
// backlog (~2 mic ticks). ~60-70% of a call is gated, so this alone frees
// most of the uplink before a single syllable is ever at risk.
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
// A frame may only enter a NEAR-DRAINED socket: same 8_000 ≈ 185ms. If the
// queue has not come back down to ~2 mic ticks since the last frame, the
// link cannot carry frames at this rate and the tier logic will slow them.
const FRAME_GATE = 8_000;
// A pathological encode (~90KB of JPEG) would be ~2.8s of uplink on its own.
const FRAME_MAX_B64 = 120_000;
// ── congestion, measured at the TROUGHS (identical numbers on Android —
// see LiveWatchEngine.CONGEST_*) ──
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
    // Everything downstream (congestion trough, the over-cap stopwatch, the
    // drop decision) reads this single value: the counter is sampled on the
    // mic clock and nowhere else, so the signal is evenly spaced and a tick
    // that happens to send twice (gate-open pre-roll) can't double-weight it.
    const buffered = ws.bufferedAmount;
    noteBuffered(buffered);
    if (buffered > AUDIO_CAP) {
      if (!overSince) overSince = performance.now();
    } else {
      overSince = 0; // drained back under the cap — the stall clock restarts
    }
    if (muted) return;
    const thr = Math.min(Math.max(noiseFloor * 3, 0.01), 0.025);
    if (rms > thr) gateLeft = hangChunks;
    else if (gateLeft > 0) gateLeft--;
    const open = gateLeft > 0;
    if (open) gatedRun = 0;
    else gatedRun++;
    // VOICE FIRST, and silence first of all. A SPEECH chunk is dropped only
    // once the socket has been over the cap for AUDIO_SUSTAIN_MS without
    // relief — a transient frame burst never costs a syllable, it only
    // delays it. A GATED chunk (no words in it) goes as soon as there is any
    // real backlog, which is where the uplink is actually recovered.
    const drop = open
      ? overSince !== 0 && performance.now() - overSince >= AUDIO_SUSTAIN_MS
      : buffered > SILENCE_CAP &&
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
      if (!wasOpen && prevPcm && !drop) {
        // closed→open: replay the previous chunk first so the syllable that
        // OPENED the gate arrives whole
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
  // set on the mic clock when the counter first goes over AUDIO_CAP, cleared
  // the moment it comes back under: only the mic tick touches it
  let overSince = 0;
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
  // pure sender: the sample and the drop decision both belong to the mic
  // tick, which is the only clock allowed to observe the socket
  function sendPcm(pcm: Int16Array) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
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
  // ── adaptive jitter cushion ──
  // A fixed 30ms lead assumes chunks always arrive before the previous one
  // finishes. On a jittery mobile downlink they don't: the buffer runs dry
  // mid-word and her voice STUTTERS. So the lead is earned: it grows 40ms
  // per utterance that ran dry (to 320ms) and decays 20ms per clean
  // utterance back to 30ms. A slightly higher constant delay is
  // imperceptible in conversation; a gap in the middle of a word is not.
  // LEAD_MIN is the pre-backpressure floor exactly: on a good network the
  // cushion never grows, so latency is identical to the old code.
  // LEAD_MAX covers the ~300ms arrival spikes this mechanism exists for
  // (a 240ms ceiling could not absorb the very jitter it was sized against).
  // At 20ms per clean utterance, a fully-grown cushion unwinds in ~10 clean
  // utterances rather than dragging 20 of them.
  const LEAD_MIN = 0.03;
  const LEAD_MAX = 0.32;
  const LEAD_GROW = 0.04;
  const LEAD_DECAY = 0.02;
  // a silence longer than this is her turn ENDING, not the stream starving
  const UTTERANCE_GAP = 0.5;
  let lead = LEAD_MIN;
  let ranDry = false; // this utterance already bought its cushion
  let heardThisTurn = false; // any audio in the current turn (silent turns don't score)
  // turnComplete arrived: the next chunk begins a NEW utterance, so the gap
  // in front of it is her generating, never our downlink starving
  let turnEnded = false;
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
    heardThisTurn = true;
    if (turnEnded) {
      // first chunk after a turn boundary. turnComplete already banked the
      // verdict for the utterance that ended, and the pause in front of this
      // chunk is HER (thinking/generating), not the network — scoring it as
      // an underrun is what made the cushion ratchet up on healthy links.
      // This is "playhead → 0" for the SCORING only: the playhead itself is
      // kept as the scheduling anchor, because her previous turn's audio can
      // still be queued ahead of outCtx.currentTime and must not be overlapped.
      turnEnded = false;
      ranDry = false;
    } else if (!playhead || now - playhead > UTTERANCE_GAP) {
      // fresh utterance: bank the verdict on the one that just ended
      if (playhead && !ranDry) lead = Math.max(LEAD_MIN, lead - LEAD_DECAY);
      ranDry = false;
    } else if (playhead < now && !ranDry) {
      // this chunk arrived AFTER the queue emptied — she stuttered mid-word.
      // Buy cushion now; one grow per utterance keeps it from ratcheting.
      ranDry = true;
      lead = Math.min(LEAD_MAX, lead + LEAD_GROW);
    }
    const at = Math.max(now + lead, playhead);
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
    // an utterance we CUT never gets scored either way
    ranDry = false;
    turnEnded = false;
    heardThisTurn = false;
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
      if (sc.turnComplete) {
        flushTexts();
        // her turn is over: settle the cushion for the utterance that just
        // played (a turn that ran clean earns one decay step), then mark the
        // boundary so the pause before her NEXT turn is never scored as a
        // network underrun. A turn with no audio at all scores nothing.
        if (heardThisTurn && !ranDry) lead = Math.max(LEAD_MIN, lead - LEAD_DECAY);
        ranDry = false;
        heardThisTurn = false;
        turnEnded = true;
      }
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
      // Hard rule: a screen frame only enters a near-drained socket, so it
      // can never queue in front of her hearing you.
      if (ws.bufferedAmount > FRAME_GATE) return false;
      if (b64Jpeg.length > FRAME_MAX_B64) return false; // pathological encode
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
