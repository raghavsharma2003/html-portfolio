# Next expert journey gaps (2026-09-07)

Scope: source-only review of `scratchpad/private-rehearsal-combined` (frozen combined candidate, base c56cadfe) and current `scratchpad/expert-integration` Studio callers. Reviewed against DESIGN-LAW's truthful actions and Feed -> Meet -> Deploy journey, with the previously applied Impeccable craft-floor/harden guidance. No browser, model, network, database or new test execution. These are source-derived findings, not measured usability or voice-quality acceptance. Cancellation, successor requests and restored-source attribution are deliberately excluded because their fixes are already in flight.

## 1. A valid minimal private draft can break the full Meet editor

Trigger: an owner saves the supported private rehearsal draft containing name, identityWho and subjectDomain, then enters the teacher workspace and opens Meet. The private API intentionally persists incomplete drafts. The creator reader types that raw body as a complete TeacherSheet; the editor assumes all arrays exist.

Actual chain:
- `src/studio/PrivateTextRehearsal.tsx:182` offers the three-field private editor; `src/studio/privateTextRehearsalApi.ts:103` saves through the existing draft endpoint.
- `api/_teacher-sheet-draft.js:170` returns `row.sheet` without filling fields. Its save operation explicitly stores submitted incomplete drafts, even when validation fails.
- `src/creatorStudio/teacherSheetApi.ts:18` declares the returned draft a full TeacherSheet.
- `src/creatorStudio/StudioApp.tsx:1892` reads that draft, `:1901` stores it directly, and `:2426` prefers any non-null draft over the seed. `:1085` passes it into TeacherSheetStudio on Meet.
- `src/creatorStudio/TeacherSheetStudio.tsx:101` calls `sheet.subjectStrands.map` unconditionally. Other controls assume boardVerbalisms, analogyBank, commonMistakeBank and doubt ladder arrays exist.

Outcome: this source path attempts `.map` on an absent value before the owner can edit their saved draft. This audit did not mount/reproduce the exception. Both desktop and mobile use this component, so there is no alternate small-screen recovery in the caller.

Smallest implementation: normalize the editable UI projection of an incomplete draft at the reader/editor boundary. Use empty structural arrays/strings only where controls need them; preserve submitted and unknown fields. Do not seed identity, consent, provenance, runtime binding or publishing readiness. Missing required values must remain visibly missing and fail ordinary validation. Do not auto-save normalization on load.

Verification: mount the actual editor with the exact three-field API body, retain the old-code exception as a negative control, then prove Meet renders and edits without losing unrelated fields. Cover existing complete sheets, no implicit save, and failed publish validation for the incomplete draft. Use one bounded phone/desktop check when implementation is ready.

## 2. The first private answer has no explicit correction-to-next-test path

Trigger: the private answer uses the wrong teaching sequence or phrasing, and the owner wants to correct it and try again. The result currently supports reading, checking, removing or preparing another question, but does not capture an instruction for the next private test.

Actual chain:
- `src/studio/PrivateTextRehearsal.tsx:169` renders the saved result and receipt actions; its editor around `:182` exposes only name, identity and subject.
- `src/engine/privateExpertRehearsal.ts:22` already projects fields such as explanationOrder, workedExamplePattern and firstMoveOnDoubt, but the private result has no caller that edits them.
- `api/_private-text-rehearsal.js:51` compiles the current draft, selected evidence and question; it does not consume a correction dataset.
- `src/studio/ExpertConversation.tsx:237` mounts TurnFeedback for the separate runtime dialogue turn, followed by FeedbackDatasetPanel. `api/_replica-feedback.js:94` and `:153` require a real dialogue turn and current runtime authority. A rehearsal request ID is not that turn ID.
- FeedbackDatasetPanel correctly says preparing a set does not change the AI. Treating this preparation as an applied improvement would be false.

Outcome: the owner can ask again, but cannot close the core Meet loop for the initial private test. This is separate from the in-flight successor-request controls. There is no evidence here that the next answer becomes better merely by preparing another test.

Smallest implementation: add an explicit result-bound action to edit a narrowly chosen existing private teaching field, such as explanation order, and save it to the private draft. Bind the edit to the current replica and reviewed draft version/content; add a compare-and-swap save contract if the existing save cannot enforce that. Confirm the saved state, refetch private readiness, then let the owner explicitly prepare and run a new question with its normal attestations and budget. Use factual-source editing for factual corrections; do not silently promote free-form style guidance into factual evidence. Label the outcome 'Saved to private draft', not 'Your AI has learned'. A richer correction record should use private-request authority rather than bypassing active-runtime feedback checks.

Verification: actual completed result -> explicit edit/save -> new draft hash -> next compiler input contains the changed supported field. Negative controls: no action means zero writes; stale replica/draft/request refuses; default/published persona and global rules remain unchanged; no inference without a new explicit action. Compare answers only as test output, not accepted quality improvement.

## 3. Room publication directs owners to a sheet publication action with no UI caller

Trigger: the owner opens distribution from the expert workspace and tries to publish a Room. The Room gate requires a published sheet and sends the owner back to Meet, but Meet only saves drafts.

Actual chain:
- `src/studio/ExpertSharePanel.tsx` opens `expertWorkspaceUrl(replicaId, 'share', ...)`; `src/studio/workspaceNavigation.ts:2` preserves replica/locale and targets teacher mode, Deploy, Share.
- `src/creatorStudio/StudioApp.tsx:1226` renders Deploy and `:1294` mounts RoomStudio.
- `api/_room-publish.js:596` reports the sheet is not published; `:597` tells the owner to publish the sheet on Meet and return.
- `src/creatorStudio/TeacherSheetStudio.tsx:149` only saves a draft. The counterpart `src/studio/TeacherSheetStudio.tsx:354` explicitly says saving does not publish.
- `rg 'publishTeacherSheet\\(' src` in the combined candidate finds only the two API definitions (`src/studio/teacherSheetApi.ts:71` and `src/creatorStudio/teacherSheetApi.ts:71`), no caller.
- The backend bound publish operation additionally requires an actual agent binding and recorded consent; an unbound private draft must not be treated as publishable.

Outcome: an otherwise eligible owner has a circular handoff rather than an actionable publication step. The same destination is used on mobile and desktop. Private rehearsal success does not resolve this authority gap, and real voice acceptance is still unavailable.

Smallest implementation: expose the existing explicit sheet publication operation in the owning Meet editor, after reviewing the current saved sheet. Keep server floor, consent, binding and other publication checks authoritative; map refusals to the existing actionable fields/steps. Show success only after a verified published receipt/readback, then return to the exact replica/locale Room destination. Distinguish publishing the sheet, activating a runtime, and publishing a Room; none should happen implicitly as a side effect of another.

Verification: mounted full teacher shell with synthetic owner-scoped responses: incomplete/unbound draft refusal leaves the draft editable; a valid synthetic publication receipt followed by published readback unlocks only the corresponding next Room action. Cover stale/uncertain POST readback, duplicate tap and another replica response. Actual SQL/authority validation remains a separate real-development check, not a mock claim.

## Decision and limits

Prioritize the minimal-draft crash because it blocks an already-authorized first-use path. Then close an explicit private correction loop; keep publication as a separate authority-preserving slice. Reverse this ordering if mounted reproduction disproves the draft path or a live caller omitted from these inspected source trees already closes it. Rejected shortcuts: seed a complete identity to prevent the crash; treat dataset preparation as learned behavior; pass rehearsal IDs to runtime feedback; relax voice/consent checks to make Deploy green. No new measured quality, latency or voice-likeness claim is made by this report.
