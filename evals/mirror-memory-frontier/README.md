# Mirror memory frontier diagnostic

This standalone diagnostic exposes a known retrieval limit. It is not a release gate and never calls a provider or writes database rows.

Run `node evals/mirror-memory-frontier/run.mjs` to validate the deterministic 40-case manifest. This reports `NOT_RUN`, not a retrieval pass. Run with `--live` using an explicitly supplied `NEON_URL` to execute the actual `approvedMirrorRecall` SELECT against read-only PostgreSQL CTE fixtures. The database must identify itself as `vyakti_expert_integration_20260906`; production configuration is never imported.

The CTEs shadow every referenced relation and use `jsonb_populate_recordset` with the real schema's composite row types. This tests actual PostgreSQL parsing, type conversion, filtering and ranking, not a JavaScript imitation of SQL. It does not test inserts, constraints, persisted lifecycle transitions, RLS or authenticated endpoints. Unspecified fixture columns are null; fixtures are deliberately not claimed to be valid insertable product records.

Ten scenarios each run with 0, 7, 8 and 16 newer distractors: relevant older fact, wrong owner, wrong replica, wrong person, wrong agent, later rejected decision, later superseded decision, fact retraction, fact invalidation, and updated fact. Decisions and state updates are synthetic snapshots, not executed mutations. The relevant-fact cases hold `need_p` equal and give every fact a distinct timestamp. An older accepted calibration deadline should become missing when eight newer unrelated notes fill the current limit. Update cases retract the original and supply a newer accepted replacement. Scope negatives isolate a single boundary mutation.

Expected current baseline: the 8- and 16-distractor crowding cases report `RETRIEVAL_LIMITATION_OBSERVED`. No expected bad outcome is labeled a product pass. Exit 2 means a retrieval limitation was observed, exit 1 means a boundary or execution failure, and exit 0 in live mode means no limitation was observed in these fixtures. Default manifest-only mode also exits 0 but explicitly says SQL and retrieval were not run.

The report includes UTC measurement time, fixture hash, current recall source hash, exact returned/required/forbidden IDs and method. It contains only synthetic data. Capture stdout to retain a baseline; do not interpret 40 cases as 40 people or report model-quality percentages.

## Recorded baseline

`baseline.json` retains the real isolated-development SQL execution on 2026-09-06 UTC (2026-09-07 in India). All 40 synthetic snapshots executed through the shipping recall SELECT and real PostgreSQL composite types. There were no observed boundary failures in these cases. The relevant older fact was omitted with 8 and 16 distractors (2 observed retrieval limitations); it remained visible with 0 and 7 distractors. The report is `KNOWN_RETRIEVAL_LIMITATION`, not a product pass. No inserts, provider generation, human ratings or production reads occurred. Exact timestamp and hashes are in the report.

## Subsequent benchmark protocol

This is a reusable retrieval scaffold, not the completed conversational benchmark. After the baseline, compare a query-aware candidate at the same eight-fact/context budget and with the same pre-ranking scope filters. Keep required evidence IDs independent of the candidate's output. Add consent expiry/revocation and missing-citation controls before any production promotion. A later separately authorized persisted test should perform accept, reload, supersede, retract and erase through actual APIs and prove the next call respects each transition. Only then evaluate answers on held-out owner-written questions covering temporal reasoning, multi-session reasoning, updates and abstention. Report evidence retrieval, answer correctness, isolation and latency separately; no inferred-trait or emotion labels belong in these fixtures.

## Opt-in lexical comparison

`node evals/mirror-memory-frontier/run.mjs --live --compare` runs 52 cases in two arms (104 SELECT executions). `comparison.json` retains the isolated PostgreSQL result. The original `baseline.json` is preserved. The candidate is activated only by the explicit fourth argument `{strategy: 'lexical-shadow', query}` to `approvedMirrorRecall`. The actual Mirror caller remains unchanged. Passing a query without this strategy does nothing. No promotion or rollout flag was introduced.

Terms are Unicode-tokenized from at most 500 input code units, normalized, deduplicated and bounded to 24, with a small English/Hindi stopword set. PostgreSQL `simple` text-search ranks independent term matches by summed `ts_rank_cd`, so unrelated question words do not make a whole-question AND return zero matches. Terms are bound parameters, never interpolated SQL. Authorization and citation filters remain intact, and the return limit remains eight. Empty, stopword-only and no-match queries retain baseline need/recency behavior, which can return unrelated facts: this is backward-compatible fallback, not evidence of useful recall or semantic abstention.

Measured comparison on 2026-09-07 India time: no boundary failures across 104 fixture SELECTs. Baseline omitted required evidence in six scenarios; the candidate omitted it in one, the deliberately unsupported Roman-query/Devanagari-fact cross-script case. English crowding, Hindi, Roman Hinglish and mixed-script Hinglish recovered their designated older evidence. Empty/no-match/stopword fallbacks exactly matched the baseline. Consent expiry/revocation and missing citation/episode/participant controls exposed no forbidden evidence in these fixtures. This is small synthetic lexical-overlap evidence, not multilingual semantic quality or a persisted API test. Inflection, transliteration, synonyms, lexical distractors and varied owner phrasing still need held-out evaluation. Candidate remains NOT_PROMOTED.

`node evals/mirror-memory-frontier/query-contract.mjs` checks input bounds, explicit opt-in, empty-query compatibility and parameterization offline. It makes no SQL or product-quality claim. The existing `evals/mirrorcall-relational-recall/run.mjs` also remains applicable to the unchanged default contract.
