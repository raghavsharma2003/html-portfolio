// Bundle entry for the eval suites: everything they probe, from the REAL source.
export { parseBubbles, stripTextingDashes } from "../src/engine/brain";
export {
  buildSystemPromptParts,
  buildSpeechStyle,
  SEARCH_DECISION,
  FORGET_DECISION,
} from "../src/engine/persona";
export {
  burstWaitMs,
  recentUserGaps,
  BURST_DEFAULT_MS,
  BURST_MIN_MS,
  BURST_MAX_MS,
} from "../src/engine/burst";
export {
  renderAway,
  humanGap,
  partOfDay,
  crossedNight,
  AWAY_MIN_MS,
  AWAY_BUDGET,
} from "../src/engine/away";
