// A 0x88 board, move generator and make/unmake — FOR THE SEARCH ONLY.
//
// ── why this exists when chess.js is right there ───────────────────────────
//
// chess.js IS the rules authority in this module (see board.ts) and nothing
// here overrides it. But it cannot back a search. Measured on this container,
// node 22, 2026-08-21, plain perft (moves() + move() + undo()):
//
//   chess.js 1.4.0   perft(4) = 197,281 nodes in 42.5 s   ~4.6k nps
//   chess.js 1.4.0   perft(3) =   8,902 nodes in  1.5 s   ~5.8k nps (SAN path)
//   chess.js 1.0.0   perft(4) = 197,281 nodes in 18.3 s  ~10.8k nps
//
// The cause is structural, not a tuning problem: 1.4.0 recomputes a BigInt
// Zobrist hash and a position-count Map on every move and undo, and every
// generated move is materialised as a Move object that renders SAN plus two
// full FENs. At ~6k nps a depth-3 search from the opening (~20k nodes) costs
// three seconds on a laptop — an order of magnitude past the phone budget in
// the brief, on a lane where latency is the product.
//
// So: rules, FEN, SAN, draw detection and — critically — final legality
// validation stay with chess.js, and only the inner search loop runs on this.
// Every move that leaves this module is re-validated through chess.js first,
// so a bug in here can cost her move QUALITY but cannot produce an illegal
// move. The correctness proof for this file is perft against the six standard
// positions (evals/chess.mjs), plus a move-for-move cross-check against
// chess.js over random positions in the same suite.
//
// Nothing in here is exported to the app. index.ts does not re-export it.

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const WHITE = 0;
export const BLACK = 1;

/** piece code = type | (colour << 3). 0 is empty, so white pieces are 1..6. */
export const typeOf = (p: number): number => p & 7;
export const colorOf = (p: number): number => (p >> 3) & 1;
export const code = (type: number, color: number): number => type | (color << 3);

// Castling rights, as bits.
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

// Move flags.
export const F_CAPTURE = 1;
export const F_EP = 2;
export const F_CASTLE_K = 4;
export const F_CASTLE_Q = 8;
export const F_DOUBLE = 16;
export const F_PROMO = 32;

// a1 = 0, h1 = 7, a8 = 112, h8 = 119. Rank index 0 is rank "1", so white
// pawns move +16. Off-board iff (sq & 0x88).
export const fileOf = (sq: number): number => sq & 7;
export const rankOf = (sq: number): number => sq >> 4;
export const onBoard = (sq: number): boolean => (sq & 0x88) === 0;

const FILES = "abcdefgh";
export function squareName(sq: number): string {
  return FILES[fileOf(sq)] + String(rankOf(sq) + 1);
}
export function squareIndex(name: string): number {
  return (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97);
}

const PROMO_CHAR: Record<number, string> = { 2: "n", 3: "b", 4: "r", 5: "q" };
const CHAR_PROMO: Record<string, number> = { n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN };

/** Moves are packed into one int32 so the search allocates nothing per node. */
export const mkMove = (from: number, to: number, promo: number, flags: number): number =>
  from | (to << 8) | (promo << 16) | (flags << 20);
export const moveFrom = (m: number): number => m & 0xff;
export const moveTo = (m: number): number => (m >> 8) & 0xff;
export const movePromo = (m: number): number => (m >> 16) & 0xf;
export const moveFlags = (m: number): number => (m >> 20) & 0x3f;

export function moveToUci(m: number): string {
  const p = movePromo(m);
  return squareName(moveFrom(m)) + squareName(moveTo(m)) + (p ? PROMO_CHAR[p] : "");
}

export interface Pos {
  board: Int8Array;
  turn: number;
  castling: number;
  /** 0x88 square behind a double pawn push, or -1. */
  ep: number;
  half: number;
  full: number;
  /** [white king square, black king square] — kept incrementally. */
  kings: Int32Array;
  hashLo: number;
  hashHi: number;
}

// ── Zobrist ────────────────────────────────────────────────────────────────
// Seeded from a constant so two builds hash a position identically. That is
// not cosmetic: her move choice is seeded from the position hash, and a hash
// that changed between builds would make "same board -> same move" false.
function xorshift32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
}
const Z_PIECE_LO = new Uint32Array(16 * 128);
const Z_PIECE_HI = new Uint32Array(16 * 128);
const Z_CASTLE_LO = new Uint32Array(16);
const Z_CASTLE_HI = new Uint32Array(16);
const Z_EP_LO = new Uint32Array(8);
const Z_EP_HI = new Uint32Array(8);
let Z_SIDE_LO = 0;
let Z_SIDE_HI = 0;
{
  const rnd = xorshift32(0x1a2b3c4d);
  for (let i = 0; i < Z_PIECE_LO.length; i++) {
    Z_PIECE_LO[i] = rnd();
    Z_PIECE_HI[i] = rnd();
  }
  for (let i = 0; i < 16; i++) {
    Z_CASTLE_LO[i] = rnd();
    Z_CASTLE_HI[i] = rnd();
  }
  for (let i = 0; i < 8; i++) {
    Z_EP_LO[i] = rnd();
    Z_EP_HI[i] = rnd();
  }
  Z_SIDE_LO = rnd();
  Z_SIDE_HI = rnd();
}

function rehash(pos: Pos): void {
  let lo = 0;
  let hi = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const p = pos.board[sq];
    if (p === EMPTY) continue;
    const i = p * 128 + sq;
    lo ^= Z_PIECE_LO[i];
    hi ^= Z_PIECE_HI[i];
  }
  lo ^= Z_CASTLE_LO[pos.castling];
  hi ^= Z_CASTLE_HI[pos.castling];
  if (pos.ep >= 0) {
    lo ^= Z_EP_LO[fileOf(pos.ep)];
    hi ^= Z_EP_HI[fileOf(pos.ep)];
  }
  if (pos.turn === BLACK) {
    lo ^= Z_SIDE_LO;
    hi ^= Z_SIDE_HI;
  }
  pos.hashLo = lo >>> 0;
  pos.hashHi = hi >>> 0;
}

// ── FEN ────────────────────────────────────────────────────────────────────

const FEN_PIECE: Record<string, number> = {
  P: code(PAWN, WHITE), N: code(KNIGHT, WHITE), B: code(BISHOP, WHITE),
  R: code(ROOK, WHITE), Q: code(QUEEN, WHITE), K: code(KING, WHITE),
  p: code(PAWN, BLACK), n: code(KNIGHT, BLACK), b: code(BISHOP, BLACK),
  r: code(ROOK, BLACK), q: code(QUEEN, BLACK), k: code(KING, BLACK),
};

/**
 * Parse a FEN. Assumes the FEN is already well-formed — chess.js validates
 * every FEN before it reaches here, and duplicating that check would mean two
 * validators that can disagree.
 */
export function posFromFen(fen: string): Pos {
  const parts = fen.trim().split(/\s+/);
  const board = new Int8Array(128);
  const kings = new Int32Array([-1, -1]);
  let rank = 7;
  let file = 0;
  for (const ch of parts[0]) {
    if (ch === "/") {
      rank--;
      file = 0;
    } else if (ch >= "1" && ch <= "8") {
      file += ch.charCodeAt(0) - 48;
    } else {
      const sq = rank * 16 + file;
      const p = FEN_PIECE[ch];
      board[sq] = p;
      if (typeOf(p) === KING) kings[colorOf(p)] = sq;
      file++;
    }
  }
  let castling = 0;
  if (parts[2] && parts[2] !== "-") {
    if (parts[2].includes("K")) castling |= CASTLE_WK;
    if (parts[2].includes("Q")) castling |= CASTLE_WQ;
    if (parts[2].includes("k")) castling |= CASTLE_BK;
    if (parts[2].includes("q")) castling |= CASTLE_BQ;
  }
  const pos: Pos = {
    board,
    turn: parts[1] === "b" ? BLACK : WHITE,
    castling,
    ep: parts[3] && parts[3] !== "-" ? squareIndex(parts[3]) : -1,
    half: parts[4] ? Number(parts[4]) : 0,
    full: parts[5] ? Number(parts[5]) : 1,
    kings,
    hashLo: 0,
    hashHi: 0,
  };
  rehash(pos);
  return pos;
}

const PIECE_FEN = ".PNBRQK..pnbrqk";

export function fenFromPos(pos: Pos): string {
  let out = "";
  for (let rank = 7; rank >= 0; rank--) {
    let run = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[rank * 16 + file];
      if (p === EMPTY) {
        run++;
      } else {
        if (run) out += run;
        run = 0;
        out += PIECE_FEN[p];
      }
    }
    if (run) out += run;
    if (rank) out += "/";
  }
  let c = "";
  if (pos.castling & CASTLE_WK) c += "K";
  if (pos.castling & CASTLE_WQ) c += "Q";
  if (pos.castling & CASTLE_BK) c += "k";
  if (pos.castling & CASTLE_BQ) c += "q";
  return (
    out +
    " " + (pos.turn === WHITE ? "w" : "b") +
    " " + (c || "-") +
    " " + (pos.ep >= 0 ? squareName(pos.ep) : "-") +
    " " + pos.half +
    " " + pos.full
  );
}

// ── attacks ────────────────────────────────────────────────────────────────

const KNIGHT_DIRS = [-33, -31, -18, -14, 14, 18, 31, 33];
const BISHOP_DIRS = [-17, -15, 15, 17];
const ROOK_DIRS = [-16, -1, 1, 16];
const KING_DIRS = [-17, -16, -15, -1, 1, 15, 16, 17];

/** Is `sq` attacked by any piece of `by`? Used for legality and for check. */
export function isAttacked(pos: Pos, sq: number, by: number): boolean {
  const b = pos.board;
  // pawns: a white pawn on sq-15/sq-17 attacks sq
  if (by === WHITE) {
    const a = sq - 17;
    const c = sq - 15;
    if (onBoard(a) && b[a] === code(PAWN, WHITE)) return true;
    if (onBoard(c) && b[c] === code(PAWN, WHITE)) return true;
  } else {
    const a = sq + 17;
    const c = sq + 15;
    if (onBoard(a) && b[a] === code(PAWN, BLACK)) return true;
    if (onBoard(c) && b[c] === code(PAWN, BLACK)) return true;
  }
  const kn = code(KNIGHT, by);
  for (let i = 0; i < 8; i++) {
    const t = sq + KNIGHT_DIRS[i];
    if (onBoard(t) && b[t] === kn) return true;
  }
  const kg = code(KING, by);
  for (let i = 0; i < 8; i++) {
    const t = sq + KING_DIRS[i];
    if (onBoard(t) && b[t] === kg) return true;
  }
  const bq = code(BISHOP, by);
  const q = code(QUEEN, by);
  for (let i = 0; i < 4; i++) {
    const d = BISHOP_DIRS[i];
    for (let t = sq + d; onBoard(t); t += d) {
      const p = b[t];
      if (p !== EMPTY) {
        if (p === bq || p === q) return true;
        break;
      }
    }
  }
  const rq = code(ROOK, by);
  for (let i = 0; i < 4; i++) {
    const d = ROOK_DIRS[i];
    for (let t = sq + d; onBoard(t); t += d) {
      const p = b[t];
      if (p !== EMPTY) {
        if (p === rq || p === q) return true;
        break;
      }
    }
  }
  return false;
}

export function inCheck(pos: Pos, color: number): boolean {
  const k = pos.kings[color];
  return k >= 0 && isAttacked(pos, k, color ^ 1);
}

// ── move generation ────────────────────────────────────────────────────────

const PROMO_TYPES = [QUEEN, ROOK, BISHOP, KNIGHT];

/**
 * Pseudo-legal moves for the side to move, appended to `out`. Legality (own
 * king left in check) is filtered by the caller during make/unmake, which is
 * the standard trade: it costs one make per move but keeps generation branch-
 * free of pin logic, and pin logic is where hand-rolled generators go wrong.
 */
export function generate(pos: Pos, out: number[], capturesOnly = false): void {
  const b = pos.board;
  const us = pos.turn;
  const them = us ^ 1;
  const forward = us === WHITE ? 16 : -16;
  const startRank = us === WHITE ? 1 : 6;
  const promoRank = us === WHITE ? 6 : 1;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = b[sq];
    if (p === EMPTY || colorOf(p) !== us) continue;
    const t = typeOf(p);

    if (t === PAWN) {
      const one = sq + forward;
      const isPromo = rankOf(sq) === promoRank;
      if (!capturesOnly && b[one] === EMPTY) {
        if (isPromo) {
          for (let i = 0; i < 4; i++) out.push(mkMove(sq, one, PROMO_TYPES[i], F_PROMO));
        } else {
          out.push(mkMove(sq, one, 0, 0));
          const two = one + forward;
          if (rankOf(sq) === startRank && b[two] === EMPTY) out.push(mkMove(sq, two, 0, F_DOUBLE));
        }
      }
      // Written out rather than looped over a literal array: an array literal
      // here allocates once per pawn per node, which at ~1e5 nodes a move is
      // the difference between a search that fits the phone budget and one
      // that spends its time in GC.
      for (let k = 0; k < 2; k++) {
        const to = sq + forward + (k === 0 ? -1 : 1);
        if (!onBoard(to)) continue;
        const tp = b[to];
        if (tp !== EMPTY && colorOf(tp) === them) {
          if (isPromo) {
            for (let i = 0; i < 4; i++) out.push(mkMove(sq, to, PROMO_TYPES[i], F_PROMO | F_CAPTURE));
          } else {
            out.push(mkMove(sq, to, 0, F_CAPTURE));
          }
        } else if (tp === EMPTY && to === pos.ep) {
          out.push(mkMove(sq, to, 0, F_CAPTURE | F_EP));
        }
      }
      continue;
    }

    if (t === KNIGHT || t === KING) {
      const dirs = t === KNIGHT ? KNIGHT_DIRS : KING_DIRS;
      for (let i = 0; i < 8; i++) {
        const to = sq + dirs[i];
        if (!onBoard(to)) continue;
        const tp = b[to];
        if (tp === EMPTY) {
          if (!capturesOnly) out.push(mkMove(sq, to, 0, 0));
        } else if (colorOf(tp) === them) {
          out.push(mkMove(sq, to, 0, F_CAPTURE));
        }
      }
      continue;
    }

    const dirs = t === BISHOP ? BISHOP_DIRS : t === ROOK ? ROOK_DIRS : KING_DIRS;
    const n = t === QUEEN ? 8 : 4;
    for (let i = 0; i < n; i++) {
      const d = dirs[i];
      for (let to = sq + d; onBoard(to); to += d) {
        const tp = b[to];
        if (tp === EMPTY) {
          if (!capturesOnly) out.push(mkMove(sq, to, 0, 0));
          continue;
        }
        if (colorOf(tp) === them) out.push(mkMove(sq, to, 0, F_CAPTURE));
        break;
      }
    }
  }

  if (capturesOnly) return;

  // Castling. Standard chess only — the app has no Chess960 mode, and guessing
  // at one would be untested code on a path that must never produce an illegal
  // move. The three squares that must be safe are king-from, king-through and
  // king-to; the rook may be attacked.
  const kSq = pos.kings[us];
  if (kSq >= 0 && !isAttacked(pos, kSq, them)) {
    const kBit = us === WHITE ? CASTLE_WK : CASTLE_BK;
    const qBit = us === WHITE ? CASTLE_WQ : CASTLE_BQ;
    if (
      pos.castling & kBit &&
      b[kSq + 1] === EMPTY &&
      b[kSq + 2] === EMPTY &&
      !isAttacked(pos, kSq + 1, them) &&
      !isAttacked(pos, kSq + 2, them)
    ) {
      out.push(mkMove(kSq, kSq + 2, 0, F_CASTLE_K));
    }
    if (
      pos.castling & qBit &&
      b[kSq - 1] === EMPTY &&
      b[kSq - 2] === EMPTY &&
      b[kSq - 3] === EMPTY &&
      !isAttacked(pos, kSq - 1, them) &&
      !isAttacked(pos, kSq - 2, them)
    ) {
      out.push(mkMove(kSq, kSq - 2, 0, F_CASTLE_Q));
    }
  }
}

// ── make / unmake ──────────────────────────────────────────────────────────

export interface Undo {
  captured: number;
  capturedSq: number;
  castling: number;
  ep: number;
  half: number;
  hashLo: number;
  hashHi: number;
}

export const newUndo = (): Undo => ({
  captured: 0, capturedSq: -1, castling: 0, ep: -1, half: 0, hashLo: 0, hashHi: 0,
});

// Rights are revoked by any move touching these squares, whichever side moves.
const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[0] = 15 & ~CASTLE_WQ;    // a1
CASTLE_MASK[4] = 15 & ~(CASTLE_WK | CASTLE_WQ); // e1
CASTLE_MASK[7] = 15 & ~CASTLE_WK;    // h1
CASTLE_MASK[112] = 15 & ~CASTLE_BQ;  // a8
CASTLE_MASK[116] = 15 & ~(CASTLE_BK | CASTLE_BQ); // e8
CASTLE_MASK[119] = 15 & ~CASTLE_BK;  // h8

function xorPiece(pos: Pos, p: number, sq: number): void {
  const i = p * 128 + sq;
  pos.hashLo = (pos.hashLo ^ Z_PIECE_LO[i]) >>> 0;
  pos.hashHi = (pos.hashHi ^ Z_PIECE_HI[i]) >>> 0;
}

export function makeMove(pos: Pos, m: number, u: Undo): void {
  const b = pos.board;
  const from = moveFrom(m);
  const to = moveTo(m);
  const flags = moveFlags(m);
  const promo = movePromo(m);
  const piece = b[from];
  const us = pos.turn;

  u.castling = pos.castling;
  u.ep = pos.ep;
  u.half = pos.half;
  u.hashLo = pos.hashLo;
  u.hashHi = pos.hashHi;
  u.captured = EMPTY;
  u.capturedSq = -1;

  // Old ep and castling contributions come off the hash before the state moves.
  if (pos.ep >= 0) {
    pos.hashLo = (pos.hashLo ^ Z_EP_LO[fileOf(pos.ep)]) >>> 0;
    pos.hashHi = (pos.hashHi ^ Z_EP_HI[fileOf(pos.ep)]) >>> 0;
  }
  pos.hashLo = (pos.hashLo ^ Z_CASTLE_LO[pos.castling]) >>> 0;
  pos.hashHi = (pos.hashHi ^ Z_CASTLE_HI[pos.castling]) >>> 0;

  if (flags & F_EP) {
    const capSq = to - (us === WHITE ? 16 : -16);
    u.captured = b[capSq];
    u.capturedSq = capSq;
    xorPiece(pos, u.captured, capSq);
    b[capSq] = EMPTY;
  } else if (b[to] !== EMPTY) {
    u.captured = b[to];
    u.capturedSq = to;
    xorPiece(pos, u.captured, to);
  }

  xorPiece(pos, piece, from);
  b[from] = EMPTY;
  const placed = promo ? code(promo, us) : piece;
  b[to] = placed;
  xorPiece(pos, placed, to);

  if (typeOf(piece) === KING) pos.kings[us] = to;

  if (flags & F_CASTLE_K) {
    const rFrom = to + 1;
    const rTo = to - 1;
    const rook = b[rFrom];
    xorPiece(pos, rook, rFrom);
    b[rFrom] = EMPTY;
    b[rTo] = rook;
    xorPiece(pos, rook, rTo);
  } else if (flags & F_CASTLE_Q) {
    const rFrom = to - 2;
    const rTo = to + 1;
    const rook = b[rFrom];
    xorPiece(pos, rook, rFrom);
    b[rFrom] = EMPTY;
    b[rTo] = rook;
    xorPiece(pos, rook, rTo);
  }

  pos.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
  pos.ep = flags & F_DOUBLE ? from + (us === WHITE ? 16 : -16) : -1;
  pos.half = typeOf(piece) === PAWN || u.captured !== EMPTY ? 0 : pos.half + 1;
  if (us === BLACK) pos.full++;
  pos.turn = us ^ 1;

  pos.hashLo = (pos.hashLo ^ Z_CASTLE_LO[pos.castling] ^ Z_SIDE_LO) >>> 0;
  pos.hashHi = (pos.hashHi ^ Z_CASTLE_HI[pos.castling] ^ Z_SIDE_HI) >>> 0;
  if (pos.ep >= 0) {
    pos.hashLo = (pos.hashLo ^ Z_EP_LO[fileOf(pos.ep)]) >>> 0;
    pos.hashHi = (pos.hashHi ^ Z_EP_HI[fileOf(pos.ep)]) >>> 0;
  }
}

export function unmakeMove(pos: Pos, m: number, u: Undo): void {
  const b = pos.board;
  const from = moveFrom(m);
  const to = moveTo(m);
  const flags = moveFlags(m);
  const promo = movePromo(m);
  const us = pos.turn ^ 1;

  pos.turn = us;
  if (us === BLACK) pos.full--;
  pos.castling = u.castling;
  pos.ep = u.ep;
  pos.half = u.half;
  pos.hashLo = u.hashLo;
  pos.hashHi = u.hashHi;

  const moved = promo ? code(PAWN, us) : b[to];
  b[from] = moved;
  b[to] = EMPTY;
  if (typeOf(moved) === KING) pos.kings[us] = from;

  if (u.captured !== EMPTY) b[u.capturedSq] = u.captured;

  if (flags & F_CASTLE_K) {
    b[to + 1] = b[to - 1];
    b[to - 1] = EMPTY;
  } else if (flags & F_CASTLE_Q) {
    b[to - 2] = b[to + 1];
    b[to + 1] = EMPTY;
  }
}

/** Legal moves, fully filtered. Used by tests and by the root, not inner nodes. */
export function generateLegal(pos: Pos): number[] {
  const pseudo: number[] = [];
  generate(pos, pseudo);
  const out: number[] = [];
  const u = newUndo();
  const us = pos.turn;
  for (const m of pseudo) {
    makeMove(pos, m, u);
    if (!inCheck(pos, us)) out.push(m);
    unmakeMove(pos, m, u);
  }
  return out;
}

/**
 * Node count to depth `depth`. This is the correctness proof for everything
 * above: castling rights, en-passant legality, promotion counts and pin
 * handling all show up as a wrong number against the published values.
 */
export function perft(pos: Pos, depth: number): number {
  if (depth === 0) return 1;
  const moves: number[] = [];
  generate(pos, moves);
  const u = newUndo();
  const us = pos.turn;
  let nodes = 0;
  for (const m of moves) {
    makeMove(pos, m, u);
    if (!inCheck(pos, us)) nodes += depth === 1 ? 1 : perft(pos, depth - 1);
    unmakeMove(pos, m, u);
  }
  return nodes;
}

/** Parse "e2e4" / "e7e8q" into the packed form, against a position. */
export function uciToMove(pos: Pos, uci: string): number {
  const from = squareIndex(uci.slice(0, 2));
  const to = squareIndex(uci.slice(2, 4));
  const promo = uci.length > 4 ? CHAR_PROMO[uci[4]] : 0;
  for (const m of generateLegal(pos)) {
    if (moveFrom(m) === from && moveTo(m) === to && movePromo(m) === (promo || 0)) return m;
  }
  return 0;
}
