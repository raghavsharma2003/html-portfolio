// Conversation engine for voice calls: she greets you, listens continuously
// (hands-free STT with a mute toggle; typed fallback where STT is missing),
// thinks, and speaks back.
//
// Realism contract: nothing said on a call appears as chat bubbles. Call
// turns are stored with channel:"call" — hidden from the chat UI but fed to
// the brain, so she remembers call conversations perfectly. The chat shows
// only a "📞 Voice call · m:ss" record when the call ends.

import { useEffect, useRef, useState } from "react";
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
import { logTurns, rememberFrom, recallForCall, callSelfBundle } from "../engine/memory";
import { asksToHangUp } from "../engine/hangup";
import { activityOf, lastAssessment } from "../state/game";
import { clearCallStatus, publishCallStatus } from "../state/callStatus";
import { activityNote } from "../engine/activity";
import { moveFact } from "../engine/chessTalk";
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
import { callLookup } from "../voice/liveLookup";
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

export function useCallEngine(
  state: AppState,
  setState: React.Dispatch<React.SetStateAction<AppState>>,
) {
  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [muted, setMuted] = useState(false);
  // watch-together: she sees their screen while staying on the call
  const [watching, setWatching] = useState(false);
  const [frameAt, setFrameAt] = useState(0); // UI proof that frames flow
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
  // G-C4, as an assertion rather than a promise: the number of times a LIVE
  // system prompt has been built on this call. It must be 1. A mid-call
  // reassembly is a different person mid-sentence, and the failure is
  // inaudible until she contradicts herself.
  const liveAssemblies = useRef(0);
  // consecutive instant recognizer failures — backoff instead of hot-looping
  const srFails = useRef(0);
  const srStartedAt = useRef(0);
  const speakingRef = useRef(false);
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

  // Turns spoken while their screen was shared. Frames are ephemeral — they
  // are streamed and never stored — but what she SAYS about a screen is not,
  // and that is the leak nobody had covered: at the end of every call the
  // last turns go to the graph extractor, which mints durable rows about the
  // user's life from them. One glance at a thread and "Rohit na?" stops being
  // a passing mistake and becomes a permanent, confidently wrong claim she
  // will raise weeks later — and it goes to a second vendor to get there.
  // Screen-derived talk is conversation; it is never durable memory about
  // their life. The price is losing some genuine memory ("they were shopping
  // for a bike") and that is the correct price.
  const watchTurnIds = useRef<Set<string>>(new Set());
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

  const log = (m: Message) => {
    if (watchSession.current && m.kind === "text") {
      watchTurnIds.current.add(m.id);
      if (watchTurnIds.current.size > 400) {
        // unbounded growth across a long session is the only cost here
        watchTurnIds.current = new Set([...watchTurnIds.current].slice(-200));
      }
    }
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
  });

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
  // fetch. 900ms is chosen against the measured recall (~165ms warm, ~900ms
  // cold, hard-capped at 2s inside runRecall) and against the connect budget
  // (ring 1.1-2.4s + 3.5s of grace before the cascade takes the call), so the
  // typical cost is ~165ms of a ~4.6s budget and the worst case is 900ms.
  const RING_FETCH_DEADLINE_MS = 900;
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
      // what they said last before calling — her taste is pulled from it, the
      // same way the chat lane does. A pickup is THEM calling HER, so this is
      // never her volunteering an opinion.
      userText: lastMsg?.text || "",
    });
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
      memories: recallRef.current,
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
      // (`rejected.md#realtime-recall-never`). `sheInitiated` is left unset,
      // which is correct and not an omission: a pickup is THEM calling HER.
      selfBundle: callSelfBundle(stateRef.current.deviceId),
      // moment.ts's pull-only law reads ONLY the live turn, and a pickup has
      // no turn yet — so "" here, never the last thing they typed. That keeps
      // T6 on its STANDING BACKGROUND heading ("do not raise any of this
      // yourself") and leaves T4 unmomented, which is the 0-unprompted-raises
      // property. The gap still speaks for itself below.
      latestUserText: "",
      gapSinceLastMs: lastMsgAt ? Math.max(0, nowAt - lastMsgAt) : 0,
      // fresh at the point of compile, never memoized — same contract
      // brain.ts is under. This is also the first time an age-tier refusal
      // has ever reached the realtime lane.
      ageGates: gatesFor(getAgeTier()),
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
      sections: compiled.sections ?? {},
    });
    let self: LiveSession | null = null;
    const s = await startLiveCall({
      base: LIVE_BASE,
      system,
      onState: (st) => {
        if (!alive.current) return;
        const speaking = st === "speaking";
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
        log({ id: uid(), from: "me", kind: "text", channel: "call", text: t, at: Date.now() });
        // A factual question on a call: fire the lookup NOW, in parallel with
        // her own answer, and inject the facts a beat after she has started
        // talking. `callLookup` is a no-op unless the turn is unambiguously
        // factual (measured 0 false fires in 55 ordinary turns), and it
        // resolves to "" on any failure, so the worst case is that nothing
        // happens and she answers from her own head as she does today.
        void callLookup(t).then((note) => {
          if (!note) return;
          // direct() already waits (capped at 1.2s) for her to stop speaking
          // before committing the turn, so this cannot guillotine her mid-word
          liveSession.current?.direct(note);
        });
      },
      onHerText: (t) => {
        const id = uid();
        log({ id, from: "her", kind: "text", channel: "call", text: t, at: Date.now() });
        noteHerLine(t, "live", id);
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
    ringFetch.current = recallForCall(state.deviceId, recent)
      .then(({ memories, relBundle }) => {
        recallRef.current = memories;
        relBundleRef.current = relBundle;
        ringFetchMs.current = Date.now() - tRing;
      })
      // A rejected ring fetch must never reject the connect that races it:
      // this promise is awaited on the call path, so an unhandled rejection
      // here would surface as "live failed to start" — the whole call lost to
      // a memory lookup that was only ever an enhancement.
      .catch(() => {
        ringFetchMs.current = -1;
      });
    // she improvises her own phone pickup — nothing scripted. The brain call
    // starts NOW, in parallel with the "ringing" beat, so pickup is instant.
    const greetPromise = think(
      state.user,
      brainKeys(),
      state.messages,
      CALL_OPEN_DIRECTIVE(),
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
        winner.direct(CALL_OPEN_DIRECTIVE()); // she picks up, spoken live
        track(stateRef.current.deviceId, "live_call_started", { ...liveTiming.current });
        return; // realtime session owns the call from here
      }
      // the race lost by a hair: the session claimed the slot in the
      // microtask gap between the timeout and this line — it's ready, take it
      if (voiceOwner.current === "live" && liveSession.current?.active()) {
        const s2 = liveSession.current;
        if (!mutedRef.current) s2.setMuted(false);
        s2.direct(CALL_OPEN_DIRECTIVE());
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
          recallRef.current,
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
        `<context: on the call, they've gone quiet for a few seconds after your last line. keep the conversation alive naturally like a real girl on the phone — extend your last thought, tease them for going quiet ("hello? so gaye kya"), or take the topic somewhere new. 1-2 short spoken sentences. never reference this note>`,
        "call",
        engine,
        true,
        undefined,
        recallRef.current,
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
        memories: recallRef.current,
        herLife: formatHerLife(stateRef.current.herLife),
        cultureNoteText: "",
        relBundle: relBundleRef.current,
        // T-H1: same ring-fetched self bundle the live lane compiles from, so
        // the native watch engine is not the one lane that forgot. Unset
        // `sheInitiated` is correct here too — a share is THEM starting it.
        selfBundle: callSelfBundle(stateRef.current.deviceId),
        // same pull-only reasoning as the live lane's compile: no live turn
        // exists at the moment a share starts
        latestUserText: "",
        gapSinceLastMs: watchLastAt ? Math.max(0, watchNow - watchLastAt) : 0,
        ageGates: gatesFor(getAgeTier()),
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
    if (voiceOwner.current === "native") claimVoice("cascade", "watch_stopped");
    // give the native recognizer a beat to release the hardware before the
    // JS one grabs it — an instant re-arm tends to land on BUSY
    setTimeout(() => {
      if (alive.current && !mutedRef.current) startListening();
    }, 450);
  }

  // Only a frame she could honestly call "right now" is attached. The
  // baseline flow can drop to one frame per 2.5s under congestion, and an
  // 8s-old picture described as live is how she ended up commenting on
  // things that were already gone. Past this she answers without the screen.
  const freshFrame = () =>
    watching && frameRef.current && Date.now() - frameRef.current.at < 3000
      ? frameRef.current.url
      : undefined;

  function toggleMute() {
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
  }

  async function handleUser(text: string, prestart?: SpecTurn) {
    if (!alive.current || !text.trim()) return;
    if (asksToHangUp(text)) armHangup("cascade");
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
        recallRef.current,
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
      hangupArmed.current = null;
      if (!alive.current) return;
      const done = onEndRef.current;
      if (done) endCall(done);
    }, HANGUP_GRACE_MS);
  }

  function endCall(onEnd: () => void) {
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
    const asked = hangupArmed.current !== null;
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
    rememberFrom(
      stateRef.current.deviceId,
      // see watchTurnIds: anything said over a shared screen is conversation,
      // never durable memory about their life
      stateRef.current.messages.filter((m) => !watchTurnIds.current.has(m.id)).slice(-60),
      wantsForAppraisal(stateRef.current.inner),
    ).then(({ self, inner }) => {
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
    });
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
  const pokedPly = useRef<number | null>(null);
  const pokeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const g = state.game;
    const ply = g && !g.closedAt ? g.game.played.length : null;
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
    pokeTimer.current = setTimeout(() => {
      pokeTimer.current = null;
      const cur = stateRef.current.game;
      if (!cur || cur.closedAt || !liveSession.current) return;
      const last = lastAssessment(cur);
      if (!last) return;
      pokedPly.current = cur.game.played.length;
      const whoMoved = last.fenBefore.split(" ")[1] === cur.herSide ? "her" : "him";
      const note = activityNote(moveFact(last, cur.herSide, whoMoved));
      if (!note) return;
      diag("call", "activity_poke", { kind: cur.kind, ply: cur.game.played.length, who: whoMoved });
      liveSession.current.direct(note);
    }, MOVE_POKE_MS);
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
    });
  });
  useEffect(() => clearCallStatus, []);

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
    watchAvailable: watchAvailable() || webWatchAvailable(),
    startWatchMode,
    stopWatchMode,
    // the look-away, for whoever draws the control next to the watch chip
    watchPaused,
    setWatchPaused: (on: boolean) => {
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
        // nor a pending reaction window from behind the closed curtain
        pendingShowWake.current = null;
      }
    },
  };
}
