# Conversation setup browser diagnosis

The unchanged conversation setup suite passed 34 mounted controls in one diagnostic run on 2026-09-08. The release30 launch crash remains unexplained. No application or test change is justified by this result alone.

## Original failure retained

- Frozen source: `6bfc4fb0301a91e3ce5de07e75c9d23131a5dfab` in `scratchpad/expert-30-combined`.
- Original receipt: `scratchpad/meet-setup-ui/1788834686049/result.json` in that worktree.
- Chromium headless shell revision1234 exited3221225477 during `chromium.launch`, before any page or control ran. Original receipt reports passed0.
- A targeted Windows Application event lookup for IDs1000/1001 between 2026-09-08T02:14:00Z and02:35:00Z returned no matching `chrome-headless-shell` record. Absence of that record is not a root-cause diagnosis.

## Diagnostic measurement

Method: run unchanged `node evals/conversation-setup-ui.mjs` once in the private-dependency release31 regression worktree. Execution session50322 completed with exit0. Playwright version1.62.1 used the default headless Chromium launch. No browser substitution, launch retry loop, test timeout change, assertion removal, provider call or cloud change was made.

- n=1 diagnostic run, 34 controls across390px and1440px viewports; runtimeErrors0.
- Receipt: `scratchpad/meet-setup-ui/1788844435205/result.json` in `scratchpad/expert-release31-regressions`.
- Receipt SHA256: `da61d48743054a8ae771291e335c5f55db452a614eadff30b9fb1d07376554cc`.
- Unchanged harness SHA256: `05ed7f15c1c11f9f3d4338fc941585816694145d6aeae9342ac9d43266f76620`.
- The browser closed through the existing finally block. Two viewport screenshots and two destination screenshots are beside the receipt.

The controls cover actual mounted conversation/entry routing against synthetic HTTP, denied generation, stale owner/session responses, focus handoff, mobile overflow and saved-reply reconciliation. They do not establish real authentication, provider dialogue, database or activation behavior.

## Decision and rejected inference

Retain the harness unchanged and include it in the next full release run. Rationale: the same source now runs all assertions successfully, and no reproducible harness defect was found. Reversal: a reproduced launch failure with additional process evidence, or a deterministic source-level defect, requires further diagnosis.

Reject calling this crash fixed or harmless. One isolated success does not explain the earlier process exit or establish reliability under the full release workload. Do not add automatic retries to convert that uncertainty into a passing release.
