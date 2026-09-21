// A practice set, as a state machine. Pure functions over data: no I/O, no
// clock of its own, no DOM, and not one word of English she could say.
//
// This is the practice stack's `src/engine/chess/`. It emits enums and numbers
// — a marks total, a verdict, a moment shape — and `practiceTalk.ts` is the
// only place any of it becomes words. The split is the same one chess makes and
// it is here for the same two reasons: the rules half has to be PROVABLE and
// prose is not provable, and the grading has to be replayable in an eval
// without a browser, a bank or a model.
//
// ── the one law that outranks everything else here ────────────────────────
//
// A MODEL NEVER GRADES. `student-app-spec.md` §3.4 and `SPEC-GAMES.md` §0.1
// say it in the same shape ("her MOVE is code, her TALK is the model"), and
// the stakes here are worse than an illegal chess move: a wrongly-graded
// question does not desync a board, it teaches a sixteen-year-old the wrong
// thing and moves a mastery track on the strength of it. Every number below
// comes off the answer key by arithmetic.
//
// ── and the one that is easiest to get wrong ──────────────────────────────
//
// The multi-correct partial scheme. `student-app-spec.md` §4.3: full marks
// only when every correct option and no incorrect one is chosen, +1 per correct
// option for a correct SUBSET with nothing wrong in it, −2 the moment anything
// wrong is included. The simplified all-or-nothing version scores a student who
// found three of four and stopped identically to one who guessed, which is the
// mastery signal being corrupted at its source. `evals/practice.mjs` carries
// every edge of it, including the one-wrong-kills case.

import type { DifficultyBand, QuestionFormat } from "./syllabus";
import { FLOOR_SECONDS, MARKING, isUnder, maxMarksFor } from "./syllabus";

// ── questions and keys ────────────────────────────────────────────────────

/**
 * Option ids are `A`–`D` in a paper and matrix rows are `P`–`S` against
 * columns `1`–`5`, but nothing here depends on that: the grader compares the
 * tokens it is given. A bank that ships six options grades correctly, and the
 * one place the count matters (matrix-match's max marks) reads it off the key.
 */
export type OptionId = string;

export type AnswerKey =
  | { format: "single_correct"; correct: OptionId }
  | { format: "multi_correct"; correct: readonly OptionId[] }
  | { format: "integer"; value: number }
  /** `tolerance` is per question, decided by the expected decimal places —
   *  `student-app-spec.md` §4.3 requires the band rather than an equality test,
   *  because a numeric field and a float are not the same kind of answer. */
  | { format: "numerical"; value: number; tolerance: number }
  | { format: "matrix_match"; rows: readonly MatrixRow[] };

export interface MatrixRow {
  row: string;
  cols: readonly string[];
}

/**
 * WHAT KIND OF WRONG a wrong answer is, tagged on the question by whoever
 * authored it.
 *
 * This is the substrate under `slip` vs `conceptual_miss`, and it is DATA
 * rather than inference on purpose. A JEE distractor is authored: option C is
 * literally the answer you get if you drop the sign in the substitution step,
 * and the person who wrote it knows that. Deriving it instead — from timing,
 * from how close a number is — would be the engine forming an opinion about a
 * student's understanding out of thin air, which is exactly the claim
 * `teacher-arc.md` §2.2 bans the clone from making.
 *
 * Untagged wrong answers are `conceptual_miss`, which is the DEFAULT and not a
 * finding: see the note on the verdict enum below.
 */
export type ErrorNature = "slip" | "conceptual";

export interface Distractor {
  /** the option id, or the numeric value, that this wrong answer is */
  answer: OptionId | number;
  nature: ErrorNature;
  /** the solution step it comes out of — "the substitution step", "the sign on
   *  the second term". The ONLY thing `practiceTalk.ts` may name about a wrong
   *  answer, and the thing `streak_of_slips_same_step` counts. */
  step?: string;
}

export interface Question {
  /** stable and internal. NEVER reaches her vocabulary — see `ref`. */
  id: string;
  /** a leaf id from `syllabus.ts` (a topic, or a chapter with no topics yet) */
  topicId: string;
  band: DifficultyBand;
  key: AnswerKey;
  /**
   * A human reference a person actually says out loud — "JEE 2019 Paper 1 Q7".
   * `id` is a database key and would be read aloud as characters on the voice
   * lane, which is the `FEN read aloud is gibberish` failure with a different
   * string in it. `practiceTalk.ts` puts `ref` in `nameable` and never `id`.
   */
  ref?: string;
  /** overrides `FLOOR_SECONDS[format]` for a question that really is faster */
  floorSeconds?: number;
  distractors?: readonly Distractor[];
}

export const formatOf = (q: Question): QuestionFormat => q.key.format;

// ── responses ─────────────────────────────────────────────────────────────

export type Response =
  | { kind: "skipped" }
  /** single- and multi-correct. One entry for single-correct. */
  | { kind: "options"; chosen: readonly OptionId[] }
  /** integer and numerical */
  | { kind: "value"; value: number }
  | { kind: "matrix"; rows: readonly MatrixRow[] };

export const SKIPPED: Response = { kind: "skipped" };

// ── verdicts ──────────────────────────────────────────────────────────────

/**
 * What kind of attempt this was. Six, and they are FACTS ABOUT AN ATTEMPT —
 * never about a student. `teacher-arc.md` §2.2 bans ability labels outright
 * ("not 'you're weak in organic'"), and the way that ban survives contact with
 * a grading engine is that the engine never produces a label about a person in
 * the first place.
 *
 * Two of the names need their meaning stated, because a reader will assume the
 * wrong one:
 *
 *  - `conceptual_miss` is the UNMARKED wrong answer: the answer matched no
 *    tagged distractor, or matched one tagged `conceptual`. It means "we have
 *    no evidence this was an execution slip", NOT "the student does not
 *    understand the topic". `practiceTalk.ts` renders it as a miss on that
 *    question and never as a statement about what they know, and that is the
 *    whole reason this enum is internal.
 *  - `rushed` is correct-or-not under the format's floor time. It is a fact
 *    about how long the attempt took, which is why it outranks the score: an
 *    answer that arrived in eight seconds did not come from working the
 *    problem, and letting it register as a clean solve is how a mastery track
 *    fills up with things nobody can actually do.
 */
export type Verdict =
  | "clean_solve"
  | "partial"
  | "slip"
  | "conceptual_miss"
  | "skipped"
  | "rushed";

export interface Graded {
  questionId: string;
  topicId: string;
  format: QuestionFormat;
  band: DifficultyBand;
  marks: number;
  maxMarks: number;
  /** full marks. The only sense of "correct" a mastery track may read. */
  correct: boolean;
  verdict: Verdict;
  /** the solution step a tagged distractor came out of, when there was one */
  step?: string;
  elapsedMs: number;
  ref?: string;
}

// ── grading ───────────────────────────────────────────────────────────────

const asSet = (xs: readonly string[]): Set<string> => new Set(xs);

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const A = asSet(a);
  const B = asSet(b);
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
};

/** Floats. `0.1 + 0.2 <= 0.3` is false, and a student who typed the right
 *  number to two decimals must not lose four marks to binary representation. */
const EPS = 1e-9;

interface Scored {
  marks: number;
  maxMarks: number;
  correct: boolean;
  /** the wrong thing they actually chose, for the distractor lookup */
  wrongAnswer: OptionId | number | null;
  /** nothing was entered at all */
  empty: boolean;
}

function score(q: Question, r: Response): Scored {
  const k = q.key;
  const scheme = MARKING[k.format];
  const maxMarks = maxMarksFor(k.format, k.format === "matrix_match" ? k.rows.length : undefined);
  const nothing: Scored = { marks: scheme.skipped, maxMarks, correct: false, wrongAnswer: null, empty: true };
  if (r.kind === "skipped") return nothing;

  switch (k.format) {
    case "single_correct": {
      if (r.kind !== "options" || r.chosen.length === 0) return nothing;
      // Two options on a single-correct question is not a partial answer, it
      // is a broken surface. Graded as wrong rather than thrown, because a
      // grader that can throw is a grader that can eat a submitted paper.
      const one = r.chosen.length === 1 ? r.chosen[0] : null;
      if (one !== null && one === k.correct) {
        return { marks: scheme.full, maxMarks, correct: true, wrongAnswer: null, empty: false };
      }
      return { marks: scheme.wrong, maxMarks, correct: false, wrongAnswer: one ?? r.chosen[0], empty: false };
    }
    case "multi_correct": {
      if (r.kind !== "options" || r.chosen.length === 0) return nothing;
      const key = asSet(k.correct);
      const chosen = [...asSet(r.chosen)];
      const wrong = chosen.filter((c) => !key.has(c));
      // ONE WRONG KILLS. Not "one wrong cancels one right" — the scheme is a
      // cliff, and the cliff is the reason a JEE student stops at three.
      if (wrong.length) {
        return { marks: scheme.wrong, maxMarks, correct: false, wrongAnswer: wrong[0], empty: false };
      }
      if (chosen.length === key.size) {
        return { marks: scheme.full, maxMarks, correct: true, wrongAnswer: null, empty: false };
      }
      // A correct subset, nothing wrong in it: +1 an option.
      return {
        marks: chosen.length * scheme.partialPerOption,
        maxMarks,
        correct: false,
        wrongAnswer: null,
        empty: false,
      };
    }
    case "integer": {
      if (r.kind !== "value" || !Number.isFinite(r.value)) return nothing;
      const hit = r.value === k.value;
      return {
        marks: hit ? scheme.full : scheme.wrong,
        maxMarks,
        correct: hit,
        wrongAnswer: hit ? null : r.value,
        empty: false,
      };
    }
    case "numerical": {
      if (r.kind !== "value" || !Number.isFinite(r.value)) return nothing;
      const hit = Math.abs(r.value - k.value) <= Math.abs(k.tolerance) + EPS;
      return {
        marks: hit ? scheme.full : scheme.wrong,
        maxMarks,
        correct: hit,
        wrongAnswer: hit ? null : r.value,
        empty: false,
      };
    }
    case "matrix_match": {
      if (r.kind !== "matrix" || r.rows.length === 0) return nothing;
      const given = new Map(r.rows.map((x) => [x.row, x.cols]));
      let marks = 0;
      let matched = 0;
      let firstWrongRow: string | null = null;
      for (const row of k.rows) {
        const cols = given.get(row.row);
        // A row left alone scores nothing either way — the same shape as a
        // skipped question, one row down.
        if (!cols || cols.length === 0) continue;
        if (sameSet(cols, row.cols)) {
          marks += scheme.partialPerOption;
          matched++;
        } else {
          marks += scheme.wrong;
          if (firstWrongRow === null) firstWrongRow = row.row;
        }
      }
      const correct = matched === k.rows.length;
      return { marks, maxMarks, correct, wrongAnswer: correct ? null : firstWrongRow, empty: false };
    }
  }
}

/** The distractor a wrong answer matched, if the bank tagged it. */
function distractorFor(q: Question, answer: OptionId | number | null): Distractor | null {
  if (answer === null || !q.distractors?.length) return null;
  return q.distractors.find((d) => d.answer === answer) ?? null;
}

/** Seconds under which this format's answer was not worked out. */
export function floorSecondsFor(q: Question): number {
  return q.floorSeconds ?? FLOOR_SECONDS[q.key.format];
}

/**
 * One attempt → marks and a verdict. Pure, total, and the only thing in the
 * product allowed to decide whether an answer is right.
 *
 * Verdict order is the whole design: skipped, then rushed, then the score.
 * Rushed outranks a full-marks score deliberately — see the enum's note.
 */
export function grade(q: Question, r: Response, elapsedMs: number): Graded {
  const s = score(q, r);
  const base = {
    questionId: q.id,
    topicId: q.topicId,
    format: q.key.format,
    band: q.band,
    marks: s.marks,
    maxMarks: s.maxMarks,
    correct: s.correct,
    elapsedMs,
    ...(q.ref ? { ref: q.ref } : {}),
  };
  if (s.empty) return { ...base, verdict: "skipped" };
  if (elapsedMs / 1000 < floorSecondsFor(q)) return { ...base, verdict: "rushed" };
  if (s.correct) return { ...base, verdict: "clean_solve" };
  if (s.marks > 0) return { ...base, verdict: "partial" };
  const d = distractorFor(q, s.wrongAnswer);
  return {
    ...base,
    verdict: d?.nature === "slip" ? "slip" : "conceptual_miss",
    ...(d?.step ? { step: d.step } : {}),
  };
}

// ── the session ───────────────────────────────────────────────────────────

export interface PracticeConfig {
  /** topic ids, or chapter ids to mean "anything under this chapter" */
  topicIds: readonly string[];
  band: DifficultyBand;
  /** how many questions the set asks for */
  n: number;
  /**
   * Leaves this student has already solved cleanly, before this set.
   *
   * Without it `first_clean_solve_of_topic` is a claim about the last twenty
   * minutes wearing the word "first", and a teacher who celebrates a first
   * solve that was actually their fourth is a teacher whose celebrations stop
   * being worth anything (`milestones.ts`: fire once, ever, backfill-safe).
   */
  priorCleanTopicIds?: readonly string[];
}

export interface PracticeSession {
  config: PracticeConfig;
  questions: readonly Question[];
  startedAt: number;
  /** graded attempts, in the order they were made */
  graded: readonly Graded[];
  /** index of the open question; === questions.length when the set is done */
  index: number;
  /** the student put the set down before the last question */
  endedEarly: boolean;
  over: boolean;
}

/**
 * A deterministic set from a bank. Same bank, same config, same seed → the
 * same questions in the same order, which is what lets an eval replay a
 * session and a student resume one.
 *
 * Selection only — it does NOT pick the band. `student-app-spec.md` §4.2 puts
 * that decision on the mastery track (never a `pyq` problem on a `foundation`
 * topic), which is a different module's job and a different measurement.
 */
export function composeSet(
  bank: readonly Question[],
  config: PracticeConfig,
  seed = 0,
): readonly Question[] {
  const pool = bank
    .filter((q) => q.band === config.band)
    .filter((q) => config.topicIds.some((t) => isUnder(q.topicId, t)))
    // Sorted by id BEFORE any shuffle: a bank that arrives in a different
    // order (a different query plan, a different day) must not produce a
    // different set for the same seed.
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ordered = seed ? shuffle(pool, seed) : pool;
  return ordered.slice(0, Math.max(0, config.n));
}

/** mulberry32 — small, pure, and stable across engines. A shuffle that uses
 *  `Math.random` cannot be replayed, and a set that cannot be replayed cannot
 *  be regraded when a key turns out to be wrong. */
function shuffle(xs: readonly Question[], seed: number): Question[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function startSession(
  config: PracticeConfig,
  questions: readonly Question[],
  startedAt: number,
): PracticeSession {
  return {
    config,
    questions,
    startedAt,
    graded: [],
    index: 0,
    endedEarly: false,
    over: questions.length === 0,
  };
}

/** The question waiting for an answer, or null when the set is done. */
export function currentQuestion(s: PracticeSession): Question | null {
  return s.over ? null : (s.questions[s.index] ?? null);
}

/**
 * Answer the open question. Returns a NEW session — nothing here mutates, so a
 * session can be replayed, forked in an eval, or held in React state without a
 * copy step that someone will one day forget.
 *
 * A submit against a finished set is a no-op rather than a throw: the surface
 * that double-fires a submit button is a bug in the surface, and eating the
 * second one is strictly better than losing the paper.
 */
export function submit(s: PracticeSession, r: Response, elapsedMs: number): PracticeSession {
  const q = currentQuestion(s);
  if (!q) return s;
  const graded = [...s.graded, grade(q, r, elapsedMs)];
  const index = s.index + 1;
  return { ...s, graded, index, over: index >= s.questions.length };
}

export function skip(s: PracticeSession, elapsedMs = 0): PracticeSession {
  return submit(s, SKIPPED, elapsedMs);
}

/**
 * The set was put down early. Distinct from `over` for the reason
 * `chessTalk.ts` keeps `endedEarly` distinct from a finished game: only the
 * session knows the difference between "they answered everything" and "they
 * walked away", and a clone that congratulates someone on a set they abandoned
 * has said the one thing that proves it was not paying attention.
 */
export function endEarly(s: PracticeSession): PracticeSession {
  if (s.over) return s;
  return { ...s, over: true, endedEarly: true };
}

// ── the summary ───────────────────────────────────────────────────────────

export interface TopicTally {
  topicId: string;
  attempted: number;
  clean: number;
  partial: number;
  slip: number;
  conceptualMiss: number;
  skipped: number;
  rushed: number;
  marks: number;
  maxMarks: number;
}

/**
 * The shapes worth remarking on. Three, and sparse on purpose — `milestones.ts`
 * §"tier tables are sparse": a moment that fires every session is wallpaper,
 * and wallpaper is the death of celebration.
 *
 * None of them is a claim about the student. Each is a claim about a specific
 * run of specific graded attempts, and each carries the question ids it is
 * made of so the thing said out loud can be checked against the record — the
 * same citation discipline `vy_pattern` enforces in the database.
 */
export type MomentShape =
  | "first_clean_solve_of_topic"
  | "comeback_after_miss"
  | "streak_of_slips_same_step";

export interface PracticeMoment {
  shape: MomentShape;
  topicId: string;
  /** `streak_of_slips_same_step` only */
  step?: string;
  /** the attempts it is made of — the citation, never decoration */
  questionIds: readonly string[];
}

/**
 * How many slips on one step before it is a shape rather than a bad minute.
 *
 * THREE, matching `vy_pattern`'s `support_count >= 3` bar exactly, and for the
 * same stated reason: one instance is an anecdote. What this constant does NOT
 * buy is the other half of that bar — `distinct_days >= 2` — because every
 * attempt in a session happens on one day. So this shape is licence to say
 * "third time on that step today" and never licence to say "you always". The
 * standing-pattern claim is `relstate.ts`'s to make, off the stored record,
 * across days; this one is about the last half hour and says so.
 */
export const SLIP_SUPPORT = 3;

const isMiss = (v: Verdict): boolean => v === "slip" || v === "conceptual_miss";

/**
 * The moment shapes present in this session, in the order they completed.
 * Exported separately from `summarize` so the eval can drive the detectors
 * directly rather than inferring which one fired from a rendered fact.
 */
export function moments(s: PracticeSession): readonly PracticeMoment[] {
  const out: PracticeMoment[] = [];
  const prior = new Set(s.config.priorCleanTopicIds ?? []);
  const cleanedThisSet = new Set<string>();
  const missedThisSet = new Map<string, string[]>();
  const firstFired = new Set<string>();
  const comebackFired = new Set<string>();
  /** per step: the run of slips still going, and the topic they are on */
  const run = new Map<string, { ids: string[]; topicId: string }>();
  const streakFired = new Set<string>();

  for (const g of s.graded) {
    if (g.verdict === "clean_solve") {
      // FIRST CLEAN SOLVE OF A TOPIC — and "first" means first ever, which is
      // what `priorCleanTopicIds` is for.
      if (!prior.has(g.topicId) && !cleanedThisSet.has(g.topicId) && !firstFired.has(g.topicId)) {
        firstFired.add(g.topicId);
        out.push({
          shape: "first_clean_solve_of_topic",
          topicId: g.topicId,
          questionIds: [g.questionId],
        });
      }
      // COMEBACK — a clean solve on a topic that bit them earlier in this same
      // set. The citation carries the miss AND the solve, because the shape is
      // the pair and half of it is not a story.
      const missed = missedThisSet.get(g.topicId);
      if (missed?.length && !comebackFired.has(g.topicId)) {
        comebackFired.add(g.topicId);
        out.push({
          shape: "comeback_after_miss",
          topicId: g.topicId,
          questionIds: [...missed, g.questionId],
        });
      }
      cleanedThisSet.add(g.topicId);
      // A clean solve on the topic BREAKS every slip run on that topic: the
      // shape is a repetition that is still going, and one that stopped is a
      // thing to say nothing about.
      for (const [step, r] of run) if (r.topicId === g.topicId) run.delete(step);
      continue;
    }
    if (isMiss(g.verdict)) {
      const list = missedThisSet.get(g.topicId) ?? [];
      list.push(g.questionId);
      missedThisSet.set(g.topicId, list);
    }
    // SLIPS ON THE SAME STEP. Only tagged slips with a named step count — an
    // untagged wrong answer has no step and cannot join a run, which is the
    // evidence bar doing its job rather than a gap.
    if (g.verdict === "slip" && g.step) {
      const r = run.get(g.step) ?? { ids: [], topicId: g.topicId };
      r.ids.push(g.questionId);
      r.topicId = g.topicId;
      run.set(g.step, r);
      if (r.ids.length >= SLIP_SUPPORT && !streakFired.has(g.step)) {
        streakFired.add(g.step);
        out.push({
          shape: "streak_of_slips_same_step",
          topicId: g.topicId,
          step: g.step,
          questionIds: [...r.ids],
        });
      }
    }
  }
  return out;
}

/**
 * The moments that COMPLETED on a given question, which is a different set
 * from "the moments this session has".
 *
 * ONE EVENT, ONE NOTE — `activityNote`'s law, and the call site is where it
 * gets broken. A poke that sends `moments(s)` last entry re-announces a
 * comeback that landed two questions ago, every question, for the rest of the
 * set: the digest failure `chessTalk.ts` refuses by construction. A moment is
 * identified by the LAST attempt it cites, because that is the attempt that
 * completed it.
 */
export function momentsAt(s: PracticeSession, questionId: string): readonly PracticeMoment[] {
  return moments(s).filter((m) => m.questionIds[m.questionIds.length - 1] === questionId);
}

export interface PracticeSummary {
  total: number;
  answered: number;
  clean: number;
  marks: number;
  maxMarks: number;
  byTopic: readonly TopicTally[];
  moments: readonly PracticeMoment[];
  over: boolean;
  endedEarly: boolean;
}

/**
 * Everything durable about the set, counted. Every number here is a COUNTER
 * off the graded record, never an estimate — `milestones.ts`'s `dyadRecord`
 * rule, and it matters more here: a mastery percentage that was estimated is a
 * number a student will plan their year around.
 *
 * `maxMarks` counts the whole SET, skipped questions included, because the
 * paper was worth what it was worth whether or not they attempted it.
 */
export function summarize(s: PracticeSession): PracticeSummary {
  const order: string[] = [];
  const tallies = new Map<string, TopicTally>();
  const tally = (topicId: string): TopicTally => {
    let t = tallies.get(topicId);
    if (!t) {
      t = {
        topicId,
        attempted: 0,
        clean: 0,
        partial: 0,
        slip: 0,
        conceptualMiss: 0,
        skipped: 0,
        rushed: 0,
        marks: 0,
        maxMarks: 0,
      };
      tallies.set(topicId, t);
      order.push(topicId);
    }
    return t;
  };

  let marks = 0;
  let maxMarks = 0;
  let clean = 0;
  for (const g of s.graded) {
    const t = tally(g.topicId);
    t.marks += g.marks;
    t.maxMarks += g.maxMarks;
    marks += g.marks;
    maxMarks += g.maxMarks;
    if (g.verdict !== "skipped") t.attempted++;
    if (g.verdict === "clean_solve") {
      t.clean++;
      clean++;
    } else if (g.verdict === "partial") t.partial++;
    else if (g.verdict === "slip") t.slip++;
    else if (g.verdict === "conceptual_miss") t.conceptualMiss++;
    else if (g.verdict === "skipped") t.skipped++;
    else if (g.verdict === "rushed") t.rushed++;
  }
  // Questions never reached still count toward what the set was worth.
  for (const q of s.questions.slice(s.graded.length)) {
    const k = q.key;
    const m = maxMarksFor(k.format, k.format === "matrix_match" ? k.rows.length : undefined);
    maxMarks += m;
    tally(q.topicId).maxMarks += m;
  }

  return {
    total: s.questions.length,
    answered: s.graded.filter((g) => g.verdict !== "skipped").length,
    clean,
    marks,
    maxMarks,
    byTopic: order.map((id) => tallies.get(id) as TopicTally),
    moments: moments(s),
    over: s.over,
    endedEarly: s.endedEarly,
  };
}
