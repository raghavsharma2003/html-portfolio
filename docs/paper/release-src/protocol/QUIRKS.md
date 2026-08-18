# Deployment quirk log

**What this is:** a compatibility record from one cloud tenant on specific
dates. It is not a vendor comparison and must not be read as one. Deployments
drift — this programme separately measured one shifting behaviour materially
over four days — so every line below is dated evidence about a deployment, never
a property of a model name.

We publish it because practitioners assembling a multi-vendor judge panel will
probably use this page more than the results. Three of six candidates could not
be scored at all until a provider-specific fix was found, and each fix took a
run to discover.

| date | deployment | symptom | fix | how it was found |
|---|---|---|---|---|
| 2026-08-15 | an OpenAI-family reasoning deployment | Rejects `max_tokens` outright | Send `max_completion_tokens` instead | 400 on the first call |
| 2026-08-15 | same | Rejects any explicit `temperature` other than its default | **Omit the field entirely.** `temperature: 0` is not the same as "no temperature" | `Unsupported value: 'temperature' does not support 0 with this model` |
| 2026-08-15 | same | With no `reasoning_effort`, spends the **entire** token budget on hidden reasoning and returns an **empty** visible completion | `reasoning_effort: "none"` (confirmed valid; `"minimal"` 400s — the enum is none/low/medium/high/xhigh) | `finish_reason: "length"`, 100/100 reasoning tokens, 0 visible |
| 2026-08-15 | an xAI reasoning deployment | Silently burns 593–738 hidden reasoning tokens per call. Does **not** empty out — this deployment caps only *visible* output | `reasoning_effort: "none"` if you care about latency and burn | token accounting on a trivial probe |
| 2026-08-15 | a Mistral deployment | Rejects `max_completion_tokens` as `extra_forbidden` (422) | Plain `max_tokens` | 422 on the first call |
| 2026-08-15 | a Cohere deployment | Verdicts arrive wrapped in `<\|START_TEXT\|>` / `<\|END_TEXT\|>` markers | The field-level regex parses through them; a whole-body `JSON.parse` would not | first parsed reply |
| 2026-08-15 | same | A 20-token probe returns empty content; 120 does not | Size the cap to the model, then verify | probe |
| 2026-08-15 | same | At full rubric scale, writes preamble and hits a 120-token cap **before** the verdict, on 192/192 calls | Raised to 400 — and even then it emitted parseable JSON on only 34 of 192 rows and was **disqualified for cause** | the parse-miss counter |
| 2026-08-15 | same | Is a reasoning model whose visible content is empty at rubric scale | `reasoning_effort: "none"` verified live (finish `stop`, reasoning length 0) | probe at rubric scale |
| 2026-08-15 | the whole panel | A hardcoded `maxTokens: 120` at the **call site** silently overrode every judge config | Read the cap from the config, always | Cohere's 400 never took effect |
| 2026-08-18 | an OpenRouter-routed reasoning model | The panel's 120-token cap emptied **128 of 192** replies; 2 more were cut mid-JSON | Raise the cap for reasoning models. The run self-invalidated on parse and is reported as a non-result | the parse-miss counter, again |
| 2026-08-15 | any cash-billed provider | A configured **spend limit** on the key silently 403'd every call after it was hit, mid-run. The surviving subset scored 100% | Count transport misses separately and self-invalidate above 5% | `GET /api/v1/key` showed usage $20.14, remaining $0 |

## Two harness-side quirks, ours not theirs

**The cost helper's field names must match the config's.** In one run the judge
configs declared pricing as `{prompt_per_token, completion_per_token}` while the
cost helper destructured `{inUsdPerTok, outUsdPerTok}`. The priced path returned
`NaN`, which serialised to `null`, so the run reported no cash total and it had
to be computed by hand. The *guard* was right — an unknown rate must never print
as `$0` — but the mismatch meant pricing was never applied at all. This release
uses one spelling (`promptPerToken` / `completionPerToken`) everywhere.

**The miss classifier must exist before the run, not after.** A classifier added
in response to a failure cannot recover the kind of misses that failure
produced. In our case the same 403 produced `error:`-prefixed bodies from one
model and empty bodies from another, so a post-hoc classifier reported
"174 transport / 0 parse" for one and "0 transport / 139 parse" for the other,
from a single root cause. Those rows are reported as *unclassified* rather than
letting a classifier impute a distinction the data cannot carry.
