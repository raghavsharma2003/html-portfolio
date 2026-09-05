import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// WS-R66. `/c/<slug>` (the creator's public page) is server-rendered HTML
// with no client bundle at all — there is nothing for vite to compile the
// way `room-layout-fixture.html` is a real entry. `scripts/check-headers.mjs`
// and `scripts/check-performance.mjs` still need a real fixture file to
// serve for it, built from the SHIPPING `buildCreatorPageHtml`
// (`api/_creator-page.js`) rather than a hand-typed stand-in that could
// drift. Generated here, in a `closeBundle` hook, rather than as its own
// step in `scripts/verify-release.mjs`, so it exists by the time the single
// "web build" gate finishes without adding a second named gate to that
// count (`context/decisions.md#ws-r66-creator-page-fixture-generated-inside-the-web-build-gate`).
function creatorPageFixturePlugin() {
  return {
    name: 'vyakti-creator-page-fixture',
    apply: 'build' as const,
    async closeBundle() {
      // `./scripts/build-creator-page-fixture.d.mts` is the real type for
      // this sibling .mjs script — a `.d.mts` file, not a cast or a
      // suppression comment, so a real signature drift in that script still
      // fails typecheck here rather than being silenced.
      const { buildCreatorPageFixture } = await import('./scripts/build-creator-page-fixture.mjs')
      await buildCreatorPageFixture()
    },
  }
}

// WS-R97. `/r/<slug>/about` (the follower's transparency page) is server-
// rendered HTML with no client bundle at all, the identical shape
// `/c/<slug>` already is above — a second, separate plugin rather than a
// second call inside `creatorPageFixturePlugin`'s own `closeBundle`, so
// either fixture can be read from its own name in this file without hunting
// through the other's hook.
function roomAboutFixturePlugin() {
  return {
    name: 'vyakti-room-about-fixture',
    apply: 'build' as const,
    async closeBundle() {
      // `./scripts/build-room-about-fixture.d.mts` is the real type for this
      // sibling .mjs script, `creatorPageFixturePlugin`'s own reason above.
      const { buildRoomAboutFixture } = await import('./scripts/build-room-about-fixture.mjs')
      await buildRoomAboutFixture()
    },
  }
}

// WS-R107, narrowed WS-R113. `context/measurements.md#first-hindi-paint-on-the-wave-fifteen-merge-gate-2026-09-05`
// measured the studio's first Hindi paint at 918ms against an 800ms budget,
// structurally: `hiCopy.ts` (`context/decisions.md#studio-hindi-table-is-its-own-chunk`)
// is a dynamic `import()` that main.tsx (WS-R91) issues as early as a module
// body can run, which is still AFTER the browser has fetched, parsed and
// started executing the main studio chunk — the dynamic import's own network
// request cannot start until then. A `<link rel="modulepreload">` for the
// chunk starts that fetch the instant the HTML parser reaches it, in
// parallel with the main chunk, which is the whole win.
//
// WS-R113 narrowed WHICH chunk this preloads: `hiCopy.ts` split into
// `hiAuthCopy.ts` (the sign-in screen's own two sections, `authGate` +
// `shell`) and `hiCopy.ts` (everything else, loaded only once a session
// exists) — see `context/decisions.md#ws-r113-hindi-chunk-splits-into-an-auth-section-and-a-rest-section`.
// This plugin now preloads ONLY `hiAuthCopy-<hash>.js`: that is the one
// chunk a signed-out `?lang=hi` visit ever fetches, and preloading the much
// larger rest chunk too would cost that visit bytes and a fetch it will
// never use before signing in.
//
// It cannot be a plain static `<link>` in `studio.html`'s source: the
// chunk's filename is content-hashed at build time and `studio.html` has no
// server-side templating step to receive that hash
// (`context/decisions.md#ws-r91-hindi-chunk-preloaded-from-main-tsx`'s own
// note). It also must not cost the ENGLISH studio a byte or a fetch: most
// visitors never touch the Hindi table, and the whole reason it is a
// separate chunk (`#studio-hindi-table-is-its-own-chunk`) is that an English
// creator should not pay for it.
//
// TWO WAYS TO MAKE THE PRELOAD CONDITIONAL ON A HINDI REQUEST WERE READ AND
// WEIGHED (`context/decisions.md#ws-r107-hindi-preload-is-a-conditional-inline-script-not-a-second-entry`
// has the full reversal condition):
//   (a) a second built entry `studio-hi.html`, routed by a `vercel.json`
//       rewrite matching `?lang=hi` via `has: [{type:"query",...}]` -- this
//       IS a real Vercel capability (verified against
//       https://vercel.com/docs/project-configuration/vercel-json#rewrites ,
//       "has ... type, key and value properties", with a worked example
//       using `"type": "query"` on the same page's `headers` section) -- but
//       it needs a genuinely SEPARATE source HTML file: a build experiment
//       here (two `rollupOptions.input` keys pointing at the identical
//       `studio.html` path) proved Vite/Rollup key an HTML *entry* by its
//       resolved file path, not by the input object's key, so the second
//       key silently produced an orphan JS facade chunk and NO second HTML
//       file at all. A hand-duplicated `studio-hi.html` would then be a
//       second copy of the whole shell (the CSS-layer-order fix, every meta
//       tag) that has to be kept byte-for-byte in sync by hand forever.
//   (b) one file, one small inline script (this plugin), gated on the
//       request rather than on which file was served. Chosen.
//
// The script's own TEXT never changes build to build (so its CSP hash,
// already committed in vercel.json's `/studio` and `/studio.html` rules,
// never goes stale as `hiCopy.ts` grows or shrinks) -- the one thing that DOES
// vary per build, the chunk's hashed filename, is carried in a `<meta>` tag
// instead, which CSP does not gate at all. The script reads that meta tag,
// decides "is this visit Hindi" by the identical two-step order
// `resolveStudioLocale` (`src/studio/studioLocalePreference.ts`) uses before
// a replica has loaded -- `?lang=` wins outright, else the remembered
// `vyakti.studio.locale.v1` `localStorage` key -- and, only then, creates
// the real `<link rel="modulepreload">` itself. An English visit (no
// `?lang=hi`, nothing remembered) never creates the link and never touches
// the meta tag's value, so the English studio's own transferred JS is
// provably unchanged -- `scripts/check-performance.mjs`'s `jsBytes` budget
// on the `/studio` target is the proof, and a new static check in that same
// file asserts the built `dist/studio.html` carries exactly one
// `hi-chunk-preload` meta tag and never a literal, unconditional
// `<link rel="modulepreload">` for the Hindi chunk.
const HI_PRELOAD_SCRIPT = `(function () {
  try {
    var meta = document.querySelector('meta[name="hi-chunk-preload"]');
    var href = meta && meta.getAttribute("content");
    if (!href) return;
    var lang = new URLSearchParams(location.search).get("lang");
    var hi = lang === "hi";
    if (!hi && lang === null) {
      try {
        hi = localStorage.getItem("vyakti.studio.locale.v1") === "hi";
      } catch (e) {}
    }
    if (!hi) return;
    var link = document.createElement("link");
    link.rel = "modulepreload";
    link.crossOrigin = "anonymous";
    link.fetchPriority = "high";
    link.href = href;
    document.head.appendChild(link);
  } catch (e) {}
})();`

function studioHindiPreloadPlugin() {
  return {
    name: 'vyakti-studio-hindi-preload',
    apply: 'build' as const,
    async closeBundle() {
      const distDir = join(process.cwd(), 'dist')
      const assetNames = readdirSync(join(distDir, 'assets'))
      // `hiAuthCopy-<hash>.js`, the same filename shape
      // `scripts/check-performance.mjs`'s `findHiAuthCopyChunkPath()` already
      // globs for -- found here rather than imported from there so this
      // plugin has no runtime dependency on a scripts/ file whose own job is
      // gating, not building. Both chunks are checked for existence (a
      // missing REST chunk means the split itself broke, even though this
      // plugin only ever preloads the auth one) so either half silently
      // disappearing fails the build loudly, by name, rather than shipping a
      // signed-in creator a broken locale.
      const hiAuthChunk = assetNames.find((n) => n.startsWith('hiAuthCopy-') && n.endsWith('.js'))
      const hiRestChunk = assetNames.find((n) => n.startsWith('hiCopy-') && n.endsWith('.js'))
      if (!hiAuthChunk || !hiRestChunk) {
        // Loud, not silent: `#studio-hindi-table-is-its-own-chunk` /
        // `#ws-r113-hindi-chunk-splits-into-an-auth-section-and-a-rest-section`
        // being unbuilt or renamed is exactly the state this plugin exists
        // to never paper over.
        throw new Error(
          'studioHindiPreloadPlugin: expected both dist/assets/hiAuthCopy-*.js and dist/assets/hiCopy-*.js -- ' +
            `found hiAuthCopy: ${hiAuthChunk ? 'yes' : 'NO'}, hiCopy: ${hiRestChunk ? 'yes' : 'NO'}. The Hindi copy ` +
            'chunk split (context/decisions.md#ws-r113-hindi-chunk-splits-into-an-auth-section-and-a-rest-section) ' +
            'is missing or an output name changed.',
        )
      }
      const hiChunk = hiAuthChunk
      const studioHtmlPath = join(distDir, 'studio.html')
      const html = readFileSync(studioHtmlPath, 'utf8')
      const marker = '<meta charset="UTF-8" />'
      if (!html.includes(marker)) {
        throw new Error(`studioHindiPreloadPlugin: expected marker ${JSON.stringify(marker)} not found in dist/studio.html`)
      }
      const injected =
        `${marker}\n    <meta name="hi-chunk-preload" content="/assets/${hiChunk}" />\n    <script>${HI_PRELOAD_SCRIPT}</script>`
      const next = html.replace(marker, injected)
      writeFileSync(studioHtmlPath, next, 'utf8')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), creatorPageFixturePlugin(), roomAboutFixturePlugin(), studioHindiPreloadPlugin()],
  build: {
    rollupOptions: {
      input: {
        // The key names the emitted chunk. scripts/verify-deploy.mjs's app-shell
        // probe (and its stale-bundle check) asserts /chat references
        // assets/index-<hash>.js — the single-entry era's default name — so the
        // app entry must stay "index", not "app". The studio is a second entry,
        // not a rename of the first.
        index: "index.html",
        studio: "studio.html",
        // The Room (WS-R1): the follower's side, served at /r/<slug> through a
        // rewrite in vercel.json. A third entry rather than a route inside the
        // studio bundle, because a follower arriving from a bio link must not
        // download a creator's studio to read one screen, and because the two
        // audiences share nothing but the palette.
        room: "room.html",
        // The layout gate's deterministic harness: the real studio panels with
        // fixture data and a stubbed /api, so scripts/check-layout.mjs can see
        // the signed-in screens without a secret. Inert off loopback and
        // unlinked. See src/studio/layoutFixture.tsx.
        "studio-layout-fixture": "studio-layout-fixture.html",
        // The same harness for the Room, and it needs its own because every
        // Room screen worth measuring is SIGNED IN: pointed at the real page
        // the gate would render "this room is not open" three times and report
        // OK. See src/room/layoutFixture.tsx.
        "room-layout-fixture": "room-layout-fixture.html",
        // WS-R45. `site/creators.html` is a static, self-contained page like
        // `site/vyakti.html` (no React, no build coupling) and is normally
        // copied into `dist/creators.html` by `scripts/vercel-build.sh`
        // AFTER `vite build` runs. `scripts/verify-release.mjs`'s "web build"
        // gate calls plain `vite build` and never runs that copy step, so
        // without an entry here `dist/creators.html` would not exist for
        // `scripts/check-layout.mjs`'s `creators`/`creators-hi` targets to
        // find. Vite emits a multi-page HTML input at a path mirroring its
        // OWN relative path from the project root, not this key -
        // `dist/site/creators.html`, not `dist/creators.html` - so the
        // layout gate's fixture path is `site/creators.html` too (see
        // `scripts/check-layout.mjs`'s `TARGETS`). The one cost: a real
        // deploy ends up with an unrouted second copy of the same public
        // page reachable at `/site/creators.html` alongside the routed one
        // at `/creators` - harmless (identical content, nothing per-person),
        // and cheaper than a second build path just to avoid one alias URL.
        "creators-directory": "site/creators.html",
      },
    },
  },
})
