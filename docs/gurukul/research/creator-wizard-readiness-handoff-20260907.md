# Creator setup readiness and actionable prerequisites

2026-09-07. Isolate `scratchpad/expert-meet-readiness`. Integration untouched. This follows the frozen full-shell handoff; it supersedes only that handoff's StudioApp and full-shell-eval hashes. Other six-file slice bytes remain unchanged.

## Decision and reversal

The lower Deploy panel computed only Deploy-owned runtime blockers. With identity/liveness/voice blockers assigned to Meet, its local list was empty and it emitted `not_activated`, telling the owner every gate was closed while the actual runtime button remained disabled. The actual model reproduced this before changes: expected four known prerequisite codes, received only `not_activated`.

Deploy now retains every runtime blocker, including earlier-step prerequisites, through the existing ownership/classification constructor. Processing-held approvals remain `us`; platform voice wiring remains `us`; identity remains `you`; unknown gates remain visible. The exact server `can_activate` is carried by the actual StudioApp reduction as `canActivate`. Only explicit true and zero runtime blockers can invite activation. Inactive false/unknown permission with no explanations gets a named platform status, not a fabricated ready state. No backend permission or activation mutation changed.

Mirrored prerequisites retain their original step and anchor. The existing ReplicaWorkspace step owner supplies navigation through StepBlockers. A bounded MutationObserver waits for the actual lazy target to mount, then uses existing jumpTo to open its details and focus it. The wait cancels on replica, token or step changes, new pointer/keyboard activity, focus moved elsewhere, unmount or a3-second upper bound. The upper bound is cleanup, not a guessed mount delay; ordinary cases focus as soon as the actual target exists.

This specific navigation button now uses native onClick, with no custom Enter/Space handler. Root explicitly authorized the exception to its historical pointerdown comment: real full-shell evidence showed pointerdown caused target focus to be overwritten by the browser's subsequent native focus on the initiating button. Native click handles pointer/keyboard and cancellation before release. A one-frame workaround passed but was rejected as unnecessary complexity. Reverse this exception only with actual full-shell pointer/Enter/Space focus evidence for a simpler alternative. No broad DESIGN-LAW edit.

## Evidence and limitations

- New actual creator model + actual StudioApp reduction:8/8 groups. Includes all blocker vocabulary/classification/anchors, processing reclassification, true/false/absent permission, unknown gates, and the old Deploy-only filtering negative control.
- Actual navigation hook code with synthetic DOM/hook scheduler:9/9 groups, including replica/token/step change, focus elsewhere, pointer/keyboard interruption, unmount, timeout, same-step action and removed-observer negative control. This is control-flow evidence, complemented by the mounted full app.
- Full real StudioApp/HTML/CSS/entry routes:59/59 groups in `scratchpad/expert-meet-readiness/scratchpad/meet-full-shell/1788784029170/result.json`. Four signed-in cases at390/1440 verify the lower panel no longer invites activation; two actual pointer cases, Enter on390 and Space on1440 change to Meet and focus the real mounted `#identity-proofing`. Exact replica and Hindi locale survive. Previous setup/layout/disclosure checks and six signed-out personal/teacher/ops entry cases remain included.
- Typecheck force passed before final native-click simplification; final incremental typecheck also passed for the final bytes (exit0). Copy check and diff whitespace checks passed. No full release or performance run by this agent.
- Source data is synthetic owner/session/API data, not real auth/DB/identity/model evidence. New Meet fixture read endpoints use existing layout ROUTES for exact known POST status operations. Readiness and drift explicitly return503 synthetic measurement unavailable; no fake scores. This confirms identity navigation, not every prerequisite's backend readiness or every downstream anchor under every feature flag.

Retained failures under `expert-meet-readiness/scratchpad/meet-full-shell`:

- `1788783668466`:12passed then focus timeout; entering real Meet exposed additional POST read operations absent from the fixture. They were refused and caused unrelated error focus. Extended only exact read fixtures; writes remain refused.
- `1788783823188`:12passed then focus timeout after read-fixture repair. Exact DOM shows identity target exists and received tabindex=-1, but activeElement is Go there button. This demonstrates pointerdown/default-focus ordering.
- `1788783907955`:59passed with one-frame workaround, retained but not final implementation.
- `1788784029170`:final59passed with native click and actual Enter/Space paths.

## Final files and hashes

| File | SHA256 |
| --- | --- |
| src/creatorStudio/StudioApp.tsx | 65ef13e5565e2b994aa9e09c098fda6f965a0d1bd273760ae31e7daf2e4c85f0 |
| src/creatorStudio/wizardModel.ts | e525cd8ac8a8c1ed5d4c26fc36430118317ea8f485af9428c1e9fecdb7e67e9a |
| src/creatorStudio/WizardRail.tsx | e240bc724226942c04355f417a516f5f7aa76ed8dc6d1630d2bfdbb508ed0643 |
| src/creatorStudio/useWizardBlockerNavigation.ts | 1f63331d48b44ddeb624085b26109b9ec0f380f05461d906aa15bbb6de653100 |
| evals/creator-wizard-readiness.mjs | 8e8535ce74a834f1c35ec259826acb29210bd0930958ab3f25d4b08a09ced8c3 |
| evals/wizard-blocker-navigation.mjs | 2889dcb73df06d56944a1b42aa4c0b8c7f96ebda739b564227eaa73b962f4ce8 |
| evals/conversation-setup-full-shell.mjs | 3df7c61a1524856b8d8990f965fb7c610e6609525e8e123212d4b6f7b1d47a51 |

Commands: `node evals/creator-wizard-readiness.mjs`, `node evals/wizard-blocker-navigation.mjs`, `node evals/conversation-setup-full-shell.mjs`.

## Separate recorder review

Read-only review of `scratchpad/expert-recorder-lifecycle` root patch found no confirmed introduced blocker. Unmount URL revocation is compatible with actual submitRecording, which uploads the retained File rather than dereferencing its URL. The WAV helper releases tracks before graph/context cleanup and preserves the original setup error while attempting cleanup. The syntactically unhandled retake cancel rejection was not established as reachable through ordinary review paths, where captureRef is null or the helper is already closed. Recommended mounted complete retake and unreadable-file recovery checks; root subsequently reports9 mounted and13 helper groups passed. This agent did not rerun those tests or use device APIs. Shared start/resume and older recorder lifecycles remain outside this reviewed slice.
