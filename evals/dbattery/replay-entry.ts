// Bundle entry for scripts/replay.mjs — everything it needs from the REAL
// compiler, bundled the same way evals/.entry.ts bundles persona.ts (WS-EVAL
// pattern: rebuild from source on every run, no frozen copy — see that
// file's comment on why). WS-BATTERY, exclusive to evals/dbattery/*.
export { compile, hashCore, coresByteIdentical } from "../../src/engine/compiler";
export { replaySnapshot, initialRelState } from "../../src/engine/relstate";
