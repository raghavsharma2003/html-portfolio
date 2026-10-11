# Connected answer quality: failed grounding

Candidate `c3cae7ddbb6992ed9311d46f88d89b31f3fee8b0`; one real Azure gpt-4.1-mini answer. Reviewed against `NATIVE-PUBLICATION-QUALITY-RUBRIC-20260908.md`, written before execution. Source/result artifact: `native-text-publication-run-checkpoint27.json`. This judgment covers the captured answer; final cleanup and transport acceptance are recorded separately.

| Criterion | Observed result |
|---|---|
| Period | Pass for this example: 45 / 18 = 2.5 seconds. |
| Frequency | Pass for this example: 1 / 2.5 = 0.4 Hz. |
| Misconception | Pass: explicitly corrects the proposed 2.5 Hz. |
| Distinction | Pass: explains time per oscillation versus oscillations per second. |
| Missing source data | **Fail.** It introduces an ideal-pendulum equation and g = 9.8, then states that the length is about 1.55 metres. The source explicitly says length and amplitude were not measured and not to infer them. The answer neither acknowledges the missing data nor qualifies the physical-model assumptions. |
| Language | The captured answer uses Hindi with familiar English technical terms as requested. This is a one-example observation, not broad Hindi-language acceptance. |
| Useful delivery | Partial failure: correct initial explanation, followed by a long unsupported length calculation. |
| Provenance | No human identity or prior-relationship claim observed in this answer. |

The raw Azure structured reply and delivered answer both contain the unsupported length conclusion. The response gate did not repair this error. Correct arithmetic and a settled successful HTTP request are not enough to pass source grounding.

Measured provider usage for this one call: 925 input tokens and 310 output tokens. At the configured $0.40/$1.60 per million token rates, the settled ledger increased by 866 microUSD ($0.000866), from 129006 to129872 microUSD. Reserved balance after the answer was zero. This is text inference accounting; it excludes other infrastructure costs and proves no voice economics.

Next action: repair the general handling of absent evidence and unstated physical/model assumptions, then test separately authored cases. This pendulum example is now a development regression case, not untouched holdout. Do not fit a pendulum-specific answer or hide the unsupported number with a string filter. The original failed response remains retained.

Reversal condition: new actual Azure evidence across independent missing-data and valid-derivation cases must show the repair distinguishes supported reasoning from unsupported assumptions. Offline prompt assertions alone cannot establish that improvement.
