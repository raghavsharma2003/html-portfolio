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
  playThinkingFiller,
  startRoomTone,
  stopRoomTone,
  duckSpeech,
} from "../voice/speech";
import { CALL_OPEN_DIRECTIVE, WATCH_COMMENT_DIRECTIVE, type VoiceEngine } from "../engine/persona";
import { logTurns, rememberFrom, recallMemories } from "../engine/memory";
import { startWatch, watchAvailable, type WatchSession } from "../native/watch";
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
  const lastAnalyzedFrame = useRef(""); // static screens must cost zero
  const firstFrameSeen = useRef(false);
  const commentBusy = useRef(false);
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
    const t = setTimeout(async () => {
      if (!alive.current) return;
      setPhase("live");
      startRoomTone(); // real lines are never digitally silent
      const reply = await greetPromise;
      if (!alive.current) return;
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
    }, 1400 + Math.random() * 700);
    return () => {
      alive.current = false;
      clearTimeout(t);
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

  function commitDelay(t: string): number {
    const trimmed = t.trim().toLowerCase();
    if (SHORT_COMPLETE.test(trimmed) || /\?$/.test(trimmed)) return 380;
    if (CONTINUATION.test(trimmed)) return 1800;
    return 650; // resume-while-thinking absorbs the rare early commit
  }

  // 150ms endpointing tick (web SR only — native STT endpoints itself)
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    const iv = setInterval(() => {
      const a = acc.current;
      const text = (a.finals + " " + a.interim).trim();
      if (!text || !a.lastAt || speakingRef.current) return;
      const waited = Date.now() - a.lastAt;
      if (waited >= Math.min(2600, commitDelay(text))) {
        acc.current = { finals: "", interim: "", lastAt: 0 };
        handleUser(text);
      }
    }, 150);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function armReengage() {
    if (reengageTimer.current) clearTimeout(reengageTimer.current);
    reengageTimer.current = setTimeout(async () => {
      // she doesn't sit in silence: after ~7s she carries the conversation
      // herself (twice per stretch, then lets it breathe)
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
        if (web) {
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
    listeningRef.current = true;
    setListening(true);
  }

  // ── watch-together: consent dialog → screen frames → couch-friend mode ──
  async function startWatchMode() {
    if (!watchAvailable() || watching) return;
    try {
      watchSession.current = await startWatch(
        (url) => {
          frameRef.current = { url, at: Date.now() };
          setFrameAt(Date.now());
          if (!firstFrameSeen.current) {
            firstFrameSeen.current = true;
            track(stateRef.current.deviceId, "watch_frame_first", {});
          }
          // commentary is driven by the NATIVE frame tick, not a JS timer —
          // Android throttles WebView timers while another app is foreground,
          // which froze her eyes in v1 of this feature
          void maybeWatchComment();
        },
        () => {
          // capture ended outside our UI (notification, system revoke)
          watchSession.current = null;
          frameRef.current = null;
          setWatching(false);
          track(stateRef.current.deviceId, "watch_stopped_externally", {});
        },
      );
      setWatching(true);
      lastCommentAt.current = Date.now(); // no instant commentary on start
      track(stateRef.current.deviceId, "watch_started", {});
    } catch {
      track(stateRef.current.deviceId, "watch_consent_denied", {});
      /* consent denied — stay in the plain call */
    }
  }

  function stopWatchMode() {
    watchSession.current?.stop();
    watchSession.current = null;
    frameRef.current = null;
    setWatching(false);
  }

  const freshFrame = () =>
    watching && frameRef.current && Date.now() - frameRef.current.at < 8000
      ? frameRef.current.url
      : undefined;

  // proactive couch-friend commentary: mostly silence, an occasional short
  // reaction when a moment earns it — never over their speech or her own.
  // Called on every NATIVE frame arrival (~3s) so it keeps working while
  // another app is foreground and WebView timers are throttled.
  async function maybeWatchComment() {
    const frame = freshFrame();
    if (!frame || !alive.current || commentBusy.current) return;
    if (speakingRef.current || thinkingRef.current || mutedRef.current) return;
    if (Date.now() - lastCommentAt.current < 20_000) return; // cadence cap
    if (Date.now() - lastHeardAt.current < 4000) return; // they're talking
    // unchanged screen = zero vision calls (a paused video / idle app
    // yields byte-identical frames — nothing new to react to)
    if (frame === lastAnalyzedFrame.current) return;
    lastAnalyzedFrame.current = frame;
    commentBusy.current = true;
    const seqAt = turnSeq.current;
    try {
      const reply = await think(
        stateRef.current.user,
        brainKeys(),
        stateRef.current.messages,
        WATCH_COMMENT_DIRECTIVE(),
        "call",
        engine,
        true,
        undefined,
        recallRef.current,
        frame,
      );
      if (
        !alive.current ||
        speakingRef.current ||
        thinkingRef.current ||
        seqAt !== turnSeq.current
      )
        return;
      const line = reply.bubbles.join(" ").trim();
      if (!line || /NO_?COMMENT/i.test(line)) return; // silence is the default
      lastCommentAt.current = Date.now();
      track(stateRef.current.deviceId, "watch_comment", {});
      log({
        id: uid(),
        from: "her",
        kind: "text",
        channel: "call",
        text: line.replace(/\[[a-z ]+\]/gi, "").trim(),
        at: Date.now(),
      });
      sayAloud(line, reply.tone);
    } finally {
      commentBusy.current = false;
    }
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      stopListen.current?.();
      listeningRef.current = false;
      setListening(false);
    } else {
      startListening();
    }
  }

  async function handleUser(text: string) {
    if (!alive.current || !text.trim()) return;
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
    // GUARANTEED acknowledgment: if her reply hasn't started speaking within
    // ~1.1s, a soft "hmm/haan" tells them she heard — the audio equivalent
    // of read-ticks. Deterministic, once per turn, never layered over speech.
    setTimeout(() => {
      if (
        thinkingRef.current &&
        alive.current &&
        !speakingRef.current &&
        seq === turnSeq.current
      )
        playAck();
    }, 1100);
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

    const reply = await think(
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
    watchAvailable: watchAvailable(),
    startWatchMode,
    stopWatchMode,
  };
}
