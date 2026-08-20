// Bundle entry for evals/self/wiring.mjs (T-H1, `selfbundle-never-set`).
//
// Everything below is the REAL shipping source, bundled with esbuild on every
// run — the same recipe evals/continuity/_entry.ts uses, and for the same
// reason: a suite that passes must be a statement about the tree being
// shipped, not about a frozen copy.
//
// `think` is the load-bearing export. This suite's whole claim is that a real
// prompt contains the self layer's bytes, and `think()` is the only function
// in the repo that assembles a chat or cascade-call prompt AND hands it to a
// model — so driving it (with the model call intercepted) is the difference
// between measuring the prompt that ships and measuring one the suite built
// itself. The realtime lane's assembly lives inside a React hook and cannot be
// invoked headless; `compile` is exported so that lane can be measured on the
// identical input object, and the suite says plainly that this is what it is.
export { think } from "../../src/engine/brain";
export { compile, TAIL_ORDER, TAIL_MANIFEST } from "../../src/engine/compiler";
export {
  recallForCall,
  recallMemories,
  takeRelBundle,
  takeSelfBundle,
  callSelfBundle,
} from "../../src/engine/memory";
export { innerContext } from "../../src/engine/inner";
export { gatesFor, getAgeTier } from "../../src/engine/clock";
export { TEXTURE_N_TURNS_FLOOR } from "../../src/engine/texture";
export { MAX_UNTOLD_BEATS, UNTOLD_SQL } from "../../src/engine/life";
