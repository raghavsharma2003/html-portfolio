// WS-R117: the Suite admin's transparency page (`/suites/about`, no
// migration).
//
//   node evals/suites-about/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no model call. Drives the
// REAL `api/_suites-about.js` (the pure HTML builder — no `db`, no SQL,
// `evals/room-about/run.mjs`'s own shape one surface over) directly.
//
// WHAT THIS PROVES:
//   1. `buildSuitesAboutHtml` is pure: same input, same bytes, every time,
//      in both locales, and `?lang=` picks the locale (no room row, no
//      creator to inherit a default from).
//   2. Every number on the page is the REAL imported constant, never a
//      typed literal — the seat prices (api/_org.js) and the pulse floor
//      (api/_pulse.js) — checked two ways: the rendered bytes carry the
//      real value, and a static source scan proves the import exists.
//   3. hreflang/x-default/og:locale, `_room-about.js`'s own WS-R97 shape.
//   4. vercel.json carries the rewrite and the headers rule, and the CSP
//      allows no 'unsafe-inline'/'unsafe-eval' script-src (this page ships
//      no script at all).
//   5. No em dash / en dash in either locale's rendered body.
//   6. STATIC IMPORT SCAN: this file imports neither `./_db.js` nor any
//      follower-table-reading module — `api/_room-about.js`'s own "no
//      import of ./_db.js" header note, restated for a file that touches no
//      database at all, not merely one routed through a parameter. Named
//      by the brief as this suite's own completeness proof that the page
//      "reads nothing from any follower table."
//   7. `scripts/check-copy.mjs`'s real scanner, run directly against both
//      locale renders: zero rooms-vocabulary offences and zero dash
//      offences on the real output, with a NEGATIVE CONTROL proving the
//      scanner actually fires on a poisoned fixture (an em dash and the
//      banned word "clone") rather than passing vacuously.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const API = join(REPO, "api");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const { buildSuitesAboutHtml } = await import(pathToFileURL(join(API, "_suites-about.js")).href);
const { PULSE_MIN_FOLLOWERS } = await import(pathToFileURL(join(API, "_pulse.js")).href);
const {
  SUITE_SEAT_PRICE_STARTER_INR,
  SUITE_SEAT_PRICE_INSTITUTE_INR,
  SUITE_SEAT_PRICE_INSTITUTE_MIN_SEATS,
} = await import(pathToFileURL(join(API, "_org.js")).href);
const { scanSource } = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);

// ═════════════════════════════════════════════════════════════════════════
// 1. buildSuitesAboutHtml: PURE, both locales, ?lang= picks the locale
// ═════════════════════════════════════════════════════════════════════════
const htmlA = buildSuitesAboutHtml({ origin: "https://vyakti.app" });
const htmlB = buildSuitesAboutHtml({ origin: "https://vyakti.app" });
{
  ok("buildSuitesAboutHtml is pure: identical input, identical bytes", htmlA === htmlB);
  ok("default (no lang) renders English", htmlA.includes('<html lang="en">'));
  ok("naming: the page title carries the platform name", htmlA.includes("Vyakti"));
}

const htmlHi = buildSuitesAboutHtml({ origin: "https://vyakti.app", lang: "hi" });
{
  ok("?lang=hi renders Hindi", htmlHi.includes('<html lang="hi">'));
  ok("the Hindi render's headings are in Hindi, not English", htmlHi.includes("Suite क्या है") && !htmlHi.includes(">What a Suite is<"));
  ok("an unrecognised lang value falls back to English (normalizeLocale's own law)",
    buildSuitesAboutHtml({ origin: "https://vyakti.app", lang: "fr" }).includes('<html lang="en">'));
}

// ═════════════════════════════════════════════════════════════════════════
// 2. EVERY NUMBER IS THE REAL IMPORTED CONSTANT
// ═════════════════════════════════════════════════════════════════════════
{
  ok("carries the real SUITE_SEAT_PRICE_STARTER_INR", htmlA.includes(`₹${SUITE_SEAT_PRICE_STARTER_INR.toLocaleString("en-IN")}`));
  ok("carries the real SUITE_SEAT_PRICE_INSTITUTE_INR", htmlA.includes(`₹${SUITE_SEAT_PRICE_INSTITUTE_INR.toLocaleString("en-IN")}`));
  ok("carries the real SUITE_SEAT_PRICE_INSTITUTE_MIN_SEATS", htmlA.includes(`at least ${SUITE_SEAT_PRICE_INSTITUTE_MIN_SEATS} seats`));
  ok("carries the real PULSE_MIN_FOLLOWERS floor", htmlA.includes(`at least ${PULSE_MIN_FOLLOWERS} followers`));

  const src = readFileSync(join(API, "_suites-about.js"), "utf8");
  ok("STATIC: the three seat-price constants are imported from ./_org.js",
    /import\s*\{[^}]*\bSUITE_SEAT_PRICE_STARTER_INR\b[^}]*\bSUITE_SEAT_PRICE_INSTITUTE_INR\b[^}]*\bSUITE_SEAT_PRICE_INSTITUTE_MIN_SEATS\b[^}]*\}\s*from\s*"\.\/_org\.js"/.test(src));
  ok("STATIC: PULSE_MIN_FOLLOWERS is imported from ./_pulse.js",
    /import\s*\{[^}]*\bPULSE_MIN_FOLLOWERS\b[^}]*\}\s*from\s*"\.\/_pulse\.js"/.test(src));
}

// ═════════════════════════════════════════════════════════════════════════
// 3. hreflang, x-default, og:locale
// ═════════════════════════════════════════════════════════════════════════
{
  for (const code of ["en", "hi", "x-default"]) {
    ok(`carries a hreflang="${code}" alternate link`, htmlA.includes(`hreflang="${code}"`));
  }
  ok('hreflang="en" and "x-default" point at the SAME bare address',
    htmlA.includes('<link rel="alternate" hreflang="en" href="https://vyakti.app/suites/about" />')
    && htmlA.includes('<link rel="alternate" hreflang="x-default" href="https://vyakti.app/suites/about" />'));
  ok('hreflang="hi" points at the ?lang=hi address', htmlA.includes('<link rel="alternate" hreflang="hi" href="https://vyakti.app/suites/about?lang=hi" />'));
  ok('an English render carries og:locale content="en_US"', htmlA.includes('<meta property="og:locale" content="en_US" />'));
  ok('the Hindi render carries og:locale content="hi_IN"', htmlHi.includes('<meta property="og:locale" content="hi_IN" />'));
  ok("carries a canonical link", htmlA.includes('<link rel="canonical" href="https://vyakti.app/suites/about" />'));
}

// ═════════════════════════════════════════════════════════════════════════
// 4. vercel.json: the rewrite and headers entry exist
// ═════════════════════════════════════════════════════════════════════════
{
  const vercelConfig = JSON.parse(readFileSync(join(REPO, "vercel.json"), "utf8"));
  const rewrite = vercelConfig.rewrites.find((r) => r.source === "/suites/about");
  ok("vercel.json rewrites /suites/about to api/suites-about", rewrite?.destination === "/api/suites-about");

  const headerRule = vercelConfig.headers.find((h) => h.source === "/suites/about");
  ok("vercel.json's headers array carries a rule for /suites/about", Boolean(headerRule));
  const csp = headerRule?.headers?.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
  ok("that CSP carries no 'unsafe-inline'/'unsafe-eval' in script-src (no script on this page at all)",
    !/script-src[^;]*unsafe-inline/.test(csp) && !/script-src[^;]*unsafe-eval/.test(csp));
  ok("that CSP's default-src is exactly 'self'", /default-src 'self';/.test(csp));
  ok("that CSP's frame-ancestors is 'none'", /frame-ancestors 'none'/.test(csp));
}

// ═════════════════════════════════════════════════════════════════════════
// 5. NO EM DASH / EN DASH in either locale's rendered body
// ═════════════════════════════════════════════════════════════════════════
{
  const bodyOf = (html) => html.slice(html.indexOf("<body>"));
  ok("no em dash in the English render's body", !/—/.test(bodyOf(htmlA)));
  ok("no en dash in the English render's body", !/–/.test(bodyOf(htmlA)));
  ok("no em dash in the Hindi render's body", !/—/.test(bodyOf(htmlHi)));
  ok("no en dash in the Hindi render's body", !/–/.test(bodyOf(htmlHi)));
}

// ═════════════════════════════════════════════════════════════════════════
// 6. STATIC IMPORT SCAN: this page reads nothing from any follower table
// ═════════════════════════════════════════════════════════════════════════
{
  const src = readFileSync(join(API, "_suites-about.js"), "utf8");
  ok("STATIC: no import of ./_db.js (this page runs no SQL of any kind)", !/from\s*"\.\/_db\.js"/.test(src));
  ok('STATIC: no "db" parameter accepted by buildSuitesAboutHtml (not slug-scoped, reads no row)',
    /export function buildSuitesAboutHtml\(\{\s*origin,\s*lang\s*\}/.test(src));
  // Every `./_..." import this file makes is one of the four platform-
  // constant modules it actually needs — an allowlist, not a ban list, so a
  // future accidental import of a follower-scoped module (api/_room*.js,
  // api/_pulse-note.js reading vy_room_follower, etc.) fails this line by
  // name rather than needing its own new rule.
  const importedModules = [...src.matchAll(/from\s*"(\.\/[^"]+)"/g)].map((m) => m[1]);
  const ALLOWED = new Set(["./_room-surface.js", "./_room-page.js", "./_pulse.js", "./_org.js"]);
  const unexpected = importedModules.filter((m) => !ALLOWED.has(m));
  ok("STATIC: every local import is one of the four allowed platform-constant modules", unexpected.length === 0, unexpected.join(", "));
}

// ═════════════════════════════════════════════════════════════════════════
// 7. scripts/check-copy.mjs's REAL scanner, run directly
// ═════════════════════════════════════════════════════════════════════════
{
  const offencesEn = scanSource("suites-about.html", htmlA, { roomsVocab: true });
  const offencesHi = scanSource("suites-about.html", htmlHi, { roomsVocab: true });
  ok("the real English render carries zero check-copy offences (dash + rooms vocabulary)", offencesEn.length === 0, JSON.stringify(offencesEn));
  ok("the real Hindi render carries zero check-copy offences (dash + rooms vocabulary)", offencesHi.length === 0, JSON.stringify(offencesHi));

  // NEGATIVE CONTROL: the scanner actually fires on a poisoned fixture, not
  // merely passing vacuously on real output it happens never to flag.
  const poisoned = `<!doctype html><html lang="en"><body><main><h1>A Suite admin never sees a clone of your data — never.</h1></main></body></html>`;
  const poisonedOffences = scanSource("suites-about.html", poisoned, { roomsVocab: true });
  ok("NEGATIVE CONTROL: an em dash in a poisoned fixture is caught", poisonedOffences.some((o) => o.rule === "dash"));
  ok("NEGATIVE CONTROL: the banned word \"clone\" in a poisoned fixture is caught",
    poisonedOffences.some((o) => o.rule === "rooms-vocabulary"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
