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
  stopSpeaking,
  listen,
  prefetchBackchannels,
  playBackchannel,
  playThinkingFiller,
  startRoomTone,
  stopRoomTone,
  duckSpeech,
} from "../voice/speech";
import { CALL_OPEN_DIRECTIVE, type VoiceEngine } from "../engine/persona";
import { logTurns, rememberFrom } from "../engine/memory";

export type CallPhase = "connecting" | "live" | "ended";

export function useCallEngine(
  state: AppState,
  setState: React.Dispatch<React.SetStateAction<AppState>>,
) {
  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [heard, setHeard] = useState("");
  const [sttSupported, setSttSupported] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const stopListen = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const speakingRef = useRef(false);
  const mutedRef = useRef(false);
  const elapsedRef = useRef(0);
  const listeningRef = useRef(false);
  const herWordsRef = useRef<Set<string>>(new Set()); // echo rejection
  const thinkingRef = useRef(false);
  // adaptive endpointing (web SR): we decide when the user's turn is over,
  // not the recognizer — LiveKit/pipecat-style, regex instead of a model
  const acc = useRef({ finals: "", interim: "", lastAt: 0 });
  const ducked = useRef(false);
  const interrupted = useRef(false);
  const reengageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlapStart = useRef(0); // when user speech over her speech began
  const reengaged = useRef(0); // continuation nudges this silence stretch

  const log = (m: Message) => {
    setState((s) => ({ ...s, messages: [...s.messages, m] }));
    if (m.kind !== "callmark") logTurns(state.deviceId, [m]);
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
    openrouterKey: state.openrouterKey,
    openrouterModel: state.openrouterModel,
    apiKey: state.apiKey,
    deviceId: state.deviceId,
  });

  // connect + greet
  useEffect(() => {
    alive.current = true;
    prefetchBackchannels(voiceOpts); // instant "hmm?" clips for turn-taking
    const t = setTimeout(async () => {
      if (!alive.current) return;
      setPhase("live");
      startRoomTone(); // real lines are never digitally silent
      // she improvises her own phone pickup — nothing scripted
      const reply = await think(
        state.user,
        brainKeys(),
        state.messages,
        CALL_OPEN_DIRECTIVE(),
        "call",
        engine,
        true,
      );
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
      sayAloud(greet);
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

  function sayAloud(text: string) {
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
        if (alive.current) {
          startListening();
          armReengage(); // if they stay quiet ~8s, one soft "hmm?"
        }
      },
      voiceOpts,
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
    if (SHORT_COMPLETE.test(trimmed) || /\?$/.test(trimmed)) return 550;
    if (CONTINUATION.test(trimmed)) return 2200;
    return 1000;
  }

  // 150ms endpointing tick (web SR only — native STT endpoints itself)
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    const iv = setInterval(() => {
      const a = acc.current;
      const text = (a.finals + " " + a.interim).trim();
      if (!text || !a.lastAt || speakingRef.current) return;
      const waited = Date.now() - a.lastAt;
      if (waited >= Math.min(3000, commitDelay(text))) {
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
      reengaged.current += 1;
      const reply = await think(
        state.user,
        brainKeys(),
        state.messages,
        `<context: on the call, they've gone quiet for a few seconds after your last line. keep the conversation alive naturally like a real girl on the phone — extend your last thought, tease them for going quiet ("hello? so gaye kya"), or take the topic somewhere new. 1-2 short spoken sentences. never reference this note>`,
        "call",
        engine,
        true,
      );
      if (!alive.current || speakingRef.current) return;
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
        sayAloud(line);
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
        if (reengageTimer.current) clearTimeout(reengageTimer.current);
        if (speakingRef.current) {
          // overlap is NORMAL in human calls — she talks through noise and
          // brief speech; only sustained, real speech takes the floor
          const real = isRealInterruption(text);
          const words = text.trim().split(/\s+/).filter(Boolean).length;
          const command = /\b(stop|wait|ruko|suno|arre|ek minute|listen|hold on|chup)\b/i.test(text);
          if (!real || words < 2) {
            overlapStart.current = 0;
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
      () => {
        listeningRef.current = false;
        setListening(false);
        if (ducked.current) {
          // interim died out — it was nothing; bring her back up
          duckSpeech(false);
          ducked.current = false;
        }
        // recognizers time out on silence — quietly re-arm
        if (alive.current && !mutedRef.current) {
          setTimeout(() => startListening(), 300);
        }
      },
    );
    if (!res.supported) {
      setSttSupported(false);
      return;
    }
    stopListen.current = res.stop || null;
    listeningRef.current = true;
    setListening(true);
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
    stopListen.current?.();
    listeningRef.current = false;
    setListening(false);
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
    // human turn-taking norm is ~0-200ms — bridge the think+render gap
    playBackchannel();
    thinkingRef.current = true;
    // still thinking after ~2.5s? hold the floor with a sound, not silence
    setTimeout(() => {
      if (thinkingRef.current && alive.current && !speakingRef.current) playThinkingFiller();
    }, 2500);
    const wasInterrupt = interrupted.current;
    interrupted.current = false;
    const brainMine = wasInterrupt
      ? { ...mine, text: `[interrupting you mid-sentence] ${text}` }
      : mine;
    const reply = await think(
      state.user,
      brainKeys(),
      [...state.messages, brainMine],
      text,
      "call",
      engine,
    );
    thinkingRef.current = false;
    if (!alive.current) return;
    mergeLearned(reply.learned);
    const spoken = reply.bubbles.join(" ");
    log({
      id: uid(),
      from: "her",
      kind: "text",
      channel: "call",
      text: spoken.replace(/\[[a-z ]+\]/gi, "").trim(),
      at: Date.now(),
    });
    sayAloud(spoken);
  }

  function endCall(onEnd: () => void) {
    alive.current = false;
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
    rememberFrom(state.deviceId, state.messages.slice(-16));
    setTimeout(onEnd, 400);
  }

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return {
    phase,
    speaking,
    listening,
    muted,
    toggleMute,
    heard,
    sttSupported,
    mmss,
    handleUser,
    startListening,
    endCall,
  };
}
