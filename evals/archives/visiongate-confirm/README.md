# visiongate-confirm — the powered watch-directive fabrication run (2026-08-15)

The confirmatory battery `context/measurements.md` `visiongate-interim` said
was required before the vision gate could give a verdict at full statistical
power. Both arms are `grok-4-20-non-reasoning` (Azure Foundry, credits) on
the 16 stimulus frames in `stimuli/` (355×768 q68 — app fidelity), differing
only in the WATCH_COMMENT_DIRECTIVE:

- **before_baseline** — the pre-retune directive, recovered from
  `git show dd0a04c^` (the line commit `36ce2a1` replaced)
- **v4b_comment** — the shipped directive, byte-verified identical to
  `src/engine/persona.ts` at the time of the run

## Headline (assertion-level fabrication, both arms past the n≥300 bar)

| arm | fabrication | n | engagement |
|---|---|---|---|
| before | 10.2% [7.3, 14.1] | 313 | 20.4% (archived matched n=240) |
| v4b | 11.2% [9.1, 13.8] | 695 | 41.7% (archived matched n=240) |

Difference +1.0 pp, 95% CI [−3.1, +5.1], p=0.64 — **no detected rise**, and
the first time this comparison has cleared `fab-noise-floor` on both arms.
Not an equivalence proof: a true rise up to ~5 pp is not excluded.
Engagement doubling: +21.3 pp, p=4.9e-7 (archived matched batches).

## Two process findings, both worth more than the headline

1. **`visiongate-interim`'s v4b fabrication figure (6.8%) was an artifact of
   incomplete judging** — only 33 of 100 archived spoken replies had been
   scored. Completing the judging of the same already-paid-for data moved
   the archived-only rate to 12.0%. The "flat" interim read compared a
   fully-judged arm to a partially-judged arm. Logged in
   `context/rejected.md`.
2. **The deployment drifted under us in 4 days.** Both arms' engagement rate
   shifted materially between the Aug-11 archive and this run (before
   20.4%→~7.6%; v4b 41.7%→57.1%), two independent new batches agreeing with
   each other against the archive. Direction widens the gap. Consistent with
   `config/models.json`'s own flag that this Foundry build "could change
   underneath us." The weekly drift monitor now has this exact battery to
   re-run.

## Layout

- `report.json` — full statistics; `gate-bundle.json` — the evidence shaped
  for the `vy_gate_run` row that was recorded from it
- `out/` — every generated and judged row plus `spend.log` (3,201 calls,
  ~4.29M tokens, credits, $0 cash)
- `harness/` — the thin wrappers plus the shared `az.mjs`/`persona.mjs`/
  `judge.mjs` they import and the two directive files
- `stimuli/` — the 16 frames + `truth.json` ground truth

To re-run (drift monitoring): the harness expects the session-scratchpad
layout it was written against — `$S/jpg/`, `$S/truth.json`, `$S/mf/dirs/`,
`$S/visiongate-confirm/out/` where `S` is exported from `harness/az.mjs`,
and an `$S/.azure` file with `AZURE_OPENAI_ENDPOINT`/`AZURE_API_KEY` (never
committed). Recreate that shape from this archive and run
`node gen.mjs <arm> <kStart> <kEnd>` then `judge-run.mjs`, `analyze.mjs`.
