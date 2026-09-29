# Getting the useful parts of Honcho into Vyakti

Research snapshot: 29 September 2026. This is a source-backed adoption decision and experiment plan, not an installed integration or a reproduced Honcho benchmark. No account, plugin, dependency, server, private-data upload, model call or cloud resource was created.

## Decision

Borrow the strongest patterns inside Vyakti's existing evidence and authority layer first. Keep a direct Honcho dependency as a separately authorized, synthetic-only comparison candidate. Do not replace ownership, consent, source erasure or explicit owner approval with inferred profiles or retrieval filters.

The reference implementation inspected is Honcho [commit 9d6fe8c](https://github.com/plastic-labs/honcho/commit/9d6fe8ca5dc666b99ef04bc00047fea4ca675017), dated 29 September at 03:37:52 UTC; its server package/changelog identify 3.2.1. Live v3 documentation can move independently of that snapshot. No Honcho implementation code has been copied into Vyakti.

## The five useful transfers

| Honcho pattern | Vyakti already has | Smallest useful next step |
|---|---|---|
| Observer-to-subject perspectives | Exact agent/person, owner/replica and follower/Room authorities in `api/_room-memory-authority.js` and `api/_experience-compiler/mirror-recall.js` | Include perspective and source revision in retrieval receipts and test cross-Room non-interference. Do not add a second identity authority. |
| Explicit facts separated from inferred conclusions | Typed evidence, claim proposals, owner decisions and accepted-profile materialization in the Human Experience Compiler | Keep inference visibly provisional; distinguish the owner's words, machine transcription and interpretation during review. Repetition must not manufacture independent evidence. |
| Deterministic evidence collection | Exact source-bound citations and committed extraction inputs | Add a bounded internal read-set receipt alongside citations, and carry existing source modality/locator into owner review. An item being retrieved does not mean the answer relied on it. |
| Cheap context assembly, separate costly reasoning | Existing compiler budgets, approved Mirror recall, and an explicit lexical-shadow experiment | Compare bounded approved-memory selection against the current rank before introducing a reasoning call per turn. Count ingestion and background work, not only prompt savings. |
| Dependency-aware retraction and fresh projections | Existing source/replica erasure graph, supersession and authority rechecks | Test that stale summaries/cards/background jobs cannot restore removed evidence. Rebuild from current permitted sources, not from the old derived profile. |

Primary references: [directional representations](https://honcho.dev/docs/v3/documentation/features/advanced/directional-representations), [representations](https://honcho.dev/docs/v3/documentation/core-concepts/representation), [evidence](https://honcho.dev/docs/v3/documentation/features/advanced/evidence), [context assembly](https://honcho.dev/docs/v3/documentation/features/get-context), [scope retraction implementation](https://github.com/plastic-labs/honcho/blob/9d6fe8ca5dc666b99ef04bc00047fea4ca675017/src/deriver/scope_backfill.py).

The retrieval receipt should separate admitted evidence, budget omissions and unavailable processing. Unauthorized identifiers, raw private text and private source fingerprints must not leak into user-visible diagnostics or generic logs. Keep validated answer citations separate from the internal read set. Honcho's optional evidence collects material encountered by retrieval and successful tool calls; it is not a complete execution trace or proof of causal attribution.

## Fit boundaries we must not blur

- **Recall is not permission.** Honcho [scopes](https://honcho.dev/docs/v3/documentation/features/advanced/scopes) do not establish authorization. Named-scope reads and session allowlists also have different semantics. Vyakti must derive allowed scope on the server and refuse missing or mixed authority instead of falling back to a wider read.
- **Projection provenance matters.** Session-context code omits peer cards under an allowlist, but the pinned source documents a peer-chat card inconsistency. This is a static finding, not a reproduced hosted vulnerability. Do not assume all endpoints have equivalent scope behavior. See [session context](https://github.com/plastic-labs/honcho/blob/9d6fe8ca5dc666b99ef04bc00047fea4ca675017/src/routers/sessions.py) and [peer chat](https://github.com/plastic-labs/honcho/blob/9d6fe8ca5dc666b99ef04bc00047fea4ca675017/src/dialectic/chat.py).
- **Session deletion is not complete forgetting.** Honcho documents that derived conclusions can survive session deletion; deletion is asynchronous and lacks a completion-status endpoint. Its queue counters are not an erasure receipt. Any future adapter needs immediate recall exclusion plus verified removal of dependent projections. [Deletion](https://honcho.dev/docs/v3/documentation/features/advanced/deleting-data)
- **A quiet queue is not a freshness barrier.** Pending/completed counts are operational telemetry and completed entries can be cleaned up. Readiness should bind to the specific source revision and materialization, with pending/failed/ready kept distinct. [Queue status](https://honcho.dev/docs/v3/documentation/features/advanced/queue-status)
- **Reasoning is not perception.** Honcho's documented uploads convert supported PDF/text/JSON material to messages; they do not supply native artwork, audio or video understanding. Keep Vyakti's upstream modality restrictions and coordinate lineage. [File uploads](https://honcho.dev/docs/v3/documentation/features/advanced/file-uploads)
- **Background hypotheses do not approve themselves.** Borrow the separation of extraction and consolidation from [dreaming](https://honcho.dev/docs/v3/documentation/features/advanced/dreaming), but keep owner persona changes behind the existing explicit review gate.

## Dependency and data-handling decision

Honcho is a separate FastAPI/deriver/PostgreSQL-pgvector service, not just a small in-process utility. Self-host configuration supports compatible model endpoints, but that does not establish a working Azure-only deployment. Every generation, embedding, retry, fallback and tracing path would need explicit configuration and egress checks; authentication must be enabled. No local stack should be started on this employer laptop. [Self-hosting](https://honcho.dev/docs/v3/contributing/self-hosting), [configuration](https://honcho.dev/docs/v3/contributing/configuration)

The core server is AGPL-3.0; SDK manifests declare Apache-2.0. These are separate licenses, and neither establishes rights to Neuromancer weights. No official weight download/license was found in the reviewed model materials. Review the exact intended deployment and license obligations before copying or integrating server code; this research is not a legal conclusion. [Core license](https://github.com/plastic-labs/honcho/blob/9d6fe8ca5dc666b99ef04bc00047fea4ca675017/LICENSE), [SDK manifest](https://github.com/plastic-labs/honcho/blob/9d6fe8ca5dc666b99ef04bc00047fea4ca675017/sdks/typescript/package.json), [Neuromancer](https://plasticlabs.ai/neuromancer)

The hosted [privacy policy](https://app.honcho.dev/privacy), last updated April 2025, permits some de-identified non-public fine-tuning and describes US-centered infrastructure; it is not an Azure-only/no-training commitment. Obtain current written data-processing and deletion terms before personal media. Hosted [terms section 5.1](https://app.honcho.dev/tos) also include a competing-systems restriction, while section 16 distinguishes the open-source version. Seek vendor clarification and appropriate legal review before a hosted Vyakti trial. Do not infer current certification status from an old roadmap.

No key or credits are required for the idea-first work. If a direct service trial is later chosen and authorized, keys come from the [Honcho dashboard](https://app.honcho.dev/). Its README's signup-credit offer and the homepage's separate startup-credit program are not confirmed entitlements for this user. Do not paste credentials into this repository or chat.

## What the benchmark claims actually establish

The published results inspected are vendor-run December 2025 experiments, distinct from current v3 code and the older Neuromancer XR model-card experiment. Pin the [results repository at 20c497b](https://github.com/plastic-labs/honcho-benchmarks/tree/20c497bff02ff8737268be6d91c197767dc7bac0/a1d689b) and its [Honcho runner revision a1d689b](https://github.com/plastic-labs/honcho/tree/a1d689bdbb0e3d7786710625e7130e3db37f6108/tests/bench). They expose useful configurations and traces, but no local reproduction was performed.

- LongMem S reports 452/500 correct (90.4%). Metadata names a Gemini 2.5 Flash Lite preview deriver and Claude Haiku 4.5 dialectic, with dreaming and summaries disabled. It is not proof that self-hosted Neuromancer or a different Azure backbone will attain that score. [Raw S artifact](https://raw.githubusercontent.com/plastic-labs/honcho-benchmarks/20c497bff02ff8737268be6d91c197767dc7bac0/a1d689b/longmemeval_s_results_20251212_201328.json)
- LoCoMo's headline 89.9% is a mean over ten conversation accuracies; the raw category totals give 1,378/1,540 (89.48%). Its runner excludes adversarial category 5, uses existing image captions as text and applies an LLM judge. This does not establish raw image understanding or abstention. [Raw LoCoMo artifact](https://raw.githubusercontent.com/plastic-labs/honcho-benchmarks/20c497bff02ff8737268be6d91c197767dc7bac0/a1d689b/locomo_results_20251215_175728.json), [runner](https://github.com/plastic-labs/honcho/blob/a1d689bdbb0e3d7786710625e7130e3db37f6108/tests/bench/locomo.py)
- The displayed BEAM 10M value of 0.409 does not match the linked raw summary's 0.405675. Preserve this unresolved discrepancy instead of selecting the more attractive number. [Dashboard](https://honcho.dev/evals/), [raw 10M artifact](https://raw.githubusercontent.com/plastic-labs/honcho-benchmarks/20c497bff02ff8737268be6d91c197767dc7bac0/a1d689b/beam_10M_20251216_184546.json)
- The LongMem token ratio concerns an uncached dialectic input-token metric, not an all-stage bill including ingestion, embeddings, background work, retries and the application answer. The site's fast `context()` claim is a different operation from reasoning `chat()`. [Metric implementation](https://github.com/plastic-labs/honcho/blob/a1d689bdbb0e3d7786710625e7130e3db37f6108/tests/bench/longmem.py)
- The newer official [LongMemEval-V2](https://github.com/xiaowu0162/LongMemEval-V2/) broadens evaluation to multimodal agent histories. No matching Honcho result was established in this review. None of these inspected scores establishes Vyakti's corrected-Hindi, source-coordinate, permission or deletion behavior.

Use the public harness structure as an evaluation reference, not a promise of a particular accuracy, cost saving or breakthrough for our users.

## First product slice

Prioritize the existing Feed -> claim review path, not a backend migration:

1. Preserve the selected Context Locker item when opening Evolve.
2. Carry authenticated source identity, modality and exact quotation into each reviewable claim; expose only coordinates actually available. Do not invent PDF page mapping or original-audio alignment.
3. Show interpretation and processing state honestly, then retain explicit accept/reject/supersede behavior.

These gaps were previously located in `src/studio/ContextLockerPanel.tsx`, `src/studio/CloneExperience.tsx`, `src/studio/PersonModelStudio.tsx` and `api/_person-model.js`. This research does not implement them. They would let an owner inspect and correct the new multimodal evidence already reaching extraction. A saved correction is not proof of learning or activation; the existing evaluation and approval gates remain intact.

## Preregistered comparison, not an executed experiment

Start with 48 invented cases: eight failure/capability classes, three language conditions (English, Hindi and code-switching), two cases per cell. Classes: explicit recall, correction, contradiction, speaker attribution, audience isolation, revocation, derived-data erasure and abstention. Include text, document excerpts and labelled media transcripts; do not count transcript recall as perception quality.

Compare the existing approved-memory baseline with its existing lexical-shadow option first. A Honcho arm is optional and blocked on the deployment/data/license decisions above. Keep source corpus, answering model, prompts, retrieval/input-context and output budgets, and scoring fixed; pin every serving/embedding/reasoning version. Measure source selection independently of answer quality. Explicitly distinguish cold ingestion, pending processing and ready recall.

Report exact-source recall, corrected/stale answers, citation validity, forbidden or resurrected evidence, actual input/output tokens, ingestion/reasoning cost, and latency distributions. Treat any unauthorized disclosure or post-revocation resurrection as failure. Register quality/cost tradeoffs before seeing outcomes; do not optimize solely for short prompts. The existing `evals/mirror-memory-frontier/query-contract.mjs` can establish query-shape behavior without connecting to SQL, but cannot establish retrieval accuracy or provider quality.

Only promote a candidate after it improves an agreed owner task without weakening scope, deletion or review. Reversal condition: reject the dependency/pattern if a controlled comparison shows no worthwhile gain, inconsistent authority/provenance, unprovable erasure, or unacceptable operational cost. Keep negative results in the research registry.

## Local verification performed

On 29 September, the existing Mirror query-contract command passed with network blocked, covering bounded query input, explicit experimental opt-in and SQL parameterization. The existing multimodal claim-evidence suite passed 19 offline groups through production functions with injected dependencies. Neither result exercises Honcho or a real database, nor measures retrieval accuracy or owner value. The 48-case comparison above remains planned, with no outcome claimed.
