// Bundle entry for evals/consolidation/run.mjs (WS-SPINE).
//
// The REAL shipping source, re-bundled by esbuild on every run — same recipe
// evals/self/_wiring-entry.ts and evals/continuity/_entry.ts use, and for the
// same stated reason: a suite that passes must be a statement about the tree
// being shipped, not about a frozen copy. Notably this must NOT import
// api/_engine.gen.js, which is exactly the frozen copy the CLAUDE.md warning
// about `parsetest.bundle.mjs` is about.
export {
  deriveTexture,
  deriveDrift,
  textureCounts,
  renderTexture,
  readTexture,
  upsertTexture,
  bandTeasing,
  bandHumour,
  bandProfanity,
  DRIFT_MIN_PER_HALF,
  TEXTURE_SCAN_SQL,
  TEXTURE_N_TURNS_FLOOR,
} from "../../src/engine/texture";
export { deriveSelfArc, MIN_SPAN_DAYS } from "../../src/engine/selfarc";
export {
  renderIndiaDynamic,
  renderKinLines,
  writeKin,
  recordRitualOccurrence,
  KIN_BUDGET,
} from "../../src/engine/india";
export { untoldFor, markTold, UNTOLD_SQL } from "../../src/engine/life";
