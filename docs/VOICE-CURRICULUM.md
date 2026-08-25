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

The protocol also assigns the sentence from a versioned English or Hindi/Hinglish
challenge deck. It rotates across identity, articulation, precision, emotion,
prosody, rhythm and breath domains before repeating a prompt. Repeated text is
down-weighted in the Bradley-Terry fit, preventing one familiar sentence from
dominating the learned boundary.

## Convergence

`converged` is deliberately conservative. It requires at least 18 completed comparisons, all seven conditions covered, at least six distinct prompt families, at least five exposures for the provisional champion, and a minimum latent-score margin. It means the discrete delivery search has separated under the current context. It is not a claim of human indistinguishability or production qualification.

## Privacy and erasure

The assigned deck text is public protocol material. The private trial ledger stores only its stable prompt key and SHA-256 commitment, never prompt text, transcript, or audio bytes. Private generations, trials, and preferences are deleted when their enrollment source is erased. Anonymous public authenticity receipts survive only so already-exported synthetic audio remains verifiable.

## Next research step

The discrete curriculum now feeds an immutable Voice Delivery Genome and a separate owner holdout over held-out prompts unseen during calibration and multiple sampling seeds. This still does not qualify production. No delivery policy should influence an approved runtime until automated ABX, identity, intelligibility, artifact, watermark, privacy, latency and noisy-enrollment-strata gates pass.
