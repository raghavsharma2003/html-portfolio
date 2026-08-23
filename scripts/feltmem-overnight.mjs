// One-command orchestrator for the powered felt-memory run, gated on
// EVAL-ONLY Google keys so production's free pool is never touched.
//
//   EVAL_GOOGLE_KEY=AIza... node scripts/feltmem-overnight.mjs [--confirm]
//
// Order, each step gating the next:
//   1. probe: the eval key must serve one tiny generation (fresh quota).
//   2. qualify: judge-backtest the gemini-flash judge config (free, ~192
//      calls). Pooled agreement >= 80% or STOP - an unqualified judge's
//      verdict is noise by SPEC 10-Q5, and running the battery under it
//      would burn quota to learn nothing.
//   3. battery: FELTMEM_RUN_JUDGED=1 run.mjs --live with this judge.
//      Generation rides the SAME eval keys (never the production pool).
//   4. drain: consolidate-first-run --confirm until lag is 0.
// Without --confirm it prints the plan and quota arithmetic only.
import { spawnSync } from "node:child_process";

const CONFIRM = process.argv.includes("--confirm");
const KEY = process.env.EVAL_GOOGLE_KEY || "";
const KEYS = (process.env.EVAL_GOOGLE_KEYS || KEY).split(",").filter(Boolean);
const NEEDED_CALLS = 660 + 1320 + 200; // gen + judge + backtest, rounded up
const CAP_PER_KEY = 200;               // measured free-tier daily serve
const keysNeeded = Math.ceil(NEEDED_CALLS / CAP_PER_KEY);

console.log(`── feltmem overnight plan ──`);
console.log(`  calls needed   ~${NEEDED_CALLS} (gen 660 + judge 1320 + backtest ~200)`);
console.log(`  keys provided  ${KEYS.length} (need ~${keysNeeded} fresh AIza keys at ${CAP_PER_KEY}/day each)`);
if (!KEYS.length) { console.log(`  STOP: set EVAL_GOOGLE_KEY / EVAL_GOOGLE_KEYS (comma-separated).`); process.exit(1); }
if (KEYS.length < keysNeeded) console.log(`  WARN: under-provisioned - the run may 429 partway and resume next reset.`);
if (!CONFIRM) { console.log(`  plan only - re-run with --confirm to execute.`); process.exit(0); }

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  return r.status === 0;
};

// 1. probe one key
const probe = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(KEYS[0])}`,
  { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: "ok" }] }], generationConfig: { maxOutputTokens: 2 } }) },
);
console.log(`  probe: ${probe.status}`);
if (!probe.ok) { console.log("  STOP: eval key not serving (bad key or quota)."); process.exit(1); }

// 2. qualify the flash judge
if (!run("node", ["evals/dbattery/judge-backtest.mjs", "--judge", "evals/dbattery/judge-candidates/gemini-36-flash-free.json"],
  { WSBAT_RUN_BACKTEST: "1" })) process.exit(1);
const judges = JSON.parse((await import("node:fs")).readFileSync("evals/dbattery/judges.json", "utf8"));
const q = (judges.qualified_panel || []).includes("google/gemini-3.6-flash");
console.log(`  flash judge qualified: ${q}`);
if (!q) { console.log("  STOP: flash failed the 80% bar - the powered run waits for a qualified judge."); process.exit(1); }

// 3. the battery
if (!run("node", ["evals/feltmem/run.mjs", "--live",
  "--judge", "evals/dbattery/judge-candidates/gemini-36-flash-free.json", "--max-spend", "1"],
  { FELTMEM_RUN_JUDGED: "1" })) process.exit(1);

// 4. drain consolidation
for (let i = 0; i < 12; i++) if (!run("node", ["scripts/consolidate-first-run.mjs", "--confirm"])) break;
console.log("── overnight run complete ──");
