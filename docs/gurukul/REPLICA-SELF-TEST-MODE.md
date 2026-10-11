# REPLICA_SELF_TEST_MODE

The owner's directive, said three times, verbatim: no identity or liveness
check for internal, self-only testing, for weeks. "I uploaded a video, my
clone should start being made." Right now, give the whole permission allow
for once only.

This document is the one place that describes the flag end to end: what it
sets, on what it never runs, how to turn it off, and the one query that
undoes everything it has ever done.

## The exact all-account internal-test guard

```
REPLICA_SELF_TEST_MODE=true
REPLICA_SELF_TEST_ENVIRONMENT=internal-owner-testing
REPLICA_SELF_TEST_ACCESS=all-authenticated
```

Set all three on both environments that can enter the flow: `vyakti-replica-
lab` (Vercel) bootstraps the six scopes before source creation, and
`vyakti-replica-processing` (Azure Container Apps Job) accepts evidence and
queues the draft after processing. The flag by itself is inert: all three
values must be exact, and the API or leased job must still supply a valid
authenticated owner UUID. Absent, unset, malformed, mismatched, or legacy
`REPLICA_SELF_TEST_MODE=true` by itself is OFF and keeps the fail-closed
production behaviour.

This is the explicit global switch for the isolated internal-test product. It
does not allow anonymous access or cross-owner access: authentication, replica
ownership and `subject_mode='self'` remain SQL predicates. The former
single-owner configuration remains supported by omitting
`REPLICA_SELF_TEST_ACCESS` and setting `REPLICA_SELF_TEST_OWNER_USER_ID`.

The Vite-built studio also needs this public presentation pair:

```
VITE_REPLICA_SELF_TEST_MODE=true
VITE_REPLICA_SELF_TEST_ENVIRONMENT=internal-owner-testing
```

Set both only on the internal owner test deployment, alongside the three server
server guards above. They reduce the studio to Add sources and Test your clone, open
file intake without a click, hide account-consent, verification, review,
readiness, activation, and publishing panels, and show direct paths for the
five source types: audio/video files, screenshots/documents/text files, text
or web links, one YouTube video, and a YouTube channel. These are choices, not
a five-item gate, and Test your clone is always reachable. The Vite flags grant
no server authority: the API still enforces the three-part authenticated test guard.
Both values must match the strings above exactly. If either is absent or
different, the production studio renders unchanged.

## What happens on upload, with it on

For an authenticated, owned replica with `subject_mode='self'`, the source endpoint
first grants `capture`, `transcription`, `storage`, `biometric`, `training`
and `inference`, so upload does not need a consent-screen round trip. The
moment a source it owns
reaches `vy_replica_source.state='ready'` (today: the instant the
`voice_quality` processing step commits), four things happen automatically,
through the real code paths, not by hand:

1. `age_verified_at`, `identity_verified_at`, `liveness_verified_at` and
   `identity_expires_at` are filled on `vy_replica` — only if they were
   `NULL`, so a real verification a person already did is never shortened.
2. All six private ingestion/model scopes remain present with method
   `account_attestation`, again only where an active row did not already exist.
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

Every row it writes carries `metadata.self_test_mode = true`,
`metadata.granted_by = 'REPLICA_SELF_TEST_MODE'`, and
`metadata.guard_contract = 'authenticated-internal-testing/v2'` and
`metadata.access_scope = 'all-authenticated'` (migration 063 added the
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

**Run this before the internal test product becomes a public production
service.** That is this decision's own reversal condition
(`context/decisions.md#replica-self-test-mode`).
