// Bundle entry for the LANE-PARITY gate. Everything a compile site touches,
// from the REAL source — no frozen snapshot, rebuilt on every run.
export { compile, OPERATIONAL_CORE_CAP, OPERATIONAL_TAIL_CAP } from "../../src/engine/compiler";
export { formatChatTail, callMemories, formatActivityLedger, withoutServerActivityBlock, ACTIVITY_BLOCK_SENTINEL } from "../../src/engine/memory";
export {
  formatSharedHistory,
  formatActivityLedgerForCall,
  formatJustHappened,
  callGraphBlocks,
  JUST_HAPPENED_BUDGET,
} from "../../src/voice/callHistory";
export { herCommitments } from "../../src/engine/honesty";
export { activityOf } from "../../src/state/game";
export { innerContext } from "../../src/engine/inner";
// WS-HERNOW. T7's string carries her told-ledger AND her present minute, so
// the parity table needs both halves separately — a lane can render T7 and
// still be dark on the present moment, which is the sub-block failure T5
// already taught this gate to look for.
export { formatHerLife } from "../../src/engine/brain";
export { herNowAt, herNowScene, HER_NOW_HEADER } from "../../src/engine/herNow";
