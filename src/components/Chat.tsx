// The chat — where the relationship lives. Human typing rhythm, multi-bubble
// replies, photo moments, presence cues.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate } from "framer-motion";
import "../styles/thread.css";
import "../styles/composer.css";
import type { AppState, Message } from "../state/store";
import { uid } from "../state/store";
import { think, formatHerLife } from "../engine/brain";
import { activityOf, activityPickupLine } from "../state/game";
// WS-HERNOW. Her present moment is a ledger with one row, not a fresh
// improvisation per turn — see src/engine/herNow.ts.
import { herNowAt } from "../engine/herNow";
import {
  HER_NAME,
  OPEN_DIRECTIVE,
  FOLLOWUP_DIRECTIVE,
  AFTERCALL_DIRECTIVE,
  DECLINED_CALL_DIRECTIVE,
} from "../engine/persona";
import type { Story } from "../engine/storyCatalog";
import {
  logTurns,
  rememberFrom,
  uploadPhotos,
  describePhoto,
  prefetchRecall,
  forgetMemories,
  messagesAfterForget,
} from "../engine/memory";
import { applyInner, wantsForAppraisal } from "../engine/inner";
import { burstDecide, followUpRate, recentUserGaps, unansweredTail, type BurstTurn } from "../engine/burst";
import { track } from "../engine/account";
import { tel, telFlush, createComposeTracker } from "../engine/telemetry";
import type { HeartReply } from "../engine/localHeart";
import PhotoAvatar from "./PhotoAvatar";
import StoryView from "./StoryView";
import { activeStories, hasUnseenStory, storySrc } from "../engine/storyCatalog";
import MessageRow, { type RowApi } from "./MessageRow";
import { fmtTime } from "./fmtTime";
import { registerLocalClip } from "./VoiceNote";
import { ChessIcon, ForkIcon, GridIcon } from "./GamesHub";
import { detectGameInvite, type GameKind } from "../engine/gameInvite";
// WS-SHECALLS. His ask, read off the thread — she rings him through the
// callback seam App already owns. See the block by `callInvite` below.
import { detectCallInvite, ringAt, type CallTurn } from "../engine/callInvite";
import { listen, sttSupported } from "../voice/speech";
import { tap, land } from "../native/haptics";
// WS-SOUND. The thread is where the two most-heard cues in the product live.
// `armSound` installs the first-gesture unlock (it builds no AudioContext by
// itself — see src/sound/index.ts gate 1), and this component is where it is
// installed because App never unmounts it: a layer armed inside something that
// comes and goes is a layer that is armed some of the time.
import { armSound, feel, play, setCallActive, setSoundEnabled } from "../sound";
import MoreSheet from "./MoreSheet";
import SourceSheet from "./SourceSheet";
import ComposeTray from "./ComposeTray";
import PhotoViewer from "./PhotoViewer";
import {
  MAX_ATTACHMENTS,
  MAX_DOCS,
  DOC_ACCEPT,
  addAttachments,
  addDocs,
  buildDocPayload,
  buildImagePayload,
  compressImage,
  docRefs,
  holdDocs,
  imagesOf,
  packDoc,
  removeAttachment,
  removeDoc,
  restoreDocs,
  takeDocs,
  transcriptLine,
  type Attachment,
  type DocAttachment,
  type DocHold,
} from "./attachments";
import WorldLayer, { useSky, skyVars } from "./WorldLayer";
import {
  PhoneIcon,
  SendIcon,
  MicIcon,
  CameraIcon,
  MoreIcon,
  ArrowDownIcon,
  ChevronIcon,
  OfflineIcon,
} from "./icons";

/** What the invite chip says. App-voiced, never a line she would say — the
 *  same discipline `GamesHub`'s blurbs and `ClockCard`'s strings keep. Her
 *  own words are in the bubble directly above it. */
const INVITE_LABEL: Record<GameKind, string> = {
  chess: "Open the chess board",
  "tic-tac-toe": "Open tic tac toe",
  "would-you-rather": "Open would you rather",
};

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onVoiceCall: () => void;
  onProfile: () => void;
  /** open the "things to do together" sheet — one tap from the chat header */
  onGames: () => void;
  /** open ONE activity room by id, the same route the hub's rows take. The
   *  invite chip in the thread needs it: the whole point of that chip is that
   *  the game opens from the conversation rather than from a menu, and a chip
   *  that opened the menu would be the menu with an extra step. */
  onOpenActivity?: (id: string) => void;
  /** open the Us screen — the relationship made visible. Entry is the header
   *  NAME (the Snapchat-friendship-profile idiom); the avatar keeps stories. */
  onUs: () => void;
  // she must never send chat bubbles while actively ON a call with them
  inCall?: boolean;
  /** a game/activity overlay is up — the thread settles on its falling edge,
   *  same 180ms it already runs when a call or sheet closes */
  activityOpen?: boolean;
  /** increments when another surface (home's gear) asks for the Settings
   *  sheet — the sheet and its destructive flows live here, so the ask
   *  travels as a signal instead of the sheet being forked (final audit H2:
   *  Settings was unreachable from the app's own landing surface) */
  openSettingsSignal?: number;
  /** WS-KNOWS. A correction started on the "what she remembers" surface, handed
   *  over as a DRAFT rather than sent: she relearns from a normal turn, in his
   *  words, which is the one path already proven to reach a compiled prompt.
   *  Same signal idiom as `openSettingsSignal` and for the same reason. */
  composePrefill?: { text: string; n: number };
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

export default function Chat({ state, setState, onVoiceCall, onProfile, onGames, onOpenActivity, onUs, inCall, activityOpen, openSettingsSignal, composePrefill }: Props) {
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  // the indicator holds for one exit beat while the bubble enters underneath
  // it — she was typing, now the words are there. Unmounting it on the same
  // frame the message lands is a teleport, and it happens on every reply.
  const [typingOut, setTypingOut] = useState(false);
  // ── the second beat ─────────────────────────────────────────────────────
  // How long she will type is UNKNOWABLE when the indicator goes up: the
  // reply does not exist yet, so there is nothing honest to pace against and
  // a progress-shaped rhythm would be a lie told in motion. What IS knowable
  // is that THIS one is taking a while. Past four seconds the indicator gains
  // a second, slower visual beat (thread.css) so a long think reads as
  // attended rather than as frozen. Reset on every `typing` edge, so each
  // bubble of a burst starts the clock again.
  const [longThink, setLongThink] = useState(false);
  const followsTyping = useRef<string[]>([]);
  const TYPING_EXIT_MS = 140;
  // the settings sheet (profile, account, clear chat) — everything that used
  // to be either unreachable or one mis-tap away from destroying the chat
  const [moreOpen, setMoreOpen] = useState(false);
  const lastSettingsSignal = useRef(openSettingsSignal ?? 0);
  useEffect(() => {
    if ((openSettingsSignal ?? 0) > lastSettingsSignal.current) setMoreOpen(true);
    lastSettingsSignal.current = openSettingsSignal ?? 0;
  }, [openSettingsSignal]);

  // the correction lands in the composer, never in the thread: he still gets
  // to say it in his own words, and to change his mind before he does.
  const lastPrefill = useRef(composePrefill?.n ?? 0);
  useEffect(() => {
    const n = composePrefill?.n ?? 0;
    if (n > lastPrefill.current && composePrefill?.text) setDraft(composePrefill.text);
    lastPrefill.current = n;
  }, [composePrefill]);
  // clearing parks the conversation for ten seconds instead of destroying it
  type Snapshot = Pick<AppState, "messages" | "herLife" | "herNow" | "inner" | "clearedAt" | "game" | "activities" | "shares" | "callback" | "tally" | "momentsFired" | "recentMoment" | "followup" | "declinedRing"> &
    // present ONLY on the forget path: clear-chat keeps her memory of HIM by
    // its own copy's promise; forget-everything must take user too, or "she
    // starts over not knowing you" ships with "lives in: pune" still in the
    // prompt (the final audit's one ship-blocker, C1)
    Partial<Pick<AppState, "user">>;
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
  // ── WS-FEEL: the three nodes the motion below needs to touch directly ──
  // The send button is the ORIGIN of his bubble's flight (spatial consistency:
  // a thing comes from its trigger), the field recoils as the message leaves
  // it, and the jump pill pulses when the count behind it changes. All three
  // are one-shot animations on a node React is not re-rendering, so they are
  // driven by attribute rather than by state — a state change here would
  // re-render the whole thread to move one pill.
  const sendBtnRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<HTMLButtonElement>(null);
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
      openPhotos: (m, i) => rowHandlers.current.openPhotos(m, i),
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
  // ── the "typing…" signal, which was already here and connected to nothing ──
  //
  // On every other messaging product the person on the other end can SEE you
  // composing, and that is most of why they don't answer your first fragment.
  // Her side of that is these two refs: what is in his box, and when he last
  // touched it. `burstDecide` (engine/burst.ts) owns what to do with them —
  // the surface only reports the signal and runs the clock.
  //
  // Refs, not state, on purpose: a keystroke must never cost a render. The
  // composer already refuses to emit per keystroke for the same reason (see
  // the tracker note above), and this rides the handlers that exist.
  const draftRef = useRef("");
  const lastKeyAt = useRef(0);
  // ── and the two signals that were missing, which is WHY it recurred ──
  //
  // A keystroke is only the LAST thing a person does before sending. Before it
  // they reach for the box and the keyboard comes up, and for the second or two
  // that takes there is a draft of zero characters and no key has been pressed —
  // which the shipped policy could not tell apart from a phone face-down on a
  // table. That gap is where "she won't let me type one, two messages" lives:
  // measured at 2.13s to her reply with the composer focused, the keyboard up
  // and his hand on it.
  //
  // `engagedAt` is the union clock — focus, keyboard, keystroke — and it never
  // advances while he is idle, which is what keeps `burstDecide`'s holds bounded
  // without a second timer. Refs for the same reason as the two above: presence
  // must not cost a render.
  const composerFocused = useRef(false);
  const keyboardOpen = useRef(false);
  const lastEngagedAt = useRef(0);
  const engaged = () => {
    lastEngagedAt.current = Date.now();
  };
  // the same clock as burstTimer, but owned by a chain that is already mid-turn
  const chainTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { messages, user, apiKey, openrouterKey } = state;

  // WS-HERNOW. What she is doing THIS MINUTE, read from the one ledger every
  // lane reads. App truth outranks it, so a board on screen is still what she
  // is in the middle of; otherwise the stored row wins for as long as its
  // natural span runs, which is what stops a second question five minutes
  // later getting a different answer. `commit` is non-null only when the
  // ledger genuinely moved on, so this writes at a transition and never per
  // turn. ONE Date.now() for the whole bag: the elapsed she may claim and the
  // row it is computed from have to come from the same instant.
  const presentNow = (now: number) => {
    const act = activityOf(state.game, now);
    return herNowAt({
      now,
      stored: state.herNow,
      appTruth: act ? { line: activityPickupLine(act), startedAt: act.startedAt } : null,
    });
  };

  const brainKeys = () => {
    const now = Date.now();
    const present = presentNow(now);
    if (present.commit) {
      const row = present.commit;
      setState((s) => (s.herNow?.key === row.key ? s : { ...s, herNow: row }));
    }
    return {
      openrouterKey,
      openrouterModel: state.openrouterModel,
      apiKey,
      deviceId: state.deviceId,
      // T7 carries BOTH halves of her own life: the told ledger (fixed between
      // them, never expires) and — appended — her present minute (never told,
      // expires by its own span). formatHerLife's header states the seam.
      herLife: formatHerLife(state.herLife, now, present.entry),
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
    };
  };
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

  // ── the sound layer's three wires ───────────────────────────────────────
  //
  // All three live here rather than in App because App belongs to another
  // workstream and because this component is the one that is always mounted
  // (App renders it behind every surface and never unmounts it, deliberately:
  // it holds an in-flight reply cycle). Nothing below creates an AudioContext.
  //
  //   arm      installs the first-gesture listener. The context is built
  //            inside that gesture and not one instruction earlier.
  //   toggle   mirrors `state.soundOn` into the module. `undefined` is ON,
  //            which is what every install that predates the field carries.
  //   call     the wider half of the call gate: `inCall` is true from the
  //            moment App decides a call is happening, which is earlier than
  //            the call engine mounts and starts publishing callStatus. The
  //            module checks BOTH and needs neither to be the only one right.
  useEffect(() => armSound(), []);
  useEffect(() => setSoundEnabled(state.soundOn !== false), [state.soundOn]);
  useEffect(() => setCallActive(Boolean(inCall)), [inCall]);

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
      // the burst clock re-arms itself, so it has to be stopped explicitly —
      // a timer that outlives the screen would call into a dead component
      if (burstTimer.current) clearTimeout(burstTimer.current);
      if (chainTimer.current) clearTimeout(chainTimer.current);
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

  // ══ WS-FEEL: the thread's motion ════════════════════════════════════════
  //
  // Everything in this block is transform/opacity only and runs on the tokens
  // in global.css. It is DOM-driven rather than state-driven on purpose: these
  // are one-shot animations on nodes React is otherwise leaving alone, and
  // routing them through state would re-render up to eighty memoised rows to
  // move one pill. The rules themselves live in styles/thread.css; this is
  // only the part that has to know WHEN.

  /**
   * A CSS duration token, in milliseconds, WHATEVER UNIT IT SURVIVED THE
   * BUILD IN.
   *
   * This is not defensive programming, it is a bug that shipped in the first
   * cut of this file and only in production. The stylesheet authors
   * `--d-state: 220ms`; the minifier rewrites it to `.22s` because that is
   * three bytes shorter; and `parseFloat(".22s")` is 0.22. So the send flight
   * ran for 0.22 MILLISECONDS — one frame, indistinguishable from the
   * teleport it was written to replace, and invisible in dev where nothing is
   * minified. Measured, caught by evals/feel-browser.mjs against the BUILT
   * app, which is the only reason it is not still there.
   *
   * The lesson generalises past this file: any code that reads a design token
   * at runtime is reading the MINIFIER'S opinion of that token, not the
   * author's, and must parse the unit rather than the number.
   */
  const cssMs = (value: string, fallback: number): number => {
    const t = value.trim();
    const n = parseFloat(t);
    if (!isFinite(n)) return fallback;
    return /ms$/.test(t) ? n : n * 1000;
  };

  /** The OS setting, read live — it can change while the app is open. */
  const reducedMotion = () =>
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * Restart a one-shot CSS animation driven by an attribute.
   *
   * Re-setting an attribute that is already there does not restart anything —
   * the animation is bound to the element's style, not to the assignment. The
   * remove / read-offsetWidth / re-add sequence is the standard idiom: the
   * layout read is what forces the style to be recomputed in between. One
   * forced layout per send is a price worth paying; a per-frame one would not
   * be, which is why nothing here is called from a scroll or a keystroke.
   */
  const restart = (el: HTMLElement | null, attr: string) => {
    if (!el) return;
    el.removeAttribute(attr);
    void el.offsetWidth;
    el.setAttribute(attr, "");
  };

  /**
   * HIS BUBBLE LEAVES THE COMPOSER.
   *
   * Measured, not authored: the flight starts at the send button's centre and
   * ends at the bubble's resting slot, so it is correct for a one-word message
   * and for a six-line one without either being a special case. That is also
   * why it is WAAPI rather than CSS — DESIGN-STANDARDS' cheapest-tool-first
   * ladder ends here exactly when the start value cannot be written down.
   *
   * The duration and the curve are READ OFF :root rather than typed in, so
   * this is on the shared scale literally rather than by resemblance: change
   * --d-state and this changes with it.
   *
   * `composite: "add"` is load-bearing. The bubble's base transform is the
   * timestamp-peek offset, and a replacing animation would drop it — which is
   * the same collision that had silently disabled the bubble entrance in the
   * shipped app (see the note at the top of thread.css).
   *
   * Clamped because the geometry is real: a bubble committed while the thread
   * is still smooth-scrolling can measure hundreds of pixels away, and a
   * message that swoops in from off screen is a different, worse animation.
   */
  const launchFromComposer = (el: HTMLElement): boolean => {
    const btn = sendBtnRef.current;
    if (!btn || reducedMotion() || typeof el.animate !== "function") return false;
    const from = btn.getBoundingClientRect();
    const to = el.getBoundingClientRect();
    if (!from.width || !to.width) return false;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    // Measured to the bubble's TAIL, not its centre. Centre-to-centre was the
    // first version and it is wrong in a way you only see on a long message:
    // a six-line bubble's centre sits level with the composer, so the flight
    // collapsed to a sideways slide (measured: dy 10px, dx pinned at the 56px
    // clamp) while a one-word bubble came up 64px. Same gesture, two different
    // animations, decided by how much he happened to type.
    //
    // The bottom-right corner is the bubble's tail, it is what `.msg.me`
    // already uses as its transform-origin, and it is in the same place
    // whatever the bubble's height — so every message leaves the composer the
    // same way, which is what spatial consistency actually asks for.
    // ...and against where the tail is ABOUT TO BE. This runs in a layout
    // effect, one frame before the thread scrolls itself down to the new
    // message, so a bubble taller than the slack still measures off the bottom
    // of the viewport — which is how the tall case ended up pinned at the
    // clamp floor even after the tail fix (measured: dy 10px against 48px for
    // a one-liner). A message that has just been sent always ends up at the
    // foot of the thread, so that is where the tail is projected to.
    const view = scrollRef.current?.getBoundingClientRect();
    const tailY = view ? Math.min(to.bottom, view.bottom - 16) : to.bottom;
    const dx = clamp(from.left + from.width / 2 - to.right, -56, 56);
    const dy = clamp(from.top + from.height / 2 - tailY, 10, 64);
    const css = getComputedStyle(document.documentElement);
    const dur = cssMs(css.getPropertyValue("--d-state"), 220);
    const easing = css.getPropertyValue("--ease-squash").trim() || "ease-out";
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.86)`, composite: "add" },
        { transform: "translate(0px, 0px) scale(1)", composite: "add" },
      ],
      { duration: dur, easing, fill: "none" },
    );
    return true;
  };

  // Which rows have already been on screen. Seeded with the WHOLE history on
  // mount, so opening the chat does not set four hundred saved messages
  // animating, and pulling older ones into the window does not either — only
  // things that ARRIVE arrive.
  const seenRows = useRef<Set<string> | null>(null);
  /** the id of the message he just sent, waiting for its element to exist */
  const launchId = useRef<string | null>(null);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const rows = root.querySelectorAll<HTMLElement>("[data-row]");
    if (!seenRows.current) {
      seenRows.current = new Set();
      for (const el of rows) seenRows.current.add(el.dataset.row || "");
      // and every message the window has not rendered yet, so scrolling back
      // to them later is history rather than an arrival
      for (const m of messagesRef.current) seenRows.current.add(m.id);
      return;
    }
    const seen = seenRows.current;
    let i = 0;
    for (const el of rows) {
      const id = el.dataset.row || "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (id === launchId.current) {
        launchId.current = null;
        // his bubble flies; the CSS entrance is told to fade only, or the two
        // transforms would both apply and it would arrive from twice as far
        el.setAttribute("data-enter", launchFromComposer(el) ? "launch" : "");
      } else {
        // Bubbles that land in the SAME commit stagger 80ms apart. In
        // conversation this never fires: her delivery loop already spaces
        // bubbles 280–1700ms apart, which is her real rhythm and is not
        // something a stylesheet should be second-guessing. It fires where
        // the app genuinely paints several at once — a cross-tab merge, and
        // undoing a clear — which are exactly the moments that otherwise read
        // as a page render rather than as someone speaking.
        if (i) el.style.setProperty("--enter-i", String(i));
        el.setAttribute("data-enter", "");
        i++;
      }
      // The attribute is the trigger, so it comes off once every animation it
      // started has finished — and "every" is the whole point. The first cut
      // was a single `{ once: true }` animationend listener, which fires on
      // whichever animation ends FIRST: the 180ms fade. Removing the attribute
      // there cancelled the 220ms rise at 82% of its length, which is exactly
      // the stretch where its overshoot settles back. The effect was a 0.3px
      // snap — invisible, and wrong, and the kind of wrong that stays wrong
      // because nobody can see it to report it.
      //
      // Waiting on the animations themselves needs no knowledge of their
      // names or their count, so it also survives the reduced-motion branch
      // (where the rise does not exist at all) with no second code path.
      requestAnimationFrame(() => {
        const running = el.getAnimations();
        const done = () => {
          el.removeAttribute("data-enter");
          el.style.removeProperty("--enter-i");
        };
        if (!running.length) return done();
        // allSettled, not all: an animation cancelled by a re-render rejects,
        // and a rejected cleanup is a `data-enter` that never comes off
        Promise.allSettled(running.map((a) => a.finished)).then(done);
      });
    }
  }, [messages]);

  // A long think gains a second beat. Deliberately keyed on `typing` itself,
  // so the clock restarts for every bubble of a burst: four seconds into THIS
  // one is the fact, not four seconds into the reply.
  useEffect(() => {
    if (!typing) {
      setLongThink(false);
      return;
    }
    const t = setTimeout(() => setLongThink(true), 4000);
    return () => clearTimeout(t);
  }, [typing]);

  // A message arriving while he is reading scrollback must never move the
  // thread — `atBottom` owns that and nothing here touches it. What it does
  // is nudge the pill that is already on screen, so a count changing behind
  // his back is something he sees change.
  const lastMissed = useRef(0);
  useEffect(() => {
    if (missed > lastMissed.current && showJump) restart(jumpRef.current, "data-pulse");
    lastMissed.current = missed;
  }, [missed, showJump]);

  // ── coming back to the thread ──────────────────────────────────────────
  // The shell animates on the way out and on the way back; the thread did
  // not, so returning from a call or a sheet was a cut. One 180ms settle,
  // on the scroller rather than on forty rows.
  const settle = () => restart(scrollRef.current, "data-settle");
  const wasInCall = useRef(Boolean(inCall));
  useEffect(() => {
    if (wasInCall.current && !inCall) settle();
    wasInCall.current = Boolean(inCall);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCall]);
  const wasOverlaid = useRef(false);
  useEffect(() => {
    const over = storyOpen || moreOpen;
    if (wasOverlaid.current && !over) settle();
    wasOverlaid.current = over;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyOpen, moreOpen]);
  // the game-return seam: activities are App-level siblings, so their edge
  // arrives as a prop — the one line WS-FEEL could not add in-bounds
  const wasActivity = useRef(false);
  useEffect(() => {
    if (wasActivity.current && !activityOpen) settle();
    wasActivity.current = Boolean(activityOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityOpen]);

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
        if (dirty.current) armBurst(chatSeq.current);
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
        if (dirty.current) armBurst(chatSeq.current);
      });
    }, 20_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // WS-SHECALLS residual (coordinator): she rang, he declined. One small
  // unhurt line, once, a beat later - the AFTERCALL idiom with a different
  // event. Local moment, cleared on consumption; any his-message first wins.
  const declinedDone = useRef(0);
  useEffect(() => {
    const iv = setInterval(() => {
      const at = state.declinedRing;
      if (!at || busy.current || delivering.current) return;
      if (declinedDone.current === at) return;
      const agoMs = Date.now() - at;
      if (agoMs < 25_000 || agoMs > 10 * 60_000) {
        if (agoMs > 10 * 60_000) setState((s) => ({ ...s, declinedRing: null }));
        return;
      }
      // he spoke after declining: the thread is alive, no line needed
      if (state.messages.some((m) => m.from === "me" && m.at > at)) {
        declinedDone.current = at;
        setState((s) => ({ ...s, declinedRing: null }));
        return;
      }
      declinedDone.current = at;
      setState((s) => ({ ...s, declinedRing: null }));
      busy.current = true;
      think(user, brainKeys(), state.messages, DECLINED_CALL_DIRECTIVE(Math.round(agoMs / 60_000)), "chat", "device", true).then(async (reply) => {
        if (reply.bubbles.length) {
          delivering.current = true;
          await deliver(reply);
          delivering.current = false;
        } else busy.current = false;
        if (dirty.current) armBurst(chatSeq.current);
      });
    }, 20_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.declinedRing, state.messages.length]);

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
          if (dirty.current) armBurst(chatSeq.current);
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
        // HER reaction landing on HIS message is the one thing in the thread
        // that arrives without a bubble to explain it, and it is about him
        // specifically. Level 2, the same weight as putting one on himself —
        // her side of the same act should not feel like a different act.
        // (Her MESSAGES stay silent, deliberately: three bubbles in four
        // seconds is a phone buzzing continuously. The note in haptics.ts.)
        land();
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
    // ── SHE ANSWERED, once ──────────────────────────────────────────────
    //
    // WS-SOUND. Every one of her messages in this delivery goes through
    // `landed` instead of `pushMsg`, and the FIRST one to arrive sounds the
    // `receive` cue. Not each one.
    //
    // The arithmetic is the same one haptics.ts uses to refuse her messages a
    // haptic at all: a three-bubble reply is three arrivals inside four
    // seconds, and three of anything in four seconds is an alarm rather than
    // an arrival. What is different about sound is that it decays and points,
    // so ONE of them is worth hearing where none were worth feeling. The
    // second and third bubbles are already carried by the thing they were
    // always carried by, which is the bubble entrance itself.
    //
    // Deliberately per-DELIVERY and not per-turn: a follow-up cycle after a
    // held [search:] lookup is genuinely a second time she came back, and it
    // gets its own arrival. A held delivery that keeps typing does not.
    let sounded = false;
    const landed = (m: Message) => {
      if (!sounded) {
        sounded = true;
        // `play`, not `feel`: the vocabulary gives `receive` no haptic, and
        // the reason is written next to it in src/sound/vocabulary.ts.
        play("receive");
      }
      pushMsg(m);
    };
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
      landed(photo);
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
      landed(msg);
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
        landed(msg);
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
      landed(msg);
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

  // ── the burst clock ────────────────────────────────────────────────────
  //
  // ALL of the judgment here belongs to engine/burst.ts — how long, whether
  // his words say more is coming, whether he is mid-word, and when to stop
  // waiting and answer what exists. This function is only the clock: it asks,
  // sleeps for exactly as long as it is told to, and asks again.
  //
  // It re-arms rather than sleeping once because the answer CHANGES while it
  // waits — he starts typing, he stops typing, the ceiling arrives. A single
  // setTimeout can only encode the answer at the moment it was set, which is
  // how a time-only burst wait ends up answering the first of six messages.
  //
  // `burstDecide` guarantees `recheckMs` never sleeps past his oldest
  // unanswered message's deadline, so this loop cannot spin forever and cannot
  // stall forever. Both directions are pinned in evals/burst.mjs.
  //
  // NEVER-SCHEDULED, still true. `firstUnansweredAt` is 0 when nothing of his
  // is waiting, and both waiters stop dead on that. She is never on a bare
  // timer; the trigger is always a message of his that has not been answered.
  // ── the soft keyboard, as a presence signal ──────────────────────────────
  //
  // There is no keyboard API. What every platform DOES do is shrink the visual
  // viewport, and this app already watches that (`main.tsx` writes --vvh from
  // it, and the effect above keeps the thread pinned through it) — the signal
  // was already arriving and nothing downstream of it knew what it meant.
  //
  // Sensed against the TALLEST viewport seen in this orientation rather than
  // `innerHeight`: Chromium resizes the layout viewport via the
  // interactive-widget meta and iOS Safari does not, so `innerHeight` means two
  // different things on the two platforms and the high-water mark means the
  // same thing on both. A rotation invalidates the mark, so it is reset there.
  //
  // 140px, and it is a DEVICE threshold rather than a policy constant — no
  // soft keyboard on any phone is shorter than that, and no browser chrome
  // collapse is taller. The policy that reads it lives in burst.ts, which is
  // the line burstwiring.mjs holds this file to.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let tallest = vv.height;
    const onResize = () => {
      tallest = Math.max(tallest, vv.height);
      const open = tallest - vv.height > 140;
      if (open !== keyboardOpen.current) {
        keyboardOpen.current = open;
        // OPENING is the act — he reached for the box. Closing is not: it is
        // the state every sent message leaves behind, and stamping the clock on
        // it would put a hold under every message. `burstDecide` only counts
        // engagement that postdates his last message; see its own note.
        if (open) engaged();
      }
    };
    const onRotate = () => {
      tallest = window.visualViewport?.height ?? tallest;
      keyboardOpen.current = false;
    };
    vv.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onRotate);
    return () => {
      vv.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onRotate);
    };
  }, []);

  function burstNow(): { fire: boolean; recheckMs: number; log: () => void } | null {
    const turns = messagesRef.current as unknown as BurstTurn[];
    const tail = unansweredTail(turns);
    // messagesRef can be one render behind the push that armed this, so
    // `dirty` — which means exactly "his messages not yet covered by a reply" —
    // is the fallback fact, not a guess.
    const firstAt = tail.firstAt || (dirty.current ? lastUserAt.current : 0);
    if (!firstAt) return null;
    const d = burstDecide({
      now: Date.now(),
      firstUnansweredAt: firstAt,
      // the NEWEST of the two, never `tail.lastAt` alone: `messagesRef` can be
      // one render behind the push that armed this, and taking the older of a
      // stale list and a fresh send time would compute a due date that has
      // already passed — which answers his first message the instant his
      // second one arrives, i.e. the exact bug this file is fixing.
      lastUserAt: Math.max(tail.lastAt, dirty.current ? lastUserAt.current : 0),
      gaps: recentUserGaps(turns),
      his: tail.texts,
      herLast: tail.herLast,
      draftLength: draftRef.current.trim().length,
      lastKeyAt: lastKeyAt.current,
      // how often HE doubles, from the whole persisted thread — the wait's
      // breadth, where `gaps` is only its depth
      followUpRate: followUpRate(turns),
      composerFocused: composerFocused.current,
      keyboardOpen: keyboardOpen.current,
      lastEngagedAt: lastEngagedAt.current,
    });
    return {
      fire: d.fire,
      recheckMs: d.recheckMs,
      // Counts and rule names only, never his text — the rule diag.ts holds.
      // This is the only way to find out afterwards whether the hold is tuned,
      // which is what this repo asks for before it asks for prose.
      log: () =>
        tel("chat.burst", {
          reason: d.reason,
          held_ms: d.heldMs,
          wait_ms: d.waitMs,
          msgs: tail.count,
          cont: d.continuation.reason,
          // the two fields that would have found this recurrence from the
          // telemetry alone: what shortened the breath, and whether she could
          // see him at the keyboard at all when she took the floor.
          done: d.completion.reason,
          eng: (composerFocused.current ? "f" : "") + (keyboardOpen.current ? "k" : "") || "-",
        }),
    };
  }

  function armBurst(seq: number) {
    if (burstTimer.current) clearTimeout(burstTimer.current);
    const tick = () => {
      burstTimer.current = null;
      if (seq !== chatSeq.current || inCallRef.current) return;
      const d = burstNow();
      if (!d) return;
      if (!d.fire) {
        burstTimer.current = setTimeout(tick, d.recheckMs);
        return;
      }
      d.log();
      void replyCycle(seq);
    };
    // deferred, never synchronous: this is called from inside `send()`, before
    // React has flushed the push, so a synchronous read of `messagesRef` would
    // be looking at the thread WITHOUT the message it was armed for.
    burstTimer.current = setTimeout(tick, 0);
  }

  /**
   * The same clock, awaited from INSIDE a reply chain.
   *
   * Between passes she is still mid-turn — she has just delivered, and more of
   * his has landed — so the flags stay held and only the waiting is shared
   * with `armBurst`. Resolves false when there is nothing of his left to
   * answer, or the chat was cleared, or a call started: the chain ends there.
   */
  function awaitBurst(seq: number, ep: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tick = () => {
        chainTimer.current = null;
        if (ep !== epoch.current || inCallRef.current) return resolve(false);
        const d = burstNow();
        if (!d) return resolve(false);
        if (d.fire) {
          d.log();
          return resolve(true);
        }
        chainTimer.current = setTimeout(tick, d.recheckMs);
      };
      void seq;
      tick();
    });
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
    armBurst(++chatSeq.current);
  }

  function lastUserText(): string {
    const hist = messagesRef.current;
    for (let i = hist.length - 1; i >= 0; i--) {
      const m = hist[i];
      if (m.from === "me" && m.channel !== "call") return m.text;
    }
    return "";
  }

  /**
   * EVERYTHING he said that she has not answered yet, as one string.
   *
   * `toTurns` already merges his consecutive messages into a single user turn,
   * so the MODEL always saw the whole burst. This is the other half: `latest`
   * is what the non-turn readers get — the recall query, her taste pull, the
   * culture note, and the read beat that decides how long she spends looking
   * at the screen before "typing…" appears. All four were seeing only the last
   * fragment, so a burst of "kal ka plan cancel ho gaya" / "ab kya karein"
   * looked up memories for "ab kya karein" and read three messages in the time
   * it takes to read one.
   *
   * Newline-joined, oldest first, so it reads the way the thread reads.
   */
  function lastUserBurstText(): string {
    const tail = unansweredTail(messagesRef.current as unknown as BurstTurn[]);
    const joined = tail.texts.filter(Boolean).join("\n").trim();
    return joined || lastUserText();
  }

  /**
   * THE REPLY CHAIN — one owner of the flags, one release, and no recursion.
   *
   * `busy-held-across-recursion` (context/rejected.md) is the reason this is
   * shaped the way it is. That bug was one missing `busy.current = false` on
   * one of three recursive paths, and its cost was not a lost reply: the flag
   * was never lowered again, so every later `scheduleReply()` died at the same
   * guard and the conversation was dead until reload — from one burst, on the
   * exact path written to serve bursts. Review did not catch it because each
   * line was individually correct and a missing release is invisible in a diff
   * that contains no releases.
   *
   * So the class is removed rather than the instance. The flags are taken HERE,
   * exactly once, and released in a `finally` that no early return, thrown
   * error or awaited branch can skip. The chain that used to recurse is now a
   * loop, so a continuation can never re-enter through the guard that the
   * outer call is still holding. Adding a fourth branch to `replyPass` cannot
   * reintroduce the bug: there is nothing for it to forget to release.
   *
   * The bound on the loop is not defensive dressing. Each pass either delivers
   * or is superseded, and both consume real time; the cap only stops a
   * pathological supersede storm from holding the flags across an unbounded
   * number of model calls.
   */
  const REPLY_CHAIN_MAX = 6;

  async function replyCycle(seq: number): Promise<void> {
    if (seq !== chatSeq.current || inCallRef.current) return; // superseded
    if (thinkingChat.current) return; // running cycle chains the newest seq
    if (delivering.current) return; // deliver-end chains a follow-up
    if (busy.current) return; // directive cycle in flight — dirty chains after
    const ep = epoch.current;
    try {
      let s = seq;
      for (let i = 0; i < REPLY_CHAIN_MAX; i++) {
        // Re-taken every pass because deliver() lowers `busy` at the end of the
        // one it just finished, and the chain is still mid-turn.
        busy.current = true;
        thinkingChat.current = true;
        if (!(await replyPass(s, ep))) return;
        // more of his landed. Wait out the burst policy again — he may still
        // be typing — then re-read EVERYTHING and answer it as one thing.
        if (!(await awaitBurst(chatSeq.current, ep))) return;
        s = chatSeq.current;
      }
    } finally {
      thinkingChat.current = false;
      busy.current = false;
      if (chainTimer.current) {
        clearTimeout(chainTimer.current);
        chainTimer.current = null;
      }
    }
  }

  /**
   * One pass of the chain. Returns true when more of his has arrived and the
   * chain should go round again; false when this turn is finished.
   *
   * It takes no flag and releases no flag — that is `replyCycle`'s job and its
   * alone. Every `return false` here is a normal end of turn, and the release
   * happens above it in the `finally`.
   */
  async function replyPass(seq: number, ep: number): Promise<boolean> {
    dirty.current = false;
    const latest = lastUserBurstText();
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
    // ── THE DOCUMENTS THIS PASS OWES HER ────────────────────────────────────
    //
    // THE ONE CALLER of `think`'s `attachments` seam, and the reason it is a
    // take-once box rather than a value read off state:
    //
    //   * TAKEN BEFORE THE CALL, so a pass that starts while this one is in
    //     flight cannot take the same documents and hand her the same PDF
    //     twice inside one turn.
    //   * PUT BACK WHEN THIS PASS IS SUPERSEDED, so the pass that actually
    //     delivers is the one that carries them. Without this, attaching a file
    //     and then typing a second line before she answers would throw the file
    //     away: the first pass would consume it and then be discarded unread.
    //   * DROPPED on an epoch change, because an epoch change is the
    //     conversation being torn down and a document belongs to the
    //     conversation it was sent to.
    //
    // PICTURES ARE DELIBERATELY NOT HERE. They ride the thread — `toTurns`
    // rebuilds them out of `photoUrls` on every turn — so passing them again
    // would put the same picture in the prompt twice. attachments.ts and
    // brain.ts's seam comment both state the split; this is where it is obeyed.
    const turnDocs = takeDocs(docHold);
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
      turnDocs ? { docs: turnDocs } : undefined,
    );
    if (ep !== epoch.current) return false; // chat was cleared mid-think
    if (seq !== chatSeq.current) {
      // MESSAGES LANDED MID-GENERATION. What came back answers a question he
      // has already moved past, so it is thrown away unread and the chain goes
      // round — through the burst clock, because he may well still be typing.
      // Nothing is released here and nothing needs to be: the flags belong to
      // replyCycle's `finally`.
      //
      // The documents go back in the box: this pass never reached him, so they
      // have not been delivered and the next pass is the one that owes them.
      // `restoreDocs` refuses to overwrite a NEWER send's documents, which is
      // the case where he attached something else while she was thinking.
      restoreDocs(docHold, turnDocs);
      return true;
    }
    mergeLearned(reply.learned);
    delivering.current = true;
    try {
      await deliver(reply, latest, readFrom);
    } finally {
      delivering.current = false;
      // deliver() lowers `busy` when it finishes. The chain is still mid-turn,
      // so take it straight back — otherwise a burst timer that fires in this
      // window starts a SECOND cycle alongside this one.
      busy.current = true;
    }
    // MESSAGES LANDED MID-DELIVERY, between her bubbles. She notices and
    // follows up, exactly as a person does when a message arrives while they
    // are still typing the last one.
    if (dirty.current && ep === epoch.current) return true;
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
    return false;
  }

  // ── clearing and forgetting, both with a way back ─────────────────────
  // The old flow was: tap an unlabelled broom twice within 2.6 seconds and
  // the conversation, her improvised life and her carried feeling were gone
  // with no confirmation and no recovery. Now both destructive actions are
  // named in a sheet, and for ten seconds afterwards they are only parked.
  //
  // the local teardown they share: whatever she was mid-way through belongs
  // to a conversation that is about to not exist
  function tearDownLocally(mode: "clear" | "forget" = "clear"): Snapshot {
    const snapshot = {
      // forget takes the profile with it (C1): everything she has worked out
      // about your life INCLUDES who you are. Clear-chat leaves it, per its
      // own dialog ("her memory of you is not touched").
      ...(mode === "forget" ? { user: state.user } : {}),
      messages: state.messages,
      herLife: state.herLife,
      herNow: state.herNow,
      inner: state.inner,
      clearedAt: state.clearedAt,
      game: state.game,
      activities: state.activities,
      callback: state.callback,
      tally: state.tally,
      momentsFired: state.momentsFired,
      recentMoment: state.recentMoment,
      declinedRing: state.declinedRing ?? null,
      shares: state.shares,
      // wiped below like the rest, and so it has to come back like the rest:
      // an undone clear that silently drops her armed "back in 20 min" is a
      // promise she made and then didn't keep, which is the one kind of
      // forgetting this product cannot afford
      followup: state.followup,
    };
    busy.current = false;
    epoch.current += 1; // kill any in-flight reply from the old chat
    // and any reply that has not started yet: an armed burst timer belongs to
    // the conversation that armed it. `dirty` goes with it — it means "his
    // messages not yet answered", and there are no longer any messages.
    if (burstTimer.current) clearTimeout(burstTimer.current);
    burstTimer.current = null;
    if (chainTimer.current) clearTimeout(chainTimer.current);
    chainTimer.current = null;
    dirty.current = false;
    if (readTimer.current) clearTimeout(readTimer.current);
    typingSince.current = 0;
    setTyping(false);
    setReplyTo(null);
    setReplySel(null);
    // The staged pictures and documents go too, the viewer over them closes,
    // and the documents parked for the next reply pass are dropped unsent.
    //
    // All four are DRAFT state living only in this component (see the tray's
    // own note by `attachments` above), so evals/teardown.mjs's FATE walker
    // cannot see them — which is exactly the shape of the reachability gap that
    // file's §6 exists for. The verdict is the same one every draft gets, and
    // it is `clear+forget`: a picture staged for a conversation that no longer
    // exists belongs to that conversation, and a viewer left open over a wiped
    // thread is the wiped thread still on screen. Cleared on BOTH doors,
    // because clear-chat's promise is about her memory of him and never about
    // his own half-written message.
    //
    // `docHold` is the one that would have been missed, and it is the worst of
    // the four: it holds the TEXT of a document, it is a ref rather than state
    // so nothing about a re-render disturbs it, and a survivor would be handed
    // to the very first reply of the conversation that begins by not knowing
    // him. The epoch bump above already stops the in-flight pass from
    // delivering, but a parked payload outlives an epoch on its own — nothing
    // reads the epoch when taking it.
    setAttachments([]);
    setDocs([]);
    docHold.current = null;
    setSourceOpen(false);
    setViewer(null);
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
      // Her present moment goes with the conversation. It is a small row and
      // it would have been a loud survival: the first thing she says to
      // someone she has just been told she has never met would be twenty
      // minutes into a book she was reading FOR HIM — `activity-forgot-the-
      // teardown`, a fourth time. It is deterministic, so the next read
      // rebuilds one; what must not survive is the started-at she shared
      // with the relationship that has just been deleted.
      herNow: null,
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
      // The ledger of finished games goes with the current one, and for the
      // same reason `game` does: she asked whether they should continue the
      // chess match in the conversation that starts by not knowing him. A
      // ledger that survives is that, three games over and in writing —
      // "we played chess on 22 aug, you left it on move 6" said to a stranger.
      // It also feeds `activityVocab`, so a surviving ledger would make her
      // invented shared history SUPPORTED by the very gate that exists to
      // catch it — the identical hole `recentMoment` was the third instance of.
      activities: [],
      callback: null,
      ...(mode === "forget"
        ? { user: { name: "", vibe: [], facts: {} } }
        : {}),
      // The audit's second omission of the same rule: the wipe left "12
      // games of chess, she's ahead 7-5" on a record whose first message is
      // now today — and every id in the fired ledger stayed dead forever, so
      // a post-forget relationship could never fire "your first game". Every
      // AppState field decides its teardown fate the day it is added.
      tally: null,
      momentsFired: [],
      // The THIRD field to slip through this same hole, and the loudest: the
      // ledger above is what stops a moment firing twice, but `recentMoment`
      // is the moment itself, held for a few hours so she can bring it up.
      // Surviving a forget means her first sentences to someone she has never
      // met are about their hundred days together — and `momentLine` feeds
      // `sharedVocab`, so the honesty layer marks that invented history
      // SUPPORTED and never flags it. `evals/teardown.mjs` now checks this
      // class mechanically: every optional AppState field is either wiped here
      // or exempted in writing, so the fourth field cannot slip quietly.
      recentMoment: null,
      declinedRing: null,
      // The FIFTH field under the same rule (WS-SHARENOW), and it is the class
      // the rule was written for: "you were watching their screen together
      // till 3 min ago, and here is what you said about it" is a shared minute
      // recited to someone she has just been told she has never met. Wiped by
      // BOTH doors like the ledger above it — the mirror is the conversation's
      // own state, not a device fact.
      shares: [],
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
    const token = state.auth?.accessToken;
    park(`${HER_NAME} forgot everything`, tearDownLocally("forget"), () => {
      forgetMemories(device, { scope: "all" }, token);
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
      herNow: snap.herNow,
      inner: snap.inner,
      clearedAt: snap.clearedAt,
      game: snap.game,
      activities: snap.activities,
      callback: snap.callback,
      tally: snap.tally,
      momentsFired: snap.momentsFired,
      recentMoment: snap.recentMoment,
      declinedRing: snap.declinedRing ?? null,
      shares: snap.shares,
      followup: snap.followup,
      // the profile comes back only if the teardown took it (forget path)
      ...(snap.user ? { user: snap.user } : {}),
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
    // PICTURES FIRST. When the tray holds anything, this send is that message
    // and the box is its caption — including an empty one, which is the
    // ordinary case of sending a photo with nothing to say about it.
    if (attachments.length || docs.length) {
      void sendAttachments();
      return;
    }
    if (!text) return; // sending is NEVER blocked — she adapts, like a person
    setDraft("");
    // the box is empty again: the composing hold has nothing left to hold on
    draftRef.current = "";
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
    // ── the send, felt ──────────────────────────────────────────────────
    // Level 1 of the haptic vocabulary (native/haptics.ts): he did something
    // and the app felt it. Fired HERE, in the same handler that commits the
    // message, because a haptic that arrives after a timeout has already
    // drifted away from the picture it belongs to.
    //
    // WS-SOUND: `feel("send")` is that same tap() plus the whoosh, from one
    // call, on the same frame as the composer recoil below. It was `tap()`.
    // The cue's haptic level is read out of the sound vocabulary's table
    // rather than named here, so the two channels cannot be changed apart.
    feel("send");
    // the composer recoils as the message leaves it, and the bubble it left
    // is picked up by the layout effect that owns arrivals
    launchId.current = mine.id;
    restart(fieldRef.current, "data-sent");
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

  // ══ SENDING HER PICTURES AND DOCUMENTS ═════════════════════════════════
  //
  // ── what changed, and why ────────────────────────────────────────────────
  //
  // This used to be: tap the camera glyph, get a file dialog, and whatever came
  // back was SENT, immediately, alone. Three things were wrong with that and
  // the owner named all three. There was no way to say anything with a picture
  // (his words: in WhatsApp we get an option to write something with it). There
  // was no camera — the glyph was a camera and the dialog was a file browser.
  // And one picture was the limit, silently, with nothing on screen to say so.
  //
  // So picking no longer sends. A picked picture lands in the TRAY, the
  // composer's own text box becomes its caption field, and ONE send puts up to
  // five pictures, three documents and one caption into one message. The source
  // question is asked first, as a sheet, because it has three answers.
  //
  // ── THE TWO ROUTES, AND WHY THEY ARE DIFFERENT ───────────────────────────
  //
  // PICTURES are uploaded, stored on the message, and reach her through the
  // THREAD: `brain.ts`'s `toTurns` rebuilds them as `image_url` parts out of
  // `photoUrls` on every turn for the next six messages. DOCUMENTS are never
  // uploaded and never stored, so `toTurns` has nothing to rebuild and the one
  // turn they are sent on is their only chance — they go through `think`'s
  // `attachments` parameter instead.
  //
  // Sending pictures through BOTH would put the same picture in the prompt
  // twice on the turn it was sent. The rule is written out once in
  // `attachments.ts` and once in `brain.ts`'s seam comment; this is the caller
  // that has to obey it.
  //
  // ── WHERE THE RULES LIVE ─────────────────────────────────────────────────
  //
  // Not here. `components/attachments.ts` owns the caps, the byte rails, the
  // collage arrangement, the wire shapes, the compressor and the take-once box,
  // because every one of those is pure and this file is three thousand lines of
  // React that no test can reach. This function is the wiring between that
  // module, the DOM and her reply cycle, and it should stay that thin.
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [docs, setDocs] = useState<DocAttachment[]>([]);
  const [sourceOpen, setSourceOpen] = useState(false);
  // one beat of "that one did not fit", cleared by its own timer
  const [refused, setRefused] = useState(false);
  const refuseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // the full-screen viewer, opened by tapping a picture in the thread
  const [viewer, setViewer] = useState<{ urls: string[]; start: number; caption: string } | null>(
    null,
  );
  /**
   * THE DOCUMENTS THAT ONE REPLY PASS OWES HER.
   *
   * A ref rather than state on purpose: this must not cause a render, and more
   * importantly it must be readable and writable SYNCHRONOUSLY inside the reply
   * chain, where a state value would be a stale snapshot from whenever the pass
   * closed over it. See `attachments.ts`'s note on the take-once box for why
   * "take before the call, put back if superseded" is the shape.
   */
  const docHold = useRef<DocHold>({ current: null }).current;
  /** How many more of each this message can still take. */
  const roomImages = MAX_ATTACHMENTS - attachments.length;
  const roomDocs = MAX_DOCS - docs.length;
  useEffect(
    () => () => {
      if (refuseTimer.current) clearTimeout(refuseTimer.current);
    },
    [],
  );

  /** The refusal, felt and seen, never modal. One place, three callers. */
  function refuse() {
    // `tap()` is the quietest thing the hardware can do and this is the one
    // place in the feature where the app says no; the count line above the tray
    // carries the same answer in words, and nudges so that the eye finds it.
    tap();
    setRefused(true);
    if (refuseTimer.current) clearTimeout(refuseTimer.current);
    refuseTimer.current = setTimeout(() => setRefused(false), 700);
  }

  /**
   * Documents arriving from the file picker.
   *
   * `packDoc` decides per file whether the client can read the text itself (a
   * .txt, a .csv) or whether the bytes have to go up for `api/_docs.js` to
   * extract (a PDF). Everything past that is the same partial-accept cap the
   * pictures get.
   */
  async function takeDocFiles(files: File[]) {
    if (!files.length) return;
    const packed = await Promise.all(files.map((f) => packDoc(f)));
    const fresh = packed.filter((d): d is DocAttachment => Boolean(d));
    if (!fresh.length) {
      showNotice("couldn't read that file. try a pdf, text, csv or json");
      return;
    }
    const res = addDocs(docs, fresh);
    setDocs(res.next);
    if (res.accepted) tel("chat.attach_add", { source: "document", n: res.accepted, total: res.next.length });
    if (res.refused) {
      refuse();
      tel("chat.attach_refused", { source: "document", n: res.refused, why: res.reason ?? "" });
    }
  }

  /**
   * Pictures arriving from either source.
   *
   * Compressed through the ONE pipeline before anything else looks at them, so
   * the tray, the byte rail and the wire all deal in the same bytes the model
   * will see. A file that will not decode is dropped with the notice the
   * single-photo path already used; a whole selection that will not decode says
   * so once rather than once per file.
   */
  async function takeFiles(files: File[], source: "camera" | "gallery") {
    if (!files.length) return;
    const packed = await Promise.all(files.map((f) => compressImage(f)));
    const fresh: Attachment[] = [];
    let unreadable = 0;
    packed.forEach((p, i) => {
      if (p && p.b64) fresh.push({ id: `${Date.now()}-${i}-${uid()}`, ...p, source });
      else unreadable++;
    });
    if (unreadable && !fresh.length) {
      showNotice("couldn't read that photo. try a different one");
      return;
    }
    const res = addAttachments(attachments, fresh);
    setAttachments(res.next);
    if (res.accepted) tel("chat.attach_add", { source, n: res.accepted, total: res.next.length });
    if (res.refused) {
      refuse();
      tel("chat.attach_refused", { source, n: res.refused, why: res.reason ?? "" });
    }
  }

  /**
   * The tray, sent: ONE message carrying its pictures, its documents and the
   * caption under both.
   *
   * The caption belongs to the whole send, not to one half of it. A person who
   * attaches a photo and a PDF and types one line has said that line about the
   * pair, and splitting it into two messages would be the app deciding which of
   * them he meant.
   */
  async function sendAttachments() {
    const atts = attachments;
    const dcs = docs;
    if (!atts.length && !dcs.length) return;
    const caption = draft.trim();
    const payload = buildImagePayload(atts, caption);
    const docPayload = buildDocPayload(dcs);
    setAttachments([]);
    setDocs([]);
    setDraft("");
    // the box is empty again: the composing hold has nothing left to hold on
    draftRef.current = "";
    const hasImages = payload.images.length > 0;
    const mine: Message = {
      id: uid(),
      from: "me",
      // A DOCUMENT DOES NOT GET ITS OWN `kind`. See MessageRow.tsx: nine
      // readers across six files switch on this field, and a value none of them
      // handle renders as an empty bubble in whichever one was missed. A send
      // with pictures is a photo message that happens to carry files; a send
      // with only files is a text message that does, and `docs` is what both
      // of them read.
      kind: hasImages ? "photo" : "text",
      text: caption,
      // instant local render; both swapped for storage URLs once they land.
      // `photoUrl` is written even for a set, because every reader that
      // predates this feature knows only that field (see store.ts).
      ...(hasImages ? { photoUrl: payload.images[0] } : {}),
      ...(payload.images.length > 1 ? { photoUrls: payload.images } : {}),
      // METADATA ONLY. The bytes are on their way to the model and are never
      // written to disk — store.ts states the whole argument beside the field.
      ...(dcs.length ? { docs: docRefs(dcs) } : {}),
      at: Date.now(),
      status: "sent",
      ...(replyTo ? { replyTo: { from: replyTo.from, text: replyTo.text } } : {}),
    };
    setReplyTo(null);
    if (state.followup) setState((s) => ({ ...s, followup: null }));
    // the same commit haptic and whoosh a text send gets. Sending five
    // pictures is at least as deliberate an act as sending "ok".
    feel("send");
    pushMsg(mine);
    if (caption) composer.send(mine.id, caption);
    tel("chat.send", {
      msg_id: mine.id,
      kind: mine.kind,
      chars: caption.length,
      n: payload.images.length,
      docs: docPayload.length,
    });
    tel("chat.media", {
      kind: hasImages ? "photo" : "doc",
      msg_id: mine.id,
      from: "me",
      n: payload.images.length,
      docs: docPayload.length,
      bytes: atts.reduce((sum, a) => sum + a.b64.length, 0),
      doc_bytes: dcs.reduce((sum, d) => sum + d.size, 0),
    });
    if (hasImages) {
      track(
        state.deviceId,
        "photo_shared",
        { caption: Boolean(caption), n: payload.images.length },
        state.auth?.userId,
      );
    }
    if (docPayload.length) {
      track(
        state.deviceId,
        "doc_shared",
        { caption: Boolean(caption), n: docPayload.length },
        state.auth?.userId,
      );
    }
    setTimeout(() => upgradeMyStatus("delivered"), 500 + Math.random() * 700);
    // WHAT SHE STILL HAS IN THREE MONTHS. The pictures leave the vision window
    // after six messages and the document text is never stored at all, so this
    // line is the whole of the long-term record: "[2 photos] [file lease.pdf]
    // ye dekh". Same shape the single-photo path has always written.
    logTurns(state.deviceId, [
      {
        ...mine,
        text: transcriptLine(payload.images.length, caption, dcs.map((d) => d.name)),
      },
    ]);
    // THE DOCUMENTS THIS TURN OWES HER, parked for exactly one reply pass.
    // Set BEFORE `scheduleReply` so the pass that wakes cannot start without
    // them, and taken there rather than passed down through the burst timer,
    // which is a clock and has no business carrying a payload.
    holdDocs(docHold, docPayload);
    // the pictures join the same burst pipeline as text — she sees them (vision
    // reads the local data URLs until the storage upload lands) and can fold
    // them into one reply with whatever else you're sending
    scheduleReply(caption);
    if (!hasImages) return; // nothing to upload: documents are never stored
    // background: permanent copies in storage (they survive devices) + one
    // factual line per picture for her long-term context, which is what she
    // still has months later when the vision window is long past them
    uploadPhotos(state.deviceId, payload.images, caption).then(async (urls) => {
      if (!urls.some(Boolean)) return; // every upload failed: keep the local copies
      const landed = urls.map((u, i) => u || payload.images[i]);
      setState((s) => ({
        ...s,
        messages: s.messages.map((x) =>
          x.id === mine.id
            ? {
                ...x,
                photoUrl: landed[0],
                ...(landed.length > 1 ? { photoUrls: landed } : {}),
              }
            : x,
        ),
      }));
      const stored = urls.filter((u): u is string => Boolean(u));
      const descs = await Promise.all(stored.map((u) => describePhoto(state.deviceId, u)));
      // Joined rather than kept apart: `desc` is ONE line in her context, and a
      // set of pictures was one thing he showed her.
      const desc = descs.filter(Boolean).join(" · ");
      if (!desc) return;
      setState((s) => ({
        ...s,
        messages: s.messages.map((x) => (x.id === mine.id ? { ...x, desc } : x)),
      }));
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
  // ── THE GAME INVITE ──────────────────────────────────────────────────────
  //
  // The tester: *"she should be able to initiate game chat me se if prompted
  // to"*. He types "chalo chess khelte h" and the board should be one tap
  // from that sentence instead of a trip through a menu.
  //
  // PRESENTATION ONLY, and the split is load-bearing. Nothing here touches
  // the reply cycle, the burst clock or `deliver()`: the whole decision is
  // `detectGameInvite`, a pure function of the messages that are already on
  // screen (src/engine/gameInvite.ts), re-derived every render with no state
  // of its own. That is also what makes "at most one pending invite" true by
  // construction rather than by bookkeeping — the detector anchors on HER
  // latest line, and there is only ever one of those.
  //
  // IT DOES NOT AUTO-OPEN. He may be mid-sentence, and a room that takes the
  // screen because of something he typed is the app deciding what he meant.
  // The tap IS the consent, which is the same rule the story ring and the
  // call button already follow.
  const [inviteTaken, setInviteTaken] = useState<string | null>(null);
  const invite = useMemo(
    // No route in means no chip: a chip that cannot open anything is worse
    // than no chip, and this prop is optional so the thread still renders in
    // a harness that does not pass it.
    () => (onOpenActivity ? detectGameInvite(visible, Date.now()) : null),
    [visible, onOpenActivity],
  );
  const pendingInvite = useMemo(() => {
    if (!invite) return null;
    // Keyed on the ASK, never on the anchor. The anchor moves every time she
    // says anything else, and keyed on it a chip he had already tapped came
    // back the moment her next bubble landed (caught by the browser battery,
    // not by review).
    if (inviteTaken === invite.askId) return null;
    // Already taken, on this device or another one. The local flag above dies
    // with the mount; this survives a reload, which is when a chip he already
    // used would otherwise come back looking unpressed. A session that STARTED
    // before the invite was offered is a different, older game and does not
    // count as having answered it.
    const g = state.game;
    const openKind: GameKind | null =
      !g || g.closedAt
        ? null
        : g.kind === "chess"
          ? "chess"
          : g.kind === "ttt"
            ? "tic-tac-toe"
            : "would-you-rather";
    if (openKind === invite.kind) {
      const at = visible.find((m) => m.id === invite.askId)?.at ?? 0;
      if ((g?.startedAt ?? 0) >= at) return null;
    }
    return invite;
  }, [invite, inviteTaken, state.game, visible]);
  // Reported once per invite, on the rising edge — a chip is a thing the app
  // OFFERED, and an offer nobody counts is an offer nobody can tune.
  const invitedRef = useRef("");
  useEffect(() => {
    if (!pendingInvite || invitedRef.current === pendingInvite.askId) return;
    invitedRef.current = pendingInvite.askId;
    tel("chat.game_invite", { kind: pendingInvite.kind, via: pendingInvite.via });
  }, [pendingInvite]);

  // ── SHE CALLS HIM ────────────────────────────────────────────────────────
  //
  // The owner's screenshot, in two lines:
  //
  //     him: "U can call me"
  //     her: "call button click kar na, main thodi kar sakti hu"
  //
  // She has been able to ring him since #107 — a dropped call arms
  // `AppState.callback`, App paints `IncomingCall`, and accepting mounts the
  // live call with `sheCalled=true` so she opens as the CALLER. What was
  // stale was her belief, and she spent it declining a thing she can do.
  //
  // THE RING GOES THROUGH THAT SAME SEAM, and building a second one was the
  // main thing this change had to not do. `AppState.callback` is the single
  // fact in this product that means "she is phoning him": App owns the due
  // time, the 10-minute plausibility TTL, the accept path that sets
  // `callFrom="her"`, and the decline path that clears it and does not
  // reschedule. A parallel path would be a second answer to "does she know
  // she called", and two answers to that question is exactly the drift
  // `useCallEngine`'s own comment warns about where it threads `sheCalled`.
  // It also inherits the notify lane for free: App's missed-call effect is
  // armed by `state.callback` itself, so a ring that lands while the app is
  // backgrounded already reaches the lock screen on web and on Android.
  //
  // ANCHORED ON HER REPLY, WHICH IS THE SEQUENCING. `detectCallInvite`
  // returns nothing until she has answered his ask in words, so the ring can
  // only ever follow her line — and `ringAt` puts it 2-6s behind it. Nothing
  // here touches the reply cycle, the burst clock or `deliver()`; the whole
  // decision is a pure function of the messages already on screen.
  //
  // THIS IS INVITATION-TRIGGERED, NOT PROACTIVE. Its only input is a sentence
  // he typed. `decisions.md#proactive-reason-contingent` is untouched: there
  // is no timer here, no predicate on his silence, and nothing that can ring
  // a thread he has not asked in.
  const callInvite = useMemo(
    () => detectCallInvite(visible as unknown as CallTurn[], Date.now()),
    [visible],
  );
  // ONE PENDING SHE-CALL, ACROSS RELOADS. `state.callback` alone makes a
  // repeat ask non-stacking while the ring is up, and a ref makes it
  // non-stacking within this mount — but neither survives a reload, and the
  // ask is still sitting in the thread afterwards. Without this, declining
  // her call and reopening the app inside the freshness window rang him
  // again, which is `IncomingCall.tsx`'s own law broken ("a declined call
  // that comes back is a product nobody wants"). Device-local, like the
  // callback it guards, and capped so it cannot grow.
  const CALL_TAKEN_KEY = "meera.shecall.taken";
  const callTaken = (askId: string): boolean => {
    try {
      return (JSON.parse(localStorage.getItem(CALL_TAKEN_KEY) || "[]") as string[]).includes(askId);
    } catch {
      return false;
    }
  };
  const markCallTaken = (askId: string) => {
    try {
      const prev = JSON.parse(localStorage.getItem(CALL_TAKEN_KEY) || "[]") as string[];
      localStorage.setItem(CALL_TAKEN_KEY, JSON.stringify([...prev, askId].slice(-20)));
    } catch {
      /* private mode, quota, no storage — the ref and state.callback still hold */
    }
  };
  const sheCallArmed = useRef("");
  useEffect(() => {
    if (!callInvite) return;
    if (inCall) return; // they are already talking
    if (state.callback) return; // a ring is already pending: asks do not stack
    if (sheCallArmed.current === callInvite.askId) return;
    if (callTaken(callInvite.askId)) return;
    // A call that already happened ANSWERS the ask. Without this, hanging up
    // and saying anything else re-derived the same invite off the same ask.
    const askAt = visible.find((m) => m.id === callInvite.askId)?.at ?? 0;
    if (visible.some((m) => m.kind === "callmark" && (m.at || 0) > askAt)) return;
    sheCallArmed.current = callInvite.askId;
    markCallTaken(callInvite.askId);
    const at = ringAt(Date.now());
    // `secs: 0` — the subtitle's "call cut at m:ss" is a fact about a dropped
    // call and there was no dropped call here, so it renders nothing rather
    // than a number that would be a small lie on the biggest screen in the
    // product.
    setState((s) => (s.callback ? s : { ...s, callback: { at, secs: 0 } }));
    tel("chat.she_calls", { via: callInvite.via, in_ms: at - Date.now() });
  }, [callInvite, inCall, state.callback, visible, setState]);

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
      // Level 2: something landed on a message. One step above `tap()`
      // because putting a reaction on is not the same act as sending, and
      // only when one goes ON — taking it off is an undo, and an undo that
      // announces itself as loudly as the thing it undoes reads as an error.
      if (next) land();
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
    openPhotos: (m, index) => {
      const urls = imagesOf(m);
      if (!urls.length) return;
      setViewer({ urls, start: index, caption: m.text || "" });
      tel("chat.photo_view", { msg_id: m.id, n: urls.length, at: index });
    },
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
    // The chip hangs UNDER the line she said it in, not at the bottom of the
    // thread: he may have typed two more messages since, and a chip that
    // floated to the end would be attached to whatever he last said instead
    // of to her offer. It scrolls away with her words, which is correct — an
    // offer is part of the conversation it was made in.
    if (pendingInvite && pendingInvite.msgId === m.id) {
      rows.push(
        <button
          key={`gi${m.id}`}
          type="button"
          className="gi-chip"
          data-tel={`chat.game_open.${pendingInvite.kind}`}
          // The label is already a complete accessible name ("Open the chess
          // board"); a suffix would only be a second, vaguer version of it,
          // and one of the three games has no board to open.
          aria-label={INVITE_LABEL[pendingInvite.kind]}
          onPointerDown={() => tap()}
          onClick={() => {
            const { kind, via } = pendingInvite;
            setInviteTaken(pendingInvite.askId);
            tel("chat.game_open", { kind, via });
            onOpenActivity?.(kind);
          }}
        >
          <span className="gi-ic" aria-hidden="true">
            {pendingInvite.kind === "chess" ? (
              <ChessIcon size={19} />
            ) : pendingInvite.kind === "tic-tac-toe" ? (
              <GridIcon size={19} />
            ) : (
              <ForkIcon size={19} />
            )}
          </span>
          <b>{INVITE_LABEL[pendingInvite.kind]}</b>
          <span className="gi-go" aria-hidden="true">
            <ChevronIcon size={15} />
          </span>
        </button>,
      );
    }
  }

  // The composer's right-hand control has three modes and ONE button (the
  // morph lives in thread.css). "off" is not disabled — it still focuses the
  // field, which is the useful answer to an empty send.
  // A staged picture is a message waiting to go, so the control is Send even
  // with an empty box — the alternative is a tray full of photos above a
  // microphone, which offers the one thing the composer cannot currently do.
  const sendMode: "send" | "mic" | "off" =
    draft.trim() || attachments.length || docs.length
      ? "send"
      : sttSupported()
        ? "mic"
        : "off";

  // THE THREAD'S OWN SKY. Presentation only: it feeds the wallpaper under the
  // thread and the band behind the header, and nothing downstream of it can
  // reach the reply cycle. `useSky` schedules off the boundary rather than
  // polling, so this costs five re-renders a day.
  const sky = useSky();

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
    <div className="chat" style={skyVars(sky)} data-sky={sky.state}>
      {/* THE WALLPAPER (docs/DESIGN-WORLD.md §Phase 3.1). A sibling of the
          scroller, never a child of it: it does not move when the thread
          moves, so a 300-message flick cannot repaint it. See `.chat > .world`
          in global.css for the containment that states this to the engine. */}
      <WorldLayer frame={sky} variant="wallpaper" />
      <div className="chat-head">
        {/* the band — the sky through the header glass. This variant shipped
            with no call sites at all (audit L1); this is its first. */}
        <WorldLayer frame={sky} variant="band" />
        {/* The gold ring, shared with home rather than re-implemented: the
            treatment lives in world.css as `.ring-gold`, the SIZE stays here,
            because a 118px presence portrait and a 44px header avatar are the
            same idea at two scales. The story states keep their existing
            classes so the ring still does its second job. */}
        <button
          className={`ring-gold ${storyLive ? (storyUnseen ? "live" : "seen") : ""}`}
          style={{ width: 44, height: 44, padding: 2.5 }}
          onClick={openStoryOrProfile}
          data-tel="chat.avatar"
          aria-label={headTarget}
        >
          <div className="ring-inner">
            <PhotoAvatar size={39} />
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
          <div className="name name-serif">{HER_NAME}</div>
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
          <div
            className="typing-bubble"
            {...(typingOut ? { "data-leaving": "" } : {})}
            {...(longThink ? { "data-long": "" } : {})}
          >
            <span className="sr-only">{HER_NAME} is typing</span>
            <i />
            <i />
            <i />
          </div>
        )}
        <div style={{ height: 6 }} />
      </div>

      {showJump && (
        <button ref={jumpRef} className="jump-latest" data-tel="chat.jump_latest" onClick={() => toBottom()}>
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
      {sourceOpen && (
        <SourceSheet
          room={roomImages}
          docRoom={roomDocs}
          onCamera={() => {
            setSourceOpen(false);
            // after the sheet's own exit beat, or the file dialog opens
            // underneath a drawer that is still on screen
            setTimeout(() => cameraRef.current?.click(), 60);
          }}
          onGallery={() => {
            setSourceOpen(false);
            setTimeout(() => galleryRef.current?.click(), 60);
          }}
          onDocument={() => {
            setSourceOpen(false);
            setTimeout(() => docRef.current?.click(), 60);
          }}
          onClose={() => setSourceOpen(false)}
        />
      )}
      {viewer && (
        <PhotoViewer
          urls={viewer.urls}
          start={viewer.start}
          caption={viewer.caption}
          onClose={() => setViewer(null)}
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
      {/* The pictures this message is going to carry, above the box that is
          about to caption them. Same seat and same glass as the reply quote,
          for the reason composer.css states: both answer "what is attached to
          the thing I am writing". */}
      <ComposeTray
        items={attachments}
        docs={docs}
        refused={refused}
        onRemove={(id) => {
          setAttachments((cur) => removeAttachment(cur, id));
          tap();
        }}
        onRemoveDoc={(id) => {
          setDocs((cur) => removeDoc(cur, id));
          tap();
        }}
        onAddMore={() => setSourceOpen(true)}
      />
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
          <div className="chat-input" ref={fieldRef}>
            <button
              className="attach-btn"
              data-tel="chat.attach"
              onClick={() => {
                // AT THE CAP THE BUTTON STILL WORKS, and says why. Going inert
                // would be the dead-option rule broken on the one control whose
                // whole job is to explain what is possible. The sheet opens
                // while EITHER kind has room and shows only the rows that can
                // do something; it is refused only when nothing at all fits.
                if (roomImages <= 0 && roomDocs <= 0) {
                  refuse();
                  return;
                }
                setSourceOpen(true);
              }}
              aria-label="Attach a photo or a file"
            >
              <CameraIcon size={21} />
            </button>
            {/* TWO INPUTS, ONE PER SOURCE, and the difference is two
                attributes. `capture` is what turns a file input into a camera:
                Capacitor's own BridgeWebChromeClient answers it with a real
                ACTION_IMAGE_CAPTURE intent and requests the CAMERA permission
                itself (the manifest already declares it), and a mobile browser
                answers it with the platform camera. `multiple` is what turns
                the other one into a gallery multi-select, which the same
                Capacitor path forwards as EXTRA_ALLOW_MULTIPLE.

                THAT IS WHY NO PLUGIN WAS ADDED. @capacitor/camera would be a
                second native surface for a job the platform already does, and
                this APK's OTA contract (android/app/build.gradle's
                OTA_NATIVE_CONTRACT) counts a new plugin method as a break that
                forces every installed copy to reinstall. Paying that for a
                capability we already have would be the worst trade in the
                feature. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                void takeFiles(Array.from(e.target.files ?? []), "camera");
                e.target.value = "";
              }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void takeFiles(Array.from(e.target.files ?? []), "gallery");
                e.target.value = "";
              }}
            />
            {/* DOCUMENTS. The `accept` list is the same one `packDoc` knows how
                to handle, shared from attachments.ts rather than written twice:
                a picker that offers a format the packer drops is a file dialog
                that answers with a notice. `multiple` because three are
                allowed and picking them one at a time is three trips. */}
            <input
              ref={docRef}
              type="file"
              accept={DOC_ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                void takeDocFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <textarea
              ref={inputRef}
              rows={1}
              data-tel="chat.composer"
              // THE BOX CHANGES JOB, so it says so. A staged picture turns the
              // composer into that picture's caption field, and a placeholder
              // still reading "Message Maya" would be describing the control it
              // was a second ago.
              placeholder={
                attachments.length || docs.length ? "Add a caption…" : `Message ${HER_NAME}…`
              }
              value={draft}
              onChange={(e) => {
                // value only, never the caret: reading selectionStart here
                // forces a second synchronous layout on top of the autosize
                // below, and it measured +0.6ms per keystroke. The caret it
                // needed is already read at keydown, before layout is dirty.
                composer.change(e.target.value);
                // the "typing…" signal she is entitled to. Refs, so this costs
                // nothing on the keystroke path; `onChange` rather than only
                // `onKeyDown` so a paste, a dictation commit and an IME
                // composition all count as him still working on the message.
                draftRef.current = e.target.value;
                lastKeyAt.current = Date.now();
                engaged();
                setDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(110, e.target.scrollHeight) + "px";
              }}
              onFocus={() => {
                composer.focus(messagesRef.current[messagesRef.current.length - 1]?.at ?? 0);
                // he is at the keyboard. On every other messaging product that
                // is visible to the other person as the box lighting up, and it
                // is the whole of the think-pause before the first letter.
                composerFocused.current = true;
                engaged();
              }}
              onBlur={() => {
                // Not an `engaged()`: letting go of the box is not reaching for
                // it, and stamping the clock here would arm a hold on the blur
                // that sending itself produces. The settle beat he gets is the
                // one his LAST real act already bought.
                composerFocused.current = false;
              }}
              onPaste={(e) => composer.paste(e.clipboardData?.getData("text")?.length ?? 0)}
              onCompositionStart={() => composer.imeStart()}
              onCompositionEnd={() => composer.imeEnd()}
              onKeyDown={(e) => {
                composer.key(
                  e.key,
                  e.currentTarget.selectionStart ?? 0,
                  e.currentTarget.selectionEnd ?? 0,
                );
                // a held backspace emits keydown without changing the value,
                // and it is still him working on the message
                lastKeyAt.current = Date.now();
                engaged();
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {/* ONE button, three modes, and it never unmounts.
                This was two buttons behind a ternary: React destroyed the mic
                and created the send arrow between two keystrokes, so the
                control under the thumb ceased to exist and no transition was
                possible across the gap — it read as a flicker at the exact
                moment he commits to a message. Both glyphs are stacked in the
                same grid cell now and `data-mode` crossfades them; the button
                element, its focus and its hit target are continuous.
                `data-tel` and the accessible name follow the mode, so the
                telemetry row still says which control was actually used. */}
            <button
              ref={sendBtnRef}
              className={`send-btn morph ${sendMode === "mic" ? "mic" : sendMode === "off" ? "off" : ""}`}
              data-mode={sendMode}
              data-tel={sendMode === "mic" ? "chat.record" : "chat.send"}
              // an empty send is not an error — it puts the caret where
              // the words go, instead of doing nothing at all
              onClick={() =>
                sendMode === "send"
                  ? send()
                  : sendMode === "mic"
                    ? startRecording()
                    : inputRef.current?.focus()
              }
              aria-label={sendMode === "mic" ? "Record voice note" : "Send"}
            >
              <span className="sb-ic sb-send" aria-hidden="true">
                <SendIcon />
              </span>
              <span className="sb-ic sb-mic" aria-hidden="true">
                <MicIcon size={19} />
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
