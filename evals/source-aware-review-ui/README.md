# Source-aware owner review regression

This suite uses invented art-method text and synthetic identifiers only. It mounts the actual `CloneExperience`, `ContextLockerPanel` and `PersonModelStudio` components with their actual browser API wrappers. The HTTP responses are fixtures, not SQL or model evidence.

Safe local checks (no HTTP server, browser, database or provider):

```sh
node evals/source-aware-review-ui/run.mjs --source-only
node evals/source-aware-review-ui/run.mjs --build-only
```

`--source-only` exits after 14 source groups, before Vite, HTTP or browser imports. `--build-only` also bundles the actual components in memory and exits before HTTP/browser imports. Run either under the worktree's network-blocking preload when available.

Hosted mounted check:

```sh
node evals/source-aware-review-ui/run.mjs
```

Mounted mode is refused unless `GITHUB_ACTIONS=true`. Do not set that variable to bypass the employer-laptop restriction. Chromium, dependencies and fonts must be supplied by the hosted workflow.

The 22 mounted groups cover the selected locker item (including two items with the same filename), a match only in the fifth citation, unrelated-claim exclusion, All sources, exact Hindi/emoji/CRLF text, document and transcription coordinates, legacy and malformed previews, explicit acceptance only, loading/empty/error states, stale owner/token/replica reads and parent selections, unmounting, keyboard operation, visible focus and 390/1440 layout bounds.

The 14 source groups execute actual helper logic, actual extracted Teach and async-load callbacks, and the actual parent selection expression. Eleven deliberate guard/matching mutations demonstrate detection of source-ID confusion, fifth-citation truncation, stale callback authorization, retained selection and stale async read witnesses. These are frontend controls, not backend authorization proofs.

Hosted output is confined to `scratchpad/source-aware-review-ui-synthetic/node-<version>/`: two selected-source screenshots, a result JSON, or a failure screenshot/JSON. No owner data or authorization tokens are written into artifacts. Local source/build-only runs do not create those artifacts.
