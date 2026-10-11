// WS-R165. `evals/lib/launch-scan.mjs`'s own suite.
//
//   node evals/launch-scan/run.mjs
//   node evals/run.mjs launch-scan
//
// Offline, deterministic, $0, no network, no database, no browser.
//
// Two things, in order:
//
//   §1. The library's own self-test (`selfTest()`), run here under this
//       suite's `ok()` bookkeeping so a failure shows up in the normal
//       registry output.
//
//   §2. THE REAL TREE. Every `.mjs` file under evals/ (fixtures and the
//       scanner library itself excluded, per the library's own header) is
//       scanned for a direct `chromium.launch(`/`firefox.launch(`/
//       `webkit.launch(`/`puppeteer.launch(` call outside
//       `evals/rehearsal/browser.mjs`. THE REGRESSION TEST: this suite
//       first proves the scanner finds a real violation (a throwaway
//       fixture file written to a temp directory, since the real tree
//       carries zero after this workstream's migration — a check that
//       cannot fail is not a check,
//       `context/rejected.md#sound-gate-proved-by-silence`), then asserts
//       the real, committed tree has NONE.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { selfTest, scanRepoForDirectLaunches } from "../lib/launch-scan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

console.log("── §1: evals/lib/launch-scan.mjs's own self-test ──");
{
  const result = selfTest();
  for (const c of result.cases) ok(`[self-test] ${c.name}`, c.cond);
  console.log(`  ${result.pass} self-test cases passed, ${result.fail} failed`);
}

console.log("\n── §2: the real tree ──");
{
  // THE NEGATIVE CONTROL: a throwaway evals/ subtree carrying the exact
  // banned shape, proving the scanner actually finds a real violation
  // before trusting it to report zero on the committed tree.
  const scratch = mkdtempSync(join(tmpdir(), "launch-scan-negative-"));
  const fakeEvals = join(scratch, "evals");
  writeFileSync(join(scratch, "package.json"), "{}");
  const fs = await import("node:fs");
  fs.mkdirSync(fakeEvals, { recursive: true });
  fs.mkdirSync(join(fakeEvals, "rehearsal"), { recursive: true });
  writeFileSync(join(fakeEvals, "rehearsal", "browser.mjs"), "export async function launchSuiteBrowser(){}\n");
  writeFileSync(join(fakeEvals, "bad-suite.mjs"), "import { chromium } from 'playwright';\nconst b = await chromium.launch({ headless: true });\n");
  const negativeFindings = scanRepoForDirectLaunches(scratch);
  ok("NEGATIVE CONTROL: the scanner finds a direct launch planted in a throwaway suite",
    negativeFindings.length === 1 && negativeFindings[0].file === "evals/bad-suite.mjs");
  rmSync(scratch, { recursive: true, force: true });

  const findings = scanRepoForDirectLaunches(REPO);
  ok("the real, committed evals/ tree has zero direct browser launches outside evals/rehearsal/browser.mjs",
    findings.length === 0,
    findings.length ? `found: ${findings.map((f) => `${f.file} (${f.receiver})`).join(", ")}` : "");
}

console.log(`\nlaunch-scan: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
