#!/usr/bin/env node
// docs/paper/analysis/r2-pooled-per-axis.mjs — WS-PAPER-R, run R2 (companion script).
//
// R2's own tables (r2-axis-decomposition.mjs --report) are per-judge x per-axis
// (30 cells, 5 judges x 6 new axes). This script pools across the 5 judges,
// per axis, the same way judges.json's own "pooled" row pools across archives
// for `overall` — one clustered-CI number per axis, so "does failure
// concentrate on register/humour vs brevity/specificity" has a single honest
// answer per axis instead of 5 separate eyeballed rows. $0, offline, reads
// only the already-written docs/paper/analysis/r2/judge-rows.json (this run's
// own committed output) and evals/dbattery/judges.json (`overall`, reused
// from R0, never re-judged — see r2-axis-decomposition.mjs's header for why).
//
// Method: identical cluster (block) bootstrap to clustered-cis.mjs
// (clusterBootstrapAgreementCI, imported not reimplemented), cluster=beat
// (12), 10,000 reps, seed 20260818. The only difference from that script's
// own per-judge tables is what gets pooled INTO one set of units before the
// bootstrap runs: here, every judge's agree/disagree units for a given axis,
// rather than one judge's units across archives.
//
// Run: node docs/paper/analysis/r2-pooled-per-axis.mjs
// Writes: docs/paper/analysis/r2/pooled-per-axis.json

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clusterBootstrapAgreementCI } from "./clustered-cis.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const rows = JSON.parse(readFileSync(join(ROOT, "docs/paper/analysis/r2/judge-rows.json"), "utf8"));
const J = JSON.parse(readFileSync(join(ROOT, "evals/dbattery/judges.json"), "utf8"));

const consolidate = (o0, o1) => (o0 === undefined || o1 === undefined ? undefined : o0 === o1 ? o0 : "TIE_FLIP");
const beatOf = (unitKey) => unitKey.split("|")[1];
function wilson(k, n, z = 1.959963984540054) {
  if (!n) return { point: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { point: p, lo: (c - s) / d, hi: (c + s) / d };
}

const JUDGES = ["DeepSeek-V4-Flash", "DeepSeek-V4-Pro", "Mistral-Large-3", "gpt-5.6-terra", "grok-4.3"];
const NEW_AXES = ["warmth", "humour", "register", "specificity", "brevity", "personhood"];

// pooled across all 5 judges: each judge contributes its own agree/disagree
// units; cluster = beat (same convention as R0/R4/R5's pooled tables — beat-
// level correlation, not judge-level, is what the cluster bootstrap corrects
// for; pooling judges together is the same move R0's own "pooled" row makes
// pooling archives together).
function unitsForAxis(axis) {
  const rs = rows.filter((r) => r.axis === axis);
  const byJudgeUnit = new Map();
  for (const r of rs) {
    const k = `${r.judge}|${r.archive}|${r.unitKey}`;
    if (!byJudgeUnit.has(k)) byJudgeUnit.set(k, {});
    byJudgeUnit.get(k)[r.order] = r;
  }
  const units = [];
  for (const [, g] of byJudgeUnit) {
    const o0 = g[0], o1 = g[1];
    if (!o0 || !o1) continue;
    if (o0.newAxisValue == null || o1.newAxisValue == null) continue;
    const archived = consolidate(o0.archivedAxisValue, o1.archivedAxisValue);
    const fresh = consolidate(o0.newAxisValue, o1.newAxisValue);
    units.push({ cluster: beatOf(o0.unitKey), agree: fresh === archived ? 1 : 0 });
  }
  return units;
}

// `overall` — REUSED from R0 (evals/dbattery/judges.json.raw_rows), pooled the
// same way, so it sits in this table on equal footing with the six new axes.
function unitsForOverall() {
  const groups = new Map();
  for (const r of J.raw_rows) {
    const k = `${r.judge}||${r.archive}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const units = [];
  for (const judge of JUDGES) {
    for (const [k, rs] of groups) {
      const [j2] = k.split("||");
      if (j2 !== judge) continue;
      const byUnit = new Map();
      for (const r of rs) {
        if (!byUnit.has(r.unitKey)) byUnit.set(r.unitKey, {});
        byUnit.get(r.unitKey)[r.order] = r;
      }
      for (const [unitKey, g] of byUnit) {
        const o0 = g[0], o1 = g[1];
        if (!o0 || !o1) continue;
        if (o0.newOverall == null || o1.newOverall == null) continue;
        const archived = consolidate(o0.archivedOverall, o1.archivedOverall);
        const fresh = consolidate(o0.newOverall, o1.newOverall);
        units.push({ cluster: beatOf(unitKey), agree: fresh === archived ? 1 : 0 });
      }
    }
  }
  return units;
}

const pooled = {};
for (const axis of [...NEW_AXES, "overall"]) {
  const units = axis === "overall" ? unitsForOverall() : unitsForAxis(axis);
  const agree = units.reduce((a, u) => a + u.agree, 0);
  const naive = wilson(agree, units.length);
  const clustered = clusterBootstrapAgreementCI(units);
  pooled[axis] = { n: units.length, agree, naive, clustered };
}

const pct = (x, d = 1) => (x == null || Number.isNaN(x) ? "n/a" : (x * 100).toFixed(d) + "%");
console.log("=== [R2] POOLED (all 5 judges combined) agreement per axis, clustered CI, cluster=beat ===\n");
console.log(["axis", "n", "agree", "naive point", "clustered 95% CI", "bar(80%)"].map((s, i) => s.padEnd([14, 6, 7, 14, 22, 10][i])).join(""));
for (const axis of [...NEW_AXES, "overall"]) {
  const p = pooled[axis];
  const verdict = p.clustered.hi < 0.8 ? "FAIL" : p.clustered.lo >= 0.8 ? "PASS" : "UNDERPOWERED";
  console.log([axis, String(p.n), String(p.agree), pct(p.naive.point), `[${pct(p.clustered.lo)}, ${pct(p.clustered.hi)}]`, verdict].map((s, i) => String(s).padEnd([14, 6, 7, 14, 22, 10][i])).join(""));
}

writeFileSync(
  join(ROOT, "docs/paper/analysis/r2/pooled-per-axis.json"),
  JSON.stringify({ method: "pooled across 5 judges, cluster=beat(12), bootstrap 10000 reps seed 20260818", pooled }, null, 2) + "\n",
);
