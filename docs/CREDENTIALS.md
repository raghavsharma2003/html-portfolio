# Credentials split — #89 (design + scaffold, no live key changes)

## The problem

Research and production share one OpenRouter budget. Every `api/*.js` route
that calls a model through OpenRouter (`api/chat.js`, `api/memory.js`,
`api/consolidate.js`) and every research/eval script that also calls
OpenRouter (`scripts/derive-adapter.mjs`, `scripts/voice-samples.mjs`,
`scripts/prosody-baseline.mjs`, `evals/candidate/generate-incumbent.mjs`,
`evals/probes/affect-recitation.mjs`, `evals/vignette/run-prestudy.mjs`, and
any future battery) draw on the same `OPENROUTER_KEY`. A large research run
(a candidate-model battery, a judge pass, a vignette study) can burn through
rate limits or spend that production needed at the same moment, and there is
no way today to tell from a bill or a 429 which side did it.

This is a **name-only wiring** ticket: the split is designed and the fallback
path is built, but the owner adds the actual second OpenRouter key later. No
live key changes ship here.

## The design

**One new optional env var / secret: `OPENROUTER_RESEARCH_KEY`.**

- `OPENROUTER_KEY` stays exactly what it is today: the production key,
  required (`scripts/write-config.mjs` still fails a deploy without it), read
  by every `api/*.js` route.
- `OPENROUTER_RESEARCH_KEY` is new and optional. When the owner creates a
  second OpenRouter key (a separate budget/rate-limit bucket on OpenRouter's
  side — OpenRouter supports multiple keys per account, each with its own
  spend and rate ceiling) and sets it as a repo secret / local env var,
  research and eval scripts draw on it instead, and production spend and
  research spend become separately visible and separately rate-limited.
- Until that key exists, everything behaves exactly as it does today —
  research scripts silently sharing the production budget would be the
  status quo's actual bug (nothing tells you it's still shared), so the
  fallback is **printed**, not silent, every time `scripts/write-config.mjs`
  runs. See `context/decisions.md` `silent-truncation` — the whole reason
  that law exists is that a silent fallback reads as fixed when it isn't.

### Where the fallback lives

Resolved **once**, in `scripts/write-config.mjs`, not scattered across every
consuming script:

```js
// api/_config.js, generated:
export const OPENROUTER_KEY = "<production key>";
export const OPENROUTER_RESEARCH_KEY = "<production key>"; // fallback: OPENROUTER_RESEARCH_KEY unset
```

If `OPENROUTER_RESEARCH_KEY` is set in the environment, it's written verbatim
and used as-is. If it is not, `write-config.mjs` writes the **production**
key's value into the `OPENROUTER_RESEARCH_KEY` export instead (so a script
that imports it never breaks) and prints:

```
WARNING: OPENROUTER_RESEARCH_KEY not set — research scripts fall back to the shared OPENROUTER_KEY budget (docs/CREDENTIALS.md).
```

This means: **adding the second key is a one-line env-var change with no
code change anywhere else.** No consuming script needs its own fallback
logic — that was the whole point of resolving it in one place.

## Which scripts read which

| script | reads | role |
|---|---|---|
| `api/chat.js` | `OPENROUTER_KEY` | production — live chat lane |
| `api/memory.js` | `OPENROUTER_KEY` | production — memory extraction fallback |
| `api/consolidate.js` | `OPENROUTER_KEY` | production — nightly consolidation |
| `scripts/derive-adapter.mjs` | `OPENROUTER_KEY` | **mixed** — the gate machine runs both derivation batteries (research-shaped, high volume) and the weekly drift probe deck (small, arguably production-adjacent). Left on the production key for now; see "Not yet migrated" below. |
| `scripts/voice-samples.mjs` | `OPENROUTER_KEY` | research — voice candidate sampling |
| `scripts/prosody-baseline.mjs` | `OPENROUTER_KEY` | research — prosody measurement |
| `evals/candidate/generate-incumbent.mjs` | `OPENROUTER_KEY` | research — candidate-model corpus generation |
| `evals/probes/affect-recitation.mjs` | `OPENROUTER_KEY` | research — recitation probe |
| `evals/vignette/run-prestudy.mjs` | `OPENROUTER_KEY` | research — vignette prestudy |

The rightmost column is the intended split, not the current wiring: every
row above still imports `OPENROUTER_KEY` today. **This ticket does not touch
any of those import lines** — that's the next, separate diff, once the owner
has actually created the second key and wants to confirm the split is worth
the operational overhead of two keys to manage. Flipping a script from
`OPENROUTER_KEY` to `OPENROUTER_RESEARCH_KEY` is a one-import-line change per
file when that happens.

### Not yet migrated, on purpose

`scripts/derive-adapter.mjs` is both the research derivation harness (§7.1,
paid, high-volume — the kind of thing this split exists for) and the
`--mode drift` weekly probe wired into `.github/workflows/drift.yml`, which
is closer to a production health check than a research run. Splitting it
would mean the drift job needs `OPENROUTER_RESEARCH_KEY` too, which muddies
"research" as a category. Left as a named open question rather than
guessed at: **the owner decides, when the second key exists, whether the
drift job's calls count as research spend or production spend.**

## What this ticket does NOT do

- Does not create `OPENROUTER_RESEARCH_KEY` anywhere real — no Vercel env
  var, no GitHub secret, no value in any `api/_config.js` on disk.
- Does not change which key any `api/*.js` or research script actually uses
  today — every one of them still resolves to the shared `OPENROUTER_KEY`
  value, whether directly or through the fallback described above.
- Does not touch `api/_config.example.js` (out of this sweep's scope) —
  when the owner wires the real key, add the `OPENROUTER_RESEARCH_KEY`
  export there too, per that file's own rule ("if you add a key here, add
  it there too, or the deployed site will have it locally and not in
  production").

## Rollout, when the owner is ready

1. Create a second OpenRouter API key, scoped to whatever budget/rate limit
   makes sense for research spend.
2. Set `OPENROUTER_RESEARCH_KEY` as a GitHub Actions secret (for CI research
   runs) and locally in `api/_config.js` (gitignored, never commit it).
3. `scripts/write-config.mjs` needs no further change — it already picks the
   dedicated key up the moment it's present, and the printed warning stops
   appearing.
4. Migrate the research-column scripts above from `OPENROUTER_KEY` to
   `OPENROUTER_RESEARCH_KEY`, one import line each. `api/*.js` (production)
   is never touched.
5. Decide `derive-adapter.mjs`'s drift-mode question (above) before or as
   part of that migration.
