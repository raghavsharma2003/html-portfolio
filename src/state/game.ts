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
import { assessLast } from "../engine/chess";
import { chessActivity } from "../engine/chessTalk";
import type { ActivityState } from "../engine/activity";

/**
 * A game in progress. `kind` is present from the first version even though
 * chess is the only member, because the alternative — a bare `game` field that
 * a second activity has to either overload or sit beside — is how the seam
 * stops being generic. Adding backgammon adds a member here and an adapter in
 * `engine/`, and touches nothing else.
 */
export interface GameSession {
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
}

/**
 * The assessment of the most recent move, or null for a fresh board.
 *
 * Recomputed rather than stored. `assessLast` is a pure function of the game,
 * deterministic and node-budgeted, and a cached copy is a second source of
 * truth that can disagree with the board it describes — which for an honesty
 * gate fed by `nameable` is not a cosmetic disagreement.
 */
export function lastAssessment(s: GameSession | null | undefined): MoveAssessment | null {
  if (!s || !s.game.played.length) return null;
  try {
    return assessLast(s.game);
  } catch {
    // A board that cannot be assessed must never take a lane down with it. She
    // simply has no opinion about the last move, which is a thing people do.
    return null;
  }
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
export function activityOf(s: GameSession | null | undefined): ActivityState | null {
  if (!s || s.closedAt) return null;
  return chessActivity(s.game, s.herSide, s.startedAt, lastAssessment(s));
}
