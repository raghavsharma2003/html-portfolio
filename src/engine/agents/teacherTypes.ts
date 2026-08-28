// The TeacherSheet contract — a CharacterSheet plus the pedagogy a teacher
// clone needs, per docs/gurukul/teacher-sheet-spec.md §3.
//
// A teacher clone is, in this repo's terms, exactly what Kabir proved a
// personality is: one sheet dropped onto the unchanged Relational Core. What a
// TEACHER additionally needs is not behavior — the OS carries interaction
// nuance and always will — it is the twenty-four facts about how this
// particular person teaches, plus four floor fields the platform owns.
//
// ── CORRECTION CARRIED FORWARD ──────────────────────────────────────────
// teacher-sheet-spec.md §0: the CharacterSheet contract is **61 fields**, not
// the 46 an early note claimed. 28 identity/register/life + 33 `ex*` example
// fragments. Any ingestion pipeline sized for 46 leaves 15 unfilled, and an
// unfilled `ex*` interpolates an empty string into a bullet that expects a
// sample. TeacherSheet inherits all 61 and adds to them; it never replaces one.
//
// ── AUTHORING LAW ───────────────────────────────────────────────────────
// characters/types.ts's law applies unchanged and is repeated here because
// this is the file a sheet-generating pipeline will read: fragments are SHAPES
// AND FACTS, never sentence-shaped lines the clone could recite
// (context/rejected.md `recited-prompt`, measured twice — example quotes acted
// as a phrase bank recited on 4/5 turns; taste written as polished sentences
// was read out verbatim twice, eight turns apart).
//
// Two fields carry that risk at its maximum and are called out where they are
// declared: `boardVerbalisms` (deliberately repeatable, therefore the phrase
// bank) and `analogyBank` (a signature analogy is memorable BY CONSTRUCTION,
// which is why it is stored as {topic, anchor} and the sentence is never
// stored at all).
//
// ── WHAT THIS FILE DOES NOT DO ──────────────────────────────────────────
// Stated plainly rather than implied. These fields are a DATA CONTRACT. WS-A
// declares them and ships a demo sheet that fills every one; it does not wire
// the pedagogy fields into the compiled prompt. teacher-sheet-spec.md §3.1
// specifies where they ride (pedagogy shapes and the four FLOOR fields in
// CORE; `commonMistakeBank` in the TAIL, budgeted, entering only when the
// student's own working matched a row — culture.ts's match-then-inject
// asymmetry, never pushed at the clone), and that assembly work belongs to the
// compiler pass, not to the sheet layer. A reader must not infer prompt
// coverage from a populated field.
//
// Leaf-module rule, one step wider than a character sheet's: this file may
// import nothing but characters/types.ts and cloneLife.ts — and cloneLife.ts
// is admitted precisely because it imports NOTHING at all, so the rule's
// purpose (this file can never drag the compiler or the persona into a sheet
// definition) is unchanged rather than merely relaxed.
import type { CharacterSheet } from "./characters/types";
import type { CloneLifeShape } from "./cloneLife";

/**
 * A signature physical analogy, stored as the PAIR and never as the sentence.
 * `topic` is what is being explained, `anchor` is the everyday object or
 * situation it is anchored to. The clone builds the sentence fresh each time;
 * storing the sentence would store a line, and a memorable line is precisely
 * what `recited-prompt` measured being recited.
 */
export interface TeacherAnalogy {
  /** the concept being explained — a strand-scoped noun phrase */
  topic: string;
  /** the everyday anchor it is explained through — a noun, not a clause */
  anchor: string;
}

/** How bluntly a wrong answer is named. Teacher-confirmed; never inferred
 *  alone — an over-read here is a real harm to a 16-year-old. */
export type TeacherStrictness = 0 | 1 | 2 | 3 | 4;

/** Encouragement density, independent of strictness. Same confirmation rule. */
export type TeacherWarmth = 0 | 1 | 2 | 3 | 4;

/** Whether they move on or over-practise. */
export type TeacherPace = "push" | "balanced" | "drill";

/** Which subject this clone answers in. A physics teacher's clone answering
 *  organic chemistry is a misrepresentation of them (consent artifact §2.1). */
export type TeacherSubject = "physics" | "chemistry" | "maths";

/**
 * `TeacherSheet extends CharacterSheet` — all 61 incumbent fields, plus the
 * seven arc overrides promoted from OPTIONAL to REQUIRED, plus 24 pedagogy and
 * platform fields.
 *
 * ── WHY THE ARC OVERRIDES ARE REQUIRED HERE ─────────────────────────────
 * They are optional on CharacterSheet so Maya's bytes do not move. They are
 * REQUIRED on TeacherSheet because the failure of omitting them is not a
 * blander clone — it is a clone of a real named teacher, talking to a minor,
 * carrying a romantic-companion arc that escalates intimacy with message count
 * and a boundary paragraph whose middle sentence is a live escalation path
 * ("warmth can deepen naturally"). docs/gurukul/safety-floor-teacher.md §3.1
 * requires that clause GONE FROM THE CONTENT, not merely gated behind
 * `clock.ts`'s `romanceRegisters`, because two independent layers is the house
 * rule for a harm the next turn cannot undo. A required field is the only
 * version of that rule the type system can hold: forgetting it is a build
 * error, not a silent inheritance.
 */
export interface TeacherSheet extends CharacterSheet {
  // ── the arc, promoted to required (docs/gurukul/teacher-arc.md §1) ─────
  /** stage 1 — competence before warmth; diagnose before you teach */
  stageEarly: string;
  /** stage 2 — the working-together era; teasing only ever about the work */
  stageGettingClose: string;
  /** stage 3 — keep your edge at depth; never become the centre of the change */
  stageEstablished: string;
  /** the MENTOR BOUNDARY paragraph that replaces ROMANCE BOUNDARY wholesale */
  boundaryParagraph: string;
  /** shapes of a study pattern worth christening — never one to install */
  ritualPatternShapes: string;
  /** the ability-label ban, appended to the diagnosis ban (teacher-arc §2.2) */
  abilityLabelBan: string;
  /** praise the METHOD, never the ability, appended to the win bullet (§3.2) */
  winMethodRule: string;

  // ── scope: what this clone answers, and what it refuses ────────────────
  /** which subject this clone answers in */
  subjectDomain: TeacherSubject;
  /** the named sub-strands they actually teach */
  subjectStrands: readonly string[];
  /** exam + class scope, AND the named topics it does not answer inside */
  syllabusScope: string;
  /** what happens when asked about a subject that is not theirs — a shape */
  outOfScopePolicy: string;
  /** which exam-cycle calendar rows apply (teacher-arc.md §5.2) */
  examTrack: readonly string[];

  // ── register: joins the existing bullets in CORE, same slot discipline ──
  /** technical nouns stay English at any Hindi density; units never translated */
  technicalTermRule: string;

  // ── how they teach: constant per teacher, so these ride in CORE ─────────
  /** canonical order through a new concept, as an arrow diagram */
  explanationOrder: string;
  /** the fixed skeleton a solved problem is run through — a shape */
  workedExamplePattern: string;
  /** the first ten seconds of a doubt — a shape, never an opening lecture */
  firstMoveOnDoubt: string;
  /** the ordered hint rungs given BEFORE any full solution — shapes, in order.
   *  This is the academic-integrity spine: it is what makes a full solution
   *  structurally never the first response (safety-floor-teacher.md §4.2). */
  doubtEscalationLadder: readonly string[];
  /** what they refuse to let a student skip — units, a diagram, a sanity check */
  rigorFloor: readonly string[];
  /** symbol and constant habits, telegraphic */
  notationConventions: string;
  /** signature analogies as {topic, anchor}; the sentence is never stored */
  analogyBank: readonly TeacherAnalogy[];
  /** the genuinely repeated short fragments — the catchphrase field, and the
   *  HIGHEST recitation risk in the sheet. Publish rules (spec §4.3): ≤3 words
   *  each, no terminal punctuation, no subject-verb pair, ≥5 occurrences in
   *  the held-out half of the teacher's own corpus (an item appearing ≤2 times
   *  is a LINE, not a verbalism), corpus-level cap ≤12 items. */
  boardVerbalisms: readonly string[];

  /** the errors they say students always make, per strand — telegraphic rows,
   *  10–40 of them. The one pedagogy field that does NOT ride in CORE: it is
   *  large and strand-scoped, so it rides in the budgeted TAIL and a row
   *  enters only when the student's own working matched it. */
  commonMistakeBank: readonly string[];

  // ── the dials, teacher-confirmed (never inferred alone) ─────────────────
  /** how bluntly a wrong answer is named */
  strictness: TeacherStrictness;
  /** encouragement density, independent of strictness */
  warmth: TeacherWarmth;
  /** move on, or over-practise */
  pacePreference: TeacherPace;

  // ── platform floor: identical across every published clone ──────────────
  /** FLOOR, not teacher-editable. The fact-shaped statement that this is an AI
   *  clone of a named real teacher, who published it, and that the real
   *  teacher is not reading these conversations. Disclosing CLONE status is
   *  not disclosing ARCHITECTURE — the never-internals block is untouched and
   *  the two must never be conflated (safety-floor-teacher.md §1.2). */
  cloneDisclosureFact: string;
  /** FLOOR, not teacher-editable. The live-assessment refusal posture. */
  academicIntegrityStance: string;
  /** who a distressed student is routed to BEYOND `crisisLines` — a trusted
   *  adult, the institution's counsellor. Required at publish. Every number in
   *  it is subject to the same PUBLISHED_HELPLINES rule as `crisisLines`. */
  escalationRoute: string;
  /** telegraphic: years teaching, institution as consented, and the explicit
   *  NOTs — not a counsellor, not a doctor, not an admissions authority */
  credentialFacts: string;

  // ── consent, the thing a clone may not exist without ────────────────────
  /** pointer to the signed likeness/voice consent row. Publish blocks without
   *  it; revocation DEREGISTERS the module rather than asking the clone to
   *  stop (safety-floor-teacher.md §2.2), and a revoked slug is never reused. */
  consentArtifactId: string;
  // ── the background life this clone has when nobody is asking (WS-Q) ─────
  /**
   * A plausible ordinary life, as SHAPES AND FACTS — the day cover, the weekly
   * rhythm and what is currently on this person's mind. See `cloneLife.ts` for
   * the contract and for why a clone's present is a pure function of it rather
   * than an improvisation.
   *
   * REQUIRED, on the same argument that made the seven arc overrides required:
   * the failure of omitting it is not a blander clone. Without it the model is
   * asked "what are you doing right now" with nothing in front of it and
   * improvises — which is the measured defect `herNow.ts` was built to close
   * ("reading a book", then "setting fairy lights", sixty seconds apart), except
   * that here the improvised life belongs to a real, named, living teacher whose
   * students will compare notes. A required field is the only version of that
   * rule the type system can hold.
   *
   * AUTHORING LAW, and it binds harder here than anywhere else in the sheet:
   * every note is a place, a posture or an activity — never a feeling (G8, "a
   * calendar is not a mood engine") and never a sentence the clone could read
   * out. The publish validator runs `shapelint.lintLine` and `timeline.ts`'s
   * own mood-word audit over every row.
   */
  life: CloneLifeShape;

  /** the TTS voice id this clone is licensed to use — null until a voice is
   *  cloned and consented. Must be covered by consentArtifactId's scope, and
   *  invalidated in the SAME transaction as revocation, or the voice outlives
   *  the consent (`cache-outlives-the-voice`). */
  voiceCloneId: string | null;
}
