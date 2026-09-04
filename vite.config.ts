import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
