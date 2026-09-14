# Saved teaching sheet publication review, 2026-09-07

Candidate only, isolated at scratchpad/teacher-sheet-publication from43230e5e. No actual customer publication, database/provider call, binding, consent grant, or deployment was performed by this agent. Intended checkpoint24, independent of release23.

## Contract and implementation

`api/_teacher-sheet-draft.js` adds a read-only publication review using the editor's existing PRIVATE_TEACHER_SHEET_READ_SQL, not an independently selected older bound sheet. Its review key binds authenticated owner, replica, sheet ID, agent, version, canonical saved content and persisted consent-column value. Only ID/version/hash leave this key; the consent identifier is not returned. Existing checkPublishable validation and phrase-bank unverified state remain. The precise consent basis is persisted_sheet_column, never verified active grant.

`api/teacher-sheet.js` GET op=publication_review is read-only. POST op=publish now requires the same review key. It re-reads the saved subject, refuses changed keys with409 teacher_sheet_publication_review_changed and then uses the original exact SQL snapshot CAS. Missing/malformed keys get409 teacher_sheet_publication_review_required. Foreign/missing ownership remains uniform404; DB failure stays500 teacher_sheet_failure. Known matching already-published reviewed requests return readback without repeating a publication UPDATE. No runtime/voice/Room publication predicates were removed.

Both actual TeacherSheetStudio implementations mount the shared TeacherSheetPublication control, using their own namespace's actual API client/error class. The saved body must equal the editor's current body; local edits/save/scope/callback changes invalidate review. Review is an explicit GET. A checkbox plus final Publish teaching sheet button is the only POST caller. Success requires a fresh GET of the same key, published state and timestamp. A malformed/lost application response yields unknown status and an explicit GET recovery action. If a later read selects another snapshot, it does not claim the old operation's outcome; it shows the new review with an unchecked confirmation. No automatic POST retry occurs. Late GET/POST responses cannot repopulate changed or unmounted scopes. In-flight network work cannot be cancelled retroactively.

The publication link goes to exact replica Room setup with locale preserved, and only after matching readback. It does not publish the Room or activate voice. Shared CSS keeps the panel and buttons within390/1440 viewports. Phrase evidence absence is explicitly unverified, as before.

## Still unavailable for ordinary new owners

The actual agent-binding producer remains runtime activation in api/_replica-runtime.js, behind the existing identity/liveness/voice/readiness gates. Saving a pre-runtime private draft deliberately does not invent or backfill an agent binding. No current API writer creates vy_teacher_sheet.consent_artifact_id. Missing sheet binding or persisted publication permission therefore remains waiting on us; editing/private testing stays available. This candidate closes review/publication for genuinely eligible historical rows only, not ordinary end-to-end publication readiness. Private rehearsal success supplies no publication authority. The editor still does not author every required ingested/floor field; validation errors remain visible rather than invented defaults.

## Evidence actually run

2026-09-07:9 source/actual-handler groups passed with synthetic scoped DB functions. They cover missing/unbound/claimed-consent controls, content validation, old latest-bound behavior versus newer private draft, owner/id/version/content/consent changes, final SQL CAS refusal, matching replay without another write, required key validation, actual HTTP dispatch/error states and live-harness prewrite refusal. These are not SQL type or concurrent-lock proof.

2026-09-07:24 actual mounted groups passed at390 and1440 using localhost synthetic responses, both actual editors/API wrappers, exact43230e5e old editor negative (no publication caller), explicit POST/readback, waiting-on-us states, local edits, unreadable response/reload, changed snapshots, Hindi fit, four pending-read scope controls, pending-post scope control and six malformed response controls. Receipt: scratchpad/teacher-sheet-publication-mounted/1788795746030/result.json. No full Studio shell or real auth/SQL/provider is claimed. The390 panel screenshot was visually inspected and fits.

Forced TypeScript build passed before the final type-preserving recovery branch and replay guard additions. The final mounted build transpiled those changes. Full forced typecheck/release remains for root after the current release timing hold. Three changed UI files were scanned directly in memory:0 dash/filler/codename findings under the approved expert-page vocabulary scope. git diff --check passed. Do not interpret the old Windows-inert check-copy CLI as proof.

The first dropped-socket browser fixture observed3 network POST attempts from one application fetch, so it is not evidence of one wire dispatch. The client contains no retry loop. The final deterministic lost-application-response test uses a committed synthetic response with unreadable JSON; it proves no app replay. The reviewed server's already-published path now avoids another publication write on a matching replay. Original failure receipt1788795499379 remains.

The four runtime SQL string exports compare equal to43230e5e after JavaScript's template-literal newline normalization. No SQL mutation in this slice. Runtime publish hash: d6d343cddde7d06b1b1cb0953ee42cebfd679e066d15133a1c39677bc69e6c80. The unreviewed internal helper behavior is retained for incumbent callers/evals; the actual public HTTP publication door always requires review.

## Root-only SQL harness

Import runTeacherSheetPublicationSqlChecks from evals/teacher-sheet-publication/live.mjs. Pass protected db plus {sheet: valid synthetic TeacherSheet, recordFixtures: async durableRecorder}. The recorder is mandatory and must persist the generated IDs before the first fixture write. It refuses any database except vyakti_expert_integration_20260906 and validates the full input before writes. It does not import credentials, run on import, call a provider or call publication APIs.

The harness EXPLAINs the exact owned/private/bound/publish statements, executes the actual reviewed functions with two scoped owners, an eligible synthetic historical legacy row, an existing newer private draft, foreign-owned row, no binding, missing column permission, changed content/version/receipt, and a precisely injected intervening write before the final SQL. The retained unreviewed helper is an explicit old-behavior negative on synthetic rows only. It exercises matching reviewed publication, readback, replay, sheet revocation and terminal replica refusal. Synthetic column markers are fixtures, never real consent grants or serving authorization. The initial bound row is legacy both-null to coexist legally with the one explicit private draft index139; no impossible double-owned-draft fixture is used.

Cleanup deletes only the three manifested sheet IDs, three replica IDs with their generated owners, and two agent IDs. No non-FK rows are produced. Cleanup errors and remaining count are returned alongside failure stage. Await all function completion before ending the protected DB session. Require passed=true, cleanup.remaining=0 and cleanup.errors=[]; do not claim SQL acceptance before root runs it. No parallel-overlap claim is made by this harness.

## Integration and reversal

Import the five frozen minimal-editor production dependencies first (already present in this isolate), then this bounded source slice. Preserve any newer unrelated Studio/teacher API hunks when merging; do not copy this isolate's context wholesale. Frozen release22 fixture-routing changes share this worktree but belong to their separate manifest and must not be bundled twice.

Proposed eval registrations: teacher-sheet-publication -> teacher-sheet-publication/run.mjs; teacher-sheet-publication-ui -> teacher-sheet-publication/mounted.mjs. live.mjs is opt-in only, never an ordinary evaluator.

Reversal: remove the publication UI/caller if exact saved-content binding, owner scope, consent-column refusal, no-auto-retry recovery, or actual SQL controls fail. Retain private editing/rehearsal and existing runtime safety gates. Broader ordinary publication stays unavailable until actual approved binding and publication-consent producers exist and are independently proven; never add synthetic consent to make this candidate green.
