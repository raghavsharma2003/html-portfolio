// Shared conversation engine for voice & video calls: she greets you,
// listens (STT where available, typed fallback), thinks, and speaks back
// while the avatar lip-syncs.

import { useEffect, useRef, useState } from "react";
import type { AppState, Message } from "../state/store";
import { uid } from "../state/store";
import { think } from "../engine/brain";
import { speak, stopSpeaking, listen } from "../voice/speech";

export type CallPhase = "connecting" | "live" | "ended";

export function useCallEngine(
  state: AppState,
  setState: React.Dispatch<React.SetStateAction<AppState>>,
  kind: "voice" | "video",
) {
  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [caption, setCaption] = useState("");
  const [heard, setHeard] = useState("");
  const [sttSupported, setSttSupported] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const stopListen = useRef<(() => void) | null>(null);
  const alive = useRef(true);

  const log = (m: Message) => setState((s) => ({ ...s, messages: [...s.messages, m] }));

  // connect + greet
  useEffect(() => {
    alive.current = true;
    const t = setTimeout(() => {
      if (!alive.current) return;
      setPhase("live");
      const name = state.user.name || "hey";
      const greet =
        kind === "video"
          ? `Hii ${name}! Arre dekho kaun aaya. Tumhe dekh ke itni khushi hui, sach mein.`
          : `Hii ${name}. Main soch hi rahi thi ki tum call karoge. Kaise ho?`;
      sayAloud(greet);
    }, 1800 + Math.random() * 900);
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
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(iv);
  }, [phase]);

  function sayAloud(text: string) {
    setCaption(text);
    speak(
      text,
      () => setSpeaking(true),
      () => {
        setSpeaking(false);
        if (alive.current) startListening();
      },
    );
  }

  function startListening() {
    if (!alive.current) return;
    const res = listen(
      (text, final) => {
        setHeard(text);
        if (final && text) handleUser(text);
      },
      () => setListening(false),
    );
    if (!res.supported) {
      setSttSupported(false);
      return;
    }
    stopListen.current = res.stop || null;
    setListening(true);
  }

  async function handleUser(text: string) {
    if (!alive.current || !text.trim()) return;
    stopListen.current?.();
    setListening(false);
    setHeard("");
    const mine: Message = { id: uid(), from: "me", kind: "text", text, at: Date.now() };
    log(mine);
    const reply = await think(state.user, state.apiKey, [...state.messages, mine], text);
    if (!alive.current) return;
    const spoken = reply.bubbles.join(" ");
    log({ id: uid(), from: "her", kind: "text", text: reply.bubbles.join("\n"), at: Date.now() });
    sayAloud(spoken);
  }

  function endCall(onEnd: () => void) {
    alive.current = false;
    stopSpeaking();
    stopListen.current?.();
    setPhase("ended");
    setTimeout(onEnd, 400);
  }

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return {
    phase,
    speaking,
    listening,
    caption,
    heard,
    sttSupported,
    mmss,
    handleUser,
    startListening,
    endCall,
  };
}
