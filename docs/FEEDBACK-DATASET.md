# Leakage-safe feedback datasets

Status: implemented manifest compiler and owner-only draft builder on
`voice-cloning`, 2026-08-24. Migration 030 is not deployed. No dataset is
approved for training and no adapter has been trained.

## Dataset law

A turn-level random split is invalid for conversations. Adjacent turns share
language, facts, callbacks, emotional state and often near-identical prompts;
putting them on both sides of a benchmark inflates the score without improving
the replica.

The compiler therefore assigns a whole private dialogue session to exactly one
of `train`, `development` or `test`. The assignment is registered by a salted
session commitment, not the session id, and is immutable across all later
dataset versions. An existing assignment wins even when new feedback arrives.
If unsafe feedback later appears inside a session already frozen outside test,
the entire candidate dataset becomes blocked rather than moving that session
and contaminating the benchmark.

Initial unseen sessions are allocated deterministically toward 70/15/15. Every
example carries only:

- opaque feedback and turn ids;
- the latest append-only feedback revision;
- session, response, rating and optional correction commitments;
- exact Person Model and calibration versions at dataset level;
- typed dimensions and example kind;
- a commitment to sealed audio when voice evidence exists;
- the frozen split.

No reply, correction, transcript, prompt, relationship state, owner identity
or provider reference is copied into the dataset definition.

## Example kinds

- `preference`: a close/off output with an owner-authored encrypted correction;
- `positive_eval`: every rated dimension was exact;
- `negative_eval`: a mismatch without a correction pair;
- `safety_holdout`: any unsafe rating, forced to test for a new session.

Only preference examples inside `train` count toward preference depth. Only
positive examples outside train count toward positive holdout depth. This
prevents a large train set from satisfying its own evaluation requirement.

## Structural readiness

A draft needs at least:

- 12 independent sessions;
- 6 train, 2 development and 2 test sessions;
- 20 development and 30 test examples;
- 30 owner-authored train preference pairs;
- 10 positive holdout judgments;
- 3 judgments each for wording, behavior, relationship, memory and delivery;
- no unsafe example stranded in a previously frozen non-test session.

Passing these checks means only `ready_for_candidate_dataset`. It does not mean
safe to train or promote. The resulting database row is always `draft`.

## Mutation safety

The final insert locks the replica row, re-resolves the active runtime versions
and compares the complete latest `(feedback_id, revision)` set with the set the
compiler saw. Any concurrent feedback revision aborts the build. Existing split
rows must match before dataset insertion, version allocation is serialized and
an identical source set is idempotent.

## Still required before training

An offline export job must decrypt exemplars only inside an isolated workspace,
then pass:

1. semantic near-duplicate and templated-response grouping;
2. PII and third-party-content policy checks;
3. adversarial correction and data-poisoning review;
4. language, relationship-stage and failure-mode balance analysis;
5. deletion/suppression reconciliation immediately before materialization;
6. a signed, short-lived artifact manifest and complete cleanup receipt.

A trained candidate then needs paired holdout evaluation against the frozen
baseline on its target layer and regression gates on every other layer. It may
create a new draft adapter/calibration version, never overwrite the active one.
The implemented decision contract is in
[candidate qualification](CANDIDATE-QUALIFICATION.md).

Offline gate:

```bash
node evals/run.mjs feedbackdataset
```
