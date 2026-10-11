# Release 56 continuity authority regression control

2026-09-08. Base: fd6cb49d. Scope: eval only; production authority unchanged.

Decision: replace the obsolete whole-global-SQL inclusion assertion with exact verification of the two permitted transformations: selected-owner-private authority and the required replica projection. Both retrieval and source-peek SQL must retain the complete derived authority. Reverse this test adaptation if production returns to a single global runtime authority or evidence shows the private selector bypasses consent/current-source guards.

Rejection: requiring the untouched global authority string in private recall fails after migration 156 intentionally selects an independent owner-private capability. Removing the assertion entirely or accepting arbitrary SQL would lose a useful security regression check. Repeating an identical synthetic callback under two lane labels would not prove the two authorization paths, so the new callback test explicitly claims only actual caller control flow.

Measurement: 2026-09-08, one serial run each, exit 0: private-continuity 26 offline controls; existing candidate-activation-runtime/private-pointer 8 groups; existing denied-callers 9 groups. Used an inert gitignored config with SHA256 728dc5821336bed9c5ad851b3e837a54d342674923de81454ce11b0a2d48a432. No SQL, provider, browser, build or performance run.

Negative controls reject missing projected replica fields, replacement of derived authority with global-only authority, and removal of current selected capability/base state/owner/profile/calibration predicates. Existing source lifecycle, encrypted visitor isolation and publication opt-in checks remain. Runtime fixture controls execute production loader/routing functions for selected private versus baseline and denied callers; mocks do not execute PostgreSQL predicates.

Remaining: root review/integration and full release verification. This patch neither changes product permissions nor establishes database authorization, voice fidelity or release readiness.
