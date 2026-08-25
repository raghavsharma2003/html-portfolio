// The JEE Advanced PCM syllabus, as data. No behaviour, no English she could
// say, no I/O — the taxonomy every other file in `src/engine/practice/` keys
// off, plus the four-band difficulty ladder and the five question formats with
// their real marking schemes.
//
// ── why this is a module and not a table in a database ────────────────────
//
// The syllabus is the product's spine: `student-app-spec.md` §2.1 hangs the
// mastery tracks off it, §1.3 hangs the revision queue off it, §3.1's pattern
// claims ("three sign slips in the same step") are only sayable because the
// step belongs to a topic with a stable id. A topic id that changes is a
// mastery track that silently resets and a `vy_pattern` citation that stops
// resolving, so the ids here are a CONTRACT: append freely, rename never.
//
// Ids are DERIVED from slugs (`p.em.electrostatics.gauss-law`) rather than
// typed out per node, because a hand-typed id table is a typo waiting to
// become a second mastery track for a topic that already had one. The raw
// tree below carries slug + name; `build()` composes the ids once.
//
// ── on the depth of the tree ──────────────────────────────────────────────
//
// Subjects and units and CHAPTERS are exhaustive for the real 2026 syllabus
// (`student-app-spec.md` §4.1, itself sourced from jeeadv.ac.in). TOPICS are
// expanded for four exemplar chapters — the three the spec names by example
// (rotational dynamics, electrochemistry's Nernst equation, integration by
// parts) plus electrostatics — and are empty everywhere else.
//
// That is not a gap in the design; it is the part of this file that is data
// entry, and it is deliberately shaped so that the engine works on the whole
// syllabus TODAY: `masteryNodes()` returns a chapter's own id as its leaf when
// that chapter has no topics yet, so a practice set on `c.org.hydrocarbons`
// grades, tallies and remembers exactly like one on an expanded chapter. When
// a chapter's topics are entered, its leaf splits and finer tracks begin; the
// coarse chapter-level history stays valid because its id never moved.

// ── the shape ─────────────────────────────────────────────────────────────

/** `p` physics, `c` chemistry, `m` mathematics. Single letters because every
 *  id in the product starts with one and they are typed into fixtures a lot. */
export type SubjectId = "p" | "c" | "m";

export interface Topic {
  /** `<subject>.<unit>.<chapter>.<topic>` — stable forever */
  id: string;
  name: string;
}

export interface Chapter {
  /** `<subject>.<unit>.<chapter>` */
  id: string;
  name: string;
  /** Empty means "topics not entered yet", never "this chapter has no parts".
   *  See `masteryNodes()`. */
  topics: readonly Topic[];
}

export interface Unit {
  /** `<subject>.<unit>` */
  id: string;
  name: string;
  chapters: readonly Chapter[];
}

export interface Subject {
  id: SubjectId;
  name: string;
  units: readonly Unit[];
}

/**
 * The four bands, in the order a topic is climbed. `student-app-spec.md` §4.2:
 * a student is never handed a `pyq` problem on a topic still sitting at
 * `foundation`, because a hard problem on an unlearned topic produces guessing,
 * and guessing corrupts the mastery signal that chose the problem.
 */
export type DifficultyBand = "foundation" | "standard" | "advanced" | "pyq";

export const BANDS: readonly DifficultyBand[] = ["foundation", "standard", "advanced", "pyq"];

/** JEE Advanced's four live formats plus matrix-match, which is historical but
 *  still needed for PYQ fidelity (`student-app-spec.md` §4.3). */
export type QuestionFormat =
  | "single_correct"
  | "multi_correct"
  | "integer"
  | "numerical"
  | "matrix_match";

export const FORMATS: readonly QuestionFormat[] = [
  "single_correct",
  "multi_correct",
  "integer",
  "numerical",
  "matrix_match",
];

/**
 * What a response is worth. Four numbers, and the whole reason they are data
 * rather than branches in the grader is that the multi-correct scheme is the
 * one everybody simplifies: `student-app-spec.md` §4.3 says the all-or-nothing
 * version "would corrupt the mastery signal for every multi-correct attempt",
 * because a student who found three of four correct options and stopped is not
 * the same student as one who guessed.
 */
export interface MarkingScheme {
  /** everything right, nothing wrong */
  full: number;
  /** per correct option/row when NOTHING wrong was chosen and the response is
   *  a proper subset of the key. 0 in the formats that carry no partial. */
  partialPerOption: number;
  /** when anything wrong was chosen. Negative, or 0 where the format has no
   *  negative marking. */
  wrong: number;
  /** unattempted. Zero in every JEE Advanced format — stated rather than
   *  assumed, because a scheme that omits it invites a grader to invent one. */
  skipped: number;
}

/**
 * The 2025-pattern schemes (`student-app-spec.md` §4.3, sourced from the
 * Careers360/Vedantu pattern coverage it cites).
 *
 * `matrix_match.full` is the standard four-row paper value; a key with a
 * different row count is worth `rows × partialPerOption`, which is what
 * `maxMarksFor` returns. `full` is the reference number, never the arithmetic.
 */
export const MARKING: Record<QuestionFormat, MarkingScheme> = {
  single_correct: { full: 3, partialPerOption: 0, wrong: -1, skipped: 0 },
  multi_correct: { full: 4, partialPerOption: 1, wrong: -2, skipped: 0 },
  integer: { full: 4, partialPerOption: 0, wrong: 0, skipped: 0 },
  numerical: { full: 4, partialPerOption: 0, wrong: 0, skipped: 0 },
  matrix_match: { full: 8, partialPerOption: 2, wrong: -1, skipped: 0 },
};

/** Rows in the canonical matrix-match paper question — P/Q/R/S against 1..5. */
export const MATRIX_STANDARD_ROWS = 4;

/**
 * Below this many seconds an answer was not SOLVED, whatever it scored.
 *
 * Not a speed penalty — `student-app-spec.md` §2.5 rejects speed bonuses
 * outright, and this is the same coin the other way up: a correct answer
 * produced in eight seconds on an advanced multi-correct is a remembered key
 * or a lucky pick, and letting it move a mastery track is how the track stops
 * meaning anything. The verdict it produces (`rushed`) is a fact about the
 * ATTEMPT, never about the student — see `practiceTalk.ts`.
 *
 * Per format, because reading four options and eliminating two is genuinely
 * faster than matching four rows. Overridable per question
 * (`Question.floorSeconds`) for a one-liner that really is that fast.
 */
export const FLOOR_SECONDS: Record<QuestionFormat, number> = {
  single_correct: 20,
  multi_correct: 35,
  integer: 30,
  numerical: 30,
  matrix_match: 45,
};

// ── the raw tree ──────────────────────────────────────────────────────────
//
// slug + name only. Ids are composed by `build()` below.

interface RawTopic {
  slug: string;
  name: string;
}
interface RawChapter {
  slug: string;
  name: string;
  topics?: readonly RawTopic[];
}
interface RawUnit {
  slug: string;
  name: string;
  chapters: readonly RawChapter[];
}
interface RawSubject {
  id: SubjectId;
  name: string;
  units: readonly RawUnit[];
}

const t = (slug: string, name: string): RawTopic => ({ slug, name });

const RAW: readonly RawSubject[] = [
  {
    id: "p",
    name: "Physics",
    units: [
      {
        slug: "measure",
        name: "Measurement and Experiment",
        chapters: [
          { slug: "units-and-measurement", name: "Units and Measurement" },
          { slug: "experimental-skills", name: "Experimental Skills" },
        ],
      },
      {
        slug: "mech",
        name: "Mechanics",
        chapters: [
          { slug: "kinematics", name: "Kinematics" },
          { slug: "laws-of-motion", name: "Laws of Motion" },
          { slug: "work-energy-power", name: "Work, Energy and Power" },
          {
            // EXPANDED — `student-app-spec.md` §2.1 names "rotational dynamics"
            // as a mastery-track example.
            slug: "rotational-dynamics",
            name: "Rotational Dynamics",
            topics: [
              t("moment-of-inertia", "moment of inertia"),
              t("axis-theorems", "parallel and perpendicular axis theorems"),
              t("torque-and-angular-acceleration", "torque and angular acceleration"),
              t("angular-momentum", "angular momentum and its conservation"),
              t("rolling", "rolling without slipping"),
              t("rotational-energy", "combined translation and rotation energy"),
              t("instantaneous-axis", "instantaneous axis of rotation"),
              t("collisions-of-rigid-bodies", "collisions involving rigid bodies"),
            ],
          },
          { slug: "gravitation", name: "Gravitation" },
          { slug: "mechanical-properties-of-matter", name: "Mechanical Properties of Matter" },
        ],
      },
      {
        slug: "heat",
        name: "Heat and Thermodynamics",
        chapters: [
          { slug: "thermal-properties-and-thermodynamics", name: "Thermal Properties and Thermodynamics" },
          { slug: "kinetic-theory-of-gases", name: "Kinetic Theory of Gases" },
        ],
      },
      {
        slug: "waves",
        name: "Oscillations and Waves",
        chapters: [{ slug: "oscillations-and-waves", name: "Oscillations and Waves" }],
      },
      {
        slug: "em",
        name: "Electricity and Magnetism",
        chapters: [
          {
            // EXPANDED — the second exemplar chapter.
            slug: "electrostatics",
            name: "Electrostatics",
            topics: [
              t("coulombs-law", "Coulomb's law and superposition"),
              t("continuous-distributions", "field of continuous charge distributions"),
              t("gauss-law", "Gauss's law"),
              t("potential-and-energy", "electric potential and potential energy"),
              t("dipole", "dipole in a uniform field"),
              t("conductors", "conductors and induced charge"),
              t("capacitance", "capacitance and combinations"),
              t("dielectrics", "dielectrics"),
              t("stored-energy", "energy stored in a capacitor"),
            ],
          },
          { slug: "current-electricity", name: "Current Electricity" },
          { slug: "magnetic-effects-of-current", name: "Magnetic Effects of Current" },
          { slug: "emi-and-ac", name: "Electromagnetic Induction and Alternating Current" },
        ],
      },
      {
        slug: "optics",
        name: "Optics",
        chapters: [
          { slug: "ray-optics", name: "Ray Optics" },
          { slug: "wave-optics", name: "Wave Optics" },
        ],
      },
      {
        slug: "modern",
        name: "Modern Physics",
        chapters: [{ slug: "modern-physics", name: "Modern Physics" }],
      },
    ],
  },
  {
    id: "c",
    name: "Chemistry",
    units: [
      {
        slug: "phys",
        name: "Physical Chemistry",
        chapters: [
          { slug: "mole-concept", name: "Mole Concept and Stoichiometry" },
          { slug: "atomic-structure", name: "Atomic Structure" },
          { slug: "chemical-bonding", name: "Chemical Bonding" },
          { slug: "states-of-matter", name: "States of Matter" },
          { slug: "thermodynamics", name: "Chemical Thermodynamics" },
          { slug: "chemical-equilibrium", name: "Chemical Equilibrium" },
          { slug: "ionic-equilibrium", name: "Ionic Equilibrium" },
          {
            // EXPANDED — `student-app-spec.md` §2.1 names "electrochemistry:
            // Nernst equation" as a mastery-track example.
            slug: "electrochemistry",
            name: "Electrochemistry",
            topics: [
              t("redox-and-electrodes", "redox and electrode reactions"),
              t("galvanic-cells", "galvanic cells and cell emf"),
              t("standard-potentials", "standard electrode potentials"),
              t("nernst-equation", "the Nernst equation"),
              t("gibbs-and-emf", "Gibbs energy and cell emf"),
              t("conductance", "conductance and molar conductivity"),
              t("kohlrausch", "Kohlrausch's law"),
              t("electrolysis", "electrolysis and Faraday's laws"),
              t("batteries-and-corrosion", "batteries and corrosion"),
            ],
          },
          { slug: "chemical-kinetics", name: "Chemical Kinetics" },
          { slug: "surface-chemistry", name: "Surface Chemistry" },
        ],
      },
      {
        slug: "inorg",
        name: "Inorganic Chemistry",
        chapters: [
          { slug: "periodic-table", name: "Periodic Table and Periodicity" },
          { slug: "s-block", name: "s-Block Elements" },
          { slug: "p-block", name: "p-Block Elements" },
          { slug: "d-and-f-block", name: "d- and f-Block Elements" },
          { slug: "coordination-compounds", name: "Coordination Compounds" },
          { slug: "metallurgy", name: "Metallurgy" },
          { slug: "qualitative-analysis", name: "Qualitative Analysis" },
        ],
      },
      {
        slug: "org",
        name: "Organic Chemistry",
        chapters: [
          { slug: "goc", name: "General Organic Chemistry" },
          { slug: "hydrocarbons", name: "Hydrocarbons" },
          { slug: "haloalkanes-and-haloarenes", name: "Haloalkanes and Haloarenes" },
          { slug: "alcohols-phenols-ethers", name: "Alcohols, Phenols and Ethers" },
          { slug: "carbonyl-and-acids", name: "Aldehydes, Ketones and Carboxylic Acids" },
          { slug: "amines", name: "Amines" },
          { slug: "biomolecules", name: "Biomolecules" },
          { slug: "polymers", name: "Polymers" },
          { slug: "practical-organic", name: "Practical Organic Chemistry" },
        ],
      },
    ],
  },
  {
    id: "m",
    name: "Mathematics",
    units: [
      {
        slug: "algebra",
        name: "Algebra",
        chapters: [
          { slug: "quadratic-equations", name: "Quadratic Equations" },
          { slug: "sequences-and-series", name: "Sequences and Series" },
          { slug: "complex-numbers", name: "Complex Numbers" },
          { slug: "permutations-and-combinations", name: "Permutations and Combinations" },
          { slug: "binomial-theorem", name: "Binomial Theorem" },
          { slug: "matrices-and-determinants", name: "Matrices and Determinants" },
        ],
      },
      {
        slug: "trig",
        name: "Trigonometry",
        chapters: [
          { slug: "ratios-and-identities", name: "Trigonometric Ratios and Identities" },
          { slug: "inverse-trigonometric-functions", name: "Inverse Trigonometric Functions" },
        ],
      },
      {
        slug: "coordinate",
        name: "Coordinate Geometry",
        chapters: [
          { slug: "straight-lines", name: "Straight Lines" },
          { slug: "circles", name: "Circles" },
          { slug: "conic-sections", name: "Conic Sections" },
        ],
      },
      {
        slug: "calculus",
        name: "Calculus",
        chapters: [
          { slug: "limits-and-continuity", name: "Limits and Continuity" },
          { slug: "differentiation", name: "Differentiation" },
          { slug: "applications-of-derivatives", name: "Applications of Derivatives" },
          {
            // EXPANDED — "you always rush integration by parts" is the running
            // example in `student-app-spec.md` §3.1 and `teacher-arc.md`, and
            // the pattern machinery cannot cite a topic that does not exist.
            slug: "integration",
            name: "Integration",
            topics: [
              t("standard-forms", "standard indefinite forms"),
              t("substitution", "integration by substitution"),
              t("by-parts", "integration by parts"),
              t("partial-fractions", "partial fractions"),
              t("trigonometric-integrals", "trigonometric integrals"),
              t("definite-properties", "properties of definite integrals"),
              t("limit-of-sum", "definite integral as a limit of a sum"),
              t("area-under-curves", "area under curves"),
              t("reduction-formulae", "reduction formulae"),
            ],
          },
          { slug: "differential-equations", name: "Differential Equations" },
        ],
      },
      {
        slug: "vectors3d",
        name: "Vectors and 3D Geometry",
        chapters: [
          { slug: "vectors", name: "Vectors" },
          { slug: "three-dimensional-geometry", name: "Three Dimensional Geometry" },
        ],
      },
      {
        slug: "probability",
        name: "Probability and Statistics",
        chapters: [
          { slug: "probability", name: "Probability" },
          { slug: "statistics", name: "Statistics" },
        ],
      },
    ],
  },
];

// ── the built tree ────────────────────────────────────────────────────────

function build(raw: readonly RawSubject[]): readonly Subject[] {
  return raw.map((s) => ({
    id: s.id,
    name: s.name,
    units: s.units.map((u) => {
      const unitId = `${s.id}.${u.slug}`;
      return {
        id: unitId,
        name: u.name,
        chapters: u.chapters.map((c) => {
          const chapterId = `${unitId}.${c.slug}`;
          return {
            id: chapterId,
            name: c.name,
            topics: (c.topics ?? []).map((x) => ({ id: `${chapterId}.${x.slug}`, name: x.name })),
          };
        }),
      };
    }),
  }));
}

/** The whole syllabus. Frozen at every level: this is a shared constant and a
 *  caller that sorts it in place would reorder it for everyone. */
export const SYLLABUS: readonly Subject[] = deepFreeze(build(RAW));

function deepFreeze<T>(v: T): T {
  if (Array.isArray(v)) v.forEach(deepFreeze);
  else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(deepFreeze);
  return Object.freeze(v);
}

// ── lookups ───────────────────────────────────────────────────────────────
//
// Built once, at module load, because every consumer here is on a per-question
// path and a linear walk of ~90 chapters per grade is the kind of cost nobody
// notices until a mock test grades 48 of them at once.

export interface Node {
  id: string;
  name: string;
  subject: SubjectId;
  unitId: string;
  chapterId: string;
  /** absent on a chapter-level node */
  topicId?: string;
}

const NODES = new Map<string, Node>();
const CHAPTER_TOPICS = new Map<string, readonly string[]>();

for (const s of SYLLABUS) {
  for (const u of s.units) {
    for (const c of u.chapters) {
      NODES.set(c.id, { id: c.id, name: c.name, subject: s.id, unitId: u.id, chapterId: c.id });
      CHAPTER_TOPICS.set(c.id, c.topics.map((x) => x.id));
      for (const x of c.topics) {
        NODES.set(x.id, {
          id: x.id,
          name: x.name,
          subject: s.id,
          unitId: u.id,
          chapterId: c.id,
          topicId: x.id,
        });
      }
    }
  }
}

/** The node for any chapter or topic id, or null. Never throws: an id that
 *  came out of a stored attempt from a syllabus revision is a thing that
 *  happens, and the caller decides what an unknown one means. */
export function nodeFor(id: string): Node | null {
  return NODES.get(id) ?? null;
}

/** The human name for a chapter or topic id, or "". This is the ONLY string in
 *  the practice stack that reaches her vocabulary, which is why it is a plain
 *  lowercase noun phrase ("integration by parts") on the topics and Title Case
 *  on the chapters — she says the topic, she names the chapter. */
export function nameFor(id: string): string {
  return NODES.get(id)?.name ?? "";
}

/**
 * The LEAVES the mastery map, the revision queue and every tally key off.
 *
 * A chapter with topics contributes its topics. A chapter WITHOUT contributes
 * itself — see this file's header: the engine has to work across the whole
 * syllabus before the topic rows are typed in, and a chapter-level track that
 * later splits into topic-level tracks loses nothing, because the chapter id
 * it was stored under never moves.
 */
export function masteryNodes(): readonly string[] {
  const out: string[] = [];
  for (const [chapterId, topics] of CHAPTER_TOPICS) {
    if (topics.length) out.push(...topics);
    else out.push(chapterId);
  }
  return out;
}

/** True when `id` is `ancestor` or sits under it. Lets a practice config name
 *  a chapter and pick up every topic in it. Prefix-matched on the dot, never
 *  on the raw string, so `p.em.electrostatics` does not swallow a future
 *  `p.em.electrostatics-lab`. */
export function isUnder(id: string, ancestor: string): boolean {
  return id === ancestor || id.startsWith(`${ancestor}.`);
}

/** Max marks for a key of this format. Matrix-match scales with its row count;
 *  every other format is a fixed number. */
export function maxMarksFor(format: QuestionFormat, rows = MATRIX_STANDARD_ROWS): number {
  if (format === "matrix_match") return rows * MARKING.matrix_match.partialPerOption;
  return MARKING[format].full;
}

/**
 * Everything structurally wrong with the tree, as strings. Empty is the
 * passing state and `evals/practice.mjs` asserts exactly that.
 *
 * It exists because the remaining work in this file is DATA ENTRY, and data
 * entry's failure mode is a duplicated slug that produces two nodes with one
 * id — which does not crash, it merges two mastery tracks into one and looks
 * fine on every screen.
 */
export function syllabusIssues(): string[] {
  const bad: string[] = [];
  const seen = new Set<string>();
  const slug = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  for (const s of SYLLABUS) {
    for (const u of s.units) {
      for (const c of u.chapters) {
        if (seen.has(c.id)) bad.push(`duplicate id ${c.id}`);
        seen.add(c.id);
        if (!slug.test(c.id.split(".").pop() ?? "")) bad.push(`bad slug ${c.id}`);
        if (!c.name.trim()) bad.push(`unnamed chapter ${c.id}`);
        for (const x of c.topics) {
          if (seen.has(x.id)) bad.push(`duplicate id ${x.id}`);
          seen.add(x.id);
          if (!slug.test(x.id.split(".").pop() ?? "")) bad.push(`bad slug ${x.id}`);
          if (!x.name.trim()) bad.push(`unnamed topic ${x.id}`);
        }
      }
    }
  }
  return bad;
}
