// Bundle entry for WS-SHARENOW: everything the share-flow eval probes, from the
// REAL source. Nothing is re-implemented here — `parsetest.v2` taught this repo
// that a frozen copy passes forever while the source rots.
export {
  formatJustHappened,
  minsAgoLabel,
  callGraphBlocks,
  publishShareLedger,
  shareLedger,
  formatSharedHistory,
  formatActivityLedgerForCall,
  JUST_HAPPENED_BUDGET,
  JUST_HAPPENED_ROWS,
  JUST_HAPPENED_MAX_CHARS,
  JUST_HAPPENED_WINDOW_MS,
  SHARED_HISTORY_BUDGET,
  SHARED_HISTORY_CALL_ROWS,
  CALL_ACTIVITY_BUDGET,
} from "../../src/voice/callHistory";
export {
  withShareRecord,
  SHARE_LEDGER_MAX,
  SHARE_SAID_MAX,
  SHARE_SAID_MAX_CHARS,
} from "../../src/state/store";
export { formatChatTail, callMemories, CHAT_TAIL_WINDOW_MS } from "../../src/engine/memory";
export { compile, OPERATIONAL_TAIL_CAP } from "../../src/engine/compiler";
export { lintBlock } from "../../src/engine/shapelint";
export { buildSystemPromptParts, WATCH_MODE_NOTE } from "../../src/engine/persona";
