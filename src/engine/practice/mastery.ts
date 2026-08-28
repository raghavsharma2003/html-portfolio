// Per-topic mastery, folded from graded practice history. Pure function of a
// record, same discipline `milestones.ts` states for the relationship record
// and `session.ts` states for grading itself: no I/O, no clock read, no
// English she could say — this is data for two screens (Practice Hub's
// picker, Mastery Map) and nothing here reaches a prompt.
//
// ── why this is additive over `session.ts`'s summaries, not a rewrite ─────
//
// `student-app-spec.md` §2.1 wants mastery weighted by "attempts, correctness,
// recency, difficulty of the questions attempted". This module gets
// correctness and attempt volume from `PracticeSummary.byTopic` — which
// `session.ts` already counts, never estimates, per its own header — and
// leaves difficulty weighting to the marks scale `syllabus.ts`'s `MARKING`
// already encodes (matrix-match is worth 8, single-correct 3), rather than
// inventing a second, un-provable difficulty multiplier on top of a scheme
// that is itself already difficulty-shaped. What this module deliberately
// does NOT add is a time/recency term — see "no decay-by-absence" below.
//
// ── the one property `evals/mastery.mjs` gates ────────────────────────────
//
// NO DECAY BY ABSENCE. A student who does not practise a topic for a month
// must not come back to a LOWER mastery number than they left — nothing here
// reads a clock, a session timestamp, or "time since last attempt", so there
// is structurally nothing that could produce that number. This is the same
// shape as `milestones.ts`'s `never-scheduled` law and `clock.ts`'s minor
// gate: the property holds because the code that could violate it does not
// exist, not because something promises not to call it.
//
// The fold is also ORDER-INDEPENDENT across how sessions are chunked — three
// five-question sets and one fifteen-question set over the same attempts
// produce the same mastery, because summing counters is commutative. That is
// the "monotonicity" the eval names: the level a topic sits at is a pure
// function of the accumulated record, never of how it arrived.

import type { Graded, PracticeSummary, TopicTally } from "./session";

export type MasteryLevel = "unattempted" | "building" | "developing" | "solid" | "mastered";

export const MASTERY_LEVELS: readonly MasteryLevel[] = [
  "unattempted",
  "building",
  "developing",
  "solid",
  "mastered",
];

/**
 * The thresholds. Two axes, not one: a score band alone would let a single
 * lucky guess on one question read as "mastered", which is the same signal
 * problem `student-app-spec.md` §4.2 names for handing hard problems to an
 * unmastered topic — a level built on too little evidence corrupts the thing
 * that reads it. So a level requires BOTH the score band AND its own minimum
 * attempt count; failing the attempt bar caps the level at `building`
 * (score) or `developing` (the "some evidence, not enough yet" middle case)
 * regardless of how good the score looks.
 */
export const SCORE_BANDS: Record<Exclude<MasteryLevel, "unattempted" | "building">, number> = {
  developing: 0.4,
  solid: 0.7,
  mastered: 0.9,
};

/** Minimum graded attempts (skips excluded — see `attemptedOf`) before a
 *  topic may sit at each level. Sparse and rising, same shape as
 *  `milestones.ts`'s tier tables: the higher the claim, the more evidence it
 *  costs, because a wrongly-declared "mastered" is the expensive direction to
 *  be wrong in (§4.2's guessing-corrupts-the-signal argument runs both ways). */
export const MIN_ATTEMPTS: Record<Exclude<MasteryLevel, "unattempted">, number> = {
  building: 1,
  developing: 3,
  solid: 3,
  mastered: 6,
};

export interface TopicMastery {
  topicId: string;
  /** graded, non-skipped attempts, summed across every session folded in */
  attempted: number;
  clean: number;
  marks: number;
  maxMarks: number;
  /** marks / maxMarks, clamped to [0, 1] — negative marking can push the raw
   *  ratio below 0, and a mastery score below "none of it" is not a number */
  score: number;
  level: MasteryLevel;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Attempts that are EVIDENCE. A skipped question says nothing about whether
 *  the topic is known, so it is excluded from the attempt bar the same way
 *  `session.ts`'s own `PracticeSummary.answered` excludes it. */
const attemptedOf = (t: TopicTally): number => t.attempted;

function levelFor(attempted: number, score: number): MasteryLevel {
  if (attempted <= 0) return "unattempted";
  if (attempted >= MIN_ATTEMPTS.mastered && score >= SCORE_BANDS.mastered) return "mastered";
  if (attempted >= MIN_ATTEMPTS.solid && score >= SCORE_BANDS.solid) return "solid";
  if (attempted >= MIN_ATTEMPTS.developing && score >= SCORE_BANDS.developing) return "developing";
  return "building";
}

/**
 * Fold any number of session summaries, in ANY order, into one mastery map.
 *
 * Additive and commutative by construction — see the header's "monotonicity"
 * note — so a caller may fold a student's whole history at once or one
 * session at a time as it finishes; both produce the same answer for the
 * same underlying attempts.
 */
export function foldMastery(
  summaries: readonly PracticeSummary[],
  prior?: ReadonlyMap<string, TopicMastery>,
): Map<string, TopicMastery> {
  const acc = new Map<string, TopicMastery>();
  if (prior) for (const [id, m] of prior) acc.set(id, { ...m });

  for (const s of summaries) {
    for (const t of s.byTopic) {
      const cur = acc.get(t.topicId) ?? {
        topicId: t.topicId,
        attempted: 0,
        clean: 0,
        marks: 0,
        maxMarks: 0,
        score: 0,
        level: "unattempted" as MasteryLevel,
      };
      cur.attempted += attemptedOf(t);
      cur.clean += t.clean;
      cur.marks += t.marks;
      cur.maxMarks += t.maxMarks;
      acc.set(t.topicId, cur);
    }
  }

  for (const m of acc.values()) {
    m.score = m.maxMarks > 0 ? clamp01(m.marks / m.maxMarks) : 0;
    m.level = levelFor(m.attempted, m.score);
  }
  return acc;
}

/** One topic's mastery out of a folded map, or the zero/`unattempted` shape
 *  for a topic the record has never touched — so a caller never has to
 *  special-case "not in the map" against "in the map at zero". */
export function masteryOf(map: ReadonlyMap<string, TopicMastery>, topicId: string): TopicMastery {
  return (
    map.get(topicId) ?? {
      topicId,
      attempted: 0,
      clean: 0,
      marks: 0,
      maxMarks: 0,
      score: 0,
      level: "unattempted",
    }
  );
}

// ── XP — strictly from graded outcomes ─────────────────────────────────────
//
// `student-app-spec.md` §2.2: XP is earned "strictly from graded outcomes"
// and NEVER from opening the app, time spent, or any action that is not
// itself evidence of learning. `rushed` is excluded on purpose and for the
// same reason the verdict itself outranks a full-marks score in `grade()`
// (`session.ts`): an answer that landed under the format's floor time did not
// come from working the problem, and XP built out of it is the "XP-for-
// attendance... rewards presence, not progress" failure `student-app-spec.md`
// §2.2 names, wearing a stopwatch instead of an open-app event. `skipped`
// scores zero marks already (`MARKING[*].skipped === 0` for every format —
// `syllabus.ts`), so excluding it here is belt-and-braces, not load-bearing.
//
// Negative marks (a wrong multi-correct, a wrong matrix row) are floored at
// zero PER ATTEMPT rather than allowed to subtract from the running total —
// XP is a count of evidence earned, and a count that can go backwards from a
// single bad guess is a countdown wearing a counter's name, which is exactly
// the register `milestones.ts` and the minor gate exist to keep XP out of.

export function xpFromGraded(graded: readonly Graded[]): number {
  let xp = 0;
  for (const g of graded) {
    if (g.verdict === "rushed" || g.verdict === "skipped") continue;
    xp += Math.max(0, g.marks);
  }
  return xp;
}

/**
 * Sparse level tiers over lifetime XP — `milestones.ts`'s own stated law
 * ("tier tables are sparse on purpose... a milestone that fires weekly is
 * wallpaper") reused directly, because a level-up is exactly the `Moment`
 * shape that module already defines and this is the same mechanism wearing a
 * different counter. Widening gaps, not a level every fixed increment: the
 * distance a demo bank's dozen questions can cover is meant to reach level 2
 * or 3, never level 8.
 */
export const XP_TIERS: readonly number[] = [40, 120, 300, 600, 1200, 2400, 4800];

export interface XpLevel {
  /** 1 at zero XP, rising by one per crossed tier */
  level: number;
  xp: number;
  /** XP needed to cross into the next level, or null at the top tier */
  nextTierXp: number | null;
}

export function levelForXp(xp: number): XpLevel {
  let level = 1;
  let nextTierXp: number | null = null;
  for (const t of XP_TIERS) {
    if (xp >= t) level++;
    else if (nextTierXp === null) nextTierXp = t;
  }
  return { level, xp, nextTierXp };
}
