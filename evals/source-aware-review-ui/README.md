# Source-aware owner review regression

This suite uses invented art-method text and synthetic identifiers only. It mounts the actual `CloneExperience`, `ContextLockerPanel` and `PersonModelStudio` components with their actual browser API wrappers. The HTTP responses are fixtures, not SQL or model evidence.

Safe local checks (no HTTP server, browser, database or provider):

```sh
node evals/source-aware-review-ui/run.mjs --source-only
node evals/source-aware-review-ui/run.mjs --build-only
```

`--source-only` exits after 17 source groups, before Vite, HTTP or browser imports. `--build-only` also bundles the actual components in memory and exits before HTTP/browser imports. Run either under the worktree's network-blocking preload when available.

Hosted mounted check:

```sh
node evals/source-aware-review-ui/run.mjs
```

Mounted mode is refused unless `GITHUB_ACTIONS=true`. Do not set that variable to bypass the employer-laptop restriction. Chromium, dependencies and fonts must be supplied by the hosted workflow.

The 22 mounted groups cover the selected locker item (including two items with the same filename), a match only in the fifth citation, unrelated-claim exclusion, All sources, exact Hindi/emoji/CRLF text, document and transcription coordinates, legacy and malformed previews, explicit acceptance only, loading/empty/error states, stale owner/token/replica reads and parent selections, unmounting, keyboard operation, visible focus and 390/1440 layout bounds.

The 17 source groups execute actual helper logic, actual extracted Teach and async-load callbacks, the actual parent selection expression and the actual activity API serializers against a scope-bound inert fixture. Eleven deliberate guard/matching mutations demonstrate detection of source-ID confusion, fifth-citation truncation, stale callback authorization, retained selection and stale async read witnesses. These are frontend controls, not backend authorization proofs.

The existing layout group additionally measures all four first-claim review actions at each viewport: at least 44 by 44 CSS pixels, at least 8 pixels between targets, wrapping inside the action container, actual Tab focus with visible outline and five-point hit testing for occlusion. Focus and measurement must not send any mutation. A narrowly injected stylesheet removes the minimum target dimensions; the same DOM target assertion must reject the resulting small buttons. The injected style is removed in `finally`, and restored dimensions are checked again. These are hosted DOM checks, not source-only measurements or real-device acceptance.

Hosted output is confined to `scratchpad/source-aware-review-ui-synthetic/node-<version>/`: selected-source, selected-claim and focused claim-actions screenshots at both widths, a result JSON, or a failure screenshot/JSON. The JSON includes `actionMeasurements`: actual rectangles, the minimum-size negative control and restoration, focus styles, hit-test results and mutation counts. The claim screenshots explicitly scroll the card into the inner viewport; a full-page screenshot alone cannot expose scrollbox contents. No owner data or authorization tokens are written into artifacts. Local source/build-only runs do not create those artifacts.
