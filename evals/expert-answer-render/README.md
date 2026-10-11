# Expert answer rendering controls

Run `node evals/expert-answer-render/run.mjs` after the pinned package install. Suggested registry key: `expert-answer-render`, browser resource class. The suite owns one local Vite build, one Chromium process and a local ephemeral-port fixture. No real account, SQL, model or provider is involved. It uses actual KaTeX0.18.7 and actual ExpertAnswer, publication/private answer CSS and locally bundled fonts. It statically checks both production callers use ExpertAnswer; it does not claim full authenticated ExpertConversation or PublicationApp coverage.

The consumed synthetic fixture is an exact copy of evals/room-expert-answer/retained-grounding28-math.json in expert-math-gate29. It preserves raw and previously delivered text from the candidate arm's GROUND-EN-HYPOTHETICAL-63 case. Four original display equations and conditional/nonmeasurement qualifications must remain visible. This is rendering evidence, not a new model-quality or source-grounding experiment.

## Final evidence

Final mounted44 passed, receipt scratchpad/expert-answer-render/1788817303916/result.json. All tested production, consumer and package hashes are captured before the build and rechecked afterward. The run covers:

- 320/390/1440: ordinary text avoids the lazy renderer, four equations have visible native MathML and exact TeX annotations, Hindi/Hinglish prose remains intact, invalid and unmatched TeX stays literal, currency/HTML does not create active content, denied links/images/HTML commands and recursive macros cannot fetch or create anchors.
- At every width: complete source survives denied href/url/includegraphics, macro-expanded href and a malformed protocol with a control character; macro definitions do not leak to the next expression; oversized expressions and the complete remainder beyond64 expressions remain literal. Multiline fallback preserves newlines and pre-wrap.
- At every width: a wide equation receives a focusable labelled region, Tab reaches it, ArrowRight scrolls locally, Tab exits to the next control, and the document does not overflow horizontally. Resolved math replaced by invalid text never retains old markup.
- Held real KaTeX chunk: replacing text, replacing with malformed TeX or unmounting before import resolution prevents stale math from appearing. These use actual delayed local browser responses, not a fake KaTeX implementation.
- A retained plain-text-renderer negative displays raw TeX with zero MathML; actual private answer CSS contains the same four visible equations at320.

There were zero external request attempts, unexpected local routes or browser page errors. All fixture requests were GET. Screenshots retained for display equations and long scrolling at all three widths, Hinglish at all three widths and private320. Inspected retained320/1440, Hinglish390 and scroll320: fractions, powers and units are readable, source qualification remains present, the narrow long equation scrolls with a visible focus ring. This is Chromium visual/keyboard inspection, not screen-reader certification, Safari/Firefox proof or a timing benchmark. One Impeccable detector pass returned[].

## Retained intermediate failure

Intermediate1788817198165 completed35 behavioral groups but exited1 because the fixture request recorder accidentally stored the method function instead of calling method(). Its report therefore omitted every method and the final GET assertion failed. Correcting only that recorder fixes the audit; it is not evidence of an application POST. Root's independently reviewed trust/source-preservation and64-expression/multiline changes occurred before the final batch and are covered by its stronger44 controls. Production was not changed by this test agent, and the intermediate result is retained rather than relabelled successful.

## Review rationale and limits

KaTeX documents that mathml output produces MathML; throwOnError handles parse failures, trust:false may render unsupported commands in errorColor rather than throw, maxExpand bounds expansion and macros objects may carry definitions between calls. These details motivate exact raw preservation, deny-command and per-expression macro controls. Official source: https://katex.org/docs/options.html (read2026-09-08). The implementation's refusal callback plus reserved error-color check was root's repair after independent source review; tests assert its externally visible result.

Decision: render only explicit bounded math delimiters, retain complete literal source when unsupported, and preserve ordinary answer text. Reversal: any missing source text, active content, unbounded instances, stale render after scope/text change or unreadable/overflowing supported equations. Rejected shortcuts: no-anchor checks alone cannot prove denied command arguments survive; mocked renderer success cannot prove real MathML; a green disabled/loading state is not completion. Root owns context/registry integration and full release. No publication authority, answer facts, model prompts or serving gates were edited here.
