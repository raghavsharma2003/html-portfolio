// WS-MULTIMODAL — runs both suites and aggregates pass/fail.
//
//   node evals/multimodal/run.mjs
//
// scene-gate.mjs is DB-free (bundles src/watch/scene.ts and
// src/components/useCallEngine.ts via esbuild, same recipe as
// evals/wsdepth-test-roundtrip.mjs) and always runs. db-writer.mjs needs a
// real NEON_URL (api/_config.js, gitignored) — if it is missing this reports
// that plainly and does not count it as a pass; it is not silently skipped.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function run(label, file) {
  console.log(`\n── ${label} ──`);
  const r = spawnSync("node", [file], { stdio: "inherit", cwd: ROOT });
  return r.status === 0;
}

const hasConfig = existsSync(`${ROOT}/api/_config.js`);

const sceneOk = run("scene-gate.mjs (offline)", `${HERE}scene-gate.mjs`);
let dbOk = true;
if (hasConfig) {
  dbOk = run("db-writer.mjs (real DB)", `${HERE}db-writer.mjs`);
} else {
  console.log(
    "\n── db-writer.mjs (real DB) ──\nSKIPPED — api/_config.js is absent, so this run cannot reach Postgres. " +
      "Not counted as a pass: rerun where the config is present before treating this gate as green.",
  );
  dbOk = false;
}

console.log(`\n${sceneOk && dbOk ? "ALL SUITES PASSED" : "SOME SUITES FAILED OR WERE UNVERIFIED"}`);
process.exit(sceneOk && dbOk ? 0 : 1);
