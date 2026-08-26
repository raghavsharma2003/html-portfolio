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
        // The layout gate's deterministic harness: the real studio panels with
        // fixture data and a stubbed /api, so scripts/check-layout.mjs can see
        // the signed-in screens without a secret. Inert off loopback and
        // unlinked. See src/studio/layoutFixture.tsx.
        "studio-layout-fixture": "studio-layout-fixture.html",
      },
    },
  },
})
