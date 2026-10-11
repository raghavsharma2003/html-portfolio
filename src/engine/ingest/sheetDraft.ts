// sheetDraft — deterministic assembly of a PARTIAL TeacherSheet from the
// statistical signals plus the teacher's own typed input (WS-F).
//
// ── the law this file is built around ─────────────────────────────────────
// `silent-truncation`: absent and NAMED, never faked. `teacher-sheet-spec.md`
// §0 states the operational version — a pipeline sized for 46 of the 61
// CharacterSheet fields "will silently leave 15 unfilled, and an unfilled
// `ex*` field means the core interpolates an empty string into a bullet that
// expects a sample". The failure mode of a sheet drafter is therefore NOT a
// crash. It is a sheet that looks complete, validates, publishes, and speaks
// with fifteen fields of nothing in it.
//
// So this module returns three things and the second is the point:
//
//   draft   — only fields it can honestly stand behind
//   gaps    — EVERY field not in the draft, each with a reason code
//   sources — where each drafted field came from, with the number behind it
//
// `draft` ∪ `gaps` is the whole sheet contract, asserted in `evals/ingest.mjs`
// against the field lists rather than against a specimen sheet. A specimen
// with a missing key would quietly shrink the contract, which is `fromSheet.ts`'s
// own reason for enumerating its 61 rather than deriving them.
//
// ── what it will NOT do ───────────────────────────────────────────────────
// It writes no prose. Not one output of this file is a sentence, because
// `recited-prompt` measured what happens to sentence-shaped text in a prompt
// (a phrase bank recited on 4/5 turns; taste written as polished English read
// out verbatim twice, eight turns apart). The register BULLETS are the
// tempting case — the spec's ING rows 6/8/13-20 say "measured ratio rendered
// into the canonical bullet" — and this module refuses them anyway: the
// register SKELETON is Relational Core, not sheet (`teacher-sheet-spec.md`
// §1), the invariant suite probes the bullet heads literally, and a drafter
// that generated bullet prose would be generating Core. What it does instead
// is publish the MEASUREMENT (`measurements` below) so the studio can render
// "marker-token ratio 0.183, n=4,210 tokens" beside the canonical bullet the
// teacher confirms. The number is mined; the sentence never is.
import type { TeacherAnalogy, TeacherSheet } from "../agents/teacherTypes";
import {
  PHRASE_BANK_MAX_WORDS,
  splitHeldOut,
  verifyPhraseBank,
  type CountedFragment,
  type PhraseBankVerification,
  type TranscriptStats,
  type TranscriptTurn,
} from "./transcriptStats";

// ── the field census ──────────────────────────────────────────────────────
//
// Source classes are `teacher-sheet-spec.md` §2's legend, verbatim:
//   ING   extracted automatically, teacher confirms
//   ING?  extractable but not reliable alone — extraction proposes, teacher
//         must edit or approve
//   TCH   teacher input, cannot be mined (and in several cases MUST NOT be)
//   TPL   authored template per subject archetype, teacher may not edit
//   FLOOR safety-floor content, identical across every published clone
//   SYS   assigned by the platform

export type SourceClass = "ING" | "ING?" | "TCH" | "TPL" | "FLOOR" | "SYS";

/** Every field of the TeacherSheet contract with the class the spec assigns
 *  it. Enumerated for `fromSheet.ts`'s stated reason and cross-checked against
 *  its own lists by `evals/ingest.mjs`, so a field added to the type and
 *  forgotten here becomes a red suite rather than a silent omission. */
export const FIELD_SOURCE_CLASS: Readonly<Record<string, SourceClass>> = Object.freeze({
  // ── SYS ──
  slug: "SYS", version: "SYS", voiceCloneId: "SYS",
  // ── FLOOR ──
  crisisLines: "FLOOR", cloneDisclosureFact: "FLOOR", academicIntegrityStance: "FLOOR",
  // ── TCH: cannot be mined, and rows 5/21 must not be ──
  name: "TCH", identityWho: "TCH", identityLife: "TCH", lifeTexture: "TCH",
  voiceIdentityPhrase: "TCH", syllabusScope: "TCH", firstMoveOnDoubt: "TCH",
  doubtEscalationLadder: "TCH", rigorFloor: "TCH", strictness: "TCH", warmth: "TCH",
  pacePreference: "TCH", credentialFacts: "TCH", examTrack: "TCH",
  escalationRoute: "TCH", consentArtifactId: "TCH",
  // ── TPL: authored templates, including the seven arc overrides, whose
  //    content is teacher-arc.md's and is a PRODUCT decision, not a teacher's ──
  textEmojiRule: "TPL", voiceSpelling: "TPL", sarvamScriptRule: "TPL",
  stageNickname: "TPL", shareSuggestLine: "TPL", outOfScopePolicy: "TPL",
  stageEarly: "TPL", stageGettingClose: "TPL", stageEstablished: "TPL",
  boundaryParagraph: "TPL", ritualPatternShapes: "TPL", abilityLabelBan: "TPL",
  winMethodRule: "TPL",
  exDeflect: "TPL", exNameRude: "TPL", exSpecificWin: "TPL", exNeverSeen: "TPL",
  exVoicenoteMood: "TPL", exPhotoReact: "TPL", exComfort: "TPL", exWantSpecific: "TPL",
  exThreadOpen: "TPL", exRememberShown: "TPL", exLateNightCallback: "TPL",
  exPointerWords: "TPL", exNeverTyped: "TPL", exNameTheMiss: "TPL", exNoHolding: "TPL",
  exSearchHold: "TPL", exResurrect: "TPL", exWatchOpinions: "TPL", exScreenWarn: "TPL",
  // ── ING: mined ──
  languageVoiceRule: "ING", languageTextRule: "ING", textLaughter: "ING",
  voiceStretch: "ING", voiceLaughter: "ING", voiceFillers: "ING",
  voiceSelfCorrect: "ING", voiceRepeat: "ING", voiceBreath: "ING",
  voiceLanguageBalance: "ING", sttSoundAlikes: "ING", technicalTermRule: "ING",
  explanationOrder: "ING", workedExamplePattern: "ING", notationConventions: "ING",
  analogyBank: "ING", boardVerbalisms: "ING", commonMistakeBank: "ING",
  subjectDomain: "ING", subjectStrands: "ING",
  exSlangRepeat: "ING", exOneWordReplies: "ING", exMissedCatch: "ING",
  exCuriousAsk: "ING", exMoveOn: "ING", exTinyCheck: "ING", exCutoffReact: "ING",
  exGetInterested: "ING", exCorrections: "ING", exSelfFix: "ING", exQuickPickup: "ING",
  // ── ING?: proposes, teacher edits ──
  textShortforms: "ING?", textStretch: "ING?", tasteTopics: "ING?",
  curiosityTopics: "ING?", exMockShock: "ING?", exDontKnow: "ING?",
  exMockOffended: "ING?",
});

/** Why a field is absent from the draft. Machine-readable, stable, greppable —
 *  `SheetValidationError.code`'s convention, because a studio renders these
 *  next to a row and a human reads the reason, not the enum. */
export type GapReason =
  /** TCH — the teacher has not typed it. Nothing mines it, by design. */
  | "needs-teacher-input"
  /** TPL — an authored template supplies it; a drafter must not invent one */
  | "needs-template"
  /** FLOOR — platform-owned, identical across every clone, not draftable */
  | "platform-floor"
  /** SYS — the platform assigns it at registration */
  | "platform-assigned"
  /** ING, but the value is a REGISTER BULLET whose head is Relational Core.
   *  The measurement is in `measurements`; the sentence is not this module's
   *  to write. */
  | "measured-needs-canonical-bullet"
  /** ING, but the derivation is a judgement the statistical pass cannot make.
   *  The `qualitativePass` seam owns it and is a stub. */
  | "needs-qualitative-pass"
  /** ING and statistical, but the corpus produced nothing above threshold */
  | "insufficient-evidence"
  /** ING and mined, but the spec marks the field "confirm + prune" and the
   *  candidates are sitting in `candidates` waiting for a teacher to pick.
   *  Mining proposes; it does not choose what a clone of a named person says. */
  | "needs-teacher-confirmation"
  /** ING and statistical, but no HELD-OUT corpus was supplied, so the
   *  phrase-bank rule could not be applied. Candidates are offered; the field
   *  is not filled from an unverified mine. */
  | "unverified-no-held-out-evidence";

export interface SheetGap {
  field: string;
  sourceClass: SourceClass;
  reason: GapReason;
  /** the number or fragment that explains the gap, when naming it helps */
  detail?: string;
}

/** Where a drafted field came from. `teacher-sheet-spec.md` §4.6: "Provenance
 *  row per extracted field ... An extracted field with no provenance cannot
 *  publish." Every key of `draft` appears here — asserted, not assumed. */
export interface SheetProvenance {
  field: string;
  /** "teacher-input" for a typed field, "transcript-stats" for a mined one */
  origin: "teacher-input" | "transcript-stats";
  /** the signal it was mined from, when mined */
  signal?: string;
  /** the counts behind it, when there are counts */
  detail?: string;
}

/** The numbers the statistical pass measured but is not allowed to render into
 *  prose. The studio shows these beside the register bullets a teacher
 *  confirms — the honest half of "measured ratio rendered into the canonical
 *  bullet", with the rendering left to a human. */
export interface DraftMeasurements {
  tokens: number;
  turns: number;
  hindiMarkerTokenRatio: number;
  hindiMarkerTurnRatio: number;
  topFillers: readonly CountedFragment[];
  laughterTokens: readonly CountedFragment[];
  stretchTokens: readonly CountedFragment[];
}

export interface SheetDraftResult {
  /** honestly-derived fields only. Never a full sheet; `validateTeacherSheet`
   *  will (correctly) reject it until the gaps are filled. */
  draft: Partial<TeacherSheet>;
  /** every contract field NOT in `draft`, each with a reason */
  gaps: readonly SheetGap[];
  provenance: readonly SheetProvenance[];
  measurements: DraftMeasurements;
  /** mined phrase-bank candidates, for the teacher to pick from. Offered,
   *  never merged: `culture.ts`'s match-then-inject asymmetry — nothing is
   *  pushed at the sheet, a row enters only when a human matched it. */
  candidates: readonly CountedFragment[];
  /** the phrase-bank verdict this draft rests on. `verified:false` with a
   *  reason is the normal answer when no held-out half was supplied. */
  phraseBank: PhraseBankVerification;
}

/** The TCH/SYS fields a teacher (or the platform) supplies by typing them.
 *  Deliberately a loose partial: a studio that saved half a form must be able
 *  to draft, and a required-field list here would duplicate
 *  `validateTeacherSheet` in a second place with a second opinion. */
export type TeacherInput = Partial<TeacherSheet>;

export interface DraftOptions {
  /** the held-out half of the corpus. Without it the phrase-bank rule cannot
   *  run, and the phrase-bank fields are left ABSENT rather than filled from
   *  an in-sample mine — the check the spec calls the difference between a
   *  habitual verbalism and a memorable LINE. */
  heldOut?: readonly TranscriptTurn[] | string | null;
  /** cap on proposed verbalisms. `teacher-sheet-spec.md` §4.3, corpus-level. */
  maxVerbalisms?: number;
}

const VERBALISM_CAP = 12;

/** The two fields the core deliberately licenses for REPETITION
 *  (`persona.ts:131`), which is exactly what makes them the phrase bank
 *  `recited-prompt` measured at 4/5 turns. Never carried through from teacher
 *  input verbatim — they go the long way round, through the verifier. */
const PHRASE_BANK_FIELDS: ReadonlySet<string> = new Set(["boardVerbalisms", "exSlangRepeat"]);

/** Fragments out of either phrase-bank spelling: `boardVerbalisms` is an array,
 *  `exSlangRepeat` is a parenthesised quoted list. Deduplicated, order kept —
 *  a teacher's ordering is a teacher's ordering. */
function normalizeFragments(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === "string"
      ? value.replace(/^[\s(]+|[\s)]+$/g, "").split(",")
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const fragment = item.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!fragment || seen.has(fragment)) continue;
    seen.add(fragment);
    out.push(fragment);
  }
  return out;
}

/** `exSlangRepeat` ships as a parenthesised quoted list — `fromSheet.ts`'s
 *  `verbalismFragments` unwraps exactly this shape, so the renderer and the
 *  parser are one round trip and not two guesses. */
function renderSlangList(items: readonly string[]): string {
  return `(${items.map((i) => `"${i}"`).join(", ")})`;
}

/** Fields a teacher typed that are safe to carry into the draft verbatim.
 *  Anything not in `FIELD_SOURCE_CLASS` is dropped rather than passed through:
 *  a jsonb body from a studio is untrusted input, and an unknown key riding
 *  into a sheet is how a field nobody validates reaches a prompt. */
function acceptedTeacherFields(input: TeacherInput): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [field, value] of Object.entries(input ?? {})) {
    const cls = FIELD_SOURCE_CLASS[field];
    if (!cls) continue;
    // FLOOR is platform content. A teacher typing `crisisLines` into their own
    // form must not have it echoed back as their field — §2.1 class 1: "A
    // teacher cannot edit, shorten, localize away, or 'make it sound more like
    // me'." The gate would catch a changed value; this stops it being carried.
    if (cls === "FLOOR") continue;
    // The phrase-bank fields are a teacher's SELECTION, not their value. They
    // are assembled below, after the held-out verifier has pruned them.
    if (PHRASE_BANK_FIELDS.has(field)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (Array.isArray(value) && !value.length) continue;
    out.push([field, value]);
  }
  return out;
}

/** The reason a field is absent, given who was supposed to supply it. One
 *  switch so a new source class cannot get a silently-missing gap reason. */
function gapReasonFor(field: string, cls: SourceClass): GapReason {
  switch (cls) {
    case "SYS": return "platform-assigned";
    case "FLOOR": return "platform-floor";
    case "TCH": return "needs-teacher-input";
    case "TPL": return "needs-template";
    default:
      return REGISTER_BULLET_ING.has(field)
        ? "measured-needs-canonical-bullet"
        : "needs-qualitative-pass";
  }
}

/** ING fields whose VALUE is a register bullet. The measurement is mineable;
 *  the bullet is Relational Core (`teacher-sheet-spec.md` §1). Mirrors
 *  `fromSheet.ts`'s REGISTER_BULLET_FIELDS restricted to the ING half —
 *  `evals/ingest.mjs` asserts the two agree. */
const REGISTER_BULLET_ING: ReadonlySet<string> = new Set([
  "languageVoiceRule", "languageTextRule", "textLaughter", "voiceStretch",
  "voiceLaughter", "voiceFillers", "voiceRepeat", "voiceBreath",
  "voiceLanguageBalance", "technicalTermRule", "voiceSelfCorrect",
  "textStretch",
]);

/**
 * Assemble a partial TeacherSheet from measured signals and typed input.
 *
 * Deterministic: same stats + same input + same options ⇒ byte-identical
 * result. That is a hard requirement rather than a nicety, because a studio
 * that re-drafts and shows a teacher a different sheet has taught them the
 * pipeline is arbitrary, and because `evals/ingest.mjs` gates it.
 */
export function draftFromSignals(
  stats: TranscriptStats,
  teacherInput: TeacherInput = {},
  options: DraftOptions = {},
): SheetDraftResult {
  const draft: Record<string, unknown> = {};
  const provenance: SheetProvenance[] = [];
  const gaps: SheetGap[] = [];

  // ── 1. what the teacher typed, carried verbatim ──────────────────────────
  // Verbatim and unedited: this is the half a human is accountable for, and a
  // pipeline that "improved" a teacher's own words about their own credentials
  // would be putting words in a named person's mouth.
  for (const [field, value] of acceptedTeacherFields(teacherInput)) {
    draft[field] = value;
    provenance.push({ field, origin: "teacher-input" });
  }

  // ── 2. the phrase bank ───────────────────────────────────────────────────
  //
  // Mining PROPOSES; it does not choose. `teacher-sheet-spec.md` marks
  // `boardVerbalisms` "confirm + prune — HIGHEST recitation risk in the sheet",
  // and an auto-filled catchphrase field is the `recited-prompt` failure with a
  // pipeline in front of it: on this suite's own fixture the top mined
  // candidates include "squared", "equals" and "r", which are the LECTURE, not
  // the teacher. So the candidate list is offered, and the field is filled only
  // from fragments the teacher themselves selected — with the machine doing the
  // half a human cannot, which is checking each selection against the held-out
  // corpus and PRUNING the ones that are lines rather than habits.
  //
  // That is the division of labour the spec asks for, in the only order that is
  // safe: a human picks what a clone of them may repeat, a counter proves they
  // actually repeat it.
  const cap = Math.max(0, options.maxVerbalisms ?? VERBALISM_CAP);
  const mined = stats.catchphrases
    .filter((c) => c.fragment.split(" ").length <= PHRASE_BANK_MAX_WORDS)
    .slice(0, cap);

  const selected = [
    ...normalizeFragments(teacherInput.boardVerbalisms),
    ...normalizeFragments(teacherInput.exSlangRepeat),
  ];
  const heldOut = options.heldOut ?? null;
  const phraseBank = verifyPhraseBank(selected, heldOut, {
    teacherSpeaker: stats.speaker.label,
  });
  const kept = phraseBank.findings.filter((f) => f.ok).map((f) => f.fragment);

  // Candidates are reported with their held-out standing too, so a studio ranks
  // by what is PROVEN habitual rather than by what was loudest in the half the
  // draft was mined from.
  const candidateVerdict = verifyPhraseBank(mined.map((c) => c.fragment), heldOut, {
    teacherSpeaker: stats.speaker.label,
  });
  const candidates = phraseBank.unverifiedReason
    ? mined
    : mined.filter((c) => candidateVerdict.findings.find((f) => f.fragment === c.fragment)?.ok);

  if (selected.length && !phraseBank.unverifiedReason && kept.length) {
    // A teacher's selection is not carried verbatim — the pruned set is what
    // lands. Carrying an unverified pick would mean the endpoint's publish gate
    // is the only thing standing between a memorable LINE and a prompt.
    draft.boardVerbalisms = kept;
    provenance.push({
      field: "boardVerbalisms",
      origin: "transcript-stats",
      signal: "teacher selection, pruned by held-out >=5 occurrences",
      detail: kept
        .map((f) => `${f}=${phraseBank.findings.find((x) => x.fragment === f)?.occurrences ?? 0}`)
        .join(", "),
    });

    // `exSlangRepeat` is the UNIGRAM half of the same evidence — "the short
    // ordinary slang the teacher genuinely repeats" (spec row 29). Same corpus,
    // same threshold, one word each, derived from the kept set rather than
    // mined a second time with a second opinion.
    const single = kept.filter((f) => !f.includes(" "));
    if (single.length) {
      draft.exSlangRepeat = renderSlangList(single);
      provenance.push({
        field: "exSlangRepeat",
        origin: "transcript-stats",
        signal: "verified single-word verbalisms",
        detail: single.join(", "),
      });
    }
  }

  // ── 3. the gaps: EVERY contract field not in the draft, with a reason ────
  for (const field of Object.keys(FIELD_SOURCE_CLASS)) {
    if (field in draft) continue;
    const cls = FIELD_SOURCE_CLASS[field];
    if (field === "boardVerbalisms" || field === "exSlangRepeat") {
      gaps.push({
        field,
        sourceClass: cls,
        reason: !selected.length
          ? "needs-teacher-confirmation"
          : phraseBank.unverifiedReason
            ? "unverified-no-held-out-evidence"
            : "insufficient-evidence",
        detail: !selected.length
          ? `${candidates.length} candidate(s) offered, none selected yet`
          : phraseBank.unverifiedReason
            ? `${selected.length} selected, none verifiable without a held-out corpus`
            : `${selected.length} selected, ${kept.length} cleared the >=5 rule`,
      });
      continue;
    }
    gaps.push({ field, sourceClass: cls, reason: gapReasonFor(field, cls) });
  }

  return {
    draft: draft as Partial<TeacherSheet>,
    gaps,
    provenance,
    measurements: {
      tokens: stats.tokens,
      turns: stats.speaker.turns,
      hindiMarkerTokenRatio: stats.codeSwitch.tokenRatio,
      hindiMarkerTurnRatio: stats.codeSwitch.turnRatio,
      topFillers: stats.fillers.slice(0, 10),
      laughterTokens: stats.laughter,
      stretchTokens: stats.stretch.slice(0, 10),
    },
    candidates,
    phraseBank,
  };
}

/** Convenience for the common shape: one corpus in, the parity split applied,
 *  the draft derived from one half and verified against the other. Exported so
 *  a caller cannot get the split backwards — deriving and verifying on the
 *  same half is a check that cannot fail, and it is one keystroke away. */
export function draftFromTranscript(
  turns: readonly TranscriptTurn[],
  statsOf: (t: readonly TranscriptTurn[]) => TranscriptStats,
  teacherInput: TeacherInput = {},
  options: Omit<DraftOptions, "heldOut"> = {},
): SheetDraftResult {
  const { derive, heldOut } = splitHeldOut(turns);
  return draftFromSignals(statsOf(derive), teacherInput, { ...options, heldOut });
}

/** Re-exported so a consumer of a draft has the analogy type without reaching
 *  past this module into the sheet contract. */
export type { TeacherAnalogy };
