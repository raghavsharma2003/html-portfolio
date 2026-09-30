# Voice frontier: Hindi, Hinglish and English

**Evidence cutoff:** 2026-08-28
**Status:** research and an executable qualification plan only. No candidate was run, no listening result was collected, no Azure resource was changed, and no quality win is claimed.

## Decision

Build and blind-test direct multilingual cloning models in this order:

1. **VoxCPM2** on the existing remote T4 profile.
2. **MOSS-TTS Local v1.5** on an Azure A10 24 GB qualification profile.
3. **ZONOS2** on the same A10 profile.

Keep DhVaani 0.5 and IndicF5 as small India-specialist controls. Keep Chatterbox as the incumbent negative control, Qwen3-TTS as an English-only control, and OpenVoice as a diagnostic conversion arm. Do not make OpenVoice the primary route: its converter changes speaker tone color after another TTS model has already chosen pronunciation and delivery. It therefore cannot repair a western Hindi accent created by the base TTS.

This order is encoded and checked in [`frontier.v1.json`](../../../evals/voice-bakeoff/frontier.v1.json) and [`frontier-plan.mjs`](../../../evals/voice-bakeoff/frontier-plan.mjs). It is a build order, not a leaderboard.

## Why the previous plan is no longer enough

The current Chatterbox and OpenVoice composition separates base speech from timbre. That is useful for diagnosis, but it is the wrong default for the owner's failure: the base speech is already robotic and foreign-accented in Hindi. A tone-color conversion can preserve that defect while making the spectral identity slightly closer.

IndicF5 remains relevant because it was built for Indian languages and accepts a reference plus transcript, but it should not receive the adaptation budget by default. Newer direct models now combine multilingual speech generation, cloning and an adaptation path in one model. The next run must compare them on matched Hindi, spontaneous Hinglish and Indian English rather than infer quality from a model card.

The primary-source landscape also contains attractive traps. OmniVoice covers 646 languages, but its official model card licenses released weights CC-BY-NC because of its training data. X-Voice likewise releases MIT code but CC-BY-NC pretrained weights. They are research references, not production bases. [OmniVoice model card](https://huggingface.co/k2-fsa/OmniVoice), [X-Voice repository](https://github.com/ishine/X-Voice).

## Ranked open candidates

| Rank | Exact model pin | License record | Hindi and cloning evidence | Memory evidence and first profile | Reversal condition |
|---|---|---|---|---|---|
| 1 | `openbmb/VoxCPM2@32279effe8c19989596f05d353d1447f51d9e915`; source `f5a1c6a6b901bc732e20f0d59a369f6829ad717a` | Apache-2.0 code and weights | Official release: 2.290B parameters, 30 languages including Hindi, isolated-reference and continuation cloning, 48 kHz, SFT and LoRA. Maintainers say 5 to 10 minutes can adapt a speaker, language or domain. Their own multilingual benchmark reports strong Hindi similarity, but that is vendor-authored evidence, not a Vyakti result. | Official repository reports about 8 GB VRAM on RTX 4090. First qualify on the existing 16 GB T4 remotely. | Demote if the reported memory route does not reproduce, or if matched native listeners reject Hindi accent/naturalness or owner identity does not beat the incumbent. |
| 2 | `OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5@be7766a6735b98bd793f7c79fb720b4d0f5d13b8`; source `58b20a0d5fcc6766658d50967a90a9d890009a46` | Apache-2.0 | Official card: 4B backbone, 4.550B parameters in the pinned repository, 31 languages including Hindi, explicit language tags, code switching, IPA and pause control, more stable cloning, 48 kHz output. | The pinned Hugging Face repository occupies 9,112,282,764 bytes. Upstream publishes no peak-VRAM result for this Local checkpoint. A10 24 GB is a conservative first qualification allocation, not a measured fit claim. | Promote if it wins blinded Hindi/Hinglish and meets latency/cost. Stop if 24 GB fails and a bounded CPU-offload or quantized route cannot preserve quality. |
| 3 | `Zyphra/ZONOS2@65f1e80f94b599d474bb6af9094a803dc52f60bd`; source `194c0a3ab67b90383a67646289f28d4ecb1c1f64` | Apache-2.0 weights; MIT source | Official release: 8B total and about 900M active MoE parameters, more than 6M training hours, speaker-embedding cloning and an accurate-clone mode. Hindi is only Tier 3, so coverage is evidence to test, not evidence of native quality. | The pinned official repository occupies 15,351,085,870 bytes. Upstream publishes no Python peak-VRAM result. Start on A10 24 GB, with A100 only after a measured OOM and a cost review. | Promote if Tier-3 Hindi wins the same blind gates. Demote if 24 GB cannot run it reliably or Hindi remains below the native-accent floor. |

Primary sources: [VoxCPM repository](https://github.com/OpenBMB/VoxCPM), [VoxCPM2 technical report](https://arxiv.org/abs/2606.06928), [MOSS-TTS repository and model card](https://github.com/OpenMOSS/MOSS-TTS/blob/main/docs/moss_tts_model_card.md), [MOSS-TTS paper](https://arxiv.org/abs/2603.18090), [ZONOS2 repository](https://github.com/Zyphra/ZONOS2), [ZONOS2 model](https://huggingface.co/Zyphra/ZONOS2), [ZONOS2 report](https://arxiv.org/abs/2606.24320).

### India-specialist controls, not the top build order

- **DhVaani 0.5**, pin `b079f01592e987042b86f4a01c3909cef569d247`: 122,798,800 F32 parameters, 491 MB weights, reference-plus-transcript cloning and Hindi in its well-represented tier. Its card admits that code-switching was not explicitly trained and mixed prosody can be rough. The checkpoint says Apache-2.0 but also asks users to respect the licenses of IndicTTS, Rasa and IISc SYSPIN. It is qualification-only until that corpus audit closes. [Official model card](https://huggingface.co/ARTPARK-IISc/DhVaani-0.5).
- **IndicF5**, pin `ba85abedf18dc479a447eaa0eccbd76ab78a47d5`: MIT, gated, 350,681,834 parameters and reference-plus-exact-transcript conditioning. It remains a useful Hindi control after access is accepted, but has no measured Vyakti quality advantage. [Official model card](https://huggingface.co/ai4bharat/IndicF5).

## Commercial anchors

Commercial APIs are test anchors, not assumed winners:

- **Azure Personal Voice:** one minute of human speech, creation in under five seconds, more than 90 languages and 100 locales, including `hi-IN` and `en-IN`. API access is limited and a recorded verbal consent statement is mandatory. The permitted use cases are narrower than an open-ended clone chat, so approval must be obtained before treating it as a deployable route. It is the only commercial anchor naturally aligned to the Azure grant. [Personal Voice overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-overview), [language support](https://learn.microsoft.com/en-us/azure/ai-services/Speech-Service/language-support), [transparency note](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/text-to-speech/transparency-note).
- **Cartesia Sonic 3.5:** pin API model `sonic-3.5-2026-05-04`; 42 languages including Hindi. Instant cloning uses about 10 seconds. Pro cloning requires at least 30 minutes, recommends two hours, and reports roughly three hours of training. [Sonic 3.5](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest), [Pro cloning](https://docs.cartesia.ai/build-with-cartesia/capability-guides/clone-voices-pro).
- **Smallest Lightning v3.1 Pro:** an India-native anchor with explicit Hindi-English code switching, Indian voices, 44.1 kHz output and a published price near USD 0.195 per 10,000 characters. Instant cloning accepts 5 to 15 seconds. [Model card](https://docs.smallest.ai/models/model-cards/text-to-speech/lightning-v-3-1-pro), [overview](https://docs.smallest.ai/models/documentation/text-to-speech-lightning/overview).
- **Hume Octave 2 preview:** supports Hindi, advertises cloning from 15 seconds and exposes a speech-language-model expression path. It is a useful naturalness/acting anchor, not proof of owner identity. [Official overview](https://dev.hume.ai/docs/text-to-speech-tts/overview).

No third-party API call or charge was made in this work.

## Architecture to build

1. **Immutable base and per-owner adapter.** Qualify the top direct bases unchanged. Train one owner LoRA on the best frozen base. Never sequentially fine-tune the shared base across owners.
2. **Language and style reference bank.** Keep 6 to 12 clean owner windows, each 6 to 12 seconds, stratified across Hindi, spontaneous Hinglish, Indian English, neutral teaching, correction, encouragement and high energy. Select the closest language/style reference per request. A two-hour file is an ingestion source, not a single inference prompt.
3. **Balanced owner recording.** Record 20 to 30 clean minutes each of Hindi, spontaneous Hinglish and Indian English, plus held-out prompts never used for adaptation. Run a 5, 15, 30 and 60 minute data curve rather than assuming more always helps.
4. **Text and acoustic controls stay separate.** Keep the current script-aware frontend, but score raw ASR and reviewed script-aware errors separately. Do not hide an English-accented Hindi failure behind transliteration.
5. **Global Hindi adaptation only after the gate fires.** If every permissive zero-shot and owner-LoRA arm fails native-Hindi listening, adapt one shared base on audited Indian speech, then learn per-owner adapters. IndicVoices-R is the cleanest current candidate: CC-BY-4.0, 1,704 hours, 10,496 speakers and 22 languages. It teaches Indian-language coverage, not a named person's identity. [IndicVoices-R](https://github.com/AI4Bharat/IndicVoices-R).

Kathbath/IndicSUPERB supplies 1,684 hours across 12 languages, including 150.2 Hindi hours, but its CC0 statement applies to packaging and explicitly notes upstream text ownership. Use it only after a rights audit. Project Vaani now advertises 31,255 hours and open models, but DhVaani's exact model card and corpus statements conflict with the catalogue-level summary, so the checkpoint-level audit wins. [IndicSUPERB](https://github.com/AI4Bharat/indicSUPERB), [Project Vaani models](https://vaani.iisc.ac.in/models).

The provided third-party lecture is suitable for ingestion and Hindi stress testing. It is not owner identity-training data unless the speaker has granted that right.

## Evaluation that can support the claim

Five listeners cannot support “indistinguishable.” Pre-register at least 20 fluent Hindi/Hinglish listeners and at least 800 total judgments, with results clustered by listener and utterance.

Use three complementary human tasks:

- MUSHRA-like panels with a hidden real recording and a deliberately degraded anchor, scoring speaker likeness, naturalness, Indian accent, pronunciation, code-switch smoothness and teaching delivery.
- ABX identity comparisons against both the owner and an impostor.
- Real-versus-clone discrimination on matched held-out text. Claim indistinguishability only if the clustered 95% interval is entirely within 45% to 55%, catch accuracy is at least 90%, and no critical human axis is worse than real speech by more than 0.2 on a five-point scale.

To claim a vendor win, require the clustered 95% lower bound of paired preference to exceed 50%; report owner preference separately. A non-significant result is not equivalence.

Automated diagnostics should include raw ASR error, script-aware error, two speaker encoders rather than one, real-real ceiling, impostor margin, MSR-UTMOS/TTSDS2, F0/rate/energy/pause distributions, prosody diversity, real-time factor and failure rate. They locate failures but never overrule fluent listeners. ZTTS1-Eval is a useful reproducible starting point because it pins Qwen3-ASR, ReDimNet, MSR-UTMOS and prosody-diversity scoring. TTSDS2 is useful because its authors evaluated 16 metrics against more than 11,000 subjective ratings and found it was the only one above 0.5 Spearman correlation in every tested domain and score. [ZTTS1-Eval](https://github.com/Zyphra/ZTTS1-Eval), [TTSDS2](https://arxiv.org/abs/2506.19441).

## Azure path under USD 1,000

Retail prices read from the official Azure Retail Prices API on 2026-08-28 were USD 1.6632/hour for the current fully allocated Container Apps T4 configuration already recorded by the project, USD 4.48/hour for `Standard_NV36ads_A10_v5` in Central India, and USD 20.569/hour for `Standard_NC96ads_A100_v4`. These are list-price planning inputs, not billing records. [Azure Retail Prices API](https://prices.azure.com/api/retail/prices).

| Stage | Expected | Hard stop | Exit |
|---|---:|---:|---|
| Zero-shot top-three screen | USD 60 | USD 100 | Three seeded blind packs per qualified model or a named incompatibility |
| Top-two owner LoRA data curve | USD 260 | USD 400 | 5/15/30/60-minute curve for no more than two bases |
| Shared Hindi adaptation, only if all earlier arms fail | USD 220 | USD 300 | Native-Hindi floor measured or cap reached |
| Human preference and release evaluation | USD 100 | USD 120 | Human, content, identity, prosody, latency and provenance reports complete |
| Infrastructure retry reserve | USD 0 | USD 80 | Used only for a pre-registered infrastructure failure |

Expected total is USD 640; all stage caps sum to USD 1,000. Foundation-model training is rejected: VoxCPM2 and ZONOS2 cite millions of training hours, so USD 1,000 is enough for qualification and parameter-efficient adaptation, not a credible from-scratch competitor.

## Reversal summary

- Replace VoxCPM2 as first build if it fails T4 reproduction or the matched Hindi owner pack.
- Promote MOSS if it wins native Hindi/Hinglish after cost and latency are included.
- Promote ZONOS2 only if Tier-3 Hindi beats the same floor and A10 is operationally stable.
- Promote DhVaani only after corpus rights are cleared and its documented code-switch weakness does not reproduce.
- Restore OpenVoice to the primary route only if a matched test shows the converter fixes accent, articulation, rhythm and identity rather than only timbre.
- Spend the Hindi base-adaptation tranche only after every permissive zero-shot and owner-LoRA candidate fails the pre-registered native-Hindi floor.
