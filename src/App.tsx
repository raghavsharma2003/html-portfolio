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
import { CloseIcon, ChevronIcon } from "./components/icons";
import { applyTheme, watchSystemTheme, watchSky } from "./engine/theme";
import { configureSky, parseSkySeed } from "./engine/sky";
import { mergeStates, safeUser } from "./state/merge";
import { OPEN_STALE_MS, activityOf, isGameSession } from "./state/game";
import ErrorBoundary from "./components/ErrorBoundary";
import { LABEL } from "./engine/activity";
import { logFinishedActivity, publishActivityLedger, withActivityRecord } from "./engine/memory";
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
              // wording as the End-game button, never a fabricated winner
              ...(curStale && !curOver && cur.kind === "chess" ? { endedEarly: true as const } : {}),
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
  }, [activity, gamesOpen, storyOpen, usOpen, authOpen, surface]);

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
          return; // merged state re-triggers this effect → retry push
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
  }, [state.messages.length, state.user, state.onboarded, state.auth?.accessToken, state.inner?.at, gameSig]);

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
              surface === "home" && !inCall && activity === null && !storyOpen && !usOpen && !gamesOpen && !authOpen
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
                setState((s) => ({ ...s, callback: null }));
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
