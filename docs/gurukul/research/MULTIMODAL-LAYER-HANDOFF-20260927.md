# Multimodal evidence continuation, 27 September 2026

This source candidate extends the active platform's Human Experience Compiler. It fixes a specific gap between stored evidence and the existing claim extractor: document timestamps became zero and source modality/locator metadata was lost. The intended user value is a suggestion traceable to the owner's actual text or media, with limitations visible to the extractor. Artwork plus the owner's explanation remains the first proposed experience; this wave does not implement image understanding.

The user authorized successor integration after the archived GroupAI push was rejected. Work is isolated on branch `codex/multimodal-layer-20260927` in `C:/Users/raghav.s/Desktop/build/Vyakti-platform-multimodal-20260927`, based on remote `codex/handoff206` at `20263775f06d471f7d69a09d4b4aa711955ee952`. Existing dirty coordinator work is preserved. The [canonical handoff](../../handoff/2026-09-09/START-HERE.md) still records broader product and release gaps.

## Connected implementation

`api/_experience-compiler/claim-evidence.js` normalizes rows already selected by current claim authority. The real `createExtractionBatch` and `extractionMessages` functions consume that projection. `api/_replica-claims.js` adds source type, format and locator to the existing SELECT without replacing current ownership, consent, review or erasure policy. Text/document evidence retains canonical character coordinates and null times. Audio/video evidence carries transcript timing and machine-transcription limitations; a video transcript does not establish visible content. Missing legacy metadata remains unknown. Image geometry is refused as semantic text evidence.

Claim schema v2 remains unchanged, preserving the SQL exclusion of evidence already completed under that schema. Prompt v3 describes the richer evidence envelope and changes the prompt-bound input hash for newly eligible batches. This is neither a migration nor a replay/backfill. No old GroupAI runtime or context graph is imported.

The [manual research cycle](MULTIMODAL-RESEARCH-CYCLE-20260927.md) adapts nine selected source cards to active paths. It retains completed failed and inconclusive outcomes in the queue. The prior Actual213 Hindi failure remains a completed historical failure with no replay command. Commands are display-only; the checker does not fetch sources, run experiments, choose providers or start a watcher. Source retrieval dates refer to the earlier review, not a new internet sweep in this integration.

## Verified scope

Root recorded these actual exit-0 outcomes on 27 September 2026. Provider-facing fixtures used the offline preload and mocked responses; network access was blocked.

| Check | Actual result |
|---|---|
| New multimodal claim evidence | 19 checks; includes the real `extractOwnedClaims` caller and Azure serialization with mocked responses |
| New research workflow | 15 groups; registry check and queue cover nine sources/five experiments |
| Incumbent extraction | 55 checks |
| Context grounding | 7 checks |
| Mirror learning | 25 checks |
| Canonical-context evidence | 39 checks |
| Citation coordinates | 7 checks |
| Existing compiler baseline | 82 named checks plus 1,000 property trials |

Both new suites also passed through the actual `evals/run.mjs` registry. Forced TypeScript exited 0. Copy checking passed seven scopes/21 negative controls, workflow validation six files, upload-boundary checking five rules, and prompt-budget checking 83 byte-identity fixtures plus operational caps. Existing target-cap/tight-tail warnings remain visible. Context graph validation passed at 2,977 nodes/2,492 edges after an append-only change of four nodes/five edges.

Root reproduced a sparse two-slot array with only index one present passing validation, then added an own-index guard and sparse/inherited-index regressions. Initial copy checking lacked TypeScript in the isolated worktree; the unchanged handoff passed. A private `npm ci --ignore-scripts --no-audit --no-fund` installed 160 packages without changing the lockfile, after which current copy checking passed. These observed failures and fixes remain in the context log.

Full release/browser gates were not run locally. No actual PostgreSQL statement, perception provider, paid call, local server or deployment was executed in this wave. Existing SQL predicates and ordering are unchanged; only four selected metadata columns were added. Offline fixtures establish shape and caller behavior, not SQL semantics, owner usefulness, visual interpretation or voice likeness.

## Publication and hosted CI checkpoint

Commit `ba3169cb6e8ecd112d81f76cd686a06641a0932b` was actually pushed to `origin/codex/multimodal-layer-20260927` and verified with `ls-remote`, superseding the earlier dry-run-only status. [Draft PR 8](https://github.com/raghavsharma2003/html-portfolio/pull/8) targets `codex/handoff206`.

APK [run 36301230958](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36301230958), job `108569122606`, failed its eval step with 55 failed suites. The hosted log explicitly passes both new suites plus context grounding, canonical-context evidence and replica claim extraction. It also shows widespread missing Chromium, built-fixture and historical Git-object prerequisites. Five relevant suite passes do not make the failed run green.

Root reproduced two exact failures on untouched handoff `20263775` using the network-blocked preload: consolidation config's `ROOM_MEMORY_COMMIT_SQL` hash mismatch and processing-worker's line-342 eight-stage-to-VoiceGenome assertion. Those source/eval files are unchanged by this PR. Only these two have the stated baseline reproduction; the remaining 53 have not each been classified. Release-gate [run 36301230948](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36301230948) remained in progress on Node 22/24 at this checkpoint. No final result is inferred.

At that publication checkpoint, the PR remained draft and blocked on full-release acceptance. No workflow patch or broad inherited-source repair was included then. The context log retains that failed run and bounded baseline evidence.

## Authorized release-blocker phase, later 27 September checkpoint

The user asked to continue. Work now addresses observed blockers after published head `14914bfcd6ac42cf2f3482c0b8b3dfe9d1205b96`. Release [run 36301775017](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36301775017), Node 24 job `108570649583`, failed two of 24 gates: evaluation and Room doors (2,236 passing/two failing checks). The other gates, including layout, performance, accessibility and security, passed in that job. APK [run 36301775018](https://github.com/raghavsharma2003/html-portfolio/actions/runs/36301775018) failed with the old prerequisites. None of these runs verifies the repairs below.

Both workflows fetch the pinned historical archive at depth two without merging historical source. APK evaluation now follows Chromium installation, Vite fixture build, EchoSim build and exact bundled Devanagari font preparation. Release diagnostics retain only sanitized gate failure logs for seven days. The stale worker-call assertion is replaced by bounded execution of the actual main body, including active and idle paths and nine mutants; production worker code is unchanged. Two memory SQL pins now match approved communication162 history/proof208, with 34 guard-deletion mutants; six other pins and migration159 remain unchanged. Room-door tests cover the existing `memory_classify` operation through its actual decision function.

The creator export now includes existing owner/replica-scoped GPU source authority and returns 503 if its query fails. Shared GPU lifecycle, child-job and monetary-hold records remain excluded. Incident/observer coverage uses doubles and performs no ARM calls. A real compiler defect was also found: T2 ignored `input.nowMs`. Snapshot stance and both relative-age labels now share the supplied turn clock, with host-clock and advanced-turn controls. The generated engine was rebuilt from this source.

Final local outcomes executed by root are CI prerequisites 13/13 groups, worker 47/47, memory config 8/8 plus separate authority 29/meter 27, Room doors 2,268/zero failures, incidents 146/zero, export 70/zero and actual-observer fixture eight groups. New multimodal evidence remains green at 19 checks. These improve on the observed worker stop after 33, doors 2,236/two, incidents 130/one and export 56/one. Clock controls have zero failed assertions for both fresh and settled labels under a 365-day host shift and for an advanced explicit turn. The generated engine is 377,198 UTF-8 bytes and passes freshness checking. Forced TypeScript, six-file workflow lint, copy seven scopes/21 negatives, and prompt-budget 83 byte-identity fixtures/operational caps passed; existing budget warnings remain visible.

A fresh temporary bare Git repository fetched the pinned archive at depth two and passed five selected historical lookup specifications, not the entire original 33-lookup matrix. This establishes availability of those objects without relying on local shared history. No local server or font installation accompanied that check. The CI font preparation is statically verified only; its hosted effect awaits the new run. No new SQL execution, hosted-green result, provider trial, deployment or user-quality result is asserted. PR 8 remains draft pending the complete gate.

## Handoff boundary

The focused projection and grounding checks are complete. A later real product trial must use the established signed-in Feed, review and Meet path and separately authorized assets/providers. It must show that the source-grounded suggestion is useful and that correction/removal changes subsequent behavior. The normal release gates remain required before shipping. Do not open a parallel ingestion service or infer that passing source contracts completes that journey.
