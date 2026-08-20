// evals/time/run.mjs — WS-TIME's whole gate, in one command.
//
//   node evals/time/run.mjs
//
// DB-free, network-free, model-free: the two clocks are pure functions and
// their gate is too, which is why this can run in the APK workflow alongside
// check-prompt-budget.mjs rather than only where NEON_URL exists.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { HERE } from "./_checks.mjs";

const suites = ["her.mjs", "his.mjs", "g1.mjs", "negative.mjs"];
const results = [];
for (const s of suites) {
  console.log(`\n════ evals/time/${s} ════`);
  try {
    execFileSync("node", [join(HERE, s)], { stdio: "inherit" });
    results.push([s, true]);
  } catch {
    results.push([s, false]);
  }
}
console.log("\n════ WS-TIME summary ════");
for (const [s, okay] of results) console.log(`  ${okay ? "PASS" : "FAIL"}  ${s}`);
process.exit(results.every(([, o]) => o) ? 0 : 1);
