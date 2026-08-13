# Archived bake-off data — the D0 validity fixtures

These are the judged transcripts and battery outputs from the three model
bake-offs that measured the identity ceiling (`charm-grok`, `charm-luna`,
`realtime-azure` in `context/`). They are the ground truth for **D0** in
docs/SPEC.md §14: any swap-detection battery must FLAG all three before its
verdicts are trusted — a battery these pass is broken.

They lived only in a session scratchpad until 2026-08-13; a container reap
would have destroyed the only known-bad corpus this program has. Audio (.wav)
was not archived — transcripts and judgments carry the evidence; regenerating
audio is possible, regenerating blind judgments of the original runs is not.

## Fixture format (M0, WS-EVAL)

The raw files are three rigs' native dialects and are kept VERBATIM — they are
evidence, never rewritten. Two files sit on top of them:

- **`fixtures.json`** — the index the D-battery reads: per bake-off, what
  happened, which flags the battery is expected to raise (`expected_flags`,
  with the recomputed numbers and the D1 reference bands from SPEC §7.2),
  what it must NOT flag (`must_not_flag` — azure's 1-of-3 helpline result is
  recorded as unresolved in rejected.md and is reported, not failed on), and
  what is missing (`gaps`).
- **`load.mjs`** — the normalizer: `loadFixture(id)` /`loadAllFixtures()`
  yield one documented shape (`candidate`/`incumbent` turn lists as
  `{lane, beat, rep, text}`, `judgments`, `aggregates`, `gaps`) so batteries
  are written against the contract, not the three raw dialects. It reads the
  raw files on every call; nothing is copied.

`evals/fixtures.mjs` (run by `evals/run.mjs`, which is a `verify-release`
gate) re-derives every `expected_flags` number from the raw data on every CI
run — the 38–2 and 17–18 both-orders-agree verdicts, the per-lane register
elevations, luna's 0-vs-11 media tags, azure's 50.8 words/turn — so a
silently edited or half-restored archive goes red before a battery quietly
passes a known-bad model. It also asserts **all three fixtures stay
`usable_for_d0: true`**: since the 2026-08-13 scratchpad recovery, SPEC
§14.1's "flags all three" is satisfiable in full, and that assertion going
red means evidence was lost — an archive-integrity incident, not a threshold
to relax.

## What each directory actually holds

- **`charm-grok/`** — the strongest fixture. `pb-grok1/2.json`: 288 grok
  replies (2 reps × 2 lanes × 12 beats × 6 turns) with the exact personas
  used; `pb-merged1/2.json` (recovered 2026-08-13): the judge inputs — the
  same grok replies byte-identical plus the **incumbent arm on the same
  stimuli** (voice register recomputes 41.4 vs 25.0 raw words, 1.66×);
  `pb-judged-grok.json`/`.ndjson`: all 96 blind counterbalanced verdicts
  (`claude-opus-4.8` judge); `personality-battery.md`: the report.
- **`charm-luna/`** — the "charm parity is not enough" fixture.
  `pb-raw/pb-raw2.json` (recovered 2026-08-13): two battery reps, THREE
  arms on the same stimuli — incumbent, `gpt-5.6-luna`, and `gpt-5.6-terra`
  (terra ran but was never judged); `pb-judged.json`/`.ndjson`: all 96
  verdicts — overall recomputes to the **17–18 tie** and specificity to
  **9–25 for luna**; `pb-metrics.json`: the rig's deterministic counters
  (voice 28.2 vs 20.5 words/turn — the recorded signature);
  `pb-tagpower.json`: auxiliary tag-power runs. D0 must flag luna despite
  the judged tie, from the deterministic axes: **0/288 media tags vs the
  incumbent's 11/288**, and voice register 1.29× the incumbent on raw
  counts. Crisis-beat collapse remains a qualitative signature (transcripts
  archived, no automated detector). The `A-before-*` files are an unrelated
  incumbent baseline register battery, kept as auxiliary reference.
- **`realtime-azure/`** — usable. `register.json`: 24 spoken turns with
  rig-side counters (mean 50.8 words/turn against her 20.5±3 band — the flag);
  `guarantees.json`: n=3 crisis/AI/manipulation probes;
  `voice-transcripts.json`: judged transcripts of the 5 saved wavs. Small n
  throughout; no incumbent arm in-archive (the 20.5 reference is recorded in
  `context/measurements.md`).
