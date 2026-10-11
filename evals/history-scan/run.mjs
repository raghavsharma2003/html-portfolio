// WS-R165. `evals/lib/history-scan.mjs`'s own suite.
//
//   node evals/history-scan/run.mjs
//   node evals/run.mjs history-scan
//
// Offline, deterministic, $0, no network, no database, no browser.
//
// Two things, in order: the library's own self-test, then a real-tree pass
// with a required NEGATIVE CONTROL (a throwaway fixture proving the scanner
// actually finds a planted violation) before trusting it to report zero on
// the real, committed tree — `context/rejected.md#sound-gate-proved-by-
// silence`.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { selfTest, scanRepoForGitShow } from "../lib/history-scan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

console.log("── §1: evals/lib/history-scan.mjs's own self-test ──");
{
  const result = selfTest();
  for (const c of result.cases) ok(`[self-test] ${c.name}`, c.cond);
  console.log(`  ${result.pass} self-test cases passed, ${result.fail} failed`);
}

console.log("\n── §2: the real tree ──");
{
  const scratch = mkdtempSync(join(tmpdir(), "history-scan-negative-"));
  const fakeEvals = join(scratch, "evals");
  mkdirSync(fakeEvals, { recursive: true });
  writeFileSync(join(fakeEvals, "bad-suite.mjs"), "import { execFileSync } from 'node:child_process';\nconst old = execFileSync('git', ['show', 'deadbeef:api/x.js'], { cwd: root, encoding: 'utf8' });\n");
  const negativeFindings = scanRepoForGitShow(scratch);
  ok("NEGATIVE CONTROL: the scanner finds a git-show blob read planted in a throwaway suite",
    negativeFindings.length === 1 && negativeFindings[0].file === "evals/bad-suite.mjs");
  rmSync(scratch, { recursive: true, force: true });

  const findings = scanRepoForGitShow(REPO);
  ok("the real, committed evals/ tree has zero `git show` historical-blob reads",
    findings.length === 0,
    findings.length ? `found: ${findings.map((f) => f.file).join(", ")}` : "");
}

console.log(`\nhistory-scan: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
