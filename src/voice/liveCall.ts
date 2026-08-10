// Gemini Live realtime call engine — true speech-to-speech. The mic streams
// 16kHz PCM up a WebSocket; her voice streams back as 24kHz PCM chunks that
// play with ~zero buffering; barge-in is server-side (an `interrupted` signal
// flushes local playback instantly). Auth is a single-use ephemeral token
// minted by /api/live-token — the Google key never reaches this code.
//
// The cascade engine (STT→LLM→TTS) remains the fallback: startLiveCall
// rejects or calls onEnded("failed"), and the caller falls back seamlessly.

const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export interface LiveSession {
  stop: () => void;
  setMuted: (m: boolean) => void;
  /** Speak an invisible directive (e.g. the pickup greeting trigger). */
  direct: (contextNote: string) => void;
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

export async function startLiveCall(opts: LiveCallOpts): Promise<LiveSession> {
  // 1. ephemeral token from our server (never the real key)
  const tokRes = await fetch(`${opts.base}/api/live-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(8000),
  });
  if (!tokRes.ok) throw new Error("no live token");
  const { token, model } = await tokRes.json();
  if (!token) throw new Error("no live token");

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
  proc.onaudioprocess = (e) => {
    if (dead || !ready || muted || !ws || ws.readyState !== WebSocket.OPEN) return;
    const input = e.inputBuffer.getChannelData(0);
    const ratio = inCtx.sampleRate / 16000;
    const outLen = Math.floor(input.length / ratio);
    const pcm = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const s = input[Math.floor(i * ratio)];
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    }
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
  };

  // ── downlink: 24k PCM chunks → gapless WebAudio playback ──
  const outCtx = new AudioContext();
  let playhead = 0;
  let liveSources: AudioBufferSourceNode[] = [];
  let speakingUntil = 0;
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
    s.connect(outCtx.destination);
    const at = Math.max(outCtx.currentTime + 0.03, playhead);
    s.start(at);
    playhead = at + buf.duration;
    speakingUntil = Math.max(speakingUntil, Date.now() + (playhead - outCtx.currentTime) * 1000);
    liveSources.push(s);
    s.onended = () => {
      liveSources = liveSources.filter((x) => x !== s);
    };
    opts.onState("speaking");
  };
  const flushPlayback = () => {
    for (const s of liveSources) {
      try {
        s.stop();
      } catch {
        /* already done */
      }
    }
    liveSources = [];
    playhead = 0;
    speakingUntil = 0;
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
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
                languageCode: "hi-IN",
              },
            },
            systemInstruction: { parts: [{ text: opts.system }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: { silenceDurationMs: 500 },
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
    active: () => !dead,
  };
}
