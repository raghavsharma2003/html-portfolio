// The chat — where the relationship lives. Human typing rhythm, multi-bubble
// replies, photo moments, presence cues.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate } from "framer-motion";
import "../styles/thread.css";
import type { AppState, Message } from "../state/store";
import { uid } from "../state/store";
import { think, formatHerLife } from "../engine/brain";
import { activityOf } from "../state/game";
import {
  HER_NAME,
  OPEN_DIRECTIVE,
  FOLLOWUP_DIRECTIVE,
  AFTERCALL_DIRECTIVE,
} from "../engine/persona";
import type { Story } from "../engine/storyCatalog";
import {
  logTurns,
  rememberFrom,
  uploadPhoto,
  describePhoto,
  prefetchRecall,
  forgetMemories,
  messagesAfterForget,
} from "../engine/memory";
import { applyInner, wantsForAppraisal } from "../engine/inner";
import { burstWaitMs, recentUserGaps } from "../engine/burst";
import { track } from "../engine/account";
import { tel, telFlush, createComposeTracker } from "../engine/telemetry";
import type { HeartReply } from "../engine/localHeart";
import PhotoAvatar from "./PhotoAvatar";
import StoryView from "./StoryView";
import { activeStories, hasUnseenStory, storySrc } from "../engine/storyCatalog";
import MessageRow, { type RowApi } from "./MessageRow";
import { fmtTime } from "./fmtTime";
import { registerLocalClip } from "./VoiceNote";
import { ChessIcon } from "./GamesHub";
import { listen, sttSupported } from "../voice/speech";
import { tap } from "../native/haptics";
import MoreSheet from "./MoreSheet";
import {
  PhoneIcon,
  SendIcon,
  MicIcon,
  CameraIcon,
  MoreIcon,
  ArrowDownIcon,
  OfflineIcon,
} from "./icons";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onVoiceCall: () => void;
  onProfile: () => void;
  /** open the "things to do together" sheet — one tap from the chat header */
  onGames: () => void;
  /** open the Us screen — the relationship made visible. Entry is the header
   *  NAME (the Snapchat-friendship-profile idiom); the avatar keeps stories. */
  onUs: () => void;
  // she must never send chat bubbles while actively ON a call with them
  inCall?: boolean;
}

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
/**
 * How long after a call she may text about it.
 *
 * The floor is not politeness, it is meaning: a message 30 seconds after
 * hanging up is the call continuing by other means, not a second thought. The
 * ceiling exists so a call from this morning cannot produce an "about earlier"
 * text tonight, which would read as brooding rather than as human.
 */
const AFTERCALL_MIN_MS = 4 * 60_000;
const AFTERCALL_MAX_MS = 40 * 60_000;

const typeDelay = (bubble: string) => {
  const jitter = 0.8 + Math.random() * 0.5;
  return Math.min(3500, Math.max(500, bubble.length * 66 * jitter));
};

export default function Chat({ state, setState, onVoiceCall, onProfile, onGames, onUs, inCall }: Props) {
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  // the indicator holds for one exit beat while the bubble enters underneath
  // it — she was typing, now the words are there. Unmounting it on the same
  // frame the message lands is a teleport, and it happens on every reply.
  const [typingOut, setTypingOut] = useState(false);
  const followsTyping = useRef<string[]>([]);
  const TYPING_EXIT_MS = 140;
  // the settings sheet (profile, account, clear chat) — everything that used
  // to be either unreachable or one mis-tap away from destroying the chat
  const [moreOpen, setMoreOpen] = useState(false);
  // clearing parks the conversation for ten seconds instead of destroying it
  type Snapshot = Pick<AppState, "messages" | "herLife" | "inner" | "clearedAt" | "game" | "callback" | "tally" | "momentsFired">;
  const [undo, setUndo] = useState<{ label: string; snapshot: Snapshot } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Forgetting parks the REQUEST, not just the local state: the server-side
  // delete is irreversible, so nothing is sent until the ten seconds are up.
  // Undo drops this; leaving the screen runs it, because walking away is not
  // taking it back — and a local wipe with the rows still on the server is
  // the worst of both, she'd look forgotten and still know everything.
  const pendingForget = useRef<(() => void) | null>(null);
  // reported, never enforced: navigator.onLine and its two events, no fetch.
  // Sending is never blocked — she answers when the line comes back.
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
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
  // the thread is one tab stop; this is where focus sits inside it
  const [focusedMid, setFocusedMid] = useState("");
  // which of her voice notes have been played on this device — the unheard
  // affordance stops asking the moment you have heard it
  const [playedVoice, setPlayedVoice] = useState<Set<string>>(() => new Set());
  // presence: she is not permanently glued to the phone — she comes online to
  // read/reply, lingers a bit, then drops to "last seen"
  const [herOnline, setHerOnline] = useState(false);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // keystroke dynamics for the composer. One tracker for the life of the
  // screen; it rolls itself up every 2s and on send, and NEVER emits per
  // keystroke — see the note on the hot path in telemetry.ts.
  const composer = useRef(createComposeTracker("chat.composer")).current;
  // scroll ownership: while you are at the bottom the thread follows her.
  // The moment you scroll back to re-read something it stops following and
  // offers to catch you up instead. (Before this, every arriving bubble
  // yanked a forty-message scrollback back to the floor.)
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [missed, setMissed] = useState(0);
  const busy = useRef(false);
  // ── how much of the thread exists in the DOM ──────────────────────────
  //
  // 80 rows is roughly four screens at the densest bubble size, so the tail
  // window is never the reason something is missing when you flick up; past
  // that it is deliberate scrollback and it can pay one tap for itself.
  //
  // The extended window is anchored by the ID of its oldest row, not by a
  // count. A count would be re-derived from the END of the list, so every
  // message that arrived while you were reading scrollback would push one row
  // out of the top and shift everything on screen by its height. An id cannot
  // do that: arrivals land below it and nothing visible moves.
  const WINDOW_STEP = 80;
  const [anchorId, setAnchorId] = useState<string | null>(null);
  // The row callbacks, indirected through a ref. `rowApi` never changes
  // identity (that is the whole point — see MessageRow.tsx); the ref it calls
  // through is rewritten on every render, so no handler is ever stale.
  const rowHandlers = useRef<RowApi>(null as unknown as RowApi);
  const rowApi = useMemo<RowApi>(
    () => ({
      toggleSelect: (id) => rowHandlers.current.toggleSelect(id),
      clearSelect: () => rowHandlers.current.clearSelect(),
      react: (m, emoji) => rowHandlers.current.react(m, emoji),
      replyTo: (m) => rowHandlers.current.replyTo(m),
      focusRow: (id) => rowHandlers.current.focusRow(id),
      moveFocus: (id, dir) => rowHandlers.current.moveFocus(id, dir),
      voicePlayed: (id) => rowHandlers.current.voicePlayed(id),
      gifResolved: (id, url) => rowHandlers.current.gifResolved(id, url),
      jumpToQuoted: (m) => rowHandlers.current.jumpToQuoted(m),
      swipe: (m) => rowHandlers.current.swipe(m),
    }),
    [],
  );
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
    // WHAT THEY ARE DOING. Same derivation the call lane reads, from the same
    // field — that is the point of `activityOf` living in state/game.ts rather
    // than in either lane. A game paused to type a message is still a game, so
    // she can be mid-board in chat and pick the call up already knowing where
    // it stands. Null when nothing is going on, which renders zero bytes and
    // leaves every byte-identity fixture untouched.
    activity: activityOf(state.game),
    // #117 — the milestone that just crossed, if any; brain.ts owns freshness
    moment: state.recentMoment ?? null,
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

  /**
   * Put (or clear) one emoji on one message. Both directions land here: his tap
   * on her bubble, and her `[react: X]` marker on his. One shared writer, so a
   * reaction cannot mean two different things depending on who sent it.
   */
  const setReaction = (id: string, emoji: string | undefined) =>
    setState((s) => ({
      ...s,
      messages: s.messages.map((m) => (m.id === id ? { ...m, reaction: emoji } : m)),
    }));

  /** The last thing HE said — what her `[react:]` lands on. */
  const lastMineId = (): string | null => {
    const hist = messagesRef.current;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].from === "me" && hist[i].channel !== "call") return hist[i].id;
    }
    return null;
  };

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

  // ── scroll ownership ──────────────────────────────────────────────────
  // "Near the bottom" is 120px, which is roughly one bubble: if the last
  // thing on screen is the newest message you are still following the
  // conversation, and the thread should keep up with her. Past that you are
  // reading, and nothing may move the viewport but you.
  const NEAR_BOTTOM = 120;
  const measureBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM;
  };
  const toBottom = (behavior: ScrollBehavior = "smooth") => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior });
    atBottom.current = true;
    setShowJump(false);
    setMissed(0);
  };

  // ── extending the window without moving the thread ────────────────────
  // Rows are added ABOVE what is on screen, so the invariant to preserve is
  // the distance from the BOTTOM, not scrollTop. Measured before the state
  // change, restored in a layout effect — i.e. after React commits the new
  // rows and before the browser paints, so there is no frame in which the
  // conversation has jumped.
  const anchorFromBottom = useRef<number | null>(null);
  /** Message id to scroll to once it is inside the window. */
  const revealPending = useRef<string | null>(null);
  const holdScroll = () => {
    const el = scrollRef.current;
    anchorFromBottom.current = el ? el.scrollHeight - el.scrollTop : null;
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorFromBottom.current;
    anchorFromBottom.current = null;
    if (el && anchor != null) el.scrollTop = el.scrollHeight - anchor;
    const want = revealPending.current;
    revealPending.current = null;
    if (el && want) {
      // `data-row` rather than `data-mid`: every row kind carries it, so a
      // photo or a voice note can be jumped to as well. Focus is only moved
      // when the row is actually focusable, which is the text bubbles.
      const target = el.querySelector<HTMLElement>(`[data-row="${CSS.escape(want)}"]`);
      target?.scrollIntoView({ block: "center" });
      if (target?.dataset.mid) target.focus({ preventScroll: true });
    }
  }, [anchorId]);

  // one passive listener; the read is a single layout query per scroll frame
  // and it never writes, so it cannot thrash
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = measureBottom();
      if (near === atBottom.current) return;
      atBottom.current = near;
      if (near) {
        setShowJump(false);
        setMissed(0);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // An unsent draft that leaves with the screen (or with the page) is an
  // abandoned one, and abandonment is the compose signal that has no other
  // trace anywhere — the draft simply ceases to exist.
  useEffect(() => {
    const leave = () => {
      composer.leave();
      telFlush("beacon");
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      composer.leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── chat.read: which bubbles were actually looked at, and for how long ──
  // Message ids and dwell only; the observer never touches text. Rolled up on
  // a 3s beat so a fast scroll through forty messages is one record, not
  // forty. IntersectionObserver rather than scroll math: it costs nothing per
  // frame and this thread can hold five hundred bubbles.
  const dwell = useRef(new Map<string, number>());
  const readSeen = useRef(new Map<string, number>());
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const t = Date.now();
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.mid;
          if (!id) continue;
          if (e.isIntersecting) readSeen.current.set(id, t);
          else {
            const from = readSeen.current.get(id);
            if (from) {
              readSeen.current.delete(id);
              dwell.current.set(id, (dwell.current.get(id) ?? 0) + (t - from));
            }
          }
        }
      },
      { root, threshold: 0.6 },
    );
    const attach = () => {
      for (const el of root.querySelectorAll("[data-mid]")) io.observe(el);
    };
    attach();
    // the thread re-renders constantly; re-attaching on a beat is cheaper and
    // simpler than tracking every arrival, and a bubble missed for 1.5s is a
    // bubble that was not being read anyway
    const reattach = setInterval(attach, 1500);
    const iv = setInterval(() => {
      // a bubble that came into view and STAYED there is the most-read bubble
      // there is; billing dwell only on exit reported nothing at all for the
      // message someone sat and looked at
      const t = Date.now();
      for (const [id, from] of readSeen.current) {
        dwell.current.set(id, (dwell.current.get(id) ?? 0) + (t - from));
        readSeen.current.set(id, t);
      }
      if (!dwell.current.size) return;
      const ids = [...dwell.current.keys()].slice(0, 30);
      const ms = ids.map((i) => Math.round(dwell.current.get(i) ?? 0));
      dwell.current.clear();
      tel("chat.read", { msg_ids: ids, dwell_ms: ms, n: ids.length });
    }, 3000);
    // copy is a first-class signal (they wanted to keep something she said)
    // and it is recorded as a LENGTH — the text is already in meera_log
    const onCopy = () => {
      const sel = window.getSelection?.()?.toString() ?? "";
      tel("chat.copy", { chars: sel.length });
    };
    root.addEventListener("copy", onCopy);
    return () => {
      io.disconnect();
      clearInterval(iv);
      clearInterval(reattach);
      root.removeEventListener("copy", onCopy);
    };
  }, []);

  // follow the conversation only while it is being followed
  const lastLen = useRef(messages.length);
  useEffect(() => {
    const grew = messages.length > lastLen.current;
    const arrivals = messages.length - lastLen.current;
    lastLen.current = messages.length;
    if (atBottom.current) {
      scrollRef.current?.scrollTo({ top: 1e9, behavior: grew ? "smooth" : "auto" });
    } else if (grew) {
      const fromHer = messages[messages.length - 1]?.from === "her";
      setShowJump(true);
      if (fromHer) setMissed((n) => n + Math.max(1, arrivals));
    }
  }, [messages.length]);

  // ── an image that finishes loading is a height change ──────────────────
  //
  // A photo bubble has an aspect-ratio box now, so the reserved height is
  // right before the bytes arrive — but "right" only for the ratio it was
  // given, and nothing reserves height for a quote thumbnail or an animated
  // emoji at all. Any of them landing while the thread is pinned to the
  // bottom pushes the newest message off the bottom edge, which is the
  // "chat opens 187px short" failure by a slower route.
  //
  // Capture phase, on the scroller: `load` does not bubble, and delegating is
  // what lets this cover images inside components this workstream does not
  // own (PhotoCard, GifBubble, BigEmoji) without a prop threaded through each.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onLoad = (e: Event) => {
      if (!(e.target instanceof HTMLImageElement)) return;
      if (atBottom.current) el.scrollTo({ top: 1e9, behavior: "auto" });
    };
    el.addEventListener("load", onLoad, true);
    return () => el.removeEventListener("load", onLoad, true);
  }, []);

  // the typing indicator adds height at the bottom — same rule
  useEffect(() => {
    if (typing && atBottom.current) scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [typing]);

  // keyboard open/close resizes the app — keep the conversation pinned to
  // the bottom through it, but only if it was pinned to begin with
  useEffect(() => {
    const onResize = () => {
      if (atBottom.current) scrollRef.current?.scrollTo({ top: 1e9 });
    };
    window.visualViewport?.addEventListener("resize", onResize);
    return () => window.visualViewport?.removeEventListener("resize", onResize);
  }, []);

  // ── connection ────────────────────────────────────────────────────────
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
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

  // ── after a call, she texts ────────────────────────────────────────────
  // The owner: "random text from her side could come like a human and
  // specially after call."
  //
  // REASON-CONTINGENT, which is what makes it shippable at all. The idle nudge
  // that used to live in this file was deleted because it fired on SILENCE —
  // making her message an unpredictable reward on the cue of not-replying,
  // which is the one shape of proactivity that cannot be made honest. This
  // fires on a CALL HAVING HAPPENED: an event in the world, not a fact about
  // his attention. See the note where NUDGE_DIRECTIVE was in persona.ts.
  //
  // Once per call, and only if he has not already texted since it ended —
  // if he spoke first there is nothing to re-open.
  const afterCallDone = useRef<string>("");
  useEffect(() => {
    const iv = setInterval(() => {
      if (busy.current || inCallRef.current) return;
      const hist = messagesRef.current;
      // the most recent call mark, and whether anything has been said since
      let markIdx = -1;
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].kind === "callmark") { markIdx = i; break; }
      }
      if (markIdx < 0) return;
      const mark = hist[markIdx];
      if (afterCallDone.current === mark.id) return;
      // anything at all after the call means the thread is already alive
      if (hist.slice(markIdx + 1).some((m) => m.channel !== "call")) {
        afterCallDone.current = mark.id;
        return;
      }
      const agoMs = Date.now() - mark.at;
      // Long enough that it reads as a second thought rather than the call
      // continuing by other means; short enough to still be about the call.
      if (agoMs < AFTERCALL_MIN_MS || agoMs > AFTERCALL_MAX_MS) return;
      afterCallDone.current = mark.id;
      busy.current = true;
      think(
        user,
        brainKeys(),
        hist,
        AFTERCALL_DIRECTIVE(mark.text || "0:00", Math.round(agoMs / 60_000)),
        "chat",
        "device",
        true,
      ).then(async (reply) => {
        if (reply.bubbles.length || reply.photo) {
          delivering.current = true;
          await deliver(reply);
          delivering.current = false;
        } else {
          busy.current = false;
        }
        if (dirty.current) void replyCycle(chatSeq.current);
      });
    }, 20_000);
    return () => clearInterval(iv);
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
    reply: HeartReply & { photoAt?: number },
    incoming = "",
    readFrom = 0,
    opts: { keepTyping?: boolean } = {},
  ) {
    busy.current = true;
    // chat.reply is stamped HERE, not after delivery: everything below this
    // line is the human typing rhythm, and folding 3.5s of deliberate pacing
    // into a latency number would make her look slow in exactly the data
    // used to decide whether she is slow.
    const replyIds = reply.bubbles.map(() => uid());
    // Her reaction lands BEFORE the typing rhythm below, because that is what a
    // reaction is: a person taps the emoji the moment they read it, then starts
    // typing. Delivering it with the bubbles would make it arrive seconds late,
    // which reads as a second thought rather than a first one.
    const react = (reply as { react?: string }).react;
    if (react) {
      const target = lastMineId();
      if (target) {
        setReaction(target, react);
        tel("chat.her_react", { msg_id: target });
      }
    }
    const replyKind = reply.photo ? "photo" : reply.voice ? "voice" : reply.gif ? "gif" : "text";
    tel("chat.reply", {
      msg_id: replyIds[0] ?? "",
      latency_ms: readFrom ? Date.now() - readFrom : -1,
      bubbles: reply.bubbles.length,
      kind: replyKind,
      // the CONFIGURED lane. Which brain actually answered is decided inside
      // brain.ts and is not returned, so this is what the client asked for,
      // not what served it — a real `lane`/`model` needs brain.ts to report.
      lane: openrouterKey ? "openrouter" : apiKey ? "claude" : "proxy",
      critical: Boolean(reply.critical),
      searched: Boolean(reply.search),
      forgot: Boolean(reply.forgot),
    });
    // a turn where she says nothing is a failed turn, whatever the transport
    // said. err.fetch carries the http side; this is the product-visible one.
    if (!reply.bubbles.length && !reply.photo && !reply.voice && !reply.gif)
      tel("chat.error", { stage: "reply", status: 0, retried: false });
    // SHE AGREED TO FORGET SOMETHING, and by the time this runs the rows are
    // already deleted (brain.ts awaits the delete before handing the reply
    // back). The turns are still in the local store though, and the local
    // store IS the context window she thinks with — leaving them there means
    // she has "forgotten" something she can still read four lines up. They go
    // before her words land, so the two are never briefly inconsistent.
    // Forgetting one FACT prunes nothing: that would shred their own history
    // as a side effect of asking her to drop a detail.
    if (reply.forgot) {
      const { target, deleted } = reply.forgot;
      setState((s) => ({ ...s, messages: messagesAfterForget(s.messages, target) }));
      // scope and counts only — a telemetry row naming the thing would
      // outlive the memory it deleted
      track(state.deviceId, "memory_forgotten", { scope: target.scope, ...deleted }, state.auth?.userId);
    }
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
    // Where she actually reached for the photo. parseBubbles records the slot
    // the [photo:] marker occupied; undefined means she wrote no marker we
    // could place, so it falls back to the end of the burst as before.
    // She re-sends the same picture. Measured at 2 of 4 runs of one script —
    // twice with a byte-identical caption, and both times on the turn where
    // the user said a friend was upset with them, which is the worst possible
    // moment for a repeat. Her brief already forbids it ("Never twice in a
    // row"), so prompt text demonstrably does not hold this; a client guard
    // does, whatever the model emits. Six of her recent photos back is enough
    // to cover a conversation without ever blocking a genuine callback to
    // something from days ago.
    const repeated =
      reply.photo != null &&
      messagesRef.current
        .filter((m) => m.kind === "photo" && m.from === "her")
        .slice(-6)
        .map((m) => m.photoSeed || m.text)
        .includes(reply.photo.seed);
    const photoOf = repeated ? null : (reply.photo ?? null);
    const photoSlot = photoOf ? (reply.photoAt ?? reply.bubbles.length) : -1;
    const photoAtEnd = photoOf != null && photoSlot >= reply.bubbles.length;
    // which hand-off is the final one of this delivery — a photo in the MIDDLE
    // of the burst is no longer the last thing she sends, so the closing beat
    // belongs to whatever really ends it
    const lastMedia = photoAtEnd ? "photo" : reply.gif ? "gif" : reply.voice ? "voice" : "";
    let photoSent = false;
    const emitPhoto = async (): Promise<boolean> => {
      if (photoSent || !photoOf) return false;
      photoSent = true;
      setTyping(true);
      await sleep(1600);
      if (stale()) return true;
      const photo: Message = {
        id: uid(),
        from: "her",
        kind: "photo",
        text: photoOf.caption,
        photoSeed: photoOf.seed,
        at: Date.now(),
      };
      await handoffTyping(photo.id, lastMedia === "photo");
      if (stale()) return true;
      pushMsg(photo);
      // `chosen` is the catalog seed, which is code, not conversation
      tel("chat.media", { kind: "photo", msg_id: photo.id, chosen: photoOf.seed, from: "her" });
      return false;
    };
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
      // she wrote the photo here, so it goes here — ahead of this bubble
      if (bi === photoSlot && (await emitPhoto())) return;
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
      const msg: Message = {
        id: replyIds[bi],
        from: "her",
        kind: "text",
        text: bubble,
        at: Date.now(),
      };
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
      // Audio tags are performance directions, not words. `spoken` keeps them
      // (ElevenLabs performs them; the proxy voice strips them at fetch), the
      // caption must not show them.
      //
      // The old strip was /\[[a-z ]+\]/ — CLOSED, alphabetic tags only. So a
      // payload the parser had truncated to "[giggles" survived it whole and
      // rendered literally in the bubble, and "[softly, warm]" would have too.
      // Anything bracket-shaped goes now, closed or not.
      const clean = reply.voice.text
        .replace(/\[[^\][]*\]/g, " ")
        .replace(/\[[^\][]*$/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      // Nothing but directions left: that is a recording of her laughing at
      // nothing, which is what shipped. The parser drops these now, so this is
      // a second lock on the same door. Skip only the CLIP — the gif and
      // follow-ups below still owe the user their turn.
      if (clean) {
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
        tel("chat.media", { kind: "voicenote", msg_id: msg.id, secs: msg.dur, from: "her" });
      }
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
      tel("chat.media", { kind: "gif", msg_id: msg.id, from: "her" });
    }
    if (reply.followup) {
      const at = Date.now() + reply.followup.minutes * 60_000;
      setState((s) => ({ ...s, followup: { at, why: reply.followup!.why } }));
    }
    if (delivered.length) logTurns(state.deviceId, delivered);
    if (photoOf) track(state.deviceId, "photo_sent", { seed: photoOf.seed.slice(0, 40) }, state.auth?.userId);
    // she wrote it at the end, or wrote no placeable marker
    if (await emitPhoto()) return;
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
    // Derived from HIS OWN recent gaps, not a constant — see engine/burst.ts.
    // A fixed wait makes a deliberate typist wait longest, which is backwards,
    // and `scene-hold-800` already measured that on the watch lane. Only the
    // timer lives here; the policy is the engine's so every surface gets it.
    const wait = burstWaitMs(recentUserGaps(messagesRef.current));
    burstTimer.current = setTimeout(() => void replyCycle(seq), wait);
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
      // they kept texting while she read — re-read EVERYTHING, reply once.
      //
      // `busy` MUST be released before recursing. It was taken at the top of
      // this cycle and is normally released by deliver(), which this branch
      // never reaches — so without the reset the recursive call returns at its
      // own `if (busy.current)` guard and she goes silent. Permanently: the
      // flag is never lowered again, so every later scheduleReply() dies at
      // the same guard and the chat is dead until reload. Reported as "when
      // sending multiple messages it's just stopping and then no message from
      // her end", and it made the burst path — the one this branch exists to
      // serve — the one path that could not work.
      busy.current = false;
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

  // ── clearing and forgetting, both with a way back ─────────────────────
  // The old flow was: tap an unlabelled broom twice within 2.6 seconds and
  // the conversation, her improvised life and her carried feeling were gone
  // with no confirmation and no recovery. Now both destructive actions are
  // named in a sheet, and for ten seconds afterwards they are only parked.
  //
  // the local teardown they share: whatever she was mid-way through belongs
  // to a conversation that is about to not exist
  function tearDownLocally(): Snapshot {
    const snapshot = {
      messages: state.messages,
      herLife: state.herLife,
      inner: state.inner,
      clearedAt: state.clearedAt,
      game: state.game,
      callback: state.callback,
      tally: state.tally,
      momentsFired: state.momentsFired,
    };
    busy.current = false;
    epoch.current += 1; // kill any in-flight reply from the old chat
    if (readTimer.current) clearTimeout(readTimer.current);
    typingSince.current = 0;
    setTyping(false);
    setReplyTo(null);
    setReplySel(null);
    // clearedAt is the synced tombstone: other devices honor it instead of
    // resurrecting the wiped conversation; followup timers from the deleted
    // conversation die with it, and so does her improvised life — a feeling
    // whose cause has been deleted is exactly the causeless mood this whole
    // design exists to make impossible.
    setState((s) => ({
      ...s,
      messages: [],
      followup: null,
      herLife: [],
      inner: undefined,
      clearedAt: Date.now(),
      // The game and any armed callback die with the conversation. The owner
      // found the gap the worst possible way: he pressed "make her forget you",
      // and in the fresh conversation she asked whether they should continue
      // the chess game — a person who claims to have forgotten you while
      // remembering your unfinished match is not forgetting, she is lying
      // about forgetting, which is the exact failure the honesty work exists
      // to prevent. AppState.game was added after this teardown was written,
      // and nothing forced the two to stay in sync. Same reasoning for
      // callback: "she calls you back" from a wiped relationship is a
      // causeless event.
      game: null,
      callback: null,
      // The audit's second omission of the same rule: the wipe left "12
      // games of chess, she's ahead 7-5" on a record whose first message is
      // now today — and every id in the fired ledger stayed dead forever, so
      // a post-forget relationship could never fire "your first game". Every
      // AppState field decides its teardown fate the day it is added.
      tally: null,
      momentsFired: [],
    }));
    return snapshot;
  }

  // park a destructive action: the local state is already gone, `commit` is
  // what actually leaves the device and it does not run for ten seconds
  function park(label: string, snapshot: Snapshot, commit?: () => void) {
    setUndo({ label, snapshot });
    // a second destructive action inside the first one's window supersedes
    // its UNDO, never its commit — that one was already confirmed, and
    // silently dropping it would leave the rows alive on a device that has
    // been told they are gone
    const superseded = pendingForget.current;
    pendingForget.current = commit ?? null;
    superseded?.();
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      setUndo(null);
      const run = pendingForget.current;
      pendingForget.current = null;
      run?.();
    }, 10_000);
  }

  function clearChat() {
    track(state.deviceId, "chat_cleared", { count: state.messages.length }, state.auth?.userId);
    park("Chat cleared", tearDownLocally());
  }

  // The inverse of the whole memory system, from the settings sheet. It is a
  // superset of clearChat on purpose: leaving the transcript on screen while
  // deleting the graph would leave her still knowing them from context, which
  // is the same lie in a smaller window.
  function forgetEverything() {
    const device = state.deviceId;
    track(state.deviceId, "memory_forgotten", { scope: "all" }, state.auth?.userId);
    park(`${HER_NAME} forgot everything`, tearDownLocally(), () => {
      forgetMemories(device, { scope: "all" });
    });
  }

  function undoClear() {
    const snap = undo?.snapshot;
    if (!snap) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    pendingForget.current = null; // the delete never leaves the device
    setUndo(null);
    busy.current = false;
    epoch.current += 1; // the fresh opener she started belongs to nothing now
    setTyping(false);
    setTypingOut(false);
    typingSince.current = 0;
    setState((s) => ({
      ...s,
      messages: snap.messages,
      herLife: snap.herLife,
      inner: snap.inner,
      clearedAt: snap.clearedAt,
      game: snap.game,
      callback: snap.callback,
      tally: snap.tally,
      momentsFired: snap.momentsFired,
    }));
    tap();
  }

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      // leaving the screen is not undoing: a confirmed forget still goes
      const run = pendingForget.current;
      pendingForget.current = null;
      run?.();
    },
    [],
  );

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
    // compose.send + compose.draft (the one place draft text is captured)
    composer.send(mine.id, text);
    tel("chat.send", { msg_id: mine.id, kind: "text", chars: text.length, quoted: Boolean(mine.replyTo) });
    track(state.deviceId, "message_sent", { len: text.length, quoted: Boolean(mine.replyTo) }, state.auth?.userId);
    // single tick → double tick shortly after (server delivery rhythm)
    setTimeout(() => upgradeMyStatus("delivered"), 500 + Math.random() * 700);
    scheduleReply(text);
  }

  /**
   * A reply sent from inside the story viewer.
   *
   * It goes through the SAME path as any other message — the quote-reply that
   * already exists carries which story it was, so she sees what he is
   * answering without a second mechanism. Instagram works this way too: a
   * story reply is a DM that quotes the story, not a separate object, and
   * building it as a separate object is how you end up with a thread that
   * cannot be replied to.
   */
  function sendStoryReply(text: string, story: Story) {
    // `desc` is what is IN the story, in her own words — the right thing to
    // quote, because it is what he is actually replying to.
    const quoted = (story.desc || "story").slice(0, 120);
    const mine: Message = {
      id: uid(),
      from: "me",
      kind: "text",
      text,
      at: Date.now(),
      status: "sent",
      // `photo` makes the quote render as the IMAGE with a small "Story"
      // label, instead of her desc text in quotation marks — which read as
      // something she had typed. `text` still carries the desc because it is
      // what the BRAIN needs: she can't see the thumbnail, and the desc is
      // what tells her which story he is answering.
      replyTo: { from: "her", text: quoted, photo: storySrc(story) },
    };
    pushMsg(mine);
    logTurns(state.deviceId, [mine]);
    tel("chat.send", { msg_id: mine.id, kind: "text", chars: text.length, quoted: true });
    track(state.deviceId, "story_reply", { len: text.length }, state.auth?.userId);
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
      showNotice("couldn't read that photo. try a different one");
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
    if (caption) composer.send(mine.id, caption);
    tel("chat.send", { msg_id: mine.id, kind: "photo", chars: caption.length });
    tel("chat.media", { kind: "photo", msg_id: mine.id, from: "me", bytes: packed.b64.length });
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
  // ── WhatsApp's OTHER horizontal gesture: drag the thread LEFT and every row
  // slides over to uncover its timestamp.
  //
  // Splitting the two directions is what makes both feel right, and it is also
  // a fix. Reply used to fire on `Math.sign(dx)` — EITHER direction — so a left
  // drag opened a reply chip, which is not what that gesture means in any app
  // he uses. Right drags reply; left drags peek. Neither can be mistaken for
  // the other, and vertical still wins for scrolling.
  const PEEK_MAX = 62;
  const peek = useRef(0);
  const setPeek = (px: number) => {
    peek.current = px;
    scrollRef.current?.style.setProperty("--peek", `${px}px`);
  };
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
        // LEFT: the whole thread slides to uncover timestamps. Damped the same
        // way the reply drag is, so the two gestures share one feel.
        if (dx < 0) {
          const m2 = -dx;
          setPeek(Math.min(PEEK_MAX, Math.min(48, m2) + Math.max(0, m2 - 48) * 0.3));
          return;
        }
        // RIGHT: 1:1 to the trigger, then damped, hard cap 80px
        const mag = Math.abs(dx);
        const damped = Math.min(48, mag) + Math.max(0, mag - 48) * 0.25;
        s.dx = Math.min(80, damped);
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
        if (s.active && s.dx >= 48) {
          setReplyTo(m);
          setReplySel(null);
          tel("chat.swipe_reply", { msg_id: m.id, from: m.from, via: "swipe" });
        }
        // The peek always springs back. It is a LOOK, not a mode — leaving the
        // thread parked open would be a state he has to undo, and WhatsApp's
        // does not do that either.
        if (peek.current) {
          const from = peek.current;
          const t0 = performance.now();
          const back = (now: number) => {
            const k = Math.min(1, (now - t0) / 220);
            // same ease-out the bubbles use, so the whole surface decelerates
            // together instead of two things stopping at different times
            setPeek(from * (1 - (1 - Math.pow(1 - k, 3))));
            if (k < 1) requestAnimationFrame(back);
            else setPeek(0);
          };
          requestAnimationFrame(back);
          tel("chat.peek_time", { px: Math.round(from) });
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
      showNotice("mic access needed: allow the microphone and try again");
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
            showNotice("recording didn't capture. try again");
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
            "[voice note — audio was unclear, you couldn't make out the words. react like a person: ask them to resend or type, casually]", // emdash-ok: brain-facing placeholder text, never rendered (voice bubbles hide their text)
          dur: secs,
          at: Date.now(),
          status: "sent",
        };
        registerLocalClip(mine.id, blob);
        pushMsg(mine);
        logTurns(state.deviceId, [mine]);
        tel("chat.send", { msg_id: mine.id, kind: "voice", chars: transcript.length });
        tel("chat.media", {
          kind: "voicenote",
          msg_id: mine.id,
          from: "me",
          secs,
          heard: Boolean(transcript),
          bytes: blob.size,
        });
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
  const visible = useMemo(() => messages.filter((m) => m.channel !== "call"), [messages]);
  // roving tabindex: the newest message is the thread's single tab stop
  // unless the reader has moved focus somewhere else in it
  const lastTextId = (() => {
    for (let i = visible.length - 1; i >= 0; i--)
      if (visible[i].kind === "text") return visible[i].id;
    return "";
  })();
  const newestHerVoice = (() => {
    for (let i = visible.length - 1; i >= 0; i--)
      if (visible[i].from === "her" && visible[i].kind === "voice") return visible[i].id;
    return "";
  })();
  // ── windowing ────────────────────────────────────────────────────────────
  //
  // Only the tail of the thread is rendered. A memoised bubble stops a
  // keystroke from RE-rendering a thousand rows; it does not stop React from
  // walking a thousand elements to find that out, and it does not stop the
  // browser from laying out a thousand boxes. Windowing bounds both.
  //
  // Deliberately NOT a virtualiser: the rows are variable-height (photos,
  // voice notes, quotes, reactions), the scroller is a plain flex column with
  // `margin-top:auto` on the first row, and the read-receipt observer, the
  // roving tabindex and the swipe gestures all walk real DOM. A measuring
  // virtualiser would have to reproduce all of that. A tail window plus an
  // explicit "load earlier" reproduces none of it, and matches how a
  // conversation is actually read: from the bottom, backwards, on demand.
  const tailStart = Math.max(0, visible.length - WINDOW_STEP);
  const anchorIdx = anchorId ? visible.findIndex((m) => m.id === anchorId) : -1;
  // An anchor that no longer exists (cleared chat, forgotten messages) simply
  // stops applying — the window falls back to the tail rather than breaking.
  const start = anchorIdx >= 0 ? Math.min(anchorIdx, tailStart) : tailStart;
  // The tab stop has to be a row that EXISTS. A focused message that the
  // window has since scrolled past would otherwise leave the thread with no
  // tab stop at all — Tab would skip the conversation entirely.
  const focusedIdx = focusedMid ? visible.findIndex((m) => m.id === focusedMid) : -1;
  const focusMid = focusedIdx >= start ? focusedMid : lastTextId;

  /** Show one more step of history, keeping what is on screen where it is. */
  const loadEarlier = () => {
    holdScroll();
    setAnchorId(visible[Math.max(0, start - WINDOW_STEP)]?.id ?? null);
  };

  /**
   * Put one message on screen, extending the window if it is older than what
   * is rendered. `revealPending` is consumed by the layout effect above, so
   * the scroll happens in the same frame the rows appear.
   */
  const revealMessage = (id: string, idx: number) => {
    if (idx < start) {
      holdScroll();
      revealPending.current = id;
      // a few rows of context ABOVE the target: landing on the very first row
      // in the window reads as the end of the conversation, which it is not
      setAnchorId(visible[Math.max(0, idx - 6)]?.id ?? null);
      return;
    }
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  /**
   * Tap a quote, go to what it quotes — the one navigation a threaded chat
   * owes you. `replyTo` carries no message id (it is a value snapshot, and
   * `state/store.ts` is not this workstream's file), so the original is found
   * by scanning BACKWARDS from the replying message for the same sender and
   * the same text. Backwards, because a repeated line should resolve to the
   * one that was actually being answered.
   */
  const jumpToQuoted = (m: Message) => {
    const q = m.replyTo;
    if (!q) return;
    const here = visible.findIndex((x) => x.id === m.id);
    for (let i = here - 1; i >= 0; i--) {
      if (visible[i].from === q.from && visible[i].text === q.text) {
        revealMessage(visible[i].id, i);
        return;
      }
    }
  };

  // roving tabindex, DOM order — only text bubbles carry `data-mid`, so this
  // walks exactly the rows that are focusable
  const moveFocus = (from: string, dir: 1 | -1) => {
    const list = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-mid]") ?? [],
    );
    const i = list.findIndex((el) => el.dataset.mid === from);
    const next = list[i + dir];
    if (next) {
      setFocusedMid(next.dataset.mid || "");
      next.focus();
      return;
    }
    // Off the top of the WINDOW is not the top of the conversation: load the
    // previous step and let the next press walk into it.
    if (dir === -1 && i === 0 && start > 0) loadEarlier();
  };

  // Every handler a row can fire, on ONE object with a stable identity — the
  // thing that makes `memo` on MessageRow hold across a keystroke. The object
  // is built once; the ref underneath it is refreshed every render, so the
  // handlers always run against the current closure.
  rowHandlers.current = {
    toggleSelect: (id) => setReplySel((cur) => (cur === id ? null : id)),
    clearSelect: () => setReplySel(null),
    react: (m, emoji) => {
      const next = m.reaction === emoji ? undefined : emoji;
      setReaction(m.id, next);
      setReplySel(null);
      tel("chat.react", { msg_id: m.id, from: m.from, on: next ?? "" });
    },
    replyTo: (m) => {
      setReplyTo(m);
      setReplySel(null);
      tel("chat.swipe_reply", { msg_id: m.id, from: m.from, via: "chip" });
      inputRef.current?.focus();
    },
    focusRow: (id) => setFocusedMid(id),
    moveFocus,
    voicePlayed: (id) => setPlayedVoice((s) => new Set(s).add(id)),
    gifResolved: (id, url) =>
      setState((s) => ({
        ...s,
        messages: s.messages.map((x) => (x.id === id ? { ...x, gifUrl: url } : x)),
      })),
    jumpToQuoted,
    swipe: swipeHandlers,
  };

  // a bubble that took over from the typing indicator waits one exit beat
  // before it starts (the delay lives in CSS)
  const rows: React.ReactNode[] = [];
  // Seeded from the message BEFORE the window, so a separator appears exactly
  // where it would in a full render — extending the window can never insert or
  // remove one above what is already on screen.
  let lastDay = start > 0 ? dayLabel(visible[start - 1].at) : "";
  for (let i = start; i < visible.length; i++) {
    const m = visible[i];
    const next = visible[i + 1];
    const lastOfGroup = !next || next.from !== m.from || next.at - m.at > 60_000;
    const d = dayLabel(m.at);
    if (d !== lastDay) {
      lastDay = d;
      rows.push(
        <div key={`sep${m.id}`} className="day-sep">
          {d}
        </div>,
      );
    }
    rows.push(
      <MessageRow
        key={m.id}
        m={m}
        api={rowApi}
        lastOfGroup={lastOfGroup}
        followsTyping={m.from === "her" && followsTyping.current.includes(m.id)}
        selected={replySel === m.id}
        tabbable={m.id === focusMid}
        unheard={m.from === "her" && m.id === newestHerVoice && !playedVoice.has(m.id)}
      />,
    );
  }

  const stories = activeStories();
  const storyLive = stories.length > 0;
  const storyUnseen = hasUnseenStory();

  const openStoryOrProfile = () => {
    // insta mechanics: an active story opens from the avatar; when nothing
    // is live the same target goes to the account
    if (storyLive) {
      setStoryOpen(true);
      track(state.deviceId, "story_open", { unseen: storyUnseen }, state.auth?.userId);
    } else {
      onProfile();
    }
  };
  const headTarget = storyLive ? "View her story" : "Account";

  return (
    <div className="chat">
      <div className="chat-head">
        <button
          className={`avatar-ring ${storyLive ? (storyUnseen ? "story-live" : "story-seen") : ""}`}
          style={{ width: 48, height: 48, padding: 2.5 }}
          onClick={openStoryOrProfile}
          data-tel="chat.avatar"
          aria-label={headTarget}
        >
          <div className="inner">
            <PhotoAvatar size={43} />
          </div>
        </button>
        {/* its accessible name is its own content — "Meera, last seen today
            at 4:06" — which is more use than repeating the avatar's label */}
        {/* The NAME opens the Us screen — the per-relationship page, the
            Snapchat-friendship-profile idiom. The avatar keeps the story
            ring, so nothing existing moved. */}
        <button
          className="who"
          data-tel="chat.header_name"
          onClick={onUs}
          aria-label={`You and ${HER_NAME}`}
        >
          <div className="name">{HER_NAME}</div>
          {/* ONE node whose contents change — typing → online → last seen
              dissolves. Rendering three sibling nodes would remount the
              element and the transition would never run. */}
          <div className={`status ${typing ? "typing" : ""}`} aria-live="polite">
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
        </button>
        <button className="icon-btn" data-tel="chat.call" onClick={onVoiceCall} aria-label="Voice call">
          <PhoneIcon />
        </button>
        <button
          className="icon-btn"
          data-tel="chat.games"
          onClick={onGames}
          aria-label="Play something together"
          aria-haspopup="dialog"
        >
          <ChessIcon size={20} />
        </button>
        <button
          className="icon-btn"
          data-tel="chat.settings"
          onClick={() => setMoreOpen(true)}
          aria-label="Settings"
          aria-haspopup="dialog"
        >
          <MoreIcon />
        </button>
      </div>

      {!online && (
        <div className="offline-bar" role="status">
          <OfflineIcon />
          No connection, she'll get it when you're back
        </div>
      )}

      {/* data-tel-private: everything inside this element is conversation.
          Telemetry may read structure here (which bubble, how long it was on
          screen) and never text — the accessible name of a bubble IS the
          message, so "use the accessible name" would smuggle content into
          the audit trail and break the one-place-per-kind rule. */}
      <div
        className="chat-scroll"
        ref={scrollRef}
        data-tel-private=""
        role="log"
        aria-label={`Conversation with ${HER_NAME}`}
      >
        {rows.length === 0 && (
          // The brand-new chat used to be a white void for the two to six
          // seconds her first line takes to arrive — the single most likely
          // moment to decide the app is broken. Now the room is furnished.
          <div className="chat-empty">
            <div className="ce-face">
              <PhotoAvatar size={96} />
            </div>
            <h2>{user.name ? `${HER_NAME} is writing to you` : `Say hi to ${HER_NAME}`}</h2>
            <p>
              She texts in Hinglish, calls when you want to hear a voice, and remembers what
              you tell her.
            </p>
            <div className="typing-bubble ce-dots">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
        {start > 0 && (
          // The window's own edge, stated. Not an infinite-scroll sentinel:
          // loading on approach would fire while you are still flicking and
          // move the thread under the finger, which is the exact failure the
          // scroll-ownership rule above exists to prevent.
          <button className="load-earlier" data-tel="chat.load_earlier" onClick={loadEarlier}>
            {start === 1 ? "1 earlier message" : `${start} earlier messages`}
          </button>
        )}
        {rows}
        {typing && (
          <div className="typing-bubble" {...(typingOut ? { "data-leaving": "" } : {})}>
            <span className="sr-only">{HER_NAME} is typing</span>
            <i />
            <i />
            <i />
          </div>
        )}
        <div style={{ height: 6 }} />
      </div>

      {showJump && (
        <button className="jump-latest" data-tel="chat.jump_latest" onClick={() => toBottom()}>
          {missed > 0 && <span className="jl-new" />}
          {missed > 0
            ? `${missed} new message${missed === 1 ? "" : "s"}`
            : "Jump to latest"}
          <span className="jl-arrow">
            <ArrowDownIcon />
          </span>
        </button>
      )}

      {storyOpen && (
        <StoryView
          stories={stories}
          signedIn={Boolean(state.auth)}
          onSignIn={() => {
            setStoryOpen(false);
            onProfile();
          }}
          onClose={() => setStoryOpen(false)}
          onReply={sendStoryReply}
          onProfile={() => {
            setStoryOpen(false);
            onProfile();
          }}
        />
      )}
      {moreOpen && (
        <MoreSheet
          state={state}
          setState={setState}
          messageCount={visible.length}
          onClose={() => setMoreOpen(false)}
          onAccount={() => {
            setMoreOpen(false);
            onProfile();
          }}
          onClearChat={clearChat}
          onForgetEverything={forgetEverything}
        />
      )}
      {undo && (
        <div className="undo-toast" role="status">
          <span>{undo.label}</span>
          <button data-tel="chat.undo" onClick={undoClear}>Undo</button>
        </div>
      )}
      {notice && (
        <div className="chat-notice" role="status">
          {notice}
        </div>
      )}
      {replyTo && (
        <div className="reply-bar">
          <div className="quote">
            <b>{replyTo.from === "her" ? HER_NAME : "You"}</b>
            <span className="qtext">{replyTo.text.slice(0, 120)}</span>
          </div>
          <button className="reply-x" data-tel="chat.reply_cancel" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
            ×
          </button>
        </div>
      )}
      <div className="chat-input-row">
        {recording ? (
          <div className="rec-bar" role="status" aria-label="Recording a voice note">
            <span className={`rec-dot ${recPaused ? "paused" : ""}`} />
            <span className="rec-time">
              <b>
                {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, "0")}
              </b>
              <span>{recPaused ? " · paused" : " · recording"}</span>
            </span>
            <button className="rec-cancel" data-tel="chat.rec_cancel" onClick={() => finishRecording(false)}>
              cancel
            </button>
            <button
              className="rec-pause"
              data-tel="chat.rec_pause"
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
            <button className="send-btn" data-tel="chat.rec_send" onClick={() => finishRecording(true)} aria-label="Send voice note">
              <SendIcon />
            </button>
          </div>
        ) : (
          <div className="chat-input">
            <button
              className="attach-btn"
              data-tel="chat.attach"
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
              data-tel="chat.composer"
              placeholder={`Message ${HER_NAME}…`}
              value={draft}
              onChange={(e) => {
                // value only, never the caret: reading selectionStart here
                // forces a second synchronous layout on top of the autosize
                // below, and it measured +0.6ms per keystroke. The caret it
                // needed is already read at keydown, before layout is dirty.
                composer.change(e.target.value);
                setDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(110, e.target.scrollHeight) + "px";
              }}
              onFocus={() =>
                composer.focus(messagesRef.current[messagesRef.current.length - 1]?.at ?? 0)
              }
              onPaste={(e) => composer.paste(e.clipboardData?.getData("text")?.length ?? 0)}
              onCompositionStart={() => composer.imeStart()}
              onCompositionEnd={() => composer.imeEnd()}
              onKeyDown={(e) => {
                composer.key(
                  e.key,
                  e.currentTarget.selectionStart ?? 0,
                  e.currentTarget.selectionEnd ?? 0,
                );
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {draft.trim() || !sttSupported() ? (
              <button
                className={`send-btn ${draft.trim() ? "" : "off"}`}
                data-tel="chat.send"
                // an empty send is not an error — it puts the caret where
                // the words go, instead of doing nothing at all
                onClick={() => (draft.trim() ? send() : inputRef.current?.focus())}
                aria-label="Send"
              >
                <SendIcon />
              </button>
            ) : (
              <button className="send-btn mic" data-tel="chat.record" onClick={startRecording} aria-label="Record voice note">
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
