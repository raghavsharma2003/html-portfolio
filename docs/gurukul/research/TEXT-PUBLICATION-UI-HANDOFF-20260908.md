# Connected text sharing UI

The studio now offers an explicit text-sharing path from Knowledge or Files before voice setup finishes. It uses the same replica and a separate reviewed publication receipt. Voice readiness and voice-only navigation retain their existing checks.

Owners choose a saved teaching profile and eligible material, inspect the published projection and limits, and confirm all four server-provided statements. A client-generated publication ID survives a lost response; status recovery never publishes a fresh link. Unpublish closes the link. Incomplete profiles have a route to the existing teaching editor.

Visitors open `/studio?publication=<id>`, sign in, accept the adult/AI/retention terms, and ask about the published material. Refresh recovers the existing request. Expired authentication is refreshed before allocating a question ID. Account changes fence stale responses. A deletion with an unknown response hides answers, blocks new admission, and remains recoverable after reload or publication closure.

## Evidence

- Actual client response boundaries: 21 controls passed.
- Connected owner/visitor components against a synthetic HTTP fixture: 28 checks at 390 and 1440 pixels. Receipt `scratchpad/text-publication-ui/1788812441993/result.json` pins five source hashes before and after execution. Covers publish response loss, OTP UI, explicit admission, ask/readback, deletion recovery, expired/failed refresh and delayed restoration after sign-out.
- Actual default studio and CloneExperience: 18 mounted checks at both widths. Receipt `scratchpad/text-publication-early-share/1788812350588/result.json`. Includes authenticated early-owner routing, old full-caller negative controls, unchanged voice guards and action-driven focus without delayed-response theft.
- TypeScript build passed after the final focus change. Copy gate passed seven scopes with 21 negative controls. Context graph and diff checks passed.

These fixtures do not prove real authentication, database behavior, uploaded-source authority, Azure quality, identity or voice likeness. The full clone goal remains open. The visitor UI is currently English apart from the existing localized sign-in; complete Hindi/Hinglish presentation and broader motion/design acceptance remain work. Screenshots establish readable layouts, not a claim of best-in-market design.

## Integration

This isolate starts at checkpoint25. Merge the reviewed UI files into the next candidate based on checkpoint26; do not replace the newer checkpoint26 test driver or context wholesale. Register `source.mjs`, `run.mjs` and `early-share.mjs` with the shared browser resource cap. The exact old CloneExperience fixture is intentionally retained for negative controls. New backend endpoints, schema143, real SQL acceptance, bounded native Azure proof and the complete release gate are required before enabling the feature.

Lost-body fixtures send response headers and a truncated body before disconnecting. Destroying a reused socket before headers caused a transport retry and was not a reliable one-request fixture. The existing client has no automatic POST retry.

## Integration review additions

Asking now has a dedicated 90-second client deadline so the generic 20-second read deadline does not cancel the bounded 45-55-second Azure operation. Status requests retain the shorter deadline. Three deterministic client-option controls include the removed-deadline failure; they are not latency measurements.

Stored link metadata no longer says that questions can be answered. The owner sees "Published link", then a separate bounded canonical public-open check confirms visitor access. Failed or unavailable checks retain Unpublish. Twelve mounted controls at both widths cover the exact previous false-ready implementation and late token, replica and unpublish responses, including transports that ignore cancellation. Final receipt: `scratchpad/publication-owner-availability/1788813502797/result.json`. Public-open acceptance does not establish Azure health or remaining model budget.

The integrated owner/visitor 28-check suite also passed at `scratchpad/text-publication-ui/1788813440261/result.json` before the final access-status wording adjustment. These are synthetic UI results, separate from real PostgreSQL acceptance.
