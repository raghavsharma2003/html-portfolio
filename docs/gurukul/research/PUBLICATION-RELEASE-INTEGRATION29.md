# Publication release integration repair, 2026-09-08

Base `f027349ac601a8bc393b2038b5c0d0baccfe3514`, isolated branch `codex/expert-release-integration29`. Frozen candidate28 and the separate math/renderer worktrees were not changed.

## Exact diagnosis

Root release28 log: `scratchpad/expert-tools/release28-1788815888159.log`. Full suite output: `scratchpad/expert-28-combined/scratchpad/release-logs/2026-09-07T21-18-08-264Z-28204/eval-suite.stdout.log` in the original root.

| Suite | Observed failure | Source cause |
| --- | --- | --- |
| persontables | line12952, mismatched PERSON_COLUMNS; one failure | Publication commit c3cae7dd added visitor_user_id to scripts/relcheck.mjs but not the offline mirror. |
| ops | lines14009,14015,14069; three failures | New /api/text-publication-expire does not match the -sweep naming rule or explicit exceptions in api/_sweep-schedule.js. Its valid ten-minute schedule is consequently omitted. |
| self-check | line19158; one failure | Same missing sweep name, not Azure configuration: azure-self-check independently passed21 controls in this release log. |
| probe-live | lines18722-18735; eight failures | cronAuthExpectation cannot read the new authorizedTextPublicationExpiry(req,env) guard with a single-quoted literal error. It only recognized req alone and double quotes. Clean local fixtures therefore receive a source-contract finding before probing that cron. |
| day-one | lines20727,20733,20740,20747; four failures | All failures are step1, which consumes probe-live. Its four clean local worlds inherit that same source-contract finding. Other steps and deliberate offline/unreachable cases pass. |
| creator-export | line18992; one failure | Erasure newly reaches vy_text_publication, but OWNER_LANE_TABLES still omits the owner's publication projection and receipt. |

Accepted release26 at `3eb404d4a3e00bf1d0b108a91a420003cfc5dc2a` passed these same six suites. Its recorded output is `scratchpad/expert-integration/scratchpad/release-logs/2026-09-07T19-50-00-225Z-31096/eval-suite.stdout.log`, successful status lines25,39,238,260,292,294. Git comparison shows no changes to the six suite sources, `_sweep-schedule.js`, `probeLiveExpectations.mjs` or `_creator-export.js` between26 and28; publication commit c3cae7dd added the new schema/cron/erasure dependency without those integrations. These are deterministic coverage/integration defects. No timeout, credential, provider, SQL exception or worker-pool failure appears in the six failing sections. This does not diagnose release28's separate contrast findings.

## Repair and controls

- Mirror visitor_user_id and verify the two actual account-visitor tables against their dedicated account forget caller and exact visitor predicate. They remain outside the generic person-ID DELETE loop; that would bind the wrong identity namespace and reset counters. Unknown visitor tables and missing caller/predicate are failures, not blanket exemptions. Offline inventory now reports155 person-keyed tables:88 owner,2 explicit account visitor,5 written exemptions,60 listed;61 actual manifest entries. Four negative controls pass.
- Export own active/revoked `vy_text_publication` rows using the existing joint replica/owner query. Exclude visitor admissions and encrypted requests. A publication query failure returns named503 instead of a successful empty manifest. Six added controls retain exact own rows, reject foreign scope/visitor data, check counts, reproduce leakage when the owner predicate is removed, and reject query failure.
- Add the exact expiry sweep name. The actual authorized HTTP caller now wraps its bounded work in `withSweepRun`; successful work records ok, full-page backlog records partial, and thrown work records failed. The response body and strict timing-safe bearer check remain unchanged. Unauthorized/wrong-method requests create no telemetry or cleanup calls. Existing heartbeat schema084 supports the name and outcomes; no migration is needed.
- Read the actual literal early auth refusal with the exact supported signatures `authorized*(req)` or `authorized*(req, env)` and matched quote styles. No per-path auth exemption was added. Nine added controls include the actual old-parser failure and refusal of arbitrary argument expressions, computed status/error bodies, a positive auth condition and an absent guard. The expiry suite tests the actual bearer function independently, so a matching source string alone is not an authorization proof.

Validation: `node evals/persontables.mjs` passed with4 negative controls; `node evals/creator-export/run.mjs`57 passed; `node evals/ops/run.mjs`155 passed; `node evals/self-check/run.mjs`85 passed; `node evals/probe-live/run.mjs`0 failures; `node evals/day-one/run.mjs`0 failures. `node evals/text-publication-runtime/expiry.mjs`10 groups passed, now asserting actual heartbeat start/finish/prune, exact unchanged cleanup queries, content-free counts and backlog/failure outcomes. An early newly authored visitor-control mutation removed only the first repeated source occurrence and did not fire; it was corrected to remove all relevant occurrences and then passed. No product logic was weakened for that control.

These are offline fixture and loopback checks. No real SQL parser, remote HTTP, scheduled firing, provider or deployment was executed. Existing SQL shapes/DDL were inspected; real deployed export and cron telemetry remain subject to root's later live acceptance. The ignored config in this isolate contains only empty strings. Full release is root-owned and was not rerun here.

Additional checks passed: Azure self-check21, copy law7 scopes/21 negative controls, context graph2517 nodes/2412 edges/4 documents, JavaScript syntax checks and git diff whitespace validation. The source-authorized reviewer is preparing a separate actual development EXPLAIN-only proof; it was not run or claimed by this slice.

Reversal: retain these six gates, explicit owner/visitor exclusions and negative controls. Replace the source extractor only with an equally strict independently checked contract. Do not rename the live cron route or bypass bearer validation merely to make discovery green. Do not call metadata export or a registered cron proof of actual execution.
