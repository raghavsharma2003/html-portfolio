// Pure rules. No engine call, no talk, no React — a board, and the two
// functions that advance or read one. Mirrors `src/engine/chess/board.ts`'s
// shape: every function is pure, every value returned is immutable, and an
// illegal move returns null rather than throwing (so a UI event handler never
// needs a try/catch on the one thing it does constantly).

import type { Cell, Game, GameStatus, Mark, PlayedMove } from "./types";

export const EMPTY_BOARD: readonly (Mark | null)[] = Object.freeze(Array(9).fill(null));

/** The eight lines a board can be won on, as cell-index triples. */
const LINES: readonly (readonly [Cell, Cell, Cell])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/**
 * Reads a board. `turn` is carried through rather than computed here — the
 * caller always knows it (it alternates by parity of the move count) — and it
 * is still reported when `over` is true, on the same contract as chess's
 * `GameStatus.turn`: "whose turn it would be", not "is there one".
 */
export function statusOfBoard(board: readonly (Mark | null)[], turn: Mark): GameStatus {
  for (const line of LINES) {
    const [a, b, c] = line;
    const v = board[a];
    if (v && v === board[b] && v === board[c]) {
      return { over: true, turn, result: "win", winner: v, line };
    }
  }
  if (board.every((c) => c !== null)) {
    return { over: true, turn, result: "draw", winner: null, line: null };
  }
  return { over: false, turn, result: "in_progress", winner: null, line: null };
}

/** X always opens — there is no board-shaped reason for the alternative, and
 *  a coin flip here would make replaying a game non-deterministic for no
 *  reason a player could ever see. */
export function newTttGame(): Game {
  const board = EMPTY_BOARD;
  return { board, played: [], status: statusOfBoard(board, "x") };
}

/** Empty cells, in board order. Empty once the game is over. */
export function legalCells(game: Game): Cell[] {
  if (game.status.over) return [];
  const out: Cell[] = [];
  for (let i = 0; i < 9; i++) if (game.board[i] === null) out.push(i);
  return out;
}

/**
 * Plays `cell` for whoever's turn it is in `game`. Returns null — never
 * throws — for an occupied cell, an out-of-range index, or a game already
 * over, matching chess's `play()`.
 */
export function playTtt(game: Game, cell: Cell): Game | null {
  if (game.status.over) return null;
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return null;
  if (game.board[cell] !== null) return null;

  const mark = game.status.turn;
  const board = game.board.slice();
  board[cell] = mark;
  const next: Mark = mark === "x" ? "o" : "x";
  const status = statusOfBoard(board, next);
  const played: PlayedMove[] = [...game.played, { cell, by: mark }];
  return { board, played, status };
}

/**
 * Every cell where `mark` would complete a line if placed there RIGHT NOW —
 * i.e. the cells that are simultaneously "her immediate win" (when `mark` is
 * her own) and "his immediate threat" (when `mark` is the opponent's). One
 * function serves both callers in `opponent.ts` and `tttTalk.ts` because they
 * are the same geometric fact asked from two sides of the board.
 */
export function winningCells(board: readonly (Mark | null)[], mark: Mark): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] !== null) continue;
    const probe = board.slice();
    probe[i] = mark;
    if (statusOfBoard(probe, mark).winner === mark) out.push(i);
  }
  return out;
}
