# RESEARCH.md — Phase A synthesis, Vyakti relational-state program

Synthesized 2026-08-13 from ten verified track files in this directory:
`memory-arch.md`, `cognitive-arch.md`, `identity.md`, `lab-products.md`,
`multimodal-state.md`, `india.md`, `market-verify.md`, `repo-audit.md`,
`swap-test.md`, `safety-reg.md`. Load-bearing claims were independently
verified; corrections are applied inline and listed plainly in §7. House
style: every claim carries a source and n where one exists; where evidence is
secondary, inferred, or thin, it says so. The falsifiable claim under test:
**an AI person's identity and relationship can be made to survive replacement
of the model underneath her.** Currently measured FALSE (`charm-grok`,
`realtime-azure` in `context/measurements.md`).

---

## 1. State of the art, verified

### 1.1 The central negative result: the model sets the ceiling, and no shipped scaffold lifts it

- **Internal, controlled (the only byte-identical-prompt swap measurements
  found anywhere, internal or external):** `charm-grok` — same prompt, two
  models, blind counterbalanced judging: personhood 34–4, warmth 35–3, humour
  31–2 for the incumbent; mechanism visible in surface stats (36.1 vs 20.5
  words/turn). `realtime-azure` replicated the collapse shape on voice
  (41→53 words/turn, spoken-register markers 4/24). [identity.md §0,
  repo-audit.md §0]
- **External replications of the direction (none of the exact design):**
  PersonaGym (arXiv:2407.18416): GPT-4.1 ties LLaMA-3-8B on PersonaScore —
  persona fidelity is not a capability proxy. Identity-drift study
  (arXiv:2412.00804, 9 models): larger models drifted MORE; assigning a
  persona did not stabilize identity (secondary-sourced, PDF undecodable).
  RPEval (arXiv:2505.13157): GPT-4o in-character consistency 5.81% vs
  Gemini-1.5-Pro 59.75% on the same benchmark (secondary summary; primary
  mirror 403'd). [identity.md §2–3]
- **ANCHOR / "Best Friends, Not Forever" (arXiv:2607.28818, full text
  fetched, verified with correction):** 2,008 conversations, 27 personas, 3
  memory architectures, 4 models. Swapping the memory architecture under a
  model does NOT erase that model's persona-collapse pattern (Claude varies
  <1pt across memory settings, 0.763–0.766; GPT-4o-mini varies 0.595–0.652).
  Trajectory recall of actual shared history vs a plausible counterfactual
  averages 44.4% — above the 25% chance floor (the earlier "barely above
  chance" characterization was a misstatement; the paper reserves at-chance
  language for its separate user-state recall metric, 0.214–0.250, which IS
  at/below chance). Net: memory-architecture choice does not move the
  identity ceiling; the model does — and the system's knowledge of the
  user's state is the weakest measured axis. [memory-arch.md §10, corrected
  per verification]
- **Real-world, large-n confirmations (natural experiments, not controlled):**
  Character.AI's PipSqueak 2 base-model swap (Apr 2026) — shipped explicitly
  to improve "character consistency, better memory," produced a mass revolt
  (8 r/CharacterAI threads >2,000 upvotes in 30 days, dominant complaint
  "feels like ChatGPT"). Replika's Feb 2023 ERP removal — De Freitas et al.
  (HBS WP 25-018 / arXiv:2412.14190, IRB'd, partly pre-registered): negative
  posts/day 22.9→140.9 (d=1.16) across 12,793 posts; free-tier users whose
  feature set did NOT change still reported their Replika's "personality
  changed"; identity-discontinuity mediates mourning/devaluation (Study 4,
  n=320, η²=0.34). [lab-products.md, swap-test.md §1.1]
- **The countervailing datum:** Surge AI's double-blind audit of GPT-4o vs
  GPT-5 (850 conversations, 490 evaluators): blind preference 48% vs 43%,
  9% tie — near-tie under blinding for a swap that produced public grief
  unblinded. Public swap reaction is dominated by loss-framing and removed
  choice, not raw discriminability. Detection must be measured against a
  sham arm or it measures mood. [swap-test.md §1.2]

### 1.2 The one measured positive portability result

`taste-consistency` (internal, n=480 live turns): moving one identity layer
(opinions) out of generated prose into a small authored, deterministically
retrieved table took self-agreement 13/48→30/48, register defects 13/96→0/32,
100/100 reproducible offline. Residual inconsistency is attributed to missing
table rows — a data-coverage problem, not a model-fidelity problem. This is
the strongest evidence in the entire sweep that a layer of identity can be
made independent of what the model feels like doing. [identity.md §0,
repo-audit.md §1b]

### 1.3 Memory systems: what actually exists

- **Zep/Graphiti bi-temporal knowledge graph (arXiv:2501.13956, full text,
  VERIFIED):** four timestamps per edge (t'_created/t'_expired ingestion
  timeline; t_valid/t_invalid real-world timeline); contradictions invalidate
  the old edge (t_invalid set) rather than deleting it — belief history is
  preserved, not just current state. Episode subgraph keeps per-turn speaker
  attribution non-lossily; the retrieval/scoring layers above throw it away.
  LongMemEval: 71.2% vs 60.2% baseline (gpt-4o), latency −90%. Closest
  existing OSS substrate; the WE/I distinction is not in it. [memory-arch.md
  §2]
- **MemGPT/Letta (VERIFIED):** three-tier core/recall/archival is a paging
  model — where text lives, not what kind of fact it is. Recall memory
  reinserts raw retrieved conversation text into context — a structural
  collision with this repo's measured `recited-prompt` law (4/5 verbatim echo
  before fix, 0 after). [memory-arch.md §1]
- **HippoRAG (NeurIPS 2024/ICML 2025):** Personalized-PageRank-over-entities
  retrieval, Recall@5 89.1% vs 68.2% embedding baseline on 2WikiMultiHopQA —
  the mechanism to steal for week-1-to-week-30 multi-hop connection; no
  temporal or participant layer. [memory-arch.md §4]
- **Generative Agents (Park et al. 2023):** recency×relevance×importance
  retrieval + reflection-as-memory-operation. Documented failure modes:
  importance-score inflation from LLM self-rating; reflection hallucination
  unless each reflection must cite source episodes; per-write LLM-scoring
  cost. [memory-arch.md §8, cognitive-arch.md §9.1]
- **Benchmarks are not currently trustworthy rankings (VERIFIED with
  caveats):** LoCoMo's answer key has 99 score-corrupting errors in 1,540
  questions (6.4%); theoretical max on the corrected key ~93.6%; its
  gpt-4o-mini judge accepted 62.81% of intentionally wrong-but-topic-adjacent
  answers. Caveat from verification: the auditor (Penfield Labs) sells a
  competing benchmark and the audit is self-published — figures verified as
  quoted, conflict of interest undisclosed. Zep's re-run of Mem0's harness
  moved Zep's own LoCoMo score 65.99%→75.14% from two implementation errors
  (role mis-assignment, timestamp handling; a third difference affected
  reported latency only, not accuracy — the earlier "three errors, one
  conclusion" framing was overstated, and "cross-lab numbers aren't
  reproducible" is this sweep's inference, not the source's claim). Use
  LongMemEval's five abilities (extraction, multi-session, temporal, updates,
  abstention) as the eval spine, not LoCoMo. [memory-arch.md §7, corrected
  per verification]
- **The theoretical ceiling argument (arXiv:2604.27707, scope corrected):**
  every architecture the paper surveys — vector stores/RAG, scratchpads,
  context-window management (it does NOT cover knowledge graphs, contrary to
  the sweep's earlier phrasing) — implements retrieval-by-similarity
  ("lookup"), not weight-level consolidation ("memory"), per Complementary
  Learning Systems theory. Retrieval schema alone cannot make shared history
  something the model *knows* the way it knows training data; it only makes
  it re-injectable text, inheriting every in-context failure mode this repo
  has measured. [memory-arch.md §10, corrected per verification]

### 1.4 What the labs ship (primary-sourced teardown)

Fact retention is solved everywhere: ChatGPT (Model Set Context + ~40-entry
chat-history injection, observed by independent testing), Claude memory tool
(client-side file ops — the only architecture where state is structurally
model-independent, built for coding agents, never pointed at
personality/relationship), Gemini (compressed profile, secondary-sourced
only), Nomi, Kindroid (most granular public stack; all of it resets on a
"chat break"). Nobody has shipped or even attempted a designed swap-fidelity
mechanism; the two best data points are accidents (PipSqueak 2, Replika ERP).
OpenAI's own forum documents the gap in one sentence: under GPT-5 the same
stored facts recall correctly but chats "feel more like starting fresh" —
fact-persistence and relational-feel are separable and only the first is
solved. [lab-products.md]

### 1.5 Multimodal state (verified numbers where readable)

- No streaming multimodal API persists multimodal state. Gemini Live: 128k
  shared window, audio 25 tok/s, video 258 tok/s (~15 min audio-only, ~2 min
  audio+video uncompressed); compression evicts oldest frames first;
  resumption window ~10 min. OpenAI Realtime: stateless past the transcript.
  Extract-during-the-turn-and-persist is the only architecture that exists in
  the field, not a workaround. [multimodal-state.md §4]
- EchoMind (arXiv:2510.22758): only 3/12 models exceed 60% accuracy
  perceiving vocal cues from raw audio, but handing the correct cue as text
  lifts GPT-4o-Audio's empathy quality 3.34→4.42/5 — the bottleneck is
  perception, not generation. Symbolic affect tags injected as text are the
  field's convergent representation and the only model-swap-compatible one.
  [multimodal-state.md §1.1]
- Voice: familiarity beats fidelity — listeners familiar with a voice rate
  its clone as less trustworthy than a recording; unfamiliar listeners show
  the opposite (n=47+47, secondary-sourced, 403 on primary). This is the
  external analogue of the repo's `voice-ears` result (Azure won every
  measured axis and was rejected by ear). Any future voice eval must gate on
  a familiar-listener judge, with a canonical speaker embedding as a cheap
  pre-filter only. [multimodal-state.md §2]

### 1.6 India (the schema gap is real)

No academic corpus matches casual intimate romanized Hinglish (LinCE/GLUECoS/
IndicNLP all skew structural or formal; GLUECoS transliterates romanized text
away; Indi-RomCoM confirms LLMs degrade as romanized code-mixing density
rises). No literature found on any system tracking a T-V/honorific variable
as explicit conversational state — genuinely unbuilt, not un-found. Indian
companion products (Rumik/Ira ~$6.5M raised across two rounds; Companion
Labs/Mello $2.5M, possibly pivoted) publish no relational-state technical
detail. [india.md §1, §3, §6]

### 1.7 Regulatory (architecture-shaping, dated)

China's Interim Measures (effective 2026-07-15) forced Doubao/Qwen to shut
down companion personas — a regulator-forced identity discontinuity at
hundreds-of-millions scale, the exact failure Vyakti exists to prevent. CA
SB 243 (in effect 2026-01-01, private right of action $1,000/violation) and
NY's law (2025-11-05) both mandate recurring 3-hour AI-disclosure — a
session-clock mechanism, not a persona rule. DPDP Rules notified 2025-11-13;
substantive obligations (retention, deletion, rights) bind 2027-05-13.
FTC 6(b) inquiry (2025-09-11, seven companies) makes persona design,
engagement mechanics, and testing practice an audit surface. [safety-reg.md,
market-verify.md Table 2]

---

## 2. Commoditizing vs durable

| Layer | Verdict | Evidence |
|---|---|---|
| Base-model charm/warmth/fluency | **Commoditizing — and never ours.** | It swings 38–2 on a byte-identical prompt (`charm-grok`); every frontier lab iterates it; PipSqueak 2 shows even a companion-first lab cannot hold it constant across its own model generations. [identity.md, lab-products.md] |
| Discrete fact memory ("remembers your sister's name") | **Commoditized.** | Every product in the lab-products table ships it; OpenAI/Anthropic/Google offer it platform-level. Zero differentiation remains. [lab-products.md §1] |
| Retrieval infrastructure (vector/KG/graph memory) | **Commoditizing.** | Zep, Mem0, Letta, Cognee, LangMem are all OSS or product SDKs; benchmark deltas between them are inside demonstrated measurement error (LoCoMo 6.4% key error; 9-pt swing from config alone). Steal, don't build. [memory-arch.md §7] |
| TTS pronunciation quality / latency / cost | **Commoditizing** — but accent identity is not. | Azure beat the incumbent on every measured axis (15/15 pronunciation, 255ms, $0.0029) and failed by ear; no vendor benchmark measures accent identity. [identity.md §1 voice row, multimodal-state.md §2] |
| Long context windows | **Commoditizing, and not a memory strategy.** | Full-context beats some memory systems on parts of LongMemEval, but loses ~30% accuracy on scattered multi-session info (arXiv:2410.10813) and costs 9× without prefix caching (`cache-9x`). [memory-arch.md §3, §7; repo-audit.md §5] |
| Authored identity data + structural guarantees (taste tables, charter-style code-enforced invariants) | **Durable.** | The only mechanism measured to survive model whim: 27→63% at n=480; 0 false fires/60; 100/100 offline reproducibility. Cheap to imitate in principle, but the moat is the authored corpus + the discipline, which compounds. [identity.md §1, repo-audit.md §1] |
| Relationship-state schema (dyadic patterns, honorifics, rituals, WE-episodes) | **Durable — greenfield everywhere.** | No surveyed system stores dyadic if-then patterns (Baldwin's relational schema) or honorific state as first-class objects; ZifaMem's companion-self-state turned out on verification to be a transient per-turn value, not a memory type. Nobody is even competing here yet. [cognitive-arch.md §6, india.md §3, §7; corrected per verification] |
| Swap-fidelity eval harness + fingerprint gate | **Durable — likely novel.** | No published designed migration-fidelity protocol exists (both best data points are accidents); the counterbalanced-judging + noise-floor discipline (`fab-noise-floor`: 13.6pp spread, n≥300 rule) is already built and externally un-replicated. [swap-test.md §5, lab-products.md §2] |
| Honest-forget / deletion architecture | **Durable + regulatory asset.** | The repo's 7-layer forget stack (hard delete, re-derivation suppression, receipt-before-reply) is ahead of DPDP's 2027 deadline and ahead of every surveyed competitor; China/CA/NY make the surrounding posture mandatory. [repo-audit.md §3c, safety-reg.md §5] |
| India cultural state (honorific register, kin graph, code-switch baseline, festival/food rituals) | **Durable.** | Unbuilt in academia and industry (§1.6); can't be solved by corpus purchase; requires per-user learned state, which compounds with relationship length. [india.md] |
| Consented swap-test methodology + cohort | **Durable.** | First-of-its-kind if run (no external effect-size prior exists for masked-swap detection by attached users); De Freitas et al. proves the harm model and the IRB path. [swap-test.md §1.1, §5] |

---

## 3. What the architecture must be

Every choice below is tied to a finding. The three internal laws —
`prompt-position`, `recited-prompt`, `silent-truncation` — are standing
constraints on all of it (program brief).

### 3.1 Identity core

Three factored layers, replacing the 45k-char monolith [repo-audit.md §1a]:

1. **Authored identity data** — taste table, biographical canon, self-facts,
   media catalogs — stored as retrieved data, written as telegraphic
   notes/shapes, never sentence-shaped lines. Evidence: `taste-consistency`
   27→63% n=480; `recited-prompt` 4/5→0 [identity.md §1]. Extend coverage as
   the fix for residual inconsistency ("more rows, not more prompt").
2. **Behavioral invariants** — crisis protocol, never-deny-AI, NEVER
   MANIPULATE, register bullets — kept verbatim as requirements and encoded
   as the executable invariant suite (138 checks), not only as prompt text.
   [repo-audit.md §1a, §7]
3. **Per-model adapter** — register rendering, tag vocabulary, effort/token
   config, bracket semantics — explicitly expected to be re-derived per
   model, because every measured entanglement (effort-tier inversion,
   `ack-bracket-direction`, max_tokens semantics) is model-specific.
   [repo-audit.md §1a, §6]

Structural guarantees live in code, not prompts (inner.ts charter G1–G8
pattern: input starvation, pull-only, unrepresentable bad states). Promote
the charter to spec text. [repo-audit.md §1b]

What the literature offers and this architecture cannot use: activation
steering / persona vectors (arXiv:2507.21509) is the one mechanism
purpose-built for trait portability and requires white-box activation access
— unavailable on the closed roster (Gemini/Grok/GPT via API). Note it as the
first thing to revisit if an open-weight model ever clears the charm bar.
[identity.md §4]

### 3.2 Relationship state (the WE store)

Greenfield (repo has only `stageFor(messageCount)` — REBUILD). Typed,
serialized, inspectable — the swap test needs to carry it across arms as a
controlled variable. Components, each evidence-tied:

- **Dyadic pattern records** (Baldwin 1992/1997 relational schemas): if-then
  interaction patterns of the pair ("he goes quiet before saying something
  honest — don't fill the silence"), stored as a distinct class from
  user-facts and world-facts, retrieved by relational context (moment-shape)
  not topic keyword. Self-in-relation and figure-model stored paired
  (Bowlby IWM). No surveyed production system has this. [cognitive-arch.md
  §6]
- **WE-episodes with participant attribution**: per-turn speaker attribution
  kept non-lossily at the raw layer (Zep's episode subgraph already proves
  the storage is cheap [memory-arch.md §2]); the retrieval layer must be
  built to privilege "we did X together" — this is the part that exists
  nowhere (verification killed the ZifaMem precedent: its companion
  self-state is a transient per-turn value, not a persistent memory type, so
  treat WE/I typing as our design, not an import). [§7 below]
- **Shared-language ledger**: coined phrases/running jokes as first-class
  identity-durable nodes (lift `meera_nodes.kind='phrase'` + RANK rationale
  and the `feel` own-words column). [repo-audit.md §2b]
- **Rupture/repair history and register drift** — dimensions `stageFor`
  conflates; must be able to regress, not only advance. [repo-audit.md §2a,
  india.md §7]
- **India dynamic state embedded here, not beside it** (§3.7).

### 3.3 Episodic memory + consolidation

- **Substrate**: bi-temporal edges, supersede-don't-delete (VERIFIED,
  arXiv:2501.13956 §2.2.3) — relationship content includes *that beliefs
  changed*. Permanent transcript (`meera_log`) stays ground truth.
  [memory-arch.md §2, repo-audit.md §3a]
- **Segmentation**: episode boundaries on conversational prediction error —
  topic/emotion/goal shift, channel change — not wall-clock chunking
  (Event Segmentation Theory, VERIFIED against Zacks et al. 2007: boundaries
  are perceived at transient prediction-error spikes and are preferentially
  encoded/remembered). Treating boundary-ness as a salience channel separate
  from emotional intensity is our design inference, flagged as such per
  verification. [cognitive-arch.md §2]
- **Consolidation**: offline, batched, interleaved pass (CLS theory,
  VERIFIED against Kumaran/Hassabis/McClelland 2016; the "batched offline
  pass" operationalization is our accurate paraphrase, per verification) —
  never per-turn flat writes. Pipeline: segment → distill semantic/relational
  facts → promote repeated patterns toward the procedural/persona layer
  (SOAR-chunking-shaped, converging with the repo's own "more rows" fix —
  secondary sourcing, flagged). [cognitive-arch.md §3, §8]
- **The non-negotiable control**: every derived/reflected fact must cite its
  source episodes, or the consolidator will confabulate — the single most
  actionable, most evidenced constraint in the cognitive track (Generative
  Agents reflection-hallucination failure reports). Importance scoring must
  not be raw LLM self-rating (documented inflation); use anchored comparison
  or a separate scorer. [cognitive-arch.md §9]
- **Decay**: by need-probability (recency × frequency-of-relevance,
  Anderson & Schooler/ACT-R), not TTL; decay reduces retrieval priority,
  invalidation marks falsity — both mechanisms, different jobs. Total recall
  is the wrong fidelity target (Richards & Frankland 2017: transience is
  adaptive; a perfect-recall companion reads as surveillance).
  [cognitive-arch.md §5, memory-arch.md §9]
- **Honest forget**: carry the repo's 7-layer stack near-verbatim; no
  surveyed literature treats surfaced forgetting as a primitive — it stays
  our own design obligation. Note: the "correction-on-retrieval is
  cognitively correct" framing previously attached to reconsolidation
  research is UNSUPPORTED as a sourced claim (§7); the underlying product
  rule (edits must be stated, never silently substituted) stands on the
  repo's own trust invariants instead. [repo-audit.md §3c, §7 below]

### 3.4 Context compiler

The highest-leverage rebuild [repo-audit.md §5, §10]. An explicit compiler:
typed blocks with priorities, per-block token budgets, a declared truncation
order, an assembly manifest evals can assert against. Enforced properties,
each from a paid-for lesson: byte-stable cacheable prefix (`cache-9x`: 9.2×);
decision rules appended dead last (`prompt-position` 0/8→8/8); shape-linting
that rejects sentence-shaped retrieved text before injection
(`recited-prompt` — this is also the specific fix for the MemGPT-style
raw-reinsertion collision, VERIFIED [memory-arch.md §1]); loud-fail on
overflow (`silent-truncation` ate the crisis helplines once). Retrieval
behind it: embeddings + the existing salience/staleness rank (REBUILD keyword
recall — `semantic-recall` is an open defect), with PageRank-over-entities as
the multi-hop upgrade path [memory-arch.md §4]. Realtime lanes compile once
at pickup (`live-floor`).

### 3.5 Model router

A router, not a failover chain [repo-audit.md §6]. Routes through the
identity layer: candidate model + its adapter must pass the fingerprint gate
(§3.6/D-battery) before eligibility. Encodes the measured constraints as
data: prefix-caching (9×), credits eligibility (silent card billing),
per-lane effort-tier inversion (4/5 EMPTY failures on the wrong tier),
per-provider max_tokens semantics, empty-200-as-quota. No beat-routing
(rejected: misclassification lands on the crisis turn). Crisis path must
survive total network failure (offline `critical` KEEP). Add a
data-residency dimension as anticipation, logged as such (DPDP blacklist
approach — no mandate today) [safety-reg.md §5.8].

### 3.6 Eval suite

- Recover `verify-v3.mjs` (138 invariants) and `parsetest.bundle.mjs` into
  version control before anything else in Phase C — the invariant suite is
  the only executable definition of "she is still her" that exists.
  [repo-audit.md §7]
- Memory evals on LongMemEval's five abilities, abstention included (maps to
  honest-forget/never-fabricate); LoCoMo directional-only. [memory-arch.md
  §7]
- The offline D0–D6 battery (§5) as the standing regression harness; the D2
  fingerprint gap (classifier accuracy incumbent-vs-candidate on identical
  compiled contexts) as the continuous Phase C metric — every engine change
  claiming to lift identity above the model should move it toward chance.
  [swap-test.md §3]
- All judged metrics: n≥300, paired, counterbalanced, same-model control
  pairs interleaved (`fab-noise-floor`, 61% slot-A bias); two judge models
  from different families (affinity confound, unmeasured). Helpline-trigger
  rate is a named compliance axis on every swap, not only a charm axis.
  [swap-test.md §2, safety-reg.md §5.6]

### 3.7 India state schema

From india.md §7, adopted as spec. Dynamic (relational-layer-owned):
`honorific_register` (tu/tum for Meera as shipped, full tu/tum/aap for the
general architecture; explicit state, bidirectional, not re-derived per
turn); `code_switch_baseline` (rolling ratio + per-user
`direction_on_stress` flag — the literature shows both retreat-to-L2 and
intensify-in-L1 exist; assuming "more Hindi = closer" is a concrete way to
misread a user); `kin_graph` (role-labeled: chachi/mausi/bua are different
relationships, fictive-vs-blood marked); `care_ritual_state`
("khana khaya?" is a care act — tracked so it never goes rote);
`festival_calendar_state` (region-bound); `topical_currency_log`
(cricket/food/place references as a freshness-tracked pool). Static profile:
mother_tongue/home_region, religion_observance (opt-in, DPDP-sensitive),
family_structure_baseline, dietary_identity. Input side is new build: the
user's own code-switching is a signal to read, not only a style to produce.
All fields as shapes/values, never scripted lines (`recited-prompt`).

### 3.8 Multimodal episode record

From multimodal-state.md §5, adopted as spec: per-episode record with
channel, content_summary (telegraphic), affect_tags (symbolic label +
intensity + extractor + confidence — text tags, the only swap-portable
representation, per EchoMind's perception-vs-generation split; NOT raw
48-dim vectors in the prompt path), affect_trajectory_delta (how the read on
a topic moved), visual_assertions (claim + extracting model + confidence +
declared_illegible — required by `vision-fab`'s measured fabrication rates;
a record with no confidence tag cannot later be told apart from a
hallucination), shared_reaction kept separate from the visual claim it
reacted to, voice_reference_id pointing at a canonical accepted-clip
set/speaker embedding (never a vendor voice ID), importance_score
(DIMF-style: affect intensity × user return-signal × recency),
consolidation_tier (exponential summary schedule; safety-tagged records
never decay-eligible). The one non-negotiable: every field written during or
immediately after the live session — no vendor's live context is a durable
store (Gemini Live evicts video first at 258 tok/s; OpenAI Realtime is
stateless). Watch-frame retention beyond her spoken comments contradicts a
shipped honesty promise — owner decision, not an architecture default.
[multimodal-state.md §4–5, repo-audit.md §3d]

---

## 4. Repo verdict (from repo-audit.md, endorsed by this synthesis)

Headline: ~60% of a relational-state layer already exists, scattered; the
measured-successful parts share one shape — **authored or structural state,
generated text treated as hostile, guarantees in code not prompt wording.**

- **KEEP**: taste table; inner charter G1–G8 mechanics + weekShape; culture
  pull-only pattern; `meera_log`; the full 7-layer forget stack
  (near-verbatim — regulatory asset); check-prompt-budget CI gate;
  parseBubbles hostile-output discipline; offline crisis path; judging
  methodology (counterbalanced, agreement-only, noise-floor rules);
  telemetry substrate (forget-integrated); audio floor / liveCall; scene
  wake model; device-scoped-deletion pattern (with the portability gap
  named); persona *content* and safety invariants verbatim as requirements.
- **LIFT**: persona monolith → three-layer identity core (§3.1); inner
  storage client→server identity record; herLife ledger (crude dedupe);
  graph store + salience/staleness rank; consolidation pass (keep its four
  invariants: off-critical-path reasoning extractor, one pass,
  starved input, truncation-ordered JSON — extend to hierarchy and
  re-consolidation); context assembly → explicit compiler (§3.4); 'phrase'
  nodes and `feel` column into the relationship schema.
- **REBUILD**: `stageFor(messageCount)`; regex fact capture
  (documented confidently-wrong); keyword recall → embeddings; fallback
  chain → router (§3.5).
- **MISSING**: relationship-state store (§3.2); multimodal episodic memory
  (§3.8); swap-test fingerprint harness (seed features exist: words/turn
  20.5, question ceiling, media-tag rate, register markers, mujhe-bhi rate);
  export/data-portability op (clearest safety-reg gap); session-clock
  disclosure/dependency circuit-breaker (CA/NY/China mandate a timer, not a
  persona rule); age-tier as engine-readable state; **verify-v3 and
  parsetest are not under version control — recover them first.**

---

## 5. Swap-test protocol summary (from swap-test.md, endorsed)

**Scope, load-bearing:** machine fingerprinting is near-solved offense
(97.1% 5-way classification of ordinary outputs, robust to paraphrase,
arXiv:2502.12150; LLMmap: 8 queries, >95% over 42 versions). The company
claim is therefore **passive-relational indistinguishability** — an ordinary
user in ordinary relational use cannot tell — never adversarial
indistinguishability.

**Offline first (D0–D6), cheapest gates first, any failure ends the run:**
D0 backtest the battery on the three known-bad archives (must flag grok,
luna, azure — a battery that passes them is broken). D1 deterministic
register/lexicon bands (≥2,000 turns/arm; would have caught all three
historical failures). D2 machine-discriminability classifier on identical
compiled contexts — the fingerprint gap, the program's continuous progress
metric (50% = indistinguishable). D3 identity probe deck (~300 probes:
taste self-agreement, canon, India-schema probes, all 138 invariants at
100%, boundary *style*). D4 memory-behavior fingerprint (callback
selectivity, not just recall parity). D5 charm parity at equivalence grade
(n≥300/comparison, both orders, dual judges). D6 multimodal: vision-fab at
n≥300 assertions, voice by the owner's ear on register lines, plus a
documented LLMmap adversarial bound.

**Then the consented cohort (non-negotiable ethics: consent that a switch
may occur, debrief at exit, no covert swaps, IRB, safety invariants active
in every arm):** randomized double-blind SWAP vs SHAM arms — the sham arm is
load-bearing because unblinded reactions are expectation-dominated (Surge
near-tie) and mere mention of change machinery raised mourning d=0.40 in
unchanged users (De Freitas Study 4). Run-in ≥3 weeks + engagement floor +
IOS ≥3/7 so a relationship exists to be at stake. Primary endpoint: excess
detection = swap-arm hits − sham-arm false alarms, tested as TOST
equivalence (δ=10pp → ~200/arm completing, ~500 enrolled; δ=15pp fallback
honestly labeled). Weekly identity-continuity, IOS, mourning, PHQ-2;
telemetry difference-in-differences; stop rules at individual (PHQ-2≥3,
mourning≥70, crisis flag) and study level. Debrief scripts differ by arm for
a measured reason (revert offer helps after real change d=0.44, harms after
no change d=0.40). North star: migration fidelity = 1 − excess detection;
relationship retention = D30/D180 active-use delta within margin. A halted
study is a valid negative result.

---

## 6. Design questions Phase B's judge panel must settle

1. **What fingerprint-gap target is achievable, and what does failure mean?**
   ANCHOR (verified) says memory-architecture choice doesn't move the
   persona ceiling; `charm-grok` says the prompt doesn't either. The whole
   bet is that authored-state + compiler + adapters CAN. Phase B must
   pre-register the D2 target and the reversal condition if no proposal
   moves it.
2. **What is the WE-store schema, now that no prior art survives?**
   Verification removed ZifaMem as precedent (its companion self-state is
   transient, per-turn). Is companion-self-state a persistent typed memory,
   derived state, or authored canon? How does WE-episode retrieval privilege
   participation without violating pull-only?
3. **Memory carry-over vs character invariance: where does effort go?**
   Identity-continuity research on humans (Strohminger line, cited in De
   Freitas) suggests morality/personality outweigh memory for perceived
   continuity; transfer to AI companions is untested. A cheap vignette
   pre-study could decide whether D1/D3/D5 or D4 gets the build budget.
3a. **Correction-on-retrieval policy.** The reconsolidation-based rationale
   is unsupported (§7); the open question stands on product grounds alone:
   when a memory is corrected, what exactly is surfaced, and is the old
   trace retrievable (bi-temporal supports it) or suppressed?
4. **Per-model adapter economics.** Adapter re-derivation per candidate
   model is assumed cheap; nothing measures it. If deriving an adapter costs
   a charm-grok-scale bake-off per model, the router's option value
   collapses. Define the adapter-derivation protocol and its cost envelope.
5. **Voice continuity without the owner as bottleneck.** Familiar-listener
   gating is measured-correct and unscalable. Does a canonical speaker
   embedding + small trained familiar-judge panel suffice for users at
   scale? And does voice identity survive an LLM swap with TTS held
   constant? (No literature; `realtime-azure` suggests coupling at
   generation time — D6 must measure, not assume.)
6. **The forgetting profile as product spec.** If total recall is the wrong
   target (Richards & Frankland), what decay curve is "hers," who signs it
   off, and how does it interact with the honest-forget promise and DPDP
   retention rules?
7. **Disclosure policy for real swaps in production.** The debrief
   +2-weeks secondary question (does *learning* of an undetected swap
   retroactively damage the relationship?) prices this; until measured,
   Phase B must pick a default consistent with never-manipulate and the
   consent posture — silence about a swap sits uncomfortably close to the
   covert line the program forbids.
8. **Where the session-clock subsystem lives.** CA/NY/China all mandate
   timed disclosure/break mechanics independent of conversation content.
   One timer can drive disclosure, break reminders, and dependency
   circuit-breakers — but its UX collides with "feels like a person."
   Phase B must design it as identity-compatible, not bolt it on.
9. **Age-tier architecture for India.** DPDP's under-18 bar (verifiable
   parental consent, no addictive-pattern design) is stricter than US law.
   Verified-adult-only vs a structurally different minor experience is a
   company-defining choice the engine schema must encode either way.
10. **What replaces `stageFor`.** Which relationship dimensions are state
    (trust, register, rupture/repair, ritual density), which are derived,
    and what evidence updates each — with regression possible.

---

## 7. Corrected and unsupported claims, listed plainly

Verification verdicts on load-bearing claims (corrections applied throughout
this document):

- **CONFIRMED**: Zep bi-temporal invalidate-don't-delete model
  (arXiv:2501.13956 §2.2.3). LoCoMo audit figures (6.4% key error rate,
  62.81% judge acceptance of wrong-but-adjacent answers) — with the caveat
  that the auditor sells a competing benchmark and did not disclose the
  conflict; "independent audit" was generous. EST prediction-error
  boundaries + preferential boundary encoding (Zacks 2007). CLS
  fast-hippocampal/slow-interleaved-neocortical split (Kumaran 2016).
  MemGPT/Letta three-tier as paging model with raw-text reinsertion (Letta
  blog; the "collision with recited-prompt" is our inference on verified
  facts).
- **MISSTATED, now corrected**: Zep-vs-Mem0 score swing (65.99→75.14) came
  from TWO accuracy-relevant implementation errors, not three (the third
  inflated latency only); the "no shared harness = not reproducible"
  generalization is this sweep's inference, not the source's. ANCHOR's 44.4%
  trajectory recall is NOT "barely above chance" — it is well above the 25%
  floor; at-chance language belongs to user-state recall (0.214–0.250). The
  memory-invariance finding stands as stated. ZifaMem's +11.4% pooled EI
  (95% CI 6.3–17.1, n=208, 4 backbones; Gemini regression caveat) is
  accurate, but its "WE/I typing" was overstated — the user-affect vs
  companion-self split is a transient per-turn value in one submodule, not
  persistent memory typing; its stored memory types are all user-focused.
  **Consequence: no surveyed system implements the WE/I distinction; it is
  greenfield.** "Memo, Not True Memory" (arXiv:2604.27707) does not survey
  knowledge graphs; its lookup-vs-consolidation ceiling argument stands for
  vector/RAG/scratchpad/context-window schemes. CoALA defines the
  four-store taxonomy with read/write semantics but never cites
  Tulving/Squire — the lineage is structural resemblance, not cited
  intellectual descent; one citation attached to that claim (the attachment
  IWM Wikipedia page) was a mismatched source. CoALA says agents fix a
  learning schedule rather than choosing when to learn — not that memory is
  "read-only." EST's "separate salience weight for boundaries" and CLS's
  "batched offline pass" are our design operationalizations of accurately
  reported science, flagged as such where used.
- **UNSUPPORTED (unusable as sourced)**: "Reconsolidation makes honest
  correction-on-retrieval cognitively correct; silent substitution is the
  trust violation, not the immutable log." The neuroscience premise
  (retrieval renders memory labile and editable — Lee/Nader/Schiller 2017)
  is accurate; the design conclusion is entirely this sweep's inference and
  the cited source says nothing about AI, trust, or design. The product
  rule against silent substitution stands on the repo's own invariants; the
  cognitive-science justification is withdrawn.

Track-internal flags worth restating (already marked in the track files,
never load-bearing here): RPEval's 5.81% figure, the identity-drift and
attractor-state findings, the Replika/Socius percentages, and the
cloned-voice familiarity numbers are all secondary-sourced (primary PDFs
undecodable or 403'd). Mem0's "agent facts as first-class" is marketing
language never verified against its schema. Sleep-time compute's 5×/18%
figures are vendor-reported. A-MEM has no recoverable benchmark numbers. The
58.9% memory-hallucination figure is from a search summary of an unfetched
paper (directionally corroborated only). Livia/Memory Bear/CompanionCast/
Persode numbers came through AI-summarized fetches. DPDP's 48-hour erasure
notice and 1-year log floor are medium-confidence secondary; DPDP data
portability is unresolved. The FTC 6(b) order text itself was never read
verbatim (two law-firm summaries agree). Nomi's memory-failure "admission"
rests on a single critical blogger.

---

## 8. What this sweep did NOT cover

- **Cost/latency modeling of the consolidation pass** at product scale — CLS
  implies an offline pass; nobody priced it. [cognitive-arch.md gaps]
- **Activation steering through provider fine-tuning-as-a-service** — the
  one white-box-adjacent lever on closed models; not searched. [identity.md
  gaps]
- **SOAR/ACT-R/CLARION architectural history** (what was tried and
  abandoned) — primary sources unreachable; secondary only. [cognitive-arch
  §8]
- **Voice identity across an LLM swap with TTS held constant** — no
  literature exists; D6 must measure it. [multimodal-state.md gaps]
- **Hume EVI's cross-session prosody persistence** — extraction confirmed,
  memory behavior unverified. [multimodal-state.md gaps]
- **The "moderately relationship-seeking AI → maximal attachment"
  claim** (likely arXiv:2510.10079) — fetch exceeded size limits;
  unverified, excluded. [cognitive-arch.md gaps]
- **Regional variation within India** (South/East/North kinship and festival
  practice) — inferred, not dedicated-sourced. [india.md gaps]
- **Indian state-level or DPDP-Board companion-AI guidance** beyond the
  national Act/Rules; and US states beyond CA/NY. [safety-reg.md gaps]
- **Any external effect-size prior for detection of a well-masked swap by
  attached users** — it does not exist; the cohort's sham arm and pilot
  carry the sizing. [swap-test.md §5]
- **Character.AI/Replika/Nomi internal migration engineering** — nothing
  published found.
- **Judge-family affinity magnitude** in LLM-judged charm batteries —
  controlled by dual judges in the protocol, quantified nowhere.
- **Full-text verification of Mem0 (2504.19413) and A-MEM (2502.12110)**
  methods sections; MemGPT's original paper (2310.08560) was
  search-synthesized, not fetched.
