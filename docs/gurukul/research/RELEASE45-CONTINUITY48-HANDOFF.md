# Release45 continuity regression controls

Source-only repair from frozen45 71663c5d173ed0ffe49b86639567cf83e9b7cd16. No product code changes. No tests or browser runs while full45 is active.

Backend failed after22 checks at private-continuity/run.mjs:72 because it searched for literal memory:false,voice:false. Commit33079be0 introduced separately scoped opt-in visitor continuity, while default and explicit opt-out still disable memory. The revised control calls actual terms/policy functions, checks default/false/true and v1 refusal, keeps voice disabled and private-continuity imports isolated, and uses real encrypted rows to reject cross-visitor/publication/owner/epoch recall. Negative controls still fail if default memory or voice is enabled.

The mounted suite failed after4 checks at ui.mjs:44 on desktop1440: immediate count after details close found one excerpt node. Retained failure screenshot shows closed details with no excerpt visible, and there were no page errors. The UI, test, CSS and client are byte-identical to release39. Async native toggle/React cleanup is a source-supported race hypothesis, not a recorded event trace. The fix waits for actual DOM detachment within Playwright's existing action timeout, then retains the strict zero-count assertion. A hidden retained-node negative control must time out, so visibility alone cannot satisfy the gate.

Original evidence is preserved in frozen45 scratchpad/release-logs/2026-09-08T10-25-42-142Z-14220/eval-suite.stdout.log and scratchpad/private-continuity-ui/1788864518838. No claim of passing repaired controls yet.
