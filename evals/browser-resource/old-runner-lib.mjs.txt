// The concurrency core behind evals/run.mjs, pulled into its own module so
// evals/registry-runner/run.mjs can drive it directly against two fake
// suites rather than the real 213-suite registry. Nothing in here knows
// what a "suite" means beyond {name, file}: no persona, no room, no db.
//
// WS-R128. The eval suite (`evals/run.mjs`) ran its 213 suites one after
// another in a single process, `execSync`, `stdio: "inherit"`. On the
// four-core machine this repo builds on that is 230-240 seconds of a
// ten-minute gate spent mostly idle-CPU: each suite is its own Node process,
// most touch no port and no shared file, and nothing stopped them running at
// once except the registry being a plain `for` loop. This buys the wall
// clock back with no change to what is proven: same suites, same pass/fail
// rule, same exit code, output printed whole and in registry order so a
// failure reads exactly as it did in the old serial loop.
//
// The two shapes of hidden shared state this repo's suites actually have
// (found by reading every `listen(` and every fixed-path write in evals/,
// not by running the pool and hoping):
//
//   - A SHARED-FILE WRITER. `evals/rehearsal/harness.mjs`'s `startHarness`
//     runs a real `npx vite build` into the repo's one `dist/`, and
//     `evals/room-push/run.mjs` reads `dist/room-sw.js` and `dist/room.html`
//     that build produces. Two of those writing at once race on the same
//     files; a write racing the read can hand `room-push` a half-written
//     `dist/`. These run SERIALLY, before the pool starts, never inside it.
//   - A PORT-BOUND suite. `evals/probe-live/run.mjs` (8940),
//     `evals/room-push/run.mjs` (8941) and `evals/day-one/run.mjs` (8945)
//     each bind one FIXED loopback port rather than an OS-assigned one —
//     unlike `evals/first-room/run.mjs`, `evals/earbench/`,
//     `evals/voice-listening-benchmark/` and `evals/rehearsal/harness.mjs`
//     itself, which all pass port 0 and are pool-safe by construction. Three
//     distinct fixed ports never collide with each other, but naming them
//     is what makes that true rather than assumed, and a fourth suite taking
//     one of 8931-8946 without reading this file would silently reintroduce
//     the hazard. They run in their own single-lane queue, one at a time,
//     alongside the pool rather than inside it.
//
// Everything else in the registry already writes to `mkdtempSync(tmpdir(),
// ...)` or binds port 0 (grep `evals/*.mjs` and `evals/*/run.mjs` for
// `join(tmpdir(),` and `listen(` before adding a suite that does neither).
//
// A suite that fails in the pool and passes serially is a suite with a THIRD
// shape of hidden shared state this sweep did not find. Fix the suite —
// its own temp dir, its own port — never this file. See
// context/rejected.md for the one this workstream did find.

import { spawn } from "node:child_process";
import { availableParallelism, cpus } from "node:os";

/** Suites that write a repo-shared file (`dist/`). Run serially, in registry
 * order, BEFORE the pool or the port lane starts — not merely in a lane
 * alongside them, because the pool's own suites (room-push included) must
 * see a `dist/` that is done being written, not one being written right now. */
export const PRE_POOL_SUITES = ["rehearsal-follower", "rehearsal-creator"];

/** Suites that bind one FIXED loopback port. Never run two of these at once
 * even though their ports differ today — the lane, not the port numbers, is
 * the guarantee a fifth fixed-port suite can rely on without re-deriving it. */
export const PORT_LANE_SUITES = ["probe-live", "room-push", "day-one"];

/** N workers: `EVALS_WORKERS` if set to a positive integer (a developer
 * knob, not a deployment env var — never added to the manifest), else
 * `os.availableParallelism() - 1` floored at 2, so a build never claims
 * every core on the box and never drops to a single worker either. */
export function pickWorkerCount(env = process.env) {
  const override = Number(env.EVALS_WORKERS);
  if (Number.isInteger(override) && override >= 1) return override;
  const n = typeof availableParallelism === "function" ? availableParallelism() : cpus().length;
  return Math.max(2, n - 1);
}

/**
 * Runs one suite file as a child process. Stdout and stderr are captured
 * into ONE buffer in arrival order (not two separate ones printed back to
 * back) so a suite that interleaves console.log/console.error reads the same
 * whole as it would under `stdio: "inherit"`.
 *
 * Returns { name, file, ok, ms, output }. Never throws — a spawn failure
 * (missing file, non-zero exit) is reported in `ok`/`output`, exactly like
 * `execSync` catching in the old loop.
 */
export function runSuiteFile(name, file, { cwd, nodePath = process.execPath } = {}) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(nodePath, [file], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (buf) => chunks.push(buf));
    child.stderr.on("data", (buf) => chunks.push(buf));
    child.on("error", (err) => {
      chunks.push(Buffer.from(String(err?.stack || err)));
      resolve({ name, file, ok: false, ms: Date.now() - t0, output: Buffer.concat(chunks).toString("utf8") });
    });
    child.on("close", (code) => {
      resolve({
        name,
        file,
        ok: code === 0,
        ms: Date.now() - t0,
        output: Buffer.concat(chunks).toString("utf8"),
      });
    });
  });
}

/**
 * Runs `entries` (an array of {name, file}) through `concurrency` workers.
 * Each worker pulls the next unclaimed entry until none remain — a plain
 * shared-index queue, not a fixed static split, so a slow suite does not
 * starve a fast worker sitting idle beside it.
 *
 * `onDone(result)` fires as each suite finishes, in COMPLETION order, for a
 * live progress line; the returned array preserves `entries`' own order
 * regardless of completion order, which is what lets the caller print
 * everything back out in registry order afterward.
 */
export async function runPool(entries, concurrency, { cwd, onDone } = {}) {
  const results = new Array(entries.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= entries.length) return;
      const { name, file } = entries[i];
      const r = await runSuiteFile(name, file, { cwd });
      results[i] = r;
      if (onDone) onDone(r);
    }
  };
  const n = Math.max(1, Math.min(concurrency, entries.length || 1));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}
