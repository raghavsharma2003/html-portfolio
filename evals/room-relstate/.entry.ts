// Bundle entry for evals/room-relstate/run.mjs — WS-R154, "RelationOS in the
// Room". Self-bootstrapping in this suite's own directory, `evals/rupture-
// channel/.entry.ts`'s own reasoning restated: a frozen bundle passes
// forever while the source rots (`gates-that-live-nowhere`), and the shared
// evals/.entry.ts is plumbing this workstream does not own. Every export
// below is the SHIPPING symbol, never a second copy beside it — the whole
// point is to compile the REAL compiler over the REAL relstate projection.
export { compile } from "../../src/engine/compiler";
export { initialRelState, stageForDims, ruptureStance } from "../../src/engine/relstate";
