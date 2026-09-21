# Same-source explicit build-intent recovery

Base: checkpoint20 da3ac2aeac29571ae45a4507d947b1cf603cf9c1. Isolate: scratchpad/primary-intent-recovery, branch codex/primary-intent-recovery. Integration and the12CAS files remain unchanged by this slice.

## Changed/new manifest

- src/studio/CloneExperience.tsx: optional fresh owner snapshot callback; explicit Use this recording action for only primary_selection_snapshot_missing / primary_voice_selection_changed; current/fresh eligibility and consent checks; pending scope/unmount fence; durable fresh UUID before existing saga polling. ResonanceRecorder source is unchanged after normalizing worktree CRLF to Git LF.
- src/studio/StudioApp.tsx: actual callback refreshes authentication and invokes existing readReplica, listSources, listEnrollmentConsent for the selected owner scope. No endpoint/ownership SQL/consent write changes. Selected scope mismatch rejects.
- evals/primary-intent-recovery/host.tsx: actual full component fixture with retained base20 component, synthetic owner/source/consent responses, no provider/media grant.
- evals/primary-intent-recovery/run.mjs: actual caller extraction and full mounted controls. --source-only runs4caller/recorder controls without browser/build.

## Contract and limits

Only an explicit owner tap replaces the old build-intent UUID. Source ID, upload-intent ID and language remain unchanged. Snapshot failure, unavailable callback, revoked source/consent, foreign scope, third-party media or inability to save/read back local storage refuses before any new POST. Old terminal intent and saved upload remain retained. The existing poll submits only after the new saga is stored; uncertain responses and reload reuse the same new UUID. Generic failures keep the existing Record again action.

Both fresh server-read and current rendered source/consent eligibility are required. Authoritative SQL and migration140 CAS still decide current build/selection authority; this UI does not grant identity, speaker ownership, publication or voice readiness. A change after the read remains subject to server checks. Local-storage compare detects an intervening other-tab intent write but localStorage provides no cross-tab atomic transaction/serialization guarantee. No automatic fresh UUID after changed-selection refusal.

## Validation

At12:54:26.776Z all18mounted assertions passed, including actual base20 old-code negative, changed/missing explicit action, generic failure, missing callback, six unavailable-data/read controls, storage refusal, four pending lifecycle controls, changed durable request and ambiguous POST followed by actual page reload. Four actual StudioApp read/caller/recorder preservation controls passed. Retained result: isolate scratchpad/primary-intent-recovery/result.json. Mounted runner ultimately exited0 after slow browser cleanup, without a forced stop. TypeScript and copy exited0. A later --source-only --verify-base-recorder check preserves the optional isolate-only recorder assertion; omit that optional flag after merging the separately authorized recorder lifetime slice. Three actual StudioApp callback controls are always required.

No real account, DB/provider/model/media or full release acceptance. Root actual migration140 SQL proof passed29groups separately, retained primary-selection-sql-1788784961799.json, cleanup0/errors[]. Production still requires draining/versioning old primary writers; this UI does not repair the remaining speaker-ownership or unavailable composite verifier boundaries.

Reversal: change this recovery flow if a reproduced current-scope or uncertain-response schedule submits a new intent without a fresh owner decision, loses saved media/request identity, or bypasses server selection authority. Keep the base20 negative and reload control.

Final focused incumbents:29clone creation saga and20clone experience QA checks passed, plus diff check. Context entries in the isolated context files should be copied selectively, never wholesale. Exact4file hashes are retained in PRIMARY-INTENT-RECOVERY-FREEZE-20260907.json. No further source edits after this freeze.
