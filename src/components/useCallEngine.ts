// Conversation engine for voice calls: she greets you, listens continuously
// (hands-free STT with a mute toggle; typed fallback where STT is missing),
// thinks, and speaks back.
//
// Realism contract: nothing said on a call appears as chat bubbles. Call
// turns are stored with channel:"call" — hidden from the chat UI but fed to
// the brain, so she remembers call conversations perfectly. The chat shows
// only a "📞 Voice call · m:ss" record when the call ends.

import { useEffect, useRef, useState } from "react";
import type { AppState, Message } from "../state/store";
import { uid } from "../state/store";
import { think } from "../engine/brain";
import {
  speak,
  stopSpeaking,
  listen,
  prefetchBackchannels,
  playBackchannel,
} from "../voice/speech";
import { CALL_OPEN_DIRECTIVE, type VoiceEngine } from "../engine/persona";

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

  const log = (m: Message) => setState((s) => ({ ...s, messages: [...s.messages, m] }));

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
  });

  // connect + greet
  useEffect(() => {
    alive.current = true;
    prefetchBackchannels(voiceOpts); // instant "hmm?" clips for turn-taking
    const t = setTimeout(async () => {
      if (!alive.current) return;
      setPhase("live");
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
    speak(
      text,
      () => {
        speakingRef.current = true;
        setSpeaking(true);
      },
      () => {
        speakingRef.current = false;
        setSpeaking(false);
        if (alive.current) startListening();
      },
      voiceOpts,
    );
  }

  // hands-free: the mic re-arms itself whenever she's not speaking and you
  // haven't muted — no tapping to talk
  function startListening() {
    if (!alive.current || mutedRef.current || speakingRef.current) return;
    const res = listen(
      (text, final) => {
        setHeard(text);
        if (final && text) handleUser(text);
      },
      () => {
        setListening(false);
        // recognizers time out on silence — quietly re-arm
        if (alive.current && !mutedRef.current && !speakingRef.current) {
          setTimeout(() => startListening(), 350);
        }
      },
    );
    if (!res.supported) {
      setSttSupported(false);
      return;
    }
    stopListen.current = res.stop || null;
    setListening(true);
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      stopListen.current?.();
      setListening(false);
    } else {
      startListening();
    }
  }

  async function handleUser(text: string) {
    if (!alive.current || !text.trim()) return;
    stopListen.current?.();
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
    const reply = await think(
      state.user,
      brainKeys(),
      [...state.messages, mine],
      text,
      "call",
      engine,
    );
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
    stopSpeaking();
    stopListen.current?.();
    setPhase("ended");
    // the chat shows a call record, never the transcript
    const secs = elapsedRef.current;
    const mmssStr = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    log({ id: uid(), from: "me", kind: "callmark", text: mmssStr, at: Date.now() });
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
