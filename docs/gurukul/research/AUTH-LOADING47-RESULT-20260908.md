# Loading47: font savings measured, Hindi timing still fails

The single authorized counterbalanced12-navigation comparison completed at11:19:18.489Z, started11:17:55.655Z, exec62351/child33656, terminal1. No timeout, force-kill or rerun. Product/experiment source freezeaf625abc39c4117d792004f328affc84ce5d3a5f; baseline exact45 in a private checkout. The original45 full-release failure remains unchanged. This comparative run is not release acceptance.

| Revision/route | n | Median LCP ms | TBT ms | Visible Hindi ms | Font bytes | CLS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline English |3|2456|100|n/a|113718|0.071875|
| candidate English |3|2240|166|n/a|84148|0.071875|
| baseline Hindi |3|3792|1341|2286.1|113718|0.086576|
| candidate Hindi |3|3976|1791|2404.3|84148|0.089295|

Both Hindi groups fail unchanged LCP2500/TBT300/visibleDOM800 limits. English medians pass. Candidate Hindi medians worsen in this sample; do not promote this as a timing optimization or explain away the finding using historical host snapshots. No claim that removing the font caused the slowdown: candidate also repairs loading geometry and the sample is small. No full release has run on this candidate.

## Actual font evidence

All six candidate contexts omit Geist and finish Instrument30262 plus Noto53886=84148 bytes by the named immutable boundary. Five of six baseline contexts request Geist29570; the remaining baseline English context does not. One baseline Hindi context has Instrument/Noto still pending at the boundary and only29570 completed font bytes. Median baseline remains113718. These exact per-run records matter: savings are not uniform across every baseline visit.

Sanitized CDP initiators are parser events: Geist and Noto cite /assets/devanagari-600-DkPwilT9.css; Instrument cites /assets/studioAuth-DCIuJKHS.css. These are actual emitted stylesheet names containing the declarations, not proof of selected glyph or individual DOM node. All retained completed fonts report200 and no cache flags. Collector caps did not overflow; complete means capture was not truncated, not that every request had finished. Some protocol response timestamps follow loadingFinished timestamps; preserve raw event values and do not infer a cross-event sequencing mechanism from those fields alone.

Candidate JS143819 English/147002 Hindi includes actual3183 locale subset; CSS8882. Bytes are not the failing budget. Pair workload uses original gate measureOnce, cold390x844 contexts,4xCPU,150ms latency, identical limits and timing. One common browser with sequential server swaps; passive capture has equal bounded instrumentation on both revisions. Manifests assert dist/source/package/config unchanged before/after and only the reviewed3 product files differ across revisions. No extra style query or font wait occurs during measurement.

## Functional repair and preserved failures

Dependency copies independently copied45 node_modules and blank18-export config: candidate11:05:59.711Z–11:10:07.419Z; baseline11:11:11.415Z–11:14:32.459Z. No npm install or hook execution. Candidate npm run build (tsc -b --force and Vite) passed, exec45579. Collector8 controls passed, runner/supervisor syntax checks passed. Scoped Impeccable ran once and returned one overused-font warning on the new existing-Instrument-family declaration. This is a stylistic heuristic, not a functional defect: this experiment deliberately matches the established final face rather than redesigning typography. The warning is retained in loading47-impeccable.json; no unrelated font replacement was made.

Initial functional8-view result personal-auth-locale-browser-1788865817917 passed insufficient visibility assertions, but its inspected Hindi loading-error screenshot clipped the alert above the viewport. Root independently confirmed it. Strengthened bounds failed in1788865975151; a true-first-loading fixture then reproduced status{x36,y-50,w318,h20} in1788866036328. Source had both short first-grid-row placement and residual general-loading mobile margin-70px. Root approved loading-only grid span/centering plus margin0; no final AuthGate geometry change.

Corrected functional8 views passed in1788866094004, exec5647 terminal0: en/hi x390/1440 xgeneral/test, status/alert bounds and reachable retry/English recovery, actual final auth flow, and a negative control restoring legacy row/margin that fails viewport bounds. Corrected hi390 general error screenshot directly inspected: alert and both controls visible. The fixture now starts with actual loading rather than mounting/focusing the final screen first. All earlier artifacts remain intact.

## Recommendation and remaining work

Keep the loading accessibility fix available for integration review, but reject any claim that this combined candidate resolves Hindi performance. The request reduction is demonstrated; its Hindi latency is not improved here. A reviewer may separate the required geometry repair from the optional font change before choosing an integration candidate. Do not automatically run more variants. Current native task/DOM attribution is still absent:40's old English-only trace cannot explain47's localized Hindi costs. A future exact-current-source diagnostic needs separate authorization.

Raw plan/pins/manifests/all12 results: ../expert-tools/loading47-pair-20260908-once/{running.json,completion.json,experiment/plan.json,experiment/progress.json,experiment/result.json}. Original freeze code hashes: runner7aa045e35a821c5debacc3b3e57b3670b9b92ed0ee099090dd4e2dd97ce34bbd; collectorfc5990f6790bc64714f5685e4d89337aecf34b352667fee4052b679df93a27d0; supervisor32e7c038ca824b6dd10b06a293cbf0cde07c1be67c80fa0785385338e8ac56ca. Browser closed; local lane released.
