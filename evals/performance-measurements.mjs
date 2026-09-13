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
// WS-R177: `/studio` and `studio-hi`'s own tighter TBT ceiling
// (`result.tbtBudget`), the identical override shape WS-R139 already
// proved for `jsBudget` — never a change to the shared 300ms `BUDGETS.tbtMs`
// every other target still uses. The negative controls that mutate the
// actual source live further down, alongside the file's other actual-source
// mutants, once `code` (the actual file text, import-path-rewritten) exists.
check("a target-specific TBT budget wins over the shared 300ms one", () => {
  const value = result(); value.tbtBudget = 150; value.median.tbtMs = 200;
  const tested = outcome(value);
  assert.equal(tested.exitCode, 1);
  assert.deepEqual(tested.findings.map((finding) => finding.metric), ["TBT"]);
  assert.match(tested.findings[0].detail, /200ms > 150ms budget/);
});
check("a target-specific TBT budget passes exactly at its own ceiling, not the shared one", () => {
  const value = result(); value.tbtBudget = 150; value.median.tbtMs = 150;
  assert.deepEqual(evaluateBudgets(value), []);
});
check("a target with no tbtBudget still uses the shared 300ms ceiling unchanged", () => {
  const value = result(); value.median.tbtMs = 200; // over 150, under 300 — must still pass
  assert.deepEqual(evaluateBudgets(value), []);
});
// WS-R177: the load-average context threaded into the TBT finding's own
// `detail` string ("the check records the load average it ran under in
// its ... finding text") — optional, defaulting to absent, so every call
// above with one argument stays byte-for-byte unaffected (proven by the
// checks above, none of which pass a second argument).
check("a TBT finding carries the load average when the caller supplies one", () => {
  const value = result(); value.median.tbtMs = 400;
  const tested = evaluateBudgets(value, { loadAverage: 12.34 });
  assert.equal(tested.length, 1);
  assert.match(tested[0].detail, /400ms > 300ms budget/);
  assert.match(tested[0].detail, /load average 12\.34/);
});
check("a TBT finding carries no load average text when the caller supplies none", () => {
  const value = result(); value.median.tbtMs = 400;
  const tested = evaluateBudgets(value);
  assert.equal(tested.length, 1);
  assert.doesNotMatch(tested[0].detail, /load average/);
});
check("a passing TBT measurement generates no finding regardless of load average", () => {
  const value = result(); value.median.tbtMs = 40;
  assert.deepEqual(evaluateBudgets(value, { loadAverage: 40 }), []);
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

// WS-R177's two negative controls, using the same actual-source `code`
// (already import-path-rewritten above) every other mutant in this file
// mutates further rather than re-deriving its own copy.
const tbtBudgetLine = "const tbtBudget = result.tbtBudget ?? BUDGETS.tbtMs;";
assert.equal(code.split(tbtBudgetLine).length, 2, "actual tbtBudget override line must match exactly once");
const withoutTbtBudgetOverride = code.replace(tbtBudgetLine, "const tbtBudget = BUDGETS.tbtMs;");
const tbtBudgetMutant = await import(`data:text/javascript;base64,${Buffer.from(withoutTbtBudgetOverride).toString("base64")}`);
check("negative control: dropping the tbtBudget override falsely passes a target that set one", () => {
  const value = result(); value.tbtBudget = 150; value.median.tbtMs = 200;
  assert.equal(outcome(value, tbtBudgetMutant.evaluateBudgets).exitCode, 0, "mutant incorrectly admits a 200ms TBT against a 150ms target budget");
});

const tbtFindingPush = 'findings.push({ metric: "TBT", detail: tbtFindingDetail(m.tbtMs, tbtBudget, loadAverage) });';
assert.equal(code.split(tbtFindingPush).length, 2, "actual TBT finding push must match exactly once");
const droppedLoadAverage = code.replace(tbtFindingPush, 'findings.push({ metric: "TBT", detail: tbtFindingDetail(m.tbtMs, tbtBudget, null) });');
const loadAverageMutant = await import(`data:text/javascript;base64,${Buffer.from(droppedLoadAverage).toString("base64")}`);
check("negative control: a TBT finding that drops the supplied load average loses its context", () => {
  const value = result(); value.median.tbtMs = 400;
  const tested = loadAverageMutant.evaluateBudgets(value, { loadAverage: 12.34 });
  assert.doesNotMatch(tested[0].detail, /load average/, "mutant should have silently dropped the load average this proof is written to catch");
});

console.log(`${checks} performance measurement checks passed; no browser or timing benchmark run.`);
