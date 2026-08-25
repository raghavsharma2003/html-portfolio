# Private voice-evidence service

This service turns a bounded, consented audio source into immutable evidence. It does not clone, train, synthesize, or receive account/person identifiers.

Production models are baked into the container at exact revisions:

- SpeechBrain ECAPA-TDNN and x-vector provide two architecturally distinct speaker embeddings.
- SpeechBrain SepFormer WHAMR emits both speaker candidates. The service never guesses which one is the subject.
- Silero VAD supplies speech regions for conservative speaker clustering.
- DeepFilterNet3 emits both a 12 dB identity-preserving candidate and a full suppression candidate. The raw source is never replaced.

The HTTPS boundary is HMAC authenticated in both directions, binds the exact canonical request/response bytes, rejects replayed nonces, and accepts no durable signed URLs. Runtime network access for models is disabled. The service is non-root and request access logs are disabled.

This is deliberately not labelled a production diarization benchmark winner. Until a verified target-anchor capture and an overlap detector are added, `target_likelihood` is exactly `0.5`, overlap is reported as unavailable, and owner review remains mandatory.

Required deployment settings:

- `AZURE_VOICE_EVIDENCE_HMAC_SECRET`: at least 256 random bits, shared only with the private worker.
- `VOICE_EVIDENCE_REQUIRE_CUDA=true` in production.
- Private ingress with platform egress allowlisting. Do not expose this service publicly.
- One replica initially, scale-to-zero, and a strict Azure budget alert. Increase concurrency only after GPU-memory load tests.

