// WS-COST measurement entry — bundles the REAL compiler + the REAL clock-varying
// renderers so prefix-stability is measured on what production assembles.
export { compile, hashCore, OPERATIONAL_CORE_CAP, OPERATIONAL_TAIL_CAP, SYSTEM_MAX } from "../src/engine/compiler";
export { formatHerLife, toTurns } from "../src/engine/brain";
export { deriveHerNow, formatHerNow, herNowAt } from "../src/engine/herNow";
export { BUDGET_FIXTURES } from "../src/engine/__fixtures__/budget.fixtures";
export { buildSystemPromptParts } from "../src/engine/persona";
