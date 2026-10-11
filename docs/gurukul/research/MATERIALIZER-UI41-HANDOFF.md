# Private comparison preparation UI

Source-only work on 2026-09-08. No tests, build, browser, SQL or provider calls ran because release39 owns the local verification lane.

The correction draft now opens a dedicated preparation action. Status is read first. The owner explicitly starts or resumes a serial sequence of one-response advances. Requests carry the exact replica, dataset, candidate and expected source-set hash. Lost responses, malformed progress, scope changes and unmount stop further client mutations. A fresh status read never automatically resumes generation. Client abort does not prove server cancellation or refund.

Ready opens the existing blind comparison panel with an optional candidate ID request filter. The server must implement this filter without exposing candidate identity or A/B mapping in its response. Existing unscoped callers remain supported. The panel title now uses a unique accessibility ID because two instances can coexist.

The progress contract counts generated responses: each successful advance that remains advanceable must increase completed, keep total and job ID fixed, and never activate a candidate. Held and failed are explicit platform states. The UI does not activate or approve a clone.

## Verification still required

- Run `node evals/candidate-materializer-ui-contract.mjs` after dependencies and lane are available. These authored controls cover scope mismatches, malformed counters, terminal advancement, unchanged active state, exact POST scope and propagated transport errors.
- Run semantic TypeScript, copy and original correction candidate mounted checks.
- Mount at mobile and desktop widths and verify one-click serial progress, held state, lost response followed by read-only status and explicit resume, unmount/account/source changes with an outstanding request, duplicate clicks, non-progress responses, exact-candidate blind request, keyboard and screen reader progress.
- Verify actual server persistence, accounting and candidate-filter SQL independently. Offline UI controls cannot prove any of those.

## Decision and rejection

Reuse the existing sealed comparison UI instead of creating another rating surface; reverse if its server cannot bind the requested candidate without leaking identities. Source inspection found the original evaluation request only scoped by replica, so mounting it and calling the results this candidate's review would be unsupported. Optional server-side candidate filtering is required before integration.

Measurement: 2026-09-08, one source inspection of the original status request and response types found no candidate selector; zero runtime checks executed in this slice.
