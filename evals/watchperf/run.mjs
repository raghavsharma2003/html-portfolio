// WS-WATCHPERF — both halves of the screen-share performance work, run
// together and aggregated.
//
//   node evals/watchperf/run.mjs
//
//   watchlat   — the frame-latency harness. Compiles and RUNS the real
//                SceneReader.java and the real WatchPacer.java against a
//                modelled clock, encoder and uplink, in three arms, and
//                asserts the things that are large and one-directional: no
//                wake is lost to the two frame accountings disagreeing, no
//                wake rides a still frame that was never delivered, and no
//                held frame waits multiple seconds.
//
//   watchaudio — "let her hear it". Runs the real PcmMix against real PCM,
//                then proves BY POSITION, against the real source, that
//                nothing in the floor arbiter can so much as name the media
//                buffers. That second half is the one that matters: the
//                barge-in floor is the most expensively measured thing in
//                this repo and a media stream that could move it would
//                invalidate all of it silently.
//
// WIRED HERE AND IN .github/workflows/build-apk.yml, deliberately, and NOT in
// evals/run.mjs. Both suites need a JDK — they compile and run the shipping
// Java — and evals/run.mjs is what `scripts/verify-release.mjs` calls on every
// developer machine, most of which have node and no javac. Putting them there
// would turn "no JDK installed" into "the release gate is red", which is how a
// gate gets commented out. The APK workflow installs temurin 21 because it has
// to build the APK, so that is where Java gates belong.
//
// Neither suite is ever silently skipped: without javac each one FAILS, for
// the reason native-gate.mjs states — an unrun check is indistinguishable
// from a check that would have failed.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const suites = [
  ["watchlat — frame latency (needs javac)", "evals/watchlat/run.mjs"],
  ["watchaudio — the media mixer and its floor (needs javac)", "evals/watchaudio/mix-gate.mjs"],
];

let failed = 0;
for (const [label, file] of suites) {
  console.log(`\n══ ${label} ══`);
  const r = spawnSync("node", [file], { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) failed++;
}

console.log(
  failed ? `\n${failed} of ${suites.length} WS-WATCHPERF suites FAILED` : `\nboth WS-WATCHPERF suites passed`,
);
process.exit(failed ? 1 : 0);
