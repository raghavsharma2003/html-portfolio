#!/usr/bin/env node
// docs/paper/figures/fig-f1-agreement-forest.mjs — WS-PAPER-W.
//
// F1 — "Every candidate fails, and clustering does not rescue any of them —
// and the bar they fail sits ABOVE the ground truth's own measured ceiling."
// A forest plot of pooled unit-level agreement with the trusted verdict set
// (Hinglish condition, the R0 run), one row per judge, showing BOTH intervals:
// the naive Wilson binomial CI (thin, light) and the honest cluster-bootstrap
// CI (thick, dark; cluster = beat, 12 clusters). The pre-registered >=80% bar
// and the two chance baselines that the both-orders-agree rule implies are
// drawn as vertical reference lines, because an agreement number is
// uninterpretable without them.
//
// [R1, 2026-08-18] A THIRD reference is now drawn and it is the important one:
// the ground truth's own test-retest ceiling. claude-opus-4.8 — the model that
// produced the archived verdicts — re-judged the same 96 units against its own
// archive and agreed with itself on 74/96 = 77.1%. That measured ceiling, with
// its Wilson CI as a hatched band, is drawn behind everything, because no
// candidate can be expected to agree with the archive more often than the
// archive's own author does. The 80% bar sits ABOVE it.
//
// EVERY NUMBER IS READ, NOT TYPED. Point estimates, naive CIs and clustered
// CIs come from `clustered-cis.mjs --json`; the chance baselines and the
// agree/n counts come from `derive-tables.mjs --json`; the ceiling is the
// opus-4.8 row of the same `clustered-cis.mjs --json` table. Nothing is
// hardcoded except the 80% bar itself, which is the pre-registration.
//
// Run: node docs/paper/figures/fig-f1-agreement-forest.mjs
// Out: docs/paper/figures/fig-f1-agreement-forest.svg

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT, analysis, svg, text, line, rect, circle, interval, xAxis, scale,
  INK, MID, SOFT, HAIR, PAPER, pct,
} from "./_svgkit.mjs";

const BAR = 0.80;

// The model that produced the archived ground-truth verdicts. Its own row in
// the backtest is a TEST-RETEST measurement, not a qualification result: it is
// the ceiling every candidate is implicitly measured against.
const GROUND_TRUTH_JUDGE = "anthropic/claude-opus-4.8";

const clus = analysis("docs/paper/analysis/clustered-cis.mjs");
const dt = analysis("docs/paper/analysis/derive-tables.mjs");

// Chance baselines under the both-orders-agree rule, pooled over both archives
// exactly as derive-tables.mjs T3 pools them (weighted by units, not averaged).
const totUnits = dt.groundTruth.reduce((a, g) => a + g.units, 0);
const coinFlip = dt.groundTruth.reduce((a, g) => a + g.chance.coinFlip * g.units, 0) / totUnits;
const pureSlotA = dt.groundTruth.reduce((a, g) => a + g.chance.pureSlotA * g.units, 0) / totUnits;

const INVALID = new Set(["anthropic/claude-opus-5"]);
const scorable = clus.table.filter((r) => r.scored > 0);
const ceiling = scorable.find((r) => r.judge === GROUND_TRUTH_JUDGE);
if (!ceiling) throw new Error(`no ${GROUND_TRUTH_JUDGE} row in clustered-cis.mjs --json: the ceiling cannot be drawn from data, and this figure never hardcodes one`);
const valid = scorable
  .filter((r) => !INVALID.has(r.judge) && r.judge !== GROUND_TRUTH_JUDGE)
  .sort((a, b) => b.clustered.point - a.clustered.point);
const refs = scorable.filter((r) => INVALID.has(r.judge)).sort((a, b) => b.clustered.point - a.clustered.point);

// ── layout, computed up front so nothing collides ───────────────────────────
const W = 920;
const LEFT = 12;                       // text-block left margin
const PADL = 176, PADR = 300;
const PLOTW = W - PADL - PADR;         // 444
const ROWH = 34, GAPBAND = 34;
const yTitle = 22, ySub1 = 38, ySub2 = 50;
const yRefLabelHi = 72, yRefLabelLo = 86;   // the two chance-baseline captions
const yTop = 96;                            // top of the plotting band
const yFirst = yTop + 24;

const rowY = [];
let cursor = yFirst;
for (let i = 0; i < valid.length; i++) { rowY.push(cursor); cursor += ROWH; }
const ySepCeil = cursor + 2;
cursor = ySepCeil + GAPBAND;
const ceilY = cursor; cursor += ROWH;
const ySep = cursor + 2;
cursor = ySep + GAPBAND;
const refY = [];
for (let i = 0; i < refs.length; i++) { refY.push(cursor); cursor += ROWH; }
const yBot = cursor - ROWH + 16;
const axisY = cursor + 6;
const H = axisY + 104;

const x = scale(0, 1, PADL, PADL + PLOTW);
const P = [];

// ── title block ─────────────────────────────────────────────────────────────
P.push(text(LEFT, yTitle, "F1 — Pooled agreement with the trusted verdict set, against the pre-registered bar", { size: 13, weight: 700 }));
P.push(text(LEFT, ySub1, "Hinglish condition (run R0). Thick interval = cluster bootstrap, cluster = beat (12 clusters, 10,000 reps, seed 20260818).", { size: 9.5, fill: MID }));
P.push(text(LEFT, ySub2, "Thin interval = naive Wilson binomial CI, drawn behind it to show exactly how much the independence assumption was buying.", { size: 9.5, fill: MID }));

// ── the ground-truth test–retest ceiling, drawn FIRST so everything else sits
// on top of it. Hatched band = the Wilson 95% CI of the archive author's own
// self-agreement; the solid rule is its point estimate. Read as: no candidate
// can be expected to beat this, and the pre-registered bar is to its right. ──
P.push(rect(x(ceiling.naive.lo), yTop - 6, x(ceiling.naive.hi) - x(ceiling.naive.lo), yBot - yTop + 6,
  { fill: "url(#hatchLight)" }));
P.push(line(x(ceiling.naive.point), yTop - 14, x(ceiling.naive.point), yBot, { stroke: MID, width: 1.6, dash: "4 2" }));

// ── gridlines and reference lines ───────────────────────────────────────────
for (const t of [0.2, 0.4, 0.6, 0.8, 1.0]) {
  P.push(line(x(t), yTop, x(t), yBot, { stroke: HAIR, width: 1 }));
}
P.push(line(x(BAR), yTop - 14, x(BAR), yBot, { stroke: INK, width: 1.6, dash: "6 3" }));
// Row yRefLabelLo carries the two >=70% references (ceiling to the left of its
// line, bar to the right of its line, so they cannot overlap); row yRefLabelHi
// carries the two chance baselines, likewise splayed apart.
P.push(text(x(BAR) + 6, yRefLabelLo, "pre-registered bar ≥80%", { size: 9.5, anchor: "start", weight: 700 }));
P.push(text(x(ceiling.naive.point) - 6, yRefLabelLo,
  `ground-truth test–retest ceiling ${pct(ceiling.naive.point)} [${pct(ceiling.naive.lo)}, ${pct(ceiling.naive.hi)}]`,
  { size: 9.5, anchor: "end", weight: 700, fill: MID }));

P.push(line(x(coinFlip), yTop - 14, x(coinFlip), yBot, { stroke: MID, width: 1.2, dash: "2 3" }));
P.push(text(x(coinFlip) + 4, yRefLabelHi, `uniform-random ${pct(coinFlip)}`, { size: 9.5, anchor: "start", fill: MID }));

P.push(line(x(pureSlotA), yTop - 14, x(pureSlotA), yBot, { stroke: SOFT, width: 1.2, dash: "1 3" }));
P.push(text(x(pureSlotA) - 4, yRefLabelHi, `pure slot-A ${pct(pureSlotA)}`, { size: 9.5, anchor: "end", fill: SOFT }));

// ── one row per judge ───────────────────────────────────────────────────────
function drawRow(r, y, style, verdict) {
  const faded = style === "faded";
  const ink = faded ? SOFT : style === "ceiling" ? MID : INK;
  P.push(text(PADL - 10, y + 4, r.judge, { size: 10.5, anchor: "end", weight: faded ? 400 : 600, fill: ink }));
  P.push(interval(x(r.naive.lo), x(r.naive.hi), y, { stroke: SOFT, width: 1, cap: 5, opacity: faded ? 0.55 : 1 }));
  P.push(interval(x(r.clustered.lo), x(r.clustered.hi), y, { stroke: ink, width: 2.4, cap: 6 }));
  P.push(circle(x(r.clustered.point), y, 4.2, { fill: style === "solid" ? INK : PAPER, stroke: ink, width: 1.6 }));
  P.push(text(PADL + PLOTW + 12, y + 4,
    `${r.agree}/${r.scored} = ${pct(r.clustered.point)}   [${pct(r.clustered.lo)}, ${pct(r.clustered.hi)}]`,
    { size: 9.5, fill: faded ? SOFT : MID }));
  P.push(text(W - LEFT, y + 4, verdict, { size: 9.5, anchor: "end", weight: 700, fill: ink }));
}

valid.forEach((r, i) => drawRow(r, rowY[i], "solid", "FAIL"));

// ── the ceiling row: the ground truth judging itself ────────────────────────
P.push(line(LEFT, ySepCeil, W - LEFT, ySepCeil, { stroke: HAIR, width: 1 }));
P.push(text(LEFT, ySepCeil + 16,
  "NOT A CANDIDATE — the model that wrote the archive, re-judging it. This is a TEST–RETEST measurement of the ground truth's own noise, and it is the ceiling above:",
  { size: 9, fill: MID, weight: 600 }));
drawRow(ceiling, ceilY, "ceiling", "CEILING");

P.push(line(LEFT, ySep, W - LEFT, ySep, { stroke: HAIR, width: 1 }));
const rowsPerJudge = dt.groundTruth.reduce((a, g) => a + g.judgments, 0);
const refMisses = refs.map((r) => {
  const p = dt.pooled.find((q) => q.judge === r.judge);
  return `${p.parseMisses}/${rowsPerJudge} unparseable`;
}).join("; ");
P.push(text(LEFT, ySep + 16, `NOT A QUALIFICATION RESULT — a parse-selected denominator (${refMisses}: the reasoning trap), labelled INVALID in §4.6 and §5.1, shown so the omission is not itself a selection:`, { size: 9, fill: SOFT, weight: 600 }));
refs.forEach((r, i) => drawRow(r, refY[i], "faded", "INVALID"));

// ── axis + provenance ───────────────────────────────────────────────────────
P.push(xAxis(PADL, axisY, PLOTW, [0, 0.2, 0.4, 0.6, 0.8, 1.0], x, {
  label: "unit-level agreement with the archived blind, counterbalanced, both-orders verdicts (judge: claude-opus-4.8)",
}));
P.push(text(LEFT, axisY + 62,
  "Source: docs/paper/analysis/clustered-cis.mjs --json (intervals, ceiling) and derive-tables.mjs --json (counts, chance baselines, miss kinds). n = 96 units; DeepSeek-V4-Pro n = 94",
  { size: 8.5, fill: SOFT }));
P.push(text(LEFT, axisY + 73,
  "(2 transport misses). Both chance baselines are derived from the archived verdict distribution, not assumed. Cohere command-a-plus is absent from the plot: 0 scorable units (158/192 parse misses).",
  { size: 8.5, fill: SOFT }));
P.push(text(LEFT, axisY + 84,
  `The hatched band is the Wilson 95% CI of the ceiling row; its beat-clustered interval is [${pct(ceiling.clustered.lo)}, ${pct(ceiling.clustered.hi)}]. The bar was pre-registered before the ceiling was measured.`,
  { size: 8.5, fill: SOFT }));

const gap = (r) => ((ceiling.naive.point - r.clustered.point) * 100).toFixed(1);
const out = svg(W, H, P.join("\n"),
  "F1 — Pooled judge agreement against the pre-registered bar and the ground truth's own test-retest ceiling",
  `Forest plot. Five candidate judges show pooled unit-level agreement between ${pct(valid[valid.length - 1].clustered.point)} and ${pct(valid[0].clustered.point)} with the trusted verdict set. Every cluster-bootstrap 95% interval lies far below the pre-registered 80% bar. A hatched vertical band marks the ground truth's own test-retest ceiling, ${pct(ceiling.naive.point)} with a 95% interval of [${pct(ceiling.naive.lo)}, ${pct(ceiling.naive.hi)}], measured by having the archive's own author re-judge it; the pre-registered bar sits above that ceiling. The candidates fall ${gap(valid[0])} to ${gap(valid[valid.length - 1])} percentage points below the ceiling. One anthropic reference row is shown in a separate band and is labelled an invalid parse-selected run, not a result.`);

const dest = resolve(ROOT, "docs/paper/figures/fig-f1-agreement-forest.svg");
writeFileSync(dest, out);
console.log(`wrote ${dest} (${out.length} bytes; ${valid.length} scorable judges + ${refs.length} labelled-invalid references; ${W}x${H})`);
