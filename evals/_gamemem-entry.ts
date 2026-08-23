// Bundle entry for evals/gamemem.mjs — the MEMORY cluster's client half,
// from the REAL source. Its own entry rather than evals/.entry.ts because a
// suite that owns its entry can be added without touching a file every other
// suite depends on (and `parsetest.v2`'s lesson applies either way: the bundle
// is rebuilt from source on every run, never cached).
export {
  activityEpisodeSummary,
  episodeDateLabel,
  MOMENT_ROW_RE,
  EPISODE_SUMMARY_MAX,
  type FinishedActivity,
  // 2026-08-23: the LOCAL half of the record — the ledger that needs no
  // network, no embedding and no consolidation, and the block she reads it
  // from. §7 drives these over a real game.
  formatActivityLedger,
  withActivityRecord,
  logFinishedActivity,
  ACTIVITY_LEDGER_MAX,
  ACTIVITY_LEDGER_ROWS,
  ACTIVITY_BLOCK_SENTINEL,
  withoutServerActivityBlock,
  type ActivityRecord,
} from "../src/engine/memory";
export { activityOf, RECENT_END_MS } from "../src/state/game";
export { settleOccupant, emitClosedActivity } from "../src/components/activityClose";
export { LABEL } from "../src/engine/activity";
export { compile } from "../src/engine/compiler";
export { renderSelfArc } from "../src/engine/selfarc";
// The real adapters and the real rules module, so §7's records are the bytes a
// finished game actually produces rather than a hand-written stand-in.
export { chessRecord } from "../src/engine/chessTalk";
export { wyrRecord } from "../src/engine/wyrTalk";
export { tttRecord } from "../src/engine/tttTalk";
export { newGame, play } from "../src/engine/chess";
export { freshSession, answerCurrent, advance } from "../src/engine/wyr/session";
export { findActivitySpecifics, activityVocabulary, guardReply } from "../src/engine/honesty";
export { mergeStates } from "../src/state/merge";
