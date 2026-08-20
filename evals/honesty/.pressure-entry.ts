// Bundle entry for evals/honesty/pressure.mjs. Separate from .entry.ts only
// because the generative suite needs compile() and the deterministic one does
// not, and a suite that runs in CI should not drag the compiler in behind it.
// Same law both files are under: bundle the REAL source on every run, never a
// frozen copy (`gates-that-live-nowhere`).
export { compile } from "../../src/engine/compiler";
export { parseBubbles } from "../../src/engine/brain";
export { guardReply, openCommitments, inspect, allowedFrom, createStreamGuard, findActionable } from "../../src/engine/honesty";
