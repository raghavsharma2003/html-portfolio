// Generates dist/creator-page-fixture.html from the REAL, shipping
// `buildCreatorPageHtml` (api/_creator-page.js) — WS-R66's own version of
// `room-layout-fixture.html`: a fixture built from real component/builder
// code with fixture data, never a hand-typed stand-in that could drift from
// what the door actually serves. `/c/<slug>` has no client bundle at all (a
// server-rendered page, not an app), so there is nothing for vite to bundle
// the way `room-layout-fixture.html`/`studio-layout-fixture.html` are real
// entries — this script IS the build step, invoked from `vite.config.ts`'s
// own `closeBundle` hook so `dist/creator-page-fixture.html` exists by the
// time `scripts/verify-release.mjs`'s single "web build" gate finishes,
// without adding a second named gate to that count
// (`context/decisions.md#ws-r66-creator-page-fixture-generated-inside-the-web-build-gate`).
//
//   node scripts/build-creator-page-fixture.mjs
//
// Five showcase slots, one Room, both proving the page's OWN five-slot
// ceiling renders correctly and giving the headers/performance gates a
// realistic byte size to measure against — an empty-showcase fixture would
// understate both the DOM the accessibility-adjacent checks walk and the
// bytes the performance budget actually has to clear in production.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");

export async function buildCreatorPageFixture() {
  const { buildCreatorPageHtml } = await import(pathToFileURL(join(ROOT, "api/_creator-page.js")).href);

  const room = {
    display_name: "Anjali",
    one_line_bio: "JEE physics, one topic a day, in plain language.",
    default_locale: "en",
  };
  const showcase = [
    { id: "s1", position: 1, question: "How do you explain projectile motion to a beginner?", answer: "Split it into horizontal and vertical motion and treat them separately." },
    { id: "s2", position: 2, question: "What if I am weak at calculus?", answer: "Start with limits, slowly, and practice one kind of problem at a time." },
    { id: "s3", position: 3, question: "How much should I study a day before boards?", answer: "Consistency over hours. Forty five focused minutes beats three distracted ones." },
    { id: "s4", position: 4, question: "Do you also help with chemistry?", answer: "Only physics for now, but I can point you to good chemistry resources." },
    { id: "s5", position: 5, question: "Can I message any time?", answer: "Yes, and I will reply when I am next available. This is not a live call." },
  ];

  const html = buildCreatorPageHtml({ room, showcase }, { origin: "https://vyakti.app", slug: "anjali", lang: "en" });
  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, "creator-page-fixture.html"), html, "utf8");
  return html;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await buildCreatorPageFixture();
  console.log("wrote dist/creator-page-fixture.html");
}
