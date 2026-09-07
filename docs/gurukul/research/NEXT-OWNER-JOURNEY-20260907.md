# Remaining creator journey: source audit, 7 September 2026

This is a build plan, not an acceptance report. The product remains expert-first: Feed it, Meet it, Deploy it. Read current context before using historical claims of completion.

## What the current slice actually enables

An owner can save a private, incomplete TeacherSheet before runtime agent creation. Suggested phrases can be inspected with bounded source excerpts before voice readiness. Inspection does not apply them. Initial replica hydration now preserves the destination carried through sign-in. Database and component checks are recorded separately from a complete authenticated journey.

## 1. Apply selected suggestions and reverse their source effects

`src/studio/ContextProposalReview.tsx` is deliberately read-only. `_channel-ingest.js::applyIngestRunDelta` marks a run; it does not merge an owned TeacherSheet. Add a dedicated authoring service rather than giving the channel miner publication authority.

Request shape: exact run/proposal hash, selected candidate IDs, expected draft snapshot and idempotency commitment. Accept only `context-sheet-candidates/v1` initially. Client-supplied replacement fragments and whole merged sheets are not approval input.

Revalidate current item/run, canonical text, owner attribution and every citation. The preview's validation is not a durable approval lease. Re-mining can change `owner_speaker` while retaining a previous proposal. `citationViolations` alone does not establish current speaker or exact item membership.

Reuse `mergeDeltaIntoSheet` only after checking normalization. `mirrorClean` can truncate to64string units and normalize existing phrases. Do not approve one fragment and silently store a different one. Distinguish existing duplicate, capacity exhaustion and malformed draft instead of treating all null merges alike.

One SQL statement must lock and validate scoped source/item/run/draft, write the exact draft, then write a durable decision receipt from successful RETURNING rows. Bind approver, source/proposal/request commitments, chosen and inserted candidate IDs, applied sheet and resulting draft hash. Historical `applied` rows without receipts remain unconfirmed. An absent-draft race must refuse rather than overwrite another first save. Identical retries return the same receipt; changed selection/snapshot conflicts.

Source removal must reverse applied content before source-derived proposal bytes are scrubbed. Cover all three callers: `_context-locker.js::removeContextItem`, `_review-queue.js` remove_source, and `_replica-source-erasure.js` canonical source deletion. A single `applied_sheet_id` is insufficient after a draft is copied. Preserve lineage across copies or define/test a conservative owner-scoped reversal. The current source-proposal scrub work does not implement this future applied-content reversal.

Acceptance: selected subset and exact draft bytes, duplicate/capacity distinction, stale proposal/speaker, forged citation, concurrent edit/first save/approval, uncertain-response retry, all removal races, copied draft reversal, unrelated fields unchanged. Real EXPLAIN and concurrent SQL, then owner phone/desktop flow.

## 2. Bind legitimate publication consent

`_teacher-sheet-draft.js` requires stored `consent_artifact_id`; source audit found no normal API writer binding the appropriate publication receipt to that column. Source/model consent is a different record. Never fabricate an ID to open publication.

Implement exact owner, sheet revision, intended scope and valid receipt binding through an explicit owner action. Publication snapshot CAS already compares JSON/status/receipt/version; preserve it. Test forged/cross-owner/expired/revoked receipts and draft changes after consent. A synthetic SQL marker proves a negative boundary only.

## 3. Adopt the private draft after legitimate activation

`_replica-runtime.js::activateOwnedRuntime` now calls exact owned-draft adoption after qualified activation. It changes only the draft agent binding, with no publication or consent substitution. Root verified 12 actual isolated SQL groups, including witnessed first-save races, revocation and retries, with zero remaining fixtures. The qualification evidence was synthetic; ordinary owner activation still needs the identity and voice prerequisites below.

## 4. Connect corrections to an owner-reviewed candidate

`TurnFeedback.tsx` stores corrections, but the dataset endpoint `api/replica-feedback-dataset.js` has no ordinary `src` or `scripts` caller. Add an explicit owner action that builds a revision-bound dataset and exposes actual readiness. Preserve insufficient-evidence states; creating a dataset does not activate a persona or demonstrate improvement. Later candidate comparison and explicit acceptance remain distinct operations.

## 5. Finish the enrollment and voice prerequisites

Strict identity remains disabled. Existing broker routing, independent document review and composite liveness are not a working deployed chain. Issued speech contracts and byte adapters do not independently establish age, identity or a usable first comparison reference. Follow the retained identity plans rather than bypassing the ordinary voice predicates.

After legitimate identity and reference authority exist, run exact pinned Azure voice variants through the matched Hindi/Indian-English/Hinglish protocol in the quality brief. No current owner likeness or competitive superiority is accepted.

## Cross-cutting answer quality

`ROOM_REPLY_TEXT_PROFILE=expert_answer` offers bounded parsed-segment preservation; the normal setting remains unset. It does not repair source grounding, all formatting or language. `ROOM_REPLY_LANGUAGE_POLICY` also remains unset after failed comparisons. The integrated `ROOM_EXPERT_TEXT_PROFILE=lean_v1` candidate preserves typed teaching material, source boundaries and private continuity while removing companion invention. Its six fresh Azure calls passed transport contracts but failed factual and list-content acceptance. It remains unset. See EXPERT-LEAN-TEXT-TRIAL-20260907.json. Diagnose deterministic delivery loss offline; future model trials need new cases.

## Product validation after the working loop

Recruit a narrow expert pilot only after the complete loop is runnable. Measure time saved, unsupported answers, correction effort, repeat client use and willingness to pay. Record cold/warm latency, retry rate and cost per accepted session. Paid conversion, margin and defensibility are hypotheses until observed. No outreach or paid acquisition has been performed by this audit.
