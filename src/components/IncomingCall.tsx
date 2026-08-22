// She is calling — the screen you see when the call is coming the other way.
//
// The owner's ask 22. What makes it shippable rather than a gimmick is WHY she
// is calling: the last call dropped while she was mid-sentence. That is a real
// event in the world, and calling back after a dropped call is what a person
// does. It is not a timer, and it is not his silence — see
// `decisions.md#proactive-reason-contingent`, and the note in persona.ts about
// why the idle nudge was deleted.
//
// Deliberately NOT a notification-style banner. A call that can be ignored by
// scrolling past it is not a call, and the whole point of this over a text is
// that a call asks for the room. Decline is a first-class, equal-weight button
// for the same reason: something that only offers "accept" is a trap, not a
// phone.
import { useEffect, useRef } from "react";
import PhotoAvatar from "./PhotoAvatar";
import WorldLayer, { useSky, skyVars } from "./WorldLayer";
import { HER_NAME } from "../engine/persona";
import { startRingback, stopRingback, unlockAudio } from "../voice/speech";
import { tap } from "../native/haptics";
import { CloseIcon, EndCallIcon } from "./icons";

interface Props {
  /** how long the call that dropped had lasted, for the subtitle */
  secs: number;
  onAccept: () => void;
  onDecline: () => void;
}

export default function IncomingCall({ secs, onAccept, onDecline }: Props) {
  const answered = useRef(false);
  // Same ground as home and the live call. A ring that arrives on a flat
  // theme background while the rest of the app is standing in a sky reads as
  // a system dialog rather than as her.
  const sky = useSky();

  useEffect(() => {
    // The ring can only sound if audio is unlocked. On a page the user has
    // been texting in it already is; on a cold load it is not, and an
    // incoming call that arrives silently is still a correct screen — it
    // rings on the next interaction rather than not at all.
    unlockAudio();
    startRingback();
    tap();
    return () => stopRingback();
  }, []);

  const finish = (fn: () => void) => {
    if (answered.current) return; // a double-tap must not both accept and end
    answered.current = true;
    stopRingback();
    fn();
  };

  // Escape declines. A full-screen thing with no keyboard exit is a trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(onDecline);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDecline]);

  return (
    <div
      className="incoming"
      role="dialog"
      aria-modal="true"
      aria-label={`${HER_NAME} is calling`}
      style={skyVars(sky)}
    >
      <WorldLayer frame={sky} />
      <div className="inc-top">
        <div className="inc-name">{HER_NAME.toLowerCase()}</div>
        <div className="inc-sub">
          calling back
          {secs > 0 && <span className="inc-why"> · call cut at {mmss(secs)}</span>}
        </div>
      </div>

      <div className="inc-stage">
        {/* the pulse is the ring made visible, on the same 2s period as the
            ringback tone so the screen and the sound agree */}
        <span className="inc-pulse" aria-hidden="true" />
        {/* the same white-bordered card the live call uses, so accepting is
            one screen becoming the next rather than two different screens */}
        <span className="inc-card">
          <PhotoAvatar size={196} />
        </span>
      </div>


      {/* THE APP'S OWN ICONS, not two text dingbats. `✕` and `✆` are
          characters, drawn from whatever the platform's UI font happens to
          carry: `✆` (U+2706 TELEPHONE LOCATION SIGN) has no consistent form at
          all and rendered as an outlined blob inside the accept disc, which is
          the largest, most consequential control in the product. `EndCallIcon`
          is what the live call already hangs up with, rotated so the same
          handset means "pick up" rather than "put down" — one glyph, two
          states, which is how a phone has always drawn it. */}
      <div className="inc-actions">
        <button
          className="inc-btn decline"
          onClick={() => finish(onDecline)}
          aria-label="Decline call"
          data-tel="call.decline"
        >
          <CloseIcon size={26} />
        </button>
        <button
          className="inc-btn accept"
          onClick={() => finish(onAccept)}
          aria-label="Accept call"
          data-tel="call.accept"
        >
          <span className="inc-pick" aria-hidden="true">
            <EndCallIcon size={28} />
          </span>
        </button>
      </div>

      {/* The same true line the live call carries, said before you pick up
          rather than only after. It is the one place a competitor puts a
          privacy claim it cannot defend. */}
      <p className="call-truth inc-truth">
        No ads, ever. She remembers this call. And she'll always tell you what she is.
      </p>
    </div>
  );
}

function mmss(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
