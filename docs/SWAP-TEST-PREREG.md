# Pre-registration: swap-test run 1 — gpt-5.6-terra vs the incumbent

This document freezes the design of the first gated model-swap attempt BEFORE
any confirmatory data exists. The commit that introduces this file is the
pre-registration timestamp; changes after that commit are amendments and must
say what they changed and why. The protocol it instantiates is
`docs/research/swap-test.md` (Phase A, track 9); the machinery is the Phase C
battery under `evals/dbattery/`. Statistical laws (`fab-noise-floor`,
both-orders agreement-only, interleaved same-model controls, TOST-not-p>.05)
apply as written there and are not restated.

## Arms

| | model | where it runs | sampling |
|---|---|---|---|
| incumbent | `google/gemini-3.6-flash` (`OPENROUTER_DEFAULT_MODEL`, chat lane) | production path | production values |
| candidate | `gpt-5.6-terra` | Azure Foundry deployment | `temperature=1` (API allows no other), `reasoning_effort:"none"`, `max_completion_tokens` |

**Scope: the CHAT lane only.** Voice (Gemini Live) and vision lanes are not
part of this run; D6-voice and D6-vision are n/a by scope, not skipped by
neglect. The vision lane has its own live gate question (the watch-directive
confirmatory run) proceeding separately.

**Disclosed asymmetry:** terra's API pins temperature to 1 while the incumbent
runs production sampling. This is a real confound and it is carried in the
corpus manifest, not hidden. If the candidate fails D1 bands, a temperature
artifact is one admissible explanation and the rejection entry must say so.

**Terra's judge failure is not a candidacy failure.** terra scored 54.2%
as a JUDGE against archived blind verdicts (bar: 80%) — it reads Hinglish
teasing as "mocking". That disqualifies it from refereeing, not from being
refereed; candidates need no qualification, the battery exists to judge them.

## The context premise — AMENDED, see Amendment 1

~~Every candidate turn is generated under the compiled context the incumbent
saw, **byte-identical** where the archive stores the served prompt.~~
WS-CANDGEN measured the premise and it failed completely: **no archive
stores a full served prompt** (the bake-off rigs were ad-hoc dialects that
never went through the real compiler), and the replayable pool ceilings at
288 distinct turns — all reconstructed, none byte-identical. The named
reversal condition fired before any run, which is the pre-registration
doing its job.

### Amendment 1 (2026-08-15, before any confirmatory data)

**Paired fresh generation replaces archive replay.** ≥2,000 distinct
contexts are compiled through the REAL engine (`src/engine/compiler.ts` —
beat scripts crossed with relational-state fixtures, so the compiled context
varies even where a stimulus line repeats), and each compiled prompt is
served to BOTH arms. Byte-identity across arms holds **by construction** —
the same bytes go to both models — which is the identity the comparison
actually needs; identity to historical traffic never was available and is
not claimed. A context is "distinct" at the (stimulus, compiled-state) pair
level, and the corpus manifest records the pairing.

This is stronger than the original design, not weaker: the arms are now
tested under the actual relational engine whose identity-carrying is the
company claim, rather than under bake-off rigs that predate it, and the D1
incumbent bands get re-derived from the same-week incumbent arm — the drift
law satisfied by construction instead of by scheduling. Cost consequence:
the incumbent arm must now be generated too (free Gemini daily pool first,
production's own path; OpenRouter overflow is the ~$0–30 cash residue
already priced in `d2-on-credits`). The free pool is a shared DAILY budget
with production — the full incumbent run is paced across days or overflowed,
never allowed to starve the live app.

## Gate sequence and frozen parameters

Run in order; first failure ends the run.

1. **D0 — battery validity.** Already passed (2026-08-15): flags all three
   archived bake-offs on deterministic axes. Not re-run.
2. **D1 — deterministic register bands.** ≥2,000 candidate turns.
   Bands: `evals/archives/fixtures.json` `reference_bands`, incumbent side
   re-measured the same week (drift law). Hard fails regardless of bands:
   any Devanagari; media-tag rate 0. Cost: Azure credits, $0 cash. **This
   gate may run before judge approval** — it needs no judge.
3. **D2 — relational judged battery.** Axes: `shared_history_use`,
   `we_reference_quality`, `boundary_consistency`. n≥300 judged units per
   cell, both orders, agreement-only wins, interleaved incumbent-vs-incumbent
   control pairs. Gate: swap-cell rate within **10 pp** of the co-measured
   control-cell rate per axis.
4. **D3 — identity probes** (taste self-agreement, canon, all 138 persona
   invariants at 100% by definition) and **D4 — memory-behavior** (callback
   distribution vs incumbent). Judged layers at n≥300; margin 10 pp.
5. **D5 — charm parity.** n≥300 conversation units, all charm axes; gate:
   **no axis loses beyond 10 pp** under the qualified judge.

## The judge — a pre-registered deviation

`swap-test.md` D5 asks for two judge families. This run uses **one**:
the anthropic family (house precedent `claude-opus-4.8`, the model whose
blind verdicts are the archived ground truth every backtest was scored
against).

Why one is defensible HERE and was not in general: the two-judge rule guards
the same-family affinity confound, and the one measured instance of it was
grok-4.3 favoring its own family 16× (81% pick rate vs 5% ground truth).
The anthropic family is disjoint from BOTH arms — google incumbent, openai
candidate — so the measured failure mode has no path into this pairing. The
cost of the second family is what the rule buys nothing with: all three
credit-billed judge candidates failed qualification (28.1% / 54.2% / 34.4%
vs the 80% bar; `evals/dbattery/judges.json` has row-level provenance), so a
second family means a second ~$400 of cash for a confound this pairing
cannot express. If a future run's candidate or incumbent IS anthropic-family,
this deviation does not carry — that run buys the second judge.

**Cash spend: ~$400, one family, judged gates only. No judged gate runs
until the owner approves the spend.** Generation and D1 are credits and
proceed without it.

## Decision rules

- **All gates pass** → a real `vy_gate_run` row is written (the machinery's
  first non-refusal), the chat-lane candidate list in `config/models.json`
  gains terra with gate evidence attached, and Phase D proceeds to adapter
  derivation under the standing caps ($500 / 3 loops / 1 week). This would
  be the first model swap this program has ever gated in.
- **Any gate fails** → the failing number goes to `context/rejected.md`,
  terra stays off the lane, and the failure is a finding — the battery
  saying no to a frontier model under a byte-identical context is exactly
  the "model sets the ceiling" claim, quantified on our own axes.
- No partial credit, no re-rolls: a failed gate is not re-run with new seeds
  until a logged engine change gives a reason to expect a different result
  (`supersedes` edge required).

## What is NOT decided by this run

Passing D1–D5 offline does not put terra in front of users. The consented
cohort (`swap-test.md` §4) is a separate, later, owner-approved step with
its own pre-registration. This run answers one question: **does the
relational engine carry enough of her identity that the battery cannot
tell the model changed** — measured, not vibed.
