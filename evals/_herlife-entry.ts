// Bundle entry for evals/herlife.mjs — T-H2 (an activity is a fact with an
// expiry), from the REAL source on both sides of the seam: the write-time
// classifier + stamper in state/store.ts, and the render-time expiry in
// engine/brain.ts. Its own entry rather than evals/.entry.ts for the reason
// _gamemem-entry.ts gives — a suite that owns its entry can be added without
// touching a file every other suite depends on.
export {
  classifySelfFact,
  stampSelfFacts,
  type AppState,
  type SelfFact,
  type SelfFactKind,
} from "../src/state/store";
export { formatHerLife, activityStillRunning, ACTIVITY_TTL_MS } from "../src/engine/brain";
export { crossedNight, NIGHT_START_HOUR, NIGHT_END_HOUR } from "../src/engine/away";
