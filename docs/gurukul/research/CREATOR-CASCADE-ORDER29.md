# Creator fixture cascade-order repair29

Base f027349ac601a8bc393b2038b5c0d0baccfe3514, isolated from frozen candidate28. No product CSS or API change.

Release28 layout reported151 contrast findings across108 total screen loads. A two-page actual built26/28 browser comparison established a specific failing creator Feed control: accepted26 foreground rgb(255,254,249), candidate28 rgb(23,25,21), both on rgb(23,73,59), opacity1. The latter is the reported1.73:1. ROOT expert-tools/contrast28-computed-diagnostic.json retains those observations. The gate's list of all108 screens is not proof that every named screen failed.

Core CSS bytes are identical: review-queue-BOL5DY47.css starts layers components, responsive, reset, tokens, base. The shared tokens-CpK_7dBX.css registers the intended reset/tokens/base/components/responsive order. In accepted26 creator HTML, tokens loaded first; candidate28 placed it last after an unrelated module/chunk graph change. Without an earlier declaration, reset button color inheritance wins over component primary-button color. The detector measured real computed color; this was neither scheduling noise nor a palette change.

Production studio.html, studio-layout-fixture.html, room.html and room-layout-fixture.html already pin layer order inline with an extensive historical explanation of this exact minifier hazard. creator-layout-fixture.html did not. Add the same inline declaration before external styles, keeping the genuine creator component fixture. Do not alter palette/thresholds or hide controls to pass. This fixes fixture parity; no failing production Studio color was established by this observation.

## Measured controls

The normal Vite build passed after an initial missing ignored api/_config.js closeBundle environment failure. The failed build log is retained in scratchpad/creator-cascade-order/build-missing-config.log. A newly generated all-empty stub, with env cleared for write-config --stub, resolved that known prerequisite. No keys were copied. Build log is build.log.

At 2026-09-07T21:36:12.051Z, node evals/creator-cascade-order/run.mjs passed24 groups. One Chromium process,390/1440 widths; actual built HTML and CSS; exact audit function extracted from scripts/check-layout.mjs using its AST without running that whole gate. Twenty repaired creator screens cover EN/HI Feed, processing Feed, Meet, Deploy and opened deployment picker. Two retained negatives remove only the inline declaration under the observed tokens-last ordering, reproducing sub2:1 primary-button contrast. Two additional positives use former tokens-first ordering. The repaired order remains ahead of every stylesheet. Cases assert mounted panels and actual primary controls, forbid non-local requests, and retain console/contrast/colors. No page errors or external requests occurred. Browser/server closed.

Receipt: scratchpad/creator-cascade-order/1788816937075/result.json. The fixture explicitly permutes the real extracted stylesheet graph to preserve the observed hazard even if a future chunk order changes. It does not substitute styles/components or alter the unchanged4.5 contrast threshold. Root should register creator-cascade-order: creator-cascade-order/run.mjs; it is a browser suite and consumes existing dist after the full runner's web build. It does not build a shared dist concurrently inside the eval pool.

This scoped test judges creator contrast, not every layout dimension or every108-screen route. Root must run the final complete layout/release on merged29. No SQL, auth, provider, identity, deployment, full release, timing or accessibility-certification claim follows.

## Ops accessibility follow-up

Release28 completed terminal exit1 at2026-09-07T21:46:16.836Z with layout, eval and accessibility failures. Its accessibility report included the same1.73:1 foreground/background on `.ops-board__lang-btn[lang="en"]` and `[lang="hi"]`. The original24 controls did not include Ops, so that coverage was not inferred.

At 2026-09-07T21:48:50.027Z, `node evals/creator-cascade-order/run.mjs --ops-only` passed8 focused groups: EN/HI Ops at390/1440, each with removed-declaration negative and current-declaration positive. Both the unchanged real layout audit and actual axe-core color-contrast rule detect the old language-button failure and report zero contrast findings for the repaired page. Browser/server closed. Receipt: scratchpad/creator-cascade-order/1788817721559/result.json. HTML/product bytes are unchanged fromf005c974; only the test and documentation expand.

The default final test now includes32 groups. The initial24 and subsequent8 were executed separately; the final combined32 invocation remains for root's gate. These are targeted contrast/accessibility-rule checks, not a complete accessibility or full-release pass.
