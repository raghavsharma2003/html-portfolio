# Private voice deployment packet, September 27

Read-only readiness assessment for backend `b3aa734036beb44dbff0f1600b78835b4084e90d`, integrated by root as `438f1b27`. This is not approval to deploy, migrate, initialize spend, start a supervisor or activate the GPU. The combined release gate is still root-owned.

## Verified existing resources

- Reuse `vyakti-internal-voice25`; one container `internal-voice`, 0.5 CPU/1Gi, min1/max1, existing narrowly scoped UMI. No second always-on CPU app is needed. Current image is `vyaktivoiceacr.azurecr.io/vyakti/internal-voice@sha256:8f416918a6cdadc2d0e9ad0cb52591db5498ac9f4a8b9b48aebedf30b614be1f`.
- Hindi app `vyakti-open-voice-hi` remains min0/max1. Its three revisions were all inactive with zero replicas. Selected revision remains `vyakti-open-voice-hi--0000002`; GPU image stays `sha256:9dc374366a6ac9c1d2569e4e824faca12321679e24941e4e345319aca8576b83`. No GPU write is needed for the CPU replacement.
- Broker `vyakti-open-voice-hi-gate` already uses the allocation-aware image `sha256:f691c507dc36d75b1729291183f72f3655c208339acc348fa848d692453f8c18` and has runtime/allocation origin bindings. Keep its image and hostname. Recheck the allocation origin equals the reused CPU hostname before deployment; presence alone is not equality evidence.
- UMI `vyakti-internal-voice25-id`, client `93535d5d-d17f-424e-bbfe-2340a53e8c13`, retains the exact GPU-scoped role: app read; revision read; replica read; revision activate; revision deactivate. No role creation, broader grant, personal Microsoft session or CLI login is required.
- No supervisor/watchdog/internal-voice Container Apps Job was present in the inspected resource group. An independent supervisor still must be run; the callback is not a deployed supervisor.
- Real `neondb` catalog reports private-run table absent. There are **zero `gpu-*` rows** in `vy_provider_budget`. Do not interpret the old CPU's configuration cap as a database balance or current spend authorization.

## Binding matrix

Values and hashes of secret values were never printed or written. Readability means the existing authenticated API returned a nonempty value in memory. It does not mean the downstream service was exercised.

| CPU binding | Existing source and result | Required operation after acceptance |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_KEY` | Existing CPU, readable; Vercel encrypted copies also readable | Preserve |
| `AZURE_REPLICA_STORAGE_ACCOUNT`, `AZURE_REPLICA_STORAGE_CONTAINER`, `AZURE_REPLICA_STORAGE_ACCOUNT_KEY` | Existing CPU, readable; key matches processing Job | Preserve |
| `OPEN_VOICE_HMAC_SECRET` | CPU, Hindi broker and GPU readable and equal | Preserve |
| `AZURE_OPEN_VOICE_ORIGIN`, `OPEN_VOICE_MODEL_ARM`, `VYAKTI_MODEL_SERVING`, `AZURE_VOICE_APP_ENABLED`, `AZURE_VOICE_APP_IDENTITY_CLIENT_ID` | Existing CPU, configured/readable | Preserve Hindi/Azure-only values |
| `AZURE_VOICE_APP_PLAN_JSON` | Existing exact GPU plan, readable | Fresh metadata comparison; preserve target/revision/scale/image |
| `NEON_URL` | Processing Job secret `neon-url`, readable; expected DB read verified | Copy in memory to new CPU secretRef |
| `AZURE_AUDIO_PROTECTION_HMAC_SECRET` | `vyakti-audio-protection` secret `protection-hmac`, readable | Copy in memory to CPU secretRef |
| `AZURE_AUDIO_PROTECTION_ORIGIN` | Existing protection app ingress; Vercel sensitive binding exists but is non-exportable | Derive HTTPS origin from the verified protection app ingress |
| `CRON_SECRET` | Existing vault `web-cron-secret`, enabled/readable | Copy in memory; share with independent supervisor |
| `REPLICA_WATERMARK_TOKEN_SECRET` | Existing vault `web-watermark-token-key`, enabled/readable | Copy in memory to CPU secretRef |
| `REPLICA_COMMITMENT_SECRET` | Existing vault `web-replica-commitment-key`, enabled/readable | Copy in memory to CPU secretRef |
| `VYAKTI_PRIVATE_VOICE_MODE` | Absent | Set `account-private` on CPU and protected Vercel Preview |
| `AZURE_VOICE_APP_BUDGET_ID` | Absent; no existing GPU budget row | Requires explicit reviewed budget initialization and matching policy ID |
| `AZURE_VOICE_APP_SUPERVISOR_ENABLED` | Absent | Set true only with independent supervisor ready |
| `AZURE_VOICE_APP_POLICY_JSON`, `AZURE_VOICE_APP_APPROVAL_SHA256` | Existing policy lacks budget ID and binds the retired Blob supervisor | Recompute with reviewed budget ID and new supervisor source; preserve numeric cost settings unless separately authorized |
| `VYAKTI_PRIVATE_VOICE_ORIGIN` | Absent on Preview | Set reused CPU HTTPS hostname |

Vault origin is `https://vyakti-webpreview-kv1729.vault.azure.net`. Versioned references are in the ignored sanitized source receipt. No owner needs to paste keys. Vercel Preview's sensitive variables are present but were not readable through its targeted decrypt API; use the verified existing Azure sources instead. The CPU UMI has GPU permissions, not an asserted Key Vault permission; copying the operator-readable values into Container App secrets avoids inventing a vault grant. Do not rotate values as part of this change.

Current CPU policy values: envelope900s, dispatch420s, rate462microusd/s, contingency2, limit1000000microusd, per-allocation estimate831600microusd, `hard_invoice_cap=false`. These are historical configuration and a planning estimate. The expired retained-owner grant is not authority for any new run or budget.

## Build and replacement sequence for review

The offline build packet contains32 exact committed source files, including the positive Docker COPY closure and the independent supervisor script. It excludes `_config.js`, credentials, recordings, tests and model weights. Root must regenerate/check it against the final accepted integration commit before submitting a build.

```powershell
node scripts/private-voice-build-packet27.mjs ACCEPTED_40_CHARACTER_COMMIT scratchpad/private-voice-final-build27
node scripts/private-voice-sql-packet27.mjs scratchpad/private-voice-final-sql27.json
```

The generated build JSON is the exact ACR `DockerBuildRequest` template: Linux/amd64, two build CPUs, timeout1200s, Dockerfile `services/private-voice/Dockerfile`, repository `vyakti/internal-voice`, positive archive, and immutable Node base `node:24.13.0-alpine3.23@sha256:cd6fb7efa6490f039f3471a189214d5f548c11df1ff9e5b181aa49e22c14383e`. It sets `submission_enabled=false`; no build was scheduled. Use a fresh root-reviewed ACR one-use intent and the existing pinned auth/build helper transport, then read back the registry digest and exact source closure. **Do not replay the September14 ACR/infra intents**, whose source and absent-target assumptions are obsolete.

After gates and separately approved prerequisite writes: refresh the existing CPU app twice and refuse observed drift; compose one existing-app update from current unowned fields, preserving identity, registry credentials, ingress, resources and min1/max1. Replace only its image/command/revision suffix and the reviewed environment/secret bindings. Command is `node services/private-voice/server.mjs`. Preserve secret values in memory and redact errors. JSON Merge Patch has no claimed atomic compare-and-swap guarantee; a concurrent edit after the final read remains a documented limitation. No new app, GPU/broker rebuild, GPU PATCH, scale change, model download or retained-reference prime is in this plan.

The supervisor source is `scripts/azure-voice-supervisor53.mjs`, SHA256 `584236ee8ecb3a24811aa7db5fcdfb3ae536115ff9eb227c00d39d4956a74a81`. For the first separately authorized canary, run it on an independent existing operator/CPU host, with `AZURE_VOICE_SUPERVISOR_ORIGIN` equal to the reused CPU origin, that exact `AZURE_VOICE_SUPERVISOR_SOURCE_SHA256`, and the existing cron secret in memory. Its command is:

```powershell
node scripts/azure-voice-supervisor53.mjs
```

The script lasts16minutes. Its30second heartbeat must be verified before dispatch and its cleanup must continue until terminal observation. Do not start it in this read-only phase: its callback can deactivate stale owned GPU windows. A durable production schedule remains a separate operational decision; a second always-on CPU app is unnecessary for the bounded canary.

## Migration and SQL packet

Migration172 has exactly three independent idempotent statements: table, owner index, queue index. Migration171 remains unused. Packet `sql-packet-final-20260927.json` contains these three statements plus35 exact parameterized EXPLAIN candidates, captured from the actual admission, execution, lifecycle, private protection, cleanup, and source/full-erasure functions with synthetic UUIDs. Its SHA256 is `92214bac0eb09d67d2727a715c9918c5cf8284913f2ca6e40aed90aaff069f37`.

After root reviews full gates and authorizes migration, use the existing Neon HTTP transport with the processing Job's already readable `NEON_URL` only in memory. Send each DDL statement separately, stop on the first error, and retain content-free acknowledgements. Then send each packet query as `EXPLAIN (FORMAT JSON) ` plus its exact SQL and parameters, **never ANALYZE**. Do not send EXPLAINs before the table exists or treat this packet generation as database proof. The packet generator has no database transport or migration execution mode.

Run `node scripts/relcheck.mjs` with the authorized in-memory DB binding after migration; the catalog owner-reach walk and private artifact/ready-output checks remain mandatory. Full accepted release gates, actual EXPLAINs, fresh image/binding readback, independent supervisor and a separately authorized real account/GPU canary are still outstanding.

## Local receipts and commands actually run

Ignored folder: `scratchpad/private-voice-readiness27/` in the backend checkout. `metadata-20260927.json` is the first nine-request Azure read; `bindings-20260927.json` adds supervisor/Preview metadata; `readable-20260927.json` records15ARM operations including five read-only listSecrets plus targeted Vercel reads; `sources-20260927.json` records ten final source/match/catalog/budget/vault reads. No cloud resource write, migration, supervisor start, model request, GPU activation or value/hash disclosure occurred.

Offline packets: `build-b3aa7340/build-packet.json`, archive SHA256 `031e972b70e9689a7557fdb75bf0bf070a90990db8c75934ce4ff4885dbb99fc`, and `sql-packet-final-20260927.json`. Read-only reproduction tools are `scripts/private-voice-readiness27.py` and `scripts/private-voice-secret-sources27.py`, each requiring the pinned existing auth helper path and a fresh scratchpad output. Optional Vercel access is also pinned. These are observations and deployment inputs, not a deploy-ready claim.
