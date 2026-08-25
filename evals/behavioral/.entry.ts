// Bundle entry for evals/behavioral/run.mjs.
//
// Same law as evals/honesty/.pressure-entry.ts and evals/relational/.entry.ts:
// bundle the REAL source on every run, never a frozen copy
// (`gates-that-live-nowhere`). The behavioural battery is only worth its cash
// if the prompt it attacks is the prompt that ships today.
export { compile } from "../../src/engine/compiler";
export { parseBubbles } from "../../src/engine/brain";
// the game-truth machinery, reached the same way evals/chesstalk.mjs reaches
// it — through the module's own public surface, plus the two files that turn a
// board into the block she actually holds.
export { newGame, play, assessLast, openingName } from "../../src/engine/chess/index";
export { chessActivity, chessGameState, chessIdea } from "../../src/engine/chessTalk";
// THE SINGLE DERIVATION, reached the way both production lanes reach it. Not
// `chessActivity` directly: `activityOf` is where a session that was ended by
// hand gets its facts rewritten and `over` set, and a battery that skipped it
// would be attacking a block the app never renders.
export { activityOf } from "../../src/state/game";
export { renderActivity, activityNote, STATE_LAW, ACTIVITY_BLOCK_MAX } from "../../src/engine/activity";
