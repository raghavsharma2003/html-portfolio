# Same text does not mean the same publication

After reviewing a published sheet, an owner could click Load saved draft and receive identical JSON from a different latest row or a changed status/version. The editors only updated draft JSON, so the publication panel kept its old published claim and Room continuation. This is separate from malformed-field display: local replacements and ordinary edits already invalidated by changing the raw draft key.

Both editors now pass a saved-load revision to the publication panel. It increments when an explicit load starts and settles, including failed loads. The panel invalidates cached review and pending asynchronous results independently of JSON equality. Publication actions and continuation pause during the load; a fresh review remains an explicit owner GET. No automatic GET/POST, permission change, raw-field rewrite, publication retry or SQL change is introduced. Existing transport retains its20second timeout.

Validation on2026-09-07:16 focused mounted groups passed at390/1440 using actual editors/publication client and synthetic localhost responses. Exact merged24 old components retain stale published state for new-row, revoked and version cases with identical bodies in both lanes and widths. Current code requires fresh review and suppresses delayed GET/POST completion, pending/failed-load continuation and automatic requests. Artifacts are `scratchpad/teacher-sheet-publication-mounted/1788798304014`; exact old consumer sources are retained there. The first attempt's stale networkidle assertion failed after one group; it now waits for the exact new HTTP response.

Forced TypeScript, actual copy7scopes/21negative controls and diffcheck passed. No actual DB/auth/model calls, full release, full48 malformed rerun or parent publication24 rerun occurred here. The ignored offline import hook refuses default DB calls and secret config imports. Parent owns combined validation.

The fresh isolate contains29 exact merged24 prerequisites committed as cfa533e0 before this delta. Merge only the three production and three mounted-test/fixture changes in the handoff, plus the report and appended context entries. Do not cherry-pick the prerequisite snapshot over root staging. The default publication mounted command now includes the16 focused groups alongside its existing24 groups.

Reversal condition: any same-body load retaining stale publication, any automatic follow-up request, or any loss of unrelated raw draft data invalidates this repair.

The final old-load-editors.json fixture contains byte-identical copies of both executed old negative sources, verified against the prerequisite Git blobs. The harness reads this committed fixture so a fresh integration checkout does not need the isolated prerequisite commit. This packaging-only change does not alter the executed old code.
