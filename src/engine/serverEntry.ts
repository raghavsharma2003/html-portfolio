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
