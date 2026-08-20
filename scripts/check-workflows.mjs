#!/usr/bin/env node
// A workflow that cannot start is worse than a workflow that fails.
//
// `deploy-web.yml` gated its deploy job on `if: ${{ secrets.VERCEL_TOKEN != '' }}`.
// That reads like every other conditional in the file and it is invalid:
// GitHub does not evaluate the `secrets` context in a job-level `if:`. The
// failure is not a skipped job or a warning — the whole FILE becomes invalid
// and the run dies at startup having dispatched ZERO jobs.
//
// It did that on every push from 2026-08-11 to 2026-08-20. Fifteen consecutive
// red runs, each `created_at == run_started_at == updated_at` with
// `total_jobs: 0`. For nine days the site did not auto-deploy, and the
// annotation job whose entire purpose was to SAY the deploy was unconfigured
// never ran either — a startup failure takes the whole file down with it, the
// reporter included.
//
// Nothing in the repo could catch that, because the gates all run the code and
// this is a file the code never reads. Hence this: a lint over the workflow
// YAML itself, run by verify-release like everything else.
//
// The rule it encodes generalises past this one bug: a context is legal in
// SOME positions and not others, the illegal ones are silent locally, and the
// only feedback is a red run with no logs in it. Check the positions.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = ".github/workflows";

// Contexts GitHub does NOT evaluate in a job-level `if:`. `secrets` is the one
// that has actually bitten us; the others are listed because they fail the
// same silent way and the next person reaching for one deserves the error at
// commit time rather than nine days later.
// Source: GitHub's context-availability table (jobs.<job_id>.if accepts
// github, needs, vars, inputs and always()/success()/failure()/cancelled()).
const ILLEGAL_IN_JOB_IF = ["secrets", "env", "steps", "runner", "job", "matrix", "strategy"];

const problems = [];

function checkFile(name) {
  const path = join(DIR, name);
  const lines = readFileSync(path, "utf8").split("\n");

  // Deliberately a line scanner, not a YAML parse. The thing being checked is
  // WHERE an expression sits, and a parsed tree loses the two-space-indent
  // distinction between a job key and a step key that makes this decidable
  // without modelling GitHub's whole schema. Job keys sit at exactly four
  // spaces under `jobs:`; a step's `if:` is deeper and inside a `- ` list.
  let inJobs = false;
  lines.forEach((line, i) => {
    if (/^jobs:\s*$/.test(line)) { inJobs = true; return; }
    if (inJobs && /^\S/.test(line)) { inJobs = false; return; }
    if (!inJobs) return;

    const m = /^ {4}if:\s*(.+)$/.exec(line);
    if (!m) return;
    const expr = m[1];
    for (const ctx of ILLEGAL_IN_JOB_IF) {
      // `needs.configured.outputs.has_token` must not trip on a bare `job`
      // substring, so require the context to start a token.
      if (new RegExp(`(^|[^\\w.])${ctx}\\.`).test(expr)) {
        problems.push(
          `${path}:${i + 1}  job-level \`if:\` reads \`${ctx}.\` — GitHub does not evaluate ` +
            `the ${ctx} context here, and the whole workflow file becomes invalid ` +
            `(run dies at startup, zero jobs, no logs). Compute it in a step, ` +
            `expose it as a job output, and gate on \`needs.<job>.outputs.<name>\`.`,
        );
      }
    }
  });
}

let files = [];
try {
  files = readdirSync(DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
} catch {
  console.log("no .github/workflows — nothing to check");
  process.exit(0);
}

for (const f of files) checkFile(f);

if (problems.length) {
  console.error(`workflow lint: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`workflow lint ok — ${files.length} file(s), no illegal context in a job-level if:`);
