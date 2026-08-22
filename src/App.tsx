import { useEffect, useRef, useState } from "react";
import { useAppState, rotateDeviceId } from "./state/store";
import type { AuthInfo, AppState } from "./state/store";
import Onboarding from "./components/Onboarding";
import Chat from "./components/Chat";
import CallVoice from "./components/CallVoice";
import IncomingCall from "./components/IncomingCall";
import AuthSheet from "./components/AuthSheet";
import ClockCard from "./components/ClockCard";
import GamesHub, { DEFAULT_ACTIVITIES, type Activity } from "./components/GamesHub";
import ChessActivity from "./components/ChessActivity";
import WouldYouRatherActivity from "./components/WouldYouRatherActivity";
import TicTacToeActivity from "./components/TicTacToeActivity";
import { CloseIcon } from "./components/icons";
import { applyTheme, watchSystemTheme } from "./engine/theme";
import { mergeStates } from "./state/merge";
import { OPEN_STALE_MS } from "./state/game";
import { useMoments } from "./components/useMoments";
import Celebration from "./components/Celebration";
import UsScreen from "./components/UsScreen";
import { unlockAudio } from "./voice/speech";
import { diagStart } from "./engine/diag";
import { startSessionClock } from "./engine/clock";
import { tel, telIdentify, telRoute } from "./engine/telemetry";
import { prewarmLiveToken } from "./voice/liveCall";
import { primeCulture } from "./engine/culture";
import { Capacitor } from "@capacitor/core";
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
    return watchSystemTheme(state.theme, () => applyTheme(state.theme));
  }, [state.theme]);

  // Who dialled the call that is up. "her" only on the callback accept path —
  // she has to KNOW she called, or she answers her own call like a stranger.
  const [callFrom, setCallFrom] = useState<"him" | "her">("him");
  const [gamesOpen, setGamesOpen] = useState(false);
  const [usOpen, setUsOpen] = useState(false);

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
              : "/chat",
      "tap",
    );
  }, [state.onboarded, inCall, authOpen, activity]);

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
            user: r?.user ?? { name: "", vibe: [], facts: {} },
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
            game: (r?.game as AppState["game"]) ?? null,
            tally: (r?.tally as AppState["tally"]) ?? null,
            momentsFired: (r?.momentsFired as string[]) ?? [],
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
            setState((s) => ({ ...s, onboarded: true, user }));
          }}
        />
      ) : (
        <>
          <ClockCard />
          <Chat
            state={state}
            setState={setState}
            inCall={inCall}
            onVoiceCall={() => {
              // unlock inside the tap gesture, or mobile browsers mute her
              unlockAudio();
              track(state.deviceId, "call_started", {}, state.auth?.userId);
              setCallFrom("him");
              setState((s) => (s.callback ? { ...s, callback: null } : s));
              setInCall(true);
            }}
            onProfile={() => setAuthOpen(true)}
            onGames={() => setGamesOpen(true)}
            onUs={() => setUsOpen(true)}
          />
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
                  onOpen={(id) => {
                    setGamesOpen(false);
                    setActivity(id);
                    track(state.deviceId, "activity_opened", { kind: id, on_call: inCall });
                  }}
                />
              </div>
            </>
          )}
          {activity === "would-you-rather" && (
            <WouldYouRatherActivity
              state={state}
              setState={setState}
              onExit={() => setActivity(null)}
              onOpenCall={() => setActivity(null)}
              onStartCall={() => {
                unlockAudio(); // inside the tap gesture, or mobile mutes her
                track(state.deviceId, "call_started", { from: "activity" }, state.auth?.userId);
                setCallFrom("him");
                setState((s) => (s.callback ? { ...s, callback: null } : s));
                setInCall(true);
              }}
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
              onStartCall={() => {
                unlockAudio(); // inside the tap gesture, or mobile mutes her
                track(state.deviceId, "call_started", { from: "activity" }, state.auth?.userId);
                setCallFrom("him");
                setState((s) => (s.callback ? { ...s, callback: null } : s));
                setInCall(true);
              }}
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
              onStartCall={() => {
                unlockAudio(); // inside the tap gesture, or mobile mutes her
                track(state.deviceId, "call_started", { from: "activity" }, state.auth?.userId);
                setCallFrom("him");
                setState((s) => (s.callback ? { ...s, callback: null } : s));
                setInCall(true);
              }}
            />
          )}
          {usOpen && <UsScreen state={state} onExit={() => setUsOpen(false)} />}
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
