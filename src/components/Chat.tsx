// The chat — where the relationship lives. Human typing rhythm, multi-bubble
// replies, photo moments, presence cues.

import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import type { AppState, Message } from "../state/store";
import { uid } from "../state/store";
import { think, formatHerLife } from "../engine/brain";
import { HER_NAME, OPEN_DIRECTIVE, FOLLOWUP_DIRECTIVE } from "../engine/persona";
import { logTurns, rememberFrom, uploadPhoto, describePhoto, prefetchRecall } from "../engine/memory";
import { applyInner, wantsForAppraisal } from "../engine/inner";
import { track } from "../engine/account";
import type { HeartReply } from "../engine/localHeart";
import PhotoAvatar from "./PhotoAvatar";
import PhotoCard from "./PhotoCard";
import StoryView from "./StoryView";
import { activeStories, hasUnseenStory } from "../engine/storyCatalog";
import BigEmoji, { isSingleEmoji } from "./BigEmoji";
import VoiceNote, { registerLocalClip } from "./VoiceNote";
import GifBubble from "./GifBubble";
import { listen, sttSupported } from "../voice/speech";
import { tap } from "../native/haptics";
import { PhoneIcon, SendIcon, BroomIcon, TickIcon, MicIcon, CameraIcon } from "./icons";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onVoiceCall: () => void;
  onProfile: () => void;
  // she must never send chat bubbles while actively ON a call with them
  inCall?: boolean;
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

export default function Chat({ state, setState, onVoiceCall, onProfile, inCall }: Props) {
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  // the indicator holds for one exit beat while the bubble enters underneath
  // it — she was typing, now the words are there. Unmounting it on the same
  // frame the message lands is a teleport, and it happens on every reply.
  const [typingOut, setTypingOut] = useState(false);
  const followsTyping = useRef<string[]>([]);
  const TYPING_EXIT_MS = 140;
  const [clearArm, setClearArm] = useState(false);
  // transient inline notice ("couldn't read that photo", "mic access needed")
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4000);
  };
  // chat generation — bumped by clear-chat so an in-flight reply from the
  // old conversation can never ghost into the fresh one
  const epoch = useRef(0);
  // her daily story (insta-style) — viewer open state; ring refreshes on close
  const [storyOpen, setStoryOpen] = useState(false);
  const inCallRef = useRef(false);
  inCallRef.current = Boolean(inCall);
  // WhatsApp-style quote-reply: tap a bubble → reply chip → quoted compose
  const [replySel, setReplySel] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // voice-note recording (mic + live transcription)
  const [recording, setRecording] = useState(false);
  const [recPaused, setRecPaused] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const recRef = useRef<{
    recorder: MediaRecorder | null;
    chunks: Blob[];
    transcript: string;
    stopSR: (() => void) | null;
    srAlive: boolean;
    srFails: number;
    armSR: (() => void) | null;
    timer: ReturnType<typeof setInterval> | null;
    startedAt: number;
    pausedAccum: number;
    pausedAt: number;
  } | null>(null);
  // presence: she is not permanently glued to the phone — she comes online to
  // read/reply, lingers a bit, then drops to "last seen"
  const [herOnline, setHerOnline] = useState(false);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);
  // ── burst-aware reply orchestration ──
  // The user can ALWAYS send (like WhatsApp). Each send schedules a reply
  // cycle behind a short "let them finish typing" debounce; newer messages
  // supersede an in-flight think (she re-reads everything), and messages
  // that arrive while she's typing out a reply get a follow-up cycle after —
  // exactly how a person handles a flurry of texts.
  const messagesRef = useRef(state.messages);
  messagesRef.current = state.messages;
  const chatSeq = useRef(0);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingChat = useRef(false);
  const delivering = useRef(false);
  const dirty = useRef(false); // user messages not yet covered by a reply

  const { messages, user, apiKey, openrouterKey } = state;

  const brainKeys = () => ({
    openrouterKey,
    openrouterModel: state.openrouterModel,
    apiKey,
    deviceId: state.deviceId,
    herLife: formatHerLife(state.herLife),
    // where she actually is: one carried feeling and what she wants. Read
    // only — brain.ts decides whether it reaches the prompt at all.
    inner: state.inner,
  });
  const sendCount = useRef(0);
  // ── reply pacing ──
  // She reads while the model thinks. `lastUserAt` is when they actually hit
  // send, so the read beat and the typing indicator run on HER clock instead
  // of starting fresh whenever the network happens to come back.
  const lastUserAt = useRef(0);
  const typingSince = useRef(0);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (messages.length === 0 && !busy.current && !inCallRef.current) {
      busy.current = true;
      think(user, brainKeys(), [], OPEN_DIRECTIVE(), "chat", "device", true).then(async (reply) => {
        if (!reply.bubbles.length && !reply.photo) reply = { bubbles: ["heyy"] };
        delivering.current = true;
        await deliver(reply);
        delivering.current = false;
        if (dirty.current) void replyCycle(chatSeq.current);
      });
    }
    // re-runs after a chat clear too — she says hi fresh, in her own words
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // her self-scheduled follow-up: "back in 20 min" → when the clock hits,
  // she texts first (survives reloads — the timestamp is persisted)
  useEffect(() => {
    const iv = setInterval(() => {
      const f = state.followup;
      if (!f || busy.current || inCallRef.current || Date.now() < f.at) return;
      const late = Math.round((Date.now() - f.at) / 60000);
      const statedAgo = late < 2 ? "right about now" : `${late} minutes past the time`;
      setState((s) => ({ ...s, followup: null }));
      busy.current = true;
      think(user, brainKeys(), messages, FOLLOWUP_DIRECTIVE(f.why, statedAgo), "chat", "device", true).then(
        async (reply) => {
          if (reply.bubbles.length || reply.photo) {
            delivering.current = true;
            await deliver(reply);
            delivering.current = false;
          } else {
            busy.current = false;
          }
          if (dirty.current) void replyCycle(chatSeq.current);
        },
      );
    }, 15_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.followup, messages.length]);

  // (the idle nudge used to live here — deleted on purpose; see the note
  // where NUDGE_DIRECTIVE was in persona.ts. Her unprompted messages are
  // reason-contingent now, never silence-contingent.)

  // Put her "typing…" up the moment she'd realistically have finished reading,
  // without waiting for the model. The round trip used to be silence the user
  // just sat through; now it's her writing.
  function beginReading(incoming: string, from: number) {
    if (readTimer.current) clearTimeout(readTimer.current);
    const ep = epoch.current;
    readTimer.current = setTimeout(
      () => {
        readTimer.current = null;
        if (ep !== epoch.current || inCallRef.current) return;
        cameOnline();
        upgradeMyStatus("read");
        if (!typingSince.current) typingSince.current = Date.now();
        setTyping(true);
      },
      Math.max(0, readDelay(incoming) - (Date.now() - from)),
    );
  }

  // `keepTyping` is set only by the [search:] holding delivery: the indicator
  // must stay up across the lookup + informed pass (4–6s), because a holding
  // bubble followed by a dead typing indicator reads as distracted, not as
  // thinking. It also keeps `typingSince`, so the first informed bubble gets
  // credit for the time already elapsed instead of paying a full typeDelay.
  async function deliver(
    reply: HeartReply,
    incoming = "",
    readFrom = 0,
    opts: { keepTyping?: boolean } = {},
  ) {
    busy.current = true;
    // deterministic meme throttle — regardless of what the model wants,
    // never two gifs within her last six messages. Context-free meme spam
    // reads as botlike; scarcity is what makes a meme land.
    if (reply.gif) {
      const recentHer = messages.filter((m) => m.from === "her").slice(-6);
      if (recentHer.some((m) => m.kind === "gif")) reply.gif = undefined;
    }
    // if the user clears the chat while she's mid-reply, this delivery is
    // from a conversation that no longer exists — it must vanish with it
    const ep = epoch.current;
    const stale = () => {
      if (ep !== epoch.current) {
        setTyping(false);
        setTypingOut(false);
        typingSince.current = 0;
        busy.current = false;
        return true;
      }
      return false;
    };
    // the indicator leaves, the bubble arrives 90ms into that exit (the CSS
    // carries the delay) — the two read as one object, not two events
    const handoffTyping = async (id: string, last = false) => {
      setTypingOut(true);
      followsTyping.current = [...followsTyping.current.slice(-7), id];
      await sleep(TYPING_EXIT_MS);
      // holding delivery: the last hand-off keeps the indicator up, because
      // she is genuinely still working on the informed reply
      if (!(opts.keepTyping && last)) setTyping(false);
      setTypingOut(false);
    };
    // which hand-off is the final one of this delivery
    const lastMedia = reply.photo ? "photo" : reply.gif ? "gif" : reply.voice ? "voice" : "";
    // the read beat is measured from when THEY sent, so the model's round trip
    // is spent reading rather than stacked on top of it
    const readWait = Math.max(0, readDelay(incoming) - (readFrom ? Date.now() - readFrom : 0));
    if (readWait) await sleep(readWait);
    if (stale()) return;
    // this is the moment she actually reads you: she pops online, blue ticks
    cameOnline();
    upgradeMyStatus("read");
    const delivered: Message[] = [];
    let firstBubble = true;
    for (let bi = 0; bi < reply.bubbles.length; bi++) {
      const bubble = reply.bubbles[bi];
      setTyping(true);
      if (!typingSince.current) typingSince.current = Date.now();
      // the first bubble credits the time the indicator has ALREADY been up —
      // she was typing it while the reply was still coming back
      const typeWait = firstBubble
        ? Math.max(0, typeDelay(bubble) - (Date.now() - typingSince.current))
        : typeDelay(bubble);
      firstBubble = false;
      await sleep(typeWait);
      if (stale()) return;
      const msg: Message = { id: uid(), from: "her", kind: "text", text: bubble, at: Date.now() };
      await handoffTyping(msg.id, !lastMedia && bi === reply.bubbles.length - 1);
      if (stale()) return;
      delivered.push(msg);
      pushMsg(msg);
      await sleep(280 + Math.random() * 420);
      if (stale()) return;
    }
    if (reply.voice) {
      setTyping(true);
      await sleep(2200 + Math.random() * 1200); // "recording..." beat
      if (stale()) return;
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
      await handoffTyping(msg.id, lastMedia === "voice");
      if (stale()) return;
      delivered.push(msg);
      pushMsg(msg);
    }
    if (reply.gif) track(state.deviceId, "gif_sent", { q: reply.gif.query.slice(0, 40) }, state.auth?.userId);
    if (reply.gif) {
      setTyping(true);
      await sleep(900 + Math.random() * 700);
      if (stale()) return;
      const msg: Message = {
        id: uid(),
        from: "her",
        kind: "gif",
        text: reply.gif.query,
        at: Date.now(),
      };
      await handoffTyping(msg.id, lastMedia === "gif");
      if (stale()) return;
      delivered.push(msg);
      pushMsg(msg);
    }
    if (reply.followup) {
      const at = Date.now() + reply.followup.minutes * 60_000;
      setState((s) => ({ ...s, followup: { at, why: reply.followup!.why } }));
    }
    if (delivered.length) logTurns(state.deviceId, delivered);
    if (reply.photo) track(state.deviceId, "photo_sent", { seed: reply.photo.seed.slice(0, 40) }, state.auth?.userId);
    if (reply.photo) {
      setTyping(true);
      await sleep(1600);
      if (stale()) return;
      const photo: Message = {
        id: uid(),
        from: "her",
        kind: "photo",
        text: reply.photo.caption,
        photoSeed: reply.photo.seed,
        at: Date.now(),
      };
      await handoffTyping(photo.id, lastMedia === "photo");
      if (stale()) return;
      pushMsg(photo);
    }
    // holding delivery: keep the elapsed-time credit too, so the first
    // informed bubble doesn't pay a full typeDelay on top of the lookup
    if (!opts.keepTyping) typingSince.current = 0;
    busy.current = false;
  }

  // schedule a reply cycle after a short burst-wait; every newer message
  // resets the wait and supersedes any in-flight thinking
  function scheduleReply(hint = "") {
    dirty.current = true;
    lastUserAt.current = Date.now();
    // the graph lookup starts now, so its round trip is spent inside the
    // burst-wait instead of in front of the model call. `hint` is the message
    // just pushed — state hasn't re-rendered yet, so messagesRef is one behind.
    prefetchRecall(state.deviceId, hint || lastUserText());
    const seq = ++chatSeq.current;
    if (burstTimer.current) clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(() => void replyCycle(seq), 1300);
  }

  function lastUserText(): string {
    const hist = messagesRef.current;
    for (let i = hist.length - 1; i >= 0; i--) {
      const m = hist[i];
      if (m.from === "me" && m.channel !== "call") return m.text;
    }
    return "";
  }

  async function replyCycle(seq: number): Promise<void> {
    if (seq !== chatSeq.current || inCallRef.current) return; // superseded
    if (thinkingChat.current) return; // running cycle chains the newest seq
    if (delivering.current) return; // deliver-end chains a follow-up
    if (busy.current) return; // directive cycle in flight — dirty chains after
    const ep = epoch.current;
    thinkingChat.current = true;
    busy.current = true;
    dirty.current = false;
    const latest = lastUserText();
    const readFrom = lastUserAt.current || Date.now();
    beginReading(latest, readFrom);
    // [search:] turns: her holding bubble is delivered while the lookup runs
    const holdingDeliver = async (r: HeartReply) => {
      if (seq !== chatSeq.current || ep !== epoch.current) return;
      delivering.current = true;
      // the indicator stays up (and keeps its elapsed-time credit) across the
      // lookup + informed pass — she said "ruk dekh ke batati hu" and is
      // visibly still on it, instead of going quiet for 4–6s
      await deliver(r, latest, readFrom, { keepTyping: true });
      delivering.current = false;
      busy.current = true; // deliver() clears it; this think is still running
    };
    const reply = await think(
      user,
      brainKeys(),
      messagesRef.current,
      latest,
      "chat",
      "device",
      false,
      undefined,
      undefined,
      undefined,
      holdingDeliver,
    );
    thinkingChat.current = false;
    if (ep !== epoch.current) {
      busy.current = false;
      return; // chat was cleared mid-think
    }
    if (seq !== chatSeq.current) {
      // they kept texting while she read — re-read EVERYTHING, reply once
      return replyCycle(chatSeq.current);
    }
    mergeLearned(reply.learned);
    delivering.current = true;
    await deliver(reply, latest, readFrom);
    delivering.current = false;
    if (dirty.current && ep === epoch.current) {
      // messages landed while she was typing — she notices and follows up
      return replyCycle(chatSeq.current);
    }
    busy.current = false;
    // periodically distill the conversation into her graph memory, and keep
    // what she claimed about HER own life — off the hot path, one extraction
    // call that was already happening, no extra round trip per turn
    sendCount.current += 1;
    if (sendCount.current % 3 === 0) {
      // the SAME call also appraises where this stretch left her — one
      // judgment pass, so her facts, her wants and her feeling can never
      // contradict each other, and no extra round trip exists to pay for
      rememberFrom(state.deviceId, messagesRef.current, wantsForAppraisal(state.inner)).then(
        ({ self, inner }) => {
          if (!self.length && !inner) return;
          setState((s) => {
            const at = Date.now();
            const seen = new Set<string>();
            return {
              ...s,
              herLife: self.length
                ? [...self.map((text) => ({ text, at })), ...(s.herLife || [])]
                    .filter((f) => {
                      const k = f.text.toLowerCase();
                      if (seen.has(k)) return false;
                      seen.add(k);
                      return true;
                    })
                    // formatHerLife renders 12 — storing more than that is
                    // just localStorage nobody reads
                    .slice(0, 12)
                : s.herLife,
              inner: inner ? applyInner(s.inner, inner, at) : s.inner,
            };
          });
        },
      );
    }
  }

  function send() {
    const text = draft.trim();
    if (!text) return; // sending is NEVER blocked — she adapts, like a person
    setDraft("");
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
    if (state.followup) setState((s) => ({ ...s, followup: null }));
    pushMsg(mine);
    logTurns(state.deviceId, [mine]);
    track(state.deviceId, "message_sent", { len: text.length, quoted: Boolean(mine.replyTo) }, state.auth?.userId);
    // single tick → double tick shortly after (server delivery rhythm)
    setTimeout(() => upgradeMyStatus("delivered"), 500 + Math.random() * 700);
    scheduleReply(text);
  }

  // ── sending HER a photo (camera or gallery): compress client-side, show
  // instantly, upload to storage, then she looks at the actual image with
  // the whole conversation as context ──
  const fileRef = useRef<HTMLInputElement>(null);

  async function compressImage(file: File): Promise<{ dataUrl: string; b64: string } | null> {
    try {
      const src = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej();
        img.src = src;
      });
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(src);
      const dataUrl = c.toDataURL("image/jpeg", 0.82);
      return { dataUrl, b64: dataUrl.split(",")[1] || "" };
    } catch {
      return null;
    }
  }

  async function sendPhoto(file: File) {
    const packed = await compressImage(file);
    if (!packed || !packed.b64) {
      showNotice("couldn't read that photo — try a different one");
      return;
    }
    const caption = draft.trim();
    setDraft("");
    const mine: Message = {
      id: uid(),
      from: "me",
      kind: "photo",
      text: caption,
      photoUrl: packed.dataUrl, // instant local render; swapped after upload
      at: Date.now(),
      status: "sent",
      ...(replyTo ? { replyTo: { from: replyTo.from, text: replyTo.text } } : {}),
    };
    setReplyTo(null);
    if (state.followup) setState((s) => ({ ...s, followup: null }));
    pushMsg(mine);
    track(state.deviceId, "photo_shared", { caption: Boolean(caption) }, state.auth?.userId);
    setTimeout(() => upgradeMyStatus("delivered"), 500 + Math.random() * 700);
    logTurns(state.deviceId, [
      { ...mine, text: caption ? `[photo] ${caption}` : "[photo]" },
    ]);
    // the photo joins the same burst pipeline as text — she sees it (vision
    // reads the local data URL until the storage upload lands) and can fold
    // it into one reply with whatever else you're sending
    scheduleReply(caption);
    // background: permanent copy in storage (survives devices) + one factual
    // line about the image for her long-term context
    uploadPhoto(state.deviceId, packed.b64, "image/jpeg").then((url) => {
      if (!url) return;
      setState((s) => ({
        ...s,
        messages: s.messages.map((x) => (x.id === mine.id ? { ...x, photoUrl: url } : x)),
      }));
      describePhoto(state.deviceId, url).then((desc) => {
        if (!desc) return;
        setState((s) => ({
          ...s,
          messages: s.messages.map((x) => (x.id === mine.id ? { ...x, desc } : x)),
        }));
      });
    });
  }

  // WhatsApp/Telegram swipe-to-reply, tuned to Telegram's source numbers:
  // 10px dead zone, ~3x direction lock, 48px trigger with re-armable haptic,
  // damped tracking past the trigger capped at 80px, 180ms decelerate
  // spring-back. touch-action: pan-y on the list keeps scrolling native.
  const swipe = useRef({ x: 0, y: 0, dx: 0, active: false, dead: false, fired: false, startedAt: 0 });
  const release = useRef<{ stop: () => void } | null>(null);
  function swipeHandlers(m: Message) {
    return {
      onTouchStart: (e: React.TouchEvent) => {
        release.current?.stop(); // a new grab always beats the spring-back
        release.current = null;
        const t = e.touches[0];
        // browser back/forward gesture zone — leave edge touches alone
        const dead = t.clientX < 20 || t.clientX > window.innerWidth - 20;
        swipe.current = {
          x: t.clientX,
          y: t.clientY,
          dx: 0,
          active: false,
          dead,
          fired: false,
          startedAt: Date.now(),
        };
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
            tap(); // a commit threshold you cannot see mid-gesture
          }
        } else {
          s.fired = false; // re-arm like Telegram
        }
      },
      onTouchEnd: (e: React.TouchEvent) => {
        const s = swipe.current;
        const el = e.currentTarget as HTMLElement;
        // the release inherits the velocity the finger had: a flick returns
        // fast, a slow drag returns slowly. Bounce 0.12 is the low end of
        // the sanctioned range and is correct here — the gesture carried
        // momentum, so a little overshoot reads as physical.
        el.style.transition = "none";
        if (s.active) {
          const v = s.dx / Math.max(1, Date.now() - s.startedAt); // px/ms
          release.current = animate(
            el,
            { transform: "translateX(0px)" },
            { type: "spring", duration: 0.42, bounce: 0.12, velocity: v * 1000 },
          );
        } else {
          el.style.transform = "";
        }
        if (s.active && Math.abs(s.dx) >= 48) {
          setReplyTo(m);
          setReplySel(null);
        }
        swipe.current = { x: 0, y: 0, dx: 0, active: false, dead: false, fired: false, startedAt: 0 };
      },
    };
  }

  async function startRecording() {
    if (recording) return; // recording is never blocked by her reply state
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const st = {
        recorder,
        chunks: [] as Blob[],
        transcript: "",
        stopSR: null as (() => void) | null,
        srAlive: true,
        srFails: 0,
        armSR: null as (() => void) | null,
        timer: null as ReturnType<typeof setInterval> | null,
        startedAt: Date.now(),
        pausedAccum: 0,
        pausedAt: 0,
      };
      recRef.current = st;
      recorder.ondataavailable = (e) => e.data.size && st.chunks.push(e.data);
      // a dying recorder (mic revoked, device unplugged) must not brick the
      // rec-bar — end cleanly, the send path salvages what it can
      recorder.onerror = () => {
        if (recRef.current === st) finishRecording(true);
      };
      recorder.start(250);
      // live transcription runs alongside the recording, re-arming on
      // silence — with a failure cap so a broken recognizer can't hot-loop
      // for the whole note (the audio itself keeps recording regardless)
      const arm = () => {
        if (!st.srAlive) return;
        const startedAt = Date.now();
        const res = listen(
          (text, final) => {
            st.srFails = 0;
            if (final && text) st.transcript = (st.transcript + " " + text).trim();
          },
          (reason?: string) => {
            if (!st.srAlive || reason === "not-allowed") return;
            if (Date.now() - startedAt < 1000) st.srFails += 1;
            else st.srFails = 0;
            if (st.srFails >= 4) return; // transcription is broken here; stop churning
            setTimeout(arm, 250);
          },
        );
        st.stopSR = res.stop || null;
      };
      st.armSR = arm;
      arm();
      st.timer = setInterval(() => {
        const pausedNow = st.pausedAt ? Date.now() - st.pausedAt : 0;
        setRecSecs(Math.max(0, Math.round((Date.now() - st.startedAt - st.pausedAccum - pausedNow) / 1000)));
      }, 400);
      setRecSecs(0);
      setRecPaused(false);
      setRecording(true);
      tap(); // confirms the mic opened before you start talking
    } catch {
      showNotice("mic access needed — allow the microphone and try again");
    }
  }

  function togglePauseRecording() {
    const st = recRef.current;
    if (!st?.recorder) return;
    if (st.pausedAt) {
      st.pausedAccum += Date.now() - st.pausedAt;
      st.pausedAt = 0;
      try {
        st.recorder.resume();
      } catch {
        /* ignore */
      }
      st.srAlive = true;
      st.srFails = 0;
      st.armSR?.(); // re-arm transcription (same capped loop as recording start)
      setRecPaused(false);
    } else {
      st.pausedAt = Date.now();
      try {
        st.recorder.pause();
      } catch {
        /* ignore */
      }
      st.srAlive = false;
      st.stopSR?.();
      setRecPaused(true);
    }
  }

  function finishRecording(sendIt: boolean) {
    const st = recRef.current;
    if (!st) return;
    st.srAlive = false;
    try {
      st.stopSR?.();
    } catch {
      /* recognizer already dead */
    }
    if (st.timer) clearInterval(st.timer);
    const pausedNow = st.pausedAt ? Date.now() - st.pausedAt : 0;
    const secs = Math.max(1, Math.round((Date.now() - st.startedAt - st.pausedAccum - pausedNow) / 1000));
    const releaseMic = () => {
      try {
        st.recorder!.stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* track already stopped */
      }
    };
    const finalize = () => {
      if (!sendIt) return;
      // give the recognizer a beat to flush its final result
      setTimeout(() => {
        const transcript = st.transcript.trim();
        const blob = new Blob(st.chunks, { type: st.recorder?.mimeType || "audio/webm" });
        if (!blob.size) {
          // no audio came out of the recorder. If we at least HEARD words,
          // the message still sends (as text) — effort is never lost.
          if (transcript) {
            const mine: Message = {
              id: uid(),
              from: "me",
              kind: "text",
              text: transcript,
              at: Date.now(),
              status: "sent",
            };
            pushMsg(mine);
            logTurns(state.deviceId, [mine]);
            setTimeout(() => upgradeMyStatus("delivered"), 500 + Math.random() * 700);
            scheduleReply(transcript);
          } else {
            showNotice("recording didn't capture — try again");
          }
          return;
        }
        // WhatsApp rule: a recording you hit send on ALWAYS sends. When the
        // audio was unintelligible, the stored text carries the unclear-audio
        // context for her brain — voice bubbles never display their text.
        const mine: Message = {
          id: uid(),
          from: "me",
          kind: "voice",
          text:
            transcript ||
            "[voice note — audio was unclear, you couldn't make out the words. react like a person: ask them to resend or type, casually]",
          dur: secs,
          at: Date.now(),
          status: "sent",
        };
        registerLocalClip(mine.id, blob);
        pushMsg(mine);
        logTurns(state.deviceId, [mine]);
        track(state.deviceId, "voice_note_sent", { dur: secs, heard: Boolean(transcript) }, state.auth?.userId);
        setTimeout(() => upgradeMyStatus("delivered"), 500 + Math.random() * 700);
        scheduleReply(mine.text); // voice notes join the same burst pipeline
      }, 600);
    };
    st.recorder!.onstop = () => {
      releaseMic();
      finalize();
    };
    try {
      // an already-dead recorder (error path, revoked mic) never fires
      // onstop — finalize directly so the rec-bar can't brick the chat
      if (st.recorder!.state !== "inactive") {
        st.recorder!.stop();
      } else {
        releaseMic();
        finalize();
      }
    } catch {
      releaseMic();
      finalize();
    }
    recRef.current = null;
    setRecording(false);
    setRecPaused(false);
  }

  // render with day separators; timestamp only on the last bubble of a
  // same-sender group (research: uncluttered = intimate)
  // call turns never render — a call is spoken, not written. Only the
  // "📞 Voice call" record shows (she still remembers everything said).
  const visible = messages.filter((m) => m.channel !== "call");
  // a bubble that took over from the typing indicator waits one exit beat
  // before it starts (the delay lives in CSS)
  const followsAttr = (m: Message) =>
    m.from === "her" && followsTyping.current.includes(m.id)
      ? { "data-follows-typing": "" }
      : {};
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
        <div key={m.id} className={`msg ${m.from} voice`} {...followsAttr(m)} {...swipeHandlers(m)}>
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
        <div key={m.id} className={`msg ${m.from} gifmsg`} {...followsAttr(m)} {...swipeHandlers(m)}>
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
        m.from === "me" ? (
          <div key={m.id} className="msg me photo" {...swipeHandlers(m)}>
            {m.photoUrl && <img className="pimg" src={m.photoUrl} alt="" draggable={false} />}
            {m.text && <div className="cap">{m.text}</div>}
            <span className="t">
              {fmtTime(m.at)}
              <TickIcon status={m.status ?? "read"} />
            </span>
          </div>
        ) : (
          <div key={m.id} className="msg her photo" {...followsAttr(m)} {...swipeHandlers(m)}>
            <PhotoCard seed={m.photoSeed || m.text} />
            <div className="cap">{m.text}</div>
          </div>
        ),
      );
    } else {
      const emojiOnly = isSingleEmoji(m.text);
      rows.push(
        <div
          key={m.id}
          className={`msg ${m.from} ${emojiOnly ? "emoji-big" : ""} ${replySel === m.id ? "sel" : ""}`}
          onClick={() => setReplySel((cur) => (cur === m.id ? null : m.id))}
          {...followsAttr(m)}
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
              <span className="qtext">{m.replyTo.text.slice(0, 120)}</span>
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

  const stories = activeStories();
  const storyLive = stories.length > 0;
  const storyUnseen = hasUnseenStory();

  return (
    <div className="chat">
      <div className="chat-head">
        <div
          className={`avatar-ring ${storyLive ? (storyUnseen ? "story-live" : "story-seen") : ""}`}
          style={{ width: 48, height: 48, padding: 2.5, animationDuration: "20s" }}
          onClick={() => {
            // insta mechanics: an active story opens from the avatar; the
            // account sheet stays reachable via ⋯ inside the viewer (and
            // directly here when no story is live)
            if (storyLive) {
              setStoryOpen(true);
              track(state.deviceId, "story_open", { unseen: storyUnseen }, state.auth?.userId);
            } else {
              onProfile();
            }
          }}
          role="button"
          aria-label={storyLive ? "View her story" : "Account"}
        >
          <div className="inner" style={{ animationDuration: "20s" }}>
            <PhotoAvatar size={43} />
          </div>
        </div>
        <div className="who">
          <div className="name">{HER_NAME}</div>
          {/* ONE node whose contents change — typing → online → last seen
              dissolves. Rendering three sibling nodes would remount the
              element and the transition would never run. */}
          <div className={`status ${typing ? "typing" : ""}`}>
            {typing ? (
              "typing…"
            ) : herOnline ? (
              <>
                <span className="dot" /> online
              </>
            ) : (
              `last seen ${lastSeenLabel(state.lastSeen)}`
            )}
          </div>
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
              busy.current = false;
              epoch.current += 1; // kill any in-flight reply from the old chat
              if (readTimer.current) clearTimeout(readTimer.current);
              typingSince.current = 0;
              setTyping(false);
              track(state.deviceId, "chat_cleared", { count: messages.length }, state.auth?.userId);
              // clearedAt is the synced tombstone: other devices honor it
              // instead of resurrecting the wiped conversation; followup
              // timers from the deleted conversation die with it
              // her improvised life belonged to that conversation too
              setState((s) => ({
                ...s,
                messages: [],
                followup: null,
                herLife: [],
                // her interior belonged to that conversation too — a feeling
                // whose cause has been deleted is exactly the causeless mood
                // this whole design exists to make impossible
                inner: undefined,
                clearedAt: Date.now(),
              }));
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
          <div className="typing-bubble" {...(typingOut ? { "data-leaving": "" } : {})}>
            <i />
            <i />
            <i />
          </div>
        )}
        <div style={{ height: 6 }} />
      </div>

      {storyOpen && (
        <StoryView
          stories={stories}
          signedIn={Boolean(state.auth)}
          onSignIn={() => {
            setStoryOpen(false);
            onProfile();
          }}
          onClose={() => setStoryOpen(false)}
          onProfile={() => {
            setStoryOpen(false);
            onProfile();
          }}
        />
      )}
      {notice && <div className="chat-notice">{notice}</div>}
      {replyTo && (
        <div className="reply-bar">
          <div className="quote">
            <b>{replyTo.from === "her" ? HER_NAME : "You"}</b>
            <span className="qtext">{replyTo.text.slice(0, 120)}</span>
          </div>
          <button className="reply-x" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
            ×
          </button>
        </div>
      )}
      <div className="chat-input-row">
        {recording ? (
          <div className="rec-bar">
            <span className={`rec-dot ${recPaused ? "paused" : ""}`} />
            <span className="rec-time">
              {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, "0")}
              {recPaused ? " · paused" : " · recording…"}
            </span>
            <button className="rec-cancel" onClick={() => finishRecording(false)}>
              cancel
            </button>
            <button
              className="rec-pause"
              onClick={togglePauseRecording}
              aria-label={recPaused ? "Resume recording" : "Pause recording"}
            >
              {recPaused ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11-7.2c.6-.4.6-1.4 0-1.8l-11-7.2c-.7-.4-1.6.1-1.6.9Z" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="5" y="4" width="5" height="16" rx="1.5" />
                  <rect x="14" y="4" width="5" height="16" rx="1.5" />
                </svg>
              )}
            </button>
            <button className="send-btn" onClick={() => finishRecording(true)} aria-label="Send voice note">
              <SendIcon />
            </button>
          </div>
        ) : (
          <div className="chat-input">
            <button
              className="attach-btn"
              onClick={() => fileRef.current?.click()}
              aria-label="Send a photo"
            >
              <CameraIcon size={21} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) sendPhoto(f);
                e.target.value = "";
              }}
            />
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
            {draft.trim() || !sttSupported() ? (
              <button className={`send-btn ${draft.trim() ? "" : "off"}`} onClick={send} aria-label="Send">
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
