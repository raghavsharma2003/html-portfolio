# Track: cognitive-arch — what cognitive science knows that an AI-person architecture should borrow

Program: Vyakti relational-state research sweep. Falsifiable claim under test: identity
and relationship can survive a model swap. This track asks what human cognitive
science says memory/identity architecture *should* look like, and where naive
ports of that science into LLM systems have already been tried and broken.

Method note: WebSearch + WebFetch used throughout. Two PDF fetches (raw arxiv PDF
for 2502.06975 and 2205.03854) failed to parse (binary/font-stream garbage) —
noted inline; where that happened I used the abstract page or a secondary
source instead and flag the gap. No claim below is filled from memory where a
fetch failed — I searched again or marked it unresolved.

---

## 1. Episodic / semantic / procedural memory — the base taxonomy

**Citation.** Tulving (1972, 1985) drew the episodic/semantic split; Tulving's
later work adds *autonoetic awareness* — the felt sense of mentally
re-experiencing a moment — as the property that separates episodic recall from
retrieving a free-floating fact. Squire and colleagues (built on the H.M. case
study, Scoville & Milner 1957) established the parallel declarative/procedural
split: declarative (episodic+semantic) depends on medial temporal lobe/
hippocampus; procedural depends on basal ganglia/cerebellum and is learned
gradually, non-consciously, and survives even total declarative amnesia (H.M.
could learn new motor skills with no memory of practicing them).
(https://en.wikipedia.org/wiki/Internal_working_model_of_attachment references
Craik's IWM work; taxonomy summary via
https://www.sciencedirect.com/topics/psychology/procedural-memory and
https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3827554/.)

**Design constraint this implies.** A relational engine needs at minimum three
*functionally distinct* stores, not one undifferentiated "memory" blob:
- **Episodic** — dated, instance-specific: "Tuesday she told me about the
  fight with her sister." Write-heavy, high churn, needs decay.
- **Semantic** — facts distilled out of episodes and stripped of the episode
  that produced them: "her sister and her don't get along." Low churn, should
  NOT re-cite the originating conversation once distilled (that's the
  autonoetic/noetic split — a fact doesn't need to feel remembered to be true).
- **Procedural** — *how she behaves*, not what she knows: turn length, question
  ceiling, register, the taste-consistency table already in `measurements.md`.
  This is closest to what `persona.ts` already encodes as static prompt, and
  Squire's finding that procedural memory is dissociable from and survives
  loss of declarative memory is directly relevant to the swap-test framing:
  **if identity has to survive a model swap, procedural "how she is" is the
  layer most analogous to what H.M. kept — it should be the layer engineered
  hardest for portability, because biology already proved it's the one that
  detaches from the substrate that holds the episodes.**

**CoALA mapping (directly reusable).** Sumers, Yao, Narasimhan & Griffiths,
"Cognitive Architectures for Language Agents" (CoALA), arXiv:2309.02427,
TMLR 2024 — https://arxiv.org/abs/2309.02427, full text via
https://ar5iv.labs.arxiv.org/html/2309.02427 — already did this port for LLM
agents explicitly modeled on Tulving/Squire:

| memory | CoALA def | read | write |
|---|---|---|---|
| working | "active and readily available information as symbolic variables for the current decision cycle" | constant | continuous |
| episodic | "experience from earlier decision cycles" | retrieval into working memory | new experiences logged |
| semantic | "agent's knowledge about the world and itself" | retrieval | LLM-derived facts written in |
| procedural | implicit (weights) + explicit (agent code) | via execution | **designer-only, explicitly flagged risky** |

**CoALA's own warning, load-bearing for this program:** *"updating procedural
memory is significantly riskier than writing to episodic or semantic memory, as
it can easily introduce bugs or allow an agent to subvert its designers'
intentions."* CoALA also flags that current language agents treat memory as
**mostly read-only with a fixed, designer-set learning schedule** — a real
departure from biological memory, which continuously trades learning against
acting. That gap is exactly the phase-C build problem: *when* does the engine
consolidate, and who decides.

---

## 2. Event segmentation theory — how continuous experience becomes discrete episodes

**Citation.** Zacks & Swallow and the broader Event Segmentation Theory (EST)
literature, e.g. Zacks, Speer, Swallow, Braver & Reynolds, "Event Perception: A
Mind-Brain Perspective," Psychological Bulletin 2007 —
https://bpb-us-e2.wpmucdn.com/sites.wustl.edu/dist/e/952/files/2017/09/zackspsychbull07-sbm4za.pdf
(fetched and parsed).

**Core mechanism.** Perceptual systems continuously predict what happens next.
An event boundary is perceived when there's a transient *spike in prediction
error* — not a fixed clock, not a topic change per se, but a moment the running
model of "what's happening" stops working. People hold a **working "event
model"** containing current perceptual detail plus relevant episodic/semantic
knowledge (goals, characters, causes); a boundary triggers replacing that model
with a new one. Events are also **hierarchical** — coarse events ("having
dinner") contain fine sub-events ("cutting food") simultaneously, and which
level is salient depends on task/attention. Critically: **information at event
boundaries is preferentially encoded and better remembered later** — boundaries
are where memory consolidation attaches most strongly.

**Design constraint this implies.** The chat/call transcript is not naturally
"episodes" — it's a token stream. An LLM-agent memory system that just chunks
by session-length or wall-clock time (most current systems, see §6) is
segmenting on the wrong signal. EST says the segmentation signal should be
**model-of-the-conversation prediction error**, operationalized as: topic
shift, emotional-state shift, goal shift (a request resolved or introduced), or
a scene/context change (a call ending, a screen-share starting). This is
directly measurable with the same extraction call that already exists
(`extract-model` in decisions.md) — the boundary detector and the "what's worth
remembering" detector can be the *same* judgment call, because EST predicts
they attend to the same signal (prediction error / goal change).

**Second, sharper implication:** EST predicts *boundaries themselves* should be
weighted for retention — the moment a call ends, the moment a fight resolves,
the moment a screen-share reveals something surprising, is where a human
memory system spends its consolidation budget disproportionately. A flat
recency- or importance-score retrieval formula (see Generative Agents, §6) has
no notion of "this was a boundary" as a separate salience channel from
"this was emotionally intense." They should probably be two different features
feeding the same write-decision, not conflated into one importance score.

---

## 3. Consolidation and reconsolidation

**Citation — consolidation/replay.** Complementary Learning Systems theory
(McClelland, McNaughton & O'Reilly 1995; updated by Kumaran, Hassabis &
McClelland 2016, "What Learning Systems do Intelligent Agents Need? CLS Theory
Updated," https://www.sciencedirect.com/science/article/abs/pii/S1364661316300432).
Two systems: **hippocampus** does fast, one-shot encoding of specific episodes;
**neocortex** does slow, interleaved, generalized learning. Sleep replay
transfers hippocampal traces to neocortex in **interleaved** order specifically
to avoid catastrophic forgetting — replaying everything in original temporal
order (not interleaved) is what causes catastrophic interference in both
biological and artificial nets when tried naively.

**Citation — reconsolidation.** Nader, Schafe & LeDoux (2000) and Nader's later
reviews (e.g. "An Update on Memory Reconsolidation Updating,"
https://www.sciencedirect.com/science/article/abs/pii/S1364661317300785):
retrieving a consolidated memory returns it to a **labile** state; it must be
re-stabilized, and during that window it can be *edited* by new information
(extinction, counterconditioning, interference). This is the mechanism by
which "what actually happened" drifts every time it's recalled — memory is not
a write-once log, it's rewritten at every retrieval.

**Design constraints this implies, two separable ones:**
1. **Consolidation needs an offline, batched, interleaved pass** — not
   per-turn commits straight into a flat "memories" table. A nightly (or
   idle-triggered) consolidation job that (a) segments the day's transcript
   into episodes per §2, (b) distills semantic facts out of episodes, (c)
   interleaves new material with old during any embedding-index rebuild or
   summarization pass to avoid the LLM-analogue of catastrophic forgetting
   (topic drift overwriting old persona-relevant facts — this is a real
   failure mode in long-context summarization chains, not just a biological
   curiosity).
2. **Reconsolidation is a feature to design FOR, not a bug to prevent.**
   If Meera is later told "actually I never said that" or a fact is
   corrected, the honest-forget invariant already in this repo's persona
   design is cognitively correct: real memory doesn't preserve an immutable
   ground truth, it updates the trace at the point of retrieval. The design
   risk is the opposite direction — an engine that treats early episodic
   writes as immutable audit log will feel *less* human than one that lets
   later corrections overwrite earlier interpretation, provided the overwrite
   is honest (stated, not silently substituted — silent substitution is a
   trust violation, not a cognitive-fidelity one).

---

## 4. Emotional salience weighting

**Citation.** LaBar & Cabeza, "Cognitive Neuroscience of Emotional Memory,"
Nature Reviews Neuroscience 2006 (https://www.nature.com/articles/nrn1825);
McGaugh 2004 consolidation-modulation hypothesis. Mechanism: amygdala
activation at encoding **modulates hippocampal consolidation strength** —
emotionally arousing events get preferentially consolidated, largely via
increased attention/deeper encoding (narrowed, deepened processing) rather
than a separate storage channel. Cost: **arousal narrows attention**, so
emotional events are remembered better for their *gist and central content* but
*worse* for peripheral detail — a real, measured trade-off, not a pure win.
(https://pmc.ncbi.nlm.nih.gov/articles/PMC5049500/, "The amygdala and
prioritization of declarative memories.")

**Design constraint this implies.** An importance/salience score at write time
should scale retention probability and consolidation priority, matching the
existing `taste-consistency` framing in this repo (specific stated
preferences get a table row; general topics don't). But the *cost* half needs
porting too and is usually skipped: emotionally intense turns should be
expected to produce **worse peripheral-detail extraction** even from a
"judgement" extraction model — i.e., don't trust the extractor's fidelity on
peripheral facts stated during a crisis-adjacent or highly charged turn as much
as during a calm one, and consider a lower-confidence write or a follow-up
re-ask rather than treating extraction confidence as uniform across emotional
register. This is untested here — flagged as a design hypothesis, not a
measured finding for this product.

---

## 5. Forgetting curves and their function

**Citation — descriptive.** Ebbinghaus's power-law forgetting curve, and its
adaptive reinterpretation: Anderson & Schooler (1991), "Reflections of the
Environment in Memory," and the fuller rational-analysis treatment in
Schooler & Anderson, "The Adaptive Nature of Memory" (ACT-R lab reprint:
http://act-r.psy.cmu.edu/wordpress/wp-content/uploads/2021/07/SchoolerAnderson2017.pdf).
Finding: forgetting curves are **power functions that mirror the statistical
structure of real-world need** — how often a word recurs in NYT headlines
predicts memory-need decay the same way spaced-repetition intervals predict
recall. Forgetting is not a storage failure; it's the memory system tracking
*"how likely am I to need this again,"* and it tracks it well.

**Citation — the "why forget at all" question.** Richards & Frankland, "The
Persistence and Transience of Memory," Neuron 94(6), 2017
(https://sherpapg.com/wp-content/uploads/2017/12/Persistance-and-Transience-of-Memory-STUDY.pdf).
Claim: transience is *adaptive*, not a defect — an agent that never forgets
becomes "cognitively overfit" to its own past and can't generalize or adapt
when the present differs from precedent. The goal of memory, on this account,
is not accurate transmission of the past but optimized *future* decision-making.

**Design constraint this implies, and it directly contradicts a naive
instinct.** The obvious design for "she remembers everything, forever, because
that proves she's real" is the wrong target on this science. Two separable
recommendations:
- **Forgetting needs a retrieval-need model, not a TTL.** Anderson &
  Schooler's finding suggests decay-by-recency-and-frequency-of-relevance
  (approximating "how likely is this to come up again") beats decay-by-age
  alone. A fact mentioned once six months ago that keeps getting relevant
  ("her sister" comes up whenever family does) should NOT decay the same as a
  fact mentioned once and never touched again.
- **Total recall is not the fidelity target — appropriate forgetting is.**
  If the swap-test protocol (track 9) ever measures "does the new model
  remember everything the old one did," that is measuring the wrong thing per
  this literature; a *human* partner doesn't recall everything either, and an
  AI that does will read as an inhuman surveillance log, not a person. The
  fidelity target should include a forgetting profile that resembles a real
  relationship's forgetting profile (retains emotionally salient + repeatedly
  relevant + recent; loses one-off low-salience detail on a power-law decay),
  not maximal recall.

---

## 6. Relationship schemas and social memory — "us" vs "them" knowledge

**Citation.** Baldwin (1992), "Relational Schemas and the Processing of Social
Information," Psychological Bulletin — https://www.researchgate.net/publication/232466680
and Baldwin (1997), "Relational Schemas as a Source of If-Then Self-Inference
Procedures." Core construct: a **relational schema** is not "facts about the
other person" and not "facts about the self" — it's a third, distinct
structure: an **if-then interaction pattern** ("if I show vulnerability, she
responds with warmth, not judgment") bundled with a self-in-relation-to-them
representation ("with her I am the one who over-explains"). This is
Baldwin's "relational self" — self-knowledge is stored *linked to* specific
significant others, at multiple levels of specificity, contextually
activated.

**Citation — the developmental root of the same construct.** Bowlby's
internal working model (IWM) of attachment: a paired model of self and of the
attachment figure, generating forecasts about the figure's availability and
responsiveness (https://en.wikipedia.org/wiki/Internal_working_model_of_attachment).
Notably Bowlby's own inspiration (via Kenneth Craik) was proto-AI systems
theory — internal models that let an organism predict its environment. This
is a case where cognitive science borrowed FROM a systems/AI framing
originally, which is worth knowing before assuming the current borrowing
direction (cog-sci → AI) is the only one that ever ran.

**Design constraint this implies — this is the one most under-built in typical
"AI memory" stacks.** Current LLM-agent memory systems (CoALA episodic/semantic,
Generative Agents' memory stream) store **facts about the user** and **facts
the agent has said**, but not, as a first-class object, **the interaction
pattern between them** — the if-then relational rule itself. A relational
engine for Meera needs a third memory class, or a semantic-memory subtype,
that is not "user facts" (her mother's name) and not "world facts" but
**relationship facts**: "he goes quiet before he says something honest, don't
fill the silence"; "teasing lands with him, sympathy reads as pity." This maps
onto what `persona.ts`'s taste table already half-does for *her* preferences,
but Baldwin's construct is specifically about the *dyad*, not either party
alone — it should probably be its own table, written to by the same
consolidation pass but retrieved differently (activated by relational context —
"we're in a moment like X" — not by topic keyword).

---

## 7. Parasocial relationship research

**Citation — foundational.** Horton & Wohl (1956) coined parasocial
interaction: a one-sided bond formed with a media figure who does not know the
viewer exists. Modern reviews (systematic review:
https://www.sciencedirect.com/science/article/pii/S2949882126000757) note AI
companions break the original one-sidedness assumption: the system *does*
respond, personalize, and simulate contingent responsiveness — some recent
literature (e.g. the emergentmind topic summary) calls this **"interactive
parasociality"** rather than classical PSI, because reciprocity is simulated,
not absent.

**Citation — attachment-specific empirical work.**
- Hu, Lan, Yan & Chen (2025), "What Makes You Attached to Social Companion
  AI? A Two-Stage Exploratory Mixed-Method Study," *Int'l J. of Information
  Management* 83 (https://www.sciencedirect.com/science/article/pii/S0268401225000222,
  DOI 10.1016/j.ijinfomgt.2025.102890). Framework: personification perception
  + interpersonal dysfunction (of the user) are the driving factors for
  intimate human-AI interaction; a **social-exchange / cost-benefit**
  mechanism governs how attachment manifests once formed.
- A three-wave panel study on attachment style and AI companion use
  (https://www.tandfonline.com/doi/full/10.1080/10447318.2026.2618548):
  attachment **anxiety** predicts *more* AI companion use over time;
  attachment **avoidance** predicts *less*. This is a real longitudinal (panel)
  design, not cross-sectional — directionally suggestive that anxiously
  attached users are both the most retainable and the most exposed
  population.
- A three-stage developmental framework (functional expectation → emotional
  evaluation → establishing representations) is proposed as a **theoretical
  review, not an empirical study** — https://pmc.ncbi.nlm.nih.gov/articles/PMC12932595/
  — flagged here explicitly as synthesis-of-literature, not new data.
- Search summaries surfaced a claim that "moderately relationship-seeking AI
  generates maximal liking/attachment without commensurate psychosocial
  benefit" — **I could not independently verify the primary source or n for
  this claim** (the arxiv longitudinal-companionship paper it likely traces to,
  arXiv:2510.10079, exceeded the fetch tool's size limit and I could not
  re-fetch a working excerpt in the time available). **Flagging this as
  unverified — do not treat as load-bearing.**

**Design constraint this implies.** Two, and they sit in tension with the
business goal:
- The "interactive parasociality" framing legitimizes treating this as a
  *relationship* system (not merely a *personalization* system) architecturally
  — the if-then relational-schema memory class in §6 is the right level of
  abstraction because the research literature itself has moved past treating
  this as classic one-sided PSI.
- The panel-study finding (anxious attachment → more use) is a **safety-shaped
  constraint on the architecture**, not just a growth lever: a system that
  optimizes purely for engagement/retention will disproportionately deepen
  bonds with the most vulnerable-to-overattachment users. This is squarely
  inside this repo's existing NEVER MANIPULATE invariant — the finding is
  evidence for why that invariant has teeth, not just a compliance checkbox.
  Any consolidation/relational-schema system built here should log itself
  against, not optimize against, users showing anxious-use patterns.

---

## 8. Cognitive architectures (SOAR, ACT-R, CLARION) — what survived, what didn't

**Note on sourcing quality here.** The primary Soar paper (Laird 2022 intro,
arXiv:2205.03854) and one comparison PDF failed to parse via WebFetch (raw
binary/font-stream garbage from the tool, and a 503 from roboticsbiz.com on
retry) — findings below rely on WebSearch snippets and secondary summaries,
which is weaker sourcing than the rest of this file. Flagged per-claim.

**What has held up (moderate confidence, secondary sourcing):**
- **SOAR** — real-time decision cycles (~50ms) even against long-term memories
  scaled to millions of items; the production-rule / chunking mechanism (a
  fired rule sequence compiles into a single new rule, i.e. procedural
  learning from repeated deliberate problem-solving) is the part most often
  cited as SOAR's durable contribution and maps directly onto Squire's
  procedural memory (§1) — repeated *explicit* interaction compiling into
  *implicit* behavior is a real, reusable design pattern: whatever gets
  repeated across many episodic instances (not stated once) should migrate
  toward procedural-memory (persona-level, static-prompt) status rather than
  staying as retrieved episodic content forever. This is effectively what
  `taste-consistency`'s "more rows, not more prompt" fix in this repo's own
  measurements.md already discovered empirically, converging with SOAR's
  chunking idea from a different direction.
- **ACT-R** — emphasizes tight coupling to measured human timing data (its
  claim to fame is quantitatively fitting reaction-time and error-rate curves,
  not just qualitative behavior) and explicit declarative/procedural memory
  modules with activation-based decay and spreading activation for retrieval —
  i.e., ACT-R's retrieval mechanism is essentially Anderson & Schooler's
  rational-analysis forgetting curve (§5) built directly into the
  architecture, since Anderson is also the ACT-R author. This is a genuine
  point of convergence worth citing: the same lab produced both the
  adaptive-forgetting theory and the cognitive architecture that operationalizes
  it, so "decay activation by recency × frequency of relevance" (§5) is not a
  novel synthesis on my part — it is literally how ACT-R's declarative memory
  module scores retrieval, and it is empirically fit against real human data.
- **CLARION** — its distinguishing claim is an explicit-implicit dual-process
  split at the architecture level (not just at the memory-type level): a
  top-level explicit reasoning system and a bottom-level implicit associative
  system, with skills moving between them through top-down and bottom-up
  learning. CLARION's organizational-behavior simulations reportedly matched
  human data patterns (e.g. distributed vs. hierarchical team structure
  effects) — cited as validated but from a single secondary summary, weak
  sourcing.

**What did not survive contact with reality (this is the honest gap in my
sourcing):** WebSearch results describe *general* criticism — "limited size
and homogeneous typology of encoded knowledge, which restricts realism and
explanatory power" (a 2020s-era knowledge-representation critique of all
three) — but I was not able to pull a primary source detailing *specific*
abandoned SOAR/ACT-R/CLARION mechanisms (e.g., which memory or learning
modules were tried and dropped across their multi-decade histories). **This
sub-question is not answered to the standard the rest of this file meets.**
Anyone building on this should re-run this specific search with working PDF
access rather than trust the summary above beyond "these architectures are
widely used but face knowledge-representation limits."

**Design constraint, net of the above.** The one load-bearing, well-sourced
takeaway from this section: **procedural memory (behavior) should be the
compilation target of repeated episodic signal, not a separately hand-authored
list that episodic memory never feeds.** Concretely: the consolidation job
(§3) should have a path where a pattern that recurs across N distinct episodic
writes gets promoted into the static persona/procedural layer (the
`persona.ts`-equivalent in the new architecture), the same way SOAR chunks
repeated deliberate sequences into automatic productions and the way this
repo's own `taste-consistency` fix already did by hand ("more rows, not more
prompt").

---

## 9. Where naive ports of human memory theory to LLM systems have already failed

This is the section most directly load-bearing for the swap-test / architecture
design, because it is evidence, not theory.

**9.1 — Importance-score inflation (Generative Agents, Park et al. 2023).**
The Stanford "Generative Agents" architecture (memory stream + recency-decay +
embedding-relevance + LLM-self-rated importance, then periodic "reflection"
synthesis) is the most-cited LLM port of human-memory theory. Reported failure
modes, per multiple secondary sources
(https://agentpatterns.ai/agent-design/generative-agents-memory-stream/,
https://memx.app/glossary/generative-agents/):
- **Importance inflation**: an LLM asked to self-rate importance on a scale
  consistently rates most things near the top, collapsing the importance
  signal — the "emotional salience weighting" mechanism from §4 does not
  transfer for free just by asking a model to imitate it; it requires
  calibration (anchors, comparison sets, or a non-self-referential scorer)
  that biological amygdala-driven salience doesn't need because it isn't a
  self-report.
- **Reflection hallucination**: the "distill episodes into semantic facts"
  step (directly the episodic→semantic consolidation mechanism §1, §3) 
  produces plausible-but-false generalizations when underlying episodes are
  noisy — i.e., consolidation without a grounding/citation requirement
  fabricates. Mitigation reported in the wild: forcing each reflection to cite
  concrete source episodes (a "why do you believe this" trace), which is not
  how biological consolidation works but is a *necessary* compensating control
  for a system whose consolidator can confabulate in ways hippocampal replay
  structurally cannot.
- **Stream bloat**: LLM-based importance scoring becomes the throughput
  bottleneck once memories reach the tens-of-thousands scale — a cost/latency
  failure mode with no direct biological analogue, because biological memory
  doesn't pay an inference-cost tax per write.

**9.2 — Memory hallucination as the dominant agent-memory failure class.**
Multiple 2025-2026 benchmark papers found on this sweep (titles only
skimmed via WebSearch, not independently fetched — flagged as lower
confidence): a breakdown of MemGPT-style agent failures attributes roughly
**58.9%** of non-timeout failures to memory hallucination (partial-memory,
process-memory, output-memory hallucination subtypes), ahead of knowledge
deficiency or intent misunderstanding. **This figure is from a WebSearch
summary of a paper I did not fetch and read directly — treat the exact
percentage as unverified, but the qualitative finding (memory hallucination,
not memory absence, is the dominant LLM agent-memory failure mode) recurs
across enough independent sources in this sweep to trust directionally.**

**9.3 — The general shape of the failure, stated once.** Every LLM-native
"memory" implementation is doing consolidation, retrieval-scoring, and
importance-weighting *by asking an LLM to imitate the output* of a biological
process, not by replicating the process's actual constraints (interleaved
offline replay, amygdala-independent-of-self-report salience tagging,
hippocampal pattern separation that prevents write interference). The result
is a system that inherits the *vocabulary* of human memory theory (episodic,
semantic, importance, reflection) without inheriting the *error-correction
structure* that keeps biological memory from confabulating at write time. Any
claim that this architecture "has episodic memory" or "does consolidation"
should be read as a metaphor borrowed for organizational clarity, not as
evidence the failure modes of naive LLM memory (hallucinated facts,
self-report-inflated importance, ungrounded reflections) have been solved by
adopting the vocabulary. **They have not been solved by vocabulary alone in
any source found this sweep** — solving them required an explicit grounding/
citation mechanism bolted on top, which is itself the actionable design
takeaway: **any consolidation step in this architecture must require
citation of source episodes for every derived semantic/relational fact, or it
will confabulate the same way Generative Agents' reflection step did.**

**9.4 — A speculative, low-confidence data point flagged for what it is.**
A single-author arXiv preprint (Menon, "Persistent Identity in AI Agents: A
Multi-Anchor Architecture for Resilient Memory and Continuity,"
arXiv:2604.09588, submitted March 2026,
https://arxiv.org/abs/2604.09588) proposes exactly this program's core
claim — identity anchored across episodic/semantic/behavioral/value layers
surviving a model swap — grounded partly in Locke's and Parfit's philosophy
of personal identity. **This is not peer-reviewed, is single-author, and its
own stated limitations include "context window constraints forcing anchor
degradation," "inconsistency when anchors conflict during model transitions,"
and "risk of identity drift under extended deployment"** — i.e. even this
paper's own author does not claim the mechanism is validated, only proposed.
Cited here because it is the closest existing published attempt at this
company's exact falsifiable claim, and because its four-anchor taxonomy
(episodic/semantic/behavioral/value) is a reasonable starting decomposition
to test against — but **nothing in it should be treated as evidence the
approach works; it is a proposal, not a measurement**, consistent with
this repo's house rule that claims need n and method.

---

## Summary table — principle → citation → concrete constraint

| principle | citation | design constraint |
|---|---|---|
| episodic/semantic/procedural split | Tulving 1972/1985; Squire (H.M., Scoville & Milner 1957) | three distinct stores with different write/decay/retrieval rules, not one memory blob |
| CoALA's LLM-agent port of the above | Sumers et al. 2024, arXiv:2309.02427 | procedural-memory writes are the riskiest and should be designer-gated; memory is currently mostly read-only in practice — decide explicitly who/what triggers writes |
| event segmentation (prediction-error boundaries) | Zacks et al., Psych Bull 2007 | segment episodes on model-of-conversation prediction error (topic/emotion/goal shift), not wall-clock chunking; boundaries deserve their own salience weight, separate from emotional intensity |
| complementary learning systems (hippocampus/neocortex, interleaved replay) | McClelland et al. 1995; Kumaran et al. 2016 | consolidation must be an offline, batched, interleaved pass, not per-turn flat writes |
| reconsolidation (retrieval destabilizes and edits) | Nader et al. 2000 | honest correction of memory on retrieval is cognitively correct, not a bug; silent substitution is the actual trust violation |
| emotional salience weighting | LaBar & Cabeza 2006; McGaugh 2004 | scale retention/consolidation priority by arousal, but discount peripheral-detail extraction confidence on high-arousal turns |
| adaptive forgetting curves | Anderson & Schooler 1991; Schooler & Anderson (ACT-R) | decay by recency × frequency-of-relevance (need probability), not by age alone; total recall is the wrong fidelity target for the swap test |
| forgetting is functionally adaptive | Richards & Frankland, Neuron 2017 | don't optimize the architecture toward maximal recall; an AI that remembers everything reads as surveillance, not partnership |
| relational schemas (if-then interaction patterns, dyad-specific) | Baldwin 1992, 1997 | needs a third memory class beyond user-facts/world-facts: relationship-pattern facts, retrieved by relational context not keyword |
| attachment internal working models | Bowlby (via Craik) | self-model is inseparable from figure-model; store them paired, not as independent tables |
| parasocial / human-AI attachment | Horton & Wohl 1956; Hu et al. 2025; three-wave panel study (Tandfonline 2026) | anxious-attachment users use more and are most exposed — engagement-optimization and NEVER MANIPULATE are in tension here, log against not toward this pattern |
| cognitive-architecture procedural compilation (SOAR chunking / ACT-R activation decay) | Laird (Soar); Anderson (ACT-R) — weak/secondary sourcing, flagged | repeated episodic patterns should compile into procedural/persona-layer content, mirroring this repo's own `taste-consistency` fix |
| naive LLM memory ports fail via confabulation, not absence | Generative Agents failure reports; MemGPT-family hallucination-taxonomy papers (secondary sourcing) | every consolidation/reflection step must cite grounding episodes or it will fabricate — this is the single most actionable, most evidenced constraint in this file |

---

## Explicit gaps (do not treat as covered)

- **SOAR/ACT-R/CLARION "what was abandoned"** — could not get primary-source
  detail; PDF fetches failed twice, secondary sources only gave generic
  present-day critique, not architectural history. Needs a re-run with working
  full-text access.
- **The "moderately relationship-seeking AI → maximal attachment without
  benefit" claim** — surfaced in a WebSearch snippet, likely traces to
  arXiv:2510.10079, which I could not fetch (exceeded tool size limit) and
  could not re-verify from a smaller excerpt in the time available. Not
  included as load-bearing.
- **Exact reflection/importance-inflation numbers and the 58.9% memory-
  hallucination figure** — both from WebSearch summaries of papers I did not
  independently fetch and read in full. Directionally consistent across
  multiple independent sources in this sweep, but the precise figures are
  secondhand and should be re-verified against the primary papers before
  being quoted in SPEC.md as a measured number.
- **No sleep/replay-analogue latency or cost modeling attempted** — CLS theory
  implies an offline consolidation pass, but I did not investigate what that
  costs computationally for an LLM-based system at this product's scale; that
  is an engineering question for the memory-arch or repo-audit track, not
  answered here.
