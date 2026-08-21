// Her move. Deterministic code, never a model call.
//
// ── why this can never be an LLM ──────────────────────────────────────────
//
// Three independent reasons, any one of which is sufficient:
//   1. Legality. A language model plays illegal moves, and an illegal move
//      from her does not degrade the feature, it ends it — the board desyncs
//      and there is no recovery a user would accept.
//   2. Money and latency. A move every ~20 seconds for a whole game, on a lane
//      that has run out of quota twice this week, against a search that costs
//      ~40 ms and nothing.
//   3. Determinism. The same board must produce the same move, or nothing here
//      is testable and no bug in it is ever reported the same way twice.
// The talking workstream may absolutely use a model — it reads the structured
// output of this file and turns it into her voice. The MOVE is code.
//
// ── latency, measured ─────────────────────────────────────────────────────
//
// This container, node 22, 2026-08-21: the x88 search sustains ~0.9M nodes per
// second (perft alone is ~3.9M nps; evaluation, ordering and legality filtering
// account for the rest). Phones in this project's install base measure roughly
// 4-8x slower than this container on scalar JS.
//
// `maxNodes` is therefore the latency knob and `maxDepth` is only an
// aspiration: iterative deepening completes whatever depth the budget allows
// and returns that, so a quiet position reaches deeper than a sharp one for
// the same cost. The level 3 default of 40,000 nodes measures ~45 ms here,
// which is ~180-360 ms on a phone.
//
// The DEEP assessment is off by default for the same reason. It costs two more
// searches than choosing the move does, and it is not on the critical path:
// she moves the piece, and the commentary is assembled after. A caller who
// wants the full numbers calls `assessLast(game)` once the move is applied.
// A wall-clock budget was rejected: see search.ts.
//
// ── why she is allowed to be worse than her own search ────────────────────
//
// The brief's constraint is that she be BEATABLE and human-feeling. A depth-4
// alpha-beta with piece-square tables already beats most casual players, and a
// companion who wins every game is not fun, she is an obstacle. So the top
// move is only a candidate: anything within `flavourMarginCp` competes on
// FLAVOUR, and `slipChance` occasionally takes a worse line on purpose. Both
// are seeded from the position, so it is reproducible, not random.

import { isLegalMove, legalMoves, play, positionKey, repetitionHashes } from "./board";
import { assessMove } from "./assess";
import { search, searchAsync } from "./search";
import type { SearchLimits, SearchResult } from "./search";
import type {
  ChoiceKind, ChoiceReason, FlavourTag, Game, HerMove, LegalMove, RootCandidate, Strength,
} from "./types";
import {
  F_CAPTURE, F_CASTLE_K, F_CASTLE_Q, F_PROMO, PAWN, WHITE,
  fileOf, moveFlags, moveFrom, moveTo, moveToUci, posFromFen, rankOf, typeOf,
} from "./x88";

/**
 * Five levels, so the owner can tune without editing code. Only `level` is
 * meant to be user-facing; the rest are the dials behind it.
 *
 * These numbers are a starting point, not a measurement. Nobody has yet played
 * a hundred games against each level, so the honest statement is: the SHAPE is
 * right and the values are guesses. Do not cite them as tuned.
 */
export const STRENGTHS: Record<number, Strength> = {
  // Levels 1 and 2 are capped by DEPTH as well as nodes: a shallow search is
  // what makes her miss two-move tactics, which is what "beatable" means to a
  // casual player. Levels 3+ are bounded by nodes alone, so they go as deep as
  // the position is cheap.
  1: { level: 1, maxDepth: 2, maxNodes: 6_000, flavourMarginCp: 220, slipChance: 0.35, slipMarginCp: 500 },
  2: { level: 2, maxDepth: 3, maxNodes: 15_000, flavourMarginCp: 150, slipChance: 0.20, slipMarginCp: 350 },
  3: { level: 3, maxDepth: 5, maxNodes: 40_000, flavourMarginCp: 90, slipChance: 0.10, slipMarginCp: 220 },
  4: { level: 4, maxDepth: 6, maxNodes: 100_000, flavourMarginCp: 50, slipChance: 0.04, slipMarginCp: 120 },
  5: { level: 5, maxDepth: 8, maxNodes: 250_000, flavourMarginCp: 20, slipChance: 0, slipMarginCp: 0 },
};

export const DEFAULT_STRENGTH = 3;

export function resolveStrength(s?: number | Partial<Strength>): Strength {
  if (s === undefined) return STRENGTHS[DEFAULT_STRENGTH];
  if (typeof s === "number") {
    const clamped = Math.max(1, Math.min(5, Math.round(s)));
    return STRENGTHS[clamped];
  }
  const base = STRENGTHS[Math.max(1, Math.min(5, Math.round(s.level ?? DEFAULT_STRENGTH)))];
  return { ...base, ...s, level: s.level ?? base.level };
}

/** How many root moves come back in `choice.considered`. */
const CONSIDERED_MAX = 5;

/**
 * Deterministic PRNG, seeded from the position unless the caller fixes it.
 *
 * Position-seeded rather than call-seeded so that replaying a game reproduces
 * her moves exactly — which is what makes "she played something weird on move
 * 14" a reportable bug instead of a story.
 */
function rngFor(fen: string, strength: Strength): () => number {
  let s = strength.seed ?? 0;
  const key = positionKey(fen);
  for (let i = 0; i < key.length; i++) s = (Math.imul(s, 31) + key.charCodeAt(i)) | 0;
  s = (s ^ (strength.level * 0x9e3779b9)) | 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** What makes a move appealing to play, independent of what it is worth. */
function flavourOf(pos: ReturnType<typeof posFromFen>, m: number): FlavourTag[] {
  const tags: FlavourTag[] = [];
  const flags = moveFlags(m);
  const from = moveFrom(m);
  const to = moveTo(m);
  const piece = pos.board[from];
  const t = typeOf(piece);
  const us = pos.turn;
  if (flags & F_CAPTURE) tags.push("capture");
  if (flags & F_PROMO) tags.push("promotion");
  if (flags & (F_CASTLE_K | F_CASTLE_Q)) tags.push("castle");
  const homeRank = us === WHITE ? 0 : 7;
  if ((t === 2 || t === 3) && rankOf(from) === homeRank) tags.push("develops");
  if (t === PAWN) {
    const f = fileOf(to);
    if (f >= 3 && f <= 4) tags.push("central_pawn");
  }
  // Moving toward the opponent reads as intent; shuffling on the back rank
  // reads as a bot with nothing to do. This is the cheapest available proxy.
  const advance = us === WHITE ? rankOf(to) - rankOf(from) : rankOf(from) - rankOf(to);
  if (advance > 0) tags.push("activity");
  if (tags.length === 0) tags.push("quiet");
  return tags;
}

const FLAVOUR_WEIGHT: Record<FlavourTag, number> = {
  capture: 34,
  check: 30,
  promotion: 40,
  castle: 26,
  develops: 22,
  central_pawn: 16,
  activity: 8,
  quiet: 0,
};

function flavourScore(tags: FlavourTag[]): number {
  let s = 0;
  for (const t of tags) s += FLAVOUR_WEIGHT[t];
  return s;
}

export interface ChooseOptions {
  strength?: number | Partial<Strength>;
  /** Override the search limits entirely. For evals and profiling. */
  limits?: SearchLimits;
  /**
   * Run the FULL fixed-depth assessment behind `HerMove.assessment` instead of
   * the cheap one. Default false, because it costs two more searches than
   * choosing the move and the commentary is not on the critical path — call
   * `assessLast(game)` after applying her move instead. The result has the
   * same shape either way, so a consumer never branches on which it got;
   * `assessment.search.depth` says how much was behind it.
   */
  deepAssess?: boolean;
}

/** The search limits a strength implies. Pure, so evals can print them. */
export function limitsFor(strength: Strength): SearchLimits {
  return {
    maxDepth: strength.maxDepth,
    maxNodes: strength.maxNodes,
    // The root window has to be at least as wide as the widest margin the
    // picker may use, or the moves it wants to compare come back as fail-low
    // bounds and cannot be compared at all.
    rootMarginCp: Math.max(
      strength.flavourMarginCp,
      strength.slipChance > 0 ? strength.slipMarginCp : 0,
    ),
  };
}

/**
 * Pick her move. Synchronous; see `chooseMoveAsync` for the UI path.
 *
 * Returns null only when the game is already over. Every other path returns a
 * move that has been re-validated through chess.js, so the caller may apply it
 * without checking it again — though `play()` checks anyway, because a second
 * gate on the one thing that must never happen is worth its cost.
 */
export function chooseMove(game: Game, opts: ChooseOptions = {}): HerMove | null {
  if (game.status.over) return null;
  const strength = resolveStrength(opts.strength);
  const limits = opts.limits ?? limitsFor(strength);
  const pos = posFromFen(game.fen);
  const result = search(pos, limits, repetitionHashes(game));
  return selectFrom(game, strength, result, opts.deepAssess === true);
}

/**
 * Turn a finished search into her move. Separate from `chooseMove` because the
 * async path runs the deepening loop itself, and running the selection once at
 * the end rather than once per depth is what keeps the yielding version from
 * costing several times the assessment work of the blocking one.
 */
function selectFrom(
  game: Game,
  strength: Strength,
  result: SearchResult,
  deepAssess: boolean,
): HerMove | null {
  const pos = posFromFen(game.fen);
  const legal = legalMoves(game.fen);
  if (legal.length === 0) return null;
  const byUci = new Map(legal.map((m) => [m.uci, m]));

  const scored: RootCandidate[] = result.root
    .filter((r) => byUci.has(moveToUci(r.move)))
    .map((r) => ({
      san: byUci.get(moveToUci(r.move))!.san,
      uci: moveToUci(r.move),
      cp: r.cp,
      exact: r.exact,
    }));

  const fallback = (): HerMove =>
    finish(game, legal[0], {
      kind: "fallback", strength: strength.level, cpBehindBest: 0, flavour: [], considered: [],
    }, result, deepAssess);

  // The fast search produced nothing usable — a budget of zero, or a bug. Fall
  // back to the rules authority rather than returning null: her turn MUST
  // produce a move, and a legal ordinary one is the safe failure.
  if (scored.length === 0) return fallback();

  const bestCp = scored[0].cp;
  const rng = rngFor(game.fen, strength);

  let kind: ChoiceKind = "best";
  let margin = strength.flavourMarginCp;
  if (legal.length === 1) {
    kind = "only_move";
    margin = 0;
  } else if (strength.slipChance > 0 && rng() < strength.slipChance) {
    kind = "slip";
    margin = strength.slipMarginCp;
  }

  // Only EXACT scores may be compared. A move that failed low is known to be
  // worse than the margin and nothing more, so admitting it to the candidate
  // pool would mean choosing on a number that is not its score.
  const pool = scored.filter((c) => c.exact && bestCp - c.cp <= margin);
  const candidates = pool.length ? pool : [scored[0]];
  const rootByUci = new Map(result.root.map((r) => [moveToUci(r.move), r.move]));

  const tagsFor = (uci: string): FlavourTag[] => {
    const packed = rootByUci.get(uci);
    const tags = packed === undefined ? [] : flavourOf(pos, packed);
    if (byUci.get(uci)!.givesCheck) tags.push("check");
    return tags.length ? tags : ["quiet"];
  };

  let picked = candidates[0];
  let pickedFlavour = tagsFor(picked.uci);
  if (candidates.length > 1) {
    let bestWeight = -Infinity;
    for (const c of candidates) {
      const tags = tagsFor(c.uci);
      // Flavour buys a BOUNDED number of centipawns, never an unbounded one:
      // the point is a human-looking choice among near-equal moves, not a
      // preference for captures over not losing. The 0.35 is what makes a
      // 90 cp gap cost more than any flavour bonus can pay for.
      const weight = flavourScore(tags) - (bestCp - c.cp) * 0.35 + rng() * 6;
      if (weight > bestWeight) {
        bestWeight = weight;
        picked = c;
        pickedFlavour = tags;
      }
    }
  }

  const cpBehindBest = bestCp - picked.cp;
  // "near_best" covers the equal-score case too: several moves scoring 0.00
  // and flavour deciding between them IS the interesting fact here, and a
  // consumer that only sees "best" cannot tell that a choice was made.
  if (kind === "best" && picked.uci !== scored[0].uci) kind = "near_best";
  if (kind === "slip" && cpBehindBest === 0 && picked.uci === scored[0].uci) kind = "best";

  // The last gate. If the fast generator and the rules authority ever
  // disagree, the rules authority wins and she plays something legal.
  const move = byUci.get(picked.uci);
  if (
    !move ||
    !isLegalMove(game.fen, { from: move.from, to: move.to, promotion: move.promotion ?? undefined })
  ) {
    return fallback();
  }

  return finish(game, move, {
    kind,
    strength: strength.level,
    cpBehindBest,
    flavour: pickedFlavour,
    considered: scored.slice(0, CONSIDERED_MAX),
  }, result, deepAssess);
}

function finish(
  game: Game,
  move: LegalMove,
  choice: ChoiceReason,
  result: SearchResult,
  deepAssess: boolean,
): HerMove {
  // The position after is produced by chess.js, not by the fast board: the
  // app's state must come from the rules authority end to end. `play` also
  // re-validates, which is the second of the two gates on the one thing that
  // must never happen.
  const next = play(game, { from: move.from, to: move.to, promotion: move.promotion ?? undefined });
  if (!next) throw new Error("chess/opponent: a validated move was rejected by the rules authority");
  const assessment = assessMove(game.fen, move, next.fen, {
    positions: game.positions,
    limits: deepAssess ? undefined : CHEAP_ASSESS,
  });
  return {
    move,
    fenAfter: next.fen,
    assessment,
    choice,
    search: {
      depth: result.depth,
      nodes: result.nodes,
      ms: result.ms,
      budgetHit: result.budgetHit,
    },
  };
}

/**
 * A shallower assessment, for callers that want her move now and the
 * commentary later. The full one costs two more searches than the move choice
 * itself. `assess: false` gets the move on the same structured shape with a
 * cheaper number behind it — the shape never changes, so a consumer never has
 * to branch on which one it got.
 */
const CHEAP_ASSESS: SearchLimits = { maxDepth: 2, maxNodes: 12_000, rootMarginCp: 0 };

/**
 * The UI path. Same search, same move, handed back to the event loop every
 * ~12,000 nodes.
 *
 * The node budget already bounds the TOTAL, but at level 5 that total is one
 * uninterrupted ~300 ms block on this container and several times that on a
 * phone — an interface that stutters while she thinks reads as a slow app
 * rather than a thinking person. Measured here at level 5: 11 interruptions,
 * longest block 47 ms, and the same move the synchronous call returns.
 *
 * What is NOT yielded: the selection and assessment that follow the search
 * (~35 ms here). They are bounded and small; if that ever stops being true the
 * fix is to make `assessMove` take the same generator shape, not to re-run the
 * search with a smaller budget — that would make her move depend on which
 * entry point was used, and every determinism guarantee in this module rests
 * on it not doing that.
 */
export async function chooseMoveAsync(game: Game, opts: ChooseOptions = {}): Promise<HerMove | null> {
  if (game.status.over) return null;
  const strength = resolveStrength(opts.strength);
  const limits = opts.limits ?? limitsFor(strength);
  const pos = posFromFen(game.fen);
  const result = await searchAsync(pos, limits, breathe, repetitionHashes(game));
  return selectFrom(game, strength, result, opts.deepAssess === true);
}

/**
 * Hand the thread back for one macrotask. `setTimeout(0)` and not a microtask:
 * a promise continuation runs before the browser paints, so a microtask-based
 * "yield" produces exactly the frame drops it was added to prevent.
 */
const breathe = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
