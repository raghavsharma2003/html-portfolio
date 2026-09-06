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

## Identity audio foundation (not an enabled identity verifier)

`POST /v1/analyze` now recognizes the signed operation `identity_audio_v1`.
It requires one capture input and `challenge_contract_sha256`; an independent
WAV, transcript, crop or nonce text is not an accepted request field. The
capture must be WebM (VP8/VP9 plus Opus) or MP4 (H.264 plus AAC), with exactly
one video and one audio stream. It decodes the complete audio locally to
24 kHz mono PCM16 WAV, bounds actual decoded frames to 720,000, and feeds
those exact serialized WAV bytes to the existing speaker measurement caller.
It does not trim, pad, separate, denoise, or synthesize identity audio.

The signed result schema is `vyakti.identity-audio.v1`, with
`challenge_contract_sha256`, `parent_sha256`, `speaker_input_sha256`,
`canonical` (base64 WAV, SHA, byte size, format, frame count and duration),
`transform` (name/version, exact parameters and their SHA, stream index and
actual ffmpeg/ffprobe version lines), plus existing speaker measurements and
`model_revisions`. This proves an authenticated ancestry claim, not identity
accuracy, visual liveness or lip synchronization. The JS adapter, versioned
challenge verifier and settlement predicates must validate and carry that
ancestry before this operation can open an identity gate. No verifier is
enabled by this service change.

Run the CPU tests from the repository root with Python 3.10+ and ffmpeg/ffprobe
on that process's PATH:

```text
python -B services/voice-evidence/test_identity_audio.py
```

The tests generate temporary synthetic WebM/MP4 captures and execute native
decoding. Missing ffmpeg/ffprobe is a failure, not a successful skip. The same
command runs during the image build; no Docker build is needed for a local
test. Tests compile the actual service request/signature/dispatch functions
in isolation and replace speaker measurement with an explicit spy. They do
not load GPU models or measure speaker fidelity. Genuine AAC priming/padding
that pushes decoded audio beyond 30 seconds is refused, even for a nominally
30-second container. UI duration limits are not decoded-duration guarantees.
