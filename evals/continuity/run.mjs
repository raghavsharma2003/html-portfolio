// WS-CONTINUITY — runs every OFFLINE suite and aggregates pass/fail.
//
//   node evals/continuity/run.mjs
//
// All four suites here are offline, DB-free and deterministic: they bundle the
// real source with esbuild on each run, so they gate the tree being shipped
// rather than a frozen copy.
//
// register.mjs is DELIBERATELY NOT in this list. It is generative (real model
// calls, real money) and is run by hand:
//
//   WSCONT_RUN_LLM=1 node evals/continuity/register.mjs 2
//
// Same rule evals/dbattery/d2.mjs is under, and for the same reason: keeping
// it out of the map is the mechanism that makes "this never runs in CI" true
// by construction rather than by remembering. G-C7 is nonetheless the gate
// that decides whether the change ships — see that file's header.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const SUITES = [
  ["parity.mjs", "G-C1 call parity, G-C5 byte-identity, negative control"],
  ["assembly.mjs", "G-C6 one assembler, G-C4 one assembly at connect, live tail budget"],
  ["pickup.mjs", "seam 2 / G-C3 pickup gap test, n=24"],
  ["seam3.mjs", "seam 3 channel-boundary readers"],
];

let failed = 0;
for (const [file, what] of SUITES) {
  console.log(`\n══ ${file} — ${what} ══`);
  const r = spawnSync("node", [`${HERE}${file}`], { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) failed++;
}
console.log(
  failed
    ? `\n${failed} of ${SUITES.length} continuity suites FAILED`
    : `\nall ${SUITES.length} continuity suites pass (offline). G-C7 (register) is generative — run it by hand.`,
);
process.exit(failed ? 1 : 0);
