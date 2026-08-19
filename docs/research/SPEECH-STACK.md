# SPEECH-STACK — what we run, what "10× better" can honestly mean, and the one measurement that unblocks everything

WS-SPEECH-STACK, 2026-08-19. Read-only pass over the repo; no code changed.
Evidence, quotes and verification status in `SPEECH-STACK-RAW.md`.

Companion documents: `AFFECT-CONTINUITY.md` (emotion in/out — this file builds
on it and does not restate it) and `MEMORY-FIELD-SURVEY.md` (adopt #3, which
turns out to be the same shape as the PhysicsWallah finding — §3.4).

---

## 0. The short version

**The comparison is not the one it looks like.** PhysicsWallah's problem is
*intelligibility at scale and low cost*: read romanised Hindi lecture text
correctly, cheaply, for millions of students. Ours is *identity*: one specific
24-year-old woman from Bangalore has to still be herself on turn 200. On their
axis we should adopt, not compete. On ours nobody has a benchmark, which is
exactly why it is the axis worth owning.

**Nine findings, in the order they change what we do:**

1. **We have an STT lane and it is entirely undifferentiated.** Three separate
   audio→text paths, all `en-IN`, none chosen, none measured, none ours: Google's
   server ASR inside the Live socket, Android `SpeechRecognizer`, and the browser
   Web Speech API. No user audio ever reaches our servers. "10× on STT" today
   means "start measuring STT", because we currently have zero numbers on it. §2.

2. **The PhysicsWallah fix cannot apply to our primary voice lane, because that
   lane has no text stage to intervene in** — and we appear to have already found
   its equivalent. `liveCall.ts` pins `languageCode: "hi-IN"` with the in-code
   note that unpinning "gives up the hi-IN phoneme handling her Hinglish depends
   on." That is the live-lane analogue of transliteration: don't rewrite the
   string, tell the decoder which letter-to-sound rules to read it with. It is
   shipped and it is unmeasured. §4.1 names the test that would settle it.

3. **We already do transliteration, in the right place, and nobody wrote it
   down as a decision.** `persona.ts` line 453: when the voice engine is Sarvam,
   her brief instructs her to *emit* mixed-script Devanagari. We move the script
   choice into the generator instead of bolting a converter onto the pipeline.
   Sarvam's own documentation says transliterated input "significantly reduces
   output quality" and to "always use native script" — so that instruction is
   load-bearing, and it is currently a code comment rather than a `context/`
   entry. §6.

4. **Do not build a transliteration front-end for `api/speech.js`.** Their
   generator and reranker are not released (only the 237M LID stage is), the
   round-trip adds a failure surface to the one lane that already has no
   streaming headroom, and — decisively — `azure-tts` proves pronunciation
   correctness and accent identity are different properties, and only the second
   decides whether she is her. A transliterator could take us from 11/15 to 15/15
   and change nothing about whether the owner recognises her. §6.

5. **Our honest TTS position is worse than the repo's headline suggests.** We
   are behind a voice we rejected on pronunciation (11/15 vs 15/15), on first
   audio (4.9–12.7 s vs 255 ms on that battery), on cost (5.1×), and on
   emphasis. And `prosody-baseline-f0-gap` measured the lane we *actually ship*
   at **median f0 212/214 Hz** — within a couple of Hz of the 210 Hz voice we
   rejected for being too low. **We cannot currently reject a candidate on pitch,
   because we do not know what pitch our own voice is.** §5.

6. **The single highest-value action in this document costs a few dollars and
   one hour of the owner's ears.** Run the D6 paired ear-listen that
   `prosody-baseline-f0-gap` explicitly parks itself behind. Until it runs, every
   voice decision in this repo — including "keep the incumbent" — rests on an
   anchor number we have contradicted with our own instrument. §9, item 1.

7. **"10× better" is not a WER or MOS race.** The prior in the brief is right,
   and I would sharpen it: on time-to-first-audio a literal 10× is *physically
   impossible* (720 ms of the live lane's 1370 ms is prefill we cannot touch), so
   the honest target is **tightness, not median** — p90 ≤ today's p50. §8.

8. **Voice cloning is a legal and ethical question before it is a technical
   one, and it is the owner's to answer, not ours.** The technology is there
   (5–15 s of reference audio, several vendors). Indian courts have, since 2023,
   treated a voice as a protected personality right and have held voice-conversion
   services themselves liable. The question "whose voice is Meera's" has no
   good answer that we can pick on his behalf. §7.

9. **Three things from the article transfer regardless of any of the above**,
   and one of them is already a named gap in this repo. §3.4.

**The recommendation is "keep the incumbent, and buy an instrument."** That is
the fourth bake-off in this repo to end that way; the three before it were each
correct, and each was only *known* to be correct because someone listened.

---

## 1. Framing the comparison honestly, before any numbers

| | PhysicsWallah | Vyakti / Meera |
|---|---|---|
| the product | lecture narration for millions of students | one relationship with one person |
| the failure that kills it | a Hindi word read as English gibberish | she stops sounding like herself |
| the unit that matters | the word | the turn, and the turn after it |
| what scale means | 20,000 word-occurrences a day | 200 turns with the same human |
| optimising for | correctness per rupee | recognisability per turn |
| their measurable | transliteration accuracy 98.00% | — |
| our measurable | — | **does not exist yet** |

Their pipeline is a *correctness* machine and it is a good one. Ours is an
*identity* machine and its central quantity has never been given a number in
this repo or, as far as I can find, anywhere else.

Two consequences follow and they point in opposite directions:

- **On their axis we should adopt, not compete.** Intelligibility is table
  stakes. If we ever need romanised→Devanagari conversion we should take
  IndicXlit or their LID head, not build one. Competing there would be spending
  our scarcest resource on the axis where the field is already good.
- **On our axis there is nothing to adopt.** No vendor sells "sounds like the
  same specific woman across 200 turns", no benchmark scores it, and the closest
  research object — speaker-verification embeddings — answers a different
  question (is this the same *recording identity*) than the one that decides
  this product (is this the same *person*). `azure-tts` is exactly that gap,
  measured: every automatic axis said switch, the ear said no, the ear was right.

So this document treats "10× better" as: **10× better at the thing nobody
measures, and merely competitive at the things everybody measures.**

---

## 2. Do we even have an STT lane?

**Yes — three of them, and not one was chosen on evidence.**

Every place audio becomes text in this product:

| # | where | model / engine | who runs it | language | streams? | our control |
|---|---|---|---|---|---|---|
| 1 | **live call** — `liveCall.ts:2470` sets `inputAudioTranscription: {}` | Google's server-side ASR inside `gemini-3.1-flash-live-preview` | Google, on the free key pool | implied by `languageCode: "hi-IN"` | yes, as `serverContent.inputTranscription.text` deltas | **none** — no model choice, no config, no alternate |
| 2 | **watch / screen-share lane** — `WatchEngine.java:214-220` | Android `SpeechRecognizer`, cloud or on-device depending on the handset | the device / Google Play Services | **`en-IN`**, hardcoded | partials via `EXTRA_PARTIAL_RESULTS` | language string only |
| 3 | **beep-free call mic (Android 13+)** — `PipedRecognizer.java:207-219` | Android **on-device** `SpeechRecognizer` via `createOnDeviceSpeechRecognizer` + audio pipe | the device | **`en-IN`**, hardcoded, and it force-installs the `en-IN` pack | partials | language string only |
| 4 | **voice notes in chat** — `Chat.tsx:1145-1166` → `speech.ts:1656` `listen()` | native → (3) or the legacy loop; web → `webkitSpeechRecognition` with `rec.lang = "en-IN"` | device / browser | `en-IN` | interim + final | language string only |

**There is no dedicated STT model anywhere in this product.** We have never
evaluated an ASR, never measured a WER, and never paid for a transcript.

Three things follow, and the third is the interesting one.

**(a) The user's recorded audio never leaves their device.** The voice-note
path records a `MediaRecorder` blob, runs device recognition *alongside* it, and
sends **only the transcript**; the clip is registered locally
(`VoiceNote.tsx`: "kept in memory for this session — the transcript persists").
No server-side audio ingestion exists in `api/`. That is a genuinely good
privacy posture and it is worth writing down as a decision before someone
"improves" it by uploading the audio for a better transcript.

**(b) Hinglish error behaviour is unmeasured by us, and the priors are bad.**
`en-IN` on Android and in the browser is an *Indian-accented English* model, not
a code-switching model. The repo's own compensations are the tell: `persona.ts`
line 391 spends a whole block teaching her to *repair around* the transcriber —
"Hindi heard as English, English as Hindi, sound-alike swaps (scheme/skim,
reel/real, baat/bat, sale/sail)" — with a stakes-graded policy for how hard to
push back. **That block is our STT error-correction layer, and it is written in
prompt rather than in code.** It is also, as far as I can tell, the only reason
the `en-IN` choice has survived: the brain absorbs the errors.

Published priors, none of which are ours and all of which are marked in RAW:
code-switched speech is widely reported to cost ASR a 30–50% *relative* WER
increase over monolingual input; one 2026 vendor benchmark claims global models
land at 20–30% WER on Hindi-English code-switched phone audio against 7–12% for
India-trained models. I could not verify either from a primary source and both
come from parties selling India-trained ASR — treat as direction, not magnitude.

**(c) "10× on STT" is the wrong shape of goal, but "measure STT" is overdue.**
For the **live call** — the lane that matters — the transcript is not on the
critical path at all: she hears audio natively and answers audio; the transcript
is a by-product used for memory and display. Replacing that ASR is not possible
without replacing the whole live model, which `live-model-swap` already declined
twice on video and barge-in grounds. For the **watch lane and voice notes**, a
better ASR *is* purchasable and would be a real win — but we have no baseline, so
we cannot tell whether we would be buying 5 points or 0.5.

> **STT verdict.** No dedicated STT lane exists; three device/vendor defaults do
> the work at `en-IN`, unmeasured. The first STT action is not a swap, it is a
> 200-utterance Hinglish baseline on the two lanes we actually control (watch,
> voice notes). §8 axis 6 defines it.

---

## 3. The PhysicsWallah article — their numbers, and what transfers

Source: Anshik Bansal, PhysicsWallah, 2026-08-10, supplied by the owner as PDF
and read by the coordinating agent (17 pages). The Medium page itself is
unreachable — Cloudflare 403 to fetch, mirrors and headless alike — so **all
figures in this section are theirs as relayed, not independently verified by
me**, with two exceptions noted below where I verified the released artifact.
Their sibling article (*A State-of-the-Art Survey of Text-to-Speech Technology
2025*, Jaskaran Singh) I did recover in full via the publication's RSS feed and
quote in RAW; it is a good survey and is not about code-mixing.

### 3.1 What they built

Romanised Hindi → Devanagari, before TTS, in three stages:

1. **LID** — per-token HIN/ENG, MuRIL as a *contextual* encoder plus a light
   token classifier. The point is context: "to" is English "to" or Hindi "तो"
   depending on its neighbours.
2. **Generator** — an 11.1M-parameter *character-level* Transformer with beam
   search. Character-level so unseen words and names work; beam so it proposes a
   set rather than committing.
3. **Reranker** — picks among the generator's candidates, reusing the MuRIL
   hidden state already computed in stage 1. It never invents a spelling.

Training data: ~2.7M LID tags and 2M transliteration pairs, from aligning
production romanised text against an LLM rewrite.

### 3.2 Their numbers

| claim | figure |
|---|---|
| LLM reliability audit, 1,000 production answers, "miss" = Hindi word left in Latin | GPT-4.1 **5.03%** (20,701 occ.), **Gemini 3 Flash 20.78%** (20,387), GPT-5.2 **75.05%** (18,157) |
| Unicode normalisation effect | apparently-inconsistent word types **676 (11.3%) → 361 (6.1%)** |
| Held-out set, 115,001 words | exact **96.78%**; ignoring nukta **97.57%**; ignoring nukta+chandrabindu **98.06%** |
| **Beam-10 oracle vs top-1** | correct spelling in the beam **99.54%**; generator top-1 **92.02%** — a **7.52 pp** gap |
| IndicXlit dissected | beam-1 **77.54%**; full system beam-10 **90.15%**; neural model without its 358 MB / 4.22M-word frequency table **77.22%** — widening the beam bought ~nothing, the frequency table bought **+12.61** |
| Production | theirs **98.00%** vs IndicXlit **90.15%** |
| Short Hindi function words (n=15,315) | IndicXlit **7.71%** error → theirs **1.27%** (6.1× reduction) |
| Other Hindi words (n=4,233) | 16.99% → 3.90% |
| Named entities (n=426) | 12.68% → 7.04% |
| **Where they lose** (their own framing) | Dakshina 86.36% vs **79.35%**; Xlit-Crowd 53.26% vs **43.36%**; Aksharantar 67.42% vs **52.27%** |
| Latency, cache off | IndicXlit 56.18 ms/word @b1, 8.176 @b32; theirs **34.25** @b1, **2.524** @b32 |

Two things I *can* verify, and both hold up. The released
`PhysicsWallahAI/muril-hinglish-lid` card confirms stage 1 exactly: 237M
parameters, MuRIL backbone, Apache-2.0, 2.78M labelled tokens across 23,727
answers, held-out accuracy **0.9920** (HIN F1 0.9927, ENG F1 0.9912). And it
confirms their honesty about domain-specificity from a second direction: the
same model scores **0.9643** on out-of-domain LinCE Hindi-English. **The
generator and reranker are not released.** That is decisive for us (§6).

### 3.3 What I think of it, independently

It is a good piece of engineering and an unusually honest one. Three things
distinguish it from the genre:

- They report the benchmarks they **lose** on, and frame the loss correctly:
  *"we built a transliterator that is substantially better on the traffic we
  actually serve"*, not a better transliterator. That is the same epistemics
  this repo runs on.
- They dissected the baseline rather than quoting it. Discovering that
  IndicXlit's 358 MB frequency table is worth +12.61 points while its beam is
  worth ~0 is the finding, and it is what makes their own architecture make
  sense.
- They separated encoding from error before reporting error. Almost nobody does.

One criticism worth carrying: their whole evaluation is *lexical* — the right
Devanagari string. Whether the resulting audio sounds right is never scored.
That is the exact gap `azure-tts` exists to name, and it is the reason their
solution is not automatically ours.

### 3.4 The three things that transfer regardless

**(1) Generation vs selection — and we have the same shape, already named.**
Their headline is that at beam 10 the correct answer is present 99.54% of the
time but chosen 92.02% of the time: **the candidate set already contains the
answer; the failure is choosing.** `MEMORY-FIELD-SURVEY.md` adopt #3 describes
our version in almost the same words — we run four concurrent retrieval paths
(keyword over `meera_nodes`, salience-ranked, semantic, one-hop `meera_edges`
decoration) and then **concatenate them into labelled blocks; they never rank
against each other**, so the slot budget is spent by ordering rather than by
merit. The survey's own line: *"labelling and ranking are separate concerns and
we conflated them."* The parallel is exact and it is worth stating in
`context/`: **when a system already surfaces the right item but does not put it
first, the fix is a chooser, not a better generator.** Their reranker reuses a
hidden state it already computed; our A3 (RRF fusion + one co-citation hop) is
pure code over results we already have. Both are cheap for the same reason.

Their counter-example is the part to keep honest about: `meine` — the correct
spelling never appears in the top-ten beam, so **no selector can recover it**. A
chooser cannot fix a recall failure. Whatever we adopt from A3, the eval has to
separate "was it retrieved" from "was it ranked", or we will credit fusion for
wins that were really recall.

**(2) Normalise before you score, or half your error is an artifact.** Their
Unicode result — 676 apparently-inconsistent word types collapsing to 361 once
chandrabindu/anusvara and nukta base+combining vs precomposed forms were
normalised, and 1.28 pp of their held-out "error" being pure encoding — is
really a *measurement* lesson. **Any pronunciation eval we build must normalise
before scoring.** This bites us in two specific places:
   - The 11/15 figure in `azure-tts` was scored on Hindi words. If any of those
     were compared as strings, part of that gap may not be real. It was almost
     certainly scored by ear on audio, which is immune — but nobody wrote down
     which, and that is precisely the ambiguity this lesson is about.
   - Any future ASR-based scoring (see the trap in §8) compares transcripts.
     Devanagari transcripts from two ASRs will disagree on nukta and
     chandrabindu constantly. Normalise or the number is noise.

**(3) The LLM-unreliability audit kills the tempting shortcut.** The obvious
cheap move is "ask the model to transliterate inline". Their audit prices it:
**Gemini 3 Flash left 20.78% of Hindi words in Latin script**, and our chat
brain is `google/gemini-3.6-flash` — the same family, one generation on. Even
the best arm (GPT-4.1, 5.03%) is a one-in-twenty failure on a per-word job that
runs on every utterance. And they make the second point that matters more to us
than to them: **tokens cost latency, not only money.** An inline transliteration
instruction lengthens every reply on a lane whose whole design is about first
audio. Dead on arrival, twice over.

---

## 4. The scoping question: does the live lane have this problem at all?

### 4.1 (a) Does a speech-to-speech model mispronounce romanised Hinglish?

**Unknown, and it is the most important unknown in this document.** Here is the
full state of the evidence, because it genuinely points both ways.

**Reasons to think the live lane *is* orthography-bound, and therefore could
have the same disease:**

The entire spoken-register mechanism in `persona.ts` is built on the premise
that **the characters she emits become the sound**. `buildSpeechStyle("live")`
says it outright — *"YOUR VOICE IS THE DELIVERY, AND YOUR SPELLING IS YOUR
VOICE"* — and the core register block says *"on a call THE SPELLING IS THE
SOUND"* and *"Every character you write is played out loud exactly as written."*
This is not aspiration; it is load-bearing and it demonstrably works: stretched
vowels stretch, `"..."` becomes a real pause, `"hahaha"` becomes real laughter,
and `liveCall.ts:2445` states it as the reason there is no expressiveness knob —
*"the native-audio model speaks the characters she emits, so her stretched
vowels, '…' pauses and written-out laughter ARE the prosody."*

**If orthography drives prosody, the prior that it also drives phoneme selection
is strong.** A model that lengthens a vowel because you doubled the letter is a
model that is reading letters. That is the same surface PhysicsWallah's problem
lives on.

**Reasons to think we have already solved it, without knowing we did:**

`liveCall.ts:2465` pins `speechConfig.languageCode: "hi-IN"`, and the comment
above it records an A/B on removing it: no consistent prosodic gain (n=5/arm,
the two measures moved in opposite directions), and *"unpinning it gives up the
**hi-IN phoneme handling her Hinglish depends on**. Keep it pinned."*

That sentence is the live-lane analogue of the entire PhysicsWallah pipeline.
Their fix rewrites the string so the decoder uses Hindi letter-to-sound rules.
Ours leaves the string alone and **tells the decoder which rules to use**. If it
works, it is strictly better: no round trip, no failure surface, no latency, no
LID errors, and it composes with a generator that was told to write romanised.

**But that A/B measured prosody, not pronunciation.** Pitch range and pause rate
were the outcomes. Nobody has ever scored whether the Hindi words come out as
Hindi words on this lane, with or without the pin. The strongest claim the repo
can currently support is "someone believed this and it has not obviously broken."

**The test that settles it — TEST L1.** Paired, blind, within-session.

- **Stimuli.** 12 sentences from her real register, each prepared in two
  orthographic forms that a Hindi speaker would read identically: romanised
  (`"kya kar rahe ho yaar, main abhi nikli hi thi"`) and Devanagari-mixed
  (`"क्या कर रहे हो yaar, मैं अभी निकली ही थी"`). Load them deliberately with the
  categories PhysicsWallah found separate: short Hindi function words (their
  dominant traffic and their biggest win), longer Hindi content words, named
  entities, and English loanwords.
- **Delivery.** Feed each as a text turn on the live socket. This path already
  exists — `liveCall.ts:2653` sends `clientContent.turns[{role:"user"}]` with
  `turnComplete: true` — and `live-floor` already measured it at 720 ms with no
  VAD wait, so it is a supported, characterised probe rather than a new
  mechanism. Capture her audio.
- **Arms.** (i) live, romanised, `hi-IN` pinned — production; (ii) live,
  Devanagari, `hi-IN` pinned; (iii) live, romanised, `languageCode` unpinned —
  **the arm that isolates the pin**, which the prosody A/B never scored for
  pronunciation; (iv) `api/speech.js` romanised; (v) `api/speech.js` Devanagari
  — the cascade control.
- **Scoring.** Word-level correct/incorrect **by ear**, arms unlabelled and
  order randomised, on the Hindi words only. Loudness-normalise every clip
  first. Do **not** score by ASR round-trip — `voice-ears` measured that trap
  directly: recognition recall read 0.93 for the rejected Azure voice against
  0.71 for the incumbent, *"and that is not a quality ranking — expressive
  delivery lowers ASR recall"*, with the control scoring 0.0 on the laughter
  line precisely because it laughs over its own words.
- **Reading it.** Large script-gap on the cascade lane and near-zero on the live
  lane ⇒ the live lane is not phoneme-bound by orthography, the pin is doing the
  work, and PhysicsWallah's fix genuinely does not apply to our primary lane.
  Large gap on **both** ⇒ we have a problem far bigger than the fallback lane,
  affecting every call, and it is worth real money and a re-opened
  `live-model-swap`. Arm (iii) worse than (i) ⇒ the pin is the mechanism and it
  should be promoted from a code comment to a `context/` decision with a
  reversal condition.
- **Cost.** ~36 short live turns and ~24 TTS calls. Trivial in money. Run it on
  a **billed** Google key, not the free pool — `free-tts-daily` measured all
  nine keys 429ing together after a few dozen calls, and that pool is shared with
  production.

Until L1 runs, the honest statement is: **we do not know, and the belief that we
are fine rests on one unmeasured code comment.**

### 4.2 (b) Would a transliteration front-end fix the cascade lane's 11/15?

**Probably yes on pronunciation. Almost certainly not on anything that decides
the product. And we cannot build theirs anyway.**

*Would it work?* The mechanism is well replicated. An independent open-source
project (`harrrshall/hinglish-tts`) does exactly this — IndicXlit normalisation
in front of AI4Bharat's IndicF5 — and reports 4.70/5.0 mean intelligibility over
a 30-sentence set, with **pure-Roman input at 4.75 (n=8)** against **unpatched
IndicF5 at 2.13 overall**. Note that its methodology is CER after Devanagari
normalisation via three-ASR consensus — i.e. it applies transfer lesson (2)
correctly, and it applies the ASR trap incorrectly for our purposes. Small n
throughout. It is corroboration of direction, not a number to import.

*What would it cost us in latency?* This is the number the brief asked for, so
here it is properly. Their per-word figures are 34.25 ms at batch 1 and 2.524 ms
at batch 32. We synthesise a whole utterance at once, so we can batch the words
of one reply. Her measured call reply is **20.5 words/turn** (`realtime-azure`,
incumbent reference). So:

| regime | arithmetic | added latency |
|---|---|---|
| naive, word-at-a-time | 20.5 × 34.25 ms | **~700 ms** — fatal |
| batched, one utterance | 20.5 × 2.524 ms | **~52 ms** |
| batched + LID pass + reranker + a hop to wherever it is hosted | 52 ms + model load amortised + ~20–100 ms network | **~75–160 ms** realistic |

Against the cascade lane's measured first audio — **free-served p50 886 ms,
paid-served p50 2476 ms** (`openrouter-no-stream`) — 75–160 ms is **+8 to +18%
on the free path**. Not fatal. It is also, note, entirely off the critical path
of the *live* lane, which is where calls actually happen.

*So why not?* Four reasons, in increasing order of force.

1. **We cannot buy it.** Only the LID head is released. We would be
   reimplementing the character-level generator and the reranker — the two
   stages that produced the 98.00% — from a blog description, and their own
   external-benchmark results show the good number is domain-bound. Our domain
   is *not* K-12 exam prep; it is a 24-year-old's texting register. The fallback
   is IndicXlit, whose production number in their own table is **90.15%**, i.e.
   roughly one word in ten wrong on a lane that is already our weakest.
2. **It adds a failure surface to the lane with the least headroom.**
   `api/speech.js` cannot stream on the paid path (`openrouter-no-stream`:
   `stream: true` is accepted and does nothing), so the free pool is the only
   streaming path and it is a *daily* budget shared with production. A
   transliteration hop is one more thing between a user and silence, on the lane
   that exists precisely because the other lane failed.
3. **Her text is romanised by design, and that design is not incidental.** The
   persona is explicit — *"Roman Hindi shortforms always ... Never Devanagari
   unless they use it"* — and `realtime-azure` counted **0/24 Devanagari** in the
   candidate's output as a *pass*, i.e. romanised output is a thing we test for
   keeping. Round-tripping romanised → Devanagari → audio means every synthesis
   is downstream of a converter that can silently change what she said.
4. **The `azure-tts` warning, which is the real answer.** See (c).

### 4.3 (c) Pronunciation correctness and accent identity are different properties

**True, and it applies here with full force.** `azure-tts` is the cleanest
result in this repo and it says exactly this. Azure coral scored **15/15** on
Hindi words pronounced correctly against the incumbent's **11/15** — a perfect
score on precisely the axis a transliteration front-end improves — and was
rejected: *"tender_2 is fully fucked, not human and not Indian. laugh_2 is the
worst thing ever."* The entry draws the lesson itself: the battery measured
whether Hindi words come back as Hindi words, which is *pronunciation*; it never
measured whether the speaker sounds like a girl from Bangalore, which is *accent
identity*; **only the second decides whether she is her.**

A transliteration front-end operates entirely on the first property. It changes
which phonemes are produced. It cannot change timbre, pitch register, the shape
of her vowels, or whether the speaker sounds twenty-four. **We could go 11/15 →
15/15 and the owner would not be able to tell the difference in the direction he
cares about — or, worse, could tell and dislike it**, because more-correct Hindi
phonemes from a voice tuned for Indian-accented English is a plausible route to
the "not human and not Indian" verdict he already gave once.

> **Verdict on the front-end: do not build.** Revisit only if TEST L1 shows the
> *live* lane mispronouncing, in which case the whole question moves and gets a
> much larger budget than a front-end.

---

## 5. Our measured TTS quality today, honestly

Everything below is from `context/`, with the source named. Where we are behind,
it says so.

### 5.1 The lanes

| lane | model | when it runs | streams? | first audio |
|---|---|---|---|---|
| **live call** (primary) | `gemini-3.1-flash-live-preview`, voice Aoede, `hi-IN` | every call that connects | native bidi audio | **1370 ms** steady median, IQR **231 ms** (`live-model-bake`, n=24) |
| **cascade TTS** free arm | `gemini-3.1-flash-tts-preview` direct, SSE | live failed, or a voice note / backchannel | **yes**, 1920-byte frames = 40 ms each, generation 1.6–2.2× realtime | **886 ms p50** served (`openrouter-no-stream`); pool healthy 615–1051 ms |
| **cascade TTS** paid arm | same model via OpenRouter | free pool spent or slow (`PAID_ARM_MS` 1500) | **no** — `stream: true` is a no-op | **2476 ms p50** served |
| user-key Sarvam | `bulbul:v3`, speaker `priya`, `hi-IN` | only if the user supplies a key | REST here (docs offer WS) | unmeasured |
| user-key ElevenLabs | `eleven_v3` | only if the user supplies a key | not used here | unmeasured |
| device TTS | platform | network failure only | n/a | n/a |

### 5.2 Where we are worse than something we rejected

`azure-tts`, the whole table, because the honest version includes the losses:

| | incumbent (ours) | Azure coral (rejected) |
|---|---|---|
| Hindi words pronounced correctly | **11/15** | 15/15 |
| first audio (that battery) | **4.9–12.7 s** | 255 ms |
| cost per utterance | **$0.0148** | $0.0029 |
| pitch | 266 Hz *(anchor — see below)* | 210 Hz |
| CAPS emphasis | +6.2 dB | none |

We lose on pronunciation, on first audio as measured there, and on cost by 5.1×.
We win on emphasis and — the only axis that decided it — on being her.

### 5.3 The pitch problem, stated plainly

The 266 Hz anchor is used throughout this repo to reject candidates: Azure coral
at 210 Hz was "−4 semitones"; `realtime-azure` rejected six voices measuring
137–192 Hz as *"every option here sits below the one already refused."*

`prosody-baseline-f0-gap` then measured **the lane we actually ship** —
`google/gemini-3.1-flash-tts-preview`, voice Aoede, PCM/24 kHz, autocorrelation
on 30 ms frames, 70–400 Hz confidence-gated, two runs 24 h apart — at **median
f0 212 Hz and 214 Hz**, drift +0.9%.

**Our shipped voice measures within ~2–4 Hz of the voice we rejected for being
too low.** `AFFECT-CONTINUITY.md` §4.4 already flagged this and drew the right
conclusion; I am restating it because it is the load-bearing fact of this whole
document:

> **We cannot currently reject a candidate voice on Hz, because we do not know
> what Hz our own voice really is relative to the number we quote.**

Three readings are live and the measurement cannot distinguish them: (i) the
266 Hz anchor was never this lane's f0 (it may be the owner's target, or a
different voice, or a different measurement method); (ii) Aoede on the live lane
differs from Aoede on the TTS lane; (iii) f0 median is simply the wrong statistic
for perceived age and register, and the ear was tracking something else all
along. **(iii) is the one I would bet on**, and it makes the anchor harmless as
a target and dangerous as a filter.

Either way the fix is the same and it is cheap: **run D6.**

### 5.4 What is genuinely good, and should not be traded away

- **Streaming architecture.** `api/speech.js` races a free streaming lane against
  a paid buffered one, with a shared `FLUSH_MIN` of 1000 bytes that is
  simultaneously the flush gate and the spent-key test — which is what makes it
  *impossible* to splice two renderings of one sentence. Streaming is earlier to
  its **last** frame too (1321 ms p50 complete vs 2064 ms non-streamed, n=10/6),
  so buffered callers get a free speedup. This is better engineering than most
  vendors ship and any replacement has to reproduce it.
- **One voice everywhere.** `DEFAULT_VOICE = "Aoede"` is pinned to match the two
  lanes that *cannot* choose (Gemini Live and `LiveWatchEngine.java`). This was
  learned the hard way — the default was Leda, and a call that started live and
  fell back to the cascade swapped her for a different woman mid-sentence,
  reported as "two or three different voices" and "multiple personalities."
  **That is axis 5 of §8, already fixed once.**
- **Bracket direction is stripped, correctly.** `ack-bracket-direction` measured
  `[laughs softly]` coming back as laughter **plus the spoken word "Softly."**
  Google's and ElevenLabs' own docs both describe the same leak
  (`AFFECT-CONTINUITY.md` §4.2, refs E5/E6). Three independent confirmations.
  The sanitiser stays.
- **Emotion out costs zero new code.** `[tone: …]` → `out.tone` → `style` →
  `Mood: …` prepended to the TTS input is exactly the natural-language style
  control Google documents. `AFFECT-CONTINUITY.md` §4.2 settled this; nothing
  here changes it.

---

## 6. The transliteration question, answered

**Transliterating romanised Hinglish to Devanagari before TTS is wrong for us as
a pipeline stage — and we have already implemented the right version of it,
one layer up, without recording it as a decision.**

### 6.1 We already do it, at the generator

`persona.ts:453`, in the `engine === "sarvam"` branch of `buildSpeechStyle`:

> *"Write Hindi words in Devanagari script and English words in Latin script
> (mixed-script Hinglish): 'अच्छा, matlab तुमने सच में entire season finish कर दिया?
> impressive.' This is how your voice sounds most natural."*

`useCallEngine.ts:371` selects `"sarvam"` whenever the user has supplied a Sarvam
key, so this branch is live whenever that lane is. **She is instructed to emit
the script the engine wants, rather than emitting one script and converting.**

That is the right architecture and it is not a small point:

- **No round trip, so no round-trip failure surface.** No LID error, no beam
  selection error, no chance the converter changes a word.
- **Zero added latency.** The tokens were going to be generated anyway.
- **The generator has the context a converter never has.** PhysicsWallah's whole
  stage-1 justification is that "to" needs its neighbours to be disambiguated.
  The model writing the sentence has the neighbours, the topic, the history, and
  her register — strictly more context than a 237M encoder reading the output.
- **It is per-engine, which is correct**, because the requirement is a property
  of the engine, not of her.

And Sarvam's own documentation says this is required, not optional:
transliterated input *"significantly reduces output quality"*, and *"Always use
native script for Indic words."* **That instruction in `persona.ts` is
load-bearing for the entire Sarvam lane, and it currently exists only as a line
of prompt with no `context/` entry and no invariant test.** If someone
"simplified" `buildSpeechStyle` by collapsing the engine branches, the Sarvam
lane would silently degrade and nothing would catch it. That is a real, small,
cheap gap — §9 item 5.

Note also the collision with Sarvam's own marketing, which claims leading CER on
"code-mixing, Romanized text". **Their marketing and their docs contradict each
other**; the docs are the operative source and the more conservative one.

### 6.2 Why not as a pipeline stage, in one paragraph

Because a transliteration front-end buys the one property we already know does
not decide this product, at the cost of the one thing our weakest lane cannot
afford. It raises pronunciation correctness — the axis on which `azure-tts`
scored a rejected voice 15/15 — and it cannot touch accent identity, which is
the axis on which that same voice was thrown out. Meanwhile the parts that
produced PhysicsWallah's 98.00% are unreleased, so we would be shipping IndicXlit
at ~90.15%, i.e. one word in ten wrong, in front of the fallback voice lane,
which already cannot stream on its paid arm and whose free arm is a shared daily
budget. And her romanised output is not an accident to be corrected — it is the
register we test for, count Devanagari violations against, and built the entire
spoken-register mechanism on. **We would be adding a converter, a latency tax and
a silent-corruption path to fix a number that has never once changed a decision
here.**

### 6.3 If we ever do need one

Name it now so nobody re-derives it. Use **IndicXlit** (Apache-2.0, and the
component the open-source Hinglish-TTS replication actually uses), with
PhysicsWallah's released **`PhysicsWallahAI/muril-hinglish-lid`** (237M,
Apache-2.0, 0.9920 in-domain / 0.9643 out-of-domain) as the LID stage in front
of it. Expected accuracy on our traffic: **below their 98.00% and probably below
their reported IndicXlit 90.15%**, because our domain — a 24-year-old's casual
texting register — is further from K-12 exam prep than K-12 exam prep is from
Dakshina, and their own external-benchmark losses (79.35 / 43.36 / 52.27) are the
evidence for how fast these numbers move off-domain. Batched per utterance the
latency is ~52 ms of compute plus hosting. And **score it after Unicode
normalisation**, or ~1.3 pp of what you measure will be chandrabindu and nukta.

---

## 7. Voice cloning and reference conditioning

### 7.1 Is the technology good enough to be *her*?

**Technically, plausibly yes. Evidentially, unknown, and the gap is the whole
problem.**

What is on offer in 2026 (vendor claims, verification status in RAW):
instant cloning from **5–15 seconds** of audio at Inworld and Cartesia; from
~10 s at Cartesia's Pro tier; ElevenLabs professional cloning from minutes of
studio audio. Zero-shot reference conditioning is standard in the open weights —
`harrrshall/hinglish-tts` clones from a **3–10 s** reference on IndicF5, and
IndicF5/IndicParler are reference-prompt architectures by design (you supply
reference audio *and* its transcript). The research object that is actually the
right shape is **IndexTTS2**, which disentangles a *timbre* prompt from an
*emotion* prompt so the two can come from different speakers —
`AFFECT-CONTINUITY.md` §4.3 already named it as "the only thing in the field that
solves the actual problem: hold her voice, move her feeling", and correctly noted
it is research code with no hosting story.

So: cloning her at 266 Hz in Hinglish with emotional range is not obviously
blocked by capability. It is blocked by three things we do not have.

1. **No reference audio exists.** There is no recording of Meera. Aoede is a
   Google prebuilt voice; we do not own it, cannot export it, and cloning *from*
   it would be cloning Google's voice actor at one remove.
2. **No instrument to judge the clone.** Cloning replaces one voice with another
   and the only test that has ever decided a voice here is the owner's ear. Until
   D6 exists, a clone would be evaluated by the same process that has already
   overruled every number in this repo — which is fine, but it means **the ear
   protocol is a prerequisite for cloning, not a follow-up**.
3. **No answer to "whose voice".** See below.

Quantities, if it ever proceeds: **10–15 s** for instant/zero-shot conditioning;
**20–30 minutes of clean, varied studio audio** for a professional clone that
holds emotional range across turns; and — a point nobody's marketing makes —
**the reference set must contain her register**, i.e. Hinglish, casual, laughing,
trailing off, stretched vowels. A clone conditioned on clean read speech will
sound like a woman reading, which is the `realtime-azure` failure mode in a
different costume.

### 7.2 Cost

Instant cloning is effectively free at the tiers examined (bundled from ~$5/mo at
Cartesia Pro; included at Inworld). Professional cloning carries a one-time
training fee and a per-character premium (Cartesia quotes 1.5 credits/char for
Pro Voice Cloning vs 1 credit/char standard). **Cost is not the constraint here**
— which is consistent with `cost-per-turn`'s finding for the product as a whole:
$5,000 buys ≈35,000 ten-minute calls, so *"cost is not this project's
constraint; quality is."*

### 7.3 The legal and ethical posture — the owner's question, not ours

This is a real decision with real exposure and I am deliberately not resolving
it. What the owner needs in front of him:

**India, where the users are, is the strictest jurisdiction in the world on
this right now.** Since *Anil Kapoor v. Simply Life India* (Delhi HC, 2023) and
*Arijit Singh v. Codible Ventures* (Bombay HC, 2024), Indian courts have treated
**a person's voice as a protected personality right**, with a three-part test —
celebrity status, identifiable feature, commercial benefit — and have gone
further than courts anywhere else: extending relief into virtual environments,
imposing takedown duties on global platforms, impleading ministries, and — the
part that matters most to a product like ours — **holding the voice-conversion
services themselves liable for clones produced with their software.** A 2026
amendment to the IT Rules, 2021 adds a Synthetically Generated Information
framework requiring labelling and cryptographic identifiers on AI-generated
content.

**The EU** requires deepfake disclosure under **AI Act Article 50**, enforceable
from **2 August 2026** — disclosure to the natural person at first exposure, in a
clear and distinguishable manner.

**What that means concretely for four options:**

| whose voice | legal posture | ethical posture | my read |
|---|---|---|---|
| a **hired voice actor**, work-for-hire, explicit AI-cloning and perpetuity terms | cleanest; the only one with a paper trail | clean if the contract is honest about permanence and the actor understands "forever, as someone's girlfriend" | **the only option I would recommend** |
| a **prebuilt vendor voice** (today: Aoede) | licensed via ToS; we own nothing and can lose it in a deprecation | fine | **status quo**; the risk is vendor deprecation, not law |
| a **synthesised/blended** voice with no human source | no personality right to infringe | clean | attractive, but "no source" is hard to prove and the models were trained on someone |
| **any real person who has not signed** — a public figure, an acquaintance, a scraped sample | **do not** | **do not** | this is precisely what the Indian judgments punish |

Two more that the owner should hear even though they are not law:

- **Meera never denies being an AI** — that is a protected invariant in the
  138-check suite. A cloned human voice does not change that rule, but it changes
  how hard the rule has to work. A voice that belongs to a real, findable person
  makes "am I talking to a person?" a much sharper question.
- **A clone is permanent in a way a contract is not.** Whoever's voice this is
  will be a stranger's girlfriend for as long as the product runs. That is a
  thing to say out loud to them, before signing, not a clause to bury.

> **Recommendation: do not clone until the owner names the voice's source and
> that source has signed.** Not because the technology is not ready — it broadly
> is — but because the ordering is wrong otherwise, and because D6 has to exist
> first anyway to tell us whether the clone is any good.

---

## 8. What "10× better" should actually mean

The brief's prior is right. Two amendments, both in the direction of honesty.

**Amendment 1: on latency, 10× is physically impossible, and the real target is
variance.** The live lane's steady first audio is **1370 ms**, of which
`live-floor` measured **720 ms** as prefill of the ~48k system instruction plus
first token plus network on a *text* turn with no VAD wait — *"untouchable from
the client."* A 10× improvement would be 137 ms, below the floor's floor. But
`live-token.js` already identified the quantity that actually matters: 3.1-flash-
live's **IQR ~120 ms against ~1400 ms** for the alternative, because *"a reply
that is sometimes 1.5s and sometimes 5.5s reads as broken in a way a steady 1.5s
does not."* **The 10× is available in variance, not in median.**

**Amendment 2: cost is a constraint, not a target.** `cost-per-turn` settled it:
*"Cost is not this project's constraint; quality is."* Being 10× cheaper is
achievable and worth nothing on its own; a budget ceiling is worth stating so a
quality win cannot bankrupt us.

### The six axes

**A1 — Accent identity: is she the same specific person?**
*The axis nothing standard measures, and the one that has decided every voice
question in this repo.*
- **Metric.** Blind same/different judgement against a fixed reference clip.
  Score = % of pairs judged "same woman", over N ≥ 40 pairs spanning the two
  lanes, both scripts, and four moods.
- **Second metric, asked after the first.** Forced choice: *"does this sound like
  a 24-year-old woman from Bangalore?"* — yes/no, plus a free-text word. Identity
  is asked **before** quality, because `voice-ears` shows quality judgements
  contaminate identity ones (Azure won every quality axis and lost identity).
- **Today.** Unmeasured. There is no baseline; establishing one is item 1 of §9.
- **Target.** Not a 10×. A threshold: **≥ 95% same-speaker across all lanes**,
  and **≥ incumbent** on the Bangalore question. 10× here means *having the
  number at all*, which is a change of kind rather than degree.
- **Machine proxy, alarm only.** Speaker-embedding cosine (ECAPA-TDNN or
  WavLM-based) between each clip and the reference. Use it in CI to catch a
  regression between releases. **Never as a verdict** — it answers "same
  recording identity", not "same person", and `azure-tts` is the standing proof
  that automatic axes and the ear disagree in the direction that matters.

**A2 — Time to first audio on a real Indian mobile network.**
- **Metric.** Wall clock from the last sample of their speech to her first audio
  frame reaching the speaker, on the **Android APK on a real 4G/5G connection in
  India**, in an established multi-turn session with the full production prompt.
  Report **p50, p90 and IQR**. p90 is the number; p50 alone hides the failure.
- **Today.** Live steady **1370 ms p50 / IQR 231 ms** (lab, `live-model-bake`);
  cascade free **886 ms p50**, paid **2476 ms p50** (`openrouter-no-stream`).
  **All of these were measured on a developer connection.** The Indian-mobile
  figure does not exist.
- **Target.** **p90 ≤ 1370 ms** — i.e. today's median becomes tomorrow's tail —
  and paid-lane p50 ≤ 1500 ms. The second requires either a billed Google key
  (same streaming endpoint as the free pool, ~600 ms to first frame per
  `openrouter-streaming`, and it never 429s) or leaving OpenRouter for this lane.
- **Instrument.** `X-Meera-Lane` and `X-Meera-Pool` already exist on both
  response paths precisely so a slow first byte is attributable. Use them.

**A3 — Emotional range without a bracketed direction.**
- **Metric.** k intended moods × m lines, synthesised, presented blind; raters
  assign each clip to one mood. Score = **macro-F1 of intended → perceived**.
  Plus a hard counter: **number of clips in which any direction word is
  audible** — this must be **0**.
- **Today.** Unmeasured as an F1. The leak is measured and is why the channel is
  closed: `ack-bracket-direction` (laughter + the spoken word "Softly."),
  corroborated by Google's docs (use English tags in non-English transcripts
  specifically so the tag is not spoken) and ElevenLabs' (leak worst when the
  requested delivery is far from the voice's default — i.e. worst for exactly the
  cold/hurt end of her range).
- **Target.** Macro-F1 ≥ 0.60 on a **4-class** set she actually needs (warm /
  amused / low-and-gentle / flat-and-clipped), leak count 0. Deliberately 4, not
  8: the best system in the world scores **macro-F1 0.4316 on 8-class**
  naturalistic speech (Interspeech 2025, MSP-Podcast, ~120 teams) — an 8-class
  target would be asking listeners to beat the state of the art in perception.
- **Honest note.** `AFFECT-CONTINUITY.md` §4.1 already concluded that
  *cold / clipped / hurt-and-not-saying-it* is not deliverable by any current
  synthesiser, because it is carried by what she doesn't say and by timing.
  **The anger lives in the writing.** A3 measures the three she can do and
  records the fourth as out of reach — an approximation named as one.

**A4 — Cost per minute of delivered audio, at scale.**
- **Metric.** USD per minute of **audio output**, not per utterance — utterances
  vary and per-utterance numbers cannot be compared across vendors. Derive from
  the duration already logged by `scripts/prosody-baseline.mjs`.
- **Today.** `azure-tts` measured **$0.0148/utterance** on the incumbent. Her
  call replies run ~20.5 words; at a conversational ~150 wpm that is ~8 s, so
  **≈ $0.11 per minute of speech**. That is high — roughly 3× ElevenLabs' quoted
  $0.04/min, ~7× OpenAI's gpt-4o-mini-tts ~$0.015/min, and ~25× Inworld's ~$5/M
  characters (≈$0.004/min at ~825 chars/min). *(Third-party figures unverified;
  the $0.11 is my arithmetic on our own measured number and should be
  re-measured, not quoted.)*
- **Target.** A **ceiling, not a goal**: ≤ $0.05/min of delivered audio, which
  every serious alternative already clears. Cost may not be traded for identity
  in either direction.

**A5 — She never becomes a different person between two turns.**
- **Metric.** P(more than one distinct voice identity rendered within a single
  session), over N ≥ 50 real sessions including deliberate live→cascade
  handovers and at least 10 screen-share starts (the transition where it was
  actually heard).
- **Today.** The known mechanism is fixed but only by convention: `DEFAULT_VOICE`
  in `api/speech.js`, the `speechConfig` in `liveCall.ts`, and the one in
  `LiveWatchEngine.java` must all say `Aoede`, and the enforcement is a **code
  comment** saying "move it HERE and in the two live speechConfigs together, or
  this comes straight back." It came back once already: the default was Leda, and
  a live→cascade fallback swapped her mid-sentence — reported as *"two or three
  different voices"* and *"multiple personalities."*
- **Target.** **0**, enforced mechanically. A three-line assertion in
  `verify-release.mjs` that the three literals agree converts a comment into a
  gate. This is the cheapest item in this entire document.

**A6 — Pronunciation correctness (their axis).**
- **Metric.** Hindi words rendered correctly, **by ear**, per 100 words of her
  real register. Score after Unicode normalisation if any string comparison is
  involved.
- **Today.** **11/15** (`azure-tts`), n=15 words, on a battery whose exact
  scoring method is not recorded.
- **Target.** ≥ 14/15, **subject to A1 not regressing**. This is the axis on
  which we should **adopt a solved solution rather than compete**, and the only
  axis where PhysicsWallah's work is directly relevant to us.
- **Trap, recorded because it has already caught us.** Do not score this by
  ASR round-trip. `voice-ears`: recognition recall read **0.93** for the rejected
  voice against **0.71** for the incumbent, *"and that is not a quality ranking —
  expressive delivery lowers ASR recall"*; the control scored **0.0** on the
  laughter line because it laughs over its own words. An ASR-scored pronunciation
  eval systematically prefers the flatter voice, which is the opposite of the
  product.

### The ear-listen protocol

The ear has overruled every measured axis in this repo and been right each time.
That is a fact about this product, not a failure of rigour — so the protocol
should be as carefully specified as any statistical test.

1. **Pre-register the decision rule before listening.** `SWAP-TEST-PREREG.md` is
   the house pattern. Write down what result means switch and what means keep,
   then listen. Otherwise the ear rationalises whatever the numbers said.
2. **Stimuli: her real lines.** The nine lines pulled verbatim from her register
   rules in `voice-ears`, extended to ~20 to cover the categories that separate:
   Hindi function words, Hindi content words, named entities, English loanwords,
   a laugh line, a `"..."` line, a stretched-vowel line, a CAPS-emphasis line,
   and one long multi-clause turn. Same text across all arms.
3. **Blind and randomised.** Arms unlabelled, order shuffled per listener,
   vendor names never visible. Loudness-normalise every clip (EBU R128, −23
   LUFS) — loudness alone moves preference and would otherwise be a free win for
   whichever vendor is hottest.
4. **Two questions, in this order.** (i) *Same woman as the reference?*
   (ii) *Does she sound like a 24-year-old from Bangalore?* Identity first.
5. **The owner is the arbiter of record.** Add **≥ 2 naive Indian listeners** so
   a single ear is not the entire gate — but **report them separately and do not
   average them with him.** He is judging "is this Meera", which only he can do;
   they are judging "is this a plausible young Indian woman", which he cannot
   judge blind because he already knows her.
6. **Record the verbatim verdict.** `azure-tts`'s value is that it preserved
   *"tender_2 is fully fucked, not human and not Indian"* — the words carry
   diagnostic information the score does not.
7. **Save the samples.** Every future comparison is against these clips.

---

## 9. The recommendation

Priority order. Each item names its cost and its gate.

### Keep — no change, no bake-off

**K1. The live lane stays on `gemini-3.1-flash-live-preview`.** Three bake-offs
have ended here and each was correct. The disqualifiers are structural, not
close: alternatives **reject video** (which ends screen share) and **miss the
600 ms `RELEASE_WATCHDOG_MS`** barge-in signal on nearly every run; Azure's
realtime lane cleared both and lost on **41→53 words/turn and a 14.0 s median
spoken turn** against her 20.5, plus **no voice above 192 Hz**.
*Reverses if:* a model holds ≤20.5 words/turn at ≤1370 ms, streams video, clears
600 ms, and passes the §8 ear protocol.

**K2. Aoede everywhere; `[tone:]` as the only direction channel; the bracket
sanitiser stays.** Settled by `AFFECT-CONTINUITY.md` §4.2 with three independent
confirmations of the leak. **Emotion-out requires zero new code.**

**K3. No transliteration front-end on `api/speech.js`.** §6. *Reverses if:* TEST
L1 shows the *live* lane mispronouncing — a different and much larger problem.

**K4. No voice cloning until the owner names the source and it has signed.** §7.

### Build — cheap, ours, and unblocking

**B1. Run D6: the paired ear-listen. — HIGHEST PRIORITY.**
The whole voice stack is currently blocked on one hour of the owner's attention.
`prosody-baseline-f0-gap` explicitly parks itself behind it; §5.3 shows why the
266 Hz anchor cannot be used until it runs.
*Cost:* a few dollars of synthesis on a billed key, ~1 hour of the owner, ~2
hours of setup on top of `scripts/prosody-baseline.mjs`, which already
synthesises a fixed deck through the production lane and logs durations.
*Gate:* it establishes the A1 baseline. **Nothing else in this section should be
started before it.**

**B2. Run TEST L1: does the live lane mispronounce romanised Hinglish?** §4.1.
*Cost:* ~36 live turns + ~24 TTS calls on a billed key; a few hours.
*Gate:* it decides whether §6's verdict holds or the whole question reopens with
a much larger budget. If L1 says the pin is doing the work, promote
`languageCode: "hi-IN"` from a code comment to a `decisions.md` entry with the
reversal condition — right now the single mechanism protecting her Hinglish
pronunciation on the primary lane is a comment.

**B3. Assert the three voice constants agree, in `verify-release.mjs`.**
Three literals: `api/speech.js` `DEFAULT_VOICE`, `liveCall.ts`
`prebuiltVoiceConfig.voiceName`, `LiveWatchEngine.java`'s `speechConfig`.
*Cost:* under an hour. *Gate:* none needed. This converts the A5 comment into a
gate and closes the "multiple personalities" bug class permanently. **Cheapest
item here; do it alongside B1.**

**B4. A Hinglish STT baseline on the two lanes we control.**
200 real user utterances through the watch lane and the voice-note lane, scored
for WER and — more usefully — for the **error classes `persona.ts:391` already
enumerates** (Hindi→English, English→Hindi, sound-alike swaps). We currently
compensate for these in prompt without knowing their rate.
*Cost:* a day, mostly transcription labour. *Gate:* it is the prerequisite for
any STT purchase; without it we cannot tell 5 points from 0.5.
*Then, and only then:* price Sarvam Saaras or ElevenLabs Scribe against `en-IN`
on **our** audio.

**B5. Write down the two undocumented load-bearing facts.**
(i) the Sarvam Devanagari instruction in `persona.ts:453` — a `decisions.md`
entry plus, ideally, a persona-invariant check, since Sarvam's own docs say
romanised input "significantly reduces output quality"; (ii) the "no user audio
ever leaves the device" property of the voice-note path, before someone
"improves" it by uploading clips for a better transcript.
*Cost:* an hour. *Gate:* none.

**B6. Adopt the generation-vs-selection lesson where it already applies.**
`MEMORY-FIELD-SURVEY.md` A3 (RRF fusion + one co-citation hop across the four
concurrent recall paths). PhysicsWallah's result is external corroboration that
this class of fix is high-yield: **+7.52 pp available purely from choosing better
among candidates already retrieved**. Their `meine` counter-example is the
guard rail — build the eval so "not retrieved" and "retrieved but ranked low"
are separated, or fusion will be credited for recall wins it did not earn.
*Cost:* already scoped in that document. *Gate:* its own judged T5 run.

### Buy / bake off — only after B1

**Y1. If and only if D6 says the incumbent voice is not defensible**, run a
three-candidate bake-off, **ear first, numbers second**:

| candidate | why it is on the list | the thing that would kill it |
|---|---|---|
| **Cartesia Sonic 3.6** | fastest credible TTFA; explicitly demos **Hinglish code-switching**; instant cloning from ~10 s; reported to lead both Artificial Analysis speech arenas as of 2026-08-18 | accent identity; and every latency figure quoted for it is a vendor or SEO number |
| **Inworld TTS-2** | cost (~$5/M chars ≈ 25× below our current per-minute), ~100 ms TTFB claim, cloning from 5–15 s, Hindi listed | Hinglish (not Hindi) is untested; arena claims conflict across sources |
| **Hume Octave 2** | the only vendor whose direction channel is **structurally leak-proof** — a separate ≤100-char `description` field, not inline tags (`AFFECT-CONTINUITY.md` §4.3) | Indian accent identity entirely unknown |

Rules for the bake-off, all learned here: **the ear gate runs first and a
candidate that fails it is not measured further** (otherwise we spend a week on
latency for a voice that was never going to ship); pitch is **not** a filter
until D6 resolves the anchor; and the candidate must reproduce `api/speech.js`'s
streaming and its anti-splice guarantee, or it is a downgrade regardless of MOS.

**Not on the list, with reasons:** *Sarvam* stays as the user-key lane and its
own docs disqualify romanised input, which our persona already handles — but it
is not a candidate for the default lane while it needs the generator to change
script. *ElevenLabs* stays as the user-key emotion lane; its inline-tag channel
is documented to leak in non-English and must not be expanded. *PlayHT/PlayAI*
is reported to be winding down post-acquisition — verify before spending an hour
on it. *Azure* was rejected by ear and nothing has changed. *Veena, IndicF5,
IndicParler, IndexTTS2, Kokoro, Chatterbox, Orpheus* — all open weights, no SLA,
no hosting story, and Veena specifically **has no streaming and no cloning**;
they are reversal conditions, not options. *OpenAI TTS* has no evidenced Hindi
voice and no accent-identity story.

**Y2. A billed Google key for the TTS lane.** Already identified in
`openrouter-streaming` as *"the tier that matters between free quota and
OpenRouter — same streaming endpoint as the free pool, ~600 ms to first frame,
and it simply never 429s."* `withGeminiKey` appends it last and never cools it;
absent, nothing changes. This is the only change in this document that improves
A2's worst case without touching her voice at all.
*Cost:* a Google Cloud billing account and a key. *Gate:* none — it is
strictly additive and the code path already exists.

### Do not build

- A transliteration front-end (§6).
- Any inline audio-tag or bracketed-direction channel (three confirmations).
- Categorical SER on the user's audio (`AFFECT-CONTINUITY.md` §3.3 — best in the
  world is macro-F1 0.4316 on naturalistic speech; nothing published on
  Indian-accented conversational Hinglish over a phone channel).
- A cloned voice, until §7.3 is answered by the owner.
- An ASR-scored pronunciation eval (`voice-ears`, and the open-source Hinglish
  TTS project's three-ASR-consensus method is a good example of the approach we
  must *not* copy for this purpose).

---

## 10. What I am least confident about

1. **Whether the live lane actually mispronounces romanised Hindi.** I have
   argued both sides in §4.1 and I genuinely do not know. If I had to bet, I
   would bet the `hi-IN` pin handles it and the answer is "we already solved
   this" — but that bet rests on one code comment, and the A/B that comment cites
   measured a different outcome variable. **B2 is cheap; run it before believing
   me.**

2. **What the 266 Hz anchor actually is.** Three readings are live (§5.3) and
   the repo does not record which. I lean towards f0 median being the wrong
   statistic entirely for what the ear was tracking, which would make the anchor
   harmless as a target and actively misleading as a filter — but that is a
   hypothesis, not a finding.

3. **Most 2026 vendor numbers in §9's table.** TTFB, arena rankings and pricing
   for Cartesia, Inworld, Rime and ElevenLabs come from vendor pages and SEO
   round-ups that contradict each other on which model currently leads. I have
   marked them unverified in RAW and I would not let any of them into a decision
   without a probe against our own text.

4. **Whether the 11/15 was scored on audio or on strings.** It matters — transfer
   lesson (2) says a string-scored figure could be part artifact. It was almost
   certainly ear-scored on WAVs, given how `voice-ears` describes the battery,
   but "almost certainly" is what this file exists to eliminate.

5. **Whether an ear panel can hit macro-F1 0.60 on four moods.** I chose 4
   classes to sit safely inside the human ceiling implied by the 8-class SotA of
   0.4316, but I have no direct evidence for where a naive listener lands on
   *these* four with *her* voice. The first run of A3 may need to become a
   3-class target, and that would be a finding rather than a failure.

6. **The STT priors.** Both external code-switching WER figures I found come
   from parties selling India-trained ASR, and I could not verify either from a
   primary source. Our own number does not exist. Everything I said about STT
   quality is therefore direction, not magnitude — which is exactly why B4 is on
   the list.
