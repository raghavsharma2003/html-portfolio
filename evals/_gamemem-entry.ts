// Bundle entry for evals/gamemem.mjs — the MEMORY cluster's client half,
// from the REAL source. Its own entry rather than evals/.entry.ts because a
// suite that owns its entry can be added without touching a file every other
// suite depends on (and `parsetest.v2`'s lesson applies either way: the bundle
// is rebuilt from source on every run, never cached).
export {
  activityEpisodeSummary,
  episodeDateLabel,
  MOMENT_ROW_RE,
  EPISODE_SUMMARY_MAX,
  type FinishedActivity,
} from "../src/engine/memory";
export { activityOf, RECENT_END_MS } from "../src/state/game";
export { LABEL } from "../src/engine/activity";
export { compile } from "../src/engine/compiler";
export { renderSelfArc } from "../src/engine/selfarc";
