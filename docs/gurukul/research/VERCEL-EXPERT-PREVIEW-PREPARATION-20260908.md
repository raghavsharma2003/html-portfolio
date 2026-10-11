# Expert preview target and build preparation

8 September 2026 IST. Read-only Vercel connector calls plus local source review at frozen integration `7d4b121abf73a171b44e3e1baba467c39d8ba38f`. Applied the installed vercel:vercel-api skill. No deployment, environment change, browser, model, database, service invocation or credential workaround. This report does not assert full-release25 acceptance.

## Target metadata: access unavailable

All four targeted connector reads returned HTTP403 Forbidden: get_project and list_deployments for each project below, scoped to the exact supplied team `team_hQIoipGIvf1GHVj3878tDOR3`.

| Project | Safe identity | Current Git binding / production branch / recent deployments / environment names |
|---|---|---|
| vyakti-replica-lab | `prj_rfW81HIge0vtG6nzIcO41OGB5fP9` | Unavailable through this connector. Local documentation and verify-deploy's default identify this as the intended Vyakti destination, but current remote binding and access are not verified. |
| html-portfolio | `prj_zcIgdPKVM07KsFgLbAwETXrdJU0w` | Unavailable through this connector. Do not substitute it as an expert preview target merely because the repository has this name. |

The enabled Vercel tool catalog has get_project/list_deployments/get_deployment but no environment-list tool. No environment-name or presence result was obtained. A403 does not establish whether the team/project is absent, the account lacks membership, or the connector lacks permission. No tokens, environment values, signed links or logs were printed. Re-establish read access to these exact project/team identities before claiming the intended target is confirmed; no new project or permission change was attempted.

## Actual source constraints

Paths here are relative to `scratchpad/expert-integration`.

- `.github/workflows/deploy-web.yml:28` triggers main and the companion branch, not codex/expert-unified. Its deploy pins another project, `prj_NZ4BT0Vr2BbkVrvWPcJNF68XCObp`, and uses `--product meera-companion --prod`. Its required OpenRouter/Google configuration belongs to that companion release. Do not dispatch this workflow to publish the expert preview.
- `scripts/vercel-product.mjs:12` chooses vyakti-clone only for `STUDIO_ROOT=1` or the exact old `claude/gurukul-platform` ref. The new expert branch requires the explicit product setting. Nearby shell comments describe a wider branch family than the actual selector implements.
- `scripts/deploy-vercel.mjs` creates a source commitment and sends four VYAKTI_SOURCE_* build metadata fields. `scripts/vercel-install.sh` runs `write-deploy-marker.mjs` before npm ci; that marker refuses missing/invalid commitment or a product mismatch. A raw Git-triggered deployment with no matching metadata is not proven to pass this contract. Use the reviewed full-source wrapper path for a prospective preview; avoid the thin fallback that fetches a mutable branch.
- `.vercelignore` excludes workstation `_config.js`, local env files and keyrings. Retain that boundary. Target environment values must arrive through the target configuration, not a local credential file upload.
- `scripts/write-config.mjs:170` still requires OPENROUTER_KEY and NEON_URL regardless of actual provider selection. Thus a valid Azure-only configuration without OpenRouter returns failure. `scripts/vercel-build.sh:41` catches generator failure and invokes `--stub`, then continues to Vite. Important qualification: the writer constructs its file from available environment values BEFORE its required-variable check; `--stub` skips that check but does not erase supplied values. Therefore this source audit does NOT establish that missing OpenRouter necessarily destroys otherwise valid Azure/auth/DB settings. The real defect is misleading validation plus a build-success path without Azure readiness validation. Do not add an external provider key simply to satisfy it.
- Build runs Vite and OTA packaging, not the full release gate. A READY static deployment is not private-answer readiness.

## Configuration names to verify, not observed presence

| Purpose | Actual source names / qualification |
|---|---|
| Product and strict serving | STUDIO_ROOT; VYAKTI_MODEL_SERVING; optional VYAKTI_REPLY_PROVIDER for shared replies. Private rehearsal uses its own fixed Azure structured generator. |
| Source commitment | VYAKTI_SOURCE_PRODUCT, VYAKTI_SOURCE_COMMITMENT, VYAKTI_SOURCE_INPUT_FILES, VYAKTI_SOURCE_INPUT_BYTES, supplied by the wrapper for the exact artifact. |
| Auth / relational state | NEON_URL, SUPABASE_URL, SUPABASE_KEY; verify exact intended isolated pilot DB/schema and authenticated owner behavior. `_db.js` and `_auth.js` prefer runtime environment over baked config. |
| Private structured answer | AZURE_FOUNDRY_ENDPOINT, AZURE_FOUNDRY_API_KEY, AZURE_FOUNDRY_DIALOGUE_MODEL; `api/_dialogue/registry.js` has no external fallback. Its adapter requires HTTPS services.ai.azure.com. |
| Accounting | AZURE_REPLICA_BUDGET_ID, AZURE_REPLICA_APP_BUDGET_USD, AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS, AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS. Keep the existing authorized ledger/rates; do not create another budget implicitly. |
| Private encrypted payload | PRIVATE_TEXT_REHEARSAL_KEK_ID and PRIVATE_TEXT_REHEARSAL_KEK_B64; absence is a platform blocker. Preserve key identity across redeployment or retained results cannot be read. |
| Actual upload/erasure storage | REPLICA_STORAGE_WRITE_BUCKET and the selected provider credentials. The tested Azure path uses AZURE_REPLICA_STORAGE_ACCOUNT, AZURE_REPLICA_STORAGE_ACCOUNT_KEY, AZURE_REPLICA_STORAGE_CONTAINER. Historical storage cleanup may additionally require its original provider authority. Verify target CORS/capability/worker configuration separately; variable presence alone does not prove it. |

These are the minimal traced names for preparation, not the complete environment manifest or evidence that any are set remotely. No voice, identity or publication grants should be enabled to make a private text preview work.

## Canary and reversal preparation

After root accepts the frozen release and the target/config blockers are resolved: create an explicit preview on the confirmed vyakti-replica-lab project with the source wrapper, no production flag or alias promotion. Record safe deployment ID, exact commit/commitment, target environment and prior accepted deployment ID. Run `verify-deploy.mjs` against the explicit preview URL and product, not its default production URL. Its existing tests check marker, landing/app assets and unauthenticated lifecycle/upload/voice boundaries; they do not yet exercise private rehearsal.

Add a bounded preview-specific check of unauthenticated private-rehearsal refusal, then the actual owner auth -> upload -> private draft -> explicit single Azure ask -> durable GET/replay -> withdrawal/source cleanup using a fresh synthetic scope, current authority and existing ledger. Check EN/HI/Hinglish claims only to the extent actually sampled. No automatic paid retry on an uncertain response. Root owns execution and scope approval.

If source/product marker, auth, Azure-only routing, private authority, billing, erasure or first-use fails, stop preview invitations and retain the failed artifact. Withdraw the exact synthetic test scope through existing handlers and preserve unsettled spend for reconciliation. Keep production aliases untouched. Prior-deployment rollback requires a confirmed target and a known accepted deployment; neither ID is currently available from the403 connector. Rolling back app bytes does not roll back grants, database migrations, keys or provider spend. Do not destructively reverse shared schema or lose encrypted-result keys.

**Decision:** prepare a source-pinned private teacher preview on the intended Vyakti project, conditional on actual target readback and build-config repair. **Reversal:** use another target only after explicit project identity/configuration review, never directory-name auto-linking; keep the preview unavailable if no exact artifact, serving configuration or authority proof can be obtained. No deployment ETA follows from a403 or a local passing gate.
