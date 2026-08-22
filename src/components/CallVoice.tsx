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
import { EndCallIcon, MicIcon, KeyboardIcon, SendIcon, OfflineIcon } from "./icons";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onEnd: () => void;
  /** true when SHE placed this call — the callback flow. The engine needs it
   *  so her opening line is a caller's, not an answerer's. */
  sheCalled?: boolean;
}

export default function CallVoice({ state, setState, onEnd, sheCalled }: Props) {
  const eng = useCallEngine(state, setState, sheCalled);
  const [typed, setTyped] = useState("");
  const [showKb, setShowKb] = useState(false);

  const hearing = Boolean(eng.heard); // her mic is picking up YOUR voice

  // OFFLINE PILL. Chat already has one (`Chat.tsx`'s `.offline-bar`); the
  // call screen had none, and a call started or continued with no network
  // goes silent with nothing on screen to say why (audit: `call-offline-
  // silent`). Same signal, same discipline: driven only by `navigator.
  // onLine` and its events, reported never enforced — you can keep talking,
  // and it delivers when the line comes back, exactly like Chat's does.
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const sendTyped = () => {
    const t = typed.trim();
    if (!t) return;
    eng.handleUser(t);
    setTyped("");
  };

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

  // The armed hangup (he said "rakh de") needs somewhere to land. Re-bound on
  // every render so it can never hold a stale closure over an old onEnd.
  useEffect(() => {
    eng.bindEnd(onEnd);
  }, [eng, onEnd]);

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
  // "ringing…" rather than "connecting…": the beat it names IS a ring — the
  // engine gives it 1.1-2.4s and lengthens it when she would plausibly be
  // asleep — and calling it "connecting" described our socket instead of her
  // phone. The timer rides every other state, WhatsApp-style, because the one
  // thing you always want on a call is how long you have been on it.
  // LIVE-DROP INDICATOR. The lane just changed under her — her own voice was
  // cut mid-word by `claimVoice`, and until now nothing on screen said so
  // (audit: `live-lane-silent-drop`). Second priority, right after
  // "ringing…": this is exactly the beat where "hello?" would otherwise read
  // as the call dying rather than as her voice pipeline changing. It clears
  // itself — see `useCallEngine.ts`'s `markLaneDegraded` — so it never
  // becomes a permanent claim about a call that has long since recovered.
  const stateLabel =
    eng.phase === "connecting"
      ? "ringing…"
      : eng.laneDegraded
        ? "voice quality reduced…"
        : eng.muted
          ? "mic off · " + eng.mmss
          : eng.speaking
            ? "speaking"
            : hearing
              ? "sun rahi hu…" // live proof she's hearing you
              : eng.thinking
                ? "hmm…"
                : eng.watching && eng.watchPaused
                  ? "you closed the curtain"
                  : eng.watching
                  ? "watching with you 👀"
                  : eng.listening
                    ? "listening…"
                    : eng.mmss;
  const stateTone =
    eng.phase === "connecting"
      ? "connecting"
      : eng.laneDegraded
        ? "degraded"
        : eng.muted
          ? "muted"
          : connected
            ? "live"
            : "";

  return (
    <div
      className="call"
      data-chrome={chrome ? "on" : "off"}
      data-blind={eng.watching && eng.watchPaused ? "" : undefined}
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
        {/* The duration, always, once she has picked up — WhatsApp puts it
            under the name and never takes it away, and the one thing you
            reliably want on a call is how long you have been on it. It is a
            separate line rather than appended to `stateLabel` because that
            label changes six times a minute and the clock must not flicker
            with it. aria-hidden: it ticks every second, and a live region
            announcing the time each tick would talk over her. */}
        {connected && (
          <div className="cclock" aria-hidden="true">
            {eng.mmss}
          </div>
        )}
      </div>

      <div className="call-stage">
        <Presence phase={phase} size={244}>
          <PhotoAvatar size={244} />
        </Presence>

        {/* OFFLINE PILL. Chat has one; the call screen went silent with no
            explanation when the network dropped (audit: `call-offline-
            silent`) — a full ring and a robotic "hello?" with nothing on
            screen naming the one fact that would explain either. */}
        {!online && (
          <div className="call-hint warn" role="status">
            <OfflineIcon size={13} /> No connection right now
          </div>
        )}

        {/* The mic is the one thing on this screen that can be wrong without
            looking wrong: she is listening, you are talking, and nothing is
            reaching her. Say so where you are already looking. */}
        {!eng.sttSupported && eng.phase === "live" && !showKb && (
          <div className="call-hint" role="status">
            Your browser can't hear you here. Type to her instead
          </div>
        )}
        {/* NATIVE-WATCH MUTE HONESTY. The Android watch service owns the mic
            for as long as it holds the call, and there is no bridge call
            that can silence it — so the mic control below is disabled
            rather than reporting a mute that would not be true (audit:
            `native-watch-mute-lie`). This says so once, plainly, rather than
            leaving the disabled button to be read as broken. */}
        {eng.nativeVoice && eng.phase === "live" && (
          <div className="call-hint warn" role="status">
            Mic can't turn off while she's watching. She can still hear and see you
          </div>
        )}
        {eng.muted && eng.phase === "live" && (
          <div className="call-hint warn" role="status">
            {/* Muting is audio-only — a share in progress is not paused by
                it, and someone who just muted may reasonably assume it was.
                Say so, short, whenever both are true at once. */}
            Your mic is off, she can't hear you
            {eng.watching ? ". She can still see your screen" : ""}
          </div>
        )}

        {/* ── the look-away ────────────────────────────────────────────────
            The moment this is needed — an OTP landing, a bank app opening,
            somebody else's message sliding down — is a moment of mild
            panic, so it is one tap, it is the widest thing on the screen
            after her face, and it never dims with the rest of the chrome.

            The state is carried three ways at once, because a person who
            THINKS they closed the curtain and did not is in exactly the
            situation this exists to prevent: the bar changes colour and
            words, the eye icon closes, and her face goes dark behind it.

            The wording is the true one. She stops receiving anything and
            nothing was stored — but while sharing, frames do leave this
            device to the model, so this says "she can't see right now",
            never "private". And it says she can still hear you, because
            she can, and a curtain that silently also muted you would be
            its own betrayal. */}
        {eng.watching && (
          <div className={`watch-chip ${eng.watchPaused ? "blind" : ""}`}>
            <span className="wb-state" role="status">
              <span className="wb-eye" aria-hidden="true">
                {eng.watchPaused ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12s3.6-6 9-6c1.4 0 2.7.4 3.8 1M21 12s-3.6 6-9 6c-1.5 0-2.8-.4-4-1.1" />
                    <path d="M4 4l16 16" />
                  </svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6Z" />
                    <circle cx="12" cy="12" r="2.6" />
                  </svg>
                )}
              </span>
              <span className="wb-text">
                {eng.watchPaused ? (
                  <>
                    <b>She can't see your screen</b>
                    <em>she can still hear you</em>
                  </>
                ) : /* CASCADE-SHARE CHIP TRUTH (audit: `cascade-share-chip-
                       truth`). On the web lane, a frame only reaches her
                       through a live session's socket — with none up, every
                       send fails and nothing she says is ever prompted by
                       what is on screen. This is that case, named honestly,
                       rather than a permanently confident claim. */
                !eng.nativeVoice && !eng.liveVoiceActive ? (
                  <>
                    <b>She can only glance when you talk</b>
                    <em>no live line to send it continuously</em>
                  </>
                ) : /* the chip's own freshness check now reads DELIVERY
                       (`sentAt`), not capture (`frameAt`) — see useCallEngine.ts */
                Date.now() - eng.sentAt < 9000 ? (
                  <>
                    <b>She can see your screen</b>
                    <em>tap look away any time</em>
                  </>
                ) : (
                  <>
                    <b>Connecting to your screen…</b>
                    <em>nothing sent yet</em>
                  </>
                )}
              </span>
            </span>
            <button
              className="wb-btn"
              data-tel="call.look_away"
              onClick={() => {
                tap(ImpactStyle.Medium); // the curtain is worth feeling
                eng.onLookAway();
              }}
              aria-pressed={eng.watchPaused}
              aria-label={eng.watchPaused ? "Let her see your screen again" : "Look away: stop sending your screen"}
            >
              {eng.watchPaused ? "Let her see" : "Look away"}
            </button>
          </div>
        )}

        {(!eng.sttSupported || showKb) && eng.phase === "live" && (
          <div className="call-input-row" style={{ position: "static", marginTop: 16, width: "88%" }}>
            <div className="chat-input" style={{ flex: 1 }}>
              <textarea
                rows={1}
                autoFocus
                data-tel="call.composer"
                aria-label={`Type to ${HER_NAME}`}
                placeholder="Say something…"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendTyped();
                  }
                }}
              />
            </div>
            {/* Enter-only was invisible on a phone: the one way to talk to
                her without a microphone had no button. */}
            <button
              className={`send-btn ${typed.trim() ? "" : "off"}`}
              data-tel="call.send_typed"
              onClick={sendTyped}
              aria-label="Send"
            >
              <SendIcon />
            </button>
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
              data-tel="call.watch"
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
            data-tel="call.keyboard"
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
            data-tel="call.end"
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
            data-tel="call.mute"
            onClick={() => eng.toggleMute()}
            disabled={eng.nativeVoice}
            aria-disabled={eng.nativeVoice}
            aria-label={
              eng.nativeVoice
                ? "Mic can't be turned off while she's watching your screen"
                : eng.muted
                  ? "Unmute microphone"
                  : "Mute microphone"
            }
            aria-pressed={eng.muted}
          >
            <MicIcon off={eng.muted || !eng.sttSupported} />
          </button>
          <span className="clabel">{eng.nativeVoice ? "can't mute" : eng.muted ? "muted" : "mic"}</span>
        </span>
      </div>
    </div>
  );
}
