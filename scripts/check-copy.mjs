// The em-dash ban, enforced on the half of the app it was never applied to.
//
// docs/DESIGN-STANDARDS.md commits to a hard em-dash ban in UI copy, and the
// repo enforces it — on HER: `stripTextingDashes` runs on every generated
// bubble (brain.ts). Product chrome had no enforcement at all, and the audit
// (2026-08-22) found twelve em-dashes in user-visible strings: the one
// typographic rule this repo wrote down was binding on the model and optional
// for the humans, which reads as two different voices in one app.
//
// Mechanical and tasteless on purpose: strip comments from every component
// file, and any em-dash that survives is in a string literal or JSX text —
// i.e. on the way to a user's screen. Code comments are exempt (they are not
// UI copy; this repo's comments use dashes freely and that is fine).
// A deliberate exception gets `// emdash-ok: <reason>` on the same line.
//
// ── THE OTHER HALF THE AUDIT MISSED: site/ ────────────────────────────────
// The landing page and the privacy page are hand-written static HTML with no
// build step, so nothing that compiles the app has ever read them — and they
// are the FIRST user-facing copy a stranger meets. The ban is on UI copy, not
// on src/, so it binds here too, and it bound here the whole time without
// anything to say so (site/index.html carried ten em-dashes and
// site/privacy.html eleven). Same mechanical treatment: strip comments, and
// anything that survives is on its way to a screen. HTML comments join JS
// ones as exempt; the inline script's STRING literals do not, because the
// picker's chip phrases are copy that renders.
import { readFileSync, readdirSync } from "fs";

const ROOT = new URL("..", import.meta.url).pathname;

/** Blank out a comment span while preserving line numbers. */
const blank = (m) => m.replace(/[^\n]/g, " ");
/** The one entity form a hand-written HTML file can smuggle one in as. */
const ENTITY = /&(?:mdash|#8212|#x2014);/i;

const offenders = [];

const DIR = "src/components/";
for (const f of readdirSync(ROOT + DIR).filter((f) => /\.tsx?$/.test(f))) {
  const raw = readFileSync(ROOT + DIR + f, "utf8");
  // strip block comments, preserving line count
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, blank);
  noBlock.split("\n").forEach((line, i) => {
    if (/emdash-ok:/.test(line)) return;
    // strip a line comment; "://" (URLs) is not a comment
    const code = line.replace(/(?<!:)\/\/.*$/, "");
    if (code.includes("—")) offenders.push(`${DIR}${f}:${i + 1}  ${code.trim().slice(0, 90)}`);
  });
}

const SITE = "site/";
for (const f of readdirSync(ROOT + SITE).filter((f) => /\.html$/.test(f))) {
  const raw = readFileSync(ROOT + SITE + f, "utf8");
  const stripped = raw
    .replace(/<!--[\s\S]*?-->/g, blank) // HTML comments
    .replace(/\/\*[\s\S]*?\*\//g, blank); // CSS/JS block comments in <style>/<script>
  stripped.split("\n").forEach((line, i) => {
    if (/emdash-ok:/.test(line)) return;
    const code = line.replace(/(?<!:)\/\/.*$/, "");
    if (code.includes("—") || ENTITY.test(code)) {
      offenders.push(`${SITE}${f}:${i + 1}  ${code.trim().slice(0, 90)}`);
    }
  });
}

if (offenders.length) {
  console.log(`FAIL  em-dash in UI copy (${offenders.length}) — rewrite with a comma, colon or full stop:`);
  for (const o of offenders) console.log("  " + o);
  process.exit(1);
}
console.log("  ok  no em-dashes in component or site copy");
