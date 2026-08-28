# Open/self-hostable voice stack, 2026 — research sweep

Scope: replace/extend the current self-hosted Chatterbox Multilingual V3 +
HMAC broker with an in-house voice-cloning platform that can eventually beat
ElevenLabs, with no vendor dependence, on Hinglish/Indian-language quality,
including realtime calling. All claims below are web-verified on 2026-08-26
via WebSearch/WebFetch unless flagged **[UNVERIFIED]** — treat any single
SEO/content-farm citation (localaimaster, gigagpu, offlinetts, findskill,
codesota, etc.) as directional, not primary-source-grade; GitHub repos, Hugging
Face model cards, arXiv papers and vendor engineering blogs are the trustworthy
tier here. Every number is followed by its source.

Related in-repo prior art (do not re-litigate without reading first):
`context/decisions.md#replica-provider-portable`,
`context/decisions.md#replica-azure-credit-is-an-eval-budget`,
`docs/research/SPEECH-STACK.md`, `docs/research/REPLICA-FRONTIER-2026.md`.
The `replica-provider-portable` decision already named Chatterbox as one of
several "permissive" candidates competing behind a semantic render contract —
this sweep updates that comparison with 2026-current data.

---

## 1. Open TTS + zero-shot cloning models, state of 2026

### Chatterbox (Resemble AI) — what we currently run

- **License:** MIT, confirmed directly from the repo README.
  [github.com/resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox)
- **Family, as of the README fetched 2026-08-26:** Chatterbox-Nano (110M,
  CPU-feasible, "3x faster than realtime on 8 CPU cores"), Chatterbox-Turbo
  (350M), **Chatterbox Multilingual V3 (500M)** — our current model —
  plus per-language "Single Language Pack" finetunes including a dedicated
  `ResembleAI/Chatterbox-Multilingual-hi` model. Multilingual V3 shipped
  **June 10, 2026** per secondary sources [localaimaster.com — Chatterbox
  Multilingual v3](https://localaimaster.com/blog/chatterbox-multilingual-v3)
  — **[UNVERIFIED date, single non-primary source]**, not stated in the
  README fetch.
- **Cloning sample requirement:** ~5–10s reference clip for zero-shot,
  reported consistently across secondary sources
  [findskill.ai](https://findskill.ai/blog/best-open-source-tts-2026/),
  [localaimaster.com](https://localaimaster.com/blog/chatterbox-tts-setup-guide) —
  **[UNVERIFIED exact figure, not in primary README]**.
- **Hindi/Hinglish evidence:** Hindi is an explicit supported language with
  its own dedicated finetune per the README (primary source, verified).
  No independent Hinglish (code-switched, romanized) benchmark was found —
  this is the same gap flagged in `context/decisions.md` (`speech-stack`):
  Sarvam's own docs note romanized input degrades output quality for
  Devanagari-tuned models, and nothing found in this sweep contradicts or
  measures that for Chatterbox specifically.
- **Streaming latency:** secondary sources report "~150ms streaming
  first-packet" for base Chatterbox and "~75ms at ~6x realtime" for Turbo
  [findskill.ai](https://findskill.ai/blog/best-open-source-tts-2026/) —
  **[UNVERIFIED, not in primary README, no methodology given]**.
  `davidbrowne17/chatterbox-streaming` is a maintained community streaming
  wrapper: [github.com/davidbrowne17/chatterbox-streaming](https://github.com/davidbrowne17/chatterbox-streaming).
- **GPU requirements:** not stated in the primary README; Nano runs on CPU.
  No verified VRAM figure for Multilingual V3 was found this sweep —
  **gap, needs direct measurement, not secondary-source claims.**
- **Fine-tuning:** two actively maintained community toolkits found —
  [gokhaneraslan/chatterbox-finetuning](https://github.com/gokhaneraslan/chatterbox-finetuning)
  (LJSpeech/file-based format, offline VAD preprocessing, vocabulary
  extension across the 23 languages) and
  [Ahmed-Ezzat20/chatterbox-finetuning-multilingual](https://github.com/Ahmed-Ezzat20/chatterbox-finetuning-multilingual).
  Neither is from Resemble AI itself — **community-maintained, not
  vendor-blessed**, a real risk for a platform meant to outlast any one
  contributor.

### CosyVoice 3 (FunAudioLLM / Alibaba)

- Open-sourced **2025-12-15**
  [medium.com/data-science-in-your-pocket](https://medium.com/data-science-in-your-pocket/cosyvoice-3-best-smallest-tts-and-voice-cloning-ai-efaf769dfed8);
  repo at [github.com/QwenAudio/CosyVoice](https://github.com/QwenAudio/CosyVoice),
  recommended small model `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` on
  [Hugging Face](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512).
- **Languages:** 9 core languages (Chinese, English, Japanese, Korean,
  German, Spanish, French, Italian, Russian) + 18+ Chinese dialects.
  **Hindi is not in the supported list** in any source checked this sweep —
  disqualifying for our primary use case unless a community Hindi finetune
  surfaces.
- Strong zero-shot cloning, pronunciation-inpainting for CMU/Pinyin phonemes;
  ships full inference/training/deployment code, which is the strongest
  "own the whole stack" story of the models checked. License needs a direct
  repo check before relying on it — not resolved in this sweep
  **[UNVERIFIED]**.

### Fish Speech / OpenAudio S1

- Two tiers: **S1 (4B, proprietary weights)** and **S1-mini (0.5B, open
  weights)**. S1-mini's current license is **CC-BY-NC-SA-4.0 — non-commercial
  only** per a live GitHub licensing-complaint issue
  [fishaudio/fish-speech#1096](https://github.com/fishaudio/fish-speech/issues/1096).
  S1 (proprietary) requires a separate commercial license from Fish Audio.
  **Net: neither tier is commercially self-hostable today without paying
  Fish Audio** — disqualifying for "no vendor dependence" as stated, unless
  that license issue resolves.
- Ranks at/near the top of the TTS-Arena open-model leaderboard per
  secondary sources [secondtalent.com](https://www.secondtalent.com/resources/open-source-ai-voice-generators/) —
  **[UNVERIFIED — could not independently load a live TTS-Arena Hindi/Hinglish
  breakdown this sweep]**. Fish's own March-2026 blind test claims S2 ranks
  #1, but sampled listeners from Fish's own platform — "useful signal, not
  independent proof" per
  [coval.ai](https://www.coval.ai/blog/best-text-to-speech-providers-in-2026-how-to-choose-(and-why-vendor-benchmarks-lie)/).

### F5-TTS

- Repeatedly cited as **the leading open-weight zero-shot cloner** — 3-second
  reference sample, strong naturalness — across multiple 2026 roundups
  [modal.com/blog/open-source-tts](https://modal.com/blog/open-source-tts),
  [secondtalent.com](https://www.secondtalent.com/resources/open-source-ai-voice-generators/).
  No Hindi-specific evidence surfaced this sweep — **gap**.

### Kokoro

- Very small footprint: **~2-3GB total GPU** and **45ms time-to-first-audio
  on an RTX 5090** per
  [gigagpu.com](https://gigagpu.com/kokoro-vs-xtts-v2-low-latency-tts/) —
  **[UNVERIFIED, vendor-adjacent blog, no independent methodology given]**.
  Kokoro is good for cheap, fast, non-cloned TTS but is **not built for
  zero-shot cloning** in the way Chatterbox/F5/XTTS are — wrong tool for
  "voice-cloning platform."

### XTTS (Coqui / community-maintained fork ecosystem)

- Zero-shot cloning from a **6-second sample**, broad language coverage,
  but **~320ms time-to-first-chunk** — meaningfully slower to first audio
  than Kokoro or Chatterbox's claimed streaming numbers
  [gigagpu.com](https://gigagpu.com/kokoro-vs-xtts-v2-low-latency-tts/) —
  **[UNVERIFIED, same caveat as above]**. Coqui the company shut down in
  early 2024; XTTS lives on only via community forks — a governance risk
  worth naming explicitly for "no vendor dependence" (no vendor, but also no
  maintainer).

### AI4Bharat IndicTTS (the actual Indic-language specialist)

- MIT-licensed **IndicConformer** ASR (see §4) and **IndicTTS** covering 13
  Indic languages including Hindi, built by AI4Bharat/IIT Madras
  [ai4bharat.iitm.ac.in](https://ai4bharat.iitm.ac.in/) — **primary language
  authority for India**, but per `context/rejected.md`'s own recorded finding
  ("Sarvam and every Indic-specialist model... tuned for formal Devanagari
  Hindi. Casual romanised Hinglish is the opposite requirement"), IndicTTS is
  almost certainly tuned the same way and needs direct romanized-Hinglish
  testing before trusting it for this product. No zero-shot voice-cloning
  claim found for IndicTTS this sweep — it looks like a fixed-speaker-set
  TTS, not a cloning platform, which is a category mismatch with the ask.

### MeloTTS

- Not independently re-verified this sweep beyond appearing in general
  roundups; treat as a lower-priority open TTS option, no cloning-specific
  claims surfaced. **[not covered in depth — time-boxed out]**.

### Leaderboard summary — TTS-Arena / quality gap to ElevenLabs

- One 2026 roundup states: **"the best open-source TTS (Sesame CSM, 4.7 MOS)
  is within 0.1–0.3 of the top commercial API (ElevenLabs Turbo v2.5, 4.8
  MOS)"** — repeated verbatim across two independent search snippets, but
  both trace to the same style of SEO aggregator content
  [offlinetts.com](https://offlinetts.com/blog/tts-model-ranking-2026/) —
  **[UNVERIFIED — MOS methodology, listener count and language not stated;
  do not cite this number to the owner as settled]**.
- A more concrete, checkable data point: in the **MultiVox** benchmark paper
  (arXiv, peer-reviewed-adjacent), CosyVoice scored MOS 2.4 (attribute match)
  / 2.1 (naturalness) vs ElevenLabs 3.1 / 3.3
  [arxiv.org/pdf/2507.10859](https://arxiv.org/pdf/2507.10859) — this is the
  single most trustworthy open-vs-ElevenLabs number found this sweep, and it
  says ElevenLabs still meaningfully leads on at least one open model on a
  real academic benchmark. **This directly contradicts the "gap nearly
  closed" claim above** — flag both to the owner rather than picking one.

---

## 2. Fine-tuning for voice fidelity

- **Chatterbox:** community consensus across the fine-tuning toolkit repos
  is **≥30 minutes of clean single-speaker audio recommended**; LoRA is
  explicitly reported as *more stable than full fine-tuning* for the Turbo
  model, with the toolkit README noting that static/hallucination artifacts
  during full-FT training are the signal to switch to LoRA
  [gokhaneraslan/chatterbox-finetuning](https://github.com/gokhaneraslan/chatterbox-finetuning) —
  **primary-ish (maintainer's own repo), but not Resemble AI's own
  guidance** — no official recipe from Resemble AI was found.
- **General pattern across TTS LoRA fine-tunes** (not Chatterbox-specific):
  **10–30 minutes of clean audio is the practical production target; 5
  minutes is enough to prove the pipeline works but is "a weak basis for
  production judgement"** — this phrasing recurred in secondary sources
  describing LoRA fine-tuning generally
  [instavar.com](https://instavar.com/blog/ai-production-stack/LoRA_Finetuning_Qwen3_TTS_Custom_Voices) —
  **[UNVERIFIED as a hard number — treat as a starting hypothesis to
  measure, not a spec]**.
- **LoRP-TTS** (arXiv 2502.07562, "Low-Rank Personalized Text-To-Speech") is
  a directly relevant published recipe for low-rank per-speaker
  personalization — worth reading in full before designing our fine-tune
  pipeline: [arxiv.org/pdf/2502.07562](https://arxiv.org/pdf/2502.07562).
  Not fully read this sweep — **follow-up task**.
- **No published, quantified "zero-shot vs fine-tuned" quality delta** (e.g.
  a MOS or similarity-score improvement number) was found for Chatterbox or
  any close analog in this sweep. This is the single biggest evidence gap
  for the "fine-tuning is our path to beating instant cloning" thesis — it
  needs to be produced in-house (see bench protocol, §Synthesis) rather than
  imported from a paper.

---

## 3. Open realtime speech-to-speech / full-duplex

### Kyutai Moshi — the most concrete open option

- Genuinely full-duplex (parallel audio streams, no VAD-mediated turn-taking,
  unlike our current Gemini Live lane which explicitly IS VAD-gated — see
  `context/rejected.md#backchannel`, which is our own measured proof that
  VAD-based turn detection breaks natural backchanneling).
- **Latency: 160ms theoretical (80ms Mimi frame + 80ms acoustic delay), ~200ms
  practical on an L4 GPU** — this figure is repeated across the Kyutai paper
  and multiple independent write-ups
  [kyutai.org/Moshi.pdf](https://kyutai.org/Moshi.pdf),
  [github.com/kyutai-labs/moshi](https://github.com/kyutai-labs/moshi) —
  **verified against the primary paper, trustworthy.**
- **Cloned voice in realtime:** Moshi ships two fixed pretrained voices
  (Moshiko/Moshika). Kyutai separately open-sourced **Pocket TTS**, described
  as "the first text-to-speech model with voice cloning" from Kyutai — but
  this is a separate TTS model, not evidence that Moshi's own realtime
  full-duplex path can run an arbitrary cloned voice end-to-end
  [github.com/kyutai-labs/moshi](https://github.com/kyutai-labs/moshi) —
  **[UNVERIFIED — no evidence found this sweep that Moshi's own S2S loop
  accepts a cloned-voice conditioning input; this is the load-bearing
  question for "does this replace our cascade" and it is unresolved]**.
- **Hindi/Hinglish:** no evidence found of Hindi training data or evaluation
  for Moshi. Almost certainly English/French-centric (Kyutai is
  Paris-based) — **treat as unsupported for our primary language until
  proven otherwise.**
- License: Moshi's code and weights are published on GitHub/Hugging Face
  under permissive terms per the repo, but the exact license string was not
  re-confirmed this sweep — **[UNVERIFIED, quick follow-up needed]**.

### Sesame CSM

- **Apache-2.0**, confirmed across multiple sources including the original
  TechCrunch coverage of the open-source release
  [techcrunch.com](https://techcrunch.com/2025/03/13/sesame-the-startup-behind-the-viral-virtual-assistant-maya-open-sources-its-base-ai-model),
  [the-decoder.com](https://the-decoder.com/sesame-releases-csm-1b-ai-voice-generator-as-open-source/).
- Voice cloning from as little as **1 minute of reference audio**, runs on
  CUDA/Apple MLX/CPU
  [openspeech.dev](https://www.openspeech.dev/models/sesame-csm-1b) —
  **[secondary source, plausible but not primary-confirmed]**.
- CSM is **context-conditioned speech generation** (turn-aware TTS), not a
  full end-to-end S2S/full-duplex model like Moshi — it needs an external
  ASR+LLM loop wrapped around it to be a calling agent. Good fit as a
  **TTS replacement inside a cascade**, not a native-realtime replacement.
- No Hindi/Hinglish evidence found this sweep.

### GLM-Voice / LLaMA-Omni-class

- Not independently re-verified this sweep beyond general awareness; time-
  boxed out given the stronger, more concrete Moshi/CSM findings. **Flag as
  an open item** if the owner wants full coverage — these are worth a
  follow-up pass specifically for Hindi/Indic support, since neither was
  checked.

### Verdict for §3, stated plainly

No open S2S/full-duplex model checked this sweep has **both** (a) verified
Hindi/Hinglish competence and (b) verified realtime arbitrary-voice cloning
in the S2S loop itself. Moshi is architecturally the right shape (genuine
full duplex, which is the exact thing our own `backchannel` rejection says
our current Gemini-Live cascade cannot do) but is unverified on both language
and cloned-voice-in-the-loop. **This means: staying a cascade (ASR → LLM →
cloned TTS) remains the only currently-defensible path for Hinglish realtime
calling; going native is a bet on Moshi maturing in both dimensions, not a
move to make now.**

---

## 4. Open ASR for Hinglish

### AI4Bharat IndicConformer

- **MIT license**, confirmed
  [ai4bharat.iitm.ac.in/.../IndicConformer](https://ai4bharat.iitm.ac.in/areas/model/ASR/IndicConformer/),
  [huggingface.co/ai4bharat/indic-conformer-600m-multilingual](https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual).
  Covers all 22 official Indian languages — the broadest, most credible,
  most clearly self-hostable Indic ASR option found in this sweep.
- No Hindi-English code-switch-specific WER/CER figure was surfaced in the
  search results themselves — needs a direct model-card or paper read
  **[gap — follow-up: fetch the HF model card directly for the code-switch
  eval table if one exists]**.

### Whisper fine-tunes for Hinglish

- `Trelis/whisper-hinglish-preview` on Hugging Face — a Whisper-large-v3
  variant specialized for Hindi-English code-switching
  [huggingface.co/Trelis/whisper-hinglish-preview](https://huggingface.co/Trelis/whisper-hinglish-preview).
  No WER number surfaced in the snippet; needs a direct model-card fetch.
- A relevant Interspeech 2025 paper, "Adapting Whisper for low-resource
  Hindi-English Code-Mix speech" — has concrete methodology (on-the-fly
  code-mixing + few-shot LLM-generated synthetic in-domain data), reported
  as most effective when combined with real in-domain data
  [isca-archive.org/interspeech_2025/biswas25_interspeech.pdf](https://www.isca-archive.org/interspeech_2025/biswas25_interspeech.pdf) —
  **the single most promising concrete recipe found in this sweep for our
  actual problem (code-switched Hinglish ASR)** — worth a full read before
  committing to an ASR choice.
- A directly relevant arXiv paper surfaced organically:
  **"The TTS-STT Flywheel: Synthetic Entity-Dense Audio Closes the Indic ASR
  Gap Where Commercial and Open-Source Systems Fail"**
  [arxiv.org/pdf/2605.03073](https://arxiv.org/pdf/2605.03073) — title alone
  suggests exactly our failure mode (this is also cited independently in the
  Chatterbox fine-tuning search results, i.e. it's a paper actively used by
  the open-TTS community). **High-priority follow-up read**, not fully
  digested this sweep.

### Sarvam ASR (Saarika)

- Sarvam's **language models** (Sarvam-30B/105B, Feb 2026) are open-sourced,
  but their **speech products (Saarika ASR, Bulbul TTS) remain API-only**
  [techbuzz.ai](https://www.techbuzz.ai/articles/sarvam-ai-launches-105b-open-source-models-for-india) —
  confirms and updates the existing `context/rejected.md` finding that
  Sarvam speech is not self-hostable, and matches our own prior conclusion
  that Sarvam-class models also underperform on romanized Hinglish
  specifically (per `context/rejected.md`'s Indi-RomCoM citation, already in
  our own repo — not re-verified externally this sweep, but consistent with
  everything found here about Devanagari-tuned models struggling on
  romanization).

**Recommendation for §4:** IndicConformer (self-hostable, MIT, broad Indic
coverage) as the base, with a fine-tune pass using the Interspeech 2025
code-mixing recipe, benchmarked directly against `Trelis/whisper-hinglish-preview`
and against whatever STT our current cascade actually uses (per
`context/measurements.md:2566`, our own repo notes **three STT lanes, all
`en-IN`, none chosen deliberately, none measured** — this is a bigger and
easier win than any external research: measure what we already have before
adding a new model).

---

## 5. Speaker verification / fidelity measurement

- **WavLM-ECAPA-TDNN** cascade (WavLM-Large frame features → ECAPA-TDNN
  speaker embedding) is the current strong open baseline: **EER 0.39% on
  VoxCeleb1-O** per ESPnet-SPK, beating fixed-WavLM (0.60%) and mel-spectrogram
  (0.85%) pipelines
  [emergentmind.com](https://www.emergentmind.com/topics/wavlm-ecapa-tdnn-architecture) —
  **[secondary aggregator, numbers plausible and internally consistent, not
  independently re-derived]**.
- Microsoft's fused VoxSRC-22 submission (13 systems incl. WavLM-ECAPA-TDNN):
  **minDCF 0.073, EER 1.436%** on the harder VoxSRC-22 eval set
  [emergentmind.com](https://www.emergentmind.com/topics/wavlm-ecapa-tdnn-architecture) —
  same caveat.
- "WavLM MHFA" (multi-head factorized attention) is named as a lighter-weight
  successor backend replacing the ECAPA-TDNN head — found only in passing,
  not independently verified with numbers this sweep.
- **No published number correlating a cosine-similarity threshold with human
  "sounds like them" judgments was found** beyond one unrelated third-party
  test-set threshold of 0.42 cosine distance for verification (not for
  perceptual identity-match, a different question)
  [emergentmind.com](https://www.emergentmind.com/topics/wavlm-ecapa-tdnn-architecture) —
  **this is a real gap.** Our own repo's `voice-ears` / `azure-tts` rejection
  is directly on point here and is the strongest evidence in either the repo
  or this sweep: **measured pitch/accent numbers did NOT predict the owner's
  ear verdict** ("azure-tts": every measured axis said switch, the owner's
  ear said no). This is strong first-party evidence that **no automated
  similarity score should gate a voice decision alone** — any speaker-
  verification score in our pipeline should be a monitoring/regression signal,
  never a substitute for a human "does this sound like them" panel.

**Recommendation:** WavLM-ECAPA-TDNN (or the open `speechbrain` ECAPA-TDNN
implementation, MIT-adjacent, widely used) as the automated regression gate
for "did this fine-tune drift," explicitly NOT as the ship/no-ship decision —
that stays a human blind-listen panel, per our own `voice-ears` precedent.

---

## 6. GPU economics

Pricing snapshot dated **2026-08-26** (sources below); GPU cloud pricing is
volatile month to month, re-check before actually budgeting.

| Provider | GPU | On-demand | Serverless | Notes |
|---|---|---|---|---|
| RunPod | H100 PCIe | $1.99/hr | — | [runpod.io/pricing](https://www.runpod.io/pricing) |
| RunPod | H100 SXM | $2.69/hr | ~$4.55/hr | serverless ≈$0.00126/s |
| RunPod | A100 PCIe | $1.39/hr | — | Secure Cloud |
| RunPod | A100 SXM | $1.59/hr | ~$2.736/hr | serverless ≈$0.00076/s |
| Modal | A100 | — | from $3.72/hr | pay-per-compute-second, no idle charge |
| Modal | H100 | — | from $4.29/hr | same |
| Lambda Labs | — | higher than RunPod on public self-serve | — | directional only, no exact figure surfaced |

Source aggregation:
[spheron.network/blog/runpod-h100-pricing-2026](https://www.spheron.network/blog/runpod-h100-pricing-2026/),
[flexprice.io](https://flexprice.io/blog/runprod-pricing-guide-with-gpu-costs),
[runpod.io/pricing](https://www.runpod.io/pricing) (primary, most trustworthy
line in the table),
[buildmvpfast.com](https://www.buildmvpfast.com/api-costs/gpu),
[costbench.com/.../modal](https://costbench.com/software/ai-gpu-cloud/modal/).
**[Treat RunPod's own pricing page as the one primary source here; the
comparison sites are directional.]**

**Cold start / utilization crossover:** one source states serverless only
beats an always-on pod below **~60% utilization on H100** and **~51% on
A100** — i.e. above those utilization levels, reserved/always-on is cheaper
[buildmvpfast.com](https://www.buildmvpfast.com/blog/gpu-cloud-cost-comparison-runpod-lambda-labs-coreweave-2026) —
**[UNVERIFIED single source, but the shape of the claim — utilization
crossover exists and sits near 50-60% — is standard cloud-economics logic
and plausible; the exact percentages are not independently confirmed]**.

**Rough monthly cost model for N concurrent cloned-voice calls (constructed,
not sourced — mark as our own estimate, not a citation):**

- Each concurrent Chatterbox/CosyVoice/F5 inference stream needs roughly one
  mid-tier GPU (A100-class) worth of headroom for real-time-factor safety
  margin at streaming latencies — this is an assumption, not a measured
  figure from any source this sweep found, and **must be replaced with an
  actual load test before being used as a budget number.**
- At RunPod A100 SXM on-demand ($1.59/hr) reserved 24/7: **~$1,145/month per
  concurrent-call slot** if held always-on, before any multiplexing/batching.
  Batching multiple concurrent streams onto one GPU is standard practice for
  TTS serving and would divide this — but no verified batching-capacity
  number for Chatterbox/CosyVoice was found this sweep. **This is the
  single most important number to measure before writing a GPU budget line,
  and nothing in this research sweep can substitute for an actual load test
  against our real traffic shape.**
- Serverless (RunPod/Modal) is the right choice below the ~50-60%
  utilization crossover cited above; for a product still ramping concurrent
  call volume, serverless is very likely the correct starting point, with a
  cutover to reserved capacity once utilization data exists to justify it.

---

## Synthesis — recommended in-house stack

**This section is a recommendation to route around vendor lock, not a claim
that any option here has been proven to beat ElevenLabs on Hinglish. Nothing
in this sweep found a head-to-head open-vs-ElevenLabs Hinglish benchmark —
that benchmark does not exist yet and is the actual product of Phase 1
below.**

1. **Primary TTS/cloning model: stay on Chatterbox Multilingual V3** for now.
   It is the only model checked this sweep with all three of: MIT license
   (true no-vendor-dependence), a *dedicated* Hindi finetune shipped by the
   maintainer, and an actively maintained community fine-tuning toolkit. The
   real competitors either fail licensing (Fish/OpenAudio S1-mini is
   NC-only), fail language coverage (CosyVoice 3 has no Hindi), or fail
   maturity/governance (XTTS is orphaned, Kokoro/F5/CSM have no verified
   Hindi evidence at all). **This is a "nothing beats the incumbent on the
   full checklist" finding, in the same shape as our own repo's repeated
   `rejected.md` pattern** — re-run this comparison in 3-6 months, not
   never.
2. **Fine-tune recipe:** LoRA over full fine-tune (community consensus, more
   stable), 30+ minutes of clean single-speaker audio per voice as the
   production target, 5-10 minutes as a pipeline smoke test only. Adopt the
   Interspeech 2025 on-the-fly code-mixing + synthetic-data approach
   ([biswas25_interspeech.pdf](https://www.isca-archive.org/interspeech_2025/biswas25_interspeech.pdf))
   for the Hinglish text side of the fine-tune corpus, and read
   `arxiv.org/pdf/2605.03073` (TTS-STT Flywheel) and `arxiv.org/pdf/2502.07562`
   (LoRP-TTS) in full before finalizing the recipe — both are cited only at
   the abstract level in this sweep.
3. **Realtime path: cascade, not native, for now.** No open S2S model
   checked (Moshi, CSM) has verified Hindi/Hinglish support or verified
   cloned-voice-in-the-loop realtime generation. Moshi is the one to
   re-evaluate first if the owner wants to revisit this — it is
   architecturally the only genuine full-duplex option and directly answers
   our own `backchannel` rejection's structural complaint about VAD-gated
   turn-taking. Until it's verified on language + cloning, keep ASR → LLM →
   Chatterbox-TTS as the calling architecture.
4. **ASR: AI4Bharat IndicConformer (MIT)** as the base, benchmarked directly
   against `Trelis/whisper-hinglish-preview` and against whatever the
   current three unmeasured `en-IN` STT lanes actually are
   (`context/measurements.md:2566` — this is a same-repo, zero-external-cost
   fix that should happen before any new ASR integration work).
5. **Fidelity measurement: WavLM-ECAPA-TDNN cosine similarity as a
   regression monitor only**, never as a ship gate — the ship gate stays a
   blind human listen panel, on the direct precedent of `voice-ears`/
   `azure-tts` in our own repo, where every measured axis said switch and
   the owner's ear said no.

### Bench protocol to prove it against ElevenLabs on Hinglish

Exact metrics, none of which exist as an out-of-the-box benchmark — this is
the actual deliverable the owner is buying, since no external benchmark
covers Hinglish specifically:

1. **Corpus:** ≥40 held-out romanized Hinglish lines spanning register
   (casual chat, code-switch-heavy, emotional/expressive), drawn from real
   product transcripts, never from `persona.ts` verbatim (per
   `recited-prompt` — using in-persona lines would contaminate the eval the
   same way it contaminates her prompt).
2. **Reference voice:** one held-out 2-5 minute clean recording, never seen
   by any fine-tune, used identically as the ElevenLabs "instant clone"
   input and as the Chatterbox fine-tune source.
3. **Arms:** (a) ElevenLabs instant clone, (b) ElevenLabs fine-tuned voice if
   available on their platform, (c) Chatterbox zero-shot, (d) Chatterbox
   LoRA fine-tuned on the same reference minutes.
4. **Metrics, all blind and counterbalanced:**
   - **Human MOS** (naturalness) and **human similarity score** ("does this
     sound like the reference speaker"), 1-5 scale, ≥3 raters, on the same
     protocol as our own `voice-ears` panel.
   - **Accent-authenticity as its own axis**, separate from pronunciation —
     explicitly required by our own `azure-tts` rejection's lesson
     ("pronunciation and accent identity are different properties and only
     the second decides whether she is her").
   - **Automated WavLM-ECAPA-TDNN cosine similarity** as a secondary,
     non-decision-making signal.
   - **Romanized-Hinglish pronunciation accuracy** (word-level, human-scored,
     same method as `context/measurements.md`'s `hinglish-tts-l1` run) —
     re-use that exact methodology so the number is comparable to our
     existing baseline.
   - **First-audio latency** and **p50/p90 end-to-end latency** under
     realistic network conditions, both cascade arms.
   - **Cost per utterance / per minute**, fully loaded (GPU amortized against
     measured concurrency, not the always-on estimate above).
5. **Decision rule:** Chatterbox (zero-shot or fine-tuned) only replaces
   ElevenLabs-equivalent spend if it **wins or ties on human similarity AND
   accent-authenticity AND stays within an agreed latency budget** — cost
   alone is not a switching reason, on the standing precedent of
   `cost-per-turn` in this repo's own decisions.

### GPU budget rows for owner approval

All dollar figures are **estimates requiring a load test**, not commitments:

| Line item | Est. monthly cost | Basis | Confidence |
|---|---|---|---|
| Fine-tuning compute (batch, not always-on) | ~$50-150/mo at current low volume | RunPod A100 on-demand, few hours/voice | low — depends on # voices/month |
| Serverless TTS inference (ramp phase) | usage-based, RunPod/Modal A100 serverless (~$0.0008-0.0037/s) | until concurrency data exists | low — no load test yet |
| Reserved TTS inference (post-ramp, >~50-60% utilization) | ~$1,145/mo per concurrent-call GPU slot (A100 SXM, unbatched) | RunPod on-demand rate x 24/7 | low — batching capacity unmeasured |
| ASR (IndicConformer self-hosted) | folded into shared GPU pool if colocated with TTS | not separately priced this sweep | unassessed |
| Speaker-verification monitoring (WavLM-ECAPA-TDNN) | small, CPU/low-GPU, batch job not realtime | not separately priced this sweep | unassessed |

**The one number that actually gates a real budget — GPU-seconds per call at
our real concurrency and batching profile — was not measurable from web
research and requires an in-house load test before any of the above rows can
be approved as a real number.**

---

## Open items / follow-ups this sweep did not close

- Verify Chatterbox Multilingual V3's actual VRAM/GPU requirement directly
  (not found in the README).
- Read `arxiv.org/pdf/2605.03073` and `arxiv.org/pdf/2502.07562` in full.
- Confirm whether Moshi's realtime loop can accept a cloned-voice
  conditioning input at all — the single most important unresolved question
  in §3.
- Directly fetch the `Trelis/whisper-hinglish-preview` and IndicConformer
  model cards for actual WER/CER-on-code-switch numbers, not just
  descriptions.
- Independently re-derive or discard the "Sesame CSM 4.7 MOS vs ElevenLabs
  4.8 MOS, gap nearly closed" claim — it conflicts with the MultiVox
  arXiv paper's CosyVoice-vs-ElevenLabs numbers and should not be repeated to
  the owner as settled until one is checked against the other's methodology.
- GLM-Voice and LLaMA-Omni-class realtime models were not evaluated this
  sweep at all.
