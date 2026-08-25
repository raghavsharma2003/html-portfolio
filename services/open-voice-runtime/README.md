# Open voice runtime

This private GPU service is Vyakti's permission-independent zero-shot voice
lane. It uses the MIT-licensed Chatterbox Multilingual V3 model, supports the
official 23-language set including Hindi, and accepts one consented adult
self-reference WAV per request. It is not a public cloning API.

The deployment has two scale-to-zero apps. A small public CPU admission broker
validates the exact body HMAC, timestamp, nonce, replay window, and size before
forwarding to the environment-only GPU runtime. The GPU app is never directly
internet reachable, so random traffic cannot wake paid GPU capacity. Configure
the application plane's `AZURE_OPEN_VOICE_ORIGIN` with the Bicep
`publicAdmissionOrigin`, never `privateOpenVoiceOrigin`.

The image pins:

- the CUDA/PyTorch base image by its immutable linux/amd64 manifest digest;
- the admission broker's Python base by its immutable linux/amd64 manifest digest;
- Chatterbox source commit `5de7a54aa4e5e2baadb0182dde554908b48b85c2`;
- `ResembleAI/chatterbox` checkpoint commit `5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18`;
- every direct Python dependency in `requirements.txt`.

Models are downloaded while the image is built. Runtime network model access
is disabled. The service starts only with CUDA by default and only exposes an
HMAC-authenticated synthesis operation. Requests contain no owner, replica,
email, or provider identifiers. Access logs are disabled, audio is handled in
memory plus one automatically deleted temporary reference file, and output is
raw 24 kHz mono PCM.

Every input utterance must already begin with the exact audible disclosure
`This is an AI-generated voice replica.` Chatterbox's PerTh watermark is
verified before output is returned. The application plane must still add
Vyakti's independent AudioSeal watermark, signed segment chain, and C2PA
receipt before any preview reaches a browser.

Required configuration:

- `OPEN_VOICE_HMAC_SECRET`: at least 32 random bytes, hex or base64url;
- `OPEN_VOICE_REQUIRE_CUDA=true` in every deployed environment;
- `OPEN_VOICE_PERTH_MIN_SCORE=0.5` or a higher measured threshold.

The broker additionally receives the internal runtime origin from the Bicep
deployment. Both images must be published and supplied to the deployment by
immutable registry digest. Both apps disable request access logs.

This service does not claim quality from its architecture. Promotion requires
real consented ABX tests for speaker identity, accent, Hinglish, prosody,
noise robustness, hallucination, latency, and watermark survival.
