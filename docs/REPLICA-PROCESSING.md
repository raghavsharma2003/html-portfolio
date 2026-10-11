# Replica noisy-evidence processing contract

Status: deployable private evidence plane. The repository now includes exact-pinned open-model inference, a scale-to-zero Azure worker, private immutable storage, current malware scanning, media probing, Azure Speech, and atomic database settlement. Provider and model boundaries are still tested offline; no live quality claim or Azure spend has occurred.

This slice turns a quarantined self-replica audio/video source into immutable preprocessing candidates and cited evidence. It does **not** claim that denoising, ASR accuracy, diarization, embeddings, speaker selection, voice cloning, or human similarity are solved. Deterministic fake providers remain the default structural fixtures. The Azure adapter is real request/response code, but has only been exercised against mocked HTTP responses.

## Non-negotiable invariants

1. The upload at `<owner>/<replica>/<source>/original` is immutable evidence. A worker never writes to that path.
2. Separation/enhancement candidates are create-only objects below `<owner>/<replica>/<source>/derived/<transform-version>/...`. Multiple candidates remain beside the original; no “best” candidate replaces it.
3. Server-side integrity verification compares a streamed digest and byte count with the quarantined manifest before later stages run. Storage metadata checked at upload finalization is not treated as content integrity.
4. Every artifact and evidence row carries the owner, replica, source, creating job, input digest, adapter identity/version, and its own canonical manifest/record digest.
5. Composite foreign keys prevent a source, job, parent artifact, or evidence record from being joined across owner/replica/source boundaries.
6. A job is complete only after its referenced artifacts/evidence exist under that same leased ownership tuple. An adapter attempt is not an outcome.
7. Lease capabilities are returned to the worker once; only a domain-separated SHA-256 digest is stored. Expired leases are reclaimable and transient failures use bounded deterministic backoff.
8. VoiceGenome/person-profile builders are versioned and draft-only. Approval is a separate transition requiring integrity, third-party review, owner calibration, and a passing held-out evaluation using real evidence. Fake results cannot satisfy that gate.
9. Portable VoiceGenome/profile definitions cannot contain provider voice IDs, provider references, signed URLs, or external voice handles. Those belong only in disposable server-side voice-provider mappings.
10. A paid Speech adapter cannot issue network I/O without an atomic reservation under the shared Azure application ceiling. It rounds each request up to Azure's documented per-second billing unit, marks the request in flight immediately before `fetch`, settles processed billable duration, and blocks automatic retry after any provider-visible ambiguous outcome.

## Audio DAG

```text
quarantined original
  -> integrity
  -> malware_scan
  -> media_probe
  -> diarize
  -> separate (immutable target/foreground candidates)
  -> enhance (N immutable candidates)
  -> transcribe (candidate-cited transcript/language spans)
  -> voice_quality (multiple embedding families + distributions)
  -> human evidence review
  -> draft VoiceGenome
  -> calibration + real held-out eval
  -> explicit approval
```

Only audio and the audio track of video enter this DAG. Text, documents, images, chat archives, PII scanning, third-party classification, target-speaker confirmation, and visual processing must remain quarantined/blocked until their own reviewed worker stages exist. Unsupported input must not be silently coerced into this flow.

## Modules

- `api/_replica-processing/contracts.js`: canonical JSON/digests, server-derived paths, adapter validation, immutable artifact/evidence manifests.
- `api/_replica-processing/pipeline.js`: audio DAG, dependency checks, retry classification and backoff.
- `api/_replica-processing/queue.js`: atomic lease/reclaim and lease-token-bound complete/retry/stop transitions.
- `api/_replica-processing/worker.js`: one leased stage executor; adapters receive private input references and return normalized results.
- `api/_replica-processing/repository.js`: create-only persistence plus a production atomic commit that persists every manifest/evidence row, settles the lease, transitions the source and enqueues the next DAG stage in one PostgreSQL statement. Any immutable collision raises and rolls back the whole statement.
- `api/_replica-processing/runtime.js`: production lease/load/execute/settle loop with composite tenant scoping.
- `api/_replica-processing/storage.js`: exact private object reads and create-only derived writes with mandatory re-read and SHA-256 verification.
- `api/_replica-processing/builders.js`: source-set hashing, portable draft builders, approval readiness, and the model-build state machine.
- `api/_replica-processing/providers/fake.js`: test fixtures only. Its byte payload literally says `FAKE-NOT-AUDIO`.
- `api/_replica-processing/providers/azure-fast-transcription.js`: direct Azure Speech fast-transcription adapter with private inline upload, Hinglish locale normalization, deadlines and bounded error classification.
- `api/_replica-processing/providers/azure-voice-evidence.js`: HMAC-authenticated adapter for the private GPU evidence plane; no tenant/person identifier or signed URL crosses the service boundary.
- `api/_replica-processing/providers/native-media.js`: real private-byte integrity, ClamAV and ffprobe seams.
- `services/voice-evidence`: non-root CUDA service with exact-pinned SpeechBrain ECAPA, x-vector and SepFormer revisions, exact-digest DeepFilterNet3, and Silero VAD.
- `services/replica-processing-worker`: non-public Azure Container Apps Job which runs the complete DAG and exits.
- `db/migrations/017_replica_processing_manifests.sql`: attempt, artifact, evidence/decision and model-build records.
- `evals/replica-processing/run.mjs`: offline boundary suite, wired as `replicaprocessing` in the root eval runner.

## Adapter interfaces

All adapters expose `{ family, name, version }` plus one stage method. The current worker recognizes:

| Stage | Method | Normalized output |
|---|---|---|
| integrity | `verify` | digest, byte count, sniffed MIME |
| malware scan | `scan` | explicit `safe: true` verdict |
| media probe | `probe` | duration, sample rate, channels, codec |
| diarization | `diarize` | speaker segments with millisecond spans, confidence, target likelihood, overlap |
| separation | `separate` | one or more create-only byte-stream candidates |
| enhancement | `enhance` | one or more create-only byte-stream candidates with transform parameters and quality facts |
| ASR | `transcribe` | candidate-cited text/language spans and optional word alignment |
| voice analysis | `measure` | at least two embedding families, acoustic/prosodic/language distributions, and quality facts |

Adapter names are retained for reproducibility. They do not enter the public VoiceGenome as external voice/profile IDs.

An immutable artifact store must implement `writeImmutable({ bucket, objectPath, body, mime, expectedSha256, ifNoneMatch: "*" })`. A production store must stream bytes, compute or independently verify the digest, reject overwrites, keep the bucket private, and never persist a signed URL.

## First real adapter: Azure Speech fast transcription

Decision date: 2026-08-24. The adapter uses the Azure Speech synchronous fast-transcription operation:

```text
POST {speech-resource-endpoint}/speechtotext/transcriptions:transcribe?api-version=2025-10-15
Content-Type: multipart/form-data
audio: inline binary
definition: { "locales": ["en-IN", "hi-IN"] }
```

This interface was chosen over batch transcription for the first real integration because:

- the [official fast-transcription guide](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/fast-transcription-create) describes synchronous, faster-than-realtime transcription for uploaded audio;
- the [2025-10-15 REST reference](https://learn.microsoft.com/en-us/rest/api/speechtotext/transcriptions/transcribe?view=rest-speechtotext-2025-10-15) accepts inline multipart bytes and returns phrase offsets, durations, confidence, locale, speaker and word timestamps;
- batch transcription is intended for large sets/long files supplied through URLs or Azure containers, while this boundary must not disclose a private storage URL;
- no asynchronous job is created by this operation, so there is no polling or cancellation endpoint to implement. Cancellation aborts the in-flight HTTP request.

The official reference currently states a maximum of 250 MB and two hours per file. The adapter enforces those conservative limits even though another Azure overview page currently shows larger limits. Its default in-process byte cap is lower (64 MiB) to protect a serverless worker; callers may explicitly raise it, but never above 250 MB. Inputs are processed sequentially and capped at four candidates per job.

### Hinglish behavior

The default candidate locales are `en-IN` and `hi-IN`. Both appear in Azure's [Speech-to-text language support table](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support), and Azure's [language-identification guidance](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/configure-language-identification-diarization) recommends a small accurate candidate set for short/noisy recordings. Each returned phrase keeps Azure's locale, confidence and exact word offsets. `code_switch` means that Azure returned more than one phrase locale for that candidate; it is evidence to review, not ground truth about every word.

This default must be evaluated on real Hindi-English code-switching, Indian accents, names, informal speech and the project's actual noise distributions. Mocked phrases prove normalization only. They say nothing about Azure's word error rate, language labels, accent fidelity or downstream replica quality.

### Private input and authentication contract

`createAzureFastTranscriptionAdapter` requires all of the following explicitly:

- an HTTPS Azure Speech endpoint under `*.cognitiveservices.azure.com` or `*.api.cognitive.microsoft.com`;
- exactly one credential mechanism: an Azure Speech key or an async Microsoft Entra token provider;
- `resolveInput({ source, input, signal })`, which consumes the application's short-lived private read capability and returns `{ body, mime, byteSize }`.
- a worker-supplied `billing.beforeProviderRequest` capability; a direct or accidentally unmetered call fails closed before HTTP.

`body` can be bounded bytes, a Blob, or an async byte stream. The adapter recomputes SHA-256 and compares it with the immutable artifact manifest before contacting Azure. Resolver results containing `url`, `signedReadUrl` or `audioUrl` are rejected: Azure receives inline bytes, never the storage capability. Authentication stays in `Ocp-Apim-Subscription-Key` or `Authorization`; it is never added to a URL or multipart field.

The adapter has no environment defaults and no fake fallback. Missing endpoint, credential, resolver, duration, MIME, digest, word timestamps, locale or confidence fails closed. It does not log transcript text, response bodies, endpoints or credentials. Each input has a deadline and accepts the worker's `AbortSignal`. Network errors, timeouts, HTTP 408/409/429 and 5xx are retryable by the existing bounded job policy; authentication, invalid request/media, integrity and malformed-response failures are not. Azure response content is never copied into thrown errors.

### Region, billing and live prerequisite

Azure's [current Speech region table](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions) lists fast transcription in `centralindia`; it explicitly says `southindia` does not support Speech processing. The closest configured choice should therefore be a Speech or Azure AI Services resource in Central India, subject to quota availability. Keys are region-scoped and must match the resource endpoint.

Fast transcription is an Azure Speech meter billed per audio duration according to the [official Azure Speech pricing page](https://azure.microsoft.com/en-us/pricing/details/speech/), not a third-party marketplace endpoint. Microsoft's [startup sponsorship coverage policy](https://learn.microsoft.com/en-us/startups/benefits/technical-benefits/azure-credits/foundry-model-sponsorship-coverage) says services/models sold and billed directly by Azure are credit-eligible, but the policy page does not enumerate every Speech SKU or every grant offer. Before the first live call, confirm in the actual subscription that the Central India Speech resource can be created, its meter is covered by the user's specific $2,000 grant, a spend alert is active, and fast-transcription quota is nonzero.

The worker now reserves the sum of every immutable input duration under the
same database-serialized grant ceiling used by Foundry, rounding every
separately submitted file up to a full billable second. The reservation binds
the job revision/attempt and each artifact digest. A private-input or
authentication failure before network I/O releases the reservation. Once a
request can have reached Azure, any error becomes `reconcile_required` and the
job is non-retryable until an operator compares it with Azure billing. A
successful response settles processed billable audio duration. This is
structural metering tested with mocked boundaries; it has not been reconciled
against a live Azure invoice.

No resource, deployment, key, token, quota or live request was created by this implementation. The remaining live prerequisite is an explicitly approved Central India resource endpoint plus a key/Entra identity, private-object resolver wiring, deployed migration 028, verified subscription rate and coverage, an operator reconciliation procedure, and a small consented noisy-Hinglish evaluation corpus with a predeclared spend cap.

## Production evidence models

The GPU image bakes the public model weights into its immutable image digest. Runtime model networking is disabled.

- SpeechBrain ECAPA-TDNN and x-vector are kept as separate embedding families. Agreement must be evaluated across held-out sources; their vectors are never averaged into a misleading universal score.
- SpeechBrain SepFormer WHAMR returns two speaker outputs. Both survive as immutable artifacts.
- DeepFilterNet3 returns a capped 12 dB identity-preserving candidate and a full noise-suppression candidate for every separated input.
- Silero VAD plus ECAPA clustering supplies conservative speech/speaker regions. Because this version has neither verified target-anchor audio nor an overlap detector, it sets every `target_likelihood` to exactly `0.5`, reports overlap as unavailable, and cannot auto-select the subject.

That last limitation is a safety property, not a hidden quality claim. Owner speaker selection and a clean, liveness-bound target anchor are the next required product gate.

Run the two production-plane structural gates with:

```bash
node evals/run.mjs voiceevidence
node evals/run.mjs processingworker
```

## Worker transaction order

For a leased job:

1. Load the internal source row and completed dependency facts; reject any ownership mismatch.
2. For a paid Speech stage, reserve the complete immutable input duration and
   pass the unforgeable start hook to the adapter.
3. Execute exactly one adapter stage. The paid adapter marks spend in flight
   immediately before network I/O and returns measured usage.
4. Validate the normalized result. For derived bytes, write create-only objects and verify returned digests.
5. Settle paid usage before returning a successful worker result.
6. Atomically insert/verify every artifact and evidence row, settle the exact live lease and attempt, transition the source, and enqueue `result.next_steps` through `commitProcessingOutput`.
7. On any immutable collision, the database arithmetic guard raises and rolls the entire statement back. A job can never be marked complete against different bytes.
8. On a retryable adapter failure, record `retry`; on integrity/malware failure, record `blocked`; otherwise record `failed`. A provider-visible paid failure is reconciliation-blocked, never automatically retried. Never call completion from a catch/finally path.

Derived object creation occurs before the database transaction because storage and PostgreSQL cannot share a transaction. Object paths are deterministic and create-only; an exact-byte retry is accepted, while different bytes at the same path are a terminal collision. No database evidence row or next-stage job can be partially committed.

## VoiceGenome contents

The draft builder currently carries:

- accepted source, artifact and evidence IDs;
- input/output digests and transform lineage;
- multiple speaker-embedding families (kept separate, not averaged across families);
- pitch, energy, speaking-rate, pause, rhythm, phrase-boundary and paralinguistic distributions supplied as evidence;
- language/accent/code-switch observations;
- target speaker segments with confidence;
- the measured quality envelope and explicit exclusions;
- builder/schema version and a canonical source-set hash;
- required calibration layers.

Changing any accepted evidence digest changes the source-set hash and therefore requires a new build/version. Deleting a source must continue to retire affected genomes/profiles through the existing source-deletion control plane.

### Durable draft materialization

Migration 042 and `/api/replica-model-build-sweep` make the VoiceGenome builder executable. The cron-authenticated worker leases at most two builds per invocation with one-way, expiring capabilities; reclaims abandoned leases; rechecks current adult identity, biometric consent and training consent; loads only owner-accepted evidence from ready self-only sources; and refuses fake/test provenance. The exact accepted evidence plus private enhanced-artifact lineage is hashed before queueing and again before settlement.

Settlement never approves a genome. It writes an immutable `draft` and moves the build to `review`. Evidence decisions, source erasure and settlement share a fail-fast PostgreSQL arbiter, while settlement also locks the exact sources. A racing rejection or erase therefore wins cleanly or makes the worker retry; neither operation can miss the other's commit. Studio exposes only counts and a canonical manifest digest, never embeddings, storage paths or raw measurements.

Run its offline gate with `node evals/model-build/run.mjs`. This proves control-plane invariants, not the quality of upstream evidence.

## Reviewed transcripts to cited claims

Accepted target-speaker transcript spans can enter the separate private claim
extraction contract in `docs/CLAIM-EXTRACTION.md`. Processing evidence remains
immutable and is not rewritten into a model summary. The extractor masks
direct identifiers, verifies exact citations against the selected evidence and
writes only review-pending Person Model claims. Sources declaring third parties
and evidence from fake/test adapters are ineligible.

## Production work still required

- Build both images, deploy the checked-in Bicep with immutable registry digests, apply all replica migrations to a staging database, and run a tiny consented canary under a separately confirmed grant budget. Code being deployable is not evidence that this environment has been deployed.
- Live-validate ClamAV streaming, ffprobe, Supabase authenticated reads/create-only writes, the private GPU service, Azure ASR billing reconciliation, lease expiry and cancellation under real network failures.
- Add a liveness-bound clean target-speaker anchor plus explicit owner speaker-cluster and enhancement-candidate audition/selection. Until then target identity cannot be auto-approved.
- Add an independent overlap detector and evaluate diarization error rate, source-separation leakage, enhancement speaker-similarity regression, ECAPA/x-vector calibration, cross-source consistency, adversarial replay and spoof inputs.
- Add explicit third-party review, PII policy, deletion of rejected derivatives, and encrypted biometric retention controls.
- Establish real noisy/accent/code-switch corpora, human calibration protocols, anti-spoof/liveness tests and held-out identity/accent/prosody evaluations. Structural fake-provider tests are not evidence of model quality.
- Add stage DAGs for non-audio evidence. The audio next-stage enqueue is now in the same PostgreSQL statement as completion; retain that invariant if the database transport changes.

Run the bounded gate with:

```bash
node evals/replica-processing/run.mjs
node evals/run.mjs replicaprocessing
```
