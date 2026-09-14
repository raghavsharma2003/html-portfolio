# Published material grounding candidate, 2026-09-08

Base: c3cae7ddbb6992ed9311d46f88d89b31f3fee8b0. Candidate is isolated and unaccepted for answer quality. No service, DB or model calls were made by this lane.

## Observed failure and mechanism hypothesis

Retained root artifact `scratchpad/expert-tools/native-text-publication-run-checkpoint27.json`, `raw_azure.structured_reply`, contains the correct period 2.5 s and frequency 0.4 Hz, followed by the simple-pendulum formula, assumed g = 9.8 m/s² and an unqualified length of about 1.55 m. The supplied note explicitly records length and amplitude as unmeasured. Root's preregistered quality rubric fails this addition. The raw output already contains the error; delivery did not create it. The original uploaded bytes, question, raw response and failed quality result remain untouched. This observed case is development evidence, never fresh heldout evidence.

`src/engine/publishedMaterialAssistant.ts:34` builds the existing shared floor. Its evidence rule and source-adjacent text already restrict unsupported source claims and require uncertainty. They do not explicitly distinguish a calculation from supported quantities from a model-based reconstruction requiring extra assumptions. Source-specific unknown data and a user request for a missing fact can therefore be answered with a familiar textbook model despite the existing general restriction. This is a falsifiable policy-interpretation hypothesis, not a proven causal account or evidence that the model cannot reason.

`api/_dialogue/providers/azure-foundry.js:110` forwards the compiler messages, with temperature 0.45, output cap 700 and the existing structured schema. `api/_dialogue/contracts.js:58` accepts a reply string and a delivery enum; `grounded` is a manner label, not a factual proof. The schema contains no prewritten answer, required chronology, numeric formula or support check. Its generic description says private replica reply; that imprecise inherited label does not force this estimate and is unchanged. `api/_text-publication-runtime.js:103` applies the existing output gates after generation; those gates do not establish mathematical applicability or certify every source claim. No post-hoc text hiding is proposed.

## Exact production slice

Only the publication compiler gains a static 1,407 UTF-16-unit claim-basis block after source material and the language policy, immediately before the unchanged output-shape rule (`publishedMaterialAssistant.ts:18,40`). The shared floor, material escaping, private compiler, Room compiler, Azure schema, authority store and all delivery gates remain unchanged. The block uses constraint shapes, not a model answer or a pendulum-specific template.

The policy separates source observations, supported derivation, conceptual explanations and explicitly requested hypothetical calculations. Missing properties stay unresolved; unsolicited estimates cannot fill them. Explicit hypothetical calculations remain allowed with assumptions and qualifications, and supported subquestions still need answers. Source/user instructions do not become factual evidence, permission or higher-priority policy. No new claim that prompts enforce SQL authority or reliably eliminate hallucination is made.

Reversal: reject or revise this candidate if fresh comparison shows no improvement on unsupported inference, hides supported answers, refuses requested hypothetical calculations, loses language/units/qualifications, or weakens authority boundaries. A static phrase assertion cannot justify promotion. This slice applies only to the published-material lane; private rehearsal and the wider clone path are not repaired by inference.

## Preregistered comparison

Before editing production, the lane saved ROOT `scratchpad/expert-tools/GROUNDING28-HELDOUT-20260908.json`, SHA256 `18125bec34efd671393b00aeafb50d80b09a815a0ee3605f178ed8378b3d0363`. Six cases span English, Hindi and Roman Hinglish, physics/chemistry/maths, missing initial conditions, molar mass/density, individual counts, quoted injection, and three explicitly hypothetical positive controls. It was authored by the implementation agent before code, not by a blind independent evaluator. No heldout values appear in production or offline tuning fixtures.

Proposed root-owned trial: six cases times two arms, exact baseline27 and frozen candidate, alternate arm order, no retries, maximum twelve Azure calls under the existing ledger and rate controls. Grade source facts, derived values/units, missing data, conditional versus measured status, language and authority independently on raw and delivered outputs. Report paired cases and each failure, not a population success rate or superiority claim. Stop at the cap and retain results; any later revision requires a new holdout. Root owns execution clearance and accounting. Prior native HTTP evidence covers unchanged API/lifecycle code only; it is not a full native proof for the changed compiler.

## Offline verification and limits

`node evals/published-grounding/run.mjs`: nine groups, actual current TypeScript against generated artifact, exact baseline difference limited to the static block, old/removal negative, adversarial material escaping, separate user role, bounds/authority, preserved platform constraints, and real Azure adapter with an injected response. The adapter control deliberately returns an unsupported synthetic assertion and verifies it is not silently rewritten: this proves the absence of factual validation, not factual success.

The first harness attempt failed before tests because `esbuild` was not an importable local package. It was replaced with the repository's existing `rolldown` test dependency; no package installed. The normal repository engine build remained unchanged.

`node evals/expert-text-compiler.mjs`: 19 groups including all 83 default byte fixtures against the actual generated artifact. `node evals/private-rehearsal-compiler.mjs`: 17 groups. Forced TypeScript, engine freshness and diff checks passed. Focused receipt `scratchpad/published-grounding/1788815176805.json` records the source/artifact hashes and 1,407-unit policy delta (synthetic fixture prompt 3,972 -> 5,379 units). These are string units, not provider tokens. No model quality, SQL or deployment acceptance follows.
