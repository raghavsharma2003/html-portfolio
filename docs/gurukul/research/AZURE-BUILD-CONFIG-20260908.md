# Explicit Azure build configuration

8 September 2026 IST. Isolated `codex/azure-build-config` from checkpoint25 `7d4b121abf73a171b44e3e1baba467c39d8ba38f`. Two production scripts changed; no API, deployment workflow, target environment, integration, model or database change.

`write-config.mjs` previously required OpenRouter for every non-stub deployment. The actual old writer refuses a valid synthetic Azure-only configuration without OpenRouter. The actual old Vercel build catches this failure and proceeds through its generic stub path, including when Azure settings themselves are invalid. The writer constructs exports before the old required-variable check; stub does not clear supplied values. This defect therefore concerns validation and false build success, not a claim that the stub always destroys otherwise valid settings.

When `VYAKTI_MODEL_SERVING=azure_only` or `VYAKTI_REPLY_PROVIDER=azure_foundry`, the writer now validates before writing through existing `resolveReplyServingProvider` and `azureSurfaceReplyConfig`, plus nonempty `NEON_URL`. That validates exact HTTPS Azure endpoint form, auth presence, model identifier, the reply-specific token rates and shared budget. It refuses a conflicting external provider even if an OpenRouter key exists. The explicit Azure branch also validates when `--stub` is passed. Errors expose a bounded code only, without input URLs or keys. Foundry fields remain runtime environment variables; no new secret fields are baked.

The Vercel build executes that branch with no catch-to-stub fallback, even if a config file already exists. `set -e` stops invalid explicit Azure before Vite. The no-selection companion branch and unconfigured generic static-preview stub remain unchanged. Existing local no-CI overwrite protection remains unchanged. This does not activate Azure on any target.

The reused import closure consists of `_model-serving-policy`, `_azure-surface-reply`, `_provider-budget`, `_provenance/contracts`, `_voice/contracts`, `_replica` and `_invites`, plus Node crypto. None imports `_config.js` or service credentials. The actual writer bootstrap controls execute in a directory without `_config.js`, with fetch replaced by a throwing sentinel; valid Azure completes without a bootstrap cycle or network request.

Run `node evals/azure-build-config/run.mjs --record`. Twenty-eight groups passed at 2026-09-07T19:20:30.931Z; receipt `scratchpad/azure-build-config/1788808830945.json`. Tests execute actual old/current writer subprocesses and actual Bash build scripts with a local npx sentinel stopping at Vite. They cover old rejection and old stub fallback, valid explicit modes/overrides, 13 invalid configurations, prewrite preservation, malformed `--stub`, legacy output-byte equality, legacy keyring, empty static preview, local overwrite refusal and no credential output. No real Vite/npm install or network call executes. Bash is a named test prerequisite; the suite fails rather than silently skipping if unavailable. Dependency copies are reused sequentially while every writer runs in a fresh process with reset output state.

The first run had no final receipt and was stopped after observed repeated-copy temp progress stalled; no successful result is attributed to that run. Its synthetic temporary tree `vyakti-azure-build-Omkei7` was retained. The filesystem cause was not established. The final run above completed after the test avoided redundant dependency copies. Product scripts did not change between those runs.

Existing keyring controls passed (14 emitted assertions; its early summary only counts eight), and existing self-check passed 85. Context/diff verification is recorded in the handoff manifest. No full release or browser acceptance is claimed by this agent.

## Deliberate limits

- Shared reply configuration is not private structured-dialogue readiness. The private endpoint separately requires `AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_API_KEY`, `AZURE_FOUNDRY_DIALOGUE_MODEL` and generic Foundry token rates for that deployment. Do not substitute the reply model/rates for its independent contract.
- Private readiness also needs the actual schema, `PRIVATE_TEXT_REHEARSAL_KEK_ID`/`PRIVATE_TEXT_REHEARSAL_KEK_B64`, verified owner auth configuration, selected source/storage and source-erasure worker configuration. Presence is not runtime or grant proof.
- The legacy `_self-check.js` required-env list still includes OpenRouter. Its preserved compatibility test is not evidence that its operations UI classifies an Azure-only target correctly; that is a separate follow-up.
- No target metadata was verified: the separate Vercel audit received403 for both supplied projects. No push, preview, alias, production promotion or configuration mutation occurred.

Decision: use the serving adapter's existing admission config for explicit Azure build validation, retaining the separate legacy preview contract. Reverse or refine if the build and actual adapter disagree, invalid configured Azure reaches Vite, a secret reaches output, or a supported legacy static/companion build regresses. Do not repair the gate by adding an external provider key or weakening runtime authority.
