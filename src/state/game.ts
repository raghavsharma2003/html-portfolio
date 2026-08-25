// The game as SESSION STATE, not component state.
//
// This file is three lines of type and one derivation, and it exists to make a
// single structural point that the owner's instruction turns on:
//
//   *"There should be continuity and proper flow between chat, call, screen
//   sharing and chess... It should be a whole continuous thing only. Nothing
//   should be broken in between."*
//
// A board held in `useState` inside ChessBoard is a board the call lane cannot
// see. She would then be playing a game she cannot talk about on a call that is
// happening at the same time — which is the exact discreteness the instruction
// forbids, and it would not read as a missing feature. It would read as her
// forgetting, mid-sentence, something she is visibly doing.
//
// So the game rides `AppState`: the same object as `messages`, `inner` and
// `herLife`, persisted by the same writer, synced to the account by the same
// sync. Navigating away from the board, taking a call, starting a screen share
// and closing the tab are all survivable for free, because none of them touch
// this field.
//
// The cost of that choice, stated plainly: `AppState` is serialised to
// localStorage on every write, so `GameSession` has to stay small. A `Game` is
// a FEN, a move list and a position list — about 1KB at move 40, next to a
// message history already measured in tens of KB. It is not a concern now and
// would become one only if an activity wanted to persist media.

import type { Game, MoveAssessment, Side } from "../engine/chess";
import type { WyrSession } from "../engine/wyr/session";
import type { Game as TttGame, Mark } from "../engine/ttt";
import { tttActivity } from "../engine/tttTalk";
import { wyrActivity } from "../engine/wyrTalk";
import { assessLast } from "../engine/chess";
import { chessActivity } from "../engine/chessTalk";
import { LABEL, type ActivityState } from "../engine/activity";

/**
 * A game in progress. `kind` is present from the first version even though
 * chess is the only member, because the alternative — a bare `game` field that
 * a second activity has to either overload or sit beside — is how the seam
 * stops being generic. Adding backgammon adds a member here and an adapter in
 * `engine/`, and touches nothing else.
 */
export type GameSession = ChessSession | WyrSession | TttSession;

export interface TttSession {
  kind: "ttt";
  game: TttGame;
  herSide: Mark;
  startedAt: number;
  closedAt?: number;
  /**
   * Set when HE ended the game before it reached a result. Identical field,
   * identical meaning and identical reason to `ChessSession.endedEarly`: the
   * two endings are different facts, and conflating them has her gloating over
   * a game nobody won. It was chess-only, so a tic-tac-toe board put away
   * mid-game rendered `over: true` above a live `it is his move` — one block
   * contradicting itself on the lane she speaks from.
   */
  endedEarly?: true;
  /** last move/answer commit — the staleness clock for open sessions */
  touchedAt?: number;
  /** lifetime tally written for this session — the reconciler's idempotence */
  tallied?: true;
}

export interface ChessSession {
  kind: "chess";
  game: Game;
  /** Which colour SHE has. Not derivable from the board; a real choice. */
  herSide: Side;
  /** epoch ms, so "we've been at this twenty minutes" is true rather than said */
  startedAt: number;
  /**
   * Set when the game reached a natural end AND she has already reacted to it,
   * so the tail stops announcing a finished game forever. The row is not
   * deleted: "we played earlier and you lost" is a thing a person remembers,
   * and the played list is what the memory layer will read.
   */
  closedAt?: number;
  /**
   * Set when HE ended the game before it reached a result — the "End game"
   * button. Distinct from closedAt-with-status.over because the two endings
   * are different facts: "she won by checkmate" vs "he ended it early, no
   * result". Conflating them would have her gloating over a game nobody won.
   */
  endedEarly?: true;
  touchedAt?: number;
  tallied?: true;
}

/**
 * The assessment of the most recent move, or null for a fresh board.
 *
 * NEVER STORED IN STATE. `assessLast` is a pure function of the game, and a
 * copy persisted alongside the board is a second source of truth that can
 * disagree with the position it describes — which for an honesty gate fed by
 * `nameable` is not a cosmetic disagreement. That prohibition is about
 * PERSISTENCE, and it is the whole reason this function exists.
 *
 * It is not a prohibition on memoising the pure call, and the two must not be
 * confused: the memo below is keyed on the position itself (`fen` +
 * `played.length`), so it cannot outlive the board state it describes — a
 * different position is a different key and recomputes. Do not remove it in
 * the name of the paragraph above.
 *
 * Why it is here at all: `assessLast` costs two extra searches (36.7 ms
 * standalone in this container, 150-290 ms on a phone), and `activityOf` calls
 * it on EVERY chat reply and EVERY call turn while a board is open. The same
 * position was being re-searched dozens of times per game for an answer that
 * cannot change.
 */
let assessMemo: { key: string; val: MoveAssessment | null } = { key: "", val: null };

export function lastAssessment(s: GameSession | null | undefined): MoveAssessment | null {
  if (!s || s.kind !== "chess" || !s.game.played.length) return null;
  // The FEN carries side to move, castling, en passant and both clocks, so
  // together with the move count it identifies the position exactly.
  const key = `${s.game.fen}|${s.game.played.length}`;
  if (assessMemo.key === key) return assessMemo.val;
  let val: MoveAssessment | null;
  try {
    val = assessLast(s.game);
  } catch {
    // A board that cannot be assessed must never take a lane down with it. She
    // simply has no opinion about the last move, which is a thing people do.
    val = null;
  }
  assessMemo = { key, val };
  return val;
}

/**
 * The activity for whatever is going on, or null.
 *
 * THE SINGLE DERIVATION. Both lanes call this — the chat lane through
 * brain.ts's `keys.activity`, the call lane through `compile({ activity })` —
 * because two lanes deriving the same state separately is precisely the fork
 * `age-tier-never-realtime` records, where the copy that was not updated
 * silently lost a rule. Here the thing that would be lost is `nameable`, and
 * losing it makes the honesty gate flag real moves as invented.
 */
export function activityOf(s: GameSession | null | undefined, nowMs?: number): ActivityState | null {
  if (!s) return null;
  if (s.closedAt) {
    // A game that JUST ended is still part of the present moment. The owner
    // hit the gap this window closes: she checkmated him, he called two
    // minutes later, and — with the closed game rendering nothing — she had
    // no idea a game had happened, invented what she "was doing" instead, and
    // then asked him what move she should play. So for a while after the
    // close, the activity stays, marked `over`, carrying who won. After the
    // window it is the memory layer's job, not the present moment's.
    //
    // `startedAt` is deliberately the CLOSE time here, not the start: the
    // renderer derives "N min ago" from it, and for a finished game the
    // number a person carries is how long since it ENDED.
    const now = nowMs ?? Date.now();
    if (now - s.closedAt > RECENT_END_MS) return null;
    const a =
      s.kind === "wyr"
        ? wyrActivity(s)
        : s.kind === "ttt"
          ? // `endedEarly` reaches BOTH board adapters — it was chess-only, and
            // the asymmetry was not a decision: a ttt board put away mid-game
            // kept rendering "it is his move" under a heading saying the game
            // had just finished, and its permanent record said "left
            // unfinished" with nobody named as having left it.
            tttActivity(s.game, s.herSide, s.closedAt, Boolean(s.endedEarly))
          : // `endedEarly` reaches the adapter here and only here: the SESSION
            // owns the difference between "no result yet" and "he stopped
            // playing", and `record`'s ending row is the one place that
            // difference has to survive into the permanent memory. The `facts`
            // rewrite below does the same job for the present-moment half.
            chessActivity(s.game, s.herSide, s.closedAt, lastAssessment(s), Boolean(s.endedEarly));
    // For a finished thing, "N min ago" means since it ENDED.
    const facts =
      s.kind === "chess" && s.endedEarly && !s.game.status.over
        ? // ended by hand: strip the live-game rows (whose move, checks) and
          // state what actually happened — no result, nobody won. HEAD fact,
          // because renderActivity drops from the END and this is the row
          // that stops her inventing a winner.
          //
          // CHESS ONLY, and that is now a decision rather than the omission it
          // was. `chessActivity` does not know the session's `endedEarly` when
          // it builds `facts` (it takes it for the RECORD alone), so this
          // rewrite is where the chess block learns about it. `tttActivity`
          // takes the same flag and emits its own head row from it — with her
          // mark on the end, so the one row the drop policy cannot take
          // carries it. Doing both would render the ending twice and eat the
          // one spare row a finished ttt block has.
          ["he ended the game early, no result", ...a.facts.filter((f) => !/(her|his) move|in check/.test(f))]
        : a.facts;
    return { ...a, facts, over: true, startedAt: s.closedAt };
  }
  if (s.kind === "wyr") return wyrActivity(s);
  if (s.kind === "ttt") return tttActivity(s.game, s.herSide, s.startedAt, Boolean(s.endedEarly));
  return chessActivity(s.game, s.herSide, s.startedAt, lastAssessment(s));
}

/**
 * Shape guard for a session arriving from OUTSIDE — a sync payload or a
 * parsed localStorage blob. `game` is the one AppState field dereferenced
 * deeply (progressOf, chessActivity) inside setState updaters, so a malformed
 * one is a blank screen that survives reloads. Anything failing this becomes
 * null at the boundary.
 *
 * This is the FIRST of two defences and the only one that keeps the game:
 * `components/ErrorBoundary.tsx` wraps the activity overlay so a session that
 * slips past this guard costs the board rather than the app. The boundary is
 * the net; this function is the reason the net should stay empty.
 */
export function isGameSession(g: unknown): g is GameSession {
  if (!g || typeof g !== "object") return false;
  const s = g as Record<string, unknown>;
  if (typeof s.startedAt !== "number") return false;
  if (s.kind === "wyr") return Array.isArray(s.seen) && Array.isArray(s.rounds) && typeof s.salt === "string";
  if (s.kind === "chess" || s.kind === "ttt") {
    const game = s.game as Record<string, unknown> | undefined;
    if (!game || !Array.isArray(game.played)) return false;
    if (!game.status || typeof game.status !== "object") return false;
    // THE MOVE RECORDS THEMSELVES. A `played` array whose ROWS are malformed
    // passed the check above and then took the whole app down: the board
    // renders `lastMove={{ from: last.from, to: last.to }}` and ChessBoard's
    // `squareIndex` does `sq[0]` on it, so a row without `from` throws during
    // RENDER, above every setState — rootKids=0, and because the blob is
    // persisted, the white screen survives every reload.
    //
    // Validate EXACTLY what is dereferenced outside a try/catch, and nothing
    // more. Over-validating is not free: every extra required field is a real
    // session (an older build's, a partially-synced one) silently dropped, and
    // a dropped game is a game she then denies having played. `assessLast`'s
    // deeper reads (fenBefore/fenAfter/moveNumber) are NOT checked here
    // because `lastAssessment` already catches around them — she simply has no
    // opinion about the last move, which is survivable.
    //   chess: `san` (movelist, opening book, the nameable allowlist),
    //          `from`/`to` (the board's last-move highlight — the crash).
    //   ttt:   `cell` (last-cell highlight, CELL_NAME lookup).
    return game.played.every((m) => {
      if (!m || typeof m !== "object") return false;
      const r = m as Record<string, unknown>;
      return s.kind === "chess"
        ? typeof r.san === "string" && typeof r.from === "string" && typeof r.to === "string"
        : typeof r.cell === "number";
    });
  }
  return false;
}

// ── THE CHOREOGRAPHY: one being, one timeline ──────────────────────────────
//
// The owner watched her play a move MILLISECONDS after his and then, two to
// three seconds later, heard her voice say she SHOULD play the move that was
// already on the board. Two agents on two clocks: the hand and the mouth. This
// block is the hand's clock, and `chessTalk.ts`'s `settledClause` is what stops
// the mouth deliberating about a choice the hand already closed.
//
// The state machine for one of her turns, and it is strictly ordered:
//
//   his_move → (board animates) → she_thinks → her_move lands →
//   settled(her move is on the board) → the note, in DONE tense
//
// There is deliberately NO pre-line. A short "hmm, ek second" in the
// deliberating register would be lovely and it is unshippable on the live lane:
// `direct()` hands text to a model that takes seconds to generate and start
// speaking, so a pre-line drafted during a 0.8s opening think arrives AFTER the
// piece has landed — which is precisely the defect being fixed, wearing a nicer
// hat. A silent move followed by a past-tense line is always coherent. A move
// followed by a future-tense line never is. See `context/decisions.md`
// `move-voice-one-timeline`.

/** Nothing of hers may land faster than this. Below ~300ms no hand moved. */
export const THINK_FLOOR_MS = 300;
/** And nothing may hang longer: past this the board reads as frozen, not busy. */
export const THINK_CEIL_MS = 7000;

/**
 * How long the board takes to SHOW a move — the slide (`--d-tap`, 180ms) plus
 * the capture death animation that waits the slide out. Her voice may not
 * comment on a move before the board has finished drawing it, and the call
 * lane's poke debounce is asserted to clear this in the movevoice suite.
 */
export const MOVE_ANIM_MS = 360;

/**
 * The bands, before modifiers. Exported because the eval asserts against THESE
 * numbers rather than against a copy of them — a table checked against a
 * hand-written twin is checked against nothing.
 */
export const THINK_BANDS = {
  /** She knows her openings. A book move is recall, not calculation. */
  chess_book: [800, 2200],
  /** Out of book but still early: shape, not lines. */
  chess_opening: [1100, 3000],
  /** The middlegame, where a position actually costs time. */
  chess_middle: [2000, 6000],
  /** Endgames are simpler boards with fewer candidate moves. */
  chess_late: [1200, 4000],
  /** Exactly one legal move. There is nothing to think about and she knows it. */
  chess_forced: [300, 600],
  ttt: [500, 2000],
  /** A win on the board or a line to block — a person sees these instantly. */
  ttt_obvious: [400, 1000],
} as const satisfies Record<string, readonly [number, number]>;

/** Past this ply the opening is over for pacing purposes. */
const OPENING_PLY = 8;
/** And past this one the middlegame is. */
const LATE_PLY = 30;

/**
 * Deterministic, never random.
 *
 * `Math.random()` in her behaviour is the causeless variation this engine is
 * built to avoid (`her-chess-pace`), and it also makes every timing assertion
 * in the eval a flake. The pace is a property of the MOMENT: the same position,
 * in the same session, always takes her the same beat, so a replay agrees with
 * the run it replays. Seeded on the session as well as the position, so two
 * different games that pass through the same position are not metronomes.
 */
function unitOf(key: string, seed: number): number {
  let h = seed | 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

export interface ChessThinkInput {
  /** The position she is thinking IN — before her move. Identifies the moment. */
  fen: string;
  /** Plies already played. */
  ply: number;
  /** How many replies she has here. 1 is forced; 38+ is a wide, slow position. */
  legalMoveCount: number;
  /** In check: forced-ish, and a person SEES a check rather than finding it. */
  inCheck: boolean;
  /** His move just took something on the square she is taking back on. */
  recapture: boolean;
  /** Still inside the opening book — recall rather than calculation. */
  book: boolean;
  /** The session seed (`startedAt`), so replays of one session agree. */
  seed: number;
}

/**
 * The held beat before her move lands, in ms. Pure, total, and bounded to
 * [THINK_FLOOR_MS, THINK_CEIL_MS] for every input including nonsense.
 */
export function chessThinkMs(i: ChessThinkInput): number {
  const forced = i.legalMoveCount === 1;
  const [lo, hi] = forced
    ? THINK_BANDS.chess_forced
    : i.ply < OPENING_PLY
      ? i.book
        ? THINK_BANDS.chess_book
        : THINK_BANDS.chess_opening
      : i.ply < LATE_PLY
        ? THINK_BANDS.chess_middle
        : THINK_BANDS.chess_late;
  const u = unitOf(`${i.fen}|${i.ply}`, i.seed);
  let ms = lo + u * (hi - lo);
  if (!forced) {
    // Modifiers are MULTIPLICATIVE and then clamped as a group, so no
    // combination of them can compound into a move that lands instantly (the
    // reported defect) or one that hangs. Order does not matter; the clamp does.
    let mult = 1;
    // A check has to be answered and the answer is usually visible at a glance.
    if (i.inCheck) mult *= 0.45;
    // Taking back is the most reflexive move in chess.
    if (i.recapture) mult *= 0.6;
    // And the width of the position: a cramped board is a quick decision, a
    // wide-open one genuinely takes longer to look at.
    if (i.legalMoveCount >= 38) mult *= 1.3;
    else if (i.legalMoveCount > 1 && i.legalMoveCount <= 12) mult *= 0.75;
    ms *= Math.min(1.35, Math.max(0.3, mult));
  }
  return Math.round(Math.min(THINK_CEIL_MS, Math.max(THINK_FLOOR_MS, ms)));
}

export interface TttThinkInput {
  /** The board as a 9-char key, "." for empty. Identifies the moment. */
  key: string;
  /** Plies already played. */
  ply: number;
  /** She can win now, or must block now. People see both instantly. */
  obvious: boolean;
  /** The session seed (`startedAt`). */
  seed: number;
}

/** Same contract as `chessThinkMs`, for a nine-square board. */
export function tttThinkMs(i: TttThinkInput): number {
  const [lo, hi] = i.obvious ? THINK_BANDS.ttt_obvious : THINK_BANDS.ttt;
  const u = unitOf(`${i.key}|${i.ply}`, i.seed);
  return Math.round(Math.min(THINK_CEIL_MS, Math.max(THINK_FLOOR_MS, lo + u * (hi - lo))));
}

/**
 * Where one of her turns is, right now.
 *
 * `thinking` is the ONLY state in which she may speak deliberatively about a
 * move, and it is the state in which the surface shows her considering (the
 * presence row `ActivityShell` already draws off `her.phase` — an existing
 * idiom, not a new affordance). Everything downstream of `landed` speaks in
 * done tense, because the choice is closed.
 */
export type TurnPhase = "over" | "thinking" | "his_turn";

export function turnPhase(s: GameSession | null | undefined): TurnPhase {
  if (!s || s.kind === "wyr") return "his_turn";
  if (s.closedAt || s.game.status.over) return "over";
  return s.game.status.turn === s.herSide ? "thinking" : "his_turn";
}

/**
 * The ply a note or line was drafted at — the staleness stamp.
 *
 * One counter for every activity kind, matching the call lane's own poke
 * counter: chess and ttt count plies, wyr counts answered rounds. Returns null
 * when there is nothing in progress, which is never equal to any stamp, so a
 * note drafted against a game that has since closed is dropped too.
 */
export function gamePly(s: GameSession | null | undefined): number | null {
  if (!s || s.closedAt) return null;
  return s.kind === "wyr" ? s.rounds.length : s.game.played.length;
}

/**
 * THE STALENESS SEAM, as one decidable function.
 *
 * A line drafted for move N must not be spoken after move N+1 exists. This is
 * the stale-reply-discard idiom from the call v2 work applied to the board: the
 * note is stamped with the ply it was written against, and the stamp is checked
 * at the LAST instant before it enters the socket, not when it was queued.
 * `null` (no game, or the game closed) is stale for anything.
 */
export function noteIsStale(draftedAtPly: number, s: GameSession | null | undefined): boolean {
  const now = gamePly(s);
  return now === null || now !== draftedAtPly;
}

/**
 * What to do with a drafted note at the instant before it enters the socket.
 *
 * A function rather than three `if`s at the call site, because this is the
 * decision the owner's defect turned on and a decision that lives only inside a
 * component is a decision no eval can reach. All three outcomes are real:
 *
 *  - `stale`  — the board moved. DROP it. A comment on a position two moves
 *               gone cannot be un-said, and a reaction delivered late is worse
 *               than none (the same judgment the watch lane's stale-frame
 *               suppressor makes).
 *  - `hold`   — she is mid-sentence, so `direct()` would sit on this note for
 *               up to 1.2s while the board is free to move underneath it. That
 *               wait is the widest stale window there is and it belongs to a
 *               file this seam does not own, so nothing is handed into it:
 *               come back and draft against the board as it is then.
 *  - `send`   — the note describes now.
 */
export type NoteVerdict = "send" | "stale" | "hold";

export function noteVerdict(
  draftedAtPly: number,
  s: GameSession | null | undefined,
  herVoiceIsLive: boolean,
): NoteVerdict {
  // Staleness first: a note about a superseded position is dropped outright,
  // never held for later — holding it would only make it staler.
  if (noteIsStale(draftedAtPly, s)) return "stale";
  return herVoiceIsLive ? "hold" : "send";
}

/**
 * How long an OPEN session stays "right now" with nobody touching it. Six
 * hours: a board left mid-game on Tuesday must not have her convinced on
 * Friday that they are mid-match ("RIGHT NOW … 4320 min in"). The reconciler
 * closes it as ended-early; an ACTIVE long game is untouched because the
 * clock runs from the last move, not the start.
 */
export const OPEN_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * How long a finished game remains part of "right now". Two hours: long
 * enough that a call twenty minutes after the ending still lands mid-afterglow,
 * short enough that tomorrow it is a memory rather than a topic she is
 * inexplicably still holding open.
 */
export const RECENT_END_MS = 2 * 60 * 60 * 1000;

/**
 * One clause for the moment she picks up a call: what is going on, or just
 * went on, between them. Kind-agnostic — it reads only the ActivityState —
 * because the pickup line must keep working unchanged when the next game
 * lands. Empty string when nothing is going on, which is most of the time.
 */
// ── THE SERIES: who usually wins ──────────────────────────────────────────
//
// The owner's ask was for her to be INTERESTING about tic-tac-toe, and the
// honest reading of that is structural rather than promptable: she had no
// material. One game of noughts and crosses is nine squares and forty seconds;
// the only thing about it worth carrying is how it sits against the last five.
// "you've beaten me three times running" is a fact, and a fact she can be
// funny about; "he won that one" on its own is a scoreline.
//
// Derived from the LEDGER rather than from a new counter, deliberately:
// `AppState.tally` is another workstream's type and adding `tttWinsHim` there
// would be a second store of a fact the ledger already holds, which is
// `warm-count-unscoped` — a reader and a writer deriving the same record until
// they disagree, invisibly. The ledger row is the SAME string that was sent to
// the server (`ActivityRecord.summary`, one rendering, two stores), so this is
// one store read twice.
//
// It parses text this repo writes, which is the hazard `STEM_DATE_RE` names
// next door in callHistory.ts, and it takes the same precaution: the eval
// drives a REAL finished game through `tttRecord` → `activityEpisodeSummary`
// → this function and asserts the round trip, so the pattern is pinned against
// the writer's actual output and never guessed at.

/** A ttt ending, as `tttRecord` writes it. Anchored on "won it in", which is
 *  that function's wording and nothing else's. */
const TTT_WIN_RE = /\b(she|he) won it in \d+ moves?\b/;
const TTT_DRAW_RE = /\ba draw, the board filled up\b/;

export interface GameSeries {
  /** finished games with a readable outcome */
  games: number;
  her: number;
  his: number;
  draws: number;
}

/** Minimal shape of one ledger row. Structural rather than an import of
 *  `engine/memory`'s `ActivityRecord`, so this file keeps its one-way
 *  dependency on the engine and an eval can hand it a literal. */
export interface SeriesRow {
  kind: string;
  summary: string;
}

/**
 * The lifetime head-to-head at one activity kind, read off the local ledger.
 * Pure, total, and cheap: the ledger holds twenty rows at most (`MAX_ACTIVITY
 * _RECORDS`), so this is twenty regex tests, not a scan of history.
 */
export function seriesOf(
  ledger: readonly SeriesRow[] | undefined,
  kind: string,
): GameSeries {
  const out: GameSeries = { games: 0, her: 0, his: 0, draws: 0 };
  for (const r of ledger ?? []) {
    if (!r || r.kind !== kind || typeof r.summary !== "string") continue;
    const win = TTT_WIN_RE.exec(r.summary);
    if (win) {
      out.games++;
      if (win[1] === "she") out.her++;
      else out.his++;
    } else if (TTT_DRAW_RE.test(r.summary)) {
      out.games++;
      out.draws++;
    }
    // An abandoned game has no outcome and is not part of a head-to-head. It
    // stays in the ledger and out of the score, which is what a person does.
  }
  return out;
}

// DELIBERATELY NOT WIRED INTO THE PROMPT, and this note is the reason rather
// than an omission. A `seriesFact` row belongs in the ONE block both lanes
// read — `formatActivityLedger` (chat) and `formatActivityLedgerForCall`
// (call) — and those are two functions in two files, one of which renders
// every activity kind. Adding it to only one is the `age-tier-never-realtime`
// fork: the lane that was not updated silently loses the row. It is also not
// the defect: the ledger already carries the last two to three games WITH
// their winners, which is the material "you've beaten me twice" is made of.
// See this workstream's report for the exact shape the wiring wants.

export function activityPickupLine(a: ActivityState | null | undefined): string {
  if (!a || !a.facts.length) return "";
  // LABEL is the same table the tail block renders from — one vocabulary for
  // what an activity is called, or the pickup and the brief drift apart.
  const what = LABEL[a.kind];
  const detail = a.facts.join("; ");
  return a.over
    ? `you two JUST finished ${what} (${detail})`
    : `you two are in the middle of ${what} right now (${detail})`;
}
