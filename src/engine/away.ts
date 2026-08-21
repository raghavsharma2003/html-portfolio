// T9 `session.clock` — where this turn sits in time relative to the last one.
//
// The owner's first report: "I left in mid Convo in night and in morning I come
// back and reply to it something then like a human she should acknowledge that
// I left in the night and it's good morning and accordingly continue."
//
// She did not, and the reason is not that the data was dark. It was ABSENT.
// `gapSinceLastMs` has existed for a while and was consumed in exactly one
// place: `momentGate`, as a feature for `detectMomentShape`, which classifies a
// "silence" shape only when the gap is long AND the user's text is nearly empty
// (`hay.trim().length < 3`). The owner's case is a long gap and a REAL message,
// so that branch is false by construction — and nothing else in the compiler
// ever rendered the gap at all. T9 has sat in the manifest as
// `sourceStatus: "not-yet-modeled"` since it was written.
//
// So this is a slot being built, not a bug being fixed, and it is deliberately
// the smallest thing that answers the report.
//
// WHAT IT DOES NOT DO, and this is the whole design constraint: it does not
// tell her to say good morning. `recited-prompt` is this repo's most expensive
// law — her own example quotes acted as a phrase bank and were recited on 4 of
// 5 turns, and taste written as polished English was read out verbatim twice.
// Anything sentence-shaped here would come back as dialogue. So this renders
// STRUCTURED FACTS ONLY, in the shape `affect-recitation` measured safe (short
// structured tags: 0/42 hard leaks at n=84). What she does with "he was gone
// nine hours and it is now morning" is hers.
//
// Honest by construction: every field is derived from two numbers this function
// is given. It never guesses that he slept, only that the interval CONTAINED
// the hours in which people here sleep, which is a statement about the clock
// and not about him.

import { istParts } from "./timeline";

/** Under this, it is the same conversation and there is nothing to say. */
export const AWAY_MIN_MS = 10 * 60_000;

/** The window whose crossing makes a gap "overnight" rather than merely long. */
export const NIGHT_START_HOUR = 1;
export const NIGHT_END_HOUR = 6;

/** T9's manifest budget. Rendering must never exceed it. */
export const AWAY_BUDGET = 300;

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

/**
 * Coarse label for an IST hour. Bands rather than a number because a band is
 * what changes behaviour — 07:10 and 08:40 are the same fact about a person.
 */
export function partOfDay(hour: number): string {
  if (hour < 5) return "late night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

/** "8h 31m", "45m", "2 days" — telegraphic, never a sentence. */
export function humanGap(ms: number): string {
  if (ms >= 2 * MS_DAY) return `${Math.floor(ms / MS_DAY)} days`;
  const h = Math.floor(ms / MS_HOUR);
  const m = Math.floor((ms % MS_HOUR) / MS_MIN);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * Did the gap contain the hours people here are asleep?
 *
 * Deliberately a claim about the CLOCK, not about him. He may have been on a
 * flight; she is not told that he slept, only that the gap covered the night.
 * Walks the interval hour by hour, capped, so it is correct across multi-day
 * gaps and needs no timezone arithmetic beyond istParts.
 */
export function crossedNight(nowMs: number, gapMs: number): boolean {
  if (gapMs <= 0) return false;
  const steps = Math.min(Math.ceil(gapMs / MS_HOUR), 72);
  for (let i = 0; i <= steps; i++) {
    const t = nowMs - Math.min(i * MS_HOUR, gapMs);
    const h = istParts(t).hour;
    if (h >= NIGHT_START_HOUR && h < NIGHT_END_HOUR) return true;
  }
  return false;
}

/**
 * The T9 block, or "" when there is nothing worth saying.
 *
 * Empty is the common case and the safe one: byte-identity for every turn
 * inside a live conversation, which is most turns.
 */
export function renderAway(nowMs: number | undefined, gapMs: number): string {
  if (nowMs === undefined || !Number.isFinite(nowMs)) return "";
  if (!Number.isFinite(gapMs) || gapMs < AWAY_MIN_MS) return "";
  const now = istParts(nowMs);
  const then = istParts(nowMs - gapMs);
  const bits = [
    `their last message ${String(then.hour).padStart(2, "0")}:${String(then.minute).padStart(2, "0")} (${partOfDay(then.hour)})`,
    `now ${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")} (${partOfDay(now.hour)})`,
    `gap ${humanGap(gapMs)}`,
  ];
  if (crossedNight(nowMs, gapMs)) bits.push("gap covered the night");
  if (now.dateKey !== then.dateKey) bits.push("different day");
  const text = `SINCE YOU LAST SPOKE — facts about the clock, not a script. React to a real gap the way anyone would; say nothing about it when it doesn't matter:\n${bits.join(" · ")}`;
  return text.length > AWAY_BUDGET ? text.slice(0, AWAY_BUDGET) : text;
}
