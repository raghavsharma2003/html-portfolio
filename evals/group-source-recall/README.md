# Group source-recall selection evaluation

The 48 invented cases in `cases.mjs` were frozen independently before the evaluator read or executed the selector. They compare recency with lexical-recency selection under identical admission and final-turn byte limits. They are not an external benchmark, model-quality test or privacy/SQL test.

Run with `node evals/group-source-recall/run.mjs`. This suite is offline and imports only the pure selector. Use `--json` for per-case counts and exact selected IDs. Refusals and adverse cases are reported, not hidden. The 23 contract/mutation checks are separate from the 48-case count.

Initial measured result: recency selects 0/54 relevant older sources; lexical-recency selects 27/54. Both preserve all 960 mandatory recent records and three available recent corrections. All 24 adversarial cases fail older-target recovery and select 288 distractors. This is a recorded limitation, not permission to tune the frozen cases or advertise general retrieval quality.

The final contract-correction rerun preserves these outcomes. Recency now skips irrelevant token scoring/caps, and the packet truthfully identifies a `host_supplied_candidate_pool`. Final maximum serialized bytes are 9,430 for recency and 17,664 for lexical-recency. The report preserves both measured hashes and byte tables. Root chose recency as the application default; this pure suite does not itself verify that application integration switch.

Forbidden and post-cutoff source records are sidecar ground truth, never admitted inputs. The host must independently prove SQL permission checks, fixed cutoff, complete-source revalidation and effect blocking. Full application prompt size and answer quality are outside this suite.

See `docs/gurukul/research/GROUP-SOURCE-RECALL-EVAL-20261001.md` for the preregistration, hashes and exact results. Do not tune corpus or scoring on this report and describe the rerun as held out.
