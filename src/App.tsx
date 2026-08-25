import { useCallback, useEffect, useRef, useState } from "react";
import { useAppState, rotateDeviceId } from "./state/store";
import type { AuthInfo, AppState } from "./state/store";
import Onboarding from "./components/Onboarding";
import Chat from "./components/Chat";
import CallVoice from "./components/CallVoice";
import IncomingCall from "./components/IncomingCall";
import AuthSheet from "./components/AuthSheet";
import ClockCard from "./components/ClockCard";
import GamesHub, { DEFAULT_ACTIVITIES, type Activity } from "./components/GamesHub";
import HomeScreen from "./components/HomeScreen";
import StoryView from "./components/StoryView";
import { activeStories } from "./engine/storyCatalog";
import ChessActivity from "./components/ChessActivity";
import WouldYouRatherActivity from "./components/WouldYouRatherActivity";
import TicTacToeActivity from "./components/TicTacToeActivity";
import KnowsScreen from "./components/KnowsScreen";
import { CloseIcon, ChevronIcon } from "./components/icons";
import { applyTheme, watchSystemTheme, watchSky } from "./engine/theme";
import { configureSky, parseSkySeed } from "./engine/sky";
import { mergeStates, safeUser } from "./state/merge";
import { OPEN_STALE_MS, activityOf, isGameSession } from "./state/game";
import ErrorBoundary from "./components/ErrorBoundary";
import { LABEL } from "./engine/activity";
import {
  episodeDateLabel,
  logFinishedActivity,
  publishActivityLedger,
  withActivityRecord,
  type ActivityRecord,
} from "./engine/memory";
import { dyadRecord, momentRecord, recordCounts } from "./engine/milestones";
import { useMoments } from "./components/useMoments";
import Celebration from "./components/Celebration";
import UsScreen from "./components/UsScreen";
import { unlockAudio } from "./voice/speech";
import { diagStart } from "./engine/diag";
import { startSessionClock } from "./engine/clock";
import { tel, telIdentify, telRoute } from "./engine/telemetry";
import { prewarmLiveToken } from "./voice/liveCall";
import { primeCulture } from "./engine/culture";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
// The hardware back button, and the ONLY thing this plugin is here for. It is
// imported unconditionally (the web bundle carries a few hundred bytes of
// no-op bridge) and USED only behind `Capacitor.isNativePlatform()`, because a
// dynamic import inside the effect would make the listener's registration
// depend on a network-free chunk load — and the window before it resolves is
// the window in which back closes the app.
import { App as CapApp } from "@capacitor/app";
// ── WS-NOTIFY ────────────────────────────────────────────────────────────
// The whole notification surface is these two imports. Everything behind them
// no-ops without keys (there are none to have — the local lane needs nothing
// configured) and without permission (nothing is posted and nothing is asked
// until the app has something real to say). See src/notify/index.ts.
import NotifySheet from "./notify/NotifySheet";
import {
  cancelStory,
  clearMissedCall,
  clearReachability,
  clearReply,
  notifyAvailable,
  permissionState,
  postMissedCall,
  postReply,
  pushConfigured,
  registerForPush,
  requestPermission,
  scheduleStory,
  shouldExplain,
  submitPushToken,
  type NotifyPermission,
} from "./notify";
import type { FeltReason } from "./notify/prefs";
import { nextStoryChange, storyAtChange } from "./notify/story";
import {
  consumeOAuthCallback,
  ensureFresh,
  isAuthDead,
  AccountError,
  loadStateRemote,
  saveStateRemote,
  track,
  type AuthSession,
} from "./engine/account";

// ── the sky test seam ────────────────────────────────────────────────────
//
// Exactly the shape `configureClock()` in clock.ts uses, and for exactly the
// same reason: the five sky states are verified by SIMULATING time, never by
// waiting for it, and a screenshot battery that waited until 04:30 IST is a
// battery nobody runs.
//
// It runs at MODULE level rather than in an effect, and that is load-bearing
// rather than stylistic: `useSky()` seeds its state on the first render, so a
// seam installed in an effect would arrive one render too late and every
// screenshot would be of the real sky wearing a query parameter. Only ever
// active when an explicit `?sky=` is present, which no shipped link contains.
try {
  const at = parseSkySeed(new URLSearchParams(location.search).get("sky"));
  if (at !== null) configureSky({ now: () => at });
} catch {
  /* no location (SSR, a test harness) — the real clock stands */
}

// ── THE PULL'S THREE NUMBERS ─────────────────────────────────────────────
// Module level so `evals/sync.mjs` can read them out of the source and pin
// them: a periodic network read whose period lives only in a closure is a
// cost nobody can audit. See the pull effect for what each one buys.
/** Focus fires visibilitychange AND focus, and the OTA check runs on the same
 *  edge — coalesce them into one read. */
const PULL_DEBOUNCE_MS = 700;
/** A floor between two reads from any trigger, so tab-flapping (or a boot
 *  load followed by the first focus) cannot turn into a request per switch. */
const PULL_MIN_GAP_MS = 20_000;
/** The open-and-quiet case, where no focus edge is ever coming. Above the 60s
 *  floor because the response is the whole state row — measured, not guessed:
 *  63.5 KB / 99.8 KB with a chess session (see the effect). */
const PULL_PERIOD_MS = 90_000;

/** Where the API lives for THIS build. The APK's WebView serves from
 *  `https://localhost`, so a relative path there reaches Capacitor's own local
 *  server and not the site. Same expression the live-token prewarm uses; stated
 *  once at module level because two copies of an origin is one copy too many. */
const NOTIFY_API_BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

// union-merge two message histories by id (never wholesale replacement —
// a message typed during sign-in must survive), honoring the clear-chat
// tombstone so a wiped chat can't be resurrected by a stale copy

export default function App() {
  const [state, setState] = useAppState();
  const [inCall, setInCall] = useState(false);
  // THINGS THEY DO TOGETHER. Both are overlays rendered as SIBLINGS of Chat and
  // CallVoice, never replacements: opening a board must not unmount the chat or
  // drop a live call, because the whole point of the activity layer is that
  // this is one continuous session rather than a set of modes.
  // THEME. Applied in an effect rather than during render because it mutates
  // the document, and applied BEFORE anything else paints for the obvious
  // reason: a dark-mode user watching the app flash white on every launch is a
  // worse experience than no dark mode at all.
  useEffect(() => {
    applyTheme(state.theme);
    // and keep following the OS while the choice is "system" — the phone
    // switching to dark at sunset with the app open is the exact case this is
    // for, and a value read once at startup would miss it
    const offOs = watchSystemTheme(state.theme, () => applyTheme(state.theme));
    // …and keep following the CLOCK while the choice is "sky". Same shape,
    // different signal: scheduled to the next sky boundary rather than
    // subscribed to a media query, because the sky changes five times a day
    // at times this app already knows.
    const offSky = watchSky(state.theme, () => applyTheme(state.theme));
    return () => {
      offOs();
      offSky();
    };
  }, [state.theme]);

  // Who dialled the call that is up. "her" only on the callback accept path —
  // she has to KNOW she called, or she answers her own call like a stranger.
  const [callFrom, setCallFrom] = useState<"him" | "her">("him");
  const [gamesOpen, setGamesOpen] = useState(false);
  const [usOpen, setUsOpen] = useState(false);
  // WS-KNOWS. "What she remembers" is reached from Settings > You, and Settings
  // lives inside Chat.tsx, which this file does not own. So the row announces
  // itself and this file listens: one event, one listener, no prop chain
  // through a component another workstream owns, and no second writer for
  // state that is not ours (the shape `activity-forgot-the-teardown` is filed
  // under). Everything else about it is the ordinary overlay contract below.
  const [knowsOpen, setKnowsOpen] = useState(false);
  const [composePrefill, setComposePrefill] = useState<{ text: string; n: number }>({ text: "", n: 0 });
  useEffect(() => {
    const open = () => setKnowsOpen(true);
    window.addEventListener("meera:knows", open);
    return () => window.removeEventListener("meera:knows", open);
  }, []);
  const [settingsSignal, setSettingsSignal] = useState(0);
  const [storyOpen, setStoryOpen] = useState(false);

  // ── THE SURFACE ────────────────────────────────────────────────────────
  //
  // Home is the landing (DESIGN-WORLD §2: "a new landing surface inside the
  // app"). The thread opens from it, and it also opens straight from a deep
  // link — `#chat`, which is what a "message Meera" shortcut or a
  // notification points at.
  //
  // NOTHING TRAPS, and that is enforced two ways rather than one:
  //  * opening the thread pushes a history entry, so the browser's back and
  //    Android's hardware back land home;
  //  * App paints its own back control over the thread's header, because
  //    Chat.tsx belongs to another workstream and a route that only works
  //    through a gesture is a route half the users never find.
  //
  // "Android's hardware back, WHICH CAPACITOR MAPS TO HISTORY" was the line
  // here, and it was the assumption that made the native back a defect rather
  // than a feature — see ONE BACK, TWO BUTTONS below. Capacitor maps it to
  // history only until something registers a `backButton` listener, and what
  // it maps it to is `history.back()` OR `exitApp()`, which over an overlay
  // is the wrong one of the two.
  const [surface, setSurface] = useState<"home" | "chat">(() =>
    typeof location !== "undefined" && /(^|[#?&])chat\b/.test(location.hash + location.search)
      ? "chat"
      : "home",
  );
  // THE HISTORY WORK LEFT THE UPDATER, and that is a correctness fix rather
  // than a tidy-up. Both of these used to push/pop from INSIDE a `setSurface`
  // updater, and an updater must stay pure because React may call one twice
  // (StrictMode does, on every render). One double-invoke pushed two entries
  // for one thread, which was invisible while the pop handler was idempotent
  // and is not invisible now that `unwind` keeps a count.
  const pushEntry = useCallback((kind: string) => {
    try {
      history.pushState({ meera: kind }, "");
    } catch {
      /* history unavailable (some embedded WebViews) — every close control in
         the app still works; only the two BACK gestures lose their meaning */
    }
  }, []);
  const openChat = useCallback(() => {
    setSurface((cur) => {
      if (cur !== "chat") pushEntry("chat");
      return "chat";
    });
  }, [pushEntry]);
  // A `history.back()` THIS APP performs is indistinguishable from a back
  // PRESS at the `popstate` handler, and that used to be harmless because the
  // handler was idempotent (it only ever set the surface home). It closes
  // things now, so a self-inflicted pop would close a second layer nobody
  // asked it to. Every programmatic unwind goes through `unwind()` and is
  // counted off here.
  const selfPop = useRef(0);
  const unwind = useCallback(() => {
    try {
      selfPop.current += 1;
      history.back();
    } catch {
      selfPop.current = Math.max(0, selfPop.current - 1);
      /* see pushEntry */
    }
  }, []);
  const surfaceRef = useRef(surface);
  useEffect(() => {
    surfaceRef.current = surface;
  }, [surface]);
  const goHome = useCallback(() => {
    if (surfaceRef.current === "home") return;
    setSurface("home");
    // Unwind the entry openChat pushed rather than pushing another one, so
    // a session of home→chat→home→chat does not build a stack a user has
    // to press back through five times to leave the app.
    if (history.state?.meera === "chat") unwind();
  }, [unwind]);


  // Escape closes, and focus starts inside the sheet rather than wherever the
  // page happened to leave it. Lifted verbatim from MoreSheet, because the
  // games hub was the ONE `aria-modal` overlay in the app without it — a sheet
  // that announces itself as modal and then ignores the key every modal
  // answers to is not a small gap: a keyboard user has no way out of it, and
  // on a tall phone neither does anyone else once the 8px of scrim above it
  // scrolls away.
  const gamesSheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!gamesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setGamesOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gamesOpen]);
  useEffect(() => {
    if (!gamesOpen) return;
    gamesSheet.current?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
  }, [gamesOpen]);

  // ── THE GAME RECONCILER ────────────────────────────────────────────────
  // Close and tally are properties of the STATE TRANSITION, written here in
  // the one component that is always mounted — not in whichever board
  // happened to be watching. The audit found four failures with one cause
  // (the close/tally living in a component effect with a 25s timer): leave
  // the board within 25s of the ending and the game is never closed and
  // never counted; press New game inside the window and the finished game
  // vanishes from the tally; a game closed on another device arrives
  // status.over and untallied forever; and an OPEN session abandoned
  // mid-game announces "RIGHT NOW you two are in the middle of… 4320 min
  // in" indefinitely, because RECENT_END_MS only ages CLOSED sessions.
  //
  // Idempotence is the `tallied` flag on the session itself, so it survives
  // sync (a session arriving already tallied is skipped) and StrictMode.
  // The 3s delay before closing a just-finished game exists for exactly one
  // consumer: the move poke's ending note, which checks !closedAt — closing
  // in the same tick as the mate would silence her reaction to it.
  useEffect(() => {
    const g = state.game;
    if (!g) return;
    const boardOver = (g.kind === "chess" || g.kind === "ttt") && Boolean(g.game.status.over);
    const stale =
      !g.closedAt && Date.now() - (g.touchedAt ?? g.startedAt) > OPEN_STALE_MS;
    const needsClose = !g.closedAt && (boardOver || stale);
    const needsTally = !g.tallied && (boardOver || (g.kind === "chess" && g.closedAt && g.endedEarly));
    if (!needsClose && !needsTally) return;
    const t = setTimeout(
      () => {
        setState((s) => {
          const cur = s.game;
          if (!cur) return s;
          let next = cur;
          const curOver =
            (cur.kind === "chess" || cur.kind === "ttt") && Boolean(cur.game.status.over);
          const curStale =
            !cur.closedAt && Date.now() - (cur.touchedAt ?? cur.startedAt) > OPEN_STALE_MS;
          if (!cur.closedAt && (curOver || curStale)) {
            next = {
              ...next,
              closedAt: Date.now(),
              // an abandoned board ended without a result — same honest
              // wording as the End-game button, never a fabricated winner.
              // BOTH boards, not only chess: a ttt session left open past
              // OPEN_STALE_MS was closed with no `endedEarly`, so its record
              // said "left unfinished" with nobody named as having left it and
              // its facts kept a live "it is his move" under a heading saying
              // the game had just finished.
              ...(curStale && !curOver && (cur.kind === "chess" || cur.kind === "ttt")
                ? { endedEarly: true as const }
                : {}),
            };
          }
          let tally = s.tally;
          if (!cur.tallied) {
            const t0 = s.tally ?? {};
            if (cur.kind === "chess" && curOver) {
              const w = cur.game.status.winner;
              tally = {
                ...t0,
                chessGames: (t0.chessGames ?? 0) + 1,
                chessWinsHim: (t0.chessWinsHim ?? 0) + (w && w !== cur.herSide ? 1 : 0),
                chessWinsHer: (t0.chessWinsHer ?? 0) + (w && w === cur.herSide ? 1 : 0),
              };
              next = { ...next, tallied: true as const };
            } else if (cur.kind === "chess" && (cur.endedEarly || (curStale && !curOver)) && cur.game.played.length >= 10) {
              // an early-ended game with real play COUNTS as a game and
              // names no winner — below ten plies it is the mis-tap the
              // exit handler already treats it as
              tally = { ...t0, chessGames: (t0.chessGames ?? 0) + 1 };
              next = { ...next, tallied: true as const };
            } else if (cur.kind === "ttt" && curOver) {
              tally = { ...t0, tttGames: (t0.tttGames ?? 0) + 1 };
              next = { ...next, tallied: true as const };
            }
          }
          return next === cur && tally === s.tally ? s : { ...s, game: next, tally };
        });
      },
      boardOver && !g.closedAt ? 3000 : 0,
    );
    return () => clearTimeout(t);
  }, [state.game, setState]);

  // ── #113: THE RECONCILER'S EMISSION — a closed session becomes a memory ──
  // `activityOf` drops a finished game after RECENT_END_MS (two hours), and
  // after that it is gone rather than remembered. This is the hand-off to the
  // memory layer, and it is a SEPARATE effect from the close above for two
  // reasons: a `setState` updater must stay pure (React may call one twice),
  // and `closedAt` is not written only by the reconciler — ChessActivity's
  // "End game" and the WYR sheet write it too, so watching the FIELD catches
  // every close rather than only the ones this file performs.
  //
  // Fire-and-forget, hard: nothing is awaited, nothing is read back, and the
  // POST cannot reach `state.game`. The ref is a local courtesy against
  // re-fires within one mount (StrictMode, a re-render, the tally landing a
  // tick later); real idempotence is server-side and keyed on the session's
  // startedAt, because two synced devices each hold their own copy of this
  // ref and only the server sees both.
  const emittedActivity = useRef<Set<string>>(new Set());
  useEffect(() => {
    const g = state.game;
    if (!g?.closedAt || !state.deviceId) return;
    const key = `${g.kind}:${g.startedAt}`;
    if (emittedActivity.current.has(key)) return;
    // THE SINGLE DERIVATION, reused rather than re-derived (`activityOf`'s own
    // note: two lanes deriving the same state separately is how a rule gets
    // silently lost). `closedAt + 1` is a real argument rather than a trick:
    // it asks what this activity looked like the instant it closed, which is
    // exactly the state the memory should hold, and it makes the answer
    // independent of how long ago that was — a session closed on another
    // device and synced here three hours later emits the same episode it
    // would have emitted at the table.
    const a = activityOf(g, g.closedAt + 1);
    if (!a || !a.facts.length) return;
    emittedActivity.current.add(key);
    const rec = logFinishedActivity(
      state.deviceId,
      {
        kind: a.kind,
        facts: a.facts,
        // the durable half — what is still true next week (activity.ts's
        // `record`). Without it the episode was the momentary rows alone, and
        // a finished game was remembered as "6 moves in" with no moves.
        record: a.record,
        startedAt: g.startedAt,
        closedAt: g.closedAt,
      },
      // one vocabulary for what an activity is CALLED — the same table the
      // tail block and the pickup line render from
      LABEL[a.kind],
    );
    // THE LOCAL HALF, and it is the one that cannot fail. The POST above is
    // fire-and-forget over a network, into a graph whose only keyword route
    // does not cover activities; this write is synchronous, works signed out,
    // and is what she actually reads from. Both halves carry the SAME string.
    if (rec) setState((s) => ({ ...s, activities: withActivityRecord(s.activities, rec) }));
  }, [state.game, state.deviceId, setState]);

  // The ledger, published for the lanes that cannot reach `AppState`. Same
  // holder idiom as `callSelfBundle` and for the same reason: the cascade call
  // lane compiles outside this component's frame. One publisher, any number of
  // readers, and it republishes on hydrate so a reload does not start her with
  // an empty record of games she definitely played.
  useEffect(() => {
    publishActivityLedger(state.activities);
  }, [state.activities]);

  // "the app came to the front" — one signal, two readers (the derived rows
  // below and the pull further down). `focus` as well as `visibilitychange`
  // because a desktop browser switching WINDOWS fires only the former, and a
  // second window is exactly the second device this whole seam is about.
  const [frontTick, setFrontTick] = useState(0);
  useEffect(() => {
    const onFront = () => {
      if (document.visibilityState === "visible") setFrontTick((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onFront);
    window.addEventListener("focus", onFront);
    return () => {
      document.removeEventListener("visibilitychange", onFront);
      window.removeEventListener("focus", onFront);
    };
  }, []);

  // ══ WS-NOTIFY — the app went AWAY ═══════════════════════════════════════
  //
  // `frontTick`'s mirror image, and it needs to be its own signal rather than
  // "not front": `focus` has no counterpart that means "the user left" (a
  // desktop `blur` fires when a devtools panel takes focus), so this listens
  // to `visibilitychange` alone and to the hidden half of it only. Two readers,
  // both below: her story is armed on this edge, and a call ringing into an app
  // that has just been backgrounded is a call he is about to miss.
  const [awayTick, setAwayTick] = useState(0);
  useEffect(() => {
    const onAway = () => {
      if (document.visibilityState === "hidden") setAwayTick((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onAway);
    return () => document.removeEventListener("visibilitychange", onAway);
  }, []);

  // ══ WS-NOTIFY — permission, felt moments, and the three things ══════════
  //
  // The law every line here answers to is `proactive-reason-contingent`:
  // SOMETHING HAPPENED. Each notification below is caused by an event with a
  // timestamp — her reply, her call, her story turning over — and none of them
  // can be caused by his absence, because nothing in this block reads how long
  // it has been since he was here. There is no elapsed-time input anywhere in
  // it, which is a property a reader can check rather than a promise.

  /** What the OS says right now, re-read on every front edge. Never cached
   *  across one: a user can revoke this in system settings while the app is
   *  open, and a stale "granted" turns that into notifications that silently
   *  never arrive — the failure mode nobody reports because it looks like
   *  nothing happening. */
  const [notifyPerm, setNotifyPerm] = useState<NotifyPermission>("prompt");
  useEffect(() => {
    let dropped = false;
    void permissionState().then((p) => {
      if (!dropped) setNotifyPerm(p);
    });
    return () => {
      dropped = true;
    };
  }, [frontTick]);

  /** Which event made the ask worth making. Component state, not stored: it
   *  only decides one sentence in the sheet, and a stale reason outliving the
   *  sheet would be a fact about him this app kept for no purpose. */
  const [feltReason, setFeltReason] = useState<FeltReason | null>(null);

  /**
   * "A notification would have helped just now, and we could not send one."
   *
   * This is the ONLY thing that arms the permission ask, which is what makes
   * an ask at onboarding structurally impossible rather than merely avoided:
   * nothing can call it until she has already replied or called. §4 #20.
   *
   * Written once. A second felt moment must not restamp it — the stamp is
   * "this became worth asking about", not "the last time it did", and a moving
   * timestamp is the seed of a re-nag.
   */
  const markFelt = useCallback(
    (reason: FeltReason) => {
      const now = Date.now();
      setState((s) => {
        const p = s.notifyPrefs ?? {};
        if (p.felt || p.declined || p.asked) return s;
        return { ...s, notifyPrefs: { ...p, felt: now } };
      });
      setFeltReason((cur) => cur ?? reason);
    },
    [setState],
  );

  // ── 1. she replied and he was not looking ──────────────────────────────
  //
  // Watched HERE rather than in Chat.tsx for the reason App already paints the
  // thread's back button: Chat belongs to another workstream. It also happens
  // to be the right place — `state.messages` is the same array both lanes
  // append to, so a reply that arrives on the call lane, from a burst, or from
  // a sync pull is seen identically, with no second writer.
  const notifiedUpTo = useRef(0);
  const notifySeeded = useRef(false);
  useEffect(() => {
    let newest = 0;
    for (const m of state.messages) newest = Math.max(newest, m.at ?? 0);
    // MOUNT IS NOT AN ARRIVAL. Without this the first render of a returning
    // user would notify about the whole history, which on a cold start is a
    // lock screen full of a conversation he has already read.
    if (!notifySeeded.current) {
      notifySeeded.current = true;
      notifiedUpTo.current = newest;
      return;
    }
    if (newest <= notifiedUpTo.current) return;
    const since = notifiedUpTo.current;
    notifiedUpTo.current = newest;
    // He is looking at it. The bubble is the notification.
    if (!document.hidden) return;
    const hers = state.messages.filter(
      (m) =>
        (m.at ?? 0) > since &&
        m.from === "her" &&
        // Call turns are SPOKEN words: hidden from the thread by design, and a
        // lock screen is the one place they must not leak to. `watched` turns
        // ride the same flag.
        (!m.channel || m.channel === "chat"),
    );
    if (!hers.length) return;
    void (async () => {
      const r = await postReply(hers, state.notifyPrefs);
      if (r === "posted") tel("notify.posted", { kind: "reply", bubbles: hers.length });
      // "unpermitted" is the felt moment: we had something of hers to say and
      // the OS would not let us. "nothing" (a bare gif, a call record) must
      // never arm the ask — asking for permission to send a notification we
      // would not have sent is asking for nothing.
      if (r === "unpermitted") markFelt("message");
    })();
  }, [state.messages, state.notifyPrefs, markFelt]);

  // ── 2. the call he missed ──────────────────────────────────────────────
  //
  // The cause is `AppState.callback`, which `useCallEngine` arms ONLY when a
  // call dropped mid-sentence. So this inherits an already-reason-contingent
  // event rather than opening a new one, and it can never fire for a call that
  // did not ring.
  //
  // `awayTick` is in the deps on purpose: the ring can be on screen when he
  // switches apps, and the moment he does is the moment it becomes missed.
  useEffect(() => {
    const cb = state.callback;
    if (!cb || inCall) return;
    const fire = () => {
      if (!document.hidden) return;
      void (async () => {
        const r = await postMissedCall(state.notifyPrefs);
        if (r === "posted") tel("notify.posted", { kind: "missed_call" });
        if (r === "unpermitted") markFelt("call");
      })();
    };
    const wait = cb.at - Date.now();
    if (wait <= 0) {
      fire();
      return;
    }
    const t = setTimeout(fire, wait + 50);
    return () => clearTimeout(t);
  }, [state.callback, state.notifyPrefs, inCall, awayTick, markFelt]);

  // ── 3. her story, armed while he is away ───────────────────────────────
  //
  // The one scheduled notification in the product, and `src/notify/index.ts`'s
  // `scheduleStory` carries the full argument for why it is not the hourglass
  // §5(a) forbids, plus the two things that would reverse it. The mechanics
  // that make the argument true are here:
  //
  //   ARMED ON LEAVING, CANCELLED ON RETURNING. It exists only in the window
  //   where a notification is the only way to know. Someone using the app when
  //   her story turns over sees the ring change, and gets nothing on top of it.
  //
  //   THE TIME IS HERS. `nextStoryChange` is a search over storyCatalog's own
  //   slot function — Bangalore's clock, identical for every user, with no
  //   input from him anywhere in it.
  useEffect(() => {
    if (awayTick === 0) return;
    void (async () => {
      const at = nextStoryChange();
      const story = at ? storyAtChange(at) : null;
      const r = await scheduleStory(
        state.notifyPrefs,
        at && story ? { at, desc: story.desc } : null,
      );
      if (r === "scheduled") tel("notify.story_armed", { at });
    })();
  }, [awayTick, state.notifyPrefs]);

  // ── he came back: take everything down ─────────────────────────────────
  //
  // Including the story alarm, which is what keeps it to the away window. The
  // promise this keeps is small and load-bearing: nothing this app posted is
  // still sitting on a lock screen after he has read it in the app. A stale
  // notification is a second, worse copy of a message — one that says she is
  // waiting when she is not.
  useEffect(() => {
    void clearReply();
    void clearMissedCall();
    void cancelStory();
  }, [frontTick]);

  // ── the push slot, which registers nothing until it is configured ──────
  useEffect(() => {
    if (!pushConfigured()) return; // the shipping state; see src/notify/config.ts
    if (notifyPerm !== "granted") return; // push permission IS notification permission
    void (async () => {
      const r = await registerForPush();
      if (r.ok) await submitPushToken(NOTIFY_API_BASE, state.deviceId, r.token);
    })();
  }, [notifyPerm, state.deviceId]);

  // ── the teardown's edge ────────────────────────────────────────────────
  //
  // BOTH doors write `clearedAt` (Chat.tsx's `tearDownLocally` stamps it for
  // clear-chat and for "make her forget you" alike), so watching it advance is
  // one observer for both without this file becoming a second writer for
  // another workstream's state.
  //
  // Why reachability is torn down at all, and why it is not an AppState field:
  // see `clearReachability` in src/notify/index.ts. Short version: a
  // notification still on a lock screen quoting a conversation he has just
  // erased is that conversation surviving its own deletion in the most visible
  // place it could, and a push token that outlives "make her forget you" is her
  // able to contact a stranger.
  const clearedSeen = useRef<number | null>(null);
  useEffect(() => {
    const at = state.clearedAt ?? 0;
    if (clearedSeen.current === null) {
      clearedSeen.current = at;
      return;
    }
    if (at <= clearedSeen.current) return;
    clearedSeen.current = at;
    void clearReachability(NOTIFY_API_BASE, state.deviceId);
  }, [state.clearedAt, state.deviceId]);

  // ── THE DERIVED LEDGER ROWS ────────────────────────────────────────────
  //
  // Two things she should be able to refer to later, written into the ledger
  // `AppState.activities` already carries rather than into a store of their
  // own — which is what makes them free: `formatActivityLedger` (chat, 1,200B)
  // and `formatActivityLedgerForCall` (call, 300B) already read that array on
  // every lane, it already syncs, already merges by union, and is already
  // wiped by "make her forget you". No new field, no new budget, no new
  // reader, and nothing on any lane that claims a block it does not get.
  //
  //  1. A MILESTONE THEY CELEBRATED. `momentsFired` holds ids and ids are not
  //     text; `recentMoment` is the text and it is deliberately local and
  //     12-hour (`moment-available-not-fired`, unchanged here). So "humne 100
  //     din complete kiye the", asked three weeks later, reached a prompt with
  //     no record of the thing at all. One row fixes that, and the row is a
  //     pure function of (id, at) so a reload re-deriving it is a no-op rather
  //     than a re-dated memory.
  //  2. THE DYAD'S OWN NUMBERS. Days, calls, games in the first clause (all
  //     the call lane's 300 bytes will hold beside the newest game); messages,
  //     time on calls and the start date after the ";", which is the chat
  //     lane's fuller business — `callActivityRow`'s existing clause split,
  //     used rather than fought. Every number is a COUNTER, never an estimate.
  //
  // Recomputed when a counted thing moves AND when the app comes to the front:
  // `days` is the one number that changes while nobody is typing, and the
  // front edge is what catches the midnight roll before the first turn of the
  // morning rather than one turn after it.
  const dyadSig = [
    state.messages.length,
    state.tally?.chessGames ?? 0,
    state.tally?.tttGames ?? 0,
    state.tally?.wyrCards ?? 0,
    state.recentMoment?.id ?? "",
  ].join("|");
  useEffect(() => {
    if (!state.onboarded) return;
    const now = Date.now();
    const counts = recordCounts(state.messages, now);
    const rows: ActivityRecord[] = [];
    const dyad = dyadRecord(
      counts,
      state.tally,
      now,
      counts.firstAt ? episodeDateLabel(counts.firstAt) : "",
    );
    if (dyad) rows.push(dyad);
    const rm = state.recentMoment;
    if (rm?.id && rm.at) {
      const rec = momentRecord(rm.id, rm.at, episodeDateLabel(rm.at));
      if (rec) rows.push(rec);
    }
    if (!rows.length) return;
    setState((s) => {
      let next = s.activities;
      for (const rec of rows) {
        const key = `${rec.kind}:${rec.startedAt}`;
        const had = (next ?? []).find((r) => `${r.kind}:${r.startedAt}` === key);
        // BYTE-IDENTICAL IS A NO-OP, and it has to be: this effect runs on
        // every counted change, and a write that changes nothing would still
        // hand every reader a new array — a rerender per keystroke, and a
        // `state.activities` clock that ticks without the record moving.
        if (had && had.summary === rec.summary) continue;
        next = withActivityRecord(next, rec);
      }
      return next === s.activities ? s : { ...s, activities: next };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dyadSig, frontTick, state.onboarded]);

  // Moments detection runs here, at the one place that owns AppState. It is
  // suppressed while a call is coming up (she is mid-pickup) — the hook's
  // own grace handles the first seconds after connect.
  // `suppressed` is plain inCall: the hook stamps the rising edge and holds
  // its own 10s pickup grace. (First wiring said `inCall && !state.onboarded`
  // — always false past onboarding, so the grace never engaged. The
  // celebration agent's review caught it.)
  const [activity, setActivity] = useState<string | null>(null);
  // gameOpen gates WHERE a celebration may exist: game mode only. The chat
  // is her; the game is a game.
  const moments = useMoments(state, setState, inCall, activity !== null);
  const [authOpen, setAuthOpen] = useState(false);

  // ── ONE BACK, TWO BUTTONS ──────────────────────────────────────────────
  //
  // Android's hardware back and the browser's back are the same gesture to
  // the person pressing them, and until now they were two different features
  // — one of them broken and one of them absent.
  //
  // NATIVE, before this: nothing registered a `backButton` listener, so
  // Capacitor ran its own default, which is `window.history.back()` and then
  // `App.exitApp()` when there is nothing left to go back to. Over Us, over
  // her story, over the account sheet and over a board opened from home there
  // was nothing on the stack, so back CLOSED THE APP mid-conversation. Over
  // the games sheet there WAS an entry (the chat's), so back navigated the
  // surface out from under a sheet that stayed open — stranded, floating
  // above home, closable only by its own X.
  //
  // WEB, before this: `popstate` set the surface home and nothing else, so
  // back over any overlay looked like it did nothing at all.
  //
  // `closeTop()` is the single answer to "what does back mean right now", and
  // both backs call it, so the two can no longer disagree. Topmost first,
  // which is z-order and is also the order they were opened in:
  //
  //   a board → the games sheet → her story → Us → the account sheet
  //   → the thread → home → the platform's own back (exit, or leave the page)
  //
  // The settings sheet is deliberately NOT a layer here. It lives inside
  // Chat.tsx, closes on Escape and on its own control, and the thread behind
  // it already owns a history entry — so back over settings lands on the
  // thread, which is where it should land. Reaching across into another
  // workstream's overlay to close it would make this file a second writer for
  // state it does not own, which is the shape `activity-forgot-the-teardown`
  // is filed under.
  //
  // `closeTop` touches NO history. It cannot: the two callers arrive with the
  // stack in opposite conditions — `popstate` has already consumed an entry,
  // the native listener has consumed nothing — so each does its own unwinding
  // afterwards. A shared helper that "handled history" would be right for
  // exactly one of them.
  const closeTop = useCallback((): "overlay" | "chat" | "none" => {
    if (activity !== null) {
      // matches the boards' own `onExit` exactly, `state.game` included: a
      // board that is put away is not a game that was abandoned
      setActivity(null);
      return "overlay";
    }
    if (gamesOpen) {
      setGamesOpen(false);
      return "overlay";
    }
    if (storyOpen) {
      setStoryOpen(false);
      return "overlay";
    }
    if (knowsOpen) {
      setKnowsOpen(false);
      return "overlay";
    }
    if (usOpen) {
      setUsOpen(false);
      return "overlay";
    }
    if (authOpen) {
      setAuthOpen(false);
      return "overlay";
    }
    if (surface === "chat") {
      setSurface("home");
      return "chat";
    }
    return "none";
  }, [activity, gamesOpen, storyOpen, usOpen, knowsOpen, authOpen, surface]);

  // THE OVERLAY SENTINELS. One history entry per open overlay, so the WEB
  // back has something to consume and the two backs stay symmetric — pressing
  // back on a phone browser closes her story rather than leaving the app,
  // exactly as the hardware button now does.
  //
  // The count is synced to the DEPTH rather than pushed by each opener, which
  // is what keeps this to one place instead of six call sites in the JSX
  // (`onStory`, `onUs`, `onProfile`, `onGames`, the sheet, the story's own
  // "sign in" hand-off). Depth up: push the difference. Depth down: unwind it,
  // unless `popstate` already consumed the entry and said so by decrementing
  // `held` itself.
  const overlayDepth =
    (activity !== null ? 1 : 0) +
    (gamesOpen ? 1 : 0) +
    (storyOpen ? 1 : 0) +
    (usOpen ? 1 : 0) +
    (knowsOpen ? 1 : 0) +
    (authOpen ? 1 : 0);
  const held = useRef(0);
  useEffect(() => {
    while (held.current < overlayDepth) {
      pushEntry("overlay");
      held.current += 1;
    }
    while (held.current > overlayDepth) {
      held.current -= 1;
      unwind();
    }
  }, [overlayDepth, pushEntry, unwind]);

  // The web back. It closes the topmost layer instead of jumping straight
  // home, which is the half of this that used to be missing.
  useEffect(() => {
    const onPop = () => {
      if (selfPop.current > 0) {
        selfPop.current -= 1;
        return;
      }
      const what = closeTop();
      // The press consumed one entry. Which one it was decides the
      // bookkeeping: an overlay sentinel comes off `held` (or the effect above
      // would push a replacement for an overlay that is already closing), and
      // the thread's own entry belongs to openChat/goHome, which need nothing.
      if (what === "overlay") held.current = Math.max(0, held.current - 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // `closeTop` changes with every layer, so this re-registers — cheap and
    // honest for a plain DOM listener, where add and remove are synchronous
    // and there is no window in between. The NATIVE listener below cannot do
    // the same thing, and says why.
  }, [closeTop]);

  // The hardware back. ONE listener, registered ONCE, reading `closeTop`
  // through a ref — and the "once" is a correctness requirement rather than a
  // tidiness one. `App.addListener` resolves its handle asynchronously, so
  // re-registering on every layer change opens a real window between
  // `remove()` and the next listener actually being installed. A back press
  // inside that window finds NO listener and gets Capacitor's default, which
  // is the exact bug this block exists to fix — reachable by pressing back at
  // the wrong moment, which is to say reachable.
  const closeTopRef = useRef(closeTop);
  useEffect(() => {
    closeTopRef.current = closeTop;
  }, [closeTop]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: PluginListenerHandle | null = null;
    let dropped = false;
    void CapApp.addListener("backButton", () => {
      const what = closeTopRef.current();
      // An overlay's sentinel is unwound by the depth effect above — the flag
      // it watches has just changed. The thread's entry has no such watcher,
      // so it is consumed here, the same way goHome consumes it.
      if (what === "chat" && history.state?.meera === "chat") unwind();
      // Nothing open, home on screen: back means leave, and on Android that
      // is `exitApp` rather than `history.back()` — a WebView with one entry
      // in it has nothing to go back TO, which is why the default landed on
      // exit over every overlay in the app.
      if (what === "none") void CapApp.exitApp();
    }).then((h) => {
      if (dropped) void h.remove();
      else handle = h;
    });
    return () => {
      dropped = true;
      void handle?.remove();
    };
  }, [unwind]);

  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // last server revision we saw — sent with saves so the server can reject
  // a stale write instead of letting this tab clobber another device
  const serverRev = useRef<string | null>(null);
  // when we last READ the server copy — see the pull effect below. Stamped by
  // every route that loads it, `adoptSession` included, so the boot load and
  // the focus pull cannot fire twice within one min-gap of each other.
  const lastPullAt = useRef(0);
  const pulling = useRef(false);

  // one-time boot: finish a Google redirect, pull the account's server copy
  // if we're already signed in, app_open analytics
  useEffect(() => {
    const oauth = consumeOAuthCallback();
    if (oauth) {
      adoptSession(oauth);
      track(state.deviceId, "signin_success", { method: "google" });
    } else if (state.auth?.accessToken) {
      adoptSession(state.auth as AuthSession); // pull what other devices did
    }
    track(state.deviceId, "app_open", { onboarded: state.onboarded }, state.auth?.userId);
    // the boot listeners have been recording since main.tsx with no identity;
    // this is where the whole held tail gets a device and leaves
    telIdentify(state.deviceId, state.auth?.userId ?? null);
    // open a diagnostic session for the app itself. Without this every
    // chat-scope record (reply timings, memory passes, her interior's
    // decisions) had no device and was thrown away — only calls and watch
    // sessions ever reached /api/diag.
    diagStart("app", state.deviceId, { onboarded: state.onboarded });
    // warm the recognition index so the FIRST turn after app start already
    // has it. cultureNote() kicks this fetch off itself and returns "" while
    // it is in flight, so this only removes a one-turn warm-up — it is
    // fire-and-forget and can never block or fail the boot.
    void primeCulture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The app has no router, so "route" is which surface is actually on screen.
  // A timeline that cannot say she was on a call, or in the auth sheet, when
  // something happened is a timeline that cannot answer "what happened".
  useEffect(() => {
    telRoute(
      !state.onboarded
        ? "/onboarding"
        : authOpen
          ? "/account"
          : // a board is where they were, even with a call underneath it
            activity
            ? `/play/${activity}`
            : inCall
              ? "/call"
              : surface === "home"
                ? "/home"
                : "/chat",
      "tap",
    );
  }, [state.onboarded, inCall, authOpen, activity, surface]);

  // user_id is not the delete key, but a session that spans a sign-in should
  // say so rather than silently changing owner halfway through
  useEffect(() => {
    telIdentify(state.deviceId, state.auth?.userId ?? null);
  }, [state.deviceId, state.auth?.userId]);

  // Session clock (SPEC §9.3): starts once she is actually being used, not
  // during onboarding. startSessionClock is idempotent — the timer itself
  // starts once per app lifetime — but every call still updates which
  // device it reports under, so a sign-out's fresh device id is picked up
  // without restarting the continuous-use stretch.
  useEffect(() => {
    if (state.onboarded) startSessionClock(state.deviceId);
  }, [state.onboarded, state.deviceId]);

  // ── silent auto-update ──
  // A long-lived tab keeps running old code after a deploy (that's how bug
  // fixes "don't arrive"). Poll the served HTML for the current bundle hash;
  // when it changes, reload the moment it can't interrupt anything.
  const inCallRef = useRef(false);
  inCallRef.current = inCall;
  useEffect(() => {
    const current = document.querySelector<HTMLScriptElement>("script[src*='assets/index-']")?.src;
    if (!current) return;
    let pending = false;
    let lastInput = Date.now();
    const noteInput = () => {
      lastInput = Date.now();
    };
    window.addEventListener("pointerdown", noteInput, true);
    window.addEventListener("keydown", noteInput, true);
    const maybeReload = () => {
      if (!pending || inCallRef.current) return;
      // hidden tab → reload now; visible tab → reload once the user has
      // been idle a while (a stale tab kept showing already-fixed bugs)
      if (document.hidden || Date.now() - lastInput > 45_000) {
        // the reload ends this session; the record has to be on the wire
        // before it, or the OTA path is invisible in the timeline
        tel("app.update_applied", { hidden: document.hidden });
        location.reload();
      }
    };
    const idleIv = setInterval(maybeReload, 10_000);
    const check = async () => {
      try {
        const html = await fetch(`${location.pathname}?u=${Date.now()}`, { cache: "no-store" }).then(
          (r) => r.text(),
        );
        const m = html.match(/assets\/index-[^"]+\.js/);
        const fresh = Boolean(m && !current.endsWith(m[0].split("/").pop() as string));
        tel("app.update_check", { found: fresh });
        if (fresh) {
          if (!pending) tel("app.update_downloaded", { build: m![0].split("/").pop() });
          pending = true;
          maybeReload();
        }
      } catch {
        tel("app.update_check", { found: false, err: true });
      }
    };
    const iv = setInterval(check, 15 * 60_000);
    const onVis = () => {
      if (document.hidden) maybeReload();
      else check();
    };
    document.addEventListener("visibilitychange", onVis);
    check();
    return () => {
      clearInterval(iv);
      clearInterval(idleIv);
      window.removeEventListener("pointerdown", noteInput, true);
      window.removeEventListener("keydown", noteInput, true);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── THE TWO SHARED HANDLERS ────────────────────────────────────────────
  //
  // Home, the chat header, the games sheet and the boards all reach the same
  // two acts, and they reach them THROUGH THESE rather than each writing
  // their own version. A second path that starts a call slightly differently
  // (forgetting `unlockAudio` inside the tap gesture, say, which is the one
  // that mutes her on mobile) is the exact shape this repo keeps having to
  // un-write; the fix is that there is only one path.
  const startCall = useCallback(
    (from: string) => {
      unlockAudio(); // inside the tap gesture, or mobile browsers mute her
      track(state.deviceId, "call_started", from ? { from } : {}, state.auth?.userId);
      setCallFrom("him");
      setState((s) => (s.callback ? { ...s, callback: null } : s));
      setInCall(true);
    },
    [state.deviceId, state.auth?.userId, setState],
  );
  const openActivity = useCallback(
    (id: string) => {
      setGamesOpen(false);
      setActivity(id);
      track(state.deviceId, "activity_opened", { kind: id, on_call: inCallRef.current });
    },
    [state.deviceId],
  );

  const authFailed = (e: unknown) => {
    if (!isAuthDead(e)) return false;
    // token revoked/expired — say so via signed-out UI instead of silently
    // pretending the account still syncs
    track(state.deviceId, "auth_expired", {});
    setState((s) => ({ ...s, auth: null }));
    return true;
  };

  // reconcile with the account's server copy: merge, never clobber
  async function adoptSession(session: AuthSession) {
    let fresh: AuthSession;
    try {
      fresh = await ensureFresh(session);
    } catch (e) {
      authFailed(e);
      return;
    }
    // the session is real — persist it BEFORE any remote call can fail,
    // or a flaky load would silently discard a completed sign-in
    setState((s) => ({ ...s, auth: fresh as AuthInfo }));
    try {
      const remote = await loadStateRemote(fresh);
      serverRev.current = remote?.updated_at ?? null;
      // this IS a pull — stamp it, or the focus pull below fires again 700ms
      // into a session that has just read the same row
      lastPullAt.current = Date.now();
      // AN ACCOUNT SWITCH IS A TEARDOWN TOO (evals/teardown.mjs's sibling
      // boundary). Reachability goes with everything else relational, and it
      // goes HERE rather than inside the updater below because that updater
      // must stay pure — React may call one twice, and a second revoke would be
      // a second network call for a token that is already gone. It reads the
      // OUTGOING deviceId deliberately: the branch below rotates it, and the
      // token that has to be revoked belongs to the account that is leaving.
      if (state.lastAccountId && state.lastAccountId !== fresh.userId) {
        void clearReachability(NOTIFY_API_BASE, state.deviceId);
      }
      setState((s) => {
        // account switch on a shared browser: never carry the previous
        // account's (or anonymous) conversation into this account
        if (s.lastAccountId && s.lastAccountId !== fresh.userId) {
          const r = remote?.state;
          return {
            ...s,
            auth: fresh as AuthInfo,
            lastAccountId: fresh.userId,
            onboarded: r?.onboarded ?? false,
            deviceId: r?.deviceId || rotateDeviceId(),
            // the server row crossed the same trust boundary merge.ts guards
            // its own half of: a `user` without `facts` reaches
            // `Object.entries(user.facts)` on the reply path and she never
            // answers again on this device
            user: safeUser(r?.user),
            messages: Array.isArray(r?.messages) ? r.messages : [],
            lastSeen: r?.lastSeen ?? Date.now(),
            clearedAt: r?.clearedAt,
            followup: null,
            // EVERYTHING relational resets on an account switch. The first
            // version reset only the conversation — the new account inherited
            // the previous one's chess game, milestone ledger, tallies and
            // her carried inner life, which is cross-account state bleed of
            // exactly the kind the lastAccountId guard exists to prevent.
            herLife: (r?.herLife as AppState["herLife"]) ?? [],
            // Her present moment, from the row the account being switched TO
            // actually holds — never carried across. It is small and it would
            // bleed loudly: "reading, about twenty minutes in" is a duration
            // she started living in somebody else's relationship. It is also
            // deterministic (engine/herNow.ts), so an absent row costs nothing
            // — the next read rebuilds one from the clock.
            herNow: (r?.herNow as AppState["herNow"]) ?? null,
            inner: r?.inner,
            // SAME GUARD AS merge.ts, and it has to be spelled out here
            // rather than assumed: this branch is the sibling of the sync
            // path, it adopts `r.game` from the same server row, and it was
            // the one that cast it straight in. A malformed session adopted
            // here is a white screen that then SYNCS and survives reload —
            // the game is what may be lost at a boundary, never the app.
            game: isGameSession(r?.game) ? (r.game as AppState["game"]) : null,
            // the ledger of games PLAYED, and it resets for exactly the reason
            // `tally` does: "we played chess on 22 aug, you left it on move 6"
            // in a conversation with an account that has never played anything
            // is the same cross-account bleed, made worse by being specific.
            activities: (r?.activities as AppState["activities"]) ?? [],
            tally: (r?.tally as AppState["tally"]) ?? null,
            momentsFired: (r?.momentsFired as string[]) ?? [],
            // Device-local present-moment state, and it belongs to the
            // relationship that just ended. The audit caught it bringing a
            // 100-day milestone into the first conversation with an account
            // that has no days — and `momentLine` feeds `sharedVocab`, so the
            // honesty layer scored her invented shared history as SUPPORTED.
            recentMoment: null,
            declinedRing: null,
            // WS-SHARENOW's share mirror, and it is the same class one field
            // over: "you were watching their screen together till 3 min ago"
            // said to an account that has never shared a screen is the bleed
            // this branch exists to stop, and it would be the FIRST block in
            // the brief. Device-local like `recentMoment`, so there is no
            // server row to adopt — it simply goes.
            shares: [],
            callback: null,
          };
        }
        return {
          ...s,
          auth: fresh as AuthInfo,
          lastAccountId: fresh.userId,
          ...mergeStates(s, remote?.state),
        };
      });
    } catch (e) {
      if (!authFailed(e)) {
        /* network blip — we're signed in; sync will retry */
      }
    }
  }

  // The callback had no scheduler: the gate is evaluated during render, and
  // nothing re-rendered App at the due time — so the ring landed whenever
  // something unrelated next touched state, usually something HE did, which
  // is the one framing the feature exists to avoid.
  const [, forceRing] = useState(0);
  useEffect(() => {
    if (!state.callback || inCall) return;
    const wait = state.callback.at - Date.now();
    if (wait <= 0) return;
    const t = setTimeout(() => forceRing((n) => n + 1), wait + 50);
    return () => clearTimeout(t);
  }, [state.callback, inCall]);

  const gameSig = [
    state.game?.kind ?? "",
    state.game?.startedAt ?? 0,
    state.game?.closedAt ?? 0,
    state.game?.touchedAt ?? 0,
    state.momentsFired?.length ?? 0,
    state.tally?.chessGames ?? 0,
    state.tally?.tttGames ?? 0,
    state.tally?.wyrCards ?? 0,
  ].join("|");

  // bumped by the 409 branch below, so a merge-and-retry is a real trigger
  // rather than a hope that the merge moved something in the dep list
  const [pushRetry, setPushRetry] = useState(0);

  // continuous sync: push state (debounced 4s) whenever it changes, with
  // conflict detection — a 409 means another device saved first: merge
  // their copy in and let the next debounce push the union
  useEffect(() => {
    if (!state.auth?.accessToken) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      try {
        const fresh = await ensureFresh(state.auth as AuthSession);
        if (fresh.accessToken !== state.auth?.accessToken) {
          setState((s) => ({ ...s, auth: fresh as AuthInfo }));
        }
        const res = await saveStateRemote(fresh, state, serverRev.current);
        if (res?.updated_at) serverRev.current = res.updated_at;
      } catch (e) {
        if (e instanceof AccountError && e.status === 409 && e.data?.state) {
          serverRev.current = e.data.updated_at ?? null;
          setState((s) => ({ ...s, ...mergeStates(s, e.data.state) }));
          // RETRY ON PURPOSE, not as a side effect. This line used to say
          // "merged state re-triggers this effect", and that was true only
          // when the merge happened to move a field in the dep list below.
          // When it did not — the common case, since the other device's copy
          // usually adds nothing we do not have — the message that lost the
          // race sat on this device, unsent, until something unrelated
          // changed. Measured in the two-device browser run
          // (evals/sync-browser.mjs): a message stayed off the account for
          // ~35s after a 409 and arrived only because the person typed again.
          setPushRetry((n) => n + 1);
          return;
        }
        authFailed(e); // otherwise: offline — next change retries
      }
    }, 4000);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // state.inner.at: an appraisal can change nothing else, and without it
    // her interior would never be pushed to the account at all
    // The dep list lagging the syncable fields is the drift merge.ts's own
    // header records killing half the merge once already. `gameSig` projects
    // the untriggering-but-synced fields so a whole chess game played without
    // a single message still pushes, without firing on every keystroke.
  }, [state.messages.length, state.user, state.onboarded, state.auth?.accessToken, state.inner?.at, gameSig, pushRetry]);

  // ── THE OTHER HALF OF SYNC: THE PULL ───────────────────────────────────
  //
  // Everything above pushes. The only READ of the account's copy was
  // `adoptSession`, which runs at boot and at sign-in — so a second device
  // left open (a laptop tab while he texts from his phone) was stale from the
  // moment it loaded, forever, and the only cure was a reload. The 409 path
  // reads the server copy too, but only as a consequence of THIS device
  // writing: a device that is merely open and quiet never writes, so it never
  // learns anything either.
  //
  // Two triggers, both of them events rather than schedules:
  //   FOCUS — the app coming to the front is the moment staleness starts to
  //     cost something, because it is the moment somebody looks at it.
  //     Debounced, because a tab switch fires visibilitychange and focus back
  //     to back, and because the OTA check runs on the same edge.
  //   A GENTLE PERIOD while visible — the open-laptop case: he is looking at
  //     it and never leaves it, so focus never fires again. 90s rather than
  //     the 60s floor because the response is the whole state row: MEASURED
  //     63.5 KB for a 400-message history, 99.8 KB with an 80-ply chess
  //     session in it (`syncableState`, real function, realistic fixture,
  //     2026-08-23). At 90s that is a bounded ~2.5 MB/hour on the worst-case
  //     row and ~0 for the common one; at 10s it would be a data plan.
  //
  // WHAT MAKES THIS SAFE IS `mergeStates`, not this effect. Every rule that
  // protects a local write is already there and is asserted in evals/sync:
  // messages union BY ID (so a message typed here and not yet pushed cannot
  // be erased by a copy that predates it), `clearedAt` takes the MAX and
  // filters both halves (so a stale peer cannot resurrect a cleared chat),
  // ledgers union, tallies take the max, and the message cap is a FLOOR over
  // the local half rather than a scythe. This effect adds no merge semantics
  // of its own — that is the point of it having none.
  //
  // Not while a call is up: the live lane's assembly is frozen at connect and
  // a merge under it buys nothing, while a `messages` rewrite mid-call is a
  // rerender of the one surface that must not stutter. `inCall` is a dep, so
  // hanging up pulls immediately — which is also when the OTHER device has
  // just been given a callmark to tell us about.
  useEffect(() => {
    const token = state.auth?.accessToken;
    if (!token || inCall) return;
    let cancelled = false;
    const pull = async (why: string) => {
      if (pulling.current || cancelled) return;
      if (document.visibilityState !== "visible") return; // a hidden tab reads nothing
      if (Date.now() - lastPullAt.current < PULL_MIN_GAP_MS) return;
      pulling.current = true;
      try {
        const fresh = await ensureFresh(state.auth as AuthSession);
        if (fresh.accessToken !== token) setState((s) => ({ ...s, auth: fresh as AuthInfo }));
        const remote = await loadStateRemote(fresh);
        lastPullAt.current = Date.now();
        if (cancelled || !remote?.state) return;
        // the revision we just READ becomes the base of the next write, or
        // the very next push 409s against the copy it has already merged
        serverRev.current = remote?.updated_at ?? serverRev.current;
        setState((s) => ({ ...s, ...mergeStates(s, remote.state) }));
        tel("sync.pull", { why });
      } catch (e) {
        // offline is the normal case here and must stay silent; a dead token
        // is not, and `authFailed` is the one place that decides which
        authFailed(e);
      } finally {
        pulling.current = false;
      }
    };
    const t = setTimeout(() => void pull("focus"), PULL_DEBOUNCE_MS);
    const iv = setInterval(() => void pull("period"), PULL_PERIOD_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.auth?.accessToken, inCall, frontTick]);

  // The realtime call's ephemeral token is fetched while they are in chat, so
  // tapping call spends a token that already exists instead of waiting on a
  // round trip — on a weak mobile link that round trip was the difference
  // between her realtime voice picking up and the slower fallback taking the
  // call. Re-armed on return to the app so it is never stale when they call.
  useEffect(() => {
    if (!state.onboarded || inCall) return;
    const base = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";
    const warm = () => {
      if (document.visibilityState === "visible") prewarmLiveToken(base);
    };
    warm();
    document.addEventListener("visibilitychange", warm);
    return () => document.removeEventListener("visibilitychange", warm);
  }, [state.onboarded, inCall]);

  return (
    <div className="app grain">
      <div className="ambient" />
      {!state.onboarded ? (
        <Onboarding
          deviceId={state.deviceId}
          onDone={(user) => {
            track(state.deviceId, "onboarded", { vibe: user.vibe });
            // "SKY" IS THE DEFAULT FOR NEW INSTALLS, and it is stamped HERE
            // rather than by changing what `undefined` means. See the long
            // note in engine/theme.ts: `undefined` is what every existing
            // install carries, so redefining it would move people who never
            // chose anything off the OS setting they had implicitly accepted,
            // at a time of day, on a build where they changed nothing. That
            // is indistinguishable from a bug. `?? "sky"` also means a person
            // who somehow already has a choice keeps it.
            setState((s) => ({ ...s, onboarded: true, user, theme: s.theme ?? "sky" }));
          }}
        />
      ) : (
        <>
          <ClockCard />
          {/* ── THE THREAD ────────────────────────────────────────────────
              ALWAYS MOUNTED, exactly like it is under a board or a call, and
              for the same reason: it holds an in-flight reply cycle, a burst
              timer, a scroll position and a typing indicator. Going home is a
              surface change, never an unmount — unmounting it would silently
              cancel a reply that was already on its way back from her.

              `inert` while home is up, so the thread is neither tabbable nor
              readable by a screen reader while it is behind the world. */}
          <div
            className="chat-wrap"
            data-surface={surface}
            inert={surface !== "chat" ? true : undefined}
          >
            <Chat
              state={state}
              setState={setState}
              inCall={inCall}
            activityOpen={activity !== null}
            openSettingsSignal={settingsSignal}
            composePrefill={composePrefill}
              onVoiceCall={() => startCall("")}
              onProfile={() => setAuthOpen(true)}
              onGames={() => setGamesOpen(true)}
              // THE INVITE CHIP'S ROUTE. The chat header's games button opens
              // the SHEET (a list of things to do); a chip that already knows
              // which game the two of them agreed on must open that game, or
              // it is the menu with an extra step. Same `openActivity` the
              // hub's own rows and home's cards take, so there is one door
              // and not three.
              onOpenActivity={openActivity}
              onUs={() => setUsOpen(true)}
            />
            {/* the way out of the thread. App paints it because Chat.tsx is
                another workstream's file; the CSS in home.css opens the
                header's left gutter for it so nothing in the thread moves. */}
            <button
              className="home-back"
              data-tel="chat.home"
              onClick={goHome}
              aria-label="Back to home"
            >
              <span className="hb-chev" aria-hidden="true">
                <ChevronIcon size={19} />
              </span>
            </button>
          </div>

          {/* ── HOME ─────────────────────────────────────────────────────
              The landing surface, over the thread. Hidden rather than
              unmounted so its scroll position, its sky timers and its card
              entrance survive a trip into the chat and back. */}
          <div
            className="home-host"
            // "on" only when home is genuinely VISIBLE: starting a call or a
            // board from home leaves surface==="home", and the audit measured
            // two painted worlds + four cloud plates animating behind an
            // opaque call surface — on the most battery-sensitive screen in
            // the product. Covered means off.
            data-on={
              surface === "home" && !inCall && activity === null && !storyOpen && !usOpen && !knowsOpen && !gamesOpen && !authOpen
                ? ""
                : undefined
            }
          >
            <HomeScreen
              state={state}
              onOpenChat={openChat}
              onCall={() => startCall("home")}
              onGames={openActivity}
              onStory={() => setStoryOpen(true)}
              onUs={() => setUsOpen(true)}
              onProfile={() => setAuthOpen(true)}
              onSettings={() => {
                // Settings lives in Chat (its destructive flows need the
                // thread's teardown), so home routes THROUGH the thread with
                // the sheet opening on arrival — one tap, no forked sheet
                openChat();
                setSettingsSignal((n) => n + 1);
              }}
            />
          </div>
          {inCall && (
            <CallVoice
              state={state}
              setState={setState}
              onEnd={() => setInCall(false)}
              sheCalled={callFrom === "her"}
            />
          )}
          {/* ── things to do together ───────────────────────────────────────
              Rendered AFTER CallVoice and as its sibling. That ordering is the
              continuity requirement in one line: Chat stays mounted with its
              history and its reply cycle, CallVoice stays mounted with the live
              socket and the move poke, and the board sits above both. Leaving
              the board unmounts one overlay and nothing else. */}
          {gamesOpen && (
            <>
              <div className="sheet-veil" onClick={() => setGamesOpen(false)} />
              <div
                className="sheet"
                role="dialog"
                aria-modal="true"
                aria-label="Things to do together"
                ref={gamesSheet}
              >
                <div className="grab" />
                <button
                  className="sheet-x"
                  onClick={() => setGamesOpen(false)}
                  aria-label="Close"
                >
                  <CloseIcon />
                </button>
                <GamesHub
                  her={{ onCall: inCall }}
                  heading="Things to do together"
                  activities={DEFAULT_ACTIVITIES.map(
                    (a): Activity =>
                      // `.over` too: a finished-but-not-yet-reconciled game
                      // (the 3s afterglow window) must not offer "resume ·
                      // your move" — there is no move to make.
                      a.id === "chess" && state.game?.kind === "chess" && !state.game.closedAt && !state.game.game.status.over
                        ? {
                            ...a,
                            state: "resume",
                            detail:
                              state.game.game.status.turn === state.game.herSide
                                ? "her move"
                                : "your move",
                          }
                        : a.id === "tic-tac-toe" &&
                            state.game?.kind === "ttt" &&
                            !state.game.closedAt &&
                            !state.game.game.status.over
                          ? {
                              ...a,
                              state: "resume",
                              detail:
                                state.game.game.status.turn === state.game.herSide
                                  ? "her move"
                                  : "your move",
                            }
                        : a.id === "would-you-rather" &&
                            state.game?.kind === "wyr" &&
                            !state.game.closedAt
                          ? { ...a, state: "resume", detail: "mid-round" }
                          : a,
                  )}
                  onOpen={openActivity}
                />
              </div>
            </>
          )}
          {/* ── the net under the boards, and only under the boards ──────────
              A malformed session used to throw during the board's RENDER,
              which unmounts the whole React tree — chat, call and all — and,
              since the session is persisted, does it again on every reload.
              `isGameSession` is the fix; this is what catches the shape nobody
              predicted. Scoped to the overlay on purpose: a boundary at the
              root would replace HER with an apology, and the one action it
              offers changes the state (the game is nulled) so the retry cannot
              land on the same crash. `key` per activity so a caught failure
              can never outlive the board it belonged to. */}
          <ErrorBoundary
            key={activity ?? "none"}
            where="activity"
            onPutAway={() => {
              setState((s) => (s.game ? { ...s, game: null } : s));
              setActivity(null);
            }}
          >
            {activity === "would-you-rather" && (
              <WouldYouRatherActivity
                state={state}
                setState={setState}
                onExit={() => setActivity(null)}
                onOpenCall={() => setActivity(null)}
                onStartCall={() => startCall("activity")}
                // her picks are seeded per RELATIONSHIP: same person, same
                // answers, forever — an account keeps them across devices
                salt={state.auth?.userId ?? state.deviceId}
              />
            )}
            {activity === "tic-tac-toe" && (
              <TicTacToeActivity
                state={state}
                setState={setState}
                onExit={() => setActivity(null)}
                onOpenCall={() => setActivity(null)}
                onStartCall={() => startCall("activity")}
              />
            )}
            {activity === "chess" && (
              <ChessActivity
                state={state}
                setState={setState}
                onExit={() => setActivity(null)}
                // Back to the call SCREEN. It never ends the call — the call is
                // running underneath this whole time.
                onOpenCall={() => setActivity(null)}
                // Calling from the board keeps the board. She starts talking and
                // the game does not move — which is the entire feature.
                onStartCall={() => startCall("activity")}
              />
            )}
          </ErrorBoundary>
          {usOpen && <UsScreen state={state} onExit={() => setUsOpen(false)} />}
          {knowsOpen && (
            <KnowsScreen
              state={state}
              onExit={() => setKnowsOpen(false)}
              onCorrect={(text) => {
                setKnowsOpen(false);
                openChat();
                setComposePrefill((cur) => ({ text, n: cur.n + 1 }));
              }}
            />
          )}
          {/* ── HER STORY, from the world ─────────────────────────────────
              The story card on home opens the SAME viewer the chat header's
              ring opens, mounted here as an overlay sibling like every other
              full-screen surface in this file.

              It is deliberately mounted WITHOUT `onReply`: replying to a
              story schedules a reply cycle, and that cycle lives inside
              Chat.tsx (`sendStoryReply` → `scheduleReply`), which this
              workstream does not own. StoryView already treats `onReply` as
              optional and simply omits the reply box, so the honest result is
              a viewer that watches — and the reply box is still there on the
              route that can actually deliver it, from the chat's own ring.
              A second, forked reply path that appended a message nothing
              would ever answer would be worse than not offering one. */}
          {storyOpen && (
            <StoryView
              stories={activeStories()}
              signedIn={Boolean(state.auth)}
              onSignIn={() => {
                setStoryOpen(false);
                setAuthOpen(true);
              }}
              onClose={() => setStoryOpen(false)}
              onProfile={() => {
                setStoryOpen(false);
                setAuthOpen(true);
              }}
            />
          )}
          {/* She is calling back after a call that dropped mid-sentence. Never
              while a call is already up, and never before its own due time —
              the arming happens in useCallEngine, on the drop itself. */}
          {!inCall &&
            state.callback &&
            Date.now() >= state.callback.at &&
            // TTL: a callback that is no longer plausible is not a callback —
            // without this, closing the app in the 25s window meant she rang
            // "about Tuesday's drop" three days later, the moment App next
            // re-rendered for any reason at all.
            Date.now() - state.callback.at < 10 * 60_000 && (
            <IncomingCall
              secs={state.callback.secs}
              reason={state.callback.secs > 0 ? "callback" : "wants"}
              onAccept={() => {
                unlockAudio(); // inside the gesture, or mobile mutes her
                setState((s) => ({ ...s, callback: null }));
                track(state.deviceId, "call_started", { incoming: true }, state.auth?.userId);
                setCallFrom("her"); // SHE is the caller here, and she knows it
                // the ring painted over Us / the games sheet (z-60), but the
                // CALL mounts at z-20 — accepting under an open overlay left
                // her talking with no call visible anywhere on screen
                setUsOpen(false);
                setGamesOpen(false);
                setInCall(true);
              }}
              onDecline={() => {
                // Cleared, not rescheduled. A declined call that comes back is
                // a product nobody wants, and "she called, he said no" is a
                // complete answer.
                setState((s) => ({ ...s, callback: null, declinedRing: Date.now() }));
                track(state.deviceId, "call_declined", { incoming: true }, state.auth?.userId);
              }}
            />
          )}
          {authOpen && (
            <AuthSheet
              state={state}
              onClose={() => setAuthOpen(false)}
              onAuthed={(session) => {
                setAuthOpen(false);
                adoptSession(session);
              }}
              onSignOut={() => {
                track(state.deviceId, "signout", {}, state.auth?.userId);
                serverRev.current = null;
                // Signing out mints a fresh device identity two lines below,
                // which would orphan this device's push registration under the
                // OLD id — a live token nothing can ever revoke again. Revoked
                // here, while the id that owns it is still the current one.
                void clearReachability(NOTIFY_API_BASE, state.deviceId);
                // privacy on shared browsers: signing out wipes the local
                // conversation and mints a fresh device identity — signing
                // back in restores everything from the account's server copy
                setState((s) => ({
                  ...s,
                  auth: null,
                  onboarded: false,
                  messages: [],
                  followup: null,
                  user: { name: "", vibe: [], facts: {} },
                  deviceId: rotateDeviceId(),
                  lastAccountId: undefined,
                  clearedAt: undefined,
                }));
                setAuthOpen(false);
              }}
            />
          )}
          {/* ── WS-NOTIFY: the one ask ──────────────────────────────────────
              A NON-MODAL card, and that is a constraint rather than a style.
              App's back machinery (closeTop, the overlay sentinels, unwind) is
              another workstream's and is not edited by this one — and a modal
              layer the back handler does not know about is a layer the hardware
              back closes the APP over, which is the exact defect that machinery
              was written to fix. With no veil and no aria-modal there is
              nothing to trap and nothing for back to mean: it covers nothing,
              home behaves exactly as it did, and the card is still there next
              time if he ignores it.

              Home only, and only with nothing else open. Home is the surface
              that is about her (her ring, her presence, her sky), which is the
              right room to be asked whether you want to hear from her, and it
              is the one surface with no composer for a bottom card to cover.

              `shouldExplain` is the whole rule and it is pure — it is false
              until a FELT moment has happened, and false forever after either
              answer. See src/notify/index.ts. */}
          {state.onboarded &&
            surface === "home" &&
            !inCall &&
            activity === null &&
            !storyOpen &&
            !usOpen &&
            !gamesOpen &&
            !authOpen &&
            shouldExplain(state.notifyPrefs, notifyPerm, notifyAvailable()) && (
              <NotifySheet
                reason={feltReason ?? "message"}
                onAllow={() => {
                  // Stamped BEFORE the dialog, not after: Android 13+ gives one
                  // runtime prompt and this is it being spent. If the process
                  // dies while the system dialog is up, the ask has still
                  // happened, and a record that only exists on the happy path
                  // is how a "never again" becomes "usually not".
                  const now = Date.now();
                  setState((s) => ({
                    ...s,
                    notifyPrefs: { ...(s.notifyPrefs ?? {}), asked: now },
                  }));
                  tel("notify.ask", { reason: feltReason ?? "message" });
                  void (async () => {
                    const p = await requestPermission();
                    setNotifyPerm(p);
                    const at = Date.now();
                    setState((s) => ({
                      ...s,
                      notifyPrefs: {
                        ...(s.notifyPrefs ?? {}),
                        ...(p === "granted" ? { granted: at } : { declined: at }),
                      },
                    }));
                    tel("notify.answered", { granted: p === "granted" });
                  })();
                }}
                onDecline={() => {
                  // Terminal, and the card's own copy says so. `shouldExplain`
                  // never returns true again once this is set, on any device
                  // this state reaches — which is why the switch in More has to
                  // exist: a refusal we honour forever needs a door he can open
                  // himself, or "no" quietly means "never".
                  const now = Date.now();
                  setState((s) => ({
                    ...s,
                    notifyPrefs: { ...(s.notifyPrefs ?? {}), declined: now },
                  }));
                  tel("notify.declined", { reason: feltReason ?? "message" });
                }}
              />
            )}
          {/* A crossed milestone celebrates OVER whatever is on screen — an
              overlay sibling, never an unmount, LAST in DOM so it paints over
              same-z sheets. One at a time; fire-once is the engine's promise;
              the hook marks the ledger on show. */}
          {activity !== null && (
            <Celebration moment={moments.moment} onDone={moments.dismiss} />
          )}
        </>
      )}
    </div>
  );
}
