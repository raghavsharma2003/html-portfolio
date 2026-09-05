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
  // WS-R119 (wave seventeen, third pass). Three more basenames, each a file
  // this repo has exactly ONE of (confirmed by `find api -name <basename>`
  // before adding it here — the same care this file's own header already
  // asks for): the Room's Telegram voice reply reaches
  // `_replica-voice-preview.js`'s real fifteen-precondition CTE and
  // `_replica-storage.js`'s real object storage read, neither of which any
  // fixture in this repo already answers (both are `beginOwnedVoicePreview`'s
  // own territory, `api/_replica-voice-preview.js`'s header: "the ONLY
  // schema-compatible choice", never re-derived by a second, weaker fixture
  // — context/rejected.md#ws-r119-fifteen-precondition-voice-preview-cte-
  // not-reproduced-in-a-fixture). `open-chatterbox-preview.js` is the ONE
  // provider room-tg.js's own `buildRoomVoiceDeps` constructs, WS-R110's own
  // "NO GPU WAKES" header naming it as the seam a caller fakes rather than
  // reaching a real Azure GPU.
  ["_replica-voice-preview.js", STUB("replica-voice-preview-with-fake-preview.mjs")],
  ["_replica-storage.js", STUB("replica-storage-with-fake-object.mjs")],
  ["open-chatterbox-preview.js", STUB("open-chatterbox-preview-fake.mjs")],
]);

// WS-R119. `_provenance/registry.js`'s own BASENAME (`registry.js`) is not
// safe to match the way the table above does — `find api -name registry.js`
// returns EIGHT files (`_claim-extraction/`, `_asr/`, `_face-session/`,
// `_liveness/`, `_voice/`, `_provenance/`, `_dialogue/`, `_channel/`,
// `_identity/`), and a basename-only redirect would silently hijack every
// one of them the moment ANYTHING in this process's transitive import graph
// resolves its OWN `./registry.js` — the exact `router-matched-a-table-
// instead-of-a-statement` shape this repo's own rejected.md already warns
// about, one layer over (a module redirect instead of a SQL match). Matched
// on the trailing TWO segments instead — `_provenance/registry.js` — which
// only `room-tg.js`, `room.js`, `voice-preview.js`, `mirror-call.js`,
// `replica-speech.js` and `replica-voice-preview.js` actually write, all six
// confirmed by grep before this was added.
const SUFFIX_REDIRECT = new Map([
  ["_provenance/registry.js", STUB("provenance-registry-with-fake-adapters.mjs")],
]);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".")) {
    const base = specifier.split("/").pop();
    const target = REDIRECT.get(base);
    if (target) return { url: target, shortCircuit: true, format: "module" };
    for (const [suffix, url] of SUFFIX_REDIRECT) {
      if (specifier.endsWith(`/${suffix}`) || specifier === `./${suffix}`) {
        return { url, shortCircuit: true, format: "module" };
      }
    }
  }
  return nextResolve(specifier, context);
}
