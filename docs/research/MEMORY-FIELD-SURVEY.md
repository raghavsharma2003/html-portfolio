# Memory field survey — what the frontier systems actually do, and what of it we should take

**WS-MEMRESEARCH, 2026-08-19.** Read-only on code; this document is the whole
deliverable. Extended notes and quotes: `MEMORY-FIELD-SURVEY-RAW.md`.

The owner's directive, verbatim:

> why dont we learn from graphiti, letta, mem0 and other frontier memory system
> (specially opensource) and get the best from them and implement it with our use
> case ... research deeply with existing best alternative and learn from them and
> make a better one in house, with no compromises of any kind.

So this is not a literature review. Every system below ends in **ADOPT / ADAPT /
REJECT** against our actual tables, and every recommendation is checked against
the seven laws in §0.2. A recommendation that violates one is dead on arrival and
is marked as such rather than argued for.

**Relationship to `docs/research/memory-arch.md` (2026-08-13).** That track was
the Phase A sweep. This one supersedes it on mechanism detail and verdicts, and
closes seven of the eight gaps it flagged as unverified (Mem0's methods section,
A-MEM's numbers, MemGPT/Letta's current architecture, Cognee, the forgetting
cluster, the LoCoMo audit, the benchmark successors). It does **not** supersede
its benchmark-reliability section, which was right and has since been
independently strengthened. Where the two disagree, this file says so explicitly.

---

## 1. Executive summary — the three things worth doing

**1. Fix forget's *matching* layer. It is the one place where a law of this repo
rests on a mechanism the field has measured at 0–5%.**

Our forget *propagation* is, on the evidence gathered here, the best in the
field — nobody else propagates a delete through derived rows at all (§4.11,
Table 9: forget is 66 of 435 coded works, and the coded gap is literally
"deletion edits one index; does not propagate to derived copies"). But
propagation only fires on what the *matcher* selects, and our matcher is a
deterministic lexical primitive: `meera_forget.term`, compared with `lower(term)`
against name and summary. A 385-case adversarial deletion study
([arXiv:2606.15903](https://arxiv.org/abs/2606.15903)) measures exactly that class
of primitive at **5% on identifier-obfuscation and 0% on cross-lingual**, and
recovers to **78–85% on intent-aware deletion / 91.7–93.2% overall** by adding an
LLM hook at *mutation* time — leaving the recall path untouched, which is the
only placement compatible with our laws. **We are a Hinglish product**: "my ex" /
"woh ladki" / "usne" is a cross-lingual restatement inside a single conversation.
This is the highest-value adopt in the document and it needs no schema change.
(§7, A1; Q5.)

**2. Add one nullable column and we are fully bi-temporal.** Graphiti's edges
carry four timestamps; our facts carry three plus a supersede chain. The missing
one is *transaction-time of belief change* (`expired_at`) — recoverable from a
successor's `created_at` when `superseded_by` is set, and **not recoverable at
all** when a fact is invalidated with no successor. That gap is not academic for
a relationship: "on 1 September, did she still think you were together?" is a
question the product should be able to answer honestly, and today it cannot.
One nullable column, no key change, no ON CONFLICT risk. (§7, A2; Q1.)

**3. Make the four concurrent recall paths compete, and give facts one hop.**
We run four retrieval paths concurrently and then *concatenate* them into labelled
blocks; they never rank against each other, so the slot budget is spent by
arrival order rather than by evidence. Graphiti fuses its three concurrent methods
with RRF before truncating; HippoRAG 2 beats a strong dense baseline by connecting
passages the embedding never saw (59.8 vs 57.0 avg F1; recall@5 78.2 vs 73.4
against NV-Embed-v2 — a fair baseline and a modest, real gain). We have a one-hop
expansion already, but only over the **legacy** `meera_edges` graph, not over
`vy_fact.citations`. Both fixes are deterministic, LLM-free, and cost no schema.
(§7, A3; Q3.)

Everything else worth doing is smaller. Everything the field is loudest about —
self-editing memory blocks, agent-managed memory files, decay-as-forgetting,
LLM-decided contradiction, community summaries, LoCoMo leaderboard position — is
either already rejected here with a measurement behind it, or newly rejected in
§8 with a law it breaks.

---

## 2. Ground truth: what we have, and the laws any recommendation must pass

### 2.1 Our system, precisely

```
meera_log (raw, immutable, forget-deletable)
   │  log_from..log_to span
   ▼
vy_episode ── participants ─┐   channel, participation(we|user|meera|group),
   │  citations             │   affect_tags, importance (anchored), tier
   ▼                        │
vy_fact  (CHECK cardinality(citations) >= 1 unless authored/legacy)
   │  kind ∈ user|world|self_in_relation|relationship|india|meera
   │  t_valid, t_invalid, superseded_by (bare bigint, no FK), need_p
   ├── vy_pattern (>=2 citations to write; prompt_eligible is a GENERATED
   │              column: support_count>=3 AND distinct_days>=2)
   ├── vy_observation (>=1 citation; promotes into vy_pattern)
   ├── vy_rel_event (cited) ──► vy_rel_state (cache, REBUILT BY REPLAY)
   ├── vy_phrase / vy_kin / vy_ritual / vy_currency / vy_india_profile
   ├── vy_self_arc (>=3 citations AND span_days >= 42)
   └── vy_agent_life ──anti-join── vy_agent_life_told (per listener)
   ▼
api/_disclosure.js  — a numbered WHERE clause, before rank
   ▼
compiler.ts — CORE 40k (byte-stable) + TAIL 24k, 13 budgeted slots,
              whole-block drops by declared priority, T10 pinned last
```

Retrieval, as it actually runs (`api/memory.js` `opRecall`, lines ~330–520): four
paths in one `Promise.all` — (1) keyword over `meera_nodes`, (2) salience-ranked
standing background, (3) person-filtered halfvec **exact scan** over `vy_fact`
(no HNSW; p50 40 ms measured), (4) the deterministic relational bundle — plus a
one-hop `meera_edges` neighbour decoration. Results are **concatenated into
labelled blocks** (`RELEVANT TO WHAT THEY JUST SAID` / `STANDING BACKGROUND` /
semantic), never merged and never rank-fused. Two deterministic gates in
`moment.ts` decide whether a pattern or a WE-callback may be *boosted*; neither
may be called speculatively.

### 2.2 The seven laws (every verdict below is checked against these)

| # | law | source |
|---|---|---|
| L1 | **Citations are DB-enforced.** A fact cannot exist uncited. | `vy_fact_cite_or_authored`, SPEC §4.2 |
| L2 | **Forget is a hard delete reaching every derived row.** No `deleted_at` anywhere; recall must be *structurally unable* to see it. | SPEC §9.1, schema.sql:81-98 |
| L3 | **Retrieval is pull-only.** Memory is reactive, never volunteered. | `moment.ts:23-27` |
| L4 | **Nothing sentence-shaped in a prompt.** It gets recited. Measured twice. | `rejected.md#recited-prompt` |
| L5 | **Prompt position is mechanism.** The appended-last set is capped at exactly two. | `prompt-position`, SPEC §3.2 T10 |
| L6 | **Neon SQL-HTTP: one statement per request, no cross-call transactions.** Anything needing a multi-statement transaction costs a migration. | 009/010/011 headers |
| L7 | **Hinglish-first; register is the product.** Any technique that degrades register is rejected however good its recall. | `relational-state`, `terra-arm-2304` |

---

## 3. Graphiti / Zep — temporal knowledge graph

**Primary sources.** [arXiv:2501.13956](https://arxiv.org/abs/2501.13956) (Zep
paper); source read directly:
[`graphiti_core/edges.py`](https://raw.githubusercontent.com/getzep/graphiti/main/graphiti_core/edges.py),
[`utils/maintenance/edge_operations.py`](https://raw.githubusercontent.com/getzep/graphiti/main/graphiti_core/utils/maintenance/edge_operations.py),
[`graphiti_core/graphiti.py`](https://raw.githubusercontent.com/getzep/graphiti/main/graphiti_core/graphiti.py),
[`search/search.py`](https://raw.githubusercontent.com/getzep/graphiti/main/graphiti_core/search/search.py);
[repo](https://github.com/getzep/graphiti).

### Mechanism

Three subgraphs: **episodes** (raw, non-lossy, the provenance anchor — "everything
traces back to episodes"), **semantic entities** (deduplicated nodes + typed
edges), **communities** (LLM-summarised clusters).

`EntityEdge` fields, read from source: `uuid`, `group_id`, `source_node_uuid`,
`target_node_uuid`, `created_at`, `name`, `fact` (a natural-language sentence),
`fact_embedding`, `episodes: list[str]`, `expired_at`, `valid_at`, `invalid_at`,
`reference_time`, `attributes`. Four timestamps across two timelines: *valid
time* (`valid_at`/`invalid_at`, when the fact held in the world) and *transaction
time* (`created_at`/`expired_at`, when the system believed it).

**Contradiction handling is an LLM call.** `resolve_extracted_edge()` sends the
new edge plus candidates to `prompt_library.dedupe_edges.resolve_edge`, which
returns a `contradicted_facts` index list. Then `resolve_edge_contradictions()`:

```python
if (edge_valid_at_utc < resolved_edge_valid_at_utc):
    edge.invalid_at = resolved_edge.valid_at
    edge.expired_at = edge.expired_at if edge.expired_at is not None else utc_now()
```

The old edge is invalidated, never deleted. There is no audit of whether the
LLM's contradiction judgement was right.

**Search.** `NodeSearchMethod` / `EdgeSearchMethod` ∈ {`bm25`, `cosine_similarity`,
`bfs`}, run **concurrently** under `semaphore_gather`, candidates collected at 2×
the limit, then reranked by one of `rrf` (reciprocal rank fusion), `mmr`,
`cross_encoder`, `node_distance`, `episode_mentions`, filtered by
`reranker_min_score`, then truncated.

**Deletion.** `remove_episode` deletes only the edges "created by the episode" —
specifically those where the episode uuid is **first** in `edge.episodes` — and
entity nodes only if no other episode mentions them.

**`group_id`** partitions the graph into isolated namespaces; when provided it
"becomes the active database connection". It is tenancy, not per-row ACL.

### Our equivalent

| theirs | ours |
|---|---|
| episode subgraph | `vy_episode` + `meera_log` span (`log_from`/`log_to`) |
| `edge.episodes` | `vy_fact.citations bigint[]` + GIN index — **and a CHECK constraint they have no analogue of** |
| `valid_at` / `invalid_at` | `t_valid` / `t_invalid` |
| `created_at` | `vy_fact.created_at` |
| `expired_at` | **nothing** — derivable only via `superseded_by` → successor `created_at` |
| `resolve_edge` LLM | consolidation §4.1 step 3 + the entailment audit that HALTS above 2% refutation |
| 3 concurrent methods + RRF | 4 concurrent paths, **no fusion** |
| `group_id` namespace | `agent_id` (tenancy) **and** `api/_disclosure.js` (per-row participant ACL) |
| `remove_episode` (first-episode-only) | citation-join delete + lineage chase + replay-rebuild |
| community summaries | nothing, deliberately (L4) |

### Verdict

- **ADOPT** the fourth timestamp (`expired_at` ≡ our `t_invalid_recorded_at`). §7 A2.
- **ADOPT** rank fusion (RRF) across concurrent paths. §7 A3.
- **REJECT** LLM-decided contradiction as the *only* gate. Ours already has the
  same effect with an entailment audit on top; adding their form would remove the
  audit's subject.
- **REJECT** community summaries — LLM-generated prose about clusters is exactly
  the sentence-shaped object L4 forbids, and it is uncited by construction (L1).
- **REJECT** `fact: str` as the storage unit. Their store *is* a sentence bank.
  Our `body` is a telegraphic note under a shape-lint for the same reason.

### Cost

`t_invalid_recorded_at`: one additive nullable column (migration 012), writers in
`api/consolidate.js` contradiction step, one line in `api/export.js`. No key
change, so no `pk-is-an-arbiter` exposure. RRF: pure code in `opRecall`; it changes
which rows survive T5's 6,000-char budget, so it needs a judged run — byte-identity
(G-E2) is unaffected because the empty-relational fixtures produce no rows to fuse.

---

## 4. Letta / MemGPT — memory blocks, self-editing memory, MemFS

**Primary sources.** [arXiv:2310.08560](https://arxiv.org/abs/2310.08560) (MemGPT);
[Memory blocks](https://www.letta.com/blog/memory-blocks/);
[sleep-time compute](https://arxiv.org/abs/2504.13171) and
[blog](https://www.letta.com/blog/sleep-time-compute/);
[MemFS docs](https://docs.letta.com/concepts/memfs);
[sleep-time agents docs](https://docs.letta.com/guides/agents/architectures/sleeptime/);
[context repositories](https://www.letta.com/blog/context-repositories/).

### Mechanism

**Original (2023).** OS metaphor: core memory (in-context, agent-editable),
recall memory (searchable conversation history), archival memory (tool-queried
long-term store). The LLM issues function calls to page memory in and out.

**Memory blocks (current).** A block is `{label, value: str, size limit,
description}` with a `block_id`. Agents edit blocks with built-in or custom tools
(the docs' own example, `rethink_memory`, replaces the entire block value).
Blocks can be marked read-only. Blocks can be **shared between agents** — which is
what makes sleep-time agents work.

**Sleep-time agents.** Background agents share the primary agent's blocks and
rewrite them asynchronously, triggered after N steps or at context compaction. An
optional review mode has a second background conversation approve proposed edits
before they land.

**Sleep-time compute (paper).** Precompute likely-needed context offline.
Benchmarks: Stateful GSM-Symbolic, Stateful AIME, Multi-Query GSM-Symbolic.
Reported: ~5× less test-time compute at equal accuracy, up to 13% (GSM) / 18%
(AIME) accuracy gain, 2.5× lower cost/query. **The paper's own stated limitation:
"the predictability of the user query [is] well correlated with the efficacy of
sleep-time compute."**

**MemFS (2026).** Memory as a **git-backed tree of markdown files** with YAML
frontmatter. `system/` files load into the system prompt every turn; everything
else stays out of context but the *file tree* is always in the prompt. Every edit
is a git commit. Per the docs: **"Deleted files remain recoverable through git
history, as the repository maintains complete version history."**

**Conversations API (Jan 2026).** One agent, many concurrent conversation
threads, all sharing the same core blocks and recall store.

### Our equivalent

- Core memory ≈ our CORE (C1–C6, 40k, byte-stable) — but ours is **authored and
  git-versioned by humans**, never agent-editable. That difference is the product.
- Recall memory ≈ `meera_log` + `opRecall`.
- Archival ≈ `vy_fact` + `vy_embedding`.
- Sleep-time compute ≈ our nightly `api/consolidate.js` — but ours precomputes
  *structure* (episodes, facts, patterns, rel-events), not *anticipated answers*.
- Conversations API ≈ our (agent × person) scoping, except Letta shares one memory
  across threads with no record of which thread heard what. See Q4.4.

### Verdict

- **REJECT self-editing memory blocks, unconditionally.** Two independent kills.
  (a) A block's `value` is prose that loads into the system prompt every turn —
  that is `recited-prompt` (L4) as a design principle rather than as a bug; we
  measured 4/5 verbatim recitation and 13/96 register defection from exactly this
  shape. (b) An agent that rewrites its own identity text has no citation trail;
  L1 refuses it. Note this is also where our repo already stands: `persona.ts` is
  READ-ONLY for whole phases, and taste requires *owner approval* before entering
  the authored table.
- **REJECT MemFS.** Beyond (a) and (b) above, git history makes deleted memory
  recoverable by design. That is a soft delete with extra steps and it fails L2
  outright — not "we would have to filter it", but "the content survives the
  delete". This is disqualifying for a product whose forget receipt is a promise.
- **REJECT the sleep-time-compute *anticipation* half.** Precomputing "what they
  will probably ask" is push-shaped memory; the moment the precomputed answer is
  in context, L3 is decided by the model rather than by `moment.ts`. The paper's
  own predictability caveat also points the wrong way for us: a companion chat is
  the least predictable workload in their evaluation's neighbourhood.
- **ADOPT-BY-CONFIRMATION the sleep-time *consolidation* half.** We already do it
  (`api/consolidate-sweep.js`, hourly cron). Letta's independent arrival at the
  same conclusion is corroboration that offline structuring is the right shape,
  and their review-mode pattern is the same shape as our `vy_taste_candidate`
  owner-review queue. Nothing to build.
- **ADAPT one small thing: block size limits as a declared contract.** Letta gives
  every block a character limit the agent is told about. Our `TAIL_MANIFEST` does
  this better (whole-block drops, declared priorities, CI-asserted arithmetic).
  Confirmation, not adoption.

### Cost

Zero. Everything here is a rejection or a confirmation of something we have.
The one thing worth writing down is the *reason*, because "let the agent manage
its own memory" is the single most attractive-looking idea in the field and it
collides with two of our laws at once.

---

## 5. Mem0 — extraction/update pipeline and Mem0g

**Primary sources.** [arXiv:2504.19413](https://arxiv.org/abs/2504.19413),
[full text](https://arxiv.org/html/2504.19413v1); benchmark harness at
`github.com/mem0ai/memory-benchmarks`.

### Mechanism

**Two phases.** *Extraction*: on a new message pair, retrieve the conversation
summary plus a recent-message window, prompt an LLM for salient memories Ω.
*Update*: for each candidate, retrieve the top-s similar existing memories by
embedding, then hand them to an LLM via function calling which picks exactly one
of four operations — **ADD** (no equivalent exists), **UPDATE** (augment),
**DELETE** (contradicted by new information), **NOOP**. The paper is explicit:
"Rather than using a separate classifier, we leverage the LLM's reasoning
capabilities to directly select the appropriate operation."

**Mem0g** is a directed labelled graph G=(V,E,L) — entity nodes with type,
embedding and creation timestamp; triplet edges. Conflicting relationships are
marked **invalid** rather than physically deleted, "to enable temporal reasoning",
via an LLM-based update resolver.

So the base product **destroys belief history on contradiction** and the graph
variant does not. That inconsistency is the interesting part.

### The numbers, and how much to trust them

From the paper's Table 1 (LLM-as-Judge column), against their own baselines:

| category | Mem0 | Mem0g | best baseline |
|---|---|---|---|
| single-hop | 67.13 | 65.71 | OpenAI 63.79 |
| multi-hop | 51.15 | 47.19 | LangMem 47.92 |
| open-domain | 72.93 | 75.71 | **Zep 76.60** |
| temporal | 55.51 | 58.13 | A-Mem 49.91 |

Headline claims: +26% relative over "OpenAI Memory" on LLM-as-judge, 91% lower
p95 latency, >90% token savings vs full context. The adversarial category was
**excluded** for lack of ground truth.

Three independent reasons to discount the headlines:

1. **Zep beats them on open-domain in their own table**, which the marketing does
   not say.
2. **Zep's audit** of Mem0's harness found three configuration errors in how Mem0
   set up Zep — both speakers assigned the "user" role, timestamps pasted into
   message text instead of the `created_at` field, sequential rather than parallel
   search — and a corrected re-run moved Zep from Mem0's published 65.99% to
   75.14% ± 0.17. A ~10-point swing from configuration alone.
   ([source](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/))
3. **An open-harness reproduction (2026)** reports Mem0 at 73.8% on LongMemEval
   against a published 93.4% — a 19.6-point gap — and attributes it not to the
   memory layer but to the evaluation stack on top of it: 14 dataset-specific
   equivalence rules in the answer prompt keyed to public question_ids, hidden
   chain-of-thought before the visible answer, a "lean toward yes" judge
   instruction with a five-step gauntlet before WRONG and none before CORRECT, and
   a one-directional gold-override that can promote a wrong prediction but never
   demote a correct one.
   ([source](https://www.maximem.ai/blog/state-of-ai-memory-2026-claimed-vs-observed))
   **Conflict of interest, stated plainly: the publisher sells a competing memory
   product (Synap).** Same caution class as Zep-audits-Mem0. The methodological
   claims are checkable against public files and the direction of both audits
   agrees; the magnitudes are one-lab numbers and are **not** treated as measured
   here.

### Our equivalent

Our in-turn `opRemember` + nightly `api/consolidate.js` occupy the same slot.
The differences are all in the direction of discipline: our extraction is
citation-window-validated (a citation outside `[input_from, input_to]` rejects the
whole item, no salvage), our contradiction step never deletes, and 100% of
rel-events and patterns get a second-family entailment audit.

### Verdict

- **REJECT the four-operation LLM update, specifically the DELETE.** A model
  deciding to physically remove a belief because it looks contradicted is
  unrecoverable and uncited. Our two-mechanism rule stands: **invalidate for
  belief change, hard-delete for forget, never the two confused** — which is
  `spec-c-minimal`'s graft from architecture A and is the thing Mem0g itself
  half-corrects.
- **REJECT their benchmark posture as a target.** See §6.
- **ADAPT one idea: NOOP as an explicit outcome.** Mem0's update step logs "we
  looked and decided nothing changed". Our consolidator has no such record, so
  "the extractor considered this and declined" and "the extractor never saw this"
  are indistinguishable in `vy_derivation`. That is the same shape as
  `error-marked-done` (state must record outcomes) and `dead-writers` (a table
  that should have rows is a testable claim). Cheap: one more key in
  `vy_derivation.wrote`.
- **CONFIRMS our extraction-window validation.** Their pipeline has no analogue,
  and their own paper's temporal category (55.51) is their second-weakest.

### Cost

NOOP recording: no schema change (`wrote` is `jsonb`). One writer edit in
`api/consolidate.js`. It makes the consolidation-lag observability in Phase E §5
honest rather than approximate.

---

## 6. Cognee, A-MEM, HippoRAG / HippoRAG 2, LangMem, MemoryBank, Generative Agents

### 6.1 Cognee — ECL over three stores

**Source.** [docs](https://docs.cognee.ai/core-concepts/architecture),
[repo](https://github.com/topoteretes/cognee). No primary paper.

**Mechanism.** Extract–Cognify–Load across three co-resident stores: a
**relational** store for documents, chunks and provenance ("where each piece of
data came from"), a **vector** store for embeddings, a **graph** store for
structure. Schemas are auto-generated ("tables, entities, and schemas are created
automatically, so you never define them yourself"). Retrieval is vector, graph, or
hybrid.

**Our equivalent.** All three stores are one Postgres: `vy_fact` + `vy_episode`
(relational + provenance), `vy_embedding` (halfvec), `meera_nodes`/`meera_edges`
(graph). We paid for that consolidation deliberately — L6 means every cross-store
write would be a non-transactional multi-hop.

**Verdict: REJECT the architecture, ADOPT-BY-CONFIRMATION the provenance-in-the-
relational-store placement.** Cognee is the only surveyed system besides ours that
puts provenance in a *relational* store rather than as a graph annotation, and it
is the right call for the same reason: provenance must be joinable, and the join
is what makes deletion propagate. Auto-generated schemas are the opposite of what
this repo needs — every constraint here (`vy_fact_cite_or_authored`,
`vy_pattern_needs_two`, `vy_self_arc_slow`) is a designed refusal, and a generated
schema has none of them.

**Cost.** Zero.

### 6.2 A-MEM — Zettelkasten notes with memory evolution

**Source.** [arXiv:2502.12110](https://arxiv.org/abs/2502.12110) (NeurIPS 2025),
full text read this pass — closing a gap `memory-arch.md` flagged.

**Mechanism.** Each memory is a note with seven components: content, timestamp,
LLM-generated keywords, tags, a contextual description, an embedding, and links.
On write, cosine-similarity retrieves top-k candidates and an **LLM decides which
links to create**. **Memory evolution**: a new memory "can trigger updates to the
contextual representations and attributes of existing historical memories".
Retrieval is plain dense similarity over all notes.

**Numbers.** Evaluated on LoCoMo (7,512 QA pairs) across six foundation models,
and DialSim. Baselines: LoCoMo's own, ReadAgent, MemoryBank, MemGPT. An ablation
isolates link generation and memory evolution. Stated limitations: quality depends
on the underlying LLM, and it is text-only.

**Our equivalent.** `vy_observation` (single-citation noticing) is the closest
object; the promotion path into `vy_pattern` is our version of "a note that
recurs matters more". We have no emergent linking.

**Verdict: REJECT memory evolution. ADAPT the atomic-note idea, which we already
have.** Retroactively rewriting an old memory's text is a direct L1 violation:
after the rewrite, the note's citations no longer support what it says, and the
nightly integrity sweep would either flag it forever or be weakened to accommodate
it. Our equivalent of "new evidence changes an old memory" is already correct and
cheaper — write a new cited row and set `superseded_by` on the old. History
survives; the claim moves. LLM-decided linking is also `importance-inflation`
shaped (a generated score deciding structure), which SPEC §4.1 step 6 already
rejected in favour of anchored comparison.

**Cost.** Zero. Named here because "let new memories update old ones" reads as
obviously good and is measurably incompatible with a citation law.

### 6.3 HippoRAG / HippoRAG 2 — Personalized PageRank retrieval

**Sources.** [HippoRAG (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/file/6ddc001d07ca4f319af96a3024f6dbd1-Paper-Conference.pdf);
[HippoRAG 2 (ICML 2025), arXiv:2502.14802](https://arxiv.org/abs/2502.14802),
[full text](https://arxiv.org/html/2502.14802v1).

**Mechanism, precisely.** *Offline*: OpenIE triples → phrase nodes + relation
edges; synonym edges added where embedding similarity > 0.8; **passage nodes**
added alongside phrase nodes, joined by "contains" context edges (this is what
HippoRAG 2 adds over 1). *Online*: embed the **whole query** and match it against
KG triples directly (not entity-extract first); an LLM **recognition-memory
filter** drops irrelevant triples from the top-k; surviving phrase nodes (max 5)
become PPR seeds with reset probability = their ranking score; all passage nodes
are also seeded at weight 0.05; **Personalized PageRank with damping 0.5**; rank
passages by PPR score.

**Numbers, with the baseline named.** Table 2 (QA F1, Llama-3.3-70B): HippoRAG 2
**59.8** avg vs NV-Embed-v2 **57.0**. Table 3 (passage recall@5): **78.2** vs
**73.4**; +5.0 on MuSiQue, +13.9 on 2Wiki. Baselines include Contriever, GTR,
GTE-Qwen2-7B, GritLM-7B, NV-Embed-v2, RAPTOR, GraphRAG, LightRAG, BM25.
**This is a fair, strong baseline and a modest, real gain** — worth saying,
because it is the opposite of the pattern in §6's benchmark section.

**Our equivalent.** We have a one-hop graph expansion (`meera_edges` neighbours,
limit 30) but only over the **legacy** node graph, and it *decorates* results
rather than seeding a ranker. `vy_fact.citations` — which is a real bipartite
fact↔episode graph with a GIN index — is never traversed at recall time.

**Verdict: ADAPT, in the smallest possible form.** Do not import PPR. Our corpora
are 10⁰–10³ rows per dyad; PPR's win is on Wikipedia-scale multi-hop, and the
LLM recognition-memory filter is a per-query model call that L3 makes awkward
(it decides relevance before the turn's pull signal is honoured) and that the
latency budget cannot hold. Take instead the one mechanism that transfers: **one
hop over `citations`** — after the four paths return, pull facts that co-cite an
episode already retrieved, and let them compete in the fusion (A3) rather than
being appended. That is one extra SQL statement over an index that exists, it is
deterministic, and it is exactly the "week-1 detail meets week-30 detail" case.

**Cost.** One statement in `opRecall` (L6-compatible: single statement, no
transaction). Adds one round trip; the p50 budget is 250 ms and the DB side has
6× headroom (`recall-v2`). Must be inside the disclosure predicate — a co-citation
join is precisely the kind of rewrite that could reach a row the ACL excluded, so
`api/_disclosure.js`'s clause has to be on both sides, the same way
`agentScopePredicate` is already applied to both sides of the embedding join.

### 6.4 LangMem — the typed-memory taxonomy

**Source.** [conceptual guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/).
Product SDK; no paper, no independent benchmark.

**Mechanism.** Three named types: **semantic** (facts), **episodic** (past
interactions including the situation, the reasoning, and why it worked),
**procedural** (behavioural rules refined from feedback, framed as *editable
system-prompt content*).

**Our equivalent.** semantic ≈ `vy_fact`; episodic ≈ `vy_episode`; procedural ≈
`vy_pattern` (if_shape / then_note / self_in_relation).

**Verdict: ADOPT-BY-CONFIRMATION on the taxonomy — our three tables map cleanly,
which is mild evidence the decomposition is right. REJECT procedural-memory-as-
editable-system-prompt** for the same L4/L1 reasons as Letta's blocks. Note our
`vy_pattern.then_note` is a *telegraphic shape*, not a rule sentence, and
`prompt_eligible` is a generated column rather than an agent's opinion.

**Cost.** Zero.

### 6.5 MemoryBank / SiliconFriend — Ebbinghaus decay

**Sources.** [arXiv:2305.10250](https://arxiv.org/abs/2305.10250),
[repo](https://github.com/zhongwanjun/MemoryBank-SiliconFriend).

**Mechanism.** Memory strength is a discrete counter modulated by an
Ebbinghaus-style exponential decay on elapsed time and boosted on recall; the
companion (SiliconFriend) is the demo application. This is the ancestor of the
whole decay-as-forgetting family (FSFM, Oblivion, FadeMem, Weibull-hazard
governance).

**Our equivalent.** `vy_fact.need_p := recency_decay × ln(1+use_count)`, computed
in pure SQL, with a hard rule: **decay moves retrieval priority ONLY. It never
deletes and never sets `t_invalid`.** `safety_hold` rows are exempt.

**Verdict: REJECT decay-as-forgetting; our split is already correct and is now
externally corroborated.** The Always-On survey's §4.3.2 states the case better
than we did: "a downweighted record is still present and still retrievable under
the right query, precisely the failure mode a user invoking a
right-to-be-forgotten would care about." Decay is a salience mechanism; deletion
is a promise. Conflating them makes honest-forget a lie.

**Cost.** Zero. Recorded because "add a forgetting curve" is the most common
suggestion in this literature and it is the wrong operation for our requirement.

### 6.6 Generative Agents — the reflection/importance/retrieval triad

**Source.** [Park et al., UIST 2023](https://dl.acm.org/doi/fullHtml/10.1145/3586183.3606763).

**Mechanism.** Append-only memory stream; retrieval score = recency (exponential
decay) × relevance (embedding) × **importance** (a self-rated 1–10 integer
assigned by the agent at write time); periodic **reflection** clusters
high-importance observations into synthesised higher-level statements written back
into the stream, recursively.

**Our equivalent.** We took the triad and changed two things deliberately:
importance is an **anchored comparison against three fixed anchor episodes**, not
a raw self-rating (self-rating inflates — SPEC §4.1 step 6); and reflection is
**citation-bound** (`vy_pattern` needs ≥2 citations to exist and ≥3 support across
≥2 days to be usable; `vy_self_arc` needs ≥3 citations across ≥42 days).

**Verdict: ADOPT-BY-CONFIRMATION, already done, and the deltas were right.** The
Always-On survey's Table 9 names our two deltas as field-wide gaps independently:
the **Validate** stage (87/435) gap is "the missing promotion gate", and the
**Write** stage (200/435) gap is "write studied as compression, not as where
authority and provenance attach".

**Cost.** Zero.

---

## 7. Benchmarks — what they measure, and what they miss for a relationship

### 7.1 LoCoMo is not usable as a target

An independent audit (Penfield Labs; method: manual review of ground truth against
source conversations, then adversarial judge testing) found **99 score-corrupting
errors in 1,540 questions (6.4%)** — hallucinated gold facts, wrong temporal
arithmetic, and **24 questions with wrong speaker attribution** — putting the
theoretical maximum for a perfect system at **~93.6%** on the original key. The
judge (gpt-4o-mini) accepted **62.81%** of intentionally wrong-but-topically-
adjacent answers, while catching specific factual errors ~89% of the time.
([source](https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg))

**The direction of that judge bias is the part that matters to us.** The metric
rewards "found the right conversation, said nothing specific" over "recalled a
detail slightly wrong". That is the *inverse* of a companion's utility function:
in this product a vague gesture at the right topic is the tell that she doesn't
actually remember, and a wrong specific is a repair-opening mistake a person
also makes. Optimising against LoCoMo would optimise for the failure mode we
most need to avoid.

### 7.2 LongMemEval, BEAM, LongMemEval-V2

- **LongMemEval** ([arXiv:2410.10813](https://arxiv.org/abs/2410.10813), ICLR
  2025): 500 hand-written questions over five abilities — information extraction,
  multi-session reasoning, temporal reasoning, knowledge updates, **abstention**.
  Commercial assistants lose ~30% accuracy on sustained multi-session history.
  Abstention is the ability that maps onto our never-fabricate and honest-forget
  constraints, and it is the one most memory systems do not report.
- **BEAM** ([arXiv:2510.27246](https://arxiv.org/pdf/2510.27246), ICLR 2026): 100
  conversations, 2,000 validated questions, up to **10M tokens**. Finding: 1M-token
  context windows, with and without retrieval, degrade as dialogues lengthen. Their
  LIGHT framework (episodic + working memory + scratchpad) reports **+3.50% to
  +12.69% over the strongest baselines** depending on backbone — a *modest gain
  reported against a strong baseline*, which is the honest shape.
- **LongMemEval-V2** ([arXiv:2605.12493](https://arxiv.org/pdf/2605.12493), May
  2026): reframed "toward experienced colleagues", explicitly adding relationship
  dynamics and whether the agent tracks its own prior statements. **Partially
  verified** — the PDF fetch returned framing but not the score tables; treat the
  "experienced colleagues" framing as confirmed and the specific systems/scores as
  **unverified**.
- **SubtleMemory** ([arXiv:2606.05761](https://arxiv.org/pdf/2606.05761)): "fine-
  grained relational memory discrimination", i.e. can an agent tell near-identical
  relational situations apart. Task taxonomy and scores were **not legibly
  extractable** from the PDF — flagged unverified. What was extractable: it
  measures the agent's ability to discriminate *external* relational information,
  and does **not** measure the agent's own participation, disclosure behaviour, or
  register.

### 7.3 What all of them miss, for us

Every benchmark above scores **answer value**. None of them scores:

- **scope non-expansion** — whether a memory written under one person's context
  silently surfaced under another's. The Always-On survey codes 269 works at the
  Retrieve stage and states the gap as "Scored on value only; scope non-expansion
  unscored", and notes that "no benchmark exercises an agent across all its data
  surfaces under a single declared privacy policy" (Lahjouji and Colaco, 2026).
  This is our `gate0-structural` axis, and it is unmeasured by the field.
- **unprompted raising** — a system that volunteers a correct memory scores *up*
  on every benchmark here and *down* on our 0-unprompted-raises-in-60 gate (L3).
  Recall@k and pull-only are not merely different objectives; on this axis they
  point in opposite directions.
- **register** — nothing measures whether recall degraded how she talks. Our
  `terra-arm-2304` and `realtime-azure` results say that is where the product
  actually dies (L7).
- **deletion propagation** — see Q2/Q4.

**House rule, restated and strengthened:** LoCoMo is not a target and not a
ranking. LongMemEval's five abilities (especially abstention) remain the right
external eval spine, per `memory-arch.md`. But the gates that decide whether our
memory is good are the four axes above, and they are ours to build because nobody
else scores them.

### 7.4 The 2026 systems literature worth knowing

- **Control-Plane Placement Shapes Forgetting**
  ([arXiv:2606.15903](https://arxiv.org/abs/2606.15903), Dongxu Yang, June 2026) —
  see §1 and Q5. 13 configurations, 385-case adversarial surface. Deterministic
  primitives: 5% identifier-obfuscation, **0% cross-lingual**. Inscribe-time LLM:
  100% canonicalisation, **0% intent-aware deletion**. Mutation-time hook: 78–85%
  intent-aware, 91.7–93.2% overall, **$0.17 per 385-case run**, 2.3 s/case mutation
  latency vs 64–191 ms deterministic, **recall path unchanged**. One paper, one
  author, one surface — the mechanism is adoptable, the numbers are not ours until
  we re-measure on Hinglish.
- **Always-On Agents: A Survey of Persistent Memory, State, and Governance**
  ([arXiv:2606.30306](https://arxiv.org/pdf/2606.30306), Ding, Nannapaneni, Liu,
  Zhang, June 2026) — 435-work coded corpus, ten lifecycle stages. This is the
  single most useful external document found in this sweep, because it is the
  only one that measures *how many people have built each thing*. Table 9 is
  reproduced in the RAW file. It independently confirms three of our four "what
  nobody has" claims.
- **When Not to Write Memory: Governing False Promotion from Correlated Agent
  Traces** ([arXiv:2607.02579](https://arxiv.org/pdf/2607.02579)) — "repetition is
  not evidence": five agents repeating a claim may be one stale note echoed.
  Directly relevant to our `distinct_days >= 2` requirement, which is the same
  insight written as a constraint. **CONFIRMS**; nothing to build.
- **Subtract or Replay? Exact Deletion from Language-Model Memory**
  ([arXiv:2607.27539](https://arxiv.org/html/2607.27539)) — deletion from
  *persistent in-context state*, audited against a counterfactual ("does the edited
  memory match the memory we would have built had this record never been
  included?"). Explicitly out of scope for derived/consolidated rows. **The
  counterfactual framing is worth stealing as an eval definition** even though the
  mechanism is not applicable to us.

---

## 8. The five questions, answered

### Q1 — Temporal modelling: are we missing something structural?

**Answer: one nullable column, and it is a real gap, not machinery envy.**

The mapping is exact except in one cell:

| Graphiti `EntityEdge` | timeline | ours | status |
|---|---|---|---|
| `valid_at` | valid time, start | `vy_fact.t_valid` | equivalent |
| `invalid_at` | valid time, end | `vy_fact.t_invalid` | equivalent |
| `created_at` | transaction time, start | `vy_fact.created_at` | equivalent |
| `expired_at` | transaction time, end | — | **missing** |
| `episodes[]` | provenance | `citations[]` + **CHECK** | ours is stronger |
| `reference_time` | ingest anchor | `vy_derivation.input_from/to` | ours is stronger (it is a *validated window*, not a stamp) |

Theirs is *not* the same idea with more machinery. It is the same idea with one
more column — and that column answers a question we currently cannot.

**Where a bi-temporal query beats ours.** Take: *"On 1 September, did she know
they had broken up?"* Suppose he told her on 12 October that the breakup happened
in August. We write a fact with `t_valid = August`, and invalidate the old
"they're together" fact with `t_invalid = August`. Now the natural
as-of-1-September query —

```sql
where created_at <= '2026-09-01' and (t_invalid is null or t_invalid > '2026-09-01')
```

— **wrongly excludes** the "they're together" belief, because `t_invalid` is
valid-time (August) while the belief was actually held until October. She would
answer "no, I knew" when the truthful answer is "no — I only found out in
October". That is not a corner case for a companion; retroactive disclosure is
one of the most emotionally loaded shapes in a real relationship, and getting it
wrong reads as the same lying that `life-per-person` warns about.

We can *sometimes* recover it: when `superseded_by` is set, the successor's
`created_at` is exactly `expired_at`. We **cannot** recover it when a fact is
invalidated with no successor (a belief that simply stopped being true), and
that is a legal state in our schema today.

**Where we are already ahead of them.** (a) Provenance is a DB constraint, not a
convention — Graphiti's `episodes: list[str]` is a Pydantic field with no
non-empty enforcement anywhere in the store. (b) Our transaction-time anchor is a
*validated window* (`vy_derivation.input_from/input_to`, and a citation outside it
rejects the whole item), which is strictly more than a timestamp. (c) Their
invalidation decision is one un-audited LLM call; ours is audited at 100% for
rel-events and patterns and halts the run above 2% refutation.

**Recommendation: A2.**

### Q2 — Conflict resolution: is anyone doing better?

**Answer: no. And the field's own coded corpus names our differentiator as its
gap. But there is one thing we are missing, and it is not the resolution — it is
the *detection of a resolution that should have happened and didn't*.**

| system | on contradiction |
|---|---|
| Graphiti | LLM `resolve_edge` → `invalid_at = new.valid_at`, `expired_at = now`, old edge retained. Unaudited. |
| Mem0 (base) | LLM picks DELETE → **physically removes the old memory**. |
| Mem0g | marks the relationship invalid via an LLM update resolver. |
| A-MEM | rewrites the old note's context/tags in place. |
| Letta | the agent overwrites its own block; the old value survives only in git. |
| MemoryBank family | no contradiction concept — only decay. |
| **us** | new cited row + `t_invalid` + `superseded_by` on the old; **derived rows are re-examined through the citation join**; 100% entailment audit on rel-events/patterns, 5% sampled elsewhere; **>2% refutation HALTS the consolidator and pages the owner**. |

The Always-On survey codes 127 works at the Update stage and states the gap as:
**"Supersession is local; derived records not re-examined."** In its own words:
"superseding a fact rarely re-examines the summaries, skills, or downstream
commitments derived from the old value, so a corrected fact can coexist with stale
derivations of itself, a provenance-preservation failure the next stages are
supposed to catch and usually cannot." That is precisely what our citation join
prevents, and nobody surveyed has it.

Nothing found does better. Two things are worth taking:

1. **A staleness diagnostic (the update that should have fired and did not).**
   The survey cites Chao et al. 2026's staleness benchmark, read on the return arc:
   *the obsolete record was never superseded, so the update that should have fired
   never did*. We measure **wrong writes** (entailment audit) and do not measure
   **missing invalidations**. Concretely: two live `vy_fact` rows for the same
   person and `name` with overlapping valid windows and no `superseded_by` between
   them are a contradiction nobody noticed. That is a pure SQL nightly probe over
   an index that exists. **A6 in §9.**
2. **Belief-drift monitoring** (Myakala et al. 2026, per the survey): whether an
   agent's stored *opinions* stay temporally consistent. Our authored `TASTE`
   table is frozen by design, so this is already handled — but `vy_self_arc` is
   the new object with the same exposure, and G-S6 only checks slowness, not
   consistency across superseding arc rows. Worth a line in the arc writer's gate,
   not a new mechanism.

### Q3 — Retrieval: is deterministic-first defensible?

**Answer: yes, and for three reasons the field's benchmarks cannot see. But we
are leaving two specific things on the table, and both are cheap.**

**Why it is defensible.**

1. **Scale.** Graphiti's rerankers, HippoRAG's PPR and every ANN index in this
   literature are sized for corpora we do not have. Ours is 10⁰–10³ rows per
   dyad, and the person-filtered halfvec **exact scan** measured **p50 40 ms**
   (`recall-v2`, n=15) — 6× under the 250 ms budget, with no index-maintenance
   surface and no multi-tenant ANN starvation risk. The measured bottleneck is
   the embed network call (p50 ~305 ms), which is why the semantic path runs
   concurrently rather than first. Adding graph machinery buys nothing at this
   size and costs the one budget we are actually short on.
2. **Objective mismatch, measured.** recall@k is the wrong target when the judge
   that defines it accepts 62.81% of vague-but-adjacent answers (§7.1). Higher k
   on that metric is often *worse* product.
3. **Pull-only inverts the sign.** A system that retrieves more and volunteers it
   scores up on every benchmark in §7 and fails our 0/60 gate (L3). No published
   benchmark scores unprompted raising; the Always-On corpus confirms the Retrieve
   stage is "scored on value only".

**What we are actually leaving on the table.**

1. **No rank fusion.** Four concurrent paths, concatenated into labelled blocks.
   The labelling is a *good* design decision — a semantic hit is a
   differently-earned signal than an exact word hit, and the diag trace must stay
   legible — but labelling and ranking are separate concerns and we conflated
   them. Today the T5 budget is spent by arrival order per path, so a weak
   keyword hit can displace a strong semantic one. Graphiti's answer (RRF over
   concurrent methods, then truncate) is deterministic, LLM-free, and preserves
   the labels: fuse to decide *which rows survive*, keep the blocks to decide
   *how they are framed*.
2. **No traversal over `citations`.** We have a bipartite fact↔episode graph with
   a GIN index and we never walk it. HippoRAG 2's transferable insight is not PPR;
   it is that connecting two things through a shared intermediate finds what
   similarity cannot. One co-citation hop is the whole of that idea at our scale.

**What we should NOT take from HippoRAG 2:** the LLM recognition-memory filter.
It is a per-query model call that decides relevance *before* the pull signal is
honoured, and the latency does not fit.

**Recommendation: A3.**

### Q4 — What nobody has: verifying each claim

**4.1 Disclosure as a SQL predicate rather than a prompt rule — CLAIM STANDS,
with two coarse precedents named.**

Nothing surveyed enforces per-row, participant-derived disclosure at retrieval.
The closest things that exist:
- **Graphiti `group_id`** — namespace isolation, where the group id "becomes the
  active database connection". That is tenancy (our `agent_id`), not an ACL.
- **Cognee** — per-agent write scope on a shared graph. Also tenancy.
- The **enforcement** literature is explicitly thin: the Always-On survey's §8.5
  finds privacy work "skewed toward demonstrating leakage rather than enforcing
  scope", and concludes "privacy is studied as an attack to demonstrate rather
  than a scope invariant to maintain jointly across the write, organize, retrieve,
  and share stages, and **consent is largely confined to the interface layer
  rather than bound to the stored record**." Our `vy_disclosure_grant` binds
  consent to the subject row *with citations to the episode where it was given*,
  which is the thing that sentence says nobody does.
- Measurement exists and agrees with us: **CIMemories** (Mireshghallah et al.
  2025) turns contextual integrity into a benchmark for persistent memory;
  Wen et al. 2026b propose privacy intervention as a *runtime context-dependent
  decision* — i.e. behavioural, which is the class our `gate0-structural`
  measured leaking 57–98% while the SQL predicate leaked zero.

**4.2 Honest-forget as a hard delete reaching every derived row — CLAIM STANDS,
and is independently corroborated as a field-wide gap.**

The Always-On corpus codes **66 of 435 works** at the Forget stage, and states the
gap as **"Deletion edits one index; does not propagate to derived copies."** In
prose: "forgetting edits one representation of a record while its derived copies
survive, so erasure becomes a property of a single index rather than of the
store. A fact a user asked to delete can persist in a summary computed before the
deletion, and nothing in these mechanisms detects or repairs that."

Concretely, per system:
- **Graphiti**: `remove_episode` deletes only edges where the deleted episode is
  **first** in `edge.episodes`. A fact derived from E1 and later reinforced by E2
  survives the deletion of E1 while still containing what E1 said.
- **Letta MemFS**: "deleted files remain recoverable through git history".
- **Mem0**: DELETE removes one memory row.
- **Decay family**: nothing is deleted at all.

**One genuine partial exception, named plainly:** the survey identifies "the
strongest cascade result, the barrier-first repair contract that withdraws derived
descendants and republishes only validated predecessor-closed successors"
(**Zhao et al., 2026b**), plus a policy layer filtering "stale zombie memories"
(Kumar et al., 2026). That is our shape — withdraw descendants, rebuild validated
successors — arrived at independently in a 2026 paper. It is a formalism, not a
shipped product, and it does not include our lineage chase in *both* directions or
the replay-rebuild of derived state. **We are not alone in the idea; we appear to
be alone in shipping it as a gated property.** The survey also notes the general
verification gap: "no corpus work formalizes deletion propagation across dependent
entries, indices, summaries, and downstream actions with cryptographic proof of
absence."

**4.3 Per-relationship register state (honorific / code-switch) — CLAIM STANDS.
No prior art found.**

Searched across dialogue-personalisation, DST and memory literature. The nearest
objects: **Inside Out** ([arXiv:2601.05171](https://arxiv.org/html/2601.05171)) —
an explicit "PersonaTree" as structured long-term memory for personalised dialogue;
**Learning User-Aware Recall** ([arXiv:2607.00017](https://arxiv.org/pdf/2607.00017))
— personalising *which* memories are retrieved per user. Both personalise content
and stable traits. Neither stores an addressed-form state (T–V) that **advances on
evidence and regresses instantly on rupture**, and nothing found models
code-switch direction under stress as a learned per-dyad flag. This reproduces
`phase-a-research`'s conclusion ("India relational state has zero prior art") with
a year of newer literature and no counterexample. Stated honestly: this is absence
of evidence after a targeted search, not proof of absence.

**4.4 An agent's own life with a per-listener told-ledger — CLAIM STANDS.**

- **ZifaMem** ([arXiv:2607.17564](https://arxiv.org/abs/2607.17564)) types
  "companion self-state" separately from user-focused state — the closest anyone
  comes — but has no record of *who has been told what*.
- **Letta's Conversations API** (Jan 2026) is the nearest architecture and goes
  the **opposite** way: one agent, many threads, all sharing core blocks and one
  recall store, with no per-thread told-record. It solves "the agent is
  consistent" and leaves "the agent knows what she has already said to you"
  untouched. That is precisely our §3-of-SPEC-SELF-LAYER split: agent-scoped
  `vy_agent_life`, per-relationship `vy_agent_life_told`, rendered as an
  anti-join.
- The general shape does exist in the field's *vocabulary* (the survey's "shared
  and social memory" type, §3.2.4) but not as a mechanism anyone implements.

**4.5 One we did not claim and should: the citation CHECK constraint.**

No surveyed system refuses to store an uncited belief. The consequences are
measured: an audit of **2,050 real persistent-memory entries found 96% were
silently system-created rather than user-authorized** (Dash et al., 2026a, via the
Always-On survey), and "when flat-text memory loses source attribution, agents
hallucinate authority and misattribute facts" — a failure the survey names
**provenance-role collapse** (Jin et al., 2026b). The survey's Write stage (200
works, the second-largest) gap is "write studied as compression, not as where
authority and provenance attach". `vy_fact_cite_or_authored` is a two-line
constraint that makes that entire failure class unrepresentable, and it is, on
this evidence, unique.

### Q5 — The single highest-value thing to adopt

**Adopt a mutation-time deletion-matching hook, so that forget matches what the
user meant rather than the words they used.**

**The argument.** Our forget stack is seven layers and its *propagation* is, on
this survey's evidence, the best in the field. But propagation only ever fires on
what the matcher selects, and two of the seven layers are pure lexical matching:

- which `meera_log` rows fall in scope for an item-forget, and
- `meera_forget.term`, compared with `lower(term)` against name **and** summary,
  which is the layer that stops the extractor re-learning the thing next turn.

[arXiv:2606.15903](https://arxiv.org/abs/2606.15903) measures that class of
primitive across a 385-case adversarial deletion surface at **5% on
identifier-obfuscation and 0% on cross-lingual**, and shows that moving an LLM to
the **mutation** path (not the recall path, not the inscribe path) recovers
**78–85% on intent-aware deletion** and **91.7–93.2% overall** for **$0.17 per
385-case run** at 2.3 s/case, **with the recall path unchanged**.

The cross-lingual row is not an abstraction for us. **We are Hinglish-first.** A
user who says "forget about my ex" has, in the same relationship, called her
"woh ladki", "us waali", her actual name, and referred to the whole thing as "woh
scene". A `lower(term)` filter catches one of those. The others walk back in
through the summary on the next extraction pass — which is exactly the failure
`meera_forget`'s own schema comment says the table exists to prevent, solved for
English and unsolved for the language the product is actually in.

**Why this placement and no other.** The paper's three regimes map onto our laws
cleanly: *inscribe-time* LLM (canonicalise at write) would put a model in the
per-turn extraction path and still score 0% on intent-aware deletion;
*recall-time* filtering is forbidden outright by L2, because a filtered row is a
row recall can see. **Mutation-time is the only regime compatible with a hard
delete**, and it happens to be the one that measures best.

**What it costs.**

- **Latency:** ~2.3 s added to a forget, once. It must complete *before* the
  receipt, because "haan, hata diya" is sent only after commit. Acceptable in
  chat; the live call lane already says honestly that it cannot delete mid-call,
  and that stays.
- **Money:** one extract-lane call per forget. Negligible, and it is on the
  credits lane. `dryrun-still-spends` applies: any dry run of this must not call
  the model.
- **Failure mode, and this needs an owner decision:** if the hook fails, falling
  back to the deterministic terms means **under-deleting**, which is the wrong
  direction for this law. `error-marked-done` says the state must record the
  outcome. The correct behaviour is to fail the *receipt* — she says she could not
  do it right now — rather than to send a receipt for a partial delete. That is a
  product decision, not an engineering one, and it should be made explicitly.
- **Schema:** **none required.** Generated variants are additional `meera_forget`
  rows, and that table "is never read by recall, never enters a prompt", so L4
  has no exposure. If we want the audit surface to distinguish user-supplied from
  machine-derived terms — and export/DPDP suggests we should — that is one
  nullable `source` column, i.e. one additive migration under L6.
- **What it breaks:** nothing measured. It widens a match set; it adds no
  tombstone, no soft delete, no prompt text, and no appended-last rule. It touches
  `api/memory.js` opForget only.
- **What must be re-measured before we claim a number:** everything. The paper is
  one author, one 385-case surface, and its cross-lingual category is not
  Hinglish. Adopt the *mechanism*; measure the *rate* ourselves (A4).

---

## 9. Prioritised adopt list

| # | item | verdict | cost | breaks / risks | law check |
|---|---|---|---|---|---|
| **A1** | **Mutation-time forget-matching hook** (§Q5) | ADOPT | 1 call/forget, ~2.3 s pre-receipt; optional 1-column migration for term provenance | receipt-on-failure policy needs an owner decision; must not run on the live-call lane | L1 n/a · L2 **strengthened** · L3 n/a · L4 terms never enter a prompt · L5 n/a · L6 one statement per insert · L7 **this is the Hinglish fix** |
| **A2** | **`vy_fact.t_invalid_recorded_at`** — the fourth timestamp (§Q1) | ADOPT | migration 012 (additive, nullable); writer in consolidate step 3; one line in export | none — no key change, so no `pk-is-an-arbiter` exposure | all pass; never rendered, query-only |
| **A3** | **RRF fusion across the four recall paths + one co-citation hop** (§Q3) | ADAPT | pure code in `opRecall` + 1 SQL statement; needs a judged T5 run | reorders T5 content; disclosure + agent predicates must be on **both** sides of the co-citation join | L3 unaffected (fusion changes rank, not whether memory is volunteered); G-E2 byte-identity holds (empty fixtures fuse nothing) |
| **A4** | **An adversarial forget/disclosure eval surface** — our own 385-case-shaped battery with a Hinglish/Devanagari/romanised cross-lingual category | ADOPT the method | eval-only; no product risk | none | measures A1 and G-E5; this is also what makes A1's rate an owned number rather than a borrowed one |
| **A5** | **Staleness probe** — two live facts, same person+name, overlapping valid windows, no supersede link (§Q2) | ADAPT (Chao et al. 2026) | one nightly SQL statement | over-firing on legitimately parallel facts; start as a report, not a halt | L6 single statement |
| **A6** | **Record NOOP in `vy_derivation.wrote`** (§5) | ADAPT (Mem0) | one writer edit; `wrote` is already jsonb | none | makes consolidation-lag honest (`dead-writers`) |
| **A7** | **Belief-consistency check on `vy_self_arc` supersede chains** (§Q2) | ADAPT | one assertion in the arc gate | none | G-S6 currently checks slowness only |

**Sequencing.** A4 before A1 — build the measurement surface first, so A1's gain
is a measured delta and not a vendor-shaped claim. A2 is independent and can land
any time. A3 needs a judged run and should not be batched with A1.

---

## 10. What we should NOT copy, and why

1. **Self-editing memory (Letta blocks, MemFS, LangMem procedural memory).**
   Two laws at once: agent-authored prose in the system prompt is `recited-prompt`
   (measured 4/5 verbatim, 13/96 register defection), and agent-authored belief is
   uncited belief (L1). The most attractive idea in the field; the most expensive
   one for this product.
2. **Git-backed memory (MemFS).** "Deleted files remain recoverable through git
   history." That is not a hard delete. L2 is not a preference.
3. **Physical DELETE on contradiction (Mem0 base).** Destroys belief history to
   express belief change, and does it by LLM judgement. Our two-mechanism rule —
   invalidate for belief change, hard-delete for forget — exists precisely to keep
   these from being the same operation. Mem0g's own divergence from Mem0 here is
   evidence they discovered the same thing.
4. **Retroactive memory rewriting (A-MEM "memory evolution").** After a rewrite
   the citations no longer support the text. New cited row + `superseded_by` gets
   the same behaviour with the history intact.
5. **Decay-as-forgetting (MemoryBank and the whole Ebbinghaus/Weibull family).**
   A downweighted row is still there and still retrievable under the right query.
   Decay is salience; deletion is a promise. Our SPEC §4.1 step 7 split is right
   and the Always-On survey says so independently.
6. **Sleep-time compute's anticipation half.** Precomputing likely answers is
   push-shaped memory and puts L3 in the model's hands. The consolidation half we
   already run.
7. **Community / cluster summaries (Graphiti communities, GraphRAG).** LLM prose
   about groups of memories: sentence-shaped (L4) and uncitable in our sense (L1).
8. **LLM-decided relevance in the retrieval path (HippoRAG 2's recognition-memory
   filter).** Decides relevance before the turn's pull signal is honoured, and the
   latency does not fit the 250 ms budget.
9. **Self-rated 1–10 importance (Generative Agents).** Already rejected here in
   favour of anchored comparison; inflation is documented.
10. **LoCoMo as a target metric.** 6.4% of the answer key is wrong, the ceiling is
    ~93.6%, and the judge accepts 62.81% of vague-but-adjacent answers — a bias
    pointing exactly away from what a companion needs.
11. **Any vendor benchmark number as a decision input.** Two independent audits in
    this sweep (Zep→Mem0, open-harness→Mem0) found 10- and 19.6-point swings from
    the evaluation stack rather than the memory layer. Both auditors sell competing
    products. The house rule from `fab-noise-floor` applies unchanged: a metric
    with demonstrated error at the 6–60% level is not a metric to build
    architecture on.
12. **Auto-generated schemas (Cognee).** Every constraint in `db/schema.sql` is a
    designed refusal. A generated schema has none of them, and the refusals are
    the product.

---

## 11. Unverified, and gaps in this sweep

Stated rather than glossed, per house rule.

- **LongMemEval-V2** (2605.12493): the "experienced colleagues" framing and the
  relationship-dynamics intent are confirmed; the systems evaluated and their
  scores were **not extractable** from the PDF. Unverified.
- **SubtleMemory** (2606.05761): task taxonomy and all scores **unverified** —
  the PDF's tables did not extract. Only the scope statement (it measures
  discrimination of external relational information, not the agent's own
  participation/disclosure/register) was recoverable.
- **arXiv:2606.15903's numbers** are from a single-author paper on a single
  385-case surface. The mechanism is adopted; the rates are **not ours** until
  A4 measures them on Hinglish.
- **The Always-On survey's per-work counts** (Table 9) are as coded by its
  authors over a 435-work corpus with a stated coding scheme; individual
  attributions inside it (Zhao et al. 2026b, Dash et al. 2026a, Chao et al. 2026,
  Jin et al. 2026b, Myakala et al. 2026) were **not independently fetched**.
  Cited as the survey's characterisation, not as verified primary claims.
- **The open-harness Mem0 reproduction** (maximem.ai) is published by a vendor
  with a competing product. Its methodological criticisms are checkable against
  public repository files; its numbers are one-lab and are reported as such.
- **Zep's LoCoMo 75.14% ± 0.17** is Zep's own re-run of a competitor's harness.
  Same class.
- **MemGPT's original paper** (2310.08560) was not re-fetched this pass; the
  architecture description is from Letta's current docs and blogs plus the
  Always-On survey's characterisation, which agree.
- **Cognee** has no primary paper and no independent benchmark; treated as an
  implementation option, not a measured system.
- **Q4.3 (register state)** is an absence-of-evidence result after a targeted
  search. If someone has built persistent per-dyad honorific state, this survey
  did not find them.
