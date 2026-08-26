// The SERVER's entry into the engine — WS-TGBOT.
//
// WHY THIS FILE EXISTS. api/*.js are plain-JS Vercel functions with a
// standing rule of zero imports from src/ (api/chat.js's own header states
// it, and the reason is real: a serverless function must keep working even if
// the bundler that builds src/ is unavailable). Node cannot import a .ts file
// without a loader this repo does not configure. But the Telegram surface is
// the FIRST place the server itself has to be Meera — a room turn has no
// client to compile the prompt.
//
// The two ways out of that were both taken before, elsewhere in this repo, and
// both are worse here:
//   - MIRROR the logic in JS (api/consolidate.js's honorific port,
//     api/chat.js's SYSTEM_MAX). Fine for a constant or thirty lines of
//     arithmetic; not for ~45k of persona plus the whole compiler. A mirrored
//     persona is a SECOND persona, and it would drift within a week.
//   - Re-derive a smaller prompt for rooms. That is a different Meera in the
//     room, which is the one thing the product cannot survive.
//
// So: this file is bundled ONCE by scripts/build-engine-bundle.mjs into
// api/_engine.gen.js, and api/tg.js imports THAT. The bundle is generated, not
// authored — the source of truth stays persona.ts / compiler.ts / room.ts, and
// the generator has a --check mode that fails when the bundle is stale, so a
// drift is a red build rather than a quiet second personality.
//
// If the bundle is missing at runtime, api/tg.js does NOT fall back to a
// hand-rolled prompt. It stays silent in the room and logs loudly. A degraded
// persona that still answers is the `silent-truncation` failure shape: it
// works, everything returns 200, and she is quietly someone else.
export { compile, type CompileInput, type CompiledPrompt } from "./compiler";
export {
  renderMpRoster,
  renderMpBridge,
  decideParticipation,
  isExplicitlyAddressed,
  ROOM_MODE_NOTE,
  ROOM_INTRO_DIRECTIVE,
  MP_ROSTER_BUDGET,
  MP_BRIDGE_BUDGET,
  ROOM_MEMBER_CAP,
  UNADDRESSED_COOLDOWN_MS,
  type RosterMember,
  type BridgeRow,
  type RoomBundleInput,
  type ParticipationInput,
  type ParticipationDecision,
  type RoomAction,
} from "./room";
export { CRISIS_LINES, type UserProfile } from "./persona";

// ── parse-and-gate, for every non-web surface (ticket #102) ────────────────
// api/_surface.js is a plain-JS Vercel function under the same zero-imports-
// from-src rule the header above describes, and until this export existed the
// only thing it could reach was `compile`. So a surface reply was raw model
// text: no protocol extraction, no texting-dash predicate, and — the reason
// this is a ticket rather than a polish item — no honesty gate. Telegram was
// shipping with NONE of families 1–4.
//
// The alternative was to re-implement the gate in JS beside the adapter, which
// is the mirrored-persona failure this file exists to refuse, one level down
// and worse: a second gate misses every rule added to honesty.ts after the
// fork, silently, while continuing to return 200. `docs/CONVERSATION-DEFECTS.md`
// names that shape ("a surface may choose how bytes reach the wire; it may not
// choose whether the engine's guarantees apply").
//
// These are exported as the gate's PUBLIC contract — the same functions
// brain.ts's own `gate()` calls, in the same order — so a surface inherits
// every future family with zero per-surface code.
export { parseBubbles, stripTextingDashes, type ParsedReply } from "./brain";
export {
  guardReply,
  openCommitments,
  allowedFrom,
  hisVocabulary,
  sharedVocabulary,
  inspect,
  type HonestyContext,
  type HonestyFinding,
} from "./honesty";

// ── the self layer (Phase E2, docs/SPEC-SELF-LAYER.md) ─────────────────────
// Exported here for the same reason room.ts is: api/consolidate.js is a
// plain-JS serverless function under the standing zero-imports-from-src rule,
// and the alternative — porting four derivers into JS by hand — is the
// mirrored-persona failure this file was created to avoid, one level down.
// A mirrored deriver is a second definition of what texture or growth MEANS,
// and it drifts on the first edit to either copy.
//
// Nothing here is a render function except the three the compiler already
// calls internally; these are the WRITE half, which only the nightly pass
// needs.
export {
  deriveTexture,
  upsertTexture,
  refreshTexture,
  readTexture,
  TEXTURE_N_TURNS_FLOOR,
  type TextureRow,
} from "./texture";
export { deriveSelfArc, loadCurrentArcs, MIN_SPAN_DAYS, type SelfArcRow } from "./selfarc";
export { untoldFor, markTold, seedFromStoryCatalog, type UntoldRow } from "./life";
export {
  writeObservation,
  matchObservations,
  decayObservations,
  observationEligibleForPromotion,
  promoteObservation,
} from "./observation";

// ── the india layer's WRITE half (WS-SPINE, P1-2) ──────────────────────────
// Same reason as everything above it: api/consolidate.js is a plain-JS
// serverless function under the zero-imports-from-src rule, and it is now the
// caller these three have never had (`never-scheduled`: vy_kin 0 rows,
// vy_ritual 0 rows, because `dead-writers` — nothing anywhere invoked them).
//
// Hand-porting `writeKin` into JS was the alternative, and it is specifically
// the one this file exists to refuse: its upsert carries the citation-union,
// the address-term coalesce and the deliberate omission of `provisional` from
// the update set list, and each of those is a RULE about what a kin row means.
// A second copy of them in api/ is a second definition of a person's family.
export { writeKin, recordRitualOccurrence, writeIndiaProfile, renderKinLines, KIN_BUDGET, type KinRow } from "./india";

// ── the teacher-sheet seam (Gurukul WS-B) ──────────────────────────────────
// api/_teachersheet.js loads a PUBLISHED TeacherSheet row and constructs its
// AgentModule server-side. Exported here for the reason this whole file
// exists: the alternative is a hand-ported constructor in api/, which is a
// SECOND definition of what a teacher clone is — and unlike a mirrored
// deriver, this one would be a second definition of a clone of a real, named,
// living person, published under their consent. It would drift on the first
// edit to either copy, and the drifted half would still return 200.
//
// `validateTeacherSheet` rides along so the loader can re-validate the row it
// actually read rather than trusting that whatever wrote it ran the gate.
// Publish-time validation and load-time validation are the same function, on
// purpose: a sheet that was valid when published and is not valid now (the
// allowlist moved, a field's rule tightened) must fail closed at load, not
// quietly serve the version that predates the rule.
export {
  sheetToModule,
  validateTeacherSheet,
  consentGateBlockers,
  helplineNumbersIn,
  PLACEHOLDER_CONSENT_ARTIFACT_ID,
  type SheetValidation,
  type SheetValidationError,
  type TeacherSheetRowState,
} from "./agents/fromSheet";
export type { TeacherSheet } from "./agents/teacherTypes";

// ── the clone aliveness seam (Gurukul WS-Q) ────────────────────────────────
// A published clone's present moment and its right to speak first. Both cross
// here for this file's standing reason: the server lane is where a clone is
// actually served, and a hand-ported copy in api/ would be a second definition
// of when a clone of a real teacher may message a sixteen-year-old first. The
// drifted half would still return 200.
export {
  cloneNowAt,
  renderCloneNow,
  localParts,
  shapeForDow,
  validateCloneLife,
  cloneLifeRows,
  CLONE_NOW_BUDGET,
  CLONE_NOW_HEADER,
  CLONE_TRANSITION_MIN,
  MAX_TODAY_BEATS as CLONE_MAX_TODAY_BEATS,
  type CloneLifeShape,
  type CloneDaySlot,
  type CloneWeekBeat,
  type CloneNowEntry,
} from "./agents/cloneLife";
export {
  initiativeVerdict,
  renderInitiative,
  INITIATIVE_BUDGET,
  INITIATIVE_HEADER,
  DAYTIME_FROM_MIN,
  DAYTIME_TO_MIN,
  OVERDUE_GRACE_MS,
  STATED_TIME_LEAD_MS,
  STATED_TIME_TRAIL_MS,
  PATTERN_MIN_OBSERVATIONS,
  PATTERN_FRESH_MS,
  type InitiativeRecord,
  type InitiativeVerdict,
  type InitiativeKind,
} from "./agents/initiative";

// ── the ingestion seam (Gurukul WS-F) ──────────────────────────────────────
// `verifyPhraseBank` is the half `fromSheet.ts`'s validator explicitly refused
// to approximate: teacher-sheet-spec.md §4.3's ">=5 occurrences in the
// held-out half", which separates a habitual verbalism from a memorable LINE
// and needs a corpus the sheet does not carry. `api/_teachersheet.js`'s
// publish predicate is where the corpus and the sheet finally meet, and that
// file is plain JS under the zero-imports-from-src rule — so the function
// crosses here rather than being hand-ported, for this file's standing reason:
// a second copy of a rule about what may be RECITED to a minor would drift on
// the first edit and the drifted half would still return 200.
//
// `transcriptStats`/`draftFromSignals` ride along so a future studio endpoint
// drafts with the same code the eval suite gates, rather than with a server
// copy of it.
export {
  transcriptStats,
  verifyPhraseBank,
  splitHeldOut,
  countFragment,
  tokenize,
  HINDI_MARKER_WORDS,
  FILLER_LEXICON,
  PHRASE_BANK_MAX_WORDS,
  PHRASE_BANK_MIN_OCCURRENCES,
  PHRASE_BANK_LINE_CEILING,
  type TranscriptTurn,
  type TranscriptStats,
  type PhraseBankVerification,
  type PhraseBankFinding,
} from "./ingest/transcriptStats";
export {
  draftFromSignals,
  draftFromTranscript,
  FIELD_SOURCE_CLASS,
  type SheetDraftResult,
  type SheetGap,
  type TeacherInput,
} from "./ingest/sheetDraft";
export {
  createStubQualitativePass,
  createQualitativePass,
  QUALITATIVE_PROPOSABLE_FIELDS,
  type QualitativePass,
  type QualitativeResult,
} from "./ingest/qualitativePass";
