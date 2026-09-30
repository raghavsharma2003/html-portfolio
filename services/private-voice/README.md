# Account-private Hindi voice slice

This CPU service is an implementation candidate, not a deployed or acoustically measured feature. Migration 172 is unapplied. Migration 171 remains unused. No retained owner grant is read and no public genome, generation, identity or enrollment authority is manufactured.

The authenticated `/api/private-voice` door accepts the exact contract described below. Admission and status polling call the consumer in this process. SQL claims use a ten-minute lease and skip locked rows. A queued run, or an expired claim that never started, can recover on a status poll. A running attempt whose lease expired becomes unknown; it cannot dispatch twice. The process must remain running after the HTTP response (Azure CPU Container App, not a Vercel background task).

The worker rechecks source/consent authority, verifies the enhanced reference, uses the existing GPU budget meter and exact-revision controller, obtains protected PCM from the Hindi provider and existing disclosure/watermark/C2PA/signer pipeline, and persists the private signed receipt and create-only WAV. All public/training claims remain false. Unknown reference language yields effective CFG zero. Hindi/Hinglish uses one pass; English is refused by frozen server configuration. The same leased authority is renewed before synthesis and protection, bounded by grant expiry; immediately before each storage write the lease covers at least 120 seconds while its separate erasure write horizon covers 90 seconds.

## HTTP contract

All requests require the current Supabase bearer token. The service validates it at `/auth/v1/user`; the Vercel proxy preserves it after its own `requireUser` boundary. No storage URL or locator reaches the browser. Disabled mode is 404 `{enabled:false,error:'private_voice_disabled'}`; invalid authentication is 401. Other failures return bounded `error` and `blocker_class`.

- GET `?replica_id=UUID`: `{enabled:true,scope,statement_set,statement,config,candidates,resume_run_id}`. Candidate fields: `source_id`, `artifact_id`, `reference_sha256`, `duration_ms`, `snapshot_hash`.
- POST `{action:'generate',replica_id,source_id,artifact_id,run_id,expected_snapshot_hash,statement_set:'private-own-voice/v1',attestations:{own_voice_private_use:true}}`: 202 `{created,run}`. UUID is caller-selected for idempotency, never authority. Extra fields are refused. One unfinished run and at most twelve admitted runs per replica per 24 hours; budget admission remains independently mandatory.
- GET `?action=status&replica_id=UUID&run_id=UUID`: `{run}`.
- GET `?action=audio&replica_id=UUID&run_id=UUID`: private WAV bytes. Rechecks grant and hash after storage read.
- POST `{action:'rate',replica_id,run_id,ratings:{owner_likeness,naturalness,indian_accent,pronunciation}}`: integers 1 through 5; `{run}`.
- POST `{action:'revoke',replica_id,run_id}`: `{run}`. Revokes first, closes allocation, then attempts safe cleanup.

Run states are queued, claimed, running, ready, failed, unknown, revoked, or expired. Run fields include IDs, fixed config, creation/expiry, `error_code`, `cleanup_pending`, `metrics`, `ratings`, and `audio_available`. The grant lasts 24 hours. `ready` requires the final protected receipt and verified output hash in one authority-fenced settlement. Ratings are observations, never identity verification.

## Deployment prerequisites, not executed here

Review and explicitly apply each statement in `db/migrations/172_private_voice_run.sql`, then EXPLAIN every exported statement in the private store, execution store, lifecycle and ledger plus the source/full erasure statements against the real database. Offline SQL doubles cannot prove Postgres syntax, types, lock behavior or referential integrity. Existing erasure and cleanup probe the catalog first, so an unapplied optional table does not break unrelated erasure.

Build the Dockerfile from the repository root with a reviewed immutable Node image. Reuse the existing CPU app and its narrowly scoped UMI. Do not create a GPU or change minReplicas. Set `VYAKTI_PRIVATE_VOICE_MODE=account-private` on CPU and protected Vercel Preview, plus `VYAKTI_PRIVATE_VOICE_ORIGIN` on Vercel. CPU needs `NEON_URL`, Supabase URL/key, existing replica private storage credentials, `VYAKTI_MODEL_SERVING=azure_only`, `OPEN_VOICE_MODEL_ARM=hindi_v3`, existing broker origin/HMAC secret, and existing audio-protection origin/HMAC/watermark/commitment secrets. The Azure controller uses its managed identity endpoint, approved exact plan/policy/commitment, enabled flag and approved budget ID. Missing bindings fail honestly; there is no fake fallback.

Configure the existing broker's `OPEN_VOICE_ALLOCATION_ORIGIN` to this CPU callback. The independent existing `scripts/azure-voice-supervisor53.mjs` caller must run against this CPU origin before dispatch, with the existing cron secret and its source commitment. Set `AZURE_VOICE_APP_SUPERVISOR_ENABLED=true`. Its callback performs exact controller cleanup and renews a 30-second database heartbeat; it also calls cleanup. The existing result-cleanup cron additionally invokes private cleanup when schema 172 exists. Do not claim an independent supervisor is deployed merely because its callback exists. The existing supervisor runs for a finite 16-minute interval and must be launched/restarted under reviewed operational supervision for an authorized canary.

Revoked/expired/orphan results retain their exact output locator until the last lease and 90-second write reservation expire and their GPU window is observed terminal with resource release. Source erasure revokes private runs, closes admission, waits for these authorities and enumerates every reserved output path before row cascades. Monetary reservations remain held until attributable usage reconciliation; a successful model response or shutdown never fabricates a bill.

## Local verification

`node --test services/private-voice/runtime.test.mjs` runs the real HTTP server, consumer, account store, budget meter, Azure controller, Hindi provider and protection delivery pipeline using synthetic SQL, ARM, signed provider responses, protection primitives and storage. It also exercises the controller's existing tests. The release registry entry is `privatevoiceruntime`.

This verifies transport/control flow only. Real SQL EXPLAIN, immutable CPU rebuild, secret bindings, supervisor deployment, real account recording and an explicitly authorized spend canary remain necessary. No voice likeness, Indian-accent quality, provider availability or new-account end-to-end success is claimed.

Availability also returns only the most recent unexpired owner/replica request ID. A fresh browser can restore its actual status without generating again. Revoked/expired handles are excluded, and status/playback still recheck current authority.
