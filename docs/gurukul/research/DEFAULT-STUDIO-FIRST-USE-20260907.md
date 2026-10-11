# Default Studio first-use repair, 2026-09-07

## Contract and scope

Candidate starts at checkpoint24 3db85f82f9491322a8db2a62556cf39be8234937, with exact staging25 Feed-return prerequisites recorded in ROOT scratchpad/expert-tools/first-use26-prerequisites.json and prerequisite commit4dcede9a. Production changes are personal StudioApp.tsx, CloneExperience.tsx and a bounded read-state rule in clone-experience.css. Creator Studio, publication, identity, voice, SQL, provider and private-rehearsal API bytes are unchanged.

Ordinary bare /studio uses main.tsx -> personalMain.tsx -> personal StudioApp -> CloneExperience. The API really creates consent_pending, then returns {consents} from a separate source grant. The UI does not invent lifecycle readiness. Workspace and source-consent reads now distinguish unresolved/error from confirmed absence. Explicit retry is a read; it never creates or grants. Consent mutation start and settlement invalidate older reads, and current actor/token/replica/revision refuse stale completions. Account generation survives legitimate refresh but changes on sign-out/account transition. This lets accepted fresh-token creation finish Files while old callbacks cannot navigate or sign out a newer session. The scope values stay in component memory, including the current token; no new browser storage is introduced.

Only the confirmed new-creation agreement opens existing Files. Failed grant retains the actual selected workspace; readback followed by another explicit agreement retries consent on that same ID. Returning owners keep their prior navigation and saved request handles. The voice alternative remains explicit and existing gates remain unchanged. Source-use and the three exact per-question inference statements stay separate. Unknown-authorship file upload remains unknown/extracted until My writing; only its current eligible source can navigate to a private question. No inferred personal facts or training claim.

## Executed evidence

Mounted result: scratchpad/first-use-private-flow/1788802689317/result.json, completed 2026-09-07T17:39:13.459Z. One bounded18-group successful batch, using actual studio.html/main/personalMain, public clients and localhost synthetic HTTP at390/1440. No seeded mode/replica/view/source/draft/consent at entry. Actual request-shape create201 consent_pending, grant201 {consents}, default unknown extracted document, explicit remine to mined, empty draft read, explicit minimum draft save and exact source-bound question all execute. One synthetic ask per width; saved result reload adds zero asks. Desktop flow deliberately refreshes its token before creating/granting. No actual auth, database, storage extraction or model call, no owner-quality acceptance. Server/page unexpected errors0.

Six retained-old outcomes: two unresolved-account agreements, two delayed empty-consent overwrites after successful grant, and two slow-grant recorder-first outcomes. The final measured slow-grant heading was Say something only you would say at both widths. The recorder/repeated-agreement predicate accepts only these named old failures, never arbitrary errors or timeout.

Actual source-function controls now18: refreshed-token list and selected read failures plus old spinner predicates; mounted/unmounted continuation with old history-write negative; legitimate refresh versus changed account generation; stale old401 error callback refusal and its old negative; same credentials after sign-out/re-entry success refusal and old predicate; exact receipt actor/replica/revision settlement. No SQL mocked-type claim. Final tiny added post-create account-generation predicate came after the18 mounted run; the final two source controls execute it, and parent merged full release must cover final source. Do not describe the prior mounted hashes as exact final StudioApp bytes.

Focus measured without fixture .focus(): explicit new Files navigation reaches context-locker-title H2, source Test action reaches ptr-title H1 at both widths. Action-triggered heading focus waits for actual lazy destination and does not run on unrelated reads. Authorship-row replacement, draft-save and answer completion still leave BODY focused; recorded limitations, not blanket focus acceptance. Screenshots answer-390.png and answer-1440.png retained with result.

Final forced TypeScript/copy/incumbent source checks are reported in handoff after completion. Full release not run in this isolate. Recommend parent registry entries first-use-private-flow-source -> first-use-private-flow/source.mjs and first-use-private-flow-ui -> first-use-private-flow/run.mjs; root owns combined registry edits.

## Retained failures and repairs

- scratchpad\first-use-private-flow\1788802149530\failure.json: 1 groups completed; locator.click: Timeout 12000ms exceeded.
- scratchpad\first-use-private-flow\1788802241025\failure.json: 2 groups completed; locator.waitFor: Timeout 12000ms exceeded.
- scratchpad\first-use-private-flow\1788802499213\failure.json: 5 groups completed; locator.waitFor: Timeout 12000ms exceeded.

First browser failure was real390 pointer obstruction: the fixed generic error toast covered retry. Dedicated centered read/error panels now suppress the duplicate toast only while blocked, keeping retry reachable. Subsequent fixture failures exposed uncontrolled grant/list ordering and an overly narrow recorder-only old expectation. Final fixture explicitly holds grant until an empty consent request arrives and retains exact old outcome. Independent source review found refreshed-token error swallowing, late unmounted navigation, refreshed-token success rejection, and stale old401 side effects; all repaired with bounded executed controls. Initial CRLF editing mismatch/type errors retained in context. Nothing about these synthetic failures is actual Azure/auth/SQL evidence.

## Reversal condition and remaining limits

Reverse if stale scope replaces a receipt, read failure authorizes mutation, accepted refresh loses first-source navigation, old completion navigates/signs out another account, or returning pending requests are lost. Existing list clients still coerce malformed successful missing arrays to []; honest state evidence here covers actual shaped successful envelopes and transport/API failures, not a newly strict malformed-success validator. Focus continuity inside material actions remains a separate small usability opportunity. No continuous memory, publication, voice or source-authority changes.
