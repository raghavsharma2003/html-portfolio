// Bundle entry for corpus-generate.mjs — mirrors evals/.entry.ts and
// src/engine/__fixtures__/.entry.ts's pattern: bundle the REAL source, never
// a frozen copy. WS-CORPUS, swap-test context corpus
// (docs/SWAP-TEST-PREREG.md Amendment 1).
export { compile, hashCore } from "../../src/engine/compiler";
export { STATE_VARIANTS } from "./corpus.seeds";
