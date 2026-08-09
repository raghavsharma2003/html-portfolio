import { useEffect, useRef, useState } from "react";
import { useAppState } from "./state/store";
import type { AuthInfo } from "./state/store";
import Onboarding from "./components/Onboarding";
import Chat from "./components/Chat";
import CallVoice from "./components/CallVoice";
import AuthSheet from "./components/AuthSheet";
import { unlockAudio } from "./voice/speech";
import {
  consumeOAuthCallback,
  ensureFresh,
  loadStateRemote,
  saveStateRemote,
  track,
  type AuthSession,
} from "./engine/account";

export default function App() {
  const [state, setState] = useAppState();
  const [inCall, setInCall] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adopted = useRef(false);

  // one-time boot: finish a Google redirect + app_open analytics
  useEffect(() => {
    const oauth = consumeOAuthCallback();
    if (oauth) {
      adoptSession(oauth);
      track(state.deviceId, "signin_success", { method: "google" });
    }
    track(state.deviceId, "app_open", { onboarded: state.onboarded }, state.auth?.userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when signed in: reconcile once (server copy wins if it has more life in
  // it), then keep the account fresh
  async function adoptSession(session: AuthSession) {
    try {
      const fresh = await ensureFresh(session);
      const remote = await loadStateRemote(fresh);
      setState((s) => {
        const merged = { ...s, auth: fresh as AuthInfo };
        const r = remote?.state;
        if (
          !adopted.current &&
          r &&
          Array.isArray(r.messages) &&
          r.messages.length > s.messages.length
        ) {
          adopted.current = true;
          return {
            ...merged,
            onboarded: r.onboarded ?? merged.onboarded,
            deviceId: r.deviceId || merged.deviceId, // keep her memory graph
            user: r.user ?? merged.user,
            messages: r.messages,
            lastSeen: r.lastSeen ?? merged.lastSeen,
          };
        }
        return merged;
      });
    } catch {
      /* stale refresh token — leave anonymous */
    }
  }

  // continuous sync: push state (debounced 4s) whenever it changes
  useEffect(() => {
    if (!state.auth?.accessToken) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      try {
        const fresh = await ensureFresh(state.auth as AuthSession);
        if (fresh.accessToken !== state.auth?.accessToken) {
          setState((s) => ({ ...s, auth: fresh as AuthInfo }));
        }
        await saveStateRemote(fresh, state);
      } catch {
        /* offline — next change retries */
      }
    }, 4000);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.messages.length, state.user, state.onboarded, state.auth?.accessToken]);

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
                adopted.current = false;
                setState((s) => ({ ...s, auth: null }));
                setAuthOpen(false);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
