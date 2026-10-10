# Private account voice: first complete Hindi vertical slice

Status: implementation contract, 2026-09-27. No migration, deployment, GPU activation, or provider call is authorized by this document.

## Outcome and boundary

The first slice lets a signed-in account use one eligible recording of its own voice to request one private Hindi or Roman-Hinglish sample, wait while the existing Azure CPU service activates the existing dormant Hindi Chatterbox GPU, and play the saved protected WAV in Studio. The same account can revoke the request and output. The run never becomes an identity, liveness, public enrollment, voice genome, release, or training claim.

The authority is a narrow, per-run account attestation:

> This recording is my own voice. Use it to make this private AI voice sample for me.

The server freezes that statement, a fixed sample text, the selected reference snapshot, the Hindi model commitment, and all synthesis settings. Request JSON cannot supply an owner, storage locator, text, model, style, output path, or public-use flag. The request expires after 24 hours. Expiration or revocation stops new byte reads, GPU dispatch, result settlement, and playback.

This slice intentionally supports `language_id=hi` only. Roman Hinglish uses the same Hindi lane and one-pass synthesis. English follows as a separate arm after this path works; a static origin and model-arm setting must not pretend to serve both.

## Why a dedicated row is required

Existing data remains authoritative where its meaning matches. None of the current rows can safely double as the private grant:

| Existing storage | Reuse | Reason |
|---|---|---|
| `vy_replica_source` | Yes | Owns the uploaded recording, capture consent, state, hash, storage locator, third-party flag, and erasure lifecycle. |
| `vy_replica_processing_artifact` and processing jobs/attempts | Yes | Identify the real enhanced WAV and prove integrity, malware scan, lineage, and non-test adapters. |
| `vy_replica_consent` | Read only | Current `capture` and `storage` consent are required. Its closed scope list has no private voice sample scope. Writing this grant as `inference`, `biometric`, `training`, `api`, or `model_improvement` would grant a different authority and would be false. |
| `vy_replica_voice_preview_intent` | No for authority | It requires a positive genome version and model-preview semantics, but has no attestation receipt, grant expiry, revocation timestamp, or frozen source snapshot. Hiding those fields in `style` or `result_metadata` would not create SQL-enforced authority. |
| `vy_replica_generation` | No for this slice | It has a non-null genome FK and its `voice_preview` authorization requires identity, liveness, inference, biometric, and training gates. Inserting a made-up genome or weakening that fence would manufacture public-style verification. |
| `vy_gpu_allocation_window` and `vy_voice_app_lifecycle` | Yes | They already meter, exclude concurrent use of the exact GPU resource, bind an exact revision, and retain uncertain cleanup/accounting state. |
| `vy_voice_allocation_authority` | No | Its generation/preview-intent columns describe the public preview authority. A private run ID must not be written into columns named `generation_id` and `intent_id`. |
| Private Blob storage helpers | Yes | Use the existing server-chosen source derivative prefix, create-only writes, hash verification, reads, and deletion. |

One dedicated table is therefore required. Keep migration 171 unused. A future reviewed migration 172 creates `vy_private_voice_run`; it is not applied as part of this planning slice. Port the useful shape from the saved private-voice branch, with these requirements:

- Owner, replica, source, and enhanced artifact composite FKs.
- `request_hash`, `snapshot_hash`, `receipt_hash`, and `config_hash` as 64-character SHA-256 values.
- Canonical `receipt` containing `scope=private_voice_test`, `statement_set=private-own-voice/v1`, `method=account_attestation`, `own_voice_private_use=true`, and `identity_claim_allowed=false`, `release_eligible=false`, `training_allowed=false`.
- Canonical `config` containing the fixed Hindi text, `hindi_v3` model commitment, seed and style, plus the same three false claims.
- States `queued`, `claimed`, `running`, `ready`, `failed`, `unknown`, `revoked`; bounded lease fields; `expires_at`; `revoked_at`.
- A nullable unique `window_id` FK to `vy_voice_app_lifecycle`, and a bounded child-operation JSON array. The broker callback consumes a child atomically from this row, so the public preview authority table is unchanged.
- Server-selected output bucket/path, `output_write_not_after`, output hash, deletion time, protected-output receipt, metrics, and ratings. `ready` requires both output hash and final protection receipt.
- Output path fixed to `<owner>/<replica>/<source>/derived/private-voice/<run>.wav`.

The final protected-output receipt may contain the bounded segment receipts produced for the fixed short sample. It must be size-limited and sealed in the same transaction that changes `running` to `ready`. No row is inserted into the public generation receipt tables.

## End-to-end execution contract

1. Studio records 24 kHz PCM WAV and uses the existing `/api/replica-source` create, upload, and finalize flow. The deployed processing Job remains the only audio processor.
2. `GET /api/private-voice?replica_id=...` returns only eligible candidate IDs, duration, reference hash, snapshot hash, the fixed statement, and fixed config. It never returns storage locators.
3. Eligibility requires an owned `subject_mode=self` replica not being revoked or purged; current source capture consent; current account storage consent; a ready `memory` audio/video upload or import with no third parties; the latest completed real `enhance` WAV; completed real integrity and malware jobs; and exact source, artifact, job, attempt, hash, and manifest bindings. Identity, liveness, inference, biometric, and training are deliberately absent.
4. `POST action=generate` accepts only replica/source/artifact/run IDs, the expected snapshot hash, the exact statement-set ID, and the one true self-use attestation. It inserts or idempotently returns one queued row, then calls the in-process consumer kick. Returning 202 without that caller is a release failure.
5. The Azure CPU consumer claims the row with `FOR UPDATE SKIP LOCKED`, sets a bounded lease, and reruns the full authority query before reading bytes. A status poll also kicks a queued or expired-lease run, so a crash after admission is recoverable without another request ID.
6. The consumer reads the enhanced WAV from private storage and verifies MIME, size, duration, and SHA-256. It reserves the existing GPU meter, creates the existing app lifecycle row, and records the exact status and synthesis children in the private run in one transaction.
7. The existing UMI controller activates the exact pinned Hindi revision. The existing CPU broker admits each signed child through the Azure CPU callback, which atomically rechecks the private run, lease, current source/consents, lifecycle, supervisor heartbeat, body hash, and dispatch deadline before marking the child consumed.
8. Chatterbox receives the fixed text, `language_id=hi`, `model_arm=hindi_v3`, the frozen reference, and frozen settings. Unknown reference-language evidence keeps effective CFG at zero. No retained-owner transcript or settings transfer to another account.
9. The existing disclosure, watermark, manifest, signer, and commitment adapters protect PCM before storage. Add a private ledger adapter whose `open`, segment append, `seal`, and `abort` statements all recheck the run lease and private authority. It writes only the private run receipt fields.
10. Immediately before the create-only Blob PUT, renew `output_write_not_after` in SQL. After upload, settle `ready`, output hash, receipt, and measured metrics atomically under the same lease and authority. A lost acknowledgement becomes `unknown`; it is never replayed automatically.
11. Authenticated `GET action=audio` rechecks ownership, expiry, revocation, source authority, `ready`, output hash, and deletion state, then reads and hashes the exact WAV. The browser creates a Blob URL and plays it. No signed public URL is exposed.
12. Revoke first marks the run revoked and closes any open lifecycle window, then attempts output deletion. The cleanup/erasure worker retries deletion and records `output_deleted_at`; playback remains closed throughout.

## File change plan

Land route, consumer, result storage, and playback in one implementation change. Do not land another admission-only checkpoint.

- `db/migrations/172_private_voice_run.sql`, `db/schema.sql`: one private-run table and indexes; no identity or public-generation changes.
- `api/_private-voice-store.js`: port and update the saved candidate/admission logic; add claim, renew, child consume, protection ledger, settlement, playback authority, and cleanup statements.
- `api/_private-voice-handler.js`: candidates, generate, status, audio, rate, and revoke. Require the real Supabase user.
- `api/private-voice.js`, `api/_private-voice-proxy.js`: thin same-origin Vercel door and exact Azure Container Apps origin proxy. Preserve the bearer token; do not place Neon, Blob, ARM, or HMAC credentials in Vercel.
- `services/private-voice/server.mjs`: Supabase bearer verification, the private handler, worker kick/recovery, `/healthz`, and the signed allocation-admission callback.
- `services/private-voice/runtime.mjs`: DB claim through protected WAV settlement using `createSupervisedVoiceAppController`, `createGpuAllocationMeter`, and `createOpenChatterboxPreviewProvider`.
- `services/private-voice/lifecycle.mjs`: SQL lifecycle adapter over the existing allocation window and app lifecycle tables.
- `services/private-voice/Dockerfile` and `README.md`: build from the repository root with a positive file list. Reuse the existing CPU app and UMI; create no GPU or always-warm GPU setting.
- `api/_provenance/contracts.js`: add a closed `private_voice_sample` authorization that accepts only this run receipt, the owned eligible artifact, false public/training claims, and versions zero. It must not call the voice-preview identity/liveness authorization.
- `api/_provenance/private-voice-ledger.js`: private run ledger adapter. Leave the public Neon generation ledger unchanged.
- `api/_replica-source-erasure.js`, `api/_replica-full-erasure.js`, `scripts/relcheck.mjs`: close/revoke runs, wait for active leases and writes, enumerate reserved and completed output paths, delete bytes, then allow row cascades.
- `api/_voice-preview-result-cleanup.js` or a sibling private cleanup module called by the same existing sweep: claim expired/revoked private results and delete exact paths.
- Studio UI uses the parallel `PrivateVoicePanel` work: candidates, exact attestation, generate, polling, honest error class, saved audio, ratings, and revoke. It renders only under `VYAKTI_PRIVATE_VOICE_MODE=account-private` in the protected private environment.

The existing broker needs no protocol change. Its `OPEN_VOICE_ALLOCATION_ORIGIN` points to the CPU service admission callback. The CPU service must also host the existing supervisor callback under its UMI, and the independent supervisor process must heartbeat before dispatch. A consumer without the supervisor is incomplete.

## Acceptance and live prerequisites

Before any deployment, focused tests must use the real handler/store/runtime with synthetic SQL, Blob, ARM, broker, GPU, and protection transports. They must prove another owner cannot list, dispatch, read, rate, revoke, or erase a run; withdrawal wins between every authority check and effect; source erasure waits for active writes/windows; an expired or revoked grant cannot play; a lost write or ARM acknowledgement becomes unknown; disclosure and watermark failures never produce ready; and the Hindi arm refuses `en`.

Live SQL requires `EXPLAIN` for every new statement plus source and full erasure statements against the real database after the reviewed migration. A protected Preview deployment then needs existing secrets bound to the Azure CPU service without printing them: Neon, Supabase auth, replica storage, audio protection, commitment/watermark/signing, broker HMAC, exact Hindi plan/policy/budget, and the existing UMI. No fresh model download or retained-owner grant is required. The actual account must sign in, upload its own recording, retain current capture/storage consent, and tap the private self-use statement.

The first live canary necessarily activates the existing GPU and therefore needs separate spend authorization. Until that happens, report code and transport verification only. Do not claim likeness, Indian-accent quality, English quality, or superiority from offline tests.
