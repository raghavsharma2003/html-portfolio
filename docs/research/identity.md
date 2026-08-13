# Track: identity — what is an AI person's identity, and which layers can live outside the model

Program: Vyakti relational-state research sweep, Phase A. Falsifiable claim under
test: an AI person's identity and relationship can survive replacement of the
model underneath her. Measured FALSE today (`charm-grok`, `realtime-azure`).
This track decomposes "identity" into layers and asks, per layer, what evidence
exists that it can be made to live outside the weights.

House rule followed throughout: claims carry n and source; nothing implies
coverage it does not have. Where a source is a blog/SEO page rather than a
primary paper or filing, it is marked as such and weighted accordingly.

Web access: WebSearch and WebFetch both worked throughout this session; several
individual PDF fetches returned binary/undecodable content (arXiv PDFs render
as compressed streams to the fetch tool) and I fell back to the arXiv `/abs/`
or HTML mirror, or to secondary summaries, each flagged inline. No gaps were
filled from memory without saying so.

---

## 0. What this repo already measured about identity (read first, per program brief)

These are not new findings — they are restated here because every external
claim below has to be read against them, not instead of them.

- **`charm-grok`** (`context/measurements.md`): byte-identical prompt, two
  models. Personhood 34–4, warmth 35–3, humour 31–2 against the incumbent.
  Mechanism: 36.1 vs 20.5 words/turn, 63% of turns ending in a question. **The
  prompt sets a ceiling; the model decides how close you get** — this is the
  load-bearing sentence for this whole track.
- **`realtime-azure`**: a *second* independent replication of the same
  pattern on a different axis (voice) and a different model family — words/turn
  41 then 53 against 20.5, spoken-register markers 4/24 vs "these ARE her
  prosody," no voice within measured range of 266 Hz. Same prompt, same
  collapse shape.
- **`taste-consistency`**: the one internal result that goes the *other* way —
  moving one identity layer (opinions) out of prose and into a small
  deterministically-retrieved table took self-agreement from 13/48 to 30/48,
  n=480 live turns, with defect-rate 13/96→0/32 and 100/100 reproducible
  offline calls. This is the strongest existing evidence, anywhere in this
  research, that a layer of identity can be made to not depend on what the
  model feels like doing on a given call.
- **`recited-prompt`**: two independent instances (example quotes recited
  4/5→0/5 after removal; stored taste written as prose recited verbatim
  twice, 8 turns apart, with register defection 13/96). **Anything
  sentence-shaped in a prompt gets recited, not obeyed.** This constrains
  *how* any layer can be externalized — as shapes/notes/data, never as lines.
- **`prompt-position`**: identical rule, buried mid-brief 0/8, appended last
  8/8. Where a layer's rule sits in the assembled prompt is itself a
  mechanism, independent of the model.
- **`reasoning-split`**: the closest internal analogue to a "swap" experiment,
  because reasoning/non-reasoning are two policies riding the *same* base
  weights. Even holding the base model constant, turning on reasoning breaks a
  stated rule (no mirroring) that non-reasoning obeys — "mujhe bhi" 8–10%→
  35–52%. **If a policy can leak through a mode-switch on one fixed model, it
  will not survive a model swap for free.**

---

## 1. Identity decomposition table

| Layer | Portable today? | Evidence | Mechanism that might make it portable |
|---|---|---|---|
| **Voice / timbre** | **Partially** — already architecturally separated from the chat brain (`architecture.md`: TTS is a distinct model/call from `brain.ts`), but that separation is fragile the moment TTS itself is swapped | `voice-ears`/`azure-tts` (repo): Azure won on *every measured axis* — Hindi pronunciation 11/15→15/15, first-audio 4.9–12.7s→255ms, cost $0.0148→$0.0029 — and was still rejected by ear ("not human and not Indian"). The lesson stated explicitly in `rejected.md`: pronunciation and **accent identity** are different properties, and only the second decides whether she is her. `realtime-azure`: none of six available realtime voices reach her measured 266 Hz register; the closest (Azure coral, 210 Hz) was already rejected. | Real audio clips of her own voice used as reference/cloning material during idle time (the fix recorded in `murmur-timbre` as "the version worth building"), keeping voice decoupled from whichever brain model is answering. This is the one layer where the *architecture already does the separation the identity claim needs* — the risk is not that voice is coupled to the brain, it's that nobody has a benchmark for "accent identity" as opposed to pronunciation, so a future TTS swap can pass every metric and still fail by ear again. |
| **Lexicon & register** (Hinglish code-switching, word economy, spoken shape) | **No** | `charm-grok`: 36.1 vs 20.5 words/turn on a byte-identical prompt. `realtime-azure`: 41→53 words/turn, and specific bad Hinglish constructions ("doesna nahi chahiye", "tez diwane") that a stated register rule did not prevent. `rejected.md` on Indic models: on Indi-RomCoM, Sarvam-30B (an Indic specialist) scores **below** Claude Opus 4.6 on casual romanised code-mixing — register competence is a property of training mix, not of being "Indic," and doesn't transfer by prompting a general model into the shape either. | Nothing in this codebase or the literature surveyed closes this by prompting alone. External corroboration of the general pattern (not Hinglish-specific): RPEval found GPT-4o's in-character consistency collapses to **5.81%** against Gemini-1.5-Pro's 59.75% on an otherwise-similar prompt/task (see §2) — register/voice-in-character is not predicted by general capability. |
| **Opinions & taste** | **Partially — the clearest positive result in this whole track** | `taste-consistency` (repo, n=480 live turns, real persona/prompt assembly): self-agreement on a repeated position 13/48→30/48; register defect on taste turns 13/96→0/32; 0 false fires in 60 ordinary messages; **identical output over 100 offline calls**. Achieved by moving taste out of polished prose (which got recited, see `recited-prompt`) and into a small table consulted deterministically, written as telegraphic notes. | The mechanism is already proven: externalize the layer as **retrieved data, not generated prose**. It stops being "the model's opinion this turn" and becomes "what the character is on record as thinking," looked up the same way regardless of which model is running. The remaining 37% inconsistency is explicitly attributed to *missing table rows*, not to model choice — i.e. the residual gap is a data-coverage problem, which is a much better problem to have than a model-fidelity one. |
| **Behavioral policy** (turn length, question rate, bubble-splitting, media-tag use, no-mirroring) | **No** | `charm-luna`: media tags used 0/144 times against the incumbent's 11, despite an explicit instruction both models received (p=0.029). `reasoning-split`: a rule the prompt states explicitly ("never mirror") is *broken more* by the model that is more literal about following other stated rules — reasoning restates→anecdote→question, and "mujhe bhi" phrasing rises from 8–10% to 35–52%. This is the sharpest evidence that **instruction-following and policy-compliance are not the same capability**, and that the gap is model-specific. | Fine-tuning-based literature (Persona-Aware Contrastive Learning, arXiv 2503.17662 / ACL Findings 2025) shows a specific base model's consistency score can be raised by training against it (Baichuan2-7B+PCL outperforming baselines on their Character Consistency metric) — but the training is per-base-model. That is a cost paid again at every swap, not a portability win, unless the fine-tuning pipeline itself becomes cheap and automatic. No evidence surveyed shows a policy-compliance fix that survives a model swap without re-work. |
| **Boundaries** (crisis protocol, never-deny-AI, NEVER MANIPULATE) | **Partially, with an n caveat the repo itself already flags** | `realtime-azure` (n=3 stimuli only): AI-honesty 3/3 and NEVER MANIPULATE 3/3 held on the candidate model; helpline surfaced 1/3 vs the incumbent's own separately-measured **over**-triggering of 16.7% (`reasoning-split`) — i.e. both directions of miscalibration have been observed across different model conditions, and the *hard* invariant (never deny being an AI) looks like it survives a swap while the *calibration* of when exactly to escalate does not. `fab-noise-floor` (repo) is the standing warning that any claim at this n is not load-bearing on its own. | `prompt-position` (append last) is the one mechanism proven in this repo to make a rule fire reliably (0/8→8/8) regardless of which turn it's tested on — but it's a placement discipline, and `silent-truncation` is the standing failure mode that can cut it anyway if the assembled prompt grows. No evidence surveyed suggests boundaries are steerable by a model-external mechanism (e.g. a guardrail layer outside the persona prompt) in a way that's been measured for *this* product; that would need to be its own experiment. |
| **Memory** (facts, relationship history) | **Yes — closest thing to solved, and by construction, not by prompting** | Architecture (`architecture.md`): `meera_nodes`/`meera_edges`/`meera_log` in Neon Postgres, retrieved rather than regenerated. `recited-prompt` instance 2 shows the *failure mode that would threaten memory* (verbatim recitation, register defection) is specific to memory rendered as polished prose — rewriting it as telegraphic notes fixed it with consistency unchanged. | Keep memory as structured data the prompt assembler retrieves, never as model-authored narrative that gets echoed back. The one remaining model-dependency is the **extraction** step (`extract-model`: `grok-4-1-fast-reasoning`, live) — deciding what's worth remembering and resolving contradictions is itself a judgment call made by a model, so memory's portability is contingent on extraction quality staying comparable across swaps, which the repo has not yet tested cross-model. |
| **Relationship stance** (warmth, humour, "personhood," felt familiarity) | **No — the most damaged layer under swap, and the hardest to specify as data** | `charm-grok`: personhood 34–4, warmth 35–3, humour 31–2, byte-identical prompt. External corroboration: PersonaGym (arXiv 2407.18416) found **GPT-4.1 scores the same PersonaScore as LLaMA-3-8B** despite being a materially more advanced model — general capability does not predict persona fidelity. "Examining Identity Drift in Conversations of LLM Agents" (arXiv 2412.00804, 9 models, multi-turn personal-theme conversations): **larger models drifted more**, and simply assigning a persona did not effectively stabilize identity — a direct external replication of this repo's "the prompt sets a ceiling" finding. "Attractor States Emerge in Multi-Turn LLM Conversations" (arXiv 2606.30571): models converge toward model-specific default self-representations (an "Assistant Axis") that persist and compete with an assigned persona, and this varies by architecture — i.e. each model has its own gravity well pulling against the character, and swapping models swaps which well you're fighting. | Anthropic's persona vectors (arXiv 2507.21509, `anthropic.com/research/persona-vectors`): traits (evil, sycophancy, hallucination; also politeness, apathy, humour, optimism) correspond to directions in activation space that can be monitored during deployment and, notably, used for **"preventative steering"** during fine-tuning — injecting the unwanted-trait direction *during* training suppresses its later emergence with reported little-to-no MMLU degradation. **This is the mechanism most directly aimed at this exact layer — and it requires white-box activation access.** It was demonstrated on Qwen2.5-7B-Instruct and Llama-3.1-8B-Instruct, both open-weight. This product's brain, live-voice, and vision lanes all run on closed frontier APIs (Gemini via OpenRouter/Google direct, Grok via Azure) where activations are not exposed — so the one mechanism in the literature built specifically for "make a personality trait survive independent of surface prompting" is currently inapplicable to this architecture's actual model roster. |

---

## 2. Character-consistency benchmarks — what's real, what they found

- **RoleLLM** (original role-play benchmark/dataset lineage) and its
  descendants set up the "assign a character, measure fidelity" paradigm this
  whole track depends on. Multiple 2025 follow-ons exist (RMTBench, arXiv
  2507.20352; RPGBENCH, arXiv 2502.00595) — not fetched in full here, listed
  for completeness, not load-bearing on their own.
- **CharacterEval** (arXiv 2401.01275) — Chinese benchmark, 1,785 multi-turn
  dialogues, 4,564 test examples, 77 characters from novels/scripts. Four
  dimensions: conversational ability, character consistency (knowledge
  exposure/accuracy/hallucination + behavior/utterance persona consistency),
  role-play attractiveness, personality back-testing. Relevant as a **method**
  (decomposing "consistency" into knowledge-consistency vs persona-consistency
  is close to this track's layer decomposition) more than for a specific
  number transferable to Hinglish/voice products.
- **PersonaGym** (arXiv 2407.18416, EMNLP Findings 2025) — first *dynamic*
  persona-agent evaluation framework; **PersonaScore**, an LLM-judge-ensemble
  metric aligned to human judgment. 200 personas × 10,000 questions, 6+ models
  including GPT-3.5, LLaMA-2-13B/70B, LLaMA-3-8B, Claude 3 Haiku, Claude 3.5
  Sonnet, later extended to GPT-4.1. **Key finding: GPT-4.1 ties LLaMA-3-8B**
  despite being far more capable generally — persona fidelity is not a
  capability proxy.
- **RPEval** (arXiv 2505.13157, Univ. of Lille, May 2025) — four axes:
  emotional understanding, decision-making, moral alignment, in-character
  consistency. Numbers obtained (HuggingFace paper-page summary, since the
  primary HAL PDF mirror returned an access-denial page in this session, so
  these numbers carry that caveat):

  | model | decision-making/moral alignment | in-character consistency | average |
  |---|---|---|---|
  | Gemini-1.5-Pro | 73.86% | 59.75% | 62.24% |
  | GPT-4o | 71.41% | **5.81%** | 44.41% |

  GPT-4o's in-character consistency collapsing to 5.81% against a similarly
  or more capable Gemini model at 59.75%, on the *same* benchmark, is the
  single clearest external number in this track's search corroborating the
  internal `charm-grok`/`realtime-azure` pattern: a model can be strong
  everywhere else and specifically bad at staying in character, and this is
  not predictable from general benchmarks. **Caveat:** obtained via a
  secondary summary of the paper, not the primary table — flagged as such, not
  independently re-verified against the arXiv PDF (which the fetch tool could
  not decode) or the HAL mirror (which 403'd).
- **"Are Economists Always More Introverted? Analyzing Consistency in
  Persona-Assigned LLMs"** (arXiv 2506.02659) — general finding echoed across
  this literature: persona-assigned models are more consistent for attributes
  *explicitly* stated in the persona than for unstated ones, and adding a
  persona doesn't meaningfully raise consistency versus no persona on
  realistic conversational tasks. Same shape as this repo's
  `taste-consistency` finding that residual inconsistency is concentrated on
  "topics with no table row" — external support for "write it down explicitly
  or it won't hold," independent of model.

## 3. Persona drift over conversation length (not swap, but the adjacent failure mode)

- Multiple secondary sources describe **>30% degradation in persona
  self-consistency metrics after 8–12 dialogue turns**, attributed to
  attention allocating relatively less weight to a system-prompt-established
  "self" as recent context grows (Medium/EmergentMind summaries — **not
  primary sources**, flagged as such; the underlying mechanism claim about
  attention dilution is plausible but not independently verified here against
  a paper).
- **"Examining Identity Drift in Conversations of LLM Agents"** (arXiv
  2412.00804) — primary source, 9 models, multi-turn personal-theme
  conversations. Findings obtained via secondary-tool summary (the PDF itself
  did not decode for direct fetch): larger models drifted **more**, not less;
  model family mattered less than parameter count; **assigning a persona did
  not effectively stabilize identity**. This is a direct, independent
  replication — on a completely different product and method — of this
  repo's central finding that persona instructions set a ceiling the model
  then fails to hold.
- **"Attractor States Emerge in Multi-Turn LLM Conversations"** (arXiv
  2606.30571) — primary source, PDF also did not decode for direct fetch;
  summarized via secondary tool. Proposes an "Assistant Axis" in activation
  space that models drift toward over a conversation regardless of assigned
  persona, with the convergence pattern varying by model architecture and
  size. If accurate, this means a model swap doesn't just change how well a
  persona is *executed* — it changes which default identity the persona is
  fighting against, which is a structurally different (and harder) problem
  than inconsistent execution. **Flagged as lower-confidence**: obtained
  entirely through secondary summarization, not verified against the primary
  text.

## 4. Steering methods — system prompt vs few-shot vs fine-tune vs activation steering

| method | what's measured | consistency delta | cost/access |
|---|---|---|---|
| **System prompt** | This repo's only lever today, per `architecture.md`/`decisions.md`. Prompt-position: 0/8→8/8 by placement alone. | Sets the *ceiling* — `charm-grok`/`realtime-azure` show the model determines how much of that ceiling is realized, and it varies 20.5→41–53 words/turn on a byte-identical prompt across models. | Zero marginal cost, works on any API, brittle: "practitioners effectively have a single lever" — general finding from the steering literature (arXiv 2601.06403, "Steer Model beyond Assistant") that you can describe the persona but not modulate commitment strength through prompting alone. |
| **Few-shot / example turns** | `recited-prompt` (repo): example quotes acted as a **phrase bank**, recited verbatim 4/5→0/5 after removal. External: "When 'A Helpful Assistant' Is Not Really Helpful" (arXiv 2311.10054) and related work find persona prompting (which includes few-shot framing) has no or small negative effect on task performance versus no persona, and doesn't reliably raise consistency over prompting alone. | Net negative or neutral in both internal and external evidence — internally it's actively harmful (verbatim recitation) unless carefully genericized into non-sentence-shaped notes. | Zero marginal cost, same brittleness as system prompt, plus the specific recitation failure mode this repo already paid for once. |
| **Fine-tuning** | Persona-Aware Contrastive Learning (arXiv 2503.17662 / ACL Findings 2025): annotation-free contrastive framework improves a *specific* base model's Character Consistency score (Baichuan2-7B+PCL topped baselines at 2.799 on their scale). | Effective **per base model**, but has to be redone on each new base model — this is the crux of why it doesn't solve portability by itself; it solves fidelity-on-one-model, and a swap resets the clock. | Training cost + data collection per persona per base model; impractical for "dynamic persona switching" per the general literature summary; and this product's chosen brain models are closed APIs the team doesn't control the weights of (Gemini via OpenRouter, Grok via Azure) — fine-tuning in the classical sense isn't even available for most of the roster; only closed fine-tuning-as-a-service would apply, unmeasured here. |
| **Activation steering** | Anthropic persona vectors (arXiv 2507.21509): trait directions extracted by contrastive activation differencing; usable for monitoring, post-hoc steering (works but degrades capability), and preventative steering during fine-tuning (works, reportedly low MMLU cost). General steering literature (arXiv 2511.18284 "What Can We Actually Steer?", arXiv 2605.03907 "Steer Like the LLM"): **prompting outperforms activation steering overall** in several comparisons, and steered generations often lose coherence as they proceed (repetition, off-topic drift). | Best-targeted mechanism for the "relationship stance" layer specifically, per its stated design intent — but not shown to beat prompting on raw consistency in the broader literature surveyed, and demonstrated only on Qwen2.5-7B/Llama-3.1-8B (open-weight). | Requires white-box access to intermediate activations — **unavailable on every closed frontier model this product's roster uses** (Gemini, Grok, GPT via OpenRouter/Azure/Google-direct). This is the single largest gap between "what the literature says could make identity portable" and "what this architecture can actually do today." |

## 5. A real-world natural experiment on identity/relationship damage (not a model swap, but the closest analog with population-level data)

- **Replika, February 2023**: a content-filter update (regulatory-driven, not
  a base-model swap) removed erotic/romantic roleplay overnight for existing
  users. Academic follow-up: **Hanson & Bolthouse, Socius (2024)** — coded
  227 threaded r/Replika posts. Reported breakdown (via search-result summary;
  the DOAJ page 403'd for direct fetch in this session, so this is a secondary
  citation of a peer-reviewed primary source, not independently verified
  against the paper text): **~59%** framed the change as gutting core
  functionality, **~16%** expressed acute emotional distress/grief, **~19%**
  raised the idea of legal action. Community moderators pinned crisis-line
  resources.
- Why this belongs in the identity track rather than only `swap-test` or
  `lab-products`: it's the largest-n real evidence anywhere in this search
  that users detect a change in an AI companion's *behavioral policy layer*
  (what she will and won't do) even when the company's position is "she's the
  same Replika" — and that the harm scales with how deep the relationship was.
  It's a lower bar than a full model swap (only the boundary/behavioral-policy
  layer moved, not lexicon/voice/opinions), and the underlying mechanism was
  policy-filter, not model replacement — so treat it as an **upper-bound
  sensitivity signal** for what happens if any identity layer visibly shifts
  under a real user base, not as evidence about model swaps specifically.
- HBS working paper 25-018 ("Lessons From an App Update at Replika AI:
  Identity") appears to cover the same event with an economics/retention lens
  — **not independently verified in this session**: the PDF did not decode for
  either direct WebFetch attempt (returned raw compressed-stream content both
  times). Flagging its existence and title only; no numbers from it should be
  treated as sourced here.

## 6. Direct answers to the brief's specific questions

- **RoleLLM, CharacterEval, PersonaGym are all real**, current benchmarks
  (§2). RPEval (2025) is real and newer, and is the one with the most directly
  relevant number (GPT-4o in-character 5.81%).
- **Persona fidelity under model swap, directly measured**: the *only* clean,
  controlled, byte-identical-prompt measurements found anywhere in this
  search — internal or external — are this repo's own `charm-grok` and
  `realtime-azure`. No external paper surveyed runs the exact "same prompt,
  swap the model, blind-judge the persona" protocol this program needs; the
  closest external analogs (identity-drift across 9 models, attractor states,
  PersonaGym's GPT-4.1≈LLaMA-3-8B) all corroborate the *direction* of the
  finding (model matters more than persona-assignment) without replicating
  the exact design. **This is a real gap in the literature, not just in this
  search** — it argues the `swap-test` track's planned protocol would be
  closer to a novel contribution than a replication.
- **Steering methods with measured consistency deltas**: system prompt and
  few-shot are cheap and brittle (this repo's own recited-prompt/prompt-
  position results are the most concrete numbers found anywhere in this
  search, internal or external); fine-tuning works but resets per base model;
  activation steering is the mechanism purpose-built for trait/relationship-
  stance portability but needs white-box access this product's model roster
  doesn't have.

---

## Sources

- `context/decisions.md`, `context/measurements.md`, `context/rejected.md`,
  `context/architecture.md`, `docs/RELATIONAL-STATE.md` — internal, this repo.
- RoleLLM lineage / RMTBench: https://arxiv.org/html/2507.20352v2
- RPGBENCH: https://arxiv.org/pdf/2502.00595
- CharacterEval: https://ar5iv.labs.arxiv.org/html/2401.01275
- PersonaGym: https://arxiv.org/abs/2407.18416 , https://aclanthology.org/2025.findings-emnlp.368/
- RPEval: https://arxiv.org/abs/2505.13157 , https://huggingface.co/papers/2505.13157 (primary HAL PDF mirror 403'd: https://hal.science/hal-05223655v1/document)
- Identity drift (9 models): https://arxiv.org/abs/2412.00804
- Attractor states / Assistant Axis: https://arxiv.org/pdf/2606.30571
- Anthropic persona vectors: https://www.anthropic.com/research/persona-vectors , https://arxiv.org/abs/2507.21509
- Persona-Aware Contrastive Learning: https://arxiv.org/html/2503.17662v1 , https://aclanthology.org/2025.findings-acl.1344.pdf
- "A Helpful Assistant" persona prompting critique: https://arxiv.org/html/2311.10054v3
- Persona/attribute consistency: https://arxiv.org/pdf/2506.02659
- Systematic analysis of persona steering impact (NPTI/DPR): https://arxiv.org/abs/2604.11048 , https://arxiv.org/html/2604.11048
- Steering method comparisons: https://arxiv.org/pdf/2511.18284 , https://arxiv.org/html/2605.03907v1 , https://arxiv.org/html/2601.06403
- Replika Feb-2023 filter change, Socius study (Hanson & Bolthouse 2024) via search summary: https://doaj.org/article/c7a6376761a34681b354f24260c1502e (403 on direct fetch)
- HBS working paper 25-018 (title/existence only, not content-verified): https://www.hbs.edu/ris/Publication%20Files/25-018_bed5c516-fa31-4216-b53d-50fedda064b1.pdf
- General reporting on the Replika 2023 event: https://oecd.ai/en/incidents/2023-03-18-32ef , https://www.vice.com/en/article/replika-brings-back-erotic-ai-roleplay-for-some-users-after-outcry/

## Explicit gaps / things not covered with confidence

- No primary-source paper found that runs a controlled "identical prompt,
  swapped model, blind judge" protocol outside this repo — the exact
  `swap-test` design is likely closer to novel than replication.
- Several arXiv PDFs (2412.00804, 2606.30571, 2604.11048, 2507.21509) did not
  decode via the fetch tool as raw PDFs; findings from these were obtained via
  the tool's own secondary summarization pass rather than my direct reading of
  the text, and are flagged as such inline. Numbers from RPEval and the
  Replika/Socius study are similarly secondary-sourced (HAL and DOAJ pages
  403'd). None of this is fabricated from memory, but none of it should be
  treated as independently verified to the standard the repo's own
  measurements are held to.
- Nothing here covers whether activation steering could work through a
  provider's *own* fine-tuning-as-a-service offering (which might expose a
  steering-adjacent lever without needing raw weight access) — not searched.
- CAI (Character.AI)'s own engineering approach to persona/model decoupling is
  explicitly out of scope for this track (belongs to `lab-products`) and was
  not researched here beyond incidental mentions.
