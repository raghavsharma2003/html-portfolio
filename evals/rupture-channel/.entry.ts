// Bundle entry for evals/rupture-channel/run.mjs — WS-EMOTION, "a rupture that
// survives a channel change".
//
// Self-bootstrapping in this suite's own directory, for the two reasons
// evals/chattail/.entry.ts states: a frozen bundle passes forever while the
// source rots (`gates-that-live-nowhere`), and the shared evals/.entry.ts is
// plumbing this workstream does not own. Every export below is the SHIPPING
// symbol, never a second copy beside it — the whole point is to compile the
// REAL compiler over the REAL relstate projection.
export { compile } from "../../src/engine/compiler";
export {
  initialRelState,
  ruptureStance,
  renderRelSnapshot,
  stageForDims,
  RUPTURE_STANCE_LAPSE_DAYS,
  RUPTURE_STANCE_LAPSE_WARM_EPISODES,
} from "../../src/engine/relstate";
export { innerContext, GAP_ENTRY_MS } from "../../src/engine/inner";
