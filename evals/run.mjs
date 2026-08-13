// The eval suite, runnable from a clean checkout: bundles the REAL source
// first, then runs every suite against the bundle. This exists because the
// suites lived only in a session scratchpad for two days — core IP protecting
// the crisis helplines and the parser, discoverable by exactly nobody, and one
// container reap away from gone. An eval that is not in version control
// protects nothing.
//
//   node evals/run.mjs           # all suites
//   node evals/run.mjs parse     # one suite
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BUNDLE = join(HERE, ".bundle.mjs");

// parsetest.v2 taught this the hard way: a frozen bundle passes forever while
// the source rots. Rebuild from source on every run, no cache.
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(HERE, "stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);

const suites = { parse: "parse.mjs", persona: "persona-invariants.mjs", fixtures: "fixtures.mjs" };
const pick = process.argv[2];
let failed = 0;
for (const [name, file] of Object.entries(suites)) {
  if (pick && pick !== name) continue;
  console.log(`\n── ${name} ──`);
  try {
    execSync(`node ${join(HERE, file)}`, { stdio: "inherit", cwd: ROOT });
  } catch {
    failed++;
  }
}
process.exit(failed ? 1 : 0);
