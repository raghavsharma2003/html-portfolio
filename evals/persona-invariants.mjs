// RUNNER half of the persona invariant suite (docs/GENERALIZATION-AUDIT.md
// item 7; docs/SPEC-AGENT-LAYER.md §3/§7 G-E3). DATA lives in
// ./persona-invariants.data.mjs — safetyFloorChecks() (the subset CLAUDE.md
// and SPEC-AGENT-LAYER.md §3 call out as "not a per-agent choice": crisis
// helplines, never-deny-being-an-AI, NEVER MANIPULATE, spoken-register
// bullets) and meeraFullChecks() (everything else Meera's persona.ts text
// protects). That file's header has the exact partition and tally.
//
// This runner is agent-agnostic: it asks the registry for every registered
// AgentModule and runs BOTH check sets against each one — "the safety floor
// ... is asserted by the invariant suite against every registered module,
// not just Meera's" (SPEC-AGENT-LAYER.md §3). With exactly one registered
// module today (meera) this reproduces the pre-existing suite's 138/138
// exactly, by construction: safetyFloorChecks ∪ meeraFullChecks is an exact
// partition of those 138 checks, run once per registered module.
//
// Bundles its own entry from src/engine/agents/ (this workstream's exclusive
// directory — same self-bootstrap pattern as
// src/engine/__fixtures__/byte-identity.mjs), never from evals/.entry.ts,
// which is shared eval-suite plumbing WS-AGENT-PERSONA does not own
// (docs/SPEC-AGENT-LAYER.md §8).
//
//   node evals/persona-invariants.mjs
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLanes, safetyFloorChecks, meeraFullChecks } from "./persona-invariants.data.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const AGENTS_DIR = join(ROOT, "src/engine/agents");
const BUNDLE = join(AGENTS_DIR, ".eval-bundle.mjs");

execSync(
  `npx esbuild ${join(AGENTS_DIR, ".eval-entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(HERE, "stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);

const { listAgents } = await import(BUNDLE);

let pass = 0;
let fail = 0;
let floorFail = 0;
const report = (c, isFloor) => {
  if (c.cond) pass++;
  else {
    fail++;
    if (isFloor) floorFail++;
  }
  console.log(`${c.cond ? "PASS" : "FAIL"}  ${c.name}${c.extra ? "  " + c.extra : ""}`);
};

const agents = listAgents();
if (!agents.length) {
  console.log("FAIL  no registered agents — registry.listAgents() returned []");
  process.exit(1);
}

for (const agent of agents) {
  const lanes = buildLanes(agent);

  console.log(`\n── agent: ${agent.slug} — safety floor (crisis lines, never-deny-AI, NEVER MANIPULATE, spoken register) ──`);
  for (const c of safetyFloorChecks(agent, lanes)) report(c, true);

  console.log(`\n── agent: ${agent.slug} — full invariants ──`);
  for (const c of meeraFullChecks(agent, lanes)) report(c, false);
}

console.log(
  fail
    ? `\n${fail} of ${pass + fail} FAILURES (${floorFail} in the safety floor)`
    : `\nALL ${pass} CHECKS PASS across ${agents.length} registered agent${agents.length === 1 ? "" : "s"}`,
);
process.exitCode = fail ? 1 : 0;
