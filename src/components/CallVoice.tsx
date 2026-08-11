// Voice call — her face inside a presence field that breathes at rest and
// moves with the real amplitude of whoever is talking, and controls that
// recede while you listen. STT with a graceful typed fallback. Deliberately
// no captions: a call is a call — you listen to her, you don't read her.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "../state/store";
import { HER_NAME } from "../engine/persona";
import PhotoAvatar from "./PhotoAvatar";
import Presence, { type Phase } from "./Presence";
import { useCallEngine } from "./useCallEngine";
import { tap, ImpactStyle } from "../native/haptics";
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

  const hearing = Boolean(eng.heard); // her mic is picking up YOUR voice

  // hardware receding: chrome dims after a few quiet seconds and comes back
  // on the first touch. One timer, no re-render storm.
  const [chrome, setChrome] = useState(true);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wake = useCallback(() => {
    setChrome((on) => (on ? on : true));
    clearTimeout(idle.current);
    idle.current = setTimeout(() => setChrome(false), 4200);
  }, []);
  useEffect(() => {
    wake();
    return () => clearTimeout(idle.current);
  }, [wake]);

  // the moment she is actually there
  const connected = eng.phase === "live";
  useEffect(() => {
    if (connected) tap(ImpactStyle.Medium);
  }, [connected]);

  // the five states of her presence. `thinking` is tracked by the engine and
  // was rendered nowhere — attention turning inward, not a spinner.
  const phase: Phase = eng.speaking
    ? "speaking"
    : eng.thinking
      ? "thinking"
      : hearing
        ? "hearing"
        : eng.listening
          ? "listening"
          : "idle";

  // What the line is doing, in one line. `connecting` gets a breathing dot
  // because it is the only state you might sit in wondering whether anything
  // is happening; the rest are self-evidently alive.
  const stateLabel =
    eng.phase === "connecting"
      ? "connecting…"
      : eng.muted
        ? "mic off · " + eng.mmss
        : eng.speaking
          ? "speaking"
          : hearing
            ? "sun rahi hu…" // live proof she's hearing you
            : eng.thinking
              ? "hmm…"
              : eng.watching
                ? "watching with you 👀"
                : eng.listening
                  ? "listening…"
                  : eng.mmss;
  const stateTone =
    eng.phase === "connecting" ? "connecting" : eng.muted ? "muted" : connected ? "live" : "";

  return (
    <div
      className="call"
      data-chrome={chrome ? "on" : "off"}
      onPointerDown={wake}
      onPointerMove={wake}
      role="dialog"
      aria-modal="true"
      aria-label={`Call with ${HER_NAME}`}
    >
      <div className="call-top">
        <div className="cname">{HER_NAME}</div>
        <div className="cstate" data-tone={stateTone} aria-live="polite">
          {eng.phase === "connecting" && <span className="cdot" />}
          {stateLabel}
        </div>
      </div>

      <div className="call-stage">
        <Presence phase={phase} size={244}>
          <PhotoAvatar size={244} />
        </Presence>

        {/* The mic is the one thing on this screen that can be wrong without
            looking wrong: she is listening, you are talking, and nothing is
            reaching her. Say so where you are already looking. */}
        {!eng.sttSupported && eng.phase === "live" && !showKb && (
          <div className="call-hint" role="status">
            Your browser can't hear you here — type to her instead
          </div>
        )}
        {eng.muted && eng.phase === "live" && (
          <div className="call-hint warn" role="status">
            Your mic is off — she can't hear you
          </div>
        )}

        {eng.watching && (
          <div className="watch-chip" role="status">
            <i />
            {Date.now() - eng.frameAt < 9000
              ? "screen shared — she can see it"
              : "connecting to your screen…"}
          </div>
        )}

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

      {/* Every control wears its name. Icon-only hardware is fine on a phone
          you have used for years and hostile on a screen you are seeing for
          the first time while someone is talking to you — "which of these
          four circles hangs up" is not a question to ask mid-sentence. */}
      <div className="call-controls">
        {eng.watchAvailable && eng.phase === "live" && (
          <span className="cbtn-wrap">
            <button
              className={`cbtn ${eng.watching ? "watch-on" : ""}`}
              onClick={() => (eng.watching ? eng.stopWatchMode() : eng.startWatchMode())}
              aria-label={eng.watching ? "Stop sharing screen" : "Watch together"}
              aria-pressed={eng.watching}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2.5" y="4.5" width="19" height="13" rx="2.5" />
                <path d="M8 21h8M12 17.5V21" />
                {eng.watching && <path d="M8.5 9.5 12 12l3.5-2.5" />}
              </svg>
            </button>
            <span className="clabel">{eng.watching ? "sharing" : "watch"}</span>
          </span>
        )}
        <span className="cbtn-wrap">
          <button
            className={`cbtn ${showKb ? "active-mic" : ""}`}
            onClick={() => setShowKb((v) => !v)}
            aria-label="Type instead"
            aria-pressed={showKb}
          >
            <KeyboardIcon />
          </button>
          <span className="clabel">type</span>
        </span>
        <span className="cbtn-wrap is-end">
          <button
            className="cbtn danger"
            style={{ width: 74, height: 74 }}
            onClick={() => {
              tap(); // same handler as the visual: latency between senses kills it
              eng.endCall(onEnd);
            }}
            aria-label="End call"
          >
            <EndCallIcon size={30} />
          </button>
          <span className="clabel">end</span>
        </span>
        <span className="cbtn-wrap">
          <button
            className={`cbtn ${eng.muted ? "muted" : eng.listening ? "active-mic" : ""}`}
            onClick={() => eng.toggleMute()}
            aria-label={eng.muted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={eng.muted}
          >
            <MicIcon off={eng.muted || !eng.sttSupported} />
          </button>
          <span className="clabel">{eng.muted ? "muted" : "mic"}</span>
        </span>
      </div>
    </div>
  );
}
