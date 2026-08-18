"use client";

/**
 * FigOrderEvacuation.tsx — the mechanism figure for Paper B.
 *
 * Claim: position bias does not merely add noise to the counterbalanced
 * design — it evacuates it into ties. A judge with a fixed, content-blind
 * slot-A propensity q produces a decisive (non-tied) verdict only when its
 * two picks (one per presentation order) happen to land on the same model:
 * P(TIE_FLIP) = q² + (1−q)². That curve is analytic, not measured — the
 * paper's one derived (not measured) quantity. Every plotted point is
 * measured. Mistral-Large-3 sits almost exactly on the curve on both
 * archives; the trusted judge and gpt-5.6-terra sit far below it, which is
 * what carrying real content information looks like.
 *
 * Site-native port of docs/paper/figures/fig-f2-slot-a-evacuation.mjs.
 */

import { Fragment, type SVGAttributes } from "react";
import {
  ASH,
  EMBER,
  FONT_MONO,
  FigureShell,
  HAIRLINE,
  INK,
  SLATE,
  SURFACE,
  VisuallyHidden,
  pctStr,
  scaleLinear,
  useFigureId,
  useNarrow,
  useSelfReveal,
} from "./figure-shared";

export interface SlotARow {
  judge: string;
  code: string;
  slotAPickRate: number; // percent, pooled across archives
  n: number;
}

export interface EvacuationPoint {
  judge: string;
  code: string;
  archive: "charm-grok" | "charm-luna";
  q: number; // 0..100, slot-A pick rate for this judge×archive cell
  tieFlipRate: number; // 0..100, observed share of units returned TIE_FLIP
  tieFlipN: number;
  n: number;
  /** True for the point(s) the copy calls out as landing on the curve. */
  onCurve?: boolean;
}

export interface FigOrderEvacuationProps {
  panelA?: SlotARow[];
  trustedJudgeSlotA?: { rate: number; n: number };
  points?: EvacuationPoint[];
  trustedJudgePoints?: Array<{ archive: "charm-grok" | "charm-luna"; q: number; tieFlipRate: number; tieFlipN: number; n: number }>;
  revealIndex?: number;
  className?: string;
}

// Source: docs/website-research/assets-manifest.md "Figure 2" table (Panel A)
// and a live run of docs/paper/analysis/derive-tables.mjs --json (perCell /
// groundTruth, Panel B) on 2026-08-18, matching
// docs/paper/figures/fig-f2-slot-a-evacuation.mjs exactly.
const DEFAULT_PANEL_A: SlotARow[] = [
  { judge: "Mistral-Large-3", code: "MIS", slotAPickRate: 89.6, n: 192 },
  { judge: "DeepSeek-V4-Flash", code: "DS-F", slotAPickRate: 80.2, n: 192 },
  { judge: "grok-4.3", code: "GRK", slotAPickRate: 73.4, n: 192 },
  { judge: "DeepSeek-V4-Pro", code: "DS-P", slotAPickRate: 65.8, n: 190 },
  { judge: "gpt-5.6-terra", code: "TER", slotAPickRate: 62.0, n: 192 },
];

const DEFAULT_TRUSTED_SLOT_A = { rate: 58.9, n: 192 };

const DEFAULT_POINTS: EvacuationPoint[] = [
  { judge: "Mistral-Large-3", code: "MIS", archive: "charm-grok", q: 90.625, tieFlipRate: 81.25, tieFlipN: 39, n: 48, onCurve: true },
  { judge: "Mistral-Large-3", code: "MIS", archive: "charm-luna", q: 88.5417, tieFlipRate: 77.0833, tieFlipN: 37, n: 48, onCurve: true },
  { judge: "DeepSeek-V4-Flash", code: "DS-F", archive: "charm-grok", q: 78.125, tieFlipRate: 60.4167, tieFlipN: 29, n: 48 },
  { judge: "DeepSeek-V4-Flash", code: "DS-F", archive: "charm-luna", q: 82.2917, tieFlipRate: 64.5833, tieFlipN: 31, n: 48 },
  { judge: "grok-4.3", code: "GRK", archive: "charm-grok", q: 76.0417, tieFlipRate: 56.25, tieFlipN: 27, n: 48 },
  { judge: "grok-4.3", code: "GRK", archive: "charm-luna", q: 70.8333, tieFlipRate: 41.6667, tieFlipN: 20, n: 48 },
  { judge: "DeepSeek-V4-Pro", code: "DS-P", archive: "charm-grok", q: 64.5833, tieFlipRate: 45.8333, tieFlipN: 22, n: 48 },
  { judge: "DeepSeek-V4-Pro", code: "DS-P", archive: "charm-luna", q: 67.0213, tieFlipRate: 50.0, tieFlipN: 23, n: 46 },
  { judge: "gpt-5.6-terra", code: "TER", archive: "charm-grok", q: 65.625, tieFlipRate: 31.25, tieFlipN: 15, n: 48 },
  { judge: "gpt-5.6-terra", code: "TER", archive: "charm-luna", q: 58.3333, tieFlipRate: 20.8333, tieFlipN: 10, n: 48 },
];

const DEFAULT_GT_POINTS: FigOrderEvacuationProps["trustedJudgePoints"] = [
  { archive: "charm-grok", q: 56.25, tieFlipRate: 16.6667, tieFlipN: 8, n: 48 },
  { archive: "charm-luna", q: 61.4583, tieFlipRate: 27.0833, tieFlipN: 13, n: 48 },
];

const TITLE = "F2 — Slot-A pick rates and the evacuation of the counterbalance";
const DESC =
  "Two panels. Left: pooled slot-A pick rates run from 62.0% for gpt-5.6-terra to 89.6% for Mistral-Large-3, against 58.9% for the trusted judge on identical rows and a 50% reference. Right: observed TIE_FLIP rate plotted against slot-A pick rate for each judge and archive, with the analytic content-blind prediction q squared plus one-minus-q squared drawn as a dashed curve. Mistral-Large-3 lies on the curve on both archives; gpt-5.6-terra and the trusted judge lie far below it.";

const ARCHIVE_LABEL: Record<string, string> = {
  "charm-grok": "charm-grok (38–2 landslide)",
  "charm-luna": "charm-luna (17–18 coin-toss)",
};

export function FigOrderEvacuation({
  panelA = DEFAULT_PANEL_A,
  trustedJudgeSlotA = DEFAULT_TRUSTED_SLOT_A,
  points = DEFAULT_POINTS,
  trustedJudgePoints = DEFAULT_GT_POINTS,
  revealIndex = 1,
  className,
}: FigOrderEvacuationProps) {
  const { ref, revealed } = useSelfReveal<HTMLElement>();
  const { ref: narrowRef, narrow } = useNarrow<HTMLDivElement>(560);
  const uid = useFigureId("fig-oe");
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;

  const W = narrow ? 400 : 960;
  const LEFT = 14;

  // Panel A geometry — desktop constants match the proven, non-colliding
  // layout in docs/paper/figures/fig-f2-slot-a-evacuation.mjs (AX/AW/BX/BW/
  // ROWH/PANEL_TOP) so the point cluster in Panel B keeps the spacing that
  // layout was tuned for; only the mobile branch is a fresh, stacked layout.
  const AX = narrow ? 66 : 152;
  const AW = narrow ? W - AX - 74 : 300;
  const rowH = narrow ? 30 : 30;
  const aTop = narrow ? 100 : 86;
  const aRows = panelA.length + 1;
  const aBottom = aTop + aRows * rowH + 8;
  const xA = scaleLinear(0, 100, AX, AX + AW);

  // Panel B geometry — stacked below Panel A on narrow, beside it on wide
  const BX = narrow ? 54 : 552;
  const BW = narrow ? W - BX - 24 : 336;
  const BY = narrow ? aBottom + 56 : aTop;
  const BH = narrow ? 240 : aBottom - aTop - 4;
  const xB = scaleLinear(40, 100, BX, BX + BW);
  const yB = scaleLinear(0, 100, BY + BH, BY);

  // Bottom of the two panels' own axis captions ("share naming…" under A,
  // "slot-A pick rate q…" under B) — the legend starts safely below BOTH,
  // not below a generic axisY that under-counted Panel B's caption line and
  // let it collide with the legend (caught in the first render pass).
  const aCaptionY = aBottom + (narrow ? 8 : 2);
  const bCaptionY = BY + BH + 30;
  const legendY = Math.max(aCaptionY, bCaptionY) + (narrow ? 30 : 26);
  const H = legendY + (narrow ? 130 : 64);

  const anim = (delayMs: number): SVGAttributes<SVGElement> => ({
    style: {
      opacity: revealed ? 1 : 0,
      transform: revealed ? "translateY(0)" : "translateY(6px)",
      transition: revealed
        ? `opacity 460ms var(--ease-out-quint, cubic-bezier(.23,1,.32,1)) ${delayMs}ms, transform 460ms var(--ease-out-quint, cubic-bezier(.23,1,.32,1)) ${delayMs}ms`
        : "none",
    },
  });

  // curve path for q in [0.4, 1.0]
  const curveD = (() => {
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const q = 40 + (60 * i) / 120;
      const qq = q / 100;
      const predicted = (qq * qq + (1 - qq) * (1 - qq)) * 100;
      pts.push(`${i === 0 ? "M" : "L"}${xB(q).toFixed(1)},${yB(predicted).toFixed(1)}`);
    }
    return pts.join(" ");
  })();

  // Deterministic label placement, ported directly from fig-f2's own placer
  // (docs/paper/figures/fig-f2-slot-a-evacuation.mjs `placeLabel`) — six
  // slots including the two diagonals, tried in the order that resolved the
  // tight Mistral-Large-3 pair in the original figure. A narrower 4-slot
  // version left MIS/MIS, GRK/DS-P and TER/GT colliding at this point
  // density; the diagonals are load-bearing, not decoration.
  const placed: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  function placeLabel(px: number, py: number, s: string) {
    const size = narrow ? 8 : 8.5;
    const w = s.length * size * 0.58;
    const h = size * 1.15;
    const slots = [
      { x: px + 7, y: py + 3.5, anchor: "start" as const },
      { x: px - 7, y: py + 3.5, anchor: "end" as const },
      { x: px, y: py - 8, anchor: "middle" as const },
      { x: px, y: py + 14, anchor: "middle" as const },
      { x: px + 7, y: py - 8, anchor: "start" as const },
      { x: px - 7, y: py + 14, anchor: "end" as const },
    ];
    for (const sl of slots) {
      const x0 = sl.anchor === "end" ? sl.x - w : sl.anchor === "middle" ? sl.x - w / 2 : sl.x;
      const box = { x0, x1: x0 + w, y0: sl.y - h * 0.8, y1: sl.y + h * 0.3 };
      const hit = placed.some((b) => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1);
      if (!hit) {
        placed.push(box);
        return { x: sl.x, y: sl.y, anchor: sl.anchor, size };
      }
    }
    placed.push({ x0: px + 7, x1: px + 7 + w, y0: py - 4, y1: py + 5 });
    return { x: px + 7, y: py + 3.5, anchor: "start" as const, size };
  }

  const ticksB = [40, 60, 80, 100];
  const codeOrder = [...new Set(points.map((p) => p.code))];

  return (
    <div ref={narrowRef} className={className}>
      <FigureShell
        outerRef={ref}
        revealIndex={revealIndex}
        revealed={revealed}
        caption={
          <>
            Left: how often each judge picked the first-presented reply,
            against the trusted judge&rsquo;s 58.9% on identical rows. Right:
            what that pick rate alone predicts for the tie rate (dashed curve,
            analytic, not measured) and where each judge actually lands — a
            judge sitting on the curve has stopped reading the replies.
            Source:{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>
              docs/paper/figures/fig-f2-slot-a-evacuation.mjs
            </span>
            .
          </>
        }
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height="auto"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          style={{ display: "block", overflow: "visible" }}
        >
          <title id={titleId}>{TITLE}</title>
          <desc id={descId}>{DESC}</desc>

          <text x={LEFT} y={20} fontFamily={FONT_MONO} fontSize={13} fontWeight={700} fill={INK}>
            F2 — Position bias evacuates the counterbalance
          </text>

          {/* ── Panel A ── */}
          <text x={AX} y={aTop - 20} fontFamily={FONT_MONO} fontSize={narrow ? 9.5 : 10.5} fontWeight={700} fill={INK}>
            A. Slot-A pick rate
          </text>
          {[0, 25, 50, 75, 100].map((t) => (
            <line key={t} x1={xA(t)} y1={aTop - 8} x2={xA(t)} y2={aBottom - 14} stroke={HAIRLINE} strokeWidth={1} />
          ))}
          {panelA.map((p, i) => {
            const y = aTop + 8 + i * rowH;
            return (
              <g key={p.judge}>
                <text x={AX - 8} y={y + 4} fontFamily={FONT_MONO} fontSize={narrow ? 9.5 : 10} fontWeight={600} textAnchor="end" fill={INK}>
                  {narrow ? p.code : p.judge}
                </text>
                <g {...anim(80 + i * 50)}>
                  <rect x={xA(0)} y={y - 7} width={xA(p.slotAPickRate) - xA(0)} height={14} fill={HAIRLINE} stroke={INK} strokeWidth={0.8} />
                </g>
                <text x={xA(p.slotAPickRate) + 6} y={y + 4} fontFamily={FONT_MONO} fontSize={narrow ? 8.5 : 9.5} fill={SLATE}>
                  {pctStr(p.slotAPickRate)}
                </text>
              </g>
            );
          })}
          {(() => {
            const y = aTop + 8 + panelA.length * rowH;
            return (
              <g>
                <text x={AX - 8} y={y + 4} fontFamily={FONT_MONO} fontSize={narrow ? 9.5 : 10} textAnchor="end" fill={ASH} fontStyle="italic">
                  {narrow ? "GT" : "trusted judge (opus-4.8)"}
                </text>
                <g {...anim(360)}>
                  <rect x={xA(0)} y={y - 7} width={xA(trustedJudgeSlotA.rate) - xA(0)} height={14} fill={SURFACE} stroke={ASH} strokeWidth={1.2} strokeDasharray="3 2" />
                </g>
                <text x={xA(trustedJudgeSlotA.rate) + 6} y={y + 4} fontFamily={FONT_MONO} fontSize={narrow ? 8.5 : 9.5} fill={SLATE}>
                  {pctStr(trustedJudgeSlotA.rate)}
                </text>
              </g>
            );
          })()}
          <line x1={xA(50)} y1={aTop - 2} x2={xA(50)} y2={aBottom - 14} stroke={INK} strokeWidth={1.3} strokeDasharray="5 3" />
          <text x={xA(50)} y={aTop - 4} fontFamily={FONT_MONO} fontSize={8.5} fontWeight={700} textAnchor="middle" fill={SLATE}>
            50%
          </text>
          <line x1={AX} y1={aBottom - 14} x2={AX + AW} y2={aBottom - 14} stroke={INK} strokeWidth={1} />
          <text x={AX + AW / 2} y={aBottom + (narrow ? 8 : 2)} fontFamily={FONT_MONO} fontSize={narrow ? 8 : 8.5} textAnchor="middle" fill={SLATE}>
            share naming the first-presented reply
          </text>

          {/* ── Panel B ── */}
          <text x={BX} y={BY - 20} fontFamily={FONT_MONO} fontSize={narrow ? 9.5 : 10.5} fontWeight={700} fill={INK}>
            B. Observed TIE_FLIP rate vs. prediction
          </text>
          <rect x={BX} y={BY} width={BW} height={BH} fill="none" stroke={HAIRLINE} strokeWidth={1} />
          {[25, 50, 75].map((t) => (
            <Fragment key={t}>
              <line x1={BX} y1={yB(t)} x2={BX + BW} y2={yB(t)} stroke={HAIRLINE} strokeWidth={1} />
              <text x={BX - 6} y={yB(t) + 3.5} fontFamily={FONT_MONO} fontSize={8.5} textAnchor="end" fill={SLATE}>
                {t}%
              </text>
            </Fragment>
          ))}
          <text x={BX - 6} y={yB(0) + 3.5} fontFamily={FONT_MONO} fontSize={8.5} textAnchor="end" fill={SLATE}>0%</text>
          <text x={BX - 6} y={yB(100) + 3.5} fontFamily={FONT_MONO} fontSize={8.5} textAnchor="end" fill={SLATE}>100%</text>

          <g {...anim(160)}>
            <path d={curveD} fill="none" stroke={ASH} strokeWidth={1.6} strokeDasharray="7 3" />
          </g>
          <text x={xB(93)} y={yB(87) - 9} fontFamily={FONT_MONO} fontSize={8.5} fontWeight={700} textAnchor="end" fill={ASH}>
            analytic, not measured
          </text>
          <text x={xB(93)} y={yB(87) + 3} fontFamily={FONT_MONO} fontSize={8.5} textAnchor="end" fill={ASH}>
            q² + (1−q)²
          </text>

          {/* Same-judge pairs (one point per archive) can sit only a few px
              apart at this data density — Mistral-Large-3's pair is the
              tightest. A thin connector plus ONE shared code label (placed
              at whichever archive point sits further from the curve, so it
              lands in the more open space) reads cleaner than two "MIS"
              strings fighting for the same few pixels, and doubles as a
              visual echo of the dumbbell motif in Figure 3. */}
          {codeOrder.map((code) => {
            const group = points.filter((p) => p.code === code);
            if (group.length < 2) return null;
            const [a, b] = group;
            return (
              <line
                key={`connector-${code}`}
                x1={xB(a.q)}
                y1={yB(a.tieFlipRate)}
                x2={xB(b.q)}
                y2={yB(b.tieFlipRate)}
                stroke={a.onCurve ? EMBER : HAIRLINE}
                strokeWidth={1}
                opacity={0.6}
              />
            );
          })}
          {points.map((p, i) => {
            const px = xB(p.q);
            const py = yB(p.tieFlipRate);
            const filled = p.archive === "charm-grok";
            const group = points.filter((q) => q.code === p.code);
            const labelHere =
              group.length < 2 ||
              p === group.reduce((best, cur) => (cur.tieFlipRate > best.tieFlipRate ? cur : best));
            const lbl = labelHere && !(narrow && !p.onCurve) ? placeLabel(px, py, p.code) : null;
            const color = p.onCurve ? EMBER : INK;
            return (
              <g key={`${p.judge}-${p.archive}`} {...anim(200 + i * 40)}>
                <circle cx={px} cy={py} r={narrow ? 3.6 : 4.2} fill={filled ? color : SURFACE} stroke={color} strokeWidth={1.7} />
                {lbl && (
                  <text x={lbl.x} y={lbl.y} fontFamily={FONT_MONO} fontSize={lbl.size} textAnchor={lbl.anchor} fill={p.onCurve ? EMBER : SLATE} fontWeight={p.onCurve ? 700 : 400}>
                    {p.code}
                  </text>
                )}
              </g>
            );
          })}
          {trustedJudgePoints?.map((p, i) => {
            const px = xB(p.q);
            const py = yB(p.tieFlipRate);
            const lbl = placeLabel(px, py, "GT");
            return (
              <g key={`gt-${p.archive}`} {...anim(560 + i * 60)}>
                <line x1={px - 5} y1={py} x2={px + 5} y2={py} stroke={INK} strokeWidth={2.2} />
                <line x1={px} y1={py - 5} x2={px} y2={py + 5} stroke={INK} strokeWidth={2.2} />
                <text x={lbl.x} y={lbl.y} fontFamily={FONT_MONO} fontSize={lbl.size} fontWeight={700} textAnchor={lbl.anchor} fill={INK}>
                  GT
                </text>
              </g>
            );
          })}

          <text
            x={narrow ? 16 : BX - 34}
            y={BY + BH / 2}
            fontFamily={FONT_MONO}
            fontSize={8.5}
            textAnchor="middle"
            fill={SLATE}
            transform={`rotate(-90 ${(narrow ? 16 : BX - 34)} ${BY + BH / 2})`}
          >
            share of units returned TIE_FLIP
          </text>
          <line x1={BX} y1={BY + BH} x2={BX + BW} y2={BY + BH} stroke={INK} strokeWidth={1} />
          {ticksB.map((t) => (
            <Fragment key={t}>
              <line x1={xB(t)} y1={BY + BH} x2={xB(t)} y2={BY + BH + 4} stroke={INK} strokeWidth={1} />
              <text x={xB(t)} y={BY + BH + 15} fontFamily={FONT_MONO} fontSize={narrow ? 8 : 9} textAnchor="middle" fill={SLATE}>
                {t}%
              </text>
            </Fragment>
          ))}
          <text x={BX + BW / 2} y={BY + BH + (narrow ? 30 : 30)} fontFamily={FONT_MONO} fontSize={narrow ? 8 : 8.5} textAnchor="middle" fill={SLATE}>
            slot-A pick rate q (judge × archive)
          </text>

          {/* legend */}
          <g transform={`translate(0, ${legendY})`}>
            <circle cx={LEFT + 5} cy={0} r={4.2} fill={INK} />
            <text x={LEFT + 15} y={3.5} fontFamily={FONT_MONO} fontSize={9} fill={SLATE}>
              filled = charm-grok (38–2 landslide)
            </text>
            <circle cx={narrow ? LEFT + 5 : LEFT + 220} cy={narrow ? 16 : 0} r={4.2} fill={SURFACE} stroke={INK} strokeWidth={1.6} />
            <text x={narrow ? LEFT + 15 : LEFT + 230} y={narrow ? 19.5 : 3.5} fontFamily={FONT_MONO} fontSize={9} fill={SLATE}>
              hollow = charm-luna (17–18 coin-toss)
            </text>
            <g transform={`translate(${narrow ? LEFT + 5 : LEFT + 470}, ${narrow ? 32 : 0})`}>
              <line x1={-5} y1={0} x2={5} y2={0} stroke={INK} strokeWidth={2.2} />
              <line x1={0} y1={-5} x2={0} y2={5} stroke={INK} strokeWidth={2.2} />
            </g>
            <text x={narrow ? LEFT + 15 : LEFT + 480} y={narrow ? 35.5 : 3.5} fontFamily={FONT_MONO} fontSize={9} fill={SLATE}>
              GT = trusted judge, same rows
            </text>
          </g>
          <text x={LEFT} y={legendY + (narrow ? 48 : 22)} fontFamily={FONT_MONO} fontSize={8} fill={EMBER} fontWeight={600}>
            ember = lands on the curve (content signal gone)
          </text>
          <text x={LEFT} y={legendY + (narrow ? 62 : 36)} fontFamily={FONT_MONO} fontSize={8} fill={SLATE}>
            MIS Mistral-L3 · DS-F/DS-P DeepSeek-V4-Flash/Pro · GRK grok-4.3 · TER gpt-5.6-terra
          </text>
        </svg>

        <VisuallyHidden>
          <table>
            <caption>{DESC}</caption>
            <thead>
              <tr>
                <th>Panel A — judge</th>
                <th>slot-A pick rate</th>
                <th>rows</th>
              </tr>
            </thead>
            <tbody>
              {panelA.map((p) => (
                <tr key={p.judge}>
                  <td>{p.judge}</td>
                  <td>{pctStr(p.slotAPickRate)}</td>
                  <td>{p.n}</td>
                </tr>
              ))}
              <tr>
                <td>trusted judge (claude-opus-4.8)</td>
                <td>{pctStr(trustedJudgeSlotA.rate)}</td>
                <td>{trustedJudgeSlotA.n}</td>
              </tr>
            </tbody>
          </table>
          <table>
            <caption>
              Panel B — observed TIE_FLIP rate vs. the analytic content-blind
              prediction q² + (1−q)², per judge × archive
            </caption>
            <thead>
              <tr>
                <th>judge</th>
                <th>archive</th>
                <th>slot-A pick rate q</th>
                <th>observed TIE_FLIP rate</th>
                <th>note</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={`${p.judge}-${p.archive}`}>
                  <td>{p.judge}</td>
                  <td>{ARCHIVE_LABEL[p.archive]}</td>
                  <td>{pctStr(p.q)}</td>
                  <td>
                    {p.tieFlipN}/{p.n} = {pctStr(p.tieFlipRate)}
                  </td>
                  <td>{p.onCurve ? "lands on the analytic curve" : ""}</td>
                </tr>
              ))}
              {trustedJudgePoints?.map((p) => (
                <tr key={`gt-${p.archive}`}>
                  <td>trusted judge (claude-opus-4.8)</td>
                  <td>{ARCHIVE_LABEL[p.archive]}</td>
                  <td>{pctStr(p.q)}</td>
                  <td>
                    {p.tieFlipN}/{p.n} = {pctStr(p.tieFlipRate)}
                  </td>
                  <td>far below the curve — content is doing work</td>
                </tr>
              ))}
            </tbody>
          </table>
        </VisuallyHidden>
      </FigureShell>
    </div>
  );
}

export default FigOrderEvacuation;
