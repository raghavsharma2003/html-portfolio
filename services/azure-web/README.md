# Azure web package

Production hosting adapter for the existing Vite frontend and Node API handlers. It is separate from the loopback development server. No Next.js, Vite server, local Docker, GPU image or replacement auth layer is introduced.

This package is not deployed. Source/fixture verification is separate from remote image build, target identity/config admission, complete release and real-user acceptance. Its health endpoints explicitly report only web-artifact readiness.

## Prepare and build after the release is accepted

From the exact reviewed checkout:

```powershell
node services/azure-web/prepare.mjs --out C:/absolute/new-build-context
```

The output directory must not exist. The preparer copies a positive source list and writes its commitment manifest. Local config, dotenv, owner audio, weights, private keys, scratchpad and unneeded repository files are excluded. The image build verifies the complete context before npm install. The expected source identity includes the Azure adapter and runtime helper imports, so `verify-deploy.mjs` still measures this code.

The following remote commands are the deployment procedure, not commands executed by this change. Substitute reviewed resource IDs, exact HTTPS preview origin and source tag. Do not put keys in command arguments.

```text
az acr build --registry <existing-acr-name> --image vyakti/expert-web:<source-tag> --platform linux/amd64 --file services/azure-web/Dockerfile --build-arg OTA_BASE_URL=<exact-https-origin> <new-build-context>
az bicep build --file services/azure-web/infra/main.bicep
az deployment group validate --resource-group <reviewed-group> --template-file services/azure-web/infra/main.bicep --parameters <reviewed-parameters-file>
```

Resolve the returned ACR image to its immutable digest before supplying `imageDigest`; a tag is not the release identity. Use a separate CPU app name, existing environment/identity/registry, reviewed non-secret runtime settings and Key Vault reference entries. Registry pull uses the existing `registryUsername` and exact versioned `registryKeyVaultUrl`, referenced as `web-registry-password`. The managed identity reads that reference from Key Vault; this path does not require a new AcrPull role. The registry password is never a container environment variable. No role assignment or GPU configuration is created by the template. Existing identity permissions and target capacity require real readback. The image uses the already-repository-pinned Node24 Alpine digest; native module boot is still a required remote-build test.

Build inputs have no runtime secrets. Build-only `_config.js` is inert and never copied to the final image. Runtime startup recreates the file from secret environment, validates explicit Azure configuration and exact database identity, then imports API handlers. Only the API directory permits this runtime file write; static files remain owned by root. Never expose the application source root as a static directory.

## Runtime fields

- `STUDIO_ROOT=1`, `VYAKTI_MODEL_SERVING=azure_only`, `VYAKTI_REPLY_PROVIDER=azure_foundry` are mandatory.
- `AZURE_WEB_PUBLIC_ORIGIN` is the exact HTTPS ingress origin; ordinary requests with another Host are refused. Calculate the app FQDN from the existing environment domain before setting up the preview, then verify actual ingress readback. Health probes are host-independent and reveal no secret values.
- `VYAKTI_DATABASE_NAME` must equal the database part of `NEON_URL` and actual `current_database()`.
- Supabase URL/key, Azure reply fields and budget/pricing must satisfy their current validators. Private rehearsal encryption keys, upload/storage, erasure and other features retain their existing requirements. No disabled provider is advertised as available.
- `AZURE_WEB_TRUST_INGRESS=1` is only for the configured Azure ingress. It consumes the last appended valid forwarded IP and discards caller-supplied Vercel/real-IP headers. Direct local adapter tests leave this off. Ingress forwarding semantics still need target verification before public use.
- Verify the exact new `/studio` OAuth redirect in Supabase before claiming Google or magic-link return acceptance. Inline email-code verification has its own `/api/account` path and requires a separately reviewed real inbox canary; missing Management API credentials do not by themselves establish that this path is unavailable. Same-origin frontend/API needs no new cross-origin auth bridge.

## Routing and boundaries

The adapter compiles the current declarative Vercel route/header subset and rejects unsupported future syntax. It preserves the conditional crawler rewrite, source-path headers, destination parameter priority, repeated query values, response streaming and raw IncomingMessage handlers. Unknown API and static paths return404; no global SPA fallback exists. The generated public manifest excludes fixture/private paths and maps. Startup verifies asset and API/helper hashes. Runtime symlinks and traversal are refused.

These are parity controls for the repository's current 18 rewrites and 15 header rules, not an implementation of all Vercel CDN features. No CDN/WAF, cross-region failover or native module acceptance is inferred from Node tests. The global Azure fetch wrapper does not sandbox node:http, SDKs, workers or browser network access.

## Schedules and cutover

Request cancellation preserves native response close/aborted events and exposes `req.signal` for handlers that support it. The adapter deadline aborts this signal and ends the response; it does not prove that an existing handler or remote provider stopped work. Handlers must consume their existing cancellation contract to stop provider work. The parsed-body limit is 8 MiB; `bodyParser:false` deliberately preserves the raw stream and uses each existing handler's own limit. For example payment and payout webhook readers reject above 1,000,000 bytes. This is not a universal upload limit or an execution sandbox.

The Bicep template reads the same 22 cron declarations from vercel.json. By default `enableSchedules=false`, preventing a second scheduler during preview. At reviewed cutover enable the jobs and disable the old schedules atomically as an operational step. Jobs use the same image with a different command, one execution per event, zero automatic retries, an exact allowlisted path and only the CRON_SECRET reference. No secret response bodies are logged. A successful web deployment with schedules disabled is not full lifecycle completion.

The API processing worker remains a separately built/deployed service. This CPU image does not contain speech model weights, FFmpeg/ClamAV processing tools or a GPU. Existing remote job/capability refusal must remain intact. Do not turn off those gates to make preview look complete.

One explicit data exception to excluding evals: the committed `evals/dbattery/prosody-baseline-log.json` is a direct runtime read by `_drift-watch.js`. It is source-committed and packaged privately so this existing caller keeps its input. It is never in the static manifest; its historical values are not current voice-quality acceptance. No other eval code or fixture is included.

## Required acceptance

Run native adapter tests and package controls, then the complete frozen release. Compile/validate Bicep, build remotely, inspect final layers and manifest, verify actual module imports and the health/release marker. Run target schema/config gates and a bounded authenticated account-to-answer-to-erasure canary. Confirm no inference on replay, no private file serving, real auth callback and exactly one schedule authority. Finally test actual mobile/desktop flow and preserve previous immutable revision for rollback. Public alias change remains root-reviewed release work.

References: [ACR remote build](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-quickstart-task-cli), [Azure containers](https://learn.microsoft.com/en-us/azure/container-apps/containers), [Azure jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs), [Vercel rewrites](https://vercel.com/docs/routing/rewrites).
