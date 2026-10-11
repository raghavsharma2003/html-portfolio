// Generates dist/room-about-fixture.html from the REAL, shipping
// `buildRoomAboutHtml` (api/_room-about.js) — `scripts/build-creator-page-
// fixture.mjs`'s own shape (WS-R66), restated for WS-R97's page: `/r/<slug>/
// about` is server-rendered HTML with no client bundle at all, so there is
// nothing for vite to compile the way `room-layout-fixture.html` is a real
// entry. `scripts/check-headers.mjs` and `scripts/check-performance.mjs`
// still need a real fixture file to serve for it, built from the SHIPPING
// builder rather than a hand-typed stand-in that could drift. Generated in
// a `closeBundle` hook (`vite.config.ts`), so `dist/room-about-fixture.html`
// exists by the time `scripts/verify-release.mjs`'s single "web build" gate
// finishes, without adding a second named gate to that count
// (`context/decisions.md#ws-r66-creator-page-fixture-generated-inside-the-web-build-gate`,
// the identical reasoning restated for this page).
//
//   node scripts/build-room-about-fixture.mjs
//
// A dormancy policy IS set on this fixture Room (unlike an empty-showcase
// creator-page fixture, this page renders DIFFERENT content depending on
// whether `dormancy_days` is null) so the headers/performance gates measure
// the LONGER of the two render paths, never the shorter one that would
// understate real bytes.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");

export async function buildRoomAboutFixture() {
  const { buildRoomAboutHtml } = await import(pathToFileURL(join(ROOT, "api/_room-about.js")).href);

  const room = {
    slug: "anjali",
    display_name: "Anjali",
    default_locale: "en",
    dormancy_days: 365,
    free_monthly_messages: 20,
    paid_monthly_messages: 500,
    paid_monthly_voice_seconds: 1800,
  };

  const html = buildRoomAboutHtml(room, { origin: "https://vyakti.app", slug: "anjali", lang: "en" });
  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, "room-about-fixture.html"), html, "utf8");
  return html;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await buildRoomAboutFixture();
  console.log("wrote dist/room-about-fixture.html");
}
