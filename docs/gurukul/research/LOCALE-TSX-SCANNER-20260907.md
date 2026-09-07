# Locale gate: distinguish JSX prose from TypeScript

Checkpoint24's full release failed only `studio-locale`. The old regex treated the expression between two `querySelector<...>` type arguments in TeacherSheetStudio as an English text node. The focus behavior was correct; no production string or callback was changed to satisfy this test.

The scanner now uses the already-installed TypeScript parser and visits actual `JsxText` nodes. It preserves the three-English-word threshold and fails on malformed TSX. It excludes semantic `code` elements containing literal commands; sibling instructions and `pre` prose remain checked. Expression values and accessibility attributes remain outside this guard's historical scope and must not be claimed as covered.

Sixteen controls execute the old generic-selector false positive and exercise nested, adjacent, multiline, post-expression and punctuated prose; prose mentioning code words; localized expressions; comments, strings, attributes, Hindi and short labels; the narrow code boundary; and parse refusal. The first AST run detected two literal command examples in VoiceExperimentPanel. That failed run is retained. Structural code handling replaced a possible per-file or per-string exception, with a sibling-prose negative control.

Root final suite: 94 passed, zero failed, 2026-09-07, `scratchpad/studio-locale-checkpoint25-code-boundary.log`. No runtime behavior, SQL, model call or full-release acceptance follows from this fixture repair.
