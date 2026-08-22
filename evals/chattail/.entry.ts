// Bundle entry for evals/chattail/run.mjs — T-H3, the chat tail that rides the
// call's ONE assembly.
//
// Self-bootstrapping, in this suite's own directory, for the two reasons
// `evals/honesty/.entry.ts` states: a frozen bundle passes forever while the
// source rots (`gates-that-live-nowhere`), and the shared `evals/.entry.ts` is
// plumbing this workstream does not own. Everything below is the SHIPPING
// export, never a second copy beside it.
export {
  formatChatTail,
  callMemories,
  CHAT_TAIL_ROWS,
  CHAT_TAIL_WINDOW_MS,
  CHAT_TAIL_BUDGET,
  CHAT_TAIL_MAX_WORDS,
  CHAT_TAIL_MAX_WORDS_THEM,
} from "../../src/engine/memory";
export { compile, OPERATIONAL_TAIL_CAP } from "../../src/engine/compiler";
export { lintBlock, lintLine } from "../../src/engine/shapelint";
export {
  buildSystemPromptParts,
  buildSpeechStyle,
  WATCH_MODE_NOTE,
} from "../../src/engine/persona";
