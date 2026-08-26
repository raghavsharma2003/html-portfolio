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

## Per-expert fine-tuning seam (named, not built)

SPEC-GURUKUL.md §8.1 makes this lane the primary voice path and says it is
"fine-tuned per expert". **No training pipeline exists in this repository and
none is built here.** Fine-tuning needs GPU budget, a training image, a
curriculum and a held-out protocol, all of which are future work with an owner
spend decision in front of them. What exists today is the seam, written down so
that work lands against a named interface instead of rearchitecting the
service around itself.

The seam, in one line: **approved evidence set in, versioned model ref out, and
that model ref flows into the same fidelity gate every other voice passes.**

- **Input.** The approved VoiceGenome evidence set for one expert — the exact
  consented, owner-approved sources `services/voice-evidence` already measured.
  A fine-tune job may read no audio that is not in an approved genome version.
  The job identifies its input by genome version and source-set hash, never by
  owner, replica, person or email; this service takes no such identifiers today
  and a training job must not become the first thing that does.
- **Output.** A `voice_model_ref` — an immutable, versioned string naming the
  adapter/checkpoint, pinned the way `MODEL_COMMITMENT` pins the base
  checkpoint today (source commit + weights commit, hashed). One expert may have
  many model refs over time; a ref is never reused or mutated in place.
- **Where it lands.** `voice_model_ref` is a column on `vy_voice_fidelity`
  (migration 054). A new model ref supersedes the standing fidelity row for
  that voice profile, so a fine-tune cannot inherit the base model's fidelity
  pass — it is unmeasured until it is measured, and unmeasured never activates.
  That is the `cache-outlives-the-voice` lesson applied before it can bite:
  a stored verdict whose key does not name the voice it measured keeps covering
  a voice it never heard.
- **What the seam deliberately does NOT promise.** It says nothing about
  whether fine-tuning improves fidelity. That is a bench result
  (`context/decisions.md#platform-north-star`), and it is also the reversal
  condition for this lane being primary at all: if the self-hosted lane's
  fidelity bench stays materially below the vendor lane after fine-tuning
  effort, the order in `api/_voice/registry.js` flips back. Measured, not
  assumed.

The synthesis request already carries the shape a model ref would slot into —
`/v1/synthesize` binds a `model` and `model_commitment` in its signed response
and `api/_voice/providers/open-chatterbox-preview.js` verifies both against a
constant. A per-expert model turns that constant into a per-request expected
value; nothing else in the transport, the HMAC binding, the PerTh verification
or the PCM contract changes. That is the whole point of naming the seam now.
