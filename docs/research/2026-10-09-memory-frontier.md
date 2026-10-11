# Memory frontier for HumanOS

Reviewed 9 October 2026. This is a source and code audit, not a benchmark result. No dependency was installed, no customer data was exported, no database or cloud state was changed, and no model was called.

## Decision

Keep Vyakti's current memory store and authority model. The next code change should be one bounded expert Room experiment: **rank the already-authorized recall pool against the current question before filling the expert compiler's 20-row prompt budget**. Do it with a deterministic Unicode-aware selector, with no new model call, migration, service, vector store or third-party runtime.

This is narrower than the September 29 context-card proposal. It targets a failure the current code makes by construction: a relevant fact at position 21 to 30 is returned by SQL but dropped by the expert compiler if 20 newer, irrelevant facts fit first. It does not claim that this failure has occurred for a real owner, and it does not fix a relevant fact outside the newest-30 SQL pool. Those are explicit evaluation boundaries.

## What Vyakti has now

| Concern | Actual implementation | Consequence |
| --- | --- | --- |
| HumanOS identity | The approved person sheet and the owner's saved vibe are separate from conversation-derived memory. The memory extractor is forbidden to infer a trait, trust, closeness, diagnosis or intention. | Preserve this boundary. A memory engine must not self-edit the person's identity or emotional baseline. |
| Owner memory authority | `OWNER_MEMORY_AUTHORITY` re-derives replica, owner, agent and subject person in SQL, requires active memory consent and excludes revoked or purging replicas. Owner rows are also structurally separated from Room rows. | A client-supplied person or agent ID cannot widen recall. |
| Owner recall | `OWNER_MEMORY_RECALL_SQL` returns active, non-retracted, non-superseded facts newest-first with `limit 30`; `ownerMemoryTail` renders up to 30. | Recall is recency-only and question-blind. An older relevant fact is invisible once it falls outside the pool. |
| Room recall | `ROOM_MEMORY_RECALL_SQL` binds follower, memory epoch, agent, person, Room, replica and publication state. It returns the newest 30 facts plus at most one current communication preference for each of language, script and brevity. | Room isolation is strong. Up to 33 rows can reach the selector. |
| Prompt selection | `selectExpertPrivateMemoryRows` pins the communication-support rows, then fills in input order until 20 rows or the private-memory character budget is reached. | Communication preferences survive, but ordinary facts are selected by recency, not relevance. |
| Corrections | Room and owner correction SQL writes a new exact user statement with its own source episode, then invalidates the old fact with `t_invalid` and `superseded_by`. | The active view has one current fact while retaining lineage. This is stronger than silently rewriting a profile summary. |
| Forgetting | Item forget sets `retracted_at`. Owner consolidation checks the person-wide suppression ledger before provider use and commit. Consent revocation creates an epoch floor so old raw turns cannot re-enter later. Whole-Room forget deletes Room-derived facts, observations and episodes. | Any new selector must consume only the existing authorized query result. It must not query around these predicates or cache selected rows. |
| Relational continuity | `vy_rel_state` can carry honorific, code-switch ratio, trust, rupture and repair state, and regular owner/Room reply paths compile it when a scoped row exists. The Room reader deliberately returns empty pattern, ritual, shared-episode and phrase arrays because their consolidator is not wired for Room followers. Prior measurements say no relationship row is the common case. | The schema can express relational continuity, but persistent emotional continuity is not established merely by having the fields. Sparse evidence must remain sparse. |
| Language | The person sheet supplies English, Hindi or Hinglish reply policy; Room communication memory separately protects explicit language, script and brevity choices. | Retrieval must work with Unicode text and must not use browser locale as identity evidence. Cross-script semantic equivalence remains a separate problem. |

The relevant code is [`api/_room-memory-authority.js`](../../api/_room-memory-authority.js), [`src/engine/expertTextCompiler.ts`](../../src/engine/expertTextCompiler.ts), [`api/_room-surface.js`](../../api/_room-surface.js), [`api/_replica-dialogue.js`](../../api/_replica-dialogue.js), [`api/_room-relstate.js`](../../api/_room-relstate.js) and [`src/engine/relstate.ts`](../../src/engine/relstate.ts). The September 29 audit correctly called the newest-30 pool an evaluation candidate, not a measured model failure.

## Frontier comparison

| System or result | Useful mechanism | Fit with Vyakti | Do not carry over |
| --- | --- | --- | --- |
| Honcho v3 | An evolving peer representation combines conclusions, session summaries and peer cards; named scopes bound session visibility; peer context and evidence APIs expose a compact, source-linked view. Its reasoning layer derives deductive, inductive and abductive conclusions in the background. [Peer representations](https://honcho.dev/docs/v3/documentation/core-concepts/representation), [documentation index](https://honcho.dev/docs/llms.txt), [reasoning](https://honcho.dev/docs/v3/documentation/core-concepts/reasoning) | Its compact relationship context and explicit evidence are useful comparison ideas. Directional representations are relevant to “what this person knows about that person.” | Do not turn inferred conclusions into HumanOS facts or trust state. Self-hosting still requires tool-calling models and OpenAI-compatible route validation for every feature; Azure compatibility has not been run. The server is [AGPL-3.0](https://github.com/plastic-labs/honcho/blob/main/LICENSE). No code should be copied into Vyakti without a separate license and architecture decision. |
| Letta | Always-visible memory blocks provide a small working profile, while archival passages can be searched and deleted. Blocks can be read-only, attached per agent and backed by Azure embeddings. [Memory blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks), [archival passages](https://docs.letta.com/api/typescript/resources/agents/subresources/passages) | A read-only, owner-approved person block resembles HumanOS; searchable archival memory resembles query-aware recall. | Letta blocks are read-write by default and agent-managed; a full-value update is last-write-wins. That conflicts with Vyakti's rule that persona never self-updates without a human tap. Replacing the runtime would also replace proven SQL authority with a broader agent state system. The public repository is [Apache-2.0](https://github.com/letta-ai/letta/blob/main/LICENSE), but no dependency is needed for the proposed experiment. |
| Mem0 | `add` extracts durable facts, then `search` fuses semantic, keyword, entity and temporal signals. Writes and reads can be filtered by user, agent, app and run. Automatic extraction is additive; explicit update or delete handles correction. [How it works](https://docs.mem0.ai/core-concepts/how-it-works), [entity scoping](https://docs.mem0.ai/platform/features/entity-scoped-memory) | Query-time ranking is the clearest transferable idea. Keeping extraction and retrieval separate also matches Vyakti's current consolidator and reply path. | Managed graph memory and its retrieval optimizations are not the same as OSS. Mem0's own docs warn that omitted scope fields are unconstrained, whereas Vyakti's SQL requires the full dyad and Room authority. Do not replace those predicates with optional filters or send conversations to Mem0 Cloud. OSS is [Apache-2.0](https://github.com/mem0ai/mem0/blob/main/LICENSE); the proposed change copies no code. |
| LongMemEval | It separates indexing, retrieval and reading. In its experiments, fact-augmented keys improved recall@k by 4 points and answer accuracy by 5 points; time-aware query expansion improved temporal recall by 7 to 11 points; structured reading also mattered. [Paper](https://arxiv.org/abs/2410.10813) | It supports testing retrieval and answer quality separately. Vyakti currently has a retrieval bottleneck before the model sees the facts. | These are the paper's results on its dataset, not expected Vyakti gains or evidence about Hindi/Hinglish. |
| PERSONAMEM | It tests profile evolution over up to 60 sessions and reports that direct prompting of frontier models remained around 50% overall accuracy. [Paper](https://arxiv.org/abs/2504.14225) | It reinforces that “put the history in the prompt” is not a sufficient personalization strategy, especially after preferences change. | It does not validate Vyakti's extraction, languages or relationship model. |
| 2026 memory work | APEX-MEM keeps append-only history and resolves conflicts at retrieval time; LoCoMo-Plus tests implicit user constraints whose later trigger may not share surface words with the original evidence. [APEX-MEM](https://aclanthology.org/2026.acl-long.749/), [LoCoMo-Plus](https://aclanthology.org/2026.acl-long.1150/) | Append-only evidence plus an active view agrees with Vyakti's correction lineage. LoCoMo-Plus identifies the next hard problem after lexical ranking: relationally relevant evidence can be semantically indirect. | A property graph and retrieval agent are too large for the first experiment. Vendor or paper scores are not a reason to weaken correction, forgetting or scope controls. |

Across these systems, the useful common pattern is small: preserve source evidence, retrieve for the current question, resolve updates deliberately, and keep the final context bounded. Vyakti already has the source, update and authority parts. Its immediate gap is retrieval within the bounded pool.

## Recommended next code change

Extend `selectExpertPrivateMemoryRows` with an optional current-question argument and use it in the expert Room compiler path. With no question, preserve today's byte behavior.

Do not apply the 20-row selector to owner Meet memory. `ownerMemoryTail` currently renders all 30 authorized rows, so inserting the expert selector there would discard 10 rows without relieving an existing owner prompt cap. Owner question ranking should be reconsidered only if a separately measured owner budget actually truncates that pool, and then with an owner-equivalent capacity.

For a question-aware call:

1. Normalize the question and each fact with Unicode NFKC and lowercase.
2. Tokenize with Unicode letter, mark and number classes. Do not use an English-only stemmer or stop-word list.
3. Keep every `communication_support === true` row first, preserving the existing maximum of three and existing character-budget refusal.
4. Rank the remaining rows by exact normalized phrase containment, then unique query-token overlap, then current recency order as the stable tie-breaker.
5. Add positive-overlap rows first, then fill unused slots by current recency order. Return at most 20 whole rows inside the existing `EXPERT_TEXT_LIMITS.privateMemory` budget.
6. Restore the selected rows to their original newest-first order before prompt rendering. Ranking chooses membership; it does not rewrite evidence or imply chronology.

This supports same-script English, Hindi and Hinglish without another inference call. It will not solve semantic paraphrases, Hindi-to-Latin transliteration or a relevant fact older than the newest 30. Those failures stay visible rather than being hidden behind an unmeasured “semantic” claim. If lexical selection earns value, the next experiment can compare an Azure-only embedding or reranker arm against it before widening storage or adding a service.

The implemented source scope is expert Room only. The exact patch set is small:

- `src/engine/privateMemorySelector.ts`: bounded Unicode token overlap, rare-token weighting and stable recency fallback over already-authorized rows only.
- `src/engine/expertTextCompiler.ts`: optional query-aware membership ranking, still capped at 20 and the existing character budget.
- `api/_engine.gen.js`: regenerated artifact from the engine build, never hand-maintained as a second implementation.
- `api/_room-surface.js`: pass the current Room message to the selector at the existing expert compiler call.
- `evals/private-memory-selector.mjs`: source-only before/after retrieval, real compiled-prompt, caller wiring, fallback, support, boundary and scope controls.

No SQL text, schema, migration, consent rule, correction path, forgetting path or relationship-state writer needs to change for this experiment.

## Failure-specific evaluation matrix

Run retrieval checks first with no model. Only if they pass, run matched answer-generation arms through the existing Azure adapter and budget ledger. Use identical model/version, prompt material and question order for baseline and candidate.

| Failure fixture | English / Hindi / Hinglish variants | Baseline expected from source | Candidate acceptance |
| --- | --- | --- | --- |
| Relevant fact is row 21 to 30; rows 1 to 20 are unrelated | Yes | Expert Room drops it because first-fit reaches 20 | Relevant fact is selected in every same-script variant; no unrelated row displaces a higher-scored row. |
| Current question has no token overlap with any fact | Yes | Newest rows win | Candidate is byte-equivalent to current recency selection. No invented relevance. |
| Saved language, script or brevity preference is older than ordinary facts | Yes | Room SQL marks up to three supports and compiler pins them | Every support remains selected. Current-turn “today only” wording controls the reply without mutating the durable preference. |
| A fact was corrected | Yes | SQL excludes the superseded row | Only the replacement can enter ranking and prompt provenance. |
| A fact was item-forgotten, source-suppressed or from a revoked consent window | Yes | Authorized SQL returns no eligible row | Selector receives or emits zero forbidden rows. Mutation controls that remove each SQL predicate must fail. |
| Same person in another Room/agent, another follower, or another owner | Yes | Full SQL authority returns no foreign row | Zero foreign IDs or body sentinels in selected rows, prompt or answer. This remains a zero-tolerance gate. |
| Quote is about a sibling, hypothetical person or assistant statement | Yes | Extractor should not convert it into the speaker's trait; assistant sources are absent | No personal trait or closeness claim. If evidence is ambiguous, answer abstains or asks, rather than personalizing. |
| Old relationship cue is semantically relevant but shares no tokens | Yes | Recency-only may miss it | Recorded expected limitation for this lexical experiment, not a pass. Use this set later to compare an Azure-only semantic arm. |
| Relevant fact is row 31 or older | Yes | SQL never returns it | Recorded pool-ceiling failure. Do not widen the SQL pool until the in-pool selector earns value and query cost is measured. |
| Sparse emotional evidence | Yes | Memory extraction forbids inferred trust/closeness; relation state may be absent | No emotion, bond or intent is invented. Existing relation state, if present and scoped, stays separate from fact ranking. |

Use 12 histories per language, with the relevant row rotated through positions 1, 10, 20, 21, 25 and 30 and with corrected, forgotten and foreign-scope sentinels in separate cases. The retrieval primary measure is evidence recall@20. Safety measures are stale-fact inclusion, forgotten-fact inclusion and cross-scope inclusion, all with a required value of zero. Record selected row IDs, prompt characters, wall time and the reason for each selected row (`communication`, `phrase`, `token`, `recency_fill`) without logging body text.

For the Azure answer stage, score source-supported answer correctness, update correctness, abstention, and language/script adherence separately. A gain counts only if retrieval recall improves on the pre-registered in-pool failures, every safety measure stays at zero, the prompt remains within the existing budget, and p95 selection time does not materially move request latency. An answer-quality gain without the correct cited fact in the selected set is not a memory gain.

## Boundaries

This report recommends no Honcho, Letta or Mem0 adoption. Honcho's Azure-compatible self-host route remains plausible and unvalidated; Letta and Mem0 would replace more infrastructure than this failure requires. No published benchmark establishes HumanOS quality, relational or emotional continuity, or English/Hindi/Hinglish performance for Vyakti. The proposed selector is a reversible local experiment whose value can be measured before any migration, new model route, external service or license obligation is introduced.
