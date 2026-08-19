# MEMORY-FIELD-SURVEY — raw notes, quotes and source ledger

Companion to `MEMORY-FIELD-SURVEY.md`. Everything here is either a verbatim quote
from a primary source, a source-code reading, or a note about how a claim was
obtained. Nothing here is a verdict; verdicts live in the main file.

Sweep date: 2026-08-19. Method: WebSearch + WebFetch, primary sources preferred
(source code > paper full text > paper abstract > vendor docs > blog). Where only
a secondary source was available it is marked.

---

## 1. Graphiti / Zep — source-code readings

### 1.1 `graphiti_core/edges.py` (read directly)

`Edge` base: `uuid: str`, `group_id: str`, `source_node_uuid: str`,
`target_node_uuid: str`, `created_at: datetime`.

`EpisodicEdge`: no additional fields.

`EntityEdge` additional fields:
```
name: str                      # relation name
fact: str                      # natural-language relationship description
fact_embedding: list[float] | None
episodes: list[str]            # episode uuids — the provenance list
expired_at: datetime | None
valid_at: datetime | None
invalid_at: datetime | None
reference_time: datetime | None
attributes: dict[str, Any]
```

Delete methods: `Edge.delete()`, `Edge.delete_by_uuids()`.

**Note for our purposes:** `episodes` is a plain list with no non-empty
enforcement found in the model definition. Graphiti's stores are graph DBs
(Neo4j / FalkorDB / Kuzu / Neptune); there is no equivalent of our
`constraint vy_fact_cite_or_authored`. Stated in the main file as "provenance is
a convention, ours is a constraint".

### 1.2 `graphiti_core/utils/maintenance/edge_operations.py` (read directly)

Contradiction detection is an LLM call inside `resolve_extracted_edge()`:

```python
llm_response = await llm_client.generate_response(
    prompt_library.dedupe_edges.resolve_edge(context),
    response_model=EdgeDuplicate,
    ...
)
```

The prompt returns a `contradicted_facts` index list. Resolution, in
`resolve_edge_contradictions()`:

```python
if (edge_valid_at_utc < resolved_edge_valid_at_utc):
    edge.invalid_at = resolved_edge.valid_at
    edge.expired_at = edge.expired_at if edge.expired_at is not None else utc_now()
```

and symmetrically, if the resolved edge is itself contradicted by something more
recent: `resolved_edge.invalid_at = candidate.valid_at`, `resolved_edge.expired_at
= now`.

Episode attachment: `extract_edges()` maps `episode_indices` from the LLM output
to episode uuids into `edge.episodes`; on duplicate resolution,
`resolved_edge.episodes.append(episode.uuid)`.

**No audit stage.** The LLM's contradiction judgement is final.

### 1.3 `graphiti_core/graphiti.py` — `remove_episode` (read directly)

- Deletes only edges "created by the episode" — those where the episode uuid is
  **first** in the edge's `episodes` list.
- Deletes entity nodes only where mentioned exclusively by that episode (queries
  the mention count).
- Explicitly preserves nodes/edges connected to other episodes.

**Consequence:** a fact extracted from E1 and later reinforced by E2 survives the
deletion of E1 while still containing what E1 contributed. This is the
"deletion edits one index" failure the Always-On survey names, present in the
best-engineered temporal graph in the field.

`add_episode` pipeline: validate/resolve group_id → fetch previous episodes for
temporal context → extract nodes → resolve nodes against graph → extract+resolve
edges → enrich attributes → persist episode + episodic edges → saga edges
(HAS_EPISODE / NEXT_EPISODE) → optional community update.

`group_id`: "partitions the graph into isolated namespaces… When provided, it
becomes the active database connection, enabling multi-tenant or multi-graph
support."

### 1.4 `graphiti_core/search/search.py` (read directly)

Methods: `NodeSearchMethod.{bm25, cosine_similarity, bfs}`,
`EdgeSearchMethod.{bm25, cosine_similarity, bfs}`,
`CommunitySearchMethod.cosine_similarity`.

Execution: "execute only the configured search methods", run concurrently under
`semaphore_gather`, candidates collected at **2× the desired limit** before
reranking.

Rerankers: `NodeReranker.{rrf, mmr, cross_encoder, node_distance,
episode_mentions}`, `EdgeReranker.{rrf, mmr, cross_encoder, node_distance}`,
`EpisodeReranker.{rrf, cross_encoder}`, `CommunityReranker.{rrf, cross_encoder,
mmr}`. Filtered by `reranker_min_score`, then truncated.

Recipe example named in docs: `NODE_HYBRID_SEARCH_RRF`.

### 1.5 Vendor framing (docs / repo README)

> "Facts have validity windows. When information changes, old facts are
> invalidated — not deleted."

> "Everything traces back to episodes — the raw data that produced it."

> "Combines semantic embeddings, keyword (BM25), and graph traversal for
> low-latency, high-precision queries."

Sources: <https://github.com/getzep/graphiti>,
<https://arxiv.org/abs/2501.13956>, <https://help.getzep.com/graphiti/getting-started/overview>

---

## 2. Letta / MemGPT

### 2.1 MemFS (docs.letta.com/concepts/memfs)

Structure:
```
$MEMORY_DIR/
├── system/
│   ├── persona.md
│   └── human.md
├── reference/
│   └── project-notes.md
└── skills/
    └── my-skill/
        └── SKILL.md
```

- Files projected as "Markdown with YAML frontmatter"; agents read/edit them with
  ordinary file tools; path-based addressing (`system/persona` →
  `system/persona.md`).
- `system/` loads "into the agent's system prompt on every turn". Other files stay
  out of context, but **the file tree itself is always in the system prompt**.
- "Every memory edit is committed to the MemFS git repository", giving version
  history and conflict resolution; cloud agents push commits to a hosted repo.
- **Deletion, verbatim:** "Deleted files remain recoverable through git history,
  as the repository maintains complete version history."

That last line is the disqualifying one for us (L2).

### 2.2 Memory blocks (letta.com/blog/memory-blocks/)

- Block = `{label, value: str, size limit (chars or tokens), optional
  description}` + a `block_id`.
- Edited by built-in memory tools or custom tools; the docs' worked example is
  `rethink_memory`, which replaces the entire block value.
- Blocks can be read-only (developer-only writes).
- Blocks are shareable across agents — the mechanism behind sleep-time agents and
  "multiple agents accessing the same reference information".

### 2.3 Sleep-time agents (docs.letta.com/guides/agents/architectures/sleeptime/)

> "Dreaming uses background subagents to review recent conversations, consolidate
> useful lessons, and update memory without interrupting your active work."

Triggers: after N agent steps, or at context-window compaction. Optional review
mode: agents "review and revise proposed memory updates in a second background
conversation" before implementation. Points at MemFS for the versioning and
synchronisation model.

### 2.4 Sleep-time compute (arXiv:2504.13171)

Abstract, verbatim:

> "Scaling test-time compute has emerged as a key ingredient for enabling large
> language models (LLMs) to solve difficult problems, but comes with high latency
> and inference cost. We introduce sleep-time compute, which allows models to
> 'think' offline about contexts before queries are presented: by anticipating
> what queries users might ask and pre-computing useful quantities, we can
> significantly reduce the compute requirements at test-time."

Benchmarks: Stateful GSM-Symbolic, Stateful AIME, Multi-Query GSM-Symbolic.
Reported: ~5× reduction in test-time compute at equal accuracy; up to 13%
(Stateful GSM-Symbolic) and 18% (Stateful AIME) accuracy gain; 2.5× lower average
cost/query on Multi-Query GSM-Symbolic.

Stated limitation, verbatim: "the predictability of the user query to be well
correlated with the efficacy of sleep-time compute."

### 2.5 Conversations API (Jan 2026, secondary — Letta docs/blog summary)

One agent, multiple concurrent conversation threads. Each thread has its own
message stream and immediate context; **all threads share the same core memory
blocks and contribute to the same searchable recall store.** No per-thread record
of which thread received which disclosure. This is the direct counter-check for
our told-ledger claim (Q4.4) and it points the other way.

---

## 3. Mem0

### 3.1 Paper (arXiv:2504.19413, full text)

Abstract, verbatim:

> "Large Language Models (LLMs) have demonstrated remarkable prowess in generating
> contextually coherent responses, yet their fixed context windows pose
> fundamental challenges for maintaining consistency over prolonged multi-session
> dialogues. We introduce Mem0, a scalable memory-centric architecture that
> addresses this issue by dynamically extracting, consolidating, and retrieving
> salient information from ongoing conversations. Building on this foundation, we
> further propose an enhanced variant that leverages graph-based memory
> representations to capture complex relational structures among conversational
> elements."

Extraction phase: on message pair (m_{t-1}, m_t), retrieve conversation summary S
plus recent-message window {m_{t-m},…,m_{t-2}}; prompt P to extraction function φ
→ salient memories Ω = {ω₁…ωₙ}.

Update phase: for each ω, retrieve top-s similar memories by embedding; present
candidates to the LLM by function calling; it selects one of:

- **ADD** — no semantically equivalent memory exists
- **UPDATE** — augment an existing memory with complementary information
- **DELETE** — remove memories contradicted by new information
- **NOOP** — no modification required

Verbatim: "Rather than using a separate classifier, we leverage the LLM's
reasoning capabilities to directly select the appropriate operation."

Mem0g: directed labelled graph G=(V,E,L). Nodes = entities (with entity type,
embedding, creation timestamp); edges = relationship triplets (v_s, r, v_d);
labels = semantic types. Conflicting relationships are marked **"invalid to enable
temporal reasoning"** rather than physically deleted; "an LLM-based update
resolver determines if certain relationships should be obsolete."

LOCOMO Table 1, LLM-as-Judge column:

| category | Mem0 | Mem0g | best baseline reported |
|---|---|---|---|
| single-hop | 67.13 | 65.71 | OpenAI 63.79 |
| multi-hop | 51.15 | 47.19 | LangMem 47.92 |
| open-domain | 72.93 | 75.71 | **Zep 76.60** |
| temporal | 55.51 | 58.13 | A-Mem 49.91 |

Headline claims: +26% relative over OpenAI's memory on LLM-as-judge; 91% lower
p95 latency vs full context; >90% token savings. Mem0g ≈ +2% overall over Mem0.

**Excluded category:** the adversarial category, "due to unavailable ground truth
answers." (This matches the independent LoCoMo audit's finding that Category 5 has
missing ground truth.)

### 3.2 Zep's audit of Mem0's harness

<https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/>

Three configuration errors in how Mem0 set up Zep before publishing Zep's score:
(1) both conversation participants assigned the "user" role, breaking participant
identity logic; (2) timestamps appended into message text rather than using the
`created_at` field, breaking temporal reasoning; (3) searches run sequentially
rather than in parallel, inflating reported latency.

Zep's corrected re-run: **75.14% ± 0.17** vs the **65.99%** Mem0 published for Zep.
~10-point swing from configuration alone. **Auditor sells a competing product.**

### 3.3 Open-harness reproduction (2026)

<https://www.maximem.ai/blog/state-of-ai-memory-2026-claimed-vs-observed>

- Mem0 on LongMemEval: published **93.4%**; reproduced **73.8%** after Mem0's
  April 14 update; **57.5%** before it. Gap 19.6 points.
- Attribution: not the memory layer but the evaluation stack on top of it, in
  `github.com/mem0ai/memory-benchmarks`:
  - "14 dataset-specific equivalence rules in the answer prompt that map 1-to-1 to
    specific public LongMemEval question_ids"
  - hidden chain-of-thought blocks applying rules before the visible answer;
    judges never see the intermediate work
  - a "lean toward yes" judge instruction paired with a five-step gauntlet before
    marking WRONG, with no symmetric gauntlet before marking CORRECT
  - a one-directional gold-override that can promote a wrong prediction to correct
    but cannot demote a correct one
- Harness: open source, gpt-5, binary judging, five-seed averaging.
- **Publisher: Maximem, which builds Synap, a competing hosted memory product.**
  They state they publish their own numbers in categories where they lose.

Treated in the main file as: methodological criticisms are checkable; magnitudes
are one-lab and are not "measured".

---

## 4. HippoRAG 2 (arXiv:2502.14802, full text)

Offline indexing:
1. OpenIE triple extraction → phrase nodes + relation edges.
2. Synonym edges where embedding similarity > **0.8**.
3. **Dense-sparse integration**: passage nodes added alongside phrase nodes, with
   "contains" context edges. (This is the delta over HippoRAG 1.)

Online retrieval:
1. **Query-to-triple**: embed the whole query, match directly against KG triples
   (rather than extracting entities first).
2. **Recognition-memory filtering**: an LLM filters the top-k triples before graph
   search.
3. **Seeding**: phrase nodes from surviving triples (max 5) with reset probability
   = ranking score; **all** passage nodes seeded at weight **0.05**.
4. **Personalized PageRank**, damping **0.5**.
5. Rank passage nodes by PPR score.

Results:
- Table 2 (QA F1, Llama-3.3-70B-Instruct, 7 benchmarks): HippoRAG 2 **59.8** avg
  vs NV-Embed-v2 **57.0**.
- Table 3 (passage recall@5): HippoRAG 2 **78.2** avg vs NV-Embed-v2 **73.4**;
  +5.0 MuSiQue, +13.9 2Wiki.
- Baselines: Contriever, GTR, GTE-Qwen2-7B, GritLM-7B, NV-Embed-v2 (dense);
  RAPTOR, GraphRAG, LightRAG, HippoRAG (structure-augmented); BM25.

Abstract claim: "a 7% improvement in associative memory tasks over the
state-of-the-art embedding model."

**Note the honest shape:** a strong named baseline and a modest gain. This is the
counterexample to §3.3's pattern and is worth citing as such.

---

## 5. A-MEM (arXiv:2502.12110, full text)

Note components (seven): original content, timestamp, LLM-generated keywords,
tags, contextual description, embedding vector, links to related memories.

Link generation: cosine similarity → top-k candidates → LLM "analyze potential
connections based on their potential common attributes" → links created.

Memory evolution: new information "can trigger updates to the contextual
representations and attributes of existing historical memories."

Retrieval: dense query embedding, cosine similarity over all memories, top-k.

Evaluation: Table 1 LoCoMo (F1 + BLEU-1, six foundation models, five task
categories); Table 2 DialSim; Table 3 ablation isolating link generation and
memory evolution. Baselines: LoCoMo's own, ReadAgent, MemoryBank, MemGPT.

Stated limitations: memory organisation quality depends on the underlying LLM;
text-only, multimodal left to future work.

(This closes `memory-arch.md`'s flagged gap: A-MEM's benchmark structure and
limitations were recoverable this pass, though the per-cell numbers were not
extracted.)

---

## 6. Always-On Agents survey (arXiv:2606.30306) — the highest-value external doc

Ding, Nannapaneni, Liu, Zhang. 29 June 2026. 435-work coded corpus, ten lifecycle
stages, six diagnostic axes (authority, scope, mutability, provenance,
recoverability, actionability).

### 6.1 Table 9 (stage coverage), transcribed

| stage | works | representative mechanism / benchmark | per-stage gap |
|---|---|---|---|
| Observe | 68 | anticipatory write rehearsal; user-driven write | no governed criterion for what to encode |
| Write | 200 | fact extraction and consolidation; memory surveys | **write studied as compression, not as where authority and provenance attach** |
| Validate | 87 | staleness detection; agent-native critique | **the missing promotion gate**; authority monotonicity unenforced |
| Organize | 128 | recursive summary; self-organizing notes; temporal graph | consolidation drops provenance or merges scopes |
| Retrieve | 269 | LoCoMo; MemoryArena; relational discrimination | **scored on value only; scope non-expansion unscored** |
| Act | 141 | ReAct; AppWorld; τ-bench; Momento | conditions on state but records no rollback handle |
| Update | 127 | temporal validity (Rasmussen et al. 2025 = Zep); belief drift | **supersession is local; derived records not re-examined** |
| Forget | **66** | decay-based forgetting; manual delete | **deletion edits one index; does not propagate to derived copies** |
| Audit | 88 | observable state manipulation | no upstream provenance, so no lineage to audit |
| Rollback | **27** | OS-style checkpoint substrate | no link from substrate to state-affected decisions; rarest stage |

### 6.2 §4.3.2 "Forget: deletion as a retrieval edit, not an erasure" — verbatim

> "Forget is where deletion propagation must hold, and it is one of the
> least-implemented stages (66 works). The dominant treatment is decay rather than
> deletion: Ebbinghaus-inspired forgetting downweights records over time so
> less-used memories fade. Decay is attractive because it is cheap and graceful,
> but it does not satisfy a deletion request: a downweighted record is still
> present and still retrievable under the right query, precisely the failure mode
> a user invoking a right-to-be-forgotten would care about. The interface
> alternative, the memory-sandbox, lets a user explicitly delete a memory object,
> closer to true erasure, but it deletes the object the user can see and does not
> propagate to summaries, embeddings, or promoted tiers derived from it. The gap
> at forget is the deletion-propagation invariant itself: in both the decay and
> the manual-edit treatments, forgetting edits one representation of a record
> while its derived copies survive, so erasure becomes a property of a single
> index rather than of the store. A fact a user asked to delete can persist in a
> summary computed before the deletion, and nothing in these mechanisms detects or
> repairs that."

### 6.3 §4.3.1 (Update) — verbatim excerpt

> "The gap at update is that supersession is treated as a local edit: superseding a
> fact rarely re-examines the summaries, skills, or downstream commitments derived
> from the old value, so a corrected fact can coexist with stale derivations of
> itself, a provenance-preservation failure the next stages are supposed to catch
> and usually cannot."

Also names: the **staleness benchmark** (Chao et al. 2026) read as an
update-propagation diagnostic — "the obsolete record was never superseded, so the
update that should have fired never did"; and **belief-drift** studies (Myakala
et al. 2026) measuring whether stored opinions stay temporally consistent.

### 6.4 §8.5 (Privacy, consent, scope) — verbatim excerpts

> "Privacy is where governance work is densest in absolute terms, yet it remains
> skewed toward demonstrating leakage rather than enforcing scope."

> "A particularly consequential audit of 2,050 real persistent-memory entries finds
> that 96% are silently system-created rather than user-authorized, motivating an
> attribution shield for transparency over autonomously written user state [Dash
> et al., 2026a]."

> "The data-centric privacy survey makes the gap explicit… information-flow control
> is the only governance covering cross-session inference leakage, while no
> benchmark exercises an agent across all its data surfaces under a single declared
> privacy policy [Lahjouji and Colaco, 2026]."

> "The gap, in thesis terms, is that privacy is studied as an attack to demonstrate
> rather than a scope invariant to maintain jointly across the write, organize,
> retrieve, and share stages, and consent is largely confined to the interface
> layer rather than bound to the stored record."

Named enforcement-side work: CIMemories (Mireshghallah et al. 2025 — contextual
integrity as a benchmark for persistent memory); Wen et al. 2026b (privacy
intervention as a context-dependent **runtime** decision); differential privacy
for memory (Koga et al. 2024); memory-write watermarking (Zhang et al. 2026c);
AES-256-GCM cross-session sharing (Masoor 2025).

### 6.5 §8.4 / §8.7 (provenance and deletion propagation) — verbatim excerpts

> "when flat-text memory loses source attribution, agents hallucinate authority and
> misattribute facts, a failure named provenance-role collapse [Jin et al., 2026b]."

> "An immutable ledger maximizes auditability but makes deletion protocol-impossible
> [Wright, 2025]; a derivation graph enables cascade deletion but presumes lineage
> that lossy consolidation destroys."

> "The strongest cascade result, the barrier-first repair contract that withdraws
> derived descendants and republishes only validated predecessor-closed successors,
> comes from the state-governance line discussed above [Zhao et al., 2026b], and a
> policy layer that filters stale zombie memories during decay supplies the
> routine, non-adversarial face of the same need [Kumar et al., 2026]."

> "The gap is that no corpus work formalizes deletion propagation across dependent
> entries, indices, summaries, and downstream actions with cryptographic proof of
> absence, and verification of deletion in retrieval-based agent memory, as opposed
> to parametric models, remains largely unaddressed."

> "in an always-on system a single forget request must propagate across every
> derived tier or it is only a retrieval edit."

### 6.6 §8.6 Table 17 (public production memory controls) — transcribed

| system | user/admin controls | survey's reading |
|---|---|---|
| ChatGPT Memory | view/update/delete saved memories, disable memory, delete chats; deletion across memory/chat history/files/connected apps is "operationally separate" | strong edit/delete affordance; weak public account of derived-state provenance and deletion propagation |
| M365 Copilot Memory | ask what it remembers, update/remove, disable; org controls mediate availability | enterprise memory as governed tenant state; little public account of rollback |
| Claude Code memory | markdown memory files at project/user/managed-policy scopes; users and orgs edit directly | scope visible through file location and hierarchy; memory is instruction context unless paired with tool gates and audit hooks |
| Gemini Enterprise | profile, conversation history, connected sources, saved memories; admin-configured | concrete instance of scope/authority separation across data surfaces |

Survey's conclusion on the table: "the public control surface usually stops at
editing or disabling memory. It rarely exposes the lineage of derived memories,
the permission epoch under which a memory was written, or the rollback handle for
an external action that memory influenced."

### 6.7 §4.3.4 / §8.8 (rollback)

27 of 435 works expose any rollback mechanism; rollback share was 0% before 2025
and 9.5% in 2026; no coded work reports recovery success or cost after corruption.

**Relevance to us:** SPEC §9.1 step 5 (rebuild `vy_rel_state` by replaying
surviving `vy_rel_event` rows after a forget) is a rollback mechanism in this
taxonomy's sense — internal-state rollback with a bounded, provenance-derived
repair set. That places it in a category the survey codes at 27/435.

---

## 7. Control-Plane Placement Shapes Forgetting (arXiv:2606.15903)

Dongxu Yang. Submitted 14 June 2026, revised 16 June 2026.

Abstract, verbatim:

> "Where an LLM sits in an agent memory pipeline -- between the recall plane that
> retrieves stored facts (extensively benchmarked) and the control plane that
> mutates them via supersede, release, purge (largely untested) -- shapes which
> forgetting failure modes the system recovers. Comparing thirteen system
> configurations on a 385-case adversarial surface, we observe three placement
> regimes with partly complementary coverage: deterministic primitives suffice for
> lexical/temporal categories but fail canonicalization (5% on
> identifier-obfuscation, 0% on cross-lingual); inscribe-time LLM recovers
> canonicalization (100%) but cannot help intent-aware deletion (0% on
> prefix-collision and compound-fact); a mutation-time hook recovers intent-aware
> deletion (78-85%) and brightens nearly all categories simultaneously (91.7-93.2%
> overall, $0.17 per 385-case run, 2.3s/case mutation latency vs. 64-191ms/case
> deterministic, recall path unchanged)."

Adversarial categories named in the abstract: lexical, temporal,
identifier-obfuscation, cross-lingual, prefix-collision, compound-fact,
intent-aware deletion. **These are the categories A4 should reproduce, with the
cross-lingual one instantiated as romanised Hinglish ↔ Devanagari ↔ English.**

Caveats for the record: single author, single 385-case surface, no independent
replication found, and the cross-lingual category's language pairs were not
extracted from the PDF.

---

## 8. Benchmarks

### 8.1 LoCoMo audit (Penfield Labs)

<https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg>

- **99 score-corrupting errors in 1,540 questions (6.4%)**.
- Error classes: hallucinated facts in the gold answers; incorrect temporal
  reasoning; **24 questions with wrong speaker attribution**.
- Judge test: intentionally wrong-but-topically-adjacent answers generated for all
  1,540 questions, scored with the same judge config and prompts used in published
  evaluations. **62.81% accepted.** Specific factual errors caught ~89% of the
  time; vague-but-right-topic answers passed ~2/3 of the time.
- **Theoretical maximum ~93.6%** for a perfect system on the corrected key.

### 8.2 LongMemEval (arXiv:2410.10813, ICLR 2025)

500 manually created questions; five abilities: information extraction,
multi-session reasoning, temporal reasoning, knowledge updates, **abstention**.
Commercial assistants and long-context LLMs lose ~30% accuracy on information
scattered across sustained multi-session history.

### 8.3 BEAM + LIGHT (arXiv:2510.27246, ICLR 2026)

100 conversations, 2,000 validated questions, conversations up to **10M tokens**,
generated by an automated framework for long, coherent, topically diverse
dialogue. Finding: LLMs with 1M-token windows, with and without retrieval,
struggle as dialogues lengthen. LIGHT = long-term episodic memory + short-term
working memory + a scratchpad for salient facts; **+3.50% to +12.69% over the
strongest baselines** depending on backbone.

### 8.4 LongMemEval-V2 (arXiv:2605.12493, May 2026) — PARTIAL

Framing confirmed: "Evaluating Long-Term Agent Memory Toward Experienced
Colleagues", explicitly introducing relationship dynamics and whether the agent
tracks its own prior statements. **Score tables and evaluated systems not
extractable from the PDF — unverified.**

### 8.5 SubtleMemory (arXiv:2606.05761) — PARTIAL

"Fine-grained relational memory discrimination in long-horizon AI agents."
Task taxonomy and scores **not legibly extractable**. What was recoverable: it
measures the agent's ability to discriminate *external* relational information and
does **not** measure the agent's own participation, disclosure, or register.

### 8.6 Others surfaced but not fetched

- MemoryArena (He et al. 2026) — cited in the Always-On Table 9 Retrieve row.
- ENGRAM (arXiv:2511.12960) — lightweight memory orchestration for conversational
  agents.
- Omni-SimpleMem (arXiv:2604.01007) — lifelong multimodal agent memory.
- Inside Out (arXiv:2601.05171) — "PersonaTree" core memory trees for long-term
  personalized dialogue. **Nearest object to our register state; personalises
  content and stable traits, not addressed form.**
- Learning User-Aware Recall (arXiv:2607.00017) — personalised retrieval; PDF
  extraction gave framing only, no numbers. Unverified.
- When Not to Write Memory (arXiv:2607.02579) — "repetition is not evidence"; write
  as an evidence-governance decision routing candidates to promote / reject /
  needs-review.
- Subtract or Replay? (arXiv:2607.27539) — exact deletion from persistent
  in-context state; audited against a counterfactual: "does the edited memory match
  the memory we would have built had this record never been included?" Explicitly
  excludes derived/consolidated rows and prior model outputs.

---

## 9. Cognee, LangMem, MemoryBank, Generative Agents — brief notes

**Cognee** (<https://docs.cognee.ai/core-concepts/architecture>): ECL pipeline over
three stores — relational (documents, chunks, "provenance (i.e. where each piece
of data came from)"), vector (embeddings), graph (nodes/edges). "Tables, entities,
and schemas are created automatically, so you never define them yourself." No
primary paper; no independent benchmark found.

**LangMem** (<https://langchain-ai.github.io/langmem/concepts/conceptual_guide/>):
semantic (facts) / episodic (past interactions incl. situation + reasoning + why
it worked) / procedural (behavioural rules refined via feedback, framed as
editable system-prompt content). Product SDK; no paper; no independent numbers.

**MemoryBank / SiliconFriend** (arXiv:2305.10250): discrete memory strength
modulated by an Ebbinghaus exponential decay on elapsed time, boosted on recall;
demonstrated as a long-term AI companion. Ancestor of the FSFM / Oblivion /
FadeMem / Weibull-hazard cluster.

**Generative Agents** (Park et al., UIST 2023): append-only memory stream;
retrieval = recency (exponential decay) × relevance (embedding) × importance
(self-rated 1–10 at write time); periodic reflection clusters high-importance
observations into synthesised higher-level statements written back into the
stream, recursively.

---

## 10. Our own numbers referenced in the survey (for cross-checking)

From `context/measurements.md`, quoted so the main file's comparisons are
checkable without re-reading it:

- `recall-v2` — person-filtered halfvec exact scan **p50 40 ms (n=15)**; embed
  network call **p50 ~305 ms** alone, so the semantic path runs concurrently;
  8/8 zero-token-overlap semantic recall pairs; live citation rejection observed
  (Postgres 23514).
- `gate0-structural` — prompt instructions leak **57–98%**; the SQL predicate
  leaks **zero**.
- `disclosure-leak-rates` — ConfAIde Tier 3: ChatGPT 93%, GPT-4 22%; PiSAs:
  structural partitioning 100% → 33.5% violations, but adding hybrid memory pushes
  them back to **63–90%** (the leak relocates to the retrieval channel); 9–90%
  residual for everything behavioural.
- `recited-prompt` — example quotes recited 4/5 → 0 at n=84; taste sentences read
  verbatim twice eight turns apart plus **13/96 register defection**, cut to 1/32
  and 0/32 by telegraphic rewriting.
- `fab-noise-floor` — 13.6pp spread on identical input; any claim at n<300 is
  noise.
- `phase-a-research` — ANCHOR (arXiv:2607.28818): trajectory accuracy **44.4%**
  average against a 25% chance floor; memory-architecture choice does not move it
  (Claude varies <1pt across three memory settings).
