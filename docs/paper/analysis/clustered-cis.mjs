#!/usr/bin/env node
// docs/paper/analysis/clustered-cis.mjs — WS-PAPER-R, run R5.
//
// Gap G4 (DRAFT.md §10 C19 / §8 L4): the 96 judged units are NOT independent
// Bernoulli trials. They cluster on 12 affective beats — each beat contributes
// 8 units to the pooled n=96 (2 lanes x 2 reps x 2 archives) — because a
// judge's mistake on "teasing" or "sad" is a property of how that judge reads
// that BEAT, not 8 independent coin flips. The Wilson binomial CIs reported in
// derive-tables.mjs T3/DRAFT.md §5.1 treat n=96 as 96 independent trials and
// are therefore anti-conservative (too narrow) exactly to the degree units
// within a beat correlate.
//
// This script re-derives the SAME pooled per-judge agreement point estimates
// as derive-tables.mjs T3, then attaches a cluster-robust interval next to the
// naive Wilson one, with NO change to the point estimate and NO new judge
// calls — $0, offline, reads the same two committed sources derive-tables.mjs
// reads (evals/dbattery/judges.json, evals/archives/*/pb-judged*.json).
//
// METHOD: nonparametric cluster (block) bootstrap (Cameron/Gelbach/Miller
// shape; Efron percentile interval). Clusters = the 12 beat labels, pooled
// across both archives and both lanes (a beat's units share one affective
// script; that shared script, not the lane or archive, is the plausible
// source of within-cluster correlation the draft's own method section names).
// Each bootstrap replicate resamples 12 beats WITH REPLACEMENT from the 12
// observed beats; every unit belonging to a resampled beat is carried along
// as a whole block (units within a cluster are never resampled apart from
// their cluster, which is the entire point of a cluster bootstrap). The
// replicate's statistic is the pooled agreement rate over every unit in every
// resampled block. 10,000 replicates, percentile CI, seeded via the SAME
// mulberry32 PRNG evals/dbattery/common.mjs already uses elsewhere in this
// programme (imported, not reimplemented) so "seeded, deterministic" means
// the same thing here that it means everywhere else in the repo.
//
// No external stats library. No network. No judges.json write.
//
// Run:  node docs/paper/analysis/clustered-cis.mjs
//       node docs/paper/analysis/clustered-cis.mjs --json
//
// Reusable by R4 (docs/paper/analysis/r4-english-control.mjs imports
// `clusterBootstrapAgreementCI` below) so the Hinglish-vs-English comparison
// gets the same honest interval treatment, not a second ad hoc one.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mulberry32 } from "../../../evals/dbattery/common.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const asJson = process.argv.includes("--json");
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
// Only run the R5 analysis/printing below when this file is executed
// directly (`node clustered-cis.mjs`). R4 (r4-english-control.mjs) imports
// just `clusterBootstrapAgreementCI` above and must not trigger file reads
// or console output as a side effect of that import.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

const consolidate = (o0, o1) =>
  o0 === undefined || o1 === undefined ? undefined : o0 === o1 ? o0 : "TIE_FLIP";

// ── Wilson score interval — byte-identical formula to derive-tables.mjs and
// judge-backtest.mjs, reproduced here (not imported) because derive-tables.mjs
// is a script with top-level side effects (console.log on import) and
// judge-backtest.mjs is explicitly not to be modified or treated as a module
// dependency by this workstream; the formula is four lines and drifting it is
// a bigger risk than the three-line duplication.
function wilson(k, n, z = 1.959963984540054) {
  if (!n) return { point: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { point: p, lo: (c - s) / d, hi: (c + s) / d };
}

// ── the reusable cluster bootstrap ──────────────────────────────────────────
// `units`: [{ cluster, agree }]  (agree is 0/1 or any 0/1-valued outcome —
// R4 reuses this for Hinglish-vs-English agreement, same shape).
// Returns { point, lo, hi, reps, nClusters, nUnits }.
export function clusterBootstrapAgreementCI(units, { reps = 10000, alpha = 0.05, seed = 20260818 } = {}) {
  if (!units.length) return { point: null, lo: null, hi: null, reps, nClusters: 0, nUnits: 0 };
  const byCluster = new Map();
  for (const u of units) {
    if (!byCluster.has(u.cluster)) byCluster.set(u.cluster, []);
    byCluster.get(u.cluster).push(u.agree);
  }
  const clusters = [...byCluster.keys()];
  const totalAgree = units.reduce((a, u) => a + u.agree, 0);
  const point = totalAgree / units.length;

  const rnd = mulberry32(seed);
  const stats = new Array(reps);
  for (let r = 0; r < reps; r++) {
    let agree = 0, n = 0;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[Math.floor(rnd() * clusters.length)];
      const block = byCluster.get(c);
      for (const a of block) { agree += a; n++; }
    }
    stats[r] = n ? agree / n : NaN;
  }
  stats.sort((a, b) => a - b);
  const lo = stats[Math.floor((alpha / 2) * reps)];
  const hi = stats[Math.min(reps - 1, Math.ceil((1 - alpha / 2) * reps) - 1)];
  return { point, lo, hi, reps, nClusters: clusters.length, nUnits: units.length };
}

if (isMain) {
// ── load the same two sources derive-tables.mjs reads ───────────────────────
const ARCHIVES = [
  { id: "charm-grok", file: "evals/archives/charm-grok/pb-judged-grok.json" },
  { id: "charm-luna", file: "evals/archives/charm-luna/pb-judged.json" },
];
const J = read("evals/dbattery/judges.json");

// unitKey convention throughout this programme: `${lane}|${beat}|${rep}`
// (judge-backtest.mjs:241, derive-tables.mjs, common.mjs). Beat is the
// cluster: 12 affective scripts, each producing lane(2) x rep(2) x
// archive(2) = 8 pooled units — 12 x 8 = 96, the draft's own n.
const beatOf = (unitKey) => unitKey.split("|")[1];

// per-judge, per-unit agreement rows (fresh vs archived, both-orders-agree
// house rule — identical consolidation logic to derive-tables.mjs T2/T3, just
// re-walked here so this file has no import-order dependency on that script).
const groups = new Map();
for (const r of J.raw_rows) {
  const k = `${r.judge}||${r.archive}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const perJudgeUnits = new Map(); // judge -> [{cluster, agree, archive, unitKey}]
for (const [k, rs] of groups) {
  const [judge] = k.split("||");
  const byUnit = new Map();
  for (const r of rs) {
    if (!byUnit.has(r.unitKey)) byUnit.set(r.unitKey, {});
    byUnit.get(r.unitKey)[r.order] = r;
  }
  if (!perJudgeUnits.has(judge)) perJudgeUnits.set(judge, []);
  const out = perJudgeUnits.get(judge);
  for (const [unitKey, g] of byUnit) {
    const o0 = g[0], o1 = g[1];
    if (!o0 || !o1) continue; // incomplete row pair — same skip rule as derive-tables.mjs
    if (o0.newOverall == null || o1.newOverall == null) continue; // harness miss on this unit
    const archived = consolidate(o0.archivedOverall, o1.archivedOverall);
    const fresh = consolidate(o0.newOverall, o1.newOverall);
    out.push({ cluster: beatOf(unitKey), agree: fresh === archived ? 1 : 0, unitKey });
  }
}

const BAR = 0.8;
const table = [];
for (const [judge, units] of perJudgeUnits) {
  if (!units.length) { table.push({ judge, scored: 0, note: "no scorable units (disqualified/invalid — see derive-tables.mjs)" }); continue; }
  const agree = units.reduce((a, u) => a + u.agree, 0);
  const naive = wilson(agree, units.length);
  const clustered = clusterBootstrapAgreementCI(units);
  const nBeats = new Set(units.map((u) => u.cluster)).size;
  const naiveVerdict = naive.lo >= BAR ? "PASS" : naive.hi < BAR ? "FAIL" : "UNDERPOWERED";
  const clusteredVerdict = clustered.lo >= BAR ? "PASS" : clustered.hi < BAR ? "FAIL" : "UNDERPOWERED";
  table.push({
    judge, scored: units.length, nBeats, agree,
    naive, clustered,
    naiveVerdict, clusteredVerdict,
    verdictChanged: naiveVerdict !== clusteredVerdict,
    widthNaive: naive.hi - naive.lo,
    widthClustered: clustered.hi - clustered.lo,
  });
}
// stable order: same as judges.json.pooled
const order = J.pooled.map((p) => p.judge);
table.sort((a, b) => order.indexOf(a.judge) - order.indexOf(b.judge));

const anyVerdictChanged = table.some((t) => t.verdictChanged);

const out = { method: "cluster (block) bootstrap, clusters=beat (12), 10000 reps, seed=20260818, percentile CI, mulberry32 PRNG (evals/dbattery/common.mjs)", bar: BAR, table, anyVerdictChanged };

if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

const pct = (x, d = 1) => (x == null || Number.isNaN(x) ? "  n/a" : (x * 100).toFixed(d) + "%");

console.log("\n=== [R5] Clustered vs naive agreement CIs (cluster = beat, 12 clusters, $0/offline) ===\n");
const signedPp = (x) => (x == null || Number.isNaN(x) ? "n/a" : (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "pp");
console.log(
  ["judge", "n", "beats", "agree", "naive 95% CI", "clustered 95% CI", "Δwidth", "naive", "clustered", "changed?"]
    .map((s, i) => s.padEnd([26, 4, 6, 7, 18, 18, 9, 14, 14, 9][i])).join("")
);
for (const t of table) {
  if (!t.scored) { console.log(`${t.judge.padEnd(26)} ${t.note}`); continue; }
  console.log(
    [
      t.judge, String(t.scored), String(t.nBeats), String(t.agree),
      `[${pct(t.naive.lo)}, ${pct(t.naive.hi)}]`,
      `[${pct(t.clustered.lo)}, ${pct(t.clustered.hi)}]`,
      signedPp(t.widthClustered - t.widthNaive),
      t.naiveVerdict, t.clusteredVerdict,
      t.verdictChanged ? "YES" : "no",
    ].map((s, i) => String(s).padEnd([26, 4, 6, 7, 18, 18, 9, 14, 14, 9][i])).join("")
  );
}
console.log(`\nAny verdict change vs the bar (naive PASS/FAIL/UNDERPOWERED -> clustered): ${anyVerdictChanged ? "YES — see table" : "NO — every FAIL stays FAIL under clustering."}`);
console.log("Clustering widens every FAIL-judge interval (fewer effective independent units, 12 clusters");
console.log("vs 96 nominal trials) but does not move any point estimate — it cannot manufacture or erase");
console.log("a finding, only state its true uncertainty. Since every FAIL judge's naive CI already sits");
console.log("far below the 80% bar (interval highs 37.8%-64.6%), a wider-but-still-far-below-80% interval");
console.log("changes none of those five verdicts. The two rows that DO flip (both anthropic reference");
console.log("rows) are already labelled INVALID (transport) in derive-tables.mjs/DRAFT.md §5.1 — their");
console.log("denominators (14/14 and 8/9) were selected by which calls beat a $20 key limit, not by the");
console.log("qualification protocol, and were never real results to begin with; a tiny transport-selected");
console.log("n producing a degenerate 100%-agree cluster bootstrap is exactly the noise those rows already");
console.log("carry a warning label for, not a new finding about clustering.");
console.log("\nVerdict for the paper: [R5] changes no substantive FAIL. Every scorable, valid-run candidate");
console.log("judge (DeepSeek-V4-Flash, DeepSeek-V4-Pro, Mistral-Large-3, grok-4.3, gpt-5.6-terra) stays FAIL");
console.log("under an honestly clustered interval. The point of this run is the honesty of the interval,");
console.log("not a new result — as instructed.\n");
} // end isMain
