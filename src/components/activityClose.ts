// Closing a session that is about to LOSE ITS SLOT.
//
// App.tsx's reconciler is still the one place that closes and tallies a game
// in the ordinary case, and nothing here replaces it. This file exists for the
// two cases the reconciler structurally cannot see, both found by the
// 2026-08-22 audit (#3, #4):
//
//   #3  A takeover ("Put it away and play X") replaced the occupying session
//       in one setState. The reconciler observes `state.game`; a session that
//       is swapped out in the same tick is never observed, so the game was
//       silently DELETED - no closedAt, no tally, no episode - while the
//       comment above the swap claimed the opposite.
//   #4  "New game" inside the reconciler's 3s close delay did the same thing
//       to a game that had only just finished: the replace re-ran the effect,
//       cleanup cleared the pending timer, and the win was gone (+200ms tap
//       measured tally=null, no closedAt, no episode).
//
// Both have one cause: the transition is performed by the component, so the
// close has to be performed by the component too, SYNCHRONOUSLY, in the same
// updater that performs the swap. Nothing may depend on an effect observing a
// state that exists for less than a tick.
//
// The arithmetic below is App.tsx's reconciler arithmetic, deliberately kept
// identical rule for rule. It lives here rather than three times over in the
// three activity adapters for the reason state/game.ts gives about
// `activityOf`: two places deriving the same state separately is how one of
// them silently loses a rule.
//
// Safe to run twice. `tallied` is the same idempotence flag the reconciler
// uses, `closedAt` is never overwritten once set, and the episode write is
// deduped server-side on `activity:<kind>:<startedAt>`.

import type { AppState } from "../state/store";
import type { GameSession } from "../state/game";
import { activityOf } from "../state/game";
import { LABEL } from "../engine/activity";
import { logFinishedActivity, withActivityRecord, type ActivityRecord } from "../engine/memory";

/** A board that reached a natural end. wyr has no such state. */
function boardOver(g: GameSession): boolean {
  return (g.kind === "chess" || g.kind === "ttt") && Boolean(g.game.status.over);
}

/**
 * PURE. The occupying session, closed and tallied exactly as the reconciler
 * would have closed and tallied it, plus the closed copy for the caller to
 * hand to `emitClosedActivity`.
 *
 * The returned state still holds the closed session in the slot: the caller
 * decides what takes the slot next, and does it in the SAME updater, which is
 * the whole point of this function existing.
 *
 * `at` is passed in rather than read from the clock here so the copy the
 * caller emits carries the identical `closedAt` to the one that is written -
 * an episode keyed on a different millisecond than the session it describes
 * would defeat the server-side dedupe.
 */
export function settleOccupant(
  s: AppState,
  at: number,
): { state: AppState; closed: GameSession | null } {
  const cur = s.game;
  if (!cur) return { state: s, closed: null };

  const over = boardOver(cur);
  let next: GameSession = cur;
  if (!cur.closedAt) {
    // Same honest wording the End-game button writes: a BOARD abandoned before
    // a result ended early and named no winner. This used to be chess-only and
    // the comment claimed "ttt has no early-end fact to carry" — it does now
    // (`TttSession.endedEarly`, and `tttRecord` names the squares nobody
    // took), and without the stamp a taken-over ttt game was remembered as
    // having simply "left unfinished" with no one responsible for leaving it.
    // wyr genuinely has no such state: a round is answered or it does not
    // exist.
    next =
      (cur.kind === "chess" || cur.kind === "ttt") && !over
        ? { ...cur, closedAt: at, endedEarly: true as const }
        : { ...cur, closedAt: at };
  }

  let tally = s.tally;
  if (!next.tallied) {
    const t0 = s.tally ?? {};
    if (next.kind === "chess" && over) {
      const w = next.game.status.winner;
      tally = {
        ...t0,
        chessGames: (t0.chessGames ?? 0) + 1,
        chessWinsHim: (t0.chessWinsHim ?? 0) + (w && w !== next.herSide ? 1 : 0),
        chessWinsHer: (t0.chessWinsHer ?? 0) + (w && w === next.herSide ? 1 : 0),
      };
      next = { ...next, tallied: true as const };
    } else if (next.kind === "chess" && next.endedEarly && next.game.played.length >= 10) {
      // an early-ended game with real play COUNTS as a game and names no
      // winner; below ten plies it is a mis-tap, not a game
      tally = { ...t0, chessGames: (t0.chessGames ?? 0) + 1 };
      next = { ...next, tallied: true as const };
    } else if (next.kind === "ttt" && over) {
      tally = { ...t0, tttGames: (t0.tttGames ?? 0) + 1 };
      next = { ...next, tallied: true as const };
    }
  }

  if (next === cur && tally === s.tally) return { state: s, closed: cur.closedAt ? cur : null };
  return { state: { ...s, game: next, tally }, closed: next };
}

/**
 * The #113 emission, performed by hand.
 *
 * Normally App.tsx's effect watches `closedAt` and emits. It cannot help here:
 * the session it would watch is replaced in the same tick, so the effect never
 * sees it. This is that effect's body, called directly with the closed copy -
 * same single derivation (`activityOf` at `closedAt + 1`, asking what the
 * activity looked like the instant it ended), same label table, same
 * fire-and-forget contract. Nothing is awaited and nothing can throw back into
 * game state.
 */
export function emitClosedActivity(
  deviceId: string | undefined,
  g: GameSession | null,
): ActivityRecord | null {
  if (!g?.closedAt) return null;
  const a = activityOf(g, g.closedAt + 1);
  if (!a || !a.facts.length) return null;
  // `deviceId` is no longer the gate. It gates the SERVER write (and
  // `logFinishedActivity` still skips the POST without one), but the local
  // ledger is what she actually reads from and it needs no identity at all —
  // which is the whole reason it exists. A person with no device row must
  // still remember the game they just played.
  return logFinishedActivity(
    deviceId || "",
    {
      kind: a.kind,
      facts: a.facts,
      // the durable half — see activity.ts's `record`
      record: a.record,
      startedAt: g.startedAt,
      closedAt: g.closedAt,
    },
    LABEL[a.kind],
  );
}

/**
 * The whole move, for a caller that is REPLACING the slot: settle whatever is
 * in it, hand `next` the slot in the SAME updater, and emit the episode for
 * the game that just lost its seat.
 *
 * `next` is a value, not a factory, because React may invoke an updater more
 * than once (StrictMode, a replay) and a factory that reads the clock would
 * deal a different board each time.
 *
 * The emitted copy is derived from `state` - the render's state, which in a
 * tap handler is the state the panel the user tapped was drawn from - and NOT
 * from a variable assigned inside the updater: React runs updaters lazily
 * during render, so such a variable is still null by the time this returns.
 * The updater re-derives the same settle against the latest state, so state
 * is always authoritative; only the episode leans on the rendered copy, and
 * that write is deduped server-side on `activity:<kind>:<startedAt>`.
 */
export function replaceOccupant(
  state: AppState,
  setState: React.Dispatch<React.SetStateAction<AppState>>,
  next: GameSession,
  /** Re-checked inside the updater as well as before it, because the slot can
   *  change between the render that drew the button and the tap on it. Both
   *  checks are needed: the wyr fix shipped with only one and the other half
   *  of the bug survived it. */
  when: (s: AppState) => boolean = () => true,
): void {
  if (!when(state)) return;
  const at = Date.now();
  const closed = settleOccupant(state, at).closed;
  // The episode is built BEFORE the slot is handed over, from the copy that
  // is about to lose it — after the swap there is nothing left to derive it
  // from. Its local half rides the same updater as the swap, so a takeover
  // cannot leave the game recorded on the server and absent on the device.
  const rec = emitClosedActivity(state.deviceId, closed);
  setState((s) =>
    when(s)
      ? {
          ...settleOccupant(s, at).state,
          game: next,
          ...(rec ? { activities: withActivityRecord(s.activities, rec) } : {}),
        }
      : s,
  );
}
