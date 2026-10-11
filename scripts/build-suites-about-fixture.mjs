// Generates dist/suites-about-fixture.html from the REAL, shipping
// `buildSuitesAboutHtml` (api/_suites-about.js) — `scripts/build-room-about-
// fixture.mjs`'s own shape (WS-R97), restated for WS-R117's page: `/suites/
// about` is server-rendered HTML with no client bundle at all, so there is
// nothing for vite to compile. `scripts/check-headers.mjs` and `scripts/
// check-performance.mjs` still need a real fixture FILE to serve for it
// (both gates' own static servers read from disk), built from the SHIPPING
// builder rather than a hand-typed stand-in that could drift.
//
// UNLIKE `build-room-about-fixture.mjs`, this is not wired into
// `vite.config.ts`'s `closeBundle` hook: `buildSuitesAboutHtml` takes no
// `db` and reads no per-Suite row (`api/_suites-about.js`'s own header says
// why), so it needs no vite build step at all to become deterministic — the
// two gate scripts that need this file on disk call this function directly,
// at the top of their own run, exactly the way this file's own `main` block
// does below.
//
//   node scripts/build-suites-about-fixture.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");

export async function buildSuitesAboutFixture() {
  const { buildSuitesAboutHtml } = await import(pathToFileURL(join(ROOT, "api/_suites-about.js")).href);
  const html = buildSuitesAboutHtml({ origin: "https://vyakti.app", lang: "en" });
  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, "suites-about-fixture.html"), html, "utf8");
  return html;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await buildSuitesAboutFixture();
  console.log("wrote dist/suites-about-fixture.html");
}
