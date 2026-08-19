# SPEECH-STACK-RAW — evidence, quotes, URLs, verification status

Companion to `SPEECH-STACK.md`. WS-SPEECH-STACK, 2026-08-19.

**Verification key**

| tag | meaning |
|---|---|
| **[V]** | I fetched the primary source and read it in this session |
| **[R]** | relayed to me by the coordinating agent from a document I could not fetch |
| **[S]** | search-result snippet only; the primary source 403'd or was not fetched |
| **[U]** | vendor marketing or SEO round-up; **unverified**, and treat the number as a claim |
| **[T]** | in-tree — from this repo's own `context/` or source files |

---

## A. The PhysicsWallah article

### A0. Retrieval status

The article the owner sent — **"Teaching a speech engine to read mix-code",
Anshik Bansal, PhysicsWallah, 2026-08-10** — is **unreachable by fetch**. Medium
serves Cloudflare 403 to `WebFetch`; `freedium.cfd` returns a 502 through the
agent proxy; the article does not appear in any mirror or search index I could
reach. Its contents in `SPEECH-STACK.md` §3.1–3.2 are **[R]** — supplied by the
coordinating agent from the owner's PDF (17 pages). **I did not verify them and
they should be attributed to PhysicsWallah, not to this document.**

**What I did recover, and how.** Medium's *RSS feed* for the publication is
served without Cloudflare interception even though the HTML pages are not:

```
https://medium.com/feed/physicswallah-engineering        → 200, full content:encoded
https://engineering-at-physics-wallah.medium.com/feed    → 200
https://medium.com/physicswallah-engineering/<slug>      → 403
```

The feed carries the last ten posts with **full body text**. Worth recording as
a general technique: **when Medium 403s, try `/feed`.** It did not contain the
mix-code article (published 2026-08-10, already outside the ten-item window on
2026-08-19), but it did contain the sibling piece below.

### A1. [V] The sibling article, recovered in full

**"A State-of-the-Art Survey of Text-to-Speech Technology 2025", Jaskaran Singh,
PhysicsWallah Engineering, Dec 2025.**
<https://medium.com/physicswallah-engineering/a-state-of-the-art-survey-of-text-to-speech-technology-2025-976e178abbd3>
(page 403s; recovered via the publication RSS feed, full text saved to
`/tmp/pw-tts.txt` during this session)

It is a survey of architectures, **not about code-mixing at all**. Relevant
extracts:

- Framing: *"Non-Autoregressive and Autoregressive paradigms are taken over by
  Diffusion and LLMs… more importance has been given to data sourcing and data
  cleaning, while architecture are being made easy to scale."*
- **F5-TTS** — does not model duration, takes it as input decided from
  characters-per-second at inference, removing the text-alignment requirement.
  Trained on 95K hours English + Chinese. *(This is the base that
  `harrrshall/hinglish-tts` builds on via IndicF5.)*
- **Chatterbox** — 0.5B Llama backbone, semantic tokens at 25 Hz, speaker
  encoder + language embedding + **emotional-valence embedding**; *"first open
  source TTS model to support emotion exaggeration control with robust
  multilingual zero-shot voice cloning"*; 23 languages, 500K hours; *"ultra-low
  latency of sub 200ms"* **[U — vendor claim relayed by the survey]**.
- **Kyutai** — delayed-streams modelling; *"delayed streaming allows to generate
  word by word as text arrives with 220ms latency"*; symmetric — delay the text
  stream instead and you get STT. 2.5M hours EN/FR. *"up to 32 requests
  simultaneously and we observe a latency of 350ms, using a L40S GPU."*
- **IndexTTS2** — *"Speaker perceiver encodes… only acoustic properties like
  timbre… The Emotion Perceiver Conditioner… a GRL (Gradient Reversal Layer) is
  added on speaker classification task… hence destroying the acoustic
  information in the Emotion embedding."* 55K hours (30K Chinese, 25K English).
  **This is the mechanism `AFFECT-CONTINUITY.md` §4.3 wants** — timbre and
  emotion genuinely disentangled — and the training mix confirms there is
  effectively no Indic data in it.
- **Its closing line, which is the one that matters to us:** *"all of these
  models works directly on graphemes and shows cross lingual generation with just
  scaling data in languages, no parallel language speech data and show Zero-Shot
  capabilities."*

> **Why that last sentence matters.** "Works directly on graphemes" is precisely
> the property that makes romanised Hindi a hazard: a grapheme model reading
> Latin letters applies whatever letter-to-sound mapping its training implies.
> It is also why `languageCode: "hi-IN"` could plausibly fix it — the language
> conditioning is what selects the mapping. This is the strongest external
> support I found for §4.1's hypothesis, and it comes from the same engineering
> team as the article the owner sent.

### A2. [V] The released artifact corroborates stage 1

<https://huggingface.co/PhysicsWallahAI/muril-hinglish-lid>

| field | value |
|---|---|
| task | token-level HIN/ENG LID on **romanized** Hinglish |
| params | **237M** (MuRIL backbone `google/muril-base-cased` + token-classification head), 12 layers, hidden 768, WordPiece vocab 197,285 |
| licence | **Apache-2.0** |
| training data | proprietary Indian K-12 tutoring text, **2.78M labelled tokens across 23,727 answers**; not released |
| held-out gold | **0.9920** accuracy (874 answers, 108,432 tokens); HIN F1 **0.9927**, ENG F1 **0.9912** |
| out-of-domain | **LinCE Hindi-English 0.9643** |
| explicitly NOT for | *"Devanagari transliteration itself"*, general multilingual LID, sentence-level classification |

Card motivation matches the article's stated rationale: contextual disambiguation
of homographs, e.g. *"to"* as English "to" vs Hindi "तो".

**The generator (11.1M char-level Transformer) and the reranker are not
released.** Only this LID head is. That is the load-bearing fact behind
`SPEECH-STACK.md` §6.3.

The 2.76-point in-domain→out-of-domain drop (0.9920 → 0.9643) is independent
corroboration of the article's own honesty about domain-boundedness, from a
second direction.

---

## B. In-tree evidence (all **[T]**)

### B1. The TTS lane — `api/speech.js`

| constant / figure | value | comment in file |
|---|---|---|
| `MODEL` (paid) | `google/gemini-3.1-flash-tts-preview` via OpenRouter | |
| `FREE_MODEL` | `gemini-3.1-flash-tts-preview` direct | 2.5 *"cannot stream: it answers a streaming request with HTTP 200 and ONE frame holding the whole file"* |
| `DEFAULT_VOICE` | `"Aoede"` | *"HER VOICE, EVERYWHERE… To move her voice, move it HERE and in the two live speechConfigs together — liveCall.ts and LiveWatchEngine.java — or this comes straight back."* |
| `FLUSH_MIN` | 1000 bytes | *"THIS NUMBER IS DELIBERATELY SHARED between the flush gate and the 'this key is spent' test… a key that produced less than this never flushed a byte, so retrying onto a second key can never splice two different renderings of the same phrase together."* |
| `PAID_ARM_MS` | 1500 | free lane clears the gate at **722 ms p90 (n=10)**; a serial fallback produced a **20180 ms worst case in a run of 8** |
| `FREE_FIRST_FRAME_MS` | 1400 | healthy keys **615–1051 ms** first frame, 6 of 9 in the live pool; one sick key took **6518 ms** to return its 503 |
| streaming benefit | **1321 ms p50 complete** streamed vs **2064 ms** non-streamed, n=10/6 | *"streaming is not only earlier to its first frame, it is earlier to its last one too"* |
| frame geometry | 1920 bytes = exactly 40 ms of L16/24 kHz mono; generation **1.6–2.2× realtime** | |
| style sanitiser | strips `[]{}<>` and quotes from `style`, caps at 120 chars | direction length adds **~0.6 s** measured between a full paragraph and none |
| attribution | `X-Meera-Lane`, `X-Meera-Pool` response headers | added because a first production battery had **p50 1000 ms vs p90 2427 ms** with no way to attribute it |

The Leda→Aoede incident, verbatim: *"a call that started live (Aoede) and fell
back to the cascade (Leda) swapped her for a different woman mid-sentence, and
screen share — where the live→cascade handoff is most likely — was where it was
heard: 'two or three different voices', reported as multiple personalities. Both
lanes were working exactly as designed; they just disagreed about who she was."*

### B2. The live lane — `liveCall.ts` and `api/live-token.js`

`liveCall.ts:2464-2466`:
```
speechConfig: {
  voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
  languageCode: "hi-IN",
},
```

The comment block above it (`liveCall.ts:2441-2463`), which is the single most
important text in this investigation:

> *"HOW HER VOICE GETS ITS PERSONALITY, and where it does NOT come from. There is
> no expressiveness knob here to turn: **the native-audio model speaks the
> characters she emits**, so her stretched vowels, '…' pauses and written-out
> laughter ARE the prosody… Measured and rejected, so nobody re-chases them:
> `enableAffectiveDialog` NOT A FIELD on v1alpha BidiGenerateContent — the server
> closes 1007 'Unknown name enableAffectiveDialog at setup'… **dropping
> `languageCode`** — no consistent prosodic gain (A/B, n=5 each, identical
> prompt: pitch range 21.2 vs 25.2 st, pauses 23.2/min vs 10.9/min — the two
> measures move in OPPOSITE directions, which at this n is noise, not a result),
> and **unpinning it gives up the hi-IN phoneme handling her Hinglish depends
> on. Keep it pinned.**"*

Note precisely what was and was not measured: **pitch range and pause rate**
(prosody). **Pronunciation was not an outcome variable.** That is the gap TEST L1
fills.

Other setup facts:
- `inputAudioTranscription: {}` and `outputAudioTranscription: {}` — both on;
  consumed at `liveCall.ts:2577-2578` into `myBuf` / `herBuf`.
- `endOfSpeechSensitivity: "END_SENSITIVITY_HIGH"`, `silenceDurationMs: 300`,
  `prefixPaddingMs: 60`; `thinkingConfig: { thinkingBudget: 0 }` because thinking
  added **3–5.5 s vs ~0.9 s** of dead air.
- `startOfSpeechSensitivity` is a **no-op for barge-in**: 14 sessions, LOW and
  HIGH behaviourally identical (full-level speech interrupts in 123–136 ms at
  both; a 0.12-gain "distant TV" in 203–216 ms at both).
- `activityHandling: NO_INTERRUPTION` measured **~16 s of deafness on a ~9 s
  reply**.
- Text-in path exists: `liveCall.ts:2653` sends
  `clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true }`.
  **This is the probe vehicle for TEST L1.**
- Echo: at −12 dB echo return loss, **her own words appeared in
  `inputTranscription` in 5 of 6 sessions** with no barge-in involved
  (`liveCall.ts:1827`) — the reason the ring gate carries an echo term.

`api/live-token.js` model bake, end-to-end on real audio, established multi-turn
session, full production system instruction:

| model | median first audio |
|---|---|
| `gemini-3.1-flash-live-preview` | **1550 ms** [n=16], IQR ~120 ms |
| `gemini-2.5-flash-native-audio-preview-09-2025` | 2536 ms [n=21], IQR ~1400 ms |
| `gemini-2.5-flash-native-audio-preview-12-2025` | 3298 ms [n=8] |
| `gemini-2.5-flash-native-audio-latest` | 3–5.5 s (thinking-heavy) |

*"3.1-flash-live is also far TIGHTER… which is what 'she answers like a person'
actually depends on — a reply that is sometimes 1.5s and sometimes 5.5s reads as
broken in a way a steady 1.5s does not."*

### B3. The STT map — file and line

| lane | file:line | evidence |
|---|---|---|
| live server ASR | `liveCall.ts:2470-2471` | `inputAudioTranscription: {}` / `outputAudioTranscription: {}` |
| watch lane | `WatchEngine.java:214-220` | `SpeechRecognizer.createSpeechRecognizer`, `EXTRA_LANGUAGE = "en-IN"`, `LANGUAGE_MODEL_FREE_FORM`, partials on |
| beep-free call mic | `PipedRecognizer.java:207-219` | `createOnDeviceSpeechRecognizer`, `EXTRA_LANGUAGE = "en-IN"`, PCM piped via `EXTRA_AUDIO_SOURCE`, `EXTRA_SEGMENTED_SESSION`; line 283 *"fire-and-forget: make sure the en-IN on-device pack stays installed"* |
| web / voice notes | `speech.ts:1713-1720` | `SpeechRecognition \|\| webkitSpeechRecognition`, `rec.lang = "en-IN"`, `interimResults`, `continuous` |
| voice-note recording | `Chat.tsx:1120-1272` | `MediaRecorder` + `listen()` in parallel; **only `st.transcript` is sent**; `srFails >= 4` stops a hot-looping recogniser; clip goes to `registerLocalClip` |
| audio leaving the device | — | **grep of `api/` for `inline_data` / `mimeType: audio` / audio upload: no hits.** No server-side audio ingestion exists. |

`speech.ts:1660-1711` dispatches native to the CallMic continuous lane if
`callMicUsable()`, else `legacyNativeListen`. `speech.ts:3` header: *"STT: native
Android SpeechRecognition (WebView has none), web SR fallback."* — i.e. the
choice was availability, not evaluation.

The prompt-side error-correction layer, `persona.ts:391`:

> *"HOW YOU HEAR THEM: their words reach you as speech-to-text of fast Hinglish
> and often contain errors — Hindi heard as English, English as Hindi, sound-alike
> swaps (scheme/skim, reel/real, baat/bat, sale/sail). Never respond to a literal
> transcript that makes no sense in context… Pick your move by stakes, like a
> person who half-heard: small talk or recoverable from context → just go with
> the obvious reading… matters a little → fold a casual guess-check into your
> reply… really matters (names, feelings, plans, times) → ask naturally and
> specifically… Max TWO tries at clarifying the same unclear thing."*

### B4. The script contract per engine — `persona.ts` + `useCallEngine.ts`

`useCallEngine.ts:371-375`:
```
const engine: VoiceEngine = state.sarvamKey ? "sarvam"
  : state.elevenKey ? "eleven"
  : "gemini";
```
`useCallEngine.ts:1645` → `buildSpeechStyle(engine)`; `:1648` → `buildSpeechStyle("live")`.

`persona.ts:453`, the `sarvam` branch:
> *"Write Hindi words in Devanagari script and English words in Latin script
> (mixed-script Hinglish): 'अच्छा, matlab तुमने सच में entire season finish कर दिया?
> impressive.' This is how your voice sounds most natural."*

Contrast `persona.ts:151`, the default texting register:
> *"Roman Hindi shortforms always: nhi, h (hai), hn, acha, thik h, yr/yaar, bt,
> kl, pta nhi, mjhe, kyu, abhi, bas, matlab, arre, chal, scene, vaise. **Never
> Devanagari unless they use it.** Never translate a Hindi word."*

`speech.ts:756` (device TTS): per-phrase language selection by script detection —
`lang: /[ऀ-ॿ]/.test(p.t) ? "hi-IN" : "en-IN"`. The same idea as the live pin,
applied at phrase granularity, on the lane that matters least.

`speech.ts:424-447` Sarvam call: `language_code: "hi-IN"`, `speaker: "priya"`,
`model: "bulbul:v3"`, `pace: 1.0`, `speech_sample_rate: 24000`,
`enable_preprocessing: true`, text passed through `stripForDevice` (which strips
audio tags and emoji but **leaves Devanagari intact**).

`speech.ts:1-11` priority header:
> *"1. Sarvam bulbul (user key) — best native Hinglish accent. 2. ElevenLabs v3
> (user key) — emotion champion, audio tags. 3. Meera voice (hosted,
> zero-config)… 4. Device TTS — last resort."*

`speech.ts:150-160` — why the hosted Gemini lane strips tags: *"there is no
evidence it performs audio tags. She emits them constantly on the cascade lane —
[excited], [laughs], [sighs], [softly], [giggles], [curious], **measured on 10 of
10 replies**… The bet is asymmetric: a performed tag buys a small flourish, an
unperformed one has her literally saying the word 'excited' mid-sentence."*

`persona.ts:430-446` records the resolution: a tag vocabulary in the brief while
the tone rule forbade brackets produced stage directions on **10/10** cascade
replies, and displaced the register — *"written laughter on the cascade lane
measured 0.15 per 100 words against 2.76 on the live lane, because the tag was
doing the job the spelling is supposed to do."*

### B5. `context/` figures used

| entry | figures |
|---|---|
| `azure-tts` / `voice-ears` | 11/15 vs 15/15 Hindi words; 4.9–12.7 s vs 255 ms first audio; $0.0148 vs $0.0029; 266 Hz vs 210 Hz; +6.2 dB vs none CAPS. Verdict *"tender_2 is fully fucked, not human and not Indian. laugh_2 is the worst thing ever."* 9 lines from her register, 4 arms, delivered as WAVs. **The ASR trap: recall 0.93 (coral) vs 0.71 (control), "not a quality ranking — expressive delivery lowers ASR recall"; control 0.0 on the laughter line "because it laughs over its own words."** |
| `prosody-baseline-f0-gap` | median f0 **212 Hz** run 1, **214 Hz** run 2 (+0.9% drift), 5-line fixed deck, autocorrelation 30 ms frames, 70–400 Hz confidence-gated, same paid lane / voice Aoede / PCM 24 kHz. Logged to `evals/dbattery/prosody-baseline-log.json`. Drift alarms ±8% f0, ±20% duration, hard alarm on model-string change. Self-described as *"a finding, not yet a verdict"* pending the D6 listen. |
| `free-tts-daily` | all 9 keys 429 **together** after a few dozen calls; two hours earlier, 6 healthy at 615–1051 ms, one 429, two 503. *"Planning that assumed 'free serves TTS' was measuring an empty budget."* |
| `openrouter-no-stream` | `stream:true` 2267 ms first byte / 2283 ms complete / 15 chunks vs baseline 1742/1768/13 — *"the whole clip lands ~20 ms after the first byte."* Production same day: **10 of 12 requests served by the paid lane; free-served p50 886 ms, paid-served p50 2476 ms.** |
| `openrouter-streaming` (rejected) | *"a **billed Google key** is the tier that matters between free quota and OpenRouter — same streaming endpoint as the free pool, ~600 ms to first frame, and it simply never 429s."* |
| `live-model-bake` | exactly **six** models support `bidiGenerateContent`; three self-disqualify. Incumbent **1370 ms / IQR 231 ms / 0-24 silent / video accepted / barge-in 5-5 @ 279 ms**. Alternatives: 2449 ms & 2272 ms, video **rejected**, barge-in 4/5 @ 1323 ms against a **600 ms** `RELEASE_WATCHDOG_MS`. |
| `live-floor` | text turn, no VAD wait = **720 ms (n=15)** — *"untouchable from the client"*; audio path adds ~745 ms; `silenceDurationMs` 150/300/500 land within **50 ms** of each other. |
| `realtime-azure` | Azure `gpt-realtime-2.1-mini`: barge-in **6/6 @ median 271 ms**, vision **5/5 correct 0 fabricated**, latency 1458–1497 ms. Disqualified on **41→53 words/turn** vs incumbent 20.5, **median 14.0 s spoken turn**, questions 13/24. **Six voices 137–192 Hz** vs the 266 Hz anchor. Hinglish quality poor (*"doesna nahi chahiye", "tez diwane"*) but **0/24 Devanagari** — romanised output survived. No continuous frame channel. |
| `ack-bracket-direction` | `[laughs softly]` → laughter **plus the spoken word "Softly."** *"A direction in a TTS payload is performed as words… bracket-shaped text is not inert anywhere in this system."* |
| `murmur-timbre` | a synthesised "mm" borrows her pitch range but is not her voice — *"weird, and it doesn't have her energy even if it's just listening."* **Timbre was the one property nobody measured.** |
| `backchannel` | the mic-hold protection and the turn-splitting damage are the same act; +171 ms / +85 ms / −171 ms table. |
| `recited-prompt` | example quotes recited 4/5 → 0 at n=84; taste-as-sentences read out verbatim twice eight turns apart, register defection 13/96 → 0/32. |
| `cost-per-turn` / `cache-9x` | chat $0.0019/turn at 99.8% cached; **$0.0160 vs $0.0017 — 9.2× cheaper with caching**; $5,000 ≈ 2.7M chat turns or ≈35,000 ten-minute calls. *"Cost is not this project's constraint; quality is."* |
| `Sarvam and every Indic-specialist model` (rejected) | *"tuned for formal Devanagari Hindi. Casual romanised Hinglish is the opposite requirement. On Indi-RomCoM, Sarvam-30B scores below Claude Opus 4.6 at every code-mixing intensity."* (that entry is about the **LLM**, not Bulbul the TTS — worth not conflating) |
| `MEMORY-FIELD-SURVEY.md` adopt #3 | *"We run four retrieval paths concurrently and then **concatenate** them into labelled blocks; they never rank against each other, so the slot budget is spent by ordering rather than merit."* … *"labelling and ranking are separate concerns and we conflated them."* **ADOPT** RRF fusion + one co-citation hop (A3). |
| `AFFECT-CONTINUITY.md` §4 | emotion-out requires **zero new code**; `enableAffectiveDialog` is a Gemini 2.5 Live feature, *"Not supported in Gemini 3.1 Flash Live"*; Hume Octave separate ≤100-char `description` field is *"structurally zero"* leak risk; IndexTTS2 is *"the only thing in the field that solves the actual problem — hold her voice, move her feeling"*; §4.4 states the pitch-anchor problem first. |
| `AFFECT-CONTINUITY.md` §3.3 | Interspeech 2025 MSP-Podcast, 324+ h, ~120 teams: categorical 8-class macro-F1 **0.4316** best / 0.3293 baseline; dimensional avg CCC **0.6076**. *"I found no published SER evaluation on Indian-accented conversational Hinglish over a phone channel."* |

---

## C. External sources

### C1. [V] Sarvam Bulbul v3 — the docs contradict the marketing

<https://docs.sarvam.ai/api-reference-docs/models/bulbul> (fetched)

> **"Transliterated input (e.g., `"Aapka order confirm ho gaya hai"`)
> significantly reduces output quality."**
> **"Always use native script for Indic words."**

Other facts from the same page: **37 named speakers** (Priya is among them; no
age or gender descriptions given); REST + HTTP streaming + WebSocket; sample
rates above 24 kHz are **REST-only, not available in streaming mode**; `pace`
0.5–2.0; **pitch and loudness are v2-only, removed in v3**; no emotion field
documented; 2,500 characters per REST request; no latency figures in the docs.

**[S/U] Contradicting marketing**, from the Bulbul v3 launch blog (page 403'd;
snippet via search): *"achieves the lowest CER across every Indian-relevant
domain, outperforming global TTS systems on numerics, STEM, named entities,
**code-mixing, Romanized text**, and abbreviations"*, and *"sub-250ms streaming
latency"*. <https://www.sarvam.ai/blogs/bulbul-v3>

> **Treat the docs as operative.** They are the more conservative and the more
> specific source, and they are what a developer integrating the API is told.
> Our `persona.ts` Sarvam branch already complies with the docs.

**[S/U] Pricing:** ₹30 per 10,000 characters beta, ₹100 free credits.
<https://www.sarvam.ai/text-to-speech> · <https://docs.sarvam.ai/api-reference-docs/text-to-speech/api/rest-api>
*My arithmetic, not theirs:* ₹30/10k chars ≈ **$34 per million characters** at
₹88/USD ≈ **$0.028 per minute** of speech at ~825 chars/min. One secondary source
quotes "$3.60 per million characters", which is off by ~10× from the rupee figure
— **do not use the USD number without checking it against the rupee price.**

**[S/U] Saaras V3 ASR:** *"19.31% WER on the 10 most popular languages subset of
IndicVoices."* <https://www.sarvam.ai/blogs/asr> (403 to fetch)

### C2. [V] Google Gemini TTS

<https://docs.cloud.google.com/text-to-speech/docs/gemini-tts>

- Models: **Gemini 3.1 Flash TTS (Preview)** — low latency, single/multi-speaker
  — plus 2.5 Flash / 2.5 Flash Lite / 2.5 Pro TTS. *(3.1 Flash TTS preview is our
  incumbent.)*
- **Hindi (India) is GA.** 70+ languages.
- Streaming: Cloud TTS API supports bidirectional ("multiple request multiple
  response"); Vertex supports unidirectional.
- Control: *"granular control over generated audio using text-based prompts"* —
  style, accent, pace, tone, emotional expression. Documented markup tags include
  `[sigh]`, `[sarcasm]`, `[whispering]`.
- **28 voices, 14 female / 14 male.** No latency figures; no custom-pronunciation
  mechanism documented; nothing on romanised or non-native-script handling.

The tag-leak guidance our sanitiser depends on lives on the sibling pages already
cited by `AFFECT-CONTINUITY.md`:
<https://ai.google.dev/gemini-api/docs/speech-generation> — for non-English
transcripts, use English tags **specifically to avoid the model speaking the tag
aloud**. ElevenLabs documents the same leak and adds that it is worst when the
requested delivery is far from the voice's default:
<https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices> ·
<https://elevenlabs.io/blog/v3-audiotags>

### C3. [V] Open-source Hinglish TTS — an independent replication of the transliterate-first approach

<https://github.com/harrrshall/hinglish-tts> · <https://harrrshall.github.io/hinglish-tts/>

- **Architecture:** IndicF5 (AI4Bharat, **330M params**) + a two-line duration
  patch + *"automatic script normalisation via **IndicXlit**"* — i.e. exactly the
  romanised→Devanagari front-end PhysicsWallah built, using the baseline
  PhysicsWallah dissected.
- **Input handling:** Devanagari passes through; Roman-script Hinglish is
  transliterated via IndicXlit with **override tables for 36 English loanwords
  and 4 Hindi function words**; mixed-script handled mid-sentence.
- **Intelligibility, 30-sentence set:**

| category | score | n |
|---|---|---|
| mixed-script | 4.88 | 9 |
| **pure Roman** | **4.75** | 8 |
| pure Devanagari | 4.62 | 8 |
| English with Indian names | 4.50 | 6 |
| **overall** | **4.70 / 5.0** | 30 |

- **Baselines on the same set:** Kokoro v1.0 (Hindi) **3.90**; Indic Parler-TTS
  **3.40**; **IndicF5 unpatched 2.13**.
- **Method:** *"Character error rate (CER) after Devanagari normalisation,
  three-ASR consensus (AssemblyAI + Deepgram + Groq Whisper)."*
- Zero-shot cloning from a **3–10 s** reference; no fine-tuning.
- **Licence is not usable by us:** eval set and `inference.py` free for research
  only, commercial use requires contacting the author; **IndicF5 weights restrict
  commercial use**; IndicXlit is Apache-2.0.

> Two readings for us. **(1)** It independently confirms the direction — a
> transliteration front-end takes an Indic TTS from 2.13 to 4.70 on romanised
> input, which is a large effect. **(2)** Its scoring method is a textbook
> instance of the trap `voice-ears` measured: CER via ASR consensus rewards clear,
> flat delivery and penalises expressive delivery. It is the right method for
> *their* question (intelligibility) and the wrong one for ours (identity). The
> two facts together are the cleanest illustration in this document of why their
> axis and our axis are different.
>
> It also applies the Unicode lesson correctly — *"after Devanagari
> normalisation"* — which is transfer lesson (2), arrived at independently.

### C4. [V] Veena (Maya Research) — India's most-downloaded voice model

<https://huggingface.co/maya-research/Veena>

| field | value |
|---|---|
| architecture | autoregressive Transformer, **3B params**, Llama-based, 2048-token context, SNAC neural codec, 24 kHz out |
| licence | **Apache-2.0** |
| languages | Hindi, English, **code-mixed** |
| input script | **not specified**; all code examples are Devanagari (`"आज मैंने..."`) |
| voices | 4 — `kavya`, `agastya`, `maitri`, `vinaya`; no descriptions beyond *"unique vocal characteristics"* |
| latency | sub-80 ms on **H100-80GB**, ~120 ms A100-40GB, ~200 ms RTX 4090; RTF 0.05× |
| **streaming** | **not supported** — listed as a future capability |
| **voice cloning** | **not mentioned / not supported** |
| training data | 15,000+ utterances per speaker, **60,000+ total**, proprietary studio recordings, not released |

**[S]** ~50,000 Hugging Face downloads in under a month; founded by Dheemanth
Reddy and Bharath Kumar; launched June 2026.

> **Disqualifying for us on two structural grounds regardless of quality: no
> streaming and no cloning.** It is a reversal condition, not an option.

### C5. [S/U] AI4Bharat

- **IndicF5** — 11 Indian languages, **1,417 hours**, MIT licence per one source
  (the derivative repo above says the weights restrict commercial use —
  **verify before relying on either**). <https://github.com/AI4Bharat/IndicF5> ·
  <https://huggingface.co/ai4bharat/IndicF5>
- **Indic Parler-TTS** — multilingual Indic extension of Parler-TTS Mini, 20
  Indic languages + English. <https://ai4bharat.iitm.ac.in/areas/model/TTS/Indic%20Parler%20TTS/>
- Both are **reference-prompt architectures**: you must supply reference audio
  *and its transcript* alongside the target text. That is a cloning-shaped API by
  construction.
- No source I found states romanised-input support for either; the derivative in
  C3 exists precisely because IndicF5 alone scores 2.13 on that input.

### C6. [S/U] Commercial vendors — 2026 landscape

**Everything in this subsection is vendor marketing or SEO round-up. The
round-ups contradict each other about which model currently leads. Do not put any
of it in a decision without a probe against our own text.**

| vendor / model | romanised Hinglish? | Indian female voice near 266 Hz? | TTFA | streams | reference conditioning | cost | source |
|---|---|---|---|---|---|---|---|
| **Gemini 3.1 Flash TTS** (incumbent) | **shipping on it; unmeasured** | Aoede, ear-approved as her; **measured 212–214 Hz** | free lane 886 ms p50, paid 2476 ms p50 | free lane yes, paid **no** | no | **$0.0148/utt ≈ $0.11/min** | **[T]** + [V] docs |
| **Cartesia Sonic 3.6 / 3.5 / 3** | *"Hinglish code-switching"* in launch demos | unknown | 90 ms std / 40 ms Turbo claimed; **~166 ms median measured incl. network** by a third party (Vapi, June 2026) | yes | instant clone from ~10 s; Pro cloning at 1.5 credits/char + one-time fee | 1 credit/char; free 20k → $299/mo for 8M credits (~10,667 min) | [U] <https://www.marktechpost.com/2026/08/18/cartesia-ships-sonic-3-6-a-streaming-tts-model-that-now-leads-both-artificial-analysis-speech-arenas/> · <https://invideo.io/blog/cartesia-sonic-ai-voice/> |
| **ElevenLabs Flash v2.5** | Hindi in 32-language list; Hinglish unstated | Monika Sogam is the repo's default Hindi female voice | ~75 ms claimed | yes | professional + instant cloning | ~$0.04/min post-2026-03-23 reset | [U] · **[T]** for the voice id |
| **ElevenLabs v3** | as above | as above | **explicitly not for realtime** | — | as above | as above | [U] + [V] docs on tag leaks |
| **Inworld TTS-2 / Realtime TTS-2** | Hindi in a 200+ language list; Hinglish unstated | unknown | ~100 ms TTFB claimed | yes | clone from **5–15 s** | **~$5/M chars ≈ $0.004/min** | [U] <https://inworld.ai/tts> |
| **Rime** (Mist v2 / Arcana / Coda) | not stated | 300+ voices, Indian coverage unstated | sub-100 ms TTFB claimed | yes | **no cloning offered** | — | [U] |
| **PlayHT / PlayAI** | — | — | — | — | — | — | **[U] reported acquired by Meta (July 2025) and being wound down. Verify before spending time on it.** |
| **Azure Neural / `mstts:express-as`** | Devanagari-oriented; `en-IN`/`hi-IN` GA | **rejected by ear at 210 Hz** | 255 ms measured | yes | custom neural voice (heavy onboarding) | $0.0029/utt measured | **[T]** `azure-tts` |
| **OpenAI gpt-4o-mini-tts** | not stated | **no evidenced Hindi voice**; 13 voices | ~0.5 s (tts-1); variable | yes | no | ~$0.015/min ($0.60/M text in, $12/M audio out) | [U] |
| **OpenAI gpt-realtime-2.1 / mini** | — | — | first chunks 500–1500 ms | yes | no | ~$0.05/min / ~$0.016/min | [U] |
| **Hume Octave 2** | unknown | unknown | unknown | yes | yes | — | **[T]** via `AFFECT-CONTINUITY.md` §4.3, refs E7 |

**Arena rankings, all [U] and mutually inconsistent.** One round-up puts
Speechify Simba 3.2 first on the Artificial Analysis Speech Arena above every
ElevenLabs/Cartesia/Google model; another names a top tier of "Gemini 3.1 Flash
TTS, Inworld Realtime TTS-2, Cartesia Sonic 3.5, ElevenLabs v3"; a third has
Inworld Realtime TTS 1.5 Max at a 73.3% win rate over 1,851 appearances with
ElevenLabs v3 third over 3,753. The MarkTechPost piece (2026-08-18) claims
Cartesia Sonic 3.6 now leads **both** arenas. **Every one of these is a
secondary source and I could not fetch the live board.** The only usable
statement: *our incumbent appears in a credible top tier*, and the board changes
weekly.
<https://www.marktechpost.com/2026/05/30/best-text-to-speech-tts-models-in-2026-a-benchmark-based-comparison/> ·
<https://inworld.ai/resources/best-voice-ai-tts-apis-for-real-time-voice-agents-2026-benchmarks> ·
<https://www.coval.ai/blog/best-text-to-speech-providers-in-2026-how-to-choose-(and-why-vendor-benchmarks-lie)/>

**Open weights, [U] round-up level:** Kokoro-82M (Apache-2.0, ~2–3 GB VRAM,
CPU-capable), Chatterbox / Chatterbox-Turbo (MIT; a **vendor-run** blind test
claims 65.3% preference vs ElevenLabs 24.5% — that is Resemble AI testing its own
model), Orpheus (Canopy Labs), Dia (Nari Labs), Fish Speech, Higgs Audio V2,
Sesame CSM. A commonly repeated claim is that best-open (~4.7 MOS) is now within
0.1–0.3 MOS of best-commercial (~4.8) — **unverified and MOS across studies is
not comparable anyway.** None of these has an SLA, and none has an evidenced
Indian-female-at-266-Hz story.

### C7. [S/U] Code-mixed ASR

- *"ASR models experience a relative increase in WER of **30–50%** when exposed
  to code-switched speech compared to monolingual input."* — SEO round-up,
  no primary citation found.
- *"Voice of India"* benchmark, claimed February 2026: Whisper-large-v3, Google
  Chirp, Azure Speech and several India-trained models on Hindi-English
  code-switched speech **on real Indian mobile phones** — global models
  **20–30% WER**, India-trained **7–12% WER**.
  <https://www.caller.digital/blog/voice-ai-india-vs-global-platforms>
  **Published by a party selling India-trained voice AI. Unverified. Direction
  only.**
- Other pointers, unverified: Trelis `whisper-hinglish-preview`
  (<https://huggingface.co/Trelis/whisper-hinglish-preview>); HiACC, a Hinglish
  adult & children code-switched corpus
  (<https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12329218/>); Interspeech 2025,
  *Adapting Whisper for low-resource Hindi-English Code-Mix speech*
  (<https://www.isca-archive.org/interspeech_2025/biswas25_interspeech.pdf>).
  **HiACC and the Interspeech paper are the two I would read first if B4 goes
  ahead** — they are the only primary, peer-reviewed items in this list.

### C8. Voice-cloning law and consent

**India — the strictest jurisdiction, and the one our users are in.**
- *Anil Kapoor v. Simply Life India* (Delhi HC, 2023) and *Arijit Singh v.
  Codible Ventures LLP* (Bombay HC, 2024): voice, name, image and signature style
  are protected aspects of personality. The *Arijit Singh* three-part test:
  **celebrity status, identifiable feature, commercial benefit.**
- Courts 2024–2026 have gone further than any parallel jurisdiction: relief
  extended into virtual environments, takedown duties on global platforms,
  ministries impleaded, and **AI voice-conversion services held liable for clones
  produced with their software.**
- **2026 amendment to the IT Rules, 2021** introduces a **Synthetically
  Generated Information (SGI)** framework: labelling plus cryptographic
  identifiers on AI-generated content.
- <https://www.worldtrademarkreview.com/article/bollywood-singer-prevails-in-first-ai-voice-cloning-infringement-decision-in-india> ·
  <https://www.scconline.com/blog/post/2026/08/05/ai-voice-cloning-consent-personality-rights-analysis/> ·
  <https://ssrana.in/articles/personality-rights-infringement-of-arijit-singh-shocks-the-conscience-of-court/> ·
  <https://candourlegal.com/ai-deepfakes-personality-rights-india-courts-2026/>
  **[S] — law-firm commentary and trade press; I did not read the judgments.**

**EU — AI Act Article 50.** Deployers creating deepfakes must disclose, *"to a
natural person upon first exposure at the latest, in a clear and distinguishable
manner."* **Transparency obligations enforceable from 2 August 2026.**
<https://artificialintelligenceact.eu/article/50/> ·
<https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act> **[S]**

**US, for completeness [S]:** Tennessee ELVIS Act (voice as a protected property
right) and the federal NO FAKES Act (status unconfirmed as of this writing).

> **The practical reading for the owner.** A prebuilt vendor voice carries no
> personality-rights exposure and is what we ship today. A hired actor under a
> work-for-hire contract that explicitly covers AI cloning and perpetuity is the
> only route to owning her voice with a paper trail. Cloning anyone who has not
> signed is the exact conduct the Indian judgments punish — and those judgments
> reached the **tooling provider**, not only the publisher.

---

## D. Method notes, negative results, and things I could not do

**Negative results worth recording so nobody repeats them:**

- Medium article pages 403 to `WebFetch`; `freedium.cfd` 502s through the agent
  proxy. **Medium `/feed` endpoints return 200 with full `content:encoded`** —
  that is the workaround, limited to the last ten posts.
- `www.sarvam.ai/blogs/*` 403s to fetch; `docs.sarvam.ai` does **not**. When a
  vendor's blog is closed, its docs are usually open — and, as C1 shows, the docs
  are often the more honest source.
- The specific article title *"Teaching a speech engine to read mix-code"*
  returns nothing on any search engine, in the PW publication feed, or on the
  author's Medium/Substack. It is genuinely not indexed.

**What I did not do, and why:**

- **I ran no live probes and spent none of the free key pool.** `free-tts-daily`
  measured that pool exhausting after a few dozen calls and it is shared with
  production. Every test I propose (D6, TEST L1, the STT baseline) specifies a
  **billed** key for this reason.
- **I did not listen to anything.** Every judgement in `SPEECH-STACK.md` about
  how a voice *sounds* is either quoted from the repo or explicitly deferred to
  the ear protocol. That is the point of §8: on this product the ear is the
  instrument of record, and an agent without one should say so rather than
  substitute a proxy metric — which is precisely the mistake `azure-tts` exists
  to prevent.
- **I did not verify the PhysicsWallah numbers.** They are [R] throughout, except
  the LID model card, which I did fetch and which corroborates stage 1 exactly.

**Arithmetic I performed myself (flagged so it is not mistaken for a measurement):**

- Transliteration latency for our lane: 20.5 words/turn (`realtime-azure`
  incumbent reference) × 2.524 ms/word at batch 32 (theirs) ≈ **52 ms**; ×34.25
  ms/word at batch 1 ≈ **700 ms**. Realistic end-to-end with LID, reranker and a
  network hop: **~75–160 ms**.
- Incumbent cost per minute: $0.0148/utterance ÷ (20.5 words ÷ 150 wpm ≈ 8.2 s)
  ≈ **$0.108/min**. Sensitive to the words-per-minute assumption; the durations
  are already logged by `scripts/prosody-baseline.mjs` and should replace it.
- Sarvam: ₹30/10k chars at ₹88/USD ≈ $34/M chars; at ~825 chars/min of speech
  ≈ **$0.028/min**.
- Inworld at $5/M chars ≈ **$0.004/min** on the same chars/min assumption.
