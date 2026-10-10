// The practice → activity adapter. The ONLY place a practice set becomes
// words.
//
// `src/engine/practice/` emits enums and numbers and no English at all — a
// verdict, a marks total, a moment shape — and this file turns them into the
// handful of telegraphic facts the teacher clone is given. Same split, same
// reason, as `chessTalk.ts`: the grading half has to be provable and prose is
// not provable, so the grader can be rewritten without touching a word she
// might say and the wording can be tuned without risking a single mark.
//
// WHAT THIS FILE MAY NOT DO, and `evals/practice.mjs` enforces each one:
//
//  1. WRITE A LINE SHE COULD SAY. `recited-prompt` measured her own example
//     quotes recited on 4 of 5 turns. Every row here is a third-person fact
//     about the set — telegraphic, ≤14 words, never sentence-shaped, never
//     first-person. "arre sign phir se gaya" belongs to her; "he slipped at
//     the sign on the second term" belongs here.
//
//  2. LABEL AN ABILITY. `teacher-arc.md` §2.2: no "you're weak in organic",
//     no "you're not a maths person", no "slow starter" — "handing a
//     sixteen-year-old a category for their own capability is the same move as
//     handing them a diagnosis, and it is stickier." §3.1 adds the praise side:
//     the celebration lands on the METHOD, never the ability, because ability
//     praise is what makes a student stop attempting hard problems.
//
//     This is not left to the wording. `ABILITY_LABELS` below is a predicate
//     and every row this file returns passes through it, for the reason
//     `gate0-structural` records: a prompt instruction leaked 57–98%, a
//     predicate leaked 0 of 31,122. The eval strikes the predicate and asserts
//     the check goes red, so the fence cannot rot into decoration.
//
//  3. NAME AN INTERNAL ID. `Question.id` and the syllabus ids are database
//     keys, and a key on the voice lane is read aloud as characters — the
//     "a FEN read aloud is gibberish in her mouth" failure with a different
//     string in it. Topics reach her as their human names and questions as
//     their `ref` ("JEE 2019 Paper 1 Q7"), which is what a person says.
//
//  4. SAY "ALWAYS". A within-session slip run is three attempts on one day.
//     `vy_pattern` needs `support_count >= 3 AND distinct_days >= 2` before a
//     standing claim about a student is prompt-eligible, and the second half
//     is unreachable inside one set by construction. So the run is rendered
//     bounded — "this set", with the count — and the standing version stays
//     `relstate.ts`'s to make off the stored record.
//
// It also may not GRADE. Everything here reads a `Graded` the session engine
// already produced. A second opinion in the talking layer is the
// `age-tier-never-realtime` fork shape, and here it would be a second opinion
// about whether a student's answer was right.

import type { ActivityState } from "./activity";
import type {
  Graded,
  PracticeMoment,
  PracticeSession,
  Question,
} from "./practice/session";
import { moments, summarize } from "./practice/session";
import type { DifficultyBand } from "./practice/syllabus";
import { nameFor } from "./practice/syllabus";

/** `ActivityState.facts` rows are ≤14 words — `chessTalk.ts`'s contract, and
 *  the same reason: a row over the limit fails SILENTLY at the far end of the
 *  pipe (`silent-truncation`) rather than here. */
const MAX_FACT_WORDS = 14;

const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/** Clauses joined to at most 14 words, dropping from the END — the same policy
 *  `renderActivity` uses on rows and `moveFact` uses on clauses, so what goes
 *  is what can afford to go. The first clause always survives. */
function row(bits: readonly string[]): string {
  const out = bits.filter(Boolean).slice();
  while (out.length > 1 && words(out.join(", ")) > MAX_FACT_WORDS) out.pop();
  return out.join(", ");
}

// ── the ability-label fence ───────────────────────────────────────────────

/**
 * Nouns and adjectives this file may never emit about a student.
 *
 * The first group is `teacher-arc.md` §3.1's banned list plus its §2.2
 * examples, widened to the obvious neighbours — the ban is on handing a
 * student a CATEGORY for their capability, and "sharp" does that as surely as
 * "brilliant". The second is the numeric version of the same move: a rank or a
 * score prediction is a diagnosis in numbers (§2.2, [MINOR-STRICTER]).
 *
 * Deliberately blunt. A word on this list that a legitimate row wanted is a
 * row that should be rewritten around the specific act, which is the rule this
 * list exists to enforce in the first place.
 */
export const ABILITY_LABELS: readonly string[] = [
  // capability categories
  "brilliant",
  "genius",
  "gifted",
  "talented",
  "talent",
  "natural",
  "prodigy",
  "topper",
  "smart",
  "clever",
  "bright",
  "sharp",
  "dull",
  "slow",
  "weak",
  "strong",
  "average",
  "hopeless",
  "stupid",
  "dumb",
  // character verdicts wearing a study coat
  "careless",
  "sloppy",
  "lazy",
  "undisciplined",
  // the diagnosis in numbers
  "rank",
  "percentile",
];

const LABEL_RE = new RegExp(`\\b(${ABILITY_LABELS.join("|")})\\w*\\b`, "i");

/** True when a row hands the student a category instead of naming an act. */
export function hasAbilityLabel(text: string): boolean {
  return LABEL_RE.test(text);
}

/** An id that escaped into prose: `p.em.electrostatics`. Two dots or more, so
 *  a decimal ("2.5") and an ordinary sentence never trip it. */
const ID_SHAPED = /\b[a-z]+(?:\.[a-z0-9-]+){2,}\b/i;

/**
 * THE STRUCTURAL FENCE. Every row this file returns goes through it.
 *
 * A row that labels an ability, or that leaked an internal id, is DROPPED
 * rather than rewritten — there is no correct automatic rewrite of a claim
 * that should not have been made, and a dropped row costs one fact while a
 * kept one costs a sixteen-year-old a category for themselves.
 */
function clean(rows: readonly string[]): string[] {
  return rows.filter((r) => r && !hasAbilityLabel(r) && !ID_SHAPED.test(r));
}

// ── vocabulary ────────────────────────────────────────────────────────────

/**
 * Bands as a person says them. `pyq` is an id, and an id on the voice lane is
 * three letters read out — "past paper" is what a teacher actually calls it.
 */
const BAND_WORD: Record<DifficultyBand, string> = {
  foundation: "foundation",
  standard: "standard",
  advanced: "advanced",
  pyq: "past paper",
};

/**
 * The topic, in the words a person uses. Falls back to "this one" and NEVER to
 * the id — an unknown id is a syllabus revision, and the answer to a name she
 * does not have is a vaguer phrase, not a database key read aloud.
 */
function topicWord(topicId: string): string {
  return nameFor(topicId) || "this one";
}

/** "8 seconds", "1 second". A count-formatter that reaches "1 seconds" on its
 *  own is the tell that a row was assembled rather than said — `captureClause`
 *  in `chessTalk.ts` carries the same note about "1 pawns". */
function secondsWord(ms: number): string {
  const n = Math.max(1, Math.round(ms / 1000));
  return `${n} ${n === 1 ? "second" : "seconds"}`;
}

// ── the per-attempt fact ──────────────────────────────────────────────────

/**
 * One row for the answer that just went in. The per-question poke.
 *
 * Two clauses, three at the ceiling — `chess-facts-as-a-scoresheet` is what
 * six clauses cost, and a set of eight questions would pay it eight times.
 *
 * `whoAnswered` exists because a teacher clone may also be walking a solution
 * herself in a worked example; the student is the default and the only case
 * the practice surface produces today.
 */
export function attemptFact(g: Graded, whoAnswered: "him" | "her" = "him"): string {
  const who = whoAnswered === "him" ? "he" : "she";
  const topic = topicWord(g.topicId);
  switch (g.verdict) {
    case "clean_solve":
      return row([`${who} solved the ${topic} one`, "full marks"]);
    case "partial":
      // The METHOD, not the score: what a partial actually says is that they
      // found some of the options and stopped, which is a different act from
      // guessing and the row should not blur them.
      return row([
        `${who} got part of the ${topic} one`,
        "nothing wrong picked",
        `${g.marks} of ${g.maxMarks} marks`,
      ]);
    case "slip":
      // THE STEP IS THE WHOLE POINT. "he slipped" is a verdict; "he slipped at
      // the sign on the second term" is a thing a teacher can actually work on
      // with them, and it is the specific act `teacher-arc.md` §3.1 asks for
      // in place of any word about the student.
      return row([
        g.step ? `${who} slipped at ${g.step}` : `${who} slipped on the ${topic} one`,
        g.step ? `on the ${topic} one` : "",
      ]);
    case "conceptual_miss":
      // Deliberately NOT a claim about understanding. The verdict name is
      // internal; what reaches her is that this question was missed.
      return row([`${who} missed the ${topic} one`, `${g.marks} marks`]);
    case "skipped":
      return row([`${who} left the ${topic} one unanswered`]);
    case "rushed":
      // TIME FIRST, and the topic second. On a long topic name the third
      // clause is what the 14-word contract takes, and the news here is the
      // clock — an answer that arrived in eight seconds did not come from
      // working the problem, whatever it scored.
      return row([
        `${who} answered in ${secondsWord(g.elapsedMs)}`,
        `on ${topic}`,
        "faster than working it takes",
      ]);
  }
}

// ── the moment facts ──────────────────────────────────────────────────────

/**
 * One row for a moment shape, or "".
 *
 * Every one of these is bounded to what the record actually holds. The slip
 * run says "this set" and carries its count for the reason in the header: three
 * attempts on one day is not the bar a standing claim about a student needs.
 */
export function momentFact(m: PracticeMoment): string {
  const topic = topicWord(m.topicId);
  switch (m.shape) {
    case "first_clean_solve_of_topic":
      return row([`first clean solve on ${topic}`, "none on record before this"]);
    case "comeback_after_miss":
      return row([`missed ${topic} earlier in this set`, "then took the next one clean"]);
    case "streak_of_slips_same_step":
      return row([
        `${m.questionIds.length} slips at ${m.step ?? "the same step"} in this set`,
        "same step each time",
      ]);
  }
}

// ── BOARD TRUTH: the one line she may not talk past ───────────────────────
//
// `student-app-spec.md` §3.4 names the failure this exists for, in the same
// breath as the chess one it is modelled on: "don't let her congratulate a
// finished session that isn't finished". A set with three of eight answered is
// not a result, and a clone that closes it out has told the student their
// afternoon is over.
//
// Derived HERE from the session's own counters and nothing else. Never from a
// fact row, never from a model. Three shapes and no fourth.

export function practiceState(s: PracticeSession): string {
  const total = s.questions.length;
  const done = s.graded.length;
  if (!s.over) return `in progress, question ${Math.min(done + 1, total)} of ${total}`;
  if (s.endedEarly) {
    return done
      ? `the set ended early after ${done} of ${total}, the rest unanswered`
      : "the set ended before a question was answered";
  }
  const sum = summarize(s);
  return `set finished, ${sum.clean} of ${total} clean`;
}

// ── HER IDEA: what she is doing with this set ─────────────────────────────
//
// The chess version answers "what's your plan for this position". The teacher
// version answers the question a student actually asks — "why these questions"
// — and a clone with no answer to it is a worksheet dispenser. Derived from the
// config and the graded record, never from a model.
//
// Most specific first, and every fallback is the vaguest TRUE thing rather
// than the most interesting one: a wrong plan is worse than a plain one.

export function practiceIdea(s: PracticeSession): string {
  const band = BAND_WORD[s.config.band] ?? "";
  if (!s.questions.length) return "";
  const live = moments(s).filter((m) => m.shape === "streak_of_slips_same_step").pop();
  if (live?.step) return row([`staying on ${live.step} until it stops slipping`]);
  const topics = [...new Set(s.questions.map((q) => q.topicId))];
  if (topics.length === 1) return row([`${band} band`, `${topicWord(topics[0])} only`]);
  return row([`mixed ${band} set`, `${topics.length} topics`]);
}

// ── the settled clause ────────────────────────────────────────────────────

/**
 * TENSE IS LAW, the practice-set form.
 *
 * The chess version exists because a past-tense note does not, on its own, say
 * that NOTHING IS PENDING, and she deliberated about a move already on the
 * board. The same gap here has a worse shape: handed "he missed the Gauss's law
 * one", a clone with a frozen prompt will start walking a solution to a
 * question the student has already moved past — or worse, hint at one they have
 * not answered yet, which is the academic-integrity failure
 * `SPEC-GURUKUL.md` §3.5 makes structural elsewhere.
 *
 * So every note about an answer carries the state of the CHOICE beside the
 * state of the set: the answer is in and there is nothing to decide, or a
 * question is genuinely open and unanswered.
 */
export function settledClause(s: PracticeSession): string {
  if (s.over) return "";
  if (!s.graded.length) return "nothing answered yet, first question open";
  return `his answer is in, question ${s.graded.length + 1} is open now`;
}

/**
 * THE NOTE THE LIVE LANE SENDS. One function, so the composition is a thing
 * that can be tested rather than a line of assembly at the call site — the
 * `chessMoveNote` argument exactly.
 *
 * The caller wraps it with `activityNote(fact, { state, idea })`, passing
 * `practiceState`/`practiceIdea` derived from the SAME session at the instant
 * the note is drafted.
 */
export function practiceNote(s: PracticeSession, g: Graded, moment?: PracticeMoment | null): string {
  const parts = clean([attemptFact(g), moment ? momentFact(moment) : "", settledClause(s)]);
  return parts.join("; ");
}

// ── the DURABLE half ──────────────────────────────────────────────────────
//
// `facts` is the present moment and expires with it. This is the half a
// student still carries next week, and the half that answers "how did that set
// on electrostatics go" three days later — the question `chessTalk.ts` learned
// the hard way has to be answerable from a record rather than invented.

export function practiceRecord(s: PracticeSession): string[] {
  const sum = summarize(s);
  const rows: string[] = [];
  const band = BAND_WORD[s.config.band] ?? "";
  const topics = [...new Set(s.questions.map((q) => q.topicId))].map(topicWord);

  // 1. WHAT THE SET WAS. Two topic names at most: a list of six is an index,
  //    and nobody remembers a set as an index.
  const named =
    topics.length <= 2
      ? topics.join(" and ")
      : `${topics.slice(0, 2).join(", ")} and ${topics.length - 2} more`;
  if (s.questions.length) rows.push(row([`${s.questions.length} ${band} questions`, `on ${named}`]));

  // 2. HOW IT WENT, counted. Never estimated — `milestones.ts`'s counter rule,
  //    and a student will plan a week around this number.
  rows.push(row([`${sum.clean} of ${s.questions.length} clean`, `${sum.marks} of ${sum.maxMarks} marks`]));

  // 3. THE ONE SHAPE THAT SHOWED UP. Most specific first, and only one: a
  //    record with three findings in it is a report card, and a report card is
  //    the ability label wearing a table.
  const ms = sum.moments;
  const pick =
    ms.find((m) => m.shape === "streak_of_slips_same_step") ??
    ms.find((m) => m.shape === "comeback_after_miss") ??
    ms.find((m) => m.shape === "first_clean_solve_of_topic");
  if (pick) rows.push(momentFact(pick));

  // 4. HOW IT STOPPED, when it stopped early. An abandoned set stated as
  //    abandoned AND located, for `chessRecord`'s reason: "he left it
  //    unfinished" with no position is a memory with no shape.
  if (s.endedEarly) {
    rows.push(
      s.graded.length
        ? `he put it down after ${s.graded.length} of ${s.questions.length}`
        : "he put it down before answering anything",
    );
  }

  return clean(rows).filter((r) => words(r) <= MAX_FACT_WORDS);
}

// ── the whole activity ────────────────────────────────────────────────────

/**
 * `ActivityState` for a practice set, per `activity.ts`'s contract.
 *
 * ORDER IS THE DROP POLICY. `renderActivity` pops whole rows off the END over
 * `ACTIVITY_BUDGET`, and the head alone is ~300 of the 420 bytes, so roughly
 * three rows survive on a live set. Least important LAST.
 *
 * `waitingOnHer` is FALSE, always, and that is a fact about this activity
 * rather than an oversight: the student answers, and there is no turn of hers
 * to take. A clone that thinks it is her move on a practice question is one
 * step from supplying the answer, which is the thing `firstMoveOnDoubt` and
 * the escalation ladder exist to make structurally impossible.
 */
export function practiceActivity(
  s: PracticeSession,
  startedAt = s.startedAt,
  /** the moment that fired on the last answer, when one did */
  moment?: PracticeMoment | null,
): ActivityState {
  const facts: string[] = [];
  const total = s.questions.length;
  const last = s.graded.length ? s.graded[s.graded.length - 1] : null;

  // 1 & 2: the two rows a person actually needs — where this stands, and what
  // just happened.
  if (s.over) {
    const sum = summarize(s);
    // The MARKS here rather than the clean count: `state:` two lines above
    // already says "set finished, N of M clean", and a block that says the
    // same thing twice in different words has spent a row on nothing —
    // `chessActivity` suppresses its opening row for exactly this reason.
    facts.push(
      s.endedEarly
        ? row([`he put the set down after ${s.graded.length} of ${total}`])
        : row([`the set is done`, `${sum.marks} of ${sum.maxMarks} marks`]),
    );
  } else {
    facts.push("it is his question to answer");
  }
  if (last) facts.push(attemptFact(last));

  // 3. the moment, when one just fired. One, never a digest.
  if (moment) facts.push(momentFact(moment));

  // 4. what the open question is on — the nicest row here and the least
  //    urgent, so it sits below the moment.
  const open = s.over ? null : (s.questions[s.index] ?? null);
  if (open) facts.push(row([`the open one is on ${topicWord(open.topicId)}`]));

  // 5. how far in. The only row nothing depends on.
  if (!s.over) facts.push(row([`${s.graded.length} of ${total} answered so far`]));

  return {
    kind: "practice",
    startedAt,
    facts: clean(facts),
    nameable: nameableOf(s),
    record: practiceRecord(s),
    state: practiceState(s),
    idea: practiceIdea(s),
    waitingOnHer: false,
    over: s.over,
  };
}

/**
 * What she is permitted to name out loud.
 *
 * `honesty-provenance-allowlist` treats an identifier she emits that was not in
 * her input as INVENTED, so a question she is expected to discuss has to be one
 * she was handed — and, just as importantly, a question that was never in the
 * set is one she now cannot claim the student got right.
 *
 * Topic NAMES and question `ref`s only. Internal ids are excluded on purpose:
 * see this file's header, rule 3.
 */
function nameableOf(s: PracticeSession): string[] {
  const out: string[] = [];
  for (const q of s.questions) {
    const name = nameFor(q.topicId);
    if (name && !out.includes(name)) out.push(name);
    if (q.ref && !out.includes(q.ref)) out.push(q.ref);
  }
  return out;
}

/** Re-exported so a surface can build a set's activity without importing two
 *  modules to do it. Type-only: nothing here re-implements the engine. */
export type { PracticeSession, Question, Graded, PracticeMoment };
