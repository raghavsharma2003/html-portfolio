// Bundle entry for the LANE-PARITY gate. Everything a compile site touches,
// from the REAL source — no frozen snapshot, rebuilt on every run.
export { compile, OPERATIONAL_CORE_CAP, OPERATIONAL_TAIL_CAP } from "../../src/engine/compiler";
export { formatChatTail, callMemories, formatActivityLedger, withoutServerActivityBlock } from "../../src/engine/memory";
export { formatSharedHistory, formatActivityLedgerForCall, callGraphBlocks } from "../../src/voice/callHistory";
export { herCommitments } from "../../src/engine/honesty";
export { activityOf } from "../../src/state/game";
export { innerContext } from "../../src/engine/inner";
