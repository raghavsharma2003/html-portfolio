// Bundle entry for the WS-CALLMEM suite: everything it probes, from the REAL
// source. Nothing is re-implemented here — `parsetest.v2` taught this repo
// that a frozen copy passes forever while the source rots.
export {
  formatSharedHistory,
  withSharedHistory,
  formatRunningNote,
  agoLabel,
  SHARED_HISTORY_BUDGET,
  SHARED_HISTORY_ROWS,
  SHARED_HISTORY_CALL_ROWS,
  SHARED_HISTORY_MAX_AGE_MS,
  SHARED_HISTORY_MAX_WORDS_THEM,
  SHARED_HISTORY_MAX_CHARS,
  RUNNING_NOTE_TURNS,
  RUNNING_NOTE_HEAD_TURNS,
  RUNNING_NOTE_FRESH_TAIL,
  RUNNING_NOTE_MIN_TURNS,
  RUNNING_NOTE_BUDGET,
  readsAsMemoryCue,
  formatMemoryNote,
  MEMORY_NOTE_BUDGET,
  MEMORY_NOTE_ROWS,
  withRecallAge,
  preCallUserText,
  callRecentTurns,
  RECALL_CACHE_MAX_AGE_MS,
  RECALL_AGE_NOTE_MAX,
  formatActivityLedgerForCall,
  callGraphBlocks,
  CALL_ACTIVITY_BUDGET,
  CALL_ACTIVITY_ROWS,
  CALL_ACTIVITY_MAX_CHARS,
} from "../../src/voice/callHistory";
export { readsAsFarewell, FAREWELL_MAX_WORDS, FAREWELL_MAX_CHARS } from "../../src/voice/farewell";
export {
  callLookup,
  shouldLookUp,
  readsAsCheckPromise,
  checkPromiseNote,
  resetLookupWindow,
} from "../../src/voice/liveLookup";
export { asksToHangUp } from "../../src/engine/hangup";
export { herCommitments } from "../../src/engine/honesty";
export {
  formatChatTail,
  callMemories,
  formatActivityLedger,
  withActivityRecord,
  withoutServerActivityBlock,
  ACTIVITY_BLOCK_SENTINEL,
  EPISODE_SUMMARY_MAX,
  activityEpisodeSummary,
  CHAT_TAIL_BUDGET,
  CHAT_TAIL_MAX_WORDS,
  CHAT_TAIL_WINDOW_MS,
} from "../../src/engine/memory";
export { compile, OPERATIONAL_TAIL_CAP, HER_COMMITMENTS_BUDGET } from "../../src/engine/compiler";
export { AWAY_BUDGET } from "../../src/engine/away";
export { RAISED_BUDGET, raisedRecently, renderRaised } from "../../src/engine/repeat";
// P1-7's reclaim, negative-tested against the REAL rule rather than asserted:
// innerContext returns thread:"" on surface "watch" BY CONSTRUCTION, which is
// what scripts/check-prompt-budget.mjs's WATCH_NO_THREAD gives back.
export { innerContext } from "../../src/engine/inner";

export { lintBlock } from "../../src/engine/shapelint";
export { buildSystemPromptParts, buildSpeechStyle, WATCH_MODE_NOTE } from "../../src/engine/persona";
