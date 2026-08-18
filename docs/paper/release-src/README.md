# vyakti-judge-qual

**Qualify your LLM judge before you use it — and measure the ceiling before you
set the bar.**

This is the protocol, harness, data and analysis behind *"It's Not the
Code-Switching: Six Frontier LLM Judges Fail a Pre-Registered Qualification Bar
— and the Bar Was Above Its Own Ground Truth's Ceiling"*. Everything here runs
offline, with no API key, and reproduces every number in the paper.

```
node analysis/derive-tables.mjs      # every headline table
node analysis/clustered-cis.mjs      # beat-clustered intervals
node harness/judge-backtest.mjs --dry-run   # the full pipeline, $0, no network
```

## What the study found, in one table

Six candidate judges, backtested against 96 blind, counterbalanced,
both-orders-agree verdicts that had already driven real deployment decisions,
under a bar fixed two days before any candidate ran:

| judge | agreement | verdict |
|---|---|---|
| five scorable candidates | 28.1% – 54.2% | **all FAIL**, no interval near the bar |
| one further candidate | — | **disqualified**: parseable JSON on 34 of 192 calls |
| *the model that wrote the ground truth, re-judging its own archive* | *77.1% [67.7, 84.4]* | ***the ceiling*** |

The last row is the one to take away. **The pre-registered 80% bar sat above the
ground truth's own test–retest ceiling.** The candidates are not merely below a
threshold somebody chose — they are 22.9 to 49.0 percentage points below the
reproducibility of the verdict set itself, and four of five recover less than
half of it.

## The three rules this suite exists to enforce

**1. Both-orders agreement is a diagnostic, not a debiasing method.** If a judge
picks the first slot with content-blind propensity *q*, counterbalancing means
it names the same side twice only by accident, so it ties on *q*² + (1−*q*)² of
units and its agreement collapses onto the archive's tie rate. Two of our judges
sat within 2.6 points of that curve. Those ties look like caution in every
downstream aggregation. The harness prints `slotAPickRate`,
`observedTieRate`, `contentBlindTieRate` and `contentSignalGapPp` on every cell
so you cannot report the agreement rate alone by accident.

**2. Measure the ground truth's ceiling before setting the bar.** Ours cost 192
calls and $3.93 against a $400 gate, and it changed the shape of the result. See
`protocol/BAR.md`.

**3. A within-subject-only control is a mechanism claim waiting to be
retracted.** We logged a 16× same-vendor favoritism effect with a clean-looking
within-judge control. A between-judge control erased it: a *family-disjoint*
judge showed a larger difference-in-differences. The harness measures
family-conflict cells rather than excluding them, precisely so the between-judge
control is available.

## The harness refuses

`harness/guards.mjs` will decline to issue a number when a run was crippled: it
counts transport misses and parse misses separately and self-invalidates above
5% and 50% respectively. **The two best numbers this programme ever measured
were both refused by these guards** — a 100% pair on denominators selected by an
API spend limit, and, three days later, a 17-of-17 on a run where a 120-token
cap left 128 of 192 replies empty. Both refusals cost the authors their most
flattering results. That is what the guards are for, and it is why they ship.

## Pointing it at your own material

1. Put your archive under `data/archives/<id>/` as `transcripts.json` and
   `verdicts.json` — the two files' shapes are documented by the ones already
   there.
2. Write a judge config (`harness/judges/example-*.json`). Configs carry an
   environment-variable **name**, never a key, an endpoint or a resource id.
3. `node harness/judge-backtest.mjs --dry-run` first. It exercises the whole
   pipeline with a deterministic mock judge, no network, $0.
4. Read `protocol/BAR.md` before choosing a bar, and measure your ceiling.
5. `node harness/judge-backtest.mjs --judge <config> --run`. Judged suites cost
   money; do not run one unattended.

## Layout

```
protocol/RUBRIC.md    the exact judge prompt (the harness reads it at run time)
protocol/BAR.md       the qualification rule, the ceiling, the 8-number report
protocol/QUIRKS.md    per-deployment compatibility log, dated
harness/              judge-backtest.mjs, guards.mjs, providers.mjs, rng.mjs
analysis/             derive-tables.mjs, clustered-cis.mjs — offline, $0
data/archives/        transcripts + 7-axis verdicts with rationales, 2 archives
data/judge-rows/      8,256 judgment rows (R0 overall, R2 per-axis, R4 English)
data/runs/            per-run summaries and cost accounting
data/r4-english-transcripts.json   the translation-control condition
DATASHEET.md          read it before using the data for anything
BUILD.md              how this bundle was built and the de-identification gates
```

## Read the datasheet

The ground truth here is **LLM-produced, not human-annotated**. Agreement with
it is not accuracy, and this suite is not a leaderboard. `DATASHEET.md` says so
in its first section, at more length, and explains what the data must not be
used for.

## Licence

Apache-2.0 for code (`LICENSE-CODE`), CC BY 4.0 for data (`LICENSE-DATA`).
Cite via `CITATION.cff`.
