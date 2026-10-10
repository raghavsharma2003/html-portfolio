#!/usr/bin/env node
// WS-R96. THE DAY-ONE CHECKLIST — runs `docs/gurukul/DAY-ONE.md`'s own
// numbered path against a real deployment, for free, and prints each step as
// done, blocked (naming the env var or door BY NAME), or unknown (a manual
// step this script never runs itself). Every expectation comes from
// `scripts/dayOneRunbook.mjs`'s parse of the runbook's own table — never a
// second, hand-typed copy of the same steps — exactly the discipline
// `scripts/probeLiveExpectations.mjs`'s own header states for vercel.json.
//
//   node scripts/day-one.mjs <base-url> [--json]
//                             [--cookie-jar <file>] [--share <url>]
//
// Env (never printed, never logged):
//   VYAKTI_OPERATOR_SESSION   optional bearer session for an account on
//                             OPS_OWNER_USER_IDS. Given, every `self-check:`
//                             row is read from ONE `GET /api/ops` call.
//                             Absent, every such row prints `unknown: no
//                             operator bearer given` and this script never
//                             attempts the call — an unauthenticated GET on a
//                             configured board answers the identical
//                             courtesy 404 an unconfigured one gives, and a
//                             404 either way would teach nothing.
//
// NETWORK: exactly `scripts/probe-live.mjs`'s own network surface (GET/HEAD
// plus the two always-refused POST /api/room bodies, all against ONE base
// URL's origin), plus at most one additional GET (`/api/ops`). No POST that
// writes anything, no paid call, no sign-in, ever — this script proves what
// it can prove for $0 and reports every step it cannot as `manual`, per
// `docs/gurukul/DAY-ONE.md`'s own law.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { loadRunbook } from "./dayOneRunbook.mjs";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PROBE_LIVE = join(HERE, "probe-live.mjs");
const TIMEOUT_MS = 15_000;

function usage() {
  console.error(
    [
      "usage: node scripts/day-one.mjs <base-url> [--json] [--cookie-jar <file>] [--share <url>]",
      "",
      "  <base-url>            the deployment to check (one origin)",
      "  --cookie-jar <file>   forwarded to scripts/probe-live.mjs for a protected preview",
      "  --share <url>         forwarded to scripts/probe-live.mjs to prime that cookie jar",
      "",
      "env VYAKTI_OPERATOR_SESSION   an operator bearer session (see docs/gurukul/DAY-ONE.md)",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const out = { baseUrl: null, json: false, cookieJar: null, share: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--cookie-jar") out.cookieJar = argv[++i];
    else if (a === "--share") out.share = argv[++i];
    else rest.push(a);
  }
  out.baseUrl = rest[0] || null;
  return out;
}

/** Runs `scripts/probe-live.mjs <base-url> --json` as a child process and
 *  returns its parsed report, or `{error}` if it could not be run/parsed at
 *  all. A non-zero exit is expected and NOT an error here — probe-live.mjs
 *  exits 1 whenever it found findings, but still prints a full JSON report
 *  first; only a report that never parses (a crash before the JSON line, or
 *  a network failure to the base URL) counts as unusable. */
async function runProbeLive(baseUrl, { cookieJar, share } = {}) {
  const args = [PROBE_LIVE, baseUrl, "--json"];
  if (cookieJar) args.push("--cookie-jar", cookieJar);
  if (share) args.push("--share", share);
  try {
    const { stdout } = await run(process.execPath, args, { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
    return { report: JSON.parse(stdout) };
  } catch (e) {
    if (e.stdout) {
      try {
        return { report: JSON.parse(e.stdout) };
      } catch {
        /* fall through */
      }
    }
    return { error: (e && (e.stderr || e.message)) || String(e) };
  }
}

/** One `GET /api/ops` with the operator bearer, if any. Same same-origin and
 *  timeout discipline as probe-live.mjs's own client, restated here rather
 *  than imported — this file makes exactly one extra call, not a whole
 *  second HTTP client worth sharing. */
async function readOpsDoor(baseUrl, bearer) {
  if (!bearer) return { skipped: true };
  const url = new URL("/api/ops", baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${bearer}` },
      signal: controller.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* leave null */
    }
    if (res.status !== 200 || !body || body.ok !== true) {
      return { error: `GET /api/ops -> ${res.status}${body ? ` ${JSON.stringify(body).slice(0, 200)}` : " (unparseable body)"}` };
    }
    return { overview: body };
  } catch (e) {
    return { error: `GET /api/ops failed: ${e && e.message ? e.message : e}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `self-check-env` (WS-R102 widened): a name can fail this step TWO ways
 * now that `api/_self-check.js#runSelfCheck` reports both halves of
 * `envPresence` - a REQUIRED name missing still reads from
 * `self_check.failing_checks` exactly as before (unchanged: workstream law
 * 1 keeps an absent OPTIONAL name out of that list entirely), and an
 * OPTIONAL name absent now reads from the SEPARATE `self_check.
 * optional_absent` list `api/_ops.js#selfCheckOverview` exposes
 * (`docs/gurukul/DAY-ONE.md`'s own gap 1, the `OPTIONAL_ENV` half closed
 * WS-R102, the `docs/gurukul/ENV-MANIFEST.md` manifest half closed
 * WS-R116 - `self-check-env-all` below is the WS-R116 sibling for a row
 * needing MULTIPLE names present at once). A name on NEITHER list is
 * `REQUIRED_ENV`/`OPTIONAL_ENV`/`MANIFEST_ONLY_ENV` and present, or a name
 * genuinely absent from `docs/gurukul/ENV-MANIFEST.md` itself (e.g.
 * `OPS_OWNER_USER_IDS`, `OPENROUTER_API_KEY` - a document gap, not a
 * self-check gap, `context/decisions.md#ws-r116-day-one-rows-convert-
 * only-when-presence-was-the-whole-proof`) - either way this step has
 * nothing to report, so it reads `done`,
 * the same "absence of a finding is not proof of anything beyond what was
 * actually checked" honesty this script already carries for `probe-live`.
 */
export function judgeStep(step, { probeReport, probeError, opsResult }) {
  const p = step.proving;
  if (p.kind === "probe-live-whole" || p.kind === "probe-live-scoped") {
    if (!probeReport) return { status: "unknown", detail: `probe-live could not be run: ${probeError || "no report"}` };
    if (p.kind === "probe-live-whole") {
      if (probeReport.findings.length === 0) return { status: "done", detail: "probe-live: 0 findings" };
      return { status: "blocked", detail: `probe-live: ${probeReport.findings.length} finding(s)` };
    }
    const matches = probeReport.findings.filter((f) => String(f.surface || "").includes(p.substring));
    if (matches.length === 0) return { status: "done", detail: `probe-live: no finding matching "${p.substring}"` };
    return { status: "blocked", detail: `probe-live: ${matches.length} finding(s) matching "${p.substring}": ${matches[0].surface}` };
  }
  if (p.kind === "self-check-env" || p.kind === "self-check-env-all" || p.kind === "self-check-door") {
    if (opsResult.skipped) return { status: "unknown", detail: "no operator bearer given (set VYAKTI_OPERATOR_SESSION)" };
    if (opsResult.error) return { status: "unknown", detail: opsResult.error };
    const failing = opsResult.overview?.self_check?.failing_checks || [];
    if (p.kind === "self-check-env") {
      const door = `env: ${p.name} missing`;
      if (failing.includes(door)) return { status: "blocked", detail: `ops door: "${door}"` };
      const optionalAbsent = opsResult.overview?.self_check?.optional_absent || [];
      if (optionalAbsent.includes(p.name)) {
        return { status: "blocked", detail: `ops door: "optional, not set: ${p.name}"` };
      }
      return { status: "done", detail: `ops door: no "${door}" finding` };
    }
    if (p.kind === "self-check-env-all") {
      // WS-R116. Every name in the row must be present — the SAME two-list
      // check `self-check-env` runs above, for each name in turn, blocking
      // (and naming which one) at the FIRST name that fails either check.
      // `scripts/check-replica-env.mjs`'s own "LIVE only once every
      // required var is set" semantics restated over the ops door instead
      // of a local shell's env.
      const optionalAbsent = opsResult.overview?.self_check?.optional_absent || [];
      for (const name of p.names) {
        const door = `env: ${name} missing`;
        if (failing.includes(door)) return { status: "blocked", detail: `ops door: "${door}"` };
        if (optionalAbsent.includes(name)) return { status: "blocked", detail: `ops door: "optional, not set: ${name}"` };
      }
      return { status: "done", detail: `ops door: no finding for any of ${p.names.length} name(s)` };
    }
    const match = failing.find((d) => d.includes(p.substring));
    if (match) return { status: "blocked", detail: `ops door: "${match}"` };
    return { status: "done", detail: `ops door: no finding matching "${p.substring}"` };
  }
  if (p.kind === "manual") {
    return { status: "unknown", detail: `run by hand: ${p.instruction}` };
  }
  // Unreachable given dayOneRunbook.mjs's own validation, but never silently
  // treated as passing if it somehow happens.
  return { status: "unknown", detail: `unrecognised proving command: ${step.provingRaw}` };
}

async function main() {
  const { baseUrl, json, cookieJar, share } = parseArgs(process.argv.slice(2));
  if (!baseUrl) {
    usage();
    process.exit(2);
  }

  const { steps } = loadRunbook();

  const [{ report: probeReport, error: probeError }, opsResult] = await Promise.all([
    runProbeLive(baseUrl, { cookieJar, share }),
    readOpsDoor(baseUrl, process.env.VYAKTI_OPERATOR_SESSION || ""),
  ]);

  const results = steps.map((step) => ({ step, ...judgeStep(step, { probeReport, probeError, opsResult }) }));

  const counts = { done: 0, blocked: 0, unknown: 0 };
  for (const r of results) counts[r.status] += 1;

  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: counts.blocked === 0,
          baseUrl,
          counts,
          steps: results.map((r) => ({ n: r.step.n, step: r.step.step, status: r.status, detail: r.detail })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`day-one: ${steps.length} step(s) checked against ${baseUrl}\n`);
    for (const r of results) {
      const icon = { done: "DONE ", blocked: "BLKD ", unknown: "?    " }[r.status];
      console.log(`  [${icon}] ${String(r.step.n).padStart(3)}  ${r.step.step.padEnd(48)} ${r.detail}`);
    }
    console.log(`\n${counts.done} done, ${counts.blocked} blocked, ${counts.unknown} unknown (manual or unproven for free)`);
    if (counts.blocked) console.log("\nFAIL — one or more steps are blocked. See docs/gurukul/DAY-ONE.md for what each step needs.");
  }
  process.exit(counts.blocked === 0 ? 0 : 1);
}

// Guarded so `evals/day-one/run.mjs` can `import { judgeStep }` for a direct
// unit test of the WS-R102 optional-absent branch above without also
// running the whole CLI as a side effect of that import - `scripts/
// check-mirrors.mjs`'s own guard, restated.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("day-one: fatal:", e && e.stack ? e.stack : e);
    process.exit(1);
  });
}
