# Private result teaching refinement UI (2026-09-07)

Isolate codex/private-teaching-refinement-ui, base43230e5e94d2086bfaf8b974fbb041862736b28c. No integration, combined or prior frozen draft-editor edits. Backend is a separate frozen slice (private-teaching-refinement at6da75c33); root must integrate both contracts before this action is available.

## Actual user path

A completed settled private result exposes Adjust how I explain. The explicit tap reads only the explanationOrder field/current commitment via GET /api/teacher-sheet?op=private_refinement&replica_id=...&request_id=.... The small inline editor saves through POST op:private_refinement with replica_id,request_id,sheet_id,expected_sheet_hash,expected_private_text_epoch,field:explanationOrder and either value or clear:true with value absent. Empty typing never deletes. Original result/source are visible; no source text, answer, whole sheet, consent, runtime or published changes are sent by this operation.

Client accepts a confirmed saved receipt only when scope/sheet/field match, hash changes, epoch increases exactly1, saved:true, can_save:false and returned value matches the attempted value/removal. Input uses the backend's4000UTF16 bound and malformed scalar/control exclusions. Responses are similarly bounded.

Saving could not be confirmed is not success. All non400 failures require an explicit Check saved guidance GET before another save. If the actual field/hash/epoch changed to the attempted state, the message says the private draft currently contains it, not that a unique save receipt was recovered. If the reviewed old hash/epoch remain current and can_save:true, typed changes remain for an explicit retry. A different current draft becomes read-only and cannot be overwritten from the old result.

A verified changed draft clears cached readiness and attestations, selects the original result's exact sheet/source and refetches. Prepare another question remains an explicit separate action; then the ordinary new question, three attestations, budget path and durable request ID are unchanged. No save/read/mount automatically asks a question. The old completed result is historical output; it is not presented as an updated answer.

## Scope and behavior

New PrivateTeachingRefinement component and privateTeachingRefinementApi client; small actual caller in PrivateTextRehearsal; new scoped spacing CSS only. Session/request identity keys plus mounted/generation/abort checks reject late reads/saves after replica, token, request or unmount changes. Existing result actions stay disabled while the editor is open; Back remains available. No animations were added; layout and native controls use existing reduced-motion-safe presentation.

Only the new refinement section's stacked margins were reduced. On save, native details retain the current guidance and the next-question button is primary. The opener replacement initially lost focus. The final actual mount callback focuses the inline heading or next button only if the body has focus and the action's focus intent remains; later pointer, keyboard, wheel or touch activity cancels that intent. No guessed timer or observer is used.

## Verification and retained evidence

- Initial27groups: scratchpad/private-teaching-refinement/1788794061686/result.json. Exact43230e5e old completed result has no action. Actual parent/component/API wrappers with synthetic localhost read/write/ask responses. First390/1440edit/saved screenshots and focus JSON retained.
- Confirmation27groups: scratchpad/private-teaching-refinement/1788794218057/result.json. Three client groups and24mounted groups across390/1440. Actual save -> refreshed readiness -> unselected attestations -> fresh explicit next ask, commitment checks, no autoPOST, explicit removal, uncertain applied/unchanged readback, conflicts, failed/foreign read, malformed save receipt, late token/replica/request/unmount and keyboard save. Includes actual heading/next focus assertions and responsive overflow/reduced-motion environment checks.
- Separate focus-only5groups: scratchpad/private-teaching-refinement/1788794323864/result.json. Same3client groups plus2viewport groups; pending successful saves do not steal focus after pointer or keyboard interaction. No screenshots or production changes in this extra functional check. The final default runner now includes these2additional groups (29distinct total), but no single full29group run was performed here.
- Forced npx tsc -b --force --pretty false passed. Incumbent private-text-rehearsal --source-only passed11response+2navigation+14cancellation controls and retained old-client negative. Actual scanSource on all3changed TS/TSX files passed, runner syntax and diff checks passed.

The HTML fixture hosts the actual private result component with normal modern Studio tokens/styles, not full authenticated StudioApp. API and ask outputs are synthetic; no inference, real SQL, ownership authority or model-quality acceptance follows. The backend's separate14offline controls are reported by its owning agent, not rerun here. No current full release or full incumbent20mounted suite was run in this isolate.

## Rejection and reversal

The first asserted27groups passed, but inspection found BODY focus after replacing the opener and excessive saved-state spacing. That was incomplete focus coverage, not a clean UX acceptance. Both first artifacts remain intact. One bounded visual correction and confirmation followed, then a nonvisual focus-interaction check. Rejected shortcuts: save on text change, call existing whole-draft save, infer an applied correction from dataset preparation, retry a POST automatically, label field save as learned/trained, or reuse prior attestations for a new paid question.

Reverse the new action if its actual owner/result/source/version contract cannot be enforced, or if verified stale-scope/receipt controls fail. Do not compensate by removing gates or returning plausible success.

## Integration

Root owns registry integration. Register evals/private-teaching-refinement/run.mjs as a browser suite; port0 and Vite write:false avoid fixed-port/dist collisions, but CPU use should obey the performance isolation slot. Merge only the three new context entries and their two edges, not entire older journals. The runtime privateTextRehearsalApi/compiler/engine/default persona and all server files remain unchanged in this UI slice. No credentials/config were read or copied.
