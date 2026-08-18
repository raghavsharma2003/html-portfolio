// The surface gate — WS-SURFACE. One command, three suites, failures printed
// together rather than the run stopping at the first one (same shape as
// scripts/verify-release.mjs: when three things are broken you want to know
// that now, not across three round trips).
//
//   node evals/surface/run.mjs
//
//   contract.mjs — the four functions, fail-closed verify, render limits,
//                  parse normalization. No network, no database.
//   identity.mjs — resolution is idempotent, convergent across surfaces, and
//                  never crosses persons. Fixture namespace, real Postgres.
//   pipeline.mjs — a Discord payload drives the WHOLE shared pipeline. This is
//                  the one that would fail if Law E3's contract were fiction.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = new URL("../..", import.meta.url).pathname;

const SUITES = [
  ["contract", "evals/surface/contract.mjs"],
  ["identity", "evals/surface/identity.mjs"],
  ["pipeline", "evals/surface/pipeline.mjs"],
];

let bad = 0;
for (const [name, path] of SUITES) {
  const t0 = Date.now();
  try {
    const { stdout } = await run("node", [path], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
    const tail = stdout.trim().split("\n").pop();
    console.log(`  ok   ${name.padEnd(9)} ${tail}  (${Date.now() - t0}ms)`);
  } catch (e) {
    bad++;
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").slice(-16).join("\n      ");
    console.log(`FAIL   ${name.padEnd(9)}\n      ${out}`);
  }
}
console.log(bad ? `\n${bad} of ${SUITES.length} surface suites FAILED` : `\nall ${SUITES.length} surface suites passed`);
process.exit(bad ? 1 : 0);
