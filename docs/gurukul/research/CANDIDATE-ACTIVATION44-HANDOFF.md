# Exact private candidate selection

Source worktree: `scratchpad/expert-candidate-activation44`, based on materializer41 `a4bf870fd3b8fffa5862081f03c32abba2ffaac5`, with qualification44 `305e2bc539a96b67db76ac8e416c3effc15ee756` integrated. This is an untested source union. Frozen predecessor branches and database receipts remain unchanged.

## Product boundary

The expert completes a sealed blind comparison, explicitly checks the result, and explicitly chooses whether to try the exact candidate in their own private text conversation. A qualified selection requires the existing strict pass. A separately labelled experimental selection requires an inconclusive result with no known failed verdict; it does not convert that result into a pass. Neither path authorizes voice, public replies or Room deployment.

The public baseline remains active throughout. Each private selection, including rollback, creates a fresh capability in `private` state and changes an owner-private pointer. Sessions bind that fresh ID. The previous conversation remains read-only for response and usage reconciliation; sending requires an explicit new conversation. Missing or withdrawn private evidence blocks the private route instead of silently falling back to the public baseline.

## Connected callers

1. `CandidateEvaluationLab` submits owner votes and mounts the qualification status/recovery action. Explicit successful result checks refresh private selection eligibility.
2. `CandidateActivationAction` reads authenticated status, sends only identifiers after an explicit tap, and handles an unknown write outcome through a status read rather than repeating the write.
3. `replica-candidate-activation.js` calls the owned receipt service. Stored artifacts, qualification bindings and SQL predicates are reconstructed on the server; browser-supplied proof is not accepted.
4. The service rerenders the artifact and compares its exact core hash against the materialization and qualification. Migration156 records the private capability, content-free transition, private pointer and immutable selection evidence.
5. Owner dialogue resolves only the selected private capability, verifies the exact model/revision contract, rechecks authority around generation and at persistence, and rejects old-session writes. Global/public runtime resolution remains separate.
6. Explicit rollback rechecks the previous identity and creates another fresh private capability. Paused, revoked or source-invalid targets are not restored.
7. If the global baseline changes, an explicit Use current AI reset targets that currently valid baseline instead of reviving the old target. Its recovery caller accepts no candidate ID, so erased private artifact metadata does not prevent recovery. The old private identity loses authority when the pointer moves; public capability rows remain unchanged.

## Source corrections

Materialization now persists `candidate_core_hash` and checks it at advance claim and package assembly/completion before a resumed baseline item can dispatch under a changed candidate core. Private runtime retains the original artifact label and exact compared core. Provider identity is checked against the compared Azure revision; no actual model dispatch occurred in this slice.

Public clone widget, Telegram and WhatsApp callers carry a current-authority guard to the shared dispatch/delivery seam. It runs before and after generation and before fragments/reactions. It cannot recall a fragment already sent and does not claim atomic cancellation of an external provider request.

The first design superseded the global active capability. Independent review found that this would interrupt public service during a private trial. Root rejected that design before execution. The source now uses the separate private pointer.

## Validation still required

No activation44 tests, browser runs, TypeScript checks, actual SQL or provider calls have run while root FULL45 owns the resource lane. Authored fixture tests are not SQL, live authentication or quality evidence.

Integration must merge the private-continuity and dialogue changes with root45/153 work rather than replacing newer files with this older-base worktree. The qualification305 union is included here, but later independent corrections and Azure correction revision work remain root-owned integrations.

Known recovery limit: if prior history is erased while a reply or measured usage is still unresolved, this UI preserves that pending state. It never calls unknown spend settled. A content-free trusted usage reconciliation path needs review of the existing budget ledger and cron before any new storage is proposed. Reset without known pending work can open a fresh private conversation after a confirmed runtime change and exact prior-session authorization failure; general network, authentication or malformed-response errors do not grant that recovery.

Queued checks: activation service; exact runtime/model controls; real caller refusal and public in-flight fences; private continuity/history; qualification service and owner-vote recovery; materializer resume; mounted qualification/selection/conversation at 390 and 1440; semantic TypeScript; copy and context graph; then the required integrated release gate.

Actual migration156 proof must cover exact catalog and mirrored erasure, application SQL parameters, private selection and rollback, source withdrawal, stale qualification and model/core identity, cross-owner/public/voice refusal, unchanged global baseline, old-session rejection, and concurrent pointer CAS. A losing CAS must not leave an unaudited private capability. The source now invokes a schema-qualified result assertion through a materialized final CTE: zero writes return no result, exactly one of each write returns the capability, and a partial write raises 40001 to roll back the entire statement. Only the known assertion becomes a 409 review-latest error; neither the one-fetch database wrapper, service nor UI retries a mutation automatically. Actual atomic rollback and concurrent loser absence remain unproved. No production or fidelity claim is appropriate until these checks and actual serving evidence exist.
