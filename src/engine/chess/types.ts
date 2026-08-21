// The shapes every other workstream reads. Nothing here is prose and nothing
// here is a sentence she could say.
//
// The rule this file exists to enforce: the talking workstream owns ALL English
// about a move, and CLAUDE.md's "anything sentence-shaped in a prompt gets
// recited" is why. If this module ever emitted a phrase like "nice fork!", that
// phrase becomes a phrase bank she recites verbatim eight turns later — the
// exact failure the persona example quotes caused (recited 4/5 -> 0 after
// removal). So every field below is an enum, a number, or a SAN token, and the
// consumer composes language from them.

export type Side = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

/** A move that has been proven legal by the rules authority (chess.js). */
export interface LegalMove {
  /** Standard Algebraic Notation, e.g. "Nf3", "exd6", "O-O", "e8=Q+". */
  san: string;
  /** Long algebraic / UCI, e.g. "g1f3", "e7e8q". The stable machine key. */
  uci: string;
  from: string;
  to: string;
  by: Side;
  piece: PieceType;
  captured: PieceType | null;
  promotion: PieceType | null;
  isCapture: boolean;
  isEnPassant: boolean;
  isCastle: boolean;
  castleSide: "king" | "queen" | null;
  /** Does this move give check / mate? Computed from the position after it. */
  givesCheck: boolean;
  givesMate: boolean;
}

export type GameResult =
  | "in_progress"
  | "checkmate"
  | "stalemate"
  | "insufficient_material"
  | "threefold_repetition"
  | "fifty_move";

export interface GameStatus {
  over: boolean;
  /** Side to move in this position. */
  turn: Side;
  inCheck: boolean;
  result: GameResult;
  /** Only set for checkmate; every other terminal result is a draw. */
  winner: Side | null;
  /** Number of legal moves available to `turn`. 0 iff mate or stalemate. */
  legalMoveCount: number;
  halfmoveClock: number;
  fullmoveNumber: number;
}

/** An immutable game. Every function that advances it returns a new one. */
export interface Game {
  fen: string;
  /** Every move played, oldest first. Empty for a fresh game. */
  played: readonly PlayedMove[];
  /**
   * Position part of every FEN that has occurred, oldest first, including the
   * current one. Threefold repetition is counted from this, which is why it is
   * carried in the value rather than kept in a module-level Map: two games in
   * two tabs must not share a repetition counter.
   */
  positions: readonly string[];
  status: GameStatus;
}

export interface PlayedMove extends LegalMove {
  /** FEN before the move — so any move can be re-assessed later, standalone. */
  fenBefore: string;
  fenAfter: string;
  /** Full move number this was played on. */
  moveNumber: number;
}

export interface MoveInput {
  from: string;
  to: string;
  promotion?: PieceType;
}

// ── assessment ─────────────────────────────────────────────────────────────

/**
 * Structural facts about a move. Deliberately overlapping and non-exclusive:
 * the consumer picks whichever is worth mentioning, and having several to pick
 * from is what stops her saying the same thing about every capture.
 */
export type MoveTag =
  | "capture"
  | "recapture"
  | "en_passant"
  | "promotion"
  | "castle"
  | "check"
  | "checkmate"
  | "stalemate"
  | "forced"
  | "only_move"
  | "wins_material"
  | "loses_material"
  | "even_trade"
  | "sacrifice"
  | "hangs_piece"
  | "punishes_hang"
  | "develops"
  | "central_pawn"
  | "pawn_push"
  | "king_walk"
  | "early_queen"
  | "repetition";

export type MoveVerdict =
  | "forced"
  | "best"
  | "good"
  | "ok"
  | "inaccuracy"
  | "mistake"
  | "blunder";

/** Who is standing better AFTER the move, from the mover's point of view. */
export type Standing = "winning" | "better" | "level" | "worse" | "losing";

export type GamePhase = "opening" | "middlegame" | "endgame";

export interface HangingPiece {
  square: string;
  piece: PieceType;
  /** Centipawn value of the piece left en prise. */
  valueCp: number;
  /** The opponent move that takes it, in SAN. */
  takenBy: string;
}

export interface MoveAssessment {
  move: LegalMove;
  fenBefore: string;
  fenAfter: string;
  tags: MoveTag[];
  verdict: MoveVerdict;
  /**
   * Evaluations in centipawns, ALWAYS from the mover's point of view, so a
   * positive number is good for whoever played the move regardless of colour.
   * `cpBefore` is the position they inherited; `cpAfter` is what they handed
   * back. Mate is reported separately because a clamped ±10000 is a number the
   * consumer would otherwise have to reverse-engineer.
   */
  cpBefore: number;
  cpAfter: number;
  /** cpBefore - cpAfter. Positive means the move gave something away. */
  cpLoss: number;
  mateIn: number | null;
  /** Raw material swing of this move alone, mover's POV, in centipawns. */
  materialDeltaCp: number;
  /** Material balance after the move, mover's POV. */
  materialBalanceCp: number;
  hangs: HangingPiece | null;
  /** The move the search preferred, when it is not the one played. */
  better: string | null;
  standing: Standing;
  phase: GamePhase;
  statusAfter: GameStatus;
  /** Search effort behind cpBefore/cpAfter, so a caller can judge confidence. */
  search: SearchInfo;
}

export interface SearchInfo {
  depth: number;
  nodes: number;
  ms: number;
  /** Whether the node budget stopped the search before `maxDepth`. */
  budgetHit: boolean;
}

// ── her move ───────────────────────────────────────────────────────────────

/** Why she picked this move rather than the engine's top choice. */
export type ChoiceKind =
  /** Exactly one legal move existed. */
  | "only_move"
  /** The search's top move, on its own merits. */
  | "best"
  /** Within the strength's margin of the top move, chosen for its flavour. */
  | "near_best"
  /** A deliberate, strength-scaled slip. She is meant to be beatable. */
  | "slip"
  /** The fast search produced nothing usable; a rules-authority move was used. */
  | "fallback";

/** What made a near-best move the more appealing one. */
export type FlavourTag =
  | "capture"
  | "check"
  | "develops"
  | "castle"
  | "promotion"
  | "central_pawn"
  | "activity"
  | "quiet";

export interface RootCandidate {
  san: string;
  uci: string;
  /** Centipawns, her point of view. Exact for moves within the flavour margin;
   *  an upper bound for the rest (they failed low and are known only to be
   *  worse than the margin). `exact` says which. */
  cp: number;
  exact: boolean;
}

export interface ChoiceReason {
  kind: ChoiceKind;
  /** Strength level this was played at. */
  strength: number;
  /** How far behind the search's top move she chose to play, in centipawns. */
  cpBehindBest: number;
  flavour: FlavourTag[];
  /** Top root moves with scores, best first. Bounded; not the whole list. */
  considered: RootCandidate[];
}

export interface HerMove {
  move: LegalMove;
  fenAfter: string;
  /** The same structured assessment the user's moves get. */
  assessment: MoveAssessment;
  choice: ChoiceReason;
  search: SearchInfo;
}

export interface Strength {
  /** 1 (casual) .. 5 (as strong as this shape gets). */
  level: number;
  maxDepth: number;
  /** Hard node ceiling. This, not depth, is what bounds latency. */
  maxNodes: number;
  /** Moves within this many centipawns of best are eligible on flavour. */
  flavourMarginCp: number;
  /** Chance per move of deliberately taking a worse line, 0..1. */
  slipChance: number;
  /** How much worse a slip may be. */
  slipMarginCp: number;
  /**
   * Fixes the PRNG. Omit and it is derived from the position, which makes her
   * deterministic per position (same board -> same move) while still varying
   * across a game. Set it to make a whole session reproducible in a test.
   */
  seed?: number;
}
