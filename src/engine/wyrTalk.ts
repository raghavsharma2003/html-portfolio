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

// ── the DURABLE half: which questions came up, and who chose what ──────────
//
// `wyrActivity`'s `facts` carry the card on screen and a running tally, which
// is exactly right for the present moment and is ALL that reached her memory.
// So a finished session was remembered as "6 rounds so far; 4 agreed, 2
// clashed so far" — counts with nothing under them. Asked afterwards which
// choices they had disagreed on, she had a number and no questions, and she
// filled the gap: "dono pineapple pizza aur early morning runs pe disagree hue
// the" — neither card existed in the deck she dealt him (2026-08-23 tester
// report: "Ye questions to aye hi nahi. Made up questions").
//
// A tally is not a memory of a game. The rounds are.

/** How many answered rounds enter the record, newest last. Six is a real
 *  sitting; beyond that it stops being "what we picked" and becomes a
 *  transcript, which is what `EPISODE_SUMMARY_MAX` would drop anyway. */
export const RECORD_ROUNDS = 6;

/** One durable row per answered round: the question as the two SHORT labels
 *  she was already allowed to name, and both picks. Never the card's full
 *  `a`/`b` sentence — `recited-prompt`, and it is the rule this file opens
 *  with. */
export function wyrRecord(session: WyrSession): string[] {
  const rows: string[] = [];
  const { agreed, clashed } = tally(session);
  // The tally goes FIRST because the drop policy drops from the end: if only
  // one row survives the budget it must be the one that is true of the whole
  // session rather than of one card.
  if (session.rounds.length)
    rows.push(`${session.rounds.length} rounds, ${agreed} agreed, ${clashed} clashed`);
  for (const r of session.rounds.slice(-RECORD_ROUNDS)) {
    const c = cardById(r.cardId);
    if (!c) continue;
    const label = (p: "a" | "b") => (p === "a" ? c.aShort : c.bShort);
    rows.push(
      r.his === r.her
        ? `on ${c.aShort} or ${c.bShort}, both picked ${label(r.his)}`
        : `on ${c.aShort} or ${c.bShort}, he picked ${label(r.his)}, she picked ${label(r.her)}`,
    );
  }
  return rows;
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
    record: wyrRecord(session),
  };
}
