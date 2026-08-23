// Bundle entry for the OVERLAP-MATRIX gate (WS-LIFECYCLE).
//
// Everything the matrix's cells claim, from the REAL source — no frozen
// snapshot, rebuilt on every run, the same rule `evals/run.mjs` and
// `evals/lanes/run.mjs` are under. A gate that bundles once and caches is a
// gate that passes forever while the tree rots (`parsetest.v2`).
export {
  LIFECYCLE_MATRIX,
  LIFECYCLE_EVENTS,
  LIFECYCLE_CONTEXTS,
  LIFECYCLE_NOTE_OWNER,
  LIFECYCLE_FACT_MAX_CHARS,
  lifecycleCell,
  boardClosedFact,
  boardOverFact,
  boardOpenedFact,
  boardTurnFact,
  shareEndedFact,
  lifecycleStateNote,
  formatJustHappened,
  formatActivityLedgerForCall,
} from "../../src/voice/callHistory";

// The wrapper every `direct` note this workstream sends rides through. One
// note vocabulary on this lane — asserted, not assumed.
export { activityNote, renderActivity } from "../../src/engine/activity";

// The pickup directive and the share-start note: two `direct` cells this
// workstream declares but does NOT own the text of.
export { CALL_OPEN_DIRECTIVE, WATCH_START_DIRECTIVE } from "../../src/engine/persona";

// The single derivation both lanes read for "what is going on".
export { activityOf, activityPickupLine, RECENT_END_MS } from "../../src/state/game";

// The one present-moment read. The matrix's `state` cells are claims about
// this: a board survives a call and stays the app truth afterwards.
export { herNowAt, herNowScene } from "../../src/engine/herNow";

// The real compiler, for the `assembly` cells — an assertion that a block
// "is carried by the next compile" has to be made against the compile.
export { compile } from "../../src/engine/compiler";

// The shape rules the facts are held to.
export { lintLine } from "../../src/engine/shapelint";

// Board fixtures, from the shipping engines rather than hand-rolled objects.
export { newGame as newChessGame, play as playChess } from "../../src/engine/chess";
export { newTttGame, playTtt } from "../../src/engine/ttt";
