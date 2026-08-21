// How long to wait after their last message before replying, in case more is
// coming.
//
// The owner's report: "when I send multiple messages before her reply … human
// dont handle this hardcoded way it's depends on the Convo and etc etc."
// He is right, and the shipped value was a hardcoded 1300 ms.
//
// THIS REPO HAS ALREADY SOLVED THIS SHAPE ONCE, on the watch lane, and the
// measurement is the reason this file exists rather than a tuned constant.
// `scene-hold-800` bounds the landing hold at `HOLD_MULTIPLIER × that person's
// own rhythm`, and what it found is the trap here too: with a fixed ceiling,
// **the slower someone moved the longer she made them wait**, which is
// backwards. A constant cannot be right for both a person who fires six
// fragments in four seconds and a person who thinks between each one.
//
// So the wait is derived from HIS OWN recent gaps, bounded at both ends.
//
// WHY THIS IS ENGINE AND NOT SURFACE. Every surface — web, Telegram, Discord,
// WhatsApp — has to decide this, and `surface-bypasses-parse` is what happens
// when a surface owns a decision the engine should have made: it drifts, and it
// drifts silently. The POLICY (how long, given a rhythm) lives here as a pure
// function. Only the TIMER (actually waiting) belongs to the surface, because
// only the surface knows what a timer is.
//
// Pure and import-free on purpose, so it is testable offline and cannot become
// a reason this module can no longer be bundled somewhere.

/** Below this, more may still be coming. Above it, they are done talking. */
export const BURST_SAMPLE_CEILING_MS = 25_000;

/**
 * Waiting exactly one gap would catch the median follow-up and miss half of
 * them, so the wait is longer than the rhythm it is derived from. 1.6 is a
 * judgment, not a measurement — the honest label is that it is the smallest
 * multiplier that clears a typical gap with margin, and the thing to tune first
 * if bursts are still being split.
 */
export const BURST_MULTIPLIER = 1.6;

/** Never so short that a fast typist gets answered mid-thought. */
export const BURST_MIN_MS = 700;

/**
 * Never so long the reply reads as dead air. Above roughly this, a person
 * assumes they have been left on read — which is the failure the wait exists to
 * avoid, arriving by the other door.
 */
export const BURST_MAX_MS = 3_200;

/** What shipped before this file, and what is used until a rhythm exists. */
export const BURST_DEFAULT_MS = 1_300;

/** Enough samples to have a rhythm at all. One gap is an anecdote. */
export const BURST_MIN_SAMPLES = 2;

/** The shape this needs from a message, so it need not import the UI's type. */
export type BurstTurn = { from: "her" | "me"; at: number; channel?: "chat" | "call" };

/**
 * Gaps between CONSECUTIVE messages of theirs, newest last.
 *
 * Consecutive matters: a gap that spans one of her replies is a conversational
 * turn, not a burst, and folding those in would inflate the rhythm with exactly
 * the pauses this is meant to distinguish from it. Call turns are excluded for
 * the same reason — spoken timing is a different clock.
 */
export function recentUserGaps(turns: readonly BurstTurn[], sample = 12): number[] {
  const gaps: number[] = [];
  for (let i = turns.length - 1; i > 0 && gaps.length < sample; i--) {
    const cur = turns[i];
    const prev = turns[i - 1];
    if (cur.channel === "call" || prev.channel === "call") continue;
    if (cur.from !== "me" || prev.from !== "me") continue;
    const d = cur.at - prev.at;
    if (d > 0 && d <= BURST_SAMPLE_CEILING_MS) gaps.push(d);
  }
  return gaps.reverse();
}

/** Median, not mean: one 20-second pause should not redefine a fast typist. */
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * The wait, in ms, for someone whose recent within-burst gaps are `gaps`.
 *
 * Returns the shipped default when there is not yet a rhythm, so a new
 * conversation behaves exactly as it did before this file existed — a person
 * with no history must not be a person with a new bug.
 */
export function burstWaitMs(gaps: readonly number[]): number {
  if (gaps.length < BURST_MIN_SAMPLES) return BURST_DEFAULT_MS;
  const scaled = Math.round(median(gaps) * BURST_MULTIPLIER);
  return Math.min(BURST_MAX_MS, Math.max(BURST_MIN_MS, scaled));
}
