# REPLICA_SELF_TEST_MODE

The owner's directive, said three times, verbatim: no identity or liveness
check for internal, self-only testing, for weeks. "I uploaded a video, my
clone should start being made." Right now, give the whole permission allow
for once only.

This document is the one place that describes the flag end to end: what it
sets, on what it never runs, how to turn it off, and the one query that
undoes everything it has ever done.

## The exact env var and value

```
REPLICA_SELF_TEST_MODE=true
```

Set on the environment that runs the processing worker (`vyakti-replica-
processing`, Azure Container Apps Job) and, if the studio ever reads it
directly, on `vyakti-replica-lab` (Vercel). Absent, unset, empty, or any
value other than the exact string `true` (case-insensitive) is OFF and is
today's behaviour, bit for bit — checked with a negative control, see below.

## What happens on upload, with it on

For a replica with `subject_mode='self'`, the moment a source it owns
reaches `vy_replica_source.state='ready'` (today: the instant the
`voice_quality` processing step commits), four things happen automatically,
through the real code paths, not by hand:

1. `age_verified_at`, `identity_verified_at`, `liveness_verified_at` and
   `identity_expires_at` are filled on `vy_replica` — only if they were
   `NULL`, so a real verification a person already did is never shortened.
2. `biometric`, `training` and `inference` consent (method
   `account_attestation`) are granted, again only for scopes not already
   active.
3. Every reviewable evidence row without an existing decision is `accepted`
   (`api/_replica-review.js`'s `acceptAllOwnedEvidenceForSelfTest`).
4. One eligible `enhance`/wav artifact is `selected`
   (`selectOwnedVoiceArtifact`, unmodified), and `queueOwnedVoiceGenome`
   (unmodified) is called, which computes its own `source_set_hash` from
   the now-accepted set and queues a draft build.

The studio's review panel (`ProcessingReview.tsx`) shows a banner whenever
`self_test_mode` is true on the replica it is looking at: "Identity and
liveness checks are turned off for this replica," in `blockerClass.ts`'s
own `disabledReason("us", …)` shape, not a new vocabulary. The owner should
never have to wonder later whether a clone was verified.

## What it never touches

- Any replica whose `subject_mode` is not `'self'` — checked at the SQL
  level inside every statement the flag's code runs, not only by its one
  caller.
- The spoken AI disclosure or the PerTh watermark on synthesised audio —
  untouched, unrelated code paths (`services/audio-protection`).
- A row that already has a real decision. Nothing here overwrites a human
  reviewer's `accepted`/`rejected`/`selected` or a real
  `liveness_verified_at`.
- `vy_replica_model_build.source_set_hash` — always computed by
  `queueOwnedVoiceGenome` itself, never invented
  (`context/rejected.md#self-test-mode-must-not-hand-write-source-set-hash`).

## Finding and revoking everything the flag ever created

Every row it writes carries `metadata.self_test_mode = true` and
`metadata.granted_by = 'REPLICA_SELF_TEST_MODE'` (migration 063 added the
`metadata` column to `vy_replica`, `vy_replica_processing_evidence_decision`
and `vy_replica_processing_artifact_decision` — `vy_replica_consent` already
had one).

```
node scripts/revoke-self-test-grants.mjs            # run it for real
node scripts/revoke-self-test-grants.mjs --dry-run   # count only
```

This is one SQL statement (`REVOKE_SELF_TEST_GRANTS_SQL` in that file):
revokes every tagged consent row, nulls the four identity timestamps on
every tagged replica, and inserts a `rejected`/`rejected` decision over
every tagged `accepted` evidence row and `selected` artifact — the same
append-only shape a human reviewer's own reversal takes, never a delete.
Proved live: `context/measurements.md#self-test-four-gates-measured-
blocking`.

**Run this before this product has any user who is not the owner.** That is
this decision's own reversal condition
(`context/decisions.md#replica-self-test-mode`).
