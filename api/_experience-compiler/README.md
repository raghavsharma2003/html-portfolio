# Experience compiler adapter boundary

This directory defines deterministic envelopes and transition guards. It is not a new database or a second source of truth. The envelopes are intended to validate records before an adapter writes the existing Vyakti substrate. This offline foundation makes no database, cloud, model, or network call.

## Existing substrate mapping

| Compiler contract | Existing authority | Adapter rule |
|---|---|---|
| Source commitment | `vy_replica_source`; session-bound call audio also remains linked by `vy_mirror_window.source_id` | Keep the database UUID as the storage identity. Store or recompute the compiler `source_id` and `record_hash` as commitments to that row and its verified bytes. Never create another source table. |
| Transcript, speaker, acoustic and voice-window observations | `vy_replica_processing_evidence` | Map the supported observation kind to the existing `evidence_type`, span, confidence, input SHA, adapter identity and `record_hash`. Put the explicit epistemic status, calibration record, compiler span hash and compiler observation ID inside the existing evidence `value`. The database evidence UUID remains the citation identity. |
| Short-lived expression observation | Request/session memory only until an existing table has an honest expiring shape | Do not disguise expression as a durable claim or another evidence type. It expires within 24 hours, is scoped to one owner/dyad/turn and cannot claim inner emotion. If persistence becomes necessary, extend the existing evidence substrate through a reviewed migration rather than creating a compiler store. |
| Fact, relation or persona candidate | `vy_replica_claim` plus `vy_replica_claim_citation` | Store one proposed claim with `proposal_hash`, owner, domain, key, origin, confidence, validity and existing source UUIDs. Expand every compiler evidence edge into a citation row bound to the existing evidence and source UUIDs. A relation candidate keeps its dyad in the claim body/typed adapter input and may only feed the relational materializer for that dyad. |
| Accept, reject, defer or edit a fact/relation/persona candidate | `vy_replica_claim_decision` | The authenticated owner decision is the durable authority. Deferral is non-terminal. An edit creates a new immutable candidate with an exact `supersedes` edge and the decision binds that replacement; it never mutates the original proposal. The compiler decision hash can live in policy metadata when that existing shape supports it, but cannot replace the row or its owner foreign key. |
| Persona materialization | `vy_replica_profile` | Build a new deterministic profile version only from accepted claims. Use the accepted candidate/evidence set as `source_set_hash`, approve the new version and retire the old version through the existing person-model transaction. Do not write a standalone compiler materialization row. |
| Voice candidate from ordinary enrollment | `vy_replica_processing_evidence` and `vy_replica_processing_evidence_decision`, then the existing VoiceGenome builder | A voice window remains evidence until the owner accepts it and active voice-reference consent is rechecked. More accumulated duration is never a materialization event. |
| Voice candidate from Mirror Call | `vy_mirror_window` candidate fields and `vy_mirror_conditioning` | The window must remain session/source bound, `owner_verified`, scored and reference-admitted. Materialization means one explicit conditioning selection, with the previous selection retained through `superseded_at`. It does not enqueue training and does not expose the call source as ordinary enrollment. |
| Mirror Call persona phrase candidate | `vy_mirror_delta` | `proposed`, `accepted`, `rejected` and `applied_at` already encode review versus materialization. The compiler may validate the source/span hashes and citation before this existing write. It must not introduce a second chip or decision table. |
| Supersession and erasure | Existing claim `superseded_by`, profile version retirement, Mirror conditioning history and existing source/replica cascades | Preserve predecessor IDs and hashes in the adapter receipt. Deletion starts from the existing source/replica graph and must make every derived compiler envelope unreachable with it. |

## Integration constraints

1. The compiler hashes are content commitments, not replacements for database UUIDs, foreign keys, owner predicates or SQL uniqueness.
2. The adapter must load complete prior decisions and materializations before calling a transition guard. Omitting history is a contract violation, not an empty history.
3. Authentication and active consent remain server-side predicates. A client-supplied decision or consent object is never sufficient evidence.
4. Existing evidence types must not be relabelled to force a new modality through an old check. Unsupported observations remain ephemeral or wait for an explicit substrate extension.
5. Materialization uses existing atomic transactions. The offline materialization envelope is a preregistered expected write and audit receipt, not a durable row by itself.
