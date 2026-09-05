// WS-R94. The module boundary this whole harness stands on.
// `evals/agent-room/loader.mjs` and `evals/recallbench/loader.mjs` are the
// precedent named in this workstream's brief: a Node module-customization
// hook (`node:module#register`) that redirects EXACTLY three relative
// specifiers this repo's `api/*.js` files resolve — `./_db.js`,
// `./_surface.js`, `./_auth.js` — to the fixture seams in `stubs/`, and
// nothing else. Every other import in the real handler's module graph
// (`api/room.js` -> `api/_room-surface.js` -> `api/_teachersheet.js`,
// `api/_room-taste.js`, `api/_rate-limit.js`, `api/_incidents.js`, ...) is
// the real, shipping file.
//
// Matched on the BASENAME of a relative specifier only, `recallbench/
// loader.mjs`'s own rule restated: a bare-package specifier that happened to
// end in the same characters must never be caught by this.
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = (name) => pathToFileURL(join(HERE, "stubs", name)).href;

const REDIRECT = new Map([
  ["_db.js", STUB("db.mjs")],
  ["_surface.js", STUB("surface-with-fake-model.mjs")],
  ["_auth.js", STUB("auth-with-fake-user.mjs")],
]);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".")) {
    const base = specifier.split("/").pop();
    const target = REDIRECT.get(base);
    if (target) return { url: target, shortCircuit: true, format: "module" };
  }
  return nextResolve(specifier, context);
}
