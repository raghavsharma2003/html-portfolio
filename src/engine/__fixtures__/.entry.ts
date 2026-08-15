// Bundle entry for the byte-identity harness — mirrors evals/.entry.ts's
// pattern (bundle the REAL source, never a frozen copy of the two sides
// under test).
export { compile, hashCore } from "../compiler";
export { compileOld } from "./oldOracle";
export { FIXTURES } from "./compiler.fixtures";
export { checkCoreByteStable } from "../shapelint";
