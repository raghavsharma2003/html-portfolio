import { useEffect, useRef, useState } from "react";
import { useAppState, rotateDeviceId, type Message } from "./state/store";
import type { AuthInfo, AppState } from "./state/store";
import Onboarding from "./components/Onboarding";
import Chat from "./components/Chat";
import CallVoice from "./components/CallVoice";
import AuthSheet from "./components/AuthSheet";
import { unlockAudio } from "./voice/speech";
import { diagStart } from "./engine/diag";
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
function mergeStates(local: AppState, remote: any): Partial<AppState> {
  const clearedAt = Math.max(local.clearedAt ?? 0, Number(remote?.clearedAt) || 0);
  const byId = new Map<string, Message>();
  for (const m of Array.isArray(remote?.messages) ? remote.messages : [])
    if (m && m.id && (m.at ?? 0) >= clearedAt) byId.set(m.id, m);
  for (const m of local.messages) if ((m.at ?? 0) >= clearedAt) byId.set(m.id, m);
  const messages = [...byId.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-500);
  return {
    onboarded: remote?.onboarded || local.onboarded,
    deviceId: remote?.deviceId || local.deviceId, // keep her memory graph
    user: local.messages.length >= (remote?.messages?.length ?? 0) ? local.user : remote?.user ?? local.user,
    messages,
    lastSeen: Math.max(local.lastSeen ?? 0, Number(remote?.lastSeen) || 0),
    clearedAt: clearedAt || undefined,
    // her side of the relationship syncs too. Without these two lines a 409
    // silently discarded whatever the other device learned about her own life
    // — she'd have one flatmate on the phone and another on the laptop.
    // The interior merges WHOLESALE by revision, never field-by-field: a
    // feeling and its watermark must never come from different revisions.
    herLife: remote?.herLife?.length && !local.herLife?.length ? remote.herLife : local.herLife,
    inner: (Number(remote?.inner?.at) || 0) > (local.inner?.at ?? 0) ? remote.inner : local.inner,
  };
}

export default function App() {
  const [state, setState] = useAppState();
  const [inCall, setInCall] = useState(false);
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
      !state.onboarded ? "/onboarding" : authOpen ? "/account" : inCall ? "/call" : "/chat",
      "tap",
    );
  }, [state.onboarded, inCall, authOpen]);

  // user_id is not the delete key, but a session that spans a sign-in should
  // say so rather than silently changing owner halfway through
  useEffect(() => {
    telIdentify(state.deviceId, state.auth?.userId ?? null);
  }, [state.deviceId, state.auth?.userId]);

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
  }, [state.messages.length, state.user, state.onboarded, state.auth?.accessToken, state.inner?.at]);

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
          onDone={(user) => {
            track(state.deviceId, "onboarded", { vibe: user.vibe });
            setState((s) => ({ ...s, onboarded: true, user }));
          }}
        />
      ) : (
        <>
          <Chat
            state={state}
            setState={setState}
            inCall={inCall}
            onVoiceCall={() => {
              // unlock inside the tap gesture, or mobile browsers mute her
              unlockAudio();
              track(state.deviceId, "call_started", {}, state.auth?.userId);
              setInCall(true);
            }}
            onProfile={() => setAuthOpen(true)}
          />
          {inCall && (
            <CallVoice state={state} setState={setState} onEnd={() => setInCall(false)} />
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
        </>
      )}
    </div>
  );
}
