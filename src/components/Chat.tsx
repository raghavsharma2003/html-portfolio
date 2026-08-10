// The chat — where the relationship lives. Human typing rhythm, multi-bubble
// replies, photo moments, idle nudges, presence cues.

import { useEffect, useRef, useState } from "react";
import type { AppState, Message } from "../state/store";
import { uid } from "../state/store";
import { think } from "../engine/brain";
import { HER_NAME, OPEN_DIRECTIVE, NUDGE_DIRECTIVE, FOLLOWUP_DIRECTIVE } from "../engine/persona";
import { logTurns, rememberFrom, uploadPhoto, describePhoto } from "../engine/memory";
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
    if (messages.length === 0 && !busy.current && !inCallRef.current) {
      busy.current = true;
      think(user, brainKeys(), [], OPEN_DIRECTIVE(), "chat", "device", true).then((reply) => {
        if (!reply.bubbles.length && !reply.photo) reply = { bubbles: ["heyy"] };
        deliver(reply);
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
        (reply) => {
          if (reply.bubbles.length || reply.photo) deliver(reply);
          else busy.current = false;
        },
      );
    }, 15_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.followup, messages.length]);

  // idle nudge — she double-texts if you go quiet with the app open;
  // the model improvises what she's doing, nothing is scripted
  useEffect(() => {
    const iv = setInterval(() => {
      if (nudged.current || busy.current || inCallRef.current || messages.length < 4) return;
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
        busy.current = false;
        return true;
      }
      return false;
    };
    await sleep(readDelay(incoming));
    if (stale()) return;
    // this is the moment she actually reads you: she pops online, blue ticks
    cameOnline();
    upgradeMyStatus("read");
    const delivered: Message[] = [];
    for (const bubble of reply.bubbles) {
      setTyping(true);
      await sleep(typeDelay(bubble));
      if (stale()) return;
      setTyping(false);
      const msg: Message = { id: uid(), from: "her", kind: "text", text: bubble, at: Date.now() };
      delivered.push(msg);
      pushMsg(msg);
      await sleep(280 + Math.random() * 420);
      if (stale()) return;
    }
    if (reply.voice) {
      setTyping(true);
      await sleep(2200 + Math.random() * 1200); // "recording..." beat
      if (stale()) return;
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
      if (stale()) return;
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
    // claim the conversation SYNCHRONOUSLY — a second Enter during the
    // think() window must not start an interleaved parallel reply
    busy.current = true;
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
    if (state.followup) setState((s) => ({ ...s, followup: null }));
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
    if (busy.current) return;
    busy.current = true; // same synchronous claim as send()
    const packed = await compressImage(file);
    if (!packed || !packed.b64) {
      busy.current = false;
      showNotice("couldn't read that photo — try a different one");
      return;
    }
    const caption = draft.trim();
    setDraft("");
    lastActivity.current = Date.now();
    nudged.current = false;
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
    // permanent copy in storage — the brain's vision reads this URL, and it
    // survives across devices; on upload failure the data URL still works
    const url = await uploadPhoto(state.deviceId, packed.b64, "image/jpeg");
    const publicUrl = url || packed.dataUrl;
    if (url) {
      setState((s) => ({
        ...s,
        messages: s.messages.map((x) => (x.id === mine.id ? { ...x, photoUrl: url } : x)),
      }));
    }
    const brainMine = { ...mine, photoUrl: publicUrl };
    logTurns(state.deviceId, [
      { ...mine, text: caption ? `[photo] ${caption}` : "[photo]" },
    ]);
    const reply = await think(
      user,
      brainKeys(),
      [...messages, brainMine],
      caption ? `[sent a photo] ${caption}` : "[sent a photo]",
    );
    mergeLearned(reply.learned);
    await deliver(reply, caption || "photo");
    // one factual line about the image → her long-term context (fire & forget)
    if (url) {
      describePhoto(state.deviceId, url).then((desc) => {
        if (!desc) return;
        setState((s) => ({
          ...s,
          messages: s.messages.map((x) => (x.id === mine.id ? { ...x, desc } : x)),
        }));
      });
    }
    sendCount.current += 1;
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
            think(user, brainKeys(), [...messages, mine], transcript).then((reply) => {
              mergeLearned(reply.learned);
              deliver(reply, transcript);
            });
          } else {
            showNotice("recording didn't capture — try again");
          }
          return;
        }
        // WhatsApp rule: a recording you hit send on ALWAYS sends
        const mine: Message = {
          id: uid(),
          from: "me",
          kind: "voice",
          text: transcript || "[voice note]",
          dur: secs,
          at: Date.now(),
          status: "sent",
        };
        registerLocalClip(mine.id, blob);
        pushMsg(mine);
        logTurns(state.deviceId, [mine]);
        track(state.deviceId, "voice_note_sent", { dur: secs, heard: Boolean(transcript) }, state.auth?.userId);
        setTimeout(() => upgradeMyStatus("delivered"), 500 + Math.random() * 700);
        lastActivity.current = Date.now();
        nudged.current = false;
        // the brain sees the unclear-audio context; the UI shows a clean bubble
        const brainMine = transcript
          ? mine
          : {
              ...mine,
              text: "[voice note — audio was unclear, you couldn't make out the words. react like a person: ask them to resend or type, casually]",
            };
        think(user, brainKeys(), [...messages, brainMine], brainMine.text).then((reply) => {
          mergeLearned(reply.learned);
          deliver(reply, transcript || "voice note");
        });
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
          <div key={m.id} className="msg her photo" {...swipeHandlers(m)}>
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
              epoch.current += 1; // kill any in-flight reply from the old chat
              setTyping(false);
              track(state.deviceId, "chat_cleared", { count: messages.length }, state.auth?.userId);
              // clearedAt is the synced tombstone: other devices honor it
              // instead of resurrecting the wiped conversation; followup
              // timers from the deleted conversation die with it
              setState((s) => ({ ...s, messages: [], followup: null, clearedAt: Date.now() }));
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
