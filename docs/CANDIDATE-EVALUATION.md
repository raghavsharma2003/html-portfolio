# Blinded owner candidate evaluation

Status: implemented on `voice-cloning`, 2026-08-24. Migration 032 is not
deployed. The operator-side package builder has offline coverage; no real
candidate outputs have been materialized and no candidate can activate itself.

## Purpose

An owner can teach the replica which response feels more like them without
being told which side is the current baseline and which is a candidate. This
prevents model labels, novelty and presentation order from contaminating the
preference evidence used by the qualification gate.

The first shipped lane is text-only for `dialogue_adapter` and `prompt_policy`
candidates. Voice and joint candidates are refused until the same protocol can
deliver sealed, watermarked audio assets and prove that the owner listened to
them. Text delivery ratings cover the implied pace and emotional shape of the
written response; they are not voice-identity evidence.

## Fixed protocol

An operator materializes one package from an immutable candidate and the test
split of its frozen feedback dataset:

1. require 30 to 100 unique held-out examples from at least two sessions;
2. freeze the exact dataset source-set hash, candidate artifact, base model,
   build manifest, required layers and both output hashes;
3. cryptographically shuffle example sequence and assign exactly balanced
   `AB` and `BA` presentation orders;
4. commit the complete plan before the owner sees any output;
5. encrypt context, A and B separately with random data-encryption keys;
6. persist only encrypted assets plus content-free hashes and commitments.

Every asset uses AES-256-GCM with exact associated data binding the run,
assignment, replica, owner, example, role and plaintext hash. Its data key is
wrapped by a separate evaluation key-encryption key. Evaluation keys are not
shared with feedback-correction keys.

## Owner boundary

`POST /api/replica-candidate-eval` supports only:

- `status`, which returns the next neutral A/B comparison and progress;
- `judge`, which atomically records one positional `a`, `b` or `tie` decision
  for every required layer.

Both operations derive ownership from the bearer token and recheck the
owner/replica/run/assignment/hash tuple in the database. The browser never
receives candidate id, baseline id, provider, model, target layers, run
commitment or presentation order. Responses are `no-store`.

Submission is idempotent only when every repeated judgment is identical.
Partial layers, extra layers, changed choices, replay against another replica,
stale assignment hashes and completed runs are rejected. A run becomes
`complete` only when every assignment has one full, immutable judgment set.
The one-statement write explicitly reasons over inserted-or-existing judgments,
so first submission and idempotent retry have the same result under PostgreSQL
data-modifying CTE visibility rules.

## Unblinding and promotion

Only the internal qualification path maps positional choices back to
candidate/baseline wins. It verifies the sealed presentation order and
assignment hash before emitting observations. Completion does not qualify or
activate a candidate. The independent statistical, safety, false-memory,
privacy, watermark and approval gates in `CANDIDATE-QUALIFICATION.md` still
apply.

## Required secrets

- `REPLICA_EVAL_KEK_ID`: stable identifier for the current evaluation KEK.
- `REPLICA_EVAL_KEK_B64`: 32 random bytes encoded as base64.

Secrets stay server-side. Rotation requires an explicit rewrap job; changing
the key without rewrapping existing data makes those assets intentionally
undecryptable.

## Offline gate

```bash
node evals/run.mjs candidateeval
```

The suite covers balanced randomization, immutable commitments, envelope
encryption and tamper detection, unsupported voice refusal, owner-only neutral
responses, exact-layer judgments, replay/IDOR negatives, transactional
completion and internal unblinding.

## Still required for production

- deploy migration 032 and exercise it against the live database;
- create an authenticated operator job that renders candidate outputs from
  the committed artifacts without exposing plaintext in logs;
- add sealed, watermarked audio delivery and listen-completion evidence for
  voice and joint candidates;
- add evaluator signing, rotation/rewrap operations and erasure integration;
- feed unblinded observations into the independent qualification service;
- require two-person promotion approval and retain instant rollback.
