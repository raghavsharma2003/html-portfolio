// The statutory disclosure/break card (SPEC §9.3, §0.3 adjudication): the
// APP speaks this, never her. It renders whatever src/engine/clock.ts's
// timer fires — client mirror included, so this card is exactly as reliable
// with the server down as the timer that drives it is (that is the whole
// point of the mirror).
//
// Deliberately NOT a modal: no scrim, no focus trap, no "don't show again".
// §9.3: the card "does not interrupt her" — she keeps going underneath it,
// and dismissing only clears THIS instance; the next boundary fires
// regardless (dismissCard() already logs the dismissal on both sides, see
// clock.ts). Every string below is app chrome, never a line she says, and
// never templated with anything she or the user said — CLAUDE.md's
// recitation law doesn't apply to app chrome, but the discipline transfers:
// keep it that way rather than relearn why.

import { useEffect, useState } from "react";
import { onClockFire, dismissCard, type ClockFire } from "../engine/clock";
import { HER_NAME } from "../engine/persona";
import { CloseIcon } from "./icons";

function fmtDuration(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const ClockGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M12 7v5l3.2 2"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function ClockCard() {
  const [fire, setFire] = useState<ClockFire | null>(null);

  // onClockFire delivers the CURRENT fire immediately on subscribe (clock.ts
  // guarantee), so a card that should already be up is never missed by a
  // late mount — e.g. this component remounting across a route change.
  useEffect(() => onClockFire(setFire), []);

  if (!fire) return null;

  const isBreak = fire.kind === "break";
  const dur = fmtDuration(fire.continuousMs);
  // CA SB 243's minor-specific posting requirement ("may not be suitable for
  // certain young users") — cheap to include correctly since the tier is
  // already on the fire event, minor-safe (unverified/minor) only.
  const minorSafe = fire.tier === "minor"; // adult-default: only the explicit minor tier shows the SB-243 line

  return (
    <div className="clockcard-wrap" role="status" aria-live="polite">
      <div className="clockcard" data-kind={fire.kind}>
        <span className="cc-icon">
          <ClockGlyph />
        </span>
        <div className="cc-body">
          <p className="cc-title">{isBreak ? "Still there?" : "Quick reminder"}</p>
          <p className="cc-text">
            {isBreak ? (
              <>
                You've been talking with {HER_NAME} for {dur}. No rush — she'll be right here
                whenever you come back.
              </>
            ) : (
              <>
                {HER_NAME} is an AI, not a person — you've been chatting for {dur}.
                {minorSafe && " She may not be suitable for younger users."}
              </>
            )}
          </p>
        </div>
        <button className="cc-close hit-44" data-tel="clock.dismiss" aria-label="Dismiss" onClick={dismissCard}>
          <CloseIcon size={13} />
        </button>
      </div>
    </div>
  );
}
