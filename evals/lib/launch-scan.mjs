// WS-R165. Finds a direct `chromium.launch(`/`firefox.launch(`/`webkit.launch(`/
// `puppeteer.launch(` call under evals/ that does not go through the one
// shared launcher, `evals/rehearsal/browser.mjs`'s `launchSuiteBrowser` /
// `launchRehearsalBrowser`.
//
// Why this exists: 30 suites under evals/ launched Chromium directly, with
// their own copy of the executablePath/channel/skip logic (or none at all),
// and 39 of Codex's mounted-component suites crashed the browserless build
// job outright (`context/rejected.md#direct-chromium-launches-crashed-the-
// browserless-build-job`). The shared launcher fixed those 39; this scanner
// is what stops a NEW suite reintroducing the same shape, and what proved
// this workstream's own migration of the remaining 30 (plus one, found by
// this scanner itself: `evals/room-push/run.mjs` and `evals/room-speak-plan/
// benchmark.mjs` both shelled to `chromium.launch(` for reasons that turned
// out to be exactly what the shared launcher already does).
//
// Scans comment-stripped source (`evals/lib/source-scan.mjs`) so a comment
// that merely DISCUSSES a direct launch — this file's own header included —
// can never be mistaken for one.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { stripComments } from "./source-scan.mjs";

const LAUNCH_CALL = /\b(chromium|firefox|webkit|puppeteer)\s*\.\s*launch\s*\(/g;

/** `[{ receiver, index }]` for every direct `<receiver>.launch(` call found
 *  in `src` (already comment-stripped by the caller, or raw — this function
 *  strips it itself so callers never have to remember to). */
export function findDirectLaunches(src) {
  const clean = stripComments(src);
  const hits = [];
  for (const m of clean.matchAll(LAUNCH_CALL)) hits.push({ receiver: m[1], index: m.index });
  return hits;
}

/** Every `.mjs` file under `evals/` (recursive, `node_modules` and
 *  `fixtures/` directories skipped — a fixture is a frozen historical
 *  source blob, never code this repo runs), as repo-relative paths. */
// Files whose own self-test (or, for the two `run.mjs` wrappers, whose own
// NEGATIVE CONTROL) carries the banned shape as a STRING LITERAL rather
// than real code — the same class of self-scan trap `context/
// rejected.md#ws-r127-own-eval-static-scan-tripped-by-its-own-prose` names
// for a comment, restated here for a string. None of the four is a suite
// that could itself launch a browser.
const SELF_EXCLUDED = new Set([
  join("lib", "launch-scan.mjs"),
  join("lib", "history-scan.mjs"),
  join("launch-scan", "run.mjs"),
  join("history-scan", "run.mjs"),
]);

function evalsFiles(evalsRoot) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "fixtures") continue;
      const full = join(dir, entry);
      if (SELF_EXCLUDED.has(relative(evalsRoot, full))) continue;
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && extname(full) === ".mjs") out.push(full);
    }
  };
  walk(evalsRoot);
  return out;
}

/** The scan the release gate runs: every direct launch under evals/, outside
 *  `rehearsal/browser.mjs` itself (which is WHERE the one real launch
 *  lives). Returns `[{ file, receiver }]`, empty when the tree is clean. */
export function scanRepoForDirectLaunches(repoRoot) {
  const evalsRoot = join(repoRoot, "evals");
  const launcherFile = join(evalsRoot, "rehearsal", "browser.mjs");
  const findings = [];
  for (const file of evalsFiles(evalsRoot)) {
    if (file === launcherFile) continue;
    const hits = findDirectLaunches(readFileSync(file, "utf8"));
    for (const hit of hits) findings.push({ file: relative(repoRoot, file).split("\\").join("/"), receiver: hit.receiver });
  }
  return findings;
}

export function selfTest() {
  const cases = [];
  const t = (name, cond) => cases.push({ name, cond: Boolean(cond) });

  t("finds a real direct chromium.launch( call",
    findDirectLaunches("const browser = await chromium.launch({ headless: true });").length === 1);

  t("finds firefox/webkit/puppeteer receivers too",
    findDirectLaunches("await firefox.launch();\nawait webkit.launch();\nawait puppeteer.launch();").length === 3);

  t("a comment mentioning `chromium.launch(` is not a real call (the ws-r127 shape)",
    findDirectLaunches("// never call chromium.launch( directly here\nconst x = 1;").length === 0);

  t("a direct launch on the SAME line as an unrelated comment is still found",
    findDirectLaunches("const b = await chromium.launch(opts); // see header\n").length === 1);

  t("launchSuiteBrowser/launchRehearsalBrowser calls are never flagged (they are the shared seam, not a direct launch)",
    findDirectLaunches('import { launchSuiteBrowser } from "../rehearsal/browser.mjs";\nconst browser = await launchSuiteBrowser("x");').length === 0);

  t("a `.launch(` on an unrelated receiver (not chromium/firefox/webkit/puppeteer) is not flagged",
    findDirectLaunches("await missile.launch();").length === 0);

  return { pass: cases.filter((c) => c.cond).length, fail: cases.filter((c) => !c.cond).length, cases };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { pass, fail, cases } = selfTest();
  for (const c of cases) console.log(`${c.cond ? "  ok  " : "FAIL  "}${c.name}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
