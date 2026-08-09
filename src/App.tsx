import { useState } from "react";
import { useAppState } from "./state/store";
import Onboarding from "./components/Onboarding";
import Chat from "./components/Chat";
import CallVoice from "./components/CallVoice";

export default function App() {
  const [state, setState] = useAppState();
  const [inCall, setInCall] = useState(false);

  return (
    <div className="app grain">
      <div className="ambient" />
      {!state.onboarded ? (
        <Onboarding
          onDone={(user) =>
            setState((s) => ({ ...s, onboarded: true, user }))
          }
        />
      ) : (
        <>
          <Chat state={state} setState={setState} onVoiceCall={() => setInCall(true)} />
          {inCall && (
            <CallVoice state={state} setState={setState} onEnd={() => setInCall(false)} />
          )}
        </>
      )}
    </div>
  );
}
