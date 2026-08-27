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
- optional official `ResembleAI/Chatterbox-Multilingual-hi` checkpoint commit
  `82ca71273cc2a9ab19efdf8315f865c1a5af0ee7` (MIT model-card license);
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

### Explicit model arms

`OPEN_VOICE_MODEL_ARM=general` is the default and preserves the pinned general
Multilingual V3 checkpoint. `OPEN_VOICE_MODEL_ARM=hindi_v3` selects Resemble
AI's official Hindi single-language pack and refuses non-Hindi requests. The
same value must be used as the Docker build argument, the Container App Bicep
parameter, and the application-plane environment variable; every request and
signed response binds it.

Only one checkpoint is downloaded into an image and only one model is loaded
onto the GPU. The Hindi pack is an evaluation arm, not an automatic route from
a `hi` language tag: it has not yet passed Vyakti's owner ABX or measured cold
start. Existing LoRA adapters target the general checkpoint and are refused by
the Hindi arm until compatibility is qualified.

The Hindi Space vendors inference code that differs from the pinned upstream
source used by the general arm. The local loader mirrors its multilingual T3
and non-strict v3 S3Gen load, but refuses every missing or unexpected weight
key unless it is explicitly whitelisted. The arm remains unqualified until a
remote image build, health check, protected synthesis, cold-start/VRAM measure,
and blind owner ABX all pass. It must use a separate evaluation origin; never
replace the global origin, because the Hindi arm intentionally refuses English.

Language conditioning negotiates
`vyakti-voice-language-conditioning/v1` inside the signed v1 transport. General
arm rollout is safe in either order: the new app plane accepts a signed legacy
runtime response and labels enforcement unverified, while the new runtime
accepts the legacy request, preserves its CFG, and labels that path unverified.
Keep this compatibility until both revisions have been observed live.

The broker additionally receives the internal runtime origin from the Bicep
deployment. Both images must be published and supplied to the deployment by
immutable registry digest. Both apps disable request access logs.

This service does not claim quality from its architecture. Promotion requires
real consented ABX tests for speaker identity, accent, Hinglish, prosody,
noise robustness, hallucination, latency, and watermark survival.

## Per-expert fine-tuning seam (BUILT — WS-U, 2026-08-26)

SPEC-GURUKUL.md §8.1 makes this lane the primary voice path and says it is
"fine-tuned per expert". The training pipeline now exists:
`services/voice-finetune/` produces per-speaker LoRA adapters, this service
loads them per request, and `services/open-voice-runtime/lora.py` is the single
implementation both sides share. Read `services/voice-finetune/README.md` for
the training half.

**Two halves of the seam are built; one is not.** Built: training, transport,
loading, and the versioned model ref. **Not** built: persistence of that ref
onto `vy_voice_fidelity`, because a fidelity row still cannot be written at all
(`context/STATE.md` — it needs a voice profile, which needs `biometric` consent,
which needs a live human liveness challenge). Everything below marked *lands*
describes where it lands once that unblocks; nothing below is claiming it does
today.

### On the wire

`/v1/synthesize` accepts three optional fields — `adapter_id`,
`adapter_sha256`, `adapter_base64` — and omitting them takes the identical
pre-adapter code path. The adapter travels **inside the signed body**, so the
request HMAC that already admits the call covers it: the runtime gains no
credential, no store, and no second trust path. Every other check is unmoved —
the disclosure prefix is validated before an adapter is parsed, the PerTh
watermark is still verified before audio is returned, and the adapter is applied
around one `generate()` and removed in a `finally` so it cannot leak into the
next caller's voice on the shared model.

The signed response gains `synthesis_commitment` — the versioned model ref this
section used to only name:

```
synthesis_commitment = sha256(f"{MODEL_COMMITMENT}:lora:{adapter_sha256}")
```

and it collapses to `MODEL_COMMITMENT` exactly when no adapter is in play, so
every receipt and verifier that predates adapters is untouched. Both sides
derive it independently and `open-chatterbox-preview.js` fails the call on
disagreement, so a response that quietly dropped the adapter cannot be mistaken
for a fine-tuned one — which is precisely the measurement error that would
destroy a fine-tune-vs-zero-shot delta.

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
- **Where it lands** (*not yet wired — see above*). `voice_model_ref` is a column on `vy_voice_fidelity`
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

That last point still stands and is now the live reversal condition rather than
a hypothetical: the first measured fine-tuned-vs-zero-shot delta on this stack
is `context/measurements.md#lora-vs-zero-shot-71s`, and it is a 71-second smoke
test, far under the ≥30 min the Chatterbox community recommends.
