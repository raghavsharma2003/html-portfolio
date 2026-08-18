# Assets manifest

What a designer or developer needs to know to place these figures correctly,
without re-deriving or re-typing a number. Every figure is a **deterministic,
dependency-free SVG** rebuilt from the underlying analysis scripts — nothing
in them is hand-drawn or hand-typed, so a figure cannot state a number the
analysis doesn't independently print. Source: `docs/paper/figures/*.mjs` in
the main repo.

All three figures belong to Paper B (`paper-b-judge-qualification`). Paper A
has no figures yet — its data is incomplete (see `content.json`
`papers[1].status_note`), and shipping a figure for it would visually imply a
finding that doesn't exist.

---

## File inventory

Each figure ships twice. Use the plain file for anything that renders as a
static image (`<img>`, PDF export, print). Use the `.theme.svg` file when the
figure is inlined directly into the page's HTML/DOM — only then can host CSS
custom properties reach into the SVG to recolor it for dark mode.

| file | role |
|---|---|
| `figures/fig-f1-agreement-forest.svg` | original, byte-identical copy from the paper repo — static / non-inlined use |
| `figures/fig-f1-agreement-forest.theme.svg` | theme-aware variant — inline into the DOM for CSS-driven theming |
| `figures/fig-f2-slot-a-evacuation.svg` | original |
| `figures/fig-f2-slot-a-evacuation.theme.svg` | theme-aware variant |
| `figures/fig-f3-english-recovery.svg` | original |
| `figures/fig-f3-english-recovery.theme.svg` | theme-aware variant |

**Verified no visual regression.** Each `.theme.svg` was produced by a pure
attribute-value substitution over the original — element count and tag
structure are byte-identical between each pair (machine-checked), and every
`fill`/`stroke` uses `var(--token, <original-hex>)`, so with no host CSS
present the theme variant renders pixel-identical to the original. Only when
a page defines the tokens below does the appearance change.

### Theme tokens used

| token | default (light) fallback | replaces | used for |
|---|---|---|---|
| `--fig-bg` | `#ffffff` | white background/fills | page background rect, hatch-pattern tile background, hollow-marker fill |
| `--fig-ink` | `#111111` | near-black | primary text, primary strokes, filled data markers, bar borders |
| `--fig-muted` | `#5b5b5b` and `#9a9a9a` (two literal fallbacks, same token) | mid/light grey | secondary and tertiary labels, axis ticks, muted reference lines |
| `--fig-grid` | `#d4d4d4` | light grey | gridlines, panel borders, hatch-line stroke |
| `--fig-accent` | `#dcdcdc` | light grey bar fill | solid data bars (F2 panel A candidate-judge bars) |

To theme for dark mode, define these on an ancestor of the inlined `<svg>`,
e.g.:

```css
:root { --fig-bg:#ffffff; --fig-ink:#111111; --fig-muted:#5b5b5b; --fig-grid:#d4d4d4; --fig-accent:#dcdcdc; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --fig-bg:#14161a; --fig-ink:#e9e9ea; --fig-muted:#9a9fa6; --fig-grid:#33373d; --fig-accent:#3a4552;
  }
}
:root[data-theme="dark"] {
  --fig-bg:#14161a; --fig-ink:#e9e9ea; --fig-muted:#9a9fa6; --fig-grid:#33373d; --fig-accent:#3a4552;
}
```

Do not define `--fig-bg` as fully transparent if the figure will sit on a
non-neutral background — the hatch-pattern tiles rely on it to occlude the
gridlines behind them; a near-page-background neutral is safer than `none`.

**No hue anywhere.** All three figures are intentionally colorless — series
are distinguished by ink value, fill-vs-outline, dash pattern, and hatching,
not by color. This was a deliberate paper-figure choice (grayscale-print- and
colorblind-safe) and it carries over cleanly to a themed site: recoloring the
five tokens re-skins the whole figure without needing per-series color logic.

---

## Figure 1 — the agreement forest plot

**File:** `fig-f1-agreement-forest.svg` / `.theme.svg`
**Pairs with:** the paper's headline claim — "all six candidate judges
fail" — and the ground-truth-ceiling result.

**Recommended caption:** *Pooled agreement between six candidate AI judges
and a trusted verdict set, against a pre-registered 80% qualification bar.
Every judge fails; the dashed band marks the trusted judge's own measured
77.1% test–retest ceiling, which sits below the bar itself.*

**Alt text (accessibility):**
> Forest plot. Five candidate judges show pooled unit-level agreement between
> 28.1% and 54.2% with the trusted verdict set. Every cluster-bootstrap 95%
> interval lies far below the pre-registered 80% bar. A hatched vertical band
> marks the ground truth's own test-retest ceiling, 77.1% with a 95% interval
> of [67.7%, 84.4%], measured by having the archive's own author re-judge it;
> the pre-registered bar sits above that ceiling. The candidates fall 22.9 to
> 49.0 percentage points below the ceiling. One anthropic reference row is
> shown in a separate band and is labelled an invalid parse-selected run, not
> a result.

*(This is the SVG's own embedded `<title>`/`<desc>` verbatim — keep alt text
and embedded description in sync if either is edited.)*

**Exact numbers encoded (do not re-type from memory — copy from here or from
`content.json`):**

| judge | agreement | 95% CI (cluster-bootstrap) | verdict |
|---|---|---|---|
| gpt-5.6-terra | 54.2% (52/96) | [43.8%, 64.6%] | FAIL |
| grok-4.3 | 34.4% (33/96) | [25.0%, 43.8%] | FAIL |
| DeepSeek-V4-Pro | 30.9% (29/94) | [20.7%, 41.5%] | FAIL |
| Mistral-Large-3 | 29.2% (28/96) | [20.8%, 38.5%] | FAIL |
| DeepSeek-V4-Flash | 28.1% (27/96) | [18.8%, 39.6%] | FAIL |
| *(ceiling, not a candidate)* claude-opus-4.8 | 77.1% (74/96) | [69.8%, 85.4%] | CEILING |
| *(invalid, not a result)* claude-opus-5 | 100.0% (17/17) | [100.0%, 100.0%] | INVALID — parse-selected denominator |
| pre-registered bar | — | — | ≥80% |
| chance baselines | uniform-random 30.5%, pure-slot-A 21.9% | derived from archived verdict distribution | — |

Cohere command-a-plus is **absent from the plot** — 0 scorable units (158 of
192 calls failed to parse as valid output).

---

## Figure 2 — slot-A pick rate and the evacuation mechanism

**File:** `fig-f2-slot-a-evacuation.svg` / `.theme.svg`
**Pairs with:** the "position bias evacuates the counterbalance" finding —
the mechanism claim, not the headline failure rate.

**Recommended caption:** *Left: how often each judge picked the
first-presented reply, against the trusted judge's 58.9% on identical rows.
Right: what that pick rate alone predicts for the tie rate, and where each
judge actually lands — a judge sitting on the dashed curve has stopped
reading the replies.*

**Alt text (accessibility):**
> Two panels. Left: pooled slot-A pick rates run from 62.0% for gpt-5.6-terra
> to 89.6% for Mistral-Large-3, against 58.9% for the trusted judge on
> identical rows and a 50% reference. Right: observed TIE_FLIP rate plotted
> against slot-A pick rate for each judge and archive, with the analytic
> content-blind prediction q squared plus one-minus-q squared drawn as a
> dashed curve. Mistral-Large-3 lies on the curve on both archives;
> gpt-5.6-terra and the trusted judge lie far below it.

**Exact numbers encoded:**

| judge | slot-A pick rate (pooled, n rows) |
|---|---|
| Mistral-Large-3 | 89.6% (n=192) |
| DeepSeek-V4-Flash | 80.2% (n=192) |
| grok-4.3 | 73.4% (n=192) |
| DeepSeek-V4-Pro | 65.8% (n=190) |
| gpt-5.6-terra | 62.0% (n=192) |
| trusted judge (claude-opus-4.8) | 58.9% (n=192) |

Panel B plots the **analytic curve** *q² + (1−q)²* (the content-blind
tie-rate prediction for slot-A propensity *q*) against each judge's measured
(pick-rate, tie-rate) point on both archives. This curve is the paper's one
non-measured, derived quantity — label it as analytic/derived if a caption
references it directly, never as a measured data series. On the
38–2-landslide archive, Mistral-Large-3 and DeepSeek-V4-Flash each land at
16.7% (8/48) agreement against an archived tie rate of 16.7% — i.e., exactly
on the degenerate content-blind prediction.

---

## Figure 3 — the translation control

**File:** `fig-f3-english-recovery.svg` / `.theme.svg`
**Pairs with:** the paper's title claim, "it's not the code-switching" — the
retracted causal hypothesis and its replacement negative result.

**Recommended caption:** *The same 96 units, machine-translated to
monolingual English and re-judged. Every recovery is small and falls inside
this programme's own ±13.6-point measurement noise floor — removing the
code-switching does not rescue any judge.*

**Alt text (accessibility):**
> Paired dumbbell plot for five judges. Recoveries from the Hinglish to the
> English condition run from minus 3.1 to plus 6.6 percentage points, mean
> plus 3.2. Every English point falls inside a shaded plus-or-minus 13.6
> percentage point noise band centred on its Hinglish value, every clustered
> confidence interval overlaps its counterpart, and no judge approaches the
> 80% qualification bar in either condition.

**Exact numbers encoded:**

| judge | Hinglish agreement | English agreement | recovery |
|---|---|---|---|
| DeepSeek-V4-Pro | 30.9% (29/94) | 37.5% (36/96) | +6.6 pp |
| Mistral-Large-3 | 29.2% (28/96) | 34.7% (33/95) | +5.6 pp |
| DeepSeek-V4-Flash | 28.1% (27/96) | 31.9% (29/91) | +3.7 pp |
| grok-4.3 | 34.4% (33/96) | 37.5% (36/96) | +3.1 pp |
| gpt-5.6-terra | 54.2% (52/96) | 51.0% (49/96) | **−3.1 pp** (wrong direction) |

Noise floor band: **±13.6 percentage points**, this programme's own measured
judged-rate spread across 300 byte-identical arm-pairs (source:
`context/measurements.md` `fab-noise-floor`). Note in any caption or copy
near this figure: gpt-5.6-terra is both a judge under test **and** the
translator used to produce the English condition for all five judges — a
disclosed confound (no family-disjoint translator was available at $0 on the
programme's compute grant), carried as a limitation rather than hidden.

---

## General rules for whoever places these

1. **Never re-type a number by hand into page copy** — copy it from this
   manifest or from `content.json`'s `key_findings[].headline` /
   `results[].number` fields, which are the same numbers, sourced the same
   way.
2. **Keep the embedded SVG `<title>`/`<desc>` and any page-level alt text in
   sync.** They currently match verbatim; if either is edited independently
   they will drift.
3. **Figure 2's dashed curve is analytic, not measured** — say so if
   captioning it directly. It is the one derived (not measured) quantity
   anywhere in this content package.
4. **Cohere (command-a-plus) is disqualified for cause, not merely a low
   scorer** — it produced 0 scorable units out of 192 calls. Don't caption it
   as "the worst performer"; it is absent from Figure 1 because it could not
   be scored at all, which is a distinct and worse failure mode.
5. **The `claude-opus-5` row in Figure 1 is not a result.** It is a
   parse-invalidated reference run (128 of 192 replies were empty because
   reasoning consumed the token budget). If it is mentioned in adjacent copy,
   it must be labelled INVALID, never cited as "a judge that passed."
