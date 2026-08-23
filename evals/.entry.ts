// Bundle entry for the eval suites: everything they probe, from the REAL source.
export {
  parseBubbles,
  stripTextingDashes,
  takeSearchSlot,
  _resetSearchBucket,
  SEARCH_BUCKET,
  takeExplicitSearchSlot,
  _resetExplicitSearchBucket,
  EXPLICIT_SEARCH_BUCKET,
  RE_EXPLICIT_SEARCH,
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
  burstDecide,
  likelyMore,
  unansweredTail,
  BURST_DEFAULT_MS,
  BURST_MIN_MS,
  BURST_MAX_MS,
  BURST_CONT_MAX_MS,
  BURST_INTERJECT_MS,
  BURST_SAMPLE_CEILING_MS,
  CONTINUATION_WEAK_MS,
  CONTINUATION_STRONG_MS,
  COMPOSE_ACTIVE_MS,
  COMPOSE_ABANDON_MS,
} from "../src/engine/burst";
export {
  leadingGreeting,
  isGreetingOnly,
  sittingStartAt,
  sheGreetedThisSitting,
  greetOnce,
  SITTING_GAP_MS,
} from "../src/engine/greeting";
export { toTurns } from "../src/engine/brain";
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
export { mergeStates, mergeGame } from "../src/state/merge";
export {
  detectGameInvite,
  playAskIn,
  gameTermIn,
  hasPlayIntent,
  isAffirmation,
  isRefusal,
  INVITE_FRESH_MS,
} from "../src/engine/gameInvite";
