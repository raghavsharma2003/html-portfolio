// Bundle entry for evals/honesty/run.mjs. Same self-bootstrap pattern as
// src/engine/agents/.eval-entry.ts and src/engine/__fixtures__/.entry.ts:
// bundle the REAL source on every run, never a frozen copy, and keep the
// entry inside this workstream's own directory rather than reusing
// evals/.entry.ts (shared eval plumbing WS-HONESTY does not own).
export { getAgent, listAgents, DEFAULT_AGENT } from "../../src/engine/agents/registry";
