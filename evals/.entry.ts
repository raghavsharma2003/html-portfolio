// Bundle entry for the eval suites: everything they probe, from the REAL source.
export {
  parseBubbles,
  stripTextingDashes,
  takeSearchSlot,
  _resetSearchBucket,
  SEARCH_BUCKET,
} from "../src/engine/brain";
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
export {
  raisedRecently,
  renderRaised,
  MIN_TIMES,
  MAX_TERMS,
  RAISED_BUDGET,
  SHORT_REPLY_WORDS,
} from "../src/engine/repeat";
export { asksToHangUp } from "../src/engine/hangup";
export { renderActivity, activityNote, ACTIVITY_BUDGET } from "../src/engine/activity";
export { chessActivity, moveFact, exchangeFact } from "../src/engine/chessTalk";
export { newGame, play, assessLast, assessMove } from "../src/engine/chess";
export { activityOf, activityPickupLine, RECENT_END_MS, lastAssessment } from "../src/state/game";
export { resolveTheme, isThemeChoice, THEMES, THEME_LABEL } from "../src/engine/theme";
export { detectMoments, momentFact } from "../src/engine/milestones";
