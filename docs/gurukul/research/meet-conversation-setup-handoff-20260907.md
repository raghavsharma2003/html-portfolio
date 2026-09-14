# Meet setup repair: frozen isolated handoff

Worktree `scratchpad/expert-meet-readiness`, branch `codex/expert-meet-readiness`, base `2c2e5b2ccce6e3ef101b7251e83efdb09d554376`. No integration edits, capture/StudioApp edits, API change, live authentication, model, database or activation call. Existing correction and adapter isolates/harness remain untouched.

## Result

Inactive Meet now offers **Open conversation setup**, directly carrying the exact replica and locale to `/studio?mode=setup&step=deploy&replica=...#runtime-gate`. This explicit mode passes both real entry dispatches into the existing generic creator StudioApp. It skips remembered-mode restoration only for setup, so a prior teacher preference cannot recategorize the setup flow. The existing private activation gate and backend authority remain unchanged. No publishing step is required by the new copy or action.

Loading, failed/mismatched readiness, stopped AI and usage reconciliation each have their own concise state. Only a checked inactive replica gets the setup link; loading/errors/holds never direct the owner to irrelevant setup. The composer still requires current exact-replica active status. The former “Review my AI” action led to Person Model claims and is omitted from this setup state; no claim or correction capability was moved.

Final caller correction: `stopped` is an existing generation lock also passed for draft/consent_pending/enrolling/calibrating. An optional explicit `lifecycle` now drives the stopped message only for paused/revoked/purging; legacy callers without lifecycle retain their old stopped fallback. The existing generation lock is unchanged. CloneExperience passes the exact selected lifecycle. Root must merge that one JSX prop separately with the capture agent's other edits: on the ExpertConversation tag, add `lifecycle={selected.lifecycle}` immediately after `replicaId={selected.replica_id}`. Do not replace the capture agent's CloneExperience file wholesale.

RuntimeGate handles the explicit asynchronous hash handoff once per replica/token, only when its current read has resolved and focus remains on body. It scrolls instantly and focuses the section; ordinary navigation, later refreshes and a user's already-focused control are left alone. Read and activation responses are scoped by generation/replica/token so old responses cannot replace the current UI or notify the host. The backend activation call, arguments and `can_activate`/stopped/active button predicates stay intact.

Meet uses its existing typography and spacing, with a scoped 44px primary anchor and existing-style focus treatment. No animation, asset or font changes.

## Files to integrate

- `src/studio/ExpertConversation.tsx`
- `src/studio/CloneExperience.tsx`: **one JSX prop only**, merge with the other agent's edits
- new `src/studio/conversationSetupNavigation.ts`
- new `src/studio/conversation-setup.css`
- `src/studio/main.tsx`
- `src/creatorStudio/main.tsx`
- `src/creatorStudio/RuntimeGate.tsx`
- new `evals/conversation-setup.mjs`
- new `evals/conversation-setup-ui.mjs`

Root owns registration/context and checkpoint19. The UI eval builds in memory and writes only uniquely named ignored evidence directories. It need not run inside another timed performance stage.

## Actual checks, 2026-09-07

- **7 navigation/caller controls passed**: actual helper, top-level dispatch and transpiled actual nested creator entry. Checks include exact replica/locale, generic setup destination, skipped mode restoration, unchanged teacher restoration and old evolve/ops negative controls. Executed actual CloneExperience JSX proves all9 lifecycle values propagate alongside the unchanged stopped generation predicate.
- **34 mounted groups passed** at390/1440: real ExpertConversation and RuntimeGate/API callers, both actual entry modules, actual route CSS, synthetic loopback HTTP. Loading/inactive/can-activate/error/foreign-active/stopped/reconciliation states, all4 unfinished and3 stopped lifecycle states, disabled composer, no incidental activation POST, exact CTA, late replica and token response isolation, keyboard focus, no overflow, guarded asynchronous landing and old-ops route refusal. The fixture replaces authenticated StudioApp with a delayed host and OpsBoard with a marker. This proves the two entry routing decisions and mounted gate behavior, not the complete authenticated StudioApp journey.
- **12 existing correction UI groups passed unchanged**, including persisted feedback callback, stale/uncertain dataset save readback, keyboard focus and late former-replica isolation.
- TypeScript `tsc -b --force`, `scripts/check-copy.mjs`, and `git diff --check` passed. No full release or real owner acceptance run by this agent.

Final UI artifact: `scratchpad/expert-meet-readiness/scratchpad/meet-setup-ui/1788780997157/result.json`. Prior30-group passing artifact `1788780656020` is retained; both Meet screenshots from that run were inspected at390/1440. The final lifecycle fix changes no default-state layout. Real nested-route target observations in1000px viewport: phone section top470px/action bottom975.8125px; desktop top565px/action bottom975.8125px; both section-focused. All runtime errors empty. These are fixture geometry observations, not performance or usability benchmarks.

Correction receipt: `scratchpad/expert-meet-readiness/scratchpad/correction-ui/result.json`.

## Rejections and retained failures

The earlier proposal mistakenly treated `mode=ops` as generic Studio because StudioApp's own reader falls back to generic for unrecognized values. The **second entry router** in creatorStudio/main intercepts ops into OpsBoard before StudioApp. Root rejected that route. The final source and mounted tests execute both entries; the old ops URL now demonstrably reaches the OpsBoard marker and no RuntimeGate. Do not reuse the original proposal's ops recommendation.

Root also rejected using the overloaded `stopped` prop as lifecycle authority: a draft genome can make Meet reachable while the generation lock remains closed. Without the explicit lifecycle prop, unfinished replicas would be incorrectly called stopped and lose the setup action. The final7/34 controls include this actual caller case; no generation predicate was loosened.

Earlier anchor failure top1178px/body focus in a1000px fixture demonstrated that a late-mounted target can miss native hash scrolling, but it **did not establish the full destination**, because the first fixture replaced creator main. The final passing route uses both real entries, real creator CSS and the bounded focus effect.

All prior runtime results remain under `scratchpad/meet-setup-ui`:

- `1788780089950`:8 groups then missing native anchor in the earlier injected-entry fixture.
- `1788780271697`:10 groups then fixture expected a request after same-URL navigation, which could be same-document. Replaced with distinct explicit fixture URLs.
- `1788780326596`:22 groups then an arbitrary top<300 assertion failed for a fully focused desktop panel. Replaced by target visibility and activation-control visibility.
- `1788780385816`:8 groups then the earlier injected-entry fixture's mixed CSS put the phone action beyond its viewport. Not claimed as shipping creator layout. The full-entry fixture now loads the actual destination CSS through its dynamic imports.
- `1788780600566`:10 groups then fixture incorrectly expected two StrictMode effects in a production bundle. Corrected to its actual single request, preserving the bounded timeout.
- `fixture-failures-before-retention.json` records the initial unresolved virtual import and interrupted unbounded capture wait; neither is an accepted UI run.

Follow-up runs corrected functional routing/focus tests and their fixture assumptions; the Meet design was not repeatedly polished. No budgets or product gates were changed to make tests green.

Decision: use explicit private setup mode rather than operator routing, unrelated claim review or a new activation control in Meet. Reversal condition: a tested unified Studio replaces the duplicate entry routing, or actual owner observation shows this explicit transition obstructs first private use. Until then maintain the exact two-entry negative controls and current server readiness authority.

## SHA-256 freeze

| File | SHA-256 |
| --- | --- |
| src/studio/ExpertConversation.tsx | e5d2b3a4db6edff7624f279fe228e59260293dc8ea504119b6886fdfe003ca13 |
| src/studio/CloneExperience.tsx (isolated base plus one prop) | dd2488c6e41f0b7988171e8edd17f4715ead09bf2efc30ded07b7ead8d68c051 |
| src/studio/conversationSetupNavigation.ts | 29a230905e86aeccf822d625b6ee62e504cf6081639ef70dfa3f6f68ecd469cd |
| src/studio/conversation-setup.css | 598cf553468829bf5279a6eb49f28ba851387e575d0549d511559a949f628ad7 |
| src/studio/main.tsx | 0a5dda958249d4a8abe2a5f747b2148e76945bcdb80a82c5d8ac1d7f6ff4e9c4 |
| src/creatorStudio/main.tsx | b24860fa4cc7c22e80b8e7632b52e3bba4dd38bc403a0060ccce4b830681cb15 |
| src/creatorStudio/RuntimeGate.tsx | 72a64586ee6413cd1df97a6f68677ba1f4b4f9270a91e129b74d77a962e1fbf8 |
| evals/conversation-setup.mjs | 38eefde0f1bddef4d6165f341f1d5d49d3117f7e042709b98386b55b57ef1b10 |
| evals/conversation-setup-ui.mjs | 970e0d8c747458fe83f0468e1f50de781b41bea67a72e400612809b9db71b152 |
