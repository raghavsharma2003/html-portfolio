# Release23 fixture assumptions, 2026-09-07

Isolate codex/release23-fixture-routing from0a3b2d2608d64a4f9aebdafc690caf445f6b5889. Two eval files only; no production, migration, schema, engine, UI or native probe changes.

## Reproduction

Frozen integration release23 log: scratchpad/release-logs/2026-09-07T15-46-17-125Z-28048/eval-suite.stdout.log. teacher-sheet-private passed16 groups then failed185 on raw schema.includes(migration.trim()). studio-setup-selection passed2 then failed35 expecting first replica A for an explicit teacher/replica link that correctly selected B.

Fresh23 isolate reproduced the selection failure. Its untouched teacher suite passed17: checkout encoding differs. Reading actual frozen integration bytes demonstrated migration139 has0CRLF and schema5598CRLF, raw mirror=false, CRLF-to-LF mirror=true. Fresh checkout has33/5636CRLF and raw mirror=true. This is line-ending sensitivity, not measured SQL drift. Original isolated logs retained under scratchpad/teacher-private-original.log and setup-selection-original.log; the original integration failure log is untouched.

## Repair and retained negatives

teacher-sheet-private normalizes only CRLF pairs in the migration mirror comparison. It does not normalize spaces, tokens or SQL string content. The original owner, publication, first-save and runtime-negative assertions remain. A new group executes the old raw comparison against mixed line endings (fails), checks both encoding directions, and rejects four content mutants: public/private statuses, cascade behavior, unique-index status and a trailing space inside a quoted SQL value. Migration139/schema files are untouched; offline controls are not SQL parser proof.

studio-setup-selection keeps the real AST-extracted loadReplicas/signOut callbacks. First-owned default applies only when no replica parameter exists. Explicit teacher, replica, share/Hindi and mode-free links require the exact owned target; manual selected workspace survives refresh. Missing/malformed/unowned IDs are refused in setup, teacher and replica modes. Existing stale-session and old-fallback mutants remain. An added negative extracts exact43230e5e callbacks: its setup-only query guard selects A for explicit non-setup B links, while setup still selects B. No production change was needed; checkpoint23's broader explicit-owner selection is intended behavior.

## Measured result

2026-09-07: teacher-sheet-private18 groups and studio-setup-selection12 groups passed in one bounded offline run. Synthetic scoped SQL functions and actual callback AST execution, with network globally refused for teacher fixtures. No DB, provider/model, browser, build, full-release or authority acceptance. No production file changed. Reverse only if actual query/caller semantics change; preserve exact owner/snapshot/lifecycle and stale-scope controls rather than loosening them for a green run.
