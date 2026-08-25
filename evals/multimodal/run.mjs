// WS-MULTIMODAL — runs both suites and aggregates pass/fail.
//
//   node evals/multimodal/run.mjs             # every suite, DB included
//   node evals/multimodal/run.mjs --offline   # the two that need no Postgres
//
// ── WHY --offline EXISTS (WS-LIFECYCLE, 2026-08-23) ──────────────────────
//
// This file was written, was correct, and was invoked by NOTHING: no
// workflow, not verify-release, not evals/run.mjs. `dead-writers`, fifth
// instance — and the more dangerous half of it, because a gate that nobody
// runs produces false confidence rather than no data.
//
// It cannot go in `evals/run.mjs`: native-gate.mjs compiles and RUNS
// SceneReader.java, so it needs a JDK, and `evals/run.mjs` is run from
// verify-release on machines that have none. The one job that already
// installs temurin to build the APK is `build-apk.yml`, which is exactly
// where evals/watchperf already lives for exactly this reason — so that is
// where this is now wired, beside it.
//
// But that job builds `api/_config.js` with `--stub`: the file EXISTS with
// every value empty. So the `existsSync` test below would say "config is
// present", db-writer would run, and it would fail against an empty
// NEON_URL — a red build reporting a defect that is not there. `--offline`
// is the honest answer: it names the DB half as OUT OF SCOPE for this runner
// rather than skipping it quietly, and the un-flagged invocation (which is
// what a developer with real credentials runs) is unchanged.
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

const offline = process.argv.slice(2).includes("--offline");
const hasConfig = existsSync(`${ROOT}/api/_config.js`);

const sceneOk = run("scene-gate.mjs (offline)", `${HERE}scene-gate.mjs`);
// WS-ANDROID-WATCH: the native lane's half. Offline too, but it needs a JDK
// (it compiles and RUNS the real SceneReader.java). Without javac it reports
// UNVERIFIED and fails rather than skipping — same rule as db-writer below.
const nativeOk = run("native-gate.mjs (offline, needs javac)", `${HERE}native-gate.mjs`);
let dbOk = true;
if (offline) {
  console.log(
    "\n── db-writer.mjs (real DB) ──\nOUT OF SCOPE for this runner (--offline). It is not skipped and not " +
      "assumed green: it is a separate gate that needs a real NEON_URL, and it runs from " +
      "`node evals/multimodal/run.mjs` with no flag wherever api/_config.js carries one.",
  );
} else if (hasConfig) {
  dbOk = run("db-writer.mjs (real DB)", `${HERE}db-writer.mjs`);
} else {
  console.log(
    "\n── db-writer.mjs (real DB) ──\nSKIPPED — api/_config.js is absent, so this run cannot reach Postgres. " +
      "Not counted as a pass: rerun where the config is present before treating this gate as green.",
  );
  dbOk = false;
}

const allOk = sceneOk && nativeOk && dbOk;
console.log(`\n${allOk ? "ALL SUITES PASSED" : "SOME SUITES FAILED OR WERE UNVERIFIED"}`);
process.exit(allOk ? 0 : 1);
