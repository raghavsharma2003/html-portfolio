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
  // WS-RESILIENCE: the connectivity-line draw and both pools, so
  // evals/resilience/run.mjs gates the no-repeat rule against the REAL
  // variants rather than a copy of them.
  drawNoRepeat,
  OOPS_CALL,
  OOPS_CHAT,
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
  handedOver,
  followUpRate,
  draftPauseMs,
  unansweredTail,
  BURST_MIN_MS,
  BURST_MAX_MS,
  BURST_GRACE_FLOOR_MS,
  BURST_HANDOFF_MS,
  BURST_CONT_MAX_MS,
  BURST_INTERJECT_MS,
  BURST_SAMPLE_CEILING_MS,
  BURST_MULTIPLIER,
  FOLLOWUP_PRIOR,
  FOLLOWUP_HALFLIFE,
  CONTINUATION_WEAK_MS,
  CONTINUATION_STRONG_MS,
  COMPOSE_ACTIVE_MS,
  COMPOSE_ABANDON_MS,
  COMPOSE_PAUSE_MIN_MS,
  COMPOSE_PAUSE_PER_CHAR_MS,
  FOCUS_HOLD_MS,
  SETTLE_MS,
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
  // WS-GAMEFEEL: the her-side loop fence, a different repetition from the one
  // above (a repeated LINE, not a repeated topic) living in the same file.
  isLoopingLine,
  loopWords,
  jaccard,
  LOOP_JACCARD,
  LOOP_LOOKBACK,
  LOOP_MIN_WORDS,
  LOOP_MAX_RETRIES,
  LOOP_NUDGE,
} from "../src/engine/repeat";
export { asksToHangUp } from "../src/engine/hangup";
export { renderActivity, activityNote, ACTIVITY_BUDGET, ACTIVITY_BLOCK_MAX, STATE_LAW } from "../src/engine/activity";
export { chessActivity, moveFact, exchangeFact, chessMoveNote, chessGameState, chessIdea, chessPlanClause } from "../src/engine/chessTalk";
export { newGame, play, assessLast, assessMove, chooseMove, userPlay, inGameLevel, nextSkill, observedLevel, outplaying, startingLevel, ADAPT } from "../src/engine/chess";
export { activityOf, activityPickupLine, RECENT_END_MS, lastAssessment } from "../src/state/game";
export { resolveTheme, isThemeChoice, THEMES, THEME_LABEL } from "../src/engine/theme";
export {
  detectMoments,
  momentFact,
  momentRecord,
  dyadRecord,
  recordCounts,
  milestoneRecordKind,
  MILESTONE_RECORD_KIND,
  DYAD_RECORD_KIND,
} from "../src/engine/milestones";
export { mergeStates, mergeGame, MERGE_MESSAGE_CAP } from "../src/state/merge";
export { syncableState, SYNC_MESSAGE_CAP } from "../src/engine/account";
export { formatActivityLedger, episodeDateLabel, withActivityRecord } from "../src/engine/memory";
export { formatActivityLedgerForCall } from "../src/voice/callHistory";
export {
  detectGameInvite,
  playAskIn,
  gameTermIn,
  hasPlayIntent,
  isAffirmation,
  isRefusal,
  INVITE_FRESH_MS,
} from "../src/engine/gameInvite";
// WS-SHECALLS. "call me", read off the thread — the predicate that makes her
// ring him instead of claiming she cannot. See evals/call-invite.mjs.
export {
  detectCallInvite,
  callAskIn,
  herCallOfferIn,
  isCallAffirmation,
  isCallRefusal,
  isReportedCall,
  isDeferred,
  isBareCapabilityQuestion,
  ringAt,
  CALL_INVITE_FRESH_MS,
  RING_MIN_MS,
  RING_MAX_MS,
} from "../src/engine/callInvite";
// WS-KNOWS. The "what she remembers" surface derives every row it shows from
// pure functions of state, in src/state/knows.ts, precisely so the surface is
// testable offline — see evals/knows.mjs.
export {
  timelineFrom,
  factsFrom,
  herSideFrom,
  knowsIsEmpty,
  dayLabel,
  monthLabel,
  ritualLabel,
  CORRECT_OPENER,
  KNOWS_MONTHS_MAX,
  KNOWS_MONTH_MAX,
  KNOWS_HER_MAX,
  FORGET_TERM_MIN,
  FORGET_TERM_MAX,
} from "../src/state/knows";

// WS-HERNOW. Her present moment as a ledger with one row (src/engine/herNow.ts)
// and the story-pool table it is derived from, so evals/hernow.mjs can assert
// the mapping is TOTAL against the real pool rather than against a copy.
export {
  SPAN_TABLE,
  STORY_ACTIVITY,
  SLOT_FALLBACK,
  SUCCESSOR,
  HER_NOW_HEADER,
  HER_NOW_WORST_CASE_CHARS,
  spanFor,
  deriveHerNow,
  herNowAt,
  herNowScene,
  formatHerNow,
  elapsedLabel,
} from "../src/engine/herNow";
export { STORY_POOL, slotForStory, slotStartedAt, pickFor } from "../src/engine/storyCatalog";
export { formatHerLife } from "../src/engine/brain";
export { mergeHerNow } from "../src/state/merge";
export { lintLine } from "../src/engine/shapelint";

// WS-K (ROADMAP-100X item 1). The disclosure-reciprocity ledger, plus the
// compiler surface evals/reciprocity.mjs needs to prove the T17 slot is really
// wired (manifest row, drop priority, tail order) rather than merely written.
export {
  classifyDisclosure,
  reciprocityState,
  reciprocityLean,
  reciprocityNote,
  renderReciprocity,
  initialReciprocityState,
  RECIPROCITY_WINDOW,
  RECIPROCITY_DECAY,
  RECIPROCITY_THRESHOLD,
  RECIPROCITY_MIN_TURNS,
  RECIPROCITY_MIN_EVIDENCE,
  RECIPROCITY_BUDGET,
  DISCLOSURE_WEIGHT,
} from "../src/engine/reciprocity";
export {
  compile,
  TAIL_MANIFEST,
  TAIL_ORDER,
  CORE_MANIFEST,
  applyDropOrder,
  assertManifestArithmetic,
  computeManifestArithmetic,
  hashManifest,
  TAIL_CAP,
  CORE_CAP,
  SYSTEM_MAX,
  OPERATIONAL_TAIL_CAP,
} from "../src/engine/compiler";

// WS-K (ROADMAP-100X item 2). The injected persona module, so evals/drift.mjs
// can compile a REAL session and — for its negative controls — a deliberately
// broken copy of the same module.
export { DEFAULT_AGENT, getAgent, listAgents } from "../src/engine/agents/registry";

// WS-Q. The clone aliveness seam, so evals/clonelife/run.mjs and evals/drift.mjs
// can drive the REAL modules rather than a copy: the clone's present, the
// speak-first predicate, the sheet that fills them, and the constructor that
// turns that sheet into an AgentModule a real compile can take.
export {
  cloneNowAt,
  renderCloneNow,
  localParts,
  shapeForDow,
  validateCloneLife,
  cloneLifeRows,
  CLONE_NOW_BUDGET,
  CLONE_NOW_HEADER,
  CLONE_TRANSITION_MIN,
  MINUTES_IN_DAY,
} from "../src/engine/agents/cloneLife";
export {
  initiativeVerdict,
  renderInitiative,
  INITIATIVE_BUDGET,
  INITIATIVE_HEADER,
  DAYTIME_FROM_MIN,
  DAYTIME_TO_MIN,
  OVERDUE_GRACE_MS,
  STATED_TIME_LEAD_MS,
  STATED_TIME_TRAIL_MS,
  PATTERN_MIN_OBSERVATIONS,
  PATTERN_FRESH_MS,
} from "../src/engine/agents/initiative";
export { DEMO_TEACHER } from "../src/engine/agents/characters/demoTeacher";
export { sheetToModule, validateTeacherSheet } from "../src/engine/agents/fromSheet";
// `lintLine` is already exported above (evals/reciprocity.mjs's surface) — one
// export, two readers, rather than a second name for the same function.
export { moodWordsIn } from "../src/engine/timeline";
