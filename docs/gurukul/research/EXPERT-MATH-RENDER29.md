# Readable expert equations

The real Azure comparison exposed two separate problems: the shared answer gate deleted display equations, and the two inspected answer views rendered surviving LaTeX literally. The independent gate repair retains the original content. This change renders explicit equations in the existing expert conversation and published-answer views.

## Implementation

`ExpertAnswer` preserves ordinary prose, Hindi/Hinglish text, currency and unmatched delimiters as React text. Only `\[...\]` and `\(...\)` enter a lazy, locally bundled KaTeX0.18.7 renderer. Native MathML avoids a remote service or font request. Each expression has a4096-character bound,200 macro expansions and10em size limit; at most64 expressions render per answer, with the full remaining text retained. Inputs over64000characters remain entirely literal.

Every expression has a fresh macro environment. Trust requests always refuse. Parser errors, trust refusals and KaTeX's controlled unsupported-command color retain the complete original expression. This last check matters because malformed URL protocols can refuse before the trust callback, and unsupported command formatting can otherwise discard arguments without throwing. The reserved color can conservatively leave a legitimate expression literal; it cannot delete that expression.

Equation components are keyed by position and complete source. Async cleanup prevents an old answer or unmounted component from adopting a late renderer result. Wide equations scroll inside their own container and become keyboard focusable only when needed. Source fallback retains multiline whitespace. No animation is added to mathematical content.

## Evidence and limits

The dependency is exact-pinned in package.json and package-lock.json, with registry integrity recorded in the lock. Its installation used this isolate's own node_modules; the dependencies of the running release28 were untouched. Root's final forced TypeScript, copy7scopes/21negative controls and diff checks passed on exec31660. The independent final mounted suite passed44groups at320/390/1440, using unchanged production and package hashes: `scratchpad/expert-answer-render/1788817303916/result.json`, SHA155eac9b33e9e7976924af0f030ee5c093d25feeb73e7dc2cf09f92712f6b1ff. Root separately inspected the retained320 screenshot: all four equations and conditional explanation are readable without page overflow. Complete integrated release validation remains pending.

The source reviewer found the refusal-content-loss issue and recommended the equation-count bound and multiline fallback. These were implemented before the final browser batch. Earlier35 mounted behavioral groups were intermediate only: the source changed, and the request-audit recorder itself required correction.

This is rendering evidence, not a new model-quality, voice, owner-likeness or competitor benchmark. The retained four equations are consumed regression material. These two consumers do not prove every Room, export, speech or historical transcript renderer. Native MathML accessibility and mobile behavior require actual target-browser verification; a Chromium run does not prove Safari or assistive-technology acceptance.

## Sources

- [KaTeX API and macro isolation](https://katex.org/docs/api), read2026-09-07.
- [KaTeX output, trust and resource limits](https://katex.org/docs/options), read2026-09-07.
- Installed pinned source: `node_modules/katex/src/Parser.ts` and `Settings.ts`, independently reviewed for refusal behavior.

Reversal condition: replace this renderer if target-browser testing cannot preserve complete readable content and safe local rendering. Never count silent omission or a hidden fallback as success.
