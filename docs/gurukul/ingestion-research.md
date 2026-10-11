# Teacher-ingestion pipeline research (voice clone / persona / knowledge extraction)

Research date: 2026-08-25. All claims below are sourced from web search results
gathered on this date via WebSearch (results reflect page content as crawled/cached;
I did not independently WebFetch every underlying page to cross-check the summarizer's
extraction unless noted "verified via WebFetch"). Where a claim could not be
corroborated by more than one source, or where sources conflicted, it is flagged
**[UNVERIFIED]** or **[CONFLICTING]**. Treat all pricing as approximate and
re-check against the vendor's live pricing page before committing to a build —
AI-tool "review" sites (aitoolrise, texttolab, gradium, etc.) that supplied many
of these numbers are SEO content, not the vendors themselves; I've flagged the
few claims I only found on primary vendor docs vs. third-party aggregators.

---

## 1. Voice cloning providers

### ElevenLabs

- **Instant Voice Cloning (IVC)**: ~1–3 minutes of clean mono audio (22kHz+,
  low noise) produces a usable clone; no dedicated model training, relies on
  the base model's prior knowledge → "educated guess" quality, not a
  fine-tuned model. Available from the **Starter ($6/mo... pricing varies by
  region/promo)** tier up.
  Source: https://help.elevenlabs.io/hc/en-us/articles/13313681788305 (2026),
  https://www.sacesta.com/our-work/blog/instant-vs-professional-voice-cloning-elevenlabs-2026-guide
- **Professional Voice Cloning (PVC)**: trains a dedicated model on
  **30 minutes to 3 hours** of audio (ElevenLabs recommends ~3 hours
  studio-grade for production quality, 30 min floor). Training takes
  **3–6 hours**. Requires **Creator tier ($22/mo)** or above; 44.1kHz/192kbps
  "ProVoice" output requires **Scale ($299/mo)+**.
  Source: https://help.elevenlabs.io/hc/en-us/articles/13313681788305,
  aggregated in https://www.sacesta.com/... (2026)
- **Consent verification**: mandatory **voice-captcha** — after upload, the
  user must read a random text prompt aloud within 10 seconds to prove they
  are the live source of the voice, not replaying a recording. PVC additionally
  restricts cloning to "your own voice" plus documented consent for
  third-party voices (i.e., a teacher cloning themself is the compliant path;
  cloning a teacher's voice on the teacher's behalf still needs their
  documented consent, which the product should capture explicitly since the
  *company*, not the individual, is the one calling the API).
  Source: https://margabagus.com/elevenlabs-voice-consent-policy/ (2026),
  https://margabagus.com/elevenlabs-voice-cloning-consent/ (2026)
- **Legal climate**: ≥12 US states now have voice-cloning-specific laws
  (California, New York, Tennessee's ELVIS Act, etc.); EU AI Act requires
  clear disclosure + written consent. Relevant to disclosure UX ("this is an
  AI voice") even though the teacher audience is India — the underlying
  vendor ToS obligations (consent capture, no impersonation without
  authorization) apply regardless of end-user geography.
  Source: same margabagus articles (2026). **[secondary source, not
  independently verified against state statute text]**
- **Language/quality**: supports 32 languages incl. Hindi as of early 2026,
  but multiple reviewers explicitly warn that "supported" ≠ equal quality —
  test the actual accent/script/proper-nouns before committing.
  Source: https://futureagi.com/blog/elevenlabs-vs-cartesia-tts-2026/ (2026)
- **Streaming latency**: WebSocket streaming with `eleven_flash_v2_5` model
  quoted at **~75ms model-inference-only** latency (32 languages incl. Hindi);
  this figure explicitly excludes network RTT and app overhead, and actual
  TTFB depends on caller geography relative to ElevenLabs' PoPs (no India PoP
  confirmed in results — worth testing from Mumbai/Bangalore specifically).
  **Cloned voices are slower than stock voices**: IVC/synthetic voices
  synthesize faster than PVC voices, which "involve additional model
  complexity that adds per-generation overhead" — i.e., the exact config this
  product needs (cloned Hinglish voice, streaming) is ElevenLabs' slowest
  combination, and no vendor-published number exists for that specific
  combination in the search results. **[gap — needs direct measurement]**
  Source: https://elevenlabs.io/blog/meet-flash,
  https://elevenlabs.io/docs/eleven-api/concepts/latency

### Sarvam AI (bulbul)

- **Voice cloning**: Sarvam does offer voice cloning as of 2026 (this was an
  open question in the brief — confirmed yes). It captures vocal traits from
  a **short browser-recorded sample** and exposes the clone as a reusable
  voice across TTS and Dubbing, covering **12 Indian languages** once cloned.
  This is positioned primarily for narration/dubbing reuse rather than
  documented explicitly as low-latency conversational streaming with a
  *cloned* voice specifically (their headline low-latency streaming numbers
  below are demonstrated on stock Bulbul voices; cloned-voice streaming
  latency is not separately published in the results found).
  Source: https://docs.sarvam.ai/creative-voice-cloning (2026)
- **Bulbul v3**: flagship Indian-language TTS, natural prosody, 30+ speakers,
  Hindi + 10 other Indian languages + English, no pitch/loudness control,
  pace 0.5–2.0x, 24kHz default sample rate. **Bulbul v4** published
  **2026-07-30** (post-dates the app's current integration — worth checking
  for cloning support specifically, not found in results).
  Source: https://www.sarvam.ai/blogs/bulbul-v3,
  https://explainx.ai/blog/sarvam-bulbul-v4-tts-emotion-voice-july-2026
- **Streaming latency (stock voices)**: WebSocket streaming, sub-250ms
  first-byte; one source says "streaming latency averages 180ms," another
  says "TTFB under 200ms" — consistent with each other, **not** independently
  verified against Sarvam's own docs page content (only the summarizer's
  extraction was seen). Positioned explicitly for "live telephony pipelines."
  Source: https://docs.sarvam.ai/api-reference-docs/text-to-speech/stream,
  https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/streaming-api/web-socket
- **Pricing**: **₹30/hr** transcription-equivalent... (this figure is
  actually for **Saaras ASR**, not Bulbul TTS — see ASR section below;
  Bulbul TTS pricing was not returned with a clean per-character/per-minute
  figure in these searches). **[gap — check docs.sarvam.ai TTS pricing page
  directly]**
- **Consent/verification**: no explicit voice-captcha-style mechanism
  surfaced in results (unlike ElevenLabs/Azure). **[UNVERIFIED — the product
  should not assume Sarvam enforces consent; build in the product's own
  consent-capture step regardless of vendor]**

### Cartesia (Sonic)

- **Latency**: headline claim is **Time-to-First-Audio as low as 40ms**,
  "sub-100ms TTFA under load at p90 across 100 measurements" in one source —
  this is the fastest latency figure among all providers surveyed and the
  strongest fit for phone-call realism if it holds for cloned Hinglish
  voices specifically.
  Source: https://gradium.ai/content/best-ai-voice-generators-2026,
  https://texttolab.com/blog/cartesia-ai-review (2026)
- **Voice cloning**: **Instant Voice Cloning (IVC)** — short sample, seconds
  to produce; **Pro Voice Cloning (PVC)** — full training run, higher
  fidelity. IVC available from the **Pro tier (~$4–5/mo)**; PVC requires
  **Startup tier ($468/yr, ~$39/mo)** or above.
  Source: https://smallest.ai/blog/cartesia-pricing-plans-cost-what-you-get-in-2026,
  https://texttolab.com/blog/cartesia-pricing
- **Pricing model**: credit-based, 1 credit/character for standard TTS,
  **1.5 credits/character when using Pro Voice Cloning**. Scale plan: 8M
  credits/mo for ~$239/mo.
  Source: https://texttolab.com/blog/cartesia-pricing
- **Hindi/Hinglish**: Cartesia explicitly markets **India-specific
  positioning** ("Speak to India the way India speaks," cartesia.ai/india),
  claims **code-switching support for Hinglish specifically** (calls this out
  by name, alongside Taglish), supports **9 Indian languages**, and claims
  **voice clones transfer across all 42 supported languages** — clone once in
  English/Hindi, speak any supported language including the other. This is
  the only provider whose marketing explicitly names Hinglish code-switching
  as a supported capability (vs. ElevenLabs/others which support "Hindi" as
  one of many languages without special code-switch handling called out).
  Source: https://www.cartesia.ai/india, https://docs.cartesia.ai/build-with-cartesia/capability-guides/multilingual-voices
  — **[marketing claims, not independently benchmarked in these results —
  should be validated with real teacher audio before relying on it]**

### PlayHT

- **Discontinued.** Following Meta's acquisition of PlayAI in 2025, PlayHT's
  products and API services were shut down. Historical pricing (Creator
  $9.99/mo, Studio $34.99/mo) is now irrelevant. **Do not build against
  PlayHT** — treat as dead.
  Source: https://typecast.ai/learn/comparing-ai-voice-cloning-services/ (2026)

### Google (Chirp 3 HD / Vertex AI)

- **Instant Custom Voice**: clones from **as little as 10 seconds** of
  reference audio, reached GA on Vertex AI in **late February 2026**, 8
  pre-built voice personalities, real-time streaming.
  Source: https://www.codesota.com/news/google-chirp-3-voice-cloning,
  Google Cloud TTS release notes
- **Access gate**: **Chirp 3 instant voice cloning remains allow-list gated**
  — requires contacting Google sales even as of an April/May 2026 check.
  This is a real blocker for a self-serve teacher-upload product unless the
  team pursues the enterprise application process ahead of time.
  Source: https://aitoolanalysis.com/google-ai-studio-text-to-speech-review/ (May 2026)
- **Pricing**: **$60 per 1M characters** for Instant Custom Voice (a premium
  tier vs. standard Cloud TTS voices).
  Source: https://texttolab.com/blog/google-cloud-tts-pricing (2026)

### Gemini Live (speech-to-speech)

- Confirmed: **native custom-voice-cloning is not publicly available through
  the Gemini Live API as of August 2026.** Google has been *testing* voice
  cloning in AI Studio (reported late Jan 2026), described as possibly tied
  to a future Gemini 3 Flash, but the currently shipping Live API only
  exposes **30 preset voice_name options**, no BYO-clone path. This directly
  answers the architecture question in §2: you cannot get Gemini Live +
  cloned voice today.
  Source: https://winbuzzer.com/2026/01/30/google-tests-voice-cloning-ai-studio-gemini-xcxwbn/,
  https://ai.google.dev/gemini-api/docs/live-api (checked Aug 2026 framing)

### OpenAI (Realtime API / TTS)

- **Confirmed: no custom cloned voices.** OpenAI's Realtime API (GA since
  **2025-08-28**) exposes a **fixed catalogue only**: Alloy, Echo, Fable,
  Onyx, Nova, Shimmer, Marin, Cedar. "Voice Engine" (OpenAI's cloning tech)
  remains in a **limited preview**, not a public API, "custom voices" are
  gated to enterprise sales contacts.
  Source: https://voxcloneai.com/blog/... (2026),
  https://gradium.ai/content/best-voice-cloning-apis-2026 (2026)
- **Realtime API pricing**: ~$0.06/min audio input, ~$0.24/min audio output
  as of mid-2026 — expensive relative to a cascade, and moot anyway since it
  can't carry a cloned voice.
  Source: https://www.forasoft.com/blog/article/openai-realtime-api-voice-agent-production-guide-2026

### Azure AI Speech (Custom Neural Voice / Personal Voice)

- Two products: **Custom Neural Voice (professional)** — requires a signed
  consent-statement recording from the voice talent, goes through a **~10
  business day** Microsoft review (fraud/impersonation check), Limited Access
  gated (registration + approval required). **Personal Voice** — the
  lower-friction, API-driven option: requires an **explicit recorded consent
  statement** read by the speaker, needs only **~10 seconds** of training
  audio, and can produce a voice model in **as little as 5 seconds**. Also
  Limited Access (registration required) but positioned for programmatic/
  scale use unlike Custom Neural Voice's manual review queue.
  Source: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-overview,
  https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-create-consent,
  https://learn.microsoft.com/en-us/azure/ai-services/speech-service/custom-neural-voice
- Given the codebase already has an Azure AI Foundry integration (grok, GPT
  families, embeddings), **Personal Voice is worth a concrete access-request
  test** — it's the only major-cloud option with sub-10-second cloning *and*
  a documented, product-grade consent-capture flow that would satisfy legal
  review out of the box. Its Hindi/Hinglish streaming quality was not
  evaluated in these searches. **[gap]**

### Provider fit summary (my synthesis, not a single source)

| Provider | Cloning min. audio | Cloned-voice streaming latency | Hindi/Hinglish signal | API self-serve? |
|---|---|---|---|---|
| ElevenLabs PVC | 30min–3hr | not separately published (PVC is slower than IVC/stock) | supported, quality untested by us | Yes, Creator tier+ |
| ElevenLabs IVC | 1–3 min | ~75ms model-only (stock voice figure) | supported | Yes, Starter tier+ |
| Sarvam bulbul clone | short browser sample | not published for cloned voice specifically (stock ~180-250ms TTFB) | best-in-class for Indian langs generally | Yes (existing integration) |
| Cartesia Sonic | short sample (IVC) / full run (PVC) | ~40ms TTFA (headline, voice unspecified) | explicitly markets Hinglish code-switch | Yes, Pro tier+ |
| Google Chirp 3 ICV | 10 sec | real-time streaming claimed | untested | **No — sales allow-list only** |
| Azure Personal Voice | 10 sec | not found | untested | Limited Access, registration required |
| OpenAI | N/A | N/A | N/A | **No custom cloning API at all** |
| Gemini Live | N/A | N/A | N/A | **No cloning; live-testing only, not shipped** |
| PlayHT | — | — | — | **Discontinued, do not use** |

**Recommendation for further work (not independently benchmarked here):**
Cartesia and Sarvam are the two strongest candidates on paper — Cartesia for
raw latency + explicit Hinglish marketing, Sarvam because it's an existing
integration in the stack with strong general Hindi-language credibility. Both
need an actual side-by-side test with 2–3 minutes of a real teacher's Hindi-
English classroom audio, measuring (a) clone fidelity, (b) TTFB with the
*cloned* voice under WebSocket streaming, (c) code-switch handling on
JEE-specific vocabulary (equations read aloud, English technical terms mid-
Hindi-sentence). None of the sources found in this research measured that
combination directly.

---

## 2. Realtime conversation architecture

**Question: does any major realtime (speech-to-speech) API support a custom
cloned voice in 2026?**

**No — confirmed for all three checked (Gemini Live, OpenAI Realtime,
implicitly Azure's realtime speech-to-speech offerings are not positioned
this way either).** This forces the cascade architecture the brief already
anticipated: **STT → LLM → cloned-voice TTS (streaming)**. See provider
findings above for the specific citations (Gemini Live: 30 fixed voices, no
BYO clone shipped; OpenAI Realtime: fixed 8-voice catalogue, Voice Engine
still limited-preview/enterprise-only).

**Cascade latency, current state of the art (2026):**

- General/mixed-vendor cascade in production: **1.5–3 seconds** end-of-user-
  speech to start-of-agent-audio is described as "typical practical" latency
  — i.e., a naive stitched pipeline will likely **miss** the brief's <1.5s
  target without deliberate optimization.
  Source: https://futureagi.com/blog/cascaded-voice-ai-vs-speech-to-speech-2026/,
  https://gradium.ai/content/cascaded-voice-agent-vs-speech-to-speech-2026
- More optimistic figure: **600ms–1,700ms** on "stitched stacks" combining
  separate ASR/LLM/TTS vendors; **co-located stacks** (all three components
  on the same network as the call, e.g. Telnyx's claim) land **under 200ms**
  — but that requires vertically integrating all three legs on one
  infrastructure provider, which conflicts with "use Sarvam/Cartesia for
  cloned TTS" unless that vendor also hosts STT+LLM nearby.
  Source: https://telnyx.com/resources/voice-ai-agents-compared-latency (2026)
- **Component breakdown** (Coval/Gradium May 2026 benchmark):
  - STT time-to-first-token: **992ms (Deepgram Nova-3)** to **2,080ms
    (ElevenLabs Scribe v2)** — a >1-second spread between STT vendors alone.
  - TTS adds **~155ms** (Coval/Gradium TTS benchmark — presumably a
    fast-tier model, not specified which).
  - LLM adds **300–500ms** for the completion itself (first-token time,
    model-dependent).
  Source: https://gradium.ai/content/stt-api-benchmark-2026-latency-accuracy,
  https://www.destilabs.com/blog/ai-voice-agent-benchmark-2026
- **Implication for the <1.5s target**: it is achievable but tight, and
  hinges almost entirely on **STT choice** (Deepgram Nova-3 class, not a
  slow/accurate-but-slow model) plus a **fast-tier TTS** (Cartesia Sonic
  ~40ms TTFA or ElevenLabs Flash ~75ms) plus a **fast/small LLM turn** for
  the conversational reply (not a slow reasoning model). Given the existing
  stack has Azure Foundry (grok, GPT) and Gemini paid/free-pool, the
  fastest-TTFT model available should be selected for the *voice-call* reply
  path specifically, likely different from the text-chat model. **No source
  found benchmarks this exact combination (Sarvam/Cartesia streaming TTS +
  Azure Foundry LLM + Deepgram/Sarvam STT) — this needs to be built and
  measured directly, per the project's own "prefer measuring to reasoning"
  principle.**

---

## 3. YouTube ingestion

- **YouTube Data API v3 does not provide a general video/audio download
  endpoint.** It exposes metadata, and a **captions.download** method — but
  that method (a) requires the calling account to **own/have edit permission
  on the video**, and (b) **only works for manually-uploaded caption tracks,
  not auto-generated captions**. For a teacher who never uploaded their own
  Hindi/English SRT, this is close to useless as the sole ingestion path.
  Source: https://developers.google.com/youtube/v3/docs/captions/download,
  https://youtube2text.org/blog/youtube-data-api-transcripts (2026 analysis)
- **YouTube ToS**: users may not download/reproduce content except (a) via a
  YouTube-provided download button (Premium offline), (b) with the
  uploader's prior written permission, or (c) as allowed by law. **Since the
  teacher IS the uploader/copyright holder of their own videos, self-
  authorization is the clean legal path** — the product should have the
  teacher either (i) grant OAuth access via YouTube Data API so the app acts
  "as the owner," or (ii) simply have the teacher direct-upload the source
  file instead of scraping it back off YouTube. Both sidestep yt-dlp's grey
  area entirely.
  Source: https://developers.google.com/youtube/terms/api-services-terms-of-service,
  https://www.bestvideodownloader.net/how-to-download-youtube-videos-legally-2026/
- **yt-dlp**: the tool itself is legal to distribute/run (no US/EU court has
  ruled against it specifically), but **using it to download from YouTube
  generally violates YouTube's ToS** regardless of whose video it is,
  because YouTube's ToS restricts *downloading* (not just redistribution) to
  the enumerated exceptions above. For "the teacher's own content with the
  teacher's consent," the ToS risk is to YouTube's relationship with the
  *product*, not a copyright claim from the teacher against themself — but
  it's still a ToS violation exposure for the platform. **Recommendation:
  prefer (1) direct file upload by the teacher, or (2) YouTube Data API
  OAuth flow where technically feasible, and treat yt-dlp-style scraping as
  a fallback only, not the default path**, given the product will operate
  at scale across many teachers (higher visibility/risk than one person
  archiving their own stuff).
  Source: https://plisio.net/cybersecurity/yt-dlp (2026),
  https://audioutils.com/blog/is-yt-dlp-legal (2026)
  **[This is a legal-risk judgment call synthesized from general-audience
  "is X legal" content sites, not from a lawyer or from YouTube's own
  enforcement statements — flag for actual legal review before shipping.]**

### ASR for Hinglish + diarization

- **Sarvam Saaras (v1/v3)** is the standout performer specifically on
  Hinglish code-switching: it "maintains phonetic integrity of mixed input"
  rather than translating Hindi into English mid-transcript, which is the
  failure mode Whisper exhibits. Reported to "outperform competitors
  significantly in Tamil and Hinglish."
  Source: https://www.autointerviewai.com/blog/sarvam-ai-bulbul-saaras-indic-voice-models-review-2026
- **Whisper large-v3**: on code-switched speech with **distinct-script
  language pairs (i.e., Hindi-English, Devanagari↔Latin)**, character error
  rate (CER) ranges **32.33%–51.62%** — a severe degradation vs. same-script
  pairs (7.32–28.26% CER). This is a strong, specific, numeric red flag
  against using Whisper large-v3 as the primary Hinglish ASR.
  Source: cited from search-result summary of a benchmark paper (title not
  fully resolved in results — **[gap: re-fetch the source arXiv/benchmark
  paper directly to confirm exact CER numbers and methodology]**)
- **Gemini** (2.5 Pro, audio transcription): **18.5% WER on Hindi**,
  "ranking second among tested models" in one benchmark; strong diarization
  claimed generally but **no structured word-level-timestamp + per-utterance
  speaker-label output** the way dedicated ASR APIs provide — meaning Gemini
  may transcribe well but requires more prompt-engineering to get clean
  diarized output.
  Source: https://medium.com/@samarrana407/geminis-hidden-power-... (2026),
  general Gemini audio docs
- **AssemblyAI / Deepgram**: strong on general code-switching benchmarks
  broadly (Universal-3.5 Pro: 7.69 WER on a normalized code-switching
  benchmark; Deepgram Nova-3 Multilingual: 12.22 WER) but **these figures are
  not specifically Hindi-English** — the benchmark language pairs used
  weren't confirmed to include Hinglish in these results. **[gap — the
  9.94–12x gap between best (Universal-3.5 Pro, 7.69) and worst (GPT-4o-
  Transcribe, 44.58) shown for "code-switching" generally is suggestive but
  not proof for the Hindi-English case specifically]**.
  Source: https://www.assemblyai.com/blog/comparing-universal-2-and-openai-whisper (2026)
- **Speaker diarization for Indian languages specifically**: a new benchmark,
  **Indic DiarBench** (arXiv, 2026), targets exactly this gap — ~108 hours
  spanning all 22 scheduled Indian languages, explicitly modeling English
  code-mixing, dialect variation, and speaker overlap. This is the most
  relevant academic resource found and worth pulling numbers from directly
  if a defensible ASR choice is needed.
  Source: https://arxiv.org/html/2607.23808 (2026) — **not yet read in full;
  only the abstract-level framing was retrieved via search summary**
- **Pricing**:
  - Sarvam Saaras v3: **₹30/hr** transcription-only, **₹45/hr** with
    diarization, billed per second (or ₹1.5/min quoted elsewhere — these
    are roughly consistent: ₹1.5/min × 60 = ₹90/hr, which does **not**
    match the ₹30/hr figure — **[CONFLICTING, re-check Sarvam's own pricing
    page directly before budgeting]**).
    Source: https://www.callmissed.com/en/models/saaras-v3,
    https://telenow.ai/voice-ai/stt/sarvam/
  - AssemblyAI: **$0.15/hr** (Universal-2, async) to **$0.21/hr**
    (Universal-3.5 Pro, async); streaming/sync **$0.45/hr**; bundled
    Voice Agent API (STT+LLM+TTS) flat **$4.50/hr**.
    Source: https://brasstranscripts.com/blog/assemblyai-pricing-per-minute-2025-real-costs (2026)
  - Deepgram: bundled Voice Agent API also **$4.50/hr** as of early 2026;
    per-minute STT-only rate not resolved in these results. **[gap]**
  - **Neither AssemblyAI nor Deepgram's Hindi-specific pricing or Hindi
    accuracy was found** in these searches — both are US/English-centric
    vendors and their marketing did not surface Hindi benchmark numbers.
    This is itself informative: **for a Hinglish-first product, Sarvam
    Saaras is the best-evidenced choice on both cost and code-switch
    accuracy**, with Gemini audio as a plausible second opinion / cross-
    check given it's already integrated in the stack.

**Recommendation**: use **Sarvam Saaras (v3, with diarization)** as primary
ASR for ingestion, since it's (a) already cost-known, (b) specifically
benchmarked as strong on Hinglish, (c) already an integrated vendor in this
codebase (per CLAUDE.md), avoiding a new procurement/consent-of-data-handling
review. Consider **Gemini audio transcription as a cheap cross-check /
fallback** since Gemini is already free-pool + paid integrated. Do **not**
rely on Whisper large-v3 alone for Hindi-English code-switch — the CER
numbers found are a real quality risk for a product whose bar is
"indistinguishable from the real teacher."

---

## 4. Persona extraction from transcript — prior art

This is the weakest-evidenced section: **there is essentially no direct
"product" prior art found for "extract a structured persona/character-sheet
from a long real-person transcript for voice-cloning/companion purposes."**
What exists splits into two unrelated buckets:

1. **Academic LLM-personality-assessment work** (mostly about *measuring*
   an LLM's own personality, or scoring *human* personality from short
   open-ended text via zero-shot LLM scoring) — adjacent but not the same
   task as "extract this specific teacher's speaking-style fingerprint from
   3 hours of classroom footage." Notable: a **Nature Human Behaviour**
   paper (2025) on zero-shot generative AI scoring of personality from
   brief open-ended text is the most rigorous nearby result, suggesting
   LLM-based personality scoring against Big-Five-style frameworks is a
   validated technique in principle, even though it wasn't built for this
   exact pipeline.
   Source: https://www.nature.com/articles/s41562-025-02389-x (2025)
2. **AI-companion / character-creation platform guidance** (Character.AI-
   style products) — practical but generic advice: character sheets should
   specify concrete behavioral rules ("uses dry humor, responds to serious
   questions with deadpan one-liners") rather than vague trait labels, and
   **3–5 example dialogues are called out as the single most effective way
   to shape behavior** — this directly echoes this project's own
   `persona.ts` lesson in CLAUDE.md that "anything sentence-shaped in a
   prompt gets recited" (i.e., example dialogues shape behavior but also
   risk verbatim recitation — worth cross-referencing `context/rejected.md`
   before designing the extraction pipeline's output format).
   Source: https://promptslove.com/blog/character-sheet-prompts/,
   general Character.AI 2026 guide (https://www.codaone.ai/blog/character-ai-complete-guide-2026/)
- **Synthia** (arXiv 2025): "Scalable Grounded Persona Generation from Social
  Media Data" — closest academic analogue found: generating structured
  persona profiles grounded in real behavioral data at scale, though the
  source data is social media posts, not spoken transcripts, and the paper
  wasn't read in full (only surfaced via title/abstract in search).
  Source: https://arxiv.org/pdf/2507.14922 (2025) — **[not fetched/read in
  full — worth a direct read if pursuing an automated 50-field extraction
  pipeline, since this is the single closest match to "extract structured
  persona attributes from a large corpus of a real person's own words"]**
- **No papers or products found that specifically address**: (a) extracting
  **filler-word distributions** (statistical/computational, not LLM-vibes)
  from a transcript as a distinct pipeline stage, or (b) extracting
  catchphrases via frequency/n-gram analysis as a complement to LLM
  qualitative extraction. **This suggests a practical, not survey-able, gap
  — the pragmatic approach is likely a hybrid**: (1) a cheap statistical
  pass (n-gram/phrase-frequency extraction, filler-word counting via a
  fixed Hinglish filler lexicon — "matlab," "toh," "basically," "like,"
  "achha," etc.) feeding hard numbers into the character sheet, **plus**
  (2) an LLM qualitative pass over transcript chunks to fill
  judgment-requiring fields (tone, teaching style, humor register, warmth),
  informed directly by this project's own hard-won CLAUDE.md lesson: write
  the *shape* of the trait into the sheet, never a verbatim quote the LLM
  could later recite back as if scripted.
  **[This entire recommendation is my synthesis from the absence of direct
  hits, not a sourced claim — flag clearly as such.]**

---

## Open gaps / things NOT verified in this pass

- Exact TTFB for a **cloned** (not stock) voice under streaming, for both
  Cartesia and Sarvam — the specific configuration this product needs.
  Needs direct measurement, not vendor marketing.
- Sarvam Bulbul TTS *per-character/per-minute* pricing (only Saaras ASR
  pricing was found cleanly; the ₹30/hr vs ₹1.5/min figures for Saaras
  itself also conflict and need reconciling against Sarvam's live pricing
  page).
- Bulbul v4 (July 2026) capabilities vs v3, and whether v4 adds/changes
  cloning support.
- Azure Personal Voice's actual Hindi/Hinglish quality and streaming
  latency — found the consent/access mechanics but no quality benchmark.
- Deepgram's per-minute STT-only pricing and any Hindi-specific accuracy
  number.
- Legal risk assessment of yt-dlp-based ingestion at product scale — the
  sources used here are general "is it legal" content sites, not legal
  counsel; treat my §3 recommendation as directional, not a legal opinion.
- Direct read of the Indic DiarBench and Synthia papers (only abstracts/
  summaries were seen via search results, not fetched in full).
- No source found that benchmarks the *exact* cascade this product would
  run (Sarvam/Cartesia streaming TTS + Azure Foundry or Gemini LLM +
  Sarvam/Deepgram STT) — all cascade latency figures are for other vendor
  combinations and are indicative, not predictive.

Sources consulted (representative, not exhaustive — see inline citations
above for the specific claim-to-source mapping):
- https://help.elevenlabs.io/hc/en-us/articles/13313681788305
- https://elevenlabs.io/blog/meet-flash
- https://elevenlabs.io/docs/eleven-api/concepts/latency
- https://margabagus.com/elevenlabs-voice-consent-policy/
- https://docs.sarvam.ai/creative-voice-cloning
- https://docs.sarvam.ai/api-reference-docs/text-to-speech/stream
- https://www.sarvam.ai/blogs/bulbul-v3
- https://explainx.ai/blog/sarvam-bulbul-v4-tts-emotion-voice-july-2026
- https://www.autointerviewai.com/blog/sarvam-ai-bulbul-saaras-indic-voice-models-review-2026
- https://www.cartesia.ai/india
- https://docs.cartesia.ai/build-with-cartesia/capability-guides/multilingual-voices
- https://texttolab.com/blog/cartesia-pricing
- https://typecast.ai/learn/comparing-ai-voice-cloning-services/ (PlayHT discontinued)
- https://www.codesota.com/news/google-chirp-3-voice-cloning
- https://aitoolanalysis.com/google-ai-studio-text-to-speech-review/
- https://winbuzzer.com/2026/01/30/google-tests-voice-cloning-ai-studio-gemini-xcxwbn/
- https://ai.google.dev/gemini-api/docs/live-api
- https://voxcloneai.com/blog/voxclone-ai-voice-agent-api-vs-openai-realtime-api-which-is-better-for-voice-agents-in-2026
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-overview
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-create-consent
- https://futureagi.com/blog/cascaded-voice-ai-vs-speech-to-speech-2026/
- https://telnyx.com/resources/voice-ai-agents-compared-latency
- https://gradium.ai/content/stt-api-benchmark-2026-latency-accuracy
- https://developers.google.com/youtube/v3/docs/captions/download
- https://developers.google.com/youtube/terms/api-services-terms-of-service
- https://plisio.net/cybersecurity/yt-dlp
- https://www.autointerviewai.com/blog/sarvam-ai-bulbul-saaras-indic-voice-models-review-2026 (Saaras Hinglish)
- https://www.assemblyai.com/blog/comparing-universal-2-and-openai-whisper
- https://arxiv.org/html/2607.23808 (Indic DiarBench)
- https://www.callmissed.com/en/models/saaras-v3
- https://brasstranscripts.com/blog/assemblyai-pricing-per-minute-2025-real-costs
- https://www.nature.com/articles/s41562-025-02389-x
- https://arxiv.org/pdf/2507.14922 (Synthia)
- https://promptslove.com/blog/character-sheet-prompts/
