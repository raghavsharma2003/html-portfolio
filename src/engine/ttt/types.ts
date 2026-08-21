// The shapes every other ttt file reads. Same discipline as
// `src/engine/chess/types.ts`: enums, numbers, cell indices. Nothing here is
// prose and nothing here is a sentence she could say — that is `tttTalk.ts`'s
// job alone, for the reason CLAUDE.md gives: anything sentence-shaped in a
// prompt gets recited.

export type Mark = "x" | "o";

/** Board cell, 0..8, row-major: `0 1 2 / 3 4 5 / 6 7 8`. */
export type Cell = number;

export type GameResult = "in_progress" | "win" | "draw";

export interface GameStatus {
  over: boolean;
  /** Side to move in this position. Meaningful even when `over` (see
   *  `board.ts`'s `statusOfBoard`), matching chess's `GameStatus.turn`. */
  turn: Mark;
  result: GameResult;
  /** Set only for `result === "win"`. */
  winner: Mark | null;
  /** The three winning cells, or null unless `result === "win"`. */
  line: readonly Cell[] | null;
}

export interface PlayedMove {
  cell: Cell;
  by: Mark;
}

/** An immutable game. Every function that advances it returns a new one. */
export interface Game {
  /** Length 9, row-major. `null` is empty. */
  board: readonly (Mark | null)[];
  /** Every move played, oldest first. Empty for a fresh board. */
  played: readonly PlayedMove[];
  status: GameStatus;
}

/**
 * Why she picked this cell. Not surfaced to the talk layer today — `herTttMove`
 * returns a bare cell, matching the brief — but kept as a real type because the
 * eval suite asserts against it via the tiers it names, and a future caller
 * that wants the reason (an eval, a debug overlay) should not have to invent
 * the vocabulary a second time.
 */
export type ChoiceKind = "only_move" | "forced_win" | "forced_block" | "optimal" | "decent" | "miss";

/**
 * Strength dials, same shape-family as chess's `Strength`: a level for humans
 * to tune, everything else derived.
 */
export interface Strength {
  /** 1 (easiest) .. 3 (hardest this shape gets). */
  level: number;
  /** Chance she plays a minimax-optimal cell when no immediate tactic applies. */
  optimalChance: number;
  /** Chance she fails to take an immediate win. Zero above the easiest level. */
  missWinChance: number;
  /** Chance she fails to block an immediate loss. Zero above the easiest level. */
  missBlockChance: number;
  /**
   * Fixes the PRNG. Omit and it is derived from the board, which makes her
   * deterministic per position (same board -> same move) while still varying
   * across a game — same contract as chess's `Strength.seed`.
   */
  seed?: number;
}
