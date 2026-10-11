# Correction preparation handoff, 2026-09-07

Isolated source: `scratchpad/expert-corrections`, branch `codex/expert-corrections`, based on 46434a41. No integration edits, models, deployment, real owner feedback, or activation performed by this agent.

## Decision and reversal

Expose a read-only owner GET that recomputes current correction readiness from one SQL snapshot. Every POST requires the exact reviewed source hash and rechecks current capability, profile, calibration and the latest eligible feedback fingerprints at insertion. Persist only a draft manifest; a receipt is not quality evidence or runtime approval. A saved historical readiness flag is never returned as current readiness. Source versions with no eligible feedback stay explicitly empty.

The owner panel belongs in the existing personal ExpertConversation, alongside saved TurnFeedback. Only a successfully persisted feedback revision triggers the refresh. An explicit Prepare action writes the snapshot. Uncertain responses trigger a GET receipt readback, never an automatic POST retry. Keep profile/calibration and split details in the expanded requirements. Restore focus only for the current replica/request, a connected action, and focus that fell to document.body.

Reverse this arrangement if a real owner test shows preparation belongs elsewhere, or if an independent SQL race demonstrates that the snapshot/insert contract admits a changed source set. A stronger overlapped transaction/lock guarantee needs separate evidence; this change does not claim one.

## Measurements

- Initial backend correction: 35 source/control-flow checks passed, including the actual former counting expression negative control. See `correction-dataset-stage1-20260907.md`.
- Expanded backend suite: `node evals/feedback-dataset/run.mjs`, **50 checks passed**. Mocks prove control flow, not SQL syntax or integrity.
- Actual built frontend API parser/callers: `node evals/feedback-dataset-client.mjs`, **18 checks passed**, including an executed replica-guard mutant. No network/model.
- Root executed `runFeedbackDatasetSqlChecks`: **10 actual development SQL groups passed**, completed **2026-09-07T10:19:17.459Z**, **0 remaining fixture rows**. Root retained `scratchpad/expert-tools/development-concurrency-feedback-dataset-20260907.json`. Exact target `vyakti_expert_integration_20260906`. Synthetic FK prerequisites only; no identity timestamps, consent grants, activation function or provider calls. This covers independent writes between review and insertion, not simultaneous lock timing.
- Headless repository fixture: final `node evals/feedback-dataset-ui.mjs`, **12 groups passed** across **390 and 1440px**, reduced motion, real ExpertConversation/TurnFeedback/panel/API callers with synthetic loopback responses. Actual persisted feedback callback, empty state, keyboard disclosure, 409 readback and focus, exact receipt, undecodable success receipt recovery without automatic retry, former-replica delayed read isolation. No page overflow or runtime errors. Both screenshots inspected.
- `npx tsc --noEmit` passed. Syntax checks and `git diff --check` passed. Full release not run in this isolated worktree.

## Rejections and failures retained

1. Raw server socket destruction after a synthetic write was not a deterministic unreadable-receipt fixture. First batch timed out after the 390px success screenshot. Replaced with a committed 201 containing undecodable JSON, and narrowed the reported guarantee. No transport-loss acceptance claimed. Retained `scratchpad/correction-ui/first-batch-failure.json`.
2. Keeping a disabled Prepare element mounted did not preserve keyboard focus: the next batch failed the actual focus assertion after 409. Added the guarded restoration described above. Failure retained in `scratchpad/correction-ui/failure.json`.
3. Parent explicitly authorized the bounded functional confirmation after the second attempt found a real focus defect. It was not another visual-polishing iteration. Final result and inspected screenshots are `scratchpad/correction-ui/result.json`, `corrections-390.png`, `corrections-1440.png`.

The in-app browser connection was unavailable, with documented discovery returning no browsers. The final verification used the existing repository's isolated Playwright test infrastructure, not real owner authentication.

## Files to integrate and register

Backend: `api/_replica-feedback-dataset.js`, `api/replica-feedback-dataset.js`.
UI: `src/studio/types.ts`, `src/studio/feedbackApi.ts`, `src/studio/TurnFeedback.tsx`, `src/studio/ExpertConversation.tsx`, new `src/studio/FeedbackDatasetPanel.tsx`, new `src/studio/feedback-dataset.css`.
Evals: expanded `evals/feedback-dataset/run.mjs`; new `evals/feedback-dataset-client.mjs`, `evals/feedback-dataset-ui.mjs`, opt-in `evals/feedback-dataset-live.mjs`.
No registry or context files changed in integration. Root owns registration and final release acceptance.
