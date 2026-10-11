# Capture lifetime handoff, 2026-09-07

Source frozen in `scratchpad/expert-capture-lifetime`, branch `codex/expert-capture-lifetime`, from checkpoint20 `da3ac2aeac29571ae45a4507d947b1cf603cf9c1`. Exact SHA-256 manifest: `scratchpad/expert-tools/capture-lifetime-hashes-20260907.json`. No integration files, registry, capture challenge, provider policy, credentials or cloud settings changed.

## Decision and reversal

`PrivateWavCapture.start()` now returns `Promise<void>`. Both OWNED microphone helpers await `AudioContext.resume()` before recording frames; resume failure closes every acquired track/node/context and preserves its original error. Pending and repeated starts cannot clear an active buffer. Cancel while resume is pending prevents late start. The older creator helper receives the same already-reviewed acquired-resource cleanup discipline as the modern helper. Reverse this approach only on a demonstrated browser compatibility failure with an alternative that still releases all owned resources and never announces recording before successful audio startup. Do not restore fire-and-forget resume simply to hide an error.

Three remaining capture panels now own preview URLs independently of React recording state, cancel on unmount, discard late permission/stop results and silence stale failures. Lab capture generations also bind exact replica ID and session token; QuickVoiceCapture invalidates when disabled. Provider issue/upload/create/erase handlers remain unchanged. Effect scope resets only the local recording/permission stage, preserving unrelated API-in-flight stages. The existing checkpoint20 ResonanceRecorder gains only awaited start and its existing generation check after that await.

The borrowed-stream `openStreamWavTap` in creatorStudio is byte-identical (normalized line endings) to checkpoint20. Its caller still owns its tracks; changing it would be a separate lifetime contract.

## Actual callers and merge boundary

- `src/studio/EnrollmentWorkspace.tsx` mounts QuickVoiceCapture and its onUseRecording callback schedules real private sample upload. The parent workspace is keyed to replica ID. New tests prove that late clean completion after unmount or disabling cannot invoke this callback.
- Both actual StudioApp implementations mount their own VoiceEnrollmentLab, keyed to replica ID. These are distinct modules, so both are repaired and mounted in the fixture.
- ResonanceRecorder is the fourth and final owned-helper start caller. `rg openPrivateWavCapture src` finds no additional caller. Its `CloneExperience.tsx` merge is ONLY the hunk around old line309: replace `capture.start()` with awaited start and repeat mounted/attempt validity before announcing recording. Grounded's separate recovery edits are elsewhere in this file and must be merged, not overwritten.

## Measured checks

All checks below ran locally on 2026-09-07 with synthetic physical/API boundaries; no real microphone permission, device, provider or model request occurred.

- `node evals/wav-capture-start.mjs`: **33/33** actual helper-source groups. Both leaves: partial constructor/node/connect failure; asynchronous/synchronous resume failure; cleanup failure still releases all tracks; pending-start no frames; start overlap; cancellation; actual PCM normal success. Fault-removal controls demonstrate leaked tracks without resume cleanup and premature accepted frames without await. Includes borrowed-stream byte identity.
- `node evals/wav-capture-cleanup.mjs`: **13/13** incumbent helper groups after adapting actual normal start to await and binding the setup-cleanup mutation to its setup occurrence.
- `node evals/capture-lifetime.mjs`: **26/26** mounted actual QuickVoiceCapture, modern Lab and creator Lab groups in React StrictMode. Preserved JSON: `scratchpad/expert-capture-lifetime/scratchpad/capture-lifetime/1788785890057/result.json` (finished 12:58:58.846Z). Tests exercise real buttons and actual component handlers, synthetic helper calls and owner-scoped consent-status reads. All provider write exports throw and are counted; zero writes and zero unhandled errors. Tests cover pending permission, pending/rejected resume, unmount, retake/re-record, disabled/token/replica changes, preview URL lifetime, and removed-await/removed-late-stop controls.
- Added six cases after that batch to explicitly test a stale stop success OR error while a NEW recording is already active. `node evals/capture-lifetime.mjs --filter=stale`: **6/6**. Preserved JSON: `scratchpad/expert-capture-lifetime/scratchpad/capture-lifetime/1788786036929/result.json`. This was a focused additional functional check, not a second visual polish round. The final unfiltered eval contains all **32** groups; the final 32-group version has not been run as one batch.
- `node evals/recorder-lifecycle.mjs`: **12/12**, including the prior nine groups and actual recorder deferred resume, visible rejection/retry availability, and unmount during resume.
- `node ../../node_modules/typescript/bin/tsc -b --force`: passed. `node scripts/check-copy.mjs`: passed. `git diff --check`: passed (only existing worktree CRLF normalization notices).
- React checklist reviewed: hooks unconditional, lifetime effects depend on primitive capture scope, resource refs detached before asynchronous cleanup, stale work cannot publish into a newer capture.

No full release, real full creator journey, physical microphone/browser hardware compatibility, voice likeness, provider readiness or performance claim follows from these focused checks. Browser fixture bundles were in memory; no integration dist rebuild. Parent owns release registration/full acceptance.

## Rejections and retained failures

1. Fire-and-forget audio resume is rejected. The actual-source removal control accepts frames and creates a WAV before resume succeeds. Resume-cleanup removal leaves both acquired tracks open.
2. Component cleanup that only cancels `captureRef` is insufficient: permission may still be pending, and stop may return a new object URL after unmount. The actual removed-late-stop guard control invokes QuickVoiceCapture's onUseRecording callback after unmount; Lab controls leak the late URL.
3. First helper cleanup run reached 12/13, then its mutation did not match: new resume cleanup added another close occurrence, and the attempted exact setup pattern omitted the existing comment. Retained tool output records the assertion. Corrected to the last close occurrence, actual setup exception control now demonstrates the leak.
4. First mounted fixture build failed because the source-mutation hook saw Vite-transformed formatting. It did not test product behavior. Corrected by enforcing pre-transform and normalizing line endings; future build errors are retained in result JSON. Original empty artifact directory `1788785725754` remains; console failure was preserved in the task transcript.
5. The next mounted batch passed seven Quick groups then timed out in its disabled probe. The fixture reassigned `disable` without its default argument, so calling it set undefined rather than true. Failed result retained at `scratchpad/expert-capture-lifetime/scratchpad/capture-lifetime/1788785748197/result.json`. Fixed the fixture default; actual disabled behavior then passed. No product change was made for this fixture failure.

## Exact files

- `src/studio/wavCapture.ts`
- `src/creatorStudio/wavCapture.ts`
- `src/studio/QuickVoiceCapture.tsx`
- `src/studio/VoiceEnrollmentLab.tsx`
- `src/creatorStudio/VoiceEnrollmentLab.tsx`
- `src/studio/CloneExperience.tsx`
- `evals/wav-capture-start.mjs`
- `evals/wav-capture-cleanup.mjs`
- `evals/capture-lifetime.mjs`
- `evals/capture-lifetime/host.tsx`
- `evals/recorder-lifecycle.mjs`
- `evals/recorder-lifecycle/host.tsx`

## Release20 incumbent fixture repair, additional frozen file

Root authorized one additional test-only file after the original freeze: `evals/quick-voice-capture/run.mjs`. Release20 retained exactly one failure in that suite at stdout line4891. The unchanged source predicate demanded the old forEach-track-stop and context.close spellings; checkpoint20 used per-track try and ownedContext.close to fix actual cleanup. Focused unmodified integration reproduction retained `quickvoicecapture-release20-reproduction-20260907.log` with 26 passing assertions and that one failure. Exact19/20 predicate JSON and diagnosis note remain beside this handoff. This was a stale test assertion; no physical failure was reproduced by that regex.

Replaced the spelling assertion with execution of the existing 13-group `wav-capture-cleanup.mjs` actual-source suite. It covers acquired track release, partial setup, throwing disconnect/close and cleanup-removal control. Named the assertion for owned-helper cleanup only; real component unmount and stale-stop behavior belong to the mounted capture tests. It no longer claims a source grep proves unmount. No runtime source changed after the original capture freeze.

`node evals/quick-voice-capture/run.mjs` passed all **27 top-level assertions** on the capture isolate, including its actual 13-group helper invocation. Do not add those 13 to the earlier unique helper count. Success log: `scratchpad/expert-tools/quickvoicecapture-capture-fix-20260907.log`. No broad browser or release rerun. Updated SHA manifest includes this thirteenth owned file. Parent registry entries for incumbent quick/helper remain unchanged.
