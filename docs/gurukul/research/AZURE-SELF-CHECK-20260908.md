# Provider-aware self-check

8 September 2026 IST. Isolated `codex/azure-self-check` from checkpoint25 `7d4b121abf73a171b44e3e1baba467c39d8ba38f`. The two frozen Azure build-config scripts are copied only as prerequisites and excluded from this delta's merge list. No integration, configuration, production, model or real database change.

## Actual caller and repair

`api/self-check.js:46` calls `runSelfCheck` with real environment/database dependencies. It records failing doors through `recordSelfCheckIncidents`, writes absent optional names separately, and sends the existing bounded operator summary. The cron response and sweep counts expose only numeric counts and a boolean. Thus the unconditional `OPENROUTER_KEY` required classification could create a real false incident even after the new build validator accepted Azure-only configuration.

The existing `REQUIRED_ENV` and `OPTIONAL_ENV` exports remain the default companion lists and exact legacy build-script mirror. New pure `api/_self-check-serving.js` returns no override in that default. Explicit `VYAKTI_MODEL_SERVING=azure_only` or `VYAKTI_REPLY_PROVIDER=azure_foundry` selects Neon plus the actually used endpoint/key names, reply model, reply-specific rates and application budget. `envPresence` marks those names required without duplicates and marks OpenRouter optional only in that selected lane. Unused generic endpoint/key names remain optional when reply-specific overrides exist.

Presence alone is insufficient: the helper invokes the existing runtime provider policy and shared-reply config validator. `runSelfCheck` adds its fixed provider configuration check, so an invalid but present endpoint/model/rate/budget, conflicting provider, or whitespace-only Neon remains a failure. Only an allowlisted fixed code is exposed; arbitrary exception messages/codes, URLs, credentials, lengths and prefixes never enter the result. Existing database, migration and sweep checks still run and retain their independent failures. No new provider request or SQL is performed by the classifier.

Default legacy env rows and entire `runSelfCheck` results were compared against retained old code for empty, missing-OpenRouter and configured environments. They remain equal. The old false-negative is retained: with valid synthetic Azure settings and a successful injected database, old code's only failing door is `env: OPENROUTER_KEY missing`; the repaired code accepts the same shared-reply configuration. This is configuration classification, not a successful provider call.

## Evidence

`node evals/azure-self-check/run.mjs --record`: 21 groups passed at 2026-09-07T19:32:28.496Z, receipt `scratchpad/azure-self-check/1788809548557.json`. Tests execute actual old/current self-check and existing incident consumer with exact routed SQL fixtures and a throwing global fetch sentinel. Covered valid explicit modes, fallback names, unique boolean presence rows, ten invalid cases, downstream incident writes, unchanged legacy mirrors/results, database failure preservation and no input markers in observable output. No real SQL execution or provider availability follows from these fixtures.

Existing self-check85 and keyring14 emitted controls passed. Context and syntax/diff checks are recorded in the manifest. The first new run failed on missing ignored `_config.js`; a direct retained-old import reproduced the same `ERR_MODULE_NOT_FOUND` through the incumbent `_db.js` import closure. An explicitly empty stub, generated under an environment whitelist with no credentials, supplied that existing eval prerequisite. This did not require changing production imports or reading a real local config. The new classifier itself reuses the pure closure already bootstrap-tested by the separate Azure build candidate.

## Separate capability requirements

| Capability | What this check establishes | Still required separately |
|---|---|---|
| Shared Azure replies | Selected config syntax/presence and existing DB/schema/sweep findings | Actual target model access, rates/SKU agreement, provider admission and protected delivery canary |
| Private structured dialogue | Nothing beyond shared infrastructure checks | AZURE_FOUNDRY_DIALOGUE_MODEL and the structured endpoint/key plus its own generic token rates; actual private handler readiness |
| Private encrypted tests | No key availability or readback claim | PRIVATE_TEXT_REHEARSAL_KEK_ID, PRIVATE_TEXT_REHEARSAL_KEK_B64 and retained key continuity |
| Owner authentication | Existing absent SUPABASE names remain in the separate optional-absence report | Actual SUPABASE_URL/SUPABASE_KEY configuration and authenticated owner/cross-owner checks |
| Upload and erasure storage | No storage readiness claim | Exact write locator, selected provider credentials/CORS/capability/worker and scoped cleanup proof |

There is no new global private-feature requirement: not every Azure shared-reply deployment enables private rehearsal. The test deliberately demonstrates that absent private dialogue/KEK settings do not make this narrow configuration check claim those capabilities are ready. Missing capability settings should remain named by their actual runtime readiness handlers. No remote environment presence was inspected or inferred.

Decision: operations health must reflect the explicitly selected provider, while retaining separate capability readiness and default legacy behavior. Reverse or refine on a false passing invalid Azure configuration, changed legacy result, leaked input, or a provider-specific failure failing to reach the existing incident consumer. No deployment or identity/publication permission follows.
