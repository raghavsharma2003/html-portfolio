// Celebration — how a moment is marked. The surface half of the milestone
// seam; `engine/milestones.ts` decides WHAT and `useMoments` decides WHEN.
//
// ── the anatomy, and why it is three beats rather than one ────────────────
// BUILDUP  the card arrives under its own power — 240ms, the house spring,
//          from just below and slightly small. It is an arrival, which is
//          the one thing `--ease-spring` exists for.
// PEAK     one burst, 90ms behind the card so the eye reads the card FIRST
//          and the burst as its consequence. Nine particles, transform and
//          opacity only, one shared keyframes rule in celebrate.css (which
//          carries the reduced-motion answer for all of it).
// SETTLE   it goes quiet on its own after ~2.8s, or the instant it is
//          touched. No button, no confirmation, nothing to dismiss.
//
// ── what it deliberately is NOT ───────────────────────────────────────────
// NOT VARIABLE. Every celebration in this app is the same burst at the same
// magnitude. Scaling intensity to the size of the win is the Balatro/slot
// machine mechanic — reward variance — and NEVER MANIPULATE rules it out
// (docs/research/gamification-2026.md, TECHNIQUE 3's charter-risk flag).
// The magnitude is a constant table below, not a random draw: two identical
// milestones look identical, forever.
//
// NOT A MODAL. No scrim, no focus trap, nothing behind it is disabled and
// nothing is waiting on a tap. The wrapper is `pointer-events: none` and
// only the card itself is touchable, so the thread underneath stays live
// while this is on screen — the same refusal `ClockCard` makes, and the
// apple-design rule "never lock input during a transition".
//
// NOT REPEATABLE. `useMoments` writes the id into the fired-ledger the frame
// this becomes visible. Nothing here can re-surface a moment, and nothing
// here counts down, expires, or is at risk of being lost.

import { useEffect, useState } from "react";
import type { Moment } from "../engine/milestones";
import { tap, ImpactStyle } from "../native/haptics";
import "../styles/celebrate.css";

/** How long it stands before settling on its own. */
const HOLD_MS = 2800;
/** The quiet fade. Matches `.cel-card[data-phase="out"]` in celebrate.css. */
const EXIT_MS = 240;

/**
 * The burst, as a fixed table.
 *
 * `a` angle in degrees (0 is straight up), `d` travel in px, `dl` the
 * particle's own delay, `sz` its size, `warm` which of the two accent inks
 * it takes. Nine — inside TECHNIQUE 7's 6-12 band.
 *
 * Hand-set rather than evenly divided so it reads as thrown rather than as a
 * clock face, and hand-set rather than randomised so it reads the SAME every
 * time. That is the charter line: organic-looking is a visual property, and
 * unpredictable is a reward-schedule property, and only the first one is
 * wanted here.
 *
 * It is a FAN, not a full circle, and that came out of looking at it: an even
 * radial spread put two particles on top of the headline for a third of a
 * second, which is a legibility bug dressed as physics. The two lowest
 * angles keep the radial read and travel barely past the medallion, so the
 * burst stays a burst and the words stay readable.
 */
const BURST = [
  { a: -142, d: 46, dl: 30, sz: 6, warm: true },
  { a: -104, d: 74, dl: 0, sz: 8, warm: false },
  { a: -70, d: 64, dl: 36, sz: 6, warm: true },
  { a: -38, d: 84, dl: 12, sz: 7, warm: false },
  { a: -6, d: 70, dl: 52, sz: 6, warm: true },
  { a: 30, d: 86, dl: 6, sz: 7, warm: false },
  { a: 66, d: 62, dl: 44, sz: 6, warm: true },
  { a: 104, d: 74, dl: 18, sz: 8, warm: false },
  { a: 140, d: 46, dl: 58, sz: 6, warm: false },
] as const;

/**
 * One mark for every kind of moment, on purpose.
 *
 * Apple Photos Memories' lesson from the research sweep: a uniform visual
 * treatment is what makes five different kinds of remembered thing read as
 * ONE artifact. A per-kind glyph would make the celebration a taxonomy, and
 * a taxonomy is a dashboard.
 */
const SparkGlyph = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 3.4c.5 3.9 1.6 5.9 3.7 7.1-2.1 1.2-3.2 3.2-3.7 7.1-.5-3.9-1.6-5.9-3.7-7.1 2.1-1.2 3.2-3.2 3.7-7.1Z"
      fill="currentColor"
    />
    <path
      d="M18.2 14.6c.25 1.9.8 2.9 1.8 3.5-1 .6-1.55 1.6-1.8 3.5-.25-1.9-.8-2.9-1.8-3.5 1-.6 1.55-1.6 1.8-3.5Z"
      fill="currentColor"
      opacity="0.78"
    />
  </svg>
);

export interface CelebrationProps {
  /** From `useMoments`. Null renders nothing at all. */
  moment: Moment | null;
  /** Called once the settle has finished — clears the moment upstream. */
  onDone: () => void;
  /** Override the ~2.8s hold. The design harness uses this; nothing else should. */
  holdMs?: number;
}

export default function Celebration({ moment, onDone, holdMs = HOLD_MS }: CelebrationProps) {
  const [out, setOut] = useState(false);
  const id = moment?.id ?? null;

  // Arrival: start the hold, and spend the one haptic. It fires in the same
  // effect that first paints the card rather than after any transition —
  // haptics.ts's own standing rule is that the touch and the picture must not
  // drift apart, and a beat behind the visual is exactly that drift.
  useEffect(() => {
    if (!id) return;
    setOut(false);
    tap(ImpactStyle.Light);
    const t = setTimeout(() => setOut(true), holdMs);
    return () => clearTimeout(t);
  }, [id, holdMs]);

  // Settle: the fade runs, then the moment is cleared upstream. Two steps so
  // the card is never yanked out mid-animation.
  useEffect(() => {
    if (!out || !id) return;
    const t = setTimeout(onDone, EXIT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [out, id]);

  if (!moment) return null;

  return (
    // role="status" rather than "alert": this is worth saying, and never
    // worth interrupting whatever a screen reader is already reading.
    <div className="cel" role="status" aria-live="polite" data-kind={moment.kind}>
      <button
        type="button"
        className="cel-card"
        data-phase={out ? "out" : "in"}
        data-tel={`moment.${moment.id}`}
        aria-label={`${moment.title}${moment.detail ? `. ${moment.detail}` : ""}. Tap to dismiss.`}
        onPointerDown={() => setOut(true)}
      >
        <span className="cel-burst" aria-hidden="true">
          {BURST.map((p, i) => (
            <i
              key={i}
              className="cel-p"
              data-warm={p.warm ? "yes" : "no"}
              style={
                {
                  "--a": `${p.a}deg`,
                  "--d": `${p.d}px`,
                  "--dl": `${p.dl}ms`,
                  "--sz": `${p.sz}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </span>

        <span className="cel-ic" aria-hidden="true">
          <SparkGlyph />
        </span>

        <b className="cel-title">{moment.title}</b>
        {moment.detail ? <em className="cel-detail">{moment.detail}</em> : null}
      </button>
    </div>
  );
}
