# judge-candidates/

**Nothing in this directory runs without explicit owner approval of the
spend.** These are config-shape placeholders for the premium cash judge
qualification named in context/decisions.md `d2-on-credits`'s exhausted
reversal condition (all three credits-billed candidates — DeepSeek-V4-Flash,
gpt-5.6-terra, grok-4.3 — failed the ≥80% agreement bar; context/measurements.md
`judge-backtest`, `grok43-judge`; evals/dbattery/judges.json). The settled
plan is **one premium judge family, paid in cash, ~$400** — not fired here,
not fired by any script in this repo automatically, ever.

Every file in this directory:

- carries **no API key** — `apiKeyEnv` names an environment variable to read
  a key from at call time; nothing here holds a secret value.
- carries **no verified pricing** — `pricing` is `null` on purpose.
  `judge-provider.mjs`'s `callCostUsd()` returns `NaN` for a judge with no
  pricing, and `d2.mjs`'s `--max-spend` treats `NaN` as "cannot certify this
  is under cap" and refuses to run rather than assuming `$0`. Fill in the
  real, live, sourced rate immediately before a real run — never from
  memory, never carried over from a different model's number
  (`context/measurements.md`'s own house rule: a figure needs n/method/date).
- has **never been called**. Every model id, deployment name, and parameter
  quirk (`tokenParam`, `temperature`, `reasoning_effort`) here is a
  best-guess starting point from this repo's own precedent with *other*
  deployments in the same vendor family — it is unverified for the specific
  candidate named and must be confirmed live (one cheap probe call, same
  discipline `judge-backtest.mjs`'s `verifyAzureDeployments()` and this
  session's terra/grok-4.3 quirk-discovery already used) before it is
  trusted for a real qualification run.

## What's here

| file | provider | family | notes |
|---|---|---|---|
| `claude-opus-5-anthropic.json` | `anthropic` (native Messages API) | anthropic | the "via API" alternative to the OpenRouter-routed Anthropic judge (`anthropic/claude-opus-4.8`) already used as `d2.mjs`'s house judge and as both archives' original ground-truth judge |
| `gpt-5.6-premium-azure.json` | `azure` | openai | deliberately a **different** deployment name placeholder than `gpt-5.6-terra`, which already failed — filling in terra's own deployment id here would silently re-test a known failure |
| `gemini-3.6-pro-openrouter.json` | `openrouter` | google | reuses the existing `OPENROUTER_KEY` field, no new key needed; carries an explicit same-vendor-affinity caution (measured directly for grok-4.3, `context/measurements.md` `grok43-judge` — ~16x same-vendor preference on a family-conflicted archive) |
| `mistral-large-3-openai-compatible.json` | `openai-compatible` | mistral | a fourth plausible family, added so the `openai-compatible` provider path named explicitly in the task brief has a concrete example beyond the two families the brief happened to name |

## How to actually qualify one (once the owner approves spend)

```
node evals/dbattery/judge-backtest.mjs --judge evals/dbattery/judge-candidates/<file>.json
```

That alone still only **prints a dry plan** — no network call is made
without `WSBAT_RUN_BACKTEST=1`. To execute the real backtest (96 archived
units, both orders, ≥80% bar against the same ground truth every prior
candidate was measured against):

```
WSBAT_RUN_BACKTEST=1 node evals/dbattery/judge-backtest.mjs --judge evals/dbattery/judge-candidates/<file>.json
```

This merges the result into `evals/dbattery/judges.json` by judge id — it
does not erase DeepSeek/terra/grok-4.3's provenance, and it updates
`qualified_panel` (and the `judge_configs` map `d2.mjs` reads its live panel
from) only if the candidate actually clears the bar.

Before running the line above for real: fill in the real deployment/model id
if it says `REPLACE_...`, fill in `pricing` from the vendor's live pricing
page, set the named `apiKeyEnv` environment variable to a real key (never
commit it, never put it in this directory), and get the owner's explicit
sign-off on the cash spend. None of that is this directory's job to enforce
beyond `null` pricing forcing `--max-spend` to fail closed — the actual
"did the owner say yes" gate is a human one.
