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

Full release/browser gates were not run. No actual PostgreSQL statement, perception provider, paid call, local server or deployment was executed. Existing SQL predicates and ordering are unchanged; only four selected metadata columns were added. Offline fixtures establish shape and caller behavior, not SQL semantics, owner usefulness, visual interpretation or voice likeness. A remote dry-run confirmed `origin/codex/multimodal-layer-20260927` is writable; it is not an actual push. Hosted CI may add evidence after a push, but no such result is claimed here.

## Handoff boundary

The focused projection and grounding checks are complete. A later real product trial must use the established signed-in Feed, review and Meet path and separately authorized assets/providers. It must show that the source-grounded suggestion is useful and that correction/removal changes subsequent behavior. The normal release gates remain required before shipping. Do not open a parallel ingestion service or infer that passing source contracts completes that journey.
