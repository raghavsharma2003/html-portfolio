# Hindi, Hinglish and English voice bake-off

Status: executable plan only. No provider call, remote build, deployment, GPU run, or paid purchase was made while writing this document.

The one acceptable outcome is a measured voice route for each language. Hindi and English may have different winners. A model does not win because it supports a language on a model card. It wins only after blind listening against the strongest available vendor anchors.

## 1. Inputs and non-negotiable controls

The prompt manifest is `evals/voice-bakeoff/prompts.v1.json`. It contains 24 exact prompts:

- six meaning-matched groups, each in Devanagari Hindi, Romanized Hindi or Hinglish, and mixed-script code-switched Hinglish;
- six English prompts covering classroom explanation, correction, Indian names and places, expressiveness, numbers, and long-form delivery.

The prompts are authored to match the uploaded Class 10 chemical-reactions lecture domain. They are not quotations from the lecture. The uploaded lecture supplies source-timed real-speech controls and in-house diagnostic reference windows. Its audio is not sent to a vendor unless the speaker's permission is recorded.

Cross-provider identity comparison uses the same consented owner reference bytes and the same reference transcript for every provider. If a provider refuses the reference or requires live verification, that arm is recorded as blocked. It must not receive a substitute voice because that would destroy the comparison.

For every stochastic model, render three fixed seeds per prompt. Do not keep regenerating until a pleasant sample appears. Persist request text, text hash, reference hash, seed, model identifier, model commitment where available, parameters, latency, byte length, sample rate, and billed units.

## 2. Model matrix

| Arm | Hindi and Hinglish | English | Clone path | Commercial status | Exact role |
|---|---|---|---|---|---|
| Chatterbox Multilingual V3 general | yes, already live but rejected by owner | yes | zero-shot and current LoRA | MIT | incumbent negative control |
| Chatterbox Hindi V3 pack | Hindi only | no | zero-shot | MIT | first in-house Hindi candidate |
| AI4Bharat IndicF5 | Hindi and 10 other Indian languages | not claimed | reference audio plus exact reference transcript | MIT, gated model access | India-specialist in-house candidate |
| Qwen3-TTS 1.7B Base | no official Hindi support | yes | 3-second zero-shot clone | Apache-2.0 | strongest permissive English-only research candidate in this pass |
| IndicF5 or Sarvam followed by OpenVoice V2 | yes | not in first pass | native TTS followed by tone-color conversion | OpenVoice MIT; base license still applies | decoupled phonology, prosody and timbre experiment |
| ElevenLabs Eleven v3 IVC | yes | yes | instant voice clone | vendor API | global quality anchor; PVC follows only with 30 minutes or more of verified owner audio |
| MiniMax Speech 2.8 HD | Hindi language boost | yes | 10 seconds to 5 minutes rapid clone | vendor API | fast commercial clone anchor |
| Fish S2.1 Pro | Hindi is listed among 83 languages | yes | zero-shot references or persistent voice | vendor API | expressive and low-latency vendor anchor |
| Sarvam Bulbul v3 | native code-mixed Hindi and Indian English | yes | stock voice by API; clone creation is dashboard-only in public docs | vendor API | India-native naturalness and code-switch ceiling |

Why several popular models are absent from the Hindi race:

- Qwen3-TTS is an excellent Apache-2.0 English cloning candidate, but the official model lists Chinese, English, Japanese, Korean, German, French, Russian, Portuguese, Spanish and Italian. Hindi community adapters are not a production qualification.
- Fish S2 self-hosting is research-only without a separate commercial agreement and officially recommends at least 24 GB VRAM. The existing Central India T4 has 16 GB VRAM, so self-hosting it is neither licensed nor hardware-compatible. Use the S2.1 API for the bake-off.
- Sarvam is added even though it was not in the original shortlist because it is the most direct India-specific code-switch competitor. Its official Bulbul v3 contract supports mixed Indic and English text, Indian English, pronunciation dictionaries, and 10 Indian languages.

## 3. Exact integrations

### Existing Chatterbox arms

Use the existing signed provider and isolated Hindi runtime. General runs all 24 prompts. Hindi V3 runs the 18 Hindi and Hinglish prompts and must refuse the six English prompts. For Hindi, preserve requested and effective CFG, text script mode, reference script mode, evidence scope, model arm, model pack, seed and commitment in every receipt.

Do not route production to the Hindi pack during evaluation. Do not apply the existing general-arm LoRA to Hindi V3 because the runtime correctly refuses an unqualified adapter on that model pack.

### IndicF5

Create an isolated, scale-to-zero Azure candidate after the Hugging Face access terms have been accepted. Pin the model revision. The request must include target text, a 24 kHz reference clip, and the exact transcript of that clip, matching the official contract. Run the Devanagari prompts as the primary arm and the Romanized and mixed prompts as stress tests. Do not silently transliterate an input and call it the raw model result; a transliterated arm is a separate treatment.

### Qwen3-TTS

Use `Qwen/Qwen3-TTS-12Hz-1.7B-Base` in a separate scale-to-zero candidate and run only the six English prompts. Supply the same reference audio and transcript used by every cloning arm. This candidate is not evidence for Hindi.

### Decoupled native speech and owner timbre

This is the research-level arm that tests a different factorization of the problem:

1. IndicF5 or Sarvam Bulbul v3 produces native Hindi phonemes, timing, stress and code-switch delivery in a neutral Indian voice.
2. OpenVoice V2 converts only the base speaker's tone color toward the owner's reference embedding.
3. The existing audio-protection service adds the Vyakti disclosure and PerTh watermark after conversion.

The hypothesis is that one cross-lingual prompt model currently fails because it is asked to solve Hindi phonology, Indian prosody and speaker identity simultaneously. This arm makes the India-native model own the first two and the converter own timbre.

OpenVoice V1 and V2 are MIT licensed and the official project claims zero-shot cross-lingual tone-color cloning. The converter implementation enables WavMark by default and accepts a message, but that is not a substitute for the product's PerTh proof. The final PerTh operation must happen after conversion because conversion can invalidate an upstream acoustic watermark. The generation receipt must bind the base TTS provider and model, base audio hash, OpenVoice source commit and checkpoint hashes, owner reference hash, converter parameters, converted audio hash, protection receipt and final audio hash.

This arm is commercially safe only in its IndicF5 to OpenVoice form, subject to the accepted IndicF5 model terms and a checkpoint audit. Sarvam to OpenVoice remains a vendor-backed route because Sarvam generated the base audio. Seed-VC is not selected for the first pass: its published model card is GPL-3.0, but a complete audit of all checkpoint and training-data obligations has not been done. OpenVoice provides a narrower MIT-licensed converter with an explicit commercial-use statement and built-in watermark mechanism.

OpenVoice maintainers state that the converter clones tone color, not accent or intonation. That is exactly why the base Hindi TTS remains responsible for accent and delivery. It is also a failure risk: conversion may reduce naturalness, introduce vocoder artifacts or weaken speaker likeness. Measure the following delta on identical base clips before promoting it:

- owner ECAPA similarity before and after conversion;
- human Hindi accent and naturalness before and after conversion;
- raw ASR error before and after conversion;
- conversion real-time factor and p90 latency;
- source and final watermark detection, with final PerTh required;
- failure rate over three seeds and four different owner reference windows.

Reject the arm if conversion lowers any critical human axis by more than 0.2, raises raw ASR error by more than 5 percent relative, misses the asynchronous RTF gate, or fails final provenance binding. Do not assume that a higher speaker embedding score compensates for degraded human speech.

### ElevenLabs

Use `voices.ivc.create` once with 1 to 2 minutes of clean consented owner audio, then synthesize with `eleven_v3`. Use `language_code` where supported and keep the exact model identifier. Eleven v3 is the expressive batch anchor. A later realtime comparison should use Flash v2.5 or Eleven v3 Conversational rather than pretending batch v3 latency represents the conversation product.

PVC is a separate arm after at least 30 minutes of clean owner audio and provider verification. ElevenLabs recommends closer to 2 to 3 hours for best fidelity and reports 3 to 6 hours for fine-tuning. Do not compare our 30-minute adapter with a vendor IVC and label it a fine-tune comparison.

### MiniMax

Upload one `mp3`, `m4a` or `wav` reference between 10 seconds and 5 minutes and no larger than 20 MB. Create one rapid clone, include the optional less-than-8-second prompt audio plus exact prompt transcript, and synthesize with `speech-2.8-hd`. Use `language_boost=Hindi` for the 18 Hindi and Hinglish prompts and `language_boost=English` for the six English prompts.

### Fish

Use `s2.1-pro` or the time-limited `s2.1-pro-free` string while it remains available. Send either a persistent `reference_id` or a zero-shot `references` array containing audio plus exact transcript. Do not self-host S2 under Vyakti's commercial route. Price the run at the paid S2 Pro rate even if the S2.1 evaluation is free, so the decision is not based on a temporary promotion.

### Sarvam

Run all prompts through `bulbul:v3`, using `hi-IN` for Hindi and Hinglish and `en-IN` for English. This is initially a stock-voice naturalness ceiling because public documentation exposes clone creation as a dashboard flow, not a clone-creation API. When the owner records the required 10-second passage in the dashboard, add that saved voice as a distinct clone arm. Never compare Sarvam stock-voice identity scores against cloned arms.

## 4. Text-front-end experiment

The current production failure mixes two variables: the acoustic model and the text front end. The benchmark therefore keeps these treatments separate:

1. Raw Devanagari.
2. Raw Romanized Hindi.
3. Raw mixed-script code-switched Hinglish.
4. Reviewed Romanized-to-Devanagari transliteration, logged as a separate derived text.
5. Language-segmented synthesis, where Hindi and English spans are generated with the correct language and joined with equal-power 25 to 50 ms crossfades.

The raw text always remains in the receipt. The derived text, transliterator version, word alignment, segment boundaries and join positions are additional fields. A front-end treatment cannot be attributed to the model.

The English disclosure under one Hindi language identifier is a known confound in the current Chatterbox call. The listening bench trims the disclosure uniformly for all arms. Product delivery still retains the spoken disclosure and watermark.

## 5. Listening protocol

### Stage A: owner triage

Use 12 prompts selected before synthesis: two Devanagari, two Romanized, two code-switched, three English, one names-and-places, one equation, and one expressive correction. Randomize opaque clip IDs and arm order. The owner rates every clip from 1 to 5 on:

- speaker likeness;
- human naturalness;
- Indian accent authenticity;
- pronunciation and intelligibility;
- code-switch smoothness when applicable;
- teaching delivery and emotion.

An arm with any mean below 3.0 on naturalness, accent, or intelligibility is eliminated. Owner triage is a preference gate, not a statistical claim.

### Stage B: blinded top-three comparison

Advance at most three arms per language. Use all eligible prompts, all three fixed seeds, and at least five listeners fluent in Hindi and Hinglish. Include the owner but report owner scores separately. Counterbalance prompt, arm and side. Use headphones in one quiet sitting. Catch trials contain real owner speech and a deliberately degraded control. A listener below 90 percent catch accuracy is excluded before scores are unsealed.

Primary measure: forced pairwise preference for each prompt on the question, "Which sounds more like this person speaking naturally in this language?"

Secondary ratings retain the six separate axes above. Do not collapse accent, naturalness and identity into one opaque MOS.

Use a two-level bootstrap that resamples listeners and semantic prompt groups. Report paired win rate and 95 percent interval. The semantic group, not each script rendering, is the content unit, which prevents the three scripts of one sentence from pretending to be three independent ideas.

### Stage C: identity equivalence

Run the existing earbench ABX identity protocol for the winning in-house and winning vendor arm against held-out real speech. The listener hears a real reference X and chooses which of A or B is the same speaker. Keep the existing exact-binomial and Wilson logic. "Not significant" remains inconclusive and must not be reported as indistinguishable.

## 6. Automated evidence

Automated results never overrule human listening. They catch regressions and explain failures:

- raw ASR WER or CER against target text;
- the existing reviewed script-aware Hindi score as a separate adjusted diagnostic, never a replacement for raw error;
- ECAPA speaker similarity against held-out real windows, with the speaker's self-similarity ceiling printed;
- clipping, DC offset, silence ratio, bandwidth, loudness and duration rails;
- repeated or omitted phrase detection from ASR alignment;
- p50 and p90 total latency, time to first audio, real-time factor and billed units;
- per-model failure rate over the three fixed seeds.

## 7. Release gates

Hindi and English are promoted independently. An in-house arm may be called better than a vendor only when all conditions below pass:

1. Paired human preference versus that vendor has a 95 percent bootstrap lower bound above 50 percent.
2. The in-house arm is non-inferior on likeness, naturalness, accent and intelligibility: the 95 percent lower bound of each paired mean difference is greater than negative 0.2 on the 1 to 5 scale.
3. Owner preference is at least 60 percent of prompts and no owner critical-axis mean is below 4.0.
4. Hindi WER or CER and code-switch token correctness do not regress beyond a pre-registered 5 percent relative margin.
5. No seed has a missing sentence, repeated sentence, speaker swap, untrimmed bench disclosure, missing product disclosure, failed watermark or invalid receipt.
6. Warm p90 synthesis real-time factor is at most 1.0 for asynchronous preview. Realtime routing receives its own time-to-first-audio gate and does not inherit the batch result.
7. Cost per generated minute is recorded from actual bills or metered GPU seconds. An estimate alone does not clear the cost gate.

If no open model clears basic Hindi naturalness and accent, the vendor winner becomes the temporary production fallback while the India-first in-house adaptation continues. That is not surrendering the in-house goal; it prevents users from receiving known-bad audio during research.

## 8. Budget under the approved USD 500 Azure ceiling

Run `node evals/voice-bakeoff/plan.mjs` for the exact snapshot. On 2026-08-28 the official Azure Retail Prices API returned these Central India Container Apps meters:

- T4 GPU: USD 0.000102 per second;
- active vCPU: USD 0.000024 per vCPU-second;
- active memory: USD 0.000003 per GiB-second.

The deployed T4 profile requests 8 vCPU and 56 GiB, so the fully allocated retail rate is USD 1.6632 per active hour before contract discounts and CPU or memory free grants.

| Phase | Expected | Hard stop | Basis |
|---|---:|---:|---|
| Nine-arm bake-off | USD 25.98 plus INR 22.56 | USD 35 | three seeds per prompt, conservative ElevenLabs USD 22 plan, MiniMax clone, paid Fish fallback, and five short Azure model sessions including OpenVoice conversion |
| Speaker-adapter sweep | about USD 45 to 70 | USD 100 | measured 140.4 seconds for 62.1 seconds of speech; linear compute projection gives USD 1.88 for one 30-minute run and USD 3.76 for one 60-minute run |
| Hindi adaptation pilot | USD 192.93 Azure retail | USD 250 | two 48-hour language-adaptation runs plus 20 hours of evaluation and synthesis |
| Unallocated reserve | not pre-spent | USD 115 | failed runs, data preparation, repeat listening stimuli or a second architecture |
| Total | | USD 500 | stop jobs automatically when the cumulative metered ceiling is reached |

The USD 500 approval is enough for a serious adapter and language-adaptation program. It is not enough to train a competitive foundation TTS model from scratch. Foundation training remains rejected until the winning architecture, licensed corpus, measured samples per GPU-second, and scaling curve exist.

Third-party API charges are not Azure credits. The first bake-off needs provider keys and at most approximately USD 25 outside Azure at conservative list pricing. Sarvam costs INR 30 per 10,000 characters. Fish S2.1 Pro is advertised free through 2026-08-31, but the plan deliberately does not depend on that ending promotion.

## 9. Execution order

1. Run the two already deployed Chatterbox arms with all eligible prompts and three seeds.
2. Run the same text-front-end treatments through Chatterbox before training anything. If reviewed Devanagari or segmented synthesis repairs most of the failure, fix the front end first.
3. Stand up isolated IndicF5 and Qwen3-TTS candidates with scale-to-zero. Never change production routing.
4. Generate MiniMax, Fish, ElevenLabs and Sarvam anchors after provider keys and the consented common reference are available.
5. Run owner triage. Eliminate failures before spending on adapters.
6. Fine-tune only the best permissive base, using 30 and 60 minutes of clean, language-matched owner speech with held-out reference and text sets.
7. Start the capped Hindi language-adaptation pilot only if no zero-shot or speaker-adapted open arm clears the Hindi gates.

## 10. Primary and official sources

- Resemble AI Chatterbox repository and Hindi pack: https://github.com/resemble-ai/chatterbox
- Chatterbox single-language and accent-transfer guidance: https://github.com/resemble-ai/chatterbox
- Chatterbox native code-switch issue: https://github.com/resemble-ai/chatterbox/issues/346
- AI4Bharat IndicF5 model card: https://huggingface.co/ai4bharat/IndicF5
- Qwen3-TTS official repository: https://github.com/QwenLM/Qwen3-TTS
- OpenVoice V2 repository and MIT license: https://github.com/myshell-ai/OpenVoice
- OpenVoice converter and WavMark implementation: https://github.com/myshell-ai/OpenVoice/blob/main/openvoice/api.py
- Seed-VC published model card and GPL-3.0 metadata: https://huggingface.co/Plachta/Seed-VC
- ElevenLabs cloning concepts: https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning
- ElevenLabs IVC API guide: https://elevenlabs.io/docs/eleven-api/guides/how-to/voices/instant-voice-cloning
- ElevenLabs PVC guide: https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/professional-voice-cloning
- ElevenLabs pricing: https://elevenlabs.io/pricing
- MiniMax voice cloning API: https://platform.minimax.io/docs/api-reference/voice-cloning-clone
- MiniMax pay-as-you-go pricing: https://platform.minimax.io/docs/guides/pricing-paygo
- Fish S2.1 Pro official release: https://fish.audio/blog/s2-1-pro-free-api/
- Fish API TTS and reference contract: https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
- Fish pricing: https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits
- Fish self-host license: https://github.com/fishaudio/fish-speech/blob/main/LICENSE
- Sarvam Bulbul v3: https://docs.sarvam.ai/api/getting-started/models/bulbul
- Sarvam code-mixed TTS contract: https://docs.sarvam.ai/api-reference/text-to-speech/convert
- Sarvam voice cloning flow: https://docs.sarvam.ai/creative-voice-cloning
- Sarvam pricing: https://docs.sarvam.ai/api/getting-started/pricing
- Azure Container Apps serverless GPU: https://learn.microsoft.com/en-us/azure/container-apps/gpu-serverless-overview
- Azure Retail Prices API: https://prices.azure.com/api/retail/prices
