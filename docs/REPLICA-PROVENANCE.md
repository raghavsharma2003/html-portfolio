# Replica output provenance contract

Status: delivery architecture, production tenant-bound Neon ledger adapter and
offline deterministic gate. No production watermark model, signing key, public
verifier, C2PA claim generator, or live replica synthesis is connected yet.

## What this protects

Replica quality may target acoustic indistinguishability in consented blinded
evaluations. Released media must never be operationally indistinguishable from
an unlabelled human recording. The delivery boundary therefore requires four
independent signals:

1. a fixed audible disclosure rendered before replica speech;
2. a robust watermark over the disclosure and replica audio;
3. signed, content-free hash-chain receipts committed before protected PCM
   segments are released to a realtime consumer;
4. a final C2PA 2.4 Content Credential bound to the exact protected asset.

UI disclosure and an audit row are also required, but neither substitutes for
media-bound evidence.

The architecture follows the [C2PA specification](https://spec.c2pa.org/specifications/)
for signed provenance and uses [AudioSeal](https://github.com/facebookresearch/audioseal)
as the first planned streaming-watermark baseline. AudioSeal is MIT-licensed,
supports streaming in its current release, and can embed a 16-bit message. The
small message space is a detection/routing signal, not a globally unique output
identifier. Exact attribution comes from the signed segment chain and final
asset credential.

## Why a final receipt is not enough

In a realtime call, playback starts before the final audio hash exists. If the
system only signed after the call, a crash could release audio without a
verifiable record. `protectReplicaStream` closes that gap:

```text
provider PCM
 -> fixed house-voice disclosure
 -> streaming watermark
 -> 240 ms protected PCM segment
 -> hash(previous chain + segment commitment)
 -> sign and persist content-free segment receipt
 -> release that segment
 -> repeat
 -> final protected-audio hash
 -> signed C2PA manifest bound to that hash
 -> signed public generation receipt
```

Segment receipts contain byte offsets, byte lengths and hashes, never PCM,
text, transcripts, memories, owner ids, replica ids, provider ids or storage
paths. They remain verifiable if a call aborts or replica data is later erased.
The operational generation row remains owner/replica-bound and is deleted with
the replica.

The production Neon ledger rechecks both `vy_replica.lifecycle='active'` and
the exact runtime capability's `state='active'` in the same statement that
persists each segment receipt. `protectReplicaStream` awaits that insert before
yielding the segment. Revocation therefore fences subsequent delivery at the
next 240 ms segment boundary even when a serverless stream is already open.

## Authorization gate

No protection adapter is called unless all of the following are true:

- request, owner, replica, voice profile, VoiceGenome and person profile ids
  bind to the same tenant;
- the replica is a verified living-adult self replica in `active` state;
- current-policy inference consent is active and unexpired;
- the voice profile is ready and both VoiceGenome/person profile versions are
  approved;
- identity fidelity, noisy robustness, behavior, relationship, privacy, abuse
  and provenance qualification suites all have passing verdicts;
- the channel is private Studio preview, private chat or private call.

Public sharing, downloadable assets, API use, outbound telephony and bulk
generation are absent from the allowlist.

## Adapter boundary

Production must provide non-test implementations for:

- disclosure rendering;
- streaming watermark embed/detect policy;
- C2PA manifest generation and signing;
- ledger/segment persistence;
- signing through a protected key service or HSM;
- watermark-token issuance;
- privacy-preserving replica commitments.

The registry refuses adapters marked `testOnly` or named fake/test unless the
caller explicitly enables the offline override. The included deterministic
adapters prove control flow, failure behavior, exact hashes, abort semantics
and response shape only. They make no robustness, perceptual-quality or
standards-conformance claim.

## Required production qualification

Before activation:

- run AudioSeal and at least one independent watermark baseline through
  resampling, MP3/AAC/Opus, telephony, clipping, noise, speed/pitch changes,
  splicing, partial capture and adversarial removal;
- measure watermark true/false positive rates separately from message recovery;
- validate C2PA manifests and certificate chains with an independent verifier;
- rotate and revoke signing keys without invalidating historical verification;
- test segment-ledger crash recovery, duplicate delivery, replay and ordering;
- prove replica erasure removes operational identity links while public
  receipts remain non-reconstructive;
- independently red-team disclosure removal, watermark forgery and cross-tenant
  receipt substitution.

Offline command:

```bash
node evals/run.mjs replicaprovenance
```

The gate currently has positive and negative controls for authorization,
ownership, qualification, fake-adapter refusal, disclosure, watermarking,
signed segment chaining, exact audio hashing, C2PA asset binding, aborts and
post-erasure receipt privacy.
