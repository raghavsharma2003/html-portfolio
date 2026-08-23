// Conversation engine for voice calls: she greets you, listens continuously
// (hands-free STT with a mute toggle; typed fallback where STT is missing),
// thinks, and speaks back.
//
// Realism contract: nothing said on a call appears as chat bubbles. Call
// turns are stored with channel:"call" — hidden from the chat UI but fed to
// the brain, so she remembers call conversations perfectly. The chat shows
// only a "📞 Voice call · m:ss" record when the call ends.

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { AppState, Message } from "../state/store";
import { uid } from "../state/store";
import { think, formatHerLife } from "../engine/brain";
import {
  speakCall,
  createStreamSpeaker,
  type StreamSpeaker,
  stopSpeaking,
  listen,
  prefetchBackchannels,
  playAck,
  playBackchannel,
  playPickup,
  prewarmSpeech,
  getSttMode,
  playThinkingFiller,
  startRoomTone,
  startRingback,
  stopRingback,
  stopRoomTone,
  duckSpeech,
  webviewMicTrace,
} from "../voice/speech";
import {
  CALL_OPEN_DIRECTIVE,
  WATCH_ALONG_DIRECTIVE,
  WATCH_COMMENT_DIRECTIVE,
  WATCH_IDLE_DIRECTIVE,
  WATCH_MODE_NOTE,
  WATCH_POINT_DIRECTIVE,
  WATCH_RESHOW_DIRECTIVE,
  WATCH_SCENE_DIRECTIVE,
  WATCH_SHOW_DIRECTIVE,
  WATCH_START_DIRECTIVE,
  type VoiceEngine,
} from "../engine/persona";
// WS-CONTINUITY seam 1 (docs/SPEC-CONTINUITY.md §1): this file used to
// hand-assemble its own system prompt out of buildSystemPromptParts +
// buildSpeechStyle + parts.tail. It no longer imports either of those, and
// that absence is the gate — a second prompt assembler cannot be reintroduced
// here without also reintroducing an import, which is a visible diff.
import { compile } from "../engine/compiler";
import type { RelBundleInput } from "../engine/compiler";
// Same freshness contract brain.ts's compile call site is under: computed at
// the point of compile, never memoized across a call, so a tier that tightens
// mid-session lands on the next compile. On this lane the "next compile" is
// the next call — the live prompt is frozen at connect on purpose.
import { gatesFor, getAgeTier } from "../engine/clock";
import {
  activityLedger,
  logTurns,
  rememberFrom,
  recallForCall,
  callSelfBundle,
  callMemories,
  formatChatTail,
  CHAT_TAIL_WINDOW_MS,
  type RememberResult,
} from "../engine/memory";
import { asksToHangUp } from "../engine/hangup";
// WS-CALLMEM. The three blocks the call lane was missing, each in its own
// module for a reason this file has learned twice: `age-tier-never-realtime`
// is what happens when a rule lives inside a call site instead of beside its
// own eval.
//   callHistory — what you two said before today (the chat lane sees it as
//                 turns; the live lane saw nothing at all)
//   farewell    — "bye" as a social close, which `asksToHangUp` deliberately
//                 does not and must not cover
import {
  callGraphBlocks,
  callRecentTurns,
  formatActivityLedgerForCall,
  formatMemoryNote,
  formatRunningNote,
  formatSharedHistory,
  preCallUserText,
  readsAsMemoryCue,
  withRecallAge,
  RECALL_CACHE_MAX_AGE_MS,
} from "../voice/callHistory";
import { readsAsFarewell } from "../voice/farewell";
// T16 her.commitments. TYPE-FREE pure transcript walk (honesty.ts imports
// nothing at all), and the compiler slot has existed and rendered zero bytes
// on this lane since it shipped — the caller is what was missing.
import { herCommitments } from "../engine/honesty";
import { activityOf, activityPickupLine, lastAssessment } from "../state/game";
import { clearCallStatus, publishCallStatus } from "../state/callStatus";
import { activityNote } from "../engine/activity";
import { exchangeFact, moveFact } from "../engine/chessTalk";
import { wyrPickFact } from "../engine/wyrTalk";
import { cardById } from "../engine/wyr/deck";
import { tttMoveFact } from "../engine/tttTalk";
import { assessMove } from "../engine/chess";
import { innerContext, applyInner, wantsForAppraisal } from "../engine/inner";
import {
  ensureOverlay,
  setWatchPrivate,
  startWatch,
  stopStrayWatch,
  watchAvailable,
  type WatchSession,
} from "../native/watch";
import { prewarmAckClips, startLiveCall, type LiveSession } from "../voice/liveCall";
import { readLevel } from "../voice/level";
import { SceneReader, gridFromRGBA, isShowClass, type WakeClass } from "../watch/scene";
import {
  callLookup,
  checkPromiseNote,
  readsAsCheckPromise,
  shouldLookUp,
} from "../voice/liveLookup";
import { track } from "../engine/account";
import { diag, diagEnd, diagStart, flushDiag } from "../engine/diag";
import { countNamedEntities, tel, telSubId } from "../engine/telemetry";

export type CallPhase = "connecting" | "live" | "ended";

// WS-INTEGRATE seam 5 (SPEC §13, api/episodes.js's own "no client call site
// posts here yet" ticket). Telemetry-style, fire-and-forget ONLY: this
// function is never awaited by anything on the call path, its promise is
// always caught, and it touches no ref, no state setter, no audio/barge-in
// primitive this file owns — a failure here is indistinguishable from the
// request never having been made. Mirrors src/engine/memory.ts's BASE
// pattern (same-origin on web, absolute on the Capacitor app).
const EPISODES_BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";
function postEpisodeCallEnd(device: string) {
  if (!device) return;
  try {
    void fetch(`${EPISODES_BASE}/api/episodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "call_end", device }),
      keepalive: true, // survives the tab/screen tearing down right after hangup
    }).catch(() => {});
  } catch {
    /* never let telemetry throw into the call path */
  }
}

// ── WS-MULTIMODAL: watch → episodes, the other half of the same ticket ────
// (SPEC-SELF-LAYER §4.2, `dead-writers`). api/episodes.js's `watch_visual` /
// `watch_moment` ops have complete, correct writers with no caller. This is
// the caller — but only for `watch_moment`, and that omission is deliberate,
// not an oversight:
//
// `vy_visual_assertion` needs a real extractor — claim + extractor_model +
// confidence, all REQUIRED by schema (vision-fab). This lane has no such
// extractor: the live model's spoken line is a conversational reply, not a
// structured vision-extraction call, and inventing a confidence number to
// satisfy the column would be fabricating metadata about fabrication risk —
// exactly the failure this whole feature exists to avoid. So this file never
// calls `writeVisualAssertion` / posts `op:"watch_visual"`. What IS honest
// and always available is what she actually SAID — true regardless of
// whether the screen-reading behind it was — which is precisely why the
// schema comment says a shared moment "survives correction of the claim it
// reacted to" and why `assertion_id` is nullable: a moment is designed to
// stand alone. Prefer under-recording (`speaker-id`'s asymmetry): a missed
// moment is a mild loss, a moment wrongly tied to the wrong screen is not.
//
// A wake is a directive asking her to comment, not a guarantee she does, and
// a line spoken later in the same call may be ordinary conversation, not a
// reaction to any particular frame. So only a SHOW-class wake — the
// deliberate "look at this", never the ambient "you've been sitting here a
// while" `along`/`idle` classes — arms a short window, and only the FIRST
// line she speaks inside it is treated as a reaction. The window is
// consumed (cleared) by that first line whether or not it produces a write,
// so a second unrelated line in the same call can never reuse it, and it is
// re-armed fresh by the next successful show wake. Every suppressor that
// already governs whether `wake()` fires at all — her own voice, quiet
// floor, the FLAG_SECURE/blank gate baked into scene.ts's `pick()`, the
// stale-frame gate, the per-minute ceiling, the look-away — therefore also
// governs whether a moment can ever be recorded: nothing here can arm a
// window `wake()` itself refused to open, so a suppressed or blacked-out
// scene produces zero rows by construction, not by a second check.
//
// WS-ANDROID-WATCH: the NATIVE Android lane arms the same window through the
// same two functions, from the "watchwake" bridge event. Its suppressors are
// the Java twins of the ones above — SceneReader.java's geometry
// (scroll-as-translation, edge-anchored overlays, and `wake-dedupe`, which is
// not loosened anywhere), WatchCaptureService's look-away, blank and
// held/fresh-frame gates, and LiveWatchEngine/WatchEngine.nudge()'s her-voice,
// quiet-floor, show-floor, ambient-share and hard-ceiling gates — and the
// event is emitted only INSIDE the branch where the wake demonstrably went
// out. So the same sentence holds on both lanes: a suppressed wake arms
// nothing, and what arms nothing writes nothing. The recording gate itself is
// deliberately NOT reimplemented in Java; a second copy is a second thing to
// drift, and this one is the shipped and tested one.
export interface PendingShowWake {
  at: number;
  cls: WakeClass;
}
// Generous enough for the live model to actually generate and start
// speaking a first line after `direct()`; tight enough that conversation
// minutes later in the same call cannot be mistaken for a reaction to one
// specific frame.
export const WATCH_MOMENT_WINDOW_MS = 12_000;

/** Call exactly when `wake()` itself fires (i.e. after every suppressor has
 *  already passed). Arms the window only for a deliberate SHOW class; an
 *  ambient wake must never clobber a window already waiting on an earlier
 *  show — pure function, no ref access, so it is directly testable. */
export function armMomentWindow(
  prior: PendingShowWake | null,
  cls: WakeClass,
  at: number,
): PendingShowWake | null {
  return isShowClass(cls) ? { at, cls } : prior;
}

/** Call on every line SHE speaks. Returns the wake to record as a shared
 *  moment, or null when there is nothing to record (no pending wake, or the
 *  window lapsed) — the caller clears the pending ref either way, so this
 *  function's only job is the yes/no and it never mutates anything itself. */
export function consumeMomentWindow(
  pending: PendingShowWake | null,
  at: number,
  windowMs = WATCH_MOMENT_WINDOW_MS,
): PendingShowWake | null {
  if (!pending) return null;
  return at - pending.at <= windowMs ? pending : null;
}

/** Fire-and-forget, same shape and same guarantees as postEpisodeCallEnd:
 *  never awaited on the call path, never throws into it. The reaction text
 *  is exactly what she said — never a paraphrase, never a claim about the
 *  screen — matching the fabrication-guard reasoning above. */
function postWatchMoment(device: string, reaction: string) {
  if (!device || !reaction.trim()) return;
  try {
    void fetch(`${EPISODES_BASE}/api/episodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "watch_moment", device, reaction }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never let telemetry throw into the call path */
  }
}

// How long to wait after a move before telling her about it.
//
// Long enough that his move and her reply are ONE event rather than two — the
// engine answers in a few hundred ms, and a person watching a board comments on
// the exchange, not on each hand separately. Short enough that the note is
// still about what just happened: past roughly a second she is reacting to
// history, which is the failure the screen-share lane's stale-frame suppressor
// exists to prevent.
const MOVE_POKE_MS = 700;

// ── the poke's conversational discipline ────────────────────────────────
//
// The first version poked on EVERY exchange, and the owner watched what that
// does to a person: she would start a story, pause for breath, a chess note
// would land in the pause, she'd pivot to the board, try the story again,
// get cut again — "she couldn't even continue the story properly." A human
// playing friendly chess finishes the story, and mentions the board when the
// board EARNS it. Three rules encode that:
//
// SALIENCE — a quiet developing move gets no note at all. The tail block
// already carries the whole position, so she is never ignorant of the game;
// she is just not PROMPTED to speak about a move nobody would speak about.
// What earns a note: a blunder or mistake, a capture, a check, a hanging
// piece, a sacrifice, material swinging, the game ending.
//
// RATE — at most one note per POKE_FLOOR_MS, except game-ending moves and
// checks, which are the "something crazy happened" that a person interrupts
// their own story for. Same judgment as the watch lane's ambient ceiling.
//
// BREATH — her voice having JUST ended is not silence, it is the pause
// inside a story. A note delivered there hijacks the story at its weakest
// moment. The poke waits out the pause (re-arms) unless the note is urgent.
const POKE_FLOOR_MS = 25_000;
const HER_BREATH_MS = 3_000;

// ── P1-4: THE RING THAT MISSED ITS DEADLINE ───────────────────────────────
//
// `RING_FETCH_DEADLINE_MS` races a recall measured at ~165ms warm and ~900ms
// COLD (memory.ts's `runRecall`, which hard-caps itself at 2s). The FIRST call
// of a day is the cold one by definition — and it is also the call with the
// most to remember. When that race is lost the live prompt compiles with
// `relBundle: null` and an empty graph block, and because that prompt is
// frozen at connect (`liveAssemblies` must read 1), the fetch landing 200ms
// later can never reach the session. She spends the whole call with no memory
// and no way to get any.
//
// So the last recall that DID land is kept. Two layers, and the split is the
// point:
//
//   • the module holder survives call → call inside one app session, which
//     covers the "she called back" and "second call this evening" cases with
//     zero storage and zero staleness risk.
//   • a small PERSISTED slice survives a cold start, which is the case that
//     actually produces the defect. Only the recall STRING is persisted, and
//     only up to `RECALL_CACHE_MAX` bytes: the rel bundle is a structured
//     snapshot of where the relationship IS, and serving a three-day-old one
//     as current is a different and worse failure than serving no bundle. The
//     bundle therefore rides the in-memory holder only, where its age is
//     bounded by the app session.
//
// Nothing here is served without saying how old it is — `withRecallAge` is
// what makes a cached block honest rather than merely present.
const RECALL_CACHE_KEY = "meera.call.recall";
/** Bytes of recall text persisted. Sized under the block's own prompt bound
 *  (`TAIL_EXTRAS`' 12 × 570 + 900) so a restored cache can never make the
 *  frozen prompt bigger than a fresh fetch could have. */
const RECALL_CACHE_MAX = 4_000;

interface RecallCache {
  at: number;
  /** The rendered recall block. NAMED `block`, not `memories`, deliberately:
   *  `evals/chattail/run.mjs` and `evals/callmem/run.mjs` both count the
   *  `memories:` fields in this file to assert there are exactly two COMPILE
   *  SITES, and a field of that name anywhere else in the file makes their
   *  count — and therefore their guarantee — wrong. Measured: it did. */
  block: string;
  relBundle: RelBundleInput | null;
}
let recallCache: RecallCache | null = null;

/** The persisted slice, or null. Never throws: a private window, a cleared
 *  store and a corrupt value all mean "no cache", which is today's behaviour
 *  exactly. */
function readRecallCache(): RecallCache | null {
  if (recallCache) return recallCache;
  try {
    const raw = localStorage.getItem(RECALL_CACHE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { at?: number; block?: string };
    if (!d || typeof d.block !== "string" || !d.block || !Number.isFinite(d.at)) return null;
    // the bundle is NOT persisted — see the note above
    recallCache = { at: Number(d.at), block: d.block, relBundle: null };
    return recallCache;
  } catch {
    return null;
  }
}

/** Record a recall that actually landed. Called from the ring's continuation
 *  and nowhere else, so "last successful" cannot come to mean anything looser. */
function writeRecallCache(block: string, relBundle: RelBundleInput | null, at: number) {
  if (!block) return; // an empty recall is not a success to remember
  recallCache = { at, block: block.slice(0, RECALL_CACHE_MAX), relBundle };
  try {
    localStorage.setItem(RECALL_CACHE_KEY, JSON.stringify({ at, block: recallCache.block }));
  } catch {
    /* storage full or unavailable — the in-memory holder still stands */
  }
}

export function useCallEngine(
  state: AppState,
  setState: React.Dispatch<React.SetStateAction<AppState>>,
  // true when SHE placed this call (the callback after a drop). She has to
  // know she is the caller — the owner heard her answer her own callback
  // like someone receiving a call, which reads as her not knowing what she
  // herself just did.
  sheCalled = false,
) {
  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [muted, setMuted] = useState(false);
  // watch-together: she sees their screen while staying on the call
  const [watching, setWatching] = useState(false);
  const [frameAt, setFrameAt] = useState(0); // UI proof a frame was CAPTURED
  // The truth the chip actually needs: a frame she could see, not one that
  // merely got encoded. On the web lane, captured and delivered diverge
  // whenever no live session owns the call — `sendFrame` returns false and
  // `frameAt` would keep ticking over a picture that went nowhere. The
  // native lane has no such gap (a frame callback IS a delivered frame), so
  // it is set to the same value `frameAt` gets there.
  const [sentAt, setSentAt] = useState(0);
  // A per-second reactive mirror of `voiceOwner.current` — the ref itself is
  // read everywhere else on the call path because a ref never lags a render,
  // but a UI surface needs to actually RE-RENDER when the lane changes, which
  // a ref cannot do on its own.
  const [voiceLane, setVoiceLane] = useState<VoiceOwner>("none");
  // The live lane dropped to cascade mid-call with nothing on screen saying
  // so (audit: `live-lane-silent-drop`). A brief, honest, quiet pill — never
  // an error screen — for the beat where her voice pipeline just changed
  // under her. Cleared as soon as live is restored, or after a few seconds
  // if it is not.
  const [laneDegraded, setLaneDegraded] = useState(false);
  const laneDegradedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function markLaneDegraded() {
    setLaneDegraded(true);
    if (laneDegradedTimer.current) clearTimeout(laneDegradedTimer.current);
    laneDegradedTimer.current = setTimeout(() => {
      laneDegradedTimer.current = null;
      if (alive.current) setLaneDegraded(false);
    }, 6000);
  }
  const watchSession = useRef<WatchSession | null>(null);
  const watchStarting = useRef(false); // synchronous double-tap / re-entry gate
  const frameRef = useRef<{ url: string; at: number } | null>(null);
  const lastCommentAt = useRef(0);
  const firstFrameSeen = useRef(false);
  // THE LOOK-AWAY. The most human privacy gesture is not a settings toggle,
  // it is putting a hand over the screen for ten seconds. Until now the only
  // controls ENDED the share, so someone who needs three seconds of privacy
  // has to kill it and re-do the whole consent dance — which in practice
  // means they never share again. While this is set no frame is encoded and
  // nothing enters the socket, and because every wake in both lanes already
  // requires a frame that actually arrived, she goes politely blind with no
  // new gating logic and no way to invent a word about what she missed.
  // USER-INITIATED ONLY: nothing here may ever engage it on a heuristic —
  // that would be exactly the content-scoring this product does not do, and
  // she would go mysteriously blind for reasons she could not explain.
  const [watchPaused, setWatchPaused] = useState(false);
  const watchPrivate = useRef(false);
  const [heard, setHeard] = useState("");
  const [sttSupported, setSttSupported] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const stopListen = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  // THE live state. The tick interval, recognizer callbacks and re-arm chain
  // all capture their first-render closure — reading `state` directly in
  // them would freeze her memory at call start (she'd forget everything said
  // DURING the call). Every callback reads stateRef.current instead.
  const stateRef = useRef(state);
  stateRef.current = state;
  // long-term graph memory, prefetched once at pickup (per-turn recall would
  // add latency to every spoken reply)
  const recallRef = useRef("");
  // ── WS-CONTINUITY seam 1: THE RING FETCH ──────────────────────────────
  // Her relational state (T2 rel.snapshot, T3 india.dynamic, T4 dyadic.active,
  // T6 we.callbacks), on the SAME round trip the recall above already makes.
  //
  // `rejected.md#murmur-timbre` established the principle for a different
  // feature and it is the whole reason this is affordable: the ring is
  // already-idle time with no call-path cost. What was NOT affordable, and is
  // what this replaces, is the old shape — the live prompt was assembled in
  // the same synchronous tick this fetch was STARTED in, so `recallRef` was
  // provably always "" at assembly and the realtime lane (the lane that takes
  // most calls) has never once had graph recall in its prompt. She was not
  // being asked to remember and failing; she was never handed the memory.
  const relBundleRef = useRef<RelBundleInput | null>(null);
  const ringFetch = useRef<Promise<void> | null>(null);
  const ringFetchMs = useRef(-1);
  // WS-CALLMEM. The shared-history block, kept separately from `recallRef`
  // ONLY so the diag record can report its bytes without re-deriving it — a
  // telemetry field that recomputes the thing it reports on is a field that
  // can start lying the moment either side moves (T-H3's own rule, and the
  // reason `chatTail` is rendered once above).
  const sharedHistoryRef = useRef("");
  // P1-4: did this call's recall come out of the cache rather than off the
  // wire? Diag only — `ring_fetch_ms: -1` says the fetch failed and this says
  // whether anything stood in for it, which is the difference between "no
  // memory" and "memory, labelled old".
  const recallFromCache = useRef(false);
  // ── P0-2: the mid-call re-query ───────────────────────────────────────
  // Rows that came back from a lookup fired DURING the call. Kept separately
  // from `recallRef` on purpose: `recallRef` is what the two frozen-prompt
  // compile sites read, and its size is pinned in
  // scripts/check-prompt-budget.mjs. These rows reach the cascade lane as
  // extra `extraMemories` at the think() call sites, and the live lane
  // through a silent direct() frame — neither of which is a compile.
  const midCallRecall = useRef("");
  const midCallRecallN = useRef(0);
  const lastMemoryQueryAt = useRef(0);
  // WS-GAMEMEM residual: the local activity ledger's call-lane block, kept
  // beside it and for the same reason — the diag record reports its bytes
  // without re-deriving them.
  const activityBlockRef = useRef("");
  // G-C4, as an assertion rather than a promise: the number of times a LIVE
  // system prompt has been built on this call. It must be 1. A mid-call
  // reassembly is a different person mid-sentence, and the failure is
  // inaudible until she contradicts herself.
  const liveAssemblies = useRef(0);
  // The one system prompt this call ever built, kept verbatim so a lane that
  // has to reconnect mid-call (#96: after a native watch share ends) can
  // restore the SAME voice rather than asking compile() for a second one —
  // which is exactly the reassembly G-C4 above forbids. Empty until the
  // first successful compile; a reconnect attempt with nothing cached here
  // is a no-op (see reconnectLiveAfterWatch).
  const liveSystemRef = useRef("");
  // consecutive instant recognizer failures — backoff instead of hot-looping
  const srFails = useRef(0);
  const srStartedAt = useRef(0);
  const speakingRef = useRef(false);
  const herStoppedAt = useRef(0);
  const lastPokeAt = useRef(0);
  const mutedRef = useRef(false);
  const elapsedRef = useRef(0);
  const listeningRef = useRef(false);
  const herWordsRef = useRef<Set<string>>(new Set()); // echo rejection
  const herSpokeUntil = useRef(0); // tail-end echo guard after she stops
  // when her CURRENT utterance began — barge-in is only interpretable as an
  // offset into her turn ("they cut her off after 400ms" vs "after 9s")
  const herSpokeSince = useRef(0);
  const thinkingRef = useRef(false);
  // adaptive endpointing (web SR): we decide when the user's turn is over,
  // not the recognizer — LiveKit/pipecat-style, regex instead of a model
  const acc = useRef({ finals: "", interim: "", lastAt: 0 });
  const ducked = useRef(false);
  const interrupted = useRef(false);
  // turn sequencing: if they resume speaking while she's still THINKING
  // (hasn't spoken yet), the in-flight reply is stale — discard it and let
  // the fresh, fuller utterance drive a new one. This is how humans handle
  // "wait, and also—": the listener re-plans instead of talking over you.
  const turnSeq = useRef(0);
  const lastHeardAt = useRef(0);
  const listenerBcAt = useRef(0); // last mid-turn listener backchannel
  const sttConsume = useRef<(() => void) | null>(null);
  // speculative turn: the brain starts on the partial ~240ms into a pause —
  // if the pause becomes the turn end (it usually does), the reply is already
  // hundreds of ms ahead; if they kept talking, one cheap call is discarded
  const spec = useRef<SpecTurn | null>(null);
  interface SpecTurn {
    text: string;
    promise: ReturnType<typeof think>;
    deltas: string[];
    sink: ((d: string) => void) | null;
  }
  const reengageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlapStart = useRef(0); // when user speech over her speech began
  const reengaged = useRef(0); // continuation nudges this silence stretch

  // ── TURNS SPOKEN WHILE THEIR SCREEN WAS SHARED ────────────────────────
  //
  // Frames are ephemeral — they are streamed and never stored — but what she
  // SAYS about a screen is not, and that is the leak nobody had covered: at
  // the end of every call the last turns go to the graph extractor, which
  // mints durable rows about the user's life from them. One glance at a
  // thread and "Rohit na?" stops being a passing mistake and becomes a
  // permanent, confidently wrong claim she will raise weeks later — and it
  // goes to a second vendor to get there. Screen-derived talk is
  // conversation; it is never durable memory about their life. The price is
  // losing some genuine memory ("they were shopping for a bike") and that is
  // the correct price.
  //
  // This used to be a `useRef<Set<string>>` of message ids, trimmed to the
  // newest 200 once it passed 400. That trim was the bug (P0-3): on a long
  // shared call the OLDEST share turns silently fell out of the set and
  // started reading as ordinary call turns again — in the extraction window,
  // in the running note, everywhere. It is now a flag on the MESSAGE
  // (`store.ts`'s `watched`), written once in `log()` below, which nothing
  // trims and which `logTurns` also carries to the server as
  // `channel: "watch"`. The set is gone rather than kept alongside: a
  // write-only ref is `dead-writers` in the other direction, and two notions
  // of "was a share up" is how one of them drifts.
  // WS-MULTIMODAL: armed by a SHOW-class wake, consumed by the next line she
  // speaks (see armMomentWindow / consumeMomentWindow above).
  //
  // WS-ANDROID-WATCH: BOTH lanes now arm it. The web lane arms inside
  // startWebWatch's wake(); the NATIVE lane arms from the "watchwake" bridge
  // event, which WatchCaptureService.emitShowWake sends only after its own
  // copy of every suppressor has passed (the Java geometry, the frame/held
  // gates, and LiveWatchEngine/WatchEngine.nudge's voice, quiet, show-floor
  // and ceiling gates) — i.e. at exactly the point the web lane arms, one
  // process further out. The recording gate itself is this one shared pair of
  // pure functions, deliberately NOT reimplemented in Java: a second copy is
  // a second thing to drift.
  const pendingShowWake = useRef<PendingShowWake | null>(null);

  const log = (rawMsg: Message) => {
    // ── P0-3, THE CLIENT THIRD ───────────────────────────────────────────
    // A share turn is stamped ON THE MESSAGE, once, here — the only place in
    // the product that knows a share was up when a line was said. Two readers
    // depend on it and neither could be served by the ref alone:
    //
    //   • `logTurns` maps `watched` to `channel: "watch"` on the wire, so
    //     consolidation can refuse to derive durable facts about his life from
    //     something she read off his screen. The server cannot re-derive this.
    //   • every local reader that used to consult the `watchTurnIds` set —
    //     the running note, the end-of-call extraction, the shared-history
    //     block — now reads a flag that a 400-entry TRIM cannot lose. On a
    //     call long enough for the trim to fire, the oldest share turns were
    //     silently rejoining the record as ordinary call turns.
    //
    // `channel` stays "call": nine local readers switch on `channel !== "call"`
    // (the chat thread's own visibility filter among them) and every one of
    // them is right to treat a share turn as a call turn. See store.ts.
    const watched = Boolean(watchSession.current) && rawMsg.kind === "text";
    const m: Message = watched ? { ...rawMsg, watched: true } : rawMsg;
    setState((s) => ({ ...s, messages: [...s.messages, m] }));
    if (m.kind !== "callmark") logTurns(stateRef.current.deviceId, [m]);
  };

  const mergeLearned = (learned?: Record<string, string>) => {
    if (!learned || !Object.keys(learned).length) return;
    setState((s) => ({
      ...s,
      user: { ...s.user, facts: { ...s.user.facts, ...learned } },
    }));
  };

  // ── the fabrication audit ─────────────────────────────────────────────
  // She can only honestly describe a screen a picture of which actually
  // reached her. For every line she says while a share is up this records
  // whether a frame existed, how old it was, and a COUNT of the named things
  // she asserted — never the things themselves. `had_frame:false` next to
  // `named_entities:3` is a fabrication, and until now that was visible only
  // as a user saying "she made that up", which arrives weeks late and cannot
  // be tied back to a moment.
  const watchId = useRef("");
  const nativeWatchAt = useRef(0);
  const nativeFrameN = useRef(0);
  const wordsIn = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
  function noteHerLine(text: string, lane: string, msgId: string) {
    tel("call.turn", { who: "her", words: wordsIn(text), lane, call_id: callId.current });
    if (!watchSession.current) return;
    const f = frameRef.current;
    const age = f ? Date.now() - f.at : -1;
    tel("watch.comment", {
      watch_id: watchId.current,
      msg_id: msgId,
      words: wordsIn(text),
      frame_age_ms: age,
    });
    tel("watch.grounding", {
      watch_id: watchId.current,
      lane,
      had_frame: Boolean(f),
      frame_age_ms: age,
      named_entities: countNamedEntities(text),
      words: wordsIn(text),
      paused: watchPrivate.current,
    });
    // WS-MULTIMODAL: this line is the FIRST she has spoken since a SHOW-class
    // wake armed the window (if any) — consume it unconditionally so a later,
    // unrelated line in the same call can never inherit it. Re-checking
    // watchPrivate here (not just at arm time) closes the one-tick race where
    // the look-away engages between the wake firing and this line landing.
    const moment = consumeMomentWindow(pendingShowWake.current, Date.now());
    pendingShowWake.current = null;
    if (moment && !watchPrivate.current) postWatchMoment(stateRef.current.deviceId, text);
  }
  const callId = useRef("");

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
    openrouterKey: stateRef.current.openrouterKey,
    openrouterModel: stateRef.current.openrouterModel,
    apiKey: stateRef.current.apiKey,
    deviceId: stateRef.current.deviceId,
    // what she has already told them about her own life — the same ledger the
    // chat uses. Without it she'd have one flatmate in chat and another on the
    // phone, which is the self-contradiction this whole fix exists to kill
    herLife: formatHerLife(stateRef.current.herLife),
    // and where her own day left her. brain.ts decides whether it reaches the
    // prompt at all: only when the last message is >45 min old, which on a
    // call means pickup and never a mid-call turn or a goodbye.
    inner: stateRef.current.inner,
    // WS-CONTINUITY seam 1: the ring-fetched relational bundle, so the CASCADE
    // lane's per-turn compile() renders T2/T3/T4/T6 exactly as chat does. Read
    // through the ref (not captured) for the same reason every other callback
    // here reads stateRef: a value captured at call start freezes her.
    // `null` until the ring fetch lands, which is compile()'s render-nothing
    // default — the same state as today, never a broken one.
    relBundle: relBundleRef.current,
    // 2026-08-22 audit, finding #9: this lane fed neither field, so a mid-call
    // fallback turn (the cascade `think()` calls below, not the frozen-at-
    // connect LIVE prompt above) was blind to the board — 371 bytes/turn of
    // T15 missing — and a milestone that had just crossed (#117) never once
    // reached a call. Same derivation, same field, as Chat.tsx's `brainKeys`
    // (`activityOf` lives in state/game.ts for exactly this — one function,
    // both lanes) — read through the ref for the reason every field above is.
    activity: activityOf(stateRef.current.game),
    // brain.ts owns freshness (MOMENT_FRESH_MS); this only has to hand over
    // what is there, `null` when nothing just crossed.
    moment: stateRef.current.recentMoment ?? null,
  });

  // ── T-H3, and why THIS lane does not get the chat tail ────────────────────
  // Every `think()` on the cascade lane is handed `stateRef.current.messages`
  // as history, and brain.ts's `toTurns` sends the last 90 of them — chat
  // turns, call turns and callmarks alike, since `messages` is the
  // channel-blind store — to the model as REAL TURNS. So the last stretch of
  // typing is already in front of the cascade model, verbatim, in the one
  // place a transcript belongs. `callMemories()` below is what gives the
  // frozen-at-connect lanes the same property; adding it here as well would
  // put the same sentences in the prompt twice, on the one lane that never
  // lost them, and spend tail budget to do it.
  //
  // Uniform in the PROPERTY, not in the bytes: every lane knows what was just
  // typed. `evals/chattail/run.mjs` asserts both halves — that the live and
  // native-watch compiles route `memories` through `callMemories`, and that
  // the cascade lane's history reaches the model unfiltered.

  // ── realtime engine (Gemini Live, speech-to-speech): near-zero latency,
  // server-side barge-in. The cascade below stays as the seamless fallback —
  // at call start when live can't connect, and mid-call if the session drops.
  const liveSession = useRef<LiveSession | null>(null);
  const liveStopping = useRef(false); // deliberate stop — not a mid-call drop
  const liveTiming = useRef<{ mintMs?: number; preminted?: boolean; readyMs?: number }>({});
  const LIVE_BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

  // ── voice ownership ──────────────────────────────────────────────────
  // EXACTLY ONE engine may speak on this call. The slot is swappable
  // ("none" while the phone rings, then live ⇄ cascade), and "native" is
  // exclusive: while the Android watch service holds it, the web layer owns
  // no mic, no timers and no TTS. Claiming kills the loser's IN-FLIGHT
  // audio, not just its future audio — a queued TTS clip is a second voice.
  type VoiceOwner = "none" | "live" | "cascade" | "native";
  const voiceOwner = useRef<VoiceOwner>("none");
  const laneSince = useRef(0);
  // Reading THROUGH a function call, not a bare `voiceOwner.current`, is
  // deliberate: TS's control-flow narrowing treats an earlier
  // `voiceOwner.current === X` check as binding for every LATER bare read in
  // the same function too, even across an `await` where the ref's value can
  // genuinely have changed underneath it — backwards for a ref, and the
  // reverse of what `tryStartLive`'s own "the ref is not a constant" comment
  // warns about. A function call is opaque to that narrowing, so it resets.
  const currentVoiceOwner = (): VoiceOwner => voiceOwner.current;

  // `why` is not decoration. The voice-swap class of bug is invisible in
  // every other signal we have — the call keeps working, she just stops
  // sounding like herself, and by the time anyone reports it the only
  // question that matters is which lane took the slot and what pushed it.
  function claimVoice(next: VoiceOwner, why = "") {
    const from = voiceOwner.current;
    if (next !== from) {
      const at = Date.now();
      tel("call.lane_change", {
        from,
        to: next,
        reason: why,
        held_ms: laneSince.current ? at - laneSince.current : 0,
        speaking: speakingRef.current,
        thinking: thinkingRef.current,
      });
      laneSince.current = at;
    }
    voiceOwner.current = next;
    setVoiceLane(next);
    if (next === "live") {
      // whatever degraded the line a moment ago, live is back — the pill's
      // job is done and holding it open past the recovery would be its own
      // small dishonesty
      if (laneDegradedTimer.current) {
        clearTimeout(laneDegradedTimer.current);
        laneDegradedTimer.current = null;
      }
      setLaneDegraded(false);
    }
    if (next !== "cascade") {
      // the cascade lane: playing/queued clips, the recognizer, the
      // re-engage nudge, accumulated speech and every in-flight think()
      stopSpeaking();
      speakingRef.current = false;
      setSpeaking(false);
      stopListen.current?.();
      stopListen.current = null;
      listeningRef.current = false;
      setListening(false);
      if (reengageTimer.current) {
        clearTimeout(reengageTimer.current);
        reengageTimer.current = null;
      }
      acc.current = { finals: "", interim: "", lastAt: 0 };
      spec.current = null;
      turnSeq.current += 1; // every reply still generating is now stale
      thinkingRef.current = false;
      setThinking(false);
      ducked.current = false;
    }
    if (next !== "live" && liveSession.current) {
      liveStopping.current = true;
      liveSession.current.stop();
      liveSession.current = null;
      liveStopping.current = false;
    }
  }

  // ── WS-CONTINUITY seam 1: how long the ring may be spent on ────────────
  // The ring is free time, not free rein. This is the only wait the connect
  // path is allowed to take, and it is a RACE, never an await: a slow or dead
  // network costs the call nothing but the relational slots it could not
  // fetch. The deadline is chosen against the measured recall (~165ms warm,
  // ~900ms cold, hard-capped at 2s inside runRecall) and against the connect
  // budget (ring 1.1-2.4s + 3.5s of grace before the cascade takes the call),
  // so the typical cost is ~165ms of a ~4.6s budget.
  //
  // ── P1-4: 900 → 1,200, and why exactly that ──────────────────────────
  // 900 was set to the COLD MEASUREMENT ITSELF, which makes the first call of
  // a day a coin flip: p50 of a ~900ms distribution misses a 900ms deadline
  // half the time, and on this lane a miss is permanent (the prompt is frozen
  // at connect). 1,200 is the same measurement plus a third — enough that the
  // cold case lands rather than races — and it is still:
  //   • inside `runRecall`'s own 2,000ms cap, so the deadline can never be the
  //     thing that decides, only the network;
  //   • inside the RING itself (1.1-2.4s measured), so on the typical device
  //     this wait is still spent on time the call was going to spend anyway
  //     and the 3.5s of connect grace is untouched.
  // What it costs in the worst case is 300ms more of a ~4.6s budget, on the
  // calls where the alternative is a whole call with no memory at all. If the
  // connect-path telemetry (`ring_fetch_ms` in `live_prompt`, against
  // `readyMs`) ever shows this pushing pickups past the cascade adoption
  // window, it comes back down and the cache below carries the cold call
  // instead — that is the evidence that reverses it.
  const RING_FETCH_DEADLINE_MS = 1_200;
  async function awaitRingFetch(deadlineMs = RING_FETCH_DEADLINE_MS): Promise<void> {
    const p = ringFetch.current;
    if (!p) return;
    await Promise.race([p, new Promise<void>((r) => setTimeout(r, deadlineMs))]);
  }

  async function tryStartLive(): Promise<LiveSession | null> {
    if (typeof WebSocket === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
    // ── WS-CONTINUITY seam 1: wait out the RING FETCH, then compile ONCE ──
    // Bounded, and bounded against the ring rather than against the reply
    // floor: the live session has ring + 3500ms to connect before the cascade
    // takes the call, and `live-floor` says a spoken reply's 1.4-1.5s is the
    // MODEL, not the assembly. So the only thing this wait can spend is
    // connect headroom, and the deadline is set well inside it. On expiry we
    // compile with whatever landed — an absent bundle renders nothing, which
    // is exactly today's behaviour, so the slow path degrades to the status
    // quo instead of to a broken prompt or a delayed pickup.
    await awaitRingFetch();
    // This is a NEW await before the connect, so it is a new window in which
    // the call can end (back gesture, navigation, a native watch claiming the
    // audio path). Bail here rather than minting a token and opening a socket
    // for a call that is already gone — the post-connect teardown below still
    // covers the case where it dies later.
    // Read into a local: comparing `voiceOwner.current` directly here would
    // let TS narrow the REF's type for the rest of the function and then flag
    // the identical (and still necessary) post-connect check below as dead.
    // The value can change across every await in between; the ref is not a
    // constant and must not be treated as one.
    const ownerBeforeConnect: VoiceOwner = voiceOwner.current;
    if (!alive.current || ownerBeforeConnect === "native") return null;
    const nowAt = Date.now();
    const lastMsg = stateRef.current.messages[stateRef.current.messages.length - 1];
    // WS-CONTINUITY seam 2. The gap test is NOT open-coded here — it lives
    // inside innerContext (GAP_ENTRY_MS), which is the same gate the chat lane
    // goes through, evaluated against `lastMsgAt`. And `messages` is the
    // channel-blind store: chat turns, call turns and callmarks all land in
    // it, so "the last message" already means the last message on ANY channel.
    // That is what makes a pickup sixty seconds after texting a continuation
    // (no thread) and a pickup after a day a re-entry (thread), without this
    // lane owning a second copy of the rule. What was wrong was only the old
    // comment above this block, which claimed a pickup is unconditionally a
    // gap entry — see the report for the measurement.
    const lastMsgAt = lastMsg?.at || 0;
    const inner = innerContext(stateRef.current.inner, {
      now: nowAt,
      lastMsgAt,
      surface: "pickup",
      // ── G2 ON THE CALL LANE (`inner.ts`'s charter, "she never initiates
      // carrying a feeling") ────────────────────────────────────────────────
      // A pickup is USUALLY them calling her, and that is the one moment this
      // feature pays for. A CALLBACK is not: `sheCalled` is true exactly when
      // SHE placed the call after a drop, and a call she placed is a message
      // she sent first. Without this the carried thread — and her taste with
      // it — rode out on a line she opened, which is G2's own sentence
      // ("implying you suffer without them") delivered by phone.
      //
      // This is threaded from the SAME `sheCalled` the self bundle reads a few
      // lines below, never recomputed here, for the reason compiler.ts's
      // SelfBundleInput doc states outright: two independent notions of "she
      // started this turn" is exactly how one of them drifts. Before this they
      // HAD drifted — the self layer was told and inner was not, in the same
      // compile() call.
      sheInitiated: sheCalled,
      // what they said last before calling — her taste is pulled from it, the
      // same way the chat lane does. Suppressed with the thread on a callback
      // by innerContext itself (structurally, not by this call site).
      userText: lastMsg?.text || "",
    });
    // T-H3: rendered ONCE, here, and both read from it — the compile below and
    // the diag record beneath it. Two calls could not actually disagree (same
    // tick, same `nowAt`), but a telemetry field that re-derives the thing it
    // is reporting on is a field that can start lying the moment either side
    // moves. Measured at ~17µs over a 2,000-message store, so this is not a
    // performance concern in either direction — it is a truthfulness one.
    const chatTail = formatChatTail(stateRef.current.messages, nowAt);
    // Rendered ONCE for the same reason `chatTail` is: the compile below and
    // the diag record beneath it must be reporting on the same bytes.
    const herOpen = herCommitments(stateRef.current.messages, nowAt);
    // The last thing HE typed before dialling, and "" unless it is fresh
    // enough to still be this conversation. See `latestUserText` below for
    // what it unlocks and why staleness is the thing that has to be gated.
    // A share turn is excluded for `Message.watched`'s reason — a line said
    // over his screen is not a turn he addressed to her.
    const preCallText = preCallUserText(stateRef.current.messages, nowAt);
    // ── ONE ASSEMBLER (G-C6) ──────────────────────────────────────────────
    // Everything below used to be a hand-rolled concatenation that shadowed
    // compile() and drifted from it: its own shorter T5 and T7 headings, no
    // T2/T3/T4/T6, no T11/T12/T13, no FORGET_DECISION, and no age-tier
    // override. `medium: "voice"` and `voiceEngine: "live"` were already
    // honoured by both the compiler and buildSpeechStyle — the call lane
    // simply never asked.
    const compiled = compile({
      user: stateRef.current.user,
      messageCount: stateRef.current.messages.length,
      medium: "voice",
      mode: "call",
      voiceEngine: "live",
      // A whole-call prompt is not a directive turn. The pickup line itself is
      // delivered separately, as CALL_OPEN_DIRECTIVE through direct().
      isDirective: false,
      // The web share starts mid-call and the live prompt is frozen at
      // connect, so the watch note cannot ride this compile; the native lane
      // passes it separately, per frame that actually carries a picture.
      watching: false,
      innerThread: inner.thread,
      innerWants: inner.wants,
      // Fetched during the ring — before this it was provably always "".
      // T-H3: plus the last stretch of typing, which the ring fetch cannot
      // know about and `herLife` has not absorbed yet. This prompt is frozen
      // at connect, so it is the only chance this call gets. See
      // `callMemories` in memory.ts for why the tail beats a flush here.
      memories: callMemories(recallRef.current, chatTail),
      herLife: formatHerLife(stateRef.current.herLife),
      // chat-only by construction inside compile(); passed empty for clarity
      cultureNoteText: "",
      relBundle: relBundleRef.current,
      // T-H1: that day is today. api/memory.js's op:"recall" now ships the
      // self rows the way it ships `relstate`, so T11/T12/T13 light on both
      // lanes at once. This reads what the RING fetch put in memory.ts's
      // call-lane holder — the same fetch and the same continuation
      // `relBundleRef` above rides, and `awaitRingFetch()` at the top of this
      // function is what makes the read a value rather than a guaranteed miss
      // (`rejected.md#realtime-recall-never`). `sheInitiated` rides `sheCalled`
      // here and in the innerContext call above — one fact, both readers.
      selfBundle: (() => {
        const b = callSelfBundle(stateRef.current.deviceId);
        // a callback is the one pickup SHE initiated — the self layer's
        // `sheInitiated` field exists for exactly this and was never fed
        return sheCalled && b ? { ...b, sheInitiated: true } : b;
      })(),
      // ── P1-9: THE MOMENT-GATED SLOTS WERE DARK ON EVERY CALL ────────────
      // moment.ts's pull-only law reads ONLY the live turn, and this call site
      // passed "". That is right when there IS no turn — but measured against
      // the compiler, `momentGate("")` means moment "none", and BOTH
      // `renderDyadicActive` (T4) and `renderSelfArc` (T12) return "" on
      // moment "none". So two slots that render fine in chat rendered zero
      // bytes on every call this product has ever taken: not gated off,
      // DARK — `age-tier-never-realtime`'s exact shape again.
      //
      // What is passed instead is the last thing he TYPED before dialling,
      // and only when it is fresh (inside CHAT_TAIL_WINDOW_MS, the same
      // window that decides the pre-call stretch is still "this
      // conversation"). Two properties come out of that choice:
      //   • it is a REAL turn of his, which is what the pull-only law asks
      //     for — not a synthesised one, and never her own words;
      //   • a cold pickup after a day of silence still passes "", so the
      //     0-unprompted-raises property is byte-identical to today on
      //     exactly the calls where there is nothing to pull FROM. A message
      //     from last week must never read as a callback he just made.
      // T6's label rides the same gate, which is correct rather than
      // incidental: if his last typed line carried deixis ninety seconds ago,
      // an active-callback framing is what a person would have.
      latestUserText: preCallText,
      gapSinceLastMs: lastMsgAt ? Math.max(0, nowAt - lastMsgAt) : 0,
      // fresh at the point of compile, never memoized — same contract
      // brain.ts is under. This is also the first time an age-tier refusal
      // has ever reached the realtime lane.
      ageGates: gatesFor(getAgeTier()),
      // ── WS-CALLMEM: the two slots this lane declared and never filled ────
      // `age-tier-never-realtime`'s law, one more time: a compiler slot whose
      // CALLER never passes it renders zero bytes forever, and nothing says
      // so. Measured against the pre-fix tree: this compile passed no `nowMs`,
      // so `renderAway(input.nowMs, …)` returned "" on every call ever made
      // (T9 SINCE YOU LAST SPOKE — its first line is `if (nowMs === undefined)
      // return ""`), and passed no `herCommitments`, so T16 did too. The chat
      // lane has had both since they shipped.
      //
      // T9 is what makes "kal" mean something on a call: the gap was already
      // being computed here (`gapSinceLastMs`, right above) and thrown away
      // for want of a clock. T16 is the open-promise half of the tester's
      // memory report — a promise the system forgets is a promise she breaks
      // on schedule, and he is the one who notices.
      //
      // WS-CALLLANE: BOTH now reach the native-watch compile below as well.
      // The asymmetry that used to sit here was a budget decision and the
      // budget moved — see that call site for the arithmetic and for what is
      // still dark there.
      nowMs: nowAt,
      herCommitments: herOpen,
      // ── P1-7 / audit footnote 6: T14 rel.raised, on the call lanes ──────
      // The owner's "she keeps bringing the same thing up" is a compiler slot
      // that has been WIRED since it shipped — on the chat lane, where
      // brain.ts passes `recentTurns: history`. Neither frozen-prompt call
      // lane passed it, so `raisedRecently([])` returned [] and T14 rendered
      // zero bytes on every call. `raisedRecently` drops call turns itself, so
      // what this hands over is the store and the one rule decides.
      recentTurns: callRecentTurns(stateRef.current.messages),
      // WHAT THEY ARE DOING. If a game is already on when the call connects,
      // she knows it the moment she picks up — she does not have to be told by
      // him that they are mid-game, which is what a person would never need.
      //
      // A game STARTED during the call cannot ride this compile: the live
      // prompt is frozen at connect (`liveAssemblies` is asserted to read 1 for
      // the whole call), so mid-call state travels by direct() instead. Same
      // split the watch lane is under, and for the same reason.
      activity: activityOf(stateRef.current.game),
    });
    const system = compiled.system;
    liveSystemRef.current = system; // the one and only assembly (#96 reconnect reuses this)
    liveAssemblies.current += 1;
    diag("call", "live_prompt", {
      // G-C4: this must read 1 for the whole call. Structural only — byte
      // counts and which slots fired, never a character of the prompt.
      assemblies: liveAssemblies.current,
      core: compiled.core.length,
      tail: compiled.tail.length,
      ring_fetch_ms: ringFetchMs.current,
      rel_bundle: Boolean(relBundleRef.current),
      recall: recallRef.current.length,
      // P1-4's production seam, and the one number that says whether the
      // deadline change worked. `ring_fetch_ms: -1` with `recall_cached:
      // false` is the failure this fix exists for — a call compiled with no
      // memory at all. With `recall_cached: true` it is the fix working: old
      // memory, labelled old. The RATE of `recall_cached: true` against
      // `ring_fetch_ms` is also what would reverse the 1,200ms deadline: if
      // the cache is carrying most cold calls anyway, the extra 300ms of ring
      // is buying nothing and should come back out.
      recall_cached: recallFromCache.current,
      // T-H3's production seam. BYTES AND AGE, never a character of content —
      // same firewall every other field here is under. `chat_tail` > 0 is what
      // says the frozen prompt actually carried the stretch that was typed
      // before the call, and `chat_tail_age_ms` is how stale the newest typed
      // message was at connect, which is the number that says whether the
      // 30-minute window is cut in the right place.
      chat_tail: chatTail.length,
      chat_tail_age_ms: lastMsgAt ? Math.max(0, nowAt - lastMsgAt) : -1,
      // WS-CALLMEM's production seam, and the same firewall every field here
      // is under: BYTES, never a character of content. `shared_history: 0` on
      // a device with a call history is the signal that the block found
      // nothing to carry — which is the failure this whole workstream is
      // about, arriving from the other direction.
      shared_history: sharedHistoryRef.current.length,
      // `activity_block: 0` on a device that has finished a game is the
      // signal that the LOCAL ledger never reached this lane — which is the
      // defect this block closes, arriving from the other direction.
      activity_block: activityBlockRef.current.length,
      // ROWS, not bytes: `herCommitments` returns records, and a field named
      // for one unit carrying the other is how a number starts lying quietly.
      her_commitments_n: herOpen.length,
      sections: compiled.sections ?? {},
    });
    let self: LiveSession | null = null;
    const s = await startLiveCall({
      base: LIVE_BASE,
      system,
      onState: (st) => {
        if (!alive.current) return;
        const speaking = st === "speaking";
        // The moment her voice ENDS matters as much as whether it is on: a
        // pause 1.5s after she stopped is a breath inside a story, not the
        // end of her turn, and anything delivered into that pause hijacks
        // the story. The poke's quiet floor reads this.
        if (speakingRef.current && !speaking) herStoppedAt.current = Date.now();
        speakingRef.current = speaking;
        setSpeaking(speaking);
        listeningRef.current = true; // live mic is always hot
        setListening(true);
      },
      onMyText: (t) => {
        lastHeardAt.current = Date.now();
        tel("call.turn", { who: "them", words: wordsIn(t), lane: "live", call_id: callId.current });
        // He asked to end the call. Armed rather than acted on: she says her
        // goodbye first and the line drops after it, which is what a person
        // does. See engine/hangup.ts on why this reads HIS words, not hers.
        if (asksToHangUp(t)) armHangup("live");
        else if (readsAsFarewell(t)) armFarewell("live");
        else {
          disarmHangup(); // further speech cancels a pending goodbye
          disarmFarewell(); // …and a goodbye he did not mean costs nothing
        }
        log({ id: uid(), from: "me", kind: "text", channel: "call", text: t, at: Date.now() });
        // A factual question on a call: fire the lookup NOW, in parallel with
        // her own answer, and inject the facts a beat after she has started
        // talking. `callLookup` is a no-op unless the turn is unambiguously
        // factual (measured 0 false fires in 55 ordinary turns).
        //
        // WS-CALLMEM: it no longer resolves to "" on a failure. The tester's
        // *"she said she's checking but then just said something random"* was
        // the silent-miss path — she announces the check because the register
        // tells her to, and nothing ever came back to answer the announcement.
        // A miss is now a note of its own (liveLookup.ts `missNote`), so the
        // gap gets an honest line instead of an invented score.
        if (shouldLookUp(t)) lookupUntil.current = Date.now() + LOOKUP_WINDOW_MS;
        // …and the other kind of question this lane could not answer: one
        // about THEIR OWN past. See maybeReQuery — the ring query was fired
        // before he said a word, so a name he raises now is unreachable
        // without this.
        maybeReQuery(t);
        void callLookup(t).then((note) => {
          if (note) {
            // facts OR an honest miss — either way the gap has been answered
            // and the check-promise backstop must not answer it again
            lookupUntil.current = Date.now() + LOOKUP_SETTLE_MS;
            // direct() already waits (capped at 1.2s) for her to stop speaking
            // before committing the turn, so this cannot guillotine her mid-word
            liveSession.current?.direct(note);
          } else if (lookupUntil.current) {
            // nothing was checked (rate-limited, or the endpoint said the
            // question has no fact to find) — the backstop is free again
            lookupUntil.current = 0;
          }
        });
      },
      onHerText: (t) => {
        const id = uid();
        log({ id, from: "her", kind: "text", channel: "call", text: t, at: Date.now() });
        noteHerLine(t, "live", id);
        // ── the promise nothing is going to answer ────────────────────────
        // The other half of the same defect. `shouldLookUp` is narrow by
        // measurement, so there are factual turns it does not fire on — and on
        // those she still says she is checking, because the spoken register
        // tells her to announce before a gap. Left alone, the announcement is
        // the only thing that happens and she fills the silence herself.
        //
        // Reads HER transcript rather than his, because the promise is the
        // event: it is the one moment where the product knows a fact has been
        // owed and knows nothing is coming to pay it.
        maybeAnswerCheckPromise(t);
      },
      onTiming: (t) => {
        // where the connect seconds actually went, per device/network
        Object.assign(liveTiming.current, t);
      },
      onEnded: (reason) => {
        if (liveSession.current === self) liveSession.current = null;
        if (liveStopping.current || !alive.current) return;
        if (voiceOwner.current === "native") return; // native watch owns the voice
        // dropped mid-call (network blip, session cap) — cascade takes over
        // so the call never dies; she just keeps talking the slower way
        track(stateRef.current.deviceId, "live_call_dropped", { reason });
        claimVoice("cascade", `live_dropped:${reason}`);
        markLaneDegraded(); // audit: nothing said so before — a quiet pill now does
        speakingRef.current = false;
        setSpeaking(false);
        listeningRef.current = false;
        setListening(false);
        startListening();
        armReengage();
      },
    });
    self = s;
    // native watch took the audio path while we were connecting, or the
    // call already ended — this session has no seat, drop it
    if (!alive.current || voiceOwner.current === "native") {
      liveStopping.current = true;
      s.stop();
      liveStopping.current = false;
      return null;
    }
    // the cascade already took the call (slow network missed the pickup
    // window) — don't waste the better engine: upgrade to it mid-call at
    // the next turn boundary instead of leaving the whole call on the
    // slower lane (telemetry: live_call_slow calls felt "she takes forever")
    if (voiceOwner.current === "cascade") {
      s.setMuted(true);
      adoptLiveLate(s);
      return null;
    }
    claimVoice("live", "live_connected");
    liveSession.current = s;
    listeningRef.current = true;
    setListening(true);
    // the session now connects DURING the ring: keep the uplink muted and
    // hold the greeting directive until the caller "picks up" at ring end —
    // she must not hear or answer a phone that is still ringing
    s.setMuted(true);
    return s;
  }

  // A live session that connected after the cascade adopted the call. Swap
  // engines at a human moment — she's not mid-sentence, no reply is in
  // flight, they aren't mid-utterance — so the upgrade is inaudible except
  // that she suddenly answers much faster.
  function adoptLiveLate(s: LiveSession) {
    let tries = 0;
    const attempt = () => {
      const drop = () => {
        liveStopping.current = true;
        s.stop();
        liveStopping.current = false;
      };
      if (!alive.current || !s.active() || voiceOwner.current !== "cascade") return drop();
      const midUser =
        (acc.current.finals + acc.current.interim).trim().length > 0 ||
        Date.now() - lastHeardAt.current < 1500;
      if (speakingRef.current || thinkingRef.current || midUser) {
        // a busy call keeps deferring; give up after ~60s and stay cascade
        if (++tries < 200) setTimeout(attempt, 300);
        else drop();
        return;
      }
      claimVoice("live", "late_upgrade"); // silences the cascade lane, in-flight audio included
      liveSession.current = s;
      listeningRef.current = true;
      setListening(true);
      if (!mutedRef.current) s.setMuted(false);
      // she joined a conversation already in progress — hand her the turns
      // she missed so nothing said on the slow lane is forgotten
      const said = stateRef.current.messages
        .filter((m) => m.channel === "call" && m.kind === "text")
        .slice(-6)
        .map((m) => `${m.from === "me" ? "them" : "you"}: ${m.text}`)
        .join("\n");
      s.direct(
        `<context: you are mid-call; the line just cleared up. What was said so far:\n${said}\nContinue the SAME conversation from exactly where it is. Do NOT greet again, do NOT restart, do NOT mention the line or anything technical. If it isn't your turn to speak, just a tiny natural acknowledgement or near-silence>`,
      );
      track(stateRef.current.deviceId, "live_call_upgraded", { ...liveTiming.current });
    };
    attempt();
  }

  // ── #96: stopping a native watch share must not strand the call on the
  // slower lane forever ──────────────────────────────────────────────────
  // `startWatchMode` hands the WHOLE audio path to the native engine and
  // kills the JS live session doing it (`claimVoice("native", ...)` stops and
  // nulls `liveSession.current`). So the instant the share ends there is no
  // live session left to hand back to, and `stopWatchMode` has always claimed
  // cascade — correctly, in the moment, but permanently, which was never the
  // point: a screen share ending is not a request to leave the fast lane for
  // the rest of the call (`docs/VOICE-LANE.md` §"Recommended, not
  // implemented"; `context/measurements.md#screen-share-triple-swap`).
  //
  // This reconnects using the SAME system prompt the call already committed
  // to — `liveSystemRef.current`, set exactly once by `tryStartLive` — never
  // a fresh `compile()`. G-C4 (`liveAssemblies` above) asserts a live prompt
  // is assembled once per call; restoring the engine mid-call is not a second
  // assembly; it is the same assembly, reconnected, which is what
  // `adoptLiveLate` already does for the "connect was just slow" case. This
  // is that same handoff for the "connect was interrupted" case.
  async function reconnectLiveAfterWatch() {
    // Nothing was ever compiled this call (live unsupported on this device,
    // or the very first connect failed before reaching compile()) — nothing
    // to restore, and cascade stays cascade exactly as it does today.
    if (!liveSystemRef.current) return;
    if (typeof WebSocket === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    // A LOT can happen while this awaits: the call can end, the user can
    // start watching again, or a second reconnect attempt (drop → stop →
    // drop) can already be racing. Bail rather than open a socket nobody
    // will use.
    if (!alive.current || voiceOwner.current !== "cascade") return;
    let self: LiveSession | null = null;
    const s = await startLiveCall({
      base: LIVE_BASE,
      system: liveSystemRef.current,
      onState: (st) => {
        if (!alive.current) return;
        const spk = st === "speaking";
        if (speakingRef.current && !spk) herStoppedAt.current = Date.now();
        speakingRef.current = spk;
        setSpeaking(spk);
        listeningRef.current = true;
        setListening(true);
      },
      onMyText: (t) => {
        lastHeardAt.current = Date.now();
        tel("call.turn", { who: "them", words: wordsIn(t), lane: "live", call_id: callId.current });
        if (asksToHangUp(t)) armHangup("live");
        else disarmHangup();
        log({ id: uid(), from: "me", kind: "text", channel: "call", text: t, at: Date.now() });
        maybeReQuery(t); // same reason as the primary lane's — see maybeReQuery
        void callLookup(t).then((note) => {
          if (!note) return;
          liveSession.current?.direct(note);
        });
      },
      onHerText: (t) => {
        const id = uid();
        log({ id, from: "her", kind: "text", channel: "call", text: t, at: Date.now() });
        noteHerLine(t, "live", id);
      },
      onTiming: (t) => {
        Object.assign(liveTiming.current, t);
      },
      onEnded: (reason) => {
        if (liveSession.current === self) liveSession.current = null;
        if (liveStopping.current || !alive.current) return;
        if (voiceOwner.current === "native") return;
        track(stateRef.current.deviceId, "live_call_dropped", { reason });
        claimVoice("cascade", `live_dropped:${reason}`);
        markLaneDegraded();
        speakingRef.current = false;
        setSpeaking(false);
        listeningRef.current = false;
        setListening(false);
        startListening();
        armReengage();
      },
    }).catch(() => null);
    self = s;
    if (!s) return;
    // Through the helper, not `voiceOwner.current` directly — this function
    // already checked `voiceOwner.current !== "cascade"` before the await
    // above, and a bare re-read here would inherit that narrowing instead of
    // seeing whatever the ref actually holds now.
    const ownerAfterConnect = currentVoiceOwner();
    // the call ended, or native watch started again, while this was connecting
    if (!alive.current || ownerAfterConnect === "native") {
      liveStopping.current = true;
      s.stop();
      liveStopping.current = false;
      return;
    }
    if (ownerAfterConnect !== "cascade") {
      // something else already changed the lane in the meantime — never
      // strand a second live session behind the one that is actually live
      liveStopping.current = true;
      s.stop();
      liveStopping.current = false;
      return;
    }
    tel("call.lane_change", { from: "cascade", to: "live_pending", reason: "watch_stop_reconnect" });
    // same quiet-moment handoff a late-arriving connect gets — she is not
    // silenced mid-word, the swap lands between turns
    adoptLiveLate(s);
  }

  // ── absorbing one extraction pass ─────────────────────────────────────────
  // The writer half of `rememberFrom`: newest-first, deduped on exact text,
  // bounded at the 12 `formatHerLife` actually renders. It exists as ONE
  // function because there are now two callers in this file (the ring, below,
  // and hangup) and a third in Chat.tsx, and three copies of a merge rule is
  // how the fourth one ends up subtly different — `age-tier-never-realtime`,
  // in miniature. Fire-and-forget everywhere: never awaited, promise always
  // caught, never on a path a call or a reply waits behind.
  function absorbRemembered(p: Promise<RememberResult>) {
    p.then(({ self, inner }) => {
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
                .slice(0, 12)
            : s.herLife,
          inner: inner ? applyInner(s.inner, inner, at) : s.inner,
        };
      });
    }).catch(() => {});
  }

  // connect + greet
  useEffect(() => {
    alive.current = true;
    voiceOwner.current = "none";
    // open the audit trail for THIS call: every timing below is stamped
    // against this session, so a slow or silent call can be reconstructed
    // from data instead of re-derived from the code
    callId.current = diagStart("call", stateRef.current.deviceId, {
      native: Capacitor.isNativePlatform(),
    });
    laneSince.current = Date.now();
    // a capture service outlives the WebView (renderer kill, reload, app
    // restart): an orphaned native engine would talk over this whole call
    void stopStrayWatch();
    prefetchBackchannels(voiceOpts); // instant "hmm?" clips for turn-taking
    // The same idea for the LIVE lane, which cannot use those: speech.ts plays
    // them through its own AudioContext, and an unregistered clip coming out of
    // the speaker during a live call is her own voice handed to the server as
    // if the user had said it (measured, exp11). liveCall.ts keeps its own
    // copies so it can register them with the echo apparatus before they are
    // audible. Fetched HERE because the ring is the idle beat — the call path
    // itself may never wait on this.
    prewarmAckClips(LIVE_BASE);
    // ── long-term memory AND her relational state, fetched while the phone
    // "rings" (WS-CONTINUITY seam 1; rejected.md#murmur-timbre's principle) ──
    // ONE round trip, the one this lane already made. It is started here, at
    // the very top of the ring, and tryStartLive() races it below — so the
    // fetch gets the whole head of the ring rather than being started in the
    // same tick the prompt was assembled in, which is why the realtime lane
    // used to compile with an empty recall every single time.
    const recent = state.messages
      .filter((m) => m.from === "me")
      .slice(-4)
      .map((m) => m.text)
      .join(" ");
    const tRing = Date.now();
    // ── WS-CALLMEM: what you two already said, from the LOCAL store ───────
    // The tester's report — *"usko kuch yaad nahi kal kya baat kiya. But chat
    // me yaad hai"* — is this block's whole reason to exist, and see
    // callHistory.ts's header for why chat had it and the call did not.
    //
    // Written SYNCHRONOUSLY, before the network call, and deliberately not
    // inside its continuation: this block is derived from `state.messages`,
    // which is already in memory, so making it wait on a round trip would
    // hand `realtime-recall-never` a second chance — a rejected ring fetch
    // would take the local history down with it. The fetch's `.then` composes
    // the two; its `.catch` leaves the local half standing.
    const shared = formatSharedHistory(state.messages, tRing);
    sharedHistoryRef.current = shared;
    // ── the games, from the LOCAL ledger ─────────────────────────────────
    // WS-GAMEMEM's residual, and it is the same shape as the block above: the
    // chat lane reads `AppState.activities` and the realtime lane read only
    // the server recall, whose one route to an activity is a semantic match
    // over `vy_fact`. Local, so it needs no network and works signed out —
    // and on THIS lane the block's heading is the only family-6 fence there
    // is, because the honesty gate has no text of hers to stand on.
    //
    // `state.activities` first, the published holder second: the ring HAS the
    // live state, and the holder is the fallback for the compile sites that
    // do not (its own doc's contract). Not two sources of truth — one store,
    // one pointer at it.
    const ledgerBlock = formatActivityLedgerForCall(
      state.activities ?? activityLedger(),
      tRing,
    );
    activityBlockRef.current = ledgerBlock;
    // ── P1-4(a): the FLOOR is the last recall that landed, not nothing ────
    // Written synchronously, before the fetch, for the same reason the local
    // blocks above are: a compile that happens before (or instead of) the
    // fetch must find the best thing available rather than the emptiest. The
    // age label is what makes serving it honest — see `withRecallAge`.
    //
    // `relBundleRef` takes the cached bundle too, but ONLY the in-memory one:
    // `readRecallCache` never restores a bundle from storage, so what can be
    // served here is bounded by the app session. A cache older than
    // RECALL_CACHE_MAX_AGE_MS is not served at all.
    const cached = readRecallCache();
    const cacheUsable =
      cached && tRing - cached.at > 0 && tRing - cached.at <= RECALL_CACHE_MAX_AGE_MS;
    recallRef.current = callGraphBlocks(
      ledgerBlock,
      shared,
      cacheUsable ? withRecallAge(cached.block, cached.at, tRing) : "",
    );
    if (cacheUsable && cached.relBundle) relBundleRef.current = cached.relBundle;
    recallFromCache.current = Boolean(cacheUsable);
    ringFetch.current = recallForCall(state.deviceId, recent)
      .then(({ memories, relBundle }) => {
        // callGraphBlocks drops the SERVER's activity block when the local one
        // rendered — brain.ts's rule, called rather than copied.
        //
        // P1-4(c): this continuation can land AFTER the live session connected
        // — the whole point of the deadline is that it may. Writing the refs is
        // still correct and is NOT a mid-call reassembly: `recallRef` is read
        // at COMPILE SITES (the live compile, the native-watch compile, the
        // cascade's per-turn think()), and the one that already ran holds its
        // own frozen copy in `liveSystemRef`. Nothing here touches a live
        // session's instruction; it upgrades what the NEXT compile site sees.
        // An empty result must not wipe a usable cache, so the floor stands.
        if (memories) {
          recallRef.current = callGraphBlocks(ledgerBlock, shared, memories);
          recallFromCache.current = false;
          writeRecallCache(memories, relBundle, Date.now());
        }
        if (relBundle) relBundleRef.current = relBundle;
        ringFetchMs.current = Date.now() - tRing;
      })
      // A rejected ring fetch must never reject the connect that races it:
      // this promise is awaited on the call path, so an unhandled rejection
      // here would surface as "live failed to start" — the whole call lost to
      // a memory lookup that was only ever an enhancement.
      .catch(() => {
        ringFetchMs.current = -1;
      });
    // ── T-H3, the other half: make the NEXT call fresh ────────────────────
    // The chat tail makes THIS call whole. It does not move `herLife`, which
    // is the durable ledger and stays behind by up to two sends plus one
    // appraisal for as long as nobody runs the pass. So run it here, on the
    // ring's idle beat: the same extraction Chat.tsx runs on every third send,
    // fire-and-forget, never awaited, so nothing about the connect path can
    // wait behind it — the strict opposite of §T-H3 option (a), which would
    // have put this very round trip in front of the pickup.
    //
    // Gated, because it is a model call and the ring is not free: only when
    // there is a stretch worth absorbing (`rememberFrom` needs two turns of
    // its own) and only when that stretch is recent enough to be the one the
    // tail is also carrying. A cold call after a day of silence starts no
    // pass, and the cost is bounded at one per call either way.
    {
      const typed = state.messages.filter((m) => m.kind === "text" && m.channel !== "call");
      const newest = typed[typed.length - 1];
      if (typed.length >= 2 && newest?.at && Date.now() - newest.at <= CHAT_TAIL_WINDOW_MS) {
        absorbRemembered(
          rememberFrom(state.deviceId, state.messages, wantsForAppraisal(state.inner)),
        );
      }
    }
    // she improvises her own phone pickup — nothing scripted. The brain call
    // starts NOW, in parallel with the "ringing" beat, so pickup is instant.
    const greetPromise = think(
      state.user,
      brainKeys(),
      state.messages,
      // same scene the live lane's pickup carries — one truth, both engines
      CALL_OPEN_DIRECTIVE(pickupOpts()),
      "call",
      engine,
      true,
    );
    // the moment the greet TEXT exists, its first clip starts synthesizing —
    // the TTS fetch (the slowest step) overlaps the ring instead of running
    // after it, which was the 2-3s of dead air at pickup
    greetPromise.then((r) => {
      if (!alive.current) return;
      const g = r.bubbles.join(" ").trim();
      if (g) prewarmSpeech(g, voiceOpts, r.tone);
    });
    // ── realtime engine: the connection starts NOW, in parallel with the
    // ring — token mint + WS setup + mic grant get the ring's free ~1.2s
    // instead of starting from zero at pickup (telemetry showed connects
    // missing the adoption window by fractions of a second) ──
    //
    // ── WHERE THE CONNECT MILLISECONDS ACTUALLY GO ON THIS DEVICE ──
    // micMs/setupMs are wall-clock spans, and a wall-clock span measured by
    // JS silently contains every millisecond the main thread spent doing
    // something ELSE: the code that stamps the end cannot run while the
    // thread is blocked, and the socket frame that ends `setupMs` cannot be
    // dispatched either. So on a phone those two numbers cannot distinguish
    // "the network/OS was slow" from "we were busy". Two probes settle it,
    // and both stop the moment the connect resolves:
    //   lag*   — event-loop lateness sampled across the connect window. High
    //            lag next to a high setupMs means the handshake was already
    //            back and waiting for us, not slow.
    //   perm*  — from the native side (Android only): when the WebView's
    //            capture request reached us and when we answered it, which
    //            splits micMs into browser IPC, permission plumbing, and the
    //            audio device open. Only the last of those is a real floor.
    // Timings and counts only — this never sees audio.
    const tProbe = Date.now();
    let lagMax = 0;
    let lagSum = 0;
    let lagN = 0;
    let lagLast = tProbe;
    const LAG_TICK = 50;
    const lagIv = setInterval(() => {
      const n = Date.now();
      const late = n - lagLast - LAG_TICK;
      lagLast = n;
      if (late > 0) {
        if (late > lagMax) lagMax = late;
        lagSum += late;
        lagN++;
      }
    }, LAG_TICK);
    const livePromise = tryStartLive().catch((e) => {
      // fast failure = no live event at all in telemetry — record WHY so
      // a device where live never engages is diagnosable remotely
      track(stateRef.current.deviceId, "live_call_failed", {
        m: String(e?.message || e).slice(0, 80),
      });
      return null;
    });
    void livePromise
      .then(async () => {
        clearInterval(lagIv);
        // asked AFTER the connect so the bridge round trip is never on it
        const tr = await webviewMicTrace();
        diag("call", "live_connect_cost", {
          connectMs: Date.now() - tProbe,
          lagMax: Math.round(lagMax),
          lagSum: Math.round(lagSum),
          lagN,
          // liveTiming is whatever startLiveCall reported, echoed so one row
          // carries both halves of the story
          ...liveTiming.current,
          ...(tr
            ? {
                // gUM called -> the request reached native: browser IPC plus
                // however long the main thread made it wait
                reqAt: tr.reqAt - tProbe,
                // our own permission handshake. 0 on the fast path is the
                // point of the fast path
                permMs: tr.grantAt ? tr.grantAt - tr.reqAt : -1,
                permFast: tr.fast,
                permN: tr.n,
              }
            : {}),
        });
      })
      .catch(() => {
        clearInterval(lagIv);
      });
    let pickupT: ReturnType<typeof setTimeout> | null = null;
    // ── HOW LONG SHE TAKES TO PICK UP ──
    // Her response timing everywhere else in a live call is the server's, and
    // the client may not add to it: her first word after they stop talking is
    // the one number this lane is not allowed to trade. The RING is the one
    // beat in the whole call that is genuinely free, because it happens before
    // the line is open — and a phone that is answered in exactly 1.2 seconds
    // every single time is one of the tells that there is nobody there.
    //
    // It only ever gets LONGER, never shorter, and that is not a style choice:
    // the live session gets `ring + 3500ms` to connect before the slower
    // cascade takes the call, so shortening the ring would buy a little realism
    // by making more calls land on the slow lane. Speed is non-negotiable in
    // one direction only.
    const ringMs = (() => {
      let ms = 1100 + Math.random() * 300; // the floor, unchanged
      const h = new Date().getHours();
      const prev = state.messages[state.messages.length - 1];
      const since = prev?.at ? Date.now() - prev.at : Infinity;
      // she was asleep, or lying in the dark with the phone face-down
      if (h < 6) ms += 500 + Math.random() * 400;
      // mid-conversation: the phone is already in her hand
      else if (since < 3 * 60_000) ms += 0;
      // they have not spoken in a day — she has to catch up to who is calling
      else if (since > 20 * 3_600_000) ms += 400 + Math.random() * 300;
      return Math.min(2400, ms);
    })();
    // The ring is audible now. It starts here rather than at dial time because
    // this is the same block that DECIDES the ring length, so the sound and the
    // beat cannot drift apart.
    startRingback();
    const t = setTimeout(async () => {
      if (!alive.current) return;
      stopRingback(); // she picked up; the tone ramps out under her first word
      setPhase("live");
      startRoomTone(); // real lines are never digitally silent
      // if the live session isn't up within ~3.5s of pickup, the cascade
      // takes the call — a late arrival is discarded, never adopted
      const winner = await Promise.race([
        livePromise,
        new Promise<"slow">((r) => setTimeout(() => r("slow"), 3500)),
      ]);
      if (!alive.current) return;
      // adopt only a session that is still the owner AND still alive — one
      // that dropped during the ring already handed the slot to the cascade
      if (winner && winner !== "slow" && winner.active() && voiceOwner.current === "live") {
        if (!mutedRef.current) winner.setMuted(false); // line is open now
        // The pickup carries the present moment: mid-game, just-finished, or
        // nothing. Without it she answered a mid-chess call with a blank
        // "what's up" — the activity block was in the frozen prompt, but a
        // rule mid-brief loses to the directive appended last
        // (`prompt-position`), so the directive itself must carry the scene.
        winner.direct(CALL_OPEN_DIRECTIVE(pickupOpts())); // she picks up, spoken live
        track(stateRef.current.deviceId, "live_call_started", { ...liveTiming.current });
        return; // realtime session owns the call from here
      }
      // the race lost by a hair: the session claimed the slot in the
      // microtask gap between the timeout and this line — it's ready, take it
      if (voiceOwner.current === "live" && liveSession.current?.active()) {
        const s2 = liveSession.current;
        if (!mutedRef.current) s2.setMuted(false);
        s2.direct(CALL_OPEN_DIRECTIVE(pickupOpts()));
        track(stateRef.current.deviceId, "live_call_started", { ...liveTiming.current });
        return;
      }
      // the cascade takes the call — claim it BEFORE the greet so nothing
      // half-adopted answers typed turns aloud. A live session that connects
      // later routes itself through adoptLiveLate (mid-call upgrade); this
      // then-block only sweeps up a session that DIED during the ring.
      claimVoice("cascade", "live_missed_pickup");
      livePromise.then((s) => {
        if (!s || (voiceOwner.current === "live" && liveSession.current === s)) return;
        if (s.active()) return; // adoptLiveLate owns a living late arrival
        liveStopping.current = true;
        s.stop();
        if (liveSession.current === s) liveSession.current = null;
        liveStopping.current = false;
      });
      if (winner === "slow") track(stateRef.current.deviceId, "live_call_slow", { ...liveTiming.current });
      // ── cascade fallback: prewarmed greet + instant pickup filler ──
      pickupT = setTimeout(() => {
        if (alive.current && !speakingRef.current && voiceOwner.current === "cascade")
          playPickup();
      }, 600);
      const reply = await greetPromise;
      if (!alive.current || voiceOwner.current !== "cascade") return;
      const greet = reply.bubbles.join(" ").trim() || "hello?";
      log({
        id: uid(),
        from: "her",
        kind: "text",
        channel: "call",
        text: greet.replace(/\[[a-z ]+\]/gi, "").trim(),
        at: Date.now(),
      });
      sayAloud(greet, reply.tone);
    }, ringMs);
    return () => {
      alive.current = false;
      clearTimeout(t);
      clearInterval(lagIv); // a call hung up mid-connect must not leave it ticking
      if (pickupT) clearTimeout(pickupT);
      if (liveSession.current) {
        liveStopping.current = true;
        liveSession.current.stop();
        liveSession.current = null;
        liveStopping.current = false;
      }
      // the call UI can close by ANY route (back gesture, navigation) — the
      // screen share must NEVER outlive the call
      stopWatchMode();
      stopSpeaking();
      stopRingback(); // a call abandoned DURING the ring must not keep ringing
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

  function sayAloud(text: string, tone?: string) {
    herWordsRef.current = new Set(
      text.toLowerCase().replace(/[^a-z\u0900-\u097F ]/gi, " ").split(/\s+/).filter(Boolean),
    );
    speakCall(
      text,
      () => {
        speakingRef.current = true;
        herSpokeSince.current = Date.now();
        setSpeaking(true);
        // keep the mic hot WHILE she talks so you can interrupt her
        if (alive.current) startListening();
      },
      () => {
        speakingRef.current = false;
        setSpeaking(false);
        herSpokeUntil.current = Date.now();
        if (ducked.current) {
          duckSpeech(false); // a soft-duck must never outlive the utterance
          ducked.current = false;
        }
        if (alive.current) {
          startListening();
          armReengage(); // if they stay quiet ~8s, one soft "hmm?"
        }
      },
      voiceOpts,
      tone,
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

  // STT gives no punctuation, so question shape is detected textually — the
  // turns where lag hurts most get the fastest commit
  const QUESTION_SHAPE =
    /^(kya|kyu|kyun|kaise|kaisa|kaisi|kab|kaha|kahan|kaun|kitna|kitni|what|why|how|where|when|who|which|can|do|did|are|is|will|should)\b|\b(kya|na|right|kya)$/i;

  function commitDelay(t: string): number {
    const trimmed = t.trim().toLowerCase();
    if (SHORT_COMPLETE.test(trimmed) || QUESTION_SHAPE.test(trimmed)) return 380;
    if (CONTINUATION.test(trimmed)) return 1800;
    return 450; // resume-while-thinking absorbs the rare early commit
  }

  // 75ms endpointing tick (web SR only — native STT endpoints itself)
  useEffect(() => {
    const iv = setInterval(() => {
      // web SR and the beep-free continuous native mic both stream interims
      // and rely on this tick to decide when the turn ended; the legacy
      // native loop self-endpoints and delivers finals directly
      if (Capacitor.isNativePlatform() && getSttMode() !== "callmic") return;
      // another engine owns the voice: words captured just before the handoff
      // must never commit into a cascade reply behind its back
      if (voiceOwner.current !== "cascade") {
        if (acc.current.lastAt) acc.current = { finals: "", interim: "", lastAt: 0 };
        return;
      }
      const a = acc.current;
      const text = (a.finals + " " + a.interim).trim();
      if (!text || !a.lastAt || speakingRef.current) return;
      const waited = Date.now() - a.lastAt;
      // real listeners backchannel DURING your story, at your breath pauses —
      // if they're mid-thought (continuation shape / long turn) a soft
      // "hmm/haan" overlaps their pause, capped to once per ~10s
      if (
        waited >= 320 &&
        waited < 480 &&
        text.length > 50 &&
        Date.now() - listenerBcAt.current > 18_000 &&
        !thinkingRef.current
      ) {
        listenerBcAt.current = Date.now();
        playBackchannel();
      }
      // speculative start: one head-start per pause window, only when she's
      // idle. A wrong guess costs one flash-priced call; a right one cuts
      // 200-400ms off every reply.
      if (
        waited >= 240 &&
        text.length > 3 &&
        !spec.current &&
        !thinkingRef.current &&
        !speakingRef.current
      ) {
        const s: SpecTurn = {
          text,
          deltas: [],
          sink: null,
          promise: null as unknown as ReturnType<typeof think>,
        };
        const specMine: Message = {
          id: uid(),
          from: "me",
          kind: "text",
          channel: "call",
          text,
          at: Date.now(),
        };
        s.promise = think(
          stateRef.current.user,
          brainKeys(),
          [...stateRef.current.messages, specMine],
          text,
          "call",
          engine,
          false,
          (d) => {
            if (s.sink) s.sink(d);
            else s.deltas.push(d);
          },
          callExtraMemories(),
          freshFrame(),
        );
        spec.current = s;
      }
      if (waited >= commitDelay(text)) {
        acc.current = { finals: "", interim: "", lastAt: 0 };
        sttConsume.current?.(); // continuous mic: don't re-deliver these words
        const sp = spec.current;
        spec.current = null;
        handleUser(text, sp && sp.text === text ? sp : undefined);
      }
    }, 75);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function armReengage() {
    if (reengageTimer.current) clearTimeout(reengageTimer.current);
    if (voiceOwner.current !== "cascade") return; // another engine owns the voice
    reengageTimer.current = setTimeout(async () => {
      // she doesn't sit in silence: after ~7s she carries the conversation
      // herself (twice per stretch, then lets it breathe)
      if (voiceOwner.current !== "cascade") return;
      if (!alive.current || speakingRef.current || thinkingRef.current || mutedRef.current) return;
      if (reengaged.current >= 2) return;
      // if we heard ANYTHING from them recently (even sub-threshold speech
      // the recognizer is still chewing on), don't talk over it
      if (Date.now() - lastHeardAt.current < 6000) {
        armReengage(); // count the clock from their last sound, not ours
        return;
      }
      if (acc.current.lastAt && Date.now() - acc.current.lastAt < 4000) {
        armReengage();
        return;
      }
      reengaged.current += 1;
      tel("call.silence", {
        call_id: callId.current,
        ms: herSpokeUntil.current ? Date.now() - herSpokeUntil.current : -1,
        who_broke_it: "her",
        nth: reengaged.current,
      });
      const seqAtArm = turnSeq.current;
      const reply = await think(
        stateRef.current.user,
        brainKeys(),
        stateRef.current.messages,
        `<context: on the call, they've gone quiet for a few seconds after your last line. keep the conversation alive naturally like a real girl on the phone: extend your last thought, tease them for going quiet ("hello? so gaye kya"), or take the topic somewhere new. 1-2 short spoken sentences. never reference this note>`,
        "call",
        engine,
        true,
        undefined,
        callExtraMemories(),
      );
      // they may have started talking (or a reply may be in flight) while
      // this nudge generated — never talk over either
      if (
        !alive.current ||
        voiceOwner.current !== "cascade" ||
        speakingRef.current ||
        thinkingRef.current ||
        seqAtArm !== turnSeq.current
      )
        return;
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
        sayAloud(line, reply.tone);
      } else {
        // network blip ate the nudge — refund it and try again, don't let
        // the call die into permanent silence
        reengaged.current = Math.max(0, reengaged.current - 1);
        armReengage();
      }
    }, 7000);
  }

  // hands-free: the mic stays hot the whole call (even while she speaks,
  // for barge-in) and re-arms itself after recognizer silence timeouts
  function startListening() {
    // only the cascade lane owns a JS recognizer. While native watch runs the
    // service owns the mic (SR is a singleton and they'd fight for it), and
    // the realtime live session owns the whole audio path. Every re-arm route
    // — recognizer onend, WebView resume, unmute, stopped events — lands here.
    if (voiceOwner.current !== "cascade") return;
    if (!alive.current || mutedRef.current || listeningRef.current) return;
    const web = !Capacitor.isNativePlatform();
    const res = listen(
      (text, final) => {
        lastHeardAt.current = Date.now();
        srFails.current = 0; // the recognizer is genuinely working
        setSttSupported(true);
        if (speakingRef.current) {
          // overlap is NORMAL in human calls — she talks through noise and
          // brief speech; only sustained, real speech takes the floor
          const real = isRealInterruption(text);
          const words = text.trim().split(/\s+/).filter(Boolean).length;
          const command = /\b(stop|wait|ruko|suno|arre|ek minute|listen|hold on|chup)\b/i.test(text);
          if (!real || words < 2) {
            // a sustained overlap that did NOT take the floor is the half of
            // barge-in nobody sees: she talked over them and they gave up
            if (overlapStart.current && Date.now() - overlapStart.current > 450)
              tel("call.bargein", {
                call_id: callId.current,
                lane: "cascade",
                accepted: false,
                at_ms_into_her_turn: herSpokeSince.current
                  ? overlapStart.current - herSpokeSince.current
                  : -1,
                words,
                reason: real ? "too_short" : "echo_or_backchannel",
              });
            overlapStart.current = 0;
            if (ducked.current) {
              duckSpeech(false); // it was nothing — bring her back up NOW
              ducked.current = false;
            }
            return; // noise blip / backchannel / echo — keep talking
          }
          if (!overlapStart.current) overlapStart.current = Date.now();
          const sustained = Date.now() - overlapStart.current > 450;
          if (sustained && !ducked.current) {
            duckSpeech(true); // "haan bolo" — she softens but keeps going
            ducked.current = true;
          }
          if ((sustained && words >= 4) || command) {
            tel("call.bargein", {
              call_id: callId.current,
              lane: "cascade",
              accepted: true,
              at_ms_into_her_turn: herSpokeSince.current
                ? overlapStart.current - herSpokeSince.current
                : -1,
              words,
              reason: command ? "command" : "sustained",
            });
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
        // tail-end echo guard: for ~1.2s after she stops, her last words can
        // still leak from the speaker into the mic — not the user talking
        if (
          Date.now() - herSpokeUntil.current < 1200 &&
          !speakingRef.current
        ) {
          const ws = text.toLowerCase().replace(/[^a-zऀ-ॿ ]/gi, " ").split(/\s+/).filter(Boolean);
          const overlap = ws.length
            ? ws.filter((w) => herWordsRef.current.has(w)).length / ws.length
            : 0;
          if (overlap >= 0.6) return;
        }
        // real accepted speech from THEM — only now does it cancel her
        // pending silence-nudge (noise blips shouldn't kill it)
        if (reengageTimer.current) clearTimeout(reengageTimer.current);
        setHeard(text);
        if (web || getSttMode() === "callmic") {
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
      (reason?: string) => {
        listeningRef.current = false;
        setListening(false);
        if (ducked.current) {
          // interim died out — it was nothing; bring her back up
          duckSpeech(false);
          ducked.current = false;
        }
        if (reason === "not-allowed") {
          // mic permission denied — stop churning the recognizer and
          // surface the typed fallback instead of silently "listening"
          setSttSupported(false);
          return;
        }
        // failure discrimination: sessions dying instantly over and over
        // mean the recognizer is broken here — back off, then give up to
        // the keyboard instead of a battery-draining 300ms hot loop
        const lasted = Date.now() - srStartedAt.current;
        if (lasted < 1200) srFails.current += 1;
        else srFails.current = 0;
        if (srFails.current >= 8) {
          setSttSupported(false);
          return;
        }
        const delay = srFails.current >= 4 ? 2500 : 300;
        // recognizers time out on silence — quietly re-arm
        if (alive.current && !mutedRef.current) {
          setTimeout(() => startListening(), delay);
        }
      },
    );
    if (!res.supported) {
      setSttSupported(false);
      return;
    }
    srStartedAt.current = Date.now();
    stopListen.current = res.stop || null;
    sttConsume.current = res.consume || null;
    listeningRef.current = true;
    setListening(true);
  }

  // ── watch-together (browser): getDisplayMedia screen capture, frames
  // streamed straight into the live session — realtime co-watching with no
  // extra model loop. Desktop Chrome/Edge; lets people without the APK
  // (Mac/iPhone friends on the website) use screen sharing too. ──
  const webWatchAvailable = () =>
    !Capacitor.isNativePlatform() &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getDisplayMedia);

  async function startWebWatch() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        // This is the DETECTION source, not the transmitted one: the JPEG
        // cadence (FRAME_EVERY_MS) and the single quality below are
        // untouched, so this costs local decode and nothing else. At 4fps
        // roughly every second detector sample read a frame identical to the
        // last, which reported "nothing moved" on a screen that was moving —
        // and made typing, scroll direction and the revert window (all
        // 100-400ms phenomena) unmeasurable on the surface where reading,
        // coding, shopping and forms actually happen.
        video: { frameRate: { ideal: 12 } },
        audio: false,
      });
    } catch {
      track(stateRef.current.deviceId, "watch_consent_denied", { web: true });
      tel("watch.no_comment", { why: "consent_denied", lane: "web" });
      return;
    }
    watchId.current = telSubId("watch");
    const watchStartedAt = Date.now();
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play().catch(() => {});
    const canvas = document.createElement("canvas");
    // ── waking her up, fast: the Live API never generates from video on its
    // own, so nothing she sees can make her speak unless we ask her to look,
    // which makes the gap between "the screen changed" and "she is looking at
    // it" the whole latency budget. DETECTION IS DECOUPLED FROM TRANSMISSION:
    // a 32x32 luma thumbnail is read every DETECT_MS (one tiny drawImage +
    // getImageData, ~0.1ms), while full JPEG frames go up at the
    // bandwidth-appropriate cadence.
    //
    // WHAT the screen is doing is worked out by src/watch/scene.ts, which is
    // pure geometry: how many cells moved, where, whether the picture
    // translated instead of being replaced, and how long it has been standing
    // still. It carries NO taste — no per-app rules, no content scoring, no
    // keyword triggers, no phrase banks. It only ever says "something
    // happened, and this is what kind". Her own judgment decides what, and
    // whether, to say, and silence answers every single wake.
    const SIG = 32;
    const sigCanvas = document.createElement("canvas");
    sigCanvas.width = SIG;
    sigCanvas.height = SIG;
    const scene = new SceneReader();
    const signature = (): Uint8Array | null => {
      if (!video.videoWidth || !video.videoHeight) return null;
      const c = sigCanvas.getContext("2d", { willReadFrequently: true });
      if (!c) return null;
      c.drawImage(video, 0, 0, SIG, SIG);
      return gridFromRGBA(c.getImageData(0, 0, SIG, SIG).data);
    };
    const grab = (maxSide: number, quality: number): string | null => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return null;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return null;
      ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", quality);
    };
    // ── ONE quality, always the best one ──
    // There is deliberately no adaptive tiering here. Degrading the picture
    // to protect the link made her worse at the only thing this feature is
    // for: at the bottom tier she saw the screen once every 2.5s, which is
    // not watching, it is a slideshow she then has to guess about. Frames go
    // out at full rate and quality; the link carries them or an individual
    // frame is lost, and she is never shown a worse picture on purpose.
    const FRAME_EVERY_MS = 600;
    const FRAME_Q = 0.68;
    const FRAME_SIDE = 768;
    // A screen that has not moved since the last frame we sent carries no new
    // information: the identical picture costs a full vision tile every 600ms
    // and shows her nothing she is not already looking at. The detector
    // already knows this — the send path just has to ask. This is NOT quality
    // tiering: the picture is never degraded, the cadence is never slowed
    // while anything is happening, and a real change still jumps the queue.
    // Only a provably identical screen gets the slow beat.
    // 2500 must stay under BOTH the 3000ms freshFrame() window (or the
    // cascade lane goes blind) and the frame-gated wake path below.
    const IDLE_FRAME_MS = 2500;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // wake-up pacing — purely to protect the socket and the API, never to
    // ration what she says: floors between wake-ups and a ceiling per minute.
    // Anything she does say is her own call, every time.
    const DETECT_MS = 120; // screen sampled this often
    const CHANGE_SEND_MS = 250; // floor between reaction frames
    // Ambient chatter must not be able to spend the budget a deliberate show
    // needs. One ring of 12, but ambient may only take 5 of them: four
    // minutes of browsing used to drain the ring, and then the one moment
    // that actually mattered — they stopped and waited — was silently rate-
    // limited into nothing, with no log and no fallback.
    const WAKE_CEILING = 12;
    const AMBIENT_CEILING = 5;
    const WAKE_WINDOW_MS = 60_000;
    // Never cut across them. AMBIENT keeps the full 3s; a SHOW gets 1200ms,
    // because a show is precisely the case where they spoke and are now
    // waiting, and the old guard burnt three of the four seconds inside which
    // a reply still reads as a reply.
    const AMBIENT_QUIET_MS = 3000;
    const SHOW_QUIET_MS = 1200;
    // Their voice, from the mic envelope rather than from transcription:
    // transcript chunks land hundreds of ms to seconds after the sound, so a
    // guard measured off them starts late and ends later. This is only ever
    // used to RELEASE a guard earlier and to time frames — never to decide
    // anything about her speech.
    const VOICE_ON = 0.12;
    const VOICE_OFF = 0.06;
    const FLUSH_EVERY_MS = 800;
    // A budget, not just a floor: on a still screen a flush frame is a frame
    // the cadence would not otherwise have spent, so someone who talks the
    // whole time must not be able to undo the keep-alive saving. Twelve a
    // minute covers about six utterances, which is more than anyone speaks
    // while watching something.
    const FLUSH_CEILING = 12;
    let voiceOn = false;
    let voiceOffAt = 0;
    let lastFlushAt = 0;
    const flushes: number[] = new Array(FLUSH_CEILING).fill(0);
    let flushIdx = 0;
    const flush = (at: number, held: boolean) => {
      if (at - lastFlushAt < FLUSH_EVERY_MS) return;
      if (at - flushes[flushIdx] < 60_000) return;
      lastFlushAt = at;
      flushes[flushIdx] = at;
      flushIdx = (flushIdx + 1) % FLUSH_CEILING;
      push(at, held);
    };
    let started = false;
    let frameN = 0;
    let lastBlank = false;
    let holdSince = 0;
    let lastSentAt = 0;
    let lastGrabAt = 0;
    let lastStillFrameAt = 0; // a frame captured while the screen was HELD
    let movedSinceSent = true; // the first frame always goes
    let wantStill = false; // the screen stopped and we still owe a still frame
    let lastShowWakeAt = 0;
    const wakes: number[] = new Array(WAKE_CEILING).fill(0);
    const wakeAmbient: boolean[] = new Array(WAKE_CEILING).fill(false);
    let wakeIdx = 0;
    // Which note each class carries. The code says "look now" and what just
    // happened; it never says what to make of it, and silence answers all of
    // them except the deliberate shows.
    const noteFor = (cls: WakeClass): string =>
      cls === "start"
        ? WATCH_START_DIRECTIVE()
        : cls === "along"
          ? WATCH_ALONG_DIRECTIVE()
          : cls === "idle"
            ? WATCH_IDLE_DIRECTIVE()
            : cls === "reshow"
              ? WATCH_RESHOW_DIRECTIVE()
              : cls === "point"
                ? WATCH_POINT_DIRECTIVE()
                : cls === "settle"
                  ? WATCH_SHOW_DIRECTIVE()
                  : WATCH_SCENE_DIRECTIVE(); // "switch": into something alive
    // Every refusal below is recorded with WHICH gate refused it. A share
    // where she stayed quiet is indistinguishable from a share where she was
    // never asked to look, and those are opposite bugs.
    const suppressed = (cls: WakeClass, by: string, frameAge: number): false => {
      tel("watch.wake", {
        watch_id: watchId.current,
        class: cls,
        frame_age_ms: frameAge,
        suppressed_by: by,
      });
      return false;
    };
    const wake = (cls: WakeClass): boolean => {
      const now = Date.now();
      const show = isShowClass(cls);
      const frameAge = lastSentAt ? now - lastSentAt : -1;
      // never cut across her own voice, or across theirs
      if (speakingRef.current) return suppressed(cls, "her_voice", frameAge);
      const quietFor = show ? SHOW_QUIET_MS : AMBIENT_QUIET_MS;
      if (now - lastHeardAt.current < quietFor) return suppressed(cls, "quiet", frameAge);
      if (voiceOn || now - voiceOffAt < quietFor) return suppressed(cls, "quiet", frameAge);
      // a wake-up may only ride behind a picture that ACTUALLY entered the
      // socket, and for a show it must be a picture of the HELD screen — not
      // a frame captured mid-transition, which is half the old screen and
      // half the new one and is exactly what makes her guess
      if (now - (show ? lastStillFrameAt : lastSentAt) > 3000)
        return suppressed(cls, "stale_frame", frameAge);
      if (show) {
        if (now - lastShowWakeAt < 2500) return suppressed(cls, "show_floor", frameAge);
      } else {
        let ambient = 0;
        for (let i = 0; i < WAKE_CEILING; i++)
          if (wakeAmbient[i] && now - wakes[i] < WAKE_WINDOW_MS) ambient++;
        if (ambient >= AMBIENT_CEILING) return suppressed(cls, "ceiling", frameAge);
      }
      if (now - wakes[wakeIdx] < WAKE_WINDOW_MS) return suppressed(cls, "ceiling", frameAge);
      if (show) lastShowWakeAt = now;
      tel("watch.wake", {
        watch_id: watchId.current,
        class: cls,
        frame_age_ms: frameAge,
        suppressed_by: "none",
      });
      wakes[wakeIdx] = now;
      wakeAmbient[wakeIdx] = !show;
      wakeIdx = (wakeIdx + 1) % WAKE_CEILING;
      liveSession.current?.direct(noteFor(cls));
      scene.noteWake(cls, now);
      // WS-MULTIMODAL: only past this point has every suppressor above
      // already passed (her voice, quiet floor, stale/blank frame, show
      // floor, ceiling) — arming here, and only here, is what makes a
      // suppressed or blacked-out scene produce zero vy_shared_moment rows
      // by construction rather than by a second, separately-fallible check.
      pendingShowWake.current = armMomentWindow(pendingShowWake.current, cls, now);
      return true;
    };
    // Encode + send one frame right now. Returns whether it reached the socket
    // — nothing else in this loop may claim she has seen anything.
    const push = (at: number, held: boolean): boolean => {
      // The look-away: while they have closed the curtain no frame is
      // encoded, nothing enters the socket, and therefore — by the same
      // grounding rule that governs everything else here — nothing can wake
      // her and she cannot invent a word about it. User-initiated only; no
      // heuristic ever engages this.
      if (watchPrivate.current) return false;
      if (at - lastGrabAt < CHANGE_SEND_MS) return false;
      const url = grab(FRAME_SIDE, FRAME_Q);
      if (!url) return false;
      // SAMPLED, deliberately: frames go out up to twice a second for the
      // length of a film, and one telemetry record per frame would be a
      // bigger stream than the thing it describes.
      frameN++;
      const sample = frameN % 10 === 1;
      lastGrabAt = at; // bound re-encode cost even when the send is refused
      frameRef.current = { url, at };
      setFrameAt(at);
      if (!firstFrameSeen.current) {
        firstFrameSeen.current = true;
        track(stateRef.current.deviceId, "watch_frame_first", { web: true });
      }
      const sent = liveSession.current?.sendFrame(url.split(",")[1] ?? "") ?? false;
      if (sample)
        tel("watch.frame", {
          watch_id: watchId.current,
          age_ms: lastSentAt ? at - lastSentAt : -1,
          bytes: url.length,
          w: canvas.width,
          h: canvas.height,
          blank: lastBlank,
          held,
          sent,
          n: frameN,
        });
      // only a frame that REACHED her spends the cadence slot: a frame the
      // socket refused must be retried on the next tick, not treated as
      // delivered and waited out for another full period
      if (sent) {
        lastSentAt = at;
        movedSinceSent = false;
        // the chip's own truth signal (audit: `cascade-share-chip-truth`) —
        // set ONLY on an actual delivery, never on capture, so a share with
        // no live session to send to (voice on cascade) cannot claim she is
        // seeing anything
        setSentAt(at);
        if (held) {
          lastStillFrameAt = at;
          wantStill = false;
        }
      }
      return sent;
    };
    const pump = () => {
      if (alive.current) {
        const at = Date.now();
        // ── cheap half: what has the screen done? ──
        const sig = signature();
        const s = sig ? scene.read(sig, at) : scene.still(at);
        lastBlank = s.blank;
        // watch.scene records what the screen DID, separately from whether it
        // earned a wake — a class that keeps firing and keeps being refused
        // is a different problem from a class that never fires at all.
        if (s.quiet && !holdSince) holdSince = at;
        else if (!s.quiet) holdSince = 0;
        if (s.wake)
          tel("watch.scene", {
            watch_id: watchId.current,
            class: s.wake,
            hold_ms: holdSince ? at - holdSince : 0,
            motion: s.motion,
            coverage: s.coverage,
          });
        // "identical" is the detector's own hold test, not byte equality: a
        // blinking caret, a clock digit or a spinner is a screen standing
        // still, and a paused video under a UI overlay redraws without
        // changing. Spending a full vision tile every 600ms on those shows
        // her nothing she is not already looking at.
        if (!s.quiet) movedSinceSent = true;

        // ── their voice, for timing only ──
        const env = readLevel("you");
        if (!voiceOn && env >= VOICE_ON) {
          voiceOn = true;
          // "dekh yeh" needs the RIGHT PIXELS, not a poke: the Live API
          // generates its own turn from the audio, and the freshest frame in
          // her context could otherwise be 600ms of scrolling out of date.
          // Costs a couple of JPEGs per spoken sentence and never a word.
          flush(at, s.quiet);
        } else if (voiceOn && env <= VOICE_OFF) {
          voiceOn = false;
          voiceOffAt = at;
          flush(at, s.quiet);
        }

        // ── expensive half: which frames are worth a vision tile ──
        // The screen just stopped: get a legible still picture up NOW, ahead
        // of the cadence, so a hold that confirms a moment later is backed by
        // the frame they are actually looking at and the poke itself is a
        // bare socket write with nothing on the critical path.
        const due =
          at - lastSentAt >= (movedSinceSent ? FRAME_EVERY_MS : IDLE_FRAME_MS);
        // The pre-roll is STICKY: if the 250ms re-encode floor swallows the
        // tick the screen stopped on, the debt carries to the next tick that
        // can pay it, so a hold is never left backed by a mid-transition
        // picture. (The 2500ms keep-alive then doubles as the refresh that
        // keeps lastStillFrameAt inside the 3000ms window a show requires.)
        if (s.preroll) wantStill = true;
        if (wantStill || due) push(at, s.quiet);

        if (!started) {
          if (lastSentAt) started = wake("start");
        } else if (s.wake) {
          wake(s.wake);
        }
      }
      timer = setTimeout(pump, DETECT_MS);
    };
    timer = setTimeout(pump, DETECT_MS);
    // one teardown, one watch.stop: the browser's own "stop sharing" and our
    // control both land here, and a share that reported ending twice (or not
    // at all) would put a hole in every duration derived from it
    let stopped = false;
    const cleanup = (reason = "user") => {
      if (timer) clearTimeout(timer);
      stream.getTracks().forEach((tr) => tr.stop());
      frameRef.current = null;
      watchSession.current = null;
      pendingShowWake.current = null; // a wake from this share must never outlive it
      setWatching(false);
      setSentAt(0); // no share, nothing delivered — the chip must not outlive it
      if (stopped) return;
      stopped = true;
      tel("watch.stop", {
        watch_id: watchId.current,
        reason,
        duration_ms: Date.now() - watchStartedAt,
        lane: "web",
        frames: frameN,
      });
      // the contract flushes at watch end for the same reason it does at call
      // end: the interesting part of a share is usually how it ended
      flushDiag();
    };
    // user can stop sharing from the browser's own UI at any moment
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (watchSession.current) {
        cleanup("external");
        track(stateRef.current.deviceId, "watch_stopped_externally", { web: true });
      }
    });
    watchSession.current = { stop: () => cleanup("user") };
    setWatching(true);
    tel("watch.start", { watch_id: watchId.current, lane: "web", call_id: callId.current });
    // she is told about the share by the pump, on the first frame that
    // actually reaches her — telling her now would be telling her to look at
    // a screen no frame of which has been sent yet
    track(stateRef.current.deviceId, "watch_started", { web: true });
  }

  // ── watch-together (Android app): consent dialog → NATIVE engine (sees/
  // thinks/speaks/listens in the service process, immune to WebView
  // freezing) ──
  async function startWatchMode() {
    // `watching` is React state and lands a frame late — a double tap used to
    // run TWO consent dialogs and two engines. This ref is the real gate.
    if (watching || watchStarting.current || watchSession.current) return;
    if (!watchAvailable()) {
      if (webWatchAvailable()) await startWebWatch();
      return;
    }
    watchStarting.current = true;
    try {
      // bubble permission ("Display over other apps"): first missing-grant tap
      // opens the settings toggle and waits for them to come back and tap
      // again — stacking the capture consent on top of Settings is chaos. If
      // they've been asked before, proceed bubble-less rather than nag.
      const overlayOk = await ensureOverlay(false);
      if (!overlayOk && !localStorage.getItem("meera.overlay.asked")) {
        localStorage.setItem("meera.overlay.asked", "1");
        await ensureOverlay(true);
        return;
      }
      // hand the whole audio path to the native lane BEFORE the consent
      // dialog: JS timers keep running behind it, so a stray re-arm, a
      // committed turn or a queued TTS clip would surface as a second voice
      // once the native engine starts. This kills in-flight audio too.
      claimVoice("native", "watch_started");
      watchId.current = telSubId("watch");
      nativeWatchAt.current = Date.now();
      // ── hand the native engine her full brain, from the ONE assembler ──
      // WS-CONTINUITY seam 1 / G-C6: this was the THIRD hand-assembled prompt
      // in the repo (chat's compile(), the live lane's, and this) and it had
      // drifted furthest — its own one-line recall heading, its own merged
      // herLife+wants heading, and none of the relational or decision slots.
      // The native side still wants the pieces separately (core, tail and the
      // watch note, so the note rides only on turns that actually carry a
      // frame), and compile() returns exactly those pieces, so nothing about
      // that split has to change.
      //
      // Two compiles, differing ONLY in voiceEngine: the native engine picks
      // between them at runtime — the LIVE engine speaks natively, so tone
      // markers and TTS directions (cascade machinery) make it stilted. The
      // tail does not depend on voiceEngine, so both carry the same one.
      const watchLastAt = stateRef.current.messages[stateRef.current.messages.length - 1]?.at || 0;
      const watchNow = Date.now();
      const watchInput = {
        user: stateRef.current.user,
        messageCount: stateRef.current.messages.length,
        medium: "voice" as const,
        mode: "call" as const,
        isDirective: false,
        // The note is handed over separately, below, precisely so the native
        // side can withhold it on a frameless turn — so compile() must NOT
        // bake it into the tail as well.
        watching: false,
        // innerContext returns thread:"" for "watch" on purpose; do not route
        // around it.
        innerThread: "",
        innerWants: innerContext(stateRef.current.inner, {
          now: watchNow,
          lastMsgAt: watchLastAt,
          surface: "watch" as const,
        }).wants,
        // T-H3: same tail the live lane carries. The native watch config is
        // compiled once when the share starts and handed to a service process
        // that never recompiles, so it is frozen exactly as the live prompt is
        // and needs the stretch for exactly the same reason.
        memories: callMemories(
          recallRef.current,
          formatChatTail(stateRef.current.messages, watchNow),
        ),
        herLife: formatHerLife(stateRef.current.herLife),
        cultureNoteText: "",
        relBundle: relBundleRef.current,
        // T-H1: same ring-fetched self bundle the live lane compiles from, so
        // the native watch engine is not the one lane that forgot. Unset
        // `sheInitiated` is correct here too — a share is THEM starting it.
        selfBundle: callSelfBundle(stateRef.current.deviceId),
        // ── WHAT THIS LANE STILL DOES NOT CARRY, AND THE EXACT NUMBER ──────
        // `latestUserText` stays "" here, and it is a BUDGET decision rather
        // than the pull-only reasoning the live lane now overrides. Lighting
        // T4 + T12 costs 1,600 + 500 = 2,100 bound bytes; after the three
        // slots below this lane stands at 23,782 of 24,000 — 218 spare,
        // measured 2026-08-23 (the figure moves with persona.ts's tail; the
        // guard prints the live one). It does not fit, it
        // cannot be made to fit out of this workstream's own blocks (the
        // shared-history and activity blocks total 1,000), and the honest
        // thing is to say so rather than to shave a bound until it passes.
        // `evals/callmem/run.mjs` asserts this site really does pass "", so
        // the omission is a pinned fact and not a hope.
        //
        // The lane is also less exposed to it than the live lane: a share
        // starts MID-CALL, so the freshest turn is a spoken one, and
        // `preCallUserText` would refuse it anyway.
        latestUserText: "",
        gapSinceLastMs: watchLastAt ? Math.max(0, watchNow - watchLastAt) : 0,
        ageGates: gatesFor(getAgeTier()),
        // ── P1-7: THE ASYMMETRY THAT USED TO LIVE HERE ─────────────────────
        // This site deliberately passed neither `nowMs` nor `herCommitments`
        // because `live+watch tail (bound)` was the tightest lane in the repo
        // and 700 bytes was what it did not have. It has them now, and the
        // room came from making the bound HONEST rather than from cutting a
        // block: `innerContext` returns `thread: ""` for surface "watch" BY
        // CONSTRUCTION (`allowThread = gapEntry && !sheInitiated && surface
        // !== "watch"`), and the week-shape block rides the same gate — so the
        // carried-feeling half of the guard's TAIL_EXTRAS cannot be spent on
        // this lane at all. scripts/check-prompt-budget.mjs reclaims it as
        // WATCH_NO_THREAD and evals/callmem/run.mjs negative-tests the claim
        // by rendering the same interior on "pickup" and on "watch".
        //
        // What each buys HERE, stated so the bytes are honest:
        //   nowMs   — T9 renders only past AWAY_MIN_MS (10 min), and a share
        //             usually starts seconds after a spoken turn, so this is
        //             mostly "" — but it is also what puts the AGE on T16's
        //             rows, and an open promise with no "when" is half a fact.
        //   herOpen — the promises she made and has not kept. A share is often
        //             the longest single stretch of a call, and it was the one
        //             stretch where she could not know she owed anything.
        nowMs: watchNow,
        herCommitments: herCommitments(stateRef.current.messages, watchNow),
        // T14, same reason and same input shape as the live compile: the slot
        // has been wired since it shipped and this lane never passed it.
        recentTurns: callRecentTurns(stateRef.current.messages),
        // T15 session.activity is DELIBERATELY not passed here (coordinator,
        // 2026-08-23, confirming the lane-parity gate's recorded exemption):
        // a screen share starts mid-call and this prompt is frozen at share
        // start, so any activity named here would be the state of one moment
        // served for the whole share; the live compile already carried it at
        // pickup. evals/lanes pins this exemption with this reason.
      };
      const cascadeCompiled = compile({ ...watchInput, voiceEngine: engine });
      const liveCompiled = compile({ ...watchInput, voiceEngine: "live" });
      const config = {
        base: "https://meera-silk.vercel.app",
        system: cascadeCompiled.core,
        systemLive: liveCompiled.core,
        // the watch note rides SEPARATELY: the native side appends it only on
        // turns that actually carry a frame, so she is never told "this is
        // what's on their screen right now" when no picture reached her
        systemTail: cascadeCompiled.tail,
        watchNote: WATCH_MODE_NOTE,
        directive: WATCH_COMMENT_DIRECTIVE(),
      };
      watchSession.current = await startWatch(
        config,
        (url) => {
          const at = Date.now();
          const prev = frameRef.current?.at ?? 0;
          frameRef.current = { url, at };
          setFrameAt(at);
          // native: arrival IS delivery — this callback only ever fires with
          // a frame the service already has, so captured and sent are the
          // same event here (unlike the web lane's cascade gap, #cascade-share-chip-truth)
          setSentAt(at);
          if (!firstFrameSeen.current) {
            firstFrameSeen.current = true;
            track(stateRef.current.deviceId, "watch_frame_first", {});
          }
          // sampled, same reason as the web lane: one record per frame would
          // be a bigger stream than the thing it describes
          nativeFrameN.current++;
          if (nativeFrameN.current % 10 === 1)
            tel("watch.frame", {
              watch_id: watchId.current,
              age_ms: prev ? at - prev : -1,
              bytes: url.length,
              lane: "native",
              n: nativeFrameN.current,
            });
        },
        (who, text) => {
          // native transcript → call memory (delivered when app is visible;
          // Android batches these while backgrounded, which is fine for logs)
          const id = uid();
          log({
            id,
            from: who,
            kind: "text",
            channel: "call",
            text,
            at: Date.now(),
          });
          if (who === "her") {
            track(stateRef.current.deviceId, "watch_comment", {});
            noteHerLine(text, "native", id);
          }
        },
        () => {
          // capture ended outside our UI (notification, system revoke)
          if (!watchSession.current) return; // already torn down here
          watchSession.current = null;
          frameRef.current = null;
          // a wake from this share must never outlive it — same rule the web
          // lane's cleanup() applies, and this is the native lane's cleanup
          pendingShowWake.current = null;
          setWatching(false);
          setSentAt(0);
          track(stateRef.current.deviceId, "watch_stopped_externally", {});
          tel("watch.stop", {
            watch_id: watchId.current,
            reason: "external",
            duration_ms: nativeWatchAt.current ? Date.now() - nativeWatchAt.current : -1,
            lane: "native",
          });
          nativeWatchAt.current = 0;
          // same hardware-release beat as stopWatchMode before re-arming
          claimVoice("cascade", "watch_stopped_externally");
          setTimeout(() => {
            if (alive.current && !mutedRef.current) startListening();
          }, 450);
          void reconnectLiveAfterWatch(); // #96 applies here too — an external stop is still a stop
        },
        (cls) => {
          // WS-ANDROID-WATCH: a SHOW-class wake actually fired natively. This
          // is the native twin of startWebWatch's
          // `pendingShowWake.current = armMomentWindow(...)`, and it is the
          // ONLY thing this callback may do: no fetch, no state, nothing on
          // the call path. Everything that decides whether a moment gets
          // stored is the shared pure pair below.
          //
          // The class is a plain string off a process boundary, not a typed
          // union, and it is narrowed by armMomentWindow's own isShowClass —
          // ONE predicate, the same one the web lane goes through, rather
          // than a second copy that could disagree with it. Anything that is
          // not a deliberate SHOW arms nothing: an ambient `along`/`idle`
          // (including the one scene.ts and its Java twin CAN still fire
          // during a FLAG_SECURE blackout, since only their SHOW branches
          // carry a blank guard), and equally an unknown or malformed string.
          // So a blacked-out or suppressed screen stores nothing even if the
          // native side is the thing that is wrong. (evals/multimodal:
          // scene-gate.mjs §4 checks exactly this boundary.)
          if (!watchSession.current) return; // a wake outliving its share
          if (watchPrivate.current) return; // look-away, re-checked at arm time
          pendingShowWake.current = armMomentWindow(
            pendingShowWake.current,
            cls as WakeClass,
            Date.now(),
          );
        },
      );
      setWatching(true);
      lastCommentAt.current = Date.now();
      // The native engine's mic is always hot — there is no bridge call that
      // mutes it (`native/watch.ts` has no `setMuted`; audit:
      // `native-watch-mute-lie`). A `muted` left true from before the switch
      // would now be a claim nothing makes good on, so it is cleared here,
      // honestly, rather than displayed and ignored. `toggleMute` below
      // refuses to set it again while this lane owns the call.
      if (mutedRef.current) {
        mutedRef.current = false;
        setMuted(false);
      }
      // belt and braces: claimVoice already silenced the JS lane before the
      // consent dialog — anything that slipped through it dies here
      stopSpeaking();
      speakingRef.current = false;
      setSpeaking(false);
      turnSeq.current += 1;
      track(stateRef.current.deviceId, "watch_started", {});
      tel("watch.start", { watch_id: watchId.current, lane: "native", call_id: callId.current });
    } catch {
      track(stateRef.current.deviceId, "watch_consent_denied", {});
      tel("watch.no_comment", { why: "consent_denied", lane: "native" });
      nativeWatchAt.current = 0;
      // consent denied — stay in the plain call, mic back on. NEVER re-arm on
      // top of a session that is actually running (a denial racing a live
      // start is how the JS cascade ended up talking over the native engine).
      if (!watchSession.current && voiceOwner.current === "native") {
        claimVoice("cascade", "watch_consent_denied");
        if (alive.current && !mutedRef.current) startListening();
      }
    } finally {
      watchStarting.current = false;
    }
  }

  function stopWatchMode() {
    const s = watchSession.current;
    watchSession.current = null;
    frameRef.current = null;
    pendingShowWake.current = null; // defense-in-depth; web's own cleanup() also clears this
    setWatching(false);
    setSentAt(0);
    // the web lane reports its own stop from inside its teardown (one place,
    // one record); the native lane has no such hook, so it is reported here
    if (s && nativeWatchAt.current) {
      tel("watch.stop", {
        watch_id: watchId.current,
        reason: "user",
        duration_ms: Date.now() - nativeWatchAt.current,
        lane: "native",
      });
      nativeWatchAt.current = 0;
      flushDiag();
    }
    s?.stop();
    const wasNative = voiceOwner.current === "native";
    if (wasNative) claimVoice("cascade", "watch_stopped");
    // give the native recognizer a beat to release the hardware before the
    // JS one grabs it — an instant re-arm tends to land on BUSY
    setTimeout(() => {
      if (alive.current && !mutedRef.current) startListening();
    }, 450);
    // #96: the swap to cascade above was forced (the native engine held the
    // only live session there was and killed it on the way in) — it was
    // never a decision to STAY on cascade. Try once to come back.
    if (wasNative) void reconnectLiveAfterWatch();
  }

  // Only a frame she could honestly call "right now" is attached. The
  // baseline flow can drop to one frame per 2.5s under congestion, and an
  // 8s-old picture described as live is how she ended up commenting on
  // things that were already gone. Past this she answers without the screen.
  const freshFrame = () =>
    watching && frameRef.current && Date.now() - frameRef.current.at < 3000
      ? frameRef.current.url
      : undefined;

  // Stable identity, deliberately: publishCallStatus's change-guard compares
  // toggleMute by reference, and a fresh function per render made the guard
  // never pass — every engine render re-rendered every subscribed board,
  // the exact cost callStatus.ts exists to prevent. Reads only refs and
  // stable setters, so [] is truthful.
  const toggleMute = useCallback(() => {
    // NATIVE-WATCH MUTE HONESTY (audit: `native-watch-mute-lie`). The native
    // engine owns the mic in its own process for the length of the share, and
    // there is no bridge call that can silence it (`native/watch.ts` has no
    // `setMuted`). Flipping `muted` here would change nothing about what she
    // hears while claiming otherwise — exactly the lie the audit found. Until
    // the bridge grows a real mute, this is a refusal, not a fake success;
    // the mic control disables itself and the UI says why (CallVoice.tsx).
    if (voiceOwner.current === "native") return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (liveSession.current) {
      // live engine: the socket stays up, we just stop sending audio
      liveSession.current.setMuted(next);
      return;
    }
    if (next) {
      stopListen.current?.();
      listeningRef.current = false;
      setListening(false);
    } else {
      startListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // THE LOOK-AWAY, exposed as one stable toggle rather than an on/off setter
  // that closes over `watchPaused`: CallStatus's equality check (same reason
  // `toggleMute` is wrapped above) and ActivityShell need a control that
  // fires the same way regardless of who is holding it, without knowing the
  // current value — it reads and flips the ref, never a captured state var.
  const onLookAway = useCallback(() => {
    const on = !watchPrivate.current;
    watchPrivate.current = on;
    // not in the contract's list, and it belongs there: a stretch where she
    // was deliberately blind explains a silence that otherwise looks like
    // the feature failing
    tel("watch.look_away", { watch_id: watchId.current, on });
    setWatchPaused(on);
    setWatchPrivate(on).catch(() => {}); // native lane, no-op on the web
    if (on) {
      // she must not be left holding a picture of the moment they closed
      // the curtain: the cascade lane reads frameRef directly
      frameRef.current = null;
      setFrameAt(0);
      setSentAt(0);
      // nor a pending reaction window from behind the closed curtain
      pendingShowWake.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUser(text: string, prestart?: SpecTurn) {
    if (!alive.current || !text.trim()) return;
    if (asksToHangUp(text)) armHangup("cascade");
    else if (readsAsFarewell(text)) armFarewell("cascade");
    else {
      disarmHangup(); // further speech cancels a pending goodbye
      disarmFarewell();
    }
    // native watch owns the conversation — she hears them through the
    // service's own mic; a reply from here would be a second voice
    if (voiceOwner.current === "native") return;
    if (liveSession.current) {
      // typed input during a live call — inject as a user turn; she answers
      // through the realtime engine's own voice
      log({ id: uid(), from: "me", kind: "text", channel: "call", text, at: Date.now() });
      liveSession.current.direct(text);
      return;
    }
    const gap = herSpokeUntil.current ? Date.now() - herSpokeUntil.current : 0;
    if (gap > 3000)
      tel("call.silence", { call_id: callId.current, ms: gap, who_broke_it: "them" });
    tel("call.turn", {
      who: "them",
      words: wordsIn(text),
      lane: "cascade",
      call_id: callId.current,
    });
    reengaged.current = 0; // they spoke — silence counter resets
    // typed input (keyboard fallback) can land while she's mid-speech —
    // an answered question means she yields the floor
    if (speakingRef.current) {
      stopSpeaking();
      speakingRef.current = false;
      setSpeaking(false);
      ducked.current = false;
      interrupted.current = true;
    }
    const seq = ++turnSeq.current;
    // mic STAYS HOT while she thinks — if they keep talking, the fresh
    // speech accumulates, commits, and this in-flight turn goes stale
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
    // P0-2 on the CASCADE lane. brain.ts hands this lane `extraMemories` and
    // never re-queries in `mode === "call"` — correctly, since a lookup in
    // front of a spoken reply is the latency this whole design refuses. So the
    // re-query runs BESIDE the turn here too, and its rows join
    // `callExtraMemories()` for the NEXT turn rather than delaying this one.
    maybeReQuery(text);
    // GUARANTEED acknowledgment: a soft "hmm/haan" tells them she heard —
    // the audio equivalent of read-ticks. Deterministic, once per turn,
    // never layered over speech. After a substantive turn (they said a real
    // thing and are now waiting) it comes at ~420ms like a human listener;
    // for quick fragments it holds back so replies usually beat it.
    const substantive = text.length > 24 || text.split(/\s+/).length > 4;
    setTimeout(() => {
      if (
        thinkingRef.current &&
        alive.current &&
        !speakingRef.current &&
        seq === turnSeq.current &&
        Date.now() - listenerBcAt.current > 2000 // a bc just played — enough
      )
        playAck();
    }, substantive ? 550 : 1300);
    thinkingRef.current = true;
    setThinking(true);
    // still silent after ~4s? hold the floor with a sound, not silence —
    // but never over the user actively talking
    setTimeout(() => {
      if (
        thinkingRef.current &&
        alive.current &&
        !speakingRef.current &&
        Date.now() - lastHeardAt.current > 1500
      )
        playThinkingFiller();
    }, 4000);
    const wasInterrupt = interrupted.current;
    interrupted.current = false;
    const brainMine = wasInterrupt
      ? { ...mine, text: `[interrupting you mid-sentence] ${text}` }
      : mine;

    // ── streaming speech: the [tone: …] marker is buffered off the head of
    // the token stream, then she starts SPEAKING at the first sentence
    // boundary while the rest of the reply is still generating ──
    let speaker: StreamSpeaker | null = null;
    let head = "";
    let headDone = false;
    let firstDelta = true;
    const startSpeaker = (tone: string) => {
      speaker = createStreamSpeaker(
        voiceOpts,
        tone || undefined,
        () => {
          speakingRef.current = true;
          herSpokeSince.current = Date.now();
          setSpeaking(true);
          if (alive.current) startListening();
        },
        () => {
          speakingRef.current = false;
          setSpeaking(false);
          herSpokeUntil.current = Date.now();
          if (ducked.current) {
            duckSpeech(false); // a soft-duck must never outlive the utterance
            ducked.current = false;
          }
          if (alive.current) {
            startListening();
            armReengage();
          }
        },
      );
    };
    const onDelta = (delta: string) => {
      if (!alive.current || seq !== turnSeq.current) return;
      if (firstDelta) {
        firstDelta = false;
        herWordsRef.current = new Set(); // fresh echo set for this utterance
      }
      for (const w of delta.toLowerCase().replace(/[^a-zऀ-ॿ ]/gi, " ").split(/\s+/))
        if (w) herWordsRef.current.add(w);
      if (headDone) {
        speaker?.push(delta);
        return;
      }
      head += delta;
      const m = head.match(/^\s*\[tone:\s*([^\]]*)\]\s*/i);
      if (m) {
        headDone = true;
        startSpeaker(m[1].trim());
        const rest = head.slice(m[0].length);
        if (rest) speaker!.push(rest);
        return;
      }
      const t = head.trimStart().toLowerCase();
      const maybeMarker = t.length < 6 ? "[tone:".startsWith(t) : t.startsWith("[tone:");
      if (t && !maybeMarker) {
        // no marker coming — speak from the top
        headDone = true;
        startSpeaker("");
        speaker!.push(head);
      } else if (head.length > 90) {
        // marker never closed — strip it leniently and speak the rest
        headDone = true;
        startSpeaker("");
        speaker!.push(head.replace(/^\s*\[tone:\s*[^\]]*\]?\s*/i, ""));
      }
    };

    let reply;
    if (prestart && !wasInterrupt) {
      // the brain already started on this exact text during the pause —
      // adopt the in-flight stream: replay what it produced, then go live
      for (const d of prestart.deltas) onDelta(d);
      prestart.sink = onDelta;
      reply = await prestart.promise;
    } else {
      reply = await think(
        stateRef.current.user,
        brainKeys(),
        [...stateRef.current.messages, brainMine],
        text,
        "call",
        engine,
        false,
        onDelta,
        callExtraMemories(),
        freshFrame(), // watching? she sees the screen while answering
      );
    }
    thinkingRef.current = false;
    setThinking(false);
    if (!alive.current) return;
    const spoken = reply.bubbles.join(" ");
    if (seq !== turnSeq.current) {
      // stale: they kept talking and a fresher turn took over. If she had
      // already started saying this, keep it in her memory of the call.
      if (speaker && (speaker as StreamSpeaker).started()) {
        log({
          id: uid(),
          from: "her",
          kind: "text",
          channel: "call",
          text: spoken.replace(/\[[a-z ]+\]/gi, "").trim(),
          at: Date.now(),
        });
      }
      return;
    }
    mergeLearned(reply.learned);
    const herId = uid();
    const herLine = spoken.replace(/\[[a-z ]+\]/gi, "").trim();
    log({
      id: herId,
      from: "her",
      kind: "text",
      channel: "call",
      text: herLine,
      at: Date.now(),
    });
    // grounding is stamped against the frame she ACTUALLY had at think time:
    // freshFrame() is what was handed to the brain, so a comment with no
    // frame behind it is recorded as exactly that
    noteHerLine(herLine, "cascade", herId);
    if (speaker && headDone) {
      (speaker as StreamSpeaker).finish(); // stream spoke — flush the tail
    } else {
      sayAloud(spoken, reply.tone); // non-streaming path (fallbacks)
    }
  }

  // ── he asked to hang up ─────────────────────────────────────────────────
  // Armed, not immediate. Cutting the line the instant he says "rakh de" means
  // she never gets to say goodbye, which is the one thing that makes a call
  // feel ended rather than dropped. The window is generous because her reply
  // has to be generated AND spoken, and it self-cancels: any further speech
  // from either side disarms it, so a phrase said mid-conversation cannot end
  // a call three sentences later.
  const HANGUP_GRACE_MS = 9_000;
  /** Under this a call is a misdial, and calling back reads as pestering. */
  const CALLBACK_MIN_SECS = 8;
  /** Long enough to be a call BACK rather than the same call continuing. */
  const CALLBACK_DELAY_MS = 25_000;
  const hangupArmed = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hangupWasAsked = useRef(false);
  const endingRef = useRef(false);
  const onEndRef = useRef<(() => void) | null>(null);

  /**
   * The screen hands over its own end-of-call callback, so the armed hangup has
   * something to call. Without this the ref is a `dead-writers` instance — a
   * timer that fires into null and silently does nothing, which would look
   * exactly like the feature not working.
   */
  function bindEnd(fn: () => void) {
    onEndRef.current = fn;
  }

  function disarmHangup() {
    if (hangupArmed.current) {
      clearTimeout(hangupArmed.current);
      hangupArmed.current = null;
    }
  }

  function armHangup(lane: string) {
    if (hangupArmed.current) return; // already counting down
    diag("call", "hangup_requested", { lane, graceMs: HANGUP_GRACE_MS });
    tel("call.hangup_asked", { call_id: callId.current, lane });
    hangupArmed.current = setTimeout(() => {
      // ORDER MATTERS: endCall reads "was this asked for?" — clearing the
      // flag first made `asked` always false on exactly this path, and the
      // other suppressor (mid-sentence) is likely TRUE here because the
      // grace window exists so she can speak the goodbye. Both suppressors
      // failed together and she rang back after a hangup he requested.
      hangupWasAsked.current = true;
      hangupArmed.current = null;
      if (!alive.current) return;
      const done = onEndRef.current;
      if (done) endCall(done);
    }, HANGUP_GRACE_MS);
  }

  // ── HE SAID BYE ─────────────────────────────────────────────────────────
  //
  // The tester: *"always eager to hang up … if you say bye she should hang up
  // on her own."* Both halves of that are real and only one of them is here:
  // the eager exit LINES are persona, and this is the missing mechanism.
  //
  // The difference from `armHangup` above is the whole design. That one
  // answers an INSTRUCTION ("rakh de") with a fixed 9-second grace, because an
  // instruction is unambiguous and the only question is whether she got to
  // speak. A goodbye is a social close, so the call must end WHEN SHE HAS
  // FINISHED SAYING GOODBYE — not on a stopwatch that either guillotines her
  // or leaves both of them sitting on an open line, which is exactly the
  // silence he described.
  //
  // Four conditions, and every one of them is a way of NOT firing:
  //   1. the words are a goodbye and nothing else   (readsAsFarewell, closed
  //      vocabulary — see src/voice/farewell.ts for why "bye bolna galat
  //      laga" cannot reach here)
  //   2. the call is past its opening seconds       (a "bye" at 0:04 is a
  //      misdial or a joke)
  //   3. nothing is already counting down           (an explicit ask wins)
  //   4. SHE gets to answer it                      (the poll below waits for
  //      her voice to start and stop; the cap is the only path that ends a
  //      call she never got to say goodbye on)
  // Any further speech from him disarms it, so a goodbye that turns out to be
  // "bye— arre wait, ek aur baat" costs nothing.
  /** Under this a "bye" is not the end of a conversation, it is the start of
   *  one. Chosen against `CALLBACK_MIN_SECS` (8s = a misdial) with room. */
  const FAREWELL_MIN_SECS = 20;
  /** After her goodbye finishes. Long enough to be a beat rather than a cut,
   *  short enough that neither of them is left listening to an open line. */
  const FAREWELL_TAIL_MS = 1_400;
  /** She never wrapped up (mute, a dropped turn, a lane change mid-goodbye).
   *  The call still ends — a farewell answered by silence is over either way
   *  — but only after long enough that "she was about to speak" is excluded. */
  const FAREWELL_MAX_MS = 12_000;
  const FAREWELL_POLL_MS = 200;
  const farewellAt = useRef(0);
  const farewellPoll = useRef<ReturnType<typeof setInterval> | null>(null);

  function disarmFarewell() {
    if (!farewellPoll.current) return;
    clearInterval(farewellPoll.current);
    farewellPoll.current = null;
    farewellAt.current = 0;
    diag("call", "farewell_cancelled", {});
  }

  function armFarewell(lane: string) {
    if (farewellPoll.current || hangupArmed.current || endingRef.current) return;
    if (elapsedRef.current < FAREWELL_MIN_SECS) {
      diag("call", "farewell_ignored", { reason: "too_early", secs: elapsedRef.current });
      return;
    }
    const at = Date.now();
    farewellAt.current = at;
    diag("call", "farewell_armed", { lane, secs: elapsedRef.current });
    tel("call.farewell", { call_id: callId.current, lane, secs: elapsedRef.current });
    farewellPoll.current = setInterval(() => {
      if (!alive.current || endingRef.current) {
        disarmFarewell();
        return;
      }
      const now = Date.now();
      // her goodbye: she started speaking after his, and has since stopped.
      // BOTH lanes are read — `herStoppedAt` is the live lane's state edge and
      // `herSpokeUntil` is the cascade's — because a farewell that only works
      // on one lane is the `age-tier-never-realtime` shape in miniature.
      const herEnd = Math.max(herStoppedAt.current, herSpokeUntil.current);
      const sheAnswered = herEnd > at;
      const capped = now - at >= FAREWELL_MAX_MS;
      if (capped || (sheAnswered && !speakingRef.current && now - herEnd >= FAREWELL_TAIL_MS)) {
        const waited = now - at;
        disarmFarewell();
        // ORDER MATTERS, and `armHangup` above already paid for this lesson:
        // `endCall` reads "was this asked for?" to decide whether to arm the
        // ring-back, and a goodbye is the one ending that must NEVER ring
        // back. Set it BEFORE endCall, not after.
        hangupWasAsked.current = true;
        diag("call", "farewell_ended", { waited_ms: waited, answered: sheAnswered, capped });
        const done = onEndRef.current;
        if (done) endCall(done);
      }
    }, FAREWELL_POLL_MS);
  }

  // ── SHE SAID SHE'D CHECK, AND NOTHING IS COMING ─────────────────────────
  /** How long a fired lookup may still answer for. `callLookup`'s own fetch
   *  fuse is 5.5s; this is that plus the slack a slow phone adds. */
  const LOOKUP_WINDOW_MS = 9_000;
  /** After a note of EITHER kind went out, the backstop stays quiet: the gap
   *  has already been answered, honestly or with facts, and answering it
   *  twice is its own kind of broken. */
  const LOOKUP_SETTLE_MS = 20_000;
  /** One honest admission per topic, not per sentence. */
  const CHECK_PROMISE_GAP_MS = 90_000;
  const lookupUntil = useRef(0);
  const lastPromiseNoteAt = useRef(0);

  function maybeAnswerCheckPromise(herLine: string) {
    if (!alive.current || !liveSession.current) return;
    if (!readsAsCheckPromise(herLine)) return;
    const now = Date.now();
    if (now < lookupUntil.current) {
      diag("call", "check_promise_skip", { reason: "lookup_pending" });
      return;
    }
    if (now - lastPromiseNoteAt.current < CHECK_PROMISE_GAP_MS) {
      diag("call", "check_promise_skip", { reason: "rate" });
      return;
    }
    lastPromiseNoteAt.current = now;
    diag("call", "check_promise", { secs: elapsedRef.current });
    tel("call.check_promise", { call_id: callId.current });
    liveSession.current.direct(checkPromiseNote());
  }

  // ── THE MID-CALL RE-QUERY (P0-2) ────────────────────────────────────────
  //
  // "He asked about Rohit at minute 20; the ring query was about the weather."
  //
  // Everything this lane can remember was decided during the ring, against the
  // last four things he TYPED, and the live prompt is frozen at connect. So a
  // name or a callback he raises mid-call has no route to her at all. This is
  // that route, and it is the same shape `callLookup` is — `readsAsMemoryCue`
  // decides, this fires, and the answer arrives BESIDE her turn rather than
  // inside it, because nothing on this lane may block her audio.
  //
  // Three bounds, all of them for the same reason (`silence-tuning`: this lane
  // pays for every frame it puts in front of her):
  //
  //   FUSE   5.5s — `callLookup`'s, and it is the ONLY fuse on this path:
  //          `runRecall`'s internal 2s cap belongs to memory.ts's own wrapper
  //          and this posts the op directly (see below for why).
  //   GAP    60s — one re-query per topic, not per clause. Longer than the
  //          lookup's 45s because a memory cue repeats itself across a stretch
  //          of conversation in a way a factual question does not.
  //   BUDGET 3 per call — a ceiling on a per-call cost is what stops an
  //          all-night call being the one shape nobody tested (`NOTE_MAX`'s
  //          reasoning, one notch tighter because each of these is a round
  //          trip rather than a local render). It is also what bounds the
  //          CASCADE side: 3 × MEMORY_NOTE_BUDGET = 1,500 bytes is the most
  //          `callExtraMemories()` can ever add to that lane's tail, which
  //          api/chat.js slices at OPERATIONAL_TAIL_CAP like any other turn.
  //
  // FAILS SILENT, always. There is no honest-miss note here and there must not
  // be: unlike `callLookup`, nothing was ANNOUNCED — he asked her a question
  // and she is answering it out of her own head at ~1.5s, exactly as she does
  // today. A note saying "you could not remember" would invent a failure and
  // put a hesitation in her mouth she never had.
  const MEMORY_QUERY_FUSE_MS = 5_500;
  const MEMORY_QUERY_GAP_MS = 60_000;
  const MEMORY_QUERY_MAX = 3;
  const MEMORY_BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

  function maybeReQuery(said: string) {
    if (!alive.current || endingRef.current) return;
    if (!readsAsMemoryCue(said)) return;
    const now = Date.now();
    if (midCallRecallN.current >= MEMORY_QUERY_MAX) {
      diag("call", "requery_skip", { reason: "budget" });
      return;
    }
    if (now - lastMemoryQueryAt.current < MEMORY_QUERY_GAP_MS) {
      diag("call", "requery_skip", { reason: "rate" });
      return;
    }
    lastMemoryQueryAt.current = now;
    midCallRecallN.current += 1;
    const device = stateRef.current.deviceId;
    if (!device) return;
    const t0 = now;
    // The EXISTING op — no new endpoint, no new server code. Called directly
    // rather than through `recallForCall` because that function moves the
    // self/rel bundles into the call-lane holders, and a mid-call fetch must
    // never swap out the bundles the frozen prompt was compiled against: half
    // her relational state coming from one moment and half from another is the
    // drift `takeRelBundle`'s consume-once contract exists to prevent.
    void fetch(`${MEMORY_BASE}/api/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "recall", device, query: said.slice(0, 200) }),
      signal: AbortSignal.timeout(MEMORY_QUERY_FUSE_MS),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const memories = typeof d?.memories === "string" ? d.memories : "";
        const note = formatMemoryNote(memories);
        diag("call", "requery", {
          n: midCallRecallN.current,
          ms: Date.now() - t0,
          rows: memories.split("\n").filter((l: string) => l.trim().startsWith("- ")).length,
          bytes: note.length,
          secs: elapsedRef.current,
        });
        if (!note || !alive.current) return;
        tel("call.requery", { call_id: callId.current, n: midCallRecallN.current });
        // THE CASCADE HALF. brain.ts refuses a per-turn `recallMemories` in
        // `mode === "call"` (it takes `extraMemories` instead, so a lookup
        // never sits in front of a spoken reply) — which is right, and which
        // also meant the cascade lane could not re-query either. It does not
        // have to: `extraMemories` is a string this file owns, so the rows go
        // in behind the ring result and the NEXT cascade turn compiles with
        // them. The ring result stays as the fallback underneath, exactly as
        // brain.ts's contract expects.
        midCallRecall.current = `${midCallRecall.current}${midCallRecall.current ? "\n\n" : ""}${note}`;
        // THE LIVE HALF. The prompt is frozen, so the rows ride the one
        // channel that is not a compile — the same silent frame the running
        // note uses. `silent: true` is turnComplete:false: appended to the
        // turn context, never answered, never a cue.
        liveSession.current?.direct(note, { silent: true });
      })
      .catch(() => {
        diag("call", "requery", { n: midCallRecallN.current, ms: Date.now() - t0, rows: -1 });
      });
  }

  /** What the CASCADE lane is handed as `extraMemories`: the ring result plus
   *  anything the mid-call re-query found. One helper rather than four call
   *  sites concatenating two refs — `age-tier-never-realtime`'s shape. */
  const callExtraMemories = () =>
    midCallRecall.current
      ? `${recallRef.current}\n\n${midCallRecall.current}`
      : recallRef.current;

  // ── THE RUNNING NOTE ────────────────────────────────────────────────────
  // See callHistory.ts's `formatRunningNote` for WHY: the live session drops
  // its own oldest turns (`slidingWindow`), so on a long call the beginning
  // leaves while she is still talking. This says the beginning again, as
  // context, on a period — never as a cue, which is what `silent: true` buys.
  //
  // Live lane only. The cascade lane needs nothing: brain.ts hands the model
  // the whole transcript as turns on every single reply, so it has no window
  // to fall out of.
  /** No note before this: a call shorter than this has lost nothing. */
  const NOTE_FIRST_MS = 4 * 60_000;
  /** …and one every this often after. Chosen well inside a compression
   *  cycle rather than against one: the trigger is server-side and
   *  unobservable from here, so the note has to be frequent enough that a
   *  fresh copy is always near the end of the window, and rare enough to be
   *  invisible next to a mic uplink (one ≤900-byte frame every four minutes,
   *  against ~32KB/s of audio). */
  const NOTE_EVERY_MS = 4 * 60_000;
  /** The tick that ASKS. Deliberately much shorter than the period, so the
   *  note lands near its due moment rather than up to four minutes late. */
  const NOTE_TICK_MS = 30_000;
  /** A ceiling on a per-call cost is what stops an all-night call from being
   *  the one shape nobody tested. Twelve notes is roughly an hour. */
  const NOTE_MAX = 12;
  const notesSent = useRef(0);
  const lastNoteAt = useRef(0);

  /** The turns of the call that is happening RIGHT NOW: everything after the
   *  newest callmark (which `endCall` writes at hangup), minus anything said
   *  over a shared screen — `Message.watched`'s rule, and it applies here for a
   *  sharper reason than it does for the graph: a wrong reading of his screen
   *  re-injected as her own memory is a wrong claim she then defends. */
  function currentCallTurns(): Message[] {
    const ms = stateRef.current.messages;
    let start = 0;
    for (let i = ms.length - 1; i >= 0; i--) {
      if (ms[i]?.kind === "callmark") {
        start = i + 1;
        break;
      }
    }
    return ms
      .slice(start)
      .filter(
        (m) =>
          m.kind === "text" &&
          m.channel === "call" &&
          Boolean(m.text?.trim()) &&
          // the FLAG, not an id set: the set this replaced was trimmed to the
          // newest 200 ids, and a 35-minute call is exactly where that trim
          // starts losing the oldest share turns — the ones this note carries
          m.watched !== true,
      );
  }

  useEffect(() => {
    const iv = setInterval(() => {
      if (!alive.current || endingRef.current) return;
      const s = liveSession.current;
      if (!s) return; // cascade/native lanes carry their own history
      const now = Date.now();
      if (elapsedRef.current * 1000 < NOTE_FIRST_MS) return;
      if (lastNoteAt.current && now - lastNoteAt.current < NOTE_EVERY_MS) return;
      if (notesSent.current >= NOTE_MAX) return;
      const note = formatRunningNote(currentCallTurns());
      if (!note) return;
      lastNoteAt.current = now;
      notesSent.current += 1;
      diag("call", "running_note", {
        n: notesSent.current,
        bytes: note.length,
        secs: elapsedRef.current,
      });
      s.direct(note, { silent: true });
    }, NOTE_TICK_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function endCall(onEnd: () => void) {
    if (endingRef.current) return; // double-tap = two callmarks, two extractions
    endingRef.current = true;
    disarmFarewell();
    // ── did this call DROP, or did it end? ───────────────────────────────
    // She was mid-sentence when the line went. A person calls back after that,
    // and only after that — so the callback is armed here, on the one signal
    // that distinguishes a drop from a goodbye, and never on a timer.
    //
    // Two suppressors, both necessary. A hangup he ASKED for is not a drop even
    // if it lands mid-word (the grace window is generous, not exact). And a
    // call under a few seconds is a misdial, where calling back reads as
    // pestering rather than as the line failing.
    // `speakingRef` is the live "she has audio playing right now" flag, set by
    // the speaker start/stop callbacks on both lanes. `herSpokeUntil` is NOT
    // this — it records when she LAST stopped, so comparing it to now can
    // never be true, and the first version of this line was exactly that bug.
    const midSentence = speakingRef.current;
    const asked = hangupArmed.current !== null || hangupWasAsked.current;
    hangupWasAsked.current = false;
    if (midSentence && !asked && elapsedRef.current >= CALLBACK_MIN_SECS) {
      setState((st) => ({
        ...st,
        callback: { at: Date.now() + CALLBACK_DELAY_MS, secs: elapsedRef.current },
      }));
      diag("call", "callback_armed", { secs: elapsedRef.current });
    }
    disarmHangup();
    alive.current = false;
    if (liveSession.current) {
      liveStopping.current = true;
      liveSession.current.stop();
      liveSession.current = null;
      liveStopping.current = false;
    }
    stopWatchMode(); // screen sharing dies with the call, always
    if (reengageTimer.current) clearTimeout(reengageTimer.current);
    stopSpeaking();
    stopRingback();
    stopRoomTone();
    stopListen.current?.();
    setPhase("ended");
    diag("call", "call_ended", {
      secs: elapsedRef.current,
      duration_ms: elapsedRef.current * 1000,
      reason: "hangup",
      lane: voiceOwner.current,
    });
    flushDiag(); // the call's whole timeline lands before the screen goes away
    diagEnd("call"); // later chat events must not inherit this call's id
    // WS-INTEGRATE seam 5: closes the call's provisional episode precisely at
    // hangup instead of waiting out openOrExtendEpisode's 45-minute gap rule.
    // Fire-and-forget, never awaited — see postEpisodeCallEnd's own comment.
    postEpisodeCallEnd(stateRef.current.deviceId);
    // the chat shows a call record, never the transcript
    const secs = elapsedRef.current;
    const mmssStr = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    log({ id: uid(), from: "me", kind: "callmark", text: mmssStr, at: Date.now() });
    // distill what was said on the call into her graph memory — and keep what
    // she claimed about herself and where the call left her. The result used to
    // be discarded, so nothing said on a call ever reached her self-ledger.
    absorbRemembered(
      rememberFrom(
        stateRef.current.deviceId,
        // see store.ts's `watched`: anything said over a shared screen is
        // conversation, never durable memory about their life. Read off the
        // MESSAGE rather than off an id set, which a long session trimmed.
        stateRef.current.messages.filter((m) => m.watched !== true).slice(-60),
        wantsForAppraisal(stateRef.current.inner),
      ),
    );
    setTimeout(onEnd, 400);
  }

  // ── THE MOVE POKE ─────────────────────────────────────────────────────
  //
  // A move played while the call is up has to reach her, and it cannot ride the
  // prompt: the live prompt is FROZEN AT CONNECT and `liveAssemblies` is
  // asserted to read 1 for the whole call. So mid-call state travels the way
  // the watch lane's state travels — one `<context: …>` note through direct(),
  // angle brackets never square, because bracket text on this lane gets SPOKEN
  // (`ack-bracket-direction`: "[laughs softly]" came back as laughter plus the
  // spoken word "Softly").
  //
  // Three decisions worth writing down, because each has an obvious wrong
  // version:
  //
  // 1. DEBOUNCED, and the note describes only the LATEST move. He moves, she
  //    answers 300ms later — poking per move would queue two notes, and
  //    direct() waits for her to finish speaking before committing, so the
  //    second lands right behind the first and she says two things back to
  //    back about one exchange. A person comments on the exchange, once.
  //
  // 2. NEVER REPLAYS. `pokedPly` starts at the ply count observed on the first
  //    pass, not at zero — otherwise connecting mid-game, or any unrelated
  //    state write, walks her through a game she was already in.
  //
  // 3. NO POKE WHEN SHE IS NOT ON A CALL. There is no chat-lane equivalent
  //    here and there should not be: in chat she answers when he texts, and
  //    the tail already carries the board. An unprompted "nice move" message
  //    because he touched a piece is exactly the `never-scheduled` failure —
  //    her unprompted moves are reason-contingent, and a move he made while
  //    she is not looking is not a reason.
  // Everything the pickup directive needs to be TRUE, computed at use time:
  // the live activity, how long since the last call ended (people who hung
  // up two minutes ago do not re-greet each other), and who dialled.
  const pickupOpts = () => {
    let lastCallMinAgo: number | null = null;
    const ms = stateRef.current.messages;
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      if (m.kind === "callmark" && m.at) {
        lastCallMinAgo = Math.max(0, Math.round((Date.now() - m.at) / 60_000));
        break;
      }
    }
    return {
      scene: activityPickupLine(activityOf(stateRef.current.game)) || undefined,
      lastCallMinAgo,
      sheCalled,
    };
  };

  const pokedPly = useRef<number | null>(null);
  const pokeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const g = state.game;
    // ONE progress counter for every activity kind: chess counts plies, wyr
    // counts answered rounds. The poke machinery below (adopt-don't-replay,
    // debounce, quiet floor) is kind-blind on purpose — a third game should
    // add a branch HERE and in the fact builder, nothing else.
    const ply =
      g && !g.closedAt
        ? g.kind === "chess"
          ? g.game.played.length
          : g.kind === "ttt"
            ? g.game.played.length
            : g.rounds.length
        : null;
    // No game, or it is over: forget where we were, so a NEW game starts clean
    // rather than inheriting the last game's ply count and staying silent
    // through its opening.
    if (ply === null) {
      pokedPly.current = null;
      return;
    }
    // First sighting of this game — adopt its position without narrating it.
    if (pokedPly.current === null) {
      pokedPly.current = ply;
      return;
    }
    if (ply <= pokedPly.current) {
      // A takeback or a reset moves the count backwards. Re-anchor, say
      // nothing: "he took a move back" is a UI event, not something she
      // watched happen.
      pokedPly.current = ply;
      return;
    }
    if (!liveSession.current) {
      // Not on the live lane. Stay silent AND stay caught up, so reconnecting
      // does not trigger a note about a move from ten minutes ago.
      pokedPly.current = ply;
      return;
    }
    if (pokeTimer.current) clearTimeout(pokeTimer.current);
    const armPoke = (delayMs: number, attempt: number) => {
      pokeTimer.current = setTimeout(() => {
        pokeTimer.current = null;
        const cur = stateRef.current.game;
        if (!cur || cur.closedAt || !liveSession.current) return;
        // Urgency is decided ONCE, from the live position: an ending or a
        // check may cross the rate floor and the breath pause — that is the
        // "something crazy happened in the chess" a person interrupts their
        // own story for. Everything else waits its turn or stays unsaid.
        const urgent =
          cur.kind === "chess" &&
          Boolean(cur.game.status?.over || cur.game.status?.inCheck);
        // ── the quiet floor ────────────────────────────────────────────
        // Never cut across an exchange that is actually alive. The owner
        // felt exactly this: mid-conversation she "abruptly stopped and
        // started speaking about the move" with no interest in it. direct()
        // waits for HER voice; nothing waited for HIS. If he spoke in the
        // last beat, the conversation has the floor — re-arm and try again,
        // twice, then let the moment go: a reaction delivered late is worse
        // than none (the same judgment as the watch lane's stale-frame
        // suppressor — she must react to what is happening, not to history).
        if (Date.now() - lastHeardAt.current < 2500) {
          if (attempt < 3) armPoke(MOVE_POKE_MS * 2, attempt + 1);
          else diag("call", "activity_poke", { kind: cur.kind, dropped: "conversation_held_floor" });
          return;
        }
        // ── the breath pause ───────────────────────────────────────────
        // Her voice ended seconds ago: that is the pause INSIDE a story,
        // not the end of her turn. "She starts telling some story... and
        // then she starts again with the chess. This keeps happening" —
        // because the old poke landed in exactly this gap, every time.
        if (!urgent && Date.now() - herStoppedAt.current < HER_BREATH_MS) {
          if (attempt < 4) armPoke(HER_BREATH_MS, attempt + 1);
          else diag("call", "activity_poke", { kind: cur.kind, dropped: "her_story_held_floor" });
          return;
        }
        // ── the rate floor ─────────────────────────────────────────────
        if (!urgent && Date.now() - lastPokeAt.current < POKE_FLOOR_MS) {
          diag("call", "activity_poke", { kind: cur.kind, dropped: "rate_floor" });
          // adopt silently — this move goes unnarrated, the tail still has it
          if (cur.kind === "chess" || cur.kind === "ttt") pokedPly.current = cur.game.played.length;
          else pokedPly.current = cur.rounds.length;
          return;
        }
        if (cur.kind === "ttt") {
          pokedPly.current = cur.game.played.length;
          const whoLast = cur.game.played.length
            ? cur.game.played[cur.game.played.length - 1].by === cur.herSide
              ? "her"
              : "him"
            : null;
          if (!whoLast) return;
          const note = activityNote(tttMoveFact(cur.game, whoLast));
          if (!note) return;
          lastPokeAt.current = Date.now();
          diag("call", "activity_poke", { kind: cur.kind, ply: cur.game.played.length });
          liveSession.current.direct(note);
          return;
        }
        if (cur.kind === "wyr") {
          const round = cur.rounds[cur.rounds.length - 1];
          pokedPly.current = cur.rounds.length;
          const card = round ? cardById(round.cardId) : undefined;
          if (!round || !card) return;
          const note = activityNote(wyrPickFact(card, round.his, round.her));
          if (!note) return;
          lastPokeAt.current = Date.now();
          diag("call", "activity_poke", { kind: cur.kind, round: cur.rounds.length });
          liveSession.current.direct(note);
          return;
        }
        const plies = cur.game.played.length;
        const hers = lastAssessment(cur);
        if (!hers) return;
        pokedPly.current = plies;
        // ── salience: does this exchange EARN a comment? ───────────────
        // The last two plies decide together — his blunder is worth a note
        // even if her reply was quiet. Ordinary development is not.
        const noteworthy = (a: typeof hers | null): boolean =>
          Boolean(
            a &&
              (a.verdict === "blunder" ||
                a.verdict === "mistake" ||
                a.mateIn !== null ||
                a.hangs?.square ||
                a.statusAfter?.over ||
                a.tags.some((t) =>
                  ["capture", "check", "checkmate", "promotion", "sacrifice", "wins_material", "loses_material", "punishes_hang", "hangs_piece"].includes(t),
                )),
          );
        // ── the exchange, not the last move ────────────────────────────
        // Her engine answers ~300ms behind his move, so by the time the
        // debounce fires the "latest move" is almost always HERS — and the
        // first version therefore had her narrating her own play every
        // single exchange ("she played Nf6, a good one"), which reads as
        // exactly the robot it is. A person talks about the exchange: what
        // HE did — that is the move she is responding to and where the
        // salience lives — and what she did about it.
        const lastMover = hers.fenBefore.split(" ")[1] === cur.herSide ? "her" : "him";
        let fact: string;
        let earned: boolean;
        if (lastMover === "her" && cur.game.played.length >= 2) {
          const hisPly = cur.game.played[cur.game.played.length - 2];
          const his = assessMove(hisPly.fenBefore, hisPly, hisPly.fenAfter);
          fact = exchangeFact(his, hers, cur.herSide);
          earned = noteworthy(his) || noteworthy(hers);
        } else {
          fact = moveFact(hers, cur.herSide, lastMover);
          earned = noteworthy(hers);
        }
        if (!earned && !urgent) {
          // a quiet exchange passes without a word — the position is in the
          // tail, so she can still bring it up herself if it fits the talk
          diag("call", "activity_poke", { kind: cur.kind, ply: plies, dropped: "quiet_move" });
          return;
        }
        const note = activityNote(fact);
        if (!note) return;
        lastPokeAt.current = Date.now();
        diag("call", "activity_poke", { kind: cur.kind, ply: plies, exchange: lastMover === "her" });
        liveSession.current.direct(note);
      }, delayMs);
    };
    // ── the lag fix ────────────────────────────────────────────────────
    // The debounce exists to merge his move and her reply into ONE note. But
    // once HER reply is the latest ply, the exchange is complete — there is
    // nothing left to merge, and every millisecond of further debounce is lag
    // between the piece landing on the board and her voice knowing it. The
    // owner measured this with his own ears: "she is making a fast move on
    // the table but calling them after some time... this lag will compound."
    // So: exchange complete → fire nearly at once; his move alone → the full
    // debounce, giving her engine reply time to join the note.
    const exchangeComplete =
      !!g &&
      (g.kind === "chess" || g.kind === "ttt") &&
      g.game.played.length > 0 &&
      g.game.played[g.game.played.length - 1].by === g.herSide;
    const boardGameOver = !!g && (g.kind === "chess" || g.kind === "ttt") && Boolean(g.game.status.over);
    if (!!g && (g.kind === "chess" || g.kind === "ttt") && !exchangeComplete && !boardGameOver) {
      // His move, her reply pending. In these games it is ALWAYS her turn
      // after his move, and her reply now takes a human think-time (1–6s) —
      // so a debounce would fire BEFORE her reply and split one exchange
      // into two notes, which is the story-fragmentation defect reborn.
      // Say nothing yet; the completed exchange speaks once, for both moves.
      // (His game-ending move is the exception handled above: there is no
      // reply coming, and an ending is worth a word.)
      pokedPly.current = g.game.played.length;
      return;
    }
    armPoke(exchangeComplete ? 150 : MOVE_POKE_MS, 0);
    return () => {
      if (pokeTimer.current) {
        clearTimeout(pokeTimer.current);
        pokeTimer.current = null;
      }
    };
  }, [state.game]);

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  // Publish the call so a board, or any future activity, can show it without
  // the call being lifted into App — see state/callStatus.ts on why an
  // `onStatus` prop would re-render the whole chat once a second.
  useEffect(() => {
    publishCallStatus({
      live: phase === "live",
      connecting: phase === "connecting",
      muted,
      mmss,
      toggleMute,
      // WATCH / LOOK-AWAY, mirrored here so every surface that shows call
      // state (ActivityShell today, Us tomorrow) can show watch state too —
      // she can see the screen and the UI has to say so wherever the call is
      // represented, not only on the call screen itself.
      watching,
      watchPaused,
      onLookAway,
      // LIVE-DROP INDICATOR: a lane that silently degraded used to render
      // nothing anywhere the call is shown. Mirrored for the same reason.
      laneDegraded,
    });
  });
  useEffect(() => clearCallStatus, []);
  // the degraded-pill timer must not fire setState after this call is gone
  useEffect(
    () => () => {
      if (laneDegradedTimer.current) clearTimeout(laneDegradedTimer.current);
    },
    [],
  );

  return {
    phase,
    speaking,
    listening,
    thinking,
    muted,
    toggleMute,
    heard,
    sttSupported,
    mmss,
    handleUser,
    startListening,
    endCall,
    bindEnd,
    disarmHangup,
    watching,
    frameAt,
    // CASCADE-SHARE CHIP TRUTH: the moment a frame actually reached her, not
    // the moment one was captured — see `push()` and the native `onFrame`
    // callback above.
    sentAt,
    watchAvailable: watchAvailable() || webWatchAvailable(),
    startWatchMode,
    stopWatchMode,
    // the look-away, for whoever draws the control next to the watch chip
    watchPaused,
    onLookAway,
    // NATIVE-WATCH MUTE HONESTY: true while the Android watch service owns
    // the mic, so the mute control can disable itself and the copy can say
    // why instead of reporting a state nothing makes true.
    nativeVoice: voiceLane === "native",
    // CASCADE-SHARE CHIP TRUTH, other half: on the web lane, frames only ever
    // reach her via a live session's socket. When this is false and
    // `nativeVoice` is also false, a web share is running with nowhere for
    // its frames to go except the reactive glance a cascade turn attaches —
    // never the continuous watching the chip used to claim unconditionally.
    liveVoiceActive: voiceLane === "live",
    // LIVE-DROP INDICATOR, for CallVoice's own state label.
    laneDegraded,
  };
}
