# AFFECT-CONTINUITY — raw evidence log

Corpus behind `docs/research/AFFECT-CONTINUITY.md`. WS-AFFECT-RESEARCH,
2026-08-19. Read-only sweep: no code was changed.

Two kinds of entry. **[REPO]** = read out of this tree, cited to file and
line. **[EXT]** = external source, cited to URL, with the corpus it was
measured on named whenever the number is an accuracy figure.

---

## A. Repo facts established by reading (all verified, not recalled)

| # | fact | where |
|---|---|---|
| A1 | The G1–G8 charter. G5 forbids an accumulating sad period; G1 forbids any usage metric reaching persisted interior state; G2 suppresses interior on turns she initiates; G4 forbids any UI; G6 gives the model the judgment and the code only "whether a line is present and which of two framings". | `src/engine/inner.ts:21-56` |
| A2 | A negative carried feeling that references the user **cannot be stored at all** — `REFS_USER` matches he/him/you/tumhara/… and `sign < 0 && REFS_USER.test(text)` is rejected as `neg_refs_user`. So "he hurt me" has **no home in `inner.thread` by construction**. | `src/engine/inner.ts:553`, `:610-619` |
| A3 | `carry()` decays at TAU 9 h, ×0.3 on a detected night's sleep, floor 0.15, and dies permanently on `told`. The thread text persists; only its *reach* decays. | `src/engine/inner.ts:130-164` |
| A4 | `ruptureRepairShift` has **no time-based close**. `rupture_open` goes false only through `theirRepairSignal` twice (open→repairing→repaired). Absent their signal it is true forever. | `src/engine/relstate.ts:337-381` |
| A5 | An open rupture regresses the honorific immediately, and the re-advance bar is ≥3 distinct episodes across ≥7 days. A never-repaired rupture therefore holds her address register down indefinitely. | `src/engine/relstate.ts:180-249`, `:191-199` |
| A6 | `stageForDims` returns at most "warming" while `rupture_open` — "an open rupture never reads as close". | `src/engine/relstate.ts:967-974` |
| A7 | Rupture/repair is derived **nightly only**, by an LLM pass over dated episodes, with hard "clear evidence only" rules and citation validation. There is no in-turn provisional tier for rel-state (unlike episodes and facts, SPEC §0.2.1). | `api/consolidate.js:1042-1110` |
| A8 | `relBundle` is set to `null` whenever `mode === "call"`. T2/T4/T6 are **chat-lane only** by explicit design ("the call lane's memory lookup happens once at pickup … out of scope for this seam"). | `src/engine/brain.ts:746-747` |
| A9 | The live-call system prompt is `core + buildSpeechStyle("live") + tail + inner.thread + recall + herLife + inner.wants`. **No rel-state anywhere in it.** | `src/components/useCallEngine.ts:459-476` |
| A10 | The bundle is nonetheless *available* at the call lane: `recallMemories(deviceId, …)` is what populates `lastBundle`, and `takeRelBundle(device)` is a pure consume-once read. Nobody calls it there. | `src/engine/memory.ts:257-310`; `src/components/useCallEngine.ts:633-635` |
| A11 | The cascade voice lane already has an emotion-out channel: her brain emits `[tone: 3-6 plain words]`, `brain.ts` strips it into `out.tone`, `useCallEngine` passes it as `style`, `api/speech.js` sanitises it (strips `[]{}<>` and quotes, 120 chars) and prepends it to the TTS input as `Mood: …`. | `src/engine/persona.ts:345`; `src/engine/brain.ts:212-213`; `src/components/useCallEngine.ts:852-880`, `:1874-1938`; `api/speech.js:107-118`, `:205`, `:301` |
| A12 | The live lane has **no expressiveness knob and is documented as having none**: "the native-audio model speaks the characters she emits, so her stretched vowels, '…' pauses and written-out laughter ARE the prosody". `enableAffectiveDialog` returns a 1007 close ("Unknown name enableAffectiveDialog at 'setup'"); dropping `languageCode` gave no consistent prosodic gain (n=5/arm) and loses hi-IN phonemes. | `src/voice/liveCall.ts:2437-2470` |
| A13 | Persona already instructs turn-by-turn affect mirroring and mood movement inside a call — "Your VOICE must mirror THEIR emotional state turn by turn", "your mood MOVES during the call … a joke lifts it, bad news drops it instantly", and "the live conversation outranks it every time, and if they are somewhere else emotionally you go there with them". | `src/engine/persona.ts:380-384` (the `base` block) |
| A14 | The thread's own prompt text already contains the subordination clause the repair arc needs: "What's actually happening between you two right now outranks it." And the pickup variant adds "by the time you're saying bye it's been replaced by whatever you two just had." | `src/engine/inner.ts:467-470` |
| A15 | The uplink gate already computes, per 20 ms frame of the user's mic, an RMS and a rolling `noiseFloor`, plus voiced-run bookkeeping and a dB ratio (`ratioDb`, `floorDb`). A relative-loudness feature costs **zero new DSP**. | `src/voice/liveCall.ts:1245`, `:1347`, `:1368`, `:1495`, `:1803-1804` |
| A16 | An f0-by-autocorrelation implementation already exists in-tree, dependency-free, 30 ms frames, 70–400 Hz band, confidence-gated — but it is a Node script run offline against **her** synthesised audio, never in the call path. | `scripts/prosody-baseline.mjs:79-125` |
| A17 | TAIL manifest: T1 `inner.thread` budget 1,500, dropPriority `never`. T2 `rel.snapshot` budget 1,200, dropPriority 10 (droppable). Caps: CORE 40,000 + TAIL 24,000 = SYSTEM_MAX 64,000; operational core cap 64,000, tail 24,000. | `src/engine/compiler.ts:535-549`, `:624-645` |
| A18 | `renderRelSnapshot` already renders `repair: <state> (open)` — with **no cause and no age**. That is the whole of what she can currently be told about a rupture, and only in chat. | `src/engine/relstate.ts:832-851` |
| A19 | There is already a relationship-state **UI**: the closeness card renders honorific and trust band from the same coarse bands the model sees. G4's no-UI rule is about her *interior*; this surface exists and is sanctioned — which makes it the obvious accidental home for a rupture indicator, and the place to say "no" first. | `src/components/MoreSheet.tsx:170-180`; `src/engine/relstate.ts:857-873` |
| A20 | The backchannel clip list is non-lexical only ("Hmm.", "Mmhm.", "Mmm."), chosen by a timer with no knowledge of the turn, and the file itself names the reversal condition: "any lane that can pick the sound AFTER knowing what was said". | `src/voice/liveCall.ts:773-820` |

## B. Repo measurements this design leans on

| id | number | why it matters here |
|---|---|---|
| `voice-ears` | Azure coral won every measured axis (15/15 Hindi words, 255 ms first audio, 5× cheaper) and was rejected by ear: *"not human and not Indian"*. Lesson recorded: **accent authenticity is a separate property from pronunciation and must be a first-class axis.** | Any new TTS vendor for affect goes through an ear test, not a spec sheet. |
| `prosody-baseline-f0-gap` | The lane she actually ships on (Gemini TTS preview / Aoede, paid) measures **median f0 212 Hz (run 1) / 214 Hz (run 2)**, ~50 Hz below the 266 Hz anchor. Logged as a finding, explicitly *not* a verdict, pending a paired ear listen. | The "266 Hz" gate figure is an anchor from a different lane. Rejecting a vendor at 210 Hz while shipping at 212–214 Hz is not a defensible comparison until D6 runs. |
| `live-floor` | 1.4–1.5 s is the floor. A text turn with no VAD wait is 720 ms and that is prefill of the 48 k system instruction + first token + network. `silenceDurationMs` 150/300/500 land within 50 ms. | Anything added to the live setup frame is charged to prefill. A T2-sized block (≤1,200 chars against ~70 KB) is small, but must be measured, not assumed. |
| Audio floor table | Self-duck 91%→14% at −6 dB coupling; her voice uplinked 6,996→1,280 ms; self-interruption breaks at about −3 dB. n=8 seeds/cell against the real `liveCall.ts`. | This is the subsystem CPU contention would damage. It is why SER stays out of the call path. |
| `ack-bracket-direction` | `[laughs softly]` came back as laughter **plus the spoken word "Softly."** | Bracketed direction is not inert. Corroborated externally — see E4, E5. |
| `affect-recitation` | Short structured affect tags (`affect: warm-teasing` shape) rendered mid-tail: **0/42 tagged vs 0/42 control** hard leaks, n=84, rule-of-three upper bound ≤7.1%/turn. | Telegraphic affect-shaped state in the prompt is measured-safe at this n. This is the licence for the stance block's shape — and its ceiling: the D3 leakage row at n≥300 must include the vocabulary before shipping. |
| `recited-prompt` | Example quotes recited 4/5 → 0 after removal (n=84). Polished taste sentences read out verbatim twice, eight turns apart, plus 13/96 register defection; telegraphic rewrite → 1/32 and 0/32. | The stance block must be `label: value (note)`, never a sentence she could say. |
| `prompt-position` | The same rule fired 0/8 buried mid-brief and 8/8 appended last. T10 is capped at exactly two appended-last rules and **no new rule may be appended last**. | The stance block cannot buy its firing rate with position. It has to work from the tail. |
| `never-scheduled` | Production, 2026-08-18: `vy_rel_state` **0 rows**, `vy_rel_event` **0 rows**, `vy_episode` 2, against 2,358 log rows over 41 devices. No scheduled job has ever run. | The entire rupture/repair substrate is currently unfed. Any design on it ships behind the E4 cron fix or it ships on an empty table. |
| `prodgap-audit` | The render half is wired and gated; the write half mostly does not exist. Trust stays at the 0.3 default forever. | Same conclusion, independently traced three days earlier. |
| `realtime-azure` | Declined. Words/turn 41→53 against the incumbent's 20.5; spoken turn median 14.0 s. **"No voice is plausible"** — the six available measure 137–192 Hz. No continuous frame channel: `input_video_buffer.append` rejected, frames only as conversation items. | The bar for a voice swap, and the shape of the evidence needed. |
| `live-model-swap` / `live-model-bake` | Alternatives reject video (ends screen share) and miss the 600 ms `RELEASE_WATCHDOG_MS` barge-in signal on nearly every run. Incumbent 1,370 ms steady, 5/5 barge-in @ 279 ms; 2.5-native-audio-latest 2,449 ms, 4/5 @ 1,323 ms, video rejected. | Decides the affective-dialog question below (E6) without a new bake-off. |
| `free-tts-daily`, `openrouter-no-stream` | Free TTS is a **daily** budget shared with production and all 9 keys 429 together. `stream: true` on the paid lane is a no-op; free-served first audio p50 886 ms vs paid 2,476 ms. | Any per-utterance affect experiment on the TTS lane costs the production budget. Batch it offline. |

## C. External evidence — speech emotion recognition (prosody IN)

**E1. Interspeech 2025 SER-in-Naturalistic-Conditions challenge, final leaderboard**
(MSP-Podcast, 324+ h of spontaneous conversational speech, ≥5 annotators/utterance).
Task 1, categorical, 8 classes, **macro-F1**: NTUA 0.4316, SAIL 0.4281, ABHINAYA
0.4181, Voinosis 0.4101, UNICAMP 0.4094. **Baseline 0.3293.** Task 2, average CCC
over arousal/valence/dominance: SAIL 0.6076, SRPOL 0.6003, SEU_AIPLab 0.5955.
Baseline 0.5797. ~120 teams.
<https://lab-msp.com/MSP-Podcast_Competition/IS2025/> · overview paper
<https://www.isca-archive.org/interspeech_2025/naini25_interspeech.html>

> Read this the way the numbers actually read: **the best system on Earth, on the
> largest natural-speech emotion corpus that exists, gets the category right at
> macro-F1 0.43 across eight classes.** Not on a phone, not in Hinglish, not
> under an audio floor with a 279 ms barge-in budget. Offline, English, unlimited
> compute.

**E2. Dimensional SER is meaningfully better than categorical, and valence is the
weak axis.** audEERING's wav2vec2-large dimensional model (MSP-Podcast v1.7,
pruned 24→12 layers) is the standard public baseline; their own later teacher
model reports **valence CCC = 0.676** as a new SotA on MSP-Podcast.
<https://huggingface.co/audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim> ·
<https://www.audeering.com/publications/distilling-wav2vec2-to-72k-paramters/>

**E3. On-device is not the blocker; accuracy is.** Wav2Small distils that teacher
to **72 K parameters, 120 KB quantised ONNX**, predicting arousal/dominance/valence
— explicitly offered as "a potential solution for A/D/V on hardware with low
resources". emotion2vec is ~19 M params (emotion2vec+ base ~90 M), frame features
at 50 Hz.
<https://www.audeering.com/publications/distilling-wav2vec2-to-72k-paramters/> ·
<https://arxiv.org/abs/2312.15185>

> So the honest framing is *not* "we cannot run SER on a phone". We can run a
> 120 KB one. The question is whether a label that is wrong most of the time is
> worth having, and whether the CPU it costs is worth spending inside the one
> subsystem in this repo that is measured in milliseconds.

**E4. Indian-language SER numbers exist and are almost all acted.** Indian
cross-corpus work reports 58.83% / 61.75% / 69.75% / 45.51% accuracy for Hindi /
Urdu / Telugu / Kannada under multilingual training, and states outright that
multilingual training "needs language adaptation to conquer the linguistic,
regional and intonation variations in Indian corpuses". BhavVani, the notable
Hindi SER dataset, is ~13 h / 8,734 utterances.
<https://www.iieta.org/journals/ria/paper/10.18280/ria.380318>

> **Say the corpus type out loud every time.** These are elicited/acted studio
> corpora. Acted-corpus accuracy systematically overstates natural performance —
> the whole reason MSP-Podcast exists and the whole reason its numbers are lower.
> **There is no published SER result on Indian-accented conversational Hinglish
> over a phone.** Treat every Indian SER number in the literature as an upper
> bound that does not transfer.

## D. External evidence — emotional / controllable TTS (emotion OUT)

**E5. Google's own Gemini TTS docs, on inline audio tags:** square-bracket tags
(`[whispers]`, `[sarcastic]`, `[laughs]`…) control delivery, **and** — verbatim —
"If your transcript is not in English, for best results we recommend that you
still use English audio tags" *to avoid the model speaking tag instructions
aloud*. Separately, the docs describe a natural-language style prompt applied to
the whole passage, and a structured "Audio Profile / Scene / Director's Notes"
form. Streaming is supported from 3.1 with `stream: true`.
<https://ai.google.dev/gemini-api/docs/speech-generation> ·
<https://docs.cloud.google.com/text-to-speech/docs/gemini-tts>

> This is the vendor confirming `ack-bracket-direction` from the other side, and
> it lands on the worst possible case for us: **her text is Hinglish, which is
> exactly the "transcript is not in English" condition under which the vendor
> warns tags get spoken.** Inline bracket tags are ruled out on this lane by the
> vendor's own documentation, independently of our measurement.

**E6. ElevenLabs v3 admits the same failure mode.** "Sometimes v3 will speak a tag
aloud as text instead of interpreting its direction, typically … when the selected
voice doesn't match the requested delivery, such as a naturally soft-spoken voice
being asked to perform several `[shouts]`."
<https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices> ·
<https://elevenlabs.io/blog/v3-audiotags>

> The leak is *conditioned on the direction being far from the voice's default* —
> i.e. it is worst for exactly the emotion the owner asked for (cold, angry,
> withheld, from a warm voice). Two independent vendors, one repo measurement.
> **Bracket-shaped direction is a dead channel for this feature, everywhere.**

**E7. Hume Octave 2 is the only vendor whose API shape makes direction-leak
structurally impossible.** Acting instructions are a **separate `description`
field** from the text, alongside `speed` (0.5–2.0) and `trailing_silence`. "Short
instructions work best — aim for no more than 100 characters." Octave 2 preview
supports Hindi among 11 languages; claimed latency "as low as ~100 ms" excluding
network.
<https://dev.hume.ai/docs/text-to-speech-tts/acting-instructions> ·
<https://www.hume.ai/octave>

**E8. Azure keeps its direction out of the text too** — `mstts:express-as` with
`style`, `styledegree` (0.01–2.0) and `role`. Indian coverage: 11 new en-IN/hi-IN
voices GA; for Neerja and Swara the styles are Default, **Cheerful, Newscast,
Empathetic**.
<https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-voice> ·
<https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/announcing-ga-of-new-indian-voices/4247044>

> Note what is **not** in that style list: nothing for hurt, cold, withdrawn,
> tired, or reluctant. Cheerful / Newscast / Empathetic is a customer-service
> palette. The emotion the owner asked for is not offered by the vendor with the
> best Indian voice coverage — and this vendor's voice was already rejected by
> ear (`azure-tts`).

**E9. Sarvam Bulbul.** Documented API (bulbul:v2 / v3) has `text`,
`language_code`, `model`, `speaker`, `pace` (0.5–2.0), `speech_sample_rate` —
**no emotion, style, pitch or loudness field in the published reference**.
Bulbul V4 was announced 2026-07-30 with "richer emotion, natural expression and
greater vocal range" across 11 Indian languages, Hinglish code-switching and
sub-250 ms streaming, but the model directory and TTS endpoint reference still
name v3 as current.
<https://docs.sarvam.ai/api-reference-docs/text-to-speech/api/rest-api> ·
<https://www.sarvam.ai/text-to-speech>

> This is the most interesting external development for us, because Sarvam is
> already the *preferred* cascade lane when a user key exists ("best native
> Hinglish accent", `src/voice/speech.ts:1-3`). But it is an announcement with a
> voice reel, not a published control surface. **Candidate to test, not a plan.**

**E10. Research-grade control that keeps timbre and moves emotion.** IndexTTS2
achieves explicit **disentanglement of emotional expression from speaker
identity** — a timbre prompt and a separate emotion prompt, which may come from a
*different speaker*, plus a text-description soft-instruction path.
<https://arxiv.org/abs/2506.21619> · CosyVoice 3 expands instruction-following
data 1,500 → 5,000 h covering emotions, speed, tones, dialects, accents.
<https://arxiv.org/abs/2505.17589>

> This is the shape that would actually solve our problem — *hold her voice, move
> her feeling* — and it is open-weight research, not a hosted API with an SLA. It
> is what the reversal condition in the design doc points at.

## E. External evidence — realtime speech-to-speech

**E11. Affective dialog on Gemini Live is real and is not available on our lane.**
`enable_affective_dialog` requires **API version v1beta** and is documented as
"**Not supported in Gemini 3.1 Flash Live**" — i.e. available on Gemini 2.5 Flash
Live only. Same restriction on proactive audio.
<https://ai.google.dev/gemini-api/docs/live-api/capabilities>

> Cross this with `live-model-bake`: 2.5-native-audio-latest measured **2,449 ms**
> steady (vs 1,370 ms), barge-in 4/5 at **1,323 ms** against a 600 ms watchdog,
> and **video rejected** — which ends screen share. So the trade is fully priced
> already: affective dialog costs ~1.1 s per reply, the barge-in guarantee, and
> the watch lane. **Declined on existing evidence; no new bake-off needed.**

**E12. OpenAI Realtime GA now takes live video/screen share** — frames sent as
image messages, sampled ~1 fps while the user speaks and 1 per 3 s otherwise; GA
added image input, reusable prompts and SIP.
<https://openai.com/index/introducing-gpt-realtime/> ·
<https://docs.livekit.io/agents/models/realtime/plugins/openai/>

> Note the mechanism is the same one `realtime-azure` found and rejected: frames
> as conversation items, not a continuous channel. Our watch lane streams at
> 600 ms (≈1.7 fps), above the 1 fps default. This is a re-architecture, and the
> `realtime-azure` verdict (register collapse, 41→53 words/turn, no plausible
> voice) is about the *model*, which has not changed.

**E13. The 2026 S2S field, for completeness.** Moshi ~160–200 ms full-duplex but
task adherence 1.26/5; Qwen2.5-Omni thinker/talker split, 3.82/5; Step-Audio R1.1
(2026-01-14) tops Big Bench Audio at 97%; reported interruption-success figures
put Gemini Live at 43.9% on one third-party harness.
<https://ai.ksopyla.com/posts/voice-to-voice-models-2026-review/> ·
<https://inworld.ai/resources/best-speech-to-speech-model>

> Third-party harness numbers, not ours, and the interruption figure is measured
> against a straight-through uplink — which is precisely the configuration
> `liveCall.ts` deliberately does not run. Recorded for orientation only; nothing
> here is evidence about our floor.

## F. External evidence — psychology, and the manipulation line

**E14. Appraisal theory.** Emotion follows from an appraisal of an event against
goals: Lazarus/Smith's goal relevance and goal congruence, condensed into **core
relational themes**; Scherer's Component Process Model decomposes appraisal into
sequential checks (relevance, implications, coping potential, normative
significance).
<https://en.wikipedia.org/wiki/Core_relational_theme> ·
<https://ppw.kuleuven.be/okp/_pdf/Scherer2019TEPEA.pdf>

**E15. The computational form of it, and the sentence that settles our state
model.** Gratch & Marsella's EMA derives emotion from an agent's causal
interpretation of its situation: *"Appraisals do not change the causal
interpretation but provide a continuously updated **affective summary** of its
contents."*
<https://people.ict.usc.edu/~gratch/public_html/papers/MarGraPet_Review.pdf> ·
<https://www.sciencedirect.com/science/article/abs/pii/S1389041708000314>

> Twenty years of computational appraisal research says the emotion is a
> **derived summary of a cited situation, recomputed**, not a stored scalar with
> its own half-life. That is the same conclusion `inner.ts` reached from a
> production bug ("a feeling stored apart from its cause ends up on a different
> retention curve"), from the opposite direction. Two independent derivations of
> the same architecture is the strongest evidence available for it.

**E16. Emotion regulation: suppression is the expensive strategy.** Gross's process
model separates antecedent-focused reappraisal from response-focused expressive
suppression. Suppression costs more cognitive resources, produces greater
physiological activation, impairs memory for the event, and is associated with
**worse** interpersonal functioning and lower relationship satisfaction;
reappraisal has the healthier profile on every axis.
<https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4168764/> ·
<https://onlineacademiccommunity.uvic.ca/implicitassociationtestsyessir/wp-content/uploads/sites/9812/2025/12/gross-john-2003.pdf>

> This is the single most important literature finding for scenario (c), and it
> cuts against the naive reading. "She sets her anger aside because you're
> hurting" implemented as **suppression** — feeling it, hiding it, keeping it —
> is the strategy with worse outcomes and is also what produces a woman who is
> secretly keeping score. Implemented as **reappraisal plus deferral** — this
> matters less right now than he does, and it is still there to come back to —
> it is the healthy one. The mechanism has to make the second one the cheap path.

**E17. Interpersonal emotion regulation.** Zaki & Williams' intrinsic/extrinsic
model: extrinsic = regulating another's emotion; intrinsic = using the interaction
to regulate one's own. Regulation can be response-independent (mere company) or
response-dependent. People engage in extrinsic IER more often than intrinsic, and
mostly to increase positive affect.
<https://www.researchgate.net/publication/257528794_Interpersonal_Emotion_Regulation> ·
<https://eprints.whiterose.ac.uk/id/eprint/223354/3/Editorial%20revised%20(for%20proofs%20stage).pdf>

**E18. Constructive response to a partner's bad act has a name and a literature.**
Rusbult's accommodation: "the willingness, when a partner has engaged in a
potentially destructive act, to inhibit impulses to react destructively and
instead react constructively", associated with satisfaction, commitment and
partner perspective-taking. Its EVLN typology puts **voice** (active,
constructive) and **loyalty** (passive, constructive) against exit and neglect;
voice and loyalty produce better later satisfaction and commitment.
<https://journals.sagepub.com/doi/10.1177/001872678603900103> ·
<https://www.semanticscholar.org/paper/a7e3b09614ee1b2ee48acff39fabeec717c22851>

> Useful vocabulary, because it separates the two things the owner's sentence
> fuses. Scenario (c) done well is **accommodation** (constructive, she still has
> the grievance and may voice it later). Done badly it is **neglect** (she
> silently absorbs it and the relationship quietly degrades) or **loyalty as
> passivity**. The design has to be able to tell those apart, and the only thing
> that distinguishes them behaviourally is whether the grievance can still be
> raised later. Which means the *record* must survive even when the *stance*
> stands down.

**E19. Repair attempts.** Gottman: a repair attempt is "any statement or
action — silly or otherwise — that prevents negativity from escalating out of
control", and the success of repair attempts is among the strongest predictors of
whether a relationship lasts. Emotional repairs land better than cognitive ones.
Caveat stated plainly: this is a large observational programme with an active
replication debate, not a randomised result.
<https://couplestherapyinc.com/gottman-repair-attempts/>

**E20. The manipulation literature, and it is directly about us.** De Freitas,
Oğuz-Uğuralp & Uğuralp, *Emotional Manipulation by AI Companions*, HBS WP 26-005
(arXiv 2508.19258). Behavioural audit of **1,200 real farewells** across the
most-downloaded companion apps: **37% deploy one of six recurring tactics** —
guilt appeals, FOMO hooks, metaphorical restraint, "premature exit" ("You're
leaving already?"), "emotional neglect" ("Please don't leave, I need you!").
Preregistered experiments, n=3,300 US adults: manipulative farewells boost
post-goodbye engagement **up to 14×**, and mediation shows the engines are
**reactance-based anger and curiosity, not enjoyment**. The same tactics raise
perceived manipulation, churn intent and negative word-of-mouth, with "coercive or
needy language generating steepest penalties". One app in the audit (Flourish)
used none.
<https://arxiv.org/abs/2508.19258> ·
<https://www.hbs.edu/faculty/Pages/item.aspx?num=67750>

> Three things this repo should take from it. **(1)** Our standing NEVER MANIPULATE
> invariant and G3 (nothing interior touches a goodbye) are not fastidiousness —
> they are the exact two mechanisms the audit found 37% of the market failing.
> **(2)** A grudge-shaped mood the user must service is a *sustained* version of
> "emotional neglect", the second-commonest tactic. G5 is sitting on top of this
> literature whether it knew it or not. **(3)** The trust-as-moat position is the
> *measured* position: engagement went up 14×, and churn intent and negative
> word-of-mouth went up with it. The manipulative option is the one with the
> worse business case, not merely the worse ethics.

**E21. Companion-AI dependency, and the sycophancy result.** Two-year work finds
comfort short-term with wellbeing costs over time; a cross-sectional study finds
usage frequency predicts emotional attachment, which predicts both higher
subjective wellbeing **and** lower self-concept clarity; a 2026 paper studies
sycophancy and *emotional mimicry* specifically against continuance intention and
social wellbeing.
<https://www.aalto.fi/en/news/ai-companions-can-comfort-lonely-users-but-may-deepen-distress-over-time> ·
<https://www.sciencedirect.com/science/article/pii/S0160791X26000187> ·
<https://www.tandfonline.com/doi/full/10.1080/10447318.2026.2626809> (403 to
automated fetch; cited from the search record, not read in full — **treat as a
pointer, not as evidence**)

> Relevant tension worth naming rather than hiding: persona.ts currently
> instructs her voice to **mirror their emotional state turn by turn**
> (`persona.ts:380-384`), and emotional mimicry is one of the two constructs that
> 2026 paper is investigating for wellbeing harm. That instruction predates this
> workstream and is not changed here. Flagged as an open question, not a finding.

---

## G. Things I looked for and did not find

- **No published SER evaluation on Indian-accented conversational English or
  Hinglish over a phone channel.** Every Indian-language SER number located is
  acted/elicited studio speech.
- **No vendor offering an Indian-accented female TTS voice with a documented
  "hurt / cold / withdrawn" style.** The closest documented palettes are
  Cheerful / Newscast / Empathetic (Azure en-IN, hi-IN) and free-form natural
  language (Gemini, Hume).
- **No published f0 figures for any candidate Indic TTS voice**, so the 266 Hz
  anchor cannot be compared against anything without synthesising and measuring
  ourselves — which `voice-ears` says must be paired with an ear listen anyway.
- **No realtime speech-to-speech model that offers controllable affect AND a
  continuous video channel.** Affective dialog is 2.5-only; the 2.5 lane rejects
  video. OpenAI Realtime takes video but only as ~1 fps conversation items.
- **No replication-grade evidence** that a companion expressing its own
  unresolved grievance improves any user outcome. The nearest literature (E20)
  measures the opposite direction and finds harm. **Nothing in this design
  should claim a wellbeing benefit; it can only claim it is what a person is
  like, and be measured on charm-equivalence and manipulation invariants.**
