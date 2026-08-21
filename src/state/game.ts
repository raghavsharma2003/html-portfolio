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
export type GameSession = ChessSession | WyrSession;

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
  if (!s || s.kind !== "chess" || !s.game.played.length) return null;
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
        : chessActivity(s.game, s.herSide, s.closedAt, lastAssessment(s));
    // For a finished thing, "N min ago" means since it ENDED.
    return { ...a, over: true, startedAt: s.closedAt };
  }
  if (s.kind === "wyr") return wyrActivity(s);
  return chessActivity(s.game, s.herSide, s.startedAt, lastAssessment(s));
}

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
