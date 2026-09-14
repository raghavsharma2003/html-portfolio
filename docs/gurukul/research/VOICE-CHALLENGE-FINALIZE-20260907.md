# Legacy creator voice challenge upload finalization

7 September 2026. Isolated source work in `scratchpad/expert-draft-adoption`, based on `a93ae825`. Root owns integration, context logging and actual development SQL. Root subsequently reported the protected development SQL run passed 21 groups at 2026-09-07T10:03:04.608Z, with remainingFixtureRows=0 and no identity mutations. This includes the original-query negative control and five witnessed NOWAIT overlaps.

## Surface correction

This patch repairs the legacy creator upload path. The files are `src/creatorStudio/VoiceIdentityChallenge.tsx` and `src/creatorStudio/voiceIdentityApi.ts`, not `src/studio` files. In the inspected integration entry point, `src/studio/main.tsx` imports `../creatorStudio/main` only when the URL query parameter is `mode=teacher` or `mode=ops`; otherwise it imports `./personalMain`. The legacy workspace is therefore reachable through `/studio?mode=teacher` or `/studio?mode=ops`, with its voice identity panel additionally gated by `VITE_VOICE_IDENTITY_CHALLENGE`. The backend route also retains its existing `VOICE_IDENTITY_CHALLENGE` gate.

The default modern `/studio` experience uses `CloneExperience` → `CloneVerificationJourney` and a separate `livenessApi` path. This work does not prove that modern owner's normal recording path is repaired or connected through complete identity settlement. Earlier audit references placing these two legacy UI files under `src/studio` were incorrect. The modern issue/capture/lease/settlement caller mapping still needs its own bounded audit.
## Problem and actual callers

The actual chain is `VoiceIdentityChallenge.tsx::upload` → `sendOne` → `StudioApp.tsx::handleFinalizeVoiceIdentity` → `voiceIdentityApi.ts::finalizeVoiceIdentityUpload` → POST `/api/replica-voice-identity`, `op=finalize` → `finalizeVoiceChallengeSource`. There is no symbol named `finalizeOwnedVoiceChallengeUpload` in this checkout.

The old SQL updated one source in `updated_source` and then tested both sources by reading the base table. PostgreSQL data-modifying CTE siblings share the original snapshot: the just-quarantined source was still pending in that read. Even after both ordinary sequential requests completed, the challenge could remain issued. The original exact statement from `a93ae825` is retained in `evals/voice-challenge-finalize-original.sql` for actual-execution negative control.

## Bounded correction

`VOICE_CHALLENGE_FINALIZE_SQL` is exported from the existing API helper. It locks the attached source rows, current replica, active capture/storage consents, and current challenge before any writes. It verifies the current owner tuple and attachments against the initial source selection, requires every nonnull attachment to exist, checks source role/kind/state/self-only declaration, and binds the pending source's stored size/MIME to the metadata preflight. Each source must reference its own still-active capture consent; a newer grant cannot retroactively authorize an old source.

The readiness relation consists of the other locked sources plus the actual `updated_source` result. The first source remains issued; the second reaches captured only when both are quarantined. Metadata rejection retains the existing failed/reject behavior. SHA remains pending server verification. This is storage metadata completion, not proof that video and WAV are one recording.

Cancellation uses challenge→source locks, deletion source→challenge, and consent revocation consent→source/replica. Waiting in a newly chosen order would introduce a cycle against existing writers. All finalizer authority locks therefore use NOWAIT. Only PostgreSQL SQLSTATE55P03 maps to `voice_challenge_finalize_busy`, status409, retryable=true; the original error is retained as cause. Every other database error propagates unchanged. No write precedes complete authority selection. NOWAIT overlap is deliberate refusal followed by explicit retry, not serialized simultaneous success.

Challenge and consent expiry are checked under the selected authority locks using clock_timestamp. The final challenge write consumes those locked eligible rows and repeats issued state, without a second wall-clock expiry check that could partially quarantine a source after the authority stage succeeded but before its dependent challenge write.

## User retry

The existing upload button restarted create/upload after any failure; an already-attached source made that retry unusable. The component now retains per-recording/per-challenge source IDs, signed upload capabilities, and uploaded/finalized flags in memory. Retry resumes the failed step and never recreates or uploads an already-completed source. A completed capture remains complete while transcript finalization retries. No receipt is persisted in local storage or reused for another recording/replica/challenge.

Challenge changes/unmount invalidate progress; definitive unavailable/replaced sources block retry and offer cancellation. Uncertain source authorization cannot safely recover the missing signed capability and therefore requires cancellation/reissue instead of another blind create. No hidden retry loop is added.

The API client handles an uncertain finalize response with one authenticated status plus source-list readback. It confirms only the exact replica/challenge/source attachment, a quarantined source, an unexpired challenge, and issued/captured state. A replaced, deleted, pending or expired result does not count as success. Status uses the existing POST status operation, not a newly invented GET endpoint. Source-list truncation or unavailable readback leaves the result unconfirmed. This recovery confirms upload state only; it does not infer identity acceptance.

## Checks actually run by this agent

- `node evals/voice-challenge-finalize.mjs`: 5 groups passed.
- `node evals/voice-challenge-finalize-ui.mjs`: 8 actual callback/API-readback groups passed.
- `node evals/voice-challenge-finalize-harness.mjs`: 4 cleanup/manifest fault-injection groups passed.
- `node evals/identity-challenge/run.mjs`: 101 incumbent checks passed. Existing fixture labels are not identity accuracy measurements.
- `npx tsc --noEmit` and `git diff --check`: passed.

These are offline control-flow/source checks, not PostgreSQL, storage or browser acceptance. No agent DB, provider, decoder, model, cloud or deployment calls ran.

## Root development SQL handoff

Import `runVoiceChallengeFinalizeSqlChecks({db,openSession,onFixtureManifest})` from isolated `evals/voice-challenge-finalize-live.mjs`. Persist the UUID-only manifest before writes. Use the protected exact-development wrapper; no autonomous database invocation is built into the module.

It executes and EXPLAINs the actual finalizer before fixtures; exercises both source orders, the original statement's stuck-issued negative control, the actual UI sequence where source two is attached after source one is finalized, metadata mismatch, wrong owner, expired/revoked authority, missing companion, metadata changes, and old-source/new-consent refusal. Five interactive overlaps cover the other finalizer, actual cancellation, actual source deletion, actual consent revocation, and attachment replacement.

The overlap witness is an independently observed granted transaction write lock plus actual55P03 from the competing NOWAIT finalizer, while the holder remains uncommitted. `pg_blocking_pids` cannot show a statement that refuses to wait. The observer must see no contender mutation; after holder commit, retry either completes or refuses according to the real changed authority.

Synthetic fixtures create no auth account, person, agent, genome, identity grant, storage object or provider resource. All identity/age/liveness timestamps must remain null. Cleanup explicitly attempts all six scoped tables: voice challenge attempts, voice challenges, audit, sources, consents, replicas; then counts each to zero. Primary and cleanup failures remain separate. Success flag: `voiceFinalizeFixtureCleanupVerified`; details: `remainingFixtureRows`, `primaryFailure`, `cleanupFailure`, `failedStage`.

## Boundaries and reversal condition

The v1 verifier, issue policy, score thresholds, identity completion and grant-writing SQL are untouched. Azure-only verifier availability remains unchanged. This does not connect v2 issuance, prove same-recording ancestry, establish Face/voice continuity or resolve missing identity measurements.

Replace NOWAIT only after a common lock order across the actual cancellation/deletion/consent callers is implemented and real overlapping transactions prove no cycle and no stale authority. Replace readback recovery only with an equally scoped durable finalization receipt; a matching challenge ID alone is insufficient. Root owns durable context logging of the actual SQL outcome reported above; these synthetic development checks do not establish real identity acceptance.
