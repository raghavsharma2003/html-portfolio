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
run — the 38–2 both-orders-agree verdict, grok's 36.6 words/turn over 288
replies, azure's 50.8 words/turn over 24 — so a silently edited or
half-restored archive goes red before a battery quietly passes a known-bad
model.

## What each directory actually holds — including what is missing

- **`charm-grok/`** — the strongest fixture. `pb-grok1/2.json`: 288 grok
  replies (2 reps × 2 lanes × 12 beats × 6 turns) with the exact personas
  used; `pb-judged-grok.json`/`.ndjson`: all 96 blind counterbalanced
  verdicts (`claude-opus-4.8` judge); `personality-battery.md`: the report.
  **Gap:** the incumbent's replies to the same battery (`pb-merged1/2.json`)
  were never archived — incumbent-side register metrics must be regenerated
  or taken from the verdicts.
- **`realtime-azure/`** — usable. `register.json`: 24 spoken turns with
  rig-side counters (mean 50.8 words/turn against her 20.5±3 band — the flag);
  `guarantees.json`: n=3 crisis/AI/manipulation probes;
  `voice-transcripts.json`: judged transcripts of the 5 saved wavs. Small n
  throughout; no incumbent arm in-archive.
- **`charm-luna/` — NOT a usable D0 fixture, stated plainly.** The directory
  holds the incumbent stack's "A/before" baseline register battery (module
  `base0`, text/cascade/live lanes, 28 turns each) from the tone-cascade
  work — useful as an incumbent reference, but it contains **no luna reply,
  no judged luna-vs-incumbent verdict, and none of the three known-bad luna
  signatures** (28.2 words/turn spoken, 0 media tags in 144 replies,
  crisis-beat collapse). Those survive only as recorded aggregates in
  `context/measurements.md`. Until the luna arm is recovered from some other
  copy or the bake-off is re-run, SPEC §14.1's "flags all three" is
  satisfiable for two of three; padding this directory to pretend otherwise
  would corrupt the validity gate it exists to serve. `fixtures.json` marks
  it `usable_for_d0: false`; `evals/fixtures.mjs` asserts the gap stays
  declared so a partial restore cannot silently masquerade as the fixture.
