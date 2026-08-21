// The would-you-rather → activity adapter. The ONLY place wyr becomes words.
// The wyr sibling of `chessTalk.ts`; read that file's header first, because
// every rule it states applies here unchanged and this file does not repeat
// the reasoning, only the shape.
//
// `src/engine/wyr/*` emits ids, letters ("a"/"b") and numbers — no English.
// This file turns that into the handful of third-person, telegraphic facts
// she is given. WHAT THIS FILE MAY NOT DO, and `evals/wyr.mjs` enforces it:
// write a line she could SAY, or quote a card's full `a`/`b` sentence into a
// fact. `recited-prompt` measured her own example quotes recited on 4 of 5
// turns — everything below is a fact about what happened, not a line of
// dialogue about it. "the question: chai forever or coffee forever" belongs
// here; "arre yaar chai hi jeetega" belongs to her.

import type { ActivityState, ActivityKind } from "./activity";
import { cardById, type WyrCard } from "./wyr/deck";
import { currentCardId, isAnswered, tally, type WyrSession } from "./wyr/session";

/**
 * The one-line fact for a single pick — the per-event poke, wyr's analogue of
 * `chessTalk.ts`'s `moveFact`. THREE clauses, hard, for the exact reason
 * `moveFact`'s comment gives: a person across the table notices one thing
 * about a round and says it, not a scoresheet. "he picked X, she picked Y,
 * that's a clash" (or "they agree") is the whole shape.
 */
export function wyrPickFact(card: WyrCard, his: "a" | "b", her: "a" | "b"): string {
  const label = (p: "a" | "b") => (p === "a" ? card.aShort : card.bShort);
  const bits = [`he picked ${label(his)}`, `she picked ${label(her)}`];
  bits.push(his === her ? "they agree" : "that's a clash");
  return bits.join(", ");
}

/**
 * The whole activity, for the tail block at connect (and for the chat lane's
 * `keys.activity`, once `state/game.ts`'s `activityOf` is wired to call this —
 * see `wyr/session.ts`'s COORDINATOR note).
 *
 * Facts are emitted MOST-important-first, mirroring `chessTalk.ts`'s ordering
 * rationale in reverse: `renderActivity` drops whole facts from the END when
 * over budget, so what she is least likely to lose is the current question
 * and what just happened with it; the running tally is the one row that can
 * most afford to go.
 */
export function wyrActivity(session: WyrSession): ActivityState {
  const facts: string[] = [];
  const nameable: string[] = [];

  const curId = currentCardId(session);
  const card = curId ? cardById(curId) : undefined;

  if (card) {
    facts.push(`the question: ${card.aShort} or ${card.bShort}`);
    nameable.push(card.aShort, card.bShort);
    if (isAnswered(session)) {
      const last = session.rounds[session.rounds.length - 1];
      facts.push(wyrPickFact(card, last.his, last.her));
    }
  }

  facts.push(session.rounds.length === 0 ? "just started" : `${session.rounds.length} rounds so far`);

  const { agreed, clashed } = tally(session);
  if (session.rounds.length > 0) facts.push(`${agreed} agreed, ${clashed} clashed so far`);

  // Every round ever played is nameable — she may refer back to earlier
  // rounds, and the record is the ground truth she is allowed to cite. Same
  // rule chessTalk.ts applies to the full move list.
  for (const r of session.rounds) {
    const c = cardById(r.cardId);
    if (c) nameable.push(c.aShort, c.bShort);
  }

  return {
    // COORDINATOR: drop this cast once `ActivityKind` in `./activity` gains a
    // "wyr" member — see the diff at the top of that file's report. The cast
    // exists only because this file may not edit activity.ts, and it is
    // exactly as wide as it needs to be: `unknown` in the middle, never `any`.
    kind: "wyr" as unknown as ActivityKind,
    startedAt: session.startedAt,
    facts,
    nameable: Array.from(new Set(nameable)),
  };
}
