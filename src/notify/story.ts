// WHEN HER STORY NEXT CHANGES — derived from the real clock, never mirrored.
//
// `storyCatalog.ts` owns the five slots and their boundaries, and its own
// header explains at length why that table is mirrored from `sky.ts` with a
// 1,440-minute-per-weekday gate holding the two together. A THIRD copy of the
// same numbers here would need a third gate, and this repo's name for the
// alternative to that gate is "mirrored is not duplicated-and-hoped".
//
// So there is no table in this file. `slotStartedAt(t)` is a monotone step
// function of t — the instant the occurrence containing t began — and the next
// change is the smallest t where it steps. That is a binary search over the
// REAL function, so it cannot disagree with the picture the ring shows: if
// someone edits a boundary in storyCatalog.ts, this follows on the same commit
// with nothing to keep in sync.
//
// (It also picks up the one subtlety a hand-written table would get wrong: the
// night slot spans midnight, so 19:40 and the next 04:30 are ONE occurrence
// and one picture. `slotStartedAt` already collapses them, and a search over it
// inherits that for free.)

import { activeStories, slotStartedAt } from "../engine/storyCatalog";
import type { Story } from "../engine/storyCatalog";

/** No slot occurrence is longer than night's 10h30m, so a day and a bit is a
 *  bound the search can never fail to find a step inside. */
const HORIZON_MS = 26 * 60 * 60 * 1000;

/**
 * The next instant her story becomes a different story, or null if nothing
 * changes inside the horizon (which cannot happen with the shipped pool, and
 * is handled anyway because "cannot happen" is how the pool going empty would
 * look).
 *
 * Resolved to the minute: the boundaries are all whole minutes, and asking for
 * millisecond precision from a search would only produce a schedule time one
 * millisecond after a boundary that a phone will batch by minutes regardless.
 */
export function nextStoryChange(now: number = Date.now()): number | null {
  const here = slotStartedAt(now);
  let lo = now;
  let hi = now + HORIZON_MS;
  if (slotStartedAt(hi) === here) return null;
  // invariant: slotStartedAt(lo) === here, slotStartedAt(hi) !== here
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (slotStartedAt(mid) === here) lo = mid;
    else hi = mid;
  }
  // `hi` is inside the new occurrence and within a minute of its start; the
  // occurrence's own start is the honest answer, and it is what `Story.at`
  // will say the post time was.
  return slotStartedAt(hi);
}

/** Her story as it will be at that instant. Authored days still win, because
 *  this asks `activeStories` rather than the pool directly. */
export function storyAtChange(at: number): Story | null {
  const live = activeStories(at);
  return live.length ? live[live.length - 1] : null;
}
