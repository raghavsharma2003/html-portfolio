// The rules authority. Everything the app touches goes through here, and
// everything here goes through chess.js.
//
// The split is the whole safety story of this module: chess.js decides what is
// legal, what the SAN is, and when the game is over; x88.ts only ever decides
// which of chess.js's legal moves is a good one. A bug in the fast generator
// can therefore cost move quality and cannot produce an illegal move, because
// `play()` re-validates every move — hers included — through chess.js before
// it becomes state. See x88.ts's header for the measurement that forced the
// split.
//
// Every function here is pure: a Game is a value, `play` returns a new one,
// and there is no module-level board. Two games in two tabs, or a real game
// and a what-if line inside the assessor, must not share state.

import { Chess } from "chess.js";
import type { Move as CjsMove, PieceSymbol, Square } from "chess.js";
import type { Game, GameStatus, LegalMove, MoveInput, PieceType, PlayedMove, Side } from "./types";
import { posFromFen } from "./x88";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Position-only part of a FEN — what repetition is actually counted over. */
export function positionKey(fen: string): string {
  const p = fen.split(" ");
  return `${p[0]} ${p[1]} ${p[2]} ${p[3]}`;
}

export function isValidFen(fen: string): boolean {
  try {
    // The constructor validates; a bad FEN throws. Catching is cheaper than
    // re-implementing validateFen's rules and being subtly out of step with it.
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

function statusOf(chess: Chess, positions: readonly string[]): GameStatus {
  const moves = chess.moves();
  const turn = chess.turn() as Side;
  const inCheck = chess.inCheck();
  // Threefold is counted from the caller's own history rather than chess.js's
  // internal position map, because that map only ever sees moves played on
  // that one instance — and this module reconstructs a Chess from a FEN on
  // every call, so its internal count would always read 1.
  const here = positions.length ? positions[positions.length - 1] : positionKey(chess.fen());
  let repeats = 0;
  for (const p of positions) if (p === here) repeats++;

  let result: GameStatus["result"] = "in_progress";
  let winner: Side | null = null;
  if (moves.length === 0) {
    if (inCheck) {
      result = "checkmate";
      winner = turn === "w" ? "b" : "w";
    } else {
      result = "stalemate";
    }
  } else if (chess.isInsufficientMaterial()) {
    result = "insufficient_material";
  } else if (repeats >= 3) {
    result = "threefold_repetition";
  } else if (chess.isDrawByFiftyMoves()) {
    result = "fifty_move";
  }

  const fenParts = chess.fen().split(" ");
  return {
    over: result !== "in_progress",
    turn,
    inCheck,
    result,
    winner,
    legalMoveCount: moves.length,
    halfmoveClock: Number(fenParts[4]),
    fullmoveNumber: Number(fenParts[5]),
  };
}

/**
 * Build a LegalMove. `givesCheck`/`givesMate` are read off the position AFTER
 * the move rather than off the SAN's "+"/"#", because SAN suffixes are a
 * rendering detail and this field is the one a consumer will branch on.
 */
function describe(m: CjsMove, givesCheck: boolean, givesMate: boolean): LegalMove {
  return {
    san: m.san,
    uci: `${m.from}${m.to}${m.promotion ?? ""}`,
    from: m.from,
    to: m.to,
    by: m.color as Side,
    piece: m.piece as PieceType,
    captured: (m.captured as PieceType) ?? null,
    promotion: (m.promotion as PieceType) ?? null,
    // Derived from `captured`, NOT from chess.js's isCapture(): that method
    // tests only the plain-capture flag and returns FALSE for en passant, so
    // `m.isCapture()` on exd6 e.p. is false while `m.captured` is "p". A
    // consumer reading isCapture would have been told a capture did not
    // happen, on the one move type where that is most surprising.
    isCapture: m.captured !== undefined,
    isEnPassant: m.isEnPassant(),
    isCastle: m.isKingsideCastle() || m.isQueensideCastle(),
    castleSide: m.isKingsideCastle() ? "king" : m.isQueensideCastle() ? "queen" : null,
    givesCheck,
    givesMate,
  };
}

/**
 * Every legal move in a position, fully described.
 *
 * Costly by design — chess.js renders SAN and two FENs per move, and this then
 * plays each one to find out whether it checks. That is fine for the BOARD
 * (move hints, click targets, one call per turn) and must never be called
 * inside a search loop; that is what x88.ts is for.
 */
export function legalMoves(fen: string): LegalMove[] {
  const chess = new Chess(fen);
  const out: LegalMove[] = [];
  for (const m of chess.moves({ verbose: true })) {
    chess.move(m.san);
    out.push(describe(m, chess.inCheck(), chess.isCheckmate()));
    chess.undo();
  }
  return out;
}

export function newGame(fen: string = START_FEN): Game {
  const chess = new Chess(fen);
  const positions = [positionKey(chess.fen())];
  return { fen: chess.fen(), played: [], positions, status: statusOf(chess, positions) };
}

/**
 * Apply a move. Returns null when the move is illegal — null rather than a
 * throw because an illegal move is an ordinary event here (a mis-drag on a
 * touchscreen, or a fast-search move that failed validation), and every caller
 * has to handle it either way.
 */
export function play(game: Game, move: string | MoveInput): Game | null {
  const chess = new Chess(game.fen);
  const fenBefore = game.fen;
  const before = chess.fen().split(" ");
  let played: CjsMove;
  try {
    played = chess.move(
      typeof move === "string" ? move : { from: move.from, to: move.to, promotion: move.promotion },
    );
  } catch {
    return null;
  }
  const fenAfter = chess.fen();
  const positions = [...game.positions, positionKey(fenAfter)];
  const record: PlayedMove = {
    ...describe(played, chess.inCheck(), chess.isCheckmate()),
    fenBefore,
    fenAfter,
    moveNumber: Number(before[5]),
  };
  return {
    fen: fenAfter,
    played: [...game.played, record],
    positions,
    status: statusOf(chess, positions),
  };
}

/** Is this move legal here? The last gate before any move becomes state. */
export function isLegalMove(fen: string, move: string | MoveInput): boolean {
  const chess = new Chess(fen);
  try {
    chess.move(
      typeof move === "string" ? move : { from: move.from, to: move.to, promotion: move.promotion },
    );
    return true;
  } catch {
    return false;
  }
}

export function statusOfFen(fen: string, positions: readonly string[] = []): GameStatus {
  const chess = new Chess(fen);
  const hist = positions.length ? positions : [positionKey(fen)];
  return statusOf(chess, hist);
}

/** SAN for a UCI move, or null if it is not legal here. */
export function sanFromUci(fen: string, uci: string): string | null {
  const chess = new Chess(fen);
  try {
    return chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? (uci[4] as PieceSymbol) : undefined,
    }).san;
  } catch {
    return null;
  }
}

/** The piece standing on a square, for the UI. */
export function pieceAt(fen: string, square: string): { type: PieceType; color: Side } | null {
  const p = new Chess(fen).get(square as Square);
  return p ? { type: p.type as PieceType, color: p.color as Side } : null;
}

/**
 * Repetition history in the form the search wants: "lo:hi" Zobrist pairs.
 *
 * Computed here rather than in the search because it needs the game's past
 * FENs, and re-parsing every one of them on every search node would cost more
 * than the repetition detection saves.
 */
export function repetitionHashes(game: Game): string[] {
  const out: string[] = [];
  for (const m of game.played) {
    const p = posFromFen(m.fenAfter);
    out.push(`${p.hashLo}:${p.hashHi}`);
  }
  return out;
}
