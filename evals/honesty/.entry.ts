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
  // 2026-08-22 audit batch: family 5 (the channel-promise gate), the HER-side
  // commitment ledger, family 4's own claim floor, and the written-down
  // boundary. Exported HERE for the same reason the rest of this file exists:
  // the suite drives the SHIPPING bytes, never a second copy beside them.
  findChannelPromises,
  herCommitments,
  HER_COMMITMENT_CAP,
  HER_COMMITMENT_TTL_MS,
  SHARED_MIN_CLAIM_TERMS,
  NOT_GATED_BY_DESIGN,
  // 2026-08-23 tester report: family 6 — invented specifics of an activity
  // they REALLY did (a move, an opening, a card, a score). Same rule as
  // everything above it: the suite drives the shipping predicate.
  findActivitySpecifics,
  activityVocabulary,
  ACTIVITY_SUPPORT_SHARE,
} from "../../src/engine/honesty";
// The RECORD family 6 checks against, from the real adapters and the real
// episode writer — so §15's support sets are the bytes a finished game
// actually produces, never a hand-written approximation of them. A gate tested
// against a fixture of its own input is a gate tested against nothing.
export { chessRecord } from "../../src/engine/chessTalk";
export { wyrRecord } from "../../src/engine/wyrTalk";
export { tttRecord } from "../../src/engine/tttTalk";
export { activityEpisodeSummary, formatActivityLedger } from "../../src/engine/memory";
export { LABEL } from "../../src/engine/activity";
export { newGame, play } from "../../src/engine/chess";
export { freshSession, answerCurrent, advance } from "../../src/engine/wyr/session";
// T16's renderer, so §10 can assert the compiler slot it feeds — a ledger
// nothing renders is `dead-writers` with extra steps.
export { renderHerCommitments, HER_COMMITMENTS_BUDGET, TAIL_ORDER, TAIL_MANIFEST } from "../../src/engine/compiler";
// the `recited-prompt` law, mechanised — every rendered commitment row goes
// through it, so "telegraphic, never sentence-shaped" is a check and not a
// promise in a comment.
export { lintLine } from "../../src/engine/shapelint";
export { parseBubbles } from "../../src/engine/brain";
