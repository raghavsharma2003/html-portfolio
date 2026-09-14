// MAY THIS CLONE SPEAK FIRST — WS-Q.
//
// ── the law, and where it already exists ─────────────────────────────────
//
// `persona.ts:570-577` records the deletion of Meera's idle nudge, in the
// words that matter here:
//
//   "It fired on SILENCE — they went quiet for a few minutes with the chat
//    open — which makes her unprompted message an unpredictable reward
//    delivered on the cue of not-replying. That is incentive salience
//    engineering: it builds wanting without touching liking, and it is the one
//    shape of proactivity that cannot be made honest, because the trigger
//    itself is their inattention. Every unprompted message she sends is now
//    REASON-contingent instead. Do not re-add a silence-triggered ping in any
//    form."
//
// A published clone gets the SAME law, and for a sharper reason than Meera
// does: the person on the other end is sixteen, `engagementMechanics` is
// structurally false for the minor tier (`clock.ts`), and
// `docs/gurukul/teacher-arc.md` §7 rows 8/9 ban absence-keyed rituals and
// streaks outright rather than merely leaving them unimplemented.
//
// ── how the law is held: BY THE TYPE, NOT BY A CHECK ─────────────────────
//
// The obvious implementation takes the world and decides. This one takes an
// `InitiativeRecord` that HAS NO FIELD FOR ABSENCE. There is no `lastSeenAt`,
// no `gapSinceLastMs`, no `silentDays`, no `streak`, no `sessionCount`, no
// message tally and nothing derived from one. So "ping them because they have
// been quiet" is not a decision this module can reach a wrong answer on — it is
// not a value the module can construct, which is the device `inner.ts` used to
// make a causeless mood unrepresentable and `timeline.ts` used to make the gap
// unrenderable.
//
// That is the property `evals/clonelife/run.mjs` §3 asserts two ways: the
// source text carries no absence-shaped identifier, and an empty record swept
// across gaps from one minute to one year never returns a verdict.
//
// ── every verdict carries its citation ───────────────────────────────────
//
// A reason that cannot be pointed at is a rationalisation. `mayInitiate` is
// never true without `citedAt > 0` naming the turn the reason came from, so a
// clone that speaks first can always answer "why now" with something that
// happened, at a time, in the record. `initiativeVerdict` returns `null` — not
// a false verdict — when there is nothing to cite, because a caller that has to
// explain itself cannot do it from a boolean.
//
// ── LEAF RULE ────────────────────────────────────────────────────────────
//
// Imports nothing, for `cloneLife.ts`'s reason: compiler.ts imports this file,
// and `shapelint -> compiler` is already a live edge.

/** Why a clone is allowed to speak first. A CLOSED union — widening it is the
 *  edit that must be argued for, and there is deliberately no "other". */
export type InitiativeKind =
  /** the clone said it would do a thing by a time, and that time has arrived */
  | "promised-followup"
  /** THEY named a concrete time for a real event ("my mock test is at 4") */
  | "stated-time"
  /** a pattern across GRADED OUTCOMES that is worth naming out loud */
  | "named-pattern";

/** Something the clone itself undertook. `dueAt` is when it comes due; the
 *  clone does not get to decide that a promise is due because a while has
 *  passed. */
export interface InitiativeCommitment {
  /** telegraphic, the thing promised — "rotational-inertia sheet", never a line */
  what: string;
  dueAt: number;
  /** epoch ms of the turn this was said in — the citation */
  citedAt: number;
}

/** A concrete time THEY stated. The teacher-clone case the owner named: "a mock
 *  test the student said was today". */
export interface InitiativeStatedTime {
  what: string;
  at: number;
  citedAt: number;
}

/**
 * A pattern across graded outcomes. `observations` is the evidence count and it
 * is REQUIRED, because the difference between "you drop signs when you rush"
 * and a horoscope is how many times it was actually seen. `lastObservedAt` is
 * the citation.
 *
 * Deliberately NOT derivable from attendance, reply speed, session count or any
 * other usage signal: the only thing that may become a pattern here is a
 * graded piece of WORK.
 */
export interface InitiativePattern {
  what: string;
  observations: number;
  lastObservedAt: number;
}

/**
 * Everything the predicate may read. Note what is absent and stays absent:
 * anything about how long they have been away, how often they come back, or
 * how many days in a row they have shown up.
 */
export interface InitiativeRecord {
  nowMs: number;
  /** the clone's own local minute-of-day, from `cloneLife.localParts` — the
   *  caller resolves it so this module stays free of a timezone and a clock. */
  localMinuteOfDay: number;
  commitments: readonly InitiativeCommitment[];
  statedTimes: readonly InitiativeStatedTime[];
  patterns: readonly InitiativePattern[];
  /** stretches of the student's own day that must never be interrupted — a
   *  stated study block, a live exam window (teacher-arc.md §7 row 11). Local
   *  minute-of-day pairs, inclusive of `fromMin`, exclusive of `toMin`. */
  quietWindows?: readonly { fromMin: number; toMin: number }[];
}

export interface InitiativeVerdict {
  mayInitiate: true;
  kind: InitiativeKind;
  /** telegraphic, third-person, never a line the clone could read out */
  reason: string;
  /** epoch ms of the thing being cited. Never 0 — see the header. */
  citedAt: number;
}

/** teacher-arc.md §7 row 11: "daytime only". 08:00–21:00 local. A clone that
 *  can reach a sixteen-year-old at 2am is a clone that will. */
export const DAYTIME_FROM_MIN = 8 * 60;
export const DAYTIME_TO_MIN = 21 * 60;

/** A promise more than this far past due is not a follow-up any more — it is an
 *  apology, which happens on the next turn THEY start. Speaking first about a
 *  three-day-old promise is a notification, not a person. */
export const OVERDUE_GRACE_MS = 36 * 60 * 60_000;

/** How early a stated time may be spoken to. Wide enough to be useful ("all the
 *  best for four o'clock"), narrow enough that it is about the event and not
 *  about the day. */
export const STATED_TIME_LEAD_MS = 3 * 60 * 60_000;
/** …and how long after it still counts as the same event. */
export const STATED_TIME_TRAIL_MS = 6 * 60 * 60_000;

/** Below this, a "pattern" is a coincidence with a name. Three is the smallest
 *  number that can be a pattern and the largest that costs nothing to require. */
export const PATTERN_MIN_OBSERVATIONS = 3;
/** A pattern nobody has seen for this long is history, not an observation. */
export const PATTERN_FRESH_MS = 14 * 24 * 60 * 60_000;

function inQuietWindow(rec: InitiativeRecord): boolean {
  for (const w of rec.quietWindows || []) {
    if (!w || typeof w.fromMin !== "number" || typeof w.toMin !== "number") continue;
    if (rec.localMinuteOfDay >= w.fromMin && rec.localMinuteOfDay < w.toMin) return true;
  }
  return false;
}

/**
 * The predicate. Returns the single strongest citable reason, or `null`.
 *
 * DETERMINISTIC: same record in, same verdict out, with no clock read inside
 * (`nowMs` is on the record) and no randomness anywhere. That is what lets the
 * eval sweep it exhaustively and what stops two surfaces disagreeing about
 * whether a clone was allowed to speak.
 *
 * ORDER IS PRIORITY, and it is the order of how much the reason is about THEM:
 * a promise the clone owes outranks an event in their day, which outranks an
 * observation about their work.
 */
export function initiativeVerdict(rec: InitiativeRecord | null | undefined): InitiativeVerdict | null {
  if (!rec || typeof rec.nowMs !== "number" || !Number.isFinite(rec.nowMs)) return null;

  // Time-of-day fences first: they can only ever REFUSE, so running them ahead
  // of the reason search means no reason is ever half-evaluated into a log.
  if (rec.localMinuteOfDay < DAYTIME_FROM_MIN || rec.localMinuteOfDay >= DAYTIME_TO_MIN) return null;
  if (inQuietWindow(rec)) return null;

  for (const c of rec.commitments || []) {
    if (!c || !c.what || !String(c.what).trim()) continue;
    if (!c.citedAt) continue; // uncitable is unusable — see the header
    if (typeof c.dueAt !== "number") continue;
    if (rec.nowMs < c.dueAt) continue;
    if (rec.nowMs - c.dueAt > OVERDUE_GRACE_MS) continue;
    return {
      mayInitiate: true,
      kind: "promised-followup",
      reason: `promised: ${String(c.what).trim()}`,
      citedAt: c.citedAt,
    };
  }

  for (const t of rec.statedTimes || []) {
    if (!t || !t.what || !String(t.what).trim()) continue;
    if (!t.citedAt) continue;
    if (typeof t.at !== "number") continue;
    if (rec.nowMs < t.at - STATED_TIME_LEAD_MS) continue;
    if (rec.nowMs > t.at + STATED_TIME_TRAIL_MS) continue;
    return {
      mayInitiate: true,
      kind: "stated-time",
      reason: `they said: ${String(t.what).trim()}`,
      citedAt: t.citedAt,
    };
  }

  for (const p of rec.patterns || []) {
    if (!p || !p.what || !String(p.what).trim()) continue;
    if (!p.lastObservedAt) continue;
    if (!(p.observations >= PATTERN_MIN_OBSERVATIONS)) continue;
    if (rec.nowMs - p.lastObservedAt > PATTERN_FRESH_MS) continue;
    return {
      mayInitiate: true,
      kind: "named-pattern",
      reason: `seen ${p.observations}x: ${String(p.what).trim()}`,
      citedAt: p.lastObservedAt,
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// the render — T19 `clone.initiative`
// ─────────────────────────────────────────────────────────────────────────

/** Header (383) + one telegraphic row. The block cannot grow past this: the
 *  verdict is a SINGLE reason by construction, and `initiativeVerdict` returns
 *  at most one. Sized so the header plus a generous row fits with room —
 *  measured against the literal header rather than estimated, because the
 *  first sizing of this constant was an estimate and the block silently
 *  rendered nothing. */
export const INITIATIVE_BUDGET = 520;

/**
 * Instructional English, like every other tail header here.
 *
 * The last sentence is the one that earns its bytes: the failure mode of a
 * visible reason is the clone ANNOUNCING it ("I'm messaging because you said
 * your mock was today"), which turns a person noticing into a system reporting.
 */
export const INITIATIVE_HEADER =
  "YOU ARE SPEAKING FIRST THIS TURN, and this is the one reason you are allowed to. " +
  "Say the ordinary human thing that comes off it, in your own words, short. " +
  "Never state the reason as a reason, never mention noticing, never mention time passing, " +
  "and never refer to their silence or their absence in any form. " +
  "If nothing natural comes off it, a small ordinary line is a complete message.";

export function renderInitiative(verdict: InitiativeVerdict | null | undefined): string {
  if (!verdict || verdict.mayInitiate !== true || !verdict.reason || !verdict.citedAt) return "";
  const row = `- ${verdict.reason}`;
  const text = `${INITIATIVE_HEADER}\n${row}`;
  // Over budget the ROW is what would have to go, and a header with no reason
  // under it is an instruction to speak first with nothing to speak from —
  // strictly worse than not rendering. So the whole block goes, together.
  return text.length > INITIATIVE_BUDGET ? "" : text;
}
