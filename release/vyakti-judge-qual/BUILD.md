# How this bundle was built, and what was checked

This directory is **generated**, not hand-assembled. It is produced by
`build-release-bundle.mjs` in the private repository the study was run in, and
re-running that script byte-reproduces this tree.

## Why a builder rather than a copy

The source archives embed the product's system prompt — 44,002 characters of
`personaText` and 47,094 of `personaVoice` — inside the same JSON objects as
the transcripts. Copying those files into a public repository would publish the
company's principal asset. The builder therefore **extracts** the fields the
paper's claims depend on, constructing every released object field by field, and
never carries a whole source object across.

"We stripped it" is not something anyone should take on trust, so a separate
script runs the de-identification gates **against this built tree** — not
against the source — and any hit fails the build rather than shipping.

## What is deliberately not here

| dropped | why |
|---|---|
| `personaText` / `personaVoice` | the product. Not needed for any claim: the result depends on transcripts, verdicts, rubric and harness, and on none of the prompt that produced the transcripts. |
| per-turn `cost`, `in`, `out`, `ms` | deployment economics |
| per-call `usage` on judge rows | same; run-level totals are in `data/runs/cost.json` instead |
| raw provider error bodies in `harnessMiss` | they carried the tenant's endpoint hostname, request ids and provider internals. The **kind** and **count** of a miss are what the guards use, and those are preserved; the body is redacted. *The gates caught this: the first build of this bundle leaked a full endpoint URL in 10 rows.* |
| `sourceText` in the translation artifacts | a redundant duplicate of the Hinglish transcripts already released under `data/archives/` |
| a third generated arm in one source archive | it was never judged, so it carries no ground truth |

## Pseudonymisation

Person names are substituted in the released text: the scripted interlocutor's
given name → `USER`, the companion persona's name → `HER`, and one surname
appearing in a scripted work anecdote → `[NAME]`. `CITATION.cff` is the one
file exempt, because a citation file is supposed to name its authors.

**Place references are retained and that is a decision.** The scripts contain
Indian city and landmark references. They are authored character detail in a
fictional script, they identify no person, and removing them would damage the
code-switched linguistic content that is the point of the release. Every
occurrence is counted in `data/BUILD-STATS.json` and reported by the gate run
so the decision is auditable. **This item is flagged for the data owner's
sign-off before publication.**

## Verifying this tree yourself

```
node analysis/derive-tables.mjs      # reproduces every headline number, offline
node analysis/clustered-cis.mjs      # reproduces every clustered interval
node harness/judge-backtest.mjs --dry-run
```

The de-identification gate run writes `de-identification-report.txt` beside
this file. If that report is missing, the gates have not been run against the
current tree — a rebuild deletes it on purpose, because a stale gate report is
worse than none.

## Inventory

32 files, 3396 KB total.

```
      1.4 KB  CITATION.cff
      9.7 KB  DATASHEET.md
     10.7 KB  LICENSE-CODE
      1.6 KB  LICENSE-DATA
      5.1 KB  README.md
     12.2 KB  analysis/clustered-cis.mjs
     16.3 KB  analysis/derive-tables.mjs
      0.5 KB  data/BUILD-STATS.json
    174.6 KB  data/archives/charm-grok/transcripts.json
    122.3 KB  data/archives/charm-grok/verdicts.json
    168.1 KB  data/archives/charm-luna/transcripts.json
    120.0 KB  data/archives/charm-luna/verdicts.json
    432.4 KB  data/judge-rows/r0-overall.jsonl
   1549.3 KB  data/judge-rows/r2-per-axis.jsonl
    239.0 KB  data/judge-rows/r4-english.jsonl
    334.0 KB  data/r4-english-transcripts.json
      4.3 KB  data/runs/cost.json
    119.4 KB  data/runs/r0-pooled.json
      1.0 KB  data/runs/r2-ground-truth-audit.json
      2.8 KB  data/runs/r2-pooled-per-axis.json
     26.2 KB  data/runs/r2-summary.json
      6.5 KB  data/runs/r4-summary.json
      4.5 KB  harness/guards.mjs
     11.7 KB  harness/judge-backtest.mjs
      0.6 KB  harness/judges/example-azure.json
      0.8 KB  harness/judges/example-openrouter.json
      0.7 KB  harness/judges/example-reasoning-model.json
      8.4 KB  harness/providers.mjs
      0.5 KB  harness/rng.mjs
      4.3 KB  protocol/BAR.md
      4.4 KB  protocol/QUIRKS.md
      2.5 KB  protocol/RUBRIC.md
```

## Counts asserted by the builder

The build fails rather than shipping a short bundle:

| item | count |
|---|---|
| transcripts, charm-grok | 96 |
| transcripts, charm-luna | 96 |
| ground-truth verdicts, charm-grok | 96 (7 axes + 3 flags + rationale each) |
| ground-truth verdicts, charm-luna | 96 (7 axes + 3 flags + rationale each) |
| judge rows, R0 `overall` | 1536 |
| judge rows, R2 six further axes | 5760 |
| judge rows, R4 English condition | 960 |
| English-condition transcripts | 192 |
