# Combined source checks

9 September 2026, source `0fce7b03e02342fecfcab09fbd87e9dbafee1a59` (product source unchanged from the preservation handover).

All three actual local commands exited0:

| Existing suite | Passed | Evidence scope |
|---|---:|---|
| `evals/expert-text-compiler.mjs` |31| Actual committed generated engine, source parity, scoped saved preferences and removal of conflicting language defaults. |
| `evals/room-expert-answer-math.mjs` |14| Scientific brackets, ASCII normalization of expert dashes, retained mathematical material, protocol/safety checks and unchanged companion parsing. |
| `evals/room-expert-answer.mjs` |19| Actual Room handler with offline SQL/provider fixtures: reply delivery, stored assistant text, length limits and suppression. |

Total64 checks. No model, database or cloud compute calls. This was not the full release gate, a real authenticated journey, or a Hindi adherence trial.

The handover checkout had no installed dependencies. A temporary Node resolve hook read the existing private205 dependencies after verifying exact lockfile equality and that the dependency directory was not a symlink. It mapped only the missing `_config.js` import to the checked-in inert example, scrubbed credential environment variables and blocked fetch. It did not copy secrets, mutate dependencies or alter product source. Tests used their normal temporary output directories.

The initial invocation used a Windows path for `--import` and failed before running tests with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Using a `file:///C:/...` URL corrected the invocation. All three results above are from subsequent actual successful runs, not the failed setup.

The next live trial must still inspect the model's actual corrected-Hindi reply. A structurally correct prompt and passing offline test cannot prove language adherence.
