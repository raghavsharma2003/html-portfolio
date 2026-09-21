# Pending request refresh settlement, 2026-09-08

## Exact delta

Branch codex/first-use-refresh-settlement begins at frozen d5b107887a48c0c873b8148ccd6be592fa7be098. Only StudioApp.tsx changes in this owned production delta. Its source still rejects old-token payloads. Account and operation generations now let the same current operation settle loading/busy status to an explicit read retry. A newer account or newer operation owns its own flags. Old401 cannot sign out the refreshed account. No automatic create, grant or inference retry.

A same-owner background refresh differs from refresh before the request: an existing source awaiting processing installs the actual readiness poll and focus-resume listener. The owner starts create, Back/list or selection with T0; the request stays pending. Focus-resume calls ensureStudioSession after the refresh threshold and installs T1. The old request then succeeds or rejects401. Before this delta, strict token checks correctly refused the payload but left creating/loadState stuck. Current code keeps that refusal and releases only its owned state. Subsequent explicit retry reads current workspace data. An uncertain creation's durable intent is preserved, with no implicit grant or duplicate create.

Separate dependency: grounded agent owns replicaApi.ts body-abort repair, exact SHA cfd6a92f80c4feccc9a9a6a45eec706c6da8758d515afe6b90c3416a6749cdf9. Prerequisite commit8151dadc contains only that file and is excluded from this delta. Exact old API fixture SHA2ecabf28ffcd1c37865ff218a640cf8a045b0fffb5f1a5980b39fe1880797973. No ActivityPanel, consent/API authority, SQL, publication or model change is owned here.

## Executed evidence

- Native actual-function24 passed: three methods, success/error after same-owner refresh, exact frozen-old methods, plus newer-account and newer-operation refusals. It asserts no stale payload adoption and no stale auth side effect. Incumbent first-use actual-function18 also passed.
- Mounted12 groups/24 outcome cases at390/1440 completed 2026-09-07T18:52:44.426Z. scratchpad/first-use-refresh-settlement/1788807094429/result.json. Actual Studio entry, native browser fetch, existing readiness focus handler and synthetic localhost HTTP. Both successful and401 old-token responses execute for each old/current create/list/select and width. Old flags remain stuck after response completion; current error/retry works. No additional grant, model request or automatic create. Final StudioApp bytes match this run.
- Mounted native Activity overlap4 at390/1440 completed 2026-09-07T18:55:56.942Z. scratchpad/first-use-activity-abort/1788807343576/result.json. Actual Activity HTTP sends200 headers and partialJSON; native Response.json begins, then real app token refresh cleans up its old effect and aborts the body. Both exact old API controls swallowAbortError into{} and crash activityRevision jobs.map. Both new API controls preserveAbortError, leave Studio mounted and let pending create settle to retry. No body mock or ActivityPanel replacement; a fixture wrapper observes the native body call without changing its rejection. Final StudioApp and dependency API bytes match this run.
- Initial narrow polling fixture held account refresh until its unrelated old Activity body finished, keeping the original state-settlement negative isolated. The separate overlap4 deliberately removes that serialization: it releases refresh while the native body is blocked, proving the original crash and repair.

Types/copy/graph results appear in final handoff after completion. Root will run original first-use18 and the full release on combined final bytes. No full release was run here. These are synthetic auth/HTTP fixtures, not actual Supabase, database, model, upload extraction or owner-quality acceptance. No network beyond localhost.

## Preserved failed runs

- scratchpad\first-use-refresh-settlement\1788806301563\failure.json: 1 completed groups, 0 page errors; Expected values to be strictly equal:
- scratchpad\first-use-refresh-settlement\1788806714806\failure.json: 0 completed groups, 1 page errors; locator.waitFor: Timeout 12000ms exceeded.
- scratchpad\first-use-refresh-settlement\1788806843575\failure.json: 0 completed groups, 1 page errors; locator.waitFor: Timeout 12000ms exceeded.
- scratchpad\first-use-refresh-settlement\1788807011061\failure.json: 2 completed groups, 0 page errors; bounded HTTP barrier

First retry check used already-satisfied networkidle and ran before its list response; corrected to exact fresh-token list response and heading disappearance. Enabling real readiness polling revealed the independent native body-abort crash; an explicit complete ActivityView envelope did not fix it. The original failures and the later deterministic old/new overlap distinguish transport from state cleanup. Back/list setup also needed the actual selected replica response, URL and new readiness poll before firing Back; an idle assumption was insufficient. No runtime changes were made to force these old negatives. The first native promise fixture also needed a real request-start barrier, replacing a two-microtask assumption that could reject an unused promise.

## Merge and registration

Apply this source delta after d5b first-use and the separate frozen transport API. Preserve root focus changes; this delta has no CloneExperience, PrivateTextRehearsal or ContextLockerPanel edits. Add registry entries first-use-refresh-source -> first-use-private-flow/refresh-source.mjs, first-use-refresh-ui -> first-use-private-flow/refresh.mjs, first-use-activity-abort-ui -> first-use-private-flow/activity-abort.mjs. Existing first-use-private-flow source test is updated for the scoped methods and still18 controls.

Reverse if cleanup affects another account/operation, accepts an old-token row or error, removes a pending intent, or sends any automatic mutation. Full owner journey and voice readiness remain governed by existing independent authority.
