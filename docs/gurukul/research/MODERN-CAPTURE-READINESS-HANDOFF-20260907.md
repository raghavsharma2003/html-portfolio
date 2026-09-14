# Modern capture readiness implementation handoff, 2026-09-07

Frozen for review in ROOT/scratchpad/modern-capture-readiness, branch codex/modern-capture-readiness, base2c2e5b2c. No integration, expert-lean-text, compiler, parser, generated-engine or provider-harness edits. Full file SHA256 manifest and counts: MODERN-CAPTURE-READINESS-FREEZE-20260907.json in this directory.

## Exact source/test manifest

Changed:
- api/replica-liveness.js
- api/replica-source.js
- src/studio/CloneExperience.tsx
- src/studio/CloneVerificationJourney.tsx
- src/studio/LivenessCapture.tsx
- src/studio/StudioApp.tsx
- src/studio/livenessApi.ts
- evals/liveness-verification/harness.tsx (supplies new readiness callback to the existing fixture only)

New:
- api/_liveness/capture-readiness.js
- evals/modern-capture-readiness.mjs
- evals/modern-capture-readiness/component.mjs
- evals/modern-capture-readiness/component.tsx

## Contract

The dependency-free source-supported capability returns ready:false, waiting_on:us, code:liveness_verifier_unavailable. No env, endpoint, health reply, factory construction or caller argument can change it. The repository service has official face session operations, but lacks the modern composite /v1/liveness/verify operation. This is a supported-code limitation, not an assertion that a remote service is down.

After authentication/rate limits, issue/start_face/create_upload refuse503 with that named waiting-on-us state before SQL mutation, storage or provider work. Generic retry_upload checks fetched owner-scoped source.capture_mode=live_challenge before bucket access or signing; caller purpose is irrelevant. Existing ownership SQL is untouched. Status, cancellation, face polling/deletion and already-uploaded finalization remain available.

New authenticated capture_readiness reads the same latestOwnedChallenge caller and adds the bounded capability state. The callback reaches BOTH actual mounts: StudioApp -> CloneExperience -> CloneVerificationJourney -> LivenessCapture, and the legacy ReplicaWorkspace mount. UI unknown/read failure/blocked state is unavailable. New issue/face/media controls remain disabled. Fresh reads immediately before getUserMedia and MediaRecorder.start also require exact current challenge ID, issued state, future expiry and passed_deleted face state. Failure after permission stops tracks. Existing poll and withdrawal remain usable. The earlier successful-face notice no longer claims recording is unlocked by face alone.

## Actual local validation

- node evals/modern-capture-readiness.mjs:16 actual HTTP handler groups passed, including auth ordering, zero mutation/signing/face work on refusal, generic retry isolation, finalize/status/cancel/poll preservation and removal-of-guard negative controls.
- node evals/modern-capture-readiness/component.mjs:15 actual mounted React browser groups passed. Device APIs are synthetic, all non-localhost browser requests are aborted, and no evidence is uploaded. Controls cover restored/unknown/failed readiness, all-attestation issue refusal, blocked new-face with working poll, fresh pre-media failure, stopped tracks after late refusal, changed challenge state/ID/expiry/face receipt, ready fixture ordering, and two actual-source mutation controls reproducing collection/recording without fresh checks.
- node evals/liveness-verification/run.mjs:22 passed.
- node evals/face-session/run.mjs:26 passed.
- node evals/source-erasure/run.mjs:59 passed with a Node resolve hook supplying ONLY empty NEON_URL for the absent ignored config; global live fetch poisoned. Initial direct invocation failed on missing _config.js, not an assertion. No config file or secrets were copied.
- node ../../node_modules/typescript/bin/tsc -b --force --noEmit:passed.
- node scripts/check-copy.mjs:passed.
- git diff --check:passed.

The browser harness first failed during setup: Vite8's deprecated esbuild helper needs a separately installed dependency, then no-discovery optimization omitted jsx-dev-runtime. It now uses installed TypeScript transpilation and explicit React runtime includes; no dependency installation. One local API fixture initially expected409 for a wrong capture-mode finalize; actual retained caller correctly returns404, and the test expectation was corrected. None of these setup failures justified changing source guards.

No full release, product build, performance benchmark, real DB, provider, actual camera/microphone, model, deployment, biometric grant or identity/voice quality acceptance is claimed. Parent owns registry/context integration and independent review.

## Decision and reversal for parent context

Decision: refuse modern challenge collection at every active caller while the required composite operation has no source-supported implementation. Keep retention, status and erasure paths usable. Reverse only after exact operation/protocol/version implementation, actual caller integration, meaningful provider/receipt and adversarial acceptance; a config flag, face-only pass or health200 cannot reverse it.
Measurement:2026-09-07, n=16 actual handler groups +15 mounted-component groups, all passed; existing22+26+59 checks and TypeScript/copy/diff checks passed under the stated local synthetic seams. File hashes retained separately.
Rejection: the existing older voice-only issue readiness test does not cover modern Studio. A configured modern adapter or generic broker health is insufficient: the expected composite operation is absent from the repository service. Removing the intake/retry guards admits unfinishable work; removing fresh UI checks allows device collection/recording after readiness changes.

Remaining scope: document-source upload and identity submit readiness remain separate caller work. Approved independent document review, modern composite verification, and same-person continuity to primary voice enrollment remain unproven. Existing identity, consent, private quarantine, liveness, ownership, erasure and voice-preview gates are not weakened. Configuration readiness can never guarantee no outage after a recording starts; this implementation claims only the tested caller refusals and source-supported unavailable boundary.


## Race-review follow-up, latest frozen result

Parent review correctly identified that the first15 mounted groups did not cover pending-read lifecycle changes. The original fresh-read helper could continue after unmount, callback/session change or same-ID local cancellation, and could attach a stream returned after cleanup. It also accepted invalid expiry NaN through a <= comparison. That earlier15-group result did not prove these race properties.

Only THREE files changed after the first freeze: src/studio/LivenessCapture.tsx, evals/modern-capture-readiness/component.mjs, and evals/modern-capture-readiness/component.tsx. The other nine file hashes remain identical, checked programmatically. The freeze JSON records previous hashes and the refreshed full manifest.

Capture now has a mounted flag and operation generation, invalidated synchronously on callback/scope/consent/challenge identity/state/expiry/face change and on cancellation/retake/unmount. Both current local eligibility and the returned scoped snapshot must pass. Expiry must be finite and future. Assertions bracket fresh-read suspension and browser permission completion; a stale late stream has all tracks stopped before it can be stored. Stale promise and recorder callbacks cannot set state or construct/start a recorder. Scope cleanup discards live capture; upload/finalize stages are not reset by the capture-only stage cleanup.

Actual final mounted suite:29 groups passed. Additional cases cover unmount during readiness and recorder-read waits; same-ID failed/expired/invalid-expiry/face changes; consent and callback/session changes; both tracks of late permission streams stopped after unmount/consent/callback changes; no recorder construction; and two actual-source lifecycle-removal controls reproducing the old post-unmount request and leaked late stream. TypeScript, copy gate and diff check passed again. One fixture syntax error during test expansion was corrected before the successful run; it did not require a source policy change.

Server16 and existing22/26/59 checks remain the earlier executed results because their sources stayed byte-identical. No new DB/provider/model call, config activation, grant, integration edit, full build or performance claim. Existing static unavailability, identity/voice-ownership/enrollment-continuity blockers and document-lane scope remain unchanged.
