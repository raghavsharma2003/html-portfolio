// The chat — where the relationship lives. Human typing rhythm, multi-bubble
// replies, photo moments, idle nudges, presence cues.

import { useEffect, useRef, useState } from "react";
import type { AppState, Message } from "../state/store";
import { uid } from "../state/store";
import { think } from "../engine/brain";
import { HER_NAME, OPEN_DIRECTIVE, NUDGE_DIRECTIVE } from "../engine/persona";
import type { HeartReply } from "../engine/localHeart";
import PhotoAvatar from "./PhotoAvatar";
import PhotoCard from "./PhotoCard";
import BigEmoji, { isSingleEmoji } from "./BigEmoji";
import { PhoneIcon, SendIcon, BroomIcon, TickIcon } from "./icons";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onVoiceCall: () => void;
}

const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function lastSeenLabel(t: number): string {
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return "recently";
  const d = new Date(t);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "today at " + fmtTime(t);
  return fmtTime(t);
}

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

export default function Chat({ state, setState, onVoiceCall }: Props) {
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [clearArm, setClearArm] = useState(false);
  // presence: she is not permanently glued to the phone — she comes online to
  // read/reply, lingers a bit, then drops to "last seen"
  const [herOnline, setHerOnline] = useState(false);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);
  const nudged = useRef(false);
  const lastActivity = useRef(Date.now());

  const { messages, user, apiKey, openrouterKey } = state;

  const brainKeys = () => ({
    openrouterKey,
    openrouterModel: state.openrouterModel,
    apiKey,
  });

  const pushMsg = (m: Message) =>
    setState((s) => ({ ...s, messages: [...s.messages, m] }));

  // tick progression on my messages: sent → delivered → read
  const upgradeMyStatus = (to: "delivered" | "read") =>
    setState((s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.from === "me" &&
        m.status &&
        m.status !== "read" &&
        (to === "read" || m.status === "sent")
          ? { ...m, status: to }
          : m,
      ),
    }));

  const cameOnline = () => {
    setHerOnline(true);
    if (offlineTimer.current) clearTimeout(offlineTimer.current);
    // she wanders off her phone 45–100s after her last activity
    offlineTimer.current = setTimeout(() => {
      setHerOnline(false);
      setState((s) => ({ ...s, lastSeen: Date.now() }));
    }, 45_000 + Math.random() * 55_000);
  };

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

  // her opening message when the chat is brand new — improvised by the model,
  // never a stored line ("heyy" alone only if the network is truly dead)
  useEffect(() => {
    if (messages.length === 0 && !busy.current) {
      busy.current = true;
      think(user, brainKeys(), [], OPEN_DIRECTIVE(), "chat", "device", true).then((reply) => {
        if (!reply.bubbles.length && !reply.photo) reply = { bubbles: ["heyy"] };
        deliver(reply);
      });
    }
    // re-runs after a chat clear too — she says hi fresh, in her own words
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // idle nudge — she double-texts if you go quiet with the app open;
  // the model improvises what she's doing, nothing is scripted
  useEffect(() => {
    const iv = setInterval(() => {
      if (nudged.current || busy.current || messages.length < 4) return;
      const idle = Date.now() - lastActivity.current;
      if (idle > 150_000 && messages[messages.length - 1]?.from === "her") {
        nudged.current = true;
        think(user, brainKeys(), messages, NUDGE_DIRECTIVE(), "chat", "device", true).then(
          (reply) => {
            if (reply.bubbles.length || reply.photo) deliver(reply);
          },
        );
      }
    }, 20_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  async function deliver(reply: HeartReply, incoming = "") {
    busy.current = true;
    await sleep(readDelay(incoming));
    // this is the moment she actually reads you: she pops online, blue ticks
    cameOnline();
    upgradeMyStatus("read");
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
    const mine: Message = {
      id: uid(),
      from: "me",
      kind: "text",
      text,
      at: Date.now(),
      status: "sent",
    };
    pushMsg(mine);
    // single tick → double tick shortly after (server delivery rhythm)
    setTimeout(() => upgradeMyStatus("delivered"), 500 + Math.random() * 700);
    const reply = await think(user, brainKeys(), [...messages, mine], text);
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
    } else if (isSingleEmoji(m.text)) {
      rows.push(
        <div key={m.id} className={`msg ${m.from} emoji-big`}>
          <BigEmoji emoji={m.text} />
          {(lastOfGroup || m.from === "me") && (
            <span className="t">
              {lastOfGroup && fmtTime(m.at)}
              {m.from === "me" && <TickIcon status={m.status ?? "read"} />}
            </span>
          )}
        </div>,
      );
    } else {
      rows.push(
        <div key={m.id} className={`msg ${m.from}`}>
          {m.text}
          {(lastOfGroup || m.from === "me") && (
            <span className="t">
              {lastOfGroup && fmtTime(m.at)}
              {m.from === "me" && <TickIcon status={m.status ?? "read"} />}
            </span>
          )}
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
        >
          <div className="inner" style={{ animationDuration: "20s" }}>
            <PhotoAvatar size={43} />
          </div>
        </div>
        <div className="who">
          <div className="name">{HER_NAME}</div>
          {typing ? (
            <div className="status typing">typing…</div>
          ) : herOnline ? (
            <div className="status">
              <span className="dot" /> online
            </div>
          ) : (
            <div className="status">last seen {lastSeenLabel(state.lastSeen)}</div>
          )}
        </div>
        <button className="icon-btn" onClick={onVoiceCall} aria-label="Voice call">
          <PhoneIcon />
        </button>
        <button
          className="icon-btn"
          style={clearArm ? { background: "rgba(255,59,48,0.12)", color: "var(--danger)" } : undefined}
          onClick={() => {
            if (!clearArm) {
              setClearArm(true);
              setTimeout(() => setClearArm(false), 2600);
            } else {
              setClearArm(false);
              nudged.current = false;
              busy.current = false;
              setState((s) => ({ ...s, messages: [] }));
            }
          }}
          aria-label={clearArm ? "Tap again to clear chat" : "Clear chat"}
        >
          <BroomIcon />
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
          <button className={`send-btn ${draft.trim() ? "" : "off"}`} onClick={send} aria-label="Send">
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
