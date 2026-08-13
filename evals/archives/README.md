# Archived bake-off data — the D0 validity fixtures

These are the judged transcripts and battery outputs from the three model
bake-offs that measured the identity ceiling (`charm-grok`, `charm-luna`,
`realtime-azure` in `context/`). They are the ground truth for **D0** in
docs/SPEC.md §14: any swap-detection battery must FLAG all three before its
verdicts are trusted — a battery these pass is broken.

They lived only in a session scratchpad until 2026-08-13; a container reap
would have destroyed the only known-bad corpus this program has. Audio (.wav)
was not archived — transcripts and judgments carry the evidence; regenerating
audio is possible, regenerating blind judgments of the original runs is not.

- `charm-grok/` — personality battery vs grok, blind counterbalanced, 48 convs
- `charm-luna/` — the luna tie (A-before-* judged sets)
- `realtime-azure/` — register/guarantee probes from the gpt-realtime battery
