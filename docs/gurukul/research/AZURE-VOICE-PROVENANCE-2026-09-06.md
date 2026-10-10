# Azure voice deployment provenance

Read-only ARM audit, 2026-09-06. No runtime or provider request, warming, deployment, job start, secret-list operation or scale change occurred.

## Answer to the fine-tuning question

A real owner-specific Chatterbox LoRA training experiment exists, and Azure still has its manual training job plus a historical successful execution. This does **not** prove the ordinary Studio preview currently selects the trained adapter. The normal source path is reference-conditioned cloning; optional adapter transport exists, but its ordinary production caller remains unproven.

IndicF5, Qwen3-TTS and the other evaluation deployments must not be described as our accepted fine-tuned owner models. Their container identity can be checked separately from model quality, adapter selection and human acceptance.

## Fresh control-plane evidence

The existing authorized service-principal API session listed 33 resources, including 15 relevant Container Apps and two jobs. Sixteen of these 17 container images are digest-pinned. All ten active application revisions reported ScaledToZero, Healthy and zero replicas. Their images matched their applications' current template images. Five applications had no active revision. Every application retained minReplicas=0; no setting was changed.

No allowlisted explicit MODEL/REVISION environment identifier was present in the sanitized readback. Model snapshots may be baked into the images; ARM configuration alone cannot inspect or verify their internal manifests. Only environment names, secret-reference booleans, presence booleans and explicitly safe model identifier fields were retained; no secret values were printed or saved.

| Resource | Configured image | Scale or trigger | Repository digest evidence |
|---|---|---|---|
| `vyakti-open-voice-admission` | `vyaktivoiceacr.azurecr.io/open-voice-admission@sha256:b6786b4d3c99bf6731cc4d0059233f363a910c93406dfa54d3d26fbe4d47b64e` | 0 to 2 | `context/measurements.md`, `docs/gurukul/research/VOICE-CLONE-RELIABILITY-QUALITY-AND-PHONELLM-2026-08-29.md` |
| `vyakti-voice-evidence` | `vyaktivoiceacr.azurecr.io/voice-evidence@sha256:b2e2b74349ee8d1e2f3d346ea5bf070a5dcf4808ca8b4cd39845ae20dbd83914` | 0 to 1 | `context/STATE.md`, `context/measurements.md` |
| `vyakti-open-voice` | `vyaktivoiceacr.azurecr.io/open-voice-runtime@sha256:625edc223f7063e744d6463dd7443daeaa7097552997a7a4e47c99888cfa86d8` | 0 to 2 | `context/measurements.md` |
| `vyakti-voice-finetune` | `vyaktivoiceacr.azurecr.io/voice-finetune:v3` | Manual job | Mutable tag: exact image digest unavailable |
| `vyakti-media-extract` | `vyaktivoiceacr.azurecr.io/media-extract@sha256:b5e23f0b89faf2f4178dfb213c5db48ba9173d250ad65d093f390790e9dd842f` | 0 to 2 | No exact digest match found in inspected repository paths |
| `vyakti-replica-processing` | `vyaktivoiceacr.azurecr.io/vyakti/replica-processing@sha256:e521b8f38c7bcf4401927c6f264c5b6fb728277a7a6136169a4a3c1fa723b63c` | Schedule job | `context/measurements.md` |
| `vyakti-audio-protection` | `vyaktivoiceacr.azurecr.io/audio-protection@sha256:a5c12a02f2f0d380dbff786bab34db743aac0385860f05f615f41d2b73985079` | 0 to 3 | `docs/gurukul/AZURE-DEPLOY-STATE.md`, `context/measurements.md` |
| `vyakti-open-voice-hi` | `vyaktivoiceacr.azurecr.io/open-voice-runtime-hi@sha256:9dc374366a6ac9c1d2569e4e824faca12321679e24941e4e345319aca8576b83` | 0 to 1 | `context/measurements.md`, `docs/gurukul/research/VOICE-CLONE-RELIABILITY-QUALITY-AND-PHONELLM-2026-08-29.md` |
| `vyakti-open-voice-hi-gate` | `vyaktivoiceacr.azurecr.io/open-voice-admission@sha256:e6539e6975eff9dd90db570cdf735c2ad245ead8da74269d6b69d111e3cadde9` | 0 to 2 | `context/measurements.md`, `docs/gurukul/research/VOICE-CLONE-RELIABILITY-QUALITY-AND-PHONELLM-2026-08-29.md` |
| `vyakti-qwen3-tts-en-eval` | `vyaktivoiceacr.azurecr.io/vyakti/qwen3-tts-en-eval@sha256:e6ee1143498b495c76d99e5748452a8bc3cf942a8ae1f9268559a919ad26a988` | 0 to 1 | `context/measurements.md` |
| `vyakti-qwen3-tts-en-gate` | `vyaktivoiceacr.azurecr.io/open-voice-admission@sha256:3229c6479f83a0864faa0a2f81d43402b115341bbac318209d5b97c8463ceeb1` | 0 to 1 | `docs/gurukul/AZURE-DEPLOY-STATE.md`, `context/rejected.md`, `context/measurements.md` |
| `vyakti-indicf5-eval` | `vyaktivoiceacr.azurecr.io/vyakti/indicf5-eval@sha256:3b88af8804d64d4be224c38fdfc4b68739cdf384b2ce1e7c1d271404c4a1a28f` | 0 to 1 | `context/measurements.md` |
| `vyakti-indicf5-eval-gate` | `vyaktivoiceacr.azurecr.io/voice-admission@sha256:f07baa8fc0ccc4eab72151b51ad84c57f0504a08bc981bdd7fb0b9c236fdca2a` | 0 to 1 | `context/measurements.md` |
| `vyakti-voxcpm2-eval` | `vyaktivoiceacr.azurecr.io/voxcpm2-eval@sha256:40df335c38bf98b2eee6bf496c2f7ac9285c6bd572014abc7d7662134436f697` | 0 to 1 | `context/measurements.md` |
| `vyakti-voxcpm2-eval-gate` | `vyaktivoiceacr.azurecr.io/open-voice-admission@sha256:3229c6479f83a0864faa0a2f81d43402b115341bbac318209d5b97c8463ceeb1` | 0 to 1 | `context/rejected.md`, `context/measurements.md`, `docs/gurukul/AZURE-DEPLOY-STATE.md` |
| `vyakti-openvoice-converter-eval` | `vyaktivoiceacr.azurecr.io/vyakti/openvoice-converter-eval@sha256:ba777d18345fe308fb02ec59190575d0d174ac3242a8dc75c30c650755a8eb64` | 0 to 1 | `context/measurements.md`, `context/decisions.md` |
| `vyakti-openvoice-converter-gate` | `vyaktivoiceacr.azurecr.io/vyakti/openvoice-converter-gate@sha256:ee3c3a8b0192ebc4524c8cb38551f4346906206cf2b6acbdc735d0823c36b100` | 0 to 1 | `context/measurements.md` |

An exact digest string match means the current ARM image identity occurs in repository evidence; it does not mean a new synthesis or benchmark was run. The media-extract digest had no exact match in the inspected context/docs/services paths, so its relationship to a particular source revision remains unverified here.

## Fine-tune job readback

`vyakti-voice-finetune` exists as a manual job, with replica timeout 7,200 seconds, retry limit zero, parallelism one and completion count one. Its image is `voice-finetune:v3`, a mutable tag rather than a digest. Recent execution metadata includes a Succeeded execution from 2026-08-26 12:50:04 UTC to 12:54:43 UTC and an earlier Failed execution starting 12:40:12 UTC. No new execution was started and no logs or private checkpoint artifacts were downloaded.

That timestamp corroborates the historical training lane. The repository measurement `lora-vs-zero-shot-71s` records 60 epochs, a one-speaker 71-second source and ECAPA mean 0.775278 to 0.795857 over two runs per arm. Its training-time figure covers the training operation, while the ARM execution spans broader job startup/teardown; they are not contradictory timing metrics. No held-out partition or blind human acceptance was established. The mutable job tag cannot identify today's exact container bytes or recovered adapter checkpoint.

The processing job remains scheduled every two minutes, with timeout 3,600 seconds, retry limit one and parallelism one. Its five returned recent executions were Succeeded. Successful scheduled executions do not prove a particular user's source was processed or that a trained adapter was promoted.

## What remains to prove before saying we use the owner fine-tune

1. Identify the exact adapter artifact hash, base model commitment and owner/source provenance without exposing its private contents.
2. Prove the ordinary owner-preview caller selects that exact adapter and carries it through the signed provider request.
3. Read back the same adapter commitment in protected output receipts.
4. Compare same-reference, same-text adapter versus zero-shot output with held-out material and blinded owner/native-listener ratings.
5. Promote only after the predefined likeness, intelligibility, latency and cost criteria pass. Container availability and a past Succeeded job are insufficient.

Sanitized evidence is stored locally in `scratchpad/expert-tools/azure-voice-provenance.json` and `azure-voice-provenance-matches.json`. This audit made no cloud mutations.
