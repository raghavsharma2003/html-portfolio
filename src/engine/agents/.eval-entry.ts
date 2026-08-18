// Bundle entry for evals/persona-invariants.mjs's RUNNER — mirrors
// src/engine/__fixtures__/.entry.ts's pattern (bundle the REAL source on
// every run, never a frozen copy: "parsetest.v2 taught this the hard way").
// Lives inside agents/ (WS-AGENT-PERSONA's exclusive directory) rather than
// reusing evals/.entry.ts, which is shared eval-suite plumbing this
// workstream does not own (docs/SPEC-AGENT-LAYER.md §8 file ownership).
export { getAgent, listAgents, DEFAULT_AGENT, MEERA_AGENT_ID } from "./registry";
