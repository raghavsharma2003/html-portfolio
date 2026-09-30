# Modern issued authority 30, prepared on 2026-09-08

This is an isolated backend prerequisite based on `f4235c68`. It implements persisted issuance and server authority reload, but does not establish usable first-owner enrollment or identity verification. No SQL, provider/model call, deployment, browser or GPU operation ran in this slice. The current capture readiness remains exactly `ready:false`, `waiting_on:'us'`, `code:'liveness_verifier_unavailable'`.

## Actual caller and storage changes

`api/replica-liveness.js` now calls `issueOwnedModernChallenge` behind the unchanged modern readiness guard. Its authenticated `capture_readiness` operation calls `getOwnedModernComparisonDescriptor`. `api/_liveness/registry.js` supplies `createModernCaptureAuthorityLoader({db})` to the shared-audio composer when the actual liveness sweep passes `{db:q}`. The composer reloads authority before private reads/derivation and after derivation/STT; the wrapper still refuses incomplete composite evidence and cannot create a passed verdict.

The existing `vy_replica_biometric_verification_grant` receipt stores the exact modern contract, independent persisted contract hash, explicit five biometric attestations, three selected-reference comparison attestations, comparison receipt hash, and immutable reference record/decision pins. It stores no reference vectors, captured media, transcript or scores. Existing challenge/grant ownership foreign keys and cascade paths remain in use. Original legacy issuer, challenge settlement, official Face provider transport and safety thresholds remain unchanged.

New proposed migration `144_modern_reference_authority_epoch.sql` adds only `vy_replica.reference_authority_epoch bigint not null default 0`, mirrored at the end of `db/schema.sql`. Top-level inventory ended at 143 before allocation; no migration was applied. Existing owner-lane erasure reaches the replica column automatically and the existing grant cascade. Source erasure deletes original processing evidence, which the loader must reread; source/consent withdrawal also invalidates the authority tuple. Consent receipts retain only the same class of audit identifiers/hashes already retained by this grant table, never copied embeddings.

Successful reference-relevant artifact/evidence decisions and successful issuance advance the new epoch. Actual `selectOwnedVoiceArtifact`, `decideOwnedEvidence`, and `acceptAllOwnedEvidenceForSelfTest` SQL callers were changed. Single/batch evidence advances only when a written row is `voice_embedding` or `voice_measurement`; artifact selection advances only after a successful selection. Refused/no-op writes do not advance it. Their lock order is source, replica, review advisory. Existing self-test behavior is not newly authorized by this change.

`private_text_epoch` remains a read-only binding here for account/source revocation. It is never incremented by these new voice changes. Reusing it for voice review was rejected: `_text-publication-store.js` compares it during completed request readback, so voice review would otherwise withdraw existing public text answers. `xmin` was also rejected as a new semantic authority field.

## Frontend wire, coordinated with comparison-ui30

The existing authenticated readiness response adds:

```ts
comparison: null | {
  statement_set: 'selected-voice-comparison/v1';
  primary_source_id: string; primary_selection_id: string;
  source_sha256: string; comparison_snapshot_sha256: string;
  source_label: null; source_created_at: string;
  locales: ['en-IN', 'hi-IN']; available: true; code: '';
};
comparison_code: '' | 'selected_reference_not_available';
```

`available` means an owned primary-source descriptor exists, not that verification or issuance is ready. The descriptor is scoped to the current self replica, nonwithdrawn ready primary, and current capture/storage receipts. Its opaque commitment binds owner, replica, source, SHA, primary-selection epoch, exact capture/storage receipt IDs, account epoch and comparison-authority epoch. Receipt IDs and private evidence values are not returned. Primary uniqueness is an existing database constraint: migration 066 defines `vy_replica_voice_reference.replica_id` as its primary key and `source_id` as unique. A multiple-row descriptor result also refuses explicitly.

The `issue` body adds to existing `replica_id` and five `attestations`:

```ts
locale: 'en-IN' | 'hi-IN';
expected_primary_source_id: string;
expected_primary_selection_id: string;
expected_primary_source_sha256: string;
expected_comparison_snapshot_sha256: string;
comparison_attestations: {
  selected_reference_is_my_voice: true;
  compare_this_capture_to_selected_reference: true;
  comparison_is_private_verification_only: true;
};
```

The server constructs owner/person/identity/consent/evidence authority itself. There is no request-body embedding or identity score. It chooses a registered sentence and six random digits, and issues a contract for at most ten minutes. Old grants are never converted into the new comparison consent. The companion frontend isolate owns the real typed producer and explicit initially unchecked choices; this backend does not claim its mounted tests as its own.

Repeated identical input consumes a preview at most once, rather than returning the same response. Successful issuance binds the post-increment comparison epoch in the receipt and leaves the pre-issue preview commitment in the comparison receipt. A retry with the same preview refuses. An uncertain response is recovered with authenticated challenge status, not an automatic new issuance. This also covers browser transport retries below a single JavaScript `fetch`.

## Why the race design changed

NOWAIT and `pg_try_advisory_xact_lock` alone are insufficient under READ COMMITTED. A writer can commit after the reader's statement snapshot but before its lock acquisition. Artifact/evidence review originally appended decisions without changing any replica authority row, so a successful late try-lock could still read an old acceptance. Issuance also needed a durable row change to consume the pre-state even if a newly inserted challenge was invisible in another statement's snapshot.

The dedicated comparison epoch now changes in the same transaction as those writes. Authority snapshots/issue/load include this epoch; the locked replica row can expose the new value through PostgreSQL EvalPlanQual, making the expected tuple unequal. Review writers themselves compare snapshot account/comparison epochs while locking the replica. This is the design to prove with actual SQL, not a claim that mocks prove PostgreSQL behavior.

The existing partial unique `vy_replica_challenge_live_ix` allows only one issued/uploaded/verifying challenge per replica. An insert-before-expire replacement was therefore rejected. Final issuance first establishes all eligibility and the expected binding under locks, expires old issued rows/grants, then inserts the new row/grant in the SAME SQL statement with explicit CTE dependencies. It does not swallow insertion conflicts. A failed insert/grant constraint aborts the statement and restores old challenge, grant and epoch. A failed eligibility predicate performs no expiry. An active official Face session or uploaded/verifying challenge refuses replacement.

## Prepared SQL proof, not executed

`evals/modern-issued-authority/sql-cases.mjs` records eight query shapes through their actual exported callers: descriptor, authority snapshot, issue, receipt, authority load, artifact review, evidence review, and batch review. `node evals/modern-issued-authority/sql-cases.mjs` is offline and prints hashes/counts only. It imports no database/network client. `prepareModernAuthoritySqlCases()` returns synthetic fixture bindings and exact parameters for root's protected runner. The proposed migration must be reviewed/applied to the isolated dev schema before parsing code that names its new column.

Required actual proof must use exact database name `vyakti_expert_integration_20260906`, predeclared synthetic IDs with absence checks, full source/query hashes, bounded statement/lock/idle timeouts, and exact seeded-scope cleanup. Retain original source hashes, errors and rollback receipts. Never treat a deadlock, timeout, uncertain SQL exception or zero checks as authority success. Root owns all database approval and execution.

1. Parse all eight actual shapes with EXPLAIN, not ANALYZE; retain a 42703 invalid-column negative. Verify migration 144 is one idempotent statement and inspect actual catalog definition of primary-source uniqueness. A duplicate primary insertion for a declared synthetic replica must produce 23505 and roll back.
2. Issue from a valid reviewed synthetic tuple. Recount one live challenge, one new grant, exactly one epoch advance, stored receipt hash and post-state. Reload with the exact verification lease and signed-intake fixture rows. No media/provider execution is part of this SQL proof.
3. Replace an existing issued challenge. Successful replacement expires the exact old grant and advances once. Reuse a predeclared existing challenge UUID, then a conflicting grant UUID, under SAVEPOINT: expected constraint error rolls back the whole statement, and old challenge/grant/source/epoch remain byte-for-byte unchanged. Missing reference/identity/consent/daily allowance also leaves them unchanged without a write.
4. Launch two issuers with the same captured pre-state on separate sessions. Hold the first after its actual SQL mutation and witness the second's source lock/NOWAIT refusal. Also use the old-snapshot barrier below, commit the first before releasing the second, and require the second to return zero eligible rows. One grant and one epoch advance only. Sequential replay of the same preview also refuses without mutation.
5. Hold the exact source row on another session: snapshot/issue/load refuse 55P03 as `authority_busy`; after rollback a fresh valid operation succeeds. Hold the actual review advisory key: authority has no usable row and writes nothing. Record the holder backend PID and lock key; do not infer contention merely from elapsed time.
6. Use `addSnapshotBarrier(actualQuery)` to establish a READ COMMITTED snapshot while the reader waits on a separate test advisory key BEFORE source/replica locks. Require `pg_blocking_pids` to name the holder and preserve both original/instrumented SQL hashes. Commit an actual evidence rejection/artifact selection, release the barrier, and require issue/load refusal. The helper changes only the test barrier, not the authority predicates. `withoutReferenceEpochAdvance(actualWriterSql)` retains the vulnerable no-advance semantics for a rolled-back synthetic negative: an old acceptance must become observable in the vulnerable case and refused with the actual writer.
7. Check successful reference review increments once; rejected/foreign/busy writes and an already-decided empty batch do not increment. A nonreference speaker-segment decision does not increment. The batch advances once for any positive number of newly written reference rows. Check actual published-text answer epoch/readback is unchanged by voice review.
8. Change each lease dimension in a separate valid case: owner/replica/challenge, source ID/hash/size/MIME/private locator, identity source ID/hash/size/MIME/private locator, attempt/token/lease expiry/verifier version, Face model/digest/score/reference/deletion proof, primary selection, accepted decision ID, record hash, exact receipt IDs, grant state, contract expiry and reference epoch. Refuse before reference return. Verify raw source integrity/malware attempt receipts remain required.
9. Commit actual consent revoke, source withdrawal, review rejection and expiry before load, including the snapshot-before-lock schedule where applicable. Refuse authority; the composer must make zero subsequent private/provider calls. Complete actual source erasure and owner erasure; recount private evidence and grant cascade within the declared scope. A reference-model revision mismatch or historical absent VAD refuses even with otherwise valid SQL rows.

The test barrier and no-epoch controls are preparation helpers. No two-session race, migration or EXPLAIN has been executed by this agent.

## Measurements and limits

Offline actual control-flow suites passed: issued-authority 41, modern issued-capture 52, modern readiness 16, liveness verification 22, composite transport 13, voice evidence 25, identity-audio 39, replica review 38, self-test-mode 31. Revision-lineage passed 56, including ten new VAD preservation controls and a retained old adapter-expression negative. These use synthetic records/transport and do not establish identity, owner likeness, calibrated thresholds, live SQL or deployment. Copy check passed seven scopes and 21 negatives. Final context/hash checks are recorded in the freeze manifest.

The signed Azure `voice_quality` map is now preserved in the existing hashed `voice_measurement.value.measurements.model_revisions` path. ECAPA/xvector revision mapping is unchanged; Silero-VAD is retained only when actually present and syntactically valid. Historical missing VAD remains absent. A nested arbitrary measurements field cannot impersonate the authenticated top-level map. No service rebuild is required merely to preserve a map the existing service already emits; actual compatible deployed provenance remains a separate operational requirement.

## The essential next first-owner dependency

The legacy selected artifact is NOT an available preidentity reference producer. `selectOwnedVoiceArtifact` requires `liveness_verified_at`, current identity, biometric and training consent. The issuer deliberately does not remove those predicates. Its valid-existing-reference path cannot bootstrap a brand-new owner, so this slice must not be reported as completed first-owner issuance or a completed clone.

Next bounded implementation proposal: introduce a purpose-limited **private comparison reference preparation** caller from the same permission/source-selection step. It should accept an explicit selected-source commitment and separate comparison-processing consent, create one job for that exact source under existing private storage/integrity/malware contracts, and persist a dedicated comparison artifact/evidence selection rather than writing an ordinary VoiceGenome selection or granting training. The job may reuse Azure derivation/embedding adapters, but needs a reviewed operation/input contract for the selected source format, source byte/hash binding, exactly one chosen comparison variant, explicit reference audition/confirmation and the new comparison authority epoch. Its grant scope must permit only comparison preparation/verification, with bounded expiry and source/account erasure. Existing voice-genome/training/inference gates remain unchanged. A scheduler/worker caller and completed-state loader must be built together; a queued-job definition alone is insufficient.

Before that preparation can be called usable, demonstrate a native brand-new synthetic owner path through source selection, explicit comparison processing consent, actual bounded prepared job, reviewed private reference, fresh modern issued receipt, withdrawal/race/erasure and zero training/inference grants. Real owner media processing needs the owner's explicit recording/selection and the existing protected Azure budget/operational proof. Human held-out Hindi/Hinglish/English listening is still needed for owner likeness; embedding compatibility and ASR nonce recognition are proxies, not that acceptance.

Even after a genuine reference producer exists, capture serving still needs a calibrated same-capture producer for continuity, anti-spoof/synthetic risk and complete identity evidence, registered execution and acceptance. No score is invented here. Reverse the unavailable readiness only after that complete route and its negative controls have real accepted evidence; reverse this storage/race design if actual PostgreSQL proof shows stale authority acceptance or the owner erasure recount is nonzero.
