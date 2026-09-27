# Multimodal research into the existing product

The next useful experience is an owner bringing artwork with their own text or
voice explanation, receiving a source-grounded suggestion, and correcting what
the AI misunderstood. Existing Feed, evidence, claim review and Meet paths remain
the product. More source cards or passing contract assertions do not establish
that this experience is useful.

The [registry](registry.json) retains nine selected sources from the GroupAI
review recorded on 27 September 2026, commits `b476a3c` and `56b3537`. Retrieval
dates describe that earlier review; this integration did not fetch these sources
again. Author-reported results remain author-reported. The prior active-platform
[expert evidence ledger](expert-fidelity-20260907/evidence-ledger.md) and
[experience compiler research](CONTINUOUS-HUMAN-CLONE-FRONTIER-2026-08-29.md)
remain relevant; this index is a bounded continuation, not a replacement.

The adopted Azure serving route is unchanged. The evaluation-guidance source is
methodology, not a new provider selection. External model availability, prices
and licenses must be rechecked before a concrete comparison uses them.

## What the retained research changes

| Product question | Retained evidence | Bounded next step |
|---|---|---|
| Can the AI remember the right correction? | [LongMemEval](https://arxiv.org/abs/2410.10813), [MemEval](https://github.com/ProsusAI/MemEval), [ReaLMem](https://arxiv.org/html/2609.19167v1) | Test current ownership, temporal changes and abstention through existing claim and serving paths. Compare candidate methods only after recording that baseline. |
| Can media remain grounded and removable? | [Deployment-Time Memorization](https://arxiv.org/html/2606.10062v2), [CrossMPI](https://arxiv.org/html/2605.16090v1), [C2PA 2.4](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html) | Preserve source and locator commitments. Media contents cannot grant authority. Track removal through existing source/replica cascades. C2PA validation is not implemented by this work. |
| Does an image plus the owner's explanation help? | [Mem-Gallery](https://arxiv.org/html/2601.03515v1), [Collective Agency in Art-making](https://ojs.aaai.org/index.php/AIES/article/view/36710) | Compare one artwork task with and without the image while holding the explanation fixed; measure useful accepted suggestions, mistaken interpretations and correction effort. |

Start with synthetic/licensed material. A future owner trial needs real sign-in
and separately authorized assets. Hold task, source bytes, prompt, provider
revision and spending limit fixed. Score English, Hindi and code-switching
separately. Capture source grounding, useful accepted next steps, correction
effort, latency and actual cost. A successful upload or structured response is
not a quality score. Sharing, remix and publication remain explicit owner acts.

## Run the small manual cycle

```powershell
node scripts/research-cycle.mjs check
node scripts/research-cycle.mjs queue --as-of 2026-10-12 --json
node evals/research-cycle/run.mjs
node evals/multimodal-claim-evidence/run.mjs
```

The source queue uses the registry snapshot date by default. Pass a later date
to see due reviews. Documentation/repositories are due after 14 days and
papers/standards after 90 days; those are triage intervals, not assurances that a
source remained unchanged. Commands stored in the registry are display-only.
Nothing fetches URLs, executes experiment commands, spends money, selects a
provider, upgrades a dependency or starts a recurring watcher.

For each cycle, choose one question from the active user journey. Open only its
due primary sources, record material changes and limitations, then run the
smallest comparison that can change an implementation decision. Record failure
as an outcome. Promote a change only on the evidence required for that specific
capability, then append the decision, measured result and rejected approach to
the existing `context/` prose and `context/graph.json`. No second graph is added.

## Evidence has separate execution and outcome fields

`planned`, `implemented` and `completed` describe execution. Only a completed
experiment carries `pass`, `fail` or `inconclusive`, an observation date and a
concrete result. Failed and inconclusive completed experiments stay in the queue.
A completed pass only covers its declared evidence scope. The checker verifies
metadata, dates, references and local artifact existence; it cannot attest that
an experiment ran or reproduce a scientific result.

The historical Actual213 record deliberately remains `completed` and `fail`.
Its seven actual calls stored corrected Hindi preferences, but the delivered
reply was entirely English. The [handoff](../../handoff/2026-09-09/START-HERE.md)
records cleanup, cost and receipt identity. This integration did not rerun it.
Its command is null to avoid advertising a replay of consumed identities. A
fresh successor should inspect actual delivered language after the existing
policy fix. New registry citations organize this historical result; they do not
claim to have motivated it at the time.

Current active artifacts include `evals/context-claim-grounding/run.mjs`,
`evals/citation-coordinates.mjs`, `evals/experience-compiler/run.mjs` and
`evals/multimodal-claim-evidence/run.mjs`. These contract/fixture suites remain
distinct from real PostgreSQL execution, actual perception quality and the
authenticated user journey. Focused outcomes belong in the existing context
measurements; the complete candidate still needs its normal release gates.

On 27 September, `node evals/research-cycle/run.mjs` passed 15 offline assertion
groups, including actual CLI subprocesses. `check` validated nine sources and
five experiments. The explicit 12 October queue marked two documentation/repo
sources due and retained Actual213's failed outcome. These are observed tooling
results only; no sources were refetched and no model or human trial ran here.
