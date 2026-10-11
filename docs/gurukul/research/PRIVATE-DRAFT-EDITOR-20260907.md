# Private draft -> Meet editor repair (2026-09-07)

Isolate: codex/private-draft-editor, base c56cadfe72a20ee02781485752d8d67fcfc6fb21. No integration or combined-candidate edits.

## Problem and final change

A legitimate private draft containing only name, identityWho and subjectDomain reaches TeacherSheetStudio through the existing saved-draft reader. Both actual editor variants previously called subjectStrands.map before rendering and threw. The private API deliberately stores incomplete drafts; replacing them with seeded full personas would falsify saved owner content.

Both editors now accept partial draft props, retain the raw object in local state and derive a small memoized control view. Only displayed missing text/array fields get empty values. Subject, strictness and warmth show Not set (Hindi: अभी तय नहीं), not an implied first choice. Save sends the raw state plus only explicit edits, preserving unrelated and unknown properties. API save parameter types accept partial data to match the existing server contract. Read status types outside this component still have the incumbent complete-sheet type; this patch does not change every consumer or claim global malformed-object sanitization. The projection handles absent/null optional display values, not arbitrarily invalid array element types.

No changes to server validation, consent, authority, runtime binding, publication, source mining, the private rehearsal component, styles or the normal compiler. No auto-save on load. Incumbent editor copy/layout and async lifecycle outside this partial-data repair are unchanged; the full shell and broader provenance copy are not newly accepted by this component fixture.

## Evidence

- Actual mounted component/API tests: final26groups (13at390px,13at1440px). Both exact old c56cadfe components reproduce the map exception. Retained old JSON/screenshots alongside usable current screenshots.
- Three-field GET -> explicit Meet navigation -> current editor usable; no POST until explicit action. Untouched save keeps the exact three-field body and actual validateTeacherSheet rejects it for publication.
- Explicit load/edit preserves unknown nested fields, version and unrelated explanationOrder. Only edited scope/strictness/chapter/ladder fields are added. Untouched arrays, warmth, disclosure and consent are not inserted into saved data.
- Completely empty drafts keep subject/strictness/warmth unset and save as {} through native Enter activation. Existing complete demo fixture bodies round-trip unchanged in both editor variants.
- Hindi unset labels and horizontal fit checked at390/1440. Reviewed first four screenshots and final phone/desktop confirmation. This is a component host using actual creator CSS, not an injected claim of full StudioApp shell acceptance.
- Forced npx tsc -b --force --pretty false passed. Incumbent node evals/teachersheet.mjs passed129checks with an all-empty ignored example-derived config and fetch-throw preload. Two actual scanSource calls passed; runner syntax and git diff --check passed.

Final mounted artifacts: scratchpad/private-draft-editor/1788793068340/result.json, 390-usable.png, 1440-usable.png, 390-hindi.png, 1440-hindi.png, and four *-old.json/*.png negatives. First22group pass retained at1788792998287. The second batch adds an empty-draft control and installs response listeners before clicks; production differences were formatting/setter naming only after the first batch.

## Failures and rejection

An incidental attempt to edit the runner used a doubled worktree-relative path and changed nothing; the first22group run still passed. An incumbent teachersheet run reached its API import and stopped on missing ignored api/_config.js. Recorded scratchpad/private-draft-editor/teachersheet-first-config-missing.txt. Only an all-empty local fixture config was created; no secret file was read or copied. Successful129check log: scratchpad/private-draft-editor/teachersheet-final.log. This is an environment prerequisite, not a product failure fixed by this patch.

Rejected: fill missing fields using demoTeacher or seedSheetFor; silently persist display defaults; treat empty required values as confirmed; infer publishing capability from a successful draft save. Reverse the projection only if an upstream contract safely guarantees complete editable structure without inventing saved values or refusing incomplete private drafts.

## Handoff

Production: src/studio/teacherSheetEditorView.ts; src/studio/TeacherSheetStudio.tsx; src/creatorStudio/TeacherSheetStudio.tsx; both corresponding teacherSheetApi.ts save argument declarations. Tests: evals/private-draft-editor/{run.mjs,host.tsx,host.html}. Register the mounted runner as a browser suite (pool-safe loopback port0, Vite write:false; uses shared CPU, no fixed dist writes). Root owns registry/integration review. Merge only the three new context entries/edges, not older journals wholesale.

No actual SQL, model call, real owner session, deployment, full release or voice-quality acceptance was run. The supported private source shape was read from the combined candidate; this isolate itself remains based on21and intentionally does not include in-flight private UI work.
