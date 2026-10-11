# Fresh voice enrollment dependency audit

Read-only Astra source audit, 7 September 2026, frozen integration f22bc6e0.
Retained outside integration while release11 runs. Add decision/measurement/rejection
and graph entries after the frozen release finishes, before implementation.

The ordinary fresh voice-challenge path is structurally circular. Processing can
create evidence, but no ordinary pre-identity comparison-reference caller exists.

| Stage | Source in integration | Finding |
|---|---|---|
| Upload processing | api/_replica-source.js:415; api/_replica-processing/queue.js:27 | Can queue/lease enrollment processing without existing identity fields. |
| Ready evidence | api/_replica-processing/repository.js:225 | Marks source ready after voice_quality, but does not insert a genome. |
| Select candidate | api/_replica-review.js:337 | Enhanced artifact selection requires existing liveness and current identity expiry. |
| Queue genome | api/_replica-review.js:115,476; api/_replica-build-intent.js:317 | Current age, identity and liveness are prerequisites; missing fields leave intent waiting. |
| Build draft | api/_replica-model-build.js:53,149,206 | Lease and completion require identity; sole genome INSERT found under api creates draft. |
| Issue voice challenge | api/_replica-voice-identity.js:455 | Requires existing latest draft/approved genome. |
| Actual callers | services/replica-processing-worker/run-once.js:132,183; api/replica-model-build-sweep.js:21 | Call the same guarded sweep. Scheduling cannot solve this dependency. |

This is a draft-creation block, not just synthesis approval. Draft preview retains
identity gates (api/_replica-voice-preview.js:276,295). Voice enrollment requires
approved genome (api/_replica-voice-profile.js:108), and runtime has approval and
identity predicates (api/_replica-runtime.js:55).

An independent document-plus-face route exists in source: replica-identity.js:35,
_replica-identity.js:301-337, _replica-liveness.js:92-137 and
_replica-liveness-verification.js:332-395. Its sweep registry callers exist. This
audit established no current configuration, deployment or successful operation.
REPLICA_SELF_TEST_MODE is excluded as a fresh product path.

Next decision: either establish the independent document/face route or implement
a deliberately separate pre-identity comparison-reference workflow that grants
no synthesis/training authority. Do not simply remove identity predicates from
ordinary genome building. Connecting the new speech component alone cannot close
this gap. Reversal condition: a verified ordinary caller already supplies an
appropriately bounded pre-identity reference, or a measured alternative provides
equivalent ownership/consent/source/revocation boundaries.

Evidence: one source audit, no execution, SQL, cloud change, recordings or identity
acceptance. The code flow is a source finding, not a new live user-journey result.
