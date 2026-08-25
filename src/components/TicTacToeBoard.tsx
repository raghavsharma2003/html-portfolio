// TicTacToeBoard — the 3x3 grid. Owns no game logic, same discipline as
// ChessBoard: it is handed a board and the cells that are legal right now,
// and its whole job is placing a mark and drawing a line feel satisfying.
// If a cell is not in `legalCells`, it cannot be tapped here, full stop.
//
// The two things that make it feel like a real move rather than a UI update:
//   1. X and O are drawn, not painted — an inline SVG stroke that animates
//      `stroke-dashoffset` from full to zero, `pathLength="1"` on every
//      shape so the animation never has to know the real geometry.
//   2. The winning line draws itself across the three cells the SAME way,
//      slightly after the mark that completed it, so the eye reads
//      "this is what she noticed" rather than "the board just changed".

import { useEffect, useRef } from "react";
import "../styles/ttt.css";
// WS-SOUND. Same two doors ChessBoard uses and for the same reason: `feel` for
// the mark HE puts down (cue + haptic, one call, one intensity nobody chose at
// the call site), `play` alone for the one that arrives.
import { feel, play } from "../sound";

export type Mark = "x" | "o";
export type Cell = number;

export interface TicTacToeBoardProps {
  /** Length 9, row-major. `null` is empty. The only source of the position. */
  board: readonly (Mark | null)[];
  /** Cells that may be tapped right now. Empty means the board takes no input. */
  legalCells?: readonly Cell[];
  /** Fired once per committed placement. Never called for an illegal cell. */
  onPlay?: (cell: Cell) => void;
  /** The cell just played, so only the newest mark plays its draw-in once. */
  lastCell?: Cell | null;
  /** The three cells of a completed line, or null. Draws the strike-through. */
  winningLine?: readonly Cell[] | null;
  /** `"dark"` when mounted over the call ground — matches `ChessBoard`'s prop. */
  tone?: "paper" | "dark";
  /** Accessible name for the grid. */
  label?: string;
  className?: string;
}

const CELL_LABEL: readonly string[] = [
  "top left", "top middle", "top right",
  "middle left", "centre", "middle right",
  "bottom left", "bottom middle", "bottom right",
];

function MarkGlyph({ mark, fresh }: { mark: Mark; fresh: boolean }) {
  if (mark === "x") {
    return (
      <svg className="tt-mark" data-fresh={fresh ? "" : undefined} viewBox="0 0 100 100" aria-hidden="true">
        <line className="tt-stroke" x1="24" y1="24" x2="76" y2="76" pathLength={1} />
        <line className="tt-stroke tt-stroke-b" x1="76" y1="24" x2="24" y2="76" pathLength={1} />
      </svg>
    );
  }
  return (
    <svg className="tt-mark" data-fresh={fresh ? "" : undefined} viewBox="0 0 100 100" aria-hidden="true">
      <circle className="tt-stroke" cx="50" cy="50" r="28" pathLength={1} />
    </svg>
  );
}

export default function TicTacToeBoard({
  board,
  legalCells = [],
  onPlay,
  lastCell = null,
  winningLine = null,
  tone = "paper",
  label = "Tic tac toe board",
  className = "",
}: TicTacToeBoardProps) {
  const legal = new Set(legalCells);
  const interactive = legal.size > 0;
  const win = new Set(winningLine ?? []);

  // The winning line is drawn as one SVG overlay spanning the three cells'
  // centres, in the SAME 0..300 coordinate space as the 3x3 grid (each cell
  // is 100 units). Only the eight fixed geometries a 3x3 board can produce.
  const lineGeometry = winningLine ? geometryFor(winningLine) : null;

  // WS-SOUND. The cell HE just committed. His cue fires against his finger in
  // the handler below; this is what keeps the arrival effect from sounding the
  // same mark a second time when it comes back as a new `lastCell`.
  const soundedCell = useRef<Cell | null>(null);
  // `undefined` means "this board has not been observed yet", which is the
  // whole guard: a board that MOUNTS with a game in progress already has a
  // `lastCell`, and sounding that would be a noise nobody's finger asked for.
  // One tick of observation costs nothing and makes the mount case impossible
  // rather than merely unlikely.
  const seenCell = useRef<Cell | null | undefined>(undefined);
  useEffect(() => {
    const prev = seenCell.current;
    seenCell.current = lastCell ?? null;
    const mine = soundedCell.current;
    soundedCell.current = null;
    if (prev === undefined) return; // mount
    if (lastCell == null || lastCell === prev) return; // cleared, or unchanged
    if (mine === lastCell) return; // his own mark, already sounded
    // Hers. No haptic: nothing of his is in front of it.
    play("place");
  }, [lastCell]);

  const commit = (cell: Cell) => {
    if (!legal.has(cell)) return;
    // Was tap(ImpactStyle.Light); `feel("place")` is that same Light tap plus
    // the wood it now makes, from one call. There is no capture in this game,
    // so the board only ever spends one of the two board cues.
    soundedCell.current = cell;
    feel("place");
    onPlay?.(cell);
  };

  return (
    <div className={`tt ${className}`.trim()} data-tone={tone} data-idle={interactive ? undefined : ""}>
      <div className="tt-frame">
        <div className="tt-grid" role="grid" aria-label={label}>
          {Array.from({ length: 3 }, (_, row) => (
            <div className="tt-row" role="row" key={row}>
              {Array.from({ length: 3 }, (_, col) => {
                const cell = row * 3 + col;
                const mark = board[cell];
                const isLegal = legal.has(cell);
                let aria = `${CELL_LABEL[cell]}, ${mark ? mark.toUpperCase() : "empty"}`;
                if (isLegal) aria += ", your move";
                if (win.has(cell)) aria += ", part of the winning line";
                return (
                  <button
                    type="button"
                    key={col}
                    role="gridcell"
                    className="tt-cell"
                    data-win={win.has(cell) ? "" : undefined}
                    aria-label={aria}
                    aria-disabled={isLegal ? undefined : true}
                    onPointerDown={() => commit(cell)}
                  >
                    {mark ? <MarkGlyph mark={mark} fresh={cell === lastCell} /> : null}
                  </button>
                );
              })}
            </div>
          ))}

          {lineGeometry ? (
            <svg className="tt-win" viewBox="0 0 300 300" aria-hidden="true">
              <line
                className="tt-win-stroke"
                x1={lineGeometry.x1}
                y1={lineGeometry.y1}
                x2={lineGeometry.x2}
                y2={lineGeometry.y2}
                pathLength={1}
              />
            </svg>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Cell-centre coordinates for the fixed line a 3x3 board can win on, pulled
 *  in a little at each end so the stroke doesn't touch the grid frame. */
function geometryFor(line: readonly Cell[]): { x1: number; y1: number; x2: number; y2: number } {
  const centre = (c: Cell) => ({ x: (c % 3) * 100 + 50, y: Math.floor(c / 3) * 100 + 50 });
  const sorted = [...line].sort((a, b) => a - b);
  const a = centre(sorted[0]);
  const b = centre(sorted[sorted.length - 1]);
  const pull = 0.12;
  return {
    x1: a.x + (b.x - a.x) * pull,
    y1: a.y + (b.y - a.y) * pull,
    x2: b.x - (b.x - a.x) * pull,
    y2: b.y - (b.y - a.y) * pull,
  };
}
