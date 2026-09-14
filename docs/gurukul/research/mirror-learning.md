# Ongoing / online mirroring and learning — research sweep (2026-08-26, WS-Z)

Scope: the academic and open-source state of the art for exactly what
`docs/gurukul/MIRROR-CALL-SPEC.md` describes — a live call in which a person's
clone improves *during the call* from (a) accumulating reference audio, (b)
statistical mining of the person's own speech, and (c) explicit in-the-moment
feedback, with every learned delta approved before it lands.

This sweep **extends** and does not redo `research/voice-stack.md` (model
choice, licensing, fine-tune recipe, fidelity measurement) or
`research/relationalos-100x.md` (agent memory, persona drift, persona
consistency benchmarks). Where a finding here overturns or sharpens one of
those, it says so explicitly.

House rules applied: every claim carries a citation; anything not verified
against a primary source is flagged **[UNVERIFIED]** with the reason;
**conflicting sources are surfaced, not averaged**; every OSS project carries
its license, with copyleft called out.

Verification posture for this sweep: primary sources fetched successfully
include the **Chatterbox source files themselves** (the single most important
finding below), the Chatterbox and seed-vc repo READMEs, the CIPHER paper HTML,
the Persona Vectors paper, and the WeClone README. Several PDFs (Cakmak &
Thomaz HRI 2012, Eder DH2010, Voicebox, kNN-VC) would not decode through the
fetch tool and are cited at search-summary tier with that flagged.

---

## 1. Online / incremental voice adaptation

### 1.1 The finding that reshapes the voice loop: Chatterbox discards reference audio past ~10 seconds

This is the strongest single result in the sweep, and it is a **primary-source
code read**, not a paper claim.

In `src/chatterbox/mtl_tts.py`, `prepare_conditionals(wav_fpath, ...)` builds
the conditioning from a **single** reference file and truncates it twice before
the model ever sees it:

- `DEC_COND_LEN = 10 * S3GEN_SR` — the S3Gen (decoder/flow) conditioning
  reference is sliced `s3gen_ref_wav[:self.DEC_COND_LEN]` → **10 seconds**.
- `ENC_COND_LEN = 6 * S3_SR` — the T3 speech-prompt tokens are taken from
  `ref_16k_wav[:self.ENC_COND_LEN]` → **6 seconds**.

Source: [resemble-ai/chatterbox `src/chatterbox/mtl_tts.py`](https://raw.githubusercontent.com/resemble-ai/chatterbox/master/src/chatterbox/mtl_tts.py)
(fetched 2026-08-26).

The layer below confirms the intent rather than contradicting it: in
`s3gen.py`, `embed_ref()` computes the speaker x-vector over **the whole
waveform it is handed** and does not itself truncate — but it prints
`"WARNING: s3gen received ref longer than 10s"` above `10 * ref_sr` samples,
i.e. >10 s is an out-of-distribution input the model warns about, not a
supported enrichment path. Source:
[resemble-ai/chatterbox `src/chatterbox/models/s3gen/s3gen.py`](https://raw.githubusercontent.com/resemble-ai/chatterbox/master/src/chatterbox/models/s3gen/s3gen.py).

The README's own usage example is `audio_prompt_path="your_10s_ref_clip.wav"`,
and the `generate()` signature takes **one** optional `audio_prompt_path` — the
shipped API has no multi-reference input at all.
[github.com/resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox)
(MIT, confirmed again this sweep).

**Consequence for MIRROR-CALL-SPEC §Voice loop.** The spec says call audio
"accumulates into the replica's reference set… the next clone turn synthesises
off the enriched reference." Under our pinned primary model, *accumulation
alone is mechanically inert*: turn 40 of a Mirror Call synthesises from at most
10 s of conditioning, exactly as turn 2 did. Growing the pool from 71 s to 20
minutes changes nothing unless something **chooses a different 10 s**.

The salvage is that the same code read hands us the mechanism: `Conditionals`
is a dataclass with `save()` / `load()`, so a chosen conditioning window can be
precomputed, cached, versioned and swapped between turns cheaply. **The voice
loop's real lever is reference *selection* over the accumulating pool, not
reference *accumulation*.** That reframing is adoption delta A1.

One honest caveat: `voice-evidence`'s ECAPA embedding *does* consume the whole
grown set (our own 71 s → 4 windows → 8 embeddings run), so the **fidelity
meter** keeps improving its estimate as audio accumulates even while the
**synthesis** does not improve. That is a live honesty hazard — a meter that
moves next to a clone that cannot have changed. Adoption delta A2.

### 1.2 How clone fidelity scales with reference duration — the sources conflict, and the conflict is informative

Three credible sources disagree, and the disagreement is *not* noise: they are
measuring different architectures.

| source | claim | tier |
|---|---|---|
| **Voicebox** (Meta, arXiv:2306.15687 §5.7, Fig. 6) | "WER mildly decreases and **SIM-r grows quickly and flattens** with longer audio prompts"; Voicebox reaches VALL-E's speaker similarity with ~two-thirds the input audio (VALL-E's baseline being 3 s) | primary paper, fetched via [ar5iv](https://ar5iv.labs.arxiv.org/html/2306.15687); the per-duration numeric table was not legible — **[UNVERIFIED numbers, verified quote]** |
| **BSC Wildspoof 2026 submission** (arXiv:2602.05770) | "direct correlation between prompt length and speaker similarity" — F5-TTS long prompt **SECS 0.35** vs short prompt **SECS 0.24**; StyleTTS2 long **0.19** vs short **0.14** (KSKT set) | primary, [arxiv.org/html/2602.05770](https://arxiv.org/html/2602.05770), fetched |
| **kNN-VC** (Interspeech 2023, arXiv:2305.18975 §5.2) | needs *minutes*: "using the maximum speaker data in LibriSpeech (roughly **8 minutes** per speaker) gives very similar performance to only using **5 minutes**"; and "with limited target data (**less than 30 s**), intelligibility and target speaker similarity decrease to a point where the more complex baselines perform better"; at **5 s** it retains only "moderate" quality | primary paper via [ar5iv](https://ar5iv.labs.arxiv.org/html/2305.18975), fetched — the numeric Figure 2 values were not extractable **[UNVERIFIED numbers, verified quotes]** |

**Resolution, stated rather than averaged.** These are two different scaling
laws for two different mechanisms:

- **Prompt-conditioned TTS** (Chatterbox, F5, StyleTTS2, Voicebox) compresses
  the reference into a fixed-size speaker condition. Similarity rises steeply
  over the first seconds and then flattens; more audio buys progressively less,
  and past the model's truncation window buys *exactly zero*. Voicebox's
  "flattens" and BSC's "long > short" are compatible — BSC's "short" prompts
  are on the steep part of the same curve.
- **Retrieval/matching-set VC** (kNN-VC) uses the reference as a *database* to
  draw frames from, so more minutes = better coverage, with a knee around
  **5 minutes** and a floor below **30 s**. This is the one architecture where
  the Mirror Call's accumulation story would work as written.

**Our in-house point sits exactly where this predicts.** ECAPA **0.7753** at
**71 s** of reference against a **0.8869** self-vs-self ceiling
(`context/STATE.md`, `first-real-clone`): 71 s is far past a 10 s truncation
window, so the residual 0.11 gap is **not a reference-duration deficit** and
will not be closed by collecting more audio in a call. It is a
model-conditioning-capacity gap, and the levers against it are (i) selecting a
better 10 s, (ii) per-speaker LoRA (the WS-U lane), (iii) a different
architecture. This is the sweep's single most decision-relevant conclusion and
it **sharpens** `ROADMAP-100X.md`'s "fine-tuning is the better-than-instant
path" from a hypothesis to a structural necessity.

### 1.3 Reference selection, weighting and quality filtering — and the trap in "just clean the audio"

- **Cleaning the reference can *lower* speaker similarity.** The BSC Wildspoof
  submission enhanced prompts with the Sidon denoiser (reported to outperform
  Demucs on signal quality) and measured: F5-TTS enhanced → **UTMOS 3.89 /
  DNSMOS 3.31 / SECS 0.28** versus **SECS 0.35** for the un-enhanced long
  prompt. Enhancement raised perceived audio quality and **reduced** speaker
  similarity; the authors conclude a trade-off requiring "adaptive enhancement
  strategies." [arxiv.org/html/2602.05770](https://arxiv.org/html/2602.05770).
  **This is a direct warning against a naive "quality filter the call audio"
  step in the Mirror Call reference pipeline.**
- **Text-matched dynamic prompt selection is a real, published technique.**
  The NPU-HWC ISCSLP-2024 system selects, from a candidate pool of prompt
  speeches, the one most relevant to the text currently being synthesised —
  because "the consistency between the prompt text and the synthesized text
  also affects the results."
  [arxiv.org/pdf/2410.23815](https://arxiv.org/pdf/2410.23815) —
  **[UNVERIFIED: read at search-summary tier, not fetched]**. Applied to a
  Mirror Call, the candidate pool is *free* — it is the owner's own turns from
  the last few minutes, already segmented by turn boundaries.
- **Multi-reference conditioning is an active line** (MRMI-TTS, ACM TALLIP
  2024: "a single reference audio cannot cover all the details of the target
  speaker's timbre"; multi-level speaker representation for timbre + prosody).
  [dl.acm.org/doi/10.1145/3649501](https://dl.acm.org/doi/10.1145/3649501) —
  **[UNVERIFIED: publisher returned HTTP 403; cited from search summary only]**.
  It does **not** compose with Chatterbox's single-`audio_prompt_path` API
  without model surgery, which the audio-floor law puts out of scope.
- **Enrollment augmentation** for target-speaker extraction is studied
  directly ([arXiv:2409.09589](https://arxiv.org/pdf/2409.09589)) — flagged as
  a follow-up read, **not** digested this sweep.

### 1.4 Own-voice isolation from call audio

The Mirror Call's reference set must contain **only the owner's voice** — the
clone's own synthesised turns leaking into it is a recursive-training loop
(§4.2). The literature calls this target-speaker extraction / target-speaker
VAD, and the enrollment clue can be "a pre-recorded enrollment speech"
([arXiv:2502.16611](https://arxiv.org/pdf/2502.16611);
[NVIDIA NeMo speaker diarization docs](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/speaker_diarization/intro.html)).
Target-speaker VAD on top of a clustering diarizer is the standard cascade
shape.

**But our situation is far easier than the literature's, and we should not buy
the hard solution.** In a Mirror Call we *emitted* the clone's audio ourselves
and we know the turn boundaries; and we already hold an ECAPA embedding of the
owner (`voice-evidence`). So own-voice isolation reduces to: (a) never admit a
window overlapping a clone-speaking interval, and (b) admit only windows whose
ECAPA cosine to the owner's enrolled profile clears a floor. That is a
predicate over machinery we already run, not a new model. Adoption delta A3.

Note this is also a **consent** mechanism, not only a quality one: a second
person audible on the owner's side of the call has given no consent, and the
existing voice-consent scope is per-replica-owner (`MIRROR-CALL-SPEC.md`
§Consent scopes).

### 1.5 Streaming / low-latency voice conversion — surveyed, and rejected for v1

| project | license | latency / requirement | verdict |
|---|---|---|---|
| **StreamVC** (Google, arXiv:2401.03078) | paper only; **no official code**. Unofficial PyTorch ports: [yuval-reshef/StreamVC](https://github.com/yuval-reshef/StreamVC), [hrnoh24/stream-vc](https://github.com/hrnoh24/stream-vc) | ~20 M params, real-time on mobile per the paper/[poster](https://google-research.github.io/seanet/stream_vc/poster/streamvc_poster.pdf) | architecturally ideal, **no weights to run** — not adoptable |
| **seed-vc** ([Plachtaa/seed-vc](https://github.com/Plachtaa/seed-vc)) | **GPL-3.0 — copyleft** | 1–30 s reference; ~300 ms algorithm + ~100 ms device delay; tiny model 430 ms on RTX 3060 | **licence-disqualified** for an in-house-shipped stack, and the repo was **archived read-only 2025-11-21** — double disqualification |
| **RVC** ([RVC-Project/Retrieval-based-Voice-Conversion-WebUI](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI)) | **MIT** | trains a per-voice model from ≥10 min of low-noise speech; realtime WebUI | licence-clean, but it is a **train-a-model** path, i.e. the same shape as our queued LoRA lane, not a mid-call lever |
| **kNN-VC** ([bshall.github.io/knn-vc](https://bshall.github.io/knn-vc)) | license not stated in the material fetched — **[UNVERIFIED]** | needs ~5 min matching set; degrades below 30 s | the only architecture whose scaling law *rewards* accumulation (§1.2) — the interesting long-shot, see A7 |
| **LLVC** ([KoeAI/LLVC](https://github.com/KoeAI/LLVC)) | not checked — **[UNVERIFIED]** | low-latency CPU VC (arXiv:2311.00873) | **not evaluated this sweep** |

**Verdict:** none of these enters v1. Chatterbox stays primary
(`ROADMAP-100X.md` §Voice, unchanged by this sweep), and the streaming lane we
already have — [davidbrowne17/chatterbox-streaming](https://github.com/davidbrowne17/chatterbox-streaming),
**MIT**, README-reported **0.472 s to first chunk / RTF 0.499**, default 50
speech tokens per chunk — is the right seam. Those latency figures are a
single README run with no stated methodology: **[UNVERIFIED]**.

### 1.6 The queued fine-tune: adapters, or the second voice eats the first

`MIRROR-CALL-SPEC.md` correctly queues a fine-tune at call end. The continual-
learning literature names the failure mode of doing this repeatedly on one base
model: "sequential fine-tuning of a model for new speakers can lead to poor
performance of older speakers… catastrophic forgetting," degrading a
multi-speaker TTS into "a single-speaker TTS for the newly adapted speaker"
([Continual Speaker Adaptation for TTS, arXiv:2103.14512](https://arxiv.org/abs/2103.14512);
[APSIPA 2025 few-shot speaker adaptation](https://www.apsipa.org/proceedings/2025/papers/APSIPA2025_P304.pdf)) —
**[UNVERIFIED: both read at search-summary tier]**. The stated remedy is
adapter-based tuning, which "effectively resolves catastrophic forgetting and
maintains the speech quality of existing speakers."

This **corroborates** `ROADMAP-100X.md`'s existing "per-expert LoRA" decision
from a direction that decision did not cite, and adds one binding constraint it
does not state: **one adapter per expert, composed at load time; never a
sequence of fine-tunes on a shared base.** Adoption delta A6.

---

## 2. Online persona / style learning from conversation

### 2.1 CIPHER / PRELUDE — the closest published match to what the Mirror Call does

**This is the single most transferable result in the sweep.**
*Aligning LLM Agents by Learning Latent Preference from User Edits* (Gao et al.,
NeurIPS 2024, arXiv:2404.15269;
[openreview](https://openreview.net/forum?id=DlYNGpCuwa)).

Mechanism: when a user's edit to the agent's output exceeds a tolerance
threshold δ, an LLM **induces a natural-language description of the latent
preference** the edit implies. At generation time, CIPHER **retrieves the
induced preferences from the k nearest historical contexts** (cosine
similarity, k ∈ {1,5}, k=5 better) and aggregates them into the prompt.

Results (Table 2, cumulative edit distance; lower is better), from
[arxiv.org/html/2404.15269v1](https://arxiv.org/html/2404.15269v1):

| method | summarization | email writing |
|---|---|---|
| Oracle preference (ceiling) | 6,573 | 1,851 |
| **No learning** | 48,269 | 31,103 |
| E-then-e LPI (learn once, then apply) | 65,218 | 24,562 |
| **Continual LPI (one rolling global preference)** | 57,915 | 26,852 |
| ICL-edit-5-BERT (show the raw edits) | 39,734 | 30,949 |
| **CIPHER-5 (retrieved induced preferences)** | **32,974** | **8,391** |

Stated reductions vs no-learning: **31%** (summarization) and **73%** (email).

Four things fall out of this table that bear directly on the Mirror Call:

1. **Induced *descriptions* beat raw edits.** CIPHER beat ICL-edit on both
   tasks. Feeding the model "here is what you said and here is what I'd have
   said" is measurably weaker than mining the *rule* behind the correction.
   This is the same thing our own `recited-prompt` law says from the other
   side — a corrected line in the prompt is a sentence-shaped object and gets
   recited; a described shape does not.
2. **A single rolling global preference is worse than retrieval — and on one
   task worse than not learning at all.** Continual LPI (57,915) and E-then-e
   LPI (65,218) both *lost to no-learning* (48,269) on summarization. That is
   published evidence for the persona-collapse pitfall in §4.3: continuously
   overwriting one global style description degrades the agent. **Context-keyed
   deltas, not a monotonically-rewritten sheet.**
3. **The learned object is human-readable and human-editable** by design — the
   paper's stated advantage over fine-tuning is that "learning descriptive
   preference improves interpretability, allowing users to view and modify the
   learned preference." That is *literally* our never-silent-update law,
   arrived at independently, and it means our approval requirement is not a
   tax on the technique — it is the technique.
4. **The gap to oracle stays large** ("significant gaps to the oracle method
   remain, especially in the summarization task"), with named failure
   categories: preference inference, preference consolidation, retrieval
   accuracy. Set expectations accordingly.

Verdict against our laws: **shapes-not-lines — passes** (induces descriptions,
not quotable lines). **Position-is-mechanism — orthogonal**, and it tells us
where to put the retrieved deltas (see A5). **Never-silent-update — passes,
natively.**

### 2.2 Self-improving loops: reflection needs an external signal, and the Mirror Call has one

- **Reflexion** (Shinn et al., NeurIPS 2023, arXiv:2303.11366;
  [github.com/noahshinn/reflexion](https://github.com/noahshinn/reflexion)):
  agents verbally reflect on task feedback and keep reflections in an episodic
  buffer; 91% pass@1 on HumanEval vs 80% for the GPT-4 baseline of the time.
  Crucially, Reflexion is defined over feedback that is *external or simulated*
  — it is not self-critique in a vacuum. Repo license **not confirmed this
  sweep — [UNVERIFIED]**.
- **The negative result that bounds it:** *Large Language Models Cannot
  Self-Correct Reasoning Yet* (Huang et al., ICLR 2024, arXiv:2310.01798) —
  without external feedback, LLMs "struggle to self-correct their responses…
  and at times, their performance even degrades after self-correction."

**Read together, these say the Mirror Call's architecture is the right one and
its cheap variant is not.** The owner on the line *is* the external feedback
signal; a background "the clone critiques its own turns and updates the sheet"
loop between calls is precisely the configuration Huang et al. shows can make
things worse. **Do not build the unattended self-critique lane.**

### 2.3 Persona vectors / steering — correct idea, wrong stack for us

*Persona Vectors: Monitoring and Controlling Character Traits in Language
Models* (arXiv:2507.21509): directions in activation space corresponding to
traits; projecting activations onto them **predicts persona shift before and
during finetuning**; "preventative steering" controls traits during training.
Anthropic released code.
[arxiv.org/pdf/2507.21509](https://arxiv.org/pdf/2507.21509),
[VentureBeat coverage](https://venturebeat.com/ai/new-persona-vectors-from-anthropic-let-you-decode-and-direct-an-llms-personality).

**Requires activation access / open weights — it cannot be applied to a
black-box API.** This exactly re-derives the flag already recorded in
`research/relationalos-100x.md` §2 for Meera on hosted Gemini. It is listed
here only so that a future session does not re-discover it a third time: **if
and when the clone's brain moves to self-hosted open weights, persona vectors
become the drift monitor we currently cannot have** — and that is the single
strongest argument on the table for an in-house brain, not just an in-house
voice.

### 2.4 Preference learning from in-call feedback: KTO, not DPO

Our feedback shape is a per-turn 👍/👎 plus occasional "I'd say it like this."
The production-DPO literature names why DPO is the wrong fit for that shape:
"a thumbs-down only gives you a rejected response, but for DPO you need a
corresponding preferred response," and production feedback is
"unpaired… noisy, sparsely labelled, and biased toward easy cases."
**Kahneman-Tversky Optimization (KTO)** "drops the requirement for paired
preferences entirely and instead takes individual examples labeled as
desirable or undesirable." Sources are practitioner-tier, not primary:
[futureagi.com](https://futureagi.com/blog/llm-eval-vs-rlhf-feedback-2026/),
[Medium — DPO Isn't Enough](https://medium.com/@fahey_james/dpo-isnt-enough-the-modern-post-training-stack-simpo-orpo-kto-and-beyond-d82e52a1ee6c)
— **[UNVERIFIED: no primary KTO paper fetched this sweep]**.

At our scale the honest recommendation is stronger than "use KTO": **do not run
gradient-based preference learning from Mirror Call feedback at all in v1.**
One call yields tens of judgements. CIPHER's result (§2.1) is that a
prompt-level, retrieval-keyed, human-readable preference store gets 31–73% of
the available win with **zero training**, full auditability, and instant
reversibility. Record the 👎 events in a shape that *could* feed KTO later
(unpaired desirable/undesirable with the turn cited) and leave it at that.
The `I'd say it like this` re-record is the high-value item — it is a **user
edit**, the exact signal CIPHER consumes.

### 2.5 Style capture from small transcripts — there is a hard floor, and one Mirror Call is under it

Stylometry has measured minimum-sample thresholds. Eder's systematic
experiments put the floor at **≥5,000 running words** for attributable samples;
other results place it as low as **~2,000 words**; samples **under 3,000 words
produced over 60% false-attribution rates**, and 2,500+ words is where 85–95%
accuracy is reported for closed-candidate-set attribution.
[Eder, "Does size matter?", DH2010](https://dh2010.cch.kcl.ac.uk/academic-programme/abstracts/papers/pdf/ab-744.pdf);
[Eder, "Short Samples in Authorship Attribution", DH2017](https://dh2017.adho.org/abstracts/341/341.pdf) —
**[UNVERIFIED: both PDFs failed to decode through the fetch tool; figures are
at search-summary tier and must be re-read before being quoted to the owner]**.

Our own arithmetic (marked as ours, not a citation): conversational speech runs
~120–150 wpm, and in a two-party call the owner holds roughly half the floor.
A **30-minute Mirror Call therefore yields ~1,800–2,300 owner words** — *below
every threshold above*. A single call is not enough text to make a reliable
idiolect claim.

This does not kill the personality loop; it disciplines it. It says: (i) phrase
habits mined from one call are **hypotheses to show the owner**, which is
exactly what a delta chip is — the architecture is already honest; (ii) the
chip stream must **display the evidence count** ("3 times in 18 minutes"), not
just the claim; (iii) confidence must **accumulate across calls**, so the
persistent object is a per-owner corpus with a word counter, not a per-call
mine. Adoption delta A4.

It also gives the negative control its shape: a chip proposed off n=1
occurrence in 400 words should be visibly weaker than one off n=9 across three
calls, and if the UI cannot tell them apart the loop is manufacturing
confidence it does not have.

### 2.6 Open-source digital twins worth reading, none worth vendoring

- **WeClone** ([github.com/xming521/WeClone](https://github.com/xming521/WeClone))
  — the leading "AI twin from your chat history" project. **AGPL-3.0 —
  strong copyleft, disqualifying for our in-house shipped stack**; ideas only.
  Pipeline: export → preprocess → LoRA fine-tune → bind to a chatbot; default
  base Qwen2.5-VL-7B-Instruct via LLaMA-Factory; recommends ≥14B for quality.
  **No quantitative evaluation at all** — the README says "current performance
  does not represent final results." The genuinely stealable part is the
  **privacy stage**: Microsoft Presidio auto-filters phone numbers, emails,
  credit cards, IPs, plus a manual `blocked_words` list, with the README's own
  caveat that detection "cannot guarantee 100% identification." A Mirror Call
  mines a live transcript; a PII scrub before anything is written to a
  TeacherSheet is cheap and obviously right. Adoption delta A4 (bundled).
- **CloneLLM** ([github.com/msamsami/clonellm](https://github.com/msamsami/clonellm))
  — RAG-over-your-own-data clone, no fine-tune. License **not verified this
  sweep — [UNVERIFIED]**. Noted for completeness; nothing found that our
  memory graph does not already do better.

---

## 3. Human-in-the-loop calibration UX — what measurably works

The relevant prior art is not "AI UX" but two decades of **interactive machine
learning** and **learning-from-demonstration** HCI.

- **Ask about features, not labels.** Cakmak & Thomaz, *Designing Robot
  Learners that Ask Good Questions* (HRI 2012), classify a learner's questions
  into **label**, **demonstration**, and **feature** queries and find **feature
  queries were preferred, with 72% of participants calling them the smartest
  questions**; the same line of work found that "people do not enjoy a constant
  stream of questions."
  [Cakmak & Thomaz, HRI 2012](https://sites.cc.gatech.edu/social-machines/papers/cakmak12_hri_active.pdf);
  [ACM DL](https://dl.acm.org/doi/10.1145/2157689.2157693) —
  **[UNVERIFIED: PDF failed to decode; the 72% figure is at search-summary
  tier and should be re-read before being quoted as a number]**.

  This maps onto our delta chips with unusual precision. "You say 'basically' a
  lot — add to phrase habits?" is a **feature query** — the preferred kind.
  "Was that turn good? 👍/👎" is a **label query** — the least-liked kind. The
  spec currently gives both equal billing. **Weight the rail toward feature
  chips; keep 👍/👎 as an always-available but unprompted affordance, never as
  a thing the clone asks for.** Adoption delta A5.
- **Query frequency is a design parameter with a cost.** The same literature's
  "people do not enjoy a constant stream of questions" is the direct argument
  for a **chip budget** — a cap on proposals per minute, with the surplus
  falling to the post-call review queue, which the spec already has as the
  landing place for un-actioned chips.
- **HITL training interfaces have published guidelines**: *Towards Guidelines
  for Designing Human-in-the-Loop Machine Training Interfaces* (IUI 2021)
  proposes scoring an interactive learner by combining technical performance
  **and** user interaction into a single metric.
  [dl.acm.org/doi/10.1145/3397481.3450668](https://dl.acm.org/doi/10.1145/3397481.3450668).
  Also *Power to the People: The Role of Humans in Interactive Machine
  Learning* (Amershi, Cakmak, Knox, Kulesza, AI Magazine 2014) —
  [ojs.aaai.org](https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/2513) —
  the canonical statement that users want to give richer feedback than the
  labels the algorithm asks for. Both **[UNVERIFIED beyond abstract/summary
  tier]**.
- **Show the learned object, let them edit it.** CIPHER's interpretability
  argument (§2.1) is the measured version of this: the learned preference is a
  sentence the user can read and change. Our sheet already is that; the Mirror
  Call should show the **diff**, not just the chip.

---

## 4. Continual-learning pitfalls, and the gates to catch each

### 4.1 Catastrophic forgetting, at both levels
- **Model level (voice):** §1.6 — sequential per-speaker fine-tuning collapses
  a multi-speaker model toward the last speaker. Mitigation: adapters/LoRA,
  one per expert. Gate: the fidelity floor of a *previously* fine-tuned voice
  must be re-measured after any new voice's fine-tune lands.
- **Prompt level (persona):** the sheet is a finite budget and truncation eats
  the end of it (`scripts/check-prompt-budget.mjs`, and the crisis-helpline
  incident that caused it). Accepted deltas *accumulate*; there is no natural
  eviction. **A Mirror Call is a machine for growing the persona prompt, and
  nothing in the current spec bounds that growth.** Gate: the prompt-budget
  check must run against a **post-Mirror-Call sheet**, with a stated eviction
  policy, before the delta lane ships.

### 4.2 Recursive self-training / model collapse
Shumailov et al., *AI models collapse when trained on recursively generated
data*, **Nature 631, 755–759 (2024)**: training on model-generated content
causes "irreversible defects… tails of the original content distribution
disappear," with early collapse (distributional drift) and late collapse
(low-frequency events permanently gone); the stated remedies are **periodic
injection of fresh human data** and **serious filtering of AI-generated data**.
[nature.com/articles/s41586-024-07566-y](https://www.nature.com/articles/s41586-024-07566-y);
[PubMed](https://pubmed.ncbi.nlm.nih.gov/39048682/). A critical note exists and
should be read alongside it:
[arXiv:2410.12954](https://arxiv.org/abs/2410.12954) — **[UNVERIFIED, not read
this sweep]**.

**The Mirror Call has two live channels for exactly this**, and both are cheap
to close: the clone's synthesised audio entering the reference set (§1.4), and
the clone's own transcribed turns entering the personality miner. **Mine only
owner turns; embed only owner windows.** This must be a *negative control in
the eval*, not a comment — the spec already demands a negative control proving
an unapproved delta never lands; it needs a sibling proving a clone turn never
enters either learning path.

### 4.3 The persona collapsing to the last session's mood
Two independent supports:
- **Measured, and ours by analogy:** CIPHER's Continual-LPI arm — one rolling,
  continuously-overwritten preference description — **lost to doing nothing**
  on summarization (57,915 vs 48,269 cumulative edit distance, §2.1).
- **Measured, external:** persona drift grows with conversation length, and
  periodic anchor re-prompting mitigates it (already logged in
  `research/relationalos-100x.md` §2, citing arXiv:2412.00804 / 2605.24279).

Mitigation to gate on: deltas are **additive and context-keyed with citations
to the turns that produced them**, never a wholesale rewrite of a sheet field;
and a delta accepted in one call must not be able to silently invert a delta
accepted in a previous one. A **contradiction check between an incoming delta
and the standing sheet, surfaced to the owner as a conflict chip rather than
resolved automatically**, is the honest shape — and it composes with the
bi-temporal validity machinery WS-O already shipped
(`context/decisions.md#bitemporal-fact-edges`).

### 4.4 Sycophancy — the feedback loop that makes a clone agreeable rather than accurate
RLHF-style optimization for human approval "systematically degrades
truthfulness"; preference models themselves favour sycophantic responses,
creating a loop where "agreement is good" is internalised (Sharma et al. 2023
and the follow-on literature;
[How RLHF Amplifies Sycophancy, arXiv:2602.01002](https://arxiv.org/html/2602.01002v1);
[Sycophancy Claims about Language Models, OpenReview](https://openreview.net/pdf?id=XePNb7JiUi)) —
**[UNVERIFIED: read at search-summary tier]**.

The Mirror Call's version is specific and nasty: **the owner is judging a clone
of themselves.** A 👍 rewards "sounds like me *as I would like to sound*," not
"sounds like me." Left alone, iterated Mirror Calls drift the clone toward the
owner's self-image and away from the owner's actual idiolect — and the
statistical miner, which reads what was actually *said*, is the only thing in
the loop that pulls the other way. **Keep the two signals separate in the data
model** (mined-from-behaviour vs accepted-from-judgement) so this divergence is
*measurable* rather than silently averaged. Adoption delta A4 (bundled).
This is also why `research/relationalos-100x.md`'s open item #8 (sycophancy
audit) stops being a nice-to-have once the Mirror Call ships.

### 4.5 Evaluation drift
- **Context rot:** Chroma's 2025 study of 18 frontier models finds performance
  degrades as input length grows, well before the context window is full —
  "a model with a 200K token window can exhibit significant degradation at 50K
  tokens." [trychroma.com/research/context-rot](https://www.trychroma.com/research/context-rot),
  [github.com/chroma-core/context-rot](https://github.com/chroma-core/context-rot) —
  **[UNVERIFIED: read at search-summary tier, not fetched]**. A Mirror Call
  grows both the transcript and the sheet; a delta that helps at turn 5 may be
  invisible at turn 60 for reasons that have nothing to do with the delta.
  Any before/after comparison must hold turn index fixed.
- **Judging the learner with the learner's own material** is the classic drift:
  if accepted deltas enter the sheet *and* the eval prompts, the eval measures
  compliance, not fidelity. Hold out a fixed probe set that no Mirror Call can
  write to.

---

## 5. Judgment — what we adopt, what we reject, what we measure first

Keyed to the build seams in `MIRROR-CALL-SPEC.md` §Build shape (WS-X) and the
fine-tune lane (WS-U / WS-Y).

### Adopt

1. **Reference *selection*, not reference accumulation, as the voice loop's
   mechanism** (§1.1). Keep a rolling candidate pool of owner-only windows;
   pick the conditioning window per clone turn; cache it as a Chatterbox
   `Conditionals` blob. Seam: `api/mirror-call.js` reference lane + the
   admission broker's synthesis call.
2. **CIPHER's shape for the personality/feedback loops** (§2.1): induce a
   *described* preference from a correction, key it to context, retrieve k=5
   at generation, keep it human-readable and editable. Seam: delta mining in
   `api/_teachersheet.js`'s statistical pass + the delta-chip queue.
3. **Feature-query-first chip rail** (§3): the rail proposes properties, not
   verdicts; 👍/👎 stays available but unrequested; a per-minute chip budget
   with overflow to the existing post-call review queue.
4. **Owner-only admission as a hard predicate on both learning paths** (§1.4,
   §4.2), with a negative control in the eval proving a clone turn can enter
   neither the reference set nor the miner.
5. **Adapters/LoRA per expert, never sequential fine-tunes on a shared base**
   (§1.6), with a regression check on a previously-cloned voice after each new
   fine-tune lands.
6. **Evidence counts on every chip, and a per-owner accumulating word counter**
   (§2.5), because one call is below every published stylometric floor.
7. **PII scrub (Presidio-shaped) before any mined text reaches a sheet**
   (§2.6).

### Reject, with reasons

- **Mid-call fine-tuning of any kind** — already rejected in the spec; §1.6 and
  §4.1 add that even *between-call* sequential fine-tuning on a shared base is
  a forgetting hazard.
- **An unattended self-critique loop** where the clone improves its own sheet
  between calls — Huang et al. (arXiv:2310.01798) shows self-correction without
  external feedback can *degrade* performance (§2.2). The owner is the external
  signal; without them the loop should not run.
- **DPO/RLHF on Mirror Call feedback in v1** (§2.4) — wrong data shape
  (unpaired), wrong scale (tens of judgements), and it destroys the
  auditability that our never-silent-update law exists to protect. Log the
  events in a KTO-compatible shape and stop.
- **seed-vc (GPL-3.0, archived)** and **WeClone (AGPL-3.0)** as code — licence
  incompatible with an in-house shipped stack. WeClone's Presidio stage is an
  *idea* we adopt, not code we import.
- **Denoising/enhancing accumulated call audio before it becomes reference** —
  the one primary measurement we found says enhancement *raised* UTMOS/DNSMOS
  and *lowered* SECS (0.35 → 0.28) (§1.3). Select clean windows; do not clean
  dirty ones.
- **Persona vectors / activation steering** — requires open weights and
  activation access we do not have (§2.3). Re-open if the brain moves
  in-house.
- **Multi-reference conditioning (MRMI-TTS-style)** — does not compose with
  Chatterbox's single-`audio_prompt_path` API without model surgery, which the
  audio-floor law puts out of scope.

### Measure first (in this order, cheapest and most decision-relevant first)

1. **The truncation experiment.** Synthesise the same held-out line from the
   owner's 71 s reference (a) as-is, (b) truncated to the first 10 s, (c) from
   three *different* 10 s windows of the same recording. Score ECAPA against
   the 0.8869 ceiling. **Predicted by §1.1: (a) ≈ (b), and the spread across
   (c) is larger than the difference between (a) and (b).** If that prediction
   holds, adoption delta A1 is proven and the spec's voice-loop paragraph must
   be rewritten. **This costs one GPU-warm session and no new code.**
2. **The selection ceiling.** Over N windows from one call, what is the ECAPA
   spread between the best and worst 10 s window, and how much of the
   0.7753 → 0.8869 gap does best-window selection recover? This is the number
   that decides whether the voice loop is worth building at all.
3. **Words-per-Mirror-Call, measured not estimated** (§2.5) — count owner words
   in a real 20–30 min calibration call and put it against the 2,000/3,000/5,000
   stylometric thresholds.
4. **Delta acceptance rate by chip type** (feature vs label vs correction),
   which is our own version of the Cakmak & Thomaz result and the cheapest way
   to know whether the rail is helping or nagging.
5. **Post-Mirror-Call prompt budget** — assembled sheet size after 1, 5 and 20
   accepted deltas, against the cap (§4.1).

---

## 6. Adoption deltas for `MIRROR-CALL-SPEC.md`

Seven changes to the build shape, highest leverage first. Each states expected
evidence and cost.

| # | Delta | Why | Expected evidence | Cost |
|---|---|---|---|---|
| **A1** | Rewrite the voice loop from "accumulate → re-embed → richer reference" to **"accumulate → select the best conditioning window → cache as `Conditionals`"** | Chatterbox truncates the reference to 10 s (s3gen) / 6 s (T3) in `prepare_conditionals`; accumulation past that is mechanically inert (§1.1) | Measurement 1: full-71 s ≈ first-10 s ECAPA, while different 10 s windows differ more | Low — a selection predicate and a cache; no model change, no `liveCall.ts` touch |
| **A2** | **Split the fidelity meter into two labelled numbers**: "how well we can measure you" (grows with accumulated audio) vs "what the next turn will synthesise from" (the selected window) | The ECAPA estimate improves with the pool while synthesis cannot; one number showing motion the clone cannot have is a fidelity-honesty violation of the same family as `disclosure-announces-the-clone` (§1.1) | The two numbers diverge on any real call; a single meter would have hidden it | Low — UI + one extra scored quantity |
| **A3** | **Own-voice admission predicate** on both learning paths: no window overlapping a clone-speaking interval; ECAPA-to-enrolled-profile floor; a second speaker's audio never admitted | Recursive-training collapse (Nature 2024, §4.2) plus consent — a third party on the owner's side consented to nothing (§1.4) | A negative control in the eval: a synthesised clone turn and a foreign speaker each fail admission | Low — we already hold turn boundaries and the owner's embedding |
| **A4** | **Every chip carries its evidence count**; confidence accumulates in a per-owner corpus with a word counter; mined-from-behaviour and accepted-from-judgement stay separate columns; PII scrub before any write | One call is below every stylometric floor (2,000–5,000 words; <3,000 → >60% false attribution, §2.5); and separating the two signals is what makes owner-sycophancy drift measurable rather than silently averaged (§4.4) | Chips at n=1/400 words are visibly weaker than n=9/3 calls; the two columns diverge and the divergence is inspectable | Low-medium — schema + UI; Presidio-shaped scrub is a library call |
| **A5** | **Rail weighted to feature queries**, with a per-minute chip budget and overflow to the review queue; deltas land as *described shapes* keyed to context and retrieved (CIPHER k=5), appended in the position the persona laws require | Feature queries preferred (72% "smartest") and constant questioning disliked (§3); induced descriptions beat raw edits, and a single rolling global preference lost to no-learning (§2.1) | Acceptance rate by chip type; no recitation of any corrected line in the following turns | Medium — the retrieval keying is real work |
| **A6** | State the fine-tune lane as **one adapter per expert, composed at load**, and add a regression re-measure of a previously fine-tuned voice after each new one lands | Sequential per-speaker fine-tuning collapses toward the newest speaker (§1.6) | Voice A's ECAPA floor does not move when voice B is fine-tuned | Low as a spec/gate change; the lane is WS-U's anyway |
| **A7** | Add a **named long-shot**: kNN-VC-family retrieval VC is the one architecture whose scaling law rewards accumulation (5 min knee, 30 s floor) — record it as the thing to re-evaluate if selection (A1) fails to close the gap, **not** as v1 work | §1.2 — the conflict between prompt-conditioned and matching-set scaling is structural, and if the selection ceiling in Measurement 2 is low, the architecture is the constraint | Measurement 2 returns a small best-vs-worst spread and a small recovered fraction | Zero now; a spec paragraph |

---

## 7. Open items this sweep did not close

- The **numeric tables** behind Voicebox Fig. 6, kNN-VC Fig. 2, Cakmak &
  Thomaz's ratings, and Eder's sample-size curves — all four PDFs failed to
  decode through the fetch tool. Quotes are verified; **numbers from those four
  are at search-summary tier and must not be quoted to the owner as settled**.
- **kNN-VC's license** was not established.
- **LLVC** ([KoeAI/LLVC](https://github.com/KoeAI/LLVC), arXiv:2311.00873) and
  **SynthVC** (arXiv:2510.09245) were not evaluated at all.
- **No primary KTO paper** was fetched; the DPO-vs-KTO argument rests on
  practitioner sources.
- **Enrollment augmentation for target-speaker extraction**
  ([arXiv:2409.09589](https://arxiv.org/pdf/2409.09589)) — identified, not read.
- **The critical note on Shumailov et al.** ([arXiv:2410.12954](https://arxiv.org/abs/2410.12954))
  — the model-collapse result has a published critique; we cite the Nature
  paper without having read the rebuttal.
- **Nothing was found that measures a Mirror-Call-shaped loop end to end.** No
  paper in this sweep evaluates "a person calibrating a clone of themselves in
  real time." The nearest neighbours are CIPHER (text edits, simulated user)
  and the HRI active-learning line (robots, not clones). **We are past the
  literature here, which means the measurements in §5 are not optional —
  they are the only evidence that will exist.**

---

## Sources index

Primary, fetched and verified this sweep:
- [resemble-ai/chatterbox `mtl_tts.py`](https://raw.githubusercontent.com/resemble-ai/chatterbox/master/src/chatterbox/mtl_tts.py) — the 10 s / 6 s truncation constants
- [resemble-ai/chatterbox `s3gen.py`](https://raw.githubusercontent.com/resemble-ai/chatterbox/master/src/chatterbox/models/s3gen/s3gen.py) — the >10 s warning
- [resemble-ai/chatterbox README](https://github.com/resemble-ai/chatterbox) — MIT, single `audio_prompt_path`
- [davidbrowne17/chatterbox-streaming](https://github.com/davidbrowne17/chatterbox-streaming) — MIT, 0.472 s first chunk
- [Plachtaa/seed-vc](https://github.com/Plachtaa/seed-vc) — GPL-3.0, archived 2025-11-21
- [xming521/WeClone](https://github.com/xming521/WeClone) — AGPL-3.0, Presidio PII stage
- [CIPHER / PRELUDE, arXiv:2404.15269](https://arxiv.org/html/2404.15269v1) — Table 2, 31% / 73%
- [BSC Wildspoof 2026, arXiv:2602.05770](https://arxiv.org/html/2602.05770) — SECS 0.35 vs 0.24; enhancement lowers SECS
- [Voicebox, arXiv:2306.15687 via ar5iv](https://ar5iv.labs.arxiv.org/html/2306.15687) — "SIM-r grows quickly and flattens"
- [kNN-VC, arXiv:2305.18975 via ar5iv](https://ar5iv.labs.arxiv.org/html/2305.18975) — 5 min ≈ 8 min; <30 s degrades
- [Persona Vectors, arXiv:2507.21509](https://arxiv.org/pdf/2507.21509) — requires activations/open weights

Cited at abstract or search-summary tier (flagged inline):
- [LLMs Cannot Self-Correct Reasoning Yet, arXiv:2310.01798](https://arxiv.org/abs/2310.01798)
- [Reflexion, arXiv:2303.11366](https://arxiv.org/abs/2303.11366) / [repo](https://github.com/noahshinn/reflexion)
- [Shumailov et al., Nature 631, 755–759 (2024)](https://www.nature.com/articles/s41586-024-07566-y) and its [critique, arXiv:2410.12954](https://arxiv.org/abs/2410.12954)
- [How RLHF Amplifies Sycophancy, arXiv:2602.01002](https://arxiv.org/html/2602.01002v1); [Sycophancy Claims about LMs](https://openreview.net/pdf?id=XePNb7JiUi)
- [Chroma, Context Rot](https://www.trychroma.com/research/context-rot) / [repo](https://github.com/chroma-core/context-rot)
- [Cakmak & Thomaz, HRI 2012](https://sites.cc.gatech.edu/social-machines/papers/cakmak12_hri_active.pdf) / [ACM DL](https://dl.acm.org/doi/10.1145/2157689.2157693)
- [Amershi et al., Power to the People, AI Magazine 2014](https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/2513)
- [HITL Machine Training Interfaces, IUI 2021](https://dl.acm.org/doi/10.1145/3397481.3450668)
- [Eder, DH2010](https://dh2010.cch.kcl.ac.uk/academic-programme/abstracts/papers/pdf/ab-744.pdf) / [DH2017](https://dh2017.adho.org/abstracts/341/341.pdf)
- [Continual Speaker Adaptation for TTS, arXiv:2103.14512](https://arxiv.org/abs/2103.14512); [APSIPA 2025](https://www.apsipa.org/proceedings/2025/papers/APSIPA2025_P304.pdf)
- [MRMI-TTS, ACM TALLIP](https://dl.acm.org/doi/10.1145/3649501) — HTTP 403, summary only
- [NPU-HWC, arXiv:2410.23815](https://arxiv.org/pdf/2410.23815); [enrollment augmentation, arXiv:2409.09589](https://arxiv.org/pdf/2409.09589)
- [StreamVC, arXiv:2401.03078](https://arxiv.org/pdf/2401.03078) / [unofficial impl.](https://github.com/yuval-reshef/StreamVC); [RVC (MIT)](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI); [LLVC](https://github.com/KoeAI/LLVC)
- [target speaker extraction, arXiv:2502.16611](https://arxiv.org/pdf/2502.16611); [NeMo diarization docs](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/speaker_diarization/intro.html)
- [msamsami/clonellm](https://github.com/msamsami/clonellm) — license unverified
- KTO-vs-DPO practitioner sources: [futureagi.com](https://futureagi.com/blog/llm-eval-vs-rlhf-feedback-2026/), [Medium](https://medium.com/@fahey_james/dpo-isnt-enough-the-modern-post-training-stack-simpo-orpo-kto-and-beyond-d82e52a1ee6c)
