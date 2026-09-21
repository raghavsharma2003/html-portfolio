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
// A third resource was measured on 2026-09-08: seven concurrent mounted
// browser suites starved renderer frames for 5.2 and 8.8 seconds despite
// visible/editable controls. Browser work shares a two-slot budget across
// the pool and port lane; CPU work still uses the existing worker count.
// Classification follows actual automation imports in suite/helper source.

import { spawn } from "node:child_process";
import { availableParallelism, cpus } from "node:os";
// WS-R181. loadRatio is the one place load1/cores is computed — shared with
// the load-aware barriers and the performance gate's own load-ceiling
// refusal, so this budget's threshold and theirs can never drift apart by
// accident.
import { loadRatio } from "./lib/bounded-wait.mjs";

/** Suites that write a repo-shared file (`dist/`). Run serially, in registry
 * order, BEFORE the pool or the port lane starts — not merely in a lane
 * alongside them, because the pool's own suites (room-push included) must
 * see a `dist/` that is done being written, not one being written right now. */
// WS-R158: "rehearsal-personal" added — it runs its own `npx vite build`
// into the same shared `dist/` (`evals/rehearsal/personal.mjs`'s own
// `ensureBuilt()`, the identical hazard this file's own header already
// names for `rehearsal-follower`/`rehearsal-creator`), so it belongs here
// for the same reason, not a new one.
// `first-five-minutes` (WS-R164) imports evals/rehearsal/personal.mjs, whose
// module body runs `npx vite build` on the shared dist/, so it is a dist/
// writer too: pooled beside the browser suites it timed out on the first
// wave-22 batch gate and passed alone twice (the merge log, 2026-09-13).
// WS-R174: "rehearsal-person-room" added — it runs its own `npx vite build`
// into the same shared `dist/` (`evals/rehearsal/person-room.mjs`'s own
// `ensureBuilt()`), the identical hazard this file's own header already
// names for every other rehearsal that builds, so it belongs here for the
// same reason, not a new one.
export const PRE_POOL_SUITES = ["rehearsal-follower", "rehearsal-creator", "rehearsal-personal", "first-five-minutes", "rehearsal-person-room"];

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
 * WS-R181. The shared two-slot browser budget (measured 2026-09-08: seven
 * concurrent mounted browser suites starved renderer frames for 5.2 and 8.8
 * seconds despite visible/editable controls — this file's own header) was
 * calibrated on a machine running ONE gate. Ten siblings sharing this same
 * four-core box each run their own pool, each with its own two-browser
 * budget, so the real concurrent-Chromium count this machine sees is never
 * 2 — it is up to 2 x (however many sibling gates are mid-run), and TWO
 * browsers fighting for CPU that is ALREADY oversubscribed is exactly the
 * frame-starvation shape that measurement found in the first place.
 *
 * `EVALS_BROWSER_BUDGET` (a developer knob, never added to the manifest) if
 * set to a positive integer; else 1 above the SAME load ratio ceiling this
 * workstream's `boundedWaitMs`/`loadCeilingResult` use elsewhere (load1/cores
 * > 2 — half of `DEFAULT_LOAD_CEILING`'s own ratio at 4 cores, chosen
 * because a browser is far more CPU-hungry per instance than the ordinary
 * CPU-bound suites `pickWorkerCount` sizes for, so this budget backs off
 * sooner), else the original 2 on a quiet machine.
 */
export function pickBrowserBudget(env = process.env, opts = {}) {
  const override = Number(env.EVALS_BROWSER_BUDGET);
  if (Number.isInteger(override) && override >= 1) return override;
  const { ratio } = loadRatio(opts);
  return ratio > 2 ? 1 : 2;
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
export function createBrowserBudget(limit = 2) {
  if(!Number.isInteger(limit)||limit<1)throw new Error('browser budget must be a positive integer');
  let active=0;const listeners=new Set();
  return {
    limit,
    acquire() {
      if(active>=limit)return null;
      active++;let released=false;
      return ()=>{if(released)return;released=true;active--;for(const listener of [...listeners])listener();};
    },
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  };
}

export async function runPool(entries, concurrency, { cwd, onDone, browserBudget } = {}) {
  const results = new Array(entries.length);
  const n = Math.max(1, Math.min(concurrency, entries.length || 1));
  const pending=new Set(entries.map((_,i)=>i)),active=new Set();
  while(pending.size||active.size){
    for(const i of pending){
      if(active.size>=n)break;
      const {name,file,browser}=entries[i];
      const release=browser&&browserBudget?browserBudget.acquire():()=>{};
      if(!release)continue;
      pending.delete(i);
      const task=runSuiteFile(name,file,{cwd}).then(result=>{results[i]=result;if(onDone)onDone(result);}).finally(()=>{active.delete(task);release();});
      active.add(task);
    }
    if(!active.size&&!pending.size)break;
    let unsubscribe=()=>{};
    const change=browserBudget?new Promise(resolve=>{unsubscribe=browserBudget.subscribe(resolve);}):new Promise(()=>{});
    try{await Promise.race([...active,change]);}finally{unsubscribe();}
  }
  return results;
}
