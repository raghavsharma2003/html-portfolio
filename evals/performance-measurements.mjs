// Actual gate decision functions with observed-run fixtures. No browser launched.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { evaluateBudgets, performanceGateResult, readSettledPerformance } from "../scripts/check-performance.mjs";

let checks = 0;
function check(name, fn) { fn(); console.log(`ok ${++checks} - ${name}`); }
function measured(overrides = {}) {
  return { lcpMs: 1200, lcpObserved: true, lcpObserverSupported: true, ...overrides };
}
function result(runs = [measured(), measured(), measured()]) {
  return {
    target: "/studio", runs, crashed: null, thirdPartyRenderBlocking: [],
    median: { lcpMs: 1200, cls: 0, tbtMs: 40, jsBytes: 1000, fontBytes: 0 },
  };
}
function outcome(value, evaluate = evaluateBudgets) {
  return performanceGateResult({ budgetFindings: evaluate(value), install: { findings: [] } });
}
function refuses(value, evaluate = evaluateBudgets) {
  const tested = outcome(value, evaluate);
  assert.equal(tested.exitCode, 1);
  assert.equal(tested.status, "failed");
  assert(tested.findings.some((finding) => finding.metric === "LCP measurement"));
  return tested;
}
check("three positive observed runs preserve normal pass", () => assert.equal(outcome(result()).exitCode, 0));
check("zero font transfer alone is permitted with valid observed LCP", () => assert.deepEqual(evaluateBudgets(result()), []));
const invalid = [
  ["null", { lcpMs: null }], ["zero", { lcpMs: 0 }], ["negative", { lcpMs: -1 }],
  ["undefined", { lcpMs: undefined }], ["NaN", { lcpMs: NaN }],
  ["positive infinity", { lcpMs: Infinity }], ["negative infinity", { lcpMs: -Infinity }],
  ["numeric string", { lcpMs: "1200" }], ["no observation", { lcpObserved: false }],
  ["missing observation flag", { lcpObserved: undefined }],
  ["unsupported observer", { lcpObserverSupported: false }],
  ["missing support flag", { lcpObserverSupported: undefined }],
];
for (const [name, override] of invalid) {
  check(`${name} in one run cannot hide behind two valid runs and a positive median`, () => {
    const tested = refuses(result([measured(), measured(override), measured()]));
    assert.equal(tested.findings.length, 1);
    assert.match(tested.findings[0].detail, /run 2:/);
  });
}
check("all three missing observations remain three named failures", () => {
  const value = result(Array.from({ length: 3 }, () => measured({ lcpMs: null, lcpObserved: false })));
  value.median.lcpMs = null;
  const tested = refuses(value);
  assert.equal(tested.findings.length, 3);
  assert(tested.findings.every((finding, index) => finding.detail.startsWith(`run ${index + 1}:`)));
});
for (const runs of [undefined, [], [measured(), measured()], [measured(), measured(), measured(), measured()]]) {
  check(`missing or wrong-size run set refuses (${runs?.length ?? "absent"})`, () => {
    const value = result(); value.runs = runs; refuses(value);
  });
}
check("null run refuses instead of crashing or coercing a value", () => refuses(result([measured(), null, measured()])));
check("valid observed LCP retains original 2500ms boundary", () => {
  const value = result(); value.median.lcpMs = 2500;
  assert.deepEqual(evaluateBudgets(value), []);
  value.median.lcpMs = 2501;
  const tested = outcome(value);
  assert.equal(tested.exitCode, 1);
  assert.deepEqual(tested.findings.map((finding) => finding.metric), ["LCP"]);
});
check("missing observation preserves independent TBT and font failures", () => {
  const value = result([measured(), measured({ lcpObserved: false }), measured()]);
  value.median.tbtMs = 301; value.median.fontBytes = 120 * 1024 + 1;
  assert.deepEqual(refuses(value).findings.map((finding) => finding.metric), ["LCP measurement", "TBT", "font transfer"]);
});
check("page errors retain missing-measurement findings", () => {
  const value = result([measured(), measured({ lcpMs: 0 }), measured()]); value.crashed = "fixture page error";
  assert.deepEqual(refuses(value).findings.map((finding) => finding.metric), ["LCP measurement", "page error"]);
});
check("Hindi wire field and 800ms boundary remain compatible with honest DOM label", () => {
  const value = result(); value.target = "studio-hi";
  value.median.hindiChunkWaitMs = 800; value.median.firstHindiPaintMs = 800;
  assert.deepEqual(evaluateBudgets(value), []);
  value.median.firstHindiPaintMs = 801;
  assert.deepEqual(evaluateBudgets(value).map((finding) => finding.metric), ["Hindi DOM text"]);
  value.median.firstHindiPaintMs = null;
  assert.match(evaluateBudgets(value)[0].detail, /no Devanagari DOM text/);
});

// Remove the actual caller's per-run guard in memory. Broken runs must become
// false passes under this mutation, demonstrating that the fixtures catch it.
const scriptUrl = new URL("../scripts/check-performance.mjs", import.meta.url);
let code = readFileSync(scriptUrl, "utf8");
const guard = "const findings = evaluateLcpMeasurements(result.runs);";
assert.equal(code.split(guard).length, 2, "actual caller guard must match exactly once");
code = code.replace(guard, "const findings = [];")
  .replace("const ROOT = rootFromModuleUrl(import.meta.url);", `const ROOT = rootFromModuleUrl(${JSON.stringify(scriptUrl.href)});`)
  .replace(/from\s+(["'])(\.[^"']+)\1/g, (_, quote, path) => `from ${quote}${new URL(path, scriptUrl).href}${quote}`);
const mutated = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
check("actual-source missing-guard mutant falsely admits every malformed-run fixture", () => {
  for (const [, override] of invalid) {
    const value = result([measured(), measured(override), measured()]);
    assert.equal(outcome(value, mutated.evaluateBudgets).exitCode, 0);
    assert.throws(() => refuses(value, mutated.evaluateBudgets), assert.AssertionError);
  }
});
check("actual-source mutant preserves ordinary budget failures", () => {
  const value = result(); value.median.tbtMs = 301;
  assert.equal(outcome(value, mutated.evaluateBudgets).exitCode, 1);
});
async function collect(initial, afterWait, read = readSettledPerformance) {
  let state = structuredClone(initial);
  const waits = [];
  const page = {
    evaluate: async fn => structuredClone(runInNewContext(`(${fn.toString()})()`, { window: { __PERF__: state } })),
    waitForFunction: async (fn, arg, options) => {
      waits.push(options);
      if (afterWait) state = structuredClone(afterWait);
      const ready = runInNewContext(`(${fn.toString()})()`, { window: { __PERF__: state } });
      if (!ready) throw new Error("bounded timeout");
    },
  };
  return { perf: await read(page), waits };
}
const initial = { lcp: null, lcpObserved: false, lcpObserverSupported: true, longtasks: [] };
const late = { ...initial, lcp: 3388, lcpObserved: true, longtasks: [100, 200] };
const settled = await collect(initial, late);
check("late paint waits once with a bound and preserves the navigation-relative clock", () => {
  assert.deepEqual(settled.waits, [{ timeout: 2500 }]);
  assert.deepEqual(settled.perf, late);
  // Zeroing the timestamp or starting a fresh clock must fail this same proof.
  for (const lcp of [0, 888]) assert.throws(() => assert.equal(lcp, settled.perf.lcp), assert.AssertionError);
});
check("successful late observation still fails the unchanged LCP budget", () => {
  const value = result(Array.from({ length: 3 }, () => measured({ lcpMs: settled.perf.lcp })));
  value.median.lcpMs = settled.perf.lcp;
  assert.equal(outcome(value).exitCode, 1);
  assert.deepEqual(outcome(value).findings.map(f => f.metric), ["LCP"]);
});
const missing = await collect(initial, null);
check("bounded timeout remains missing observation, never zero or a manufactured value", () => {
  assert.deepEqual(missing.waits, [{ timeout: 2500 }]);
  assert.deepEqual(missing.perf, initial);
  refuses(result(Array.from({ length: 3 }, () => measured({ lcpMs: missing.perf.lcp, lcpObserved: false }))));
});
const ready = await collect(late, null);
const unsupported = await collect({ ...initial, lcpObserverSupported: false }, null);
check("observed and unsupported observers do not extend the existing measurement window", () => {
  assert.deepEqual(ready.waits, []);
  assert.deepEqual(unsupported.waits, []);
});
const returnPerf = /  return perf;\r?\n\}/;
assert.ok(returnPerf.test(code), "actual settlement return is reachable by the negative control");
const resetClockCode = code.replace(returnPerf, "  return { ...perf, lcp: Math.max(0, (perf.lcp ?? 0) - 2500) };\n}");
const resetClock = await import(`data:text/javascript;base64,${Buffer.from(resetClockCode).toString("base64")}`);
const reset = await collect(initial, late, resetClock.readSettledPerformance);
check("actual-source reset-clock mutant falsifies the late-paint budget", () => {
  assert.throws(() => assert.equal(reset.perf.lcp, late.lcp), assert.AssertionError);
  const value = result(Array.from({ length: 3 }, () => measured({ lcpMs: reset.perf.lcp })));
  value.median.lcpMs = reset.perf.lcp;
  assert.equal(outcome(value).exitCode, 0, "mutant incorrectly admits the real 3388ms paint");
});
console.log(`${checks} performance measurement checks passed; no browser or timing benchmark run.`);
