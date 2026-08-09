// The chat — where the relationship lives. Human typing rhythm, multi-bubble
// replies, photo moments, idle nudges, presence cues.

import { useEffect, useRef, useState } from "react";
import type { AppState, Message } from "../state/store";
import { uid } from "../state/store";
import { think } from "../engine/brain";
import { HER_NAME, OPEN_DIRECTIVE, NUDGE_DIRECTIVE } from "../engine/persona";
import { logTurns, rememberFrom } from "../engine/memory";
import { track } from "../engine/account";
import type { HeartReply } from "../engine/localHeart";
import PhotoAvatar from "./PhotoAvatar";
import PhotoCard from "./PhotoCard";
import BigEmoji, { isSingleEmoji } from "./BigEmoji";
import VoiceNote, { registerLocalClip } from "./VoiceNote";
import GifBubble from "./GifBubble";
import { listen } from "../voice/speech";
import { PhoneIcon, SendIcon, BroomIcon, TickIcon, MicIcon } from "./icons";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onVoiceCall: () => void;
  onProfile: () => void;
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

export default function Chat({ state, setState, onVoiceCall, onProfile }: Props) {
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [clearArm, setClearArm] = useState(false);
  // WhatsApp-style quote-reply: tap a bubble → reply chip → quoted compose
  const [replySel, setReplySel] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // voice-note recording (mic + live transcription)
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const recRef = useRef<{
    recorder: MediaRecorder | null;
    chunks: Blob[];
    transcript: string;
    stopSR: (() => void) | null;
    srAlive: boolean;
    timer: ReturnType<typeof setInterval> | null;
    startedAt: number;
  } | null>(null);
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
    deviceId: state.deviceId,
  });
  const sendCount = useRef(0);

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

  // keyboard open/close resizes the app — keep the conversation pinned to
  // the bottom through it
  useEffect(() => {
    const onResize = () => scrollRef.current?.scrollTo({ top: 1e9 });
    window.visualViewport?.addEventListener("resize", onResize);
    return () => window.visualViewport?.removeEventListener("resize", onResize);
  }, []);

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
    const delivered: Message[] = [];
    for (const bubble of reply.bubbles) {
      setTyping(true);
      await sleep(typeDelay(bubble));
      setTyping(false);
      const msg: Message = { id: uid(), from: "her", kind: "text", text: bubble, at: Date.now() };
      delivered.push(msg);
      pushMsg(msg);
      await sleep(280 + Math.random() * 420);
    }
    if (reply.voice) {
      setTyping(true);
      await sleep(2200 + Math.random() * 1200); // "recording..." beat
      setTyping(false);
      const clean = reply.voice.text.replace(/\[[a-z ]+\]/gi, "").trim();
      const msg: Message = {
        id: uid(),
        from: "her",
        kind: "voice",
        text: clean,
        spoken: reply.voice.text,
        dur: Math.max(2, Math.round(clean.split(/\s+/).length / 2.4)),
        at: Date.now(),
      };
      delivered.push(msg);
      pushMsg(msg);
    }
    if (reply.gif) track(state.deviceId, "gif_sent", { q: reply.gif.query.slice(0, 40) }, state.auth?.userId);
    if (reply.gif) {
      setTyping(true);
      await sleep(900 + Math.random() * 700);
      setTyping(false);
      const msg: Message = {
        id: uid(),
        from: "her",
        kind: "gif",
        text: reply.gif.query,
        at: Date.now(),
      };
      delivered.push(msg);
      pushMsg(msg);
    }
    if (delivered.length) logTurns(state.deviceId, delivered);
    if (reply.photo) track(state.deviceId, "photo_sent", { seed: reply.photo.seed.slice(0, 40) }, state.auth?.userId);
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
      ...(replyTo ? { replyTo: { from: replyTo.from, text: replyTo.text } } : {}),
    };
    setReplyTo(null);
    pushMsg(mine);
    logTurns(state.deviceId, [mine]);
    track(state.deviceId, "message_sent", { len: text.length, quoted: Boolean(mine.replyTo) }, state.auth?.userId);
    // single tick → double tick shortly after (server delivery rhythm)
    setTimeout(() => upgradeMyStatus("delivered"), 500 + Math.random() * 700);
    const reply = await think(user, brainKeys(), [...messages, mine], text);
    mergeLearned(reply.learned);
    await deliver(reply, text);
    // periodically distill the conversation into her graph memory
    sendCount.current += 1;
    if (sendCount.current % 4 === 0) {
      rememberFrom(state.deviceId, [...messages, mine]);
    }
  }

  // WhatsApp/Telegram swipe-to-reply, tuned to Telegram's source numbers:
  // 10px dead zone, ~3x direction lock, 48px trigger with re-armable haptic,
  // damped tracking past the trigger capped at 80px, 180ms decelerate
  // spring-back. touch-action: pan-y on the list keeps scrolling native.
  const swipe = useRef({ x: 0, y: 0, dx: 0, active: false, dead: false, fired: false });
  function swipeHandlers(m: Message) {
    return {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        // browser back/forward gesture zone — leave edge touches alone
        const dead = t.clientX < 20 || t.clientX > window.innerWidth - 20;
        swipe.current = { x: t.clientX, y: t.clientY, dx: 0, active: false, dead, fired: false };
      },
      onTouchMove: (e: React.TouchEvent) => {
        const s = swipe.current;
        if (s.dead) return;
        const dx = e.touches[0].clientX - s.x;
        const dy = e.touches[0].clientY - s.y;
        if (!s.active) {
          if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 2.5) s.active = true;
          else if (Math.abs(dy) > 10) s.dead = true; // vertical won: it's a scroll
          return;
        }
        // 1:1 to the trigger, then damped, hard cap 80px
        const mag = Math.abs(dx);
        const damped = Math.min(48, mag) + Math.max(0, mag - 48) * 0.25;
        s.dx = Math.sign(dx) * Math.min(80, damped);
        const el = e.currentTarget as HTMLElement;
        el.style.transition = "none";
        el.style.transform = `translateX(${s.dx}px)`;
        if (Math.abs(s.dx) >= 48) {
          if (!s.fired) {
            s.fired = true;
            try {
              navigator.vibrate?.(10);
            } catch {
              /* iOS has no vibrate */
            }
          }
        } else {
          s.fired = false; // re-arm like Telegram
        }
      },
      onTouchEnd: (e: React.TouchEvent) => {
        const s = swipe.current;
        const el = e.currentTarget as HTMLElement;
        el.style.transition = "transform 0.18s cubic-bezier(0, 0, 0.2, 1)";
        el.style.transform = "";
        if (s.active && Math.abs(s.dx) >= 48) {
          setReplyTo(m);
          setReplySel(null);
        }
        swipe.current = { x: 0, y: 0, dx: 0, active: false, dead: false, fired: false };
      },
    };
  }

  async function startRecording() {
    if (recording || busy.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const st = {
        recorder,
        chunks: [] as Blob[],
        transcript: "",
        stopSR: null as (() => void) | null,
        srAlive: true,
        timer: null as ReturnType<typeof setInterval> | null,
        startedAt: Date.now(),
      };
      recRef.current = st;
      recorder.ondataavailable = (e) => e.data.size && st.chunks.push(e.data);
      recorder.start(250);
      // live transcription runs alongside the recording, re-arming on silence
      const arm = () => {
        if (!st.srAlive) return;
        const res = listen(
          (text, final) => {
            if (final && text) st.transcript = (st.transcript + " " + text).trim();
          },
          () => {
            if (st.srAlive) setTimeout(arm, 250);
          },
        );
        st.stopSR = res.stop || null;
      };
      arm();
      st.timer = setInterval(() => setRecSecs(Math.round((Date.now() - st.startedAt) / 1000)), 500);
      setRecSecs(0);
      setRecording(true);
    } catch {
      /* mic denied — nothing to do */
    }
  }

  function finishRecording(sendIt: boolean) {
    const st = recRef.current;
    if (!st) return;
    st.srAlive = false;
    st.stopSR?.();
    if (st.timer) clearInterval(st.timer);
    const secs = Math.max(1, Math.round((Date.now() - st.startedAt) / 1000));
    st.recorder!.onstop = () => {
      st.recorder!.stream.getTracks().forEach((t) => t.stop());
      if (!sendIt) return;
      // give the recognizer a beat to flush its final result
      setTimeout(() => {
        const transcript = st.transcript.trim();
        if (!transcript) return; // nothing intelligible — send nothing
        const blob = new Blob(st.chunks, { type: st.recorder!.mimeType || "audio/webm" });
        const mine: Message = {
          id: uid(),
          from: "me",
          kind: "voice",
          text: transcript,
          dur: secs,
          at: Date.now(),
          status: "sent",
        };
        registerLocalClip(mine.id, blob);
        pushMsg(mine);
        logTurns(state.deviceId, [mine]);
        track(state.deviceId, "voice_note_sent", { dur: secs }, state.auth?.userId);
        setTimeout(() => upgradeMyStatus("delivered"), 500 + Math.random() * 700);
        lastActivity.current = Date.now();
        nudged.current = false;
        think(user, brainKeys(), [...messages, mine], `[voice note] ${transcript}`).then((reply) => {
          mergeLearned(reply.learned);
          deliver(reply, transcript);
        });
      }, 600);
    };
    st.recorder!.stop();
    recRef.current = null;
    setRecording(false);
  }

  // render with day separators; timestamp only on the last bubble of a
  // same-sender group (research: uncluttered = intimate)
  // call turns never render — a call is spoken, not written. Only the
  // "📞 Voice call" record shows (she still remembers everything said).
  const visible = messages.filter((m) => m.channel !== "call");
  const rows: React.ReactNode[] = [];
  let lastDay = "";
  for (let i = 0; i < visible.length; i++) {
    const m = visible[i];
    const next = visible[i + 1];
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
    if (m.kind === "callmark") {
      rows.push(
        <div key={m.id} className="call-chip">
          📞 Voice call · {m.text} <span className="ct">{fmtTime(m.at)}</span>
        </div>,
      );
    } else if (m.kind === "voice") {
      rows.push(
        <div key={m.id} className={`msg ${m.from} voice`} {...swipeHandlers(m)}>
          <VoiceNote m={m} />
          {(lastOfGroup || m.from === "me") && (
            <span className="t">
              {lastOfGroup && fmtTime(m.at)}
              {m.from === "me" && <TickIcon status={m.status ?? "read"} />}
            </span>
          )}
        </div>,
      );
    } else if (m.kind === "gif") {
      rows.push(
        <div key={m.id} className={`msg ${m.from} gifmsg`} {...swipeHandlers(m)}>
          <GifBubble
            m={m}
            onResolved={(id, url) =>
              setState((s) => ({
                ...s,
                messages: s.messages.map((x) => (x.id === id ? { ...x, gifUrl: url } : x)),
              }))
            }
          />
          {lastOfGroup && <span className="t">{fmtTime(m.at)}</span>}
        </div>,
      );
    } else if (m.kind === "photo") {
      rows.push(
        <div key={m.id} className="msg her photo" {...swipeHandlers(m)}>
          <PhotoCard seed={m.photoSeed || m.text} />
          <div className="cap">{m.text}</div>
        </div>,
      );
    } else {
      const emojiOnly = isSingleEmoji(m.text);
      rows.push(
        <div
          key={m.id}
          className={`msg ${m.from} ${emojiOnly ? "emoji-big" : ""} ${replySel === m.id ? "sel" : ""}`}
          onClick={() => setReplySel((cur) => (cur === m.id ? null : m.id))}
          {...swipeHandlers(m)}
        >
          {replySel === m.id && (
            <button
              className="reply-chip"
              onClick={(e) => {
                e.stopPropagation();
                setReplyTo(m);
                setReplySel(null);
                inputRef.current?.focus();
              }}
            >
              ↩ reply
            </button>
          )}
          {m.replyTo && (
            <div className="quote">
              <b>{m.replyTo.from === "her" ? HER_NAME : "You"}</b>
              {m.replyTo.text.slice(0, 90)}
            </div>
          )}
          {emojiOnly ? <BigEmoji emoji={m.text} /> : m.text}
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
          onClick={onProfile}
          role="button"
          aria-label="Account"
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
              track(state.deviceId, "chat_cleared", { count: messages.length }, state.auth?.userId);
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

      {replyTo && (
        <div className="reply-bar">
          <div className="quote">
            <b>{replyTo.from === "her" ? HER_NAME : "You"}</b>
            {replyTo.text.slice(0, 90)}
          </div>
          <button className="reply-x" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
            ×
          </button>
        </div>
      )}
      <div className="chat-input-row">
        {recording ? (
          <div className="rec-bar">
            <span className="rec-dot" />
            <span className="rec-time">
              0:{String(recSecs).padStart(2, "0")} · recording…
            </span>
            <button className="rec-cancel" onClick={() => finishRecording(false)}>
              cancel
            </button>
            <button className="send-btn" onClick={() => finishRecording(true)} aria-label="Send voice note">
              <SendIcon />
            </button>
          </div>
        ) : (
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
            {draft.trim() ? (
              <button className="send-btn" onClick={send} aria-label="Send">
                <SendIcon />
              </button>
            ) : (
              <button className="send-btn mic" onClick={startRecording} aria-label="Record voice note">
                <MicIcon size={19} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
