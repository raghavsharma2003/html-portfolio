# Research figures — site-native components

Three React/TSX components, built as siblings to `turn-diagram.tsx` in
Vyakti.ai's live visual language, not imported paper images. Source lives in
`docs/website-research/components/`:

| file | role |
|---|---|
| `figure-shared.tsx` | support module (not a figure itself) — reveal-on-scroll hook, narrow/mobile hook, the `FigureShell` card chrome, SVG text/hatch primitives, brand-token constants |
| `FigJudgeCeiling.tsx` | Figure 1 — the headline forest plot |
| `FigOrderEvacuation.tsx` | Figure 2 — the mechanism (position bias) |
| `FigEnglishControl.tsx` | Figure 3 — the refutation (translation control) |

All three are ports of `docs/paper/figures/fig-f1/f2/f3-*.mjs`, re-themed
into the site's tokens, made interactive/responsive/accessible, and
re-verified against the analysis scripts (see "Numbers" below) rather than
retyped from the SVGs by eye.

Drop all four files into the real site's `src/components/research/` (or
wherever the research page's components live) — they import only from
`react` and from each other; no other project dependency.

---

## FigJudgeCeiling — the headline

**Claim:** six candidate judges were backtested against a trusted-verdict
archive under a pre-registered ≥80% agreement bar. All six fail — five are
scorable (28.1%–54.2%) and sit far below the bar; the sixth (Cohere
command-a-plus) is disqualified for cause (0 scorable units), not merely a
low scorer. The bar itself sits *above* the ground truth's own measured
test–retest ceiling (77.1%), so the study could not have passed even its own
author. A separate INVALID row (claude-opus-5) is shown, labelled as a
parse-selected non-result, never a pass.

**Props** (`FigJudgeCeilingProps`):

```ts
candidates?: JudgeAgreementRow[];       // 5 scorable FAIL rows, default below
disqualified?: DisqualifiedJudge;       // Cohere, no bar, "0 scorable units"
ceiling?: JudgeAgreementRow;            // claude-opus-4.8 test-retest row
invalid?: JudgeAgreementRow & { detail: string }; // claude-opus-5
bar?: number;                           // default 80
chanceUniform?: number;                 // default 30.5
chanceSlotA?: number;                   // default 21.9
revealIndex?: number;                   // data-reveal stagger index, default 0
className?: string;
```

**A11y summary** (verbatim `<title>`/`<desc>` + alt text, from
`assets-manifest.md` Figure 1):

> Forest plot. Five candidate judges show pooled unit-level agreement between
> 28.1% and 54.2% with the trusted verdict set. Every cluster-bootstrap 95%
> interval lies far below the pre-registered 80% bar. A hatched vertical band
> marks the ground truth's own test-retest ceiling, 77.1% with a 95% interval
> of [67.7%, 84.4%], measured by having the archive's own author re-judge it;
> the pre-registered bar sits above that ceiling. The candidates fall 22.9 to
> 49.0 percentage points below the ceiling. One anthropic reference row is
> shown in a separate band and is labelled an invalid parse-selected run, not
> a result.

A visually-hidden `<table>` (judge / agreement / 95% CI / verdict, one row
per candidate + disqualified + ceiling + invalid + the bar + chance
baselines) sits below the SVG for screen readers.

**Numbers encoded** (default props; source: `assets-manifest.md` Figure 1
table, cross-checked 2026-08-18 against a live run of
`node docs/paper/analysis/clustered-cis.mjs --json` and
`derive-tables.mjs --json`):

| judge | agree/n | agreement | 95% CI | verdict |
|---|---|---|---|---|
| gpt-5.6-terra | 52/96 | 54.2% | [43.8, 64.6] | FAIL |
| grok-4.3 | 33/96 | 34.4% | [25.0, 43.8] | FAIL |
| DeepSeek-V4-Pro | 29/94 | 30.9% | [20.7, 41.5] | FAIL |
| Mistral-Large-3 | 28/96 | 29.2% | [20.8, 38.5] | FAIL |
| DeepSeek-V4-Flash | 27/96 | 28.1% | [18.8, 39.6] | FAIL |
| Cohere command-a-plus | 0/0 | — | — | DISQUALIFIED (158/192 parse misses) |
| claude-opus-4.8 (ceiling) | 74/96 | 77.1% | [67.7, 84.4] | CEILING |
| claude-opus-5 (invalid) | 17/17 | 100.0% | [100.0, 100.0] | INVALID (128/192 unparseable) |
| pre-registered bar | — | — | — | ≥80% |
| chance baselines | — | — | — | uniform-random 30.5%, pure-slot-A 21.9% |

---

## FigOrderEvacuation — the mechanism

**Claim:** position bias does not add noise to the counterbalanced design —
it evacuates it into ties. A judge with a fixed, content-blind slot-A
propensity *q* produces a decisive (non-tied) verdict only when its two
picks (one per presentation order) land on the same model:
P(TIE_FLIP) = q² + (1−q)². That curve is analytic, not measured — labelled
as such on the figure. Mistral-Large-3's two points (one per archive) sit
almost exactly on the curve; the trusted judge and gpt-5.6-terra sit far
below it, which is what carrying real content information looks like.

**Props** (`FigOrderEvacuationProps`):

```ts
panelA?: SlotARow[];                    // 5 judges, pooled slot-A pick rate
trustedJudgeSlotA?: { rate: number; n: number };
points?: EvacuationPoint[];             // 10 points: 5 judges × 2 archives
trustedJudgePoints?: Array<{ archive; q; tieFlipRate; tieFlipN; n }>; // 2 GT points
revealIndex?: number;                   // default 1
className?: string;
```

`EvacuationPoint.onCurve` flags the two Mistral-Large-3 points the copy
calls out as landing on the degenerate prediction — drawn in the site's
ember accent, the only hue in an otherwise grayscale-safe figure.

**A11y summary** (verbatim, from `assets-manifest.md` Figure 2):

> Two panels. Left: pooled slot-A pick rates run from 62.0% for gpt-5.6-terra
> to 89.6% for Mistral-Large-3, against 58.9% for the trusted judge on
> identical rows and a 50% reference. Right: observed TIE_FLIP rate plotted
> against slot-A pick rate for each judge and archive, with the analytic
> content-blind prediction q squared plus one-minus-q squared drawn as a
> dashed curve. Mistral-Large-3 lies on the curve on both archives;
> gpt-5.6-terra and the trusted judge lie far below it.

Two visually-hidden tables (Panel A: judge / slot-A pick rate / rows; Panel
B: judge / archive / q / observed TIE_FLIP rate / note) carry the full data
for screen readers.

**Numbers encoded** — Panel A (pooled slot-A pick rate; source:
`assets-manifest.md` Figure 2 table):

| judge | slot-A pick rate | rows |
|---|---|---|
| Mistral-Large-3 | 89.6% | 192 |
| DeepSeek-V4-Flash | 80.2% | 192 |
| grok-4.3 | 73.4% | 192 |
| DeepSeek-V4-Pro | 65.8% | 190 |
| gpt-5.6-terra | 62.0% | 192 |
| trusted judge (opus-4.8) | 58.9% | 192 |

Panel B (per judge × archive; source: a live run of
`node docs/paper/analysis/derive-tables.mjs --json`, `perCell`/`groundTruth`
tables, 2026-08-18 — matches `docs/paper/figures/fig-f2-slot-a-evacuation.mjs`
and CAMERA.md §4.2's stated gaps exactly):

| judge | archive | q | observed TIE_FLIP | on curve? |
|---|---|---|---|---|
| Mistral-Large-3 | charm-grok | 90.6% | 39/48 = 81.25% | **yes** |
| Mistral-Large-3 | charm-luna | 88.5% | 37/48 = 77.08% | **yes** |
| DeepSeek-V4-Flash | charm-grok | 78.1% | 29/48 = 60.42% | |
| DeepSeek-V4-Flash | charm-luna | 82.3% | 31/48 = 64.58% | |
| grok-4.3 | charm-grok | 76.0% | 27/48 = 56.25% | |
| grok-4.3 | charm-luna | 70.8% | 20/48 = 41.67% | |
| DeepSeek-V4-Pro | charm-grok | 64.6% | 22/48 = 45.83% | |
| DeepSeek-V4-Pro | charm-luna | 67.0% | 23/46 = 50.00% | |
| gpt-5.6-terra | charm-grok | 65.6% | 15/48 = 31.25% | |
| gpt-5.6-terra | charm-luna | 58.3% | 10/48 = 20.83% | |
| trusted judge | charm-grok | 56.25% | 8/48 = 16.67% | |
| trusted judge | charm-luna | 61.46% | 13/48 = 27.08% | |

---

## FigEnglishControl — the refutation

**Claim:** the paper was named for a hypothesis — that Hindi–English
code-switching defeats the judges' register model. The same 96 archived
units, machine-translated to monolingual English and re-judged, refute it.
Every recovery is small (−3.1 to +6.6pp, mean +3.2) and every one lands
inside this programme's own measured ±13.6pp noise floor.

**Props** (`FigEnglishControlProps`):

```ts
rows?: RecoveryRow[];    // 5 judges, Hinglish vs. English agreement + CIs
bar?: number;            // default 80
noiseFloorPp?: number;   // default 13.6
revealIndex?: number;    // default 2
className?: string;
```

**A11y summary** (verbatim, from `assets-manifest.md` Figure 3):

> Paired dumbbell plot for five judges. Recoveries from the Hinglish to the
> English condition run from minus 3.1 to plus 6.6 percentage points, mean
> plus 3.2. Every English point falls inside a shaded plus-or-minus 13.6
> percentage point noise band centred on its Hinglish value, every clustered
> confidence interval overlaps its counterpart, and no judge approaches the
> 80% qualification bar in either condition.

A visually-hidden `<table>` (judge / Hinglish agreement+CI / English
agreement+CI / recovery / inside-noise-floor?) carries the full data.

**Numbers encoded** (source: `assets-manifest.md` Figure 3 table, matching a
live run of `docs/paper/analysis/r4/summary.json` `recovery_table`,
2026-08-18):

| judge | Hinglish | English | recovery |
|---|---|---|---|
| DeepSeek-V4-Pro | 30.9% [20.7, 41.5] | 37.5% [28.1, 47.9] | +6.6pp |
| Mistral-Large-3 | 29.2% [20.8, 38.5] | 34.7% [26.3, 45.3] | +5.6pp |
| DeepSeek-V4-Flash | 28.1% [18.8, 39.6] | 31.9% [19.4, 45.2] | +3.7pp |
| grok-4.3 | 34.4% [25.0, 43.8] | 37.5% [29.2, 45.8] | +3.1pp |
| gpt-5.6-terra (also the translator) | 54.2% [43.8, 64.6] | 51.0% [38.5, 63.5] | −3.1pp |

Noise floor: ±13.6pp, n=300 byte-identical arm-pairs
(`context/measurements.md` `fab-noise-floor`).

---

## Design system compliance

- **Color**: every fill/stroke is `var(--c-*, <fallback>)` (`--c-bone`,
  `--c-ash`, `--c-slate`, `--c-hairline`, `--c-surface`, `--c-ember`) — no
  bare hex outside a `var()` fallback. Light-only, no dark-mode branch (the
  live site has none). Ember is used sparingly, as the site's one accent:
  the pre-registered-bar reference line, FAIL verdict text, and the two
  points that land on Figure 2's degenerate prediction curve — everything
  else stays grayscale, matching the paper figures' own colorblind/print-safe
  convention.
- **Type**: `var(--font-mono)` (Geist Mono) for every numeric label, axis
  tick, and judge-code; prose (captions, figcaptions) inherits the page's
  `var(--font-sans)` (Geist) via ordinary Tailwind classes.
- **Motion**: each figure is its own `[data-reveal]` root (a self-contained
  `IntersectionObserver`, so it reveals correctly even if dropped somewhere
  the site's global reveal pass isn't mounted) using the site's own
  `--ease-out-quint` curve and a duration in the "marketing/explanatory" band
  (460–520ms) per `animate`/`review-animations` STANDARDS.md. A second,
  shorter stagger (60–80ms per element) animates bars/intervals/points in
  once the card is visible — `transform`/`opacity` only, no layout
  properties. `prefers-reduced-motion: reduce` is honored by skipping the
  transition entirely (not just the observer's wait): verified by loading
  the page with reduced motion forced and a screenshot taken at ~50ms with
  zero settle time — the figure is already at its final state
  (`fig-order-evacuation-reduced-motion.png` in `figure-shots/`).
- **Mobile (390px)**: each figure ships a genuinely different layout below a
  520px container-width threshold (`useNarrow`, `ResizeObserver` on the
  figure's own box, not the viewport), not a shrunk desktop layout:
  - **F1**: judge names collapse to 3–4 letter codes (TER/GRK/DS-P/MIS/DS-F/
    COH/GT/INV — reused across all three figures for consistency), the
    off-plot "agree/n · %" column is dropped (the point + verdict chip
    already carries it), and the x-axis keeps only 0/50/80/100%.
  - **F2**: Panel A and Panel B stack vertically instead of sitting
    side-by-side; Panel B drops per-point text labels except the two ember
    "on-curve" points (dot + fill/hollow + the shared legend still identify
    every series without 10 overlapping code labels at that width).
  - **F3**: the right-hand numeric column (agree counts, recovery, "inside
    noise floor") moves to a single centered line under each row instead of
    a fourth column, which the 390px width has no room for.
- **A11y**: every SVG is `role="img"` with `aria-labelledby` pointing at a
  `<title>`/`<desc>` pair (ids namespaced per instance via `useId()`, so two
  copies of the same figure never collide, and neither do the hatch-pattern
  `<defs>` ids) carrying the manifest's alt text verbatim. Every data point
  is additionally in a visually-hidden `<table>` (Tailwind's `sr-only`
  pattern, inlined as a literal style object so it doesn't depend on
  Tailwind being present) so the finding survives without the SVG at all.

## Verification

- `npx tsc --noEmit` — 0 errors attributable to these four files, checked
  against the real site tree's `tsconfig.json` (an unrelated, pre-existing
  type error in a different, concurrently-edited page —
  `src/app/research/papers/[slug]/page.tsx`, owned by another workstream —
  was present in the same tree and is not from this work; filtered out and
  confirmed by name).
- `npx next build` — green, before that concurrent page landed in the shared
  tree (route list included `/fig-preview-temp` cleanly alongside every
  other route).
- Rendered via Playwright/Chromium at 1440px and 390px; screenshots in
  `../figure-shots/`: `fig-judge-ceiling-*`, `fig-order-evacuation-*`,
  `fig-english-control-*` (`-desktop-1440`, `-mobile-390`,
  `-reduced-motion`), plus two whole-page composites (`full-desktop-1440`,
  `full-mobile-390`) showing all three sitting in the site's real header/
  footer chrome.
- Two review passes on the renders caught and fixed: a ceiling-row label
  overflowing the plot in F1 (shortened), a disqualified-row detail string
  running through the ceiling band/bar (moved to a stacked left-column
  line), two narrow-mode label suffixes and one narrow-mode summary line
  clipped off the left edge of the card (shortened / re-anchored centered),
  Figure 2's "50%" reference label colliding with the panel title (moved
  below it), the "analytic" curve label sitting on the panel's top border
  (repositioned inside it), the legend row colliding with the x-axis caption
  (recomputed from the actual lowest content, not a generic axis constant),
  and the tightly-clustered Mistral-Large-3 point pair's two "MIS" labels
  overlapping (ported the source `.mjs`'s full 6-slot label placer, widened
  Panel B to the paper's own proven dimensions, and de-duplicated same-judge
  labels to one shared label plus a thin connector between the two archive
  points).
