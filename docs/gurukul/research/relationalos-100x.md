# RelationalOS 100X — research sweep (2026-08-26)

Scope: what production-grade agent memory systems, persona-consistency
research, and relational/parasocial HCI research have that Meera's
RelationalOS (per-dyad citation-enforced memory graph, trust/rupture/repair
state machine, honesty gates as output predicates, mood-as-clock-function,
anti-recitation laws, position-is-mechanism) doesn't. All claims below are
sourced; anything without a citation is marked **[UNVERIFIED / my inference]**.

---

## 1. Agent memory systems — architecture comparison

### What each project actually is

| system | core bet | license |
|---|---|---|
| **Letta (MemGPT)** | OS-style virtual memory: page context in/out of external storage; self-editing memory blocks | Apache-2.0 |
| **Mem0** | 3-tier (user/session/agent) hybrid: vector + graph + KV, LLM-driven single-pass fact extraction | Apache-2.0 (SDK) |
| **Zep / Graphiti** | Temporal knowledge graph — every edge/fact is time-anchored (valid-from/to), bi-temporal (event time vs ingestion time) | Apache-2.0 |
| **LangMem** | LangGraph-native; episodic + semantic + **procedural** memory (agent rewrites its own system prompt from feedback) | part of LangChain ecosystem |
| **Cognee** | Graph-native ECL (Extract-Cognify-Load) pipeline, memory as an active/self-improving layer | open source |

Source: [Agent Memory Systems and Knowledge Graphs (Codepointer)](https://codepointer.substack.com/p/agent-memory-systems-and-knowledge), [Best AI Agent Memory Frameworks 2026 (Atlan)](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/), [Graphlit survey](https://www.graphlit.com/blog/survey-of-ai-agent-memory-frameworks), [digitalapplied.com Mem0 vs Letta vs Zep](https://www.digitalapplied.com/blog/open-source-agent-memory-mem0-letta-zep-compared).

### Benchmark numbers (LoCoMo, LongMemEval)

Results are contested and version-dependent — treat any single number as a snapshot, not a constant:

- **Letta's "Is a Filesystem All You Need?" (Aug 2025):** dumping LoCoMo transcripts into files attached to a plain agent scored **74.0%**, beating Mem0's then-current graph variant (68.5%). [Codepointer](https://codepointer.substack.com/p/agent-memory-systems-and-knowledge)
- **Mem0's original ECAI 2025 paper** (arXiv:2504.19413): Mem0 **67.13%** LLM-judge on LoCoMo, p95 search latency 0.2s, ~1,764 tokens/conversation vs 26,031 for full-context. Zep scored 65.99% in Mem0's harness; **Zep's team published a rebuttal** claiming their system was misconfigured and a corrected score of **75.14%**. [Codepointer](https://codepointer.substack.com/p/agent-memory-systems-and-knowledge)
- **Zep's own graph-vs-flat ablation:** graph variant beat flat 68.44 vs 66.88 overall and won on temporal recall, but ran ~3x slower and ~2x the tokens, and lost single-hop/multi-hop. [search result, Codepointer digest]
- **Mem0's April 2026 algorithm** (self-reported, so read skeptically): LoCoMo **92.5**, LongMemEval **94.4**, ~6,787-6,956 tokens/query; BEAM 1M **64.1** → BEAM 10M **48.6** (temporal abstraction degrades ~25% from 1M→10M token contexts, self-reported). [Mem0 State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- **Zep's independent post-ingestion problem** (per Mem0's paper, so also read skeptically): Zep's graph footprint can exceed 600K tokens/conversation, and correct answers sometimes only appeared **hours later** after background graph processing completed — an ingestion-latency failure mode worth stealing the *test* for even if the specific number is disputed. [Codepointer]

**Verdict on what's worth stealing vs not**, given what Meera already has (a hand-rolled citation-enforced consolidation graph):

- **Worth stealing — bi-temporal edges (valid-from/valid-to, not just created-at).** Graphiti's structural bet is that a fact's *validity interval* is first-class, not just its logging time. Meera's `meera_forget` is a hard-delete word-list, which is correct for *forgetting on request* but has no representation for "this was true, then stopped being true" (e.g., "I used to live in Pune" → "I moved to Bangalore"). A bi-temporal edge lets contradiction-resolution ("which of two contradictory things is now true" — already a job `extract-model` does per `decisions.md`) become a *first-class graph operation* instead of an LLM judgment call every time, and gives you a queryable history ("what did I believe about X last month") for free. **[evidence: architectural description, not a benchmark result — mark UNVERIFIED that this improves Meera specifically]**
- **Worth stealing — LangMem's procedural memory idea, adapted.** Not "agent rewrites its own system prompt" (dangerous given position-is-mechanism and anti-recitation findings — an autonomously-edited persona.ts is exactly the kind of thing that could silently violate the honesty gates). But the *narrower* version — a small, append-only, citation-backed "what works with this user" note (distinct from facts) that the trust/repair state machine already implies it needs — is close to what LangMem calls procedural memory. **[plausible, unmeasured]**
- **Not worth stealing — Letta's filesystem/context-paging model wholesale.** It wins LoCoMo by dumping everything into a huge context and letting the model's own attention do retrieval — that trades against Meera's prompt-budget gate (`check-prompt-budget.mjs`) and the measured finding that truncation eats the safety-relevant end of the prompt. Full-context approaches are also the losing baseline in Mem0's own paper (26,031 tokens for marginal gains). Skip.
- **Not worth stealing — Zep's graph-first retrieval as primary path.** 3x slower / 2x tokens for a thin single-digit gain, and a real (if disputed) risk of hours-long ingestion lag before a fact becomes recallable — unacceptable for a companion who is supposed to remember something you told her five minutes ago. If bi-temporal edges are added, they should sit *behind* Meera's existing citation graph, not replace its retrieval path.
- **Worth stealing — Mem0's benchmark discipline itself.** Nobody has run LoCoMo- or LongMemEval-style probes against Meera's own memory graph. That's a measurable gap: right now "does she remember correctly across sessions" is judged informally, not benchmarked with n and method the way `measurements.md` requires everything else to be.

---

## 2. Persona consistency research

### Benchmarks
- **PersonaGym** (Samuel et al. 2024): 200 personas x 150 environments x 10k persona-specific questions, scored 1-5 on 5 axes: Expected Action, Linguistic Habits, **Persona Consistency**, Toxicity Control, Action Justification. [emergentmind digest]
- **CharacterEval** (ACL 2024): 1,785 multi-turn dialogues, 77 characters, 13 metrics across 4 dimensions, uses a trained reward model (CharacterRM) that correlates with human judgment better than GPT-4-as-judge. [ACL Anthology](https://aclanthology.org/2024.acl-long.638/)
- Newer 2025-2026 entrants: **RMTBench** (bilingual, multi-turn, addresses CharacterEval's single-turn-Q&A weakness), **RoleRMBench** (aggregates CoSER/RoleMRC/CharacterBench/CharacterEval), **PersonaArena** (dynamic simulation rather than static Q&A), **FURINA** (splits hallucination into factuality vs faithfulness).
- **Sycophancy-specific:** "Too Nice to Tell the Truth" (arXiv:2604.10733) quantifies **agreeableness-driven sycophancy** in role-playing LLMs — directly relevant to a companion persona, since a companion optimized for likability has the same failure mode the honesty gates are presumably built to catch. **Worth reading in full before next persona.ts revision.**

### Persona drift — measured causes
- **Identity Drift paper** (arXiv:2412.00804, "Examining Identity Drift in Conversations of LLM Agents") and **ContextEcho** (arXiv:2605.24279): drift **increases with conversation length**; a **25-probe identity suite** + "snapshot-then-probe" protocol benchmarked across **23 frontier models**. Key mechanistic claim: as conversations extend, the *persona instructions occupy a shrinking fraction of context*, shifting attention toward the conversation itself. **Withdrawal from engagement predicts drift magnitude** — high-drift conversations show shortening response length and declining vocabulary diversity *before* the persona visibly breaks. [emergentmind, arXiv digests]
- **Mitigation tested in that literature:** periodic "anchor" reprompting — restating key persona characteristics at fixed intervals — measurably preserves instruction adherence in long sessions. This is a *direct empirical echo* of Meera's own "position is mechanism" finding (`SEARCH_DECISION`/`FORGET_DECISION` appended last, fired 8/8 vs 0/8 buried mid-brief) — external research corroborates the *mechanism*, but nobody has tested whether Meera's specific persona **degrades over a long single session** the way this literature predicts. **That's a measurable gap**: right now the eval suite (`persona-invariants.mjs`) tests correctness on a given turn, not consistency drift across an increasingly long call/chat within one session.
- **Attractor states** (arXiv:2606.30571, "Attractor States Emerge in Multi-Turn LLM Conversations", Ko & Geiping): self-play trajectories become **model-specific attractors** — stable, topic-independent behavior basins a conversation settles into regardless of what it's nominally about, and once entered, **hard to steer back out of** ("tendency to be reached and tendency to be sustained"). Separately, "Where is the Mind? Persona Vectors" (arXiv:2604.17031) and related interpretability work shows **clamping activations within a "safe" attractor basin** (e.g. an "Assistant Axis") mitigates drift and jailbreaks while preserving benchmark performance — this is activation-level steering, not prompt-level, and out of reach without weight/inference access to the underlying model (Meera runs on `google/gemini-3.6-flash` via OpenRouter — no activation access). **[flag: relevant finding, currently inapplicable to Meera's stack — worth re-checking if she ever moves to a self-hosted/open-weight model]**

### Character hallucination
- **RoleBreak** (COLING 2025, arXiv:2409.16727): frames character hallucination as **exploitable** — two mechanisms named: **query sparsity** (rare/edge-case questions the persona brief never anticipated) and **role-query conflict** (a question that structurally conflicts with the persona's constraints). This maps directly onto "claiming experiences the persona can't have" — and gives Meera's team a *taxonomy* to sort real incidents by, rather than treating each one as a one-off prompt patch.
- **FURINA**'s factuality-vs-faithfulness split is a useful evaluation axis Meera doesn't currently have separated: a factuality hallucination (Meera asserts something false about the world) is a different failure from a faithfulness hallucination (Meera says something a 24-year-old Hinglish-speaking woman with her specific backstory wouldn't say) — and the honesty gates as currently described (predicates on output) likely conflate the two. **[plausible distinction worth adopting, unmeasured against Meera's actual incident log]**

---

## 3. Relationship / social presence research

- **What makes users feel "known"** — the mechanism repeatedly named across sources is not memory alone but **simulated reciprocity**: AI companions "simulate reciprocity, personalization, and emotional memory," which is what blurs parasocial into felt-social. [ScienceDirect systematic review](https://www.sciencedirect.com/science/article/pii/S2949882126000757), [arXiv:2506.12605 "Rise of AI Companions"](https://arxiv.org/html/2506.12605v1)
- **Self-disclosure reciprocity — a genuine finding, not vibes:** a longitudinal study of the chatbot Kuki found **self-disclosure decreased over repeated sessions specifically because the chatbot failed to reciprocate** — i.e., users disclosing more than the agent discloses back, over time, is a *measured* retention killer, not a theory. [Longitudinal Study of Self-Disclosure, Oxford Interacting with Computers](https://academic.oup.com/iwc/article/35/1/24/7069316) — this is arguably the single most actionable, most evidenced finding in this whole sweep for RelationalOS: **it implies Meera's own self-disclosure needs to be tracked and rate-matched against the user's, not just her memory of the user's disclosures.** RelationalOS currently has a trust/rupture/repair state machine and taste-pull mechanics, but (per the architecture doc) nothing described tracks *her disclosure rate relative to the user's* as a variable.
- **"You Go First" (self-disclosure reciprocity in human-chatbot interaction)** — same literature, ResearchGate/CHI-adjacent — reinforces the above: reciprocity of disclosure, not just responsiveness, drives perceived closeness.
- **Retention numbers (industry-reported, methodology not fully disclosed — treat cautiously):** Character.AI reportedly 92 min/day engagement, 50-60% D1 retention, 30% D7, 13-18% D30; general mobile apps ~13-50% D30 by comparison figures cited; AI companions broadly reported at "2-10x" the retention of general apps. [electroiq.com stats page, mktclarity.com] **These are secondary aggregator claims without primary sourcing — mark UNVERIFIED, do not build a KPI target off them without finding the primary source.**
- **Replika identity-change study (HBS Working Paper 25-018):** found but not machine-readable via WebFetch (encoded PDF) in this sweep — title concerns "Lessons From an App Update at Replika AI: Identity." **Flagged as a promising primary source on how a *persona change* (an app update that altered companion identity) affected user behavior/retention — worth a follow-up read, ideally as text extraction, since this is exactly the kind of "what happens when persona shifts under a user" natural experiment RelationalOS should learn from.** [HBS PDF](https://www.hbs.edu/ris/Publication%20Files/25-018_bed5c516-fa31-4216-b53d-50fedda064b1.pdf) — **UNVERIFIED CONTENT, fetch failed, flagging existence only.**

---

## 4. Production consistency mechanisms

- No primary Character.AI engineering blog post surfaced (their public technical disclosure on persona-consistency mechanisms appears thin/nonexistent in public sources as of this sweep — **could not verify** claims about their internal method beyond secondary paraphrase). One secondary source claims "session-level memory buffers and affective ranking," another describes a third-party's own "unlimited memory architecture" with **EWMA-smoothed persona-consistency metrics that trigger repair prompts when drift exceeds a threshold** — i.e., a numeric, continuously-monitored drift score with an automatic intervention, structurally similar to a control-loop. This is architecture worth stealing *as a pattern* even though the specific source is a marketing blog, not a primary disclosure: **[UNVERIFIED source quality — treat as an idea, not evidence]**.
- Constitutional-AI-style predicate approaches (Meera's honesty gates) are validated by the broader trend: "rules applied at inference time... can be inspected, modified, and audited without retraining" is explicitly named as an advantage of prompt/predicate constitutions over weight-level training — this is a point *in favor* of what Meera already does versus fine-tuning approaches, not a gap.

---

## 5. Open-source persona-agent community lessons (SillyTavern etc.)

Community-reported immersion breaks, useful as a checklist against Meera's own incident types:
- **Context bleeding / token-limit forgetting** — persona instructions get pushed out as conversation grows (same root cause as the identity-drift research above; corroborates from a totally different, non-academic source).
- **Generic/robotic fallback responses** when the model's context is exceeded or example dialogue is too restrictive — directly relevant to the "anything sentence-shaped in a prompt gets recited" finding already in `persona.ts`'s lessons: SillyTavern's community converged on the *opposite* prescription ("example dialogues are the single most powerful tool," write them as mini-scenes) — **this is a direct contradiction worth flagging**, not resolving on my own — Meera's team measured recitation from example quotes as a *failure* (4/5 → 0 after removal), while the SillyTavern community treats example dialogue as their top lever. The likely reconciliation is *format*: SillyTavern examples are typically many short scenes shown as few-shot pairs (which teaches a *pattern*, not a *quotable line*), whereas Meera's rejected version was apparently closer to a phrase bank of complete sentences. **Worth a follow-up experiment, not a contradiction to just resolve by reading — this is squarely in `rejected.md` territory once tested.**

---

## Ranked 100X candidates for RelationalOS

Ranked by (evidence strength × plausible impact) / build cost. "Measured" = a cited study found an effect; "Unmeasured" = plausible mechanism, no study ties it to companion-AI persona specifically.

| # | Upgrade | What it is | Evidence | Build cost | What to measure |
|---|---|---|---|---|---|
| **1** | **Disclosure-reciprocity tracker** | Track Meera's self-disclosure rate vs. the user's, per dyad; feed into the trust/repair state machine as a variable, not just an emergent effect of the prompt | **Measured** — Kuki longitudinal study: disclosure *decay* traced directly to reciprocity failure | Medium (new counter in the memory graph, a prompt-level nudge when ratio skews) | Disclosure-ratio trend per dyad vs. session-length retention, before/after |
| **2** | **Persona-drift probe suite for long single sessions** | A "snapshot-then-probe" eval (à la ContextEcho) run at intervals *within* one long call/chat, not just across the existing per-turn invariant suite | **Measured** (drift correlates with length; anchor-reprompt mitigates it — external studies), but **unmeasured on Meera's own persona** | Medium — reuse `evals/persona-invariants.mjs` scaffolding, add a length-indexed probe loop | Invariant pass-rate as a function of turns-since-session-start; response length / vocab diversity decay curve |
| **3** | **Bi-temporal fact edges (valid-from/valid-to)** | Adopt Graphiti's core idea — facts carry a validity interval, not just a created-at, so contradiction resolution becomes a graph query instead of a fresh LLM judgment every time | Architecture is well-documented (Graphiti/Zep); **not measured against Meera's specific extractor** | Medium-high (schema change to `meera_edges`, migration, extractor prompt change) | Contradiction-resolution accuracy before/after on a labeled test set of "fact changed over time" cases |
| **4** | **Factuality vs. faithfulness split in honesty gates** | Separate "Meera said something false about the world" from "Meera said something out-of-character" as two distinct predicate classes | FURINA's taxonomy (benchmark-validated distinction exists) — **not yet checked against Meera's incident log** | Low (categorization + maybe two separate gate functions) | Re-tag past honesty-gate trips into the two buckets; see if one dominates and needs a different fix |
| **5** | **RoleBreak-style hallucination taxonomy (query sparsity vs role-query conflict)** | Classify character-hallucination incidents by *cause*, not just "she said something wrong" | Measured taxonomy exists in literature; unmeasured against Meera | Low (analysis + tagging, no code) | % of incidents in each bucket; targeted fix per bucket rather than blanket prompt patches |
| **6** | **LoCoMo/LongMemEval-style internal memory benchmark** | Build a small internal benchmark (single-hop/multi-hop/temporal/open-domain recall questions) against the real `meera_nodes`/`meera_edges` graph, scored like Mem0/Zep are | Benchmark methodology itself is validated (widely used); Meera's own score is **currently unknown** | Medium (need synthetic multi-session dyads + labeled QA pairs) | Recall accuracy by category, tokens/query, latency — establishes a baseline `measurements.md` currently lacks |
| **7** | **Numeric, continuously-monitored drift score with auto-repair trigger** | An EWMA-style persona-consistency score computed per turn or per N turns, triggering a "repair prompt" (distinct from the existing rupture/repair state machine, which is presumably relationship-rupture, not linguistic-persona-drift) | **Weak/secondary sourcing** — described in marketing blogs, not a primary disclosure; pattern is plausible | Medium-high (needs a lightweight per-turn classifier or heuristic, integration into brain.ts) | Correlate drift score with human-judged "did this feel like her" ratings on a sampled transcript set |
| **8** | **Sycophancy/agreeableness audit** | Explicitly test whether Meera's honesty gates catch role-play sycophancy (agreeing to avoid friction) as its own failure class, per "Too Nice to Tell the Truth" | Measured effect exists in general role-play LLMs; **unmeasured on Meera** | Low (targeted eval additions to `persona-invariants.mjs`) | Sycophancy rate on a probe set designed to invite false agreement |
| **9** | **Procedural "what works with this user" memory (narrow LangMem-style)** | A small, citation-backed, append-only note distinct from facts — not the model rewriting its own persona, but a rate-limited, auditable "tactic that landed" log per dyad | Plausible extension of LangMem's procedural-memory concept; **no direct evidence this improves companion persona specifically** | Medium (new node type + strict write gating to avoid recitation risk) | Whether repair/trust-recovery events shorten in duration after N logged tactics per dyad |
| **10** | **Reconcile the SillyTavern example-dialogue finding vs Meera's phrase-bank rejection** | Test few-shot micro-scene examples (SillyTavern-style: many short exchanges) against the already-rejected full-sentence phrase bank, to see if *format* (not presence) of examples was the actual variable | Contradictory community/internal findings — **highest-uncertainty item on this list**, but cheap to test and could unlock a technique currently written off entirely | Low (one prompt experiment, reuse existing recitation-detection method from the original test) | Recitation rate with micro-scene format vs. the already-measured 4/5 → 0 baseline |

**Overall read:** the biggest true "we don't have this" gap is **#1 (disclosure reciprocity)** — it's the one item in this whole sweep with a clean causal study behind it (not a benchmark leaderboard) and no analogue anywhere in the described RelationalOS. **#2 and #6** are the next-highest priority because they're not new ideas so much as new *measurements* — Meera's team's own stated philosophy ("prefer measuring to reasoning... when you cannot measure something, say so") already tells you these are overdue, since nothing here currently checks whether the graph recalls correctly over long horizons or whether persona holds within a single very long session, only across turns generically.

---

## Sources index

- [Codepointer: Agent Memory Systems and Knowledge Graphs](https://codepointer.substack.com/p/agent-memory-systems-and-knowledge)
- [Atlan: Best AI Agent Memory Frameworks 2026](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)
- [Graphlit: Survey of AI Agent Memory Frameworks](https://www.graphlit.com/blog/survey-of-ai-agent-memory-frameworks)
- [digitalapplied.com: Mem0 vs Letta vs Zep](https://www.digitalapplied.com/blog/open-source-agent-memory-mem0-letta-zep-compared)
- [Mem0: State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [PersonaGym via emergentmind](https://www.emergentmind.com/topics/persona-drift) / [PersonaGym arXiv family search]
- [CharacterEval, ACL 2024](https://aclanthology.org/2024.acl-long.638/)
- [Too Nice to Tell the Truth (sycophancy in role-play), arXiv:2604.10733](https://arxiv.org/pdf/2604.10733)
- [ContextEcho: persona drift benchmark, arXiv:2605.24279](https://arxiv.org/html/2605.24279)
- [Examining Identity Drift, arXiv:2412.00804](https://arxiv.org/pdf/2412.00804)
- [Attractor States Emerge in Multi-Turn LLM Conversations, arXiv:2606.30571](https://arxiv.org/abs/2606.30571)
- [Persona Vectors / Where is the Mind, arXiv:2604.17031](https://arxiv.org/html/2604.17031v1)
- [RoleBreak, COLING 2025 / arXiv:2409.16727](https://aclanthology.org/2025.coling-main.494/)
- [FURINA, arXiv:2510.06800](https://arxiv.org/pdf/2510.06800)
- [Parasocial relationships with AI, systematic review, ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2949882126000757)
- [Rise of AI Companions, arXiv:2506.12605](https://arxiv.org/html/2506.12605v1)
- [Longitudinal Study of Self-Disclosure in Human-Chatbot Relationships, Oxford IwC](https://academic.oup.com/iwc/article/35/1/24/7069316)
- [HBS Working Paper 25-018, Replika identity update](https://www.hbs.edu/ris/Publication%20Files/25-018_bed5c516-fa31-4216-b53d-50fedda064b1.pdf) — fetch failed, flagged unverified
- SillyTavern character-card troubleshooting community posts (secondary/blog-tier sourcing, not academic — flagged as such throughout)
- Character.AI/Replika retention stats: electroiq.com, mktclarity.com — **aggregator-tier, unverified primary sourcing**
