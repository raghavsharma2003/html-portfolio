# Track: multimodal-state — relational state beyond text

Research sweep for Vyakti / relational-state program, Phase A. Grounded against
`context/decisions.md`, `context/measurements.md`, `context/rejected.md` — no
claim here contradicts a measured repo finding without saying so explicitly.

Web access: WebSearch + WebFetch both worked for the session. Several PDF
fetches (arXiv `/pdf/...` URLs) returned binary/garbled content and could not
be read directly — noted individually below; where that happened I used the
`/abs/` or HTML mirror instead and flag anything drawn only from an abstract as
abstract-only.

---

## 1. Does anyone store HOW something was said, not just WHAT — emotion/prosody as memory

### 1.1 The representations that actually exist

**Hume AI — Speech Prosody model.** Streaming/batch expression-measurement API.
Output is **48 continuous dimensions of emotional expression per segment**,
scored roughly 0–1, derived from Hume's "semantic space" affect model (not a
single discrete emotion label — a vector). Available via Expression
Measurement batch API and a real-time streaming API/SDK.
Source: https://dev.hume.ai/docs/expression-measurement/models/prosody ,
https://dev.hume.ai/docs/expression-measurement/overview ,
https://www.hume.ai/explore/speech-prosody-model
Hume's EVI (Empathic Voice Interface) is the productized version: it measures
prosody live during a call and conditions both response content and the TTS
delivery on it. Source: https://www.hume.ai/empathic-voice-interface ,
https://www.hume.ai/blog/introducing-hume-evi-api
*I could not reach Hume's technical docs page with enough detail to confirm
whether EVI itself persists prosody vectors across sessions as memory, or only
uses them within-turn to steer generation — treat "EVI has cross-session
prosody memory" as UNVERIFIED; what's confirmed is the extraction capability,
not a memory product built on it.*

**Speech-emotion-recognition-as-symbolic-label is the dominant applied
pattern**, not raw embeddings. Two separate systems converge on this
independently:
- A VR-agent paper (Reading the Mood Behind Words) runs HuBERT-Large
  (SUPERB-tuned) SER over audio → discrete label {Happy, Sad, Angry, Neutral}
  → injects it as a **bracketed text tag prepended to the transcript**, e.g.
  `[Angry] {transcript}`, directly into the LLM prompt. n=30, within-subjects:
  rapport t(29)=3.98 p<.001, engagement t(29)=3.37 p<.01, human-likeness
  t(29)=2.80 p<.01, emotional responsiveness t(29)=5.62 p<.001; **93.3%
  (28/30) preferred the emotion-tagged agent** over the same agent with
  transcript only. Source: https://arxiv.org/html/2603.09324v1
- EchoMind (a 2026 benchmark for empathetic speech-LMs, 12 models tested)
  measures whether models perceive 39 vocal attributes (emotion, speech rate,
  breathing, laughter/sighing, etc.) directly from audio vs. having them
  handed as text. **Only 3 of 12 models exceeded 60% accuracy perceiving vocal
  cues from raw audio.** But when the *correct* vocal-cue information was
  supplied as text, GPT-4o-Audio's empathetic-response quality jumped **3.34 →
  4.42 / 5** — i.e. **the bottleneck is perception, not generation.** A model
  that is bad at hearing tone gets good at using it once told in words.
  Source: https://arxiv.org/html/2510.22758

**This is the load-bearing finding for the design**: the field has converged
on *extracting prosody into a short symbolic/textual tag and injecting that as
text*, not on carrying raw audio or high-dimensional embeddings into the LLM
context. That is also the only representation compatible with a **model-swap**
architecture — a text tag means nothing about the underlying LLM or TTS engine
has to change for the signal to keep working, exactly the property the
relational-state program needs. It is a close cousin of the extract-model
pattern the repo already runs for text memory (`context/decisions.md`
`extract-model`), just pointed at the audio channel instead of the transcript.

**One repo-specific hazard to flag against `recited-prompt`:** the repo's own
law is that anything sentence-shaped in a prompt gets recited verbatim
(phrase-bank effect, 4/5 → 0/5 after removal; taste-as-sentences read back
twice 8 turns apart). A bracketed emotion tag like `[flat, clipped, laugh cut
short]` is a *label*, not a sentence, and should be safe by the repo's own
rule (shapes/notes, never lines she could say) — but this has not been tested
inside Meera's actual prompt, so treat "tags don't get recited" as an
extrapolation from `recited-prompt`, not a new measurement.

### 1.2 Emotion-as-memory-unit architectures (episodic, not just per-turn)

- **Memory Bear** (arXiv 2603.22306, Mar 2026) proposes "Emotion Memory Units"
  (EMUs) as the atomic stored object: structured memory formation →
  working-memory aggregation → long-term consolidation → memory-driven
  retrieval → dynamic fusion calibration → continuous updating. Explicit
  design stance: **emotion is an evolving variable across a trajectory, not a
  transient per-turn output** — i.e. don't just tag the current turn, track
  how the emotional read on a topic/person moves over the relationship.
  Reports "consistent gains... especially under noisy or missing-modality
  conditions" but I could not extract numeric results — the PDF fetch
  returned unparseable binary and the abstract page didn't carry tables.
  Treat the architecture shape as credible (it's coherent with the other
  sources below) but the quantitative claims as UNVERIFIED.
  Source: https://arxiv.org/abs/2603.22306 (abstract only)

- **KEEM** (Generation-Based and Emotion-Reflected Memory Update, arXiv
  2601.05548) stores **fact-emotion-cause tuples**, not free text: what
  happened, what was felt, why. Built by having an LLM rewrite session
  summaries to fold in emotion+cause, then merge with the prior summary.
  Measured: **10–30% lower perplexity vs. operation-based memory updates**,
  and **memory-contradiction rate ~5% vs. ~30%** for the baseline (KMSC
  dataset). This is a *text*-memory result (Korean multi-session chat), not
  multimodal, but it's the clearest evidence that separating "what" from
  "felt, and why" as distinct fields — rather than folding affect into prose
  — measurably reduces the system contradicting its own emotional read of the
  user later. Source: https://arxiv.org/pdf/2601.05548 (via search summary;
  full PDF not independently re-verified)

- **Livia** (arXiv 2509.05298, AR companion) is the closest published system
  to Meera's shape: a four-agent pipeline — emotion analyzer (RoBERTa for
  text + CNN-LSTM for audio), dialogue agent, memory-compression agent,
  behavior orchestrator. Two compression mechanisms:
  - **Temporal Binary Compression (TBC)**: pairwise-merges raw turns into
    daily → weekly → monthly summaries on an exponential schedule, explicitly
    modeled on human memory decay.
  - **Dynamic Importance Memory Filter (DIMF)**: assigns each memory an
    importance score weighted by *emotional intensity*, user feedback, and
    contextual relevance, and prunes low-score memories first — so
    emotionally flat small talk decays before an emotionally loaded episode
    does.
  Measured (50 participants, 18–34, 11,504 turns over 4 weeks): storage
  reduced ~50KB → ~15KB/user (**70% reduction**); **92% recall accuracy on
  important events vs. 65% on general details** — the importance-weighted
  scheme selectively protects exactly what you'd want it to. 7.9
  conversations/day, 4.8 min average.
  Source: https://www.alphaxiv.org/abs/2509.05298 ,
  https://arxiv.org/abs/2509.05298
  *Caveat: these numbers come through an AI-summarized fetch of the paper, not
  a table I read directly — treat the specific percentages as
  probably-accurate-but-not-independently-cross-checked.*

**Design implication:** the repo has no equivalent of DIMF today —
`context/` describes text extraction and taste-consistency but nothing that
weights memory survival by emotional salience under storage pressure. That's
a specific, citable gap a multimodal episodic record should close, because
without it a compressed history will forget the fight and remember the small
talk in whatever order they happened to occur, not by what mattered.

---

## 2. Voice identity continuity — why familiarity beat fidelity, and what would make it portable

The repo's own measured finding (`context/rejected.md#azure-tts`,
`context/decisions.md#voice-model`) is central here and this track does not
contradict it: Azure coral won on **every measured axis** (Hindi pronunciation
15/15 vs 11/15, first-audio 255ms vs 4.9–12.7s, cost $0.0029 vs $0.0148) and
was rejected by ear — "not human and not Indian." The repo's own lesson,
already written down, is exactly what the outside literature independently
confirms:

**Perception-and-evaluation research on cloned vs. recorded voices**
(ScienceDirect, 2025 — WebFetch was blocked with HTTP 403 on the publisher
page, so this is from search-result summaries only, flagged accordingly):
listeners **familiar** with a voice rate its **clone** as *less* trustworthy,
attractive, and competent than a genuine recording of the same person;
listeners **unfamiliar** with the voice show the opposite pattern — they
prefer the clone or can't tell the difference. n=47 participants + 47
unfamiliar controls, rating self-voice and friend-voice clones vs recordings
on Trustworthiness/Attractiveness/Competence/Dominance.
Source: https://www.sciencedirect.com/science/article/pii/S2949882125000271
(fetch blocked 403; summarized via search snippet — UNVERIFIED at
primary-source level)

This maps directly onto the repo's finding: **the owner is the "familiar
listener."** A stranger judging blind clips might well rate Azure coral
higher (better pronunciation, better latency) — same asymmetry the research
shows. The repo's `voice-ears` measurement is not an outlier finding, it's the
expected result of testing with the one listener who has the calibration to
notice. That means **any future voice-model comparison in this program must
keep testing with a familiar-listener judge, not a blind pronunciation/MOS
panel** — a naive MOS-style eval will systematically favor the more polished,
less-actually-her option, which is exactly the trap the repo's `voice-ears`
entry already names as a lesson ("test accent authenticity as a first-class
axis").

### 2.2 What would make voice identity survive a model swap — the portable representation

The mechanism that exists in the literature for **decoupling voice identity
from a specific TTS backend** is the **speaker embedding**: a fixed-length
vector (commonly a **d-vector**, or from an ECAPA-TDNN encoder, **256–512
dimensions**) extracted from a few seconds of reference audio, which then
*conditions* a separate multispeaker TTS backbone. This is the standard
zero-shot voice-cloning architecture: encoder → embedding → conditions
vocoder/backbone, and a **Speaker Consistency Loss** (cosine-similarity
penalty between reference and synthesized embeddings) is used during training
specifically to keep identity stable across resynthesis.
Source: https://www.emergentmind.com/topics/zero-shot-tts ,
https://arxiv.org/pdf/2505.00579 (Voice Cloning: Comprehensive Survey)

**What this means architecturally, stated as an inference, not a
measurement:** the thing worth persisting as "her voice" for
migration-fidelity purposes is not "we use Gemini TTS with voice ID X" — that
is backend-specific and breaks the moment `voice-model` reverses. It is a
**canonical speaker embedding extracted from her own accepted output**
(the clips already judged "her" by the owner), stored independently of which
engine currently renders it. A future backend swap becomes: extract an
embedding from the candidate's output, compute similarity against the
canonical embedding, and — per the familiarity-vs-fidelity finding above —
**gate on the owner's ear, not on the cosine similarity number.** Embedding
similarity is a cheap pre-filter to avoid wasting owner-listening time on
obviously-wrong candidates; it is not a substitute for the "does she sound
like herself" judgment, because pronunciation/accent-identity are the
*specific axis the repo has already proven a spec sheet won't catch*
(`voice-ears`, `azure-tts`: Azure won every measured number and still failed).

**Unresolved / not found:** I did not find published work on maintaining
voice identity *specifically across a swap of the underlying LLM* (as
distinct from swapping the TTS engine) — i.e. whether the same speaker
embedding + same reference clips reliably reproduces "her" prosody when a
different LLM is choosing the words and pacing that get spoken. Given
`realtime-azure`'s finding that the *model* changes spoken-turn length and
markers even on a byte-identical prompt (41→53 words/turn, spoken-register
markers 4/24 vs incumbent), it is a reasonable inference — not a citation —
that voice identity and *linguistic* identity are coupled at the point of
generation even if the TTS layer is held perfectly constant. This is a gap
the `swap-test` track's protocol should be designed to actually measure, not
assume.

---

## 3. Shared-attention memory — remembering what you watched/did together

Direct hits on "AI companion remembers a screen-share session with you" as a
shipped product are thin; the closest published work is either
human-robot-interaction joint-attention research (older, not multimodal-LLM
era) or very recent (2025-2026) multi-agent co-viewing papers.

- **CompanionCast** (arXiv 2512.10918, CHI 2026 workshop paper) — multi-agent
  system for co-viewing (tested on shared soccer-match viewing). Stores what
  was watched, when, and participant reactions/commentary, and uses that
  stored history to keep later discussion grounded in the shared session and
  track who said what during it. **No quantitative evaluation was extractable
  from the fetch** — PDF returned as binary and the tool couldn't parse
  numbers; treat this as architecture-shape evidence only, UNVERIFIED
  numerically. Source: https://arxiv.org/pdf/2512.10918

- **Persode** (arXiv 2508.20585) — personalized visual journaling agent, not
  a live-companion system, but its **per-event schema is the clearest
  published shape for "what must an episodic record contain"**: photo/visual
  evidence, emotional state, activity, people present, place, timestamp.
  Retrieval is described as context-aware rather than keyword matching, so
  later reflection surfaces thematically-related past entries, not just
  time-adjacent ones. Numeric eval not extractable from the fetch (same PDF
  parsing limitation) — UNVERIFIED quantitatively, but the schema itself is
  independently sane and matches the older HRI literature.
  Source: https://arxiv.org/pdf/2508.20585

- **Older HRI joint-attention line** (2015-2021, pre-LLM) established the
  underlying cognitive claim this design leans on: joint/shared attention is
  a prerequisite for the *interaction* to register as relational at all, and
  memory-based joint-attention frameworks that fuse multi-sensory perception
  with an episodic store outperform purely reactive attention. An
  automatic-diary-generation paper (arXiv 2309.01948) is explicit that the
  underlying model **has no memory of the joint experience itself** — the
  diary is generated *after the fact* from a log of the interaction/dialogue
  history, i.e. the "memory" is a post-hoc textual artifact built from a
  transcript-like record, not something the live model retained. This is the
  same shape as Meera's existing extract-model pattern and as the
  Gemini-Live/OpenAI-Realtime findings in §4 below: **live multimodal
  processing does not equal persistent multimodal memory; something has to
  extract and write it down afterward.**
  Sources: https://pmc.ncbi.nlm.nih.gov/articles/PMC8650613/ ,
  https://arxiv.org/abs/2309.01948 (abstract; full PDF unreadable via fetch)

### 3.1 What the screen actually contains vs. what can safely be stored

The repo's own `vision-fab` measurement is directly load-bearing here and
should gate what a screen-share episodic record is allowed to claim: even the
best-measured vision model (grok-4-20-non-reasoning) had **0/32 fabrications
only under good conditions**; llama-4-maverick fabricated 3/32 and broke the
"seeing it for the first time" rule twice in 16 frames; GPT-5.6 models
declared sections illegible and then confidently invented content anyway
(read-part-assert-the-rest, `context/rejected.md`). **A shared-attention
memory record must store what was *extracted and asserted*, tagged with the
extracting model and its declared confidence/illegibility — never a raw
frame treated as ground truth, and never an assertion promoted to "what we
watched together" without the record of which model said it and whether it
hedged.** This is a direct consequence of a measurement already in the repo,
not new research — the outside literature (CompanionCast, Persode) doesn't
address hallucination risk in the co-viewing record at all, which is itself
worth noting as a gap in the outside field, not just in this repo.

---

## 4. Streaming multimodal session state vs. persistent state — what leaks, what doesn't

This is the part with the clearest, most directly source-able answers.

### 4.1 Gemini Live API (the incumbent per `live-model-bake`/`live-model-swap`)

- **Context window**: 128k tokens, shared across all modalities in the
  session. Audio costs **25 tokens/sec**, video costs **258 tokens/sec** —
  video is ~10× the token cost of audio per second of real time. Without
  compression, this caps an **audio-only session at ~15 minutes** and an
  **audio+video session at ~2 minutes** before the session is forcibly
  terminated. Source: https://ai.google.dev/gemini-api/docs/live-session ,
  https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/start-manage-session
- **Context window compression**: a server-side sliding window that, once a
  configured token threshold is hit, **truncates the oldest turns —
  including their video frames** — to keep the session alive indefinitely.
  This is opt-in (`contextWindowCompressionConfig`) and is the only way to
  run a long screen-share session at all. Source:
  https://ai.google.dev/gemini-api/docs/live-api/best-practices
- **Session resumption**: a resumption token lets a client reconnect after a
  brief drop (wifi→cellular) and have server-side state restored — but the
  resumption window is on the order of **~10 minutes**; past that the session
  state is discarded server-side to free resources. This is explicitly a
  continuity-of-connection feature, not a persistent-memory feature — it
  bridges a network blip within one still-live session, and buys nothing
  once the session is actually over.
  Source: https://ai.google.dev/gemini-api/docs/live-session ,
  https://firebase.google.com/docs/ai-logic/live-api/sessions

**What this means for Meera specifically:** video is the modality that gets
silently discarded *first and fastest* under Gemini Live's own compression —
at 258 tok/s it blows the 128k budget in minutes without compression, and
compression's whole mechanism is throwing away the oldest frames first. A
screen-share call that runs long is *guaranteed* by the vendor's own
architecture to lose the early part of what was watched unless something
outside the live session captured it in real time. This directly explains
*why* the repo's screen-share lane already works the way it does (600ms
scene-change gated capture feeding a separate vision call, per
`context/measurements.md` `vision-fab` and `frame-cadence`) — that pipeline
isn't just a cost optimization, per the repo's own framing ("scene-change
gating is not an optimisation, it is viability") — it is *also* the only
mechanism by which anything from the call could survive as a persistent
memory, because the live session's own context will not hold it.

### 4.2 OpenAI Realtime API

- **Realtime sessions are stateless from the server's persistence
  perspective for anything beyond the conversation transcript.** Once a
  session/socket closes, the live audio/emotional context is gone; there is
  no automatic carryover of extracted affect or vision content.
  Source: https://openai.github.io/openai-agents-js/guides/sessions/ ,
  https://developers.openai.com/api/docs/guides/conversation-state
- OpenAI's newer **Conversations API** gives a `conversation_id` the server
  will reconstruct history from, and conversation items **do not expire under
  the general 30-day TTL** once attached to a conversation — but this
  persists *transcript/text items*, not prosody or extracted emotion; nothing
  in the mechanism extracts affect automatically.
  Source: https://developers.openai.com/api/docs/guides/conversation-state
- Directly confirming the "extraction has to be a separate pass" pattern:
  **ChatGPT's Advanced Voice Mode does not carry the persistent Memory layer
  into voice sessions by default** — voice sessions are session-scoped, and
  cross-session continuity depends entirely on the *separate*, text-based
  Memory system, not on anything intrinsic to voice/audio processing.
  Source: search-result summary citing OpenAI's own product documentation
  (page not independently re-fetched — treat as UNVERIFIED at
  primary-source level, but consistent with the Realtime API's documented
  statelessness above).

### 4.3 The pattern, stated once

**No major streaming multimodal API — Gemini Live, OpenAI Realtime, or
OpenAI's own consumer voice product — offers persistent multimodal memory as
a platform feature.** All three converge on the same shape: the *live*
session (audio, video, prosody) is genuinely ephemeral and actively evicted
under pressure (Gemini's token economics make video the first casualty);
*persistent* memory, where it exists at all, is a separate, text-based,
app-owned layer that something has to actively write into during or
immediately after the live session. This is not a gap specific to Meera's
current build — it is the state of the entire category as of this research
date (August 2026) — which means **the "extract during the live turn, persist
the extract, discard the raw stream" pattern the repo already uses for text
(`extract-model`) is not a workaround for an immature vendor feature; it is
the only architecture that exists anywhere in the field for multimodal
relational memory**, and building anything else (waiting for a vendor to ship
native persistent multimodal memory) is not a credible alternative path
within this program's horizon.

---

## 5. Design: what a multimodal episodic record must contain

Synthesizing §1–4 into a concrete schema. This is a design proposal for Phase
B, built only from what's shown above to actually exist — not aspirational.

```
EpisodicRecord {
  id, timestamp, channel: "chat" | "call" | "screen-share",
  duration_s,

  # WHAT — content layer (already exists in the repo's text pipeline;
  # extend, don't replace)
  content_summary: string        # extract-model output, telegraphic notes
                                   # per recited-prompt (never full sentences
                                   # she could recite verbatim)
  participants_present: [...]     # speaker-ID is explicitly NOT built
                                   # (rejected.md#speaker-id) — this stays
                                   # "the owner" until that changes

  # HOW — prosody/affect layer (new; grounded in §1)
  affect_tags: [ {label, intensity_0to1, source: "voice"|"text"|"vision",
                   extractor_model, confidence} ]
                # symbolic tags, not raw audio/embeddings — matches the
                # extract-once-inject-as-text pattern validated by EchoMind
                # and the VR-agent paper (§1.1). NOT a continuous Hume-style
                # 48-dim vector in the live prompt path — that's an analytics
                # store, not a prompt input, per recited-prompt and
                # prompt-budget discipline.
  affect_trajectory_delta: string # optional — how the read on a *topic* or
                                   # *person* moved vs. last record on the
                                   # same subject (Memory Bear's "evolving
                                   # variable" framing, §1.2) — this is what
                                   # lets her notice "you used to hate his
                                   # roommate, now you don't mention him"

  # SHARED ATTENTION — screen/watch layer (new; grounded in §3)
  visual_assertions: [ {claim, extracting_model, confidence,
                         declared_illegible: bool} ]
                # never a raw frame treated as fact. Every claim is tagged
                # with which model said it and whether it hedged — required
                # because of vision-fab's measured fabrication rates and the
                # read-part-assert-the-rest failure mode already in
                # rejected.md. A record with no confidence tag cannot later
                # be told apart from a hallucination.
  shared_reaction: string?        # her own in-the-moment reaction, if any,
                                   # kept separate from the visual claim it
                                   # was reacting to, so a later-corrected
                                   # visual claim doesn't silently invalidate
                                   # a genuine emotional beat that already
                                   # landed with the user

  # VOICE IDENTITY — continuity anchor (new; grounded in §2)
  voice_reference_id: string      # points at the canonical accepted-clip
                                   # set / speaker embedding, NOT at a
                                   # specific vendor voice ID — decouples the
                                   # record from voice-model's current value
                                   # so a future swap doesn't orphan history

  # SALIENCE — for compression under storage pressure (grounded in §1.2)
  importance_score: float         # DIMF-style: weighted by affect intensity,
                                   # explicit user signal (did they come back
                                   # to this topic unprompted), and recency
  consolidation_tier: "raw" | "daily" | "weekly" | "monthly" | "kept-forever"
                                   # TBC-style exponential decay schedule,
                                   # EXCEPT records tagged with the crisis
                                   # protocol or safety invariants, which are
                                   # out of scope for this track but should
                                   # never be eligible for decay-driven loss
                                   # — flagging for safety-reg track, not
                                   # deciding it here.
}
```

**Extraction timing, stated as the one non-negotiable per §4:** every field
above must be written by a process that runs *during or immediately after*
the live session, never read back out of the live model's own context later
— because the live context (Gemini Live's compression, OpenAI Realtime's
statelessness) is not a durable store for any vendor measured in this
research. This is the direct multimodal analogue of the repo's existing
`extract-model` decision and should probably be the *same* extraction call
where practical (one pass that pulls text facts, affect tags, and visual
claims together), rather than three separate passes, both for the
prompt-budget/cost reasons in `cache-9x` and because Memory Bear's fusion
argument (§1.2) is that affect is only correctly read *with* its
co-occurring content, not independently of it.

---

## Summary of what's measured vs. inferred vs. unverified

- **Measured (repo)**: voice-model rejection reasons, vision-fab fabrication
  rates, extract-model rationale, recited-prompt law, prompt-position law —
  all cited above as constraints the design must respect, none contradicted.
- **Measured (external, numbers I could read directly)**: EchoMind (39
  attributes, 12 models, 3/12 >60%, 3.34→4.42 empathy score); VR-agent SER
  paper (n=30, t-tests, 93.3% preference); KEEM (10-30% perplexity, 5% vs 30%
  contradiction rate); Gemini Live token costs and window limits (25 vs 258
  tok/s, 15min/2min caps).
- **Externally reported but not independently re-verified at the primary
  source** (fetch blocked, PDF unparseable, or relied on a search-engine
  summary rather than the document itself): Memory Bear's quantitative
  results, Livia's compression/recall percentages, CompanionCast's and
  Persode's evaluation numbers, the cloned-voice familiarity study's exact
  numbers, ChatGPT Advanced Voice Mode's memory-scoping claim. The
  *architecture shapes* from these sources are used in the design because
  they're internally coherent and consistent with each other across
  independent groups; the specific percentages are flagged so nothing here
  gets cited downstream as more solid than it is.
- **Pure inference, explicitly labeled where used**: that voice identity and
  linguistic identity are coupled at generation time even with TTS held
  constant (extrapolated from `realtime-azure`, not measured for voice
  specifically); that bracketed affect tags won't be recited the way prose
  taste-notes were (extrapolated from `recited-prompt`, not tested in
  Meera's actual prompt).

## Gaps this track did not resolve

- No primary-source read of Hume's EVI persistence/memory behavior across
  sessions — only the extraction capability is confirmed.
- No published research found on voice-identity continuity specifically
  across an *LLM* swap (as opposed to a TTS-engine swap) — this is a real gap
  in the field, not just in this search, and is a candidate for the
  `swap-test` track to measure directly rather than assume.
- CompanionCast and Persode numeric evaluations were not extractable from
  the tooling available this session (PDF binary parsing failed twice); a
  follow-up with a proper PDF-text extraction path would be worth doing
  before Phase B treats their numbers as load-bearing.
