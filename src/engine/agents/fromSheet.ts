// sheetToModule — an AgentModule built from sheet DATA rather than from a
// compile-time import. This is the whole of WS-B's runtime half.
//
// ── why this file exists at all ───────────────────────────────────────────
// `agents/teacher.ts` is the STATIC precedent and it is deliberately eight
// lines of substance: the same persona.ts builders every incumbent uses,
// parameterized by one sheet. That is the proof that a teacher clone is a
// sheet on the unchanged Relational Core, and it is also the reason a dynamic
// loader is cheap: everything a module needs is already a pure function of
// the sheet.
//
// SPEC-GURUKUL.md §2: "Registry: today compile-time static (registry.ts).
// Gurukul needs DB-backed sheets: TeacherSheet rows stored at publish time, an
// AgentModule constructed at runtime from the stored sheet, with the invariant
// checks run at publish time (studio-side) instead of build time. The static
// registry stays for Maya/Kabir; the dynamic loader is additive."
//
// So `sheetToModule` is PURE and has exactly one input. It does not read the
// database, it does not consult consent, and it does not decide whether a
// clone may exist — those are the LOADER's job (api/_teachersheet.js), and
// keeping them out of here is what lets the static registry and the server
// loader construct byte-identical modules from the same sheet. A constructor
// that quietly enforced a policy would be a second, invisible copy of that
// policy.
//
// ── what this file does NOT change about teacher.ts's scope note ──────────
// Repeated rather than left to be inferred, because a reader who arrives at a
// dynamically-loaded teacher module will assume more coverage, not less: the
// 24 pedagogy fields are still NOT compiled into the prompt (that is compiler
// work, teacher-sheet-spec.md §3.1), so `cloneDisclosureFact` and
// `academicIntegrityStance` still exist as data and do not reach a model. The
// chat lane's media catalogs are still Maya's. Constructing a module from a DB
// row does not add a single byte of prompt coverage over the static path.
//
// ── why agents/teacher.ts does NOT call sheetToModule ─────────────────────
// It was written that way first, and it does not work: `registry.ts` →
// `teacher.ts` → this file → `shapelint.ts` → `compiler.ts` → `registry.ts`,
// and `compiler.ts` reads `DEFAULT_AGENT.CRISIS_LINES` AT MODULE SCOPE. Under
// that edge `DEFAULT_AGENT` is undefined when the line runs and the whole
// engine bundle throws on import — `storyCatalog.ts:41-42` records the
// identical hazard from the other side. So the runtime registry's import graph
// stays clear of `shapelint`, and the price is that the static path and this
// one are two spellings of the same five builder calls rather than one.
//
// That price is paid down by a TEST, not by a comment: `evals/teachersheet.mjs`
// compiles `sheetToModule(DEMO_TEACHER)` and the registered
// `teacher-demo-arjun` module and asserts the prompt bytes are identical. A
// drift between the two spellings is then a red suite, rather than a clone
// that is subtly not the teacher the studio validated.
import {
  buildSystemPromptParts,
  buildSpeechStyle,
  buildWatchModeNote,
  stageParagraphFor,
  SEARCH_DECISION,
  FORGET_DECISION,
} from "../persona";
import { PUBLISHED_HELPLINES } from "../honesty";
import { lintLine } from "../shapelint";
// WS-R111: the material block. `fromSheet.ts` already imports `shapelint`,
// which already imports `compiler` for `hashCore` — "`fromSheet.ts` →
// `shapelint` → `compiler` is already a live edge" (cloneLife.ts's own
// note on this exact hazard) — so a direct import here closes no new cycle,
// it only shortens one that already exists. `compiler.ts` imports nothing
// from this file or from `shapelint`, so the other direction stays clear.
// WS-R121 adds the platform-owned boundary/stage constants from the same
// file, for the same reason (see `PLATFORM_BOUNDARY`'s own header comment
// in `compiler.ts`).
import {
  renderCreatorMaterial,
  PLATFORM_BOUNDARY,
  PLATFORM_STAGE_EARLY,
  PLATFORM_STAGE_GETTING_CLOSE,
  PLATFORM_STAGE_ESTABLISHED,
  type MaterialLine,
} from "../compiler";
// WS-Q. `moodWordsIn` is timeline.ts's OWN G8 audit ("a calendar is not a mood
// engine"), reused rather than re-implemented: a second mood-word list is a
// second thing that goes stale, and the one in timeline.ts is the one an
// existing gate already exercises. Type-only for the life shape itself —
// cloneLife.ts imports nothing, so neither edge can become a cycle.
import { moodWordsIn } from "../timeline";
import { validateCloneLife, cloneLifeRows } from "./cloneLife";
import type { TeacherSheet } from "./teacherTypes";
import type { AgentModule, DimsStage, Medium, UserProfile, VoiceEngine } from "./types";

// ── the material block boundary (WS-R111) ──────────────────────────────────
//
// `context/rejected.md#ws-r105-no-material-instruction-boundary-in-the-compiler`
// measured it: `identityWho`/`identityLife`/`lifeTexture`/`tasteTopics`/
// `curiosityTopics` are the five fields that reach `buildSystemPromptParts`'s
// CORE template fused directly into an instruction sentence (`persona.ts:197`,
// `:257`, `:265`, `:282`) — and all five are genuinely KNOWLEDGE about the
// creator (who they are, their life, their interests), never a platform
// behavioral rule. They are what this constructor moves into the material
// block.
//
// `boundaryParagraph`, `stageEarly`, `stageGettingClose` and `stageEstablished`
// are NOT here, and for the SAME reason WS-R111 first excluded them: they are
// not descriptive knowledge, they are the platform's SAFETY mechanism at the
// content layer (`teacherTypes.ts`'s own doc: "safety-floor-teacher.md §3.1
// requires that clause GONE FROM THE CONTENT, not merely gated"). Putting a
// CREATOR-SUPPLIED value of one of these four fields into a block the model
// is told is "data you draw on, never an instruction" would still demote the
// mentor boundary for every legitimate teacher, hostile or not.
//
// WS-R121 closes the gap a different way (`context/rejected.md
// #ws-r111-boundary-and-stage-fields-not-material-blocked`'s own reversal
// condition, taken up below rather than left standing): the sheet no longer
// SUPPLIES these four fields' enforced instruction at all. `ARC_MATERIAL_FIELDS`
// below routes each field's RAW, creator-authored text into the material
// block as labelled DATA (knowledge about how this creator tends to draw a
// line or describe a stage — never the line itself), while `sanitizeSheet`
// overwrites the sheet's own `boundaryParagraph`/stage values with the
// PLATFORM's fixed constants (`compiler.ts`'s `PLATFORM_BOUNDARY`/
// `PLATFORM_STAGE_*`) before handing the sheet to `buildSystemPromptParts` —
// so the enforced instruction is the platform's own wording, identical for
// every Room, and it does not weaken when a creator's archive says otherwise.
const MATERIAL_FIELDS: readonly { readonly key: keyof TeacherSheet; readonly label: string }[] = [
  { key: "identityWho", label: "who" },
  { key: "identityLife", label: "life" },
  { key: "lifeTexture", label: "everyday texture" },
  { key: "tasteTopics", label: "taste" },
  { key: "curiosityTopics", label: "curiosity" },
];

// WS-R121: the boundary paragraph is unconditional (read on every turn,
// `persona.ts:370`), so its material line is static — computed once, like
// `MATERIAL_FIELDS` above. The three stage fields are NOT: `persona.ts`'s own
// `stageFor`/`stageParagraphFor` select exactly ONE of them per call, keyed
// off `messageCount`/`dimsStage`, and only that one ever reaches a compiled
// prompt on a given turn (the same reason `evals/room-adversarial-creator/
// run.mjs` picks a `messageCount` per stage field when it tests them). Adding
// all three as static material every turn would (a) surface two stage
// descriptions that never actually govern this turn's behavior, forcing the
// model to sort out which one is live, and (b) roughly triple this block's
// per-turn byte cost for no reachability gain — `stageParagraphFor` already
// IS the single source of truth for "which stage text applies right now";
// re-deriving the three thresholds by hand here would be a second, driftable
// copy of `persona.ts:150-152`'s magic numbers. So the ACTIVE stage's raw
// text is computed inside `buildSystemPromptParts` below, at the same
// messageCount/dimsStage the compiled prompt itself uses, via the real,
// imported `stageParagraphFor` called against the UNSANITIZED sheet.
const BOUNDARY_MATERIAL_LABEL = "how they draw lines";
const STAGE_MATERIAL_LABEL = "how they'd describe this stage of getting to know a student";

/**
 * Build an AgentModule from a TeacherSheet. Pure — same sheet in, same module
 * out, whether the sheet came from `characters/demoTeacher.ts` or from a
 * `vy_teacher_sheet` row.
 *
 * `register.honorificSystem` is "hi-TV" as for the incumbents, and [MINOR] the
 * T-V default runs respectful-to-the-STUDENT and never slides to a diminutive
 * (teacher-sheet-spec.md §4.6).
 *
 * `buildSystemPromptParts` here does two things `persona.ts`'s own function
 * does not, and does them WITHOUT editing `persona.ts` (its READ-ONLY law
 * holds): it calls the real, unmodified `buildSystemPromptParts` against a
 * SANITIZED copy of the sheet — MATERIAL_FIELDS blanked, so the shared core
 * template's interpolation sites for them render empty rather than fusing the
 * creator's raw words into an instruction sentence — and then appends the
 * material block (built from the REAL, unsanitized values) to CORE, which is
 * where every one of those five fields' fused positions already lived (never
 * TAIL — none of the five sit in `buildSystemPromptParts`'s tail output).
 * `buildSpeechStyle` and `WATCH_MODE_NOTE` are untouched: neither reads any of
 * the five (grepped: `C.identityWho`/`identityLife`/`lifeTexture`/
 * `tasteTopics`/`curiosityTopics` appear in `persona.ts` only inside the CORE
 * template `buildSystemPromptParts` builds).
 */
export function sheetToModule(sheet: TeacherSheet): AgentModule {
  const staticMaterial: MaterialLine[] = MATERIAL_FIELDS.map(({ key, label }) => ({
    label,
    value: String(sheet[key] ?? ""),
  }));
  const sanitized: TeacherSheet = { ...sheet };
  for (const { key } of MATERIAL_FIELDS) {
    (sanitized as unknown as Record<string, unknown>)[key] = "";
  }
  // WS-R121: the platform owns these four now — overwritten on the SANITIZED
  // copy only, so `sheet` (captured by the closure below, unmodified) still
  // carries the creator's own raw text for the material lines.
  sanitized.boundaryParagraph = PLATFORM_BOUNDARY;
  sanitized.stageEarly = PLATFORM_STAGE_EARLY;
  sanitized.stageGettingClose = PLATFORM_STAGE_GETTING_CLOSE;
  sanitized.stageEstablished = PLATFORM_STAGE_ESTABLISHED;

  return {
    slug: sheet.slug,
    displayName: sheet.name,
    personaVersion: sheet.version,

    buildSystemPromptParts: (
      user: UserProfile,
      messageCount: number,
      medium: Medium,
      dimsStage?: DimsStage,
    ) => {
      // The ACTIVE stage's raw creator text, at THIS turn's messageCount/
      // dimsStage — same selector `buildSystemPromptParts` below uses
      // internally, called here against the RAW sheet rather than the
      // sanitized one, so this always names whichever of the three raw
      // stage texts actually governs this turn (see this file's header).
      const activeStageText = stageParagraphFor(messageCount, dimsStage, sheet);
      const materialBlock = renderCreatorMaterial([
        ...staticMaterial,
        { label: BOUNDARY_MATERIAL_LABEL, value: String(sheet.boundaryParagraph ?? "") },
        { label: STAGE_MATERIAL_LABEL, value: activeStageText },
      ]);
      const parts = buildSystemPromptParts(user, messageCount, medium, dimsStage, sanitized);
      return { core: parts.core + materialBlock, tail: parts.tail };
    },
    buildSpeechStyle: (engine: VoiceEngine | "live") => buildSpeechStyle(engine, sheet),

    WATCH_MODE_NOTE: buildWatchModeNote(sheet),
    SEARCH_DECISION,
    FORGET_DECISION,
    CRISIS_LINES: sheet.crisisLines,

    register: { script: "latin", honorificSystem: "hi-TV" },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// validateTeacherSheet — the PUBLISH-TIME validator (teacher-sheet-spec.md §4)
// ─────────────────────────────────────────────────────────────────────────
//
// "This is a gate, not a linter run: publish fails closed." Every failure
// names its field, so the studio can point at the row rather than at the
// sheet.
//
// ── what is deliberately NOT here ─────────────────────────────────────────
//
//  1. THE CONSENT GATE. A sheet's CONTENT can be valid while the clone may
//     not exist — the demo teacher is exactly that case, and it is the reason
//     `consentGateBlockers` is a separate export rather than one more error in
//     this list. Publishing is `validateTeacherSheet(sheet).ok &&
//     consentGateBlockers(...).length === 0`, both, and the loader re-checks
//     the second against the row it actually read.
//  2. THE ≥5-OCCURRENCES HALF of the phrase-bank rule (spec §4.3: an item must
//     appear at least five times in the held-out half of the teacher's own
//     transcript corpus; an item appearing ≤2 times is a LINE, not a
//     verbalism). That check needs a transcript, this function takes a sheet,
//     and a corpus-free approximation of it would be a check that passes
//     against a corpus it cannot see — the exact shape `dead-writers` warns
//     about. It belongs to WS-F's ingestion pipeline, where the corpus lives.
//     The shape half (≤3 words, no terminal punctuation, cap 12) IS enforced
//     here because it needs nothing but the sheet.
//  3. THE ASSEMBLED-PROMPT CHECKS (§4.4/§4.5): floor invariants per module,
//     CORE byte-stability, appended-last-exactly-two, prompt budget. Those run
//     over compiled output, not over sheet data — the publish path composes
//     `sheetToModule` with the invariant runner, which is what
//     `evals/teachersheet.mjs` drives.

export interface SheetValidationError {
  /** the sheet field that failed — the studio points at this row */
  field: string;
  /** machine-readable reason; stable, greppable, never prose */
  code: string;
  /** the offending value or number, when naming it is the useful part */
  detail?: string;
}

export interface SheetValidation {
  ok: boolean;
  errors: readonly SheetValidationError[];
}

/** All 61 CharacterSheet fields (28 identity/register/life + 33 `ex*`), which
 *  a TeacherSheet inherits and never replaces. Enumerated rather than derived
 *  from a specimen sheet: a specimen with a missing key would quietly shrink
 *  the contract, and teacher-sheet-spec.md §0's whole point is that a pipeline
 *  sized for the wrong number leaves fields silently unfilled. */
const CHARACTER_STRING_FIELDS = [
  "slug", "name", "version",
  "identityWho", "identityLife",
  "languageVoiceRule", "crisisLines", "languageTextRule",
  "textShortforms", "textStretch", "textLaughter", "textEmojiRule",
  "voiceStretch", "voiceLaughter", "voiceFillers", "voiceSelfCorrect",
  "voiceRepeat", "voiceBreath", "voiceSpelling", "voiceLanguageBalance",
  "lifeTexture", "tasteTopics", "curiosityTopics", "voiceIdentityPhrase",
  "sttSoundAlikes", "sarvamScriptRule", "stageNickname", "shareSuggestLine",
  "exSlangRepeat", "exOneWordReplies", "exMockShock", "exDeflect",
  "exNameRude", "exSpecificWin", "exNeverSeen", "exDontKnow",
  "exVoicenoteMood", "exPhotoReact", "exComfort", "exWantSpecific",
  "exThreadOpen", "exRememberShown", "exLateNightCallback", "exMissedCatch",
  "exCuriousAsk", "exMoveOn", "exPointerWords", "exTinyCheck",
  "exCutoffReact", "exMockOffended", "exNeverTyped", "exGetInterested",
  "exNameTheMiss", "exNoHolding", "exSearchHold", "exCorrections",
  "exSelfFix", "exResurrect", "exWatchOpinions", "exScreenWarn",
  "exQuickPickup",
] as const;

/** The seven arc overrides. OPTIONAL on CharacterSheet so Maya's bytes do not
 *  move; REQUIRED here, and this list is the runtime half of that requirement.
 *
 *  A teacher sheet may not fall back to the companion arc. The failure of
 *  omitting one is not a blander clone: it is a clone of a real named teacher
 *  talking to a minor while carrying an arc that escalates intimacy with
 *  message count and a boundary paragraph whose middle sentence is a live
 *  escalation path ("warmth can deepen naturally"). safety-floor-teacher.md
 *  §3.1 requires that clause GONE FROM THE CONTENT, not merely gated behind
 *  clock.ts's `romanceRegisters` — two independent layers, the house rule for
 *  a harm the next turn cannot undo. The TYPE holds this for a compile-time
 *  sheet; a sheet arriving as a jsonb row has no type, so it is held here. */
const ARC_OVERRIDE_FIELDS = [
  "stageEarly", "stageGettingClose", "stageEstablished",
  "boundaryParagraph", "ritualPatternShapes", "abilityLabelBan", "winMethodRule",
] as const;

/** Teacher string fields beyond the arc (spec §3). */
const TEACHER_STRING_FIELDS = [
  "syllabusScope", "outOfScopePolicy", "technicalTermRule",
  "explanationOrder", "workedExamplePattern", "firstMoveOnDoubt",
  "notationConventions", "cloneDisclosureFact", "academicIntegrityStance",
  "escalationRoute", "credentialFacts", "consentArtifactId",
] as const;

const TEACHER_ARRAY_FIELDS = [
  "subjectStrands", "examTrack", "doubtEscalationLadder",
  "rigorFloor", "boardVerbalisms", "commonMistakeBank",
] as const;

/** Register-bullet fields. Spec §4.2: these are EXEMPT from the three content
 *  lints exactly as persona.ts's own core prose is (shapelint.ts:10-18 — it is
 *  instructional English telling the model how to sound, not a line the clone
 *  says), and get a structural check instead: the bullet must begin with "- "
 *  and its canonical head must survive. The register SKELETON is Relational
 *  Core; a sheet fills slots and never rewrites a bullet head, and the
 *  invariant floor probes those heads literally per module. */
const REGISTER_BULLET_FIELDS = [
  "languageVoiceRule", "languageTextRule", "textShortforms", "textStretch",
  "textLaughter", "textEmojiRule", "voiceStretch", "voiceLaughter",
  "voiceFillers", "voiceSelfCorrect", "voiceRepeat", "voiceBreath",
  "voiceSpelling", "voiceLanguageBalance", "sarvamScriptRule",
  "technicalTermRule",
] as const;

/** Content-row fields, spec §4.2's list verbatim. `shapelint.lintLine` runs
 *  over each ROW of these, with the allowlist carrying only `crisisLines` —
 *  the one class where verbatim is the point. */
const LINTABLE_CONTENT_FIELDS = [
  "commonMistakeBank", "analogyBank", "notationConventions", "rigorFloor",
  "credentialFacts", "tasteTopics", "curiosityTopics", "lifeTexture",
] as const;

const PACE_VALUES = new Set(["push", "balanced", "drill"]);
const SUBJECT_VALUES = new Set(["physics", "chemistry", "maths"]);

/** The phrase-bank cap (spec §4.3, corpus-level). */
const VERBALISM_MAX_WORDS = 3;
const VERBALISM_MAX_ITEMS = 12;

/** Below this many digits, a run is not an identifier anyone can act on —
 *  honesty.ts's own short-code floor is 3, and its MIN_PHONE_DIGITS is 8. A
 *  "24x7" or an "under-18" must not be read as a helpline, and a "1098" must. */
const MIN_IDENTIFIER_DIGITS = 3;

const digitsOf = (s: string) => s.replace(/\D+/g, "");
const HELPLINE_DIGITS = new Set(PUBLISHED_HELPLINES.map(digitsOf));

/**
 * Every actionable number in a crisis-adjacent string. Digit runs, allowing
 * the spaces/hyphens/leading + a written phone number carries, then filtered
 * to what honesty.ts would treat as an identifier at all.
 */
export function helplineNumbersIn(text: string): readonly string[] {
  const out: string[] = [];
  for (const m of text.match(/\+?\d[\d\s-]*\d|\d+/g) ?? []) {
    const d = digitsOf(m);
    if (d.length >= MIN_IDENTIFIER_DIGITS) out.push(d);
  }
  return out;
}

/**
 * Rows of a field, for the content lint. Arrays are already rows; a
 * comma-list or telegraphic string is split on the separators the spec's own
 * field descriptions use ("comma-list fragment", "telegraphic"), so the lint
 * measures a ROW and not a whole field — a four-item comma list is not one
 * twenty-word sentence and must not be reported as one.
 */
function rowsOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) =>
      v && typeof v === "object" && "topic" in (v as object)
        ? // analogyBank: {topic, anchor}. The SENTENCE is never stored, so the
          // row we lint is the pair rendered as one — which is also the shape
          // any renderer of it will produce.
          `${(v as { topic: string }).topic}: ${(v as { anchor: string }).anchor}`
        : String(v),
    );
  }
  if (typeof value !== "string") return [];
  return value.split(/[\n;·,]/).map((s) => s.trim()).filter(Boolean);
}

/** Fragments of a phrase-bank field: `boardVerbalisms` is already an array,
 *  `exSlangRepeat` is a parenthesised quoted list. */
function verbalismFragments(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .replace(/^[\s(]+|[\s)]+$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^["'`]+|["'`]+$/g, "").trim())
    .filter(Boolean);
}

/**
 * The publish-time validator. Returns every failure rather than the first —
 * a studio that makes a teacher fix one row per round trip is a studio nobody
 * finishes a publish in.
 */
export function validateTeacherSheet(sheet: unknown): SheetValidation {
  const errors: SheetValidationError[] = [];
  const push = (field: string, code: string, detail?: string) =>
    errors.push(detail === undefined ? { field, code } : { field, code, detail });

  if (!sheet || typeof sheet !== "object") {
    return { ok: false, errors: [{ field: "<sheet>", code: "not-an-object" }] };
  }
  const s = sheet as Record<string, unknown>;

  // ── 1. every required field present and correctly typed ────────────────
  const requiredStrings = [
    ...CHARACTER_STRING_FIELDS,
    ...ARC_OVERRIDE_FIELDS,
    ...TEACHER_STRING_FIELDS,
  ];
  for (const f of requiredStrings) {
    const v = s[f];
    if (typeof v !== "string") {
      // Arc overrides get their own code: "this sheet would silently inherit
      // the companion arc" is a different failure from "a field is blank",
      // and the studio must not report them with the same words.
      const arc = (ARC_OVERRIDE_FIELDS as readonly string[]).includes(f);
      push(f, arc ? "arc-override-missing" : "missing-or-not-a-string", typeof v);
    } else if (!v.trim()) {
      const arc = (ARC_OVERRIDE_FIELDS as readonly string[]).includes(f);
      push(f, arc ? "arc-override-missing" : "empty");
    }
  }

  for (const f of TEACHER_ARRAY_FIELDS) {
    const v = s[f];
    if (!Array.isArray(v) || v.length === 0) push(f, "missing-or-empty-array");
    else if (v.some((x) => typeof x !== "string" || !x.trim())) push(f, "non-string-row");
  }

  if (!Array.isArray(s.analogyBank)) push("analogyBank", "missing-or-empty-array");
  else if (
    s.analogyBank.some(
      (a) =>
        !a || typeof a !== "object" ||
        typeof (a as { topic?: unknown }).topic !== "string" ||
        typeof (a as { anchor?: unknown }).anchor !== "string",
    )
  ) {
    push("analogyBank", "not-a-topic-anchor-pair");
  }

  if (!SUBJECT_VALUES.has(String(s.subjectDomain))) push("subjectDomain", "not-a-subject", String(s.subjectDomain));
  if (!PACE_VALUES.has(String(s.pacePreference))) push("pacePreference", "not-a-pace", String(s.pacePreference));
  for (const f of ["strictness", "warmth"] as const) {
    const v = s[f];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 4) push(f, "not-a-0-4-dial", String(v));
  }
  if (!(s.voiceCloneId === null || typeof s.voiceCloneId === "string")) {
    push("voiceCloneId", "not-a-string-or-null", typeof s.voiceCloneId);
  }

  // ── 2. crisis lines — the strictest gate in the spec (§4.1) ────────────
  // Non-empty, and every actionable number in it (and in `escalationRoute`,
  // which routes a distressed minor the same way) present in honesty.ts's
  // PUBLISHED_HELPLINES. The coupling is the whole point: the honesty gate
  // treats an actionable identifier not present in its input as INVENTED, so
  // a helpline added to a sheet and not to the allowlist ships a clone that
  // cannot say the child helpline. Childline 1098 is that number, and this is
  // the check that makes the two edits one change.
  for (const f of ["crisisLines", "escalationRoute"] as const) {
    const v = s[f];
    if (typeof v !== "string" || !v.trim()) {
      if (f === "crisisLines") push(f, "crisis-lines-empty");
      continue;
    }
    for (const num of helplineNumbersIn(v)) {
      if (!HELPLINE_DIGITS.has(num)) push(f, "helpline-not-published", num);
    }
  }

  // ── 3. register bullets keep their slot shape (§4.2, exempt half) ───────
  for (const f of REGISTER_BULLET_FIELDS) {
    const v = s[f];
    if (typeof v === "string" && v.trim() && !v.startsWith("- ")) {
      push(f, "register-bullet-head-lost", v.slice(0, 24));
    }
  }

  // ── 4. shapelint over the content rows (§4.2) ──────────────────────────
  // The allowlist carries only `crisisLines` — the one class where verbatim is
  // the point (shapelint.ts:70-75) — and `crisisLines` is not in the lintable
  // set anyway, which is the same statement made twice on purpose.
  for (const f of LINTABLE_CONTENT_FIELDS) {
    for (const row of rowsOf(s[f])) {
      const violation = lintLine(row);
      if (violation.reasons.length) push(f, "recitable-shape", `${row} — ${violation.reasons.join("; ")}`);
    }
  }

  // ── 5. the phrase-bank rule (§4.3), shape half only ────────────────────
  // `boardVerbalisms` and `exSlangRepeat` are the two fields the core
  // deliberately licenses for REPETITION (persona.ts:131), which is exactly
  // what makes them the phrase bank `recited-prompt` measured at 4/5 turns.
  // Enforced here: ≤3 words per fragment, no terminal punctuation, ≤12 items.
  // NOT enforced here: the ≥5-occurrences-in-the-held-out-corpus half, which
  // separates a habitual verbalism from a memorable LINE. It needs a
  // transcript; this function takes a sheet. It stays in WS-F's ingestion
  // pipeline, and a corpus-free stand-in for it would be worse than nothing.
  for (const f of ["boardVerbalisms", "exSlangRepeat"] as const) {
    const items = verbalismFragments(s[f]);
    if (items.length > VERBALISM_MAX_ITEMS) push(f, "phrase-bank-too-many", String(items.length));
    for (const item of items) {
      const words = item.split(/\s+/).filter(Boolean);
      if (words.length > VERBALISM_MAX_WORDS) push(f, "phrase-bank-too-long", item);
      if (/[.?!]$/.test(item)) push(f, "phrase-bank-terminal-punctuation", item);
    }
  }

  // ── 6. the clone's background life (WS-Q) ──────────────────────────────
  //
  // Three checks, and they are three because each catches a different way this
  // field ships broken while looking filled:
  //
  //  STRUCTURE — `validateCloneLife` proves the day covers midnight and its
  //    boundaries ascend. Without it `slotAtMinute` has an unreachable tail of
  //    the day and the clone's evening silently becomes its afternoon. That is
  //    `silent-truncation` wearing a calendar, and it returns 200.
  //  SHAPE — `lintLine` over every authored row. `boardVerbalisms` is the
  //    field this repo already names as the phrase bank; a day note is the
  //    field nobody thinks of that way, and it is read on more turns than any
  //    catchphrase, because it renders on all of them.
  //  MOOD — timeline.ts's own G8 audit. A note that says how the person FEELS
  //    about their afternoon is a mood assigned by a clock, delivered to a
  //    sixteen-year-old, on every single turn, with no cause in the
  //    conversation. It is the exact failure `inner.ts` made unrepresentable
  //    for Meera, arriving through the one door a sheet can open.
  for (const p of validateCloneLife(s.life)) {
    push(p.field, p.code, p.detail);
  }
  for (const row of cloneLifeRows(s.life as never)) {
    const violation = lintLine(row);
    if (violation.reasons.length) push("life", "recitable-shape", `${row} — ${violation.reasons.join("; ")}`);
    const mood = moodWordsIn(row);
    if (mood.length) push("life", "mood-word-in-life-note", `${row} — ${mood.join(", ")}`);
  }

  return { ok: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────
// The consent gate — separate on purpose (see the note above)
// ─────────────────────────────────────────────────────────────────────────

/** A sheet row as the loader reads it: the stored status and consent pointer,
 *  which are row state and NOT sheet content. A `consentArtifactId` inside the
 *  sheet jsonb is the studio's claim; the column is the platform's record, and
 *  the gate reads the column. */
export interface TeacherSheetRowState {
  status?: string | null;
  consent_artifact_id?: string | null;
}

/** The nil-shaped placeholder `characters/demoTeacher.ts` carries. It is not a
 *  consent row and does not point at one — a fictional teacher has nobody to
 *  consent — and publish must fail closed on it. */
export const PLACEHOLDER_CONSENT_ARTIFACT_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Why a sheet may NOT be registered. Empty array = the gate is open.
 *
 * safety-floor-teacher.md §2.2: consent gates registration, revocation
 * DEREGISTERS the module rather than asking the clone to stop. So this is the
 * predicate the loader and the publish path share, and it is deliberately a
 * list of blockers rather than a boolean — `api/_replica-runtime.js`'s
 * `runtimeBlockers` is the house shape, and a caller that has to say WHY a
 * clone is unreachable cannot do it from a false.
 */
export function consentGateBlockers(row: TeacherSheetRowState): readonly string[] {
  const blockers: string[] = [];
  if (row.status !== "published") blockers.push("sheet_not_published");
  const consent = row.consent_artifact_id;
  if (!consent) blockers.push("consent_artifact_missing");
  else if (consent === PLACEHOLDER_CONSENT_ARTIFACT_ID) blockers.push("consent_artifact_placeholder");
  return blockers;
}
