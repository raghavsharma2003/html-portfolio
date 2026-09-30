# Local voice migration reconciliation

These11 exact SQL artifacts preserve local066–076 history by SHA256. They are nested so the top-level apply runner cannot discover them automatically. No database was queried or changed during integration. Historical comments inside artifacts are source evidence, not fresh live claims.

Before promotion: identify target database, inspect its applied ledger and exact tables/constraints/indexes; compare both lineages; classify each statement as already-equivalent, missing, or incompatible; allocate fresh migration identities (137/138 were reserved by wave20); generate idempotent reconciliation SQL; mirror schema and erasure/reach tests; EXPLAIN target queries. Preserve original applied identities. Never run all archived files blindly.
