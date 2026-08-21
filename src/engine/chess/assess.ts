// Structured facts about a move — hers and his, through the same function.
//
// This is the interface the TALKING workstream reads, and the reason it is
// structured rather than written is CLAUDE.md's first hard-won prompt rule:
// anything sentence-shaped gets recited. If this file returned "that was a
// blunder, you hung your knight", that string becomes a phrase bank she reads
// out verbatim eight turns later in an unrelated conversation — measured twice
// already in this repo. So: enums, numbers and SAN tokens only. No English.
//
// The same function assesses both players deliberately. A separate "his move"
// path would drift from the "her move" path, and the first thing a consumer
// will do is compare the two ("was that better than what I did") — which is
// only meaningful if the numbers come from one search at one depth.

import { positionKey, sanFromUci, statusOfFen } from "./board";
import { materialBalance, phaseOf, PIECE_VALUE } from "./evaluate";
import { MATE_THRESHOLD, search } from "./search";
import type { SearchLimits } from "./search";
import type {
  Game, HangingPiece, LegalMove, MoveAssessment, MoveTag, MoveVerdict,
  PieceType, SearchInfo, Standing,
} from "./types";
import {
  KING, PAWN, WHITE,
  colorOf, moveTo, moveToUci, posFromFen, squareIndex, squareName, typeOf,
} from "./x88";

/**
 * Assessment depth is fixed and is NOT the opponent's strength.
 *
 * If it tracked strength, a weak opponent would also mis-report the user's
 * blunders, and "she didn't notice I hung my queen" reads as her being broken
 * rather than her being easy — the opposite of the intent. So commentary is
 * always judged at the same depth, whoever is playing.
 */
export const ASSESS_LIMITS: SearchLimits = {
  // Depth is an aspiration and nodes are the bound. Iterative deepening means
  // a quiet position is judged deeper than a sharp one for the same cost,
  // which is the right way round: sharp positions are where the budget runs
  // out and where a shallower honest answer beats a deeper truncated one.
  maxDepth: 5,
  maxNodes: 30_000,
  rootMarginCp: 0,
};

// Centipawn loss thresholds. Roughly the public convention (Lichess-style) so
// that a "blunder" here means what it means everywhere else; a private scale
// would make the numbers uncomparable to anything the owner has ever seen.
const BLUNDER_CP = 300;
const MISTAKE_CP = 150;
const INACCURACY_CP = 60;
const GOOD_CP = 25;

/** Material swing large enough to be worth calling material at all. */
const MATERIAL_CP = 90;

const STANDING_WINNING = 300;
const STANDING_BETTER = 80;

function standingOf(cp: number): Standing {
  if (cp >= STANDING_WINNING) return "winning";
  if (cp >= STANDING_BETTER) return "better";
  if (cp > -STANDING_BETTER) return "level";
  if (cp > -STANDING_WINNING) return "worse";
  return "losing";
}

/** Clamp mate scores to a number a consumer can put on a bar without checking. */
const clampCp = (cp: number): number =>
  Math.abs(cp) > MATE_THRESHOLD ? Math.sign(cp) * 10000 : cp;

const DEVELOPING_PIECE: Record<PieceType, boolean> = {
  n: true, b: true, r: false, q: false, k: false, p: false,
};

export interface AssessOptions {
  limits?: SearchLimits;
  /** Prior positions, for repetition. Supplied automatically by assessLast. */
  positions?: readonly string[];
}

/**
 * Assess one move. `fenBefore` must be the position the move was played in.
 *
 * Two searches, both from the MOVER's point of view: what was available before
 * the move, and what is left after it. Their difference is the only honest
 * definition of "how bad was that" — a verdict read off the move's own shape
 * (it was a capture, it gave check) says nothing about whether it was good.
 */
export function assessMove(
  fenBefore: string,
  move: LegalMove,
  fenAfter: string,
  opts: AssessOptions = {},
): MoveAssessment {
  const limits = opts.limits ?? ASSESS_LIMITS;
  const history = opts.positions ?? [];

  const posBefore = posFromFen(fenBefore);
  const posAfter = posFromFen(fenAfter);
  const mover = posBefore.turn;

  const before = search(posBefore, limits);
  // The after-search runs for the OPPONENT, so its score is negated to stay in
  // the mover's frame. Every cp field in the result is the mover's frame; a
  // consumer that has to remember whose turn it is will get it wrong.
  const after = search(posAfter, limits);
  const cpBefore = clampCp(before.cp);
  const cpAfter = clampCp(-after.cp);
  const cpLoss = cpBefore - cpAfter;

  const statusAfter = statusOfFen(fenAfter, [...history, positionKey(fenAfter)]);
  const onlyMove = statusOfFen(fenBefore).legalMoveCount === 1;

  const bestUci = before.best ? moveToUci(before.best) : null;
  const better = bestUci && bestUci !== move.uci ? bestUci : null;

  const materialDeltaCp = move.captured
    ? PIECE_VALUE[pieceIndex(move.captured)] -
      (move.promotion ? PIECE_VALUE[PAWN] - PIECE_VALUE[pieceIndex(move.promotion)] : 0)
    : move.promotion
      ? PIECE_VALUE[pieceIndex(move.promotion)] - PIECE_VALUE[PAWN]
      : 0;
  const materialBalanceCp = materialBalance(posAfter, mover);

  const hangs = findHang(fenAfter, after, cpLoss);

  const verdict: MoveVerdict = onlyMove
    ? "forced"
    : cpLoss >= BLUNDER_CP ? "blunder"
    : cpLoss >= MISTAKE_CP ? "mistake"
    : cpLoss >= INACCURACY_CP ? "inaccuracy"
    : better === null ? "best"
    : cpLoss <= GOOD_CP ? "good"
    : "ok";

  const tags = tagsFor({
    move, cpLoss, materialDeltaCp, hangs, onlyMove, statusAfter,
    posBeforeTurn: mover, fenBefore, cpBefore, cpAfter,
  });

  const searchInfo: SearchInfo = {
    depth: Math.min(before.depth, after.depth),
    nodes: before.nodes + after.nodes,
    ms: before.ms + after.ms,
    budgetHit: before.budgetHit || after.budgetHit,
  };

  return {
    move,
    fenBefore,
    fenAfter,
    tags,
    verdict,
    cpBefore,
    cpAfter,
    cpLoss,
    // Mate DELIVERED is mateIn 0. The after-search sees a position with no
    // legal moves and returns no mate distance at all, so the terminal case is
    // read off the status instead — otherwise the one move a consumer most
    // wants to talk about is the one with a null here.
    mateIn:
      statusAfter.result === "checkmate" ? 0
      : after.mateIn === null ? null
      : -after.mateIn,
    materialDeltaCp,
    materialBalanceCp,
    hangs,
    better: better ? sanFromUci(fenBefore, better) : null,
    standing: standingOf(cpAfter),
    phase: phaseOf(posAfter),
    statusAfter,
    search: searchInfo,
  };
}

/** Assess the move that was just played in `game`. Null if none has been. */
export function assessLast(game: Game, opts: AssessOptions = {}): MoveAssessment | null {
  const last = game.played.at(-1);
  if (!last) return null;
  return assessMove(last.fenBefore, last, last.fenAfter, {
    ...opts,
    positions: opts.positions ?? game.positions.slice(0, -1),
  });
}

// ── the pieces of it ───────────────────────────────────────────────────────

const PIECE_INDEX: Record<PieceType, number> = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
const pieceIndex = (p: PieceType): number => PIECE_INDEX[p];

/**
 * Does this move leave something hanging?
 *
 * Read off the opponent's OWN best reply rather than a static exchange
 * evaluator: an SEE over attacker lists is blind to x-rays and to the case
 * where the "hanging" piece is defended by a pin, and both of those produce a
 * confident wrong claim — which is worse than no claim, because the consumer
 * will say it out loud.
 */
function findHang(
  fenAfter: string,
  after: ReturnType<typeof search>,
  cpLoss: number,
): HangingPiece | null {
  if (cpLoss < MISTAKE_CP) return null;
  if (!after.best) return null;
  const reply = after.best;
  const pos = posFromFen(fenAfter);
  const target = moveTo(reply);
  const victim = pos.board[target];
  if (victim === 0) return null;
  const t = typeOf(victim);
  if (t === KING) return null;
  const valueCp = PIECE_VALUE[t];
  if (valueCp < MATERIAL_CP) return null;
  const san = sanFromUci(fenAfter, moveToUci(reply));
  if (!san) return null;
  return { square: squareName(target), piece: fenPieceType(t), valueCp, takenBy: san };
}

const TYPE_CHAR: PieceType[] = ["p", "p", "n", "b", "r", "q", "k"];
const fenPieceType = (t: number): PieceType => TYPE_CHAR[t];

interface TagInput {
  move: LegalMove;
  cpLoss: number;
  materialDeltaCp: number;
  hangs: HangingPiece | null;
  onlyMove: boolean;
  statusAfter: MoveAssessment["statusAfter"];
  posBeforeTurn: number;
  fenBefore: string;
  cpBefore: number;
  cpAfter: number;
}

function tagsFor(i: TagInput): MoveTag[] {
  const tags: MoveTag[] = [];
  const m = i.move;
  if (m.isCapture) tags.push("capture");
  if (m.isEnPassant) tags.push("en_passant");
  if (m.promotion) tags.push("promotion");
  if (m.isCastle) tags.push("castle");
  if (m.givesCheck && !m.givesMate) tags.push("check");
  if (i.statusAfter.result === "checkmate") tags.push("checkmate");
  if (i.statusAfter.result === "stalemate") tags.push("stalemate");
  if (i.statusAfter.result === "threefold_repetition") tags.push("repetition");
  if (i.onlyMove) { tags.push("only_move"); tags.push("forced"); }

  if (i.materialDeltaCp >= MATERIAL_CP && i.cpLoss < MISTAKE_CP) tags.push("wins_material");
  else if (m.isCapture && Math.abs(i.materialDeltaCp) < MATERIAL_CP) tags.push("even_trade");
  if (i.hangs) tags.push("hangs_piece");
  if (i.cpLoss >= BLUNDER_CP) tags.push("loses_material");
  // A sacrifice is material given up on purpose: down material, evaluation
  // holds. The cpLoss test is what separates it from a plain blunder, and
  // without it every hung piece would be reported as brilliance.
  if (i.materialDeltaCp < 0 && i.cpLoss < INACCURACY_CP) tags.push("sacrifice");
  if (m.isCapture && i.materialDeltaCp >= MATERIAL_CP && i.cpAfter - i.cpBefore >= MATERIAL_CP) {
    tags.push("punishes_hang");
  }

  const pos = posFromFen(i.fenBefore);
  const from = squareIndex(m.from);
  const homeRank = i.posBeforeTurn === WHITE ? 0 : 7;
  if (DEVELOPING_PIECE[m.piece] && from >> 4 === homeRank) tags.push("develops");
  if (m.piece === "p") {
    tags.push("pawn_push");
    const file = squareIndex(m.to) & 7;
    if (file >= 3 && file <= 4) tags.push("central_pawn");
  }
  if (m.piece === "k" && !m.isCastle) tags.push("king_walk");
  // "Queen out early" is a real chess-culture observation and a good thing for
  // her to have available; the move-number bound is what keeps it from firing
  // in a middlegame where the queen belongs out.
  if (m.piece === "q" && pos.full <= 6) tags.push("early_queen");

  return tags;
}

/**
 * Was this a recapture? Needs the PREVIOUS move, which assessMove does not
 * take, so it is exposed separately for the caller that has the game.
 */
export function isRecapture(game: Game): boolean {
  const n = game.played.length;
  if (n < 2) return false;
  const last = game.played[n - 1];
  const prev = game.played[n - 2];
  return last.isCapture && prev.isCapture && last.to === prev.to;
}

/** Material each side holds, in centipawns. For a captured-pieces strip. */
export function materialCount(fen: string): { w: number; b: number } {
  const pos = posFromFen(fen);
  let w = 0;
  let b = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = pos.board[sq];
    if (p === 0) continue;
    const t = typeOf(p);
    if (t === KING) continue;
    if (colorOf(p) === WHITE) w += PIECE_VALUE[t]; else b += PIECE_VALUE[t];
  }
  return { w, b };
}
