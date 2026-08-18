"use client";

/**
 * FigEnglishControl.tsx — the refutation figure for Paper B.
 *
 * Claim: the paper was named for a hypothesis — that Hindi–English
 * code-switching defeats the judges' register model. The same 96 archived
 * units, machine-translated to monolingual English and re-judged under an
 * identical protocol, refute it. Every recovery is small (−3.1 to +6.6 pp,
 * mean +3.2) and every one of them lands inside this programme's own
 * measured ±13.6 pp noise floor — a spread recorded across 300 arm-pairs
 * whose input was provably byte-identical, i.e. where the setting under
 * test could not have acted at all. A recovery smaller than that band is
 * not a result, in this programme's own terms.
 *
 * Site-native port of docs/paper/figures/fig-f3-english-recovery.mjs.
 */

import { Fragment, type SVGAttributes } from "react";
import {
  ASH,
  EMBER,
  FONT_MONO,
  FigureShell,
  HAIRLINE,
  HatchDefs,
  INK,
  SLATE,
  SURFACE,
  VisuallyHidden,
  pctStr,
  ppStr,
  scaleLinear,
  useFigureId,
  useNarrow,
  useSelfReveal,
} from "./figure-shared";

export interface RecoveryRow {
  judge: string;
  code: string;
  hinglishPct: number;
  hinglishCi: [number, number];
  hinglishAgree: string; // e.g. "29/94"
  englishPct: number;
  englishCi: [number, number];
  englishAgree: string; // e.g. "36/96"
  recoveryPp: number;
  isTranslator?: boolean;
}

export interface FigEnglishControlProps {
  rows?: RecoveryRow[];
  bar?: number;
  noiseFloorPp?: number;
  revealIndex?: number;
  className?: string;
}

// Source: docs/website-research/assets-manifest.md "Figure 3" table, matching
// a live run of docs/paper/analysis/r4/summary.json (recovery_table) on
// 2026-08-18. Sorted by recovery, descending, as in the source figure.
const DEFAULT_ROWS: RecoveryRow[] = [
  { judge: "DeepSeek-V4-Pro", code: "DS-P", hinglishPct: 30.9, hinglishCi: [20.7, 41.5], hinglishAgree: "29/94", englishPct: 37.5, englishCi: [28.1, 47.9], englishAgree: "36/96", recoveryPp: 6.6 },
  { judge: "Mistral-Large-3", code: "MIS", hinglishPct: 29.2, hinglishCi: [20.8, 38.5], hinglishAgree: "28/96", englishPct: 34.7, englishCi: [26.3, 45.3], englishAgree: "33/95", recoveryPp: 5.6 },
  { judge: "DeepSeek-V4-Flash", code: "DS-F", hinglishPct: 28.1, hinglishCi: [18.8, 39.6], hinglishAgree: "27/96", englishPct: 31.9, englishCi: [19.4, 45.2], englishAgree: "29/91", recoveryPp: 3.7 },
  { judge: "grok-4.3", code: "GRK", hinglishPct: 34.4, hinglishCi: [25.0, 43.8], hinglishAgree: "33/96", englishPct: 37.5, englishCi: [29.2, 45.8], englishAgree: "36/96", recoveryPp: 3.1 },
  { judge: "gpt-5.6-terra", code: "TER", hinglishPct: 54.2, hinglishCi: [43.8, 64.6], hinglishAgree: "52/96", englishPct: 51.0, englishCi: [38.5, 63.5], englishAgree: "49/96", recoveryPp: -3.1, isTranslator: true },
];

const TITLE = "F3 — Hinglish versus English agreement per judge, against the measured noise floor";
const DESC =
  "Paired dumbbell plot for five judges. Recoveries from the Hinglish to the English condition run from minus 3.1 to plus 6.6 percentage points, mean plus 3.2. Every English point falls inside a shaded plus-or-minus 13.6 percentage point noise band centred on its Hinglish value, every clustered confidence interval overlaps its counterpart, and no judge approaches the 80% qualification bar in either condition.";

export function FigEnglishControl({
  rows = DEFAULT_ROWS,
  bar = 80,
  noiseFloorPp = 13.6,
  revealIndex = 2,
  className,
}: FigEnglishControlProps) {
  const { ref, revealed, reducedMotion } = useSelfReveal<HTMLElement>();
  const { ref: narrowRef, narrow } = useNarrow<HTMLDivElement>(560);
  const uid = useFigureId("fig-ec");
  const hatchId = `${uid}-hatch`;
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;

  const W = narrow ? 400 : 760;
  const LEFT = 14;
  const PADL = narrow ? 60 : 156;
  const PADR = narrow ? 14 : 168;
  const PLOTW = W - PADL - PADR;
  const ROWH = narrow ? 62 : 48;
  const yTitle = 20;
  const ySub1 = 36;
  const ySub2 = narrow ? 62 : 50;
  const yTop = narrow ? 82 : 70;
  const yFirst = yTop + 26;
  const rowY = rows.map((_, i) => yFirst + i * ROWH);
  const yBot = rowY[rowY.length - 1] + 22;
  const axisY = yBot + 8;
  const H = axisY + (narrow ? 110 : 66);

  const x = scaleLinear(0, 100, PADL, PADL + PLOTW);
  const ticks = narrow ? [0, 50, 80, 100] : [0, 20, 40, 60, 80, 100];

  const anim = (delayMs: number): SVGAttributes<SVGElement> => ({
    style: {
      opacity: revealed || reducedMotion ? 1 : 0,
      transform: revealed || reducedMotion ? "translateY(0)" : "translateY(8px)",
      transition:
        !reducedMotion && revealed
          ? `opacity 480ms var(--ease-out-quint, cubic-bezier(.23,1,.32,1)) ${delayMs}ms, transform 480ms var(--ease-out-quint, cubic-bezier(.23,1,.32,1)) ${delayMs}ms`
          : "none",
    },
  });

  return (
    <div ref={narrowRef} className={className}>
      <FigureShell
        outerRef={ref}
        revealIndex={revealIndex}
        reducedMotion={reducedMotion}
        revealed={revealed}
        caption={
          <>
            The same 96 units, machine-translated to monolingual English and
            re-judged. Every recovery is small and falls inside this
            programme&rsquo;s own ±13.6-point measurement noise floor —
            removing the code-switching does not rescue any judge. Source:{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>
              docs/paper/figures/fig-f3-english-recovery.mjs
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
          <HatchDefs id={hatchId} />

          <text x={LEFT} y={yTitle} fontFamily={FONT_MONO} fontSize={13} fontWeight={700} fill={INK}>
            F3 — It&rsquo;s not the code-switching
          </text>
          <text x={LEFT} y={ySub1} fontFamily={FONT_MONO} fontSize={narrow ? 8.5 : 9.5} fill={SLATE}>
            Same 96 units, same protocol, translated to monolingual English.
          </text>
          <text x={LEFT} y={ySub2} fontFamily={FONT_MONO} fontSize={narrow ? 8.5 : 9.5} fill={SLATE}>
            Shaded = ±{noiseFloorPp}pp noise floor on byte-identical input.
          </text>

          {ticks.map((t) => (
            <line key={t} x1={x(t)} y1={yTop} x2={x(t)} y2={yBot} stroke={HAIRLINE} strokeWidth={1} />
          ))}
          <line x1={x(bar)} y1={yTop - 12} x2={x(bar)} y2={yBot} stroke={EMBER} strokeWidth={2} strokeDasharray="6 3" />
          <text x={x(bar)} y={yTop - 17} fontFamily={FONT_MONO} fontSize={narrow ? 8.5 : 9.5} fontWeight={700} textAnchor="middle" fill={EMBER}>
            bar ≥{pctStr(bar, 0)}
          </text>

          {rows.map((r, i) => {
            const y = rowY[i];
            const lo = Math.max(0, r.hinglishPct - noiseFloorPp);
            const hi = Math.min(100, r.hinglishPct + noiseFloorPp);
            const yH = y - 9;
            const yE = y + 9;
            const inside = Math.abs(r.recoveryPp) <= noiseFloorPp;
            return (
              <g key={r.judge}>
                <g {...anim(60 + i * 70)}>
                  <rect x={x(lo)} y={y - 17} width={x(hi) - x(lo)} height={34} fill={`url(#${hatchId})`} stroke={HAIRLINE} strokeWidth={1} />
                </g>

                <text x={PADL - 10} y={y - 3} fontFamily={FONT_MONO} fontSize={narrow ? 10 : 10.5} fontWeight={600} textAnchor="end" fill={INK}>
                  {narrow ? r.code : r.judge}
                </text>
                {r.isTranslator && (
                  <text x={PADL - 10} y={y + 10} fontFamily={FONT_MONO} fontSize={7} textAnchor="end" fill={SLATE} fontStyle="italic">
                    {narrow ? "+ translator" : "also the translator"}
                  </text>
                )}

                <g {...anim(120 + i * 70)}>
                  <line x1={x(r.hinglishCi[0])} y1={yH} x2={x(r.hinglishCi[1])} y2={yH} stroke={ASH} strokeWidth={1.2} />
                  <line x1={x(r.hinglishCi[0])} y1={yH - 4} x2={x(r.hinglishCi[0])} y2={yH + 4} stroke={ASH} strokeWidth={1.2} />
                  <line x1={x(r.hinglishCi[1])} y1={yH - 4} x2={x(r.hinglishCi[1])} y2={yH + 4} stroke={ASH} strokeWidth={1.2} />
                  <line x1={x(r.englishCi[0])} y1={yE} x2={x(r.englishCi[1])} y2={yE} stroke={ASH} strokeWidth={1.2} />
                  <line x1={x(r.englishCi[0])} y1={yE - 4} x2={x(r.englishCi[0])} y2={yE + 4} stroke={ASH} strokeWidth={1.2} />
                  <line x1={x(r.englishCi[1])} y1={yE - 4} x2={x(r.englishCi[1])} y2={yE + 4} stroke={ASH} strokeWidth={1.2} />

                  <line x1={x(r.hinglishPct)} y1={yH} x2={x(r.englishPct)} y2={yE} stroke={INK} strokeWidth={1.5} />
                  <circle cx={x(r.hinglishPct)} cy={yH} r={4.6} fill={SURFACE} stroke={INK} strokeWidth={1.8} />
                  <circle cx={x(r.englishPct)} cy={yE} r={4.6} fill={INK} />
                </g>

                {!narrow ? (
                  <>
                    <text x={PADL + PLOTW + 14} y={y - 4} fontFamily={FONT_MONO} fontSize={9.5} fill={SLATE}>
                      {pctStr(r.hinglishPct)} → {pctStr(r.englishPct)}
                    </text>
                    <text x={W - LEFT} y={y - 4} fontFamily={FONT_MONO} fontSize={11} fontWeight={700} textAnchor="end" fill={INK}>
                      {ppStr(r.recoveryPp)}
                    </text>
                    <text x={W - LEFT} y={y + 10} fontFamily={FONT_MONO} fontSize={8.5} textAnchor="end" fill={SLATE}>
                      {inside ? "inside noise floor" : "OUTSIDE noise floor"}
                    </text>
                  </>
                ) : (
                  // Centered under the row, spanning the full plot width, so
                  // this summary never runs off the card's left edge the way
                  // an end-anchored label at the narrow label column would.
                  <text x={PADL + PLOTW / 2} y={y + 24} fontFamily={FONT_MONO} fontSize={8.5} textAnchor="middle" fill={SLATE}>
                    {pctStr(r.hinglishPct)} → {pctStr(r.englishPct)} ({ppStr(r.recoveryPp)})
                  </text>
                )}
              </g>
            );
          })}

          <line x1={PADL} y1={axisY} x2={PADL + PLOTW} y2={axisY} stroke={INK} strokeWidth={1} />
          {ticks.map((t) => (
            <Fragment key={t}>
              <line x1={x(t)} y1={axisY} x2={x(t)} y2={axisY + 4} stroke={INK} strokeWidth={1} />
              <text x={x(t)} y={axisY + 15} fontFamily={FONT_MONO} fontSize={narrow ? 9 : 10} textAnchor="middle" fill={SLATE}>
                {t}%
              </text>
            </Fragment>
          ))}
          <text x={PADL + PLOTW / 2} y={axisY + 30} fontFamily={FONT_MONO} fontSize={narrow ? 8.5 : 9.5} textAnchor="middle" fill={SLATE}>
            agreement with the trusted verdicts
          </text>

          {/* legend */}
          <g transform={`translate(${LEFT}, ${axisY + (narrow ? 50 : 48)})`}>
            <circle cx={5} cy={0} r={4.6} fill={SURFACE} stroke={INK} strokeWidth={1.8} />
            <text x={15} y={3.5} fontFamily={FONT_MONO} fontSize={9} fill={SLATE}>
              Hinglish (R0)
            </text>
            <circle cx={narrow ? 5 : 150} cy={narrow ? 16 : 0} r={4.6} fill={INK} />
            <text x={narrow ? 15 : 160} y={narrow ? 19.5 : 3.5} fontFamily={FONT_MONO} fontSize={9} fill={SLATE}>
              English (R4)
            </text>
            <rect x={narrow ? 0 : 285} y={narrow ? 27 : -9} width={22} height={11} fill={`url(#${hatchId})`} stroke={HAIRLINE} strokeWidth={1} />
            <text x={narrow ? 27 : 312} y={narrow ? 35.5 : 0} fontFamily={FONT_MONO} fontSize={9} fill={SLATE}>
              ±{noiseFloorPp}pp noise floor (n=300 byte-identical pairs)
            </text>
          </g>
          {!narrow && (
            <text x={LEFT} y={axisY + 76} fontFamily={FONT_MONO} fontSize={8.5} fill={SLATE}>
              Mean recovery +3.2pp; largest +6.6pp; the best judge in both conditions moves the wrong way (−3.1pp). No English point approaches the bar.
            </text>
          )}
        </svg>

        <VisuallyHidden>
          <table>
            <caption>{DESC}</caption>
            <thead>
              <tr>
                <th>Judge</th>
                <th>Hinglish agreement</th>
                <th>Hinglish 95% CI</th>
                <th>English agreement</th>
                <th>English 95% CI</th>
                <th>Recovery</th>
                <th>Inside noise floor?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.judge}>
                  <td>
                    {r.judge}
                    {r.isTranslator ? " (also the translator for all five judges)" : ""}
                  </td>
                  <td>
                    {r.hinglishAgree} = {pctStr(r.hinglishPct)}
                  </td>
                  <td>
                    [{pctStr(r.hinglishCi[0])}, {pctStr(r.hinglishCi[1])}]
                  </td>
                  <td>
                    {r.englishAgree} = {pctStr(r.englishPct)}
                  </td>
                  <td>
                    [{pctStr(r.englishCi[0])}, {pctStr(r.englishCi[1])}]
                  </td>
                  <td>{ppStr(r.recoveryPp)}</td>
                  <td>{Math.abs(r.recoveryPp) <= noiseFloorPp ? "yes" : "no"}</td>
                </tr>
              ))}
              <tr>
                <td>Pre-registered bar</td>
                <td colSpan={6}>≥{pctStr(bar, 0)}, not approached in either condition by any judge</td>
              </tr>
              <tr>
                <td>Noise floor</td>
                <td colSpan={6}>
                  ±{noiseFloorPp} percentage points, measured across 300 byte-identical arm-pairs (source: context/measurements.md fab-noise-floor)
                </td>
              </tr>
            </tbody>
          </table>
        </VisuallyHidden>
      </FigureShell>
    </div>
  );
}

export default FigEnglishControl;
