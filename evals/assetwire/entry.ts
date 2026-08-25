// The executable slice of WS-ASSETWIRE's gate.
//
// Everything reachable from here is REAL SOURCE — `src/components/anim.tsx`,
// the real `BigEmoji`, the real `docExt` — bundled fresh by `run.mjs` on every
// run, same discipline as `evals/.entry.ts`. Nothing in this file re-states a
// rule; it only makes the modules reachable from a node process.
//
// `react`, `react/jsx-runtime` and `react-dom/server` stay EXTERNAL at bundle
// time. esbuild's CJS-in-ESM shim cannot load react-dom's server build (it
// does a dynamic `require("util")`), and inlining a second copy of react would
// mean the components under test and the renderer holding them were two
// different reacts. External means both halves come from the repo's own
// node_modules, which is also what the app ships.
export { renderToStaticMarkup } from "react-dom/server";
export { createElement } from "react";
export {
  AnimGlyph,
  ReactionGlyph,
  REACTION_ART,
  animMotion,
  animStill,
  hasMotion,
} from "../../src/components/anim";
export { default as BigEmoji, bigEmojiSource } from "../../src/components/BigEmoji";
export { docExt, docSize } from "../../src/components/attachments";
