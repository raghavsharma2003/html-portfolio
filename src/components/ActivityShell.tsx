// ActivityShell — the frame an activity lives in.
//
// The owner's requirement, in his words: "There should be continuity and
// proper flow between chat, call, screen sharing, and chess... It should be a
// whole continuous thing only. Nothing should be broken in between... it
// should be continuous personality like a real human."
//
// So this frame is built around one refusal: it is NOT a mode. Four things
// follow from that, and every layout decision below is one of them.
//
//   1. SHE IS IN THE HEADER, ALWAYS. The same face at the same size in the
//      same corner as the chat header and the call screen, with a line
//      saying what she is doing right now. The person you were texting is
//      visibly the person you are now playing. A frame that showed only the
//      game would have made the game the relationship.
//   2. THE WAY OUT IS A WAY BACK. A labelled "‹ Chat", never an ✕. Closing
//      implies ending something, and this ends nothing — least of all the
//      call. When a call is live the control says so in its accessible name,
//      because the fear it has to answer ("will this hang up on her") cannot
//      be answered by an icon.
//   3. THE CALL STAYS VISIBLE AND STAYS REACHABLE. A live call is reported
//      in the header with its running time and is one tap away, so the board
//      is never somewhere the call got lost in. Mute is offered in place, so
//      the commonest reason to leave the activity stops being a reason.
//   4. IT REPAINTS THE ROOM IT IS IN. With a call live the shell takes the
//      call's own warm-dark ground, so the board arriving reads as the same
//      room continuing rather than as a second screen covering the first.
//      `activityTone()` is exported so the caller inks the activity itself
//      (the board takes `tone` too) off the same expression.
//
// It knows nothing about chess, or about any game: it renders `children` and
// hands back an exit. SURFACE layer only (docs/SPEC-GAMES.md §3).

import { useEffect, useRef } from "react";
import { HER_NAME } from "../engine/persona";
import PhotoAvatar from "./PhotoAvatar";
import { ChevronIcon, MicIcon, PhoneIcon } from "./icons";
import { tap, ImpactStyle } from "../native/haptics";
import "../styles/games.css";

/** Matches `ChessBoard`'s `tone`, and is meant to be passed to both. */
export type ActivityTone = "paper" | "dark";

/** The same five states `Presence` draws on the call screen. */
export type HerPhase = "idle" | "listening" | "hearing" | "thinking" | "speaking";

export interface ActivityCall {
  /** A call is up. Everything else here is ignored when this is false. */
  live?: boolean;
  /** Ringing, not yet answered. */
  connecting?: boolean;
  muted?: boolean;
  /** Running time, pre-formatted (`eng.mmss`). */
  mmss?: string;
  /** Bring the call screen forward. Omitted, the chip reports without acting. */
  onOpen?: () => void;
  /** Omitted, no mic button is drawn. */
  onToggleMute?: () => void;
  /** Offered only when no call is live. Omitted, no call button is drawn. */
  onStart?: () => void;
  /** WATCH / LOOK-AWAY, mirrored from `CallStatus`. A screen share is live
   *  right now — either lane. Every surface that shows call state must show
   *  this too: she can see the screen, and it must say so wherever the call
   *  is represented, not only on the call screen (audit:
   *  `watch-invisible-off-call-screen`). Omitted, no watch pill is drawn. */
  watching?: boolean;
  /** The look-away is engaged — nothing is leaving the device right now. */
  watchPaused?: boolean;
  /** Toggles the look-away from here, without leaving the board. Omitted,
   *  the pill reports without offering a control. */
  onLookAway?: () => void;
  /** LIVE-DROP INDICATOR: the live lane silently dropped to the cascade
   *  fallback moments ago. A brief, honest, quiet state — not an error —
   *  mirrored from `CallStatus.laneDegraded`. */
  degraded?: boolean;
}

export interface ActivityShellProps {
  /** "Chess". Names the surface, and is its accessible name. */
  title: string;
  her?: {
    phase?: HerPhase;
    /** Overrides the derived line — this is where "her move" belongs. */
    line?: string;
  };
  call?: ActivityCall | null;
  /** Leave the activity. Must NOT end the call, and must not end the game. */
  onExit: () => void;
  /** Where the exit goes, in one word. Default "Chat". */
  exitLabel?: string;
  /** Defaults to dark while a call is live — see `activityTone`. */
  tone?: ActivityTone;
  /** One quiet line under the header. The only live region on this surface. */
  note?: React.ReactNode;
  /** Controls belonging to the activity, not to the shell. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** One expression, so the shell and the activity inside it never disagree. */
export const activityTone = (callLive?: boolean): ActivityTone => (callLive ? "dark" : "paper");

// App-voiced, never a line she would say — the same discipline ClockCard
// states for its own strings. `her.line` is the override for anything the
// activity knows better ("her move", "she's stuck on this one").
const HER_LINE: Record<HerPhase, string> = {
  speaking: "she's talking",
  thinking: "she's thinking…",
  hearing: "she can hear you",
  listening: "she's listening",
  idle: "here with you",
};

export default function ActivityShell({
  title,
  her,
  call,
  onExit,
  exitLabel = "Chat",
  tone,
  note,
  footer,
  children,
  className = "",
}: ActivityShellProps) {
  const root = useRef<HTMLDivElement>(null);

  const live = Boolean(call?.live);
  const connecting = Boolean(call?.connecting);
  const phase: HerPhase = her?.phase ?? "idle";
  const skin: ActivityTone = tone ?? activityTone(live);
  const line = her?.line ?? (live && phase === "idle" ? "on the call with you" : HER_LINE[phase]);

  // Focus lands inside the shell so a keyboard is not left wherever the page
  // happened to leave it, and so Escape has a target. `preventScroll` because
  // the stage is scrollable and focusing its container must not move it.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  // Escape leaves — but ONLY from the chrome. Inside the stage the key
  // belongs to the activity: the board already spends Escape on putting a
  // lifted piece back down, and a key that both deselects and exits is a key
  // that will one day do both at once.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(".as-stage")) return;
    e.stopPropagation();
    onExit();
  };

  return (
    <div
      className={`as ${className}`.trim()}
      ref={root}
      tabIndex={-1}
      role="region"
      aria-label={title}
      data-tone={skin}
      data-phase={phase}
      data-call={live ? (connecting ? "connecting" : "live") : "off"}
      data-foot={footer ? "on" : "off"}
      onKeyDown={onKeyDown}
    >
      <div className="as-head">
        {/* first in the DOM on purpose: the way out is the first thing a
            keyboard reaches, before eight rows of squares */}
        <button
          type="button"
          className="as-back"
          data-tel="activity.exit"
          onPointerDown={() => tap(ImpactStyle.Light)}
          onClick={onExit}
          aria-label={
            live
              ? `Back to ${exitLabel.toLowerCase()}. The call keeps going.`
              : `Back to ${exitLabel.toLowerCase()}`
          }
        >
          <ChevronIcon size={18} />
          <span>{exitLabel}</span>
        </button>

        <div className="as-who">
          <span className="as-face" aria-hidden="true">
            <PhotoAvatar size={36} />
          </span>
          <span className="as-tx">
            <b className="as-title">{title}</b>
            {/* No aria-live: this changes several times a minute during a
                call, and a screen reader announcing each change would talk
                straight over her. `note` below is the live region. */}
            <span className="as-state">
              {live ? <i className="as-dot" aria-hidden="true" /> : null}
              {line}
            </span>
          </span>
        </div>

        <div className="as-end">
          {live ? (
            <>
              {/* WATCH / LOOK-AWAY, next to the mic — the same argument this
                  file's header comment already makes for mute: a call that
                  becomes invisible the moment you open a board is exactly the
                  discreteness this shell exists to remove, and screen
                  sharing is the one state that argument had not reached yet
                  (audit: `watch-invisible-off-call-screen`). */}
              {call?.watching ? (
                <button
                  type="button"
                  className="as-watch"
                  data-on={call.watchPaused ? "paused" : "on"}
                  data-tel="activity.look_away"
                  onClick={call.onLookAway}
                  disabled={!call.onLookAway}
                  aria-pressed={Boolean(call.watchPaused)}
                  aria-label={
                    call.watchPaused
                      ? "She can't see your screen right now. Let her see again"
                      : "She can see your screen. Look away"
                  }
                >
                  {call.watchPaused ? (
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
                </button>
              ) : null}
              {call?.onToggleMute ? (
                <button
                  type="button"
                  className="as-mic"
                  data-on={call.muted ? "muted" : "on"}
                  data-tel="activity.mute"
                  onClick={call.onToggleMute}
                  aria-pressed={Boolean(call.muted)}
                  aria-label={call.muted ? "Unmute microphone" : "Mute microphone"}
                >
                  <MicIcon size={18} off={Boolean(call.muted)} />
                </button>
              ) : null}
              {/* LIVE-DROP INDICATOR: the same brief, quiet state CallVoice
                  shows, mirrored here so the board does not go on reporting
                  a call as ordinary the instant her voice pipeline changed
                  under it (audit: `live-lane-silent-drop`). */}
              {call?.onOpen ? (
                <button
                  type="button"
                  className="as-call"
                  data-state={connecting ? "connecting" : call?.degraded ? "degraded" : "live"}
                  data-tel="activity.to_call"
                  onClick={call.onOpen}
                  aria-label={`Go back to the call with ${HER_NAME}`}
                >
                  <i className="as-cdot" aria-hidden="true" />
                  <span>
                    {connecting
                      ? "ringing…"
                      : call?.degraded
                        ? "voice reduced"
                        : call?.mmss ?? "on call"}
                  </span>
                </button>
              ) : (
                <span
                  className="as-call"
                  data-state={connecting ? "connecting" : call?.degraded ? "degraded" : "live"}
                  role="status"
                >
                  <i className="as-cdot" aria-hidden="true" />
                  <span>
                    {connecting
                      ? "ringing…"
                      : call?.degraded
                        ? "voice reduced"
                        : call?.mmss ?? "on call"}
                  </span>
                </span>
              )}
            </>
          ) : call?.onStart ? (
            <button
              type="button"
              className="as-mic"
              data-tel="activity.start_call"
              onClick={call.onStart}
              aria-label={`Call ${HER_NAME}`}
            >
              <PhoneIcon size={18} />
            </button>
          ) : null}
        </div>
      </div>

      {note ? (
        <div className="as-note" role="status" aria-live="polite">
          {note}
        </div>
      ) : null}

      {/* The hero. The shell sizes nothing in here — the board owns its own
          geometry and a parent measuring it would be a second opinion about
          the same number. */}
      <div className="as-stage">{children}</div>

      {footer ? <div className="as-foot">{footer}</div> : null}
    </div>
  );
}
