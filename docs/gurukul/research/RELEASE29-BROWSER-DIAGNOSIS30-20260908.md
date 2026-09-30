# Release29 browser diagnosis

Release29 on f4235c6809128d00f336fb73b127e75afe6493b2 finished at 2026-09-07T22:19:56.167Z, with23/24 gates passing and evaluation failing three suites. The root owns the separate deterministic parse-separator correction. This investigation covers the two browser failures without changing frozen29 or running another full release.

## Retained evidence

The eval log at scratchpad/expert-29-release/scratchpad/release-logs/2026-09-07T21-56-00-934Z-32704/eval-suite.stdout.log records:

- Creator cascade:25 checks passed, then the1440/Hindi/Meet target timed out waiting15seconds for the first button.primary-button. Its mounted/panel/contrast audit had already succeeded. Failure artifact creator-cascade-order/1788818747292 contains no page error or unexpected origin. It does not capture the failing DOM, so absence versus delayed rendering cannot be distinguished from that artifact.
- Explicit action focus:45 checks passed, then page.goto(load) timed out after10seconds before the next1440/save/failure action. Passive browser-failure-0.json records a visible blank root with only1animation frame and an11,512.5ms initial frame gap. No long tasks were recorded. The immediately subsequent retained screenshot shows the complete private-draft UI. This supports delayed rendering rather than a sustained React crash, but does not distinguish renderer scheduling, resource delivery, stylesheet blocking or machine contention. No cause is proved by the gap alone.

## Actual bounded reruns

Isolate expert-browser-diagnostics30 starts at the exact frozen29 commit. Its ignored dependency and dist junctions only read the final release29 install/build. No rebuild, cloud, SQL or provider call occurred. No action timeout, browser launch setting or product source changed.

1. Unchanged creator32 passed, receipt scratchpad/creator-cascade-order/1788819913680/result.json, finished22:25:29.956Z.
2. Unchanged focus58 passed, receipt scratchpad/action-focus/1788819927384/result.json, finished22:26:22.507Z. The two bounded runs overlapped briefly with at most two Chromium instances. This is not recreation of the complete release workload or a timing comparison.
3. The narrow creator audit-completeness repair passed all32 again, receipt scratchpad/creator-cascade-order/1788820001886/result.json. It waits for the actual target control to be visible before the real contrast audit, retaining the existing15second deadline and all original removed-layer-order negative controls. It also records per-target phase and, on failure, DOM, button geometry, browser frame diagnostics and resource request/completion/failure metadata. Failure-only metadata was not exercised in this passing run.

The creator code previously audited a mounted shell before confirming its lazy target button existed. Fixing that measurement order is justified independently of the unreproduced timeout. It is not a demonstrated fix for that timeout. The focus fixture and product are unchanged; no additional fix is justified by this bounded evidence.

Full release on the next immutable integrated candidate remains required. Keep the original failed receipts. If either timeout recurs, compare target phase and resource timing with renderer diagnostics before changing scheduling. A standalone pass is not evidence that the full workload is reliable, and increasing timeouts or using force clicks would discard the original signal.
