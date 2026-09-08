# The correction loop stops before candidate construction

Source audit, 2026-09-08, release34 base `5ade4ea95209b15b0268338128514401be41b710`. No browser, build, test, database or model execution was performed. Existing release34 verification owns those resources.

An owner can save and reopen a private correction. That correction does **not** currently become an improved candidate they can review and approve. This is the highest-value missing bridge in the audited loop. It is not a missing feedback form, and appending the corrected answer to the next prompt would contradict both the intended learning boundary and retained failed experiments.

## Actual caller map

| Step | Existing caller and implementation | What it establishes |
| --- | --- | --- |
| Private answer | `src/studio/ExpertConversation.tsx` → `createDialogueTurn` → `api/_replica-dialogue.js:generateOwnedDialogue` | Uses current approved Person Model and calibration, private relationship state, session history and explicitly selected continuity. |
| Owner correction | `ExpertConversation` mounts `TurnFeedback`; `useTurnFeedbackEditor` calls `feedbackApi` → `api/replica-feedback.js` → `recordOwnedTurnFeedback` | Owner-authenticated, revision-bound correction evidence, encrypted wording, explicit replacement/removal, stale-write refusal. Save does not update the persona. |
| Review saved evidence | `ExpertConversation` mounts `FeedbackDatasetPanel`; `onSaved` increments `feedbackRevision` | Refreshes the current correction snapshot after a save. |
| Prepare | `FeedbackDatasetPanel.prepare` → `prepareFeedbackDataset` → `api/replica-feedback-dataset.js` → `buildOwnedFeedbackDataset` | Explicit action freezes a source/version-bound **draft manifest**, with session-separated preparation and evaluation. No training or activation is claimed. |
| Construct candidate | `loadOwnedFeedbackLearningExample` and `registerOwnedCandidate` exist | **No production caller found.** They are definitions plus eval use, not a functioning construction pipeline. |
| Prepare blind comparisons | `persistCandidateEvaluationPackage` exists | **No production caller found.** Encrypted, committed comparison assets have infrastructure but no running materializer. |
| Owner judges | `StudioApp.tsx` mounts `CandidateEvaluationLab` → `candidateEvalApi` → `api/replica-candidate-eval.js` | Existing status/judge route can consume a prepared package. It must be reused, not replaced with a second A/B surface. |
| Qualify | `loadCandidateOwnerObservations` and `recordOwnedCandidateQualification` exist | **No production caller found.** A qualification pass changes candidate status only, not the active runtime. |
| Approve and next version | Existing runtime activation binds approved profile/calibration/genome | No audited correction-candidate promotion flow issues a new capability from this dataset and candidate. Existing docs explicitly retain promotion as unfinished. |

The search covered `api/`, `src/`, `scripts/` and then repository references excluding context and scratchpad. Five bridge functions above have definitions but no production invocation in those trees. Eval references establish that functions were exercised by existing suites, not that those suites passed in this audit. This is a source finding, not a claim about external services or unseen branches.

## Do not lose the working smaller loop

`PrivateTextRehearsal` already mounts `PrivateTeachingRefinement` after a completed, settled private test. An explicit **Save guidance** action calls `savePrivateTeachingRefinement`, checks the source, request, consent, sheet hash and authority epoch, then changes only the private draft's `explanationOrder`. **Prepare another question** starts a fresh test against current draft authority. Reload after an uncertain save uses a read-only recovery marker rather than hiding the saved guidance or repeating inference.

This is a separate path from active `ExpertConversation` feedback. It is not evidence that arbitrary wording, memory, personality or voice corrections improve subsequent answers. Retained `saved-refinement-does-not-prove-adaptation-20260907` and `static-presentation-tail-does-not-establish-adaptation-20260907` explicitly record the distinction and failed actual-model behavior.

## Next bounded implementation

The first missing production caller is a **private candidate construction job consuming the reviewed dataset**, not a new approval button. Its input should be the immutable dataset, current baseline capability, exact source commitment and an explicit owner preparation request. It should use the existing learning-example reader only for the preparation split, record a concrete artifact/build commitment, and register the result through `registerOwnedCandidate`. Unknown model or billing outcomes must preserve the existing job identity and budget hold.

The construction mechanism still needs a falsifiable design decision: an evaluated structured policy compiler, or a genuinely trained adapter served on Azure. A raw correction-prompt tail is not an accepted implementation. Building a job that only returns a manifest would repeat the existing unfinished step under a new name. Therefore this audit does not add a fake candidate producer, change active runtime behavior, weaken qualification or invent a model success.

After a real candidate exists, reuse package encryption and the existing owner comparison UI. Qualification and explicit promotion are subsequent distinct actions. Promotion needs new immutable capability binding, source/revision freshness, revocation handling and rollback. Private corrections must not become customer relationship memories or published source material by implication.

## Validation before claiming the loop complete

1. Source integration and actual isolated SQL: exact dataset/baseline authority, latest correction revision, erased sources, concurrent revocation, immutable artifact and idempotent job behavior. Offline mocks do not prove SQL.
2. Held-out separation: no evaluation example reaches candidate construction; disjoint conversation assignments remain frozen; unsafe evidence cannot train the candidate.
3. Actual bounded Azure construction: record artifact, model, request and usage provenance, including failed and unknown outcomes. A fixture candidate does not qualify.
4. Browser at 390 and 1440 pixels: save/reopen → reviewed preparation → real job states → blind comparison → explicit approval. Cancel, stale data, account switch and lost-response recovery must remain usable without duplicate writes.
5. Runtime negative control: saving, preparing, judging and qualifying each leave active capability unchanged. Only the authorized promotion action changes it. A later rollback restores the earlier capability without rewriting historical turns.
6. Fresh owner-held-out English, Hindi and Hinglish cases: measure preference and task correctness against the frozen baseline, with false-memory, privacy, latency and cost controls. Report operational completion separately from improved fidelity.

## Concrete request preparation added after the audit

`api/_replica-correction-request.js` prepares a held Azure structured request from a frozen dataset and the exact complete training preference set. It reuses the existing calibration strategy catalog and cost estimator. The model may propose only known strategy IDs supported by exact training feedback IDs, or abstain. It cannot generate arbitrary persona instructions, owner votes, biography or memory. Validation requires three supporting examples from at least two sessions and rejects competing strategies for one scenario.

This is an explicitly **unrun proposal preparation slice**. It has no fetch, route, SQL, worker dispatch, candidate registration or active-runtime write. Its `dispatch_allowed` is always false. `evals/correction-strategy-request/run.mjs` is prepared but has not run during the release34 CPU reservation.

The concrete worker integration is:

1. Reload the reviewed dataset with current owner, replica, consent, capability and latest-revision/source authority. Do not treat a caller-supplied snapshot hash as persisted authorization. The existing learning-example reader supplies a structured-output response commitment; hashing reply text alone is wrong.
2. Read **only** the complete eligible training preference split through `loadOwnedFeedbackLearningExample`, then prepare the request. Over 120 pairs or 64,000 request-message UTF-8 bytes refuses whole; do not silently sample until a separate split/sampling protocol is reviewed.
3. Implement the fixed-schema Azure extraction adapter with the same bounded body, deadline, measured usage, redirect refusal and cancellation semantics as the existing dialogue adapter. A response-format schema change means the dialogue adapter cannot simply be reused unchanged. Azure deployment compatibility remains untested.
4. Use the existing `claim_extraction` budget operation for behavioral-shape extraction, with a distinct request identity. Reserve → current-authority recheck → begin once → response validation → measured settlement. Include schema framing in the input reservation. If actual existing ledger binding cannot express this adapter, add an explicitly reviewed operation rather than laundering the call as a user dialogue.
5. Validate output, then render a **private experimental policy artifact**, retaining the baseline Person Model and platform constraints. Existing `compileReplicaRuntimeCore` labels calibration as owner-calibrated, so inferred choices must not be passed as forged owner preferences. A distinct candidate rendering branch with accurate provenance is required.
6. Store the concrete artifact privately and register its exact artifact/base/build hashes through `registerOwnedCandidate`. Source/consent withdrawal between construction and registration must invalidate the candidate. Registration must not activate it.
7. Materialize baseline/candidate responses using the existing held-out package builder, existing owner judgment UI and qualification functions. A signed, explicit promotion action remains separate and must create a new immutable runtime capability with rollback.

The 30-pair/6-session preparation floor comes from existing dataset readiness. Three-example/two-session proposal support and the 120-pair/64 KB ceiling are new conservative experimental bounds, not measured optimal settings. Reverse them only through a reviewed sampling/coverage design or controlled owner-held-out evidence. These counts do not establish that a proposed shape is true, useful, or faithful.

Existing implementations are preserved for reuse; the missing authenticated construction-and-promotion pipeline remains explicitly open.
