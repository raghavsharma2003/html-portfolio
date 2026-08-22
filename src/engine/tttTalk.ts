// The ttt → activity adapter. The ONLY place tic-tac-toe becomes words —
// same split, same reason, as `chessTalk.ts`: `src/engine/ttt/` emits enums
// and cell indices and no English at all, so the search can change without
// touching a word she might say, and the wording can be tuned without
// risking a legal move.
//
// WHAT THIS FILE MAY NOT DO, same law as chessTalk.ts: write a line she could
// SAY. `recited-prompt` measured her own example quotes recited on 4 of 5
// turns. Everything below is a fact in the third person about the board —
// telegraphic, ≤14 words, never sentence-shaped, never first-person, no
// dialogue. "arre yeh toh block ho gaya" belongs to her; "he blocked her
// line" belongs here.
//
// ── kind, and why this file can't just say "ttt" and be done ───────────────
//
// `ActivityState.kind` (src/engine/activity.ts) is `"chess" | "watch"` today
// and is OWNED by that file, which this workstream does not touch. So the
// return type here is a local, structural twin — `TttActivityState` — with
// `kind` widened to include `"ttt"`. It is not a workaround: once the
// coordinator lands the one-line union diff this file's report asks for,
// `ActivityKind` includes `"ttt"` and `TttActivityState` becomes exactly
// `ActivityState` again, same fields, same order, nothing here changes.

import type { ActivityState } from "./activity";
import { winningCells } from "./ttt";
import type { Game, Mark, PlayedMove } from "./ttt";

// COORDINATOR: src/engine/activity.ts needs one member added to the union,
// and the label map extended to match:
//   export type ActivityKind = "chess" | "watch" | "ttt";
//   const LABEL: Record<ActivityKind, string> = {
//     chess: "a game of chess",
//     watch: "watching their screen",
//     ttt: "a game of tic tac toe",
//   };
// Until that lands, `TttActivityState` stands in as the return type below —
// identical shape to `ActivityState`, `kind` widened to admit `"ttt"` — so
// this file compiles today and needs no edit once the union does.
export type TttActivityState = Omit<ActivityState, "kind"> & { kind: "ttt" };

/** Cell names she is allowed to say. Index-matched to `src/engine/ttt`'s
 *  row-major layout. Two words each, on purpose — "the corner" is ambiguous
 *  with four of them on the board, and this is the one place that ambiguity
 *  would show up as her naming the wrong square. */
const CELL_NAME: readonly string[] = [
  "top left", "top middle", "top right",
  "middle left", "centre", "middle right",
  "bottom left", "bottom middle", "bottom right",
];

/**
 * The one-line fact for a move that was just played — ttt's `moveFact`.
 *
 * At most THREE clauses, same hard cap chess's `moveFact` enforces and for
 * the same reason: a person across a board notices ONE thing about a move
 * and says it, not a scoresheet.
 */
export function tttMoveFact(game: Game, whoMoved: "her" | "him"): string {
  const last: PlayedMove | undefined = game.played[game.played.length - 1];
  if (!last) return "";
  const who = whoMoved === "her" ? "she" : "he";
  const bits: string[] = [`${who} took ${CELL_NAME[last.cell]}`];

  // What the board looked like an instant before this move, so "did this
  // block a threat" is read off the record rather than a stored flag —
  // correct on replay, and correct even if this is called long after.
  const before = game.board.slice();
  before[last.cell] = null;
  const opp: Mark = last.by === "x" ? "o" : "x";

  if (game.status.over && game.status.result === "win") {
    bits.push("that wins it");
  } else if (winningCells(before, opp).includes(last.cell)) {
    bits.push("it blocked a line");
  } else if (game.status.over) {
    bits.push("that draws it");
  }
  return bits.join(", ");
}

/**
 * The whole activity, for the tail block at connect — ttt's `chessActivity`.
 *
 * Short by construction. A person sitting down mid-game knows roughly where
 * it stands and whose turn it is, not the full move list.
 */
export function tttActivity(game: Game, herMark: Mark, startedAt: number): TttActivityState {
  const facts: string[] = [];
  const nameable: string[] = [];
  const ply = game.played.length;

  facts.push(ply === 0 ? "the board is empty" : `${ply} move${ply === 1 ? "" : "s"} in`);
  facts.push(`she is playing ${herMark}`);

  // Whose turn it is (or how it ended) comes before the move colour-commentary
  // below, not after — `renderActivity` drops whole facts from the END when
  // over budget, and docs/SURFACES.md names "it is his move" as the row that
  // must never be the one silently cut. `tttMoveFact` is the more dispensable
  // of the two, so it is pushed last.
  if (game.status.over) {
    facts.push(
      game.status.result === "draw"
        ? "the board filled up, nobody won"
        : game.status.winner === herMark
          ? "she won that one"
          : "he won that one",
    );
  } else {
    facts.push(game.status.turn === herMark ? "it is her move" : "it is his move");
  }

  const last = game.played[game.played.length - 1];
  if (last) {
    const whoMoved: "her" | "him" = last.by === herMark ? "her" : "him";
    const fact = tttMoveFact(game, whoMoved);
    if (fact) facts.push(fact);
  }

  // Every cell ever played is nameable — she may refer back to the game, and
  // the record is the ground truth she is allowed to cite. Mirrors chess's
  // "every move ever played is nameable" for the honesty allowlist.
  for (const m of game.played) nameable.push(CELL_NAME[m.cell]);

  return {
    kind: "ttt",
    startedAt,
    facts,
    nameable,
    waitingOnHer: !game.status.over && game.status.turn === herMark,
    // Same contract chessActivity honours: without this, a finished-but-
    // unclosed ttt game rendered "RIGHT NOW YOU TWO ARE IN THE MIDDLE OF"
    // directly above a fact announcing the winner — one block contradicting
    // itself on the lane she speaks from.
    over: game.status.over,
  };
}
