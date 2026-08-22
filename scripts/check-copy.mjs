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
import { readFileSync, readdirSync } from "fs";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = "src/components/";

const offenders = [];
for (const f of readdirSync(ROOT + DIR).filter((f) => /\.tsx?$/.test(f))) {
  const raw = readFileSync(ROOT + DIR + f, "utf8");
  // strip block comments, preserving line count
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  noBlock.split("\n").forEach((line, i) => {
    if (/emdash-ok:/.test(line)) return;
    // strip a line comment; "://" (URLs) is not a comment
    const code = line.replace(/(?<!:)\/\/.*$/, "");
    if (code.includes("—")) offenders.push(`${DIR}${f}:${i + 1}  ${code.trim().slice(0, 90)}`);
  });
}

if (offenders.length) {
  console.log(`FAIL  em-dash in UI copy (${offenders.length}) — rewrite with a comma, colon or full stop:`);
  for (const o of offenders) console.log("  " + o);
  process.exit(1);
}
console.log("  ok  no em-dashes in component copy");
