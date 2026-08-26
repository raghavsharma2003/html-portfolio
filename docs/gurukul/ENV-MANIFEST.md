# ENV-MANIFEST — every env var the replica/voice lanes consume

SPEC-GURUKUL.md §4 called this out from the replica-lab audit: "~55 env vars
consumed by the replica lanes, none set anywhere; most fail closed by design.
`CRON_SECRET` alone silently 401s all five sweeps." This file is the single
place that claim now points at — every row below was verified against the
file:line that actually reads it, not copied from the spec's estimate. See
the discrepancy note at the bottom: the true count is higher, and depends on
whether you count the Vercel app alone or the six deployment targets together.

**How to read a row.** *Consumed at* is the exact file:line of the `env.X` /
`process.env.X` read, checked by opening the file, not inferred from a
provider name. *Required* means the code `throw`s/`fail()`s without it, so
the feature is unusable and (depending on where the throw sits) may 503 the
whole route. *Optional* means it degrades to a stated default or a disabled
state. *Deployment target* is which of the six places you'd actually set the
var: `vercel-app` (Vercel project env vars, read at request time — **not**
baked by `scripts/write-config.mjs**, see §14), or one of the five standalone
services' own container/App env.

A var appearing in two targets (e.g. `AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED`
in both `vercel-app` and `azure-verifier`) is **not** one setting — it is two
independent settings in two independent deployments that happen to share a
name. Setting one does not set the other. This has already bitten the
project once in spirit (`docs/CREDENTIALS.md`'s "one key doing two jobs"
family) and is flagged per-row below.

---

## 1. Foundry — claim extraction + dialogue generation (`vercel-app`)

The two LLM lanes ingestion (WS-F) and the Studio review step (WS-E) will
call: `api/_claim-extraction/registry.js` turns teacher uploads into cited
claims, `api/_dialogue/registry.js` is the sheet-authoring assist. Both are
Azure AI Foundry chat completions on the same resource, different
deployments.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `AZURE_FOUNDRY_ENDPOINT` | `api/_claim-extraction/registry.js:4`, `api/_dialogue/registry.js:4` | required | none — throws `claim_extractor_unavailable` / `dialogue_generator_unavailable` (503) | both lanes 503 |
| `AZURE_FOUNDRY_API_KEY` | `api/_claim-extraction/registry.js:6`, `api/_dialogue/registry.js:6` | required | same as above | same as above |
| `AZURE_FOUNDRY_CLAIM_MODEL` | `api/_claim-extraction/registry.js:5` | required | throws if unset | claim extraction 503s (dialogue unaffected) |
| `AZURE_FOUNDRY_DIALOGUE_MODEL` | `api/_dialogue/registry.js:5` | required | throws if unset | dialogue generation 503s (claim extraction unaffected) |

All three of endpoint/key/model are checked together per registry (`if
(!endpoint || !model || !apiKey) throw`) — a partial set is the same as none.

## 2. Foundry spend fencing (`vercel-app`)

`api/_provider-budget.js`'s `reserveFoundrySpend`/`beginFoundrySpend`/
`settleFoundrySpend`, called from `api/_replica-claims.js:212` and
`api/_replica-dialogue.js:216` — every Foundry call in §1 is fenced by this
before it can spend money.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `AZURE_REPLICA_BUDGET_ID` | `api/_provider-budget.js:25` | optional | defaults to `"azure-replica-grant-v1"` | none — cosmetic budget-row id only |
| `AZURE_REPLICA_APP_BUDGET_USD` | `api/_provider-budget.js:27` | required | throws `provider_budget_limit_required` | every fenced spend (Foundry, personal voice, fast transcription — §2/§8/§11) refuses to reserve |
| `AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS` | `api/_provider-budget.js:28` | required | throws `provider_input_rate_required` | Foundry reservation refuses |
| `AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS` | `api/_provider-budget.js:29` | required | throws `provider_output_rate_required` | Foundry reservation refuses |

`AZURE_REPLICA_APP_BUDGET_USD` is shared across all three budgeted
subsystems (Foundry, Azure Personal Voice, fast transcription) — one shared
dollar ceiling, `AZURE_REPLICA_BUDGET_ID` scoped, per `vy_provider_budget`.

## 3. Identity verification (`vercel-app`)

`api/_identity/registry.js` → `api/_identity/providers/azure-composite.js`.
Consumed by the Studio identity-check flow and by `api/replica-identity-sweep.js`
(one of the five cron sweeps).

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `REPLICA_IDENTITY_VERIFIER` | `api/_identity/registry.js:5` | optional (switch) | unset → `configuredIdentityVerifier()` returns `null`; identity sweep answers `{ok:true, disabled:true}` | identity verification silently off, not broken — the sweep no-ops cleanly |
| `AZURE_COMPOSITE_IDENTITY_ENABLED` | `api/_identity/providers/azure-composite.js:39` | required (once the switch above is set to `azure_identity_composite`) | throws `azure_composite_identity_disabled`-shaped fail if not `"true"` | provider construction 503s |
| `AZURE_IDENTITY_REVIEW_PATH_APPROVED` | `api/_identity/providers/azure-composite.js:41` | required | throws if not `"true"` | provider construction 503s — **and per `services/azure-verifier/README.md`, this must stay `false` in production until the independent document-review service (§16) is deployed and adversarially tested; setting it true prematurely is a release blocker, not a config nicety** |
| `AZURE_COMPOSITE_IDENTITY_ENDPOINT` | `api/_identity/providers/azure-composite.js:44` | required | throws on invalid/missing URL | provider construction 503s |
| `AZURE_COMPOSITE_IDENTITY_HMAC_KEY_B64` | `api/_identity/providers/azure-composite.js:45` | required | throws on invalid/missing key | provider construction 503s |
| `AZURE_COMPOSITE_IDENTITY_VERSION` | `api/_identity/providers/azure-composite.js:46` | required | throws on invalid/missing pinned version | provider construction 503s |

`REPLICA_IDENTITY_VERIFIER` must be the literal string `azure_identity_composite`
— any other non-empty value throws `identity_verifier_unsupported` (503).

## 4. Liveness verification (`vercel-app`)

`api/_liveness/registry.js` → `api/_liveness/providers/azure-composite.js`.
Consumed by `api/replica-liveness-sweep.js`.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `REPLICA_LIVENESS_VERIFIER` | `api/_liveness/registry.js:5` | optional (switch) | unset → sweep answers `{ok:true, disabled:true}` | liveness verification silently off |
| `AZURE_COMPOSITE_LIVENESS_ENABLED` | `api/_liveness/providers/azure-composite.js:39` | required once switched on | throws if not `"true"` | provider construction 503s |
| `AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED` | `api/_liveness/providers/azure-composite.js:41` (**and** `api/_face-session/providers/azure-quicklink.js:44`, **and** `services/azure-verifier/src/config.js:70` — three independent reads of the same name in three deployments) | required | throws if not `"true"` | provider construction 503s in whichever deployment is missing it |
| `AZURE_COMPOSITE_LIVENESS_ENDPOINT` | `api/_liveness/providers/azure-composite.js:44` | required | throws | provider construction 503s |
| `AZURE_COMPOSITE_LIVENESS_HMAC_KEY_B64` | `api/_liveness/providers/azure-composite.js:45` | required | throws | provider construction 503s |
| `AZURE_COMPOSITE_LIVENESS_VERSION` | `api/_liveness/providers/azure-composite.js:46` | required | throws | provider construction 503s |

`AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED` is the flag SPEC §4 calls "a
manual gate not yet requested" — it must be `"true"` in **every** deployment
target that reads it (the Vercel app twice, over two different registries,
plus the azure-verifier service) before any Face liveness path activates
anywhere. See §22c for the Microsoft approval this represents.

## 5. Face session broker (`vercel-app`)

`api/_face-session/registry.js` → `api/_face-session/providers/azure-quicklink.js`.
Consumed by `api/replica-face-session-sweep.js` and by the erasure sweep's
Face-fenced cleanup (`api/replica-erasure-sweep.js`).

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `REPLICA_FACE_SESSION_BROKER` | `api/_face-session/registry.js:5,15` | optional (switch) | unset → both broker functions return `null`; face-session sweep and the erasure sweep's Face cleanup both answer `{disabled:true}` | face-session lane silently off |
| `AZURE_FACE_SESSION_BROKER_ENABLED` | `api/_face-session/providers/azure-quicklink.js:41` | required once switched on | throws if not `"true"` | broker construction 503s |
| `AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED` | `api/_face-session/providers/azure-quicklink.js:44` | required | throws — shared name, see §4 | broker construction 503s |
| `AZURE_FACE_DEDICATED_RESOURCE` | `api/_face-session/providers/azure-quicklink.js:46` | required | throws if not `"true"` | broker construction 503s — deliberate: the README requires a Face resource dedicated to this verifier so orphan cleanup can safely enumerate-and-delete |
| `AZURE_FACE_SESSION_BROKER_ORIGIN` | `api/_face-session/providers/azure-quicklink.js:49` | required | throws on invalid origin | broker construction 503s |
| `AZURE_FACE_SESSION_BROKER_HMAC_KEY_B64` | `api/_face-session/providers/azure-quicklink.js:50` | required | throws | broker construction 503s |
| `AZURE_FACE_DEVICE_CORRELATION_HMAC_KEY_B64` | `api/_face-session/providers/azure-quicklink.js:51` | required | throws | broker construction 503s |
| `AZURE_FACE_SESSION_BROKER_VERSION` | `api/_face-session/providers/azure-quicklink.js:52` | required | throws | broker construction 503s |
| `AZURE_FACE_LIVENESS_MODEL_VERSION` | `api/_face-session/providers/azure-quicklink.js:53` | required | throws | broker construction 503s |

## 6. Provenance / protection — watermark + C2PA, app side (`vercel-app`)

`api/_provenance/registry.js` → `api/_provenance/providers/azure-protection.js`
(the client of the standalone `audio-protection` service, §18). Consumed by
every route that must protect disclosed replica audio before it reaches a
browser (`api/replica-voice-preview.js` among them). Registry doc comment:
"Production protection is all-or-nothing... There is deliberately no
local/fake fallback in this registry."

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `AZURE_AUDIO_PROTECTION_ORIGIN` | `api/_provenance/providers/azure-protection.js:23` | required | throws `open_voice_origin_required`-shaped fail on invalid URL | protection adapters unavailable (503) — no route can deliver replica audio |
| `AZURE_AUDIO_PROTECTION_HMAC_SECRET` | `api/_provenance/providers/azure-protection.js:32` | required | throws `audio_protection_hmac_secret_required` | same |
| `REPLICA_WATERMARK_TOKEN_SECRET` | `api/_provenance/providers/azure-protection.js:33` | required | throws `watermark_token_secret_required` | same |
| `REPLICA_COMMITMENT_SECRET` | `api/_provenance/providers/azure-protection.js:34` | required | throws `replica_commitment_secret_required` | same |
| `REPLICA_PROTECTION_MAX_PCM_BYTES` | `api/_provenance/providers/azure-protection.js:27` | optional | defaults to `33_554_432` (32 MiB) | none |

## 7. Voice: Azure Personal Voice (`vercel-app`) — Microsoft Limited Access

`api/_voice/registry.js` → `api/_voice/providers/azure-personal-voice.js`.
The provider strategy SPEC §2.5 calls "pending Microsoft approval."

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `AZURE_PERSONAL_VOICE_ENABLED` | `api/_voice/providers/azure-personal-voice.js:49` | required | throws `azure_personal_voice_disabled` if not `"true"` | provider construction 503s |
| `AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED` | `api/_voice/providers/azure-personal-voice.js:51` | required | throws `azure_personal_voice_approval_required` if not `"true"` | provider construction 503s — the Microsoft approval gate, see §22c |
| `AZURE_PERSONAL_VOICE_ENDPOINT` | `api/_voice/providers/azure-personal-voice.js:54` (creation) and `:82` (erasure — separate, smaller config) | required | throws `azure_personal_voice_endpoint_required` | creation AND deletion both 503 |
| `AZURE_PERSONAL_VOICE_TTS_ENDPOINT` | `api/_voice/providers/azure-personal-voice.js:59` | required (creation config only) | throws | creation/synthesis 503s; **erasure is unaffected — deliberately smaller config surface, see below** |
| `AZURE_PERSONAL_VOICE_KEY` | `api/_voice/providers/azure-personal-voice.js:63` (creation) and `:86` (erasure) | required | throws `azure_personal_voice_key_required` | creation AND deletion both 503 |
| `AZURE_PERSONAL_VOICE_PROJECT_ID` | `api/_voice/providers/azure-personal-voice.js:65` | required (creation only) | throws | creation 503s |
| `AZURE_PERSONAL_VOICE_COMPANY_NAME` | `api/_voice/providers/azure-personal-voice.js:66` | required (creation only) | throws, max 80 chars | creation 503s |
| `AZURE_PERSONAL_VOICE_BASE_MODEL` | `api/_voice/providers/azure-personal-voice.js:68` | required (creation only) | throws; also rejects a model string containing `"latest"` — must be version-pinned | creation 503s |
| `SUPABASE_URL` | `api/_voice/providers/azure-personal-voice.js:71` | required (creation only, shared Meera var) | throws `private_storage_origin_required` if not a valid `https://` URL | creation 503s |

**Erasure has a deliberately smaller config surface** (`azurePersonalVoiceErasureConfig`,
lines 80-89): only `AZURE_PERSONAL_VOICE_ENDPOINT` + `AZURE_PERSONAL_VOICE_KEY`.
The comment at line 76 is explicit: turning off new cloning, losing approval,
or misconfiguring TTS/model must never block deletion of an already-created
biometric voice. Do not assume the full creation var set is needed to revoke.

## 8. Voice: Azure Personal Voice spend fencing (`vercel-app`)

`api/_provider-budget.js`'s `reserveAzurePersonalVoiceSpend`/`...settle...`.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `AZURE_REPLICA_BUDGET_ID` | `api/_provider-budget.js:47` | optional | see §2 | shared budget id |
| `AZURE_REPLICA_APP_BUDGET_USD` | `api/_provider-budget.js:49` | required | throws | reservation refuses, see §2 |
| `AZURE_PERSONAL_VOICE_USD_PER_PROFILE` | `api/_provider-budget.js:50` | required | throws `provider_voice_profile_rate_required` | voice-training reservation refuses |
| `AZURE_PERSONAL_VOICE_SYNTHESIS_USD_PER_MCHARACTERS` | `api/_provider-budget.js:52` | required | throws `provider_synthesis_rate_required`-shaped fail | synthesis reservation refuses |

## 9. Voice: Chatterbox preview — self-hosted, **no Microsoft approval gate** (`vercel-app`)

`api/_voice/providers/open-chatterbox-preview.js`, invoked directly (not
through `api/_voice/registry.js`'s provider switch) from
`api/replica-voice-preview.js:9,85`. This is the client half of the
`open-voice-runtime` service (§19) — the origin var name says "AZURE" because
the admission broker runs on Azure Container Apps, but the model itself is
the self-hosted Chatterbox Multilingual V3, not an Azure cognitive service.
SPEC §2.5 calls this "the approval-free lane."

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `AZURE_OPEN_VOICE_ORIGIN` | `api/_voice/providers/open-chatterbox-preview.js:30` | required | throws `open_voice_origin_required` on invalid URL | `createOpenChatterboxPreviewProvider()` throws; `/api/replica-voice-preview` 503s |
| `OPEN_VOICE_HMAC_SECRET` | `api/_voice/providers/open-chatterbox-preview.js:36` | required | throws `open_voice_hmac_secret_required` (min 32 bytes decoded) | same |

`api/replica-voice-preview.js` also needs the full §6 protection stack
(watermark/C2PA) and §12 storage stack to actually deliver a preview — a
Chatterbox-only deploy still needs those, they are not gated behind
Microsoft approval either.

## 10. Voice evidence extraction — client side (`vercel-app`)

`api/_replica-processing/providers/azure-voice-evidence.js` — the app's
client of the standalone `voice-evidence` service (§17), called from the
processing pipeline (`api/_replica-processing/runtime.js`) and, separately,
by the standalone worker's own copy of this same file (§20).

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `AZURE_VOICE_EVIDENCE_ORIGIN` | `api/_replica-processing/providers/azure-voice-evidence.js:25` | required | throws on invalid URL | evidence adapters unavailable |
| `AZURE_VOICE_EVIDENCE_HMAC_SECRET` | `api/_replica-processing/providers/azure-voice-evidence.js:40` | required | throws | same |
| `VOICE_EVIDENCE_MAX_AUDIO_BYTES` | `api/_replica-processing/providers/azure-voice-evidence.js:30` | optional | defaults to `33_554_432` | none |
| `VOICE_EVIDENCE_TIMEOUT_MS` | `api/_replica-processing/providers/azure-voice-evidence.js:31` | optional | defaults to `600_000` (10 min) | none |

## 11. Voice evidence spend fencing — fast transcription (`vercel-app` + `processing-worker`)

`api/_provider-budget.js`'s `reserveAzureFastTranscriptionSpend` (function
name inferred from the pattern at lines 39-42; called with `budgetEnv` from
`services/replica-processing-worker/run-once.js:61`).

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `AZURE_REPLICA_BUDGET_ID` | `api/_provider-budget.js:39` | optional | see §2 | shared budget id |
| `AZURE_REPLICA_APP_BUDGET_USD` | `api/_provider-budget.js:41` | required | throws | reservation refuses |
| `AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR` | `api/_provider-budget.js:42` | required | throws `provider_audio_rate_required` | transcription reservation refuses — the worker cannot bill the Foundry-adjacent budget for Azure Speech time |

## 12. Replica private storage (`vercel-app` + `processing-worker`)

`api/_replica-storage.js` — the Supabase-backed private bucket every replica
subsystem reads/writes source and derived artifacts through.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `REPLICA_STORAGE_BUCKET` | `api/_replica-storage.js:1` | optional | defaults to `"vyakti-replica-private"` | none, unless the actual bucket has a different name — then every read/write 404s |
| `SUPABASE_URL` | `api/_replica-storage.js:25` (shared Meera var, also read directly by `api/_voice/providers/azure-personal-voice.js:71`) | required | falls back to `config.SUPABASE_URL` (the gitignored `api/_config.js`), then empty | storage calls fail — enrollment, evidence, and voice preview all depend on this |
| `SUPABASE_SERVICE_ROLE_KEY` | `api/_replica-storage.js:30` | required | falls back to `config.SUPABASE_SERVICE_ROLE_KEY`, then empty | same — **deliberately distinct from `SUPABASE_KEY`**: `api/_config.example.js`'s own comment says biometric storage never guesses that the general app key is privileged |

## 13. Encryption-at-rest — three independent KEKs (`vercel-app`)

Each pair is a 32-byte key-encryption-key wrapping a different sensitive
column family. They are intentionally not one shared key — a compromise or
rotation of one does not touch the others.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `REPLICA_PROVIDER_CONSENT_KEK_ID` / `REPLICA_PROVIDER_CONSENT_KEK_B64` | `api/_replica-provider-consent-crypto.js:11-12` | required (both) | throws `provider_consent_encryption_key_id_required` / `..._key_required` | provider consent records cannot be sealed/opened |
| `REPLICA_FEEDBACK_KEK_ID` / `REPLICA_FEEDBACK_KEK_B64` | `api/_replica-feedback-crypto.js:10-11` | required (both) | throws `feedback_encryption_key_id_required` / `..._key_required` | turn feedback dataset cannot be sealed/opened |
| `REPLICA_EVAL_KEK_ID` / `REPLICA_EVAL_KEK_B64` | `api/_replica-candidate-eval-crypto.js:11-12` | required (both) | throws `candidate_eval_encryption_key_id_required` / `..._key_required` | candidate qualification/owner-eval records cannot be sealed/opened |

`*_KEK_B64` must decode to exactly 32 bytes; `*_KEK_ID` must match
`/^[A-Za-z0-9._-]{3,80}$/`. All three throw rather than degrade — there is no
"read without decrypting" mode.

## 14. Erasure (`vercel-app`)

`api/_replica-full-erasure.js` (the receipt/finalizer) and
`api/replica-erasure-sweep.js` (the cron handler, one of the five sweeps).

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `REPLICA_ERASURE_RECEIPT_KEY_B64` | `api/_replica-full-erasure.js:23` | required | throws `erasure_receipt_key_required` unless it decodes to exactly 32 bytes | `createReplicaErasureReceipt` throws — the erasure **finalizer** step of the sweep fails even though prepare/provider-cleanup steps ran |
| `REPLICA_BACKUP_RETENTION_DAYS` | `api/_replica-full-erasure.js:25` | required | throws `backup_retention_policy_required` unless an integer 1-90 | same — finalizer fails |
| `REPLICA_ERASURE_SECRET` | `api/replica-erasure-sweep.js:19` | optional (alt auth) | `authorizedReplicaErasure` accepts **either** this **or** `CRON_SECRET` | if neither is set, the sweep 403s on every cron tick |
| `REPLICA_ERASURE_KILL` | `api/replica-erasure-sweep.js:29` | optional (kill switch) | unset/false → sweep runs normally; `"1"/"true"/"yes"` → sweep answers `{ok:true, disabled:true}` without touching anything | none |

## 15. Cron auth — the vercel-env-only var (`vercel-app`, **not** baked by `write-config.mjs`)

`CRON_SECRET` authenticates every `vercel.json` cron hit (`GET`/`POST` with
`Authorization: Bearer <secret>`, `timingSafeEqual`-compared, minimum 24
bytes). **Checked before adding it to `scripts/write-config.mjs`'s `STRINGS`
list, per this workstream's instructions: every one of the six consumers
below reads `process.env.CRON_SECRET` directly at request time — none of
them import `api/_config.js`.** Vercel serverless functions receive Project
→ Environment Variables directly as `process.env` at runtime, so this var
belongs entirely to the Vercel dashboard (or `vercel env add CRON_SECRET
production`), not to the gitignored, deploy-time-baked config file. Adding it
to `write-config.mjs` would be redundant at best and, because that file
writes a **committed-shape** module rather than reading env at request time,
would freeze a value into the deployed bundle instead of letting Vercel's own
per-environment secret rotate independently — so it was deliberately left
alone; see the commit on `scripts/write-config.mjs` for the one-line pointer
back to this file.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `CRON_SECRET` | `api/replica-identity-sweep.js:7`, `api/replica-face-session-sweep.js:9`, `api/replica-liveness-sweep.js:7`, `api/replica-model-build-sweep.js:6`, `api/channel-ingest-sweep.js:19`, `api/replica-erasure-sweep.js:19` (OR'd with `REPLICA_ERASURE_SECRET`), and pre-existing `api/consolidate-sweep.js:117` | required (5 of 6 sweeps have no alternate; erasure alone has one) | unset → `expected.length` is 0, `timingSafeEqual`'s length check fails first, every cron call gets 401 (`replica-erasure-sweep.js` gets 403 via its own comparator) | **this is the exact failure SPEC §4 names**: all five replica sweeps silently 401/403 forever, on schedule, with no error surfaced anywhere except a Vercel cron-invocation log nobody is watching |

## 15b. Channel watch + ASR — the stays-current loop (`vercel-app`)

Gurukul WS-I. `SPEC-GURUKUL.md` §8 item 3: "Channel link → new-video
detection → re-ingestion → PROPOSED claims/sheet deltas the expert approves
— never silent self-update of a live persona." Two seams, both fail-closed,
both following `api/_claim-extraction/registry.js`'s pattern: the registry
reads env and throws a coded 503 when it is incomplete, and neither registry
imports a fixture provider, so no variable below can be *un*set into a
fixture lane.

`/api/channel-ingest-sweep` is registered in `vercel.json` crons at
`0 */6 * * *` and is authenticated by **`CRON_SECRET`** (§15) — the same
comparator, the same 24-byte minimum, added to that row's consumer list.

### Channel provider — YouTube Data API v3, acting as the channel's owner

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `YOUTUBE_OAUTH_CLIENT_ID` | `api/_channel/registry.js:14` | required | none — throws `channel_provider_unavailable` (503) | the sweep answers `{ok:true, disabled:true}`; no channel is ever listed |
| `YOUTUBE_OAUTH_CLIENT_SECRET` | `api/_channel/registry.js:15` | required | same as above | same as above |

Both are checked together (`if (!clientId || !clientSecret) throw`) — a
partial set is the same as none.

**Not an env var, and deliberately so:** the teacher's OAuth **refresh
token**. Migration 053 stores `vy_channel_watch.oauth_grant_ref` as a `uuid`
— a reference and never a credential, enforced by the column type rather
than by a comment — and
`api/_channel/providers/youtube-oauth.js` takes an injected `grantStore`
(`refreshToken(grantRef)`) rather than reading a token from a row or from
the environment. The vault behind that seam belongs to the consent lane
(WS-E), where every other credential for a real named person already lives.
Without a grant store the provider fails closed with
`channel_oauth_grant_store_unavailable`.

### ASR — self-hosted first, Sarvam Saaras second

`api/_asr/registry.js` prefers the self-hosted lane whenever it is
configured, per SPEC §8 item 1's in-house directive. That order is a
**strategy** decision (vendor independence), not a quality claim: nothing has
yet measured the in-house lane against Sarvam on this corpus, and the first
measurement that does belongs in `context/measurements.md` with n, method and
date.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `ASR_SELF_HOSTED_ORIGIN` | `api/_asr/registry.js:28`, `api/_asr/providers/self-hosted.js:72` | optional (lane selector) | absent → the Sarvam lane is used | in-house lane unreachable; throws `asr_origin_required` if set but not a bare `https://` origin |
| `ASR_HMAC_SECRET` | `api/_asr/registry.js:28`, `api/_asr/providers/self-hosted.js:79` | required *with* the origin | throws `asr_hmac_secret_required` (min 32 bytes decoded, hex or base64url) | in-house lane 503s |
| `ASR_SELF_HOSTED_MODEL` | `api/_asr/providers/self-hosted.js:80` | optional | `"indic-conformer-hinglish-v1"` | none — but the value is asserted against the runtime's echoed `model`, so a mismatch fails `asr_response_binding_invalid` |
| `ASR_SELF_HOSTED_MODEL_COMMITMENT` | `api/_asr/providers/self-hosted.js:81` | optional | `""` → the commitment check is skipped | the transcript no longer names the exact weights that produced it, which is what SPEC §8 item 2's per-clone fidelity recomputation rests on |
| `SARVAM_API_KEY` | `api/_asr/registry.js:31` | required for the Sarvam lane | none — throws `asr_provider_unavailable` (503) | with no self-hosted origin either, the sweep answers `{ok:true, disabled:true}` |
| `SARVAM_ASR_MODEL` | `api/_asr/registry.js:35` | optional | `"saaras:v3"` | none |
| `SARVAM_API_ORIGIN` | `api/_asr/providers/sarvam-saaras.js:91` | optional | `"https://api.sarvam.ai"` | none — it exists so the endpoint-path verification below does not require a code change |

`ASR_HMAC_SECRET` is a **third independent secret** from
`OPEN_VOICE_HMAC_SECRET` (§9) and `AZURE_AUDIO_PROTECTION_HMAC_SECRET` (§6),
in the sense this file's header sets out: same mechanism, different
deployments, and setting one does not set the others.

**Two flags carried from `docs/gurukul/ingestion-research.md` §3, restated
here because a caveat that lives only in a research doc is a caveat nobody
reads at the moment it matters:**

1. The Sarvam lane is **not** wired into `api/_provider-budget.js`'s spend
   fencing, unlike every Foundry and Personal Voice call (§2, §8). §3's own
   pricing figures conflict by 3x (₹30/hr vs ₹1.5/min = ₹90/hr) and a fence
   built on a rate that might be wrong reports a budget it is not holding.
   Resolving the real rate and adding the fence is a prerequisite for the
   first paid run.
2. The Sarvam batch endpoint **paths** in `providers/sarvam-saaras.js` are
   coded from §3's account of the API, not from a request that has been made.
   The protocol SHAPE (init → upload → start → poll → fetch) is what
   determines the file's structure and failure modes and is not in doubt; the
   exact path strings must be checked against Sarvam's live docs first.

## 16. azure-verifier — standalone service, its own deployment (`azure-verifier`)

`services/azure-verifier/src/config.js:57-124`. Node 24, one Container App,
scale-to-zero-with-max-one-replica (the in-memory ten-minute replay fence
cannot be split across replicas). This is the deployable backend of the
`azure_identity_composite` adapter (§3) and the `azure_face_speech_composite`
adapter (§4) — a **separate Azure deployment** the Vercel app calls over
HTTPS, not a Vercel function.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `PORT` | `config.js:75` | optional | defaults `8080`, bounded 1-65535 | none |
| `VYAKTI_PRIVATE_SOURCE_ORIGIN` | `config.js:58` | required | throws `source_origin_required` | service fails to start |
| `VYAKTI_BROKER_HMAC_KEY_B64` | `config.js:77` | required | throws `broker_hmac_key_required` | service fails to start |
| `VERIFIER_VERSION` | `config.js:66` | required | throws `verifier_version_required` (must not contain `latest`/`preview-head`) | service fails to start |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | `config.js:81` | required | throws | service fails to start |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY` | `config.js:82` | required | throws | service fails to start |
| `DOCUMENT_POLL_MS` | `config.js:85` | optional | defaults `500`, bounded 100-2000 | none |
| `DOCUMENT_MAX_POLLS` | `config.js:86` | optional | defaults `24`, bounded 2-60 | none |
| `AZURE_FACE_ENDPOINT` | `config.js:89` | required | throws | service fails to start |
| `AZURE_FACE_KEY` | `config.js:90` | required | throws | service fails to start |
| `AZURE_FACE_LIVENESS_ENABLED` | `config.js:67` | optional | defaults `false` (README ships it `false`) | liveness stays disabled — safe default |
| `AZURE_FACE_LIVENESS_ERASURE_ENABLED` | `config.js:68-69` | optional | defaults `false`, but forced `true` whenever `AZURE_FACE_LIVENESS_ENABLED` is `true` | see the README's two-phase shutdown note — erasure must outlive create |
| `AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED` | `config.js:70` | required *if* `AZURE_FACE_LIVENESS_ENABLED=true` | throws `face_liveness_approval_required` | new liveness sessions cannot start — this service's own copy of the gate in §4/§22c |
| `AZURE_FACE_DEDICATED_RESOURCE` | `config.js:72` | required *if* liveness-erasure is enabled | throws `face_liveness_dedicated_resource_required` | same shared name as §5, independent setting |
| `AZURE_FACE_LIVENESS_MODEL_VERSION` | `config.js:99` | required *if* liveness-erasure is enabled | throws | same |
| `AZURE_FACE_VERIFY_CONFIDENCE_THRESHOLD` | `config.js:100` | required *if* liveness-erasure is enabled | throws unless in 0.9-0.99 | same |
| `AZURE_FACE_LIVENESS_SESSION_TTL_SECONDS` | `config.js:101` | required *if* liveness-erasure is enabled | throws unless in 60-600 | same |
| `AZURE_LIVENESS_SESSION_SEAL_KEY_B64` | `config.js:102` | required *if* liveness-erasure is enabled | throws — 32-byte key, **must differ from `VYAKTI_BROKER_HMAC_KEY_B64`** (README: "separate 32 random bytes") | same |
| `VYAKTI_PUBLIC_APP_ORIGIN` | `config.js:104` | required *if* `AZURE_FACE_LIVENESS_ENABLED=true` | throws `public_app_origin_required` on invalid `https://` origin | the liveness return URL cannot be built |
| `AZURE_DOCUMENT_REVIEW_ENDPOINT` | `config.js:60-65` | required | throws `document_review_endpoint_required` | service fails to start — **this is the "independently deployed... review service" the README calls out; it does not exist anywhere in this tree, see §22 discrepancy** |
| `AZURE_DOCUMENT_REVIEW_HMAC_KEY_B64` | `config.js:112` | required | throws | service fails to start |
| `AZURE_DOCUMENT_REVIEW_VERSION` | `config.js:113` | required | throws (pinned, no `latest`) | service fails to start |
| `MAX_IDENTITY_BYTES` | `config.js:117` | optional | defaults `52_428_800` (50 MiB), bounded | none |
| `MAX_CONCURRENCY` | `config.js:122` | optional | defaults `2`, bounded 1-4 | none |

## 17. voice-evidence — standalone GPU service (`voice-evidence`)

`services/voice-evidence/app.py`. Private ingress only, one GPU replica,
scale-to-zero. The client side is §10 (app) and part of §20 (worker).

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `AZURE_VOICE_EVIDENCE_HMAC_SECRET` | `app.py:339` (via `_secret()`) | required | `RuntimeError` at startup if unset/short | service fails to start |
| `VOICE_EVIDENCE_MAX_AUDIO_BYTES` | `app.py:40` | optional | defaults 32 MiB, clamped 1 MiB-48 MiB | none |
| `VOICE_EVIDENCE_MAX_DURATION_SECONDS` | `app.py:41` | optional | defaults 600s, clamped 10s-1200s | none |
| `VOICE_EVIDENCE_REQUIRE_CUDA` | `app.py:341` | optional | defaults `"true"`; startup fails if `true` and no CUDA device | GPU-only guard — README requires `true` in production |
| `VOICE_EVIDENCE_MODEL_ROOT` | `app.py:343`, `fetch_models.py:43` | optional | defaults `/models/voice-evidence` | wrong path → model load fails at startup |
| `VOICE_EVIDENCE_MAX_SPEAKERS` | `app.py:351` | optional | defaults `4`, clamped 1-8 | none |
| `VOICE_EVIDENCE_CLUSTER_COSINE_THRESHOLD` | `app.py:352` | optional | defaults `0.68` | none |

## 18. audio-protection — standalone GPU service (`audio-protection`)

`services/audio-protection/app.py`. No public ingress, fail-closed at
startup. The client side is §6.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `AZURE_AUDIO_PROTECTION_HMAC_SECRET` | `app.py:284` (via `_secret()`) | required | `RuntimeError` at startup | service fails to start |
| `AZURE_KEY_VAULT_KEY_ID` | `app.py:285` | required | `KeyError` at startup (`os.environ[...]`, no default) | service fails to start — signing key |
| `C2PA_SIGN_CERTIFICATE_B64` | `app.py:286` | required | `KeyError` at startup | service fails to start — C2PA manifest cert chain |
| `PUBLIC_APP_ORIGIN` | `app.py:288` | required | `KeyError` at startup | service fails to start — public manifest origin |
| `C2PA_TIMESTAMP_URL` | `app.py:287` | optional | defaults `http://timestamp.digicert.com` | none |
| `AUDIO_PROTECTION_MAX_PCM_BYTES` | `app.py:40` | optional | defaults 32 MiB, clamped 1 MiB-64 MiB | none |
| `AUDIO_PROTECTION_REQUIRE_CUDA` | `app.py:294` | optional | defaults `"true"`; startup fails without CUDA if true | README: fail-closed without CUDA in production |
| `AUDIOSEAL_GENERATION_MIN_CONFIDENCE` | `app.py:298` | optional | defaults `0.80` | none |

## 19. open-voice-runtime — standalone GPU service + admission broker, two apps (`open-voice-runtime`)

`services/open-voice-runtime/app.py` (private GPU runtime, never internet
reachable) and `services/open-voice-runtime/broker.py` (small public CPU
admission broker that validates the HMAC before forwarding). The client side
is §9.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `OPEN_VOICE_HMAC_SECRET` | `broker.py:46` | required | fails closed on empty/short secret | broker rejects everything |
| `OPEN_VOICE_RUNTIME_ORIGIN` | `broker.py:57` | required | fails closed on empty origin | broker cannot reach the private GPU app |
| `OPEN_VOICE_REQUIRE_CUDA` | `app.py:264` | optional | defaults `"true"`; startup fails without CUDA if true | README requires `true` in every deployed environment |
| `OPEN_VOICE_MODEL_ROOT` | `app.py:266` | optional | defaults `/models/chatterbox-multilingual-v3` | wrong path → model load fails at startup |
| `OPEN_VOICE_PERTH_MIN_SCORE` | `app.py:271` | optional | defaults `0.5` | README recommends raising this only after a measured threshold |

The application plane's `AZURE_OPEN_VOICE_ORIGIN` (§9) must point at the
**broker's** public admission origin — the README explicitly warns never to
point it at the private `OPEN_VOICE_RUNTIME_ORIGIN` (that's the broker→GPU
hop, not the app→broker hop).

## 20. processing-worker — standalone Container Apps Job (`processing-worker`)

`services/replica-processing-worker/run-once.js` (entry point, via
`entrypoint.sh`'s ClamAV readiness loop) and `services/replica-processing-worker/db.js`.
This is a scheduled/event-driven job, not a long-running server — idle cost
is zero. It imports and reuses the **same** `api/_replica-processing/providers/*`
and `api/_replica-storage.js` modules the Vercel app uses (repo-root import,
`services/replica-processing-worker/run-once.js:1-6`), so every var in §10
and §12 applies here too, read from this job's own env, not the Vercel app's.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `NEON_URL` | `db.js:2` (shared Meera var, own copy in this deployment) | required | throws `neon_url_required` / `neon_url_invalid` | job cannot lease or write jobs at all |
| `CLAMAV_ADAPTER_VERSION` | `run-once.js:20` | optional | defaults `"clamav-debian12"` | cosmetic — recorded as the malware-scan adapter version, not a functional gate (ClamAV itself is a hard dependency via `entrypoint.sh`, not this var) |
| `FFPROBE_ADAPTER_VERSION` | `run-once.js:21` | optional | defaults `"ffprobe-debian12"` | cosmetic, same reasoning |
| `AZURE_SPEECH_ENDPOINT` | `run-once.js:25` | required (transcription step) | undefined passed through; the transcription adapter will fail at call time, not at startup | Hinglish transcription step fails; earlier DAG stages (integrity, malware, probe, evidence) are unaffected |
| `AZURE_SPEECH_KEY` | `run-once.js:26` | required (transcription step) | same | same — README notes this is a stopgap: "Replace it with managed identity once the Speech resource role and token path are deployed" |
| `AZURE_SPEECH_LOCALES` | `run-once.js:27` | optional | defaults `"en-IN,hi-IN"` | none |
| `AZURE_SPEECH_MAX_SPEAKERS` | `run-once.js:28` | optional | defaults `4`, clamped 2-8 | none |
| `PROCESSING_JOBS_PER_RUN` | `run-once.js:46` | optional | defaults `4`, clamped 1-20 | none — throughput knob |
| `PROCESSING_RUN_BUDGET_MS` | `run-once.js:47` | optional | defaults `840_000` (14 min), clamped 60s-850s\* | \*bounded so the job self-aborts before the README's 15-minute replica timeout |
| `AZURE_VOICE_EVIDENCE_ORIGIN`, `AZURE_VOICE_EVIDENCE_HMAC_SECRET`, `VOICE_EVIDENCE_MAX_AUDIO_BYTES`, `VOICE_EVIDENCE_TIMEOUT_MS` | via `createAzureVoiceEvidenceAdapters({env,...})`, `run-once.js:23` → §10 | see §10 | see §10 | evidence steps (diarize/separate/enhance/voice_quality) fail without the required two |
| `REPLICA_STORAGE_BUCKET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | via `createReplicaProcessingStorage`, `run-once.js:5` → §12 | see §12 | see §12 | the job cannot resolve or write any object |
| `AZURE_REPLICA_BUDGET_ID`, `AZURE_REPLICA_APP_BUDGET_USD`, `AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR` | via `budgetEnv: process.env`, `run-once.js:61` → §11 | see §11 | see §11 | transcription spend cannot be reserved |

The Dockerfile's ClamAV signature refresh (`entrypoint.sh`) is a hard startup
dependency with no env var — a failed `freshclam` update blocks the job
outright by design ("a failed update must not silently turn malware scanning
into a fake green gate").

## 21. github-actions (`.github/workflows/deploy-web.yml`)

**None of the replica/voice vars above flow through this workflow today.**
Verified by reading the file: the `Reconstruct api/_config.js` step's `env:`
block passes exactly the pre-existing Meera set (`OPENROUTER_KEY`,
`GOOGLE_KEY`, `GOOGLE_KEYS`, `GOOGLE_PAID_KEY`, `NEON_URL`, `SUPABASE_URL`,
`SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AZURE_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, `AZURE_ENDPOINT`) into
`scripts/write-config.mjs`. No `AZURE_FOUNDRY_*`, no `REPLICA_*`, no
`CRON_SECRET`, nothing from §1-15. This matches SPEC §4's "none set
anywhere" and is exactly why `CRON_SECRET` unset silently 401s every replica
sweep in production right now: even if someone sets it in the Vercel
dashboard directly (the only place it can be set — see §15), nothing in this
repo's CI checks that they did.

The `configured` job's gate (lines ~55-95) also does not check any replica
var before deciding "deploys configured" — a replica-blind deploy always
reports ready, by design (the gate is about the site staying up, not about
the replica lanes lighting up).

## 22. Pre-existing Meera vars — reference only

Every var below is documented in full at `scripts/write-config.mjs`'s
`STRINGS` list and `api/_config.example.js`'s comments — this file does not
duplicate that documentation, only points at it: `OPENROUTER_KEY` /
`OPENROUTER_RESEARCH_KEY`, `GOOGLE_KEY` / `GOOGLE_KEYS` / `GOOGLE_KEYRING` /
`GOOGLE_PAID_KEY` / `GEMINI_PAID_KEY` / `PAID_LANE` / `PAID_CACHE`,
`NEON_URL`, `SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`,
`AZURE_KEY` / `AZURE_ENDPOINT` / `AZURE_CHAT_DEPLOYMENT` /
`AZURE_VISION_DEPLOYMENT`, `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` /
`TELEGRAM_BOT_USERNAME`, `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` /
`FCM_PRIVATE_KEY`, `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` /
`WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_DISPLAY_NAME`,
`DISCORD_PUBLIC_KEY` / `DISCORD_BOT_TOKEN` / `DISCORD_APPLICATION_ID` /
`DISCORD_BOT_USERNAME`, `CONSOLIDATE_SWEEP_SECRET` / `CONSOLIDATE_KILL` /
`CONSOLIDATE_SWEEP_LIVE` / `CONSOLIDATE_MAX_CALLS` / `CONSOLIDATE_MAX_TOKENS` /
`CONSOLIDATE_USD_PER_MTOK_IN` / `CONSOLIDATE_USD_PER_MTOK_OUT`,
`CULTURE_SECRET`, `LIFE_SECRET`, `TASTE_QUEUE_SECRET`.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are pre-existing names but are
now also load-bearing for the replica lanes (§7, §12) — they are not
Meera-only anymore. `CRON_SECRET` is likewise pre-existing (`consolidate-sweep.js`)
but is now shared by all five replica sweeps too — see §15, it is
deliberately **not** on the `write-config.mjs` list.

## 23. Minimal-viable-subsets

What to set, in order, to light up successive slices without waiting on
Microsoft. All three assume the pre-existing Meera required pair
(`OPENROUTER_KEY`, `NEON_URL`) is already set, since nothing in Gurukul
replaces the base engine.

### (a) Foundry claim-extraction + dialogue only — no replica lab at all

Lights up WS-F ingestion's LLM pass and WS-E's dialogue-authoring assist,
with **no** identity/liveness/voice/storage machinery running.

```
AZURE_FOUNDRY_ENDPOINT
AZURE_FOUNDRY_API_KEY
AZURE_FOUNDRY_CLAIM_MODEL
AZURE_FOUNDRY_DIALOGUE_MODEL
AZURE_REPLICA_BUDGET_ID            (optional, has a default)
AZURE_REPLICA_APP_BUDGET_USD
AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS
AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS
```

8 vars (6 required + 2 optional-with-defaults), one deployment target
(`vercel-app`), zero standalone services, zero Microsoft approvals.

### (b) + Chatterbox voice lane — still no Microsoft approvals

Adds a working consented self-clone voice preview end to end: storage →
Chatterbox synthesis → watermark/C2PA protection → delivery. Requires
deploying two of the five standalone services (`open-voice-runtime`'s two
apps, `audio-protection`).

Vercel app additions:
```
REPLICA_STORAGE_BUCKET             (optional, has a default)
SUPABASE_URL                       (pre-existing Meera var, now dual-purpose)
SUPABASE_SERVICE_ROLE_KEY
AZURE_OPEN_VOICE_ORIGIN
OPEN_VOICE_HMAC_SECRET
AZURE_AUDIO_PROTECTION_ORIGIN
AZURE_AUDIO_PROTECTION_HMAC_SECRET
REPLICA_WATERMARK_TOKEN_SECRET
REPLICA_COMMITMENT_SECRET
REPLICA_PROTECTION_MAX_PCM_BYTES   (optional, has a default)
```
Plus, if the full evidence pipeline (not just preview) should also run:
```
AZURE_VOICE_EVIDENCE_ORIGIN
AZURE_VOICE_EVIDENCE_HMAC_SECRET
VOICE_EVIDENCE_MAX_AUDIO_BYTES     (optional)
VOICE_EVIDENCE_TIMEOUT_MS          (optional)
AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR
```

`open-voice-runtime` service env: `OPEN_VOICE_HMAC_SECRET` (its own copy),
`OPEN_VOICE_RUNTIME_ORIGIN`, `OPEN_VOICE_REQUIRE_CUDA`, `OPEN_VOICE_MODEL_ROOT`,
`OPEN_VOICE_PERTH_MIN_SCORE`.

`audio-protection` service env: `AZURE_AUDIO_PROTECTION_HMAC_SECRET` (its own
copy), `AZURE_KEY_VAULT_KEY_ID`, `C2PA_SIGN_CERTIFICATE_B64`,
`PUBLIC_APP_ORIGIN`, `C2PA_TIMESTAMP_URL` (optional),
`AUDIO_PROTECTION_MAX_PCM_BYTES` (optional), `AUDIO_PROTECTION_REQUIRE_CUDA`
(optional), `AUDIOSEAL_GENERATION_MIN_CONFIDENCE` (optional).

No `*_LIMITED_ACCESS_APPROVED`, no `*_ENABLED` flags gated on Microsoft
anywhere in this subset — everything here is `AZURE_` in *hostname* only
(the compute happens to sit on Azure Container Apps), not in *approval
status*.

### (c) + Azure Personal Voice + identity/liveness — the full, approval-gated stack

Everything in (a) and (b), plus every var in §3, §4, §5, §7, §8, §14, §15,
§16, §17, §20, and the two Microsoft Limited Access approvals themselves —
see `DEPLOY.md` for the ordered rollout. This is the only subset that needs
`AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED` and
`AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED` to ever be `"true"`.

## 24. Counted totals, and the discrepancy against SPEC §4's "~55"

Counting **distinct env var names**, replica/voice-specific (i.e. excluding
the pure-Meera set in §22, but including `NEON_URL`/`SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY`/`CRON_SECRET` since they are now load-bearing for
the replica lanes too):

- **Vercel app alone (§1-15):** 61 replica-specific names + 4 shared
  infra names (`NEON_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `CRON_SECRET`) = **65 settings** in one deployment target.
- **All six deployment targets together (§1-20),** counting a shared name in
  two different deployments as two settings (per the "not one setting" rule
  in the header): **106 individual env var settings** across `vercel-app`
  and the five standalone services.

**WS-I adds 7 names to `vercel-app` (§15b)**, all of them optional in the
sense that matters for a deploy — with none of them set, the stays-current
sweep answers `{ok:true, disabled:true}` and nothing else in the app changes:
`YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`,
`ASR_SELF_HOSTED_ORIGIN`, `ASR_HMAC_SECRET`, `ASR_SELF_HOSTED_MODEL`,
`ASR_SELF_HOSTED_MODEL_COMMITMENT`, `SARVAM_API_KEY`, `SARVAM_ASR_MODEL`,
`SARVAM_API_ORIGIN` — 9 names, of which 4 are optional-with-defaults, so
**5 new required-if-you-want-the-lane settings**. The totals above predate
them and are stated as of §1-20; add 9 to the vercel-app name count and to
the all-targets count for the current tree.

SPEC §4's "~55" is a reasonable estimate **if and only if** it was scoped to
the Vercel app's *unique names* (61 replica-specific names is close to 55;
counting the 4 shared infra vars gets to 65). It undercounts by roughly half
once the five standalone services' own, separately-configured environments
are included — those were "enumerable only by reverse-engineering ~10
registry/provider files" per the problem statement, and that reverse-
engineering did not, in the spec draft, appear to have walked into
`services/*/src/config.js` and the four Python `app.py` files, which is where
most of the undercount lives. This file is the correction: 106 is the number
to plan a deploy runbook against, not 55.

One additional discrepancy, unrelated to counting: `AZURE_DOCUMENT_REVIEW_ENDPOINT`
(§16) is a **required** var for the azure-verifier service pointing at "an
independently deployed, HMAC-authenticated review service" that
**does not exist anywhere in this repository** — not as a `services/*`
directory, not as an `api/*` route. SPEC §4 did not flag this. It is a sixth
service the deploy runbook has to either build or contract out, not merely
configure, before `AZURE_IDENTITY_REVIEW_PATH_APPROVED` can honestly become
`true`.
