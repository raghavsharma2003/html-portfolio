import { useState } from "react";
import { useAppState } from "./state/store";
import Onboarding from "./components/Onboarding";
import Chat from "./components/Chat";
import CallVoice from "./components/CallVoice";
import CallVideo from "./components/CallVideo";
import Settings from "./components/Settings";

type Screen = "chat" | "voice" | "video";

export default function App() {
  const [state, setState] = useAppState();
  const [screen, setScreen] = useState<Screen>("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);

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
          <Chat
            state={state}
            setState={setState}
            onVoiceCall={() => setScreen("voice")}
            onVideoCall={() => setScreen("video")}
            onSettings={() => setSettingsOpen(true)}
          />
          {screen === "voice" && (
            <CallVoice state={state} setState={setState} onEnd={() => setScreen("chat")} />
          )}
          {screen === "video" && (
            <CallVideo state={state} setState={setState} onEnd={() => setScreen("chat")} />
          )}
          {settingsOpen && (
            <Settings state={state} setState={setState} onClose={() => setSettingsOpen(false)} />
          )}
        </>
      )}
    </div>
  );
}
