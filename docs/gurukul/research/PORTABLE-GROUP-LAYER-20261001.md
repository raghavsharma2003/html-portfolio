# Portable Group AI: researched boundaries and the first reusable unit

Research date: 1 October 2026. This extends the [Honcho review](HONCHO-ADOPTION-20260929.md) and the [readiness ledger](GROUPAI-READINESS-20260929.md). Public documentation, source and papers were reviewed; no external implementation was copied, memory service installed, private data uploaded, or provider benchmark run.

## Implementation choice

Extract small mechanisms that the real application already needs, with injected authority and storage adapters. Keep the existing PostgreSQL source of truth, platform audience checks, owner review and disclosure predicates. Do not add a second memory database or workflow platform just to obtain a reusable API.

The first unit is `api/_group-runtime/checkpoints.js`, with TypeScript declarations and a local README. It has no imports or ambient I/O. The host provides a policy version, scope and authority reader, binds a source snapshot once, and invokes `assertCurrent()` at named boundaries. Its guarantee is deliberately `checkpointed`: this is not a transaction, durable delivery ledger, bearer capability, or atomic external-send authorization.

Object-key ordering is canonicalized, array ordering is preserved, snapshots are detached and frozen, malformed/unbounded DTOs fail closed, and any observed failure permanently invalidates that turn. The repeated authority/source/authority/source sequence detects changes during awaited readers. It cannot detect every unobserved transition or undo a completed external disclosure. Resource limits are explicitly UTF-16 characters and structural counts, not a model-token or wire-byte budget.

`api/_surface.js` remains the adapter: it owns current SQL eligibility and the trusted transport witness. Reuse requires the other project to supply equally explicit admission logic; a successful reader call alone is not permission. Two unrelated synthetic adapters in the unit suite exercise reuse without Vyakti identities or chat concepts. Actual caller integration and hosted acceptance must be recorded separately from those unit tests. No package has been published and no external license grant is implied.

## Durable execution and authorization research

| Reference | Technique worth using | Boundary retained |
|---|---|---|
| [Temporal Activities](https://docs.temporal.io/activity-definition), [execution](https://docs.temporal.io/activity-execution) | Stable effect identities and replay of recorded results; explicit retry policy. | An activity may run again after an unrecorded completion. The downstream service must enforce idempotency; cancellation does not undo disclosure. |
| [Restate durable steps](https://docs.restate.dev/develop/ts/durable-steps) | Journal small named steps and keep invocation IDs stable. | External success before journal settlement is still ambiguous. Its inspected [server license](https://github.com/restatedev/restate/blob/d477c43e1f6d48efbc93eedcc82c5bdfba38c3a5/LICENSE) is BSL 1.1, not an open-source license; no dependency adoption follows. |
| [Zanzibar, 2019](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/), [SpiceDB consistency](https://authzed.com/docs/spicedb/concepts/consistency) | Track policy and data revisions; respect causal ordering of content and access changes. | An equality receipt is not a datastore revision token. A snapshot-consistent permission check cannot atomically bind a later Telegram send. |
| [OpenFGA immutable models](https://openfga.dev/docs/getting-started/immutable-models), [consistency options](https://openfga.dev/blog/query-consistency-options-announcement) | Pin policy semantics and compare policy revisions deliberately. | Policy version, membership freshness and source freshness are distinct. Request-supplied context is not automatically trusted evidence. |
| [Transactional outbox](https://microservices.io/patterns/data/transactional-outbox), [idempotent consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html), [Helland, CIDR 2007](https://www.cidrdb.org/cidr2007/papers/cidr07p15.pdf) | Store intake identity and effect intent alongside application state; reconcile uncertainty. | A relay may deliver twice. Durable intent is not exactly-once observation, and revoked queued disclosures must be cancellable. |

Versioned licensing snapshots reviewed by the research agent: Temporal `fc4372605ce23f333b7e1a43eef303ff002c2ef1` (MIT), Restate `d477c43e1f6d48efbc93eedcc82c5bdfba38c3a5` (BSL 1.1), SpiceDB `e4b276d7046cbba01c0f9e165367456639ccd4b7` (Apache-2.0), OpenFGA `97943bf64d85ac3015272d90ab1145696db9ef5b` (Apache-2.0). These are research references, not installed or performance-verified components. Review the actual selected release and deployment terms before any later adoption.

## Memory and group research beyond Honcho

| Reference | Transfer to the next implementation | Limitation |
|---|---|---|
| [Graphiti v0.30.2](https://github.com/getzep/graphiti/releases/tag/v0.30.2), commit `eaa4128681bc53487138a4bbc22d58336ebe70d2` | Separate event validity from ingestion time; preserve episode support and request-scoped routing. | Do not conflate OSS removal with hosted [Zep deletion](https://help.getzep.com/deleting-data-from-the-graph); shared summaries may not be rebuilt. No general erasure receipt was established. |
| [Hindsight v0.10.2](https://github.com/vectorize-io/hindsight/releases/tag/v0.10.2), commit `5fc4ce20917b916240cef27c212c387a177f115b` | Mark derived observations stale and reconsolidate co-sources after changed document permissions. [Document semantics](https://hindsight.vectorize.io/developer/api/documents) | Its documented [recall limit](https://hindsight.vectorize.io/developer/retrieval) excludes metadata and may return an oversized first result. Apply a separate whole-payload limit. |
| [GroupMemBench v2](https://arxiv.org/html/2605.14498v2) | Preserve asker, speaker, counterparty and reply context; compare a raw-source baseline against derived memory. | Synthetic English workplace data is not multilingual media or permission proof. The [release](https://github.com/UCSB-NLP-Chang/GroupMemBench) mixes filtered and unfiltered domains. |
| [SocialMemBench v1](https://arxiv.org/html/2605.17789v1) | Test who said something about whom; retain individual dissent instead of flattening it into a group norm. | Synthetic groups and attribution-focused evaluation; its departed-member recall target does not override withdrawal or erasure policy. |
| [LongMemEval-V2](https://arxiv.org/abs/2605.12493), [official implementation](https://github.com/xiaowu0162/LongMemEval-V2/) | Evaluate changing state, procedures, environment knowledge and false premises for reuse beyond personal profiles. | Distinguish the original paper from later repository updates. No result from our layer on this benchmark exists. |
| [GroupGPT / MUIR v3](https://arxiv.org/html/2603.01059v3) | Evaluate the decision to remain silent separately from answer generation. | The headline 4.72/5 is an LLM rating, not the human-study score; dataset access is gated and code licensing was not established. No model/data import is proposed. |

Graphiti's inspected release is Apache-2.0 and Hindsight's is MIT. Missing or incomplete code/data licenses in other inspected releases are not permission to copy them. These papers motivate tests; none proves a benefit for our product.

## Next reusable contracts, not implemented by extraction

Implementation planning for source recall is recorded in [the source-preserving group recall plan](GROUP-SOURCE-RECALL-PLAN-20261001.md). Its candidate limits and 48-case comparison are proposals, not implemented or measured recall results.

**Source-preserving selection:** admit rows under server authority before ranking, then retain source/episode/revision, speaker and available reply ancestry. Distinguish speaker identity from inferred subject identity. Measure the entire serialized packet, including metadata. An internal read-set receipt is not an answer citation. Compare recency-only with bounded lexical selection on identical permitted sources before adding learned retrieval or another datastore.

**Durable effect handling:** the next persistence design needs a scoped immutable transport-event ID and payload hash, with conflict detection and explicit `prepared`, `executing`, `confirmed`, `not_executed`, `unknown` and `cancelled` states. A timeout after dispatch is `unknown`, not permission to resend. A fresh lease cannot fence an old in-flight HTTP request unless the downstream service honors that fence. Implement this in the existing storage authority only after its actual SQL proof; the checkpoint module does not provide it.

**Dependency-safe forgetting:** keep source lineage through summaries, projections and assistant paraphrases. Rebuild only from current authorized support. Until that exists, the current group runtime excludes assistant history rather than pretending its old dependencies remain valid.

## Bounded evaluation sequence

1. Verify the repair candidate's real SQL and mounted UI in hosted CI, preserving all failed controls and independent scope tests.
2. Verify the portable checkpoint module in isolation and through actual group dispatch. Test rebinding, failed reads, changes during awaited readers, sticky invalidation and two unrelated adapters. Repeat the configured release checks for the integrated candidate.
3. Preregister 48 invented selection cases: eight families, English/Hindi/code-switching, two cases per cell. Families cover older evidence, speaker/subject distinctions, disagreements, corrections, role-specific wording, dissent, audience changes and revocation/erasure. This comparison is planned, not run.
4. Test effect replay and uncertain outcomes with deterministic fault injection before any real platform trial. No blind retry after ambiguous dispatch.
5. Obtain current transport/provider authority and a bounded budget for an explicitly consented group task. Measure usefulness, unwanted interruptions, correction fidelity, latency and total cost independently of software pass counts.

Reject or simplify any addition that does not improve an agreed task under identical authority and resource budgets. Keep owner approval and deterministic disclosure mandatory. A larger framework, more papers, or a passing synthetic benchmark is not a readiness or superiority claim.

## Verified checkpoint, 1 October

Steps 1 and 2 above have a bounded software receipt for exact code `3e036e7db552b1cc802c2a42451787fc5791d4a1`: [release run 36848366333](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36848366333) passes all 24 configured checks on both Node 22 and 24; [separate PostgreSQL run 36848366256](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36848366256) passes 30 actual-query groups; [APK run 36848366332](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36848366332) succeeds. The release jobs explicitly skip relational gates without `NEON_URL`; the separate SQL proof uses synthetic PostgreSQL 16.15, not the live catalog or Neon transport. Hosted logs include 39 kernel groups, 86 actual group-turn groups and 17 source/22 mounted review groups.

Independent integration review exposed and verified a real mutable-destination defect before this commit: authorization captured one destination while the later send could read a changed event/context/adapter/room. The accepted integration snapshots these inputs before its first await and captures the original default send method with a frozen receiver. Mutation controls exercise the actual caller. Trusted callback internals and the external send race remain outside the kernel's guarantee.

The final SHA-verified 390/1440 claim screenshots show the original Hindi/emoji quotation, a visibly labeled interpretation, explicit coordinate limits and review actions without horizontal clipping. This is a scoped synthetic capture inspection, not complete accessibility or human-usability approval. Compact review action targets need a separately measured UI follow-up. Only the portable checkpoint experiment is completed/pass at automated software-contract scope. Steps 3 through 5, durable effects, source-preserving recall and whole-layer acceptance remain open.
