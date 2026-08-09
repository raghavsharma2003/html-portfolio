// The chat — where the relationship lives. Human typing rhythm, multi-bubble
// replies, photo moments, idle nudges, presence cues.

import { useEffect, useRef, useState } from "react";
import type { AppState, Message } from "../state/store";
import { uid } from "../state/store";
import { think } from "../engine/brain";
import { NUDGES, HER_NAME, timeOfDay } from "../engine/persona";
import type { HeartReply } from "../engine/localHeart";
import PhotoAvatar from "./PhotoAvatar";
import PhotoCard from "./PhotoCard";
import { PhoneIcon, VideoIcon, SendIcon, SettingsIcon } from "./icons";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onVoiceCall: () => void;
  onVideoCall: () => void;
  onSettings: () => void;
}

const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function dayLabel(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const yd = new Date(today.getTime() - 864e5);
  if (d.toDateString() === today.toDateString()) return "today";
  if (d.toDateString() === yd.toDateString()) return "yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

// human rhythm (research-calibrated): she "reads" at ~4 words/sec before the
// typing indicator appears, then "types" at ~15 chars/sec, clamped 500–3500ms.
const readDelay = (incoming: string) => {
  const words = incoming.split(/\s+/).filter(Boolean).length;
  return Math.min(3000, Math.max(600, (words / 4) * 1000));
};
const typeDelay = (bubble: string) => {
  const jitter = 0.8 + Math.random() * 0.5;
  return Math.min(3500, Math.max(500, bubble.length * 66 * jitter));
};

export default function Chat({ state, setState, onVoiceCall, onVideoCall, onSettings }: Props) {
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);
  const nudged = useRef(false);
  const lastActivity = useRef(Date.now());

  const { messages, user, apiKey } = state;

  const pushMsg = (m: Message) =>
    setState((s) => ({ ...s, messages: [...s.messages, m] }));

  const mergeLearned = (learned?: Record<string, string>) => {
    if (!learned || !Object.keys(learned).length) return;
    setState((s) => ({
      ...s,
      user: { ...s.user, facts: { ...s.user.facts, ...learned } },
    }));
  };

  // auto scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [messages.length, typing]);

  // her opening message when the chat is brand new
  useEffect(() => {
    if (messages.length === 0 && !busy.current) {
      busy.current = true;
      const tod = timeOfDay();
      const opener =
        tod === "night"
          ? [`oh hi ${user.name}`, "main bas chai bana ke baithi thi, neend nahi aa rahi", "tum bhi jaag rahe ho... kya scene hai?"]
          : [`hey ${user.name}`, "perfect timing honestly, abhi free hui hoon", "acha pehle yeh batao — tum yahan kaise pahunche? 😄"];
      deliver({ bubbles: opener });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // idle nudge — she double-texts if you go quiet with the app open
  useEffect(() => {
    const iv = setInterval(() => {
      if (nudged.current || busy.current || messages.length < 4) return;
      const idle = Date.now() - lastActivity.current;
      if (idle > 150_000 && messages[messages.length - 1]?.from === "her") {
        nudged.current = true;
        const n = NUDGES[Math.floor(Math.random() * NUDGES.length)];
        deliver({ bubbles: n });
      }
    }, 20_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  async function deliver(reply: HeartReply, incoming = "") {
    busy.current = true;
    await sleep(readDelay(incoming));
    for (const bubble of reply.bubbles) {
      setTyping(true);
      await sleep(typeDelay(bubble));
      setTyping(false);
      pushMsg({ id: uid(), from: "her", kind: "text", text: bubble, at: Date.now() });
      await sleep(280 + Math.random() * 420);
    }
    if (reply.photo) {
      setTyping(true);
      await sleep(1600);
      setTyping(false);
      pushMsg({
        id: uid(),
        from: "her",
        kind: "photo",
        text: reply.photo.caption,
        photoSeed: reply.photo.seed,
        at: Date.now(),
      });
    }
    busy.current = false;
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy.current) return;
    setDraft("");
    lastActivity.current = Date.now();
    nudged.current = false;
    const mine: Message = { id: uid(), from: "me", kind: "text", text, at: Date.now() };
    pushMsg(mine);
    const reply = await think(user, apiKey, [...messages, mine], text);
    mergeLearned(reply.learned);
    await deliver(reply, text);
  }

  // render with day separators; timestamp only on the last bubble of a
  // same-sender group (research: uncluttered = intimate)
  const rows: React.ReactNode[] = [];
  let lastDay = "";
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const next = messages[i + 1];
    const lastOfGroup =
      !next || next.from !== m.from || next.at - m.at > 60_000;
    const d = dayLabel(m.at);
    if (d !== lastDay) {
      lastDay = d;
      rows.push(
        <div key={`sep${m.id}`} className="day-sep">
          {d}
        </div>,
      );
    }
    if (m.kind === "photo") {
      rows.push(
        <div key={m.id} className="msg her photo">
          <PhotoCard seed={m.photoSeed || m.text} />
          <div className="cap">{m.text}</div>
        </div>,
      );
    } else {
      rows.push(
        <div key={m.id} className={`msg ${m.from}`}>
          {m.text}
          {lastOfGroup && <span className="t">{fmtTime(m.at)}</span>}
        </div>,
      );
    }
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <div
          className="avatar-ring"
          style={{ width: 48, height: 48, padding: 2.5, animationDuration: "20s" }}
          onClick={onSettings}
        >
          <div className="inner" style={{ animationDuration: "20s" }}>
            <PhotoAvatar size={43} />
          </div>
        </div>
        <div className="who" onClick={onSettings}>
          <div className="name">{HER_NAME}</div>
          {typing ? (
            <div className="status typing">typing…</div>
          ) : (
            <div className="status">
              <span className="dot" /> online
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={onVoiceCall} aria-label="Voice call">
          <PhoneIcon />
        </button>
        <button className="icon-btn" onClick={onVideoCall} aria-label="Video call">
          <VideoIcon />
        </button>
        <button className="icon-btn" onClick={onSettings} aria-label="Settings">
          <SettingsIcon />
        </button>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {rows}
        {typing && (
          <div className="typing-bubble">
            <i />
            <i />
            <i />
          </div>
        )}
        <div style={{ height: 6 }} />
      </div>

      <div className="chat-input-row">
        <div className="chat-input">
          <textarea
            ref={inputRef}
            rows={1}
            placeholder={`Message ${HER_NAME}…`}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(110, e.target.scrollHeight) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
        </div>
        <button className={`send-btn ${draft.trim() ? "" : "off"}`} onClick={send} aria-label="Send">
          <SendIcon />
        </button>
      </div>
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
