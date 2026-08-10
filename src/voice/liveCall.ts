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
  /** Stream a screen frame (base64 JPEG) — realtime co-watching. */
  sendFrame: (b64Jpeg: string) => void;
  /**
   * Smoothed uplink pressure: 0 clear, 1 moderate, 2 heavy. Callers shed
   * VIDEO against this (rate/quality) — never audio.
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
}

// ── uplink backpressure thresholds (ws.bufferedAmount, bytes) ──
// 16k PCM16 base64 runs ~43KB/s, so 48KB of unsent socket buffer is already
// ~1s of mic audio the server hasn't heard. Past that, DROPPING a chunk is
// strictly better than queueing it: a hole in the uplink costs one syllable
// (the VAD rides it out), a queue costs an ever-growing delay on every word
// after it. Frames get a third of that budget so a screen frame can NEVER
// sit in front of her hearing you.
const UPLINK_AUDIO_MAX = 48_000;
const UPLINK_FRAME_MAX = 16_000;
// congestion levels off the smoothed reading (hysteresis so a single frame
// in flight doesn't flap the video tier)
const CONGEST_UP_1 = 8_000;
const CONGEST_UP_2 = 32_000;
const CONGEST_DOWN_1 = 5_000;
const CONGEST_DOWN_2 = 24_000;

/**
 * Mint the ephemeral token with two STAGGERED attempts inside one budget.
 * On a lossy mobile link a single lost SYN burns the entire ring window
 * (8s of retransmit backoff, then no live call at all); a second attempt
 * fired at 2.5s costs one request and wins the race outright when the
 * first one is stuck. First success wins — the loser is abandoned.
 */
async function mintToken(base: string, budgetMs: number) {
  let won = false;
  const attempt = async (delayMs: number) => {
    if (delayMs) {
      await new Promise((r) => setTimeout(r, delayMs));
      if (won) throw new Error("superseded"); // never mint a second token for nothing
    }
    const res = await fetch(`${base}/api/live-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(budgetMs - delayMs),
    });
    if (!res.ok) throw new Error("no live token");
    const j = await res.json();
    if (!j?.token) throw new Error("no live token");
    won = true;
    return j as { token: string; model?: string };
  };
  try {
    return await Promise.any([attempt(0), attempt(2500)]);
  } catch {
    throw new Error("no live token"); // both attempts failed inside the budget
  }
}

export async function startLiveCall(opts: LiveCallOpts): Promise<LiveSession> {
  // 1. ephemeral token from our server (never the real key)
  const { token, model } = await mintToken(opts.base, 8000);

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
    if (muted) return;
    const thr = Math.min(Math.max(noiseFloor * 3, 0.01), 0.025);
    if (rms > thr) gateLeft = hangChunks;
    else if (gateLeft > 0) gateLeft--;
    const open = gateLeft > 0;
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
    sendPcm(pcm);
  };
  // ── uplink congestion: bufferedAmount is the browser's own count of bytes
  // we handed the socket that have not reached the network. It only grows
  // when the uplink can't keep up, so a smoothed reading IS the congestion
  // signal — no probing, no extra traffic. Sampled on the mic clock (~85ms)
  // and on every frame attempt.
  let bufEma = 0;
  let congestionLevel: 0 | 1 | 2 = 0;
  const noteBuffered = (buffered: number) => {
    bufEma = bufEma * 0.8 + buffered * 0.2;
    if (congestionLevel < 2 && bufEma > CONGEST_UP_2) congestionLevel = 2;
    else if (congestionLevel < 1 && bufEma > CONGEST_UP_1) congestionLevel = 1;
    else if (congestionLevel === 2 && bufEma < CONGEST_DOWN_2) congestionLevel = 1;
    else if (congestionLevel === 1 && bufEma < CONGEST_DOWN_1) congestionLevel = 0;
  };
  function sendPcm(pcm: Int16Array) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const buffered = ws.bufferedAmount;
    noteBuffered(buffered);
    // the uplink is behind: skip this chunk rather than deepen the queue
    if (buffered > UPLINK_AUDIO_MAX) return;
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
  // per utterance that ran dry (to 240ms) and decays 10ms per clean
  // utterance back to 40ms. A slightly higher constant delay is
  // imperceptible in conversation; a gap in the middle of a word is not.
  const LEAD_MIN = 0.04;
  const LEAD_MAX = 0.24;
  const LEAD_GROW = 0.04;
  const LEAD_DECAY = 0.01;
  // a silence longer than this is her turn ENDING, not the stream starving
  const UTTERANCE_GAP = 0.5;
  let lead = LEAD_MIN;
  let ranDry = false; // this utterance already bought its cushion
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
    if (!playhead || now - playhead > UTTERANCE_GAP) {
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
      if (dead || !ready || !ws || ws.readyState !== WebSocket.OPEN) return;
      const buffered = ws.bufferedAmount;
      noteBuffered(buffered);
      // hard rule: a screen frame never queues in front of her hearing you
      if (buffered > UPLINK_FRAME_MAX) return;
      ws.send(
        JSON.stringify({
          realtimeInput: { video: { data: b64Jpeg, mimeType: "image/jpeg" } },
        }),
      );
    },
    congestion: () => congestionLevel,
    active: () => !dead,
  };
}
