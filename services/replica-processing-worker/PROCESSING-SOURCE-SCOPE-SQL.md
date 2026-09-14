# Processing source scope SQL inventory

This canary-only scope is read from `REPLICA_PROCESSING_SOURCE_SCOPE_JSON` and
requires the complete reviewed object: `owner_user_id`, `replica_id`, and
`source_id`.

| Operation | Source predicate |
| --- | --- |
| Processing lease | `j.owner_user_id=$4::uuid and j.replica_id=$5::uuid and j.source_id=$6::uuid` |
| Capability recovery requeue | `owner_user_id=$4::uuid and replica_id=$5::uuid and source_id=$6::uuid` |
| Build intent reconciliation | `i.owner_user_id=$2::uuid and i.replica_id=$3::uuid and i.candidate_source_id=$4::uuid` |
| Voice-genome build lease | `scoped_intent.owner_user_id=$4::uuid`, `scoped_intent.replica_id=$5::uuid`, and `scoped_intent.candidate_source_id=$6::uuid` |
| Self-test genome recovery | Skipped: it has no per-source API and would alter replica-wide evidence, consent, and primary selection. |

The absent scope binds `NULL` only to retain the existing ordinary worker path.
