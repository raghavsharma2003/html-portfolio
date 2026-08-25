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
