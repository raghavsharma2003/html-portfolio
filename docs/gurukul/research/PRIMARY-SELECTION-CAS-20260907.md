# Candidate promotion primary-selection CAS

Frozen isolated branch `codex/candidate-primary-cas`, directory `scratchpad/candidate-primary-cas`, base `68283658955ca97eb057b201c8b35bae90ca702a`. No integration edits. Exact12-file hashes in `PRIMARY-SELECTION-CAS-FREEZE-20260907.json`, frozen2026-09-07T12:24:34.671Z.

## Decision and boundary

An owner can stage candidateB while primaryA remains selected, then explicitly chooseC beforeB's build finishes. The old `promoteCandidate` unconditionally overwrites the primary withB. A source ID or timestamp alone cannot distinguish explicit same-source reselection, and a row-only reference token disappears when there is no primary.

Migration140 adds `vy_replica.primary_selection_id uuid NOT NULL DEFAULT gen_random_uuid()` and nullable `vy_replica_voice_build_intent.expected_primary_selection_id`. The persistent replica UUID is an epoch, including when no primary exists. Existing intents remainNULL; neither replay nor migration infers a historical expectation. No timestamp columns, new tables, consent grants, identity receipts or runtime flags.

Actual setter, newly inserted intent capture, candidate promotion, explicit source withdrawal and physical source completion participate. Promotion checks the latest locked replica epoch and locks the current intent before evaluating queued/superseded state. Setter and promotion rotate on every selection, including same-source selection. Withdrawal/completion rotate when they actually remove the primary pointer. Source and replica locks useNOWAIT; the proposed execution order is source, replica, then current intent for promotion. Offline SQL text does not prove execution order. The live harness includes both-lock-held controls that require the first PostgreSQL refusal to name the source relation.

Source withdrawal had three competing updates to the same replica row. It now has one conditional update preserving age-vs-liveness invalidation and enrollment lifecycle behavior, with epoch rotation in that update. Physical completion similarly combines identity invalidation with pointer withdrawal. A materialized statement-snapshot epoch is compared to the subsequently locked replica epoch before either erasure statement mutates anything; mismatch returns the same named retryable busy state. This avoids claiming thatNOWAIT alone refreshes unrelated-table snapshots.

Named outcomes: `primary_voice_selection_busy` is retryable409 and preserves queued state; `primary_selection_snapshot_missing` is a terminal historical-intent failure requiring a newly issued intent; `primary_voice_selection_changed` is the terminal stale-promotion result after a fresh read. Existing candidate readiness, owner predicates, review/queue authority, supersession and other failure reasons remain.

Reversal: replace this mechanism only with a smaller contract that passes the actual same-source, absent-ABA, overlap, erasure and owner controls while retaining exactly-once intent expectation. Do not restore the unconditional promotion merely because it avoids a retry.

## Exact file manifest

Changed: `api/_replica-build-intent.js`, `api/_replica-source.js`, `api/_replica-source-erasure.js`, `db/schema.sql`, `evals/clone-creation-saga/run.mjs`, `evals/source-erasure/run.mjs`.

New: `api/_replica-primary-selection.js`, `db/migrations/140_primary_voice_selection_epoch.sql`, `evals/primary-selection-cas/capture.mjs`, `evals/primary-selection-cas/run.mjs`, `evals/primary-selection-cas/live.mjs`, `evals/primary-selection-cas/fixtures/old-promotion.json`.

Migration140 was absent from integration and original refs; filesystem scan finds only this new isolate's140. Existing DB function `gen_random_uuid()` is already used throughout the schema. Exactly two idempotent statements, mirrored in canonical schema. Parent alone applies them to the exact development DB. Both fields belong to existing owner-erased rows; no new owner-lane table or separate erasure reach is introduced.

## Measurement and retained failures

2026-09-07, isolated source, no network/model/DB calls:14focused CAS groups,29incumbent saga groups,17primary-source groups,59source-erasure groups passed. Syntax checks on the four API files and live harness, copy gate anddiff check passed. The saga fixture now supplies a captured epoch; the erasure source assertion checks each conditional identity invalidation and conditional person return instead of the former literal unconditional assignment. No build/browser/full release performed in this slice.

The first erasure run stopped at its literal old assignment assertion; it was updated to assert the replacement conditional semantics, then all59passed. A briefly explored canonical context extension imported the wider context graph and encountered absent config exports during offline checks; no provider ran. That extension and its capture import were removed before the final14-group rerun. Config was never copied.

Correction: the generic `createStoredContextSource` accepts input.kind, but its actual `contextSourceKind` producer returns image/chat_archive/document/text and routes audio elsewhere. Thus selectable audio/video in the canonical context lane was not established. `_context-locker.js` is byte-for-byte back to base. Its existing producer wait/tombstone semantics remain unchanged. Do not describe this repair as proving every source lifecycle transition; source-deleting voice eligibility is a separate boundary.

## Parent-only actual SQL harness

Import `evals/primary-selection-cas/live.mjs`; call `runPrimarySelectionSqlProof({db,connect,recordFixtureIds,optIn:true})`. `db(sql,params)` returns rows. `connect()` returns a dedicated PostgreSQL session `{db(sql,params),close()}`. Every connection checks `current_database()` equals `vyakti_expert_integration_20260906`; dedicated sessions set8second statement and5second lock limits. The harness does not apply migration140.

`recordFixtureIds` must durably store the complete manifest before its first write. The16cases contain generated owner/replica/source/intent/build/identity/challenge IDs. The final result includes the manifest and content-free checks/errors. It executesEXPLAIN for five captured actual caller statements plus the exact base promotion retained with SHA256. Initial synthetic rows are fixture-only draft/build/identity states, never an actual enrollment, consent or serving authorization. There are no media objects, storage/provider/model calls or publication operations.

Checks include unchanged and absent success; newer manual selection; same-source reselection with selected_at forced equal; absent→select→withdraw ABA; explicit withdrawal; direct physical completion; legacy/replay/foreign owner; identity/liveness/both invalidation; and counterparts for setter/create/promote/withdraw/complete. Old overlap starts the exact old statement against an uncommitted setter, requires `pg_blocking_pids` to witness the exact blocking backend, then commits and expects the stale overwrite. The repaired overlap must refuseNOWAIT and then fail a fresh retry without overwritingC. Separate controls hold both source and replica to witness actual first-lock refusal. Cleanup rolls back/closes sessions and deletes only manifested fixtures, including non-FK audit/erasure-attempt rows, then counts all involved owner/model/reference tables.

No actual SQL result exists yet in this handoff. The old-query overwrite is not claimed reproduced until parent executes this harness. Root should also review the exact changed erasure statement and preserve earlier teacher-sheet/tombstone proofs separately. The stale-snapshot guard has offline negative controls; no deterministic induced late-commit snapshot schedule is claimed.

## Remaining blockers

This prevents an asynchronous candidate from replacing a newer primary selection. It does not bind the primary recording's actual speaker to a modern verified identity receipt, solve enrollment continuity, implement the unavailable composite identity operation, validate model quality, or activate Azure/voice serving. The prior ownership-binding audit remains applicable. Schema application and actual development SQL proof remain acceptance prerequisites; integration belongs to separate checkpoint21 after root review.

Read-only follow-up2026-09-07: `CloneExperience.tsx:832-854` polls the persisted saga buildIntentId and stops scheduling onfailed, but retains the saga, so remount reissues the same terminal ID once. The failed UI at1120 offers onlyRecord again→`replaceRecording`:1056, which clears saga and next `submitRecording`:927 generates new upload/build UUIDs. No same-recording reissue exists. Product acceptance therefore also needs an explicit action for exactly snapshot_missing/selection_changed: preserve source/upload ID, obtain a fresh owner decision, generate and persist one new buildIntentId before dispatch, use ordinary request/poll/retry and retain scope/generation guards. Never automatically reissue a changed-selection failure or require unnecessary reupload. Parent assigned this as a subsequent change from checkpoint20's newbase, preserving its recorder fixes.

Rollout limitation: old still-serving setter/promotion/withdrawal/completion code does not rotate the new epoch. A migration alone is insufficient; drain or version all old writer instances/jobs before claiming protection. The development harness assumes all five tested counterparts use this new slice. Mixed-version deployment has not been proved safe.

## First actual SQL result and harness-only diagnostic revision

Root ran the exact development harness at2026-09-07T12:30:17.183Z. Migration140 is applied to the exact development database. Eleven groups passed: both columns, five actual callerEXPLAINs plus old queryEXPLAIN, fixtures, unchanged/manual/same-time/absent/absentABA/withdrawal/directcompletion and old nonoverlap overwrite. The old overlap witness failed; no successful overlap or complete source/caller proof is claimed. Cleanup counted0fixture rows but recorded a client connection error. Receipt `primary-selection-sql-1788784133006.json` retains the failure.

The original harness recorded backendPIDs beforeBEGIN, never began a promoter transaction, discarded its pending query error, and could continue80network polls after that operation had already failed. Transaction pooling can change the backend after a pre-BEGIN PID read; actual PID drift was not observed in the first result because it was not recorded. Do not label that hypothesis a measured cause.

Root authorized only `evals/primary-selection-cas/live.mjs` to change. Revised at12:34:27.193Z, SHA256`d09310270cc4f19facaaff95a8eddaf1d74fa339df0911471a1468f10f82f3af`; all other11file hashes rechecked unchanged. Both sessions nowBEGIN before PIDcapture. The artifact records before/in-transactionPIDs, exact target eligibility, pending outcome/code/elapsed, and content-free pg_stat_activity states/waits/blockers. Observation is bounded to6reads and a3.5second loop budget and stops on pending completion. Success still requires an actual exact blocking-backend witness. No timeout values changed. Rollback failure no longer skips session.close. Syntax check passed; root rerun remains required.

## Completed bounded development SQL proof

Root rerun at2026-09-07T12:44:12.142Z passed29groups; retained `primary-selection-sql-1788784961799.json`, cleanupremaining0/errors[]. The earlier failed result remains retained. This run executed the exact captured five product statements, old promotion negative control, old blocked-witness then stale overwrite, repaired NOWAIT plus fresh retry, legacy/replay/foreign ownership, identity/liveness invalidation and all10counterpart lock controls. No product SQL changed between runs.

Actual diagnostic now records PID drift: before transactions both logical sessions reported5327; old-overlap pinned transactions were setter5327/promoter5415, and new-overlap setter5415/promoter5327. Old overlap observed the exact blocking witness at493ms and completed stale overwrite at741ms after release. This establishes the old harness's pre-transaction PID method was unsound on this connection path; the first run did not retain enough evidence to assign its exact failure cause retrospectively. No timeout increases were needed.

Schema/SQL prerequisites now have bounded development evidence. Same-source explicit UI reissue and coordinated writer rollout remain separate acceptance requirements. Modern speaker ownership, consent/identity continuity and voice quality remain unproved. This slice does not cover the unchanged canonical context removal path.
