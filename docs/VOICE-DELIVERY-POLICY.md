# Voice Delivery Genome

Status: immutable draft-candidate control plane. No candidate can activate a
replica or enter a call until the held-out qualification phase is implemented
and passed.

## Why this is a separate artifact

A VoiceGenome describes acoustic identity evidence. A Voice Delivery Genome
describes how the pinned renderer should use bounded delivery controls for one
language and one exact VoiceGenome, enrollment artifact and model commitment.
Keeping these artifacts separate prevents a few expressiveness votes from
rewriting the person's acoustic identity.

## Build invariant

The builder accepts only completed `voice-curriculum/bt-active-v2` trials from
`voice-calibration-deck/v1`. Every comparison is bound to two sealed,
watermarked generations with identical text, language, identity artifact,
model and sampling seed. A build requires the curriculum's conservative
convergence gate, including at least 18 judgments and six prompt families.

The immutable candidate contains:

- the bounded champion control preset and runner-up key;
- per-condition latent estimates, exposure counts and rejection weight;
- aggregate evidence depth, prompt diversity and latent margin;
- commitments to the exact preference set, model, deck and algorithms.

It contains no prompt text, transcripts, audio, provider secret or free-form
instruction. A transaction rechecks ownership, adult self-identity, biometric,
training and inference consent, selected private evidence and the complete
preference snapshot before the candidate is inserted.

## No automatic promotion

Builds start as `draft`. New evidence creates a new version and retires older
drafts, but never promotes a candidate. The next protocol must preregister
held-out prompts and compare this policy against the strongest discrete
baseline over multiple seeds. Qualification needs owner ABX plus automated
speaker identity, intelligibility, artifact, latency, watermark and privacy
gates. Until then the candidate is research evidence, not a production voice.

## Erasure

Deleting the selected enrollment source deletes every derived Voice Delivery
Genome before processing artifacts are removed. Full replica erasure cascades
through the owner-bound ledger. Public authenticity receipts for already
exported synthetic media remain content-free and independent.
