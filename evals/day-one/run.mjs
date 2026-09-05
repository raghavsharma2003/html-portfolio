// WS-R96. THE DAY-ONE CHECKLIST'S OWN OFFLINE PROOF.
//
//   node evals/day-one/run.mjs
//
// Two things are proved, matching this workstream's own brief exactly:
//
//   1. `scripts/dayOneRunbook.mjs#parseRunbook` against `docs/gurukul/
//      DAY-ONE.md`'s REAL table (never a second, hand-typed copy of the
//      steps) — the happy path, plus THE REQUIRED NEGATIVE CONTROL: a
//      runbook row with its Proving Command cell blanked out must fail the
//      WHOLE parse, never silently pass as "manual" or get skipped.
//   2. `scripts/day-one.mjs` run as a real subprocess against
//      `evals/day-one/fakeServer.mjs` (itself a thin wrapper around the REAL
//      `evals/probe-live/fakeServer.mjs`) in three states — stub config,
//      half configured, complete — plus a fourth run with no operator
//      bearer at all, proving every `self-check:` row degrades to `unknown`
//      rather than guessing.
//
// Offline, deterministic, $0, no DB, no real network (127.0.0.1 only), no
// model call, no GPU, no browser.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseRunbook, RUNBOOK_PATH } from "../../scripts/dayOneRunbook.mjs";
import { startDayOneFixture, VALID_OPERATOR_BEARER } from "./fakeServer.mjs";

// Async execFile, never execFileSync — the fixture server runs IN THIS SAME
// PROCESS, and a synchronous child call would block the event loop the
// fixture's own HTTP server needs to answer on, deadlocking until the
// child's timeout fires. Same lesson `evals/probe-live/run.mjs`'s own header
// already states, restated here because it is the exact shape this suite
// reuses (a fixture server plus a subprocess CLI hitting it).
const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DAY_ONE = join(ROOT, "scripts", "day-one.mjs");
const PORT = 8945; // distinct from probe-live's own 8940 and the layout/perf/a11y/headers gates' 8931-8935

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function runDayOne(baseUrl, { bearer } = {}) {
  const env = { ...process.env };
  if (bearer) env.VYAKTI_OPERATOR_SESSION = bearer;
  else delete env.VYAKTI_OPERATOR_SESSION;
  try {
    const { stdout } = await run(process.execPath, [DAY_ONE, baseUrl, "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
      env,
    });
    return { exitCode: 0, report: JSON.parse(stdout) };
  } catch (e) {
    let report = null;
    try {
      report = JSON.parse(e.stdout || "");
    } catch {
      /* leave null */
    }
    return { exitCode: e.code ?? 1, report, stderr: e.stderr, stdout: e.stdout };
  }
}

function stepStatus(report, n) {
  const step = report?.steps?.find((s) => s.n === n);
  return step ? step.status : `(no step ${n} in report)`;
}

async function main() {
  // ── 1a. parseRunbook against the REAL doc: sanity shape ─────────────────
  {
    const { steps } = parseRunbook(readFileSync(RUNBOOK_PATH, "utf8"));
    check("real runbook parses", Array.isArray(steps) && steps.length > 0, `${steps?.length} steps`);
    check("real runbook steps are numbered 1..N with no gaps", steps.every((s, i) => s.n === i + 1), JSON.stringify(steps.map((s) => s.n)));
    const kinds = new Set(steps.map((s) => s.proving.kind));
    check(
      "real runbook uses only the documented proving-command kinds",
      [...kinds].every((k) => ["probe-live-whole", "probe-live-scoped", "self-check-env", "self-check-door", "manual"].includes(k)),
      [...kinds].join(", "),
    );
    check("real runbook has at least one probe-live row", steps.some((s) => s.proving.kind.startsWith("probe-live")));
    check("real runbook has at least one self-check row", steps.some((s) => s.proving.kind.startsWith("self-check")));
    check("real runbook has at least one manual row", steps.some((s) => s.proving.kind === "manual"));
  }

  // ── 1b. THE REQUIRED NEGATIVE CONTROL: a row with no proving command ────
  {
    const real = readFileSync(RUNBOOK_PATH, "utf8");
    // Blank out step 2's Proving Command cell (`self-check:env:NEON_URL`)
    // specifically -- a targeted, minimal mutation of the REAL doc text,
    // never a hand-built fixture table that could drift from the real
    // column shape.
    const mutated = real.replace(
      "| self-check:env:NEON_URL |",
      "|  |",
    );
    check("mutation actually changed the text", mutated !== real, "replace() found nothing to replace -- the row text this control targets may have moved");
    let threw = null;
    try {
      parseRunbook(mutated);
    } catch (e) {
      threw = e;
    }
    check("a row with a blank Proving Command cell fails the WHOLE parse", threw instanceof Error, threw ? "(no throw)" : "parsed without error");
    check(
      "the thrown error names the step number and cell reason",
      threw && /step 2/.test(threw.message) && /Proving Command/i.test(threw.message),
      threw?.message,
    );
  }

  // ── 1c. a second negative control: cell count drift is also caught ──────
  {
    const real = readFileSync(RUNBOOK_PATH, "utf8");
    const mutated = real.replace("| 1 | Confirm the stub baseline on both projects | none | both | $0 |", "| 1 | Confirm the stub baseline on both projects | none | both |");
    check("mutation actually changed the text", mutated !== real);
    let threw = null;
    try {
      parseRunbook(mutated);
    } catch (e) {
      threw = e;
    }
    check("a row with a dropped column also fails the whole parse", threw instanceof Error, threw ? "(no throw)" : "parsed without error");
  }

  // ── 2. day-one.mjs against the fixture, three self-check states ─────────
  const cases = [
    {
      name: "stub config",
      state: "stub",
      // NEON_URL and OPENROUTER_KEY both report missing -> steps 2 and 7 blocked.
      expect: { 1: "done", 2: "blocked", 7: "blocked" },
    },
    {
      name: "half configured",
      state: "half",
      // required env present; one migration family missing -> step 2/7 done, step 3 blocked.
      expect: { 1: "done", 2: "done", 3: "blocked", 7: "done" },
    },
    {
      name: "complete",
      state: "complete",
      expect: { 1: "done", 2: "done", 3: "done", 7: "done" },
    },
  ];

  for (const c of cases) {
    const { server, stop, url } = await startDayOneFixture(PORT, { selfCheckState: c.state });
    try {
      const { exitCode, report, stderr } = await runDayOne(url, { bearer: VALID_OPERATOR_BEARER });
      check(`${c.name}: day-one.mjs ran and produced a report`, !!report, stderr);
      if (!report) continue;
      for (const [n, want] of Object.entries(c.expect)) {
        check(`${c.name}: step ${n} is "${want}"`, stepStatus(report, Number(n)) === want, `got "${stepStatus(report, Number(n))}"`);
      }
      // Every `manual:` row must be `unknown`, never silently "done" -- this
      // script must NEVER claim a manual step passed.
      const manualSteps = report.steps.filter((s) => /run by hand/.test(s.detail));
      check(`${c.name}: every manual row is "unknown"`, manualSteps.length > 0 && manualSteps.every((s) => s.status === "unknown"), JSON.stringify(manualSteps.filter((s) => s.status !== "unknown")));
      // Exit code must be 0 exactly when there are zero blocked rows.
      const wantExit = report.counts.blocked === 0 ? 0 : 1;
      check(`${c.name}: exit code matches counts.blocked`, exitCode === wantExit, `exit ${exitCode}, counts ${JSON.stringify(report.counts)}`);
    } finally {
      await stop();
    }
  }

  // ── 3. no operator bearer: every self-check row degrades to unknown ─────
  {
    const { stop, url } = await startDayOneFixture(PORT, { selfCheckState: "complete" });
    try {
      const { report } = await runDayOne(url, {}); // no bearer
      check("no bearer: report produced", !!report);
      if (report) {
        check("no bearer: step 1 (probe-live) still done", stepStatus(report, 1) === "done", stepStatus(report, 1));
        check("no bearer: step 2 (self-check) is unknown", stepStatus(report, 2) === "unknown", stepStatus(report, 2));
        check("no bearer: step 7 (self-check) is unknown", stepStatus(report, 7) === "unknown", stepStatus(report, 7));
        const step2 = report.steps.find((s) => s.n === 2);
        check("no bearer: step 2's detail names the env var to set", /VYAKTI_OPERATOR_SESSION/.test(step2?.detail || ""), step2?.detail);
      }
    } finally {
      await stop();
    }
  }

  // ── 4. an unreachable base URL never crashes, never claims "done" ───────
  {
    const { report, exitCode } = await runDayOne("http://127.0.0.1:1", {});
    check("unreachable base URL: report still produced (no crash)", !!report);
    if (report) {
      check("unreachable base URL: no step is ever reported done", report.steps.every((s) => s.status !== "done"), JSON.stringify(report.steps.filter((s) => s.status === "done")));
      check("unreachable base URL: exit code 0 (nothing BLOCKED, only unknown)", exitCode === 0, `exit ${exitCode}`);
    }
  }

  console.log(`\n${failures === 0 ? "ok" : "FAIL"}  ${failures} failing check(s)`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("evals/day-one: fatal:", e && e.stack ? e.stack : e);
  process.exit(1);
});
