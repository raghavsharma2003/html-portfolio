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

## 10b. In-house YouTube audio extraction — client side (`vercel-app`)

`api/_channel/media-extract-client.js` — the app's client of the standalone
`media-extract` service (§17b), constructed by `api/_channel/registry.js` and
reached only through `api/_channel/providers/youtube-extract.js`.

**Selection is by PRESENCE, not by a flag.** There is no `USE_EXTRACTION`
variable and there deliberately is not one: with `AZURE_MEDIA_EXTRACT_ORIGIN`
and `MEDIA_EXTRACT_HMAC_SECRET` both set, the registry returns the composing
provider (OAuth listing + captions + extraction); with either missing it
returns the plain OAuth provider, whose `fetchAudio` is an honest typed
refusal. A missing extraction service degrades to *cannot*, never to *silently
allowed*.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `AZURE_MEDIA_EXTRACT_ORIGIN` | `api/_channel/media-extract-client.js:50` | required *for the extraction lane* | absent → registry returns the OAuth-only provider (lane disabled, not broken); present-but-invalid → throws `media_extract_origin_invalid` | back-catalogue import and audio-lane ingestion; captions ingestion is unaffected |
| `MEDIA_EXTRACT_HMAC_SECRET` | `api/_channel/media-extract-client.js:70` (via `secretBytes`) | required *for the extraction lane* | absent → lane disabled; too short → throws `media_extract_hmac_secret_required` (min 32 bytes decoded) | same |
| `MEDIA_EXTRACT_TIMEOUT_MS` | `api/_channel/media-extract-client.js:56` | optional | defaults `1_800_000` (30 min); clamped 60 s–60 min | none |
| `MEDIA_EXTRACT_MAX_DURATION_MS` | `api/_channel/media-extract-client.js:64` | optional | defaults `14_400_000` (4 h); clamped 1 min–6 h | none — this is the app-side ceiling; the service enforces its own |
| `MEDIA_EXTRACT_ROUTE` | `api/_channel/extract-routes.js` (`audioRouteFor`) | optional | unset → the first CONFIGURED route in preference order (`proxy` → `provider` → `cookies` → `pot` → `direct`), which with no credentials at all is `direct`; set to a name this build does not know → `channel_extract_route_unknown`; set to a route whose credential is absent → that route's OWN code, never a downgrade | which egress fetches the audio. `direct` and `pot` are MEASURED not to return bytes from a datacenter IP |
| `MEDIA_EXTRACT_PROXY_URL` | `api/_channel/extract-routes.js` (`proxyConfig`) | required *when the route is `proxy`* | absent → `channel_extract_route_proxy_credential_missing`; malformed → `channel_extract_route_proxy_url_invalid`. Both reach the owner's Activity surface as a sentence plus a next action | the recommended audio route. Set the SAME value as the service's `MEDIA_EXTRACT_PROXY` |
| `MEDIA_EXTRACT_COOKIES_B64` / `MEDIA_EXTRACT_COOKIES_FILE` | `api/_channel/extract-routes.js` (`cookiesConfig`) | required *when the route is `cookies`* | absent → `channel_extract_route_cookies_credential_missing` | free, and the only route whose downside is a real Google account. See `youtube-extraction-routes.md` §5 |
| `MEDIA_EXTRACT_POT_PROVIDER_URL` | `api/_channel/extract-routes.js` (`potConfig`) | required *when the route is `pot`* | absent → `channel_extract_route_pot_provider_missing`; non-http → `..._invalid` | a self-hosted `bgutil-ytdlp-pot-provider`. Measured to help metadata on a warm IP and to deliver no audio bytes |
| `MEDIA_EXTRACT_PROVIDER` + `MEDIA_EXTRACT_PROVIDER_KEY` | `api/_channel/extract-routes.js` (`providerConfig`) | required *when the route is `provider`* | unnamed → `..._provider_not_named`; not in `KNOWN_PROVIDERS` → `..._provider_unknown`; no key → `..._provider_credential_missing` | no adapter ships in this build, so a `provider` request refuses at `route_provider_adapter_unavailable` rather than quietly running direct |
| `MEDIA_EXTRACT_TRANSCRIPT_ROUTE` | `api/_channel/extract-routes.js` (`transcriptRouteFor`) | optional | unset → `captions_oauth` when the OAuth pair is present, else the first configured audio-capable route | the transcript half is chosen SEPARATELY from the audio half on purpose, so a working transcript route cannot hide a blocked audio route |

`MEDIA_EXTRACT_HMAC_SECRET` appears **twice** in this manifest, here and in
§17b, and per this file's opening rule those are **two independent settings in
two independent deployments that happen to share a name**. They must hold the
same value for the transport to verify, and setting one does not set the other.

The extraction lane also needs the §12 storage stack: the service is handed a
pre-signed upload URL minted by `api/_replica-storage.js`'s
`createSignedReplicaUpload`, so `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` / `REPLICA_STORAGE_BUCKET` are prerequisites. The
service never holds a storage credential of its own.

## 11. Voice evidence spend fencing — fast transcription (`vercel-app` + `processing-worker`)

`api/_provider-budget.js`'s `reserveAzureFastTranscriptionSpend` (function
name inferred from the pattern at lines 39-42; called with `budgetEnv` from
`services/replica-processing-worker/run-once.js:61`). **Dormant since WS-AN
(2026-08-26):** `transcribe` runs through Sarvam now, whose adapter
(`api/_replica-processing/providers/sarvam-transcription.js`) sets no billing
meter, so `worker.js`'s `adapter.billing?.meter === "azure_speech_audio_ms"`
check never matches and this reservation path never fires for `transcribe`.
Left in place in case Azure Fast Transcription is ever reintroduced as a
second lane.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `AZURE_REPLICA_BUDGET_ID` | `api/_provider-budget.js:39` | optional | see §2 | shared budget id |
| `AZURE_REPLICA_APP_BUDGET_USD` | `api/_provider-budget.js:41` | required | throws | reservation refuses — also fences the (still-live) voice-evidence spend, so this var stays required regardless |
| `AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR` | `api/_provider-budget.js:42` | required only if the Azure Fast Transcription path is ever called again | throws `provider_audio_rate_required` | nothing today — the path it fences is unreachable from `transcribe` |

## 12. Replica private storage (`vercel-app` + `processing-worker`)

`api/_replica-storage.js` — the Supabase-backed private bucket every replica
subsystem reads/writes source and derived artifacts through.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `REPLICA_STORAGE_BUCKET` | `api/_replica-storage.js:1` | optional | defaults to `"vyakti-replica-private"` | none, unless the actual bucket has a different name — then every read/write 404s |
| `SUPABASE_URL` | `api/_replica-storage.js:25` (shared Meera var, also read directly by `api/_voice/providers/azure-personal-voice.js:71`) | required | falls back to `config.SUPABASE_URL` (the gitignored `api/_config.js`), then empty | storage calls fail — enrollment, evidence, and voice preview all depend on this |
| `SUPABASE_SERVICE_ROLE_KEY` | `api/_replica-storage.js:30` | required | falls back to `config.SUPABASE_SERVICE_ROLE_KEY`, then empty | same — **deliberately distinct from `SUPABASE_KEY`**: `api/_config.example.js`'s own comment says biometric storage never guesses that the general app key is privileged |

## 12b. Owner-only internal replica testing (`vercel-app` + `processing-worker`)

`api/_replica-processing/self-test.js` removes enrollment ceremony clicks for
one explicitly allowlisted owner while leaving authentication, ownership,
private storage, quarantine, malware scanning, media evidence and model-build
gates intact. The Vercel copy bootstraps the six scopes before source creation;
the processing-worker copy auto-reviews real evidence and queues a draft after
`voice_quality`. All three settings are mandatory together. The old single
`REPLICA_SELF_TEST_MODE=true` setting is inert.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `REPLICA_SELF_TEST_MODE` | `api/replica-source.js`, `api/_replica-processing/runtime.js` | optional, owner testing only | anything except exact `true` is off | no bypass |
| `REPLICA_SELF_TEST_ENVIRONMENT` | same | required only with self-test | must equal exact `internal-owner-testing` | no bypass |
| `REPLICA_SELF_TEST_OWNER_USER_ID` | same | required only with self-test | no fallback; must match the authenticated/leased owner's UUID | no bypass, including for every other account |

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

## 15c. Clone channels — "deploy the clone anywhere" (`vercel-app`)

Gurukul WS-N. The surfaces a published clone can be reached on: an embeddable
web widget, Telegram, WhatsApp. Migration 055 (`vy_clone_channel`) stores the
BINDING; none of it stores a credential, because `credentials_ref` is a `uuid`
and a bot token cannot be cast into one. Every variable below is fail-closed
and none of them can be *un*set into a working lane.

### The widget's session signing key

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `CLONE_WIDGET_SESSION_SECRET` | `api/_clonechat.js:sessionSecret()` | required, **≥32 chars** | none — throws `clone_widget_unconfigured` (503) | the embeddable widget refuses every request. Nothing degrades: no session can be minted, so no turn can be taken |

It signs the widget's session token, which carries **the disclosure card's
digest** and **the transcript's digest**. Both bindings are the mechanism
behind safety-floor-teacher.md §1's P1 and the anti-forgery rule, so an unset
key does not mean "the widget runs without signatures" — it means the widget is
off. Generate with `openssl rand -base64 48`. Rotating it invalidates every
open widget session, which shows up as one re-opened panel per visitor and one
re-rendered disclosure card; that is the correct consequence and not a reason
to avoid rotating.

### The channel secret store — where a bot token actually lives

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `CHANNEL_SECRET_BACKEND` | `api/_channel-secrets.js:activeBackend()` | optional | `none` | with the default, `putChannelSecret`/`getChannelSecret` throw `channel_secret_store_unconfigured` (503) — a credentialed channel (Telegram, WhatsApp) **cannot be connected at all**. The web widget and embed are unaffected: they need no credential |
| `AZURE_KEY_VAULT_URL` | `api/_channel-secrets.js:keyVaultAuth()` | required when backend is `azure-keyvault` | none — throws `channel_secret_store_unconfigured` | same as above |
| `AZURE_TENANT_ID` | `api/_channel-secrets.js:keyVaultAuth()` | same | same | same |
| `AZURE_CLIENT_ID` | `api/_channel-secrets.js:keyVaultAuth()` | same | same | same |
| `AZURE_CLIENT_SECRET` | `api/_channel-secrets.js:keyVaultAuth()` | same | same | same |

All four Key Vault values are checked **together** (`if (!vault || !tenant ||
!clientId || !clientSecret) throw`) — §1's rule: a partial set is the same as
none, so a half-configured store fails at boot with a name rather than at write
time with a provider error nobody can act on.

`AZURE_KEY_VAULT_URL` and the three service-principal values are **new to
`vercel-app`**. `services/audio-protection` already reads
`AZURE_KEY_VAULT_KEY_ID` (§18) against a vault of its own; per this file's
opening rule, these are **not one setting** — they are independent settings in
independent deployments that happen to name the same provider. Pointing both at
one vault is a choice, not a default.

**NOT VERIFIED:** no secret has ever been written. There are no service
principal credentials in this environment, so what is proven offline is the
refusal path, the reference shape, and the request the backend would make —
never a round trip.

### Telegram, per clone

No new variable. A per-clone bot's token is a **secret-store entry**, not an
env var — that is the whole point of `credentials_ref`, and it is why a hundred
teachers do not mean a hundred environment variables. The existing
`TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_BOT_USERNAME`
(§22) still describe **Meera's own bot** and today's single-agent lane, which
is reached when the webhook URL carries no `?ch=` parameter.

`TELEGRAM_WEBHOOK_SECRET` becomes deployment-wide rather than Meera-specific:
it is the value an owner pastes into their own `setWebhook` call, and it is
compared in constant time on every update regardless of which clone the `?ch=`
resolves to. A missing configured secret refuses every request, unchanged.

**Verified (WS-R41, 2026-09-04)** against `core.telegram.org/bots/api#setwebhook`:
the header is `X-Telegram-Bot-Api-Secret-Token`, 1-256 characters,
`[A-Za-z0-9_-]` only — matches `api/tg.js`'s own `secretOk()` exactly. See
that file's own header for what else this pass verified and fixed (a stale
`reply_to_message_id` field, replaced by `reply_parameters` per Bot API 7.0).

### WhatsApp, per clone

The existing `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` remain
**deployment-wide** — they authenticate Meta's webhook to us and are not
per-teacher. `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` remain the
fallback pair for a single-tenant lane; a bound clone gets its own
`phone_number_id` from `vy_clone_channel.external_ref` and its own access token
from the secret store, and never touches either variable.

**Verified (WS-R41, 2026-09-04)** against
`developers.facebook.com/docs/graph-api/webhooks/getting-started`: the
signature header is `X-Hub-Signature-256`, `sha256=` + HMAC-SHA256 of the raw
payload under the App Secret — matches `api/whatsapp.js`'s own
`signatureOk()` exactly. See that file's own header for the full set of
shapes this pass checked against Meta's own documents.

### Provider contract marks (WS-R60, 2026-09-04)

WS-R41 (2026-09-04) verified most provider-contract marks against the
providers' own documents and left four open by name; this pass closed all
four (two fully VERIFIED via cross-checked secondary sources where the
primary page is unreachable by this session's fetch tool, two ANSWERED from
the provider's own reference where the mark was an operator question rather
than a code shape). Full citations:
`context/measurements.md#ws-r60-open-provider-marks-2026-09-04`.

| mark | status |
|---|---|
| Razorpay `updateSubscriptionQuantity` (subscription seat PATCH) | VERIFIED |
| Razorpay `registerFundAccount` (fund account GET) | VERIFIED |
| Razorpay `sendPayout` (payout POST) | VERIFIED |
| RazorpayX payout webhook events (`payout.processed`/`failed`/`reversed` and 5 more) + payload | VERIFIED |
| RazorpayX webhook signature (same `X-Razorpay-Signature`/HMAC-SHA256 mechanism as Subscriptions) | VERIFIED |
| Telegram `setMessageReaction` body shape | VERIFIED (via the Bot API changelog + a typed SDK, not the primary reference page — it still truncates for this session's fetch tool) |
| Meta: can one WABA/number's webhook be delivered to two apps or URLs | ANSWERED — yes, via the Subscribed Apps API (`POST /<WABA_ID>/subscribed_apps`), which is a different mechanism from the per-app webhook override; still an operator's call which shape to use, not a code decision |

See `docs/gurukul/INSTAGRAM-DM-GAP.md` §3 for why WhatsApp is not yet
self-serve (Tech Provider enrolment + Embedded Signup) and §1–2 for why
Instagram DM has no adapter and no variables at all.

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

## 18. audio-protection — standalone service (`audio-protection`)

`services/audio-protection/app.py`. Fail-closed at startup. The client side
is §6.

> **Deployed 2026-08-26 by WS-AL**, on **CPU**, with **external** ingress. Both
> are recorded decisions with reversal conditions, not silent flag flips:
> `context/decisions.md#audio-protection-cpu` and
> `#audio-protection-ingress`. The service is its own HMAC admission broker.
> Endpoint, digest, serving revision and measured cold start are in
> `docs/gurukul/AZURE-DEPLOY-STATE.md` section 14. As deployed it therefore sets
> `AUDIO_PROTECTION_REQUIRE_CUDA=false`, and the image sets
> `NO_TORCH_COMPILE=1`, without which every watermark request answers 503 while
> `/healthz` stays green
> (`context/rejected.md#a-green-build-and-a-green-healthz-can-both-lie-about-a-model`).

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
| `AZURE_CLIENT_ID` | `DefaultAzureCredential`, not read by `app.py` directly | required **when using a user-assigned managed identity** | with none set the credential tries the system-assigned identity and Key Vault signing fails at the first `/v1/sign` or `/v1/c2pa` | receipts and C2PA manifests 503; the watermark path still works, so this failure is partial and easy to misread |
| `NO_TORCH_COMPILE` | set in the Dockerfile, read by AudioSeal's bundled moshi `compile.py` | **required in any image without a C++ toolchain** | unset, TorchInductor shells out to `g++` on the first watermark call | **every `/v1/watermark` returns 503 while the build, the boot and `/healthz` all stay green** |

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

## 19b. media-extract — standalone CPU service (`media-extract`)

`services/media-extract/app.py`. The only service in this manifest that needs
**no GPU** — it shells out to a pinned `yt-dlp` and `ffmpeg`, so it runs on the
plain Consumption profile at `minReplicas: 0` and costs close to nothing idle.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `MEDIA_EXTRACT_HMAC_SECRET` | `app.py` (`_startup` via `_secret()`) | required | `RuntimeError` at startup if unset or under 32 bytes | service fails to start |
| `MEDIA_EXTRACT_UPLOAD_HOST` | `app.py` (`_startup`) | required | `RuntimeError` `media_extract_upload_host_required` | service fails to start. This is the ONLY host the service may PUT extracted audio to; a request naming any other host is refused `upload_host_forbidden`, so a signed request from the app plane still cannot redirect a teacher's lecture anywhere else |
| `MEDIA_EXTRACT_MAX_DURATION_SECONDS` | `app.py` (module scope) | optional | defaults `14400` (4 h), clamped 60 s–6 h | none |
| `MEDIA_EXTRACT_MAX_AUDIO_BYTES` | `app.py` (module scope) | optional | defaults `268435456` (256 MB), clamped 1 MB–512 MB | none |
| `MEDIA_EXTRACT_TIMEOUT_SECONDS` | `app.py` (module scope) | optional | defaults `1800`, clamped 60–3600 | none |
| `MEDIA_EXTRACT_WORK_DIR` | `app.py` (`_startup`) | optional | defaults `/scratch` | media is written per-request to a temp dir under this root and removed in a `finally`; a non-writable path fails at startup |
| `MEDIA_EXTRACT_COOKIES_FILE` / `MEDIA_EXTRACT_COOKIES_B64` | `app.py` (`_cookies_path`) | required *when the request's route is `cookies`* | absent → `route_cookies_credential_missing` BEFORE the metadata probe, so a missing credential costs zero requests to YouTube; a `_B64` jar is written once to scratch at mode `0600`, never logged and never echoed | the `cookies` route. Read ONLY on that route now: routes no longer share credentials, so a response can honestly say which one served the bytes |
| `MEDIA_EXTRACT_PROXY` | `app.py` (`_common_args`) | required *when the request's route is `proxy`* | absent → `route_proxy_credential_missing` | the recommended audio route. Mirror of the app plane's `MEDIA_EXTRACT_PROXY_URL` |
| `MEDIA_EXTRACT_POT_PROVIDER_URL` | `app.py` (`_common_args`) | required *when the request's route is `pot`* | absent → `route_pot_provider_missing` | passed as `youtubepot-bgutilhttp:base_url=…` |
| `MEDIA_EXTRACT_PROVIDER_KEY` | `app.py` (`_route`) | required *when the request's route is `provider`* | absent → `route_provider_credential_missing`; present → `route_provider_adapter_unavailable` (501), because no adapter is built | never silently degrades to `direct` |
| `MEDIA_EXTRACT_PLAYER_CLIENTS` | `app.py` (`_common_args`) | optional | unset → yt-dlp defaults | passed as `youtube:player_client=…`; the lever for PO-token enforcement |

`MEDIA_EXTRACT_HMAC_SECRET` is this service's **own copy** of the value the app
plane holds under the same name (§10b). Same name, two independent settings,
and they must match for the transport to verify.

The service receives **no** account, replica, person, owner or transcript id —
only a video id, an attestation envelope (receipt hash + channel key + expiry),
a duration ceiling and a pre-signed upload URL. It is told what was permitted,
never who permitted it, which is `services/voice-evidence`'s rule and the
reason it can be a service rather than a privileged part of the app.

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
| `SARVAM_API_KEY` | `composition.js`'s ASR block, via `createSarvamTranscriptionAdapter` | required (transcription step) | undefined passed through; `transcribe` stops at `asr_unconfigured`, not a crash at startup | Hinglish transcription step fails; earlier DAG stages (integrity, malware, probe, evidence) are unaffected. As of WS-AN (2026-08-26) this replaces `AZURE_SPEECH_ENDPOINT`/`AZURE_SPEECH_KEY` — this subscription has zero Cognitive Services accounts |
| `SARVAM_ASR_MODEL` | `composition.js`'s ASR block | optional | defaults `"saaras:v3"` | none |
| `PROCESSING_JOBS_PER_RUN` | `run-once.js:46` | optional | defaults `4`, clamped 1-20 | none — throughput knob |
| `PROCESSING_RUN_BUDGET_MS` | `run-once.js:47` | optional | defaults `840_000` (14 min), clamped 60s-850s\* | \*bounded so the job self-aborts before the README's 15-minute replica timeout |
| `AZURE_VOICE_EVIDENCE_ORIGIN`, `AZURE_VOICE_EVIDENCE_HMAC_SECRET`, `VOICE_EVIDENCE_MAX_AUDIO_BYTES`, `VOICE_EVIDENCE_TIMEOUT_MS` | via `createAzureVoiceEvidenceAdapters({env,...})`, `run-once.js:23` → §10 | see §10 | see §10 | evidence steps (diarize/separate/enhance/voice_quality) fail without the required two |
| `REPLICA_STORAGE_BUCKET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | via `createReplicaProcessingStorage`, `run-once.js:5` → §12 | see §12 | see §12 | the job cannot resolve or write any object |
| `AZURE_REPLICA_BUDGET_ID`, `AZURE_REPLICA_APP_BUDGET_USD` | via `budgetEnv: process.env`, `run-once.js:61` → §11 | see §11 | see §11 | fences the OTHER Azure-billed steps (voice evidence); `transcribe` is unmetered now — see the Sarvam row above and its adapter's header for why |
| `REPLICA_SELF_TEST_MODE` | `api/_replica-processing/self-test.js` | optional, internal owner testing only | anything except exact `true` disables the auto-grant | setting this alone does nothing; the two guards below are also mandatory |
| `REPLICA_SELF_TEST_ENVIRONMENT` | `api/_replica-processing/self-test.js` | required only with self-test mode | must equal exact `internal-owner-testing` | missing or different keeps every identity, consent and review gate fail-closed |
| `REPLICA_SELF_TEST_OWNER_USER_ID` | `api/_replica-processing/self-test.js` | required only with self-test mode | no fallback; must be a UUID matching the leased job owner | malformed or mismatched keeps the bypass off, so another account cannot inherit the owner's test grant |

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
```
And, for `transcribe` specifically (Sarvam, not Azure Speech, as of WS-AN 2026-08-26):
```
SARVAM_API_KEY
SARVAM_ASR_MODEL                  (optional, defaults saaras:v3)
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

### (b2) + in-house YouTube ingestion — no Microsoft approvals, no GPU

Adds the stays-current loop's ability to reach a teacher's own back catalogue.
Requires deploying one more standalone service (`media-extract`), which is
**CPU-only** and therefore the cheapest thing in the deployment: plain
Consumption profile, `minReplicas: 0`, no GPU quota involved at all.

Vercel app additions:
```
AZURE_MEDIA_EXTRACT_ORIGIN
MEDIA_EXTRACT_HMAC_SECRET
MEDIA_EXTRACT_TIMEOUT_MS           (optional)
MEDIA_EXTRACT_MAX_DURATION_MS      (optional)
YOUTUBE_OAUTH_CLIENT_ID            (pre-existing; the lane composes over it)
YOUTUBE_OAUTH_CLIENT_SECRET        (pre-existing)
CRON_SECRET                        (pre-existing; the sweep 401s silently without it)
```

`media-extract` service env: `MEDIA_EXTRACT_HMAC_SECRET` (its own copy),
`MEDIA_EXTRACT_UPLOAD_HOST` (**required** — the single host the service may PUT
to; it refuses to start without it), `MEDIA_EXTRACT_MAX_DURATION_SECONDS`
(optional), `MEDIA_EXTRACT_MAX_AUDIO_BYTES` (optional),
`MEDIA_EXTRACT_TIMEOUT_SECONDS` (optional), `MEDIA_EXTRACT_WORK_DIR`
(optional), `MEDIA_EXTRACT_COOKIES_FILE` (optional),
`MEDIA_EXTRACT_PROXY` (optional), `MEDIA_EXTRACT_PLAYER_CLIENTS` (optional).

The three optional ones at the end are the levers for the datacenter-IP,
PO-token and bot-check problems documented in
`docs/gurukul/youtube-extraction-posture.md` §3. All are off by default and
none of them is needed for the service to start.

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

## 25. Vyakti Rooms v1 additions (`vercel-app` + `web build`, WS-R1..R10, 2026-09-03)

Six workstreams merged as Vyakti Rooms v1 (`context/STATE.md`'s "main loop,
Rooms merge" session log entry). Two of them introduced env-gated surfaces;
one reused two existing sweep names against two new handlers. Every row below
was checked against the file:line that reads it, same discipline as §1-24.

### The owner identity path (WS-R2)

`api/_replica-voice-identity.js` (all decisions), `api/replica-voice-identity.js`
(the handler), `api/replica-voice-identity-sweep.js` (the attempt-expiry cron),
and `src/studio/VoiceIdentityChallenge.tsx` (the capture UI). **Two independent
flags, one per side of the HTTP boundary, and BOTH must be set for the seam to
do anything** — this is deliberately not one name shared between server and
build, because a Vite `import.meta.env.*` value is baked into the JS bundle at
build time while `process.env.*` is read fresh per request, and conflating the
two would mean "flip it on" sometimes needs a redeploy and sometimes does not,
silently depending on which side you touched.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `VOICE_IDENTITY_CHALLENGE` | `api/_replica-voice-identity.js:389` (`voiceIdentityChallengeEnabled`), read by `api/replica-voice-identity.js:60` and `api/replica-voice-identity-sweep.js:33` | optional (switch) | must equal the exact string `"1"`; anything else (including unset, `"true"`, `"yes"`) is off | the handler answers `404 not_found` on every op and the sweep answers `{ok:true, disabled:true}` — no challenge row is ever created, scored or expired, server-side |
| `VITE_VOICE_IDENTITY_CHALLENGE` | `src/studio/StudioApp.tsx:130` via `voiceIdentityChallengeUiEnabled()` (`src/studio/voiceIdentityApi.ts:6`) | optional (switch) | must equal the exact string `"1"`; **this is a Vite build-time env var, baked into the bundle by `npx vite build` — setting it on Vercel requires a rebuild to take effect, unlike every `process.env` var in this file** | the capture card never mounts, even if the server flag above is on — a teacher can never reach the UI that would create a challenge |

Setting only one of the pair is a real, reachable state: `VOICE_IDENTITY_CHALLENGE=1`
alone leaves the API live with no UI path to it (reachable only by a direct
API call); `VITE_VOICE_IDENTITY_CHALLENGE=1` alone renders a card whose every
request 404s. Both default OFF, so the deployed tree is byte-identical in
behaviour to pre-WS-R2 until the main loop sets both
(`context/STATE.md`'s WS-R2 session log entry: "Both env flags default off, so
the deployed tree is unchanged until the main loop turns them on").

Two independent measurements gate a challenge internally (ECAPA cosine against
the owner's own VoiceGenome reference at accept ≥0.78 / review 0.70-0.78 /
reject <0.70, and a Sarvam transcript overlap plus the spoken nonce) — neither
is a separate env var; both read the existing `api/_fidelity.js` and `SARVAM_API_KEY`
(§15b) seams. **Unverified**: whether Sarvam returns Latin or Devanagari script
for this sentence bank is untested against the live service
(`context/rejected.md#romanised-lexicon-meets-devanagari-asr`), and there is no
different-speaker control anywhere in this repo, so the 0.70 reject floor is
inherited rather than earned (WS-R2's own session log entry says this
directly).

### Vendor voice bench arms (WS-R6)

`api/_voice/providers/vendor-common.js`, `elevenlabs-pvc.js`, `sarvam-bulbul.js`,
wired into `api/_voice/registry.js`. **Bench arms only** — `VOICE_LANE_ORDER`
(the shipped default) is unchanged by any var below; they exist to make
`context/decisions.md#platform-north-star`'s reversal condition ("the
self-hosted lane stays materially below the vendor lane after fine-tuning
effort") testable, and only that.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `VOICE_VENDOR_ARMS` | `api/_voice/providers/vendor-common.js:36` (`VENDOR_ARMS_ENV`), read by `enabledVendorArms()` | optional (switch) | empty string → both arms return `available:false, reason:"vendor_arm_not_enabled:VOICE_VENDOR_ARMS", blocker:"waiting_on_you"` | neither bench arm is reachable; comma-separated list of `elevenlabs`, `sarvam` (e.g. `VOICE_VENDOR_ARMS=elevenlabs,sarvam`) |
| `ELEVENLABS_API_KEY` | `api/_voice/providers/elevenlabs-pvc.js:80,102` (`vendorApiKey`) | required *once the arm is enabled above* | throws `elevenlabs_api_key_required` | the ElevenLabs arm construction 503s with that named reason |
| `ELEVENLABS_MODEL_ID` | `api/_voice/providers/elevenlabs-pvc.js:83` (`pinnedModelId`) | optional | defaults `"eleven_multilingual_v2"`; rejects a value containing `"latest"` (same law as every other pinned-model var in this file) | none |
| `ELEVENLABS_CLONE_MODE` | `api/_voice/providers/elevenlabs-pvc.js:84` | optional | defaults `"instant"` | none — `"professional"` mode is the multi-minute training path this file's own header says "cannot complete inside one request" |
| `SARVAM_TTS_MODEL` | `api/_voice/providers/sarvam-bulbul.js:87` | optional | defaults `"bulbul:v3"` | none |
| `SARVAM_TTS_SPEAKER` | `api/_voice/providers/sarvam-bulbul.js:89` | optional | defaults `"priya"` | none |
| `VOICE_PRIMARY_LANE` | `api/_voice/registry.js:152` (`primarySynthesisLane`) | optional | unset → shipped order, self-hosted first, unchanged | naming a lane this file does not know throws `voice_primary_lane_unknown`; naming a real lane that is not configured throws rather than silently falling back to self-hosted — an operator who asks for a vendor primary and gets self-hosted audio without an error has been told the opposite of the truth about what produced it |

`SARVAM_TTS_MODEL`/`SARVAM_TTS_SPEAKER` are new names, but the Sarvam arm's
**credential** is the pre-existing `SARVAM_API_KEY` (§15b) — its third
call site in this manifest now (self-hosted-ASR fallback, the processing
worker's `transcribe` step, and this TTS bench arm), all in the same
deployment target (`vercel-app`), so — unlike the cross-deployment pattern
this file's header warns about — this one genuinely is the same setting doing
three jobs, not three settings sharing a name.

**Nothing here has ever been contacted.** No vendor key exists in any
environment this repo's sessions can reach; no vendor audio has ever been
produced; there is no listening result or similarity number for either arm
(WS-R6's own session log entry). One matched pack costs about USD 0.048 on
ElevenLabs and INR 0.81 on Sarvam at list prices read 2026-09-03.

### Two more cron consumers of the existing `CRON_SECRET` (WS-R2, WS-R9)

No new var — add these two handlers to §15's consumer list. Same comparator,
same 24-byte minimum, same failure shape (a silent 401 on a schedule nobody is
watching) as the five it already names.

| cron | schedule (`vercel.json`) | handler | consumed at |
|---|---|---|---|
| identity-challenge attempt sweep | `*/5 * * * *` | `api/replica-voice-identity-sweep.js` | `:23` |
| drift-watch sweep | `0 */6 * * *` | `api/drift-watch-sweep.js` | `:23` |

`api/drift-watch-sweep.js` is the **sole writer** of `vy_replica_drift_report`
(migration 076) — `api/drift-watch.js` (the owner-facing read) is deliberately
read-only, so an unset `CRON_SECRET` here does not just delay an alert, it
means drift is never computed for anyone, on any schedule, until the next time
a human happens to open the studio and a synchronous read recomputes it
inline (if that path exists — **unverified in this pass**, not read as part of
this reconciliation).

### The studio project's model keys — still absent

Every LLM-backed reply in this repo, on every surface, leaves through exactly
one of two doors, and both need a model key nobody has set on the **studio**
Vercel project (`vyakti-replica-lab`, distinct from the `html-portfolio`
project per this file's own "not one setting" rule — §22's Meera vars living
on one Vercel project's dashboard does not set them on another project that
happens to build from the same GitHub repo):

- `api/chat.js:155` (the direct chat endpoint) explicitly checks
  `process.env.OPENROUTER_API_KEY || OPENROUTER_KEY` (config fallback), a free
  Google key pool (`poolSize()`), and `azureConfigured()` (`AZURE_KEY` +
  `AZURE_ENDPOINT`) together, and returns `500 {"error":"no key configured"}`
  by name when all three are absent.
- `api/_surface.js:287` (`think()` — the ONE call every other surface's
  `gatedReply()` routes through, per that file's own header: "One copy for
  every surface — a second copy is a second set of sampling parameters nobody
  remembers to keep in step") reads only `process.env.OPENROUTER_API_KEY`
  directly, with no Google/Azure fallback. **This is a different failure
  shape from `api/chat.js`'s, not the same one**: an empty key makes the
  OpenRouter fetch fail its own `.ok` check, and `think()` catches that and
  returns `""` rather than throwing or naming a reason — so a Room `say`, a
  Mirror Call reply, a Telegram/WhatsApp turn or an embedded-widget message
  does not 500 with `"no key configured"`, it hands `gatedReply()`'s honesty
  gate an EMPTY model reply. **What a follower actually receives from that —
  a named refusal, a blank message, or something `gateReply`'s own fallback
  produces — was not traced further in this pass and is marked unverified
  here rather than guessed at**, per this project's own law that a plausible
  return hiding a dead pipeline is worse than a loud one.

Neither `OPENROUTER_KEY`/`OPENROUTER_API_KEY`, `GOOGLE_KEYS`, `AZURE_KEY` nor
`AZURE_ENDPOINT` (§22) has ever been set on the studio project
(`context/STATE.md`'s "main loop, Rooms merge" session log entry: "Still
owner-gated: model keys on the studio Vercel project (its chat API answers
'no key configured')..."). This is a **separate gap from every subsystem in
§1-24**, which are all replica/voice/identity plumbing — this is the base
completion call underneath the Room, the Mirror Call, and every channel, and
without it none of them can produce a reply at all, regardless of how many
Rooms-specific vars above are set correctly.

## 26. The studio collapsed to Feed/Meet/Share (`vercel-app`, WS-R31, 2026-09-04)

`src/studio/StudioShell.tsx` (`web build`), read at `src/studio/StudioApp.tsx`.
**One new build-time flag, a presentation switch only** — every panel it
fronts (`ReplicaWorkspace`, unchanged) is the same component reading the same
data behind the same blockers whether this is on or off; nothing here is a
new capability, a new gate, or a new SQL statement.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `VITE_STUDIO_SHELL` | `src/studio/StudioApp.tsx` (`STUDIO_SHELL_UI`) | optional (switch) | **UNSET = ON**, the one flag in this file with that default; only the exact string `"0"` turns it off | unset or any value other than `"0"`: a signed-in creator sees the three-tab shell (Feed / Meet / Share) as the default view, with a plain "All panels" link one tap away to the old wizard rail (`StudioShell.tsx`'s own `onShowAllPanels`, a runtime view toggle, not a rebuild). Set to `"0"`: the studio renders exactly as it did before this workstream, and the shell component is never mounted. This is a Vite build-time env var (baked into the bundle by `npx vite build`, same caveat §25's `VITE_VOICE_IDENTITY_CHALLENGE` row already names): flipping it on Vercel needs a rebuild to take effect |

**Why unset = on, against this file's own pattern of every other flag
defaulting off.** Every prior flag in this manifest gates a NEW capability
this codebase had not earned trust in yet (a spoken identity challenge, an
invite wall) — defaulting off is the safe direction for something that might
not work. This flag gates a REARRANGEMENT of capabilities that already exist
and are already gated exactly as they were (`context/decisions.md#ws-r31-studio-shell-unset-is-on`):
the whole point of WS-R31 is that a creator reaches the same panels sooner,
so a deploy that forgot to set this var should still ship the shorter path,
not silently keep the longer one. The rollback lever is the in-page "All
panels" link, not this var — the var exists only so a real production defect
in the shell can be switched off without a person's browser cache serving a
stale bundle in between.

**Where the shell gets its three headline reads**, none of them a new
fetch: `src/studio/ReplicaWorkspace` (exported for the first time this
workstream, unchanged otherwise) now accepts three additive, optional
callback props — `onReadiness`, `onInterviewPreview`, `onRoomState` — wired
to `ReadinessPanel`, `MirrorCallStudio` and `RoomStudio` respectively, each
already computing the exact fact the shell needs on the exact read it was
already making. `RoomStudio.tsx` and `MirrorCallStudio.tsx` gained the same
kind of additive prop; no existing caller of either is affected, since both
default to `undefined` and are called with the optional-chaining operator
they were both already written with (`onStatusChange?.(...)`'s own pattern).

**No new SQL. No new server-side env var.** Everything this workstream
touches is `src/studio/`, `scripts/check-layout.mjs` (a new named layout
target, `studio:shell`) and `evals/studio-shell/` (a new offline gate).

## 27. The payout status webhook (`vercel-app`, WS-R56, migration 111, 2026-09-04)

`api/payout-webhook.js` (the door, `POST /api/payout-webhook`, auto-routed by
Vercel's own file-based convention — **no `vercel.json` rewrite added**,
matching `api/payments-webhook.js`/`api/_room-telegram.js`'s own webhook
doors, none of which needed one either), `api/_payments.js`'s
`applyPayoutWebhook`, and `api/_payments/providers/{fake,razorpay}.js`'s new
`verifyPayoutWebhook`/`parsePayoutEvent` pair. Closes the open item
`context/STATE.md` and this workstream's own brief both name: WS-R36 built
`markPayoutSent`/`markPayoutSettled` with no caller anywhere in this tree;
this workstream gives `settled`/`failed` a real caller (a `sent`-marking
caller remains unbuilt — see `api/_payments.js`'s own comment on
`applyPayoutWebhook` for why its WHERE spans `queued`/`sent` rather than
assuming the missing step ran).

The three PAYMENTS\_\* vars below existed before this workstream
(`api/_payments.js`'s `providerSecrets`) and were never listed in this
manifest — a pre-existing gap, out of this workstream's own scope to close
in full; only the ONE var this workstream adds is a new row here.

| name | consumed at | required | fallback | breaks without it |
|---|---|---|---|---|
| `PAYMENTS_FAKE_PAYOUT_WEBHOOK_SECRET` | `api/_payments.js:providerSecrets` (the `fake` branch) | optional | unset falls back to the SAME value as `PAYMENTS_FAKE_WEBHOOK_SECRET` (pre-existing, also undocumented before this row) | nothing breaks — a deployment that never sets this one keeps signing/verifying the payout webhook with the identical secret the Subscriptions webhook already uses, which is the byte-for-byte fake-provider behaviour this workstream shipped with in `evals/payouts` and `evals/room-doors` |

**The `razorpay` provider's own secret carries one new OPTIONAL field, not a
new env var**: `providerSecrets`'s `razorpay` branch already returns
whatever JSON keys live behind `PAYMENTS_SECRET_REF` unfiltered (§ this
file never documented before — `accountNumber`, read by
`api/_payments/providers/razorpay.js`'s `sendPayout`, is the existing
precedent for an unvalidated optional field in that same blob).
`applyPayoutWebhook` reads `secrets.payoutWebhookSecret`, falling back to
`secrets.webhookSecret` when absent — an operator who configures RazorpayX's
payout webhook with its own signing secret adds a `payoutWebhookSecret` key
to that JSON blob; an operator who reuses one webhook secret for both
products never has to.

**NOT VERIFIED (named, not guessed — WS-R56, 2026-09-04).** This
workstream's brief permitted no network beyond 127.0.0.1 and npm (only
WS-R60 may fetch provider documentation this wave), so nothing about
RazorpayX's own payout webhook was checked against a live document this
session. Marked by name in `api/_payments/providers/razorpay.js`'s own
comments on `verifyPayoutWebhook` and `parsePayoutEvent`:
  - the header name `X-Razorpay-Signature` for a PAYOUT webhook specifically
    (assumed identical to the Subscriptions webhook's own header, which WAS
    fetched and cited, 2026-09-03 — see that file's `verifyWebhookSignature`);
  - the envelope shape `{event, payload:{payout:{entity:{...}}}}` (assumed
    from the SAME skeleton the Subscriptions/Payments webhooks use, per
    `api/_payments.js`'s own `parseWebhookPayload`);
  - the exact webhook EVENT NAMES `payout.processed`/`payout.reversed`/
    `payout.failed`/`payout.rejected` (the Payouts Entity's own `status`
    values were partially confirmed by WS-R41's `sendPayout` fetch,
    2026-09-04; the WEBHOOK event names for the same outcomes were not
    independently fetched);
  - whether RazorpayX issues a SEPARATE signing secret for a payout webhook
    at all (the reason `payoutWebhookSecret` exists as an optional field
    rather than an assumed-shared one).

Reversal condition for all four: whoever can next reach
`razorpay.com`'s own RazorpayX payout-webhook page (or a sandbox account)
confirms or corrects them — `context/rejected.md#ws-r41-provider-docs-sites-resist-a-single-page-fetch-tool-two-ways`
names the exact URLs that resisted a single-page fetch tool for the
adjacent Payouts API this session reused conventions from.

**No other new env var.** The rate limit gate reuses the EXISTING
`payments_webhook_ip` scope (`api/_rate-limit.js`) rather than minting a
second one — both doors are the same provider's own delivery IPs, not a
person — so `api/_rate-limit.js` is untouched by this workstream.

## 28. UPI Autopay, verified (`vercel-app`, WS-R69, 2026-09-05)

**No new env var.** This workstream verified the follower Room's UPI Autopay
mandate against Razorpay's own documents, fixed the fake provider twin to
emit a realistic event sequence, and added the checkout disclosure copy the
brief required — no new secret, no new `PAYMENTS_*` variable. `evals/payments/run.mjs`
grew from 78 to 98 assertions (§12–§15); `evals/renewals/run.mjs` (54) and
`evals/payments-reconcile/run.mjs` (38, the WS-R42 ledger/reconcile suite)
were run and are UNCHANGED, per this workstream's own law 4.

| mark | status | citation |
|---|---|---|
| How a Subscription is created for UPI Autopay (payment_method/upi fields) | **VERIFIED** — answered "there is no such field" | `razorpay.com/docs/payments/subscriptions/create/`, fetched 2026-09-05: the documented request body is `plan_id`, `customer_notify`, `total_count`, `quantity`, `start_at`, `expire_by`, `notes`, `addons` — no method/payment-method field anywhere; UPI Autopay is picked on Razorpay's own hosted Checkout page, never in this call |
| The mandate amount versus the plan amount | **VERIFIED** | `razorpay.com/docs/payments/subscriptions/workflow/`, fetched 2026-09-05, quoted verbatim: "Immediate start: charged the plan amount (not refunded); Future start: charged ₹5 (auto-refunded)" — `createSubscription` never sends `start_at`, so the mandate's own authentication transaction IS the plan amount |
| Pre-debit notification timing | **VERIFIED** | `razorpay.com/blog/what-is-upi-autopay-recurring-payments-razorpay-subscriptions/`, fetched 2026-09-05, quoted verbatim: "pre-debit notifications will be sent to consumers 24 hours prior to the debit" |
| Pre-debit notification sender, for UPI specifically | **STILL OPEN** | the only page reachable that names a sender (`razorpay.com/docs/announcements/rbi-card-mandate-guidelines/subscriptions/`, via the cloudfront mirror) scopes it to CARD e-mandates ("Banks should send customers a pre-debit notification..."), not UPI; `npci.org.in` was unreachable across six attempts — `context/rejected.md#ws-r69-npci-org-in-unreachable-by-this-sessions-fetch-tool` |
| Rs 15,000 ceiling (existence) | **VERIFIED (by an earlier workstream, unchanged)** | `api/_payments/providers/razorpay.js`'s own header, "RBI's Digital Payments E-mandate Framework, 2026... fetched 2026-09-03" |
| Rs 15,000 ceiling — what happens above it | **STILL OPEN** | no `razorpay.com`/`npci.org.in` page this session reached states it directly; not consequential today (every Room price, Rs 299–599, is two orders of magnitude under it) |
| Webhook events handled vs ignored | **VERIFIED (unchanged — already fully answered)** | `api/_payments.js`'s own `KIND_TO_STATE`: handled = `authenticated`/`activated`/`charged`/`resumed`/`paused`/`halted`/`cancelled`/`completed`; ignored (logged only) = `pending`, `payment.failed` |
| Only the customer can resume a customer-paused Subscription | **VERIFIED, a new finding** | `razorpay.com/docs/payments/subscriptions/faqs/`, fetched 2026-09-05, quoted verbatim: "No. You cannot resume a Subscription paused by your customer. Only your customer can resume such Subscriptions." — this is why the Room has no "resume" button anywhere (confirmed by grep) and why `copy.ts`'s new `paused` copy says "resume it from your UPI app," never a dead in-Room control |
| Seat-quantity updates do not work on a UPI/Emandate subscription | **VERIFIED, a new finding, OUT OF THIS WORKSTREAM'S SCOPE** | same FAQ page, quoted verbatim: "You can only update a Subscription authorised using cards and not via UPI and Emandate." Affects `api/_payments.js`'s `updateOrgSeats` (the SUITE seat lane, a different lane than this workstream's brief), which calls `updateSubscriptionQuantity` unconditionally — a real gap if a Suite's own subscription is ever authorised via UPI, named here rather than fixed (out of scope) |

**What changed in code**, all in the follower Room lane only:
- `api/_payments/providers/fake.js`: new `mandateEventSequence()` — the fake
  twin now emits `authenticated -> activated -> charged... [-> halted]` in
  Razorpay's own documented order, so `evals/payments/run.mjs` §12/§13 drive
  the REAL state machine through a realistic multi-cycle lifecycle rather
  than one hand-picked kind at a time.
- `api/_payments.js`: `followerSubscriptionStatus` now derives a `'halted'`
  DISPLAY state (never a stored one — `vy_room_subscription_state_check`,
  migration 078, is UNCHANGED, no widening needed) from the most recent
  matching `vy_payment_event.kind` when the stored state is `'paused'`. New
  SQL (for EXPLAIN): `select kind from vy_payment_event where subscription_id
  = ($1)::uuid and kind in ('subscription.paused', 'subscription.halted')
  order by received_at desc limit 1` — runs ONLY when the stored state is
  already `'paused'`, so every other read pays nothing new.
- `src/room/copy.ts` / `RoomApp.tsx`: the checkout disclosure (`pay.mandateNote`/
  `mandateNoteNoPrice`, both locales) rendered at all three subscribe
  surfaces (the plain capped screen, the cap-reached offer, the
  session-worked offer); `account.subscriptionStates.halted` added, `paused`
  reworded to name the UPI app, both locales.
- `src/room/roomPayApi.ts`: `RoomSubscriptionState.state` widened (TypeScript
  union only — no CHECK, no migration) to include the virtual `'halted'`
  value the API can now return.

See `context/measurements.md#ws-r69-upi-autopay-verification-2026-09-05` for
the full citation table and `context/decisions.md`/`context/rejected.md` for
the fixed shapes and the closed fetch paths.

## 29. Dormancy (`vercel-app`, WS-R75, migration 119, 2026-09-05)

A follower who has not visited for a long time is told, then forgotten with
a receipt, on a schedule the follower can see, behind a flag that is off.
No new person table — both new columns ride existing rows (`vy_room.
dormancy_days`, `vy_room_follower.dormancy_notice_at`). See `api/_dormancy.js`'s
own header for the full mechanism.

| Var | Read by | Required? | Exact value | What changes with it |
|---|---|---|---|---|
| `ROOM_DORMANCY` | `api/_dormancy.js:dormancyEnabled()`, read by `api/renewals-sweep.js`'s handler and `api/_dormancy.js:dormancyThisWeek()` | optional (switch) | must equal the exact string `"1"`; anything else (including unset, `"true"`, `"yes"`) is off | **off (default)**: the columns exist the moment migration 119 is applied, an owner can still set `dormancy_days` on their own Room and a follower's account page still renders the policy sentence — but the daily sweep (`api/renewals-sweep.js`, WS-R37's own `0 0 * * *` cron) runs neither of `api/_dormancy.js`'s two statements, so no notice is ever sent and no follower is ever forgotten by this mechanism. **on**: the sweep also notices due followers and forgets overdue ones through the REAL `roomForgetForFollower` (`api/_room-surface.js`), every run |

No new cron entry — `ROOM_DORMANCY` gates a step folded into WS-R37's existing
`renewals-sweep` cron (this workstream's own law 2: "the daily sweep gains
two statements"), never a second `vercel.json` crons entry. The owner sets
this on Vercel like any other `process.env` var (not a `VITE_` build-time
flag — no frontend rebuild needed to flip it).

`ROOM_TELEGRAM_BOT_TOKEN` (already in this manifest, §15c) is reused, not
invented, for the one real delivery channel this workstream wires (a
dormancy notice's Telegram DM). Web push is deliberately NOT attempted — a
real, previously undiscovered gap found while building this workstream:
`public/room-sw.js`'s own push handler drops any payload whose `t` is not
the literal string `"checkin"`, so `api/_renewals.js`'s own `t:"renewal"`
push (WS-R37) is already silently discarded on arrival, unproven end to
end. See `context/rejected.md#ws-r75-web-push-type-switch-drops-every-non-
checkin-payload`. WhatsApp stays structurally present and inert: no
dormancy-specific template is approved (this repo has only
`vyakti_checkin_v1`, `api/_room-whatsapp.js`), and Meta refuses free-form
text outside an approved template.
