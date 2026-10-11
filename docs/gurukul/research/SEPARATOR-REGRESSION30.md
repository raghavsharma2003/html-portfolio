# Separator regression fixture repair

2026-09-08, based on frozen release29 f4235c6809128d00f336fb73b127e75afe6493b2.

The release suite failed before exercising the parser: its negative-control setup assumed the separator regex appeared exactly once in the generated engine. Math preservation added a separate expert prose splitter using the same regex, so the observed count became two. This was a fixture assumption failure, not evidence of incorrect separator output.

The mutation now targets the unique actual `raw.split(...)` companion branch. It asserts that the runtime changes and that reversing exactly that replacement restores the entire original runtime. The existing negative control still demonstrates two ghost bubbles and the lost review label with the old separator expression. The expert splitter and production sources are unchanged.

Validation: all eight retained parser/shared-gate groups passed on the actual generated engine. The first invocation could not import the missing ignored config; after installing only the already-pinned all-empty config, the suite ran successfully. No model, database or network call was made. The full release29 remains separately failed/pending and is not superseded by this focused result.

Reversal: if the companion branch moves or duplicates, fail the targeted setup and review the actual caller; do not mutate an arbitrary first regex occurrence.
