# Private account voice request, batch 1

This batch persists owner-attested requests only. No public route, queue consumer, model call or GPU activation is registered. Existing retained-owner grant/mode stays unchanged. Root must apply migration 171 before deploying the touched erasure queries.

`createPrivateVoiceHandler({db,requireUser,env,now})` is an injected server seam. It requires `VYAKTI_INTERNAL_VOICE_MODE=account-private`, `VYAKTI_MODEL_SERVING=azure_only`, and legacy self-test flags off. `requireUser` must be the real existing Supabase session verifier; request JSON never supplies owner authority.

- GET `?replica_id=<uuid>` returns owned ready enhancement candidates, snapshot hashes, fixed server sample configuration and one self-use statement. Optional source/artifact IDs narrow selection. Storage locators are not returned.
- POST `{action:'generate',replica_id,source_id,artifact_id,run_id,expected_snapshot_hash,statement_set:'private-own-voice/v1',attestations:{own_voice_private_use:true}}` returns 202 with `{created:true,run}`; identical UUID replay returns the existing request. Additional owner/path/text/model/style fields are rejected. Run state is queued. No fake voice readiness is reported.
- GET `?replica_id=<uuid>&run_id=<uuid>` returns status after current owner/source/permission recheck. Expired/revoked status is readable but never grants audio.
- POST `{action:'revoke',replica_id,run_id}` revokes the request and closes admission for an existing lifecycle window. It retains output locator and active-write deadlines for the erasure worker. Backend GPU supervisor cleanup is the next batch's responsibility.

Exports in `api/_private-voice-store.js`: `createPrivateVoiceStore`, `requirePrivateVoiceRun`, SQL constants, `privateVoiceSampleConfig`, scope/statement/text constants and receipt hashing. `requirePrivateVoiceRun` returns an authorized server-only reference locator plus immutable config. The CPU must still implement atomic lease/activation/child claim SQL against that request and freshly recheck permission at each effect; the read helper alone is not a transaction around a future GPU call.

Fixed first config: Hindi sample, `hindi_v3`, actual provider pack commitment, seed 31001, exaggeration 0.2, requested CFG 0.78, temperature 0.6. Fresh source language is explicitly unknown/unverified, so current provider conditioning's effective CFG is 0. This batch inherits none of the retained owner's transcript/profile. CPU must consume the frozen config/receipt hashes and expose measured effective values; future observed transcript conditioning requires a new server config/request, not a client override.

Migration 171 adds one table only. Each request is its own self-use attestation grant, with current capture/storage receipts, source/artefact/job snapshots, config and hashes. No consent scope extension, identity/liveness timestamps, genome, public generation or per-user GPU budget. `window_id` links the existing shared lifecycle; private children stay in this request's JSON because existing public child rows FK to public authority. The CPU adapter must reuse the shared SQL GPU meter/resource lock and independent supervisor. Do not run the old Blob-metered diagnostic simultaneously on the same target.

Output path is reserved at admission as `<owner>/<replica>/<source>/derived/private-voice/<run>.wav`. Future CPU upload must first set a bounded `lease_expires_at` / `output_write_not_after` and check request/source authority in the same SQL claim. Source erasure manifest includes the reserved path even if the upload result is lost. Lease/renew/complete wait for active leases/writes and unresolved GPU windows. Source/replica withdrawal marks requests revoked, closes windows and preserves paths. Rows cascade with the owned artifact/source/replica only after the existing erasure flow removes bytes; no accounting windows are erased.

Root preflight dependencies (check actual live schema, not historical migration labels):

- `vy_replica`: composite `(replica_id,owner_user_id)`, `subject_mode`, `lifecycle`, `policy_version`, `private_text_epoch`.
- `vy_replica_source`: composite `(source_id,replica_id,owner_user_id)`, consent/hash/state/purpose/capture/kind/third-party columns; existing erasure/storage-writer fields.
- `vy_replica_consent`: `consent_id`, tuple, scope/policy/receipt_hash, revoked_at/expires_at/granted_at.
- `vy_replica_processing_artifact`: unique `(artifact_id,source_id,replica_id,owner_user_id)`, created_by_job_id, stage/mime/size/duration/hash/manifest/storage and adapter fields.
- `vy_replica_processing_job`: tuple, step/revision/state/attempt/result; `vy_replica_processing_attempt`: job/attempt/outcome/result_manifest_hash and adapter fields.
- `vy_voice_app_lifecycle`: window_id, state; `vy_gpu_allocation_window`: window_id, resource_released_at. Both are required even before any request has a window. Full CPU batch also needs existing shared budget/supervisor tables and live pinned plan/configuration.

Parser packet: `node scripts/private-voice-sql-packet.mjs` emits four real-store `EXPLAIN` statements with synthetic parameter values, never ANALYZE or execution. Candidate params: `[replica_uuid,owner_uuid,source_uuid|null,artifact_uuid|null]`. Read: `[replica_uuid,owner_uuid,run_uuid|null]`. Admit: candidate four + `[run_uuid,request_hash,snapshot_hash,snapshot_json,receipt_json,receipt_hash,config_json,config_hash,expiry_iso]`. Revoke: `[replica_uuid,owner_uuid,run_uuid]`. Root must also EXPLAIN the touched existing source/full-erasure queries after migration; mocks do not parse their SQL.

Offline focused tests: `node --test evals/private-voice/run.test.mjs`. These exercise the actual handler/store with captured SQL and synthetic results. They prove control flow, isolation parameter binding, idempotency and refusal behavior; no live DB/parser/provider quality claim follows.
