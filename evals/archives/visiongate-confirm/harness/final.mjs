import fs from "fs";
import { loadBefore, loadV4b, agg } from "./analyze.mjs";
import { wilsonCI, twoPropZ } from "./stats.mjs";

const b = loadBefore();
const v = loadV4b();
const bA = agg(b.rowSets, b.verdictSets);
const vA = agg(v.rowSets, v.verdictSets);

// ---- fabrication, assertion level (the powered comparison) ----
const fabZ = twoPropZ(bA.fabAssert, bA.assertN, vA.fabAssert, vA.assertN);
const fabCI_before = wilsonCI(bA.fabAssert, bA.assertN);
const fabCI_v4b = wilsonCI(vA.fabAssert, vA.assertN);

// ---- engagement, call level ----
const engZ = twoPropZ(bA.spoke, bA.n, vA.spoke, vA.n);
const engCI_before = wilsonCI(bA.spoke, bA.n);
const engCI_v4b = wilsonCI(vA.spoke, vA.n);

// ---- canonical archived n=240/arm engagement figure (visiongate-interim, zero new spend) ----
const archBeforeSpoke = 49, archBeforeN = 240, archV4bSpoke = 100, archV4bN = 240;
const engZ_archived = twoPropZ(archBeforeSpoke, archBeforeN, archV4bSpoke, archV4bN);

// ---- spend, this confirmatory run only ----
const spend = fs
  .readFileSync("out/spend.log", "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
const totalCalls = spend.reduce((s, r) => s + r.calls, 0);
const totalTokIn = spend.reduce((s, r) => s + r.tokIn, 0);
const totalTokOut = spend.reduce((s, r) => s + r.tokOut, 0);

const report = {
  arms: {
    before_baseline: {
      directive: "pre-retune WATCH_COMMENT_DIRECTIVE (recovered from git dd0a04c^, the line removed in that commit)",
      calls: bA.n,
      spoken: bA.spoke,
      engagementRate: bA.spoke / bA.n,
      assertN: bA.assertN,
      fabAssert: bA.fabAssert,
      fabricationRate: bA.fabAssert / bA.assertN,
    },
    shipped_retuned_v4b: {
      directive: "current src/engine/persona.ts WATCH_COMMENT_DIRECTIVE (= mf/dirs/v4b_comment.txt, byte-verified identical)",
      calls: vA.n,
      spoken: vA.spoke,
      engagementRate: vA.spoke / vA.n,
      assertN: vA.assertN,
      fabAssert: vA.fabAssert,
      fabricationRate: vA.fabAssert / vA.assertN,
    },
  },
  fabrication_powered_comparison: {
    n_before: bA.assertN,
    n_v4b: vA.assertN,
    both_arms_meet_n300: bA.assertN >= 300 && vA.assertN >= 300,
    before_rate: fabCI_before,
    v4b_rate: fabCI_v4b,
    diff_v4b_minus_before: fabZ.diff,
    ci95_diff: fabZ.ci95,
    z: fabZ.zStat,
    p_two_sided: fabZ.pTwoSided,
  },
  engagement_this_run_pooled: {
    n_before: bA.n,
    n_v4b: vA.n,
    before_rate: engCI_before,
    v4b_rate: engCI_v4b,
    diff_v4b_minus_before: engZ.diff,
    ci95_diff: engZ.ci95,
    z: engZ.zStat,
    p_two_sided: engZ.pTwoSided,
    caveat:
      "pooled across batches run at different times; batch-level engagement rate swung considerably for the before-arm (20.4% archived n=240 -> 8.0% on the first new 736-call batch), consistent with fab-noise-floor's documented finding that this harness has large batch-level noise even on identical inputs — treat the pooled figure, not any single batch, as the estimate.",
  },
  engagement_archived_canonical: {
    note: "visiongate-interim's original n=240/arm figure, recomputed here unchanged for reference (zero new spend)",
    n_before: archBeforeN,
    n_v4b: archV4bN,
    before_rate: archBeforeSpoke / archBeforeN,
    v4b_rate: archV4bSpoke / archV4bN,
    diff: engZ_archived.diff,
    ci95_diff: engZ_archived.ci95,
    p_two_sided: engZ_archived.pTwoSided,
  },
  spend_this_confirmatory_run: {
    model: "grok-4-20-non-reasoning",
    endpoint: "Azure AI Foundry (AZURE_OPENAI_ENDPOINT), Microsoft-for-Startups credits",
    calls: totalCalls,
    tokensIn: totalTokIn,
    tokensOut: totalTokOut,
    costUsd: 0, // credits program — no per-token Azure price for this deployment is recorded anywhere in the repo; not fabricating one
    breakdown: spend,
  },
};

fs.writeFileSync("report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
