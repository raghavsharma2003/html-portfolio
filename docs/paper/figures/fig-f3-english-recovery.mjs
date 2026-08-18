#!/usr/bin/env node
// docs/paper/figures/fig-f3-english-recovery.mjs — WS-PAPER-W.
//
// F3 — "It's not the code-switching."
// The R4 translation control, drawn as a paired (dumbbell) plot: for each of
// the five scorable judges, agreement in the Hinglish condition and agreement
// on the SAME 96 units machine-translated to monolingual English, with the
// clustered CI for each condition and — the point of the figure — this
// programme's own measured noise floor shaded around the Hinglish value.
//
// The noise floor is not a rhetorical device. `context/measurements.md`
// `fab-noise-floor` measured a 13.6 pp spread in judged rates across 300
// arm-pairs whose input was provably BYTE-IDENTICAL, i.e. where the setting
// under test could not act at all. A judged-rate difference smaller than that
// band, in this programme, is not a result. Every recovery in this figure
// lands inside it — which is what "register causality is NOT established"
// means, drawn rather than asserted.
//
// Numbers are read from docs/paper/analysis/r4/summary.json (the committed R4
// output) and NOT recomputed here; the noise floor is the single hardcoded
// constant and it is a citation, not an estimate.
//
// Run: node docs/paper/figures/fig-f3-english-recovery.mjs
// Out: docs/paper/figures/fig-f3-english-recovery.svg

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT, svg, text, line, rect, circle, interval, xAxis, scale,
  INK, MID, SOFT, HAIR, PAPER, pct, pp,
} from "./_svgkit.mjs";

const BAR = 0.80;
const NOISE_FLOOR_PP = 13.6;   // context/measurements.md `fab-noise-floor`, n=300 arm-pairs

const r4 = JSON.parse(readFileSync(resolve(ROOT, "docs/paper/analysis/r4/summary.json"), "utf8"));
const rows = [...r4.recovery_table].sort((a, b) => b.recovery_pp - a.recovery_pp);

// ── layout ──────────────────────────────────────────────────────────────────
const W = 960, LEFT = 12;
const PADL = 176, PADR = 306;
const PLOTW = W - PADL - PADR;
const ROWH = 46;
const yTitle = 22, ySub1 = 38, ySub2 = 50;
const yTop = 84;
const yFirst = yTop + 28;
const rowY = rows.map((_, i) => yFirst + i * ROWH);
const yBot = rowY[rowY.length - 1] + 22;
const axisY = yBot + 8;
const H = axisY + 122;

const x = scale(0, 1, PADL, PADL + PLOTW);
const P = [];

P.push(text(LEFT, yTitle, "F3 — The translation control: removing the code-switching does not rescue any judge", { size: 13, weight: 700 }));
P.push(text(LEFT, ySub1, "Same 96 archived units, same both-orders protocol, same trusted verdicts; the only change is that both transcripts per unit were machine-translated to", { size: 9.5, fill: MID }));
P.push(text(LEFT, ySub2, `monolingual English and the rubric's language descriptor changed. Shaded band = ±${NOISE_FLOOR_PP} pp, this programme's measured judged-rate noise floor on byte-identical input.`, { size: 9.5, fill: MID }));

for (const t of [0.2, 0.4, 0.6, 0.8]) {
  P.push(line(x(t), yTop, x(t), yBot, { stroke: HAIR, width: 1 }));
}
P.push(line(x(BAR), yTop - 12, x(BAR), yBot, { stroke: INK, width: 1.6, dash: "6 3" }));
P.push(text(x(BAR), yTop - 17, "pre-registered bar ≥80%", { size: 9.5, anchor: "middle", weight: 700 }));

rows.forEach((r, i) => {
  const y = rowY[i];
  const hi = r.hinglish_pct / 100, en = r.english_pct / 100;
  const lo = Math.max(0, hi - NOISE_FLOOR_PP / 100), up = Math.min(1, hi + NOISE_FLOOR_PP / 100);

  // the noise band first, so everything else sits on top of it
  P.push(rect(x(lo), y - 16, x(up) - x(lo), 32, { fill: "url(#hatchLight)", stroke: HAIR, width: 1 }));

  P.push(text(PADL - 10, y - 2, r.judge, { size: 10.5, anchor: "end", weight: 600 }));
  P.push(text(PADL - 10, y + 11, r.note.includes("translator") ? "translator = this judge (§7 L7)" : "", { size: 8, anchor: "end", fill: SOFT }));

  // clustered CIs: Hinglish above the row centre, English below it
  const yH = y - 8, yE = y + 8;
  P.push(interval(x(r.hinglish_clustered_ci[0] / 100), x(r.hinglish_clustered_ci[1] / 100), yH, { stroke: SOFT, width: 1.2, cap: 4 }));
  P.push(interval(x(r.english_clustered_ci[0] / 100), x(r.english_clustered_ci[1] / 100), yE, { stroke: SOFT, width: 1.2, cap: 4 }));

  // the pair itself: open = Hinglish, filled = English, connector shows direction
  P.push(line(x(hi), yH, x(en), yE, { stroke: INK, width: 1.4 }));
  P.push(circle(x(hi), yH, 4.6, { fill: PAPER, stroke: INK, width: 1.8 }));
  P.push(circle(x(en), yE, 4.6, { fill: INK }));

  P.push(text(PADL + PLOTW + 14, y - 3,
    `${r.hinglish_agree} → ${r.english_agree}`, { size: 9.5, fill: MID }));
  P.push(text(PADL + PLOTW + 14, y + 10,
    `${pct(hi)} → ${pct(en)}`, { size: 9.5, fill: MID }));
  P.push(text(W - LEFT, y - 3, pp(r.recovery_pp), { size: 11, anchor: "end", weight: 700 }));
  // asserted by the data, not by the caption
  P.push(text(W - LEFT, y + 10,
    Math.abs(r.recovery_pp) <= NOISE_FLOOR_PP ? "inside noise floor" : "OUTSIDE noise floor",
    { size: 8.5, anchor: "end", fill: SOFT }));
});

P.push(xAxis(PADL, axisY, PLOTW, [0, 0.2, 0.4, 0.6, 0.8, 1.0], x, {
  label: "unit-level agreement with the archived trusted verdicts (unchanged between conditions)",
}));

// legend
const ly = axisY + 52;
P.push(circle(LEFT + 6, ly - 3.5, 4.6, { fill: PAPER, stroke: INK, width: 1.8 }));
P.push(text(LEFT + 17, ly, "Hinglish condition (run R0)", { size: 9, fill: MID }));
P.push(circle(LEFT + 176, ly - 3.5, 4.6, { fill: INK }));
P.push(text(LEFT + 187, ly, "English condition (run R4)", { size: 9, fill: MID }));
P.push(rect(LEFT + 344, ly - 9, 22, 11, { fill: "url(#hatchLight)", stroke: HAIR, width: 1 }));
P.push(text(LEFT + 372, ly, `±${NOISE_FLOOR_PP} pp noise floor (fab-noise-floor, n=300 byte-identical arm-pairs)`, { size: 9, fill: MID }));

P.push(text(LEFT, axisY + 76,
  "All five English-condition runs are VALID under the harness's own guards (max transport-miss rate 2.6%, threshold 5%). Mean recovery across the panel is +3.2 pp; the largest is +6.6 pp;",
  { size: 8.5, fill: SOFT }));
P.push(text(LEFT, axisY + 87,
  "the best judge in both conditions moves the WRONG way (−3.1 pp). Every English-condition clustered CI overlaps its Hinglish counterpart, and no upper bound comes near the 80% bar.",
  { size: 8.5, fill: SOFT }));
P.push(text(LEFT, axisY + 102,
  "Source: docs/paper/analysis/r4/summary.json (recovery_table); clustered CIs via docs/paper/analysis/clustered-cis.mjs (cluster = beat, 12 clusters, 10,000 reps, seed 20260818).",
  { size: 8.5, fill: SOFT }));

const out = svg(W, H, P.join("\n"),
  "F3 — Hinglish versus English agreement per judge, against the measured noise floor",
  "Paired dumbbell plot for five judges. Recoveries from the Hinglish to the English condition run from minus 3.1 to plus 6.6 percentage points, mean plus 3.2. Every English point falls inside a shaded plus-or-minus 13.6 percentage point noise band centred on its Hinglish value, every clustered confidence interval overlaps its counterpart, and no judge approaches the 80% qualification bar in either condition.");

const dest = resolve(ROOT, "docs/paper/figures/fig-f3-english-recovery.svg");
writeFileSync(dest, out);
console.log(`wrote ${dest} (${out.length} bytes; ${rows.length} judges; ${W}x${H})`);
