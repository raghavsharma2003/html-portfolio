// The chess → activity adapter. The ONLY place chess becomes words.
//
// `src/engine/chess/` deliberately emits enums and numbers and no English at
// all — it has an eval asserting that. This file is where its structured
// verdict becomes the handful of facts she is given, and it is separate for a
// reason worth stating: the rules module has to be provable, and prose is not
// provable. Keeping them apart means the search can be rewritten without
// touching a word she might say, and the wording can be tuned without risking
// a single legal move.
//
// WHAT THIS FILE MAY NOT DO, and the eval enforces it: write a line she could
// SAY. `recited-prompt` measured her own example quotes recited on 4 of 5
// turns. Everything below is a fact in the third person about the position —
// telegraphic, ≤14 words, never sentence-shaped, never first-person. "arre
// blunder tha yeh" belongs to her; "he hung the queen on f7" belongs here.
//
// ── the second failure mode, which is the harder one ──────────────────────
//
// The first is her sounding like a scoresheet (`chess-facts-as-a-scoresheet`).
// The second is her sounding like a COMMENTATOR: calling every move a crisis,
// because a fact that fires on every move is a fact that means nothing. The
// threat facts below are all bounded — mate only inside five moves, a hanging
// piece only when the search actually found one, a piece "close to the king"
// only when it CLOSED distance to within two squares, a file "opening" only
// when the last pawn actually left it this move. A quiet developing move in a
// normal position must produce none of them, and the eval asserts exactly that
// as its negative control.
//
// It also may not SEARCH. Everything here is read off a `MoveAssessment` that
// the assessment layer already produced, plus the FEN's own piece placement.
// A second search in the talking layer would be a second, drifting opinion —
// the `age-tier-never-realtime` fork shape — and it would cost a search per
// spoken sentence.

import type { ActivityState } from "./activity";
import type { Game, MoveAssessment, PieceType, Side } from "./chess";
import { SCHOLARS_NAME, openingName } from "./chess";

/** Coarse bands, never a centipawn number she could read out loud. */
function standingFact(a: MoveAssessment, herSide: Side): string {
  // `standing` is in the MOVER's frame; flip it when the mover was him.
  const moverIsHer = a.move && a.fenBefore.split(" ")[1] === herSide;
  const s = a.standing;
  const flip: Record<string, string> = {
    winning: "losing",
    better: "worse",
    level: "level",
    worse: "better",
    losing: "winning",
  };
  const fromHer = moverIsHer ? s : (flip[s] ?? s);
  if (fromHer === "level") return "position is about level";
  return `she is ${fromHer}`;
}

const LEVEL = "position is about level";

/** `ActivityState.facts` rows are ≤14 words. Shapelint enforces it downstream. */
const MAX_FACT_WORDS = 14;

const TAG_FACT: Partial<Record<string, string>> = {
  checkmate: "that is checkmate",
  check: "it was a check",
  capture: "it took a piece",
  en_passant: "it was an en passant",
  promotion: "a pawn promoted",
  castle: "they castled",
  hangs_piece: "it left a piece hanging",
  punishes_hang: "it punished a hanging piece",
  sacrifice: "it was a sacrifice",
  wins_material: "it won material",
  loses_material: "it gave material away",
  early_queen: "the queen came out early",
  develops: "it developed a piece",
  forced: "there was nothing else to play",
};

const VERDICT_FACT: Partial<Record<string, string>> = {
  blunder: "a bad one",
  mistake: "a mistake",
  inaccuracy: "slightly off",
  best: "the best move there",
  good: "a good one",
};

const PIECE_WORD: Record<PieceType, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

// ── reading the board, without a board module ──────────────────────────────
//
// Piece placement only, straight off the FEN string. This is not chess logic
// and it must never become chess logic: no move generation, no attack maps, no
// evaluation. `src/engine/chess/` owns all of that and is the only thing
// allowed to be right about it. What is here is "which squares hold what",
// which is the FEN's first field spelled out, and it is here rather than behind
// an import because `pieceAt` costs a full position parse per square and these
// facts want the whole board.

/** grid[0] is rank 8, grid[r][f] with f=0 meaning the a-file. "" is empty. */
type Grid = readonly string[][];

const FILES = "abcdefgh";

interface Sq {
  /** 0..7, a..h */
  f: number;
  /** 0..7, rank 1..rank 8 */
  r: number;
}

function gridOf(fen: string): Grid {
  const out: string[][] = [];
  for (const row of fen.split(" ")[0].split("/")) {
    const line: string[] = [];
    for (const ch of row) {
      const n = ch.charCodeAt(0) - 48;
      if (n >= 1 && n <= 8) for (let i = 0; i < n; i++) line.push("");
      else line.push(ch);
    }
    out.push(line);
  }
  return out;
}

function sqOf(name: string | null | undefined): Sq | null {
  if (!name || name.length < 2) return null;
  const f = FILES.indexOf(name[0]);
  const r = Number(name[1]) - 1;
  if (f < 0 || !Number.isInteger(r) || r < 0 || r > 7) return null;
  return { f, r };
}

function kingSquare(g: Grid, side: Side): Sq | null {
  const want = side === "w" ? "K" : "k";
  for (let row = 0; row < 8; row++) {
    for (let f = 0; f < 8; f++) if (g[row]?.[f] === want) return { f, r: 7 - row };
  }
  return null;
}

function pawnsOnFile(g: Grid, f: number): number {
  let n = 0;
  for (let row = 0; row < 8; row++) {
    const p = g[row]?.[f];
    if (p === "P" || p === "p") n++;
  }
  return n;
}

function heavyOnFile(g: Grid, f: number, side: Side): boolean {
  const mine = side === "w" ? ["R", "Q"] : ["r", "q"];
  for (let row = 0; row < 8; row++) if (mine.includes(g[row]?.[f] ?? "")) return true;
  return false;
}

const chebyshev = (a: Sq, b: Sq): number => Math.max(Math.abs(a.f - b.f), Math.abs(a.r - b.r));

// ── the threat facts ───────────────────────────────────────────────────────

/**
 * Mate distances beyond this are not said out loud. A depth-5 assessment can
 * report a long mate it half-sees, and "mate in 9" from someone who then does
 * not deliver it is worse than her having said nothing.
 */
const MAX_MATE_DISTANCE = 5;

/** How close a piece has to get before it counts as coming at the king. */
const NEAR_KING = 2;

/** Being in check with this few replies is the thing a club player remarks on. */
const CORNERED_MOVES = 3;

/** Pieces that threaten a king from a distance. A pawn beside it is not news. */
const ATTACKER: Partial<Record<PieceType, boolean>> = { n: true, b: true, r: true, q: true };

interface Pressure {
  /** Set iff a mate is on the board somewhere inside MAX_MATE_DISTANCE. */
  mate: string | null;
  /** Facts that outrank a verdict: someone is about to lose something now. */
  urgent: string[];
  /** Facts that are worth saying only when nothing louder happened. */
  ambient: string[];
}

function pressureOf(a: MoveAssessment, herSide: Side): Pressure {
  const empty: Pressure = { mate: null, urgent: [], ambient: [] };
  if (!a?.move || a.statusAfter?.over) return empty;

  const mover = a.fenBefore.split(" ")[1] === herSide;
  const theirs = mover ? "her" : "his";
  const foes = mover ? "his" : "her";

  const urgent: string[] = [];
  const ambient: string[] = [];

  // 1. mate. `mateIn` is in MOVES, mover's frame: positive means the mover is
  //    the one delivering it. Flipping it into HER frame is the whole job,
  //    because "mate in 2" with the wrong owner is the most alarming possible
  //    thing to get backwards.
  let mate: string | null = null;
  if (a.mateIn !== null && a.mateIn !== 0) {
    const forHer = mover ? a.mateIn : -a.mateIn;
    const n = Math.abs(forHer);
    if (n <= MAX_MATE_DISTANCE) {
      mate = forHer > 0
        ? `she has mate in ${n}`
        : `mate is threatened on her king in ${n}`;
      urgent.push(mate);
    }
  }

  // 2. a hanging piece. `hangs` is found from the OPPONENT's own best reply, so
  //    the piece en prise belongs to whoever just moved — and it carries the
  //    piece type, so nothing has to be looked up to name it.
  //
  //    Not when a mate is already on the board. `hangs` reads the opponent's
  //    best reply, and when that reply is mate the "hanging" piece is whatever
  //    the mating move happened to land on — which produced "mate is threatened
  //    on her king in 1, her pawn is hanging on f7" for scholar's mate. The
  //    pawn is not the story and mentioning it makes her look like she missed
  //    the mate she just reported.
  if (a.hangs && !mate) {
    urgent.push(`${theirs} ${PIECE_WORD[a.hangs.piece]} is hanging on ${a.hangs.square}`);
  }

  // 3. in check with almost nothing to play. `legalMoveCount` is the count for
  //    the side to move, which after a checking move is the side in check.
  const st = a.statusAfter;
  if (st?.inCheck && st.legalMoveCount > 0 && st.legalMoveCount <= CORNERED_MOVES) {
    const who = st.turn === herSide ? "she" : "he";
    urgent.push(
      st.legalMoveCount === 1
        ? `${who} is in check with one legal move left`
        : `${who} is in check with only ${st.legalMoveCount} legal moves`,
    );
  }

  // 4. the owner's ask, literally: *"the bishop has moved near the king, this
  //    kind of thing is targeting the king now."* Bounded to a piece that
  //    CLOSED distance to within two squares of the enemy king, which is what
  //    keeps Nf3 and Bb5 — five and three squares away, and aimed at pawns —
  //    from reading as an attack every single opening.
  const near = nearKingFact(a, theirs, foes);
  if (near) ambient.push(near);

  // 5. a file that just came open pointing at a king, with a heavy piece
  //    already on it. Derived by comparing the pawns on that file before and
  //    after this move, so "opening up" is a thing that literally just
  //    happened rather than a standing feature of the position.
  const file = openFileFact(a, foes);
  if (file) ambient.push(file);

  return { mate, urgent, ambient };
}

function nearKingFact(a: MoveAssessment, theirs: string, foes: string): string | null {
  const m = a.move;
  if (!ATTACKER[m.piece]) return null;
  const to = sqOf(m.to);
  const from = sqOf(m.from);
  if (!to || !from) return null;
  const king = kingSquare(gridOf(a.fenAfter), m.by === "w" ? "b" : "w");
  if (!king) return null;
  const now = chebyshev(to, king);
  // Strictly closer, or it is a piece that was already there and shuffling —
  // which is not news and would fire on every retreat and return.
  if (now > NEAR_KING || now >= chebyshev(from, king)) return null;
  return `${theirs} ${PIECE_WORD[m.piece]} has come up close to ${foes} king`;
}

function openFileFact(a: MoveAssessment, foes: string): string | null {
  const m = a.move;
  const before = gridOf(a.fenBefore);
  const after = gridOf(a.fenAfter);
  const king = kingSquare(after, m.by === "w" ? "b" : "w");
  if (!king) return null;
  // Only the files this move touched can have changed, and only a pawn leaving
  // a file can open it.
  for (const name of [m.from, m.to]) {
    const s = sqOf(name);
    if (!s) continue;
    if (pawnsOnFile(before, s.f) === 0) continue;
    if (pawnsOnFile(after, s.f) !== 0) continue;
    if (Math.abs(s.f - king.f) > 1) continue;
    if (!heavyOnFile(after, s.f, m.by)) continue;
    return `the ${FILES[s.f]}-file is opening up toward ${foes} king`;
  }
  return null;
}

/**
 * Every threat fact this position supports, most urgent first.
 *
 * Usually EMPTY, and that is the point — see the commentator note in this
 * file's header. Exported so the eval can assert the negative control directly
 * rather than inferring it from a rendered block.
 */
export function threatFacts(a: MoveAssessment, herSide: Side): string[] {
  const p = pressureOf(a, herSide);
  return [...p.urgent, ...p.ambient];
}

/**
 * The one-line fact for a move that was just played — the per-move poke.
 *
 * Names the move in algebraic, which is BOTH what a person says out loud and
 * what the honesty allowlist needs: an identifier she emits that was not in
 * her input is treated as invented, so a move she is expected to discuss has
 * to be a move she was handed.
 */
export function moveFact(a: MoveAssessment, herSide: Side, whoMoved: "her" | "him"): string {
  const who = whoMoved === "her" ? "she" : "he";
  // THREE clauses, hard. The first version allowed six and produced "she played
  // Qxf7+, a bad one, it took a piece, it was a check, f7 is hanging, she is
  // losing" — which is a scoresheet being read out, blew the 14-word row limit,
  // and overflowed the block so that whose-turn-it-is fell off the end.
  //
  // A person across a board notices ONE thing about a move and says it. So:
  // the move, the single most salient thing about it, and where that leaves
  // them. Tag order below is the order a human would notice in.
  const bits: string[] = [`${who} played ${a.move.san ?? a.move.uci ?? ""}`.trim()];
  const p = pressureOf(a, herSide);
  // A mate on the board and a piece hanging both beat "a good one" — that is
  // the whole reason the threat facts exist, and a verdict band is the blandest
  // true thing that can be said about a move. But a BLUNDER outranks the
  // ambient facts: when the move was simply bad, "a bad one" is what a person
  // says, not that a bishop wandered nearer the king.
  const grave =
    a.verdict === "blunder" ? VERDICT_FACT.blunder
    : a.verdict === "mistake" ? VERDICT_FACT.mistake
    : null;
  const headline =
    (a.statusAfter?.over ? "that ends it" : null) ??
    p.urgent[0] ??
    grave ??
    p.ambient[0] ??
    VERDICT_FACT[a.verdict] ??
    a.tags.map((t) => TAG_FACT[t]).find(Boolean) ??
    null;
  if (headline) bits.push(headline);
  const standing = standingFact(a, herSide);
  // Two clauses is a complete thought and three is the ceiling, not the target.
  // The standing clause is dropped when it adds nothing:
  //
  //  - a mate on the board already says who is winning;
  //  - "position is about level" on move three is true of nearly every opening
  //    ever played — a tic, not an observation, and in the opening it is
  //    exactly the row that pushes the opening's NAME out of a 420-byte block;
  //  - "position is about level" tacked onto a threat is worse than a tic, it
  //    is a contradiction in tone ("the h-file is opening up toward her king,
  //    position is about level") and it was the one row that broke the 14-word
  //    limit in testing.
  //
  // A quiet middlegame move with nothing else to say keeps it, because there
  // "about level" is the actual news.
  const vacuous =
    standing === LEVEL && (a.phase === "opening" || p.urgent.length > 0 || p.ambient.length > 0);
  if (!a.statusAfter?.over && !p.mate && !vacuous) bits.push(standing);
  // The 14-word row limit is a CONTRACT, not a target, and the standing clause
  // is the one that goes when a row is at the edge — it is the least specific
  // thing in the line and the only one that is true of the position rather than
  // of the move. Enforced here rather than by keeping every headline string
  // short enough by hand: the next headline someone adds will be longer than
  // they think, and a row over the limit fails silently at the far end of the
  // pipe (`silent-truncation`) rather than here.
  while (bits.length > 2 && bits.join(", ").split(/\s+/).length > MAX_FACT_WORDS) bits.pop();
  return bits.join(", ");
}

/**
 * One line for a COMPLETED exchange: his move and her answer together.
 *
 * The per-move poke used to describe only the latest move — which, after her
 * engine answers ~300ms behind his, was always HER move. The debounce meant
 * the one note that survived described her own play, so on calls she narrated
 * herself ("she played Nf6, a good one") every single exchange, which reads
 * exactly as robotic as it sounds. A person talks about the exchange: what he
 * did, and what she did about it — with HIS move carrying the salience,
 * because his move is the one she is actually responding to.
 */
export function exchangeFact(
  his: MoveAssessment,
  hers: MoveAssessment | null,
  herSide: Side,
): string {
  const base = moveFact(his, herSide, "him");
  if (!hers?.move?.san) return base;
  if (hers.statusAfter?.over) return `${base}; she answered ${hers.move.san} and that ends it`;
  return `${base}; she answered ${hers.move.san}`;
}

/**
 * TENSE IS LAW: the clause that closes the choice.
 *
 * The owner heard her play a move and then, seconds later, say she SHOULD play
 * the move that was already on the board. The mechanism is not the wording of
 * any one fact — `moveFact` and `exchangeFact` are both already past tense. It
 * is that a note describing what happened does not, on its own, say that
 * NOTHING IS PENDING. Handed "he played Qh5; she answered Nf6" a model with a
 * frozen prompt that said "it is her move" at connect will happily deliberate
 * about the move it was just told she made.
 *
 * So every note about a move carries the state of the CHOICE alongside the
 * state of the board: her move is on the board and there is nothing to decide,
 * or it genuinely is her turn and it is not played yet. That second branch is
 * the only one in which a deliberative register is ever correct, and on the
 * live lane it is unreachable by construction (the poke fires on a COMPLETED
 * exchange), which is exactly the guarantee this function exists to make
 * checkable rather than assumed.
 *
 * Telegraphic, third person, ≤14 words, not a line she could say — the same law
 * as every other row in this file.
 */
export function settledClause(game: Game, herSide: Side): string {
  // A finished game closes the choice by itself, and louder than this could.
  if (game.status?.over) return "";
  if (!game.played.length) return game.status?.turn === herSide ? "she opens, nothing played yet" : "";
  return game.status?.turn === herSide
    ? "it is her turn, her move is not played yet"
    : "her move is already on the board, his turn now";
}

/**
 * THE NOTE THE LIVE LANE SENDS. One function, so the composition is a thing
 * that can be tested rather than a line of assembly at the call site.
 *
 * It is not a convenience wrapper. The defect this fixes was born of exactly
 * the assembly it replaces: the poke site built a past-tense fact and sent it,
 * and the clause that says the CHOICE IS CLOSED did not exist. Building the
 * note here means a caller cannot send the fact without the clause, and the
 * eval can tense-check the real thing instead of a re-assembly of its parts.
 *
 * `his` is the move she is answering, when there is one — the exchange carries
 * more salience than either half (`exchange-not-move`).
 */
export function chessMoveNote(
  game: Game,
  herSide: Side,
  his: MoveAssessment | null,
  hers: MoveAssessment,
  lastMover: "her" | "him",
): string {
  const fact =
    his && lastMover === "her" ? exchangeFact(his, hers, herSide) : moveFact(hers, herSide, lastMover);
  return [fact, settledClause(game, herSide)].filter(Boolean).join("; ");
}

/** Past this many plies the opening is over and its name is no longer news. */
const OPENING_FACT_PLY = 16;

// ── BOARD TRUTH: the one line she may not talk past ────────────────────────
//
// Tester report, 2026-08-25: she declared checkmate in the middle of a live
// game, and she replayed the previous game's content as if it were the board
// in front of them. Both are the same absence — the block carried whose move
// it was and what had just been played, and nothing in it stated, as a fact,
// WHERE THIS GAME STANDS.
//
// `ActivityState.state` is that fact, and it is derived HERE from
// `game.status` — the rules authority's own reading of the position, the same
// object `verdict` on screen is drawn from. It is never assembled from a fact
// row, never inferred from a move's tags, and never touched by a model. That
// is the entire property `STATE_LAW` in activity.ts leans on: a fence is only
// worth its bytes when the thing it points at cannot itself be wrong.
//
// Two shapes, and no third:
//   in progress, move N       — the game is live, whatever else is happening
//   <ending>                  — and the ending names its winner or says there
//                               is none, because "the game ended" with nobody
//                               named is what lets her fill a winner in.

/**
 * The machine-derived state line. Pure, total, search-free.
 *
 * `endedEarly` is the session's, exactly as `chessRecord` takes it and for the
 * same reason: only the session knows the difference between "no result yet"
 * and "he stopped playing", and a board put away by hand is a board she must
 * not claim a result on.
 */
export function chessGameState(game: Game, herSide: Side, endedEarly = false): string {
  const st = game?.status;
  const moves = Math.ceil((game?.played?.length ?? 0) / 2);
  if (st?.over) {
    if (st.result === "checkmate") {
      return `checkmate, ${st.winner === herSide ? "she" : "he"} won`;
    }
    const how =
      st.result === "stalemate" ? "stalemate"
      : st.result === "insufficient_material" ? "not enough pieces left"
      : st.result === "threefold_repetition" ? "the same position three times"
      : st.result === "fifty_move" ? "fifty moves with no progress"
      : "";
    return `the game ended in a draw${how ? `, ${how}` : ""}, nobody won`;
  }
  // Ended by hand. It IS over — she may not go on playing it — and it has no
  // result, which the line says out loud so the fence's "if it names no
  // winner there is none" clause has something to bite on.
  if (endedEarly) return `the game ended early on move ${moves}, no result, nobody won`;
  return `in progress, move ${moves || 1}`;
}

// ── HER IDEA: the substrate under "what's your plan" ───────────────────────
//
// Same tester, same session: *"what's your idea behind this opening"* → "mai
// bhul gayi". She was not being evasive and she was not forgetting. The block
// carried the board and not one byte about what SHE was trying to do with it,
// so there was nothing to answer from — the `chess-facts-as-a-scoresheet`
// failure seen from the other side.
//
// Derived from HER OWN MOVES against the book that already exists
// (`openings.ts`) plus a phase-and-shape reading of the position. Never a
// model, never prose, and never a line she could say: it is a noun phrase in
// the third person, the same shape as an opening name, and the eval holds it
// to the ≤14-word contract every other row here lives under.
//
// A wrong plan is worse than no plan, exactly as a wrong opening name is
// (`openings.ts`'s own law). So every branch below is read off something that
// is literally on the board — a rook she actually moved to a file, a piece
// that is actually within three squares of his king, a pawn count — and the
// fallbacks are deliberately the vaguest true things rather than the most
// interesting ones.

/** Pieces that count as "coming at the king" for the plan reading. Pawns do
 *  not: a pawn beside his king is a pawn storm's result, not its intent, and
 *  the king itself is never its own attacker. */
const PLAN_ATTACKER = new Set(["n", "b", "r", "q"]);

/** How close one of her pieces has to be to his king before the plan reads as
 *  an attack. Three, not `NEAR_KING`'s two: this is a standing feature of the
 *  position rather than a thing that just happened, so it may be looser. */
const PLAN_NEAR_KING = 3;

/** Two of them, not one. A single knight near his king is where knights go;
 *  two pieces aimed at the same king is a plan. */
const PLAN_ATTACKERS_MIN = 2;

/** Below this many heavy+minor pieces on the board it is an endgame and the
 *  plan is an endgame plan, whatever the move number says. */
const PLAN_ENDGAME_PIECES = 6;

/** Material edge, in whole pawns, before "up material" is the plan. */
const PLAN_MATERIAL_EDGE = 2;

const PIECE_CP: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

interface Shape {
  /** her non-king, non-pawn pieces within PLAN_NEAR_KING of his king */
  nearKing: number;
  /** she has castled in this game */
  castled: boolean;
  /** distinct squares her knights and bishops have landed on */
  developed: number;
  /** she has a pawn on one of the four central squares */
  centre: boolean;
  /** total minor+major pieces left on the board, both sides */
  pieces: number;
  /** her material minus his, in whole pawns */
  edge: number;
}

function shapeOf(game: Game, herSide: Side): Shape {
  const grid = gridOf(game.fen);
  const theirKing = kingSquare(grid, herSide === "w" ? "b" : "w");
  let nearKing = 0;
  let pieces = 0;
  let edge = 0;
  let centre = false;
  for (let row = 0; row < 8; row++) {
    for (let f = 0; f < 8; f++) {
      const p = grid[row]?.[f];
      if (!p) continue;
      const white = p === p.toUpperCase();
      const mine = white === (herSide === "w");
      const t = p.toLowerCase();
      edge += (mine ? 1 : -1) * (PIECE_CP[t] ?? 0);
      if (t !== "p" && t !== "k") pieces++;
      const sq: Sq = { f, r: 7 - row };
      if (mine && t === "p" && sq.f >= 3 && sq.f <= 4 && sq.r >= 3 && sq.r <= 4) centre = true;
      if (mine && theirKing && PLAN_ATTACKER.has(t) && chebyshev(sq, theirKing) <= PLAN_NEAR_KING) {
        nearKing++;
      }
    }
  }
  const mine = game.played.filter((m) => m.by === herSide);
  return {
    nearKing,
    castled: mine.some((m) => m.isCastle),
    developed: new Set(mine.filter((m) => m.piece === "n" || m.piece === "b").map((m) => m.to)).size,
    centre,
    pieces,
    edge,
  };
}

/**
 * One clause for what she is trying to do, most specific first. Exported so
 * the eval can drive the ladder directly instead of inferring which branch
 * fired from a rendered block.
 */
export function chessPlanClause(game: Game, herSide: Side): string {
  const s = shapeOf(game, herSide);
  if (s.pieces <= PLAN_ENDGAME_PIECES) {
    return s.edge >= PLAN_MATERIAL_EDGE
      ? "endgame now, trading down while she is up material"
      : "endgame now, pushing pawns and keeping her king active";
  }
  if (s.nearKing >= PLAN_ATTACKERS_MIN) {
    return s.castled
      ? "castled, pieces already pointed at their king"
      : "pieces pointed at their king";
  }
  if (s.edge >= PLAN_MATERIAL_EDGE) return "up material, happy to trade pieces off";
  if (!s.castled && s.developed >= 2) return "getting the pieces out, king safe first";
  if (s.centre) return "holding the centre, developing behind it";
  return "developing pieces, keeping the centre flexible";
}

/**
 * HER IDEA, as one telegraphic row: the opening's name when the book knows it,
 * and what she is trying to do with the position either way.
 *
 * "" before she has played a move — she cannot have a plan for a game she has
 * not started, and inventing one is the defect wearing a nicer hat.
 */
export function chessIdea(game: Game, herSide: Side): string {
  if (!game?.played?.length) return "";
  if (game.status?.over) return "";
  const book = openingName(game.played.map((m) => m.san));
  // THE ONE BOOK ENTRY THAT IS NOT HERS TO CLAIM. Every other name describes
  // the game both of them are in — "the italian game" is as true of her side
  // as of his. The scholar's-mate shape describes what ONE player is trying to
  // do, and on the board where SHE is the one being mated at, "her idea: the
  // four-move checkmate try" is the most confidently wrong row this file could
  // emit. It still reaches her: `chessActivity` keeps its own "the opening is
  // …" fact row for exactly the names this line drops.
  const name = book && book !== SCHOLARS_NAME ? book : null;
  const plan = chessPlanClause(game, herSide);
  const row = [name, plan].filter(Boolean).join(", ");
  // The ≤14-word contract, enforced rather than hoped for — the same reason
  // `moveFact` enforces it. The NAME is what survives: it is the specific half
  // and the half a person actually asks about.
  return row.split(/\s+/).length <= MAX_FACT_WORDS ? row : (name ?? plan);
}

// ── the DURABLE half: what is still true about this game next week ─────────
//
// `chessActivity`'s `facts` are the present moment and are correct to be: they
// answer "where does this stand right now". The memory layer used to store
// exactly those rows and nothing else, which meant a finished game was
// remembered as "he ended the game early, no result; she is playing black; 6
// moves in". Not one move. No opening at all past ply 16, because the opening
// row is deliberately suppressed once it stops being news IN THE MOMENT — and
// "which opening did we play" is the single most likely thing to be asked
// about a game afterwards.
//
// The first external tester asked exactly that, two days later, and she
// invented an answer: "d4 chal ke b2 se bishop fianchetto kiya tha tune …
// catalan thi na woh?" — of which only `d4` was real. That is not a gate
// failure first, it is a RECORD failure: there was nothing to answer from.
//
// So the durable rows are built here, beside the momentary ones, from the same
// `Game` and with the same laws (telegraphic, ≤14 words, third person, not a
// line she could say, no centipawns, no FEN).

/** How many plies of the opening go into the record, in SAN. Six is three
 *  moves each — the part of a game a person can actually replay from memory,
 *  and enough that the opening is identifiable even when the book does not
 *  name it. A full move list is a scoresheet, which is the thing this file
 *  exists to not produce. */
export const RECORD_OPENING_PLIES = 6;

const PIECE_PLURAL: Record<PieceType, string> = {
  p: "pawns",
  n: "knights",
  b: "bishops",
  r: "rooks",
  q: "queens",
  k: "kings",
};

/** "his queen, a rook and 3 pawns" — or "" when nothing was taken. */
function captureClause(taken: readonly PieceType[], whose: "his" | "her"): string {
  if (!taken.length) return "";
  // Heaviest first: a queen is the capture a person remembers, a pawn is not.
  const ORDER: PieceType[] = ["q", "r", "b", "n", "p"];
  const counts = new Map<PieceType, number>();
  for (const p of taken) counts.set(p, (counts.get(p) ?? 0) + 1);
  const parts: string[] = [];
  for (let i = 0; i < ORDER.length; i++) {
    const p = ORDER[i];
    const n = counts.get(p) ?? 0;
    if (!n) continue;
    // "1 pawns" is the shape a count-formatter reaches on its own, and it is
    // the tell that a sentence was assembled rather than said. One of a thing
    // is "a pawn"; the possessive lands on the FIRST item only, so the row
    // reads as one phrase instead of a list of separately-owned pieces.
    const head = parts.length ? "" : `${whose} `;
    parts.push(n === 1 ? `${head || "a "}${PIECE_WORD[p]}` : `${head}${n} ${PIECE_PLURAL[p]}`);
  }
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The rows that outlive the game. Pure, search-free, and deliberately kind to
 * the budget: four rows, each of them a thing a person actually carries.
 *
 * `endedEarly` is passed rather than inferred because the session owns it —
 * `state/game.ts` keeps the distinction between "nobody won" and "he stopped
 * playing", and conflating them is how she ends up gloating over a game that
 * had no result.
 */
export function chessRecord(game: Game, herSide: Side, endedEarly = false): string[] {
  const rows: string[] = [];
  const sans = game.played.map((m) => m.san).filter(Boolean);
  const moves = Math.ceil(sans.length / 2);

  // 1. HOW IT OPENED. The name is looked up over the WHOLE line, not the
  //    first sixteen plies: `openingName` already walks back from the longest
  //    book prefix it can find, and a forty-move game still had an opening.
  if (sans.length) {
    const opened = sans.slice(0, RECORD_OPENING_PLIES).join(" ");
    const name = openingName(sans);
    rows.push(`opened ${opened}${name ? `, ${name}` : ""}`);
  }

  // 2. WHICH SIDE SHE HAD. Past tense, because this row is a memory — the
  //    live block says "she is playing white" and that row is its own.
  rows.push(`she had ${herSide === "w" ? "white" : "black"}`);

  // 3. HOW IT ENDED, and the three endings are three different memories.
  const st = game.status;
  if (st?.over && st.result === "checkmate") {
    rows.push(`${st.winner === herSide ? "she" : "he"} won by checkmate on move ${moves}`);
  } else if (st?.over) {
    const how =
      st.result === "stalemate" ? "stalemate"
      : st.result === "insufficient_material" ? "not enough pieces left"
      : st.result === "threefold_repetition" ? "the same position three times"
      : st.result === "fifty_move" ? "fifty moves with no progress"
      : "";
    rows.push(`a draw${how ? `, ${how}` : ""}, after ${moves} moves`);
  } else if (endedEarly) {
    // The abandoned game, stated as abandoned AND located. "he left it
    // unfinished" without a move number is a memory with no shape; the tester
    // walked away mid-game and she needs to be able to say where.
    rows.push(
      sans.length
        ? `he left it unfinished on move ${moves}, no result`
        : "he left it before a move was played",
    );
  } else {
    rows.push(`still unfinished at move ${moves}`);
  }

  // 4. WHAT WAS TAKEN. One row for both sides — the exchange is the memory,
  //    not two independent inventories.
  const herTook: PieceType[] = [];
  const hisTook: PieceType[] = [];
  for (const m of game.played) {
    if (!m.captured) continue;
    (m.by === herSide ? herTook : hisTook).push(m.captured);
  }
  //    Two rows rather than one joined clause: a joined "she took his queen, a
  //    rook and 3 pawns, he took her 2 pawns" runs to exactly the 14-word
  //    ceiling, and a row at the ceiling is a row the filter below silently
  //    deletes WHOLE — losing both halves to save one. Split, the budget can
  //    only ever cost the second.
  const hers = captureClause(herTook, "his");
  const his = captureClause(hisTook, "her");
  if (hers) rows.push(`she took ${hers}`);
  if (his) rows.push(`he took ${his}`);
  if (!hers && !his && sans.length) rows.push("nothing was captured either side");

  // 5. WHERE IT WAS WHEN IT STOPPED — the last move, and only for a game that
  //    outran its own opening. Under seven plies the opening row above already
  //    IS the whole game and repeating its last token is noise. Last, because
  //    it is the most droppable row here and the drop policy takes the end.
  if (sans.length > RECORD_OPENING_PLIES) rows.push(`the last move was ${sans[sans.length - 1]}`);

  // The ≤14-word contract, enforced rather than hoped for — same reason
  // `moveFact` enforces it: a row over the limit fails silently at the far end
  // of the pipe (`silent-truncation`), never here.
  return rows.filter((r) => r.split(/\s+/).length <= MAX_FACT_WORDS);
}

/**
 * The whole activity, for the tail block at connect.
 *
 * Short by construction. A person sitting down mid-game knows roughly where it
 * stands and whose turn it is — not the move list.
 */
export function chessActivity(
  game: Game,
  herSide: Side,
  startedAt: number,
  last?: MoveAssessment | null,
  /** the session's own `endedEarly` — only the session knows the difference
   *  between "no result yet" and "he stopped playing", and `record`'s ending
   *  row is the one place that difference has to be right. Defaulted, so every
   *  existing call site is unchanged. */
  endedEarly = false,
): ActivityState {
  const facts: string[] = [];
  const nameable: string[] = [];
  const ply = game.played.length;
  const turn = game.status?.turn;

  // ORDER IS THE DROP POLICY. `renderActivity` pops whole facts off the END
  // when the block is over budget, and the head alone is ~300 of the 420
  // bytes — so on a live game roughly three rows survive and the rest is
  // written for the cases where they fit. Least important LAST, and the two
  // rows a person actually needs (whose move it is, which colour she has) are
  // first for that reason. "3 moves in" used to lead and is now last: it is
  // the only row here that nothing depends on.
  if (game.status?.over) {
    // The ending, concretely — who won and how. "the game has finished" alone
    // left her congratulating nobody: she had checkmated him minutes earlier
    // and picked up the phone not knowing there was anything to gloat about.
    const r = game.status.result;
    if (r === "checkmate") {
      facts.push(game.status.winner === herSide ? "she won, by checkmate" : "he won, by checkmate");
    } else {
      // the four draws are four different stories to a person — a stalemate
      // she walked into and a fifty-move grind deserve different sentences
      facts.push(
        r === "stalemate"
          ? "a draw, stalemate, nobody could move"
          : r === "insufficient_material"
            ? "a draw, not enough pieces left to mate"
            : r === "threefold_repetition"
              ? "a draw, same position three times"
              : r === "fifty_move"
                ? "a draw, fifty moves with no progress"
                : "it ended in a draw",
      );
    }
  } else if (turn) {
    facts.push(turn === herSide ? "it is her move" : "it is his move");
  }

  facts.push(`she is playing ${herSide === "w" ? "white" : "black"}`);

  let told = "";
  if (last) {
    const whoMoved = last.fenBefore.split(" ")[1] === herSide ? "her" : "him";
    told = moveFact(last, herSide, whoMoved);
    facts.push(told);
    if (last.move?.san) nameable.push(last.move.san);
    if (last.better) nameable.push(last.better);
  }

  // ONE threat row, and only one the move fact did not already carry. Two rows
  // saying the same thing in different words is the commentator failure with
  // extra steps, and there is no budget for it anyway.
  const spare = last ? threatFacts(last, herSide).find((f) => !told.includes(f)) : undefined;
  if (spare) facts.push(spare);

  // The opening's name, while it is still the opening. The owner asked for
  // this directly — *"taking the opening name and explaining 'this is the
  // opening' can be there, in a good sense"* — and it is deliberately below the
  // move and the threat: it is the nicest row here and the least urgent.
  //
  // SUPPRESSED WHEN `idea` ALREADY CARRIES IT. `chessIdea` leads with the same
  // book name, and the two rendered together read as the block repeating
  // itself — "her idea: the italian game, …" three lines above "the opening is
  // the italian game". The idea line is the one that survives, because it is
  // undroppable and says strictly more; dropping the fact row gives the threat
  // and the move count a row back rather than costing anything.
  const idea = chessIdea(game, herSide);
  if (ply > 0 && ply <= OPENING_FACT_PLY && !game.status?.over) {
    const name = openingName(game.played.map((m) => m.san));
    if (name && !idea.includes(name)) facts.push(`the opening is ${name}`);
  }

  const moves = Math.ceil(ply / 2);
  facts.push(
    ply === 0 ? "the game has just started"
    : moves === 1 ? "1 move in"
    : `${moves} moves in`,
  );

  // Only if nothing above already said it — the threat rows name the side in
  // check and this one does not, so it is the weaker version and goes last.
  if (!game.status?.over && game.status?.inCheck && !facts.some((f) => f.includes("in check"))) {
    facts.push(turn === herSide ? "she is in check" : "he is in check");
  }

  // Every move ever played is nameable — she may refer back to the game, and
  // the record is the ground truth she is allowed to cite.
  for (const m of game.played) if (m.san) nameable.push(m.san);

  return {
    kind: "chess",
    startedAt,
    facts,
    nameable,
    record: chessRecord(game, herSide, endedEarly),
    // THE TWO UNDROPPABLE ROWS. Both are derived from THIS `game` and nothing
    // else — there is no path by which a previous session's moves can reach
    // either one, which is the structural half of the cross-game-bleed fix
    // (the prompt half is `STATE_LAW`).
    state: chessGameState(game, herSide, endedEarly),
    idea,
    waitingOnHer: !game.status?.over && turn === herSide,
    over: Boolean(game.status?.over),
  };
}
