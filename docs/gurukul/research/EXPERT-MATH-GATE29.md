# Expert math gate repair, 2026-09-08

Base: frozen candidate28 `f027349ac601a8bc393b2038b5c0d0baccfe3514`. Worktree: `scratchpad/expert-math-gate29`, branch `codex/expert-math-gate29`. No other worktree was changed.

The common expert parser deleted bracket contents from complete `\[ ... \]` display equations. The captured candidate `GROUND-EN-HYPOTHETICAL-63` answer has four correct derivation lines; all became bare backslashes despite `gated:true` and empty findings. The immutable parent artifact is `scratchpad/expert-tools/grounding28-ab-result-20260908.json`, SHA256 `eb1dcecec04cac4a7f7e7969140bd9c383b10d80d614b06612ac734ae5027076`; root's separate `GROUNDING28-INDEPENDENT-REVIEW-20260908.md` identifies this delivery failure. No source factual error is repaired or hidden here.

`src/engine/brain.ts` now keeps complete explicit display and inline LaTeX spans together when parsing an expert answer and excludes only those spans from stage-direction bracket deletion. Known protocol extraction runs before recognition. Metadata filtering sees the full content; content returns to the existing honesty and Never gates unchanged. No sentinels or opaque placeholders conceal it. Malformed spans, ordinary bracket notation, companion caps and companion formatting keep their prior behavior. Other existing text cleanup, including dash normalization, is unchanged. This is not a general LaTeX parser or a mathematical correctness check.

The actual existing callers are `api/_surface.js` `gateReply(..., 'expert_answer')`, used by `api/_text-publication-runtime.js` and the configured Room expert path. The generated `api/_engine.gen.js` is rebuilt from the changed source; no API or compiler contract changed.

Regression data lives at `evals/room-expert-answer/retained-grounding28-math.json`. Canonical-LF fixture SHA256 is pinned in the new test as `8fa12ff4d9134e8e024713a6117f93a2cbe8b3287be0b0d2cfdef2a7b1e617ad`. Its raw reply and historical delivery were compared exactly with the selected immutable result cell. A no-recognized-math mutant uses the old splitting/stripping behavior and must reproduce the historical delivery byte for byte. It requires no historical git commit or external artifact at test time.

Validation completed locally:

- `node evals/room-expert-answer-math.mjs`: 11 groups, source/generated parity and negative control, four retained equations recovered. Also passed `--source-only` before bundle regeneration.
- `node evals/room-expert-answer-lists.mjs`: 15 groups.
- `node evals/room-expert-answer.mjs`: 18 checks.
- `node evals/text-publication-runtime/all.mjs`: 29 runtime,10 expiry and4 held-authority groups.
- `node evals/run.mjs parse`: 38 checks.
- `node evals/honesty/run.mjs`: 613 checks.
- `node scripts/build-engine-bundle.mjs --check`: fresh.
- `node ../../node_modules/typescript/bin/tsc -b --force`: passed.
- `node scripts/context.mjs --check`: 2517 nodes,2412 edges,4 documents valid.
- `node scripts/check-copy.mjs`: 7 scopes clean and21 negative controls passed.
- `git diff --check`: passed.

Direct `node evals/parse.mjs` initially failed because the new isolate lacked its ignored bundle. The canonical registry command rebuilt it and passed. The initial common-gate import lacked ignored `_config.js`; a credential-free empty stub enabled offline checks. Neither environmental setup file is committed. Fetch is denied in the new replay; no model, SQL, provider or deployment operation was performed.

The test is registered as `room-expert-answer-math`. The external replay receipt is `scratchpad/expert-tools/EXPERT-MATH29-REPLAY-20260908.json` in the original root. Full release remains root-owned and was not run in this isolate.

The existing publication and ExpertConversation views display plain text, with no KaTeX/MathJax renderer. Preserved LaTeX therefore remains literal text. This slice proves content retention and existing safety checks only, not readable rendered mathematics, new factual quality, owner-clone completion or voice likeness. Next UI work must use a separately reviewed bounded renderer/presentation path and keep raw/display safety guarantees. Reverse this repair if retained math or protected-content controls regress; do not compensate by changing prompts, rewriting captured answers or retrying consumed cases.
