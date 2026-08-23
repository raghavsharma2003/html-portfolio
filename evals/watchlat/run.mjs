// WS-WATCHPERF — the frame-latency harness.
//
//   node evals/watchlat/run.mjs            # tables + assertions
//   node evals/watchlat/run.mjs --json     # raw rows, for diffing runs
//
// WHY THIS EXISTS. The owner's report was "the latency of her grabbing what's
// on screen is very bad". Nothing in this repo could answer it. The audio
// floor has `evals/echosim`, which drives the REAL liveCall.ts and can prove a
// change did not move it; the screen-share pacing had no equivalent, because
// it lived inside an Android foreground service that needs a MediaProjection,
// a VirtualDisplay and an ImageReader to exist at all. So the pacing policy
// was extracted into `WatchPacer.java` — pure, no Android imports, exactly the
// discipline `SceneReader.java` already follows — and this compiles and RUNS
// it against the real geometry.
//
// WHAT IS REAL AND WHAT IS A MODEL is stated at the top of
// evals/watchlat/java/LatSim.java and must be read before any number here is
// quoted. In short: SceneReader.java and WatchPacer.java are the shipping
// files; the clock, the encode cost and the uplink queue are a model with
// named parameters. This is a harness for the SHAPE of a latency change, not
// a substitute for the on-device trace — which is why the same change also
// ships the instrumentation that produces one.
//
// THE THREE ARMS:
//   before          — PacerBaseline, a photograph of the pre-WS-WATCHPERF
//                     service policy. NOT a gate, NOT shipping code.
//   after           — the shipping WatchPacer.
//   after-linkgate  — the shipping WatchPacer plus a REJECTED uplink
//                     pre-check, kept so its numbers stay a record.
//
// Needs a JDK. Without javac this FAILS rather than skipping, for the reason
// native-gate.mjs states: an unrun check is indistinguishable from one that
// would have failed.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const AND = join(ROOT, "android/app/src/main/java/app/meera/companion");
const HERE = join(ROOT, "evals/watchlat/java");
const json = process.argv.includes("--json");

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};

const javac = spawnSync("javac", ["-version"], { encoding: "utf8" });
if (javac.error) {
  console.log(
    "UNVERIFIED — no javac on PATH, so the real pacing policy could not be run.\n" +
      "This suite is NOT skipped: it fails, because an unrun latency check is\n" +
      "indistinguishable from a latency check that would have failed.",
  );
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "watchlat-"));
const JENV = { ...process.env };
delete JENV.JAVA_TOOL_OPTIONS; // a proxy/truststore banner would eat the output
execFileSync(
  "javac",
  [
    "-d", tmp, "-nowarn",
    join(AND, "SceneReader.java"),
    join(AND, "WatchPacer.java"),
    join(HERE, "PacerBaseline.java"),
    join(HERE, "LatSim.java"),
  ],
  { stdio: ["ignore", "ignore", "inherit"], env: JENV },
);

const raw = execFileSync("java", ["-cp", tmp, "app.meera.companion.LatSim"], {
  encoding: "utf8",
  env: JENV,
});
const rows = raw
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("{"))
  .map((l) => JSON.parse(l));

if (json) {
  for (const r of rows) console.log(JSON.stringify(r));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n) => String(v).padStart(n);

console.log(
  "\nWS-WATCHPERF frame latency — 4 scenarios x 2 encode costs x 2 links x 3 arms,\n" +
    "8 tick-phase offsets each (which 120ms tick a stop lands between is luck,\n" +
    "and at n=1 that luck is several hundred ms wide).\n",
);
console.log(
  "  heldMed/Worst = screen stopped -> a HELD frame ACTUALLY delivered\n" +
    "  wakeMed/Worst = screen stopped -> the SHOW wake ACTUALLY sent\n" +
    "  lost          = wakes the service allowed and the engine refused (no wake at all)\n" +
    "  ungr          = SHOW wakes sent with NO still frame really delivered behind them\n" +
    "  refd          = frames the uplink refused, i.e. encodes thrown away\n",
);

const scenarios = [...new Set(rows.map((r) => r.scenario))];
for (const sc of scenarios) {
  console.log(`\n── ${sc} ──`);
  console.log(
    `  ${pad("link/enc", 14)}${pad("arm", 16)}${num("heldMed", 8)}${num("heldWorst", 10)}` +
      `${num("wakeMed", 8)}${num("wakeWorst", 10)}${num("lost", 6)}${num("ungr", 6)}${num("refd", 6)}`,
  );
  for (const link of ["good", "jittery"]) {
    for (const enc of [30, 80]) {
      for (const arm of ["before", "after", "after-linkgate"]) {
        const r = rows.find(
          (x) => x.scenario === sc && x.link === link && x.encodeMs === enc && x.arm === arm,
        );
        if (!r) continue;
        console.log(
          `  ${pad(`${link}/${enc}ms`, 14)}${pad(arm, 16)}${num(r.heldMed, 8)}${num(r.heldWorst, 10)}` +
            `${num(r.wakeMed, 8)}${num(r.wakeWorst, 10)}${num(r.wakesLost, 6)}${num(r.ungrounded, 6)}${num(r.refused, 6)}`,
        );
      }
    }
  }
}

// ── the assertions ─────────────────────────────────────────────────────────
// Deliberately NOT "after is faster than before in every cell". It is not, and
// claiming it would be a lie the harness itself can disprove: the two arms do
// not see the same tick grid, BY CONSTRUCTION — moving the encoder off the
// capture loop is precisely what changes the loop's period, and SceneReader's
// hold thresholds are derived from the timestamps it is driven at. On a good
// link the arms therefore differ by ±150ms in both directions and that is grid
// noise, not a pipeline result.
//
// What IS asserted is the part that is large, one-directional, and structural:
// the wake stops evaporating, the grounding stops being violated, and the
// worst case stops being multiple seconds.
console.log("\n── assertions ──");

const after = rows.filter((r) => r.arm === "after");
const before = rows.filter((r) => r.arm === "before");

ok(
  "no wake is ever lost to the two accountings disagreeing (after)",
  after.every((r) => r.wakesLost === 0),
  JSON.stringify(after.filter((r) => r.wakesLost > 0).map((r) => `${r.scenario}/${r.link}`)),
);
ok(
  "the defect is real: the baseline DOES lose wakes on a jittery link",
  before.some((r) => r.link === "jittery" && r.wakesLost > 0),
  "negative control — if this passes trivially the harness is not exercising the bug",
);
ok(
  "no wake ever rides a still frame that was not delivered (after)",
  after.every((r) => r.ungrounded === 0),
  JSON.stringify(after.filter((r) => r.ungrounded > 0).map((r) => `${r.scenario}/${r.link}`)),
);
ok(
  "the grounding defect is real: the baseline DOES fire ungrounded wakes",
  before.some((r) => r.ungrounded > 0),
  "negative control",
);
ok(
  "the baseline's worst case exceeds 2.5s of dead wait somewhere",
  before.some((r) => r.heldWorst > 2500),
  "negative control for the idle-beat stall",
);
ok(
  "after: no held frame ever waits more than 1.5s",
  after.every((r) => r.heldWorst >= 0 && r.heldWorst <= 1500),
  JSON.stringify(after.map((r) => [`${r.scenario}/${r.link}/${r.encodeMs}`, r.heldWorst])),
);
ok(
  "after: a SHOW wake fires in every single run of every cell",
  after.every((r) => r.wakeNever === 0 && r.heldNever === 0),
  JSON.stringify(after.filter((r) => r.wakeNever || r.heldNever).map((r) => r.scenario)),
);
ok(
  "after: wake latency no longer depends on encode cost (spread <= 150ms per cell)",
  scenarios.every((sc) =>
    ["good", "jittery"].every((link) => {
      const c = after.filter((r) => r.scenario === sc && r.link === link).map((r) => r.wakeMed);
      return c.length < 2 || Math.max(...c) - Math.min(...c) <= 150;
    }),
  ),
  "the whole point of moving the encoder off the capture loop",
);
ok(
  "the rejected link-gate arm is measured, not asserted: it wins on waste",
  rows
    .filter((r) => r.arm === "after-linkgate" && r.link === "jittery")
    .every((r) => {
      const a = after.find(
        (x) => x.scenario === r.scenario && x.link === r.link && x.encodeMs === r.encodeMs,
      );
      return r.refused <= a.refused;
    }),
  "if this ever fails, the reason WatchPacer gives for rejecting it is stale",
);

console.log(
  failed
    ? `\n${failed} assertion(s) FAILED`
    : `\nall assertions passed (${rows.length} cells, ${rows[0].runs} runs each)`,
);
process.exit(failed ? 1 : 0);
