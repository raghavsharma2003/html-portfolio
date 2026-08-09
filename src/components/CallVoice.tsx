// Voice call — avatar in a slow-spinning gradient ring, live waveform,
// STT with graceful typed fallback. Deliberately no captions: a call is a
// call — you listen to her, you don't read her.

import { useEffect, useState } from "react";
import type { AppState } from "../state/store";
import { HER_NAME } from "../engine/persona";
import PhotoAvatar from "./PhotoAvatar";
import { useCallEngine } from "./useCallEngine";
import { EndCallIcon, MicIcon, KeyboardIcon } from "./icons";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onEnd: () => void;
}

export default function CallVoice({ state, setState, onEnd }: Props) {
  const eng = useCallEngine(state, setState);
  const [typed, setTyped] = useState("");
  const [showKb, setShowKb] = useState(false);
  const [bars, setBars] = useState<number[]>(Array(24).fill(8));

  useEffect(() => {
    const iv = setInterval(() => {
      setBars((b) =>
        b.map(() =>
          eng.speaking
            ? 6 + Math.random() * 30
            : eng.listening
              ? 5 + Math.random() * 14
              : 5 + Math.random() * 4,
        ),
      );
    }, 120);
    return () => clearInterval(iv);
  }, [eng.speaking, eng.listening]);

  const stateLabel =
    eng.phase === "connecting"
      ? "connecting…"
      : eng.muted
        ? "mic off · " + eng.mmss
        : eng.speaking
          ? "speaking"
          : eng.listening
            ? "listening…"
            : eng.mmss;

  return (
    <div className="call">
      <div className="call-top">
        <div className="cname">{HER_NAME}</div>
        <div className="cstate">{stateLabel}</div>
      </div>

      <div className="call-stage">
        <div style={{ position: "relative" }}>
          <div className={`speak-glow ${eng.speaking ? "on" : ""}`} />
          <div className="avatar-ring" style={{ width: 244, height: 244 }}>
            <div className="inner">
              <PhotoAvatar size={228} speaking={eng.speaking} listening={eng.listening} />
            </div>
          </div>
        </div>

        <div className="wave">
          {bars.map((h, i) => (
            <i key={i} style={{ height: h }} />
          ))}
        </div>

        {(!eng.sttSupported || showKb) && eng.phase === "live" && (
          <div className="call-input-row" style={{ position: "static", marginTop: 10, width: "88%" }}>
            <div className="chat-input" style={{ flex: 1 }}>
              <textarea
                rows={1}
                placeholder="Say something…"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (typed.trim()) {
                      eng.handleUser(typed.trim());
                      setTyped("");
                    }
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="call-controls">
        <button className="cbtn" onClick={() => setShowKb((v) => !v)} aria-label="Type instead">
          <KeyboardIcon />
        </button>
        <button className="cbtn danger" style={{ width: 74, height: 74 }} onClick={() => eng.endCall(onEnd)} aria-label="End call">
          <EndCallIcon size={30} />
        </button>
        <button
          className={`cbtn ${eng.listening ? "active-mic" : ""}`}
          onClick={() => eng.toggleMute()}
          aria-label={eng.muted ? "Unmute microphone" : "Mute microphone"}
        >
          <MicIcon off={eng.muted || !eng.sttSupported} />
        </button>
      </div>
    </div>
  );
}
