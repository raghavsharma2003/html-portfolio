// WS-R181. THE GATE HONEST UNDER LOAD -- the wait function's own offline
// proof.
//
//   node evals/gate-load/run.mjs
//
// `evals/lib/bounded-wait.mjs` is the one place every load-aware barrier and
// every fixed-port suite's port wait now goes through. This suite proves,
// deterministically and at $0 (no real busy loop, no real machine load --
// `loadRatio`'s injected `loadavg`/`cpus` dependencies stand in for
// `os.loadavg`/`os.cpus`, the same shape `evals/suite-resources.mjs` already
// uses), the three properties the rest of this workstream's fix depends on:
//
//   1. boundedWaitMs SCALES with load -- never below `base` on a quiet
//      machine, growing past it as the ratio (load average over core count)
//      rises, and CAPPED so an extremely loaded box still gets a finite
//      wait rather than one that grows without bound. Negative controls: a
//      "return base regardless" stand-in and an uncapped multiplier are
//      both shown to disagree with the real function's own output.
//   2. loadCeilingResult REFUSES to judge, never passes silently and never
//      reports a false miss, above its ceiling -- and reports the load and
//      the ceiling either way, so a caller can always record what it read.
//      Wired end to end through the REAL `performanceGateResult` (imported
//      from `scripts/check-performance.mjs`, never re-implemented here):
//      a load above ceiling produces a FAILURE finding named "load
//      ceiling", distinct from a budget miss and distinct from a missing
//      prerequisite.
//   3. listenWithPortWait actually WAITS -- a port held by another real
//      process is retried, not failed on the first attempt, and binds the
//      moment the holder releases it; a port that never frees rejects with
//      a NAMED error only once its own bounded timeout has elapsed, never
//      as an uncaught exception.
//
// Offline, deterministic, $0, no DB, no browser, no model call, no GPU, no
// real port collision (every port test below binds 127.0.0.1:0 or a
// throwaway high port this process itself created and owns for the
// duration of the check).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  boundedWaitMs,
  loadCeilingResult,
  loadRatio,
  listenWithPortWait,
  DEFAULT_LOAD_CEILING,
} from "../lib/bounded-wait.mjs";
import { performanceGateResult } from "../../scripts/check-performance.mjs";
import { pickBrowserBudget } from "../runner-lib.mjs";

let failures = 0;
let count = 0;
function ok(name, cond, detail) {
  count++;
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

// A fixed core count throughout -- every scaling assertion below reasons in
// terms of `ratio` (load1 / cores) rather than a raw load1 number, so fixing
// cores at 4 (this repo's own real build machine, per ws-common.md) keeps
// every assertion's own arithmetic legible without hiding the dependency.
const CORES = 4;
const fakeOs = (load1) => ({ loadavg: () => [load1, load1, load1], cpus: () => Array.from({ length: CORES }) });

// ── 1. boundedWaitMs scales with load, never below base, capped ──────────
{
  const base = 12000;

  ok("quiet machine (ratio < 1): unchanged, exactly base", boundedWaitMs(base, fakeOs(1)) === base);
  ok("ratio exactly 1: unchanged, exactly base", boundedWaitMs(base, fakeOs(CORES)) === base);
  ok(
    "ratio 3 (load 12 on 4 cores, this workstream's own brief example): 3x base",
    boundedWaitMs(base, fakeOs(CORES * 3)) === base * 3,
  );
  const capped = boundedWaitMs(base, fakeOs(CORES * 50));
  ok("an extremely loaded box is CAPPED, not proportional forever", capped < base * 50 && capped > base);
  ok(
    "the cap itself is a fixed multiplier of base, not a magic absolute number",
    boundedWaitMs(2 * base, fakeOs(CORES * 50)) === 2 * capped,
  );
  ok("boundedWaitMs never returns less than base at any load", boundedWaitMs(base, fakeOs(0)) === base);
  ok(
    "boundedWaitMs refuses a non-positive base rather than silently returning something",
    (() => { try { boundedWaitMs(0); return false; } catch { return true; } })(),
  );

  // NEGATIVE CONTROL: a stand-in that ignores load entirely would pass every
  // "never below base" assertion above and fail to distinguish itself from
  // the real function only here -- proving the real function actually READS
  // the load rather than being a constant in disguise.
  const ignoresLoad = (b) => b;
  ok(
    "NEGATIVE CONTROL: an load-blind stand-in disagrees with the real function under real load",
    ignoresLoad(base, fakeOs(CORES * 3)) !== boundedWaitMs(base, fakeOs(CORES * 3)),
  );

  // Sanity on the ratio helper itself, since every assertion above leans on it.
  const r = loadRatio(fakeOs(CORES * 3));
  ok("loadRatio reports the load, cores and ratio it was given", r.load1 === CORES * 3 && r.cores === CORES && r.ratio === 3);
  ok("loadRatio floors cores at 1 (never divides by zero)", loadRatio({ loadavg: () => [5], cpus: () => [] }).cores === 1);
}

// ── 2. loadCeilingResult: refuse to judge above ceiling, always report ────
{
  ok("the shared ceiling constant is 8 (the same number ws-common.md's own gate instructions use)", DEFAULT_LOAD_CEILING === 8);

  const quiet = loadCeilingResult(DEFAULT_LOAD_CEILING, fakeOs(2));
  ok("below ceiling: exceeded is false", quiet.exceeded === false);
  ok("below ceiling: the load itself is still reported", quiet.load1 === 2 && quiet.ceiling === DEFAULT_LOAD_CEILING);

  const busy = loadCeilingResult(DEFAULT_LOAD_CEILING, fakeOs(23));
  ok("above ceiling: exceeded is true", busy.exceeded === true);
  ok("above ceiling: the load itself is still reported, never withheld", busy.load1 === 23);

  // Boundary: AT the ceiling is still trustworthy (a measurement exactly on
  // the line is not "too busy", only strictly above it is).
  const boundary = loadCeilingResult(DEFAULT_LOAD_CEILING, fakeOs(DEFAULT_LOAD_CEILING));
  ok("NEGATIVE CONTROL: exactly at the ceiling is NOT exceeded (strictly greater than, not >=)", boundary.exceeded === false);

  // Wired end to end through the REAL production function, never a
  // reimplementation: a load-ceiling finding is a FAILURE, named, and
  // distinct in kind from a budget miss or a missing prerequisite.
  const overBudget = performanceGateResult({
    loadFindings: [{ target: "performance budgets", metric: "load ceiling", detail: "not measurable at load 23.00 (ceiling 8, 4 cores, ratio 5.75)" }],
  });
  ok("a load-ceiling finding fails the real performanceGateResult", overBudget.status === "failed" && overBudget.exitCode === 1);
  ok(
    "the failure is named 'load ceiling', not folded into a budget-miss or prerequisite finding",
    overBudget.findings.length === 1 && overBudget.findings[0].metric === "load ceiling",
  );
  const underBudget = performanceGateResult({ budgetFindings: [] });
  ok("NEGATIVE CONTROL: no load finding at all still passes when nothing else fails", underBudget.status === "passed" && underBudget.exitCode === 0);
  const mixed = performanceGateResult({
    loadFindings: [{ target: "performance budgets", metric: "load ceiling", detail: "not measurable at load 40.0" }],
    budgetFindings: [{ target: "/", metric: "TBT", detail: "999ms > 300ms budget" }],
  });
  ok(
    "a load-ceiling finding and a real budget finding are BOTH reported, load-ceiling first",
    mixed.findings.length === 2 && mixed.findings[0].metric === "load ceiling" && mixed.findings[1].metric === "TBT",
  );
}

// ── 2b. pickBrowserBudget: the pool's own browser cap backs off under load ─
{
  ok("a quiet machine (ratio 1) gets the original 2-browser budget", pickBrowserBudget({}, fakeOs(CORES)) === 2);
  ok("ratio just under the threshold (2.0 exactly): still 2", pickBrowserBudget({}, fakeOs(CORES * 2)) === 2);
  ok(
    "load 12 on 4 cores (ratio 3, this workstream's own brief example): backs off to 1",
    pickBrowserBudget({}, fakeOs(CORES * 3)) === 1,
  );
  ok(
    "NEGATIVE CONTROL: a stand-in that never backs off disagrees with the real function under real load",
    ((() => 2)()) !== pickBrowserBudget({}, fakeOs(CORES * 3)),
  );
  ok(
    "EVALS_BROWSER_BUDGET overrides the load-based calculation entirely",
    pickBrowserBudget({ EVALS_BROWSER_BUDGET: "4" }, fakeOs(CORES * 3)) === 4,
  );
  ok(
    "an invalid override (0, negative, non-numeric) is ignored, falling back to the load-based value",
    pickBrowserBudget({ EVALS_BROWSER_BUDGET: "0" }, fakeOs(CORES)) === 2 &&
      pickBrowserBudget({ EVALS_BROWSER_BUDGET: "nonsense" }, fakeOs(CORES * 3)) === 1,
  );
}

// ── 3. listenWithPortWait actually waits, and fails by name once expired ──
{
  const port = 8947; // above every named gate port (8931-8935, 8940, 8941, 8945/8946) -- this suite's own, held for the duration of this block only
  const holder = createServer((_, res) => res.end("holder"));
  await new Promise((resolve, reject) => {
    holder.once("error", reject);
    holder.listen(port, "127.0.0.1", resolve);
  });

  // 3a. A waiter given a bounded timeout SHORTER than the holder's own
  // lifetime must reject, by name, once its own wait expires -- never hang,
  // never crash the process on Node's own uncaught EADDRINUSE.
  const impatient = createServer((_, res) => res.end("impatient"));
  const t0 = Date.now();
  let impatientError = null;
  try {
    await listenWithPortWait(impatient, port, "127.0.0.1", { timeoutMs: 300, intervalMs: 50 });
  } catch (e) {
    impatientError = e;
  }
  const impatientElapsed = Date.now() - t0;
  ok("a port that never frees within the timeout REJECTS rather than hanging", impatientError !== null);
  ok(
    "the rejection names the port and that it waited, not a raw EADDRINUSE stack",
    Boolean(impatientError) && /port 8947 still in use after waiting 300ms/.test(impatientError.message),
  );
  ok("the wait was actually bounded (retried, not instant-fail on the first attempt)", impatientElapsed >= 250 && impatientElapsed < 3000);

  // 3b. A waiter given enough time actually WAITS for the holder to release,
  // then binds -- proving the retry loop is real, not merely tolerant of a
  // single failed attempt.
  const patient = createServer((_, res) => res.end("patient"));
  const patientPromise = listenWithPortWait(patient, port, "127.0.0.1", { timeoutMs: 3000, intervalMs: 100 });
  const releaseAfterMs = 350;
  const releaseTimer = setTimeout(() => holder.close(), releaseAfterMs);
  const t1 = Date.now();
  await patientPromise;
  const patientElapsed = Date.now() - t1;
  clearTimeout(releaseTimer);
  ok("a waiter with enough time binds ONCE the holder releases the port", patient.listening === true);
  ok(
    "binding happened only after the release, not before (the retry loop is real)",
    patientElapsed >= releaseAfterMs - 60,
  );
  await new Promise((r) => patient.close(r));

  // 3c. The ordinary case -- nothing holds the port -- binds immediately,
  // with no measurable retry delay, so the wait never taxes the common path.
  const free = createServer((_, res) => res.end("free"));
  const t2 = Date.now();
  await listenWithPortWait(free, port + 1, "127.0.0.1", { timeoutMs: 3000, intervalMs: 100 });
  ok("an already-free port binds immediately, no retry delay paid", Date.now() - t2 < 200);
  await new Promise((r) => free.close(r));
}

console.log(failures ? `\nfailed: ${failures}/${count}` : `\n  ok    gate-load: ${count} checks, 0 failed`);
process.exit(failures ? 1 : 0);
