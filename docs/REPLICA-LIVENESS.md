# Replica liveness and biometric consent

Status: the fail-closed control plane, durable worker, owner polling and a
production-shaped Azure broker adapter are implemented. No production verifier
has passed a user. Azure Face liveness access, an approved identity reference,
the browser Face SDK and the Azure-hosted composite service are still external
release blockers.

## Why one score is not enough

Voice matching is not liveness. Microsoft's Speaker Recognition documentation
explicitly says its API is not intended to determine whether audio came from a
live person and recommends random phrases as replay resistance. Azure Face
liveness is separately gated and uses short-lived client session tokens. The
platform therefore refuses to average weak signals into a pass.

A liveness pass requires every gate:

1. exact server-issued phrase binding and exact six-digit random code;
2. scripted-speech similarity above the frozen policy threshold;
3. live-face decision/score above threshold;
4. face match to the separately verified identity reference;
5. one speaker with audio/visual speaker continuity;
6. synthetic/replay risk below threshold;
7. evidence hash equality and one audio+video capture binding;
8. a pinned verifier bundle and explicit provider acceptance.

The thresholds in `LIVENESS_VERIFICATION_POLICY` are provisional release
thresholds, not vendor-independent probability claims. They must be calibrated
on consented genuine attempts, print/screen replays, injected audio, face swaps,
voice conversion, codecs, low light, packet loss and demographic slices before
production activation.

## Owner flow

The Studio issues a five-minute Hindi/English phrase containing an unpredictable
code and a narrow spoken biometric-consent statement. Only voice plus live-face
video is accepted. The browser asks for camera and microphone access, records
locally, lets the owner review or retake, hashes in a worker, and uploads only
after an explicit click.

Object-metadata finalization does not equal verification. It moves the exact
challenge-bound file to private quarantine and the scheduled worker later
leases it. Studio polls the owner-only challenge state and cannot mark itself
passed.

## Verification boundary

The worker leases only quarantined, single-subject video belonging to a
non-revoked adult self-replica with identity verification already present. Raw
lease capabilities are never stored. Expired work is reclaimed, ambiguous
provider outcomes retry forever with bounded backoff, and every attempt is
append-only.

The adapter sends a two-minute signed private-media URL, exact media SHA-256,
challenge phrase/hash and pinned verifier version to one allowlisted Azure
Container Apps or App Service endpoint. Both request and raw response are
HMAC-authenticated. A network-success response with a bad signature, wrong
request ID, wrong media hash or moving model version is rejected.

The broker response is reduced in memory to a fixed content-free verdict. Raw
transcript, face image, voice embedding, media URL, provider reference and
provider error body never enter PostgreSQL. A pass atomically sets
`liveness_verified_at` and creates a 90-day, evidence-bound biometric consent
receipt. Training and inference remain separate permissions.

## Required production configuration

```text
REPLICA_LIVENESS_VERIFIER=azure_face_speech_composite
AZURE_COMPOSITE_LIVENESS_ENABLED=true
AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED=true
AZURE_COMPOSITE_LIVENESS_ENDPOINT=https://<service>.azurecontainerapps.io/v1/liveness/verify
AZURE_COMPOSITE_LIVENESS_HMAC_KEY_B64=<32 random bytes, base64>
AZURE_COMPOSITE_LIVENESS_VERSION=<pinned composite model manifest>
CRON_SECRET=<strong scheduler bearer secret>
```

The broker must run with network egress restricted to the private storage and
approved Azure AI endpoints, no request logging, bounded concurrency, managed
identity where available, and zero retained media/transcripts. The web app must
integrate the gated Azure Face liveness client before the external release gate
can open.

## Primary references

- [Azure Face liveness overview and gated SDK](https://learn.microsoft.com/en-us/azure/ai-services/face/tutorials/liveness)
- [Azure Face liveness session REST API v1.2](https://learn.microsoft.com/en-us/rest/api/face/liveness-session-operations/create-liveness-session?view=rest-face-v1.2)
- [Azure Speaker Recognition API limitations](https://learn.microsoft.com/en-us/rest/api/speakerrecognition/)
- [Azure Speech short-audio and scripted pronunciation assessment](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short)

Offline gate:

```bash
node evals/run.mjs livenessverify
```
