// Negamax + alpha-beta + a captures-only quiescence, bounded by a NODE budget
// rather than a time budget.
//
// ── why nodes and not milliseconds ────────────────────────────────────────
//
// A wall-clock budget makes her play differently on a fast phone than on a
// slow one, and differently on the same phone under load. That breaks the one
// property the rest of this module is built on: the same board must produce
// the same move, or nothing about her play is reproducible in a test and no
// bug in it is ever reported the same way twice. A node budget is
// deterministic; latency is then bounded by measuring nodes-per-second once
// (see the header of opponent.ts for that measurement) and choosing the cap.
//
// Iterative deepening is what makes the budget safe: every depth completes
// before the next starts, so when the budget stops the search mid-depth there
// is always a finished shallower result to return. Aborting a search that has
// never completed a depth would leave her with a random move.

import { evaluate, PIECE_VALUE } from "./evaluate";
import {
  EMPTY, PAWN, QUEEN,
  F_CAPTURE, F_PROMO,
  generate, inCheck, makeMove, moveFlags, moveFrom, movePromo, moveTo,
  newUndo, typeOf, unmakeMove,
} from "./x88";
import type { Pos, Undo } from "./x88";

export const MATE_SCORE = 30000;
/** Anything past this magnitude is a mate score, not an evaluation. */
export const MATE_THRESHOLD = MATE_SCORE - 1000;

export interface SearchLimits {
  maxDepth: number;
  maxNodes: number;
  /**
   * Root moves scoring within this margin of the best get an EXACT score, so
   * the flavour picker can compare them. Everything worse is cut off and
   * reported as an upper bound. Raising this costs nodes; it is the price of
   * having alternatives to choose between.
   */
  rootMarginCp: number;
}

export interface RootMoveScore {
  move: number;
  cp: number;
  /** False means "cut off; known only to be worse than best - rootMarginCp". */
  exact: boolean;
}

export interface SearchResult {
  best: number;
  cp: number;
  depth: number;
  nodes: number;
  ms: number;
  budgetHit: boolean;
  mateIn: number | null;
  /** Every root move, best first. */
  root: RootMoveScore[];
}

interface Ctx {
  pos: Pos;
  nodes: number;
  maxNodes: number;
  aborted: boolean;
  undos: Undo[];
  killers: Int32Array;
  /**
   * One move buffer and one score buffer per ply, reused for the whole search.
   * A fresh array per node is the single largest cost in a JS search of this
   * shape — at ~60k nodes a move that is 120k allocations handed to the GC
   * inside one animation frame.
   */
  bufs: number[][];
  scoreBufs: number[][];
  /** Position hashes on the path plus the game history, for repetition. */
  repLo: number[];
  repHi: number[];
}

const MAX_PLY = 64;

/**
 * MVV-LVA: take the most valuable victim with the least valuable attacker.
 * The single highest-value ordering heuristic there is — without it the node
 * counts below roughly quadruple at the same depth.
 */
function scoreMove(ctx: Ctx, m: number, ply: number): number {
  const flags = moveFlags(m);
  if (flags & F_CAPTURE) {
    const victim = ctx.pos.board[moveTo(m)];
    const attacker = ctx.pos.board[moveFrom(m)];
    // En passant leaves `to` empty; the victim is a pawn by definition.
    const vv = victim === EMPTY ? PIECE_VALUE[PAWN] : PIECE_VALUE[typeOf(victim)];
    return 1_000_000 + vv * 16 - PIECE_VALUE[typeOf(attacker)];
  }
  if (flags & F_PROMO) return 900_000 + PIECE_VALUE[movePromo(m)];
  if (ctx.killers[ply * 2] === m) return 800_000;
  if (ctx.killers[ply * 2 + 1] === m) return 799_000;
  return 0;
}

function sortMoves(ctx: Ctx, moves: number[], ply: number): void {
  const scores = ctx.scoreBufs[ply];
  for (let i = 0; i < moves.length; i++) scores[i] = scoreMove(ctx, moves[i], ply);
  // Insertion sort: move lists are ~35 long and already partly ordered, and it
  // beats Array.sort's comparator-call overhead at this size.
  for (let i = 1; i < moves.length; i++) {
    const m = moves[i];
    const s = scores[i];
    let j = i - 1;
    while (j >= 0 && scores[j] < s) {
      moves[j + 1] = moves[j];
      scores[j + 1] = scores[j];
      j--;
    }
    moves[j + 1] = m;
    scores[j + 1] = s;
  }
}

/**
 * Has this exact position already occurred on the path or in the game?
 *
 * The last entry in repLo/repHi IS the current position — it is pushed before
 * recursing — so the scan starts two plies back, not at the end. Starting at
 * the end made every position a repetition of itself, which returned a draw
 * score from every node and made the whole search evaluate every move as 0.00.
 * It looked like a working engine that had no opinions.
 *
 * Stepping by two is not an optimisation: a position can only repeat with the
 * same side to move, so the odd indices cannot match and testing them would
 * only cost time.
 */
function isRepetition(ctx: Ctx): boolean {
  const { hashLo, hashHi } = ctx.pos;
  // Only positions since the last irreversible move can possibly repeat.
  const from = Math.max(0, ctx.repLo.length - 1 - ctx.pos.half);
  for (let i = ctx.repLo.length - 3; i >= from; i -= 2) {
    if (ctx.repLo[i] === hashLo && ctx.repHi[i] === hashHi) return true;
  }
  return false;
}

/**
 * Captures-only search at the leaves. Without it the evaluation is read in the
 * middle of an exchange and she hangs pieces to a depth-1 tactic — the single
 * most obvious "this is a bot and a bad one" tell in a shallow engine.
 */
function quiesce(ctx: Ctx, alpha: number, beta: number, ply: number): number {
  if (++ctx.nodes >= ctx.maxNodes) {
    ctx.aborted = true;
    return alpha;
  }
  const stand = evaluate(ctx.pos);
  if (stand >= beta) return beta;
  // Delta pruning: if even winning a queen for free cannot reach alpha, this
  // whole subtree is irrelevant.
  if (stand + PIECE_VALUE[QUEEN] < alpha) return alpha;
  if (stand > alpha) alpha = stand;
  if (ply >= MAX_PLY - 1) return alpha;

  const moves = ctx.bufs[ply];
  moves.length = 0;
  generate(ctx.pos, moves, true);
  sortMoves(ctx, moves, ply);
  const u = ctx.undos[ply];
  const us = ctx.pos.turn;
  for (let mi = 0; mi < moves.length; mi++) {
    const m = moves[mi];
    makeMove(ctx.pos, m, u);
    if (inCheck(ctx.pos, us)) {
      unmakeMove(ctx.pos, m, u);
      continue;
    }
    const score = -quiesce(ctx, -beta, -alpha, ply + 1);
    unmakeMove(ctx.pos, m, u);
    if (ctx.aborted) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(ctx: Ctx, depth: number, alpha: number, beta: number, ply: number): number {
  if (++ctx.nodes >= ctx.maxNodes) {
    ctx.aborted = true;
    return alpha;
  }
  if (ply > 0 && (isRepetition(ctx) || ctx.pos.half >= 100)) return 0;
  // Hard ply ceiling. The check extension below can lengthen a line without
  // bound in a perpetual-check position, and ctx.undos is a fixed array — an
  // unguarded extension reads undefined off the end and takes the whole call
  // down, which on this lane means her turn silently never arrives.
  if (ply >= MAX_PLY - 2) return evaluate(ctx.pos);
  if (depth <= 0) return quiesce(ctx, alpha, beta, ply);

  const us = ctx.pos.turn;
  const checked = inCheck(ctx.pos, us);
  // Check extension: a forced sequence is cheap to follow and expensive to
  // misjudge, and it is what stops her walking into a mate one ply past the
  // horizon.
  const d = checked ? depth + 1 : depth;

  const moves = ctx.bufs[ply];
  moves.length = 0;
  generate(ctx.pos, moves);
  sortMoves(ctx, moves, ply);
  const u = ctx.undos[ply];
  let legal = 0;
  let best = -MATE_SCORE * 2;

  for (let mi = 0; mi < moves.length; mi++) {
    const m = moves[mi];
    makeMove(ctx.pos, m, u);
    if (inCheck(ctx.pos, us)) {
      unmakeMove(ctx.pos, m, u);
      continue;
    }
    legal++;
    ctx.repLo.push(ctx.pos.hashLo);
    ctx.repHi.push(ctx.pos.hashHi);
    const score = -negamax(ctx, d - 1, -beta, -alpha, ply + 1);
    ctx.repLo.pop();
    ctx.repHi.pop();
    unmakeMove(ctx.pos, m, u);
    if (ctx.aborted) return best > -MATE_SCORE * 2 ? best : alpha;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      // Killers: quiet moves that caused a cutoff here usually do so in
      // sibling nodes too.
      if (!(moveFlags(m) & F_CAPTURE)) {
        ctx.killers[ply * 2 + 1] = ctx.killers[ply * 2];
        ctx.killers[ply * 2] = m;
      }
      break;
    }
  }

  if (legal === 0) {
    // Mate scores carry the distance so a mate in 1 is preferred over a mate
    // in 5; without the ply term she finds a mate and then shuffles forever.
    return checked ? -MATE_SCORE + ply : 0;
  }
  return best;
}

function makeCtx(pos: Pos, maxNodes: number, history: readonly string[] | undefined): Ctx {
  const undos: Undo[] = [];
  const bufs: number[][] = [];
  const scoreBufs: number[][] = [];
  for (let i = 0; i < MAX_PLY; i++) {
    undos.push(newUndo());
    bufs.push([]);
    scoreBufs.push([]);
  }
  const ctx: Ctx = {
    pos,
    nodes: 0,
    maxNodes,
    aborted: false,
    undos,
    killers: new Int32Array(MAX_PLY * 2),
    bufs,
    scoreBufs,
    repLo: [],
    repHi: [],
  };
  // The game's own repetition history arrives as hashes the caller already
  // computed; see board.ts. Passing FENs here instead would mean re-parsing
  // every past position on every search.
  if (history) {
    for (const h of history) {
      const [lo, hi] = h.split(":");
      ctx.repLo.push(Number(lo));
      ctx.repHi.push(Number(hi));
    }
  }
  return ctx;
}

/**
 * How much work runs between two interruption points on the async path.
 *
 * ~4 ms on this container, ~16-32 ms on a phone (the install base measures
 * 4-8x slower on scalar JS; see opponent.ts). Short enough that a frame is
 * not visibly dropped, long enough that the yields themselves do not cost
 * more than the search.
 *
 * This was 12,000, which is LARGER than the whole node budget of the shipped
 * strength-2 opponent (maxNodes 15,000). The async path therefore breathed
 * exactly twice per move and the longest uninterrupted block measured 11.7 ms
 * in node / 53 ms in-app — 210-420 ms of frozen UI per move on a phone. The
 * budget is a node count, not a clock, so lowering it changes only WHERE the
 * search pauses, never which move comes out: `search` and `searchAsync` stay
 * byte-identical in result by construction.
 */
const YIELD_EVERY_NODES = 4_000;

/**
 * The search, as a generator that pauses at root-move boundaries.
 *
 * This shape exists so `search` and `searchAsync` are the SAME code and
 * produce the SAME move. An async path that re-ran the search with a smaller
 * budget would return a different move on a phone than in a test, and then
 * "she blundered" would be unreproducible — which is the failure the whole
 * determinism story in this module exists to prevent. The pause points are
 * chosen by NODE COUNT, not by wall clock, for the same reason.
 */
function* searchGen(
  pos: Pos,
  limits: SearchLimits,
  repetitionHashes?: readonly string[],
): Generator<void, SearchResult, void> {
  const t0 = Date.now();
  const ctx = makeCtx(pos, limits.maxNodes, repetitionHashes);

  const rootMoves: number[] = [];
  generate(pos, rootMoves);
  // Filter to legal at the root only. Inner nodes filter inline, but the root
  // list is also the caller's candidate list, so it must be exactly legal.
  const legalRoot: number[] = [];
  const u0 = ctx.undos[0];
  for (const m of rootMoves) {
    makeMove(pos, m, u0);
    if (!inCheck(pos, pos.turn ^ 1)) legalRoot.push(m);
    unmakeMove(pos, m, u0);
  }

  if (legalRoot.length === 0) {
    return {
      best: 0,
      cp: inCheck(pos, pos.turn) ? -MATE_SCORE : 0,
      depth: 0, nodes: 0, ms: 0, budgetHit: false, mateIn: null, root: [],
    };
  }

  let ordered = legalRoot.slice();
  let finished: RootMoveScore[] = ordered.map((m) => ({ move: m, cp: 0, exact: false }));
  let bestMove = ordered[0];
  let bestCp = 0;
  let depthDone = 0;
  let lastYield = 0;

  for (let depth = 1; depth <= limits.maxDepth; depth++) {
    // Depth 1 is not optional. A budget too small to finish it leaves
    // `finished` at its all-zero initial state and `bestMove` at the first
    // move the generator happened to emit — measured at level 1 in kiwipete,
    // where 6,000 nodes was not enough for 48 root moves plus quiescence and
    // she answered Rb1 for no reason at all. One completed ply is what makes
    // the budget a strength dial instead of a randomiser, so it is exempt.
    ctx.maxNodes = depth === 1 ? Infinity : limits.maxNodes;
    const scores: RootMoveScore[] = [];
    let alpha = -MATE_SCORE * 2;
    let iterBest = ordered[0];
    let iterBestCp = -MATE_SCORE * 2;

    for (const m of ordered) {
      makeMove(pos, m, u0);
      ctx.repLo.push(pos.hashLo);
      ctx.repHi.push(pos.hashHi);
      // Root window: keep alpha-beta cutoffs, but only for moves already known
      // to be worse than the flavour margin. Anything inside the margin is
      // searched with a real window and so comes back exact — which is what
      // lets the opponent layer choose between near-best moves honestly
      // instead of comparing fail-low bounds.
      const rootAlpha = alpha === -MATE_SCORE * 2 ? alpha : alpha - limits.rootMarginCp - 1;
      const score = -negamax(ctx, depth - 1, -(MATE_SCORE * 2), -rootAlpha, 1);
      ctx.repLo.pop();
      ctx.repHi.pop();
      unmakeMove(pos, m, u0);
      if (ctx.aborted) break;
      scores.push({ move: m, cp: score, exact: score > rootAlpha });
      if (score > iterBestCp) {
        iterBestCp = score;
        iterBest = m;
      }
      if (score > alpha) alpha = score;
      if (ctx.nodes - lastYield >= YIELD_EVERY_NODES) {
        lastYield = ctx.nodes;
        yield;
      }
    }

    if (ctx.aborted) break;
    scores.sort((a, b) => b.cp - a.cp);
    finished = scores;
    bestMove = iterBest;
    bestCp = iterBestCp;
    depthDone = depth;
    // Best-first for the next iteration: this is most of what makes iterative
    // deepening cheaper than searching the final depth directly.
    ordered = scores.map((s) => s.move);
    // A forced mate is not worth deepening.
    if (Math.abs(bestCp) > MATE_THRESHOLD) break;
  }

  const mateIn =
    Math.abs(bestCp) > MATE_THRESHOLD
      ? Math.sign(bestCp) * Math.ceil((MATE_SCORE - Math.abs(bestCp)) / 2)
      : null;

  return {
    best: bestMove,
    cp: bestCp,
    depth: depthDone,
    nodes: ctx.nodes,
    ms: Date.now() - t0,
    budgetHit: ctx.aborted,
    mateIn,
    root: finished,
  };
}

/**
 * Search `pos`. Pure with respect to the caller: `pos` is restored to its
 * input state by make/unmake pairing, and nothing is cached between calls.
 */
export function search(
  pos: Pos,
  limits: SearchLimits,
  repetitionHashes?: readonly string[],
): SearchResult {
  const g = searchGen(pos, limits, repetitionHashes);
  let step = g.next();
  while (!step.done) step = g.next();
  return step.value;
}

/**
 * The same search, pausing at each checkpoint so the caller can hand the
 * thread back. `breathe` is awaited at every pause; a caller that wants real
 * frames must return a MACROTASK (setTimeout), because a microtask does not
 * let the browser paint.
 */
export async function searchAsync(
  pos: Pos,
  limits: SearchLimits,
  breathe: () => Promise<void>,
  repetitionHashes?: readonly string[],
): Promise<SearchResult> {
  const g = searchGen(pos, limits, repetitionHashes);
  let step = g.next();
  while (!step.done) {
    await breathe();
    step = g.next();
  }
  return step.value;
}
