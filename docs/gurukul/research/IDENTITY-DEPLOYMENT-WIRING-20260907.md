# Identity deployment wiring, 2026-09-07

Read-only source audit at frozen integration checkpoint `a0e2523c` during release 12. This report is outside the integration tree. No deployment, database/provider request, credentials inspection, remote fetch, or live inventory query was performed. The parent is independently checking Azure inventory. This report supplements `FRESH-ENROLLMENT-RESOLUTION-20260907.md`; it does not repeat the enrollment state analysis.

## Immediate deployment gap: container parameter

The Azure document transport source now consumes `VYAKTI_PRIVATE_SOURCE_AZURE_CONTAINER` when `VYAKTI_PRIVATE_SOURCE_ORIGIN` is an exact Azure Blob account origin (`services/azure-verifier/src/config.js:59-68`). The service README and ENV-MANIFEST already document the new variable. **The Bicep template does not pass it.** Its `privateSourceOrigin` description still says Supabase (`services/azure-verifier/infra/main.bicep:17`), and the environment list passes only the origin (`:129`). An Azure-origin deployment using this template would fail startup with `source_container_required`.

Smallest next patch, after the freeze:

1. Add a plain, non-secret `privateSourceAzureContainer` parameter, default empty for existing Supabase deployments. Pass it as `VYAKTI_PRIVATE_SOURCE_AZURE_CONTAINER` in the container environment. Update the origin description to state exact Supabase project or Azure Blob account origin. Preserve all Face enable/approval defaults as false and all existing erasure assertions.
2. Add local template/config contract checks: the parameter reaches the exact env name; a synthetic Azure origin plus container starts configuration with liveness disabled; omitted/invalid container fails; Supabase remains supported. Include a negative control removing the env mapping. Compile Bicep locally if the compiler is available; a text check is not a deployment validation.
3. At an authorized deployment phase, use a fresh immutable image digest containing the transport patch, with the actual account/container matching the app's source locator. The service Dockerfile copies `src` into Node 24 without a build step, so a new image is required; editing API deployment environment alone cannot update this service.

No storage account key belongs in this broker deployment. The app issues a short read-only signed capability; the broker consumes that URL under the exact origin/container/path/expiry checks and verifies returned bytes. The app-side `createSignedReplicaRead` route still needs its own storage signer configuration. The two sides must refer to the same locator, not merely to any Azure storage account.

## Application and service settings must agree

| Deployment boundary | Required wiring, not evidence of current readiness |
| --- | --- |
| App identity selector | `REPLICA_IDENTITY_VERIFIER=azure_identity_composite`; explicit identity enable and independent-review readiness flags; endpoint ending `/v1/identity/verify`; pinned adapter version and 32-byte broker HMAC key. See `api/_identity/registry.js:3` and `providers/azure-composite.js:38-46`. |
| App official Face session selector | `REPLICA_FACE_SESSION_BROKER=azure_face_liveness_quicklink`; explicit enable, limited-access and dedicated-resource flags; broker origin; broker HMAC key; separate device-correlation HMAC key; pinned broker and Face model versions. See `api/_face-session/providers/azure-quicklink.js:38-54`. |
| App composite liveness selector | `REPLICA_LIVENESS_VERIFIER=azure_face_speech_composite`; explicit enable and limited-access flags; endpoint ending `/v1/liveness/verify`; pinned version and HMAC key. **The configured endpoint implementation is missing from the supplied broker; see below.** |
| Azure verifier service | Exact private-source origin/container; service version; Document Intelligence and Face resource endpoints/keys; independent review endpoint/key/version; broker HMAC; separate session sealing key; public app origin and Face configuration when enabled. Its Bicep maps secrets through Key Vault references and a user-assigned identity. Provisioning those resources, access and secrets is not part of this template. |
| Scheduling | Deployed app `CRON_SECRET` and its authenticated cron delivery. Every inspected sweep requires a bearer secret of at least 24 bytes. A configured service does not start app sweeps. |

The broker uses one platform HMAC (`VYAKTI_BROKER_HMAC_KEY_B64`) for its authenticated routes. App identity and Face session HMAC settings must match that service secret; similarly their expected service versions must match the deployed manifest. The review service uses a different HMAC contract/key. Face device correlation and encrypted session-handle sealing are different purposes and should not be substituted for the broker signing key.

The existing template sets scale zero to one replica, single active revision, external HTTPS ingress, and a user-assigned identity for Key Vault secret references. It accepts the image as a parameter but does not itself build/push an image or establish registry pull permissions. Its output exports the broker origin and identity endpoint only; derive documented Face session URLs from that same origin. It does not create a document-review service, Face resource, or Document Intelligence resource.

`/health/ready` in `services/azure-verifier/src/server.js:41-46` reports configured dependency names and version; it does **not** probe those providers or prove that review exists. A green readiness probe therefore cannot establish bootstrap readiness.

## Callers, scheduling, and browser path

- `studio.html:55` loads `src/studio/main.tsx`; the isolated expert development server redirects `/` to `/studio` (`scripts/dev-expert.mjs:57`). `src/studio/StudioApp.tsx:101,1380` loads and renders `LivenessCapture`; identity and liveness API wrapper calls live in `src/studio/identityApi.ts` and `livenessApi.ts`. These are real source callers, not layout fixtures. The inherited `creatorStudio` copy also has wrappers; it is not evidence of a separate deployed path.
- `api/replica-identity.js` owns document case submission. `api/replica-identity-sweep.js:19-24` constructs the configured provider and runs up to two jobs; absent selector returns disabled. `api/replica-liveness.js` owns challenge issue and official Face session actions. `api/replica-liveness-sweep.js:19-22` supplies the separately configured composite liveness verifier; absent selector also returns disabled.
- `vercel.json:445-454` schedules identity, liveness and Face-session cleanup every five minutes; replica erasure is every ten minutes (`:441`). The Face-session sweep calls `configuredFaceSessionErasureBroker`, preserving cleanup when new creation is disabled (`api/replica-face-session-sweep.js:21-24`). This is committed scheduling configuration, not evidence the frozen local server or a remote deployment is running it. `scripts/dev-expert.mjs` serves handlers but contains no corresponding timer/cron scheduler.
- Browser Face capture uses Microsoft's hosted quicklink, not a bundled Azure capture SDK. `src/studio/LivenessCapture.tsx:230-249` opens a popup, calls the app action, checks the `https://liveness.face.azure.com` origin, and navigates there; a later poll requests the result. The service creates `detectLivenessWithVerify-sessions`, exchanges authorization for a quicklink, and implements result/deletion/expired-session cleanup (`services/azure-verifier/src/liveness.js:36,61,116,194,278`). Do not implement a new browser SDK path merely because the app needs Face.
- `.github/workflows/deploy-web.yml:29` triggers automatically only for `main` and the companion branch, not `codex/expert-unified`. No current workflow file builds/deploys this Azure verifier service. `docs/gurukul/DEPLOY.md` describes the desired service workflow, not an implemented one. Avoid touching companion production deployment to satisfy expert wiring.

## Additional missing endpoint: composite liveness

This is a correction to an overly optimistic reading of the earlier bootstrap report. The document/Face state flow is structurally independent of voice genomes, but the source implementation is incomplete beyond the known document review gap.

`api/_liveness/providers/azure-composite.js:12-18,78-141` requires `/v1/liveness/verify` and sends the captured media, issued phrase/hash, and identity document. It expects recognized text, speaker-continuity and synthetic-risk scores, single-speaker/capture bindings, and a provider acceptance decision. `api/_replica-liveness-verification.js:123-152` combines those outputs with independently obtained official Face proof. `:520` actually calls `verifier.verify`; the official Face session result is not a substitute for that call.

The supplied broker route table (`services/azure-verifier/src/server.js:19-26`) implements `/v1/identity/verify` and `/v1/liveness/{session,resume,result,delete,cleanup}`. It has **no `/v1/liveness/verify` route**. Setting the composite adapter endpoint to this broker would receive 404. Its Dockerfile/package contain no speech/continuity implementation that fills the missing response contract. Do not point the adapter at `/v1/liveness/result`, fabricate the missing scores, or drop decision predicates to make the flow complete.

A bootstrap deployment therefore needs either an independently implemented and evaluated Azure composite endpoint satisfying the existing decision contract, or a deliberately versioned redesign of that acceptance policy and its inputs. The newer `identity_audio`, ASR-byte, and strict speech prerequisites do not automatically implement or validate this older composite policy. That is separate work from the tiny container-wiring patch.

## Inherited branch search for reusable review implementation

Searched all **36 locally available head/remote-tracking refs** using `git grep -l` over `services/` and `api/`, excluding `_config.js`, for `/v1/document/review` and `vyakti-document-authenticity-review`. The matches were only the inherited verifier configuration, outbound `src/review.js` client, and configuration/identity tests. No handler implementing that contract was found. The search included local Gurukul, integration, origin Gurukul workstreams/voice branches, and inherited audit remotes. No network fetch was used, so this says nothing about unseen remote commits or a separately deployed external service.

A second search of the same 36 refs for `/v1/liveness/verify` and `vyakti-azure-liveness-broker/v1` found only the inherited app adapter. No service handler for that contract was found. These are exact contract searches, not a claim that no identity-related software exists anywhere in branch history.

The independent review client (`services/azure-verifier/src/review.js:7-44`) expects a signed response bound to request ID, document SHA and pinned review version; `pending` is an explicit retryable failure, and only `approved`/`denied` are accepted decisions. Its tests return synthetic signed review responses. They establish client behavior, not a real authenticity decision or human-review operation.

## Next implementation boundary and readiness evidence

Proceed with the Bicep container parameter/env mapping and focused local checks only. This makes the already-tested Azure document transport deployable; leave every readiness flag untouched. In parallel, inventory should distinguish (1) resource presence, (2) endpoint implementation/image revision, (3) authentication/config agreement, (4) actual scheduled caller delivery, and (5) measured acceptance plus erasure. None implies the next.

Before claiming fresh enrollment works, obtain an actual owner-path trace through authentic/current adult document evidence, official Face result and provider deletion, the still-missing composite verification contract, final identity settlement, and first ordinary draft. Age remains a separate prerequisite. No implementation or measurement in this report removes that requirement or authorizes training/synthesis.

## Parent-provided live inventory, separate evidence

After the source audit, the parent reported read-only ARM inventory on 2026-09-07 using existing authentication, retained in ROOT `scratchpad/expert-tools/azure-identity-readiness.json`: 33 resources in the default subscription, including 17 Container Apps/jobs, zero Microsoft.Web/sites and two AIServices accounts. No inspected app container exposed identity/liveness/document/Face/verifier/private-source environment names, and none was a named identity-verifier or document-review app. This supports absence from that inspected deployment scope, not absence from other subscriptions or externally hosted services. The reported capability fields did not establish Face limited-access approval; generic AIServices resource presence does not establish it, and missing approval evidence does not establish denial. I did not rerun these live queries.
