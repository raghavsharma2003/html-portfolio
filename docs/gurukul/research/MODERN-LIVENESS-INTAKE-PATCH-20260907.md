# Modern liveness intake quarantine patch

2026-09-07. Isolated `scratchpad/expert-liveness-intake`, branch `codex/expert-liveness-intake`, base `6a43559c`. Implementation/evals frozen for root review. This does not modify the legacy two-upload finalizer worktree or integration.

The modern one-video finalizer already queues integrity. Previously its ordinary worker changed the live source to processing and scheduled the enrollment DAG; liveness required quarantine. The patch keeps that initial job, runs integrity and malware_scan through existing native adapters, then stops without any media-probe, transcript, derived artifact or speaker model. Successful intake preserves quarantined state. Missing scanner, infection and changed bytes remain non-success.

## Files and behavior

- New `api/_replica-processing/purpose.js`: one live-purpose JS rule and internal SQL predicates. Processing eligibility binds the exact live source to its uploaded challenge, active narrow verification grant, current source-bound capture consent, storage consent and owned current self-replica lifecycle/policy. Historical live sources already in processing/ready remain ineligible rather than being silently resurrected.
- `pipeline.js`, `worker.js`: live intake stops after malware; an early guard precedes adapter access, provider budget and artifact effects. A versioned purpose marker enters the existing completion receipt and its canonical hash.
- `queue.js`, `runtime.js`: real queue/context predicates refuse stale forbidden jobs; the actual worker still checks purpose even if a stale caller supplies a context directly. Split legacy completion is refused for live media; only atomic purpose-aware completion may make its receipts.
- `repository.js`: commit locks/rechecks source and job, enforces permitted live stage, SHA, no derived output, precise next stage and native adapter provenance; preserves quarantine. Split enqueue refuses live media. Ordinary-upload DAG and receipt shapes are preserved.
- `_replica-storage-writer.js`: live challenge sources cannot acquire or renew ordinary processing artifact-write authority, including under an old lease.
- `_replica-liveness-verification.js`: both lease and settlement add the same strict intake receipt prerequisite. Each required job must be complete in the current shared intake revision, joined to its actual completed attempt and matching manifest hash, exact source SHA, purpose, empty artifact/evidence lists and precise next stage. Integrity requires native byte verifier/sha256-v1; malware requires the native ClamAV adapter identity and non-fixture provenance. The composite decision thresholds, identity writers and provider remain unchanged.

No migration, new approval mechanism, scanner implementation or configuration flag is introduced. The existing job result JSON and attempt schema hold the additive purpose and commitments. The native adapter outputs are the provenance source in production composition; the SQL harness's injected scanner is explicitly synthetic, not a successful installed scan.

Root review revision adds challenge expiry independently of the longer verification-grant expiry, and requires the replica policy to equal the exported current REPLICA_POLICY_VERSION, as well as challenge/consent agreement. Equal stale policy strings are insufficient. The policy import follows _replica to _invites to node:crypto without a processing import cycle. Syntax checks and both focused offline suites passed again after this revision when root released the timing slot.

## Checks run

- `node evals/liveness-intake.mjs`: 7 groups passed on final run. Actual worker + native adapter functions, ordinary upload control, infected/unavailable/hash mismatch, all forbidden stages, receipt binding, actual source guard removal reaching one forbidden adapter, and actual SQL construction at required callers.
- `node evals/liveness-intake-harness.mjs`: 4 groups passed. Manifest failure causes zero DB calls; wrong DB causes zero fixture writes; an initial write failure still attempts/recounts all 14 cleanup tables; cleanup failure preserves the primary error.
- `node evals/replica-processing/run.mjs`: incumbent suite passed one complete run.
- Syntax and diff whitespace checks passed, including a final diff check after journal edits. Context graph validation passed with 2,211 nodes, 2,363 edges and 4 documents after root released the performance timing slot.

These checks do not parse PostgreSQL or run ClamAV. No provider, model, cloud, DB or deployment calls were made by this agent. Initial new-test syntax and four-digit nonce fixture errors were corrected; no production predicate was relaxed for those fixtures.

## Protected real SQL handoff

Import `runLivenessIntakeSqlChecks({db,openSession,onFixtureManifest})` from `evals/liveness-intake-live.mjs`. `db(sql,params)` and each interactive session's `query(sql,params)` return row arrays; `close()` terminates the session. The manifest callback must durably record UUIDs before writes. The harness independently checks exact database `vyakti_expert_integration_20260906`.

The planned manifest contains seven replicas, fourteen sources, seven document cases/challenges/verification grants, fourteen capture/storage consents and twenty-one job IDs. Synthetic adult-document/Face prerequisites exist only to reach actual lease predicates. Replica identity/liveness timestamps remain null; no auth/person, real media object, training/inference/biometric-model consent or identity grant is created. There is no provider call. The only completeLivenessVerification invocation supplies a rejected verdict after invalidating scan proof and must affect zero rows.

Global processing/liveness candidate APIs are wrapped with additional exact generated source/challenge predicates so this harness cannot lease unrelated development work. All production SQL guards and parameters remain present. Report this additive fixture scope, rather than claiming an unrestricted global drain was run.

The harness exercises missing/partial/complete scan evidence, source quarantine, real liveness leasing, proof change before settlement, attempt/provenance/manifest/revision/purpose/source-hash negative controls, old queued and old leased forbidden stages, and the exact original commit statement retained in `evals/liveness-intake-original-commit.sql`.

Two added rollback groups reuse the existing fixture manifest: an expired challenge with its grant still active, and equal stale replica/challenge/consent policies. Actual queue refusal is paired with removal of exactly the relevant new SQL predicate, which must admit the otherwise same fixture. The planned total is 13 groups; these are not measured SQL passes until root executes them.

Two interactive source-deletion races pause the first transaction before COMMIT and observe `pg_blocking_pids(writer)` containing the actual source-holder PID. The corrected commit must refuse the stale source; the original statement must demonstrate stale job completion, which is the negative control. A third overlap holds scan completion uncommitted, observes its actual transaction write lock, proves liveness cannot lease, then commits and leases through a fresh statement. That third test is a visibility/write-lock witness, not a blocking witness.

No cancellation or capture-consent withdrawal overlap is implemented in this harness. Those simultaneous authority races remain unproven; source-deletion fencing is not evidence for every lifecycle or consent mutation. Native adapter names and version blacklists are receipt constraints, not proof that a real scanner ran, that signatures were current, or that identity measurements were calibrated.

Cleanup separately attempts and recounts all fourteen relevant tables: processing attempts, liveness attempts, identity attempts, processing evidence/artifacts/jobs, source storage writers, narrow verification grants, liveness challenges, identity cases, audit, sources, consents and replicas. Errors preserve `failedStage`, `primaryFailure`, `cleanupFailure` and `remainingFixtureRows`. Success requires `intakeFixtureCleanupVerified=true` and every count zero. Original SHA/capability secrets are not printed.

## Remaining acceptance

Root subsequently executed the protected development harness successfully at 2026-09-07T10:47:33.856Z: 13 groups passed and all 14 table recounts were zero. Retained evidence is `development-concurrency-liveness-intake-20260907.json`. This includes expiry/equal-stale-policy refusal and predicate-removal controls, the original DAG quarantine escape, corrected/original witnessed source-deletion overlaps, and uncommitted-scan visibility. This is root-run SQL evidence, not scanner execution. Cancellation and capture-consent withdrawal overlaps remain unproven.

Root must separately verify a native scanner process with current signatures in the correct worker environment. Do not mark fake scanner outcomes, receipt metadata or source quarantine as real scan/identity success. The missing composite endpoint, document review authority, later Face/audio continuity and primary enrollment voice ownership remain separate blockers. This patch grants no identity and changes no liveness score policy.

Journal entries are in isolated context/decisions.md, measurements.md and rejected.md, indexed by three new graph nodes. Root owns integration registration and final release evidence. Reversal requires a separately reviewed verification-purpose operation with explicit consent, lineage, concurrency, deletion and measured acceptance; it cannot be justified by an ordinary enrollment job progressing further.
