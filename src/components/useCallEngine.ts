// Conversation engine for voice calls: she greets you, listens continuously
// (hands-free STT with a mute toggle; typed fallback where STT is missing),
// thinks, and speaks back.
//
// Realism contract: nothing said on a call appears as chat bubbles. Call
// turns are stored with channel:"call" — hidden from the chat UI but fed to
// the brain, so she remembers call conversations perfectly. The chat shows
// only a "📞 Voice call · m:ss" record when the call ends.

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { AppState, Message } from "../state/store";
import { uid } from "../state/store";
import { think } from "../engine/brain";
import {
  speakCall,
  createStreamSpeaker,
  type StreamSpeaker,
  stopSpeaking,
  listen,
  prefetchBackchannels,
  playAck,
  playBackchannel,
  playPickup,
  prewarmSpeech,
  getSttMode,
  playThinkingFiller,
  startRoomTone,
  stopRoomTone,
  duckSpeech,
} from "../voice/speech";
import {
  CALL_OPEN_DIRECTIVE,
  WATCH_COMMENT_DIRECTIVE,
  WATCH_MODE_NOTE,
  buildSystemPromptParts,
  buildSpeechStyle,
  type VoiceEngine,
} from "../engine/persona";
import { logTurns, rememberFrom, recallMemories } from "../engine/memory";
import { ensureOverlay, startWatch, watchAvailable, type WatchSession } from "../native/watch";
import { startLiveCall, type LiveSession } from "../voice/liveCall";
import { track } from "../engine/account";

export type CallPhase = "connecting" | "live" | "ended";

export function useCallEngine(
  state: AppState,
  setState: React.Dispatch<React.SetStateAction<AppState>>,
) {
  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [muted, setMuted] = useState(false);
  // watch-together: she sees their screen while staying on the call
  const [watching, setWatching] = useState(false);
  const [frameAt, setFrameAt] = useState(0); // UI proof that frames flow
  const watchSession = useRef<WatchSession | null>(null);
  const frameRef = useRef<{ url: string; at: number } | null>(null);
  const lastCommentAt = useRef(0);
  const firstFrameSeen = useRef(false);
  const [heard, setHeard] = useState("");
  const [sttSupported, setSttSupported] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const stopListen = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  // THE live state. The tick interval, recognizer callbacks and re-arm chain
  // all capture their first-render closure — reading `state` directly in
  // them would freeze her memory at call start (she'd forget everything said
  // DURING the call). Every callback reads stateRef.current instead.
  const stateRef = useRef(state);
  stateRef.current = state;
  // long-term graph memory, prefetched once at pickup (per-turn recall would
  // add latency to every spoken reply)
  const recallRef = useRef("");
  // consecutive instant recognizer failures — backoff instead of hot-looping
  const srFails = useRef(0);
  const srStartedAt = useRef(0);
  const speakingRef = useRef(false);
  const mutedRef = useRef(false);
  const elapsedRef = useRef(0);
  const listeningRef = useRef(false);
  const herWordsRef = useRef<Set<string>>(new Set()); // echo rejection
  const herSpokeUntil = useRef(0); // tail-end echo guard after she stops
  const thinkingRef = useRef(false);
  // adaptive endpointing (web SR): we decide when the user's turn is over,
  // not the recognizer — LiveKit/pipecat-style, regex instead of a model
  const acc = useRef({ finals: "", interim: "", lastAt: 0 });
  const ducked = useRef(false);
  const interrupted = useRef(false);
  // turn sequencing: if they resume speaking while she's still THINKING
  // (hasn't spoken yet), the in-flight reply is stale — discard it and let
  // the fresh, fuller utterance drive a new one. This is how humans handle
  // "wait, and also—": the listener re-plans instead of talking over you.
  const turnSeq = useRef(0);
  const lastHeardAt = useRef(0);
  const listenerBcAt = useRef(0); // last mid-turn listener backchannel
  const sttConsume = useRef<(() => void) | null>(null);
  // speculative turn: the brain starts on the partial ~240ms into a pause —
  // if the pause becomes the turn end (it usually does), the reply is already
  // hundreds of ms ahead; if they kept talking, one cheap call is discarded
  const spec = useRef<SpecTurn | null>(null);
  interface SpecTurn {
    text: string;
    promise: ReturnType<typeof think>;
    deltas: string[];
    sink: ((d: string) => void) | null;
  }
  const reengageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlapStart = useRef(0); // when user speech over her speech began
  const reengaged = useRef(0); // continuation nudges this silence stretch

  const log = (m: Message) => {
    setState((s) => ({ ...s, messages: [...s.messages, m] }));
    if (m.kind !== "callmark") logTurns(stateRef.current.deviceId, [m]);
  };

  const mergeLearned = (learned?: Record<string, string>) => {
    if (!learned || !Object.keys(learned).length) return;
    setState((s) => ({
      ...s,
      user: { ...s.user, facts: { ...s.user.facts, ...learned } },
    }));
  };

  const voiceOpts = {
    elevenKey: state.elevenKey,
    elevenVoiceId: state.elevenVoiceId,
    sarvamKey: state.sarvamKey,
    deviceVoice: state.deviceVoice,
  };
  // Hosted Gemini voice is the zero-config default — device TTS is only ever
  // a network-failure fallback inside speak() itself.
  const engine: VoiceEngine = state.sarvamKey
    ? "sarvam"
    : state.elevenKey
      ? "eleven"
      : "gemini";

  const brainKeys = () => ({
    openrouterKey: stateRef.current.openrouterKey,
    openrouterModel: stateRef.current.openrouterModel,
    apiKey: stateRef.current.apiKey,
    deviceId: stateRef.current.deviceId,
  });

  // ── realtime engine (Gemini Live, speech-to-speech): near-zero latency,
  // server-side barge-in. The cascade below stays as the seamless fallback —
  // at call start when live can't connect, and mid-call if the session drops.
  const liveSession = useRef<LiveSession | null>(null);
  const liveStopping = useRef(false); // deliberate stop — not a mid-call drop
  const LIVE_BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

  async function tryStartLive(): Promise<LiveSession | null> {
    if (typeof WebSocket === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
    const parts = buildSystemPromptParts(stateRef.current.user, stateRef.current.messages.length, "voice");
    const system =
      parts.core +
      buildSpeechStyle("live") +
      parts.tail +
      (recallRef.current
        ? `\n\nWHAT YOU KNOW ABOUT THEM (true memories — answer confidently):\n${recallRef.current}`
        : "");
    let self: LiveSession | null = null;
    const s = await startLiveCall({
      base: LIVE_BASE,
      system,
      onState: (st) => {
        if (!alive.current) return;
        const speaking = st === "speaking";
        speakingRef.current = speaking;
        setSpeaking(speaking);
        listeningRef.current = true; // live mic is always hot
        setListening(true);
      },
      onMyText: (t) => {
        lastHeardAt.current = Date.now();
        log({ id: uid(), from: "me", kind: "text", channel: "call", text: t, at: Date.now() });
      },
      onHerText: (t) =>
        log({ id: uid(), from: "her", kind: "text", channel: "call", text: t, at: Date.now() }),
      onEnded: (reason) => {
        if (liveSession.current === self) liveSession.current = null;
        if (liveStopping.current || !alive.current) return;
        // dropped mid-call (network blip, session cap) — cascade takes over
        // so the call never dies; she just keeps talking the slower way
        track(stateRef.current.deviceId, "live_call_dropped", { reason });
        speakingRef.current = false;
        setSpeaking(false);
        listeningRef.current = false;
        setListening(false);
        startListening();
        armReengage();
      },
    });
    self = s;
    if (!alive.current) {
      liveStopping.current = true;
      s.stop();
      liveStopping.current = false;
      return null;
    }
    liveSession.current = s;
    listeningRef.current = true;
    setListening(true);
    s.direct(CALL_OPEN_DIRECTIVE()); // she improvises her pickup, spoken live
    return s;
  }

  // connect + greet
  useEffect(() => {
    alive.current = true;
    prefetchBackchannels(voiceOpts); // instant "hmm?" clips for turn-taking
    // long-term memory for the whole call, fetched while the phone "rings"
    const recent = state.messages
      .filter((m) => m.from === "me")
      .slice(-4)
      .map((m) => m.text)
      .join(" ");
    recallMemories(state.deviceId, recent).then((m) => {
      recallRef.current = m || "";
    });
    // she improvises her own phone pickup — nothing scripted. The brain call
    // starts NOW, in parallel with the "ringing" beat, so pickup is instant.
    const greetPromise = think(
      state.user,
      brainKeys(),
      state.messages,
      CALL_OPEN_DIRECTIVE(),
      "call",
      engine,
      true,
    );
    // the moment the greet TEXT exists, its first clip starts synthesizing —
    // the TTS fetch (the slowest step) overlaps the ring instead of running
    // after it, which was the 2-3s of dead air at pickup
    greetPromise.then((r) => {
      if (!alive.current) return;
      const g = r.bubbles.join(" ").trim();
      if (g) prewarmSpeech(g, voiceOpts, r.tone);
    });
    let pickupT: ReturnType<typeof setTimeout> | null = null;
    const t = setTimeout(async () => {
      if (!alive.current) return;
      setPhase("live");
      startRoomTone(); // real lines are never digitally silent
      // ── realtime engine first: true speech-to-speech (Gemini Live). If it
      // doesn't come up within ~3.5s, the cascade takes the call — and if
      // the live session then arrives late, it's discarded, not adopted. ──
      const livePromise = tryStartLive().catch(() => null);
      const winner = await Promise.race([
        livePromise,
        new Promise<"slow">((r) => setTimeout(() => r("slow"), 3500)),
      ]);
      if (!alive.current) return;
      if (winner && winner !== "slow") {
        track(stateRef.current.deviceId, "live_call_started", {});
        return; // realtime session owns the call from here
      }
      livePromise.then((s) => {
        // late arrival after the cascade already started talking — discard
        if (s && liveSession.current !== s) {
          liveStopping.current = true;
          s.stop();
          liveStopping.current = false;
        }
      });
      if (winner === "slow") track(stateRef.current.deviceId, "live_call_slow", {});
      // ── cascade fallback: prewarmed greet + instant pickup filler ──
      pickupT = setTimeout(() => {
        if (alive.current && !speakingRef.current) playPickup();
      }, 600);
      const reply = await greetPromise;
      if (!alive.current || liveSession.current) return;
      const greet = reply.bubbles.join(" ").trim() || "hello?";
      log({
        id: uid(),
        from: "her",
        kind: "text",
        channel: "call",
        text: greet.replace(/\[[a-z ]+\]/gi, "").trim(),
        at: Date.now(),
      });
      sayAloud(greet, reply.tone);
    }, 1100 + Math.random() * 300);
    return () => {
      alive.current = false;
      clearTimeout(t);
      if (pickupT) clearTimeout(pickupT);
      if (liveSession.current) {
        liveStopping.current = true;
        liveSession.current.stop();
        liveSession.current = null;
        liveStopping.current = false;
      }
      // the call UI can close by ANY route (back gesture, navigation) — the
      // screen share must NEVER outlive the call
      stopWatchMode();
      stopSpeaking();
      stopRoomTone();
      stopListen.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // call timer
  useEffect(() => {
    if (phase !== "live") return;
    const iv = setInterval(
      () =>
        setElapsed((e) => {
          elapsedRef.current = e + 1;
          return e + 1;
        }),
      1000,
    );
    return () => clearInterval(iv);
  }, [phase]);

  function sayAloud(text: string, tone?: string) {
    herWordsRef.current = new Set(
      text.toLowerCase().replace(/[^a-z\u0900-\u097F ]/gi, " ").split(/\s+/).filter(Boolean),
    );
    speakCall(
      text,
      () => {
        speakingRef.current = true;
        setSpeaking(true);
        // keep the mic hot WHILE she talks so you can interrupt her
        if (alive.current) startListening();
      },
      () => {
        speakingRef.current = false;
        setSpeaking(false);
        herSpokeUntil.current = Date.now();
        if (ducked.current) {
          duckSpeech(false); // a soft-duck must never outlive the utterance
          ducked.current = false;
        }
        if (alive.current) {
          startListening();
          armReengage(); // if they stay quiet ~8s, one soft "hmm?"
        }
      },
      voiceOpts,
      tone,
    );
  }

  // is this the user actually talking over her, or just an "hmm"/her own
  // voice leaking into the mic? Backchannels and echo must NOT stop her.
  function isRealInterruption(text: string): boolean {
    const t = text.toLowerCase().trim();
    if (t.length < 10) return false;
    if (/^(h+m+|haa*n|ha|acha+|ok+a*y*|right|yeah|sahi|thik h?a*i?)( |$)+$/.test(t)) return false;
    const words = t.replace(/[^a-z\u0900-\u097F ]/gi, " ").split(/\s+/).filter(Boolean);
    if (!words.length) return false;
    const overlap = words.filter((w) => herWordsRef.current.has(w)).length / words.length;
    return overlap < 0.6; // mostly her own words = speaker echo, ignore
  }

  // continuation cues hold the turn open — the poor man's end-of-utterance
  // model (covers most of what LiveKit's transformer buys)
  const CONTINUATION =
    /(\b(and|but|so|or|um|uh|like|because|then|aur|toh|to|lekin|par|matlab|kyunki|na|woh|wo|i mean)\s*)$/i;
  const SHORT_COMPLETE =
    /^(haa*n|nahi+|nope|yes|yeah|no|ok+a*y*|hmm+|thik h?a*i?|pata nahi|i don'?t know|kuch nahi|bilkul|sahi)$/i;

  // STT gives no punctuation, so question shape is detected textually — the
  // turns where lag hurts most get the fastest commit
  const QUESTION_SHAPE =
    /^(kya|kyu|kyun|kaise|kaisa|kaisi|kab|kaha|kahan|kaun|kitna|kitni|what|why|how|where|when|who|which|can|do|did|are|is|will|should)\b|\b(kya|na|right|kya)$/i;

  function commitDelay(t: string): number {
    const trimmed = t.trim().toLowerCase();
    if (SHORT_COMPLETE.test(trimmed) || QUESTION_SHAPE.test(trimmed)) return 380;
    if (CONTINUATION.test(trimmed)) return 1800;
    return 450; // resume-while-thinking absorbs the rare early commit
  }

  // 75ms endpointing tick (web SR only — native STT endpoints itself)
  useEffect(() => {
    const iv = setInterval(() => {
      // web SR and the beep-free continuous native mic both stream interims
      // and rely on this tick to decide when the turn ended; the legacy
      // native loop self-endpoints and delivers finals directly
      if (Capacitor.isNativePlatform() && getSttMode() !== "callmic") return;
      const a = acc.current;
      const text = (a.finals + " " + a.interim).trim();
      if (!text || !a.lastAt || speakingRef.current) return;
      const waited = Date.now() - a.lastAt;
      // real listeners backchannel DURING your story, at your breath pauses —
      // if they're mid-thought (continuation shape / long turn) a soft
      // "hmm/haan" overlaps their pause, capped to once per ~10s
      if (
        waited >= 320 &&
        waited < 480 &&
        text.length > 50 &&
        Date.now() - listenerBcAt.current > 18_000 &&
        !thinkingRef.current
      ) {
        listenerBcAt.current = Date.now();
        playBackchannel();
      }
      // speculative start: one head-start per pause window, only when she's
      // idle. A wrong guess costs one flash-priced call; a right one cuts
      // 200-400ms off every reply.
      if (
        waited >= 240 &&
        text.length > 3 &&
        !spec.current &&
        !thinkingRef.current &&
        !speakingRef.current
      ) {
        const s: SpecTurn = {
          text,
          deltas: [],
          sink: null,
          promise: null as unknown as ReturnType<typeof think>,
        };
        const specMine: Message = {
          id: uid(),
          from: "me",
          kind: "text",
          channel: "call",
          text,
          at: Date.now(),
        };
        s.promise = think(
          stateRef.current.user,
          brainKeys(),
          [...stateRef.current.messages, specMine],
          text,
          "call",
          engine,
          false,
          (d) => {
            if (s.sink) s.sink(d);
            else s.deltas.push(d);
          },
          recallRef.current,
          freshFrame(),
        );
        spec.current = s;
      }
      if (waited >= commitDelay(text)) {
        acc.current = { finals: "", interim: "", lastAt: 0 };
        sttConsume.current?.(); // continuous mic: don't re-deliver these words
        const sp = spec.current;
        spec.current = null;
        handleUser(text, sp && sp.text === text ? sp : undefined);
      }
    }, 75);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function armReengage() {
    if (reengageTimer.current) clearTimeout(reengageTimer.current);
    reengageTimer.current = setTimeout(async () => {
      // she doesn't sit in silence: after ~7s she carries the conversation
      // herself (twice per stretch, then lets it breathe)
      if (watchSession.current || liveSession.current) return; // another engine owns the voice
      if (!alive.current || speakingRef.current || thinkingRef.current || mutedRef.current) return;
      if (reengaged.current >= 2) return;
      // if we heard ANYTHING from them recently (even sub-threshold speech
      // the recognizer is still chewing on), don't talk over it
      if (Date.now() - lastHeardAt.current < 6000) {
        armReengage(); // count the clock from their last sound, not ours
        return;
      }
      if (acc.current.lastAt && Date.now() - acc.current.lastAt < 4000) {
        armReengage();
        return;
      }
      reengaged.current += 1;
      const seqAtArm = turnSeq.current;
      const reply = await think(
        stateRef.current.user,
        brainKeys(),
        stateRef.current.messages,
        `<context: on the call, they've gone quiet for a few seconds after your last line. keep the conversation alive naturally like a real girl on the phone — extend your last thought, tease them for going quiet ("hello? so gaye kya"), or take the topic somewhere new. 1-2 short spoken sentences. never reference this note>`,
        "call",
        engine,
        true,
        undefined,
        recallRef.current,
      );
      // they may have started talking (or a reply may be in flight) while
      // this nudge generated — never talk over either
      if (
        !alive.current ||
        speakingRef.current ||
        thinkingRef.current ||
        seqAtArm !== turnSeq.current
      )
        return;
      const line = reply.bubbles.join(" ").trim();
      if (line) {
        log({
          id: uid(),
          from: "her",
          kind: "text",
          channel: "call",
          text: line.replace(/\[[a-z ]+\]/gi, "").trim(),
          at: Date.now(),
        });
        sayAloud(line, reply.tone);
      } else {
        // network blip ate the nudge — refund it and try again, don't let
        // the call die into permanent silence
        reengaged.current = Math.max(0, reengaged.current - 1);
        armReengage();
      }
    }, 7000);
  }

  // hands-free: the mic stays hot the whole call (even while she speaks,
  // for barge-in) and re-arms itself after recognizer silence timeouts
  function startListening() {
    // while watch-together runs, the NATIVE engine owns the mic — a JS
    // recognizer here would fight it for the hardware (SR is a singleton);
    // same when the realtime live session owns the whole audio path
    if (watchSession.current || liveSession.current) return;
    if (!alive.current || mutedRef.current || listeningRef.current) return;
    const web = !Capacitor.isNativePlatform();
    const res = listen(
      (text, final) => {
        lastHeardAt.current = Date.now();
        srFails.current = 0; // the recognizer is genuinely working
        setSttSupported(true);
        if (speakingRef.current) {
          // overlap is NORMAL in human calls — she talks through noise and
          // brief speech; only sustained, real speech takes the floor
          const real = isRealInterruption(text);
          const words = text.trim().split(/\s+/).filter(Boolean).length;
          const command = /\b(stop|wait|ruko|suno|arre|ek minute|listen|hold on|chup)\b/i.test(text);
          if (!real || words < 2) {
            overlapStart.current = 0;
            if (ducked.current) {
              duckSpeech(false); // it was nothing — bring her back up NOW
              ducked.current = false;
            }
            return; // noise blip / backchannel / echo — keep talking
          }
          if (!overlapStart.current) overlapStart.current = Date.now();
          const sustained = Date.now() - overlapStart.current > 450;
          if (sustained && !ducked.current) {
            duckSpeech(true); // "haan bolo" — she softens but keeps going
            ducked.current = true;
          }
          if ((sustained && words >= 4) || command) {
            stopSpeaking();
            speakingRef.current = false;
            setSpeaking(false);
            ducked.current = false;
            overlapStart.current = 0;
            interrupted.current = true;
          } else {
            return;
          }
        }
        overlapStart.current = 0;
        // tail-end echo guard: for ~1.2s after she stops, her last words can
        // still leak from the speaker into the mic — not the user talking
        if (
          Date.now() - herSpokeUntil.current < 1200 &&
          !speakingRef.current
        ) {
          const ws = text.toLowerCase().replace(/[^a-zऀ-ॿ ]/gi, " ").split(/\s+/).filter(Boolean);
          const overlap = ws.length
            ? ws.filter((w) => herWordsRef.current.has(w)).length / ws.length
            : 0;
          if (overlap >= 0.6) return;
        }
        // real accepted speech from THEM — only now does it cancel her
        // pending silence-nudge (noise blips shouldn't kill it)
        if (reengageTimer.current) clearTimeout(reengageTimer.current);
        setHeard(text);
        if (web || getSttMode() === "callmic") {
          // accumulate; the endpointing tick decides when the turn is over
          if (final) {
            acc.current.finals = (acc.current.finals + " " + text).trim();
            acc.current.interim = "";
          } else {
            acc.current.interim = text;
          }
          acc.current.lastAt = Date.now();
        } else if (final && text) {
          handleUser(text);
        }
      },
      (reason?: string) => {
        listeningRef.current = false;
        setListening(false);
        if (ducked.current) {
          // interim died out — it was nothing; bring her back up
          duckSpeech(false);
          ducked.current = false;
        }
        if (reason === "not-allowed") {
          // mic permission denied — stop churning the recognizer and
          // surface the typed fallback instead of silently "listening"
          setSttSupported(false);
          return;
        }
        // failure discrimination: sessions dying instantly over and over
        // mean the recognizer is broken here — back off, then give up to
        // the keyboard instead of a battery-draining 300ms hot loop
        const lasted = Date.now() - srStartedAt.current;
        if (lasted < 1200) srFails.current += 1;
        else srFails.current = 0;
        if (srFails.current >= 8) {
          setSttSupported(false);
          return;
        }
        const delay = srFails.current >= 4 ? 2500 : 300;
        // recognizers time out on silence — quietly re-arm
        if (alive.current && !mutedRef.current) {
          setTimeout(() => startListening(), delay);
        }
      },
    );
    if (!res.supported) {
      setSttSupported(false);
      return;
    }
    srStartedAt.current = Date.now();
    stopListen.current = res.stop || null;
    sttConsume.current = res.consume || null;
    listeningRef.current = true;
    setListening(true);
  }

  // ── watch-together (browser): getDisplayMedia screen capture, frames
  // streamed straight into the live session — realtime co-watching with no
  // extra model loop. Desktop Chrome/Edge; lets people without the APK
  // (Mac/iPhone friends on the website) use screen sharing too. ──
  const webWatchAvailable = () =>
    !Capacitor.isNativePlatform() &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getDisplayMedia);

  async function startWebWatch() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 4 },
        audio: false,
      });
    } catch {
      track(stateRef.current.deviceId, "watch_consent_denied", { web: true });
      return;
    }
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play().catch(() => {});
    const canvas = document.createElement("canvas");
    const grab = (): string | null => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return null;
      const scale = Math.min(1, 768 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return null;
      ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.68);
    };
    const iv = setInterval(() => {
      if (!alive.current) return;
      const url = grab();
      if (!url) return;
      frameRef.current = { url, at: Date.now() };
      setFrameAt(Date.now());
      if (!firstFrameSeen.current) {
        firstFrameSeen.current = true;
        track(stateRef.current.deviceId, "watch_frame_first", { web: true });
      }
      // realtime path: the live model sees the screen as a video stream
      liveSession.current?.sendFrame(url.split(",")[1] ?? "");
    }, 700);
    const cleanup = () => {
      clearInterval(iv);
      stream.getTracks().forEach((tr) => tr.stop());
      frameRef.current = null;
      watchSession.current = null;
      setWatching(false);
    };
    // user can stop sharing from the browser's own UI at any moment
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (watchSession.current) {
        cleanup();
        track(stateRef.current.deviceId, "watch_stopped_externally", { web: true });
      }
    });
    watchSession.current = { stop: cleanup };
    setWatching(true);
    liveSession.current?.direct(
      "<context: they just started sharing their screen with you — from now on you can SEE it live (frames stream to you). React like a friend on the couch: mostly silent, short instant reactions only when a moment earns it, never narrate. never reference this note>",
    );
    track(stateRef.current.deviceId, "watch_started", { web: true });
  }

  // ── watch-together (Android app): consent dialog → NATIVE engine (sees/
  // thinks/speaks/listens in the service process, immune to WebView
  // freezing) ──
  async function startWatchMode() {
    if (watching) return;
    if (!watchAvailable()) {
      if (webWatchAvailable()) await startWebWatch();
      return;
    }
    try {
      // bubble permission ("Display over other apps"): first missing-grant tap
      // opens the settings toggle and waits for them to come back and tap
      // again — stacking the capture consent on top of Settings is chaos. If
      // they've been asked before, proceed bubble-less rather than nag.
      const overlayOk = await ensureOverlay(false);
      if (!overlayOk && !localStorage.getItem("meera.overlay.asked")) {
        localStorage.setItem("meera.overlay.asked", "1");
        await ensureOverlay(true);
        return;
      }
      // stand the JS mic lane down BEFORE the consent dialog + native start —
      // the native recognizer's first grab must not collide with ours. The
      // live session releases the mic entirely (native watch owns audio);
      // when watch ends, the cascade resumes and live re-engages next call.
      if (liveSession.current) {
        liveStopping.current = true;
        liveSession.current.stop();
        liveSession.current = null;
        liveStopping.current = false;
      }
      stopListen.current?.();
      listeningRef.current = false;
      setListening(false);
      if (reengageTimer.current) clearTimeout(reengageTimer.current);
      // hand the native engine her full brain: cached persona core + call
      // style, volatile tail + watch rules, and the comment directive
      const parts = buildSystemPromptParts(stateRef.current.user, stateRef.current.messages.length, "voice");
      const config = {
        base: "https://meera-silk.vercel.app",
        system: parts.core + buildSpeechStyle(engine),
        systemTail:
          parts.tail +
          WATCH_MODE_NOTE +
          (recallRef.current
            ? `\n\nWHAT YOU KNOW ABOUT THEM (true memories — answer confidently):\n${recallRef.current}`
            : ""),
        directive: WATCH_COMMENT_DIRECTIVE(),
      };
      watchSession.current = await startWatch(
        config,
        (url) => {
          frameRef.current = { url, at: Date.now() };
          setFrameAt(Date.now());
          if (!firstFrameSeen.current) {
            firstFrameSeen.current = true;
            track(stateRef.current.deviceId, "watch_frame_first", {});
          }
        },
        (who, text) => {
          // native transcript → call memory (delivered when app is visible;
          // Android batches these while backgrounded, which is fine for logs)
          log({
            id: uid(),
            from: who,
            kind: "text",
            channel: "call",
            text,
            at: Date.now(),
          });
          if (who === "her") track(stateRef.current.deviceId, "watch_comment", {});
        },
        () => {
          // capture ended outside our UI (notification, system revoke)
          watchSession.current = null;
          frameRef.current = null;
          setWatching(false);
          track(stateRef.current.deviceId, "watch_stopped_externally", {});
          // same hardware-release beat as stopWatchMode before re-arming
          setTimeout(() => {
            if (alive.current && !mutedRef.current) startListening();
          }, 450);
        },
      );
      setWatching(true);
      lastCommentAt.current = Date.now();
      // the native engine owns voice + mic now: cut any in-flight JS speech
      // and invalidate pending turns so nothing talks over her native lane
      stopSpeaking();
      speakingRef.current = false;
      setSpeaking(false);
      turnSeq.current += 1;
      track(stateRef.current.deviceId, "watch_started", {});
    } catch {
      track(stateRef.current.deviceId, "watch_consent_denied", {});
      // consent denied — stay in the plain call, mic back on
      if (alive.current && !mutedRef.current) startListening();
    }
  }

  function stopWatchMode() {
    watchSession.current?.stop();
    watchSession.current = null;
    frameRef.current = null;
    setWatching(false);
    // give the native recognizer a beat to release the hardware before the
    // JS one grabs it — an instant re-arm tends to land on BUSY
    setTimeout(() => {
      if (alive.current && !mutedRef.current) startListening();
    }, 450);
  }

  const freshFrame = () =>
    watching && frameRef.current && Date.now() - frameRef.current.at < 8000
      ? frameRef.current.url
      : undefined;

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (liveSession.current) {
      // live engine: the socket stays up, we just stop sending audio
      liveSession.current.setMuted(next);
      return;
    }
    if (next) {
      stopListen.current?.();
      listeningRef.current = false;
      setListening(false);
    } else {
      startListening();
    }
  }

  async function handleUser(text: string, prestart?: SpecTurn) {
    if (!alive.current || !text.trim()) return;
    if (liveSession.current) {
      // typed input during a live call — inject as a user turn; she answers
      // through the realtime engine's own voice
      log({ id: uid(), from: "me", kind: "text", channel: "call", text, at: Date.now() });
      liveSession.current.direct(text);
      return;
    }
    reengaged.current = 0; // they spoke — silence counter resets
    // typed input (keyboard fallback) can land while she's mid-speech —
    // an answered question means she yields the floor
    if (speakingRef.current) {
      stopSpeaking();
      speakingRef.current = false;
      setSpeaking(false);
      ducked.current = false;
      interrupted.current = true;
    }
    const seq = ++turnSeq.current;
    // mic STAYS HOT while she thinks — if they keep talking, the fresh
    // speech accumulates, commits, and this in-flight turn goes stale
    setHeard("");
    const mine: Message = {
      id: uid(),
      from: "me",
      kind: "text",
      channel: "call",
      text,
      at: Date.now(),
    };
    log(mine);
    // GUARANTEED acknowledgment: a soft "hmm/haan" tells them she heard —
    // the audio equivalent of read-ticks. Deterministic, once per turn,
    // never layered over speech. After a substantive turn (they said a real
    // thing and are now waiting) it comes at ~420ms like a human listener;
    // for quick fragments it holds back so replies usually beat it.
    const substantive = text.length > 24 || text.split(/\s+/).length > 4;
    setTimeout(() => {
      if (
        thinkingRef.current &&
        alive.current &&
        !speakingRef.current &&
        seq === turnSeq.current &&
        Date.now() - listenerBcAt.current > 2000 // a bc just played — enough
      )
        playAck();
    }, substantive ? 550 : 1300);
    thinkingRef.current = true;
    setThinking(true);
    // still silent after ~4s? hold the floor with a sound, not silence —
    // but never over the user actively talking
    setTimeout(() => {
      if (
        thinkingRef.current &&
        alive.current &&
        !speakingRef.current &&
        Date.now() - lastHeardAt.current > 1500
      )
        playThinkingFiller();
    }, 4000);
    const wasInterrupt = interrupted.current;
    interrupted.current = false;
    const brainMine = wasInterrupt
      ? { ...mine, text: `[interrupting you mid-sentence] ${text}` }
      : mine;

    // ── streaming speech: the [tone: …] marker is buffered off the head of
    // the token stream, then she starts SPEAKING at the first sentence
    // boundary while the rest of the reply is still generating ──
    let speaker: StreamSpeaker | null = null;
    let head = "";
    let headDone = false;
    let firstDelta = true;
    const startSpeaker = (tone: string) => {
      speaker = createStreamSpeaker(
        voiceOpts,
        tone || undefined,
        () => {
          speakingRef.current = true;
          setSpeaking(true);
          if (alive.current) startListening();
        },
        () => {
          speakingRef.current = false;
          setSpeaking(false);
          herSpokeUntil.current = Date.now();
          if (ducked.current) {
            duckSpeech(false); // a soft-duck must never outlive the utterance
            ducked.current = false;
          }
          if (alive.current) {
            startListening();
            armReengage();
          }
        },
      );
    };
    const onDelta = (delta: string) => {
      if (!alive.current || seq !== turnSeq.current) return;
      if (firstDelta) {
        firstDelta = false;
        herWordsRef.current = new Set(); // fresh echo set for this utterance
      }
      for (const w of delta.toLowerCase().replace(/[^a-zऀ-ॿ ]/gi, " ").split(/\s+/))
        if (w) herWordsRef.current.add(w);
      if (headDone) {
        speaker?.push(delta);
        return;
      }
      head += delta;
      const m = head.match(/^\s*\[tone:\s*([^\]]*)\]\s*/i);
      if (m) {
        headDone = true;
        startSpeaker(m[1].trim());
        const rest = head.slice(m[0].length);
        if (rest) speaker!.push(rest);
        return;
      }
      const t = head.trimStart().toLowerCase();
      const maybeMarker = t.length < 6 ? "[tone:".startsWith(t) : t.startsWith("[tone:");
      if (t && !maybeMarker) {
        // no marker coming — speak from the top
        headDone = true;
        startSpeaker("");
        speaker!.push(head);
      } else if (head.length > 90) {
        // marker never closed — strip it leniently and speak the rest
        headDone = true;
        startSpeaker("");
        speaker!.push(head.replace(/^\s*\[tone:\s*[^\]]*\]?\s*/i, ""));
      }
    };

    let reply;
    if (prestart && !wasInterrupt) {
      // the brain already started on this exact text during the pause —
      // adopt the in-flight stream: replay what it produced, then go live
      for (const d of prestart.deltas) onDelta(d);
      prestart.sink = onDelta;
      reply = await prestart.promise;
    } else {
      reply = await think(
        stateRef.current.user,
        brainKeys(),
        [...stateRef.current.messages, brainMine],
        text,
        "call",
        engine,
        false,
        onDelta,
        recallRef.current,
        freshFrame(), // watching? she sees the screen while answering
      );
    }
    thinkingRef.current = false;
    setThinking(false);
    if (!alive.current) return;
    const spoken = reply.bubbles.join(" ");
    if (seq !== turnSeq.current) {
      // stale: they kept talking and a fresher turn took over. If she had
      // already started saying this, keep it in her memory of the call.
      if (speaker && (speaker as StreamSpeaker).started()) {
        log({
          id: uid(),
          from: "her",
          kind: "text",
          channel: "call",
          text: spoken.replace(/\[[a-z ]+\]/gi, "").trim(),
          at: Date.now(),
        });
      }
      return;
    }
    mergeLearned(reply.learned);
    log({
      id: uid(),
      from: "her",
      kind: "text",
      channel: "call",
      text: spoken.replace(/\[[a-z ]+\]/gi, "").trim(),
      at: Date.now(),
    });
    if (speaker && headDone) {
      (speaker as StreamSpeaker).finish(); // stream spoke — flush the tail
    } else {
      sayAloud(spoken, reply.tone); // non-streaming path (fallbacks)
    }
  }

  function endCall(onEnd: () => void) {
    alive.current = false;
    if (liveSession.current) {
      liveStopping.current = true;
      liveSession.current.stop();
      liveSession.current = null;
      liveStopping.current = false;
    }
    stopWatchMode(); // screen sharing dies with the call, always
    if (reengageTimer.current) clearTimeout(reengageTimer.current);
    stopSpeaking();
    stopRoomTone();
    stopListen.current?.();
    setPhase("ended");
    // the chat shows a call record, never the transcript
    const secs = elapsedRef.current;
    const mmssStr = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    log({ id: uid(), from: "me", kind: "callmark", text: mmssStr, at: Date.now() });
    // distill what was said on the call into her graph memory
    rememberFrom(stateRef.current.deviceId, stateRef.current.messages.slice(-16));
    setTimeout(onEnd, 400);
  }

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return {
    phase,
    speaking,
    listening,
    thinking,
    muted,
    toggleMute,
    heard,
    sttSupported,
    mmss,
    handleUser,
    startListening,
    endCall,
    watching,
    frameAt,
    watchAvailable: watchAvailable() || webWatchAvailable(),
    startWatchMode,
    stopWatchMode,
  };
}
