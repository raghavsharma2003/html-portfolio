// A small, typed demo question bank — UI-facing content ONLY.
//
// `session.ts`'s `Question` deliberately carries no prose: `id`, `topicId`,
// `band`, `key` (the answer key), `ref` (a sayable citation) and optional
// `distractors` are everything the grading engine needs, and the engine's own
// header says why — a model must never grade, and content that could drift
// independently of the key is exactly the kind of second opinion that rule
// exists to forbid. But a student sitting in front of a question still has to
// READ it, so this file pairs each `Question` with the display text a screen
// renders — the stem, option labels, matrix row/column text — as a SEPARATE
// object the grading engine never sees and never needs to.
//
// `student-app-spec.md` §6 ("Out of scope for v1: AI-authored novel
// questions") — every question below is written for this bank, matched to the
// taxonomy in `syllabus.ts`, not transcribed from any real paper. Two
// chapters are covered because they are the ones `syllabus.ts` expands to
// topic level: Electrostatics (`p.em.electrostatics`) and Integration
// (`m.calculus.integration`) — a question on a chapter `syllabus.ts` has not
// broken into topics yet would have nowhere to attach.
//
// Every answer key below was worked by hand; `evals/mastery.mjs` does not
// re-derive them, so a wrong key here is a content bug, not an engine one —
// worth stating because the grading half is exactly the half this repo will
// not let an LLM own.

import type { AnswerKey, Question } from "./session";

/** One option, as the student reads it. `id` matches an `AnswerKey`'s
 *  `OptionId` and is what `Response.chosen` carries — never the display text,
 *  which is free to change without touching a single graded record. */
export interface DemoOption {
  id: string;
  text: string;
}

/** UI-only wrapper. `question` is handed to `session.ts` untouched; nothing
 *  else here reaches the grading engine or `practiceTalk.ts`. */
export interface DemoQuestion {
  question: Question;
  /** the stem, as a person reads it — plain text, MathML-free on purpose:
   *  this is a demo bank, not a typesetting workstream. */
  prompt: string;
  /** single_correct / multi_correct only */
  options?: readonly DemoOption[];
  /** integer / numerical only — what the entered number means */
  unit?: string;
  /** matrix_match only: the four List-I row labels, in the order the answer
   *  key's `rows` uses them */
  matrixRows?: readonly DemoOption[];
  /** matrix_match only: the List-II column labels, `cols` values key into
   *  this by id */
  matrixCols?: readonly DemoOption[];
}

const opts = (...pairs: readonly (readonly [string, string])[]): DemoOption[] =>
  pairs.map(([id, text]) => ({ id, text }));

const key = (k: AnswerKey): AnswerKey => k;

// ── Electrostatics (p.em.electrostatics) ───────────────────────────────────

const E1: DemoQuestion = {
  question: {
    id: "demo.p.electrostatics.001",
    topicId: "p.em.electrostatics.gauss-law",
    band: "foundation",
    ref: "Demo E1",
    key: key({ format: "single_correct", correct: "B" }),
    distractors: [
      { answer: "A", nature: "slip", step: "the inverse-square step" },
      { answer: "D", nature: "conceptual" },
    ],
  },
  prompt:
    "A solid conducting sphere of radius R carries total charge Q. Taking E0 = Q / (4πε0 R²), what is the field magnitude at a point r = 2R from the centre?",
  options: opts(["A", "E0"], ["B", "E0 / 4"], ["C", "E0 / 2"], ["D", "0"]),
};

const E2: DemoQuestion = {
  question: {
    id: "demo.p.electrostatics.002",
    topicId: "p.em.electrostatics.coulombs-law",
    band: "standard",
    ref: "Demo E2",
    key: key({ format: "single_correct", correct: "A" }),
    distractors: [
      { answer: "B", nature: "slip", step: "setting up the null-point ratio" },
      { answer: "C", nature: "conceptual" },
    ],
  },
  prompt:
    "Point charges +q and +4q sit a distance d apart. On the segment joining them, the field is zero at distance x from the +q charge. What is x?",
  options: opts(["A", "d / 3"], ["B", "d / 2"], ["C", "2d / 3"], ["D", "d / 5"]),
};

const E3: DemoQuestion = {
  question: {
    id: "demo.p.electrostatics.003",
    topicId: "p.em.electrostatics.capacitance",
    band: "advanced",
    ref: "Demo E3",
    key: key({ format: "multi_correct", correct: ["A", "B", "C"] }),
  },
  prompt:
    "A parallel-plate capacitor (capacitance C0, air-filled) is charged to potential V0, then the battery is disconnected. A dielectric slab of constant K is inserted, completely filling the gap. Which are true afterward?",
  options: opts(
    ["A", "Capacitance becomes K·C0"],
    ["B", "Charge stays Q0 = C0·V0"],
    ["C", "Potential drops to V0 / K"],
    ["D", "Stored energy increases"],
  ),
};

const E4: DemoQuestion = {
  question: {
    id: "demo.p.electrostatics.004",
    topicId: "p.em.electrostatics.dipole",
    band: "standard",
    ref: "Demo E4",
    key: key({ format: "integer", value: 2 }),
  },
  prompt:
    "A dipole of moment p = 4×10⁻⁹ C·m sits in a uniform field E = 5×10⁴ N/C, oriented for maximum torque. Give the torque, in units of 10⁻⁴ N·m, as an integer.",
  unit: "×10⁻⁴ N·m",
};

const E5: DemoQuestion = {
  question: {
    id: "demo.p.electrostatics.005",
    topicId: "p.em.electrostatics.potential-and-energy",
    band: "advanced",
    ref: "Demo E5",
    key: key({ format: "numerical", value: 0.09, tolerance: 0.01 }),
  },
  prompt:
    "Three +1 μC point charges sit at the corners of an equilateral triangle of side 30 cm in vacuum. Find the system's electrostatic potential energy, in joules, to two decimal places. (Use 1/4πε0 = 9×10⁹ N·m²/C².)",
  unit: "J",
};

const E6: DemoQuestion = {
  question: {
    id: "demo.p.electrostatics.006",
    topicId: "p.em.electrostatics.conductors",
    band: "advanced",
    ref: "Demo E6",
    key: key({
      format: "matrix_match",
      rows: [
        { row: "P", cols: ["1"] },
        { row: "Q", cols: ["2"] },
        { row: "R", cols: ["3"] },
        { row: "S", cols: ["4"] },
      ],
    }),
  },
  prompt: "Match each statement about an isolated charged conductor (List-I) to its property (List-II).",
  matrixRows: opts(
    ["P", "Charge on the conductor"],
    ["Q", "Field just outside the surface"],
    ["R", "Field inside the conductor"],
    ["S", "Potential on the surface"],
  ),
  matrixCols: opts(
    ["1", "Resides entirely on the outer surface"],
    ["2", "Perpendicular to the surface, magnitude σ/ε0"],
    ["3", "Zero"],
    ["4", "Same everywhere (equipotential)"],
    ["5", "Varies with local curvature"],
  ),
};

// ── Integration (m.calculus.integration) ───────────────────────────────────

const I1: DemoQuestion = {
  question: {
    id: "demo.m.integration.001",
    topicId: "m.calculus.integration.standard-forms",
    band: "foundation",
    ref: "Demo I1",
    key: key({ format: "single_correct", correct: "A" }),
    distractors: [
      { answer: "B", nature: "conceptual" },
      { answer: "D", nature: "slip", step: "the power rule on a trig antiderivative" },
    ],
  },
  prompt: "∫ sec²x dx equals (up to a constant of integration):",
  options: opts(["A", "tan x + C"], ["B", "sec x · tan x + C"], ["C", "−cot x + C"], ["D", "sec²x / 2 + C"]),
};

const I2: DemoQuestion = {
  question: {
    id: "demo.m.integration.002",
    topicId: "m.calculus.integration.by-parts",
    band: "standard",
    ref: "Demo I2",
    key: key({ format: "single_correct", correct: "A" }),
    distractors: [
      { answer: "B", nature: "slip", step: "the factor of 2 on the second by-parts term" },
      { answer: "C", nature: "slip", step: "the sign on the constant term" },
      { answer: "D", nature: "conceptual" },
    ],
  },
  prompt: "∫ x·e^(2x) dx equals (up to a constant of integration):",
  options: opts(
    ["A", "e^(2x)(2x − 1) / 4 + C"],
    ["B", "e^(2x)(x − 1) / 2 + C"],
    ["C", "e^(2x)(2x + 1) / 4 + C"],
    ["D", "x·e^(2x) / 2 + C"],
  ),
};

const I3: DemoQuestion = {
  question: {
    id: "demo.m.integration.003",
    topicId: "m.calculus.integration.by-parts",
    band: "advanced",
    ref: "Demo I3",
    key: key({ format: "multi_correct", correct: ["A", "B", "D"] }),
  },
  prompt:
    "Let I = ∫ x²·ln x dx. Applying integration by parts once with u = ln x, dv = x² dx, which of the following are correct?",
  options: opts(
    ["A", "I = (x³ ln x)/3 − ∫ x²/3 dx"],
    ["B", "I = (x³ ln x)/3 − x³/9 + C"],
    ["C", "I = (x³ ln x)/3 + x³/9 + C"],
    ["D", "dv = x² dx integrates to v = x³/3"],
  ),
};

const I4: DemoQuestion = {
  question: {
    id: "demo.m.integration.004",
    topicId: "m.calculus.integration.definite-properties",
    band: "standard",
    ref: "Demo I4",
    key: key({ format: "integer", value: 7 }),
  },
  prompt: "∫ from 0 to π of sin³x dx equals p/q in lowest terms, p and q coprime positive integers. Find p + q.",
};

const I5: DemoQuestion = {
  question: {
    id: "demo.m.integration.005",
    topicId: "m.calculus.integration.area-under-curves",
    band: "advanced",
    ref: "Demo I5",
    key: key({ format: "numerical", value: 1.33, tolerance: 0.01 }),
  },
  prompt: "Find the area enclosed between y = x² and y = 2x for x in [0, 2], to two decimal places.",
  unit: "sq. units",
};

const I6: DemoQuestion = {
  question: {
    id: "demo.m.integration.006",
    topicId: "m.calculus.integration.reduction-formulae",
    band: "pyq",
    ref: "Demo I6",
    key: key({ format: "single_correct", correct: "A" }),
    distractors: [
      { answer: "B", nature: "slip", step: "the sign on the constant term of the reduction step" },
      { answer: "C", nature: "slip", step: "the sign on the linear term of the reduction step" },
      { answer: "D", nature: "conceptual" },
    ],
  },
  prompt:
    "For Iₙ = ∫ xⁿ eˣ dx, the reduction formula gives Iₙ = xⁿeˣ − n·Iₙ₋₁. With I₀ = eˣ + C, what is I₂ (up to the constant)?",
  options: opts(
    ["A", "eˣ(x² − 2x + 2) + C"],
    ["B", "eˣ(x² − 2x − 2) + C"],
    ["C", "eˣ(x² + 2x + 2) + C"],
    ["D", "eˣ(x² − 2x) + C"],
  ),
};

/** All twelve, in bank order — `composeSet` sorts by `Question.id` before any
 *  shuffle, so this array's own order is cosmetic. */
export const DEMO_BANK: readonly DemoQuestion[] = [E1, E2, E3, E4, E5, E6, I1, I2, I3, I4, I5, I6];

/** Just the graded-engine half, for anything that only wants what
 *  `composeSet`/`grade` consume. */
export const DEMO_QUESTIONS: readonly Question[] = DEMO_BANK.map((d) => d.question);

const BY_ID = new Map(DEMO_BANK.map((d) => [d.question.id, d]));

/** The display half for a graded question id, or null — a `Graded.questionId`
 *  that does not resolve is a bank swap or a stale record, and the caller
 *  decides what an unknown one means, same contract as `syllabus.ts`'s
 *  `nodeFor`. */
export function demoQuestionFor(id: string): DemoQuestion | null {
  return BY_ID.get(id) ?? null;
}
