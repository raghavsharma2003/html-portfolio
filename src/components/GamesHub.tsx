// GamesHub — the things the two of them can do together, listed.
//
// The whole design pressure on this file is the owner's line: "it should be a
// whole continuous thing only. Nothing should be broken in between." So this
// is not a games menu. It is a list of things SHE is up for, with her face and
// her availability at the top of it, and one tap into any of them. There is no
// difficulty picker, no new-game/continue fork, no lobby — a fork before a
// game is a form, and nobody fills in a form to play chess with a friend.
//
// Three things it is built to survive, because the owner has said more
// activities are coming:
//
//   1. A SECOND AND THIRD ROW COST NOTHING. The shape is a list, not a tile
//      grid: a grid has to be redesigned at four items and again at seven,
//      and this one takes the tenth without a decision. Add an entry to
//      `DEFAULT_ACTIVITIES` (or pass your own `activities`) and it lands.
//   2. NOT-BUILT-YET IS A STATE, NOT AN ABSENCE. `state: "soon"` renders the
//      row in full, quietly, with the one word that explains why nothing
//      happens. Hiding it would make the section look finished when it is
//      not; ghosting it would make it look broken.
//   3. IT KNOWS NOTHING ABOUT CHESS. No engine import, no board import, no
//      game state. It hands an id back and that is the entire contract, so a
//      second activity does not have to be a board game to fit.
//
// SURFACE layer only (docs/SPEC-GAMES.md §3): drawn and touched here, decided
// elsewhere.

import { HER_NAME } from "../engine/persona";
import PhotoAvatar from "./PhotoAvatar";
import { ChevronIcon } from "./icons";
import { tap, ImpactStyle } from "../native/haptics";
import "../styles/games.css";

/* ── icons ────────────────────────────────────────────────────────────────
   Local rather than pulled from `./chess/pieces`: those glyphs take their
   fill and rim from the board's own token block, so outside a `.cb` they
   have no colour to be. These are line icons in `currentColor`, drawn the
   same way `icons.tsx` draws everything else. */

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const ChessIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} aria-hidden="true">
    <circle cx="12" cy="6" r="2.9" />
    <path d="M9.4 11.1h5.2" />
    <path d="M10.6 11.1c0 3-1.2 4.9-2.6 6.4h8c-1.4-1.5-2.6-3.4-2.6-6.4" />
    <path d="M6.9 17.5h10.2a1.4 1.4 0 0 1 1.4 1.4v1.4H5.5v-1.4a1.4 1.4 0 0 1 1.4-1.4Z" />
  </svg>
);

/** Two options, one stem. */
export const ForkIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} aria-hidden="true">
    <path d="M12 20.5v-6.8" />
    <path d="M12 13.7 6.9 9.1V6.6" />
    <path d="M12 13.7l5.1-4.6V6.6" />
    <circle cx="6.9" cy="4.6" r="2" />
    <circle cx="17.1" cy="4.6" r="2" />
  </svg>
);

export const GridIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} aria-hidden="true">
    <path d="M9.3 3.6v16.8M14.7 3.6v16.8M3.6 9.3h16.8M3.6 14.7h16.8" />
  </svg>
);

/* ── the catalogue ────────────────────────────────────────────────────── */

/**
 * `ready`  — built, tap to start.
 * `resume` — built, and something of his is already waiting in it.
 * `soon`   — not built yet. Shown, not hidden: a section that quietly omits
 *            what is coming reads as finished, and this one is not.
 */
export type ActivityState = "ready" | "resume" | "soon";

export interface Activity {
  /** Opaque to this component — it is handed straight back to `onOpen`. */
  id: string;
  title: string;
  /** One line, app-voiced. Never a line she would say. */
  blurb: string;
  state: ActivityState;
  /** Replaces `blurb` when there is something live to report ("your move"). */
  detail?: string;
  icon?: React.ReactNode;
}

export interface HerAvailability {
  /** Default true. False is for a real absence, not a loading state. */
  around?: boolean;
  /** A call is live right now. */
  onCall?: boolean;
  /** Overrides the derived line entirely. */
  line?: string;
}

export interface GamesHubProps {
  /** Defaults to `DEFAULT_ACTIVITIES`. Pass your own to add or reorder. */
  activities?: readonly Activity[];
  /** One tap in. Fired with `Activity.id`; never fired for a `soon` row. */
  onOpen: (id: string) => void;
  her?: HerAvailability;
  /** Pass `""` when the container already has a heading of its own. */
  heading?: string;
  className?: string;
}

// Only chess is playable. The other two are here to prove the shape holds a
// second and a third — swap them for whatever actually lands next; nothing
// below reads their ids.
export const DEFAULT_ACTIVITIES: readonly Activity[] = [
  {
    id: "chess",
    title: "Chess",
    blurb: "A real board, both sides. She plays and talks while you do.",
    state: "ready",
    icon: <ChessIcon />,
  },
  {
    id: "would-you-rather",
    title: "Would you rather",
    blurb: "Two bad options and an argument about them.",
    state: "ready",
    icon: <ForkIcon />,
  },
  {
    id: "tic-tac-toe",
    title: "Tic tac toe",
    blurb: "Thirty seconds, no thinking required.",
    state: "soon",
    icon: <GridIcon />,
  },
];

export default function GamesHub({
  activities = DEFAULT_ACTIVITIES,
  onOpen,
  her,
  heading = "Do something together",
  className = "",
}: GamesHubProps) {
  // Availability said in words, next to her face, once. A badge per row would
  // say the same fact three times and make it a property of the games rather
  // than of her.
  const away = her?.around === false;
  const line =
    her?.line ??
    (away ? "away right now" : her?.onCall ? "on the call with you" : "around, up for a game");
  const dot = away ? "away" : her?.onCall ? "call" : "here";

  return (
    <section className={`gh ${className}`.trim()} aria-label={heading || "Things to do together"}>
      {heading ? <h2 className="gh-title">{heading}</h2> : null}

      <div className="gh-her">
        <span className="gh-face" aria-hidden="true">
          <PhotoAvatar size={40} />
        </span>
        <span className="gh-who">
          <b>{HER_NAME}</b>
          <em>
            <i className="gh-dot" data-state={dot} aria-hidden="true" />
            {line}
          </em>
        </span>
      </div>

      <ul className="gh-list">
        {activities.map((a, i) => {
          const soon = a.state === "soon";
          return (
            // The stagger is per-row and lives in CSS: 45ms apart, inside the
            // 30-80ms band, so the list arrives as a hand dealing rather than
            // as one block appearing.
            <li className="gh-item" key={a.id} style={{ "--i": i } as React.CSSProperties}>
              <button
                type="button"
                className="gh-card"
                data-state={a.state}
                data-tel={`games.open.${a.id}`}
                disabled={soon}
                aria-label={
                  soon
                    ? `${a.title}. Not here yet.`
                    : `${a.title}. ${a.detail ?? a.blurb}`
                }
                // Feedback on pointerdown, navigation on click: the press is
                // felt while the finger is still down, and a scroll that
                // started on this row does not open anything.
                onPointerDown={() => {
                  if (!soon) tap(ImpactStyle.Light);
                }}
                onClick={() => {
                  if (!soon) onOpen(a.id);
                }}
              >
                <span className="gh-ic" aria-hidden="true">
                  {a.icon ?? <ChessIcon />}
                </span>
                <span className="gh-tx">
                  <b>{a.title}</b>
                  <em>{a.detail ?? a.blurb}</em>
                </span>
                <span className="gh-end" aria-hidden="true">
                  {soon ? (
                    <span className="gh-tag">soon</span>
                  ) : a.state === "resume" ? (
                    <span className="gh-tag" data-kind="resume">
                      resume
                    </span>
                  ) : null}
                  {soon ? null : (
                    <span className="gh-chev">
                      <ChevronIcon size={16} />
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
