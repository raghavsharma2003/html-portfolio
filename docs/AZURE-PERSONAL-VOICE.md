# Azure Personal Voice adapter

Status: production-shaped adapter, provider-specific owner capture and the
VoiceGenome-to-provider control plane are implemented and offline-qualified on
`voice-cloning`, 2026-08-24. No Azure Personal Voice request has been made, no
profile has been created and Limited Access approval has not been verified.

## Why this lane exists

Azure Personal Voice is a fast, grant-compatible challenger, not the permanent
identity substrate. Microsoft documents a verbal consent statement plus a
short clean prompt, profile creation in seconds, synthesis across 91 languages
and an Azure watermark on Personal Voice output. The current API is Limited
Access and may be used only for the business use case Microsoft approves.

Official references:

- [Personal Voice overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-overview)
- [Create consent](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-create-consent)
- [Create a voice](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-create-voice)
- [Use a voice](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-how-to-use)
- [Limited Access requirements](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/speech-service/text-to-speech/limited-access)

The `$2,000` Azure grant does not imply Limited Access approval. The registry
refuses this provider unless both the feature flag and a separate approval flag
are true.

## Trust boundary

Enrollment requires two distinct evidence classes:

1. a provider-specific verbal consent recording containing the exact current
   Microsoft statement, locale, voice-talent name and company name;
2. 30-90 seconds of selected clean target speech derived from approved private
   evidence.

The generic Vyakti liveness phrase is not reused as Microsoft consent. A
training source cannot also be relabelled as the consent source. The adapter
accepts only WAV/MP3, 5-90 seconds per file, no more than ten prompts and no
more than 30 MiB across the bounded request.

Private audio is downloaded only from the exact configured Supabase origin
with redirects disabled. Each file is hashed again before any paid reservation
or Azure mutation. Azure receives memory-only multipart files with synthetic
filenames; private storage paths and signed URLs are not stored in the spend
ledger.

The Studio records provider consent as native microphone PCM, resamples it to
24 kHz mono and emits a WAV locally. Raw samples never pass through a third
party or a generic media upload. The legal name is envelope-encrypted under a
dedicated provider-consent KEK; PostgreSQL stores neither the name nor the
rendered statement as plaintext.

The enrollment control plane accepts only an exact approved VoiceGenome
version. That version pins explicit enhanced WAV artifact IDs. The server then
selects at most one artifact per source, rejects fixture/test provenance and
third-party sources, and enforces a deterministic 30-90 second prompt set.
Five-minute reads are signed immediately before use and their rotating tokens
do not change enrollment identity.

## Provider lifecycle

The provider uses Custom Voice API `2026-01-01`:

```text
verified provider-consent audio
  -> create or recover consent resource
  -> wait for consent success
  -> create or recover Personal Voice profile
  -> store one opaque provider reference server-side

ready profile + disclosed text
  -> resolve speaker profile server-side
  -> synthesize pinned-base-model SSML
  -> raw 24 kHz / 16-bit / mono PCM
  -> Vyakti watermark, signing, provenance and revocation fence
```

Provider reference, consent id, speaker profile id, key, model and endpoint
never enter the browser. IDs and `Operation-Id` values are deterministic from
the immutable enrollment commitment. A settled retry may reuse only the exact
existing project/consent/profile tuple. An ambiguous provider outcome remains
`reconcile_required` and cannot automatically spend again.

Synthesis uses the fixed `raw-24khz-16bit-mono-pcm` wire contract already
consumed by the protected cascade player. User text is XML escaped and the
non-disableable spoken disclosure is part of the metered SSML. A version-pinned
base model is mandatory; a moving `Latest` model cannot silently change a
person's active voice.

Deletion removes both the Personal Voice resource and its provider consent
copy. A 404 is idempotent success. This provider deletion is one step inside
the larger replica erasure job, not a substitute for source, derivative,
relationship and key erasure.

The owner path marks the profile `deleting` and revokes runtime capabilities,
sessions and open generations before making the first provider call. A
separate authenticated reconciler runs every ten minutes and leases unfinished
deletions with a one-way token hash. It removes both Azure resources and only
then removes the local provider mapping. Ambiguous outcomes are retried with
30-second-to-six-hour exponential backoff; they never reactivate the voice and
never become a terminal "gave up" state. Provider identifiers and raw errors
are excluded from the append-only attempt ledger and public responses.

Erasure intentionally requires only the Azure endpoint and server key. The
new-cloning enable flag, Limited Access creation approval, TTS endpoint,
project and model configuration cannot strand an existing biometric copy when
they are disabled or changed.

## Spend control

Training and synthesis share migration 028's one atomic Azure ceiling:

- training reserves one profile request using
  `AZURE_PERSONAL_VOICE_USD_PER_PROFILE`;
- synthesis reserves UTF-8 bytes as a conservative multilingual character
  bound using `AZURE_PERSONAL_VOICE_SYNTHESIS_USD_PER_MCHARACTERS`;
- reserve and one-way begin happen before paid provider I/O;
- success settles exact deterministic units;
- uncertain outcomes retain their full reserve for operator reconciliation.

Rates come from the effective approved Azure resource/SKU immediately before
activation. No price is hardcoded.

## Required production configuration

```text
AZURE_PERSONAL_VOICE_ENABLED=true
AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED=true
AZURE_PERSONAL_VOICE_ENDPOINT=https://<resource>.cognitiveservices.azure.com
AZURE_PERSONAL_VOICE_TTS_ENDPOINT=https://<region>.tts.speech.microsoft.com
AZURE_PERSONAL_VOICE_KEY=<server secret>
AZURE_PERSONAL_VOICE_PROJECT_ID=<existing approved project>
AZURE_PERSONAL_VOICE_COMPANY_NAME=Vyakti
AZURE_PERSONAL_VOICE_BASE_MODEL=<fixed version, never Latest>
AZURE_PERSONAL_VOICE_USD_PER_PROFILE=<effective rate>
AZURE_PERSONAL_VOICE_SYNTHESIS_USD_PER_MCHARACTERS=<effective rate>
SUPABASE_URL=https://<private project origin>
CRON_SECRET=<strong Vercel cron bearer secret>
```

## Still closed

- Microsoft Limited Access approval and a live approved project;
- real synthesis quality, latency, cross-language identity and spend results;
- production Vyakti watermark, signing and C2PA adapters;
- sealed blind audio evaluation and promotion;
- end-to-end revocation/erasure against a live provider.

Until all of those pass, the Studio correctly reports voice training as
unavailable and production cloned speech remains blocked.

Offline gate:

```bash
node evals/run.mjs personalvoice
node evals/run.mjs providerconsent
node evals/run.mjs voiceenrollment
node evals/run.mjs voiceerasure
```
