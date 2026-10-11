# Creator journey source audit, 2026-10-09

## Scope and evidence boundary

This audit is pinned to clean baseline `ebe16cc061f1db02b2ba2922a96e3dc3e033d07f`. Other agents began editing the shared checkout during the audit, so every finding below was re-read with `git show HEAD:<path>` and does not depend on their working-tree changes. The in-flight saved-vibe backend repair and generic-person quick-draft frontend repair are excluded.

This is a source and bounded local-test audit. It did not use a real account, send an OTP, upload owner media, mutate a cloud resource, call a model, or exercise live PostgreSQL. The September 30 handoff remains the live boundary: the protected preview renders sign-in and rejects unauthenticated API calls, while a genuine signed-in creator journey, fresh private answer, voice playback, and sharing visit remain unverified.

The following focused tests were run:

- `node evals/deploy-studio/run.mjs`: 24 passed, 0 failed.
- `node evals/studio-auth-link-code/run.mjs`: 11 source controls plus 2 navigation-persistence controls passed.
- `node evals/private-text-rehearsal/run.mjs`: returned clean, but relevant files had acquired concurrent working-tree edits by then, so this run is not baseline evidence and is not used to close any finding.

The first two suites are synthetic/source checks. They do not cover the redirect, bare-return, cross-browser discovery, person-sheet publication, or blocker-destination cases below.

## End-to-end trace

| Stage | Shipping caller and durable authority | Exact eligibility and recovery behavior |
| --- | --- | --- |
| Sign in | `PersonalAuthGate` calls `/api/account` for `send_otp`, `verify_otp`, and `google_url`; `restoreSession` refreshes saved tokens. | Manual OTP remains in the same tab. Email-link completion can wake the original waiting tab through the `storage`/focus listeners. Full-page Google and email-link destinations are hard-coded to bare `/studio`, which creates finding 1. |
| New workspace | `StudioApp.handleBeginClone` calls `createReplica`, then grants enrollment consent. | Creation uses an owner-scoped durable creation UUID before the POST and clears it only after a confirmed replica response (`src/studio/StudioApp.tsx:2323-2365`). If consent fails after creation, the empty clone stays selected and the next attempt retries consent rather than creating again. |
| Record/upload | `CloneExperience.submitRecording` writes a per-replica saga before authorizing `/api/replica-source`, uploads to the signed URL, finalizes the same source, then refreshes server rows (`src/studio/CloneExperience.tsx:1194-1326`). | Client intent IDs make retries idempotent; the authoritative source row exists server-side once authorization succeeds. Failed transfer retains the in-memory Blob for same-tab retry. A reload cannot restore that Blob, but the source/saga recovery path can check the server receipt and require a new recording instead of silently resending. No real browser-to-Azure PUT was run in this audit. |
| Persisted text sources | `ContextLockerPanel` posts files/links to `/api/context-items`, reloads the saved locker, and reports eligible counts. `SourcesStudio` reads the unified `/api/replica-source` overview. | Private rehearsal accepts only an extracted/mined text, Markdown, PDF, or DOCX item marked as the owner's writing, backed by a ready source whose hash matches the canonical text and complete evidence spans (`api/_private-text-rehearsal-store.js:77-103`). Pending/refused/routed items remain visible but ineligible. |
| Private rehearsal | `PrivateTextRehearsal` reads readiness, persists a UUID in `rehearsal_request`, then POSTs `ask` to `/api/replica-text-rehearsal`. | The server requires an owned, non-stopped replica; a saved person sheet with `name` and `identityWho` (teacher sheets also need a supported subject); an eligible source; live capture/storage account attestations; exact snapshot/evidence hashes; and three per-question attestations. Provider/budget preflight can turn otherwise-ready state into platform-unavailable. Result and withdrawal reads require the exact request UUID, which creates finding 2. |
| Profile save/correction | `HumanOsStudio` saves a `sheetKind: "person"` draft through `/api/teacher-sheet`; `TeacherSheetPublication` performs the separate publication ceremony. The parent refreshes runtime after a confirmed save. | Existing rehearsal results are re-read against current authority; if the sheet or source changed, the old result becomes blocked rather than being treated as current. A new root question can then be prepared. The known saved-vibe and quick-draft issues are outside this report. |
| Sharing | `ExpertSharePanel` chooses text-material publication before voice readiness and Room publication after voice readiness. | Text-material publication currently requires a teaching subject even for a person workspace, creating finding 3. Room publication requires active runtime, readiness at least 70 overall and 55 in every part, and a published sheet/disclosure; its repair action is misrouted, creating finding 4. |
| Return visit / another tab | Replica and view are encoded in the URL; auth tokens and voice saga use local storage; activity/readiness poll on pending work and resume on focus. | Exact restoration works only while the URL and local handles survive. Full-page auth drops the route, and private rehearsal has no owner/replica discovery read when its request UUID is absent. |

## Highest-impact remaining gaps

### 1. P1: full-page sign-in loses the exact workspace and recovery handle

The signed-out gate always sends email links to `"/studio"` (`src/studio/PersonalAuthGate.tsx:95-100`) and calls Google without a return-path argument (`src/studio/PersonalAuthGate.tsx:200-211`). Google itself hard-codes `window.location.origin + "/studio"` (`src/studio/studioAuth.ts:136-140`). This drops `replica`, `view`, `enrichView`, and `rehearsal_request` on the full-page round trip.

The apparent resume mechanism does not survive that navigation. `StudioApp` keeps `AuthResumeIntent` only in a React ref/state pair (`src/studio/StudioApp.tsx:1597-1618`, `1690-1704`), while the fresh callback entry always mounts `PersonalAuthGate` with `resumeIntent={null}` (`src/studio/PersonalStudioEntry.tsx:78`). The existing auth test proves same-page state wiring, not provider-return continuity.

Impact: a session-expired creator who chooses Google can return to the first replica rather than the clone and screen they were using. If the dropped URL carried a private rehearsal request, this also removes the only client recovery handle for that durable request.

Minimal repair: before any full-page auth redirect, save a one-use, allowlisted resume envelope containing only `replica`, `view`, `enrichView`, `step`, and `rehearsal_request`. Restore it after a successful callback, validate the replica through the owned list, then delete it. Keep the provider callback at bare `/studio`; the repository already rejects relying on OAuth allow-list behavior to preserve arbitrary query strings.

### 2. P1: a durable private request cannot be discovered after its UUID leaves the URL

`PrivateTextRehearsal` reads the active request only from `?replica=<id>&rehearsal_request=<uuid>` and initializes component state from that URL (`src/studio/PrivateTextRehearsal.tsx:53-64`, `99`). It correctly writes the UUID before sending a question, so an uncertain response is safe in the same URL.

The API, however, exposes only `readiness`, `result(request_id)`, `withdraw(request_id)`, and `ask` (`api/_private-text-rehearsal.js:35-47`; client calls at `src/studio/privateTextRehearsalApi.ts:93-117`). There is no read-only lookup for the latest unresolved/saved request by owner and replica. A new browser, a bare `/studio` return, cleared history, or finding 1's auth redirect therefore presents an empty composer even though an admitted, dispatched, uncertain, complete, or billed server row may still exist.

Impact: the product can retain a private question/answer or unresolved spend that the owner cannot find, check, or withdraw without recovering the opaque URL.

Minimal repair: add an owner-and-replica-scoped read-only discovery operation that returns at most the newest non-withdrawn request ID and state. On rehearsal mount, call it only when the URL lacks a valid handle, put the discovered UUID into the URL, and read status. It must never dispatch or retry generation automatically. This is the same recovery shape already used for the private voice run.

### 3. P1: the generic text-first Share door opens a teacher-only publication contract

When voice is not ready, `ExpertSharePanel` deliberately mounts `MaterialSharePanel` (`src/studio/ExpertSharePanel.tsx:48-61`). That panel is reachable from the generic personal workspace, but the server requires every selected draft to contain `name` and `subjectDomain`, with the subject restricted to physics, chemistry, or maths (`api/_text-publication-source.js:46-55`). A HumanOS sheet is explicitly `sheetKind: "person"` (`src/studio/HumanOsStudio.tsx:88-106`) and does not require or naturally collect a teaching subject.

The recovery UI confirms the mismatch: it says the user needs a teaching profile and links to `mode=teacher` (`src/studio/publication/MaterialSharePanel.tsx:91`, `124-132`). A general creator can therefore follow the visible Share path, select their saved person profile, and never satisfy the publication predicate without switching products and inventing a school subject.

Impact: text-ready personal creators are offered a dead sharing workflow before voice is ready.

Minimal repair: branch on sheet kind before presenting this surface. Until a person-publication projection and consent contract exists, show an honest "voice Room required for personal sharing" blocker and a route back to voice setup. Do not send a person into teacher mode or fabricate `subjectDomain`.

### 4. P1: the Room publication blocker sends profile work to Corrections instead of the profile editor

The Room server correctly names a missing published disclosure as `room_disclosure_not_approved` and anchors it at `#teacher-sheet-studio` (`api/_room-publish.js:621-627`). The actual person-sheet publication control exists in `HumanOsStudio` through `TeacherSheetPublication` (`src/studio/HumanOsStudio.tsx:589-599`).

In the personal shell, though, `ExpertSharePanel` receives `onReview={() => chooseRoom("evolve")}` (`src/studio/CloneExperience.tsx:1601`). `DeployStudio` uses that callback for both its "Review profile" banner and every Room blocker mapped to Meet (`src/studio/DeployStudio.tsx:134-140`, `174-180`, `193-198`). The `evolve` room mounts `PersonModelStudio`, while the editable/publishable person profile is `navigateWorkspace("personality")` -> `enrichView="humanos"` (`src/studio/CloneExperience.tsx:1430-1443`, `1606-1607`). The primary banner also listens on `onPointerDown`, so keyboard activation does not invoke it.

Impact: a voice-ready creator blocked only by an unpublished person sheet is told to review the profile but lands on claim corrections, where the blocker cannot be cleared.

Minimal repair: pass an explicit `onOpenProfile` callback from `CloneExperience` to `ExpertSharePanel`/`DeployStudio`, route the disclosure blocker and banner to `navigateWorkspace("personality")`, and use `onClick`. Keep readiness blockers mapped to their own destination rather than collapsing every Meet blocker into Corrections.

## What did not produce another top finding

The baseline has real callers for workspace creation, source authorization/finalization, context persistence, profile save/publication, private rehearsal, and both sharing APIs. The recording path persists intent before network mutation and refreshes server state after finalization; the text-source path reloads server rows after writes; readiness polling resumes on focus and separates owner action from platform work. These are source-level conclusions only. They do not convert the synthetic fixtures or prior unauthenticated live probes into evidence that OTP delivery, Azure upload, a private model answer, voice likeness, Room publication, or a follower return visit works in a real account.
