// Video call — full-screen living avatar scene with the user's camera in a
// picture-in-picture card, WhatsApp/FaceTime-style controls.

import { useEffect, useRef, useState } from "react";
import type { AppState } from "../state/store";
import { HER_NAME } from "../engine/persona";
import Avatar from "./Avatar";
import { useCallEngine } from "./useCallEngine";
import { EndCallIcon, MicIcon, KeyboardIcon } from "./icons";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onEnd: () => void;
}

export default function CallVideo({ state, setState, onEnd }: Props) {
  const eng = useCallEngine(state, setState, "video");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [typed, setTyped] = useState("");
  const [showKb, setShowKb] = useState(false);
  const [camOk, setCamOk] = useState(false);

  // user camera PiP
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCamOk(true);
        }
      })
      .catch(() => setCamOk(false));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stateLabel =
    eng.phase === "connecting"
      ? "connecting…"
      : eng.speaking
        ? "speaking"
        : eng.listening
          ? "listening…"
          : eng.mmss;

  return (
    <div className="call">
      <div className="video-stage">
        <div className="bg-scene" />
        <div style={{ position: "relative", zIndex: 2 }}>
          <div className={`speak-glow ${eng.speaking ? "on" : ""}`} />
          <Avatar size={Math.min(420, window.innerWidth)} speaking={eng.speaking} listening={eng.listening} />
        </div>

        {/* top overlay */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "calc(var(--safe-top) + 18px) 20px 30px",
            background: "linear-gradient(to bottom, rgba(8,5,12,0.7), transparent)",
            zIndex: 3,
          }}
        >
          <div className="cname" style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 500 }}>
            {HER_NAME}
          </div>
          <div style={{ color: "var(--ink-dim)", fontSize: 13.5, letterSpacing: "0.04em", marginTop: 3 }}>
            {stateLabel}
          </div>
        </div>

        {/* user PiP */}
        <div className="pip" style={{ top: "calc(var(--safe-top) + 74px)" }}>
          {camOk ? (
            <video ref={videoRef} autoPlay playsInline muted />
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ink-faint)",
                fontSize: 12,
                textAlign: "center",
                padding: 10,
              }}
            >
              camera off
            </div>
          )}
        </div>

        {/* caption overlay */}
        <div
          style={{
            position: "absolute",
            bottom: "calc(var(--safe-bottom) + 190px)",
            left: 24,
            right: 24,
            textAlign: "center",
            zIndex: 3,
          }}
        >
          <div className="call-caption" style={{ margin: "0 auto", textShadow: "0 2px 12px rgba(0,0,0,0.7)" }}>
            {eng.heard ? `"${eng.heard}"` : eng.caption}
          </div>
        </div>

        {(!eng.sttSupported || showKb) && eng.phase === "live" && (
          <div className="call-input-row">
            <div className="chat-input" style={{ flex: 1, background: "rgba(20,13,26,0.85)" }}>
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

      <div className="call-controls" style={{ position: "absolute", bottom: 0, left: 0, right: 0, justifyContent: "center", zIndex: 5 }}>
        <button className="cbtn" onClick={() => setShowKb((v) => !v)} aria-label="Type instead">
          <KeyboardIcon />
        </button>
        <button className="cbtn danger" style={{ width: 74, height: 74 }} onClick={() => eng.endCall(onEnd)} aria-label="End call">
          <EndCallIcon size={30} />
        </button>
        <button
          className={`cbtn ${eng.listening ? "active-mic" : ""}`}
          onClick={() => eng.startListening()}
          aria-label="Microphone"
        >
          <MicIcon off={!eng.sttSupported} />
        </button>
      </div>
    </div>
  );
}
