# Typed owner calibration

Status: implemented control-plane and Studio slice on `voice-cloning`,
2026-08-24. It does not yet prove behavioral fidelity or provide a production
behavior-generation model.

## Why it is not a prompt editor

Replica corrections are long-lived evidence. Appending each correction to a
system prompt creates contradictions, loses history and lets arbitrary text
become privileged instructions. Vyakti instead presents versioned,
server-owned contrast pairs and stores the owner's choice as an append-only
preference event.

```text
safe contrast pair -> owner choice -> append-only revision
                                  -> deterministic calibration policy
                                  -> exact runtime capability binding
```

The first battery covers delivery, language, behavior, memory uncertainty and
relationship expression. The alternatives are both safe; they distinguish
plausible styles rather than asking the owner to choose between a good and an
obviously harmful response. `tie` preserves genuine equivalence and `neither`
marks an unresolved axis instead of forcing false evidence.

## Trust boundaries

- Scenario ids, revisions, alternatives, hashes and runtime directives are
  server-owned.
- The browser can submit only scenario id, left/right/tie/neither and bounded
  confidence. It cannot submit candidate refs or policy JSON.
- Free-text notes are private review metadata and never enter a built policy.
- Every preference is scoped to owner and replica and records which approved
  Person Model was current when the choice was made.
- Revisions append and cite the preference they supersede.
- Client responses omit pair hashes, candidate refs and runtime directives.

## Deterministic policy

`calibration-builder/v1` takes the latest valid revision for every known pair.
Its source-set commitment binds the Person Model version, preference ids, pair
hashes, revisions, choices and confidence. A minimum ready policy has seven
resolved contrasts and covers all five core layers.

Builds are source-set idempotent. Approval recomputes current preferences
server-side and promotes only the exact matching draft. An approved policy is
then referenced by `calibration_version` from runtime capabilities, evaluation
runs and generation records.

Only a correctly versioned builder definition and strategy ids found in the
server registry can compile to runtime directives. A forged strategy, wrong
layer, unversioned policy or arbitrary JSON field is ignored.
The protected replica commitment binds the voice profile, VoiceGenome, Person
Model and calibration versions, so a receipt cannot ambiguously refer to a
moving behavioral identity.

An active capability keeps its frozen Person Model and calibration approved
when a newer version is approved. This permits deliberate upgrades without
silently altering or breaking a live session.

## Still closed

- generated A/B responses grounded in the owner's real evidence;
- active-learning task selection from measured uncertainty;
- speech/prosody and multimodal comparison playback;
- learned rerankers, adapters or preference fine-tunes;
- production replica dialogue using the compiled policy;
- human behavioral-fidelity, contradiction, privacy and abuse qualification.

Offline gate:

```bash
node evals/run.mjs replicacalibration
```
