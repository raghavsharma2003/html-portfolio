# Private candidate activation UI

2026-09-08. Source only. No tests, browsers, builds, SQL or providers executed during the reserved Hindi CPU lane.

The completed blind evaluation now mounts `CandidateActivationAction` for its explicit candidate ID. The first request is a status read through POST `op=status`. Activation requires a verified qualification ID and current capability ID from the scoped server response. Restoration uses the exact rollback capability. Both mutations require an explicit tap and refresh status afterward. Interrupted or invalid responses remove eligibility until the owner checks status; no mutation is retried automatically.

The component uses the existing compact action styling, wrapping controls, minimum 44px targets, live status and a local alert. Its scope includes account token, replica, candidate and stopped state. Changing scope aborts pending client work and invalidates late responses. Aborting does not claim to cancel a server transaction. Copy states private text conversations and directs the owner to start a new conversation after switching.

Decision: display this action after completed blind review, not during anonymous comparisons. Rationale: preserve the comparison flow and make promotion a separate explicit owner action. Reverse if the integrated qualification flow needs a dedicated review summary, while retaining explicit promotion and scoped authority.

Measurement: n=0 executed checks in this task. Source fixture contains 6 planned mounted groups across 390px and 1440px, including 10 invalid response shapes per viewport. Method is authored Playwright/Vite fixture using synthetic route responses; it does not prove real SQL or qualification correctness. `evals/candidate-activation-ui.mjs` is intentionally not registered or run while the parent reserves CPU/browser resources.

Rejection: do not enable activation from a completed review alone, or blindly reuse a mutation response after an uncertain request. Completion is not qualification, and an interrupted response does not prove the server did nothing. Current source requires server eligibility, expected capability binding and explicit status recovery.

Integration remains: merge this mount with the separate qualification action; refresh or remount status after a qualification result changes; connect the named stale-capability error and new-conversation reset in the parent runtime flow. Run parser/browser controls and semantic TypeScript after the hold, then register the suite and union context entries with the root graph. No quality, deployment or end-to-end acceptance is claimed.

## Explicit private experiment follow-up

Root authorized a distinct `owner_private_text` experiment without changing the existing qualification pass. The flat parser now requires `can_experiment`, `experimental_qualification_id` and `selection_kind`. The separate “Try this version privately” action sends `op=experiment`, the experimental qualification ID and expected capability, followed by a status read. It never auto-runs and never enables qualified activation. An active experimental selection is labelled “Private text experiment”. Rollback is unchanged.

Decision: keep experiments visibly separate from qualified use. Reverse if experimental eligibility cannot be bound to the reviewed server evidence and explicit owner selection. Rejection: do not describe an inconclusive qualification as passed merely because a private experiment is permitted. Measurement: still zero executed checks; the source fixture now contains 8 planned viewport groups and 13 parser negative shapes per viewport, including explicit experimentation while qualified activation stays disabled.

## Selection to next conversation caller

Confirmed mutations followed by validated fresh status emit `vyakti:private-runtime-changed` with only replica and capability IDs. The mounted conversation listens in its current authenticated scope and treats this as invalidation, not authority. It stops audio, invalidates pending reads/replies, clears the visible history, and rechecks authenticated runtime/history. A bounded in-memory `runtimeChanged` marker survives remount. Existing session and uncertain trace IDs survive until their history can be read and pending usage checked. An explicit New conversation creates the next session and restores its history before sending is enabled. No event sends a question or automatically opens a session.

Decision: preserve settlement recovery before switching sessions. Reverse only with an equivalent durable recovery path that cannot hide unresolved usage. Rejection: deleting the old continuity entry immediately loses the pending trace and can conceal a still-running reply. Backend history for a previously owned capability must remain readable; otherwise this UI deliberately remains blocked rather than silently dropping unsettled work.

Measurement: no execution. The existing `dialogue-history-ui.mjs` now has one authored event-to-next-answer group per viewport, covering malformed/foreign events, pending reply, remount, explicit new session and next-send session identity. Activation fixture also asserts token-free event payloads and no events from status-only reads or ambiguous writes. Conversation reset is source-connected; integration/runtime acceptance remains pending.

## Qualification305 union

Restored only `CandidateEvaluationLab.tsx` from exact commit `305e2bc539a96b67db76ac8e416c3effc15ee756`, then added the activation mount and results-refresh callback. Existing qualification/vote scope guards, explicit uncertain-result recovery and strict completion checks are preserved. The mount requires the same scoped completed nonempty review as qualification.

An explicit successful Check results or Read result status triggers a stable revision callback. Activation refreshes status without remounting; if a version request is pending, the read waits for that request to settle. This avoids cancelling a version change and losing its uncertain-result recovery marker. Neither initial qualification reads nor callback identity changes trigger any mutation. The qualification fixture now separately permits status-only activation calls and asserts a second eligibility read after an explicit result check. Source only; no tests executed during FULL45.

Root's architecture decision preserves the global/public baseline and uses a separate owner-private selection pointer. UI copy remains confined to private text conversations; backend scope redesign is parent-owned.

## Private runtime status review

Source-reviewed `ownedPrivateRuntimeStatus`: an existing owner-private pointer returns `private_selection=true`, explicit `owner_private_text` exposure, candidate boolean, capability ID only when valid, and `private_selection_unavailable` on failure. Added optional typed fields and client validation of that private shape. Conversation renders this blocker as a platform availability issue with Check again, without a setup link or raw internal key. A private baseline (`private_candidate=false`) is still text only: listening is disabled even for previously restored turns that once allowed voice. No change to baseline/public backend selection.

Measurement: zero runs during FULL45. Two additional authored dialogue-history viewport groups cover private baseline voice suppression, platform-owned unavailable state and recovery. Existing selection-to-new-session reconciliation remains intact. Rejection: treating `private_candidate=false` as permission for voice would incorrectly enable voice on a private baseline capability; use `private_selection` as the modality boundary.

## Exact selection conflict recovery

Only a `ReplicaApiError` with HTTP409 and exact raw code `candidate_selection_changed` renders “Your selection changed. Check the latest status.” Hindi uses the existing Studio locale resolution: “आपका चयन बदल गया है। ताज़ा स्थिति देखें।” The server's specific atomic compare-and-swap conflict mapping remains parent-owned. Other errors retain unconfirmed-change copy. All failures clear eligibility and cancel any queued qualification-triggered refresh so recovery still requires an explicit status tap. No mutation retries.

Measurement: no runs. Activation source fixture adds one conflict group per viewport with both locales and a generic500 negative. `private-runtime-status-ui-contract.mjs` separately authors 4 accepted shapes and 8 refusal controls, including no-pointer legacy response, text-only private baseline, forged public exposure and capability/activity mismatch. That new contract suite is not registered here. RuntimeGate's existing platform-owned private-selection label was read and preserved unchanged.

Rejection: mapping every database failure to a stale-selection message would hide unknown write outcomes. Only the exact recognized409 code receives the review-latest explanation. Reverse this presentation if the server changes its documented conflict contract, without inventing a successful selection or retrying a mutation.

## Explicit current-AI recovery

Root authorized reset separately from historical rollback. The strict status shape now requires `can_reset` and nullable `reset_target_capability_id`. When eligible, the owner sees “Use current AI” or “मौजूदा AI इस्तेमाल करें”. An explicit tap sends `op=reset` with expected private capability and the exact server-provided current-global target, without qualification. Confirmed reset and fresh status use the same runtime invalidation event and explicit next-conversation flow. Reset is never automatic and shares conflict/unknown-result manual recovery.

Decision: keep historical Restore previous version distinct from Use current AI, since they select different targets. Rejection: relabelling rollback as reset can silently select an outdated baseline after the global AI changes. Measurement: no execution; reset source fixtures cover both locales at both widths, exact request binding, absence of qualification and a fresh private-baseline capability event. Three parser negative shapes cover reset eligibility without a target, self-target and nonboolean permission. The backend creates the private baseline and preserves the global AI; UI fixtures do not prove those SQL effects.

## Recovery without a surviving candidate

`PrivateSelectionRecovery` is mounted directly in the unavailable-private conversation state. It needs only authenticated token and replica ID, omits `candidate_id` in status/reset requests, and strictly requires `candidate_id:null` in receipts. Thus an erased candidate or unavailable comparison panel cannot remove the recovery button. The existing candidate-specific action keeps its required UUID contract. Explicit reset binds both expected private capability and current-global reset target; uncertain completion needs a manual status read, with no repeated reset. A confirmed changed capability uses the same conversation invalidation event, pending-work preservation and explicit new-session flow.

Decision: recovery belongs in the conversation's unavailable state as well as the candidate review. Rejection: mounting recovery only under completed candidate evaluation makes an erased candidate impossible to recover from. Measurement: source only, zero tests. The activation mounted fixture now includes candidate-free reset, null-candidate parser negatives and uncertain reset recovery per viewport. The dialogue-history fixture allows the newly mounted recovery status read without permitting a reset.

## Erased prior history after reset

An exact409 `dialogue_session_not_authorized` or `dialogue_runtime_not_active` while reading the explicitly named prior session can permit explicit New conversation after a runtime change, only when no uncertain trace, uncertain opening or known pending usage survives. This supersedes the earlier blanket requirement that old history always be readable. The old transcript stays cleared; the composer remains disabled until the new session's own history succeeds. Auth failures, generic503 and malformed histories do not grant this path.

Continuity now retains `pendingWork` from history and completed-turn billing state, including late replies. Erased history with known pending/uncertain work stays blocked; no UI path claims its usage was settled. Such permanently erased unsettled work needs a separate server reconciliation path. Decision: distinguish inaccessible settled history from outstanding work. Rejection: blindly dropping the old session after any read failure can hide an in-flight charge, while requiring all erased settled history to become readable traps legitimate recovery. Measurement: no tests; added source controls for explicit recovery without known pending work and continued refusal with erased pending history.
