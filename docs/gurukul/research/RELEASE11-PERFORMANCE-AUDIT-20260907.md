# Release 11 performance audit

Read-only audit, 2026-09-07. Integration source comparison: release 10 `a3dcdead` to frozen release 11 `f22bc6e0`. Release 11 was still running during this audit. No benchmark, browser launch, code edit, process termination, cloud request or budget change was performed. This document is the only written artifact.

**Finding:** release 11 has seven genuine gate failures, but the retained artifacts do not establish a code-performance regression or prove host contention. Broad cross-page slowdown with stable assets makes environmental/scheduling variation plausible. More actionable: both Studio targets report missing LCP as zero, and zero completed font transfer despite unchanged local font imports. Diagnose this measurement/render anomaly before changing page code.

## Retained evidence

Worktree root: `C:/Users/raghav.s/Desktop/build/Vyakti-platform/scratchpad/expert-integration`.

- [Run 10 performance stdout](../expert-integration/scratchpad/release-logs/2026-09-07T02-20-51-525Z-12764/performance-budgets.stdout.log).
- [Run 11 performance stdout](../expert-integration/scratchpad/release-logs/2026-09-07T05-18-02-103Z-16184/performance-budgets.stdout.log). Its stderr is empty.
- Corresponding `web-build.stdout.log` files retain content-hashed filenames and rounded sizes. Performance was invoked without `--json` or `--diagnostics`, so these runs retain medians, not individual runs, resource timing, LCP candidates or long-task attribution.

| Target | LCP 10 → 11, ms | TBT 10 → 11, ms |
| --- | ---: | ---: |
| / | 936 → 1480 | 0 → 29 |
| /vyakti | 560 → 1832 | 0 → 515 |
| /r/slug | 1216 → 2084 | 79 → 528 |
| room-hi | 1612 → 2816 | 56 → 323 |
| /studio | 1856 → **0** | 2 → 662 |
| studio-hi | 2000 → **0** | 44 → 542 |
| /c/slug | 400 → 648 | 0 → 0 |
| /r/slug/about | 324 → 744 | 0 → 0 |
| /suites/about | 344 → 1040 | 0 → 177 |

Hindi chunk wait: **24 → 1645 ms** against 800 ms. The separately named first-Hindi-paint metric is **230 → 655 ms**. Both Studio font totals change **82.2 KB → 0 KB**, with CLS **0.072 → 0**. Every target's displayed JS and CSS totals is unchanged. Budgets remain LCP 2500 ms and TBT 300 ms; no relaxation is justified.

## Source and artifact comparison

`git diff --name-only a3dcdead..f22bc6e0 -- scripts site src/room src/studio studio.html src/creatorStudio/replicaApi.ts` identifies only `src/creatorStudio/replicaApi.ts`. Its sole change maps one unavailable-verifier API error to explanatory copy; it introduces no startup loop, animation, font or Hindi-loading change. Other changed runtime files are server-side processing and detached identity helpers. The performance server serves built/static files; it does not execute these new inference/identity helpers.

The changed replica API bundle grows from **1.86 to 1.97 KB**, gzip **0.73 to 0.80 KB**. Dependent content-hash names change, but the actual measured JS totals remain constant at printed precision. Crucially, **`hiAuthCopy-8p53CmrP.js` is identical by retained content-hashed name and size: 5.65 KB, gzip 1.84 KB** in both builds. Room and static marketing source are unchanged. This does not support treating chunk growth or the new optional speaker metadata as the explanation for the broad slowdown.

## Studio zero-LCP/font anomaly

- [personalMain.tsx](../expert-integration/src/studio/personalMain.tsx:3) imports local Geist, Instrument Sans and Noto Devanagari font packages. The gate header's claim that the product loads no web fonts is stale. There was no font-source change between the releases.
- [check-performance.mjs:435](../expert-integration/scripts/check-performance.mjs:435) initializes LCP to `0`; the observer changes it only when a candidate arrives and swallows setup errors. [Budget evaluation:641](../expert-integration/scripts/check-performance.mjs:641) checks only the upper limit. Thus no observed LCP is currently accepted as fast LCP. A median of zero means at least two of the three runs retained zero under this implementation. It does not prove instantaneous paint or prove why no candidate appeared.
- [Font accounting:405](../expert-integration/scripts/check-performance.mjs:405) requires `Network.responseReceived` followed by `Network.loadingFinished`. Failed/pending requests are not recorded as failures. Zero completed transfer can indicate font requests never initiated, failed, remained unfinished, or bytes were not counted. It is insufficient to distinguish these cases or conclude a blank page. The fresh browser contexts reduce ordinary per-context caching as an explanation but do not establish a diagnosis.
- [Settling:528](../expert-integration/scripts/check-performance.mjs:528) waits for `load`, ignores a 12-second network-idle timeout, then dwells 1500 ms. It does not assert the signed-out app mounted, fonts settled, or a contentful candidate was recorded.
- [Hindi marker:493](../expert-integration/scripts/check-performance.mjs:493) watches `document.body.textContent` with a MutationObserver. Despite its metric name, it does not check text visibility or actual paint. Its 655 ms therefore cannot rescue the missing LCP evidence. Chunk wait is a separate test-triggered dynamic import started after first-paint, so its 1645 ms is not the same clock/event as the DOM-text marker.

## Host evidence and limits

Unchanged gates also slowed: typecheck **17,480 → 50,307 ms**, board legibility **18,460 → 61,766**, web build **5,836 → 9,435**, and layout **250,610 → 273,699**. Some workload differences exist in the expanded eval suite, so its **353,934 → 457,874 ms** is weaker comparison evidence. Gates are sequential awaited subprocesses ([verify-release.mjs:71](../expert-integration/scripts/verify-release.mjs:71)); this runner does not itself overlap the performance and eval gates.

A sanitized host snapshot at **05:36:41 UTC**, after the performance failure while the full runner continued, found i5-1145G7, eight logical CPUs, reported CPU load **15%**, **3383 MB free of 16123 MB**, 343 processes. Counts included 11 Node, 4 Chromium headless shell, 7 Chrome, 19 Edge and 20 WebView2 processes. No command lines, credentials or environment values were inspected. This proves several applications existed at snapshot time, not that CPU was saturated during performance measurement. No retained failure-time CPU/memory/thermal trace exists in these artifacts. Do not equate process count or cumulative CPU time with concurrent load.

## Smallest diagnostic after the full runner exits

Keep the same frozen source and `dist/`; first verify no other gate/browser benchmark is active. From the integration worktree, run exactly one existing three-run batch:

```powershell
node scripts/check-performance.mjs --target studio-hi --diagnostics > ../expert-tools/release11-studio-hi-diagnostic.json
```

This also runs the existing installable-Room check and static Hindi-preload check; `--target` filters only performance targets. Preserve its exit code and JSON. Inspect all three `runs[].diagnostic.lcpEntries`, resources (especially `.woff2`, personalMain JS/CSS and hiAuthCopy), navigation timings, long tasks, wall times and font byte counts. Existing diagnostics record timing, not failed-network events or screenshots.

If Studio remains anomalous, take a narrowly scoped follow-up capture of the real target: screenshot, root-child/visibility state, `document.fonts.status`, font-face status, and sanitized request-failed/request-finished events. This distinguishes mounted fallback text, unfinished/failed local font loading and missing observer delivery without changing the benchmark's dwell or budgets. If long-task slowdown still occurs, run one unchanged static control batch, sequentially:

```powershell
node scripts/check-performance.mjs --target /vyakti --diagnostics > ../expert-tools/release11-vyakti-diagnostic.json
```

A recovery is diagnostic evidence, not a replacement green release. If retained long tasks identify actual changed code, fix that cause; otherwise compare the unchanged control and recorded host state before attributing a regression. No speculative animation, font, chunk-loading or budget edit is justified yet.

## Minimal missing-LCP patch/test plan, not implemented

1. Treat absent/unsupported observer output as unavailable (`null` plus explicit observation/support state), never numerical zero. Preserve actual positive measurements and existing budget values.
2. Before median evaluation, emit a named measurement finding for **each** run without a finite positive observed LCP. One missing run among two valid runs must not disappear behind a valid median. Do not substitute FCP or Hindi DOM text as LCP.
3. Extend the pure performance gate tests (currently [evals/performance-prerequisites.mjs](../expert-integration/evals/performance-prerequisites.mjs)) through a small exported result validator used by the real runner: positive observed LCP passes; null, zero, negative, NaN/Infinity and unsupported observer refuse; one missing run among two valid refuses; ordinary positive over-budget LCP still fails its existing budget; non-LCP findings remain intact. Add an actual-source negative control removing the measurement guard, which must admit a broken fixture and be caught.
4. Validate with the existing real Studio diagnostic after the pure tests, preserving public-fixture-only telemetry. Font transfer is supporting diagnostic evidence, not a universal mandatory positive-byte threshold: legitimate fallback/cache behavior can exist. Separately correct the stale font and DOM-paint comments so future readers do not overstate these measurements.

Full-run status, root logging and any implementation decision remain with the parent task.

## Subsequent authorized phase

After the read-only audit, root reported release 11 completed with **23/24 checks passing, performance alone failing**, and ran the targeted Studio diagnostic on unchanged source/dist. I read `expert-integration/scratchpad/release11-studio-hi-diagnostic.json`: status passed, LCP runs **2304/2160/2212 ms**, TBT **70/66/140 ms**, fonts **84148 bytes each**, two LCP entries each, Hindi chunk waits **54.8/47.5/91.6 ms**. Median LCP2212/TBT70 and recovered font transfer are diagnostic recovery, not replacement release acceptance or proof of a particular host cause.

Root then authorized the missing-LCP patch. Implemented only `scripts/check-performance.mjs` and new `evals/performance-measurements.mjs`: null initial LCP, explicit observed/support state, mandatory per-run finite positive observation before budget acceptance, n/a output for unavailable median, retained thresholds/settle times. Corrected font comments and printed Hindi label to DOM text; retained `firstHindiPaintMs` JSON field for compatibility. **26 focused checks plus 9 existing prerequisite checks passed**, and diff whitespace check passed. An actual-source mutant removing the caller guard falsely admits all12 malformed-run fixtures, which the new tests detect. No browser or performance benchmark was launched by this subagent in either phase. Root owns registry, further real diagnostic and full-release verification.
