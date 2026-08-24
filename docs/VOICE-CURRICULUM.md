# Adaptive Voice Curriculum

The Voice Curriculum turns owner judgments into controlled evidence for a Voice Delivery Genome. It does not claim that a fixed preset is the person, and it does not train model weights from a handful of votes.

## Trial invariant

Within one blind comparison, the system holds these inputs constant:

- owner, replica, draft VoiceGenome version, and selected enrollment artifact
- cleaned prompt commitment and language
- pinned Chatterbox model commitment
- deterministic sampling seed
- disclosure, PerTh watermark, AudioSeal watermark, C2PA proof, and generation ledger

Only the server-assigned delivery condition may differ. The database rejects a preference unless both sealed generations occupy the assigned left and right sides of the same active trial.

## Search space

Seven bounded conditions cover a conservative one-dimensional identity-to-expression manifold. Each condition freezes Chatterbox `exaggeration`, `cfg_weight`, and `temperature`. The browser receives only an opaque trial id and side before voting. Condition names are revealed after the exact preference is committed.

The first five trials guarantee coverage. Later trials use a deterministic Bradley-Terry maximum-a-posteriori fit and choose pairs with a mixture of:

- expected Fisher information near the current perceptual boundary
- exposure uncertainty for under-tested conditions
- a repeat penalty for already-tested pairs
- rejection exploration when the owner chooses neither

Learning is language-specific and bound to the current enrollment artifact, VoiceGenome, and model commitment. Changing any of those starts a new evidence context.

## Convergence

`converged` is deliberately conservative. It requires at least 18 completed comparisons, all seven conditions covered, at least five exposures for the provisional champion, and a minimum latent-score margin. It means the discrete delivery search has separated under the current context. It is not a claim of human indistinguishability or production qualification.

## Privacy and erasure

The trial ledger stores a SHA-256 prompt commitment, never prompt text, transcript, or audio bytes. Private generations, trials, and preferences are deleted when their enrollment source is erased. Anonymous public authenticity receipts survive only so already-exported synthetic audio remains verifiable.

## Next research step

The discrete curriculum is a safe data-collection layer. The next model-learning stage should use its exact paired evidence to fit a versioned delivery adapter, then compare that adapter against the best discrete condition on held-out prompts, both supported languages, multiple sampling seeds, and noisy enrollment strata. No adapter should replace an approved VoiceGenome until preregistered ABX, identity, intelligibility, watermark, privacy, and latency gates pass.
