# Return to knowledge during voice setup

2026-09-08. Base: personality review freeze `684441e14dcbb0fac904fea3c8d104412848ab98`, retaining its token/replica review fences. Root's candidate28 and the grounding comparison sources/holdouts were not changed.

## Friction and bounded correction

The actual CloneExperience caller mounts CloneVerificationJourney after a recording becomes the active candidate. At this point RoomNav is hidden until a source-bound voice draft exists. The recorder's earlier Add knowledge first action is gone, and the caller never supplied the verification component's existing onExit callback. Thus a user waiting on source processing or unavailable live verification had no direct route from that scene to the already-implemented knowledge, private draft test and material-sharing flows. This is a source-observed navigation gap, not measured user abandonment.

The caller now supplies onExit to select the existing knowledge menu. A visible Back to knowledge label accompanies the existing back icon, using a 44px minimum action in the verification header. The owner can return through the existing Back to voice action. The callback changes only local navigation/view parameters, preserving the exact replica, locale, saved candidate, upload intent and build intent. It does not reset recording selection, clear consent, grant identity, retry a new build, publish material or introduce another chat mode. The existing stage model, review fields, safety callbacks and server boundaries are unchanged.

This is navigation away from the current scene, not a promise to persist unsaved local document/camera edits. Existing child-unmount cleanup applies. The retained candidate and server-backed pending/unavailable state are what the mounted controls prove can be resumed. The knowledge and sharing destinations still run their own readiness checks and can truthfully be unavailable.

## Executed evidence

Final actual mounted receipt: `scratchpad/verification-knowledge/1788815964784/result.json`, 14 groups at 396x900 and 1440x900. The fixture mounts actual old/current CloneExperience, the real verification stage, lazy LivenessCapture, PrivateTextRehearsal and MaterialSharePanel, with the actual entry fonts/styles. It supplies synthetic stored state and local HTTP responses; no real identity, consent, provider or SQL proof follows.

Controls retain the old caller's missing navigation, keyboard navigation and heading focus, exact candidate/intent/local-storage preservation, clone and Hindi-locale URL preservation, same-stage return and reload, hidden voice-ready navigation, unavailable verifier and disabled source-derived actions. Private-test and publication readiness are genuinely unavailable fixture envelopes, not fake ready states. There are no unexpected routes or HTTP mutations; the preexisting idempotent build-intent read/replay callback is observed with the same UUID rather than disguised as a new build. The new caller differs from its base only by onExit and label wiring.

Other checks: 31 existing clone-verification stage/safety checks, forced TypeScript, copy law (7 scopes, 21 negatives), source-only caller delta, and git diff checks passed. One Impeccable detector pass reported an empty finding list. Final mobile and desktop screenshots were inspected: the action is visible in the initial viewport and no horizontal overflow was observed. This is functional and visual inspection, not timing, accessibility certification or user research.

Retained fixture correction: first 14-group run used the wrong private-test endpoint/shape and only checked disabled Ask. That could pass after a read error and did not prove a valid unavailable state. The strengthened Waiting on us/no-alert assertion then failed. Correcting the route to `/api/replica-text-rehearsal` and supplying the exact statement-set/grant-scope/three-statement envelope made the final 14 pass. No runtime fallback, timeout increase or production change was used to obtain that result. Initial receipt `1788815855120` is not the final blocker-flow proof; intermediate run `1788815917205` failed at the strengthened assertion.

## Decision and reversal

Reuse the established navigation port and existing destinations rather than treating blocked voice enrollment as a reason to prevent independent knowledge work. Keep a visible action rather than an unexplained empty header slot. Reverse or revise this placement if actual users cannot find it, misread navigation as verification completion, or a measured pending-media case requires a specific unsaved-work guard. Do not remove verification predicates to make a destination appear ready.

Only three production files change: CloneExperience.tsx, CloneVerificationJourney.tsx and clone-verification-journey.css. Root owns registry integration and full release. Suggested suite key `verification-knowledge`: `node evals/verification-knowledge/run.mjs` (browser resource class; old/current share one bounded browser process). No full release, deployment, real auth, provider call or paid operation was run here.

## Portable historical negative control (V2)

Root review found that the original test used git show on base684441e and would fail in shallow CI. The exact historical caller is now committed as fixtures/CloneExperience.before.tsx.txt, pinned to SHA256 b7fb64ac4965ba7af81ec4acff5cc9c7f42b052a0cb1f6d3f3297c0c7b5ddb8e and protected from line-ending conversion. The mounted old-caller negative uses the same bytes. Source-only checks load no Vite, Playwright or fixture dependencies. A real local file-protocol depth1 clone at test commit9fe799ce, without node_modules, had exactly one commit and could not resolve the old base; source-only passed and a deliberate fixture-byte mutation failed. Receipt ROOT scratchpad/expert-tools/verification-knowledge29-depth1-proof.json. Production hashes remain identical to the14-group mounted receipt. No repeat mounted/browser run was needed for this history-loading repair.
