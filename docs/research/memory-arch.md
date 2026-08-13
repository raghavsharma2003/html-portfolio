# Track: memory-arch — State of the art in LLM-agent memory systems, measured not marketed

Scope note per program brief: this covers system architectures (MemGPT/Letta,
Zep/Graphiti, Mem0, HippoRAG, A-MEM, LangMem, Cognee), plain-RAG vs KG vs
hybrid, consolidation/reflection, forgetting/decay, and benchmark numbers
(LoCoMo, LongMemEval) with their caveats — closing on the design question that
matters to Vyakti: can any of these represent "WE experienced this together"
(shared episodic history with the AI as participant) as distinct from "I know
this fact about the user"?

All numbers below are attributed to a specific source. Where a number is
vendor-marketed and independently disputed, both figures are given.

---

## 1. MemGPT / Letta

**Source:** Packer, Wooders, Lin, Fang, Patil, Gonzalez, "MemGPT: Towards LLMs
as Operating Systems" (2023); Letta docs/blog.
- https://arxiv.org/abs/2310.08560 (MemGPT paper, referenced via search — not
  independently re-fetched this session)
- https://www.letta.com/blog/agent-memory/
- https://www.letta.com/blog/sleep-time-compute/

**Architecture.** OS-inspired hierarchy: **core memory** (small block that
lives inside the context window — the LLM reads/writes it directly, analogous
to RAM), **recall memory** (searchable full conversation history outside
context, queried by tool call), **archival memory** (long-term store, also
tool-queried, analogous to cold storage/disk). The agent itself issues
function calls to page memory in and out of context — the LLM manages its own
memory, not an external orchestrator.

**Sleep-time compute** (Letta, 2025): a separate idea layered on the same
system — do memory consolidation/reasoning *between* turns instead of at query
time, on the theory that idle time is free and predictable-query workloads
benefit from precomputing likely-needed context. Reported: up to 5x lower
inference compute, 2.5x lower cost/query, up to 18% higher accuracy when
scaled — **vendor-reported, not independently verified in this pass**, and the
paper's own framing restricts the win to workloads where "queries are
predictable given context," which is a real caveat, not a footnote.

**Relevance to the WE/I distinction:** the three-tier structure is purely
about *where* text lives (in-context vs. queryable-outside), not about *what
kind* of fact it is. Recall memory stores raw turn history including the
agent's own utterances, so a MemGPT-style system technically retains "what she
said and did" — but nothing in the architecture marks an episode as
co-experienced vs. reported. It is a storage/paging model, not a semantic
one. Load-bearing for the "prompt gets recited" law already in this repo's
`rejected.md`: raw recall memory re-inserted verbatim is exactly the
mechanism that produced the phrase-bank problem — MemGPT's own design
re-injects retrieved text into context near-verbatim, which is the failure
mode Meera's `context/rejected.md#recited-prompt` already measured against a
different subsystem (persona examples, stored taste). Same mechanism,
different memory system — worth treating as a general law, not a one-off.

---

## 2. Zep / Graphiti — temporal knowledge graph

**Source:** Rasmussen et al., "Zep: A Temporal Knowledge Graph Architecture
for Agent Memory," arXiv:2501.13956. Fetched full text.
- https://arxiv.org/abs/2501.13956 / https://arxiv.org/html/2501.13956v1
- https://blog.getzep.com/state-of-the-art-agent-memory/
- Independent audit thread: https://github.com/getzep/zep-papers/issues/5

**Architecture — three-tier graph 𝒢=(𝒩,ℰ,ϕ):**
- **Episode subgraph** — raw input (messages/text/JSON) stored non-lossy.
  Episodic edges connect episodes to the semantic entities extracted from
  them. This is the layer closest to "what actually happened, verbatim."
- **Semantic entity subgraph** — entity nodes deduplicated across episodes,
  connected by semantic edges (extracted facts/relationships).
- **Community subgraph** — clusters of strongly-connected entities with
  LLM-generated summaries; the most abstracted layer.

**Bi-temporal model — this is the architecturally interesting part.** Two
independent timelines are tracked per edge (fact): **T** (when the event
actually happened, in the real world) and **T′** (when the system ingested/
recorded it). Each edge carries four timestamps: `t'_created`, `t'_expired`
∈ T′ (system-time bookkeeping) and `t_valid`, `t_invalid` ∈ T (the real-world
window during which the fact held true). When a new fact contradicts an
existing one, the system doesn't delete the old edge — it sets the old edge's
`t_invalid` to the new edge's `t_valid`. **The superseded fact stays in the
graph, timestamped as no-longer-true, rather than being overwritten.** This
is a genuinely different retention model from a vector store or a
overwritten-JSON user-profile — it preserves the history of what was believed
true and when belief changed, which is closer to "what we knew at each point
in our history" than a single mutable fact table.

**Benchmark numbers, as reported by Zep:**
- Deep Memory Retrieval (DMR, 500 conversations ~60 msgs each): Zep(gpt-4-turbo)
  94.8% vs MemGPT 93.4%; Zep(gpt-4o-mini) 98.2% vs full-conversation baseline
  98.0% (i.e. barely beats just stuffing the whole thing in context on this
  particular benchmark).
- LongMemEval: Zep(gpt-4o) 71.2% vs baseline 60.2% (**+18.5%**); Zep(gpt-4o-mini)
  63.8% vs baseline 55.4% (+15.2%). Latency 2.58s vs 28.9s baseline (**−90%**),
  context ~1.6k tokens vs 115k baseline.
- LoCoMo (vendor-claimed by Zep in marketing): 75.14% ± 0.17, disputing Mem0's
  reported 65.99% for Zep as a **misconfiguration**, not a real gap (see §7
  below — this exact dispute is the load-bearing lesson of this whole track).

**Relevance to WE/I:** Graphiti's episode subgraph explicitly retains the
speaker per turn, so an event the AI participated in (not just observed)
is structurally distinguishable from a fact merely told to it — the episode
node knows who said what. But the paper's own framing (per fetched text) is
psychological window-dressing ("episodic memory represents distinct events,"
"semantic memory captures associations") rather than a design decision to
treat AI-as-participant differently from AI-as-informed-party. Nothing in the
retrieval or scoring path privileges "we did X together" over "user told me
X." **This is the closest existing OSS architecture to the substrate Vyakti
needs, but the WE/I distinction would have to be added on top — it is not
there today.**

---

## 3. Mem0

**Source:** Chhikara et al., "Mem0: Building Production-Ready AI Agents with
Scalable Long-Term Memory," arXiv:2504.19413 (abstract fetched; full-text
numbers not independently re-extracted — flagged below).
- https://arxiv.org/abs/2504.19413
- https://mem0.ai/research

**Architecture, as described in secondary sources (not independently
verified against primary source in this pass):** extraction collapses to a
single LLM call that only *adds* (no separate summarize/update step),
multi-signal retrieval, and — notably — treats the **agent's own stated
facts as first-class alongside the user's**, per Mem0's own blog description
found via search. This is the one piece of positioning language across all
systems reviewed that explicitly names "facts about me (the agent)" as a
retained category, not just "facts about the user." Whether that is actually
architecturally separate from user-facts in the schema, vs. just marketing
language, was **not verified against the paper's methods section** — flag
this as unconfirmed if it becomes load-bearing.

**Headline numbers (mem0.ai self-report, treat as vendor-marketed):**
+26% accuracy over "OpenAI Memory" on LoCoMo LLM-as-judge, 91% lower p95
latency and >90% token savings vs full-context, LoCoMo 92.5 / LongMemEval
94.4 in later blog posts (these later, higher numbers are **not** the
ECAI-2025-paper numbers and were not traced to a controlled methodology in
this pass — treat with more suspicion than the paper's own claims).

**The dispute (§7 covers detail):** Zep's audit says Mem0's own harness
under-configured Zep and Mem0's benchmark numbers are not reproducible by a
third-party public harness. Mem0 also, per its own paper abstract, is beaten
by full-context (~73%) on one LongMemEval configuration according to a
secondary source citing the paper — i.e. **the "memory system" loses to
"just paste in the whole conversation"** on a meaningful chunk of the
benchmark, which is a genuinely important negative result if accurate, not
merely a caveat.

---

## 4. HippoRAG / HippoRAG 2

**Source:** Gutiérrez et al., "HippoRAG: Neurobiologically Inspired
Long-Term Memory for LLMs," NeurIPS 2024, and "From RAG to Memory:
Non-Parametric Continual Learning for LLMs" (HippoRAG 2), ICML 2025,
arXiv:2502.14802.
- https://proceedings.neurips.cc/paper_files/paper/2024/file/6ddc001d07ca4f319af96a3024f6dbd1-Paper-Conference.pdf
- https://arxiv.org/abs/2502.14802

**Architecture.** Builds a knowledge graph from OpenIE-extracted triples over
the corpus, then answers queries via **Personalized PageRank** seeded at
query-relevant nodes — explicitly modeled on the hippocampal-indexing theory
of memory (hippocampus as sparse index into neocortical representations,
not a store of the content itself). HippoRAG 1: 89.1% Recall@5 on
2WikiMultiHopQA vs 68.2% for ColBERTv2 (per secondary source). HippoRAG 2
adds deeper passage integration and reports a 7% gain in associative-memory
tasks (MuSiQue, 2Wiki, HotpotQA, LV-Eval) over "the state-of-the-art
embedding model," evaluated jointly on factual memory (NQ, PopQA),
sense-making (NarrativeQA), and associativity.

**Relevance:** this is a multi-hop-retrieval-quality architecture, not a
relationship-state architecture — it was built for corpus QA (Wikipedia-style
multi-hop reasoning), not for conversational companionship. It has no
temporal/episodic layer and no participant marking at all. Its contribution
to this track is narrow but real: **PageRank-over-extracted-entities is a
materially different retrieval mechanism from embedding-similarity search**,
and it measurably wins on tasks requiring connecting facts across distant
mentions — which is exactly the failure mode LoCoMo's multi-hop category is
designed to probe. If Vyakti's context compiler ever needs "connect a thing
said in week 1 to a thing said in week 30 without either being in the
retrieval window," this is the retrieval mechanism to steal, not the
memory-typing scheme.

---

## 5. A-MEM (agentic memory, Zettelkasten-style)

**Source:** "A-Mem: Agentic Memory for LLM Agents," arXiv:2502.12110, NeurIPS
2025. Abstract fetched directly; full-text numbers **not obtained** — the
fetch returned only the abstract's claim of "superior improvement... on six
foundation models" with no benchmark names or percentages, and explicitly no
stated limitations section content. **This is a gap, flagged as such.**
- https://arxiv.org/abs/2502.12110

**Architecture, as described.** Inspired by the Zettelkasten note-card
method: each new memory becomes an atomic "note" with generated context,
keywords, tags; the system then *searches existing memories for meaningful
links* and creates connections dynamically (rather than a fixed schema), and
— the notable part — **new memories can trigger updates to the
representations of old memories** ("memory evolution"). This is architecturally
distinct from Zep/MemGPT in that linkage is emergent/associative rather than
entity-schema-based, closer to how a human's understanding of an old memory
can shift in light of something new.

**Caution:** no independently verified benchmark numbers for this track. Do
not cite A-MEM's superiority claims as measured fact — they were not
recoverable from the sources fetched in this session. The design pattern
(atomic notes + emergent linking + retroactive memory evolution) is worth
noting as a *candidate mechanism*, not as a benchmarked winner.

---

## 6. LangMem and Cognee — framework notes (secondary sources only)

**LangMem** (LangChain): explicitly names three memory types — semantic
(facts), episodic (past interactions incl. situation + reasoning + why it
worked), procedural (behavioral rules refined via feedback) — and frames
procedural memory as literally editable system-prompt content. No primary
paper; this is a product SDK, and no independent benchmark numbers were found
for it in this pass.
- https://langchain-ai.github.io/langmem/concepts/conceptual_guide/

**Cognee**: an ECL (Extract-Cognify-Load) pipeline building a self-hosted
knowledge graph + vector + relational store; positions itself similarly to
Graphiti/Zep but open-source-first and multi-tenant (per-agent write scope on
a shared graph). No independent benchmark numbers found; treat as an
implementation option, not a measured winner.
- https://github.com/topoteretes/cognee

---

## 7. The benchmark reliability problem — this is the load-bearing finding of the whole track

Every headline number above needs to be read through this section. Sources:
- Zep's own audit of Mem0's methodology:
  https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/
- Independent third-party audit of LoCoMo's answer key:
  https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg
- LongMemEval original paper: arXiv:2410.10813 (ICLR 2025)

**LoCoMo's answer key is measurably wrong.** An independent audit (Penfield
Labs, methodology: manual review against source conversations) found **99
score-corrupting errors in 1,540 questions (6.4%)** — hallucinated facts in
the gold answers (referencing details that exist only in internal annotation
metadata, not in the actual dialogue), incorrect temporal-reasoning ground
truth (e.g. "last Saturday" computed wrong relative to a Thursday reference
turn), and 24 questions with wrong speaker attribution. **Theoretical maximum
score for a perfect system on the corrected key is ~93.6%** — meaning any
reported score close to or above that on the *original* key is evidence of
overfitting to the benchmark's errors, not superhuman recall. Separately,
Category 5 of LoCoMo is unusable outright (missing ground truth) and both
Mem0 and Zep silently excluded it from their published numbers.

**The judge is gameable in a way that specifically rewards shallow
retrieval.** The same audit tested the LLM judge (gpt-4o-mini) with
intentionally wrong-but-topically-adjacent answers and found it **accepted
62.81% of them** — vague answers that name the right topic but no specific
detail pass roughly two-thirds of the time, while specific factual errors
(wrong name/date) are caught ~89% of the time. This means the metric
structurally rewards "found the right conversation, extracted nothing" over
precise recall failures, which is close to the *opposite* of what a
relationship-memory product needs to optimize.

**Cross-lab reproducibility is currently broken.** Zep's audit of Mem0's
LoCoMo evaluation found three concrete implementation errors in how Mem0
configured a *competing* system before reporting its score: (1) both
conversation participants were assigned the "user" role, breaking Zep's
internal participant-identity logic; (2) timestamps were appended into
message text instead of using Zep's dedicated `created_at` field, breaking
temporal reasoning; (3) searches were run sequentially rather than in
parallel, inflating reported latency. Zep's corrected re-run: 75.14% ± 0.17
vs. the 65.99% Mem0 published for Zep — roughly a 10-point swing from
implementation details alone, on the same underlying system. **A number from
one lab about a competitor's system, without a published harness the
competitor can independently re-run, should not be treated as measured.**

**LongMemEval is comparatively more trustworthy but still has a documented
prompt-shape sensitivity.** The original paper (Wu et al., arXiv:2410.10813,
ICLR 2025) reports commercial chat assistants and long-context LLMs losing
~30% accuracy on information scattered across sustained multi-session
history, across five abilities: information extraction, multi-session
reasoning, temporal reasoning, knowledge updates, and abstention (knowing
when NOT to answer — directly relevant to Meera's never-fabricate
constraints). This benchmark was independently reused by Zep with numbers
that are internally consistent with Zep's own DMR results, which is mild
corroborating evidence its scores are more load-bearing than LoCoMo's.

**House-style verdict for this repo:** treat LoCoMo leaderboard position as
directional only, never as a ranking claim past roughly the top few points of
spread — this echoes exactly the `fab-noise-floor` lesson already logged in
this repo's own `context/measurements.md` (fabrication metric noise spread of
13.6pp on identical input; "any claim at n<300 is noise"). The mechanism is
different (benchmark-error noise vs. harness-noise) but the lesson transfers
directly: **a memory-system comparison is only as good as its worst
measurement link, and for LoCoMo that link (the answer key, or the judge) is
demonstrably broken at the 6–60% level depending on which failure mode you
measure.**

---

## 8. Consolidation, reflection, and sleep-time compute

**Generative Agents (Park et al., 2023, UIST '23).**
- https://dl.acm.org/doi/fullHtml/10.1145/3586183.3606763
- https://3dvar.com/Park2023Generative.pdf

Architecture: a flat, append-only **memory stream** of every observation,
retrieved by a weighted combination of **recency** (exponential decay),
**relevance** (embedding similarity), and **importance** (a self-rated 1–10
integer the agent assigns at write time). Periodically, the agent runs
**reflection**: it clusters recent high-importance observations and asks
itself to synthesize a higher-level statement ("Klaus has been eating alone
and seems withdrawn"), which is itself written back into the stream as a new
memory that can be retrieved and further reflected on — a recursive tree of
increasingly abstract self-generated insight sitting on top of raw
observation. This is the origin of "importance-weighted retrieval" and of
reflection-as-a-distinct-memory-operation, both since absorbed into most
production systems' vocabulary (LangMem's procedural memory and Letta's
sleep-time compute are both descendants of this idea, applied to
skill/behavior rather than narrative self-model).

**Sleep-time compute (Letta, 2025).** Distinct claim from Park et al.:
instead of reflecting to build better *future* memory, precompute likely
*future context* during idle time so the live turn is faster and/or more
accurate. Vendor-reported 5x compute reduction, 2.5x cost reduction, up to
18% accuracy gain **when queries are predictable given context** — this
predictability condition is the load-bearing caveat; Meera's actual traffic
(a companion chat, emotionally reactive, not task-completion) is plausibly
*less* predictable than the benchmark workloads this was validated on
(reported as scheduling/agentic-task-style workloads in secondary sources),
so the gain should not be assumed to transfer without a workload-matched
retest.
- https://www.letta.com/blog/sleep-time-compute/
- https://arize.com/blog/sleep-time-compute-beyond-inference-scaling-at-test-time/

---

## 9. Forgetting and decay

**Source (survey/framing only — individual mechanism papers are 2026 and
largely unverified against primary text in this pass):**
- Search results surfaced FSFM (arXiv:2604.20300), Oblivion
  (arXiv:2604.00131), FadeMem (arXiv:2601.18642), an ACT-R-inspired
  architecture (ACM HAI 2025), and a Weibull-decay governance framework
  (arXiv:2603.11768) — none independently fetched in full in this session;
  treat every specific number attributed to them below as **unverified,
  taxonomy-only**.

The consistent shape across this cluster: forgetting is modeled as
**decay-driven loss of retrieval accessibility**, not deletion — a memory's
activation/retrievability falls off (commonly modeled as an
Ebbinghaus-style exponential or a Weibull hazard function) as a function of
elapsed time since last access, modulated by access frequency and semantic
relevance, and reinforced (activation boosted) each time it's retrieved. This
is architecturally the opposite of Zep's bi-temporal invalidation — Zep marks
a fact **false as of a specific moment** because it was superseded by new
information; the decay-family papers make a fact **harder to retrieve over
time by default**, independent of whether it's still true. Both are needed
for different jobs: invalidation for "this fact changed," decay for "this
fact is true but no longer salient" (a birthday mentioned once in month one
should decay in retrieval priority without being marked false).

**Directly load-bearing for this repo's existing law:** none of the
forgetting-mechanism papers reviewed address *honest* forgetting — telling
the user "I don't remember that" as a first-class, surfaced behavior — as
opposed to *silent* retrieval decay. Meera's product requirement (per program
brief's "honest forget" invariant) is a UX/trust behavior, not a retrieval
optimization; nothing found in this literature treats "admitting you forgot"
as an architectural primitive rather than a prompt instruction. This looks
like an open design gap the lab would have to solve itself, not one it can
borrow.

---

## 10. The design question: can any of this represent "WE" as distinct from "I know about you"?

This is the crux the program brief asks for, and the honest answer is: **not
yet, in any surveyed production system, as a first-class architectural
category** — but the raw material to build it exists in pieces.

**What exists that's close:**
1. **Zep/Graphiti's episode subgraph** retains per-turn speaker attribution
   non-lossily, so "the AI said X" vs "the user said X" is structurally
   recoverable — but the *retrieval and scoring* layers (entity/community
   subgraphs) abstract that away into speaker-agnostic facts. The
   participant information exists in the substrate and is thrown away by the
   next layer up.
2. **ZifaMem** (arXiv:2607.17564, fetched full text) is the one system found
   in this search that explicitly names the distinction the brief is asking
   about, splitting memory into **"user-focused state"** (preferences,
   emotional history, relational facts about the user) vs. **"companion
   self-state"** (the AI's own stylistic/mood consistency) as separate typed
   categories, with affect tags embedded at consolidation time rather than
   stored as a separate table. Reported result: +11.4% pooled
   emotional-intelligence score (95% CI 6.3–17.1%, n=208 paired instances, 4
   backbones: Claude, Qwen3.6, Doubao-Seed-1.8, GLM-5.2) vs. a
   "deployment-honest" full-raw-history comparator, DeepSeek-v4 as judge,
   paired bootstrap, 3 repeats. Persona-grounding gain concentrated on Claude
   specifically (+42% relative, n=114) — **the paper's own stated caveat is
   backbone-dependence**: Gemini *regressed* on preference and
   fiction-reality discrimination under the same structured memory, meaning
   compression can strip signal a weaker model was actually using from raw
   history. This is the single most relevant primary source found for
   Vyakti's exact design question, and it is one paper, n in the low
   hundreds, one judge model — treat as a promising direction, not a settled
   architecture.
   - https://arxiv.org/abs/2607.17564 / https://arxiv.org/html/2607.17564v1
3. **Generative Agents' reflection mechanism** is the closest thing to a
   *process* for building a "WE" narrative — reflections are self-generated
   higher-order statements that can synthesize across many raw observations,
   which is structurally what a "how our relationship has evolved" summary
   would need — but Park et al. built it for third-person NPC behavior
   believability, not first-person "the AI and I did this," and nothing in
   the retrieval scoring treats reflections-about-us differently from
   reflections-about-the-world.

**What's structurally missing everywhere else surveyed:** MemGPT/Letta,
Mem0, HippoRAG, LangMem, and Cognee all default to a **user-model** framing —
memory exists to make the system better at serving/knowing the user, and the
schema (explicit or implicit) is "facts about the user, indexed for later
retrieval by the user's next query." None of them, in the primary sources
recoverable in this session, have a benchmark or scoring axis that rewards or
even measures "does the AI's own participation in past events get
represented and retrieved as such." Mem0's blog language claims the AI's own
facts are captured "as first-class alongside the user's" — this was **not
verified against the paper's schema/methods in this pass** and should be
re-checked before being relied on.

**The sharpest negative evidence on whether any of this survives a model
swap** is "Best Friends, Not Forever" (Venkit et al., arXiv:2607.28818,
fetched full text) — not a memory-architecture paper per se, but directly
adjacent to the program's north-star claim. Method: ANCHOR, a controlled
synthetic audit, 2,008 conversations across 27 personas, 9 interaction
schedules, **3 generated-memory settings** (long-context, hierarchical
summary, self-managed JSON), 4 models. Two measurements matter most here:
- **Trajectory accuracy — can the model tell what actually happened between
  it and the user from a plausible counterfactual — averages 44.4%** across
  models/conditions, barely above the 25% chance floor for their 4-option
  format. This is a direct measurement of "does the system actually know
  what WE did," and the answer, empirically, is close to chance.
- **The memory-architecture choice does not fix this.** The paper's stated
  finding: "generated memory settings do not erase model differences" —
  swapping which of the three memory architectures backs a given model
  leaves that model's persona-collapse and trajectory-recall pattern largely
  intact (Claude varies <1 point across the three memory settings; GPT-4o-mini
  varies 0.595–0.652). **This is independent, converging evidence for this
  repo's own `charm-grok` / `realtime-azure` finding that the model, not the
  scaffold, sets the ceiling** — here specifically for whether the AI's
  memory of shared history holds up, which is the closest thing found in
  this literature to a direct test of the company's falsifiable claim.
  - https://arxiv.org/abs/2607.28818 / https://arxiv.org/html/2607.28818

**"Contextual Agentic Memory is a Memo, Not True Memory"** (Xu, Dai, Zhang,
arXiv:2604.27707) is the most theoretically pointed critique found, and
worth internalizing even though it wasn't fetched past the abstract/secondary
summary in this pass: it argues every system surveyed above — vector store,
KG, scratchpad, context window — implements **lookup** (retrieval by
similarity to a stored exemplar) not **memory** (weight-level consolidation
that generalizes to inputs never seen before), drawing on Complementary
Learning Systems theory (fast hippocampal exemplar storage + slow neocortical
weight consolidation — biological intelligence runs both, these systems only
run the first). If this framing is right, it implies a hard ceiling: **no
amount of clever retrieval schema converts "WE experienced this" into
something the model *knows* the way it knows its training data** — it only
ever converts it into something retrievable and re-injectable into context,
which inherits every failure mode this repo has already measured for
in-context text (`recited-prompt`, `prompt-position`, `silent-truncation`).
This is a reason for humility about how far "memory architecture" alone can
close the swap-fidelity gap — it may be necessary but not sufficient, and the
identity track's job (layers of identity that can live outside the model) may
matter more than the memory track's job for the "WE" problem specifically.
- https://arxiv.org/abs/2604.27707

---

## What to steal, what to avoid, and why

### Steal

1. **Zep/Graphiti's bi-temporal edge model** (`t_valid`/`t_invalid` +
   `t'_created`/`t'_expired`, supersede-don't-delete). Evidence: arXiv:2501.13956,
   architecture section fetched directly. Why: this is the one mechanism
   surveyed that already solves "what we used to believe vs. what's true
   now" without destroying history — directly useful for a relationship
   that needs to remember *that beliefs changed*, not just current state
   ("you used to think you hated X, then you didn't" is relational content,
   not noise to overwrite).
2. **Per-turn speaker/participant attribution kept non-lossily at the raw
   layer**, even if abstracted away above it (same Zep source). Why: it's
   the cheapest available primitive for eventually building the WE/I split
   — the raw data to distinguish "AI said/did" from "user said/told" already
   exists in this design; it's the retrieval layer that needs building, not
   the storage layer.
3. **Explicit typed split between user-state and companion-self-state**, per
   ZifaMem (arXiv:2607.17564). Evidence: +11.4% pooled EI score, n=208, 4
   backbones, with a stated backbone-dependence caveat. Why: it is the only
   system found that operationalizes the exact distinction the brief asks
   for, and it's cheap to imitate (a typed field, not a new algorithm) even
   though the evidence behind it is thin (one paper, one judge model).
4. **Recency/relevance/importance weighted retrieval and reflection-as-a-
   memory-operation**, per Park et al. 2023. Why: well-established (not a
   2026 pre-print), conceptually simple, and is the direct ancestor of "how
   has our relationship evolved" summarization the brief implies is needed.
5. **HippoRAG's PageRank-over-entities retrieval mechanism** for the
   specific sub-problem of connecting a week-1 detail to a week-30 detail
   with neither in the retrieval window. Evidence: NeurIPS 2024 / ICML 2025,
   Recall@5 89.1% vs 68.2% for embedding baseline on 2WikiMultiHopQA. Why:
   embedding similarity search, which is what most systems above default to,
   structurally fails exactly this multi-hop case, and this is a
   drop-in-different retrieval algorithm, not a different memory schema.
6. **Treat LongMemEval's five abilities (extraction, multi-session, temporal,
   updates, abstention) as the eval spine for Phase C/D**, not LoCoMo. Why:
   §7 above — LoCoMo's answer key is 6.4% measurably wrong and its judge
   accepts 63% of vague-but-wrong answers; LongMemEval has no equivalent
   published audit found in this pass and its numbers are internally
   consistent with independent reuse (Zep). Abstention in particular maps
   directly onto Meera's honest-forget and never-fabricate constraints
   already logged in this repo.

### Avoid

1. **Do not cite LoCoMo leaderboard rank as a purchasing or architecture
   decision without re-running the corrected key.** Evidence: 6.4% of the
   answer key is wrong (Penfield Labs audit), theoretical max ~93.6%, and a
   documented 10-point swing between labs on the *same* competitor's system
   from configuration differences alone (Zep vs Mem0 dispute). This is the
   direct analogue of this repo's own `fab-noise-floor` law — a metric with
   demonstrated noise/error at the 6–60% level is not a metric to build
   architecture decisions on without re-measuring under a harness this lab
   controls end-to-end.
2. **Do not treat vendor blog-post benchmark numbers (Mem0's 92.5/94.4
   LoCoMo/LongMemEval figures, sleep-time compute's 18% accuracy gain) as
   load-bearing without tracing them to a paper's methods section.** Several
   numbers found in this pass exist only in blog posts, not papers, and one
   vendor's own paper (per a secondary source on Mem0) shows full-context
   *beating* the memory system on part of LongMemEval — i.e. the vendor's
   own data contains a negative result its marketing omits.
3. **Do not assume a smarter memory architecture closes the swap-fidelity
   gap on its own.** Evidence: "Best Friends, Not Forever" (arXiv:2607.28818)
   — swapping among three memory architectures left each model's
   persona-collapse and trajectory-recall pattern (44.4% avg, near chance)
   essentially unchanged; the model, not the scaffold, dominated the
   variance, mirroring this repo's own `charm-grok`/`realtime-azure` finding
   in a different domain (memory/identity persistence rather than charm/
   voice). This is the single most important piece of negative evidence
   this track surfaced for the company's central claim: **memory
   architecture is necessary infrastructure, but on current evidence it is
   not sufficient to make identity survive a model swap** — the identity
   track's findings likely matter as much or more.
4. **Do not build a raw-recall-memory system that re-injects retrieved
   conversation text verbatim into the live prompt without rewriting it.**
   Evidence: this repo's own `recited-prompt` law (`context/rejected.md`) —
   sentence-shaped text in a prompt gets recited verbatim (4/5 → 0 after
   removal; taste sentences echoed twice, 8 turns apart). MemGPT-style recall
   memory and most vector-store RAG designs retrieve and reinsert raw text
   by default — this is a structural collision with an already-measured
   failure mode in this exact codebase, not a hypothetical risk.
5. **Do not treat "decay" (Ebbinghaus/Weibull-style forgetting-mechanism
   papers, §9) as solving the product's honest-forget requirement.** These
   mechanisms make retrieval quietly less likely over time; the brief's
   safety invariant (never covertly manipulate, and by extension: don't
   silently lose relational history without saying so) needs *surfaced*
   forgetting, which none of the papers found in this pass address as a
   first-class design goal. This is a gap to design for internally, not
   something to borrow.

---

## Gaps and things not independently verified this session

- MemGPT's original arXiv:2310.08560 was not directly fetched (search-result
  synthesis only).
- Mem0's arXiv:2504.19413 full methods/results section was not successfully
  extracted (fetch returned abstract only); the 92.5/94.4 numbers circulating
  in later blog posts were not traced to a controlled methodology and should
  be treated as unverified marketing until re-checked.
- A-MEM's (arXiv:2502.12110) actual benchmark numbers, the six foundation
  models tested, and its stated limitations were not recoverable — the fetch
  returned only the abstract's qualitative claim. Flagged, not fabricated.
- The forgetting/decay cluster (FSFM, Oblivion, FadeMem, ACT-R-inspired,
  Weibull-governance) is taxonomy-only in this file — no individual paper's
  numbers were independently fetched and verified.
- LangMem and Cognee: no primary academic paper exists for either (both are
  engineering products); numbers cited are architectural claims from
  docs/GitHub, not benchmarked results.
- Web access held up throughout this session — no search or fetch failures
  to report other than PDF-binary fetches that returned unparseable content
  (Zep's PDF; HTML version was fetched successfully as a fallback and used
  instead).
