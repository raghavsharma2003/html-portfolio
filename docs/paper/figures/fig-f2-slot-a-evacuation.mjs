#!/usr/bin/env node
// docs/paper/figures/fig-f2-slot-a-evacuation.mjs — WS-PAPER-W.
//
// F2 — "Position bias does not add noise to the counterbalance; it evacuates it."
//
// Panel A: pooled slot-A pick rate per judge (judgment-row level), against the
//   50% line a content-driven judge would scatter around and against the
//   trusted judge's own rate on the identical rows.
//
// Panel B: the degenerate prediction, drawn as a curve rather than asserted.
//   Under the both-orders-agree rule (§4.2) presentation is counterbalanced,
//   so a judge that picks slot A with content-blind propensity q names the
//   incumbent in one order and the candidate in the other. It therefore
//   produces a DECISIVE unit only when its two picks happen to land on the
//   same model:
//
//        P(decisive) = 2q(1-q)          P(TIE_FLIP) = q^2 + (1-q)^2
//
//   which reproduces the two anchor points §4.2 already states: q=0.5 gives
//   50% TIE_FLIP (the uniform-random judge) and q=1 gives 100% TIE_FLIP (the
//   pure slot-A judge, whose agreement collapses to exactly the archived tie
//   rate). This curve is an ANALYTIC PREDICTION, not a measurement, and is
//   labelled as such on the figure. Every plotted POINT is measured and comes
//   from derive-tables.mjs --json.
//
//   A judge sitting on the curve is behaving as if content told it nothing.
//
// Run: node docs/paper/figures/fig-f2-slot-a-evacuation.mjs
// Out: docs/paper/figures/fig-f2-slot-a-evacuation.svg

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT, analysis, svg, text, line, rect, circle, xAxis, scale,
  INK, MID, SOFT, HAIR, FILL_LIGHT, PAPER, pct,
} from "./_svgkit.mjs";

const dt = analysis("docs/paper/analysis/derive-tables.mjs");

const CODE = {
  "Mistral-Large-3": "MIS",
  "DeepSeek-V4-Flash": "DS-F",
  "grok-4.3": "GRK",
  "DeepSeek-V4-Pro": "DS-P",
  "gpt-5.6-terra": "TER",
};
const CANDIDATES = Object.keys(CODE);

// ── measured series ─────────────────────────────────────────────────────────
const pooled = dt.pooled
  .filter((p) => CANDIDATES.includes(p.judge))
  .sort((a, b) => b.slotAPickRate - a.slotAPickRate);

// trusted judge, same rows, overall axis
const gt = Object.fromEntries(dt.groundTruth.map((g) => [g.archive, g]));
const gtSlotAPooled =
  dt.groundTruth.reduce((a, g) => a + g.slotA.overall.a, 0) /
  dt.groundTruth.reduce((a, g) => a + g.slotA.overall.a + g.slotA.overall.b, 0);

// per judge x archive: (slot-A pick rate, TIE_FLIP share of scored units).
// A fresh TIE_FLIP is either (i) on an archived-tie unit, where it AGREES —
// that is onArchivedTies.agree — or (ii) on an archived-decisive unit, where
// it is the evacuation — that is decisiveFreshPicks.tieFlip. Their sum is the
// judge's total TIE_FLIP count, and it reproduces §5.3's stated counts
// (Mistral 39 and 37; DeepSeek-Flash 29 and 31).
const pts = dt.perCell
  .filter((c) => CANDIDATES.includes(c.judge) && c.scored > 0)
  .map((c) => ({
    judge: c.judge,
    code: CODE[c.judge],
    archive: c.archive,
    q: c.slotAPickRate,
    tie: (c.decisiveFreshPicks.tieFlip + c.onArchivedTies.agree) / c.scored,
    tieN: c.decisiveFreshPicks.tieFlip + c.onArchivedTies.agree,
    n: c.scored,
  }));

// the trusted judge's own two points on the same axes
const gtPts = dt.groundTruth.map((g) => ({
  code: "GT",
  archive: g.archive,
  q: g.slotA.overall.rate,
  tie: g.perAxis.overall.tie / g.units,
  tieN: g.perAxis.overall.tie,
  n: g.units,
}));

// ── layout ──────────────────────────────────────────────────────────────────
const W = 960, LEFT = 12;
const yTitle = 22, ySub = 38;
const PANEL_TOP = 86;

// Panel A
const AX = 152, AW = 300;
const ROWH = 30;
const aRows = pooled.length + 1; // + trusted judge reference row
const aBottom = PANEL_TOP + aRows * ROWH + 8;

// Panel B
const BX = 552, BW = 336, BH = aBottom - PANEL_TOP - 4;
const BY = PANEL_TOP;

const axisY = Math.max(aBottom, BY + BH) + 6;
const H = axisY + 126;

const xA = scale(0, 1, AX, AX + AW);
const xB = scale(0.4, 1.0, BX, BX + BW);
const yB = scale(0, 1, BY + BH, BY);

const P = [];

P.push(text(LEFT, yTitle, "F2 — Position bias evacuates the counterbalance", { size: 13, weight: 700 }));
P.push(text(LEFT, ySub, "Left: how often each judge picked the first-presented reply. Right: what that propensity alone predicts, and where each judge actually sits.", { size: 9.5, fill: MID }));

// ── Panel A ─────────────────────────────────────────────────────────────────
P.push(text(LEFT, PANEL_TOP - 24, "A.  Slot-A pick rate, pooled judgment rows", { size: 11, weight: 700 }));
for (const t of [0, 0.25, 0.5, 0.75, 1.0]) {
  P.push(line(xA(t), PANEL_TOP - 10, xA(t), aBottom - 12, { stroke: HAIR, width: 1 }));
}

let ay = PANEL_TOP + 6;
for (const p of pooled) {
  P.push(text(AX - 10, ay + 4, p.judge, { size: 10, anchor: "end", weight: 600 }));
  P.push(rect(xA(0), ay - 8, xA(p.slotAPickRate) - xA(0), 16, { fill: FILL_LIGHT, stroke: INK, width: 0.8 }));
  P.push(text(xA(p.slotAPickRate) + 6, ay + 4, `${pct(p.slotAPickRate)}  (n=${p.slotAN} rows)`, { size: 9.5, fill: MID }));
  ay += ROWH;
}
// trusted judge, drawn as an outline bar so it reads as the reference, not a candidate
P.push(text(AX - 10, ay + 4, "trusted judge (opus-4.8)", { size: 10, anchor: "end", fill: MID, style: "font-style:italic" }));
P.push(rect(xA(0), ay - 8, xA(gtSlotAPooled) - xA(0), 16, { fill: "url(#hatchLight)", stroke: MID, width: 0.8 }));
P.push(text(xA(gtSlotAPooled) + 6, ay + 4, `${pct(gtSlotAPooled)}  (n=192 rows)`, { size: 9.5, fill: MID }));

// 50% line last so it sits on top of the bars
P.push(line(xA(0.5), PANEL_TOP - 10, xA(0.5), aBottom - 12, { stroke: INK, width: 1.4, dash: "5 3" }));
P.push(text(xA(0.5), PANEL_TOP - 15, "50%", { size: 9, anchor: "middle", weight: 700 }));

P.push(xAxis(AX, aBottom - 12, AW, [0, 0.25, 0.5, 0.75, 1.0], xA, { label: "share of judgments naming the first-presented reply" }));

// ── Panel B ─────────────────────────────────────────────────────────────────
P.push(text(BX - 44, PANEL_TOP - 24, "B.  Observed TIE_FLIP rate vs. the content-blind prediction", { size: 11, weight: 700 }));
P.push(rect(BX, BY, BW, BH, { fill: "none", stroke: HAIR, width: 1 }));
for (const t of [0.25, 0.5, 0.75]) {
  P.push(line(BX, yB(t), BX + BW, yB(t), { stroke: HAIR, width: 1 }));
  P.push(text(BX - 6, yB(t) + 3.5, `${Math.round(t * 100)}%`, { size: 9, anchor: "end", fill: SOFT }));
}
P.push(text(BX - 6, yB(1) + 3.5, "100%", { size: 9, anchor: "end", fill: SOFT }));
P.push(text(BX - 6, yB(0) + 3.5, "0%", { size: 9, anchor: "end", fill: SOFT }));

// the analytic curve  P(TIE_FLIP) = q^2 + (1-q)^2
const curve = [];
for (let i = 0; i <= 120; i++) {
  const q = 0.4 + (0.6 * i) / 120;
  curve.push(`${i === 0 ? "M" : "L"}${xB(q).toFixed(1)},${yB(q * q + (1 - q) * (1 - q)).toFixed(1)}`);
}
P.push(`<path d="${curve.join(" ")}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-dasharray="7 3"/>`);
P.push(text(xB(0.955), yB(0.915) - 8, "content-blind prediction", { size: 9, anchor: "end", weight: 700 }));
P.push(text(xB(0.955), yB(0.915) + 3, "q² + (1−q)²", { size: 9, anchor: "end", fill: MID }));

// measured points
function marker(px, py, filled) {
  return filled
    ? circle(px, py, 4.4, { fill: INK })
    : circle(px, py, 4.4, { fill: PAPER, stroke: INK, width: 1.6 });
}
// Deterministic label placer: try right, left, above, below in that order and
// take the first slot that does not collide with a label already placed. Ten
// points in a 336px box will otherwise collide (Mistral's two archives sit
// almost on top of each other), and a hand-nudged offset is exactly the kind
// of thing that silently rots when the data moves.
const placed = [];
function placeLabel(px, py, s, opts = {}) {
  const size = 8.5;
  const w = s.length * size * 0.58, h = size * 1.15;
  const slots = [
    { x: px + 7, y: py + 3.5, anchor: "start" },
    { x: px - 7, y: py + 3.5, anchor: "end" },
    { x: px, y: py - 8, anchor: "middle" },
    { x: px, y: py + 14, anchor: "middle" },
    { x: px + 7, y: py - 8, anchor: "start" },
    { x: px - 7, y: py + 14, anchor: "end" },
  ];
  for (const sl of slots) {
    const x0 = sl.anchor === "end" ? sl.x - w : sl.anchor === "middle" ? sl.x - w / 2 : sl.x;
    const box = { x0, x1: x0 + w, y0: sl.y - h * 0.8, y1: sl.y + h * 0.3 };
    const hit = placed.some((b) => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1);
    if (!hit) {
      placed.push(box);
      return text(sl.x, sl.y, s, { size, anchor: sl.anchor, ...opts });
    }
  }
  const box = { x0: px + 7, x1: px + 7 + w, y0: py - 4, y1: py + 5 };
  placed.push(box);
  return text(px + 7, py + 3.5, s, { size, ...opts });
}

for (const p of pts) {
  const px = xB(p.q), py = yB(p.tie);
  P.push(marker(px, py, p.archive === "charm-grok"));
  P.push(placeLabel(px, py, p.code, { fill: MID }));
}
for (const p of gtPts) {
  const px = xB(p.q), py = yB(p.tie);
  // trusted judge drawn as a cross so it never reads as one more candidate
  P.push(line(px - 5, py, px + 5, py, { stroke: INK, width: 2 }));
  P.push(line(px, py - 5, px, py + 5, { stroke: INK, width: 2 }));
  P.push(placeLabel(px, py, "GT", { weight: 700 }));
}

P.push(text(BX - 40, BY + BH / 2, "share of units returned TIE_FLIP", {
  size: 9.5, anchor: "middle", fill: MID,
  style: `transform:rotate(-90deg);transform-origin:${(BX - 40).toFixed(1)}px ${(BY + BH / 2).toFixed(1)}px`,
}));
P.push(xAxis(BX, BY + BH, BW, [0.4, 0.6, 0.8, 1.0], xB, { label: "slot-A pick rate q (per judge × archive)" }));

// ── legend + provenance ─────────────────────────────────────────────────────
const ly = axisY + 46, ly2 = axisY + 62;
P.push(circle(LEFT + 5, ly - 3.5, 4.4, { fill: INK }));
P.push(text(LEFT + 15, ly, "charm-grok (the 38–2 landslide)", { size: 9, fill: MID }));
P.push(circle(LEFT + 190, ly - 3.5, 4.4, { fill: PAPER, stroke: INK, width: 1.6 }));
P.push(text(LEFT + 200, ly, "charm-luna (the 17–18 coin-toss)", { size: 9, fill: MID }));
P.push(line(LEFT + 383, ly - 3.5, LEFT + 393, ly - 3.5, { stroke: INK, width: 2 }));
P.push(line(LEFT + 388, ly - 8.5, LEFT + 388, ly + 1.5, { stroke: INK, width: 2 }));
P.push(text(LEFT + 400, ly, "GT = the trusted judge on the identical rows", { size: 9, fill: MID }));
P.push(text(LEFT, ly2, "MIS Mistral-Large-3   ·   DS-F / DS-P DeepSeek-V4-Flash / DeepSeek-V4-Pro   ·   GRK grok-4.3   ·   TER gpt-5.6-terra", { size: 8.5, fill: SOFT }));

P.push(text(LEFT, axisY + 84,
  "Read Panel B as: a judge lying ON the dashed curve is producing exactly the tie rate its slot-A propensity alone predicts — its content signal is gone. Mistral-Large-3 sits on the curve",
  { size: 8.5, fill: SOFT }));
P.push(text(LEFT, axisY + 95,
  "on both archives; the trusted judge sits far below it at a comparable pick rate, which is what carrying content information looks like. Curve is analytic (see §4.2/§5.3); all points are measured.",
  { size: 8.5, fill: SOFT }));
P.push(text(LEFT, axisY + 110,
  "Source: docs/paper/analysis/derive-tables.mjs --json (T2 perCell, T3 pooled, T1 ground truth). Cohere command-a-plus is absent: 34 parsed rows of 192, no scorable units.",
  { size: 8.5, fill: SOFT }));

const out = svg(W, H, P.join("\n"),
  "F2 — Slot-A pick rates and the evacuation of the counterbalance",
  "Two panels. Left: pooled slot-A pick rates run from 62.0% for gpt-5.6-terra to 89.6% for Mistral-Large-3, against 58.9% for the trusted judge on identical rows and a 50% reference. Right: observed TIE_FLIP rate plotted against slot-A pick rate for each judge and archive, with the analytic content-blind prediction q squared plus one-minus-q squared drawn as a dashed curve. Mistral-Large-3 lies on the curve on both archives; gpt-5.6-terra and the trusted judge lie far below it.");

const dest = resolve(ROOT, "docs/paper/figures/fig-f2-slot-a-evacuation.svg");
writeFileSync(dest, out);
console.log(`wrote ${dest} (${out.length} bytes; ${pts.length} judge×archive points + ${gtPts.length} trusted-judge points; ${W}x${H})`);

// Print the observed-vs-predicted table too, so §5.3's prose numbers are
// PRINTED BY A COMMITTED SCRIPT rather than typed into the draft by hand.
// The prediction is analytic; q and the observed tie rate are measured.
const blind = (q) => q * q + (1 - q) * (1 - q);
console.log("\njudge                     archive     q       predicted TIE_FLIP  observed TIE_FLIP  gap");
for (const p of [...pts].sort((a, b) => b.q - a.q)) {
  console.log(
    `${p.judge.padEnd(25)} ${p.archive.padEnd(11)} ${pct(p.q).padStart(6)}  ${pct(blind(p.q)).padStart(17)}  ${(`${p.tieN}/${p.n} = ${pct(p.tie)}`).padStart(17)}  ${pct(p.tie - blind(p.q)).padStart(7)}`,
  );
}
for (const p of gtPts) {
  console.log(
    `${"trusted judge (opus-4.8)".padEnd(25)} ${p.archive.padEnd(11)} ${pct(p.q).padStart(6)}  ${pct(blind(p.q)).padStart(17)}  ${(`${p.tieN}/${p.n} = ${pct(p.tie)}`).padStart(17)}  ${pct(p.tie - blind(p.q)).padStart(7)}`,
  );
}
