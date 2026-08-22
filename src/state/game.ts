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
          ? tttActivity(s.game, s.herSide, s.closedAt)
          : chessActivity(s.game, s.herSide, s.closedAt, lastAssessment(s));
    // For a finished thing, "N min ago" means since it ENDED.
    const facts =
      s.kind === "chess" && s.endedEarly && !s.game.status.over
        ? // ended by hand: strip the live-game rows (whose move, checks) and
          // state what actually happened — no result, nobody won. HEAD fact,
          // because renderActivity drops from the END and this is the row
          // that stops her inventing a winner.
          ["he ended the game early, no result", ...a.facts.filter((f) => !/(her|his) move|in check/.test(f))]
        : a.facts;
    return { ...a, facts, over: true, startedAt: s.closedAt };
  }
  if (s.kind === "wyr") return wyrActivity(s);
  if (s.kind === "ttt") return tttActivity(s.game, s.herSide, s.startedAt);
  return chessActivity(s.game, s.herSide, s.startedAt, lastAssessment(s));
}

/**
 * Shape guard for a session arriving from OUTSIDE — a sync payload or a
 * parsed localStorage blob. `game` is the one AppState field dereferenced
 * deeply (progressOf, chessActivity) inside setState updaters with no error
 * boundary in the tree, so a malformed one is a blank screen that survives
 * reloads. Anything failing this becomes null at the boundary.
 */
export function isGameSession(g: unknown): g is GameSession {
  if (!g || typeof g !== "object") return false;
  const s = g as Record<string, unknown>;
  if (typeof s.startedAt !== "number") return false;
  if (s.kind === "wyr") return Array.isArray(s.seen) && Array.isArray(s.rounds) && typeof s.salt === "string";
  if (s.kind === "chess" || s.kind === "ttt") {
    const game = s.game as Record<string, unknown> | undefined;
    return Boolean(game && Array.isArray(game.played) && game.status && typeof game.status === "object");
  }
  return false;
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
