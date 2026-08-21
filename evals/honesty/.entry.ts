// Bundle entry for evals/honesty/*.mjs. Same self-bootstrap pattern as
// src/engine/agents/.eval-entry.ts and src/engine/__fixtures__/.entry.ts:
// bundle the REAL source on every run, never a frozen copy, and keep the
// entry inside this workstream's own directory rather than reusing
// evals/.entry.ts (shared eval plumbing WS-HONESTY does not own).
//
// The honesty predicates are exported from here rather than reimplemented in
// a .mjs beside the suite. There WAS a second copy — evals/honesty/detect.mjs
// — and it was deleted when the gate moved onto the output path, because
// `age-tier-never-realtime` is this repo's law about exactly that: a second
// implementation loses the rules added after the fork, silently, and is
// discoverable only by diffing two things nobody thinks of as the same thing.
// The suite now tests the shipping bytes.
export { getAgent, listAgents, DEFAULT_AGENT } from "../../src/engine/agents/registry";
export {
  findActionable,
  allowedFrom,
  emptyAllowed,
  findOutOfBandReceipts,
  findUnsupportedReceipts,
  findFalseAttributions,
  hisVocabulary,
  findSharedPastFabrications,
  sharedVocabulary,
  openCommitments,
  guardReply,
  createStreamGuard,
  inspect,
  PUBLISHED_HELPLINES,
} from "../../src/engine/honesty";
export { parseBubbles } from "../../src/engine/brain";
