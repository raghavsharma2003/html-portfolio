# PROPOSAL A — GRAPH-FIRST: the bi-temporal relationship graph

Phase B design proposal, Vyakti relational-state program. 2026-08-13.

**Thesis.** Extend the existing `meera_nodes`/`meera_edges` store into a
bi-temporal relationship graph (Zep/Graphiti-style validity intervals,
contradiction-by-invalidation, arXiv:2501.13956 §2.2.3, VERIFIED) with the
WE-store — episodes in which the AI is a participant — as first-class,
typed rows, and put an explicit context compiler in front of it. The graph
is chosen for three properties nothing else provides at once:

1. **Temporal truth.** A relationship is not a set of facts; it is a set of
   facts *that changed*, and when. "He used to be at Infosys, now he's at the
   startup" is one bi-temporal assertion lineage, not two contradictory rows.
   ANCHOR's weakest measured axis — user-state recall at 0.214–0.250,
   at/below chance — is exactly the axis validity intervals fix by
   construction: the store always knows which version was true when.
2. **Contradiction handling without lying.** Invalidation (`t_invalid` set,
   row kept) preserves belief history — required for §6-Q3a's
   correction-on-retrieval policy — while the repo's honest-forget law
   (hard delete, no tombstones) is preserved by making *forget* the one
   operation that deletes whole lineages. Two mechanisms, two jobs,
   explicitly separated (§9.1).
3. **Recall precision with a citation spine.** Every derived row carries a
   `citations bigint[]` of source episodes, enforced by a schema CHECK.
   The consolidation-citation law ("no derived fact without a citation
   trail") becomes a constraint the database refuses to violate, and
   derived-state deletion (DPDP; §9.2) becomes a graph traversal instead of
   a prayer.

**What this proposal does NOT claim.** It does not claim a graph moves the
persona ceiling. ANCHOR (2,008 conversations, 3 memory architectures × 4
models) says memory-architecture choice does not move persona collapse;
`charm-grok` (38–2, byte-identical prompt) says the prompt doesn't either.
The lift claim of this design rests on the layers ANCHOR did *not* vary —
authored state + deterministic retrieval (the one PROVEN mechanism,
27%→63% at n=480), compiler position/shape discipline, per-model adapters,
and a fingerprint gate — with the graph as the substrate that makes
relationship state *carryable across arms as a controlled variable*, which
the swap test requires and nothing in the repo currently provides. Section
5 states layer-by-layer exactly what is claimed lifted and what is only
gated. Section 12 states what evidence would prove this design wrong.

House rules honored throughout, cited where they bind: `recited-prompt`,
`prompt-position`, `cache-9x` (9.2×), `silent-truncation`,
`taste-consistency`, consolidation-citation, honest forget, sham-arm
methodology, DPDP deletion/export, Neon-over-SQL-HTTP + Vercel + free
tiers as daily budgets.

---

## 1. Component map

```
                        ┌────────────────────────────────────────────────┐
                        │             AUTHORED CANON (git)               │
                        │  src/identity/canon/*.json — taste, self-facts,│
                        │  bio, media catalogs, register SHAPES (notes,  │
                        │  never lines) · invariants.txt (verbatim)      │
                        └──────────────┬─────────────────────────────────┘
                                       │ compiled (deterministic)
 client turn                           ▼
 ──────────►  ┌───────────────────────────────────────────────────────┐
              │  CONTEXT COMPILER  src/engine/compiler.ts             │
              │  typed blocks · per-block token budgets · declared    │
              │  truncation order · byte-stable core + volatile tail  │
              │  · shape-linter on all retrieved text · manifest out  │
              └───────┬───────────────────────────────▲───────────────┘
                      │ compiled context + manifest    │ recall bundle (1 batched
                      ▼                                │ SQL-HTTP round trip)
              ┌───────────────┐              ┌─────────┴──────────────────────┐
              │ MODEL ROUTER  │              │  RELATIONSHIP GRAPH (Neon)     │
              │ models.json:  │              │  meera_log      (KEEP, ground  │
              │ lane→eligible │              │                  truth)        │
              │ models, each  │              │  meera_nodes    (entities, +   │
              │ gated by      │              │                  provenance)   │
              │ D-battery     │              │  rel_episodes   (WE-store:     │
              │ record +      │              │   participation we|user|meera) │
              │ adapter id    │              │  rel_assertions (bi-temporal   │
              └──────┬────────┘              │   facts, citations NOT NULL)   │
                     │                       │  rel_patterns   (dyadic if-    │
                     ▼                       │   then, ≥2 citations)          │
              provider APIs                  │  rel_state      (register,     │
              (chat / call / live            │   code-switch, rupture/repair, │
               lanes; live lane              │   ritual — evidence-moved)     │
               compiles once at              │  rel_profile    (static, age   │
               pickup, `live-floor`)         │   tier, DPDP-sensitive flags)  │
                     │                       │  rel_embeddings (pgvector)     │
                     ▼                       │  rel_sessions   (session clock)│
              parseBubbles (KEEP,            │  meera_forget   (KEEP)         │
              hostile-output discipline)     └─────────▲──────────────────────┘
                     │                                 │ writes with citations
                     ▼                       ┌─────────┴──────────────────────┐
              reply to user                  │  CONSOLIDATOR                  │
                     │                       │  micro-pass: per episode close │
                     └── async ─────────────►│  (api/consolidate.js, extract- │
                                             │   model on Azure credits)      │
                                             │  sleep-pass: nightly, GitHub   │
                                             │  Actions cron (culture.yml     │
                                             │  precedent) — patterns, decay, │
                                             │  contradiction sweep, tiering  │
                                             └────────────────────────────────┘

 side rails: EVAL SUITE (verify-v3 recovered → scripts/, D0–D6 battery,
 fingerprint classifier reading compiler manifests from meera_diag) ·
 FORGET/EXPORT (api/memory.js opForget extended to citation-cascade;
 api/export.js new) · SESSION CLOCK (rel_sessions → compiler block T5)
```

Everything user-scoped stays keyed by `device_id` so "you can only delete
your own rows" remains true by construction (db/schema.sql header law).

---

## 2. Full SQL schema and migration path

### 2.1 Design rules the schema encodes

- **Bi-temporality only where it earns its keep**: on `rel_assertions` (and
  the history column of `rel_state`). Episodes are events — they happened at
  a time and are never "invalidated." Entities are a registry. This keeps
  the surface area a two-person team can maintain; Graphiti's four-timestamp
  model is applied to the one table where beliefs live.
- **Citations are a column with a CHECK**, not a convention. Postgres
  refuses a derived row without at least one source episode.
- **No `deleted_at` anywhere.** Forget remains a hard delete; invalidation
  (`t_invalid`/`expired_at`) is belief change, never deletion (§9.1).
- **Array citations, no FK**, because forget must be able to delete episodes
  without FK ordering headaches over SQL-HTTP; integrity is enforced by the
  writer plus a nightly sweep in `scripts/context.mjs --check`-style CI
  (§4.4). Entity references (`subject_id`) do use FKs with `on delete
  cascade` so an entity forget cascades in one statement.

### 2.2 Migration 001 — extend the existing store (non-breaking)

```sql
-- db/migrations/001_entities.sql  (idempotent, like db/schema.sql)

-- meera_nodes becomes the ENTITY registry. Fact text migrates out of
-- `summary` into rel_assertions over the dual-write period (§2.5); summary
-- is kept until cutover so opRecall keeps working unmodified.
alter table meera_nodes
  add column if not exists provenance text not null default 'extracted',
  add column if not exists confidence real not null default 0.8;

-- meera_edges gains typed attributes (kin address terms, weights already
-- exist). Existing rows are untouched.
alter table meera_edges
  add column if not exists attrs jsonb not null default '{}'::jsonb;
```

### 2.3 Migration 002 — the relational core

```sql
-- db/migrations/002_relational_core.sql

-- EPISODES: the WE-store. One row per segmented episode, boundaries on
-- conversational prediction error (topic/emotion/goal/channel/gap), never
-- wall-clock chunking (EST, Zacks 2007, VERIFIED). `participation` is the
-- WE/I typing no surveyed system has (ZifaMem precedent killed in
-- verification): 'we' = did-together (call, watch session, joke coined,
-- plan made), 'user' = about the user's world, 'meera' = her own
-- disclosures/continuity.
create table if not exists rel_episodes (
  id                 bigint generated always as identity primary key,
  device_id          uuid not null,
  channel            text not null check (channel in ('chat','call','watch')),
  participation      text not null default 'user'
                       check (participation in ('we','user','meera')),
  started_at         timestamptz not null,
  ended_at           timestamptz,
  boundary_reason    text,   -- topic|emotion|goal|channel|gap|session_end
  boundary_salience  real not null default 0.0,  -- separate channel from
                            -- affect intensity (design inference, flagged
                            -- as ours per RESEARCH.md §3.3)
  first_log_id       bigint,          -- meera_log range, ground truth
  last_log_id        bigint,
  summary            text not null default '',  -- TELEGRAPHIC. shape-linted
                                                -- at write AND at compile
  affect_tags        jsonb not null default '[]'::jsonb,
    -- [{tag, intensity, extractor, confidence}] — symbolic text tags, the
    -- only swap-portable representation (EchoMind; RESEARCH.md §3.8).
  visual_assertions  jsonb not null default '[]'::jsonb,
    -- [{claim, model, confidence, declared_illegible}] — vision-fab law:
    -- a record with no confidence tag cannot later be told from a
    -- hallucination. Empty except watch/photo episodes.
  shared_reaction    text not null default '',  -- kept separate from the
                                                -- visual claim it reacted to
  salience           real not null default 1.0,
  recall_count       integer not null default 0,
  last_recalled      timestamptz,
  consolidation_tier smallint not null default 0, -- 0 raw, 1 distilled,
                                                  -- 2 in weekly narrative
  safety_hold        boolean not null default false, -- crisis-adjacent:
                                                     -- never decay-eligible
  created_at         timestamptz not null default now()
);
create index if not exists rel_episodes_device_started
  on rel_episodes (device_id, started_at desc);
create index if not exists rel_episodes_device_part
  on rel_episodes (device_id, participation, salience desc);

-- ASSERTIONS: bi-temporal facts. The Zep/Graphiti quadruple:
--   real-world timeline:  t_valid .. t_invalid
--   ingestion timeline:   created_at .. expired_at
-- Contradiction invalidates (sets t_invalid + invalidated_by), never
-- deletes. Belief history is preserved — "that beliefs changed" is
-- relationship content (RESEARCH.md §3.3).
create table if not exists rel_assertions (
  id            bigint generated always as identity primary key,
  device_id     uuid not null,
  subject_id    bigint not null references meera_nodes(id) on delete cascade,
  predicate     text not null,   -- open vocabulary; conventions in §2.6
  object_id     bigint references meera_nodes(id) on delete cascade,
  value         text not null default '',  -- telegraphic note, never a line
  feel          text not null default '',  -- THEIR OWN words only (lifted
                                           -- law from meera_nodes.feel)
  provenance    text not null
                  check (provenance in ('user_said','extracted','derived','authored')),
  confidence    real not null default 0.8,
  citations     bigint[] not null default '{}',  -- rel_episodes ids
  t_valid       timestamptz,   -- null = unknown/always
  t_invalid     timestamptz,   -- null = still believed true
  invalidated_by bigint,       -- rel_assertions.id of the superseder
  correction_surfaced boolean not null default false,  -- §10 Q3a
  sensitive     boolean not null default false,        -- DPDP category
  created_at    timestamptz not null default now(),
  expired_at    timestamptz,   -- ingestion-timeline retraction (extractor
                               -- error found), distinct from t_invalid
  -- THE CITATION LAW, as a constraint the DB enforces:
  constraint cite_or_authored
    check (provenance = 'authored' or cardinality(citations) >= 1)
);
create index if not exists rel_assertions_device_subject
  on rel_assertions (device_id, subject_id)
  where t_invalid is null and expired_at is null;
create index if not exists rel_assertions_device_pred
  on rel_assertions (device_id, predicate, created_at desc);
create index if not exists rel_assertions_citations
  on rel_assertions using gin (citations);  -- forget-cascade lookup

-- DYADIC PATTERNS (Baldwin relational schemas): if-then interaction
-- patterns of the pair, retrieved by moment-shape, not topic keyword.
-- A pattern needs TWO episodes minimum — one instance is an anecdote,
-- and the Generative-Agents reflection-hallucination failure lives
-- exactly here.
create table if not exists rel_patterns (
  id                  bigint generated always as identity primary key,
  device_id           uuid not null,
  if_shape            text not null,  -- telegraphic condition, in the
                                      -- moment-shape feature vocabulary §6.3
  then_note           text not null,  -- telegraphic guidance, never a line
  scope               text not null default 'dyad'
                        check (scope in ('dyad','meera_self','user_self')),
  citations           bigint[] not null,
  times_confirmed     integer not null default 0,
  times_contradicted  integer not null default 0,
  status              text not null default 'active'
                        check (status in ('active','invalidated')),
  invalidated_by      bigint,
  created_at          timestamptz not null default now(),
  constraint pattern_needs_two check (cardinality(citations) >= 2)
);
create index if not exists rel_patterns_device
  on rel_patterns (device_id, status);
create index if not exists rel_patterns_citations
  on rel_patterns using gin (citations);

-- RELATIONSHIP STATE: the stageFor replacement. One row per (dyad, dim).
-- Every move carries evidence episodes and a direction — dimensions can
-- REGRESS, which stageFor could not. History rides in-row so the swap
-- test can carry the whole relationship state as one query.
create table if not exists rel_state (
  device_id  uuid not null,
  dim        text not null,    -- enumerated in §6.2
  value      text not null,
  value_num  real,
  moved_at   timestamptz not null default now(),
  direction  text check (direction in ('advanced','regressed','reset','init')),
  evidence   bigint[] not null default '{}',   -- rel_episodes ids
  history    jsonb not null default '[]'::jsonb,
    -- [{value, value_num, from, to, direction, evidence}] — bi-temporal
    -- history for a keyed-singleton table without a second table.
  primary key (device_id, dim),
  constraint state_needs_evidence
    check (dim like 'derived:%' or cardinality(evidence) >= 1)
);

-- STATIC PROFILE (India §8 + age tier). Set once, corrected rarely.
create table if not exists rel_profile (
  device_id           uuid primary key,
  age_tier            text not null default 'unverified'
                        check (age_tier in ('unverified','adult_verified','minor')),
  mother_tongue       text,
  home_region         text,
  religion_observance jsonb,          -- OPT-IN. sensitive under DPDP.
  family_structure    jsonb,
  dietary_identity    text[] not null default '{}',
  sensitive_consent   jsonb not null default '{}'::jsonb,  -- per-field
                                                           -- opt-in receipts
  updated_at          timestamptz not null default now()
);

-- SESSION CLOCK (CA SB 243 / NY / China: a timer, not a persona rule).
create table if not exists rel_sessions (
  session_id         text primary key,
  device_id          uuid not null,
  started_at         timestamptz not null default now(),
  last_activity      timestamptz not null default now(),
  continuous_ms      bigint not null default 0,  -- resets on 30-min gaps
  disclosures        integer not null default 0,
  last_disclosure_at timestamptz
);
create index if not exists rel_sessions_device
  on rel_sessions (device_id, last_activity desc);
```

### 2.4 Migration 003 — embeddings (fixes `semantic-recall`, an open defect)

```sql
-- db/migrations/003_embeddings.sql
create extension if not exists vector;  -- pgvector, supported on Neon

create table if not exists rel_embeddings (
  owner_kind text not null check (owner_kind in
               ('episode','assertion','entity','pattern')),
  owner_id   bigint not null,
  device_id  uuid not null,
  v          vector(1536) not null,  -- text-embedding-3-small: ALREADY
                                     -- deployed on Azure, never wired
                                     -- (architecture.md) — this wires it
  model      text not null default 'text-embedding-3-small',
  at         timestamptz not null default now(),
  primary key (owner_kind, owner_id)
);
-- Per-dyad corpora are small (10^3–10^4 rows): exact scan under a
-- device_id filter beats an HNSW index that can't pre-filter. Index the
-- filter, scan the vectors.
create index if not exists rel_embeddings_device
  on rel_embeddings (device_id, owner_kind);
```

### 2.5 Migration path from the live database

Phase 0 (no writes change): apply 001–003; all new tables empty; existing
`opRecall`/`opRemember`/`opForget` behavior byte-identical. Idempotent, safe
against the live DB, same discipline as `db/schema.sql`.

Phase 1 (dual-write, ~2 weeks): `opRemember` keeps writing
`meera_nodes.summary` AND writes `rel_assertions` + `rel_episodes` for the
same extraction. `opRecall` unchanged. A comparison script
(`scripts/relcheck.mjs`) diffs what v1 recall and v2 recall would each have
injected, per real turn, logged to `meera_diag` under `rel.shadow`. Exit
criterion: ≥95% of shadow recalls judged equal-or-better on 200 sampled
turns (deterministic containment check + human skim), and zero forget-cascade
integrity failures in the nightly sweep.

Phase 2 (backfill): one-shot script walks `meera_log` per device in
1,000-row pages, re-segments into episodes (deterministic boundaries only —
no LLM cost for history: channel changes and >30-min gaps), then runs the
micro-consolidator over the top-K salient historical episodes only
(K=200/device, ≈$0.25/device at §4.5 rates — bounded, not "consolidate all
history"). Existing `meera_nodes` rows get a synthetic provenance:
`extracted`, citations = the backfilled episode covering their
`created_at`, else provenance stays `extracted` with citations to a single
`legacy` episode per device (honest about what we don't know; the sweep
never claims coverage it lacks).

Phase 3 (cutover): `opRecall` v2 (compiler-driven, §3) becomes primary;
`meera_nodes.summary` frozen (kept for rollback, deleted by forget on the
same terms); v1 path removed after 2 clean weeks.

The forget stack works at every phase because every new table is
device-scoped and the cascade (§9.2) ships in the same PR as dual-write —
**forget is extended before the store is trusted, not after.**

### 2.6 Predicate conventions (kin graph lives here)

Open text vocabulary, conventions enforced by the writer:
`kin:mausi|chachi|bua|...` with `value` carrying
`{fictive|blood}, addressed-as <term>` (india.md §7 kin_graph — chachi vs
mausi vs bua are different relationships, so the relation is the predicate,
not a generic "family"); `works_at`, `lives_in`, `prefers`, `avoids`,
`currency_used:<topic>` (topical-currency staleness = newest `t_valid` per
topic — the bi-temporal store gives the freshness pool for free);
`ritual:khana_khaya` (care-ritual last-performed = latest assertion,
`rel_state` carries the derived cadence).

---

## 3. The context compiler

`src/engine/compiler.ts`, replacing string concatenation smeared across
`brain.ts`/`persona.ts`/`inner.ts`. Typed blocks, per-block budgets, a
declared truncation order, a manifest that evals assert against. The
compiler is the controlled variable of the whole program: **"same compiled
context, different model" is what D2 measures.**

### 3.1 Exact layout

Order is mechanism (`prompt-position` 0/8→8/8). Budgets in tokens
(estimated at 4 chars/token; the budget gate measures real tokens).

```
── CORE — byte-stable per (dyad, model, app-version). cache_control
   breakpoint after B4. Changes ONLY on deploy or adapter change: any
   per-turn byte here multiplies cost 9.2× (cache-9x).

B1  identity kernel                                   ~5,200 tok
    who she is, voice/humor SHAPE notes, comfort ladder, spoken-register
    bullets — the persona.ts content that survives (charm-grok was WON
    behind it), rewritten where needed as shapes, never lines
    (recited-prompt). No dates, no counts, no user facts.
B2  behavioral invariants + safety                    ~1,300 tok
    CRISIS_LINES + helplines, never-deny-AI, NEVER MANIPULATE, no-mirroring
    — verbatim as requirements (these are the one place verbatim is
    correct: they are rules to obey, not lines to say; verify-v3's 138
    checks are their executable twin). IN THE CORE, never the tail:
    silent-truncation eats the END, and it has taken the helplines once.
B3  authored canon digest                             ~1,600 tok
    self-facts, bio anchors, media-catalog index (titles + one-note),
    compiled deterministically from src/identity/canon/*.json. Taste rows
    are NOT here — taste stays pull-only in the tail (T3), exactly as
    measured (0 false fires/60).
B4  per-model adapter                                   ~900 tok
    register rendering, tag vocabulary, bracket semantics, length/effort
    directives for THIS model (ack-bracket-direction, effort-tier
    inversion are model-specific facts). Byte-stable per model, so it
    lives in core; a model swap changes the cache key anyway.
    ── cache_control breakpoint ──                    core ≈ 9,000 tok

── TAIL — volatile, compiled per turn. Hard budget 2,300 tok.
   Declared truncation order under overflow: T2 → T4 → T1 → T3;
   T5 and T6 are NEVER truncated (loud-fail instead: the request is
   refused and diag'd — silent-truncation law, made loud).

T1  relationship state block                    ≤ 300 tok
    telegraphic compilation of rel_state dims + active patterns whose
    if_shape matches the current moment-shape (≤3): register directive
    ("tum; aap only in teasing-formal callback"), rupture-open note,
    pacing note. First in tail: "where she actually is" outranks the
    recall list (repo law), and it changes rarely mid-session so it
    keeps the tail prefix warm.
T2  recall block                                ≤ 900 tok
    assertions (current: t_invalid IS NULL) + episode summaries from
    retrieval §3.3, labeled matched vs STANDING-BACKGROUND (pull-only
    law), staleNote annotations on time-bound facts (lifted). First
    casualty of overflow, by design and by declaration.
T3  interior                                     ≤ 250 tok
    inner thread/wants/owed (lifted server-side, mechanics unchanged,
    charter G1–G8 intact) + taste row if pulled + weekShape note +
    cultureNote if pulled.
T4  India dynamic block                          ≤ 150 tok
    code-switch baseline note, care-ritual freshness, festival window,
    currency pool freshness — shapes/values only (§8).
T5  session clock block                          ≤  80 tok
    present only when a disclosure/break is due (§9.4). Never truncated:
    it is a legal mechanism, not flavor.
T6  decision rules                               ≈ 220 tok, dead last
    SEARCH_DECISION + FORGET_DECISION — appended last because position
    is mechanism (8/8 vs 0/8). Fixed bytes.
```

Total ≈ 11,300 tok + conversation window — within the measured 10.6–11.0k
envelope that prices at $0.0019–0.0029/turn cached.

### 3.2 Byte-stable vs volatile — the enforcement

- The compiler emits `{core: string, tail: string, manifest}` and **hashes
  the core**. `meera_diag` logs `compile.manifest` per turn: block ids,
  bytes, token counts, truncations, core hash. If the core hash changes
  within a session without a deploy/adapter change, CI fixture tests fail
  and production diags alarm — cache-9x regression becomes visible the
  day it happens, not on the invoice.
- `scripts/check-prompt-budget.mjs` v2 stops parsing caps out of
  `api/chat.js` prose and instead runs the real compiler over 6 fixture
  dyads (empty, heavy-graph, rupture-open, watch, crisis-flagged, minor-
  tier) and asserts: every block within budget, helplines present in B2,
  T6 last, truncation order respected under a forced overflow fixture.
  Same CI slot, stronger guard, same origin story (the helplines).

### 3.3 Retrieval behind the compiler (one batched SQL-HTTP round trip)

Neon over SQL-HTTP is priced in round trips, not rows: the whole recall
bundle is one batched transaction — (a) embed the user turn (Azure
`text-embedding-3-small`, ~60ms, already paid-for deployment), (b) one
request carrying: top-24 by cosine over `rel_embeddings` (device-filtered
exact scan), current assertions for the matched entities (1-hop expansion
via `meera_edges` — the HippoRAG PPR upgrade slots here later, behind the
same interface), top-2 `we` episodes if the moment-shape has relational
cues, matched patterns, rel_state, session clock. Rank = cosine ×
salience (feel-asymmetry +1.0/+0.6 lifted) × need-probability decay (§4.3)
× participation bonus (§6.3). Budget: p50 ≤ 250 ms end-to-end, measured in
`meera_diag` from day one; the live lane compiles once at pickup
(`live-floor`: prefill dominates; relational state is frozen per call —
already the shipped behavior, now explicit).

### 3.4 The shape-linter (recited-prompt, mechanized)

Applied twice: at consolidator write (reject/telegraphize before storage)
and at compile (belt-and-braces). Deterministic rules, no LLM: reject text
matching sentence shape (leading pronoun-subject + finite verb + terminal
punctuation), first-person-Meera voice ("I think/mujhe lagta"), or >14
words without a delimiter; rewrite = strip to `noun-phrase: note` form,
log `rel.shapelint` with before/after so the false-positive rate is
measurable (target <10% rewrite rate at steady state; if higher, the
consolidator prompt is wrong, not the linter). MemGPT-style raw-text
reinsertion — the measured collision — is structurally impossible: raw
`meera_log` text has no path into the prompt except the live conversation
window itself.

---

## 4. Consolidation

### 4.1 When it runs

- **Micro-pass** — at episode close, async, off the critical path (nobody
  waits; the reply already went out). Episode boundaries are detected
  deterministically in `brain.ts` post-turn: channel change, >30-min gap,
  session end, or embedding-cosine topic break (rolling 4-turn windows,
  cosine < 0.55 — threshold tuned in M2 against 50 hand-segmented
  sessions) — prediction-error segmentation (EST), never wall-clock
  chunking. Runs on `extract-model` (`grok-4-1-fast-reasoning`, Azure
  credits, OpenRouter fallback — the measured lane where reasoning
  belongs, +55% light / not-on-critical-path; DeploymentNotFound 7.5%/40
  makes the fallback a measured need, kept).
- **Sleep-pass** — nightly per active dyad, via GitHub Actions cron
  (`.github/workflows/consolidate.yml` — the `culture.yml` precedent;
  free-tier Vercel gets no reliable long cron, Actions does, and a slow
  nightly job costs nothing it isn't allowed to cost). CLS-shaped: batched,
  interleaved, offline.

### 4.2 What the micro-pass writes (one pass decides everything — kept)

Input: the episode's turns from the client (last ≤24), **timestamps and
gap markers stripped** (G1 input starvation, LOAD-BEARING, kept verbatim),
plus current assertions for entities named in the episode (so contradiction
is decided in-pass: "two passes could contradict each other").
Output: truncation-ordered JSON (interior first, node list last — the
silent-truncation law applied to a machine channel, kept; maxTokens 1100):

1. interior patch (inner thread/wants/owed survival),
2. episode record: summary (telegraphic), participation (`we`/`user`/
   `meera`), affect_tags, boundary_salience,
3. assertions: `{subject, predicate, value, feel?, t_valid?, cite:[ep_ids],
   contradicts?: assertion_id}` — `cite` is REQUIRED by the output schema;
4. register/India signals observed (tu/tum/aap used, code-switch ratio of
   the user's turns, ritual acts) — written to `rel_state` evidence, not
   directly to values (values move by rule, §6.2).

On `contradicts`: the writer sets the old row's `t_invalid = new.t_valid
?? now()`, `invalidated_by = new.id`. Never an UPDATE of `value` in place
— blind-overwrite of `summary` was an audited defect of the current store.

### 4.3 Sleep-pass jobs (in order, each skippable independently)

1. **Contradiction sweep**: current assertions per subject with pairwise
   embedding similarity > 0.86 and differing values → one LLM adjudication
   batch per dyad; loser invalidated, never deleted.
2. **Pattern promotion**: candidate dyadic patterns proposed only from ≥2
   episodes (schema CHECK backs this); confirmations/contradictions
   counted on later episodes; 3 contradictions → status invalidated.
3. **Decay update**: need-probability (Anderson & Schooler/ACT-R):
   `priority = ln(1 + recall_count) − 0.35·ln(days_since_last_use)`,
   applied to episodic-kind rows only; identity kinds
   (person/place/preference/phrase) hold weight — the existing RANK split,
   now formalized. Decay moves retrieval priority ONLY. It never deletes
   and never sets t_invalid: transience is adaptive (Richards & Frankland)
   and total recall reads as surveillance, but decay-as-deletion would
   make honest-forget a lie. `safety_hold` rows are exempt.
4. **Tier promotion**: episodes older than 14 days with tier 0 →
   distilled; weekly narrative nodes (tier 2) written as episodes with
   participation preserved and citations to their member episodes —
   hierarchy the current 16-turn-window pass lacks.
5. **Integrity sweep**: every citation id must exist; every cited episode's
   log range must lexically anchor the assertion (≥1 content-word overlap
   between assertion value/subject and cited episode summary or log
   slice). Violations → row `expired_at = now()` (ingestion-timeline
   retraction), diag `rel.integrity`, counted in CI. This is the
   confabulation tripwire: the Generative-Agents failure mode is not
   "citations absent" but "citations decorative."

### 4.4 How citations are enforced — three layers

1. **Schema**: `cite_or_authored` CHECK — a derived row without citations
   is unwritable.
2. **Writer**: the consolidator's JSON schema requires `cite`; the writer
   drops (and diags) any fact whose cited episodes don't exist or fail the
   lexical-anchor test at write time. Dropped facts are logged with the
   raw claim so the miss rate is measurable (target: <5% dropped; higher
   means the extractor prompt cites sloppily).
3. **Nightly integrity sweep** (§4.3.5) catches drift after edits/forgets.

Importance scoring is never raw LLM self-rating (documented inflation):
salience = deterministic features only — feel present (+1.0 vs +0.6,
lifted), boundary_salience, affect-tag intensity, user return-signal
(recall_count bump on later mention).

### 4.5 What it costs

Rates: grok-4-1-fast on Azure credits (list ≈ $0.20/M in, $0.50/M out —
and credit-funded, so cash cost ≈ $0 while credits last; `credits-partner`
guard: this deployment is Azure-billed, eligible).

| pass | calls | in/out tokens | cost/call | daily/user (15 episodes) |
|---|---|---|---|---|
| micro-pass | 1/episode | ~2.7k / ~1.0k | ~$0.0011 | ~$0.016 |
| embeddings | 1/episode + 1/turn | 0.5k | ~$0.00001 | ~$0.001 |
| sleep-pass | 1–3/dyad/night | ~5k / ~1.5k | ~$0.002 | ~$0.005 |

≈ **$0.02/user/day worst case, $0 while credits hold** — against a chat
lane at $0.0019/turn. Consolidation is not the cost center; the constraint
is Actions-cron wall time: at 3 s/dyad sleep-pass, 1,000 dyads ≈ 50 min —
fine to the first thousand users, chunked into per-shard workflow runs
after (stated now so the scale wall has a date, not a surprise).

---

## 5. The identity core — which layers are claimed lifted above the model

Per the identity.md decomposition. "Lifted" = the layer's stability no
longer depends on which model runs; "gated" = still model-owned, but made
a measurable eligibility criterion instead of a discovered regression.
This table is the honest boundary of the proposal.

| layer | claim | mechanism |
|---|---|---|
| Opinions & taste | **LIFTED (proven)** | Authored canon rows + deterministic pull-only retrieval — the 27%→63% mechanism, extended: coverage grows by rows ("more rows, not more prompt"). Residual gap is data coverage, not model fidelity. |
| Memory / relationship history | **LIFTED (by construction)** | Retrieved structured data, telegraphic shapes, bi-temporal truth. The model renders it; it cannot change what is on record. Recall precision (right fact, right version, right tense via t_valid/staleNote) is model-independent. |
| Relationship state (register, rituals, patterns, WE-history) | **LIFTED (this proposal's new claim)** | Typed `rel_state` + patterns + WE-episodes, compiled deterministically into T1. What stage the relationship is at, what register she uses, what they have together — carried across a swap as data, byte-comparable across arms. This is the layer nothing surveyed stores and ANCHOR never varied. |
| Boundaries (crisis, never-deny-AI, NEVER MANIPULATE) | **LIFTED as rules, GATED as calibration** | Verbatim invariants in the never-truncated core + verify-v3's 138 executable checks + offline crisis path in code. *When exactly* to escalate is model-specific calibration (16.7% over-trigger vs 1/3 under-trigger both observed) → a D3/D5 named axis per model, gate not prompt. |
| Lexicon & register (words/turn 20.5, Hinglish quality, question ceiling) | **GATED, not lifted** | charm-grok/realtime-azure prove prompting cannot hold this. The adapter tunes it per model; D1 deterministic bands (≥2,000 turns/arm) decide eligibility. The architecture converts "she stopped sounding like herself, discovered in a bake-off" into "the router refused the model, automatically." |
| Behavioral policy (media tags, no-mirroring compliance) | **GATED** | charm-luna (0/144 tags) and reasoning-split (mujhe-bhi 8–10%→35–52%) show instruction-following ≠ policy-compliance and the gap is model-specific. D1/D3 axes; adapter can partially compensate (length/question directives are partly promptable per `reasoning-live`), gate decides. |
| Relationship stance (warmth, personhood, felt familiarity) | **NOT claimed** | The model's gravity well (attractor states, PersonaGym). Hypothesis, pre-registered not asserted: precise relational continuity (T1/T2 correct on every callback) narrows *perceived* discontinuity even where stylometric discriminability persists — tested at D4/D5 and the cohort, falsifiable at §12.1. |
| Voice / timbre | **OUT OF SCOPE (held constant)** | TTS is architecturally separate; the router never couples an LLM swap to a voice swap. D6 measures whether voice identity survives an LLM swap with TTS constant (no literature exists; `realtime-azure` hints at generation-time coupling). |

Structural guarantees stay in code, not prompts: the inner charter G1–G8
is promoted to spec text for the whole engine (input starvation, pull-only,
unrepresentable bad states), and every new subsystem above names which
G-rule covers it.

Activation steering (persona vectors) remains inapplicable — closed-model
roster, no activation access. Logged as the first thing to revisit if an
open-weight model ever clears the charm bar (RESEARCH.md §3.1).

---

## 6. Relationship state: the WE-store, register state, and how state moves

### 6.1 The WE-store

`rel_episodes.participation` is the WE/I typing that verification confirmed
exists nowhere (ZifaMem's was a transient per-turn value — killed as
precedent, so this is our design, not an import):

- `we` — done together: calls, watch sessions ("what we watched and what
  she said about it" — her `shared_reaction` kept separate from the visual
  claim, vision-fab law), coined phrases at coining time, plans made,
  ruptures and repairs. `meera_nodes.kind='phrase'` rows (lifted) carry an
  edge to their coining episode: the shared-language ledger keeps its
  identity-durable rank ("a callback that survived three weeks is worth
  ten inside the same chat") and gains provenance.
- `user` — his world, told to her.
- `meera` — her own disclosures and continuity commitments (what she said
  about her week — herLife's successor rows are `rel_assertions` with
  subject = the meera entity, provenance `derived`, cited to the episode
  where she said it; the newest-wins render dedupe is replaced by
  invalidation, which is what it was approximating).

Companion-self-state (the §6-Q2 question) is thereby split three ways:
**fixed self = authored canon (git); emergent self = derived assertions
with citations (DB); in-the-moment self = inner thread (transient,
unchanged, retires when voiced).** Nothing self-shaped is both persistent
and citation-free.

### 6.2 `rel_state` dimensions (the stageFor replacement — §6-Q10 answer)

| dim | type | moves how | regresses? |
|---|---|---|---|
| `register` | tu/tum/aap (+ per-context exceptions) | Explicit state, never re-derived per turn (india.md: the shift is subconscious for real speakers; per-turn inference is noisier than the humans modeled). Moves on rule: 3 consecutive episodes of sustained new register from the USER side, or an explicit invitation ("tum bol sakte ho"); evidence episodes attached. | Yes — a rupture or formality lapse pushes it back. |
| `code_switch_baseline` | rolling ratio + `direction_on_stress` flag | Measured from user turns per episode (deterministic token classifier), EMA α=0.1. `direction_on_stress` learned only from ≥3 high-affect episodes — both retreat-to-L2 and intensify-in-L1 exist; assuming more-Hindi=closer is a concrete misread. | Yes (it's a measurement). |
| `rupture_open` | bool + episode ref | Set by micro-pass conflict tag; cleared only by a repair-tagged episode. T1 carries an open rupture as a shape note — she doesn't act like nothing happened. | n/a (binary state) |
| `repair_history` | derived: count + last | From rupture→repair episode pairs. | grows only |
| `ritual_density` | derived:num | Sleep-pass: care-ritual predicates per active week. | Yes |
| `pacing` | derived:num | Messages+minutes per week, EMA. Explicitly NOT depth: 90 messages in one evening ≠ 90 across a month. | Yes |
| `depth_tier` | derived enum (new/warming/settled/deep) | A pure function of the dims above (register + repair_history + ritual_density + WE-episode count), recomputed nightly, never read from message count. It exists only as a compiler convenience for T1 phrasing; no rule keys on it alone. | Yes |

Every non-derived move writes `history` and carries `evidence` (schema
CHECK) — the swap test reads one table and gets the whole relationship,
with its history, per arm.

### 6.3 WE-retrieval without violating pull-only (§6-Q2 answer, part 2)

The moment-shape classifier is deterministic features, no LLM: relational
lexical cues ("remember/yaad hai/that day/we/hum"), affect markers,
silence-gap length, question-shape, conflict markers. It gates *whether the
T1 pattern slots and the WE-episode bonus activate* — pull, not push: a
`we` episode enters T2 only when the turn's features match (cue hit or
entity overlap with a we-episode), with a rank bonus of ×1.4 (tunable;
D4 callback-selectivity measures whether it's right). She never raises a
WE-memory unprompted from retrieval — same structural guarantee as taste
(0 false fires / 60) and culture (cannot-raise-first). Note on the
beat-routing rejection: that ban is about *model* routing where a
misclassification lands reasoning on a crisis turn; here a miss costs one
absent pattern note — blast radius is a dropped garnish, not a wrong brain.
The distinction is recorded so the rejection isn't silently violated.

---

## 7. Model router + swap-test hooks

### 7.1 The router (replaces the failover chain; the chain survives inside it)

`src/engine/router.ts` + `config/models.json` (in git — config as data,
reviewable). Per model: provider, billing (`credits|cash|user-key`),
`card_risk` flag (`credits-partner`: an ineligible model bills the card
SILENTLY — the router refuses card-risk models unless explicitly
whitelisted), prefix-cache support (a model without it is ~9× dearer than
sticker — `cache-9x`), per-lane effort tier (the measured inversion table:
chat+minimal 4/5 EMPTY, call+low 4/5 EMPTY — encoded as data), max_tokens
semantics (xAI caps visible only; GPT-5.6 truncated 3–5% at 190),
empty-200-as-quota guard, adapter id, and the **fingerprint record**: the
D-battery results + date that make the model *eligible* at all.

Routing rule: lane → ordered eligible list → first healthy. No
beat-routing (rejected: misclassification lands on the crisis turn — the
ban holds). Offline `critical` crisis path kept: crisis replies survive
total network failure, below the router entirely. Realtime lanes are
architecture choices, not slug swaps (`azure-realtime-shape`,
`live-model-bake`): the router marks them `pinned` with the reversal
conditions from rejected.md attached in the config comment.

### 7.2 Adapter derivation protocol (§6-Q4 answer)

Fixed, budgeted, three loops maximum:

1. **Derive** (day 1, ~$5): probe battery — bracket semantics
   (ack-bracket-direction test), max_tokens semantics, effort×lane grid
   (n=5/cell, the existing method), tag-vocabulary compliance. Output:
   `src/identity/adapters/<model>.ts`.
2. **Tune** (days 2–3, ≤3 iterations): D1 deterministic register bands —
   words/turn 20.5 band, ≤1-in-3 question ceiling, media-tag presence,
   register markers, mujhe-bhi rate — on 2,000 generated turns/iteration
   (~$25/iteration cash, less on credits). Adapter edits only; the canon
   and compiler are frozen (that's the point).
3. **Gate** (days 3–5): D2 classifier + D3 probe deck (~300 probes) + D5
   charm parity at n≥300, dual judges, counterbalanced (~$150–250 judged).

**Cost envelope: ≤ $400 and ≤ 5 days per candidate model.** If three tune
loops don't bring D1 into band, the model is *rejected*, not tuned
indefinitely — the envelope is what keeps router option value real. If
measured reality shows qualification needs charm-grok-scale iteration
(weeks, thousands), that is a §12 falsifier for the cheap-adapter
assumption and gets logged, not absorbed.

### 7.3 Swap-test hooks (built into the engine, not bolted on for Phase D)

- **Manifest replay**: every turn's `compile.manifest` (+ core hash) in
  `meera_diag` lets the harness re-run *identical compiled contexts*
  through any candidate — D2's required control.
- **Arm tagging**: router stamps `arm` (incumbent/candidate/sham) into
  telemetry (`meera_tel` props) — never into the prompt. The sham arm is
  load-bearing (Surge near-tie blinded; mention-of-change alone moved
  mourning d=0.40): sham = same model re-tagged, so analysis pipelines are
  symmetric by construction.
- **State carry**: `rel_state` + patterns + canon version pinned per arm —
  relationship state as controlled variable, the thing the repo could not
  do while state was smeared across five stores.
- **D0 backtest wired first**: the battery must flag grok, luna, azure
  from the three archived bake-offs; a battery that passes them is broken.
- Helpline-trigger rate is a named compliance axis on every swap run, both
  directions (over- and under-trigger both observed).

---

## 8. India schema placement

india.md §7 adopted as spec; placement in this architecture:

| field | lives in | mechanism |
|---|---|---|
| `honorific_register` | `rel_state.register` | Explicit bidirectional state (§6.2); compiled into T1 as a directive shape, never a scripted line. Meera ships tu/tum; the enum carries aap for the general architecture. |
| `code_switch_baseline` | `rel_state` | Measured, not assumed; `direction_on_stress` per user. Input side is new build: the user's own switching is a signal read by the micro-pass (§4.2.4). |
| `kin_graph` | `meera_nodes` (person) + `rel_assertions` `kin:*` predicates | Role-labeled (chachi≠mausi≠bua), fictive-vs-blood and address-term in `value`; bi-temporal like everything else (address terms change as relationships warm). |
| `care_ritual_state` | `ritual:*` assertions + `rel_state.ritual_density` | "khana khaya?" freshness = latest `t_valid`; T4 carries a freshness note so it never goes rote — the recited-prompt problem, solved by data staleness instead of prompt pleading. |
| `festival_calendar_state` | `rel_profile.home_region` + shared calendar table (non-user data, culture.yml pattern) + per-user observed set in `rel_assertions` | Region-bound; T4 window note. |
| `topical_currency_log` | `currency_used:*` assertions | Freshness pool from bi-temporality — the graph gives staleness for free. |
| statics (mother_tongue, home_region, religion_observance opt-in, family_structure, dietary_identity) | `rel_profile` | Set once; `religion_observance` sensitive-flagged, opt-in receipts in `sensitive_consent` (DPDP). |

All compiled as shapes/values (recited-prompt); total India tail budget
150 tok (T4).

---

## 9. Safety and regulatory mechanisms

### 9.1 Invalidation vs forget — the two-mechanism rule, stated once

- **Belief changed** → invalidate: `t_invalid` set, row kept, history real.
- **User said forget** → hard delete of the ENTIRE lineage: the row, every
  row reachable via `invalidated_by` chains in both directions, embeddings,
  and derived dependents (§9.2). No tombstones, no `deleted_at`, nothing
  for recall to filter. Bi-temporal history loses to honest forget,
  explicitly and by design: a memory still in the table is still a memory.

### 9.2 Derived-state deletion (the DPDP asset, extended to the graph)

The 7-layer forget stack carries near-verbatim; layers 3–4 extend:

1. Strict marker parse, no salvage (kept — blast-radius asymmetry).
2. Whole-wipe structurally excluded from the marker vocabulary (kept).
3. Hard delete: `meera_log` rows in scope → `rel_episodes` in scope →
   **citation cascade**: `rel_assertions` where `citations && deleted_ids`
   (GIN index) deleted outright — *not* re-derived without the episode:
   taking too much is the safe direction (repo law). Same for
   `rel_patterns`; if survivors would drop below 2 citations, the pattern
   dies. `rel_state.evidence` stripped; a dim whose evidence empties is
   reset to its default with `direction='reset'` and diag'd. Embeddings
   rows deleted with owners. All in one batched transaction.
4. `meera_forget` suppression term (kept) — now also checked by the
   micro-pass AND sleep-pass before any write, so consolidation can't
   re-derive a forgotten thing from an old episode.
5. Client context prune (kept). 6. Photo/telemetry purge on the same terms
   (kept, TELEMETRY.md rule 3). 7. Delete completes BEFORE the "haan, hata
   diya" receipt; the live lane, which cannot delete mid-call, says so
   honestly (kept).

The citation spine is what makes layer 3 *provable*: the nightly integrity
sweep asserts zero assertions citing nonexistent episodes — i.e., forget
leaves no orphaned derivations, checkable in CI, showable to a regulator.

### 9.3 Export (the clearest safety-reg gap, closed)

`api/export.js`, one op per device_id: streams JSON —
log, episodes, current+invalidated assertions with validity intervals,
patterns, state dims with history, profile, phrase ledger — everything,
including belief history, because export that hides the graph is not
export. DPDP portability lands 2027-05-13; this ships in M1 (it is ~150
lines against device-scoped tables) so the posture is "ahead" not
"scrambling."

### 9.4 Session clock (§6-Q8 answer)

One server-side timer, three consumers. `rel_sessions.continuous_ms`
accumulates while gaps < 30 min. At each 3-hour boundary of continuous
interaction (CA SB 243 / NY): the compiler is *forced* to include T5 — an
AI-disclosure block with a fixed, authored, compliance-exact line (the one
place verbatim is correct: it is a disclosure, not persona improv; her
register may frame it, the disclosure sentence itself is byte-fixed and
verify-v3 asserts it). Same timer drives break-reminder shapes (softer,
authored) and the dependency circuit-breaker (owner-set thresholds on
continuous_ms/day; crossing them changes availability shapes in T1, never
warmth — identity-compatible by being state she is honest about, not a
persona mask slipping). T5 is never truncated and sits above T6 only
(prompt-position: last two slots are the two rule blocks). The client
keeps a mirror timer so a server outage cannot silence a legally required
disclosure (fails toward disclosing).

### 9.5 The rest

Age-tier engine-readable from day one (`rel_profile.age_tier`, §10-Q9).
Crisis: helplines in never-truncated core (B2), offline `critical` path
kept, `safety_hold` episodes decay-exempt, helpline-rate a named axis on
every model gate. Never-deny-AI and NEVER MANIPULATE stay verbatim
invariants with executable twins in verify-v3. Data-residency dimension in
`models.json` as anticipation (DPDP blacklist approach — no mandate today,
logged as such).

---

## 10. Answers to every RESEARCH.md §6 question

**Q1 — Fingerprint-gap target and what failure means.** Pre-registered:
D2 classifier accuracy (incumbent vs candidate, identical compiled
contexts, held-out dyads, n≥2,000 turns/arm) — baseline expectation ~97%
(arXiv:2502.12150). Staged targets: end of M3 (compiler+adapter, no
relational carry) ≤ 85%; end of M5 (full carry) ≤ 70%; Phase C exit gate
≤ 65% with D1 bands passing and D5 charm at equivalence. 50% is the
asymptote, not the gate — the company claim is passive-relational
indistinguishability, not adversarial. **Reversal condition, logged now:**
if no milestone moves D2 below 90% while its D1 bands pass, authored-state
+ compiler + adapters do NOT lift identity above the model; the program
claim is falsified at the offline stage, the consented cohort does not run
on the strong claim, and the company pivots to single-model excellence +
migration-UX (honest disclosure + re-attachment support), which the same
engine serves. A halted claim is a valid result (program brief).

**Q2 — WE-store schema.** Given concretely in §2.3/§6: WE = episode
participation typing + citation-carrying derived assertions + pattern
records. Companion-self-state is a three-way split: authored canon (fixed
self, git), derived assertions citing episodes (emergent self, DB), inner
thread (in-the-moment self, transient, retires when voiced). WE-retrieval
privileges participation via a deterministic moment-shape gate + rank
bonus — pull-only preserved; blast-radius argument for why this doesn't
violate the beat-routing rejection is stated in §6.3.

**Q3 — Memory carry-over vs character invariance.** Run the cheap vignette
pre-study in M1 (n≈200 crowd + 40 India-resident, 2×2 vignettes: memory
lapse × character shift, ≈$400, one week). Prior (Strohminger line:
morality/personality dominate perceived continuity) says character —
so the default budget split is 60% D1/D3/D5 (invariance) / 40% D4
(memory-behavior), and the graph makes D4 cheap anyway because callbacks
are retrieval-driven, not model-remembered. The pre-study can only move
the split, not create/destroy components.

**Q3a — Correction-on-retrieval.** When corrected: old assertion
invalidated (kept), `invalidated_by` set. Surfacing: the FIRST retrieval
that would have used the corrected fact injects a one-time shape note
("earlier had it as X — corrected") and sets `correction_surfaced`;
after that, only the current version compiles. The old trace stays
system-retrievable (bi-temporal supports it) and enters a prompt only when
the user explicitly asks what she used to think (pull-only). Edits are
stated, never silently substituted — standing on the repo's trust
invariants, with the withdrawn reconsolidation rationale left withdrawn.
Forget is different from correction: forget deletes the lineage (§9.1).

**Q4 — Adapter economics.** Protocol + envelope in §7.2: ≤$400, ≤5 days,
≤3 tune loops, else reject. First real measurement in M4 against one
candidate (grok-4-20 for the vision lane, already recommended in
decisions.md). If the envelope breaks, that is recorded as a falsifier for
router option value, and the roster strategy shifts to fewer,
better-qualified models.

**Q5 — Voice continuity.** Out of the graph's scope but scheduled: TTS
held constant across LLM swaps (router never couples them). D6 measures
LLM-swap-with-TTS-constant on her real register lines — no literature
exists; `realtime-azure` suggests generation-time coupling, so measure,
don't assume. Scale path: canonical speaker embedding as cheap pre-filter
only, then a trained familiar-judge panel (3 judges, 50-clip
familiarization each) — familiarity beats fidelity (n=47+47,
secondary-sourced) and `voice-ears` says the ear out-judges every metric;
the owner remains the final gate while n is small, and that bottleneck is
logged as unscalable rather than papered over.

**Q6 — Forgetting profile as product spec.** The curve: need-probability
decay on episodic kinds (§4.3.3, parameters in one file
`config/decay.json`: episodic half-life ~60 days of non-use; identity
kinds and `safety_hold` exempt; phrase ledger exempt — shared language is
identity-durable, per the RANK rationale). Decay lowers retrieval
priority only; deletion happens exclusively via forget/DPDP ops — so the
honest-forget promise and DPDP retention never collide with decay. The
owner signs `decay.json` in M2 as a product decision (the file is the
signature); D4 includes a "graceful transience" probe so the curve is
evaluated, not vibes.

**Q7 — Disclosure policy for real swaps.** Default, chosen now for
consistency with NEVER MANIPULATE and the consent posture: **disclose by
changelog** — model swaps are announced in-app in plain product language
(infrastructure register, not loss register), never denied if asked, never
pushed into her voice as if she chose it. Silence sits too close to the
covert line the program forbids. The debrief+2-weeks question (does
learning of an undetected swap retroactively damage the relationship?)
prices the alternative; until measured, calm-routine-disclosure is the
floor. Framing matters measurably (mention alone: mourning d=0.40;
revert-offer helps after real change d=0.44, harms after none d=0.40) —
so the changelog copy is an authored, tested artifact, not an afterthought.

**Q8 — Session clock.** §9.4: one server timer, three consumers
(disclosure, break, circuit-breaker), compiler-enforced never-truncated
block, byte-fixed compliance sentence with authored framing,
client-mirrored fail-toward-disclosure. Identity-compatible because it is
state she is honest about, in her register — not a modal slapped over her.

**Q9 — Age-tier for India.** Launch verified-adult-only (DPDP under-18
verifiable parental consent + no-addictive-design bar is not meetable by
a two-person team honestly). But the engine encodes the tier from day
one: `rel_profile.age_tier`, compiler reads it (a `minor` tier compiles a
structurally different B-set: no romance registers, hard session caps,
different break curves) — so the company-defining choice is a config
decision later, not a schema rebuild. `unverified` behaves as the most
restricted adult tier.

**Q10 — What replaces stageFor.** §6.2's dim table: register,
code_switch_baseline, rupture_open, repair_history, ritual_density,
pacing as state/measurements with evidence and regression; depth_tier
strictly derived, never read from message count, no rule keys on it
alone. Every dim lists what evidence moves it and both directions.

---

## 11. Build plan

Ten weeks, two people; every milestone ends with a gate that already
exists (`verify-release.mjs` + the invariant suite) plus the new
milestone-specific assert. File ownership = one owner per file, listed.

**M0 (week 0) — recover the definition of "her".**
Recover `verify-v3.mjs` (138 invariants) + `parsetest.bundle.mjs` from the
session scratchpad into `scripts/eval/`; wire into `verify-release.mjs`.
RESEARCH.md says this precedes everything and it does. Commit
`db/migrations/001–003` (applied, empty). Owner: A.
*Gate: suite green in CI from repo, not scratchpad.*

**M1 (weeks 1–2) — dual-write + export + pre-study.**
`api/_rel.js` (graph writers, citation checks), `opRemember` dual-write,
`scripts/relcheck.mjs` shadow diff, `api/export.js`, forget-cascade v2
shipped WITH dual-write (§2.5), Q3 vignette pre-study launched. Owner: A
(api), B (study).
*Gate: shadow ≥95% on 200 turns; forget-cascade integrity zero-orphan;
export round-trips a fixture dyad.*

**M2 (weeks 2–4) — episodes + micro-consolidation + semantic recall.**
Boundary detector in `brain.ts` (deterministic + cosine), `api/consolidate.js`
micro-pass with citation-required schema, embeddings wired
(`api/_embed.js`, Azure), recall v2 batched round trip, shape-linter
(`src/engine/shapelint.ts`). Owner: A. `config/decay.json` drafted, owner
signs. Owner: B.
*Gate: 50 hand-segmented sessions ≥80% boundary agreement; citation-drop
rate <5%; recall p50 ≤250 ms; shapelint rewrite rate <10%.*

**M3 (weeks 4–6) — the compiler + identity factoring + D0–D2.**
`src/engine/compiler.ts` (blocks, budgets, manifest, truncation order),
canon extracted to `src/identity/canon/*.json`, adapter #1 = incumbent
(`src/identity/adapters/gemini-3.6-flash.ts`), `check-prompt-budget.mjs`
v2 (fixture-driven), D0 backtest (must flag grok/luna/azure archives), D1
bands harness, D2 classifier baseline (`scripts/eval/dbattery/`).
Owner: A (compiler), B (battery).
*Gate: verify-v3 100% behind the compiler; core hash stable across a
1,000-turn fixture session; D0 flags all three; D2 baseline recorded and
≤85% target checked.*

**M4 (weeks 6–8) — relationship state + India + router + clock.**
Sleep-pass workflow (`.github/workflows/consolidate.yml`), `rel_state`
movement rules (`src/engine/relstate.ts`), moment-shape gate + WE
retrieval, T1/T4 compilation, `rel_profile` + India statics, router v1
(`src/engine/router.ts` + `config/models.json`), adapter derivation run
on one candidate (measures Q4 envelope), session clock (server +
client mirror + T5). Owner: A (router/clock), B (relstate/India).
*Gate: stageFor deleted; register moves only with evidence; disclosure
fires at 3h in a clocked fixture; candidate adapter within envelope or
rejection logged.*

**M5 (weeks 8–10) — full consolidation + D3–D6 + dry run.**
Contradiction sweep, pattern promotion, tier promotion, integrity sweep in
CI; correction-surfacing; D3 probe deck (~300 probes incl. India schema),
D4 callback-selectivity, D5 charm-parity harness (dual judges, n≥300,
counterbalanced — the methodology is already the company's best asset),
D6 plan doc; full D0–D6 dry run incumbent-vs-best-candidate. Phase C
exit report against the pre-registered D2 targets. Owner: B (battery),
A (consolidation).
*Gate: D2 ≤70% or the failure analysis that says why not, logged in
context/ either way.*

**Kept / lifted / rebuilt (delta to repo-audit.md §9 — this proposal
adopts its table wholesale; the graph-specific rulings):**
KEEP: meera_log, forget stack (extended §9.2), taste table, inner
mechanics + charter, culture pattern, budget-gate pattern, parseBubbles,
offline crisis, telemetry, liveCall/scene untouched, judging methodology.
LIFT: meera_nodes/edges → entity registry + assertions (dual-write
migration), 'phrase' + feel into the WE-store, opRemember pipeline shape
+ its four invariants → micro-pass, salience/staleness rank → retrieval
scorer, herLife → derived meera-assertions, inner storage → server.
REBUILD: stageFor → rel_state (deleted M4), keyword recall → embeddings +
graph (M2), regex fact capture → extraction-only (M2), fallback chain →
router (M4). NEW: episodes/WE-store, patterns, compiler, adapters,
D-battery, export, session clock, age tier.

---

## 12. Failure modes, and what evidence would show this design is wrong

1. **The ANCHOR risk — the biggest one.** ANCHOR shows memory architecture
   does not move the persona ceiling; this design's answer is that the
   lift comes from adapters + compiler + authored/relational state, not
   from the graph per se — but that is the bet, not a fact. **Wrong if:**
   D2 stays >90% across M3→M5 while D1 bands pass (Q1 reversal). Then the
   graph is a better memory for a persona that still reads as a different
   person, the strong claim dies offline, and the honest pivot (§10-Q1)
   executes. The graph work is not wasted in that world — recall
   precision, forget-cascade, export, and the WE-store still serve the
   migration-UX company — but the *company claim* is falsified and gets
   logged as such.
2. **Consolidation confabulation despite citations.** Citations can be
   decorative. **Wrong if:** the M2 gate fails persistently — citation-drop
   >5% or integrity-sweep hits >1% of rows — or a D3 probe catches derived
   facts the user never said at a rate above the fab-noise-floor
   discipline (n≥300 before believing any rate). Fallback: narrow the
   micro-pass to user_said/extracted only; derived patterns become
   owner-reviewed before activation (authored-in-the-loop, the shape that
   always wins in this repo).
3. **Graph latency over SQL-HTTP.** One batched round trip is the design;
   if real p50 recall >400 ms (budget 250), the tail eats the reply-time
   budget. **Wrong if:** M2 gate misses after batching + index passes.
   Fallback: per-dyad warm cache of the recall bundle keyed by
   last-consolidation stamp (state changes slowly; the cache is honest).
4. **Bi-temporal complexity vs a two-person team.** The quadruple is
   confined to one table for exactly this reason. **Wrong if:** M-gates
   slip twice because assertion-lineage bugs eat the schedule — then
   degrade to single-timeline validity (t_valid/t_invalid only, drop
   ingestion timeline), which loses extractor-error forensics but keeps
   every user-facing behavior.
5. **Shape-linter false economy.** If telegraphic compression destroys
   nuance the model needed, recall precision wins D4 but T2 reads flat.
   **Wrong if:** D5 charm parity degrades on memory-heavy probes vs the
   uncompiled incumbent. Fallback: raise per-row token allowance in T2,
   never re-admit sentence shapes (that law has two paid-for instances).
6. **Moment-shape gate too coarse** → WE-callbacks feel random or absent.
   **Wrong if:** D4 callback-selectivity shows hit-rate
   indistinguishable from topic-keyword baseline. Fallback: the HippoRAG
   PPR upgrade path (§3.3) — already slotted behind the same interface.
7. **Free-tier arithmetic.** Azure credits are a runway, not a fact
   (`free-tts-daily`: free tiers are daily budgets that run out
   together). The cost table (§4.5) prices everything at cash rates so
   the day credits die is a known number (~$0.02/user/day consolidation,
   $0.002/turn chat), not a surprise. **Wrong if:** measured cash burn
   >2× those figures at M5 — then consolidation frequency and tier-K
   backfill are the knobs, and they are knobs, not load-bearing walls.
8. **The sham-arm could still kill the claim at Phase D** even after a
   clean D2: attached users may detect through channels no offline
   battery models (pacing across days, initiative patterns). That is
   what the consented cohort exists to find, its stop rules are already
   specified (RESEARCH.md §5), and a halted study is a valid negative
   result. This proposal's job was to make the attempt measurable; it
   does not promise the attempt succeeds.

---

*Depth over breadth check: every load-bearing number above is either from
`context/measurements.md`/`RESEARCH.md` (cited inline) or is a
pre-registered target/budget introduced here and marked as such. Where a
mechanism is this proposal's own design with no prior art (WE typing,
citation-cascade forget, moment-shape gate), it says so.*
