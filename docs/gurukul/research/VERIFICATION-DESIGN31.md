# Verification permission refinement

Based on UI30 commit42e19f5118dbc45e5c007e5e287dfafd41b52a82, 2026-09-08.

The mobile permission screen repeated eight large bordered cards and exposed server-verifier terminology. The existing verification journey now presents the same eight explicit choices as compact labelled rows, with two descriptive legends and plain wording. The recording date remains visible in its summary. No permission defaults, statement keys, issue payloads, readiness rules or recording bindings changed. The primary action and uncertain-request recovery are preserved.

Validation:24 mounted controls at390/1440 passed in the actual journey/client fixture, including changed selection/consent, late responses, aborts, unavailable state and explicit readback after an interrupted issue response. Root inspected both retained layouts. An independent source review found no loss of permission meaning or caller safeguards. Forced TypeScript, copy law (7scopes/21negative controls), diff check and the Impeccable detector passed.

Receipt: scratchpad/selected-reference-comparison/1788819932994/result.json. This is a focused refinement, not acceptance of the full Studio, complete identity service or voice quality. The captured positive verification state is synthetic; actual missing provider capabilities remain unavailable.

Reversal: restore or revise any wording that user comprehension testing shows obscures a permission. Keep every explicit choice and the selected-recording binding during further simplification.
