#!/usr/bin/env node
// docs/paper/analysis/derive-tables.mjs — WS-PAPER
//
// Recomputes EVERY derived number that appears in docs/paper/DRAFT.md, from
// two committed sources only:
//   evals/dbattery/judges.json          (raw_rows: 1,536 judge rows)
//   evals/archives/{charm-grok,charm-luna}/pb-judged*.json  (ground truth)
//
// No network, no API keys, no spend. The paper's citation law is that every
// figure in the draft is either (a) a logged context/measurements.md entry or
// (b) printed by this script. Anything else is a gap, listed in the draft's
// claim-gap table.
//
// Run:  node docs/paper/analysis/derive-tables.mjs
//       node docs/paper/analysis/derive-tables.mjs --json

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const asJson = process.argv.includes("--json");

const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

// ── house rule: a unit counts only when both presentation orders agree ──────
// Identical to consolidateUnit() in evals/dbattery/judge-backtest.mjs:228.
const consolidate = (o0, o1) =>
  o0 === undefined || o1 === undefined ? undefined : o0 === o1 ? o0 : "TIE_FLIP";

const INCUMBENT = "google/gemini-3.6-flash";

// ── Wilson score interval (same as the harness) ─────────────────────────────
function wilson(k, n, z = 1.959963984540054) {
  if (!n) return { point: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { point: p, lo: (c - s) / d, hi: (c + s) / d };
}

// ── exact two-sided binomial test ───────────────────────────────────────────
function lchoose(n, k) {
  const lg = (x) => {
    // Lanczos
    const g = 7;
    const C = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lg(1 - x);
    x -= 1;
    let a = C[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += C[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  };
  return lg(n + 1) - lg(k + 1) - lg(n - k + 1);
}
function binomPmf(k, n, p) {
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}
function binomTest(k, n, p) {
  if (!n) return null;
  const obs = binomPmf(k, n, p);
  let acc = 0;
  for (let i = 0; i <= n; i++) {
    const pr = binomPmf(i, n, p);
    if (pr <= obs * (1 + 1e-9)) acc += pr;
  }
  return Math.min(1, acc);
}

// ── T1: ground-truth archive structure + chance baselines ───────────────────
const ARCHIVES = [
  { id: "charm-grok", file: "evals/archives/charm-grok/pb-judged-grok.json" },
  { id: "charm-luna", file: "evals/archives/charm-luna/pb-judged.json" },
];
const AXES = ["warmth", "humour", "register", "specificity", "brevity", "personhood", "overall"];

const groundTruth = ARCHIVES.map(({ id, file }) => {
  const j = read(file);
  const V = j.verdicts;
  const units = new Map();
  for (const v of V) {
    const k = `${v.lane}|${v.beat}|${v.rep}`;
    if (!units.has(k)) units.set(k, {});
    units.get(k)[v.order] = v;
  }
  const perAxis = {};
  for (const ax of AXES) {
    let inc = 0, cand = 0, tie = 0;
    for (const [, g] of units) {
      const w = consolidate(g[0]?.[ax], g[1]?.[ax]);
      // The rig's own third value on the sub-axes is the literal string "TIE"
      // (the overall axis never carries one — verified: 0 non-A/B rows).
      if (w === undefined || w === "TIE_FLIP" || w === "TIE" || w === "NONE" || w === "NA") tie++;
      else if (w === INCUMBENT) inc++;
      else cand++;
    }
    perAxis[ax] = { inc, cand, tie };
  }
  // slot-A pick rate of the trusted judge itself, per axis, over A/B rows only
  const slotA = {};
  for (const ax of AXES) {
    let a = 0, b = 0;
    for (const v of V) {
      const s = v.rawSlots?.[ax];
      if (s === "A") a++; else if (s === "B") b++;
    }
    slotA[ax] = { a, b, rate: a + b ? a / (a + b) : null };
  }
  const o = perAxis.overall;
  const n = o.inc + o.cand + o.tie;
  return {
    archive: id,
    judge: j.judge,
    judgments: V.length,
    units: units.size,
    perAxis,
    slotA,
    chance: {
      // a judge choosing uniformly at random per presentation:
      //   P(same model twice) = .25 each side, P(order flip -> TIE) = .5
      coinFlip: ((o.inc + o.cand) * 0.25 + o.tie * 0.5) / n,
      // a judge that always picks slot A: counterbalancing turns every unit
      // into a TIE_FLIP, so it can only ever "agree" on archived ties
      pureSlotA: o.tie / n,
    },
  };
});

// ── T2: per-judge decomposition from judges.json raw rows ───────────────────
const J = read("evals/dbattery/judges.json");
const groups = new Map();
for (const r of J.raw_rows) {
  const k = `${r.judge}||${r.archive}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const perCell = [];
for (const [k, rs] of groups) {
  const [judge, archive] = k.split("||");
  const units = new Map();
  for (const r of rs) {
    if (!units.has(r.unitKey)) units.set(r.unitKey, {});
    units.get(r.unitKey)[r.order] = r;
  }
  let scored = 0, skipped = 0;
  let agree = 0;
  let decAgree = 0, decTotal = 0, tieAgree = 0, tieTotal = 0;
  let decPickInc = 0, decPickCand = 0, decPickTie = 0;
  let freshCand = 0, freshInc = 0;
  let archCandDec = 0, archDecTotal = 0;
  for (const [, g] of units) {
    const o0 = g[0], o1 = g[1];
    if (!o0 || !o1) { skipped++; continue; }
    const av = consolidate(o0.archivedOverall, o1.archivedOverall);
    if (av !== "TIE_FLIP") { archDecTotal++; if (av !== INCUMBENT) archCandDec++; }
    if (o0.newOverall == null || o1.newOverall == null) { skipped++; continue; }
    const fv = consolidate(o0.newOverall, o1.newOverall);
    scored++;
    if (fv === av) agree++;
    if (fv === "TIE_FLIP") { /* no decisive fresh verdict */ }
    else if (fv === INCUMBENT) freshInc++; else freshCand++;
    if (av === "TIE_FLIP") { tieTotal++; if (fv === "TIE_FLIP") tieAgree++; }
    else {
      decTotal++;
      if (fv === av) decAgree++;
      if (fv === "TIE_FLIP") decPickTie++;
      else if (fv === INCUMBENT) decPickInc++; else decPickCand++;
    }
  }
  const rowsScored = rs.filter((r) => r.newPickedSide).length;
  const slotA = rs.filter((r) => r.newPickedSide === "A").length;
  perCell.push({
    judge, archive, scored, skipped,
    agree, agreementRate: scored ? agree / scored : null,
    ci95: wilson(agree, scored),
    decisive: { agree: decAgree, total: decTotal, acc: decTotal ? decAgree / decTotal : null },
    onArchivedTies: { agree: tieAgree, total: tieTotal },
    decisiveFreshPicks: { incumbent: decPickInc, candidate: decPickCand, tieFlip: decPickTie },
    freshNonTiePickRateCandidate: freshInc + freshCand ? freshCand / (freshInc + freshCand) : null,
    archivedNonTiePickRateCandidate: archDecTotal ? archCandDec / archDecTotal : null,
    slotAPickRate: rowsScored ? slotA / rowsScored : null,
    slotARowsScored: rowsScored,
    slotABinomP: rowsScored ? binomTest(slotA, rowsScored, 0.5) : null,
    transportMisses: rs.filter((r) => typeof r.harnessMiss === "string" && r.harnessMiss.startsWith("error:")).length,
    parseMisses: rs.filter((r) => typeof r.harnessMiss === "string" && r.harnessMiss.startsWith("unparseable:")).length,
  });
}

// ── T3: pooled per judge, with the chance-baseline test ─────────────────────
const gtByArchive = Object.fromEntries(groundTruth.map((g) => [g.archive, g]));
const pooled = new Map();
for (const c of perCell) {
  if (!pooled.has(c.judge)) pooled.set(c.judge, {
    judge: c.judge, agree: 0, scored: 0, decAgree: 0, decTotal: 0,
    tieAgree: 0, tieTotal: 0, slotA: 0, slotRows: 0,
    transportMisses: 0, parseMisses: 0, chanceExpected: 0,
  });
  const p = pooled.get(c.judge);
  p.agree += c.agree; p.scored += c.scored;
  p.decAgree += c.decisive.agree; p.decTotal += c.decisive.total;
  p.tieAgree += c.onArchivedTies.agree; p.tieTotal += c.onArchivedTies.total;
  p.slotA += Math.round((c.slotAPickRate ?? 0) * c.slotARowsScored);
  p.slotRows += c.slotARowsScored;
  p.transportMisses += c.transportMisses; p.parseMisses += c.parseMisses;
  p.chanceExpected += (gtByArchive[c.archive]?.chance.coinFlip ?? 0) * c.scored;
}
const pooledOut = [...pooled.values()].map((p) => {
  const chanceP = p.scored ? p.chanceExpected / p.scored : null;
  return {
    judge: p.judge,
    agreementRate: p.scored ? p.agree / p.scored : null,
    agree: p.agree, scored: p.scored,
    ci95: wilson(p.agree, p.scored),
    barPass: p.scored ? wilson(p.agree, p.scored).lo >= 0.8 : null,
    chanceBaseline: chanceP,
    pVsChance: p.scored ? binomTest(p.agree, p.scored, chanceP) : null,
    decisiveAcc: p.decTotal ? p.decAgree / p.decTotal : null,
    decisiveN: p.decTotal,
    decisiveCi95: wilson(p.decAgree, p.decTotal),
    pDecisiveVsChance: p.decTotal ? binomTest(p.decAgree, p.decTotal, 0.25) : null,
    agreeOnArchivedTies: `${p.tieAgree}/${p.tieTotal}`,
    slotAPickRate: p.slotRows ? p.slotA / p.slotRows : null,
    slotAN: p.slotRows,
    slotAp: p.slotRows ? binomTest(p.slotA, p.slotRows, 0.5) : null,
    transportMisses: p.transportMisses,
    parseMisses: p.parseMisses,
  };
});

// ── T4: family-conflict cells (own-vendor arm present in the archive) ───────
const FAMILY = {
  "DeepSeek-V4-Flash": "deepseek", "DeepSeek-V4-Pro": "deepseek",
  "gpt-5.6-terra": "openai", "grok-4.3": "xai",
  "Mistral-Large-3": "mistral", "command-a-plus-05-2026": "cohere",
  "anthropic/claude-opus-5": "anthropic", "anthropic/claude-opus-4.8": "anthropic",
};
const ARCHIVE_CANDIDATE_FAMILY = { "charm-grok": "xai", "charm-luna": "openai" };
const familyCells = perCell
  .filter((c) => c.scored > 0)
  .map((c) => ({
    judge: c.judge, archive: c.archive,
    judgeFamily: FAMILY[c.judge], candidateFamily: ARCHIVE_CANDIDATE_FAMILY[c.archive],
    conflict: FAMILY[c.judge] === ARCHIVE_CANDIDATE_FAMILY[c.archive],
    freshCandidatePickRate: c.freshNonTiePickRateCandidate,
    groundTruthCandidatePickRate: c.archivedNonTiePickRateCandidate,
    deltaPp: c.freshNonTiePickRateCandidate != null && c.archivedNonTiePickRateCandidate != null
      ? (c.freshNonTiePickRateCandidate - c.archivedNonTiePickRateCandidate) * 100 : null,
  }));

const out = { groundTruth, perCell, pooled: pooledOut, familyCells };

if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

const pct = (x, d = 1) => (x == null ? "  n/a" : (x * 100).toFixed(d) + "%");
const pv = (x) => (x == null ? "n/a" : x < 1e-4 ? x.toExponential(1) : x.toFixed(4));

console.log("\n=== T1  Ground truth (archived blind verdicts, judge = anthropic/claude-opus-4.8) ===");
for (const g of groundTruth) {
  const o = g.perAxis.overall;
  console.log(`\n${g.archive}: ${g.judgments} judgments / ${g.units} units`);
  console.log(`  overall (both-orders-agree): incumbent ${o.inc} – candidate ${o.cand}, tie/flip ${o.tie}`);
  console.log(`  trusted-judge slot-A rate (overall axis): ${pct(g.slotA.overall.rate)}  (A=${g.slotA.overall.a}, B=${g.slotA.overall.b})`);
  console.log(`  chance baselines under the both-orders rule: coin-flip ${pct(g.chance.coinFlip)}, always-slot-A ${pct(g.chance.pureSlotA)}`);
  console.log("  per axis (inc – cand – tie):");
  for (const ax of AXES) {
    const a = g.perAxis[ax];
    console.log(`    ${ax.padEnd(12)} ${String(a.inc).padStart(2)} – ${String(a.cand).padStart(2)} – ${String(a.tie).padStart(2)}   slot-A ${pct(g.slotA[ax].rate)}`);
  }
}

console.log("\n=== T2  Per judge × archive ===");
console.log(
  ["judge", "archive", "n", "agree", "95% CI", "dec.acc", "dec n", "slot-A", "p(slotA=.5)", "transp", "parse"]
    .map((s, i) => s.padEnd([26, 12, 4, 7, 16, 8, 6, 7, 12, 7, 6][i])).join("")
);
for (const c of perCell) {
  console.log(
    [
      c.judge, c.archive, String(c.scored), pct(c.agreementRate),
      c.ci95.lo == null ? "n/a" : `[${pct(c.ci95.lo)}, ${pct(c.ci95.hi)}]`,
      pct(c.decisive.acc), String(c.decisive.total),
      pct(c.slotAPickRate), pv(c.slotABinomP),
      String(c.transportMisses), String(c.parseMisses),
    ].map((s, i) => String(s).padEnd([26, 12, 4, 7, 16, 8, 6, 7, 12, 7, 6][i])).join("")
  );
}

console.log("\n=== T3  Pooled per judge (the paper's headline table) ===");
for (const p of pooledOut) {
  console.log(`\n${p.judge}`);
  console.log(`  agreement            ${p.agree}/${p.scored} = ${pct(p.agreementRate)}  95% CI [${pct(p.ci95.lo)}, ${pct(p.ci95.hi)}]   bar>=80%: ${p.barPass ? "PASS" : "FAIL"}`);
  console.log(`  chance baseline      ${pct(p.chanceBaseline)} (coin flip under both-orders-agree)   p(obs vs chance) = ${pv(p.pVsChance)}`);
  console.log(`  decisive-unit acc    ${pct(p.decisiveAcc)} (n=${p.decisiveN}) 95% CI [${pct(p.decisiveCi95.lo)}, ${pct(p.decisiveCi95.hi)}]   p vs 25% chance = ${pv(p.pDecisiveVsChance)}`);
  console.log(`  agreed on arch. ties ${p.agreeOnArchivedTies}`);
  console.log(`  slot-A pick rate     ${pct(p.slotAPickRate)} (n=${p.slotAN} rows)  p(=50%) = ${pv(p.slotAp)}`);
  console.log(`  misses               transport ${p.transportMisses}, parse ${p.parseMisses}`);
}

console.log("\n=== T4  Same-vendor cells (judge family vs the archive's candidate family) ===");
console.log(["judge", "archive", "conflict", "fresh cand%", "GT cand%", "delta pp"].map((s, i) => s.padEnd([26, 12, 10, 13, 10, 9][i])).join(""));
for (const f of familyCells) {
  console.log([
    f.judge, f.archive, f.conflict ? "SAME" : "-",
    pct(f.freshCandidatePickRate), pct(f.groundTruthCandidatePickRate),
    f.deltaPp == null ? "n/a" : (f.deltaPp >= 0 ? "+" : "") + f.deltaPp.toFixed(1),
  ].map((s, i) => String(s).padEnd([26, 12, 10, 13, 10, 9][i])).join(""));
}
console.log("");
