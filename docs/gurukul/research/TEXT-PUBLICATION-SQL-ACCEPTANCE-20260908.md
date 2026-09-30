# Real text publication database acceptance

All execution targeted `vyakti_expert_integration_20260906`. No production database, real person, model, voice or storage call was part of these SQL fixtures.

| Scope | Evidence | Cleanup |
|---|---|---|
| Migration 143 | Eight reviewed DDL statements executed individually; four tables confirmed | Additive development schema retained |
| Sequential lifecycle | 17 exact EXPLAIN statements and 18 checks passed | Five fixture scopes, zero private rows; 11 retired IDs retained |
| Revocation and replay concurrency | 13 checks and 13 actual PostgreSQL blocking witnesses passed | Fourteen fixture scopes, zero private rows; 27 retired IDs retained |
| Quotas and exclusive claims | Five checks and five actual blocking witnesses passed | Five fixture scopes, zero private rows; 11 retired IDs retained |

The runs exercised actual store statements and distinct pinned PostgreSQL sessions. Unexpected SQL errors failed acceptance. Retired publication/request IDs contain no owner, visitor or content and intentionally survive cleanup to prevent reuse.

Root receipts under `scratchpad/expert-tools`:

- `text-publication-sql-sequential-1788812645502-result.json`
- `text-publication-sql-races-1788813428653-result.json`
- `text-publication-sql-quota-1788813801408-result.json`

An earlier race run failed to observe overlap because its timer included multiple setup queries. The corrected tests wait for the exact target SQL dispatch before starting the blocking observation window. The failed original receipt is retained.

The two successful concurrency receipts were written before the launcher attempted to close already-closed clients, producing an unsettled-await shutdown warning and nonzero process exit. The launcher now closes each client once. A separate actual connection close check exited zero after repeated calls. The SQL result and cleanup evidence do not depend on relabeling those earlier command exits.

This does not prove native authentication/upload flow, model answer quality, global expiry scheduling, deployment readiness or owner voice likeness. The global expiry SQL was parsed but not executed over unrelated development rows. Those remain separate acceptance requirements.
