// Static evaluation: material + piece-square tables, tapered between a
// middlegame and an endgame king table.
//
// This is deliberately the simplest evaluation that produces a recognisable
// chess personality, because the brief's constraint is "beatable and human-
// feeling", not strength. A stronger evaluation (pawn structure, mobility,
// king safety) would make her harder to beat and slower, and both of those are
// the wrong direction for this product. If she ever needs to be stronger, the
// lever is `Strength.maxDepth` / `flavourMarginCp`, not more terms here.

import {
  BISHOP, BLACK, EMPTY, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE,
  colorOf, fileOf, rankOf, typeOf,
} from "./x88";
import type { Pos } from "./x88";

/** Centipawns. Bishop over knight by 10 so she resolves the pair naturally. */
export const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 0];

/** What the king is worth for "who is winning" arithmetic — never traded. */
const MATE_MATERIAL = 0;

// Tables are written rank 8 first, the way a board is drawn, so a human can
// read them. They are indexed for WHITE; black mirrors vertically.
const PST_PAWN = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
const PST_KNIGHT = [
 -50,-40,-30,-30,-30,-30,-40,-50,
 -40,-20,  0,  0,  0,  0,-20,-40,
 -30,  0, 10, 15, 15, 10,  0,-30,
 -30,  5, 15, 20, 20, 15,  5,-30,
 -30,  0, 15, 20, 20, 15,  0,-30,
 -30,  5, 10, 15, 15, 10,  5,-30,
 -40,-20,  0,  5,  5,  0,-20,-40,
 -50,-40,-30,-30,-30,-30,-40,-50,
];
const PST_BISHOP = [
 -20,-10,-10,-10,-10,-10,-10,-20,
 -10,  0,  0,  0,  0,  0,  0,-10,
 -10,  0,  5, 10, 10,  5,  0,-10,
 -10,  5,  5, 10, 10,  5,  5,-10,
 -10,  0, 10, 10, 10, 10,  0,-10,
 -10, 10, 10, 10, 10, 10, 10,-10,
 -10,  5,  0,  0,  0,  0,  5,-10,
 -20,-10,-10,-10,-10,-10,-10,-20,
];
const PST_ROOK = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
const PST_QUEEN = [
 -20,-10,-10, -5, -5,-10,-10,-20,
 -10,  0,  0,  0,  0,  0,  0,-10,
 -10,  0,  5,  5,  5,  5,  0,-10,
  -5,  0,  5,  5,  5,  5,  0, -5,
   0,  0,  5,  5,  5,  5,  0, -5,
 -10,  5,  5,  5,  5,  5,  0,-10,
 -10,  0,  5,  0,  0,  0,  0,-10,
 -20,-10,-10, -5, -5,-10,-10,-20,
];
const PST_KING_MG = [
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -20,-30,-30,-40,-40,-30,-30,-20,
 -10,-20,-20,-20,-20,-20,-20,-10,
  20, 20,  0,  0,  0,  0, 20, 20,
  20, 30, 10,  0,  0, 10, 30, 20,
];
const PST_KING_EG = [
 -50,-40,-30,-20,-20,-30,-40,-50,
 -30,-20,-10,  0,  0,-10,-20,-30,
 -30,-10, 20, 30, 30, 20,-10,-30,
 -30,-10, 30, 40, 40, 30,-10,-30,
 -30,-10, 30, 40, 40, 30,-10,-30,
 -30,-10, 20, 30, 30, 20,-10,-30,
 -30,-30,  0,  0,  0,  0,-30,-30,
 -50,-30,-30,-30,-30,-30,-30,-50,
];

const PST = [null, PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_ROOK, PST_QUEEN, null];

/** Table index for a piece of `color` standing on 0x88 square `sq`. */
const pstIndex = (sq: number, color: number): number =>
  color === WHITE ? (7 - rankOf(sq)) * 8 + fileOf(sq) : rankOf(sq) * 8 + fileOf(sq);

/** Non-pawn, non-king material for one side, in centipawns. */
export function nonPawnMaterial(pos: Pos, color: number): number {
  let m = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = pos.board[sq];
    if (p === EMPTY || colorOf(p) !== color) continue;
    const t = typeOf(p);
    if (t !== PAWN && t !== KING) m += PIECE_VALUE[t];
  }
  return m;
}

/** Material balance in centipawns from `color`'s point of view. */
export function materialBalance(pos: Pos, color: number): number {
  let bal = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = pos.board[sq];
    if (p === EMPTY) continue;
    const t = typeOf(p);
    const v = t === KING ? MATE_MATERIAL : PIECE_VALUE[t];
    bal += colorOf(p) === color ? v : -v;
  }
  return bal;
}

/**
 * Whole-board score in centipawns, ALWAYS from the side to move's point of
 * view — negamax requires that and nothing else in this module reads it.
 */
export function evaluate(pos: Pos): number {
  let score = 0;
  let phaseMaterial = 0;
  let wKing = -1;
  let bKing = -1;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = pos.board[sq];
    if (p === EMPTY) continue;
    const t = typeOf(p);
    const c = colorOf(p);
    if (t === KING) {
      if (c === WHITE) wKing = sq; else bKing = sq;
      continue;
    }
    if (t !== PAWN) phaseMaterial += PIECE_VALUE[t];
    const v = PIECE_VALUE[t] + PST[t]![pstIndex(sq, c)];
    score += c === WHITE ? v : -v;
  }
  // Tapered king safety. Full middlegame at both sides' starting non-pawn
  // material (2 x 3190), full endgame once it is nearly gone. A hard switch
  // makes her king lurch across the board on the move a queen comes off.
  const OPENING_MATERIAL = 6380;
  const t = Math.max(0, Math.min(1, phaseMaterial / OPENING_MATERIAL));
  if (wKing >= 0) {
    const i = pstIndex(wKing, WHITE);
    score += Math.round(PST_KING_MG[i] * t + PST_KING_EG[i] * (1 - t));
  }
  if (bKing >= 0) {
    const i = pstIndex(bKing, BLACK);
    score -= Math.round(PST_KING_MG[i] * t + PST_KING_EG[i] * (1 - t));
  }
  return pos.turn === WHITE ? score : -score;
}

export type Phase = "opening" | "middlegame" | "endgame";

/**
 * Coarse phase, for the consumer to talk about. Move number matters as well as
 * material: a 12-move game with no trades is still an opening.
 */
export function phaseOf(pos: Pos): Phase {
  const mat = nonPawnMaterial(pos, WHITE) + nonPawnMaterial(pos, BLACK);
  if (mat <= 1800) return "endgame";
  if (pos.full <= 10 && mat >= 5400) return "opening";
  return "middlegame";
}

export const pieceValueOf = (t: number): number =>
  t === KNIGHT ? PIECE_VALUE[KNIGHT]
  : t === BISHOP ? PIECE_VALUE[BISHOP]
  : t === ROOK ? PIECE_VALUE[ROOK]
  : t === QUEEN ? PIECE_VALUE[QUEEN]
  : t === PAWN ? PIECE_VALUE[PAWN]
  : 0;
