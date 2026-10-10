# Account-private Hindi voice slice

The account-private base service and migration 172 are deployed. The owner-entered Hindi/Hinglish text extension in this checkout is an October 10 candidate and is not deployed. See `docs/handoff/2026-10-09/START-HERE.md` for the accepted deployment and remaining evidence boundary. No fresh likeness or acoustic-quality result follows from this code change.

The authenticated `/api/private-voice` door accepts the exact contract described below. Admission and status polling call the consumer in this process. SQL claims use a ten-minute lease and skip locked rows. A queued run, or an expired claim that never started, can recover on a status poll. A running attempt whose lease expired becomes unknown; it cannot dispatch twice. The process must remain running after the HTTP response (Azure CPU Container App, not a Vercel background task).

The worker rechecks source/consent authority, verifies the enhanced reference, uses the existing GPU budget meter and exact-revision controller, obtains protected PCM from the Hindi provider and existing disclosure/watermark/C2PA/signer pipeline, and persists the private signed receipt and create-only WAV. All public/training claims remain false. Unknown reference language yields effective CFG zero. Hindi/Hinglish uses one pass; English is refused by frozen server configuration. The same leased authority is renewed before synthesis and protection, bounded by grant expiry; immediately before each storage write the lease covers at least 120 seconds while its separate erasure write horizon covers 90 seconds.

## HTTP contract

All requests require the current Supabase bearer token. The service validates it at `/auth/v1/user`; the Vercel proxy preserves it after its own `requireUser` boundary. No storage URL or locator reaches the browser. Disabled mode is 404 `{enabled:false,error:'private_voice_disabled'}`; invalid authentication is 401. Other failures return bounded `error` and `blocker_class`.

- GET `?replica_id=UUID`: `{enabled:true,scope,statement_set,statement,config,text_limits?,candidates,resume_run_id}`. `text_limits` advertises the custom-text capability; its absence means fixed-sample legacy mode. Candidate fields: `source_id`, `artifact_id`, `reference_sha256`, `duration_ms`, `snapshot_hash`.
- POST `{action:'generate',replica_id,source_id,artifact_id,run_id,expected_snapshot_hash,statement_set:'private-own-voice/v1',attestations:{own_voice_private_use:true},text}`: 202 `{created,run}`. `text` is optional for compatibility with the original fixed sample. When supplied, it is trimmed, limited to 280 Unicode code points, and must contain Devanagari or a reviewed Roman Hindi transformation. Pure English is refused. The server fixes Hindi, the Hindi V3 model arm, seed and style; the request cannot override them. The normalized text, deterministic text plan, config and receipt are content-addressed before budget reservation. UUID is caller-selected for idempotency, never authority. Reusing one UUID with different text is a conflict. Extra fields are refused. One unfinished run and at most twelve admitted runs per replica per 24 hours; budget admission remains independently mandatory.
- GET `?action=status&replica_id=UUID&run_id=UUID`: `{run}`.
- GET `?action=audio&replica_id=UUID&run_id=UUID`: private WAV bytes. Rechecks grant and hash after storage read.
- POST `{action:'rate',replica_id,run_id,ratings:{owner_likeness,naturalness,indian_accent,pronunciation}}`: integers 1 through 5; `{run}`.
- POST `{action:'revoke',replica_id,run_id}`: `{run}`. Revokes first, closes allocation, then attempts safe cleanup.

Run states are queued, claimed, running, ready, failed, unknown, revoked, or expired. Run fields include IDs, fixed config, creation/expiry, `error_code`, `cleanup_pending`, `metrics`, `ratings`, and `audio_available`. The grant lasts 24 hours. `ready` requires the final protected receipt and verified output hash in one authority-fenced settlement. Ratings are observations, never identity verification.

## Deployment status

Do not replay migration 172. The custom-text candidate changes no schema and does not change the GPU model artifact. Its release requires a reviewed immutable CPU rebuild and verification before the web client advertises `text_limits`. Deploy the CPU contract first and the web client second. During rollback, an older CPU omits `text_limits`; the web client then hides the editor and sends the legacy fixed-sample request without a `text` field.

The existing account-private authority, budget, supervisor, storage, disclosure, watermark and erasure boundaries remain required. Missing or drifted bindings still fail closed. This candidate does not authorize a canary, GPU wake, model call or deployment.

Revoked/expired/orphan results retain their exact output locator until the last lease and 90-second write reservation expire and their GPU window is observed terminal with resource release. Source erasure revokes private runs, closes admission, waits for these authorities and enumerates every reserved output path before row cascades. Monetary reservations remain held until attributable usage reconciliation; a successful model response or shutdown never fabricates a bill.

## Local verification

`node --test services/private-voice/runtime.test.mjs` runs the real HTTP server, consumer, account store, budget meter, Azure controller, Hindi provider and protection delivery pipeline using synthetic SQL, ARM, signed provider responses, protection primitives and storage. It also exercises the controller's existing tests. The release registry entry is `privatevoiceruntime`.

This verifies transport/control flow only. Real SQL EXPLAIN, immutable CPU rebuild, secret bindings, supervisor deployment, real account recording and an explicitly authorized spend canary remain necessary. No voice likeness, Indian-accent quality, provider availability or new-account end-to-end success is claimed.

Availability also returns only the most recent unexpired owner/replica request ID. A fresh browser can restore its actual status without generating again. Revoked/expired handles are excluded, and status/playback still recheck current authority.
