// Bundle entry for the WS-CONTINUITY suites (docs/SPEC-CONTINUITY.md).
// Everything below is the REAL shipping source — the suites bundle this file
// with esbuild on every run, same recipe as evals/multimodal/scene-gate.mjs,
// so a suite that passes is a statement about the tree being shipped rather
// than about a frozen copy.
export { compile, TAIL_ORDER, TAIL_MANIFEST } from "../../src/engine/compiler";
export type { CompileInput } from "../../src/engine/compiler";
export { innerContext, GAP_ENTRY_MS } from "../../src/engine/inner";
export { momentGate } from "../../src/engine/moment";
export { toTurns } from "../../src/engine/brain";
