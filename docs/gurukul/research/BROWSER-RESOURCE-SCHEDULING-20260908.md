# Browser suite resource scheduling

8 September 2026 IST. Isolate `codex/release25-browser-controls`, base checkpoint25 `7d4b121abf73a171b44e3e1baba467c39d8ba38f`. No application, API, SQL, auth, model, deployment or browser-action change.

The unchanged full release25 finished 23/24. Its evaluation failure included `explicit-action-focus` at the third attestation checkbox and `teacher-sheet-edit-races` while filling the syllabus field. Both were native actionability timeouts. The original failures remain in integration's `scratchpad/release-logs/2026-09-07T19-03-36-401Z-14728/eval-suite.stdout.log` and associated failure artifacts. A separate mined-CTA historical fixture issue belongs to the root agent.

A first concurrent replay of those two suites passed 58 and 54 groups with unchanged controls and deadlines. Passive browser diagnostics were the only fixture addition. This alone did not explain the release failures.

The next probe used the actual `runPool` with seven real existing browser suites, matching the release's worker count. It ran Activity abort, pending refresh, explicit focus, first-use flow, editor races, Feed return and private refinement against synthetic localhost responses. No real auth, DB or provider was contacted. Five suites passed; focus and editor races failed again, at different actions. Focus stalled on “My writing” after native visibility/enabled/stability checks and click dispatch. Editor stalled on “Load saved draft” after those checks and scrolling. Therefore this reproduces browser stalls in the same suites, not the original exact checkbox/textarea positions.

The editor diagnostic showed a visible document, no visibility transitions, an enabled/editable connected syllabus field, no element animations, and successive renderer frame gaps of 5233 and 8766 milliseconds. No JavaScript long tasks were reported. The focus browser did not answer a diagnostic evaluation within three seconds. Across 204 one-second parent samples, minimum free memory was 0.532 GiB on a 15.745 GiB machine and the maximum parent event-loop delay was 496 ms. These observations support resource-related scheduling stalls. They do not identify an OS, paging or Chromium internal mechanism conclusively.

Unbounded receipt: `scratchpad/browser-overlap/1788809532618/result.json`, completed 2026-09-07T19:35:41.634Z. Passive editor evidence: `scratchpad/editor-edit-races/1788809537693/browser-failure-0.json`. The seven-suite launcher and its original version are retained in ignored `scratchpad/browser-overlap/`.

## Change

The runner now shares a two-slot browser-suite budget between its normal worker pool and fixed-port lane. It retains the existing overall worker count, pre-pool serial `dist` writers, fixed-port serialization, result ordering and failure status. A blocked browser entry does not occupy a worker: later CPU work can proceed. Slots release in `finally`, including unsuccessful child processes. This is a per-runner suite limit, not a machine-wide limit on Chromium processes or contexts inside one suite.

`suite-resources.mjs` parses registered suite source and relative helpers under `evals/` and `scripts/` without importing or executing them. Literal Playwright/Puppeteer imports, exports, require/dynamic imports and actual known browser launch calls mark a browser closure. The launch rule covers the incumbent creator rehearsal's computed helper URL. Comments and prose do not count. The current base registry yields 27 potentially browser-capable closures out of 337 entries; this is conservative and includes performance tests importing helpers with browser code even if they only invoke pure functions. The new resource regression adds one CPU entry. This is not a general JavaScript call-graph proof: a future unusual computed helper or external automation system needs explicit classifier coverage and a regression.

The first source-catalog assertion correctly rejected missing coverage for the creator rehearsal's computed import. It was repaired by recognizing its actual launch caller, not by dropping the assertion. No API configuration is read by this classifier. The registry integration is a small driver diff and one new suite entry; preserve independently added registry entries when merging.

## Validation

- Existing scheduler regression: 15 passed.
- New real-child scheduler and source-classification controls: 12 passed. The retained old scheduler actually starts more than two browser children. Current controls witness two overlapping browser children, a CPU child progressing behind seven queued browser entries, a shared cap across the port/main pools, slot release on failure and preserved result ordering. The control is based on acknowledged HTTP barriers, not relative sleep durations. Receipt: `scratchpad/browser-resource/1788810047527/result.json`.
- Final registry/source verification repeated those 12 and the incumbent 15 after the driver integration: `scratchpad/browser-resource/1788810322865/result.json`, 338 registered entries including the new resource test, 27 conservative browser closures. Context graph and diff checks also passed. No application TypeScript changed.
- The same seven actual browser suites, with the same actions and timeouts, passed under the two-slot budget: Activity 4, refresh 12, focus 58, first-use 18, editor 54, Feed 13 and refinement 40, totaling 199 groups. Receipt: `scratchpad/browser-overlap/1788809935363/result.json`, completed 2026-09-07T19:42:57.494Z. There were 237 parent samples, minimum free memory 2.710 GiB and maximum parent loop delay 249 ms. This is one bounded comparison, not a performance benchmark or full release.

Scheduler bytes stayed fixed throughout the bounded browser probe. During that probe the classifier gained the computed-helper launch rule needed by creator rehearsal; all seven selected probe entries had already classified as browser work through their direct imports, and the final 12 source controls cover the final classifier. The final full release must execute the integrated registry and final bytes.

Passive fixture diagnostics record frame gaps, visibility, long tasks and failure DOM state. They never focus an element, force a click, alter deadlines or retry actions. Diagnostic reads have their own short deadline so an unresponsive browser cannot indefinitely delay the original failure report.

Decision: retain browser action deadlines and bound shared browser-suite concurrency to two. Reverse or revise if a source eligibility defect explains the stalls, a measured alternative supports more browser work without missed actions, the resource classifier misses a registered browser caller, or CPU/port/writer semantics regress. A passing isolated replay must not replace the failed full25 release record.
