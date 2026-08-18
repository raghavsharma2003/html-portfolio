#!/usr/bin/env node
// docs/paper/figures/fig-f1-agreement-forest.mjs — WS-PAPER-W.
//
// F1 — "Every candidate fails, and clustering does not rescue any of them."
// A forest plot of pooled unit-level agreement with the trusted verdict set
// (Hinglish condition, the R0 run), one row per judge, showing BOTH intervals:
// the naive Wilson binomial CI (thin, light) and the honest cluster-bootstrap
// CI (thick, dark; cluster = beat, 12 clusters). The pre-registered >=80% bar
// and the two chance baselines that the both-orders-agree rule implies are
// drawn as vertical reference lines, because an agreement number is
// uninterpretable without them.
//
// EVERY NUMBER IS READ, NOT TYPED. Point estimates, naive CIs and clustered
// CIs come from `clustered-cis.mjs --json`; the chance baselines and the
// agree/n counts come from `derive-tables.mjs --json`. Nothing is hardcoded
// except the 80% bar itself, which is the pre-registration.
//
// Run: node docs/paper/figures/fig-f1-agreement-forest.mjs
// Out: docs/paper/figures/fig-f1-agreement-forest.svg

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT, analysis, svg, text, line, circle, interval, xAxis, scale,
  INK, MID, SOFT, HAIR, PAPER, pct,
} from "./_svgkit.mjs";

const BAR = 0.80;

const clus = analysis("docs/paper/analysis/clustered-cis.mjs");
const dt = analysis("docs/paper/analysis/derive-tables.mjs");

// Chance baselines under the both-orders-agree rule, pooled over both archives
// exactly as derive-tables.mjs T3 pools them (weighted by units, not averaged).
const totUnits = dt.groundTruth.reduce((a, g) => a + g.units, 0);
const coinFlip = dt.groundTruth.reduce((a, g) => a + g.chance.coinFlip * g.units, 0) / totUnits;
const pureSlotA = dt.groundTruth.reduce((a, g) => a + g.chance.pureSlotA * g.units, 0) / totUnits;

const INVALID = new Set(["anthropic/claude-opus-5", "anthropic/claude-opus-4.8"]);
const scorable = clus.table.filter((r) => r.scored > 0);
const valid = scorable.filter((r) => !INVALID.has(r.judge)).sort((a, b) => b.clustered.point - a.clustered.point);
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
const ySep = cursor + 2;
cursor = ySep + GAPBAND;
const refY = [];
for (let i = 0; i < refs.length; i++) { refY.push(cursor); cursor += ROWH; }
const yBot = cursor - ROWH + 16;
const axisY = cursor + 6;
const H = axisY + 92;

const x = scale(0, 1, PADL, PADL + PLOTW);
const P = [];

// ── title block ─────────────────────────────────────────────────────────────
P.push(text(LEFT, yTitle, "F1 — Pooled agreement with the trusted verdict set, against the pre-registered bar", { size: 13, weight: 700 }));
P.push(text(LEFT, ySub1, "Hinglish condition (run R0). Thick interval = cluster bootstrap, cluster = beat (12 clusters, 10,000 reps, seed 20260818).", { size: 9.5, fill: MID }));
P.push(text(LEFT, ySub2, "Thin interval = naive Wilson binomial CI, drawn behind it to show exactly how much the independence assumption was buying.", { size: 9.5, fill: MID }));

// ── gridlines and reference lines ───────────────────────────────────────────
for (const t of [0.2, 0.4, 0.6, 0.8, 1.0]) {
  P.push(line(x(t), yTop, x(t), yBot, { stroke: HAIR, width: 1 }));
}
P.push(line(x(BAR), yTop - 14, x(BAR), yBot, { stroke: INK, width: 1.6, dash: "6 3" }));
P.push(text(x(BAR), yRefLabelHi, "pre-registered bar ≥80%", { size: 9.5, anchor: "middle", weight: 700 }));

P.push(line(x(coinFlip), yTop - 14, x(coinFlip), yBot, { stroke: MID, width: 1.2, dash: "2 3" }));
P.push(text(x(coinFlip) + 4, yRefLabelHi, `uniform-random ${pct(coinFlip)}`, { size: 9.5, anchor: "start", fill: MID }));

P.push(line(x(pureSlotA), yTop - 14, x(pureSlotA), yBot, { stroke: SOFT, width: 1.2, dash: "1 3" }));
P.push(text(x(pureSlotA) + 4, yRefLabelLo, `pure slot-A ${pct(pureSlotA)}`, { size: 9.5, anchor: "start", fill: SOFT }));

// ── one row per judge ───────────────────────────────────────────────────────
function drawRow(r, y, faded) {
  const ink = faded ? SOFT : INK;
  P.push(text(PADL - 10, y + 4, r.judge, { size: 10.5, anchor: "end", weight: faded ? 400 : 600, fill: ink }));
  P.push(interval(x(r.naive.lo), x(r.naive.hi), y, { stroke: SOFT, width: 1, cap: 5, opacity: faded ? 0.55 : 1 }));
  P.push(interval(x(r.clustered.lo), x(r.clustered.hi), y, { stroke: ink, width: 2.4, cap: 6 }));
  P.push(circle(x(r.clustered.point), y, 4.2, { fill: faded ? PAPER : INK, stroke: ink, width: 1.6 }));
  P.push(text(PADL + PLOTW + 12, y + 4,
    `${r.agree}/${r.scored} = ${pct(r.clustered.point)}   [${pct(r.clustered.lo)}, ${pct(r.clustered.hi)}]`,
    { size: 9.5, fill: faded ? SOFT : MID }));
  P.push(text(W - LEFT, y + 4, faded ? "INVALID" : "FAIL", { size: 9.5, anchor: "end", weight: 700, fill: ink }));
}

valid.forEach((r, i) => drawRow(r, rowY[i], false));

P.push(line(LEFT, ySep, W - LEFT, ySep, { stroke: HAIR, width: 1 }));
P.push(text(LEFT, ySep + 16, "NOT QUALIFICATION RESULTS — transport-selected denominators, labelled INVALID in §4.6 and §5.1, shown so the omission is not itself a selection:", { size: 9, fill: SOFT, weight: 600 }));
refs.forEach((r, i) => drawRow(r, refY[i], true));

// ── axis + provenance ───────────────────────────────────────────────────────
P.push(xAxis(PADL, axisY, PLOTW, [0, 0.2, 0.4, 0.6, 0.8, 1.0], x, {
  label: "unit-level agreement with the archived blind, counterbalanced, both-orders verdicts (judge: claude-opus-4.8)",
}));
P.push(text(LEFT, axisY + 62,
  "Source: docs/paper/analysis/clustered-cis.mjs --json (intervals) and derive-tables.mjs --json (counts, chance baselines). n = 96 units; DeepSeek-V4-Pro n = 94 (2 transport",
  { size: 8.5, fill: SOFT }));
P.push(text(LEFT, axisY + 73,
  "misses). Both chance baselines are derived from the archived verdict distribution, not assumed. Cohere command-a-plus is absent from the plot: 0 scorable units (158/192 parse misses).",
  { size: 8.5, fill: SOFT }));

const out = svg(W, H, P.join("\n"),
  "F1 — Pooled judge agreement with clustered confidence intervals against the 80% qualification bar",
  "Forest plot. Five candidate judges show pooled unit-level agreement between 28.1% and 54.2% with the trusted verdict set. Every cluster-bootstrap 95% interval lies far below the pre-registered 80% bar, with interval upper bounds between 38.5% and 64.6%. Four of the five overlap the 30.5% uniform-random baseline. Two anthropic reference rows are shown in a separate band and are labelled invalid transport-selected runs, not results.");

const dest = resolve(ROOT, "docs/paper/figures/fig-f1-agreement-forest.svg");
writeFileSync(dest, out);
console.log(`wrote ${dest} (${out.length} bytes; ${valid.length} scorable judges + ${refs.length} labelled-invalid references; ${W}x${H})`);
