// HOW STRONG SHE PLAYS, and how that follows the person across the table.
//
// Tester report, 2026-08-25, two halves of one complaint: she is the same
// opponent every game, and she is the same opponent inside a game that is
// visibly going one way. A companion who plays a fixed level is not an
// opponent, she is a setting — and the level she is fixed AT is wrong for
// almost everybody, because the person on the other side of it changes.
//
// ── the law this file lives under ─────────────────────────────────────────
//
// Same as the rest of `src/engine/chess/`: NO ENGLISH SHE COULD SAY. Numbers
// and enums out, prose composed elsewhere. Nothing here is spoken, and the
// level she plays at is never a thing she announces — a companion who tells
// you she has turned the difficulty up has told you she is a program.
//
// ── why material and not the search ───────────────────────────────────────
//
// `assessMove` reports `cpLoss` against a real search and is by far the better
// judge of a move. It also costs two searches, and this has to be recomputed
// on every one of her turns for the whole game — measured at 36.7 ms per
// assessment in this container and 150–290 ms on a phone, times forty moves,
// on the critical path between his piece landing and hers. `opponent.ts`'s own
// header rules that out in the same words.
//
// So the estimate is read off the MATERIAL RECORD, which is already in
// `game.played` and costs a walk of it: no parse, no search, no clock. It is a
// blunt instrument and it is deliberately used bluntly — the only questions
// asked of it are "is he clearly better than her baseline" and "roughly where
// should she start next time", and a heuristic that is right about those is
// worth more than a precise one that cannot be afforded.
//
// THE WINDOW IS THREE PLIES, which is what makes a trade read as a trade. His
// move, her reply, his recapture: a knight for a knight nets zero and is not a
// mistake. A piece he simply left hanging nets the piece, because there was no
// recapture to make. Delayed punishment is invisible to this and that is an
// accepted, stated limit — see `chess-strength-material-proxy` in the report.

import type { Game, PieceType, Side } from "./types";

// ══ THE TUNING BLOCK — every constant, one edit ═══════════════════════════
//
// Nobody has played a hundred games against each of these, so the honest
// statement is `STRENGTHS`': the SHAPE is right and the values are a starting
// point. They are here in one block, named, so tuning is one edit and a future
// measurement has something to move.
export const ADAPT = {
  /** Where a person with no history starts. Two, not `DEFAULT_STRENGTH`'s
   *  three: level 3's own comment says it already beats most casual players,
   *  and the owner's note on the surface is "she was too strong I think".
   *  Friendly first is the product decision; the ladder below is what stops
   *  friendly meaning boring. */
  BASE_LEVEL: 2,
  /** She may never drop below this. At level 1 she misses one-movers and the
   *  game stops being a game. */
  MIN_LEVEL: 1,
  /** …nor climb past this. Level 5 is a search that does not lose to a club
   *  player, which is not a companion, it is an obstacle. */
  MAX_LEVEL: 4,

  // ── in-game ────────────────────────────────────────────────────────────
  /** His moves before she has any opinion at all. Under six, "he has not
   *  blundered" is a fact about the opening book rather than about him. */
  MIN_MOVES: 6,
  /** A three-ply swing at least this bad, in centipawns, is a blunder. 200 is
   *  a clean minor piece: losing a pawn is a game, losing a knight is a
   *  mistake anybody can see. */
  BLUNDER_CP: 200,
  /** At or below this blunder rate he is not making the errors her baseline is
   *  built to punish. */
  STRONG_BLUNDER_RATE: 0.1,
  /** …and he has to actually be AHEAD as well, by this many centipawns, before
   *  "clearly outplaying her" is a thing the board supports. Both conditions,
   *  because either alone is ordinary: a clean game can still be losing, and a
   *  material lead can be one gift she handed him. */
  STRONG_EDGE_CP: 150,
  /** How far she may climb inside one game. ONE notch, and this is a hard
   *  ceiling rather than a rate: a companion who gets two levels stronger
   *  while you are winning is a companion who took the game away from you. */
  IN_GAME_STEP: 1,

  // ── across games ───────────────────────────────────────────────────────
  /** How fast the stored estimate follows the last game. 0.4 means three games
   *  of consistent play move it most of the way and one fluke moves it a
   *  little — a person is allowed a bad evening. */
  EMA_ALPHA: 0.4,
  /** Games shorter than this teach nothing and do not move the estimate. Ten
   *  plies is the same floor the tally uses for "this was a real game". */
  MIN_PLIES: 10,
} as const;

/** Whole-pawn values, the only place this module has an opinion about a piece.
 *  Deliberately NOT imported from `evaluate.ts`: that table is the search's and
 *  is tuned for the search, and a strength estimate that moves when somebody
 *  retunes a bishop by eight centipawns is an estimate nobody can reason
 *  about. Centipawns, so the constants above read in the same unit. */
const VALUE_CP: Record<PieceType, number> = { p: 100, n: 300, b: 320, r: 500, q: 900, k: 0 };

/** What his play looks like from the material record alone. */
export interface PlayQuality {
  /** His moves that had a full three-ply window to settle. */
  moves: number;
  /** Share of them that shed `BLUNDER_CP` or more. 0 when `moves` is 0. */
  blunderRate: number;
  /** Mean centipawns shed per move, counting only the losing ones. */
  meanLossCp: number;
  /** Material balance at the end of the record, HIS point of view. */
  edgeCp: number;
}

/**
 * Material balance after every ply, from HIS point of view, in centipawns.
 * `bal[0]` is the start position (0) and `bal[i + 1]` is the balance after
 * `played[i]`.
 */
function balances(game: Game, herSide: Side): number[] {
  const out = [0];
  let bal = 0;
  for (const m of game.played ?? []) {
    const his = m.by !== herSide;
    const sign = his ? 1 : -1;
    if (m.captured) bal += sign * (VALUE_CP[m.captured] ?? 0);
    if (m.promotion) bal += sign * ((VALUE_CP[m.promotion] ?? 0) - VALUE_CP.p);
    out.push(bal);
  }
  return out;
}

/**
 * Read his play off the game. Pure, total, search-free, and cheap enough to
 * call on every one of her turns — one walk of a move list that is at most a
 * few hundred entries.
 */
export function userPlay(game: Game, herSide: Side): PlayQuality {
  const played = game?.played ?? [];
  const bal = balances(game, herSide);
  let moves = 0;
  let blunders = 0;
  let lossCp = 0;
  for (let i = 0; i < played.length; i++) {
    if (played[i].by === herSide) continue;
    // The three-ply window: his move, her reply, his answer to it. A trade he
    // initiated and recaptured in nets zero; a piece he left hanging does not.
    // Truncated at the end of the record rather than skipped, so the move that
    // just lost the queen counts immediately instead of two plies later.
    const end = Math.min(played.length, i + 3);
    const swing = bal[end] - bal[i];
    moves++;
    if (swing < 0) lossCp += -swing;
    if (swing <= -ADAPT.BLUNDER_CP) blunders++;
  }
  return {
    moves,
    blunderRate: moves ? blunders / moves : 0,
    meanLossCp: moves ? lossCp / moves : 0,
    edgeCp: bal[bal.length - 1] ?? 0,
  };
}

const clampLevel = (n: number): number =>
  Math.max(ADAPT.MIN_LEVEL, Math.min(ADAPT.MAX_LEVEL, Math.round(n)));

/**
 * Is he clearly outplaying her baseline right now?
 *
 * Both halves, deliberately (see `STRONG_EDGE_CP`). ONE-WAY: this can raise
 * her level and can never lower it. A companion who gets easier while you are
 * struggling has noticed you are struggling, and there is no way to do that
 * which does not read as pity — the across-game estimate is where a softer
 * setting is allowed to come from, because there it arrives as a fresh game
 * rather than as a visible concession mid-fight.
 */
export function outplaying(q: PlayQuality): boolean {
  return (
    q.moves >= ADAPT.MIN_MOVES &&
    q.blunderRate <= ADAPT.STRONG_BLUNDER_RATE &&
    q.edgeCp >= ADAPT.STRONG_EDGE_CP
  );
}

/** The level she should be playing at RIGHT NOW, given where she started. */
export function inGameLevel(baseLevel: number, q: PlayQuality): number {
  const base = clampLevel(baseLevel);
  return outplaying(q) ? clampLevel(base + ADAPT.IN_GAME_STEP) : base;
}

/**
 * What this ONE game says his level is, on the same 1..5 scale her strength
 * uses. A ladder rather than a formula: the inputs are blunt and a formula
 * over blunt inputs is precision theatre.
 */
export function observedLevel(q: PlayQuality): number {
  if (q.moves < ADAPT.MIN_MOVES) return ADAPT.BASE_LEVEL;
  if (q.blunderRate <= ADAPT.STRONG_BLUNDER_RATE && q.edgeCp >= ADAPT.STRONG_EDGE_CP) return 4;
  if (q.blunderRate <= 0.15 && q.meanLossCp <= 60) return 3;
  if (q.blunderRate >= 0.35 || q.meanLossCp >= 200) return 1;
  return 2;
}

/**
 * The stored per-user estimate after this game. An EMA, so one bad evening
 * moves it a little and a run of them moves it properly.
 *
 * A game too short to teach anything returns `prev` UNCHANGED — including
 * `undefined`, so a person who opened a board and closed it still has no
 * history rather than a fabricated one.
 */
export function nextSkill(prev: number | undefined, game: Game, herSide: Side): number | undefined {
  if ((game?.played?.length ?? 0) < ADAPT.MIN_PLIES) return prev;
  const observed = observedLevel(userPlay(game, herSide));
  const base = Number.isFinite(prev) ? (prev as number) : ADAPT.BASE_LEVEL;
  const next = base + ADAPT.EMA_ALPHA * (observed - base);
  // Stored to one decimal: the EMA needs the fraction to move at all, and a
  // full float in a synced localStorage blob is noise nobody can read.
  return Math.round(Math.max(ADAPT.MIN_LEVEL, Math.min(ADAPT.MAX_LEVEL, next)) * 10) / 10;
}

/**
 * The level a NEW game opens at, from the stored estimate.
 *
 * No history → `BASE_LEVEL`, which is the level the surface hard-coded before
 * this file existed. That is not a coincidence and it is the point: a person
 * who has never played gets byte-for-byte the opponent they got yesterday, and
 * only a person who has actually demonstrated something gets a different one.
 */
export function startingLevel(skill: number | undefined): number {
  return Number.isFinite(skill) ? clampLevel(skill as number) : ADAPT.BASE_LEVEL;
}
