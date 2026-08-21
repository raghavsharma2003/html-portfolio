// Her move. Deterministic code, never a model call — same three reasons
// `src/engine/chess/opponent.ts` gives (legality, cost, determinism), and the
// same conclusion: the MOVE is code, the TALK is the model.
//
// ── why she is allowed to be worse than perfect ────────────────────────────
//
// Perfect tic-tac-toe never loses. A companion who never loses at a thirty-
// second game is not a companion, she is a wall — so this file is built
// around one split, deliberately stronger than chess's flavour-margin idea
// because the game is small enough to make it exact rather than approximate:
//
//   1. IMMEDIATE TACTICS ARE (ALMOST) NEVER MISSED. If she can win this turn,
//      she takes it. If he can win next turn unless she blocks, she blocks.
//      These are read directly off the board (`winningCells`), not off the
//      full game-tree search below, and only the EASIEST level has any
//      chance of missing one — `missWinChance` / `missBlockChance` are zero
//      at every other level.
//   2. EVERYTHING ELSE IS A QUALITY DIAL. When no immediate tactic applies,
//      she plays the game-theoretically best cell with probability
//      `optimalChance` and a "merely decent" one otherwise — a legal cell
//      that is not the single worst score available, not a random one.
//
// This is why a companion at the lowest level still feels like she is
// TRYING, rather than trolling: the only thing she is willing to miss is a
// long-range plan, never the thing sitting in front of her.
//
// ── the search itself ──────────────────────────────────────────────────────
//
// The full tic-tac-toe game tree is tiny (at most 9! sequences, ~5,478 unique
// reachable board states) so "search" here is exact minimax to the leaves,
// memoized by board+turn. That memo is a pure transposition table — every
// entry is a game-theoretic fact about a BOARD, true regardless of which game
// or which tab reached it — which is a different shape from chess's
// `positions` array (SPEC-GAMES.md §5): that counts repetitions in ONE game's
// history and would corrupt if shared, this caches a fact that never changes.
// Sharing it across every game in the process is not just safe, it is the
// point.

import { legalCells, statusOfBoard, winningCells } from "./board";
import type { Cell, Game, Mark, Strength } from "./types";

/**
 * Three levels — a smaller ladder than chess's five, because the game itself
 * is smaller and "beatable" has a hard ceiling here that chess doesn't have:
 * even the top level still loses `optimalChance`-of-the-time worth of games
 * to a truly perfect opponent, on lines where the "decent" tier alone was not
 * enough to save her (see the numbers in evals/ttt.mjs). Not tuned against
 * played games — the SHAPE is deliberate, the numbers are a starting point,
 * same caveat chess's STRENGTHS carries.
 */
export const STRENGTHS: Record<number, Strength> = {
  1: { level: 1, optimalChance: 0.45, missWinChance: 0.12, missBlockChance: 0.12 },
  2: { level: 2, optimalChance: 0.7, missWinChance: 0, missBlockChance: 0 },
  3: { level: 3, optimalChance: 0.95, missWinChance: 0, missBlockChance: 0 },
};

export const DEFAULT_STRENGTH = 2;

export function resolveStrength(s?: number | Partial<Strength>): Strength {
  if (s === undefined) return STRENGTHS[DEFAULT_STRENGTH];
  if (typeof s === "number") {
    const clamped = Math.max(1, Math.min(3, Math.round(s)));
    return STRENGTHS[clamped];
  }
  const base = STRENGTHS[Math.max(1, Math.min(3, Math.round(s.level ?? DEFAULT_STRENGTH)))];
  return { ...base, ...s, level: s.level ?? base.level };
}

/**
 * Deterministic PRNG, seeded from the board unless the caller fixes it —
 * same construction as chess's `rngFor`, same reason: replaying a game must
 * reproduce her moves exactly, so "she played something weird" is a
 * reportable bug rather than a story that cannot be pinned down.
 */
function rngFor(board: readonly (Mark | null)[], turn: Mark, strength: Strength): () => number {
  let s = strength.seed ?? 0;
  const key = board.map((c) => c ?? ".").join("") + turn;
  for (let i = 0; i < key.length; i++) s = (Math.imul(s, 31) + key.charCodeAt(i)) | 0;
  s = (s ^ (strength.level * 0x9e3779b9)) | 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function pick(cells: readonly Cell[], rng: () => number): Cell {
  return cells[Math.floor(rng() * cells.length) % cells.length];
}

// ── exact minimax, memoized by board+turn ──────────────────────────────────
//
// `outcome(board, turn)` is the best result `turn` can force from this board
// with optimal play by both sides from here on: 1 = a forced win, 0 = a
// forced draw (best available), -1 = a forced loss. The memo is module-level
// on purpose — see the file header for why that is safe here and would not
// be for chess's repetition counter.
const outcomeMemo = new Map<string, 1 | 0 | -1>();

function outcome(board: readonly (Mark | null)[], turn: Mark): 1 | 0 | -1 {
  // A board handed in here is always evaluated BEFORE `turn` has moved, so if
  // it is already terminal, the opponent completed it (or filled it) on the
  // move before — `turn` is never the winner in this branch, only a drawer
  // or a loser. `statusOfBoard` is the single source of that fact, shared
  // with `board.ts` and `tttTalk.ts` rather than re-derived a third time.
  const status = statusOfBoard(board, turn);
  if (status.over) return status.result === "draw" ? 0 : -1;

  const key = board.map((c) => c ?? ".").join("") + turn;
  const cached = outcomeMemo.get(key);
  if (cached !== undefined) return cached;

  const oppOf: Mark = turn === "x" ? "o" : "x";
  let best: 1 | 0 | -1 = -1;
  for (let i = 0; i < 9 && best !== 1; i++) {
    if (board[i] !== null) continue;
    const next = board.slice();
    next[i] = turn;
    const oppVal = outcome(next, oppOf);
    const val: 1 | 0 | -1 = oppVal === -1 ? 1 : oppVal === 1 ? -1 : 0;
    if (val > best) best = val;
  }
  outcomeMemo.set(key, best);
  return best;
}

/** The minimax value of playing `mark` at `cell` right now, from `mark`'s
 *  own point of view — i.e. what `outcome` reports one ply later, negated. */
function scoreCell(board: readonly (Mark | null)[], mark: Mark, cell: Cell): 1 | 0 | -1 {
  const next = board.slice();
  next[cell] = mark;
  const oppOf: Mark = mark === "x" ? "o" : "x";
  const opp = outcome(next, oppOf);
  return opp === -1 ? 1 : opp === 1 ? -1 : 0;
}

/**
 * Her move. Returns null only when the game is already over or has no empty
 * cell — mirroring chess's `chooseMove`, so a caller never needs a special
 * case for "there was nothing to play".
 */
export function herTttMove(game: Game, opts: { strength?: number | Partial<Strength> } = {}): Cell | null {
  if (game.status.over) return null;
  const cells = legalCells(game);
  if (cells.length === 0) return null;
  if (cells.length === 1) return cells[0];

  const mark = game.status.turn;
  const opp: Mark = mark === "x" ? "o" : "x";
  const strength = resolveStrength(opts.strength);
  const rng = rngFor(game.board, mark, strength);

  // Tier 1: an immediate win. Almost never missed.
  const wins = winningCells(game.board, mark);
  if (wins.length > 0 && rng() >= strength.missWinChance) {
    return pick(wins, rng);
  }

  // Tier 2: an immediate block. Almost never missed.
  const blocks = winningCells(game.board, opp);
  if (blocks.length > 0 && rng() >= strength.missBlockChance) {
    return pick(blocks, rng);
  }

  // Tier 3: no forced tactic (or a deliberate miss of one) — ordinary quality
  // selection off the exact search.
  const scored = cells.map((c) => ({ cell: c, score: scoreCell(game.board, mark, c) }));
  const bestScore = Math.max(...scored.map((s) => s.score));
  const best = scored.filter((s) => s.score === bestScore).map((s) => s.cell);
  if (rng() < strength.optimalChance) return pick(best, rng);

  // "Merely decent": among the moves that are NOT the top tier, still prefer
  // the least-bad of them — a human who isn't trying their hardest still
  // avoids the single worst legal move, they just stop optimizing past that.
  const rest = scored.filter((s) => s.score !== bestScore);
  const pool = rest.length ? rest : scored;
  const poolBest = Math.max(...pool.map((s) => s.score));
  const decent = pool.filter((s) => s.score === poolBest).map((s) => s.cell);
  return pick(decent, rng);
}
