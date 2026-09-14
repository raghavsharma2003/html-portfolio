// The mock boundary for the recall benchmark: a Node module-resolution hook
// that redirects EXACTLY three of api/memory.js's imports and nothing else.
//
// WHY A LOADER AND NOT A BUNDLE. evals/teachersheet.mjs's idiom is to write a
// temp entry and bundle the real TypeScript with the esbuild CLI, and that is
// the right tool when the thing under test is a pure module graph. It is the
// wrong tool here for one specific reason: esbuild's `--alias:` does not apply
// to RELATIVE specifiers, and `api/memory.js`'s database import is
// `import { q } from "./_db.js"`. Aliasing it from the CLI is not expressible,
// and the alternative — copying api/memory.js somewhere and rewriting the
// import — would be testing a copy, which is the exact failure
// `gates-that-live-nowhere` names. So the mock is placed at the module
// boundary itself, where the real file's own import statement resolves.
//
// WHAT IS REDIRECTED, and each one is a deliberate, stated choice:
//
//   ./_db.js         → stubs/db.mjs        the fixture-backed query router.
//                                          This is the whole point of the
//                                          harness: the REAL opRecall runs,
//                                          against fixture rows.
//   ./_embed.js      → stubs/embed.mjs     `embedOne` returns null, which is
//                                          the documented degrade path
//                                          ("an embedding is an enhancement,
//                                          never the only path to a memory").
//                                          The SEMANTIC LEG IS THEREFORE NOT
//                                          EXERCISED BY THIS SUITE and the
//                                          run header says so out loud.
//   ./_ratelimit.js  → stubs/ratelimit.mjs so a fifty-question sweep is not
//                                          throttled by a per-minute counter
//                                          that has nothing to do with recall.
//
// EVERYTHING ELSE IS THE REAL FILE — api/memory.js itself, api/episodes.js,
// api/_agentscope.js, api/_engine.gen.js. In particular the ranking, the RRF
// fusion, the co-citation seeding, the dedup, the block assembly, the stale
// note and the T5 budget drop are all the shipping code.
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = (name) => pathToFileURL(join(HERE, "stubs", name)).href;

const REDIRECT = new Map([
  ["_db.js", STUB("db.mjs")],
  ["_embed.js", STUB("embed.mjs")],
  ["_ratelimit.js", STUB("ratelimit.mjs")],
]);

export async function resolve(specifier, context, nextResolve) {
  // Match on the BASENAME of a relative specifier only. A bare-package
  // specifier that happened to end in the same characters must never be
  // caught by this — the redirect set is three files inside api/, not three
  // strings anywhere in the module graph.
  if (specifier.startsWith(".")) {
    const base = specifier.split("/").pop();
    const target = REDIRECT.get(base);
    if (target) return { url: target, shortCircuit: true, format: "module" };
  }
  return nextResolve(specifier, context);
}
