// Bundle entry for the felt-memory battery. Everything a real compile site
// touches, from the REAL source, re-bundled on every run — never a frozen
// snapshot. Same rule (and the same reason) as evals/.entry.ts and
// evals/lanes/.entry.ts: context/rejected.md `gates-that-live-nowhere` is
// what a frozen bundle buys you.
export { compile, OPERATIONAL_CORE_CAP, OPERATIONAL_TAIL_CAP } from "../../src/engine/compiler";
export { formatChatTail, callMemories, formatActivityLedger } from "../../src/engine/memory";
export { formatSharedHistory, formatActivityLedgerForCall, callGraphBlocks } from "../../src/voice/callHistory";
export { herCommitments } from "../../src/engine/honesty";
export { activityOf } from "../../src/state/game";
export { innerContext } from "../../src/engine/inner";
