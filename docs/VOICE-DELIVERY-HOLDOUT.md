# Voice Delivery Owner Holdout

Status: implemented owner-only qualification layer. It is intentionally not a
production qualification or an indistinguishability claim.

## Separation from calibration

Calibration uses `voice-calibration-deck/v1`. Qualification uses six different
English or Hindi/Hinglish prompts committed as
`voice-delivery-holdout-deck/v1`. Database constraints require every holdout
trial to reference one immutable Voice Delivery Genome and prevent any holdout
row from entering the Bradley-Terry calibration history.

Each prompt is judged twice with two deterministic, policy-bound sampling
seeds. The frozen champion is compared blind against its strongest calibration
runner-up. Candidate side is deterministically counterbalanced and not returned
before judgment. All other generation inputs and the full protection pipeline
remain identical.

## Owner verdict

The preregistered deck has 12 exact cells: six unseen prompts by two seeds. A
result cannot be finalized unless every cell has one completed protected pair.
Ties score one half; `neither` scores zero and makes a pass impossible. An owner
pass requires both:

- candidate score rate of at least 0.75; and
- the 95% Wilson lower bound above 0.50.

With 12 cells this effectively requires strong, consistent preference rather
than a bare majority. The immutable qualification commits the exact preference
ids, pair hashes, prompt keys, seed indices, deck, protocol and parent policy.
It stores no prompt text or audio.

## Deliberate firewall

`owner_pass` does not update the delivery-policy status, VoiceGenome status,
runtime capability or replica lifecycle. Production remains locked until real
automated gates measure speaker identity, intelligibility, audible artifacts,
latency, watermark survival, provenance and privacy over separate test data.
That separation prevents a favorable self-evaluation from being mislabeled as
world-class or human-indistinguishable performance.
