# Issued authority SQL acceptance preparation, 2026-09-08

The production source remains frozen at `3462b1f6575731c18379088d79cd5e919a45cc87`. This follow-up adds an executable acceptance function and offline guards. No database statement, migration, provider, storage operation, real enrollment or identity acceptance has been executed by this agent.

From this worktree, the safe default commands are:

```sh
node evals/modern-issued-authority/live.mjs
node evals/modern-issued-authority/live-guards.mjs
```

The first prints only preparation metadata for eight actual SQL shapes. The second ran ten offline controls with injected database callbacks and network disabled. These controls prove refusal/cleanup control flow and fixture construction, not PostgreSQL syntax, constraints, locks or live acceptance.

## Root-owned execution contract

Import `runModernIssuedAuthoritySqlChecks` from `evals/modern-issued-authority/live.mjs`. It requires `{db, openSession, onFixtureManifest, expectedSourceSha256, allowSyntheticSql:true}`. `db(sql, params)` returns a row array. `openSession()` returns an independent connection with `query(sql, params)` returning rows and `close()`. `onFixtureManifest(manifest)` must atomically persist the complete declaration before returning; it runs before any seed and again before newly allocated production challenge/grant IDs can be inserted. The helper reads no credentials and has no default database connection.

The protected launcher must pin the reviewed worktree commit, the follow-up files, and the complete local dependency closure. The runner additionally verifies its 17 required source hashes before calling any DB function; this is a minimum guard, not a claim that 17 files comprise the entire import closure. Pass the reviewed manifest's exact hashes, never freshly computed values from unreviewed source. Default CLI invocation does not opt into SQL.

Every connection must name exactly `vyakti_expert_integration_20260906`. Migration 144 must already have been separately reviewed and applied by root; the runner checks the bigint column and never applies SQL migrations. Each transaction sets statement timeout 10 seconds, lock timeout 7 seconds and idle transaction timeout 60 seconds. Query planning uses `EXPLAIN` without `ANALYZE` in a read-only transaction, with an actual invalid-column `42703` negative under a savepoint.

## Declared mutation and cleanup scope

Three freshly generated synthetic owner/replica/person fixtures are declared before all absence checks. Each declares three sources, capture/storage and transaction-local review consent IDs, one synthetic identity case, one reference selection, an enhanced artifact, four evidence IDs, prior decisions and processing job IDs. The actual production issuer allocates challenge/grant IDs; the wrapper stops immediately before its INSERT, durably adds both IDs to the manifest and proves global absence, then the runner may execute that exact captured statement. No real auth accounts, storage objects, raw media or cloud work are involved.

The synthetic identity/Face/lease/intake rows are explicitly test prerequisites, including fake scores. They are never passed off as provider verification, never make product readiness available and never become owner evidence. Ordinary artifact review prerequisites are created only inside a rollback transaction. Existing product consent predicates are exercised unchanged.

Cleanup is attempted only for fixtures whose seed started. It deletes the exact declared replica with matching owner, then its exact synthetic person, and requires zero rows across 16 scoped table counts: replica, source, consent, identity case, voice reference, processing job/attempt/artifact/evidence, artifact/evidence decisions, liveness challenge, biometric grant, liveness attempt, audit and person. Partial seed failure triggers only that started fixture's cleanup. Cleanup failure is retained independently from the original test failure. The manifest survives for root recovery; the helper has no global sweep or unscoped deletion.

## Prepared acceptance and boundaries

The runner prepares eight actual production query EXPLAINs; first issue; same-preview replay refusal; conflicting challenge/grant insertion rollback with unchanged old grants/challenge/source/epoch; valid replacement; real unique-primary constraint; valid server authority load; review no-op/nonreference/batch/artifact epoch controls; six changed capture/lease/identity dimensions; grant revocation and expiry; source NOWAIT and review advisory contention; and three witnessed old-snapshot schedules.

Each old-snapshot schedule waits before source locks using the narrow test barrier over the actual query, witnesses `pg_blocking_pids` naming the holder, and verifies the exact blocked SQL hash. The holder then performs the actual writer and commits. Expected cases are repaired review mutation returning no authority, retained no-epoch mutation exposing stale authority, and overlapping same-prestate issuers producing one grant and one epoch advance. Unexpected SQL errors or an absent witness fail acceptance. Raw exception messages are not emitted; the report retains stage, safe error code, assertion, query hashes and cleanup results.

Correction to the earlier frozen plan: the retained no-epoch negative cannot use a rolled-back writer to demonstrate committed MVCC visibility. This runner commits the mutated writer only in its separately declared synthetic fixture, then removes the whole fixture with exact cleanup. Constraint-failure and ordinary review controls still roll back. This distinction must appear in any live receipt.

This finite runner does not cover every proposed matrix item in the production handoff: actual consent/source withdrawal callers, native account erasure, every lease dimension, first-owner private selection/preparation and a calibrated complete composite producer remain separate work. Passing this runner must not be reported as native capture completion, likeness acceptance, a working first-owner route or activation of readiness.

## Decision, measurement and rejection

Decision: prepare real SQL acceptance around actual exported query/caller shapes with injected connections, exact source pins and predeclared isolated fixtures. Reverse this approach if root review or PostgreSQL execution shows an unsafe cleanup scope, an unobserved schedule or stale authority acceptance under the repaired writer.

Measurement: on 2026-09-08, ten offline guard groups passed once after the final guard repair; eight SQL shapes were prepared. Method: real runner and fixture constructors with recording/refusing callbacks, zero network or database connections. No SQL success count is claimed.

Rejection: rollback-only mutation cannot prove the stale committed-snapshot negative. The finite negative instead requires a committed synthetic mutation and exact cleanup. Also rejected: treating offline mocks as parser proof, automatically applying migration 144, computing trusted pins from whatever source happens to be present, and presenting synthetic identity prerequisites as enrollment evidence.

## Reviewed harness correction

Independent source review found that PostgreSQL may truncate `pg_stat_activity.query`, and that a holder cleanup error could skip reader cleanup. The follow-up now submits a unique leading test comment, requires the dedicated reader PID's actual blocker and an exact visible prefix including that marker, checks server activity capacity for the marker, and explicitly reports truncation. Original, barrier-instrumented and fully submitted query hashes remain separately retained; none is misrepresented as a fully observed server query when truncated. No global database setting changes are needed. Nested cleanup attempts holder rollback/close, pending completion and reader rollback/close, preserving each failure. Twelve offline groups now pass, including a 1,023-byte observed-prefix control and simultaneous holder rollback/close failures. The independent reviewer cleared these changes by source inspection only. No real SQL was run.

## Next first-owner work

For an already completed source with real compatible provenance, a purpose-limited private comparison selection receipt can be the next bounded slice without launching another processing job. It needs an actual audition/confirmation caller, separate explicit comparison use permission, exact current source/artifact/evidence and receipt bindings, epoch invalidation and erasure. It must replace only modern authority's dependence on ordinary artifact/evidence selection; existing voice genome, training and public voice gates remain intact. If the required compatible evidence is absent, the UI must return that named platform prerequisite. A real preparation job/worker is then required as a subsequent connected slice; existing stored historical evidence must not acquire invented model revisions.
