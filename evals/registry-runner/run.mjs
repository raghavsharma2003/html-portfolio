// WS-R128. The self-test of evals/runner-lib.mjs's own concurrency core,
// against two FAKE suites written by this file — never a slice of the real
// 213-suite registry.
//
// Why fakes, not the real registry: the property under test is "does the
// pool preserve registry order and aggregate exit codes correctly," which is
// a property of the SCHEDULER, not of any real suite's content. A real suite
// takes tens of milliseconds to tens of seconds and would make this suite's
// own pass/fail depend on machine load, exactly the flake this workstream
// exists to buy speed WITHOUT introducing. A fake suite's timing is chosen
// by this file, so the ordering assertion is deterministic: fixture A always
// takes longer than fixture B, on any machine, because A's own sleep is
// longer by a wide margin (250ms vs 20ms) — no timing race close enough for
// scheduling jitter to flip it.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPool, runSuiteFile, pickWorkerCount } from "../runner-lib.mjs";

let fail = 0,
  count = 0;
const ok = (name, cond, extra = "") => {
  count++;
  if (!cond) {
    fail++;
    console.log(`FAIL  ${name}  ${extra}`);
  } else {
    console.log(`  ok  ${name}`);
  }
};

const dir = mkdtempSync(join(tmpdir(), "registry-runner-"));

// Fixture A: registered FIRST, finishes LAST (sleeps 250ms), exits 0.
const fixtureA = join(dir, "a.mjs");
writeFileSync(
  fixtureA,
  `console.log("A start");
   await new Promise((r) => setTimeout(r, 250));
   console.log("A end");
   process.exit(0);`,
);

// Fixture B: registered SECOND, finishes FIRST (sleeps 20ms), exits 1 — the
// suite that fails, printing to stderr the way a real assertion failure would.
const fixtureB = join(dir, "b.mjs");
writeFileSync(
  fixtureB,
  `console.log("B start");
   await new Promise((r) => setTimeout(r, 20));
   console.error("B failed on purpose");
   process.exit(1);`,
);

try {
  // ── runSuiteFile: one suite, output captured whole, exit code honoured ──
  const rOk = await runSuiteFile("fixture-pass", fixtureA);
  ok("a passing suite reports ok:true", rOk.ok === true);
  ok("its output carries both of its own lines", rOk.output.includes("A start") && rOk.output.includes("A end"));

  const rFail = await runSuiteFile("fixture-fail", fixtureB);
  ok("a failing suite (exit 1) reports ok:false", rFail.ok === false);
  ok(
    "a failing suite's stderr is still captured in the same buffer, not dropped",
    rFail.output.includes("B failed on purpose"),
  );

  // ── runPool: COMPLETION order (B first, A second) vs RESULT order ──
  // A is listed FIRST in `entries` but finishes LAST; with concurrency 2 both
  // start together, so completion order is B-then-A while the returned array
  // must stay in ENTRY order (A, B) — the property evals/run.mjs's own final
  // print loop depends on to read the same as the old serial loop regardless
  // of which suite actually finished first.
  const completionOrder = [];
  const entries = [
    { name: "slow-first", file: fixtureA },
    { name: "fast-second", file: fixtureB },
  ];
  const results = await runPool(entries, 2, { onDone: (r) => completionOrder.push(r.name) });

  ok(
    "the pool actually overlaps them (fast-second COMPLETES before slow-first, despite being listed second)",
    completionOrder[0] === "fast-second" && completionOrder[1] === "slow-first",
    JSON.stringify(completionOrder),
  );
  ok(
    "the RETURNED array preserves ENTRY (registry) order regardless of completion order",
    results[0].name === "slow-first" && results[1].name === "fast-second",
    JSON.stringify(results.map((r) => r.name)),
  );
  ok("registry-order result 0 (the slow, passing suite) is ok:true", results[0].ok === true);
  ok("registry-order result 1 (the fast, failing suite) is ok:false", results[1].ok === false);

  // ── exit-code aggregation, the same rule evals/run.mjs's tail applies ──
  const anyFailedTwoOfTwo = results.some((r) => !r.ok);
  ok("one failure in a two-suite batch aggregates to 'failed'", anyFailedTwoOfTwo === true);

  const bothPass = await runPool(
    [
      { name: "p1", file: fixtureA },
      { name: "p2", file: fixtureA },
    ],
    2,
  );
  ok("two passing suites aggregate to 'all passed'", bothPass.every((r) => r.ok) === true);

  // NEGATIVE CONTROL for the ordering assertion itself: a pool of
  // concurrency 1 (the --serial shape) forces B to run strictly AFTER A
  // finishes, so completion order becomes registry order too — proving the
  // out-of-order completion measured above came from real concurrency
  // (concurrency 2), not from a scheduler that happens to always finish
  // fast suites first regardless of the concurrency it was given.
  const serialCompletion = [];
  await runPool(
    [
      { name: "slow-first", file: fixtureA },
      { name: "fast-second", file: fixtureB },
    ],
    1,
    { onDone: (r) => serialCompletion.push(r.name) },
  );
  ok(
    "NEGATIVE CONTROL: at concurrency 1, completion order matches registry order (slow-first really did run first)",
    serialCompletion[0] === "slow-first" && serialCompletion[1] === "fast-second",
    JSON.stringify(serialCompletion),
  );

  // ── pickWorkerCount ──
  ok("EVALS_WORKERS overrides when set to a positive integer", pickWorkerCount({ EVALS_WORKERS: "3" }) === 3);
  ok("a non-numeric EVALS_WORKERS is ignored, not coerced to 0 or NaN workers", pickWorkerCount({ EVALS_WORKERS: "nope" }) >= 2);
  ok("with no override, the floor is 2 workers even on a single-core reading", pickWorkerCount({}) >= 2);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(fail ? `${fail} FAILURES of ${count}` : `ALL ${count} PASS`);
process.exit(fail ? 1 : 0);
