# Room reply through the Meet Azure registry

Enable only after checking the deployment and its actual rate card:

| Setting | Meaning |
|---|---|
| `AZURE_FOUNDRY_ENDPOINT` | Foundry resource HTTPS root or `/models`, shared with Meet. |
| `AZURE_FOUNDRY_DIALOGUE_MODEL` | Exact deployed dialogue model shared with Meet. |
| `AZURE_FOUNDRY_API_KEY` | Server-only key shared with Meet. |
| `AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS` | Explicit input price for the ordinary dialogue deployment. |
| `AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS` | Explicit output price for the ordinary dialogue deployment. |
| `AZURE_FOUNDRY_DIALOGUE_RATE_MODEL` | Required for `gpt-5.6-terra`, exactly that deployment name. |
| `AZURE_FOUNDRY_DIALOGUE_EXPECTED_RESPONSE_MODEL` | Required dated response-model binding for `gpt-5.6-terra`. |
| `AZURE_FOUNDRY_DIALOGUE_INPUT_USD_PER_MTOKENS` | Terra-specific input rate. |
| `AZURE_FOUNDRY_DIALOGUE_OUTPUT_USD_PER_MTOKENS` | Terra-specific output rate. |
| `AZURE_REPLICA_APP_BUDGET_USD` | Existing durable application budget limit. |
| `AZURE_REPLICA_BUDGET_ID` | Optional existing budget identifier. |

The adapter uses the existing `vy_provider_budget` and `vy_provider_spend`
tables. Missing rates, budget access or settlement block delivery. Its public
capability describes configuration readiness, not a live deployment or balance
probe. Never place keys in client bundles or examples.

The existing shared compiler, recalled memory, output guards and protected
voice route remain the caller. The Room constructs its reply provider through
`api/_dialogue/registry.js`, the same production registry Meet uses. It has no
fallback or retry loop. A dispatched request keeps
its reservation until measured usage settles; missing usage, HTTP errors and
timeouts remain reconciliation work. Unknown dispatch outcomes are not free.
There is no OpenRouter selection or fallback on this path. Each normal `think`
invocation gets a new attempt receipt; this does not claim
end-to-end client retry idempotency. The lower-level adapter accepts a stable
request key when a caller has a durable attempt identity.

Contract: `POST /models/chat/completions?api-version=2024-05-01-preview`, capped
at 400 total completion tokens and 30 seconds. Existing deployments including
`gpt-4.1-mini` retain `max_tokens:400`. The explicit `gpt-5.6-terra` lookup uses
`max_completion_tokens:400`, `reasoning_effort:none`, and no temperature override.
That exact deployment/dialect returned four actual dated-model responses in the
isolated synthetic Quality88/89 comparison; this production port is source-only.
Terra's returned model must equal `gpt-5.6-terra-2026-07-09`. A provider upgrade
therefore refuses until reviewed, after settling usable measured usage. Custom
deployment aliases and other reasoning models are not inferred by prefix.

Terra cannot become ready by changing only the model: its explicit rate-model
binding and positive input/output rates are required. Prices remain operator
configuration verified against the current applicable rate card, not constants
in the adapter. This acknowledgement prevents accidental reuse during a simple
model switch; it cannot certify that an operator's declared rates match an invoice.
Do not alter an existing budget limit to enable a new model.

Reported completion tokens already include reasoning. They are charged once;
reasoning details must fit within that total and cannot increase the400-token
ceiling. Optional fingerprints are not a delivery requirement or a backend
identity guarantee. Candidate qualification contracts are unaffected. No model
superiority, voice quality or latency claim follows from this capability.

[Microsoft reference](https://learn.microsoft.com/en-us/rest/api/microsoftfoundry/model-inference/get-chat-completions/get-chat-completions?view=rest-microsoftfoundry-model-inference-2024-05-01-preview),
checked 2026-09-06. Microsoft also documents a newer
[v1 route](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle);
this adapter deliberately retains the existing resource's independently probed
inference contract. The older models route is deprecated; migration needs its
own compatibility review and is outside this request-dialect delta.

Run `node evals/azure-surface-reply/run.mjs`. The 24 deterministic checks use
synthetic prices, mocked HTTP and the real budget functions against a fixture
database. They prove control flow, not SQL validity or live cost. No cloud
calls are made by the suite. Mirror reply 137 and surface gate 84 regression
checks also passed after integration.
