# Teacher sheet edit races, 2026-09-07

Scope: checkpoint25 delta over exact combined25 prerequisites, isolated branch codex/teacher-sheet-edit-races from checkpoint24 3db85f82f9491322a8db2a62556cf39be8234937. Do not overwrite current integration context files with this isolate's older context.

Decision: every explicit draft edit advances a local revision. A Load response may replace raw draft state only if that revision and mounted request scope remain current. Otherwise newer edits stay and a short status explains that the saved draft was not loaded. Save/Load are mutually exclusive even before React commits disabled buttons. Success distinguishes the version submitted from newer edits; uncertain save is not labelled not saved. Nothing automatically retries or publishes. Existing savedLoadRevision advances on start and current settle, including ignored and failed loads.

Changes: two TeacherSheetStudio components and existing EN/HI copy. Four portable test fixture files embed the exact old editor source with verified SHA-256; no runtime git dependency. Existing disclosure CSS is a verified prerequisite, not a new race delta. No API, publication component or style change.

Evidence: 54 mounted groups, actual editors/API clients under StrictMode, synthetic loopback at 390/1440; eight old loss controls and eight corresponding fixed controls, with exact whole raw draft comparisons. Save revision, uncertain commit readback, no automatic retry, token/replica/unmount stale response, same-JSON normal/ignored/failed Load publication invalidation, native Enter/Space and overflow passed. Source hashes are bound in the result. Forced tsc, copy seven scopes/21 negative controls passed. No SQL, real auth, provider, full-shell or publication permission acceptance. Two retained editor screenshots inspected; no general design-superiority claim.

Rejections: exact old editors overwrite newer scalar edits and explicit malformed-list replacements. The old generic saved/not-saved claims are insufficient for concurrent editing/unknown transport outcomes. Initial fixture-only newline hashing, shell quoting and JSX closure failures remain retained, as does initial copy-interface typecheck failure. The final successful browser batch was the only run that entered Chromium.

Artifacts: scratchpad/editor-edit-races/1788802055713/result.json, 390-creator.png, 390-studio.png, 1440-creator.png, 1440-studio.png; scratchpad/editor-edit-races-batch*.log; editor-races-tsc-initial-failure.log, editor-races-tsc-final.log and editor-races-copy.log.

Reversal: reopen this choice if actual explicit edits escape the fence, unchanged raw fields change, stale scope can affect a new editor, or readback/publication invalidation regresses. Backend CAS and cross-client concurrent editing are outside this local editor fix.

Integration: register node evals/teacher-sheet-edit-races/run.mjs as a browser/build resource suite. Host uses real editor CSS but is intentionally not a substitute full Studio shell. Use manifest delta files only; merge context entries by ID.
