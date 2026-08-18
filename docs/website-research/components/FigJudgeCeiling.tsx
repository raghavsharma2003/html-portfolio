"use client";

/**
 * FigJudgeCeiling.tsx — the headline figure for Paper B.
 *
 * Claim: six candidate judges were backtested against a trusted verdict
 * archive under a pre-registered ≥80% agreement bar. All six fail — five
 * are scorable and sit far below the bar; the sixth (Cohere command-a-plus)
 * produced 0 scorable units and is disqualified for cause, not merely a low
 * scorer. The bar itself sits ABOVE the ground truth's own measured
 * test–retest ceiling (77.1%) — a judge re-run against its own past verdicts
 * — so the study could not have passed even its own author. A separate
 * INVALID row (claude-opus-5) is shown because omitting it would itself be a
 * selection, and is labelled as a parse-selected non-result, never a pass.
 *
 * Site-native port of docs/paper/figures/fig-f1-agreement-forest.mjs.
 * Simplification vs. the paper figure: this version draws one CI per row
 * (the clustered-bootstrap interval the site's copy already cites) rather
 * than the paper's naive-vs-clustered comparison — that comparison is a
 * methods appendix point, not part of the page's headline claim.
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
  scaleLinear,
  useFigureId,
  useNarrow,
  useSelfReveal,
} from "./figure-shared";

export interface JudgeAgreementRow {
  judge: string;
  code: string;
  agree: number;
  n: number;
  point: number; // percent, e.g. 54.2
  ciLow: number; // percent
  ciHigh: number; // percent
}

export interface DisqualifiedJudge {
  judge: string;
  code: string;
  detail: string;
}

export interface FigJudgeCeilingProps {
  /** Five scorable candidates, FAIL verdict. Sort order is preserved as given. */
  candidates?: JudgeAgreementRow[];
  /** The sixth candidate: disqualified for cause (0 scorable units), not plottable. */
  disqualified?: DisqualifiedJudge;
  /** The ground truth's own test–retest ceiling — not a candidate. */
  ceiling?: JudgeAgreementRow;
  /** A parse-invalidated reference run — not a result. */
  invalid?: JudgeAgreementRow & { detail: string };
  /** Pre-registered qualification bar, percent. */
  bar?: number;
  /** Chance baselines, percent. */
  chanceUniform?: number;
  chanceSlotA?: number;
  revealIndex?: number;
  className?: string;
}

// Source: docs/website-research/assets-manifest.md "Figure 1 — the agreement
// forest plot" table, cross-checked against a live run of
// docs/paper/analysis/clustered-cis.mjs --json and derive-tables.mjs --json
// (2026-08-18). Every value below reproduces exactly.
const DEFAULT_CANDIDATES: JudgeAgreementRow[] = [
  { judge: "gpt-5.6-terra", code: "TER", agree: 52, n: 96, point: 54.2, ciLow: 43.8, ciHigh: 64.6 },
  { judge: "grok-4.3", code: "GRK", agree: 33, n: 96, point: 34.4, ciLow: 25.0, ciHigh: 43.8 },
  { judge: "DeepSeek-V4-Pro", code: "DS-P", agree: 29, n: 94, point: 30.9, ciLow: 20.7, ciHigh: 41.5 },
  { judge: "Mistral-Large-3", code: "MIS", agree: 28, n: 96, point: 29.2, ciLow: 20.8, ciHigh: 38.5 },
  { judge: "DeepSeek-V4-Flash", code: "DS-F", agree: 27, n: 96, point: 28.1, ciLow: 18.8, ciHigh: 39.6 },
];

const DEFAULT_DISQUALIFIED: DisqualifiedJudge = {
  judge: "Cohere command-a-plus",
  code: "COH",
  detail: "0 scorable units — 158 of 192 calls failed to parse as valid output",
};

const DEFAULT_CEILING: JudgeAgreementRow = {
  judge: "claude-opus-4.8",
  code: "GT",
  agree: 74,
  n: 96,
  point: 77.1,
  ciLow: 67.7,
  ciHigh: 84.4,
};

const DEFAULT_INVALID: JudgeAgreementRow & { detail: string } = {
  judge: "claude-opus-5",
  code: "INV",
  agree: 17,
  n: 17,
  point: 100.0,
  ciLow: 100.0,
  ciHigh: 100.0,
  detail: "parse-selected denominator — 128 of 192 replies were empty (reasoning consumed the token budget); not a qualification result",
};

const TITLE =
  "F1 — Pooled judge agreement against the pre-registered bar and the ground truth's own test-retest ceiling";
const DESC =
  "Forest plot. Five candidate judges show pooled unit-level agreement between 28.1% and 54.2% with the trusted verdict set. Every cluster-bootstrap 95% interval lies far below the pre-registered 80% bar. A hatched vertical band marks the ground truth's own test-retest ceiling, 77.1% with a 95% interval of [67.7%, 84.4%], measured by having the archive's own author re-judge it; the pre-registered bar sits above that ceiling. The candidates fall 22.9 to 49.0 percentage points below the ceiling. One anthropic reference row is shown in a separate band and is labelled an invalid parse-selected run, not a result.";

export function FigJudgeCeiling({
  candidates = DEFAULT_CANDIDATES,
  disqualified = DEFAULT_DISQUALIFIED,
  ceiling = DEFAULT_CEILING,
  invalid = DEFAULT_INVALID,
  bar = 80,
  chanceUniform = 30.5,
  chanceSlotA = 21.9,
  revealIndex = 0,
  className,
}: FigJudgeCeilingProps) {
  const { ref, revealed } = useSelfReveal<HTMLElement>();
  const { ref: narrowRef, narrow } = useNarrow<HTMLDivElement>(560);
  const uid = useFigureId("fig-jc");
  const hatchId = `${uid}-hatch`;
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;

  // ── layout ──────────────────────────────────────────────────────────────
  const W = narrow ? 400 : 760;
  const LEFT = 14;
  const PADL = narrow ? 74 : 168;
  const PADR = narrow ? 14 : 176;
  const PLOTW = W - PADL - PADR;
  const ROWH = narrow ? 46 : 34;
  const yTitle = 20;
  const ySub = narrow ? 34 : 36;
  const yRefRow1 = narrow ? 52 : 54; // chance baseline labels
  const yTop = (narrow ? 68 : 72) + 14;
  const yFirst = yTop + 22;

  const rowY = candidates.map((_, i) => yFirst + i * ROWH);
  const yDisq = rowY[rowY.length - 1] + ROWH;
  const ySepCeil = yDisq + ROWH * 0.55;
  const GAP = narrow ? 22 : 26;
  const ceilY = ySepCeil + GAP + 14;
  const ySepInv = ceilY + ROWH * 0.62;
  const invY = ySepInv + GAP + 14;
  const yBot = invY + 18;
  const axisY = yBot + 10;
  const H = axisY + (narrow ? 96 : 60);

  const x = scaleLinear(0, 100, PADL, PADL + PLOTW);
  const ticks = narrow ? [0, 50, 80, 100] : [0, 20, 40, 60, 80, 100];

  const anim = (delayMs: number): SVGAttributes<SVGElement> => ({
    style: {
      opacity: revealed ? 1 : 0,
      transform: revealed ? "scaleX(1)" : "scaleX(0.6)",
      transformOrigin: `${x(0)}px 0`,
      transition: revealed
        ? `opacity 520ms var(--ease-out-quint, cubic-bezier(.23,1,.32,1)) ${delayMs}ms, transform 520ms var(--ease-out-quint, cubic-bezier(.23,1,.32,1)) ${delayMs}ms`
        : "none",
    },
  });

  function Row({
    r,
    y,
    delay,
    tone,
    verdict,
    verdictColor,
    labelSuffix,
  }: {
    r: JudgeAgreementRow;
    y: number;
    delay: number;
    tone: "solid" | "muted" | "faded";
    verdict: string;
    verdictColor: string;
    labelSuffix?: string;
  }) {
    const stroke = tone === "solid" ? INK : tone === "muted" ? ASH : SLATE;
    const labelWeight = tone === "solid" ? 600 : 500;
    const label = narrow ? r.code : r.judge;
    return (
      <g opacity={tone === "faded" ? 0.75 : 1}>
        <text
          x={PADL - 10}
          y={y + 4}
          fontFamily={FONT_MONO}
          fontSize={narrow ? 10.5 : 11}
          fontWeight={labelWeight}
          textAnchor="end"
          fill={stroke}
        >
          {label}
        </text>
        {labelSuffix && (
          <text
            x={PADL - 10}
            y={y + 16}
            fontFamily={FONT_MONO}
            fontSize={8.5}
            textAnchor="end"
            fill={SLATE}
            fontStyle="italic"
          >
            {labelSuffix}
          </text>
        )}
        <g {...anim(delay)}>
          <line x1={x(r.ciLow)} y1={y} x2={x(r.ciHigh)} y2={y} stroke={stroke} strokeWidth={2.4} strokeLinecap="round" />
          <line x1={x(r.ciLow)} y1={y - 5} x2={x(r.ciLow)} y2={y + 5} stroke={stroke} strokeWidth={1.6} />
          <line x1={x(r.ciHigh)} y1={y - 5} x2={x(r.ciHigh)} y2={y + 5} stroke={stroke} strokeWidth={1.6} />
          <circle cx={x(r.point)} cy={y} r={4.4} fill={tone === "solid" ? INK : SURFACE} stroke={stroke} strokeWidth={1.8} />
        </g>
        {!narrow && (
          <text x={PADL + PLOTW + 12} y={y + 4} fontFamily={FONT_MONO} fontSize={9.5} fill={SLATE}>
            {r.agree}/{r.n} · {pctStr(r.point)}
          </text>
        )}
        <text
          x={narrow ? x(r.ciHigh) : W - LEFT}
          y={narrow ? y + 17 : y + 4}
          fontFamily={FONT_MONO}
          fontSize={narrow ? 9 : 9.5}
          textAnchor={narrow ? "start" : "end"}
          fill={verdictColor}
          fontWeight={700}
          dx={narrow ? 6 : 0}
        >
          {narrow ? `${pctStr(r.point)} ${verdict}` : verdict}
        </text>
      </g>
    );
  }

  return (
    <div ref={narrowRef} className={className}>
      <FigureShell
        outerRef={ref}
        revealIndex={revealIndex}
        revealed={revealed}
        caption={
          <>
            Pooled agreement between six candidate AI judges and a trusted
            verdict set, against a pre-registered 80% qualification bar. Every
            judge fails; the hatched band marks the trusted judge&rsquo;s own
            measured 77.1% test&ndash;retest ceiling, which sits below the bar
            itself. Source:{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>
              docs/paper/figures/fig-f1-agreement-forest.mjs
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

          {/* chance band: pure slot-A to uniform-random */}
          <g {...anim(0)}>
            <rect
              x={x(chanceSlotA)}
              y={yTop - 8}
              width={x(chanceUniform) - x(chanceSlotA)}
              height={yBot - yTop + 8}
              fill={HAIRLINE}
              opacity={0.35}
            />
          </g>

          {/* ceiling band, hatched — drawn early so data sits on top */}
          <g {...anim(60)}>
            <rect
              x={x(ceiling.ciLow)}
              y={yTop - 8}
              width={x(ceiling.ciHigh) - x(ceiling.ciLow)}
              height={yBot - yTop + 8}
              fill={`url(#${hatchId})`}
            />
            <line x1={x(ceiling.point)} y1={yTop - 12} x2={x(ceiling.point)} y2={yBot} stroke={ASH} strokeWidth={1.4} strokeDasharray="4 3" />
          </g>

          {/* gridlines */}
          {ticks.map((t) => (
            <line key={t} x1={x(t)} y1={yTop} x2={x(t)} y2={yBot} stroke={HAIRLINE} strokeWidth={1} />
          ))}

          {/* the bar — the one accent color in the figure */}
          <line x1={x(bar)} y1={yTop - 14} x2={x(bar)} y2={yBot} stroke={EMBER} strokeWidth={2} strokeDasharray="6 3" />

          {/* reference labels */}
          <text x={x(chanceSlotA) - 4} y={yRefRow1} fontFamily={FONT_MONO} fontSize={narrow ? 7.5 : 8.5} textAnchor="end" fill={SLATE}>
            slot-A {pctStr(chanceSlotA)}
          </text>
          <text x={x(chanceUniform) + 4} y={yRefRow1} fontFamily={FONT_MONO} fontSize={narrow ? 7.5 : 8.5} textAnchor="start" fill={SLATE}>
            chance {pctStr(chanceUniform)}
          </text>
          {!narrow && (
            <text x={x(bar) + 6} y={yTop - 20} fontFamily={FONT_MONO} fontSize={9.5} fontWeight={700} fill={EMBER}>
              pre-registered bar ≥{pctStr(bar, 0)}
            </text>
          )}
          {narrow && (
            <text x={x(bar)} y={yTop - 18} fontFamily={FONT_MONO} fontSize={9} fontWeight={700} fill={EMBER} textAnchor="middle">
              bar ≥{pctStr(bar, 0)}
            </text>
          )}

          {/* candidate rows */}
          {candidates.map((r, i) => (
            <Row key={r.judge} r={r} y={rowY[i]} delay={80 + i * 60} tone="solid" verdict="FAIL" verdictColor={EMBER} />
          ))}

          {/* disqualified — no bar, per assets-manifest rule: absent for cause, not "worst".
              Detail text stays in the left label column, stacked under the name, so it
              never runs across the plot and collides with the ceiling band or the bar. */}
          <g opacity={0.85}>
            <text x={PADL - 10} y={yDisq + 2} fontFamily={FONT_MONO} fontSize={narrow ? 10.5 : 11} fontWeight={500} textAnchor="end" fill={SLATE}>
              {narrow ? disqualified.code : disqualified.judge}
            </text>
            {!narrow && (
              <text x={PADL - 10} y={yDisq + 14} fontFamily={FONT_MONO} fontSize={8} fill={SLATE} fontStyle="italic" textAnchor="end">
                {disqualified.detail}
              </text>
            )}
            <line x1={PADL} y1={yDisq + 2} x2={PADL + Math.min(PLOTW, 90)} y2={yDisq + 2} stroke={SLATE} strokeWidth={1} strokeDasharray="2 3" />
            <text x={W - LEFT} y={yDisq + 6} fontFamily={FONT_MONO} fontSize={9.5} textAnchor="end" fill={SLATE} fontWeight={700}>
              DISQUALIFIED
            </text>
          </g>

          {/* separator + ceiling row */}
          <line x1={LEFT} y1={ySepCeil} x2={W - LEFT} y2={ySepCeil} stroke={HAIRLINE} strokeWidth={1} />
          {!narrow && (
            <text x={LEFT} y={ySepCeil + 13} fontFamily={FONT_MONO} fontSize={8} fill={SLATE} fontWeight={600}>
              not a candidate — the archive&rsquo;s own author, re-judging it (test–retest ceiling):
            </text>
          )}
          <Row
            r={ceiling}
            y={ceilY}
            delay={420}
            tone="muted"
            verdict="CEILING"
            verdictColor={ASH}
            labelSuffix={narrow ? "ceiling, not a candidate" : undefined}
          />

          {/* separator + invalid row */}
          <line x1={LEFT} y1={ySepInv} x2={W - LEFT} y2={ySepInv} stroke={HAIRLINE} strokeWidth={1} />
          {!narrow && (
            <text x={LEFT} y={ySepInv + 13} fontFamily={FONT_MONO} fontSize={8} fill={SLATE} fontWeight={600}>
              not a qualification result — parse-selected denominator (128/192 unparseable):
            </text>
          )}
          <Row
            r={invalid}
            y={invY}
            delay={480}
            tone="faded"
            verdict="INVALID"
            verdictColor={SLATE}
            labelSuffix={narrow ? "invalid, not a result" : undefined}
          />

          {/* axis */}
          <line x1={PADL} y1={axisY} x2={PADL + PLOTW} y2={axisY} stroke={INK} strokeWidth={1} />
          {ticks.map((t) => (
            <Fragment key={t}>
              <line x1={x(t)} y1={axisY} x2={x(t)} y2={axisY + 4} stroke={INK} strokeWidth={1} />
              <text x={x(t)} y={axisY + 15} fontFamily={FONT_MONO} fontSize={narrow ? 9 : 10} textAnchor="middle" fill={SLATE}>
                {t}%
              </text>
            </Fragment>
          ))}
          <text x={PADL + PLOTW / 2} y={axisY + (narrow ? 30 : 30)} fontFamily={FONT_MONO} fontSize={narrow ? 8.5 : 9.5} textAnchor="middle" fill={SLATE}>
            unit-level agreement with the trusted verdict set
          </text>
          {narrow && (
            <text x={PADL + PLOTW / 2} y={axisY + 44} fontFamily={FONT_MONO} fontSize={8} textAnchor="middle" fill={SLATE}>
              n = 96 units (DeepSeek-V4-Pro n = 94)
            </text>
          )}
          {!narrow && (
            <text x={LEFT} y={axisY + 46} fontFamily={FONT_MONO} fontSize={8.5} fill={SLATE}>
              n = 96 units (DeepSeek-V4-Pro n = 94, 2 transport misses). Cohere command-a-plus: 0 scorable of 192 calls (158 parse misses).
            </text>
          )}
        </svg>

        <VisuallyHidden>
          <table>
            <caption>{DESC}</caption>
            <thead>
              <tr>
                <th>Judge</th>
                <th>Agreement</th>
                <th>95% CI (cluster bootstrap)</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((r) => (
                <tr key={r.judge}>
                  <td>{r.judge}</td>
                  <td>
                    {r.agree}/{r.n} = {pctStr(r.point)}
                  </td>
                  <td>
                    [{pctStr(r.ciLow)}, {pctStr(r.ciHigh)}]
                  </td>
                  <td>FAIL</td>
                </tr>
              ))}
              <tr>
                <td>{disqualified.judge}</td>
                <td>not scorable</td>
                <td>n/a</td>
                <td>DISQUALIFIED — {disqualified.detail}</td>
              </tr>
              <tr>
                <td>{ceiling.judge}</td>
                <td>
                  {ceiling.agree}/{ceiling.n} = {pctStr(ceiling.point)}
                </td>
                <td>
                  [{pctStr(ceiling.ciLow)}, {pctStr(ceiling.ciHigh)}]
                </td>
                <td>CEILING — not a candidate, the archive&rsquo;s own author re-judging it</td>
              </tr>
              <tr>
                <td>{invalid.judge}</td>
                <td>
                  {invalid.agree}/{invalid.n} = {pctStr(invalid.point)}
                </td>
                <td>
                  [{pctStr(invalid.ciLow)}, {pctStr(invalid.ciHigh)}]
                </td>
                <td>INVALID — {invalid.detail}</td>
              </tr>
              <tr>
                <td>Pre-registered bar</td>
                <td colSpan={3}>≥{pctStr(bar, 0)}</td>
              </tr>
              <tr>
                <td>Chance baselines</td>
                <td colSpan={3}>
                  uniform-random {pctStr(chanceUniform)}; pure slot-A {pctStr(chanceSlotA)}
                </td>
              </tr>
            </tbody>
          </table>
        </VisuallyHidden>
      </FigureShell>
    </div>
  );
}

export default FigJudgeCeiling;
