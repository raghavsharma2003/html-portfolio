// dryrun-check.mjs — WS-BATTERY. Runs BOTH judged-suite dry-runs
// (judge-backtest.mjs --dry-run, d2.mjs --dry-run) back to back and asserts
// each exits 0. $0, no network, deterministic — proves the D2 pipeline
// (pairing, both-orders, tallying, judge-config plumbing, output schema) end
// to end without spending anything, on every run.
//
// NOT added to evals/run.mjs. That file is owned exclusively by WS-EVAL
// (SPEC.md §13's file-ownership table), and its own header comment states
// the exclusion of D2+ from its suite map is a DELIBERATE mechanism ("the
// mechanism that makes 'D2+ never runs in CI' true by construction instead
// of by remembering") — not an oversight this workstream should paper over,
// even with a $0 dry-run variant. Both dry-runs individually measure well
// under the ~5s bar the task brief set for CI-worthiness (see WS-D2PREP's
// exit report), so the ONLY reason this stays standalone is file ownership,
// not speed. WS-EVAL (or the coordinator) can wire `node
// evals/dbattery/dryrun-check.mjs` into evals/run.mjs's suite map
// themselves — that edit belongs in their file, not this one.
//
//   node evals/dbattery/dryrun-check.mjs
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const checks = [
  { name: "judge-backtest --dry-run", file: "judge-backtest.mjs", args: ["--dry-run"] },
  { name: "d2 --dry-run (n=300, requesting the powered target on a 48-unit fixture on purpose — proves the cap-not-error path too)", file: "d2.mjs", args: ["--dry-run", "--n", "300"] },
];

let failed = 0;
for (const c of checks) {
  const t0 = Date.now();
  console.log(`\n── ${c.name} ──`);
  try {
    execFileSync("node", [join(HERE, c.file), ...c.args], { stdio: "inherit", cwd: ROOT });
    console.log(`PASS  ${c.name}  (${Date.now() - t0}ms)`);
  } catch {
    failed++;
    console.log(`FAIL  ${c.name}  (${Date.now() - t0}ms)`);
  }
}

// dry-run.mjs's own subprocess (judge-backtest.mjs --dry-run) writes
// judges.dryrun.json as a side effect — clean it up so this check leaves no
// artifact behind and can never be mistaken for touching the real judges.json.
try {
  const { unlinkSync, existsSync } = await import("node:fs");
  const p = join(HERE, "judges.dryrun.json");
  if (existsSync(p)) unlinkSync(p);
} catch {}

console.log(failed ? `\n${failed} DRY-RUN CHECK FAILURE(S)` : "\nDRY-RUN CHECK PASS — both judged-suite pipelines proven end to end at $0.");
process.exit(failed ? 1 : 0);
