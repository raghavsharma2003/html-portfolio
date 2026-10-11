# Modern private-dialogue adapter hardening, 2026-09-07

Source is isolated in `scratchpad/expert-corrections`, based on 46434a41. This separate patch changes only `api/_dialogue/providers/azure-foundry.js` and adds `evals/azure-dialogue-adapter.mjs`. Correction files, integration, model settings, budget laws, identity and activation remain untouched by this task.

## Decision, rationale and reversal

Require measured token counts to be explicit nonnegative safe integers, with a positive combined total matching the existing settlement law. Missing, string, fractional, negative, unsafe or nonfinite units raise `dialogue_azure_usage_invalid`; they are never coerced to zero. A reported zero in one counter remains allowed when the other is positive. The real service receives this refusal before it persists a successful reply, and retains an uncertain spend reservation.

Reject an already-aborted call before fetch, propagate later cancellation, and cancel pending body reads. Enforce the existing 512000-byte response limit while reading, including absent or false Content-Length, with no unbounded text fallback. Reject redirects through native fetch's `redirect: "error"`; explicitly reject returned 3xx or already-redirected responses. Error bodies are cancelled without copying them to logs. Preserve existing endpoint handling, request body, temperature, strict response schema, model selection and 700 output-token ceiling.

Reverse only if documented/measured normal Azure transport requires a different body or usage contract and an equally strict bounded/accountable implementation is tested. Do not relax malformed usage into estimates or follow redirects to make a smoke pass.

## Measurements and rejections

- `node evals/azure-dialogue-adapter.mjs`: **54 checks passed**, 2026-09-07, actual adapter and private-dialogue service code with synthetic transport and DB rows. Includes four executed regression mutants: old usage coercion, removed pre-dispatch abort, old full-text buffering, and removed redirect refusal option. The old-usage mutant also runs through real service settlement. A separate controlled-clock module drives the actual deadline callback without a timing claim.
- The service mutant settles missing prompt-token usage as **0 input units**. The hardened service control instead reaches `reconcile_required`, never calls the successful reply persistence or settlement query, and raises the named usage error. This is mocked control flow, not real SQL accounting evidence.
- Normal request/schema parity, exact 512000-byte boundary, overflow cancellation before reading the tail, UTF-8 split across single-byte chunks, caller/body cancellation, HTTP classifications and incomplete structured responses are covered.
- `evals/replica-dialogue/run.mjs`: **31 incumbent checks passed** under the same isolated import boundary described below.
- `node evals/provider-budget/run.mjs`: **41 checks passed**; budget implementation was unchanged.
- Syntax and scoped `git diff --check` passed. No full release, real model call, Azure smoke, provider setting change or deployment was run by this agent.
- First attempted test imports failed on absent ignored `api/_config.js`, initially through `_db.js`, then through `_readiness` importing the unrelated `_recall-run` inference module. No config was copied or secrets loaded. The test now intercepts the unused default DB transport with a throwing stub and substitutes only the exact exported `RECALL_RUN_METHOD_VERSION` declaration read from actual source. All dialogue/runtime/settlement functions under test remain real; their DB is explicitly injected. No claim is made about the unrelated recall implementation.
- Existing private-dialogue service bookkeeping begins the spend before calling the adapter. A pre-aborted adapter now dispatches no request, but that existing caller may still conservatively mark its reservation uncertain. This patch does not change the caller's ledger transitions or release law.

## One-call structured Azure smoke plan for root

This is an adapter/schema/accounting smoke, **not** an authenticated owner journey, quality benchmark, identity acceptance or activation. No person, replica, consent, session or dialogue fixture needs to be inserted.

1. Use root's verified development `db` and in-memory secret configuration. Require `select current_database() as name` to return exactly `vyakti_expert_integration_20260906`. Use the existing authorized **USD 1 text ledger**, with its exact current budget ID and `AZURE_REPLICA_APP_BUDGET_USD=1`; do not invent another budget ID or increase a limit. Verify the existing budget row is active and has limit_microusd=1000000, then let the ordinary reservation perform the authoritative capacity check.
2. Require the actual modern registry settings `AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_DIALOGUE_MODEL`, `AZURE_FOUNDRY_API_KEY`. Confirm that `AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS` and `AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS` are the rates for this exact dialogue deployment, not borrowed shared-reply prices. If any setting/rate is absent or unverified, stop before reservation/network. Do not select a fallback model, alter temperature/schema/max_tokens, or enable any feature.
3. Construct the actual adapter with `createAzureFoundryDialogueGenerator({endpoint: env.AZURE_FOUNDRY_ENDPOINT, model: env.AZURE_FOUNDRY_DIALOGUE_MODEL, apiKey: env.AZURE_FOUNDRY_API_KEY, fetchImpl})`. These are the same three production registry values. The injected fetch wrapper must permit **at most one invocation**, record only a sanitized attempted-dispatch count, and call native fetch with the adapter's unchanged options. A second invocation throws before network. Never print headers, credential values or private endpoints.
4. Use the actual `compileDialoguePrompt` with these exact inputs:

```js
{
  core: "Synthetic test fixture, not a real person. Published fact: C92 practice has 23 minutes of independent solving followed by 13 minutes of review. Breaks are outside the 36-minute block. Do not add facts.",
  relationship: "",
  history: [],
  message: "In English, state the solving and review times in order in one sentence. Use grounded mode, natural pace, intensity 0.2, English language hint and no nonverbals."
}
```

5. Generate one fresh UUID request key and durably record it with the synthetic prompt hash before reservation. Call the existing `reserveFoundrySpend(db, {operation: "dialogue", requestKey, adapter, messages: prompt.messages, env})`, persist its content-free reservation ID/request hash, and call `beginFoundrySpend(db, reservation)` once. If reservation or begin fails, make **zero** model calls. Do not automatically release an ambiguous begin acknowledgment; inspect/reconcile it without a paid retry. Before an acknowledged begin, an explicitly cancelled, certainly undispatched reservation may use the existing pre-call release helper.
6. Call `adapter.generate({prompt, signal})` exactly once. On transport, cancellation, malformed usage, oversize or adapter failure after begin, call the existing `markFoundrySpendUncertain(db, reservation, error)` and retain the reservation. Stop; no retry, second prompt or alternative provider. Its helper is best-effort, so verify the actual ledger state afterward and report an unverified reconciliation write rather than assuming success.
7. On a returned result, settle the actual validated units with `settleFoundrySpend(db, reservation, generated.usage)` and independently run `validateDialogueOutput(generated.output)`. Accounting can settle measured usage even if the structured output or factual check fails; such a result remains a failed smoke, not a free call. If settlement itself fails, mark/verify reconciliation and stop. Do not substitute estimated usage or adjust rates to fit the reservation.
8. Verify strict output shape, reply within its real validator bounds, controlled delivery enums and source relations: **23 belongs to independent solving first; 13 belongs to review second**. Numeric presence alone is insufficient. The synthetic requested delivery is grounded/natural/0.2/English/no nonverbals. Report any mismatch without another model call.
9. Retain request/prompt commitments, adapter version and model identifier, one attempted-dispatch count, bounded synthetic output, measured input/output units, actual microusd, reservation ID and final ledger state. Read the exact reservation row plus budget totals to verify settlement or retained uncertainty. Keep accounting receipts; **do not delete the spend row or refund its cost as fixture cleanup**. No owner-data fixture was created, so there is no synthetic identity cleanup to claim.

Do not read model identities from the earlier blind experiment as part of this smoke. This test's configured dialogue deployment and receipt are a separate artifact and scope.
