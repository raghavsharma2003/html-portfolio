# PROPOSAL B-events — Event-Sourcing-First Relational State

Phase B design proposal, Vyakti relational-state program. 2026-08-13.
Prior defended here: **EVENT-SOURCING-FIRST.** Episodes are the only source of
truth. Every piece of derived state — facts, taste-candidates, relationship
stage, honorific register, WE-patterns — is a rebuildable projection with a
citation trail back to episodes, recomputed by offline consolidation jobs.

## 0. Thesis, and why replayability is the load-bearing argument

The program has four hard jobs that look unrelated and are actually the same
job:

1. **Honest forget including derived state** (repo law + DPDP 2027): when a
   user says forget, every downstream trace must die, including traces the
   consolidator inferred.
2. **Swap-test control** (swap-test.md D0–D6): both arms must receive
   *byte-identical compiled contexts*, and the sham arm must be
   indistinguishable in everything except the model slug.
3. **Consolidation without confabulation** (`consolidation-citation`, the
   most-evidenced constraint in the cognitive track): no derived fact without
   a citation trail, or the reflector invents.
4. **Audit** (FTC 6(b) makes persona design an audit surface; safety-reg.md
   §5.7): what changed, when, derived from what.

All four reduce to one property: **the entire relational state must be a
function of (append-only episode log, authored identity data, code version)**.
If that holds:

- Forget = delete episodes in scope + delete every derived row whose citation
  set intersects the deleted ids. Derived-state deletion stops being a promise
  and becomes a SQL join. This is the single strongest argument for this
  design: **citations make derived-state deletion computable.** No other
  architecture in the Phase A sweep can say that — a mutable fact-store with
  no provenance can only forget what it can find by keyword.
- Swap test = both arms compile from the same projection snapshot hash. "Same
  compiled context, different model" (repo-audit §10.2) is a stored,
  checkable artifact, not a hope.
- Confabulation control = a derived row that cites nothing, or cites an
  episode outside its input window, is rejected *at write time by the
  database*, not caught later by a judge.
- Audit = `vk_derivations` is the audit log for free; it is the same table
  consolidation already needs.

**Honesty about the word "rebuildable."** The consolidator is an LLM
(`extract-model`), so a replay is not bit-identical. This proposal defines
rebuildability as three separable guarantees, each achieved by a different
mechanism, none requiring LLM determinism:

- **Deletable**: by citation-join — pure SQL, deterministic (mechanism above).
- **Auditable**: every derived row's derivation record (model, prompt hash,
  input span, output) is stored; any row can be checked against its cited
  episodes at any time.
- **Re-derivable**: a full rebuild from the log is allowed to produce
  *different but equally cited* projections; it must pass the same invariant
  suite and entailment audit. Bit-identity is claimed only for the two lanes
  where it is achievable and needed: deletion and context compilation
  (compilation is a pure function of stored rows).

Everything below is the concrete form of that thesis, honoring the measured
laws: `consolidation-citation`, `recited-prompt` (shape-linting on every
injected string), `prompt-position` (decision rules dead last, enforced by the
compiler), `cache-9x` (byte-stable prefix as an emitted, hashed artifact),
`silent-truncation` (per-block budgets, declared truncation order, loud-fail
telemetry, CI gate), `taste-consistency` (authored state + deterministic
retrieval is the spine, extended not replaced), the model-ceiling law
(`charm-grok`, ANCHOR — §5 says exactly which identity layers this design
claims to lift and which it explicitly does not), the safety invariants
(carried verbatim; forget stack carried near-verbatim and generalized to
derived state), sham-arm methodology, and DPDP deletion/export. Team
constraints honored throughout: Neon Postgres over SQL-HTTP stays the only
database (plus pgvector, which Neon ships), Vercel functions stay the backend,
free tiers are treated as daily budgets (`free-tts-daily`), and nothing here
requires a new paid service.

---

## 1. Component map

```
                        ┌────────────────────────────────────────────┐
                        │ AUTHORED STATE (in repo, versioned)        │
                        │ canon notes · taste table · invariants     │
                        │ (verbatim) · India festival calendar ·     │
                        │ per-model adapters · decay-curve config    │
                        └──────────────┬─────────────────────────────┘
                                       │ read at compile time (hash-pinned)
  client ──turn──► api/chat.js ──► CONTEXT COMPILER (src/engine/compiler.ts)
                        │              │  emits: prompt + manifest{block,tok,hash}
                        │              ▼
                        │        MODEL ROUTER (src/engine/router.ts + api/route table)
                        │         adapters · fingerprint-gate status · billing/caching
                        │         constraints as data · offline crisis path (KEEP)
                        │
                        ├──append──► vk_events  (EPISODE LOG — the only source of truth)
                        │                │
                        │                │ offline, debounced + nightly cron
                        │                ▼
                        │        CONSOLIDATOR (api/consolidate.js, grok-4-1-fast-reasoning
                        │         on Azure credits, OpenRouter fallback — extract-model KEEP)
                        │                │  writes ONLY rows with citations
                        │                ▼
                        │   PROJECTIONS (all rebuildable, all cited)
                        │    vk_episodes · vk_facts (bi-temporal) · vk_we_patterns
                        │    vk_rel_state + vk_rel_transitions · vk_kin · vk_rituals
                        │    vk_currency · vk_self_facts · vk_embeddings (pgvector)
                        │                │
                        │                ▼ deterministic retrieval (pull-only)
                        │        back into COMPILER tail blocks (shape-linted)
                        │
                        ├── FORGET PLANE: api/memory.js opForget generalized —
                        │    delete events → citation-join delete of projections →
                        │    vk_forget suppression → client prune → media/telemetry purge
                        │    → receipt AFTER delete (all 7 layers KEEP)
                        ├── EXPORT PLANE: api/export.js (new) — events+projections bundle
                        └── SESSION CLOCK: vk_sessions timer (api/clock.js) — 3h disclosure,
                             break nudges, dependency circuit-breaker; app-voice, not hers
```

Unchanged and deliberately untouched: `liveCall.ts` audio floor, `scene.ts`
watch wake model, `parseBubbles` hostile-output discipline, offline
`localHeart` crisis path, telemetry substrate (forget-integrated), judging
methodology. The live lane keeps "compile once at pickup" (`live-floor`): the
compiler produces one frozen snapshot per call.

---

## 2. Full SQL schema (Neon) and migration from db/schema.sql

Naming: new tables are `vk_*` (Vyakti engine, persona-agnostic — Meera is
instance one). Existing `meera_*` tables are kept during migration and either
retired or retained per the table below. Device-scoped-by-construction
deletion (schema.sql's load-bearing pattern) is preserved: every user-scoped
table keys on `device_id`, with `user_id` carried for the account-portability
lift the safety track demands (a relationship that survives a model swap must
survive a device swap — safety-reg §5.2).

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 2.1 THE EPISODE LOG — append-only, the only source of truth.
-- Supersedes meera_log as the substrate; meera_log is backfilled into it.
-- No UPDATE path exists in application code; forget is the only DELETE.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists vk_events (
  id          bigint generated always as identity primary key,
  device_id   uuid not null,
  user_id     uuid,                          -- account linkage when signed in
  session_id  text,                          -- ties to meera_tel_session
  channel     text not null default 'chat',  -- chat|call|watch|system
  role        text not null,                 -- user|her|system
  kind        text not null default 'text',
  -- kinds: text | voice_transcript | photo_desc | visual_assertion |
  --        affect_obs | register_obs | inner_state | clock | consent | forget_receipt
  content     text not null,
  meta        jsonb not null default '{}'::jsonb,
  -- meta carries the multimodal episode record fields (RESEARCH §3.8):
  --   affect_tags: [{label, intensity, extractor, confidence}]  (symbolic, text)
  --   visual: {claim, model, confidence, declared_illegible}    (vision-fab law)
  --   medium markers, src_log_id (migration provenance), voice_reference_id
  at          timestamptz not null default now()
);
create index if not exists vk_events_device_at on vk_events (device_id, at desc);
create index if not exists vk_events_device_id on vk_events (device_id, id);
create index if not exists vk_events_session   on vk_events (session_id, id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.2 EPISODES — segmentation projection. Boundaries on conversational
-- prediction error (topic/affect/goal shift, channel change, sleep gap), not
-- wall-clock chunking (EST, cognitive-arch §2). citations = the event ids the
-- episode spans; the summary is telegraphic and shape-linted at write time.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists vk_episodes (
  id              bigint generated always as identity primary key,
  device_id       uuid not null,
  channel         text not null,
  boundary_reason text not null,     -- gap|topic|affect|goal|channel|session_end
  summary         text not null,     -- telegraphic notes, never sentences she could say
  affect_tags     jsonb not null default '[]'::jsonb,
  salience        real not null default 1.0,   -- feel-asymmetry carried from RANK
  boundary_weight real not null default 0.0,   -- EST: boundary-ness ≠ intensity, separate channel
  tier            smallint not null default 0, -- 0=fresh 1=weekly-narrative 2=era
  safety_tagged   boolean not null default false, -- never decay-eligible
  citations       bigint[] not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_recalled   timestamptz,
  constraint vk_episodes_cited check (cardinality(citations) >= 1)
);
create index if not exists vk_episodes_device on vk_episodes (device_id, salience desc, updated_at desc);
create index if not exists vk_episodes_cit on vk_episodes using gin (citations);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.3 FACTS — bi-temporal, supersede-don't-delete (Zep model, VERIFIED
-- arXiv:2501.13956 §2.2.3). Two timelines: valid_from/invalid_at (world),
-- recorded_at/retired_at (ingestion). Contradiction sets invalid_at + writes
-- the superseding row; belief history is preserved. `feel` keeps THEIR OWN
-- words only (schema.sql law). `perspective` is the WE/I typing that no
-- surveyed system has (RESEARCH §7) — greenfield, ours.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists vk_facts (
  id            bigint generated always as identity primary key,
  device_id     uuid not null,
  kind          text not null,   -- person|place|preference|fact|event|phrase|self
  name          text not null,
  body          text not null,   -- telegraphic; shape-linted on write
  feel          text not null default '',
  perspective   text not null default 'user'
                check (perspective in ('user','her','we')),
  valid_from    timestamptz not null default now(),
  invalid_at    timestamptz,
  superseded_by bigint references vk_facts(id),
  recorded_at   timestamptz not null default now(),
  retired_at    timestamptz,
  time_bound    boolean not null default false,  -- staleNote mechanism carried
  salience      real not null default 1.0,
  mentions      integer not null default 1,
  last_recalled timestamptz,
  citations     bigint[] not null default '{}',
  provenance    text not null default 'consolidation'
                check (provenance in ('consolidation','authored','legacy')),
  -- THE CITATION LAW, enforced by the database, not by discipline:
  constraint vk_facts_cited
    check (provenance <> 'consolidation' or cardinality(citations) >= 1)
);
create index if not exists vk_facts_device_name on vk_facts (device_id, name);
create index if not exists vk_facts_live on vk_facts (device_id, salience desc)
  where invalid_at is null and retired_at is null;
create index if not exists vk_facts_cit on vk_facts using gin (citations);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.4 WE-STORE — dyadic pattern records (Baldwin relational schemas,
-- cognitive-arch §6). if/then stored as SHAPES (recited-prompt law), retrieved
-- by moment-shape tags, not topic keywords. Nobody ships this (RESEARCH §2).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists vk_we_patterns (
  id              bigint generated always as identity primary key,
  device_id       uuid not null,
  if_shape        text not null,   -- "goes quiet before saying something honest"
  then_shape      text not null,   -- "don't fill the silence" — a shape, never a line
  moment_tags     text[] not null, -- {'pre-honesty-silence','late-night','post-rupture'}
  self_in_relation text not null default '',  -- Bowlby IWM: her-with-him, paired
  confidence      real not null default 0.5,
  reinforced      integer not null default 1,
  last_seen       timestamptz not null default now(),
  citations       bigint[] not null,
  retired_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint vk_we_cited check (cardinality(citations) >= 2)
  -- ≥2: a dyadic PATTERN needs at least two instances; one instance is an event
);
create index if not exists vk_we_tags on vk_we_patterns using gin (moment_tags);
create index if not exists vk_we_cit  on vk_we_patterns using gin (citations);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.5 RELATIONSHIP STATE — replaces stageFor(messageCount). Current values in
-- one row; every movement is a cited transition. Fields can REGRESS.
-- India dynamic state is embedded HERE, not beside it (RESEARCH §3.2/§3.7).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists vk_rel_state (
  device_id        uuid primary key,
  user_id          uuid,
  honorific        text not null default 'tum' check (honorific in ('tu','tum','aap')),
  -- Meera ships on the tu/tum axis (india.md §3); schema keeps aap for the
  -- general architecture (elder/teacher personas).
  cs_ratio         real,            -- rolling code-switch baseline (their %Hindi tokens)
  cs_on_stress     text not null default 'unknown'
                   check (cs_on_stress in ('to_l1','to_l2','unknown')),
  -- direction learned per user; "more Hindi = closer" is a documented misread
  warmth           real not null default 0.30,  -- slow scalar in [0,1]
  trust            real not null default 0.30,
  ritual_density   real not null default 0.0,   -- rituals/week, derived
  rupture_open     boolean not null default false,
  last_rupture_at  timestamptz,
  repair_state     text not null default 'none'
                   check (repair_state in ('none','open','repairing','repaired')),
  snapshot_ver     integer not null default 0,  -- bumps ONLY at consolidation (cache law)
  updated_at       timestamptz not null default now()
);

create table if not exists vk_rel_transitions (
  id         bigint generated always as identity primary key,
  device_id  uuid not null,
  field      text not null,
  from_v     text not null,
  to_v       text not null,
  direction  text not null check (direction in ('advance','regress','reset')),
  reason     text not null,          -- telegraphic
  citations  bigint[] not null,
  at         timestamptz not null default now(),
  constraint vk_relt_cited check (cardinality(citations) >= 1)
);
create index if not exists vk_relt_device on vk_rel_transitions (device_id, at desc);
create index if not exists vk_relt_cit on vk_rel_transitions using gin (citations);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.6 INDIA SCHEMA (india.md §7 adopted as spec) — dynamic parts
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists vk_kin (
  id             bigint generated always as identity primary key,
  device_id      uuid not null,
  person_fact_id bigint references vk_facts(id),
  relation_type  text not null,    -- chachi|mausi|bua|didi|... role-labeled, not "aunt"
  fictive        boolean not null default false,
  address_term   text not null default '',
  citations      bigint[] not null,
  updated_at     timestamptz not null default now(),
  constraint vk_kin_cited check (cardinality(citations) >= 1)
);

create table if not exists vk_rituals (
  id           bigint generated always as identity primary key,
  device_id    uuid not null,
  ritual       text not null,      -- khana_khaya|good_morning|match_checkin|...
  last_done_at timestamptz,
  cadence_days real,
  gone_rote    boolean not null default false, -- consolidator flags hollow repetition
  citations    bigint[] not null,
  constraint vk_rituals_cited check (cardinality(citations) >= 1)
);
create unique index if not exists vk_rituals_dr on vk_rituals (device_id, ritual);

create table if not exists vk_currency (
  id         bigint generated always as identity primary key,
  device_id  uuid not null,
  topic      text not null,        -- specific team/player/dish/place
  category   text not null,        -- cricket|food|place|festival|film
  last_used  timestamptz,
  uses       integer not null default 0,
  citations  bigint[] not null,
  constraint vk_curr_cited check (cardinality(citations) >= 1)
);

-- Static cultural profile (india.md §7B) — profile facts, opt-in sensitive
-- fields flagged for DPDP handling; read-gated, export-included, forget-covered.
create table if not exists vk_profile (
  device_id       uuid primary key,
  user_id         uuid,
  mother_tongue   text,
  home_region     text,
  religion_obs    jsonb,           -- opt-in only; null until explicitly disclosed
  family_shape    jsonb,           -- joint|nuclear + names once given
  dietary         text[],
  age_tier        text not null default 'unverified'
                  check (age_tier in ('unverified','adult','minor')),
  sensitive_keys  text[] not null default '{}',  -- DPDP-sensitive field names
  updated_at      timestamptz not null default now()
);
-- festival calendar is AUTHORED shared data (region-keyed file in repo),
-- not user data — same pattern as meera_culture. Per-user observance lives in
-- vk_profile.religion_obs + vk_rituals.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.7 SELF-FACTS (herLife lift) — her life ledger, server-side, cited when
-- consolidation-derived, authored when canon.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists vk_self_facts (
  id          bigint generated always as identity primary key,
  device_id   uuid not null,       -- per-relationship: what she told THIS user
  body        text not null,
  topic_key   text not null,       -- replaces 2-word-overlap dedupe: explicit key
  citations   bigint[] not null default '{}',
  provenance  text not null default 'consolidation'
              check (provenance in ('consolidation','authored')),
  recorded_at timestamptz not null default now(),
  retired_at  timestamptz,
  constraint vk_self_cited
    check (provenance <> 'consolidation' or cardinality(citations) >= 1)
);
create unique index if not exists vk_self_topic
  on vk_self_facts (device_id, topic_key) where retired_at is null;
-- newest-wins becomes: retire old row, insert new — history kept, prompt consistent.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.8 RETRIEVAL — embeddings (closes `semantic-recall`). Neon ships pgvector.
-- text-embedding-3-small is already deployed on Azure, unwired (architecture.md).
-- ═══════════════════════════════════════════════════════════════════════════
create extension if not exists vector;
create table if not exists vk_embeddings (
  ref_table  text not null,        -- vk_facts|vk_episodes|vk_we_patterns
  ref_id     bigint not null,
  device_id  uuid not null,
  emb        halfvec(1536) not null,   -- halfvec: 3KB/row, storage arithmetic §4
  primary key (ref_table, ref_id)
);
create index if not exists vk_emb_hnsw on vk_embeddings
  using hnsw (emb halfvec_cosine_ops);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.9 DERIVATION AUDIT + CONSOLIDATION BOOKKEEPING
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists vk_derivations (
  id           bigint generated always as identity primary key,
  device_id    uuid not null,
  run_id       bigint not null,
  model        text not null,
  prompt_hash  text not null,
  input_from   bigint not null,    -- vk_events id span the run was allowed to cite
  input_to     bigint not null,
  wrote        jsonb not null,     -- [{table, id}]
  audit_status text not null default 'unaudited'
               check (audit_status in ('unaudited','entailed','refuted')),
  at           timestamptz not null default now()
);
create table if not exists vk_consolidation_runs (
  id          bigint generated always as identity primary key,
  device_id   uuid not null,
  kind        text not null check (kind in ('session','nightly','weekly','rebuild')),
  ev_from     bigint not null,
  ev_to       bigint not null,
  status      text not null default 'running'
              check (status in ('running','done','failed')),
  tokens_in   integer, tokens_out integer,
  at          timestamptz not null default now()
);
create index if not exists vk_runs_device on vk_consolidation_runs (device_id, at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.10 SAFETY PLANE
-- ═══════════════════════════════════════════════════════════════════════════
-- suppression terms: meera_forget carried unchanged in role; renamed for scope
create table if not exists vk_forget (
  id        bigint generated always as identity primary key,
  device_id uuid not null,
  term      text not null,
  at        timestamptz not null default now()
);
create unique index if not exists vk_forget_dt on vk_forget (device_id, lower(term));

create table if not exists vk_sessions (       -- session clock (safety-reg §5.3/5.5)
  session_id     text primary key,
  device_id      uuid not null,
  started_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  disclosed_at   timestamptz,                  -- last 3h AI-disclosure fire
  break_nudges   integer not null default 0
);

create table if not exists vk_export_jobs (    -- DPDP access/export (the named gap)
  id         bigint generated always as identity primary key,
  device_id  uuid not null,
  status     text not null default 'pending'
             check (status in ('pending','ready','collected','expired')),
  url        text,
  at         timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.11 ROUTER TABLE — measured constraints as data (repo-audit §6)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists vk_models (
  model_id       text primary key,
  provider       text not null,
  billing        text not null,    -- credits|cash|user_key  (credits-partner trap)
  prefix_cache   boolean not null, -- cache-9x: no cache ≈ 9x cost, encoded not remembered
  effort_map     jsonb not null,   -- per-lane effort tier (inversion is model-specific)
  max_tokens_sem text not null,    -- 'visible_only'|'total' (xAI vs GPT semantics)
  residency      text,             -- DPDP anticipation, logged as anticipation
  adapter_id     text,             -- null = ineligible: no adapter, no routing
  gate_status    jsonb not null default '{}'::jsonb, -- {D0..D6: {passed, date, report}}
  eligible       boolean not null default false
);
```

### Migration path from db/schema.sql (ordered, reversible)

1. **M1a — additive.** Run all `vk_*` DDL above (idempotent, like schema.sql).
   Nothing existing changes.
2. **M1b — dual-write.** `api/memory.js opLog` writes `meera_log` AND
   `vk_events` (`meta.src_log_id` carries the meera_log id). One deploy;
   revert = remove the second insert.
3. **M1c — backfill.** One script (`scripts/migrate-events.mjs`) copies
   `meera_log → vk_events` in `at` order, per device, skipping rows already
   present by `src_log_id`. Re-runnable.
4. **M1d — legacy projections.** `meera_nodes/meera_edges → vk_facts`:
   `provenance='legacy'`, `citations` recovered where possible by joining the
   node's `created_at..updated_at` window to migrated events for that device
   (best-effort, marked in a `meta` derivation record); otherwise empty.
   Legacy rows are **barred from being cited by new derivations** and are
   deleted on any forget whose scope plausibly covers them — over-deletion is
   the safe direction (repo's own forget law). The weekly consolidator
   re-derives their content from the migrated event log with real citations,
   retiring the legacy row when a cited replacement lands (`supersedes`
   pattern, never silent deletion — decisions.md discipline).
   `meera_forget → vk_forget` copies verbatim.
5. **M1e — cutover.** Reads move to `vk_*`; `meera_log` writing stops after a
   2-week parity check (`scripts/check-migration.mjs` diffs counts and spot
   samples). `meera_log` is retained frozen for one release, then dropped.
   `meera_diag`, `meera_tel*`, `meera_state`, `meera_culture`,
   `meera_search_cache` are **kept as-is** — they are not relational state.
6. **Namespace trap honored:** no table named the same as any index
   (schema.sql's measured meera_tel_session trap); all `vk_*` index names are
   prefixed distinctly and the DDL file carries the warning forward.

---

## 3. The context compiler

`src/engine/compiler.ts` — the highest-leverage rebuild (repo-audit §5). An
explicit compiler over **typed blocks** with per-block token budgets, a
declared truncation order, and an emitted **assembly manifest**
`{block_id, tokens, sha256}[]` logged to telemetry every turn — the artifact
D2 replays and the sham arm depend on.

### Exact layout (chat lane; call/cascade identical shape, live = frozen at pickup)

Budgets in tokens. Measured reference: chat lane totals 10,613 input tokens at
99.8% cached (`cache-9x`). The compiler's cap sums to ~11.2k; `api/chat.js`
slice caps are generated FROM the manifest so guard and guarded cannot drift
(check-prompt-budget pattern, extended).

| # | block | budget | stability | content and position rationale |
|---|---|---|---|---|
| 1 | `core.identity` | 3,800 | **byte-stable per release** | Canon as telegraphic notes/shapes (never lines — `recited-prompt`); factored from the 45k monolith. Hash pinned to repo version. |
| 2 | `core.safety` | 700 | byte-stable per release | Crisis lines, never-deny-AI, NEVER MANIPULATE — **verbatim** (non-negotiable inputs). Sits inside the cached prefix so it can never be the truncation casualty; `silent-truncation` ate helplines once, so safety lives at a position that overflow cannot reach. |
| 3 | `core.adapter` | 450 | byte-stable per (model, release) | Per-model register rendering, tag vocabulary, bracket policy, length directive. Different model ⇒ different cache prefix, correctly. |
| — | **cache breakpoint** | — | — | `cache_control` here. Everything above is byte-identical for every turn of every conversation on this (release, model). |
| 4 | `snap.rel` | 350 | **per-conversation frozen** | vk_rel_state rendered as values/shapes (honorific, cs baseline+direction, repair state, ritual dues). `snapshot_ver` bumps only at consolidation, which only runs offline ⇒ never moves mid-conversation ⇒ blocks 4–6 join the stable prefix *within* a conversation, preserving the measured 99.8% hit rate. |
| 5 | `snap.self` | 250 | per-conversation frozen | vk_self_facts live rows (topic-keyed, consistent by construction). |
| 6 | `snap.day` | 150 | per-day | weekShape (pure clock function, KEEP) + culture day index (pull-only pattern KEEP). |
| 7 | `tail.history` | 3,600 | volatile | Client-managed turns, post-`messagesAfterForget` prune (KEEP). |
| 8 | `tail.watch` | 350 | volatile | Watch block early in tail — it carries privacy rules (existing rationale, kept). |
| 9 | `tail.recall` | 700 | volatile | Retrieved episodes/facts/WE-records, telegraphic, `matched` vs `STANDING BACKGROUND — context only, never raise unprompted` labels (pull-only law). **Shape-linted**: any candidate string failing the lint (≥8 words, terminal punctuation, first/second-person subject — sentence-shaped) is rejected and re-telegraphed or dropped; this is the enforced fix for the MemGPT raw-reinsertion collision. |
| 10 | `tail.inner` | 250 | volatile | Thread/wants/owed — **first-protected in tail**: "if anything is lost it must be the recall list, never where she actually is" (existing law, now encoded as eviction order, not a comment). |
| 11 | `tail.decision` | 250 | volatile | `SEARCH_DECISION`, `FORGET_DECISION` — **dead last, always** (`prompt-position` 0/8→8/8). The appended-last set is capped at these two: position is a scarce resource; adding rules here dilutes the mechanism that makes them fire. Register/honorific behavior is NOT a decision rule — it is state in block 4 plus adapter rendering. |

### Enforced properties

- **Budget overflow is loud.** Eviction order (first casualty → last):
  `tail.recall.background` → `tail.recall.matched` → `snap.day` →
  `tail.history` oldest turns → **never** `tail.inner`, `tail.watch` privacy
  rules, `tail.decision`, or anything in core. Every eviction logs a
  `compiler.evict` telemetry event with block and tokens; an eviction reaching
  `tail.history` pages the owner (this is the `silent-truncation` law turned
  into an alarm instead of a silence).
- **CI gate.** `scripts/check-prompt-budget.mjs` extended: builds the compiler
  against fixture state, asserts every block ≤ budget, asserts the manifest
  sum ≤ the `api/chat.js` cap it generates, asserts `tail.decision` is the
  final bytes, and asserts the shape-linter rejects a seeded sentence-shaped
  fixture. Build fails otherwise.
- **Determinism.** `compile(stateSnapshot, authoredVersion, adapterId, turnInput)`
  is pure; same inputs ⇒ same bytes ⇒ same manifest hash. This is what makes
  "identical compiled contexts" in D2/D4 and the sham arm a checkable claim.

---

## 4. Consolidation

**When it runs.** Off the critical path, three cadences, all within free-tier
mechanics (Vercel cron is limited on the free plan, so cron is not the only
trigger):

- **Session pass** — when a request arrives and an unconsolidated event span
  older than 30 minutes exists for the device, `api/chat.js` fires
  `api/consolidate.js` via `waitUntil` (fire-and-forget, after the reply is
  delivered — never adds latency; `extract-model` invariant kept). Debounce
  guard in `vk_consolidation_runs`.
- **Nightly cron** — sweeps devices with pending spans the lazy trigger
  missed (users who close the app and don't return).
- **Weekly pass** — hierarchy: tier-0 episodes → tier-1 week narrative;
  re-consolidation (contradiction resolution via bi-temporal supersede);
  decay re-scoring by need-probability (recency × frequency-of-relevance,
  ACT-R — decay lowers retrieval priority only, never deletes; invalidation
  marks falsity — two mechanisms, two jobs); rote-detection for rituals;
  taste-row candidate promotion (§5).

**What it writes.** One pass decides everything for its span (the measured
"two passes contradict each other" invariant, KEEP): episode segmentation
(boundary on prediction-error features: time gap > sleep threshold, channel
change, topic/affect shift scored by the extractor), vk_facts upserts
(bi-temporal supersede on contradiction), WE-pattern reinforcement or
candidacy, rel-state transition proposals, self-fact updates, ritual/currency
bookkeeping, embeddings for new rows. Input starvation kept: the extractor
receives conversation text with timestamps and gap markers stripped (G1 — no
path from reply speed to her mood); episode boundary detection uses gaps but
runs as a separate pre-pass whose output is structural (span cuts), not
affective. Output JSON is truncation-ordered — interior/rel-state first, the
re-derivable node list last (measured invariant, KEEP). Importance scoring is
**not raw LLM self-rating** (documented inflation): salience = feel-present
asymmetry (1.6 vs 1.0, carried from RANK) × user-return-signal (mentions
across ≥2 sessions) × recency, computed in code from countable features.

**How citations are enforced — four layers, cheapest first:**

1. **Schema**: `CHECK (cardinality(citations) >= 1)` (≥2 for WE-patterns).
   A consolidation-provenance row without citations cannot exist.
2. **Writer validation**: every cited id must lie inside
   `[input_from, input_to]` of the run and belong to the same `device_id`. A
   citation outside the input window is confabulation *by construction* and
   rejects the whole item (strict, no salvage — blast-radius asymmetry law).
3. **Sampled entailment audit**: 5% of writes (100% of rel-state transitions
   and WE-patterns — low volume, high blast radius) re-checked by a
   second-family model: "is this claim supported by these episodes?" Result
   → `vk_derivations.audit_status`; refuted rows are retired and counted; a
   refutation rate >2% halts the consolidator and pages the owner.
4. **CI**: `scripts/check-citations.mjs` — referential integrity sweep
   (every cited id exists, same device, no legacy row cited), runnable
   against fixtures in CI and against prod nightly.

**What it costs** (estimate; RESEARCH §8 names consolidation cost as unpriced,
so method stated: token arithmetic from measured turn sizes, ~40 tok/turn,
~150 turns/active-day):

| pass | in tok/user | out tok/user | cadence | est. $/user (grok-4-1-fast, Azure credits) |
|---|---|---|---|---|
| session/nightly | ~9,500 (day's events 6k + live projections 2k + instructions 1.5k) | ~1,200 | per active day | ≈ $0.0025 |
| weekly | ~4,000 | ~500 | per week | ≈ $0.001 |
| entailment audit | ~600/sampled item | ~50 | 5% of writes | ≈ $0.0002/day |

≈ **$0.003/active-user-day ⇒ $3/day at 1,000 DAU, on credits**, with the
OpenRouter fallback for the measured 7.5% Azure `DeploymentNotFound` rate ("a
bad Azure minute must cost a slower extraction, never a lost memory" — KEEP).
Neon storage: ~300 B/event ⇒ ~45 KB/user-day ⇒ ~16 MB/user-year raw events;
embeddings ~3 KB/row halfvec. Free tier (0.5 GB) covers the entire pre-user
phase D0–D6 plus a ~200-person cohort-year; first paid Neon tier covers 10k
users. These are estimates, flagged as such; M2's exit gate includes replacing
them with measured numbers (n, method, date) in measurements.md.

---

## 5. The identity core — which layers this design claims to lift, and how

Per identity.md's seven-layer decomposition. Saying this precisely is the
brief's requirement; the ceiling law (`charm-grok` 38–2 byte-identical, ANCHOR
memory-invariance) makes over-claiming here the design's biggest lie risk.

| layer | claimed lifted? | mechanism |
|---|---|---|
| **Opinions & taste** | **YES — already proven** (27%→63%, n=480). | Authored table KEEP, deterministic pull-only retrieval KEEP. Extension: the consolidator **nominates** taste-row candidates (a stance she expressed consistently, ≥3 citations across ≥2 weeks) into an **owner review queue**; only owner-approved rows enter the authored table. Generated text never writes the identity core directly — that keeps the "authored" property that the measurement rests on. "More rows, not more prompt" becomes a pipeline. |
| **Memory / relationship history** | **YES — by construction.** | Event log + cited projections + deterministic retrieval. It is data looked up the same way whatever model runs; the model-dependent step (extraction) is off-path, gated by the entailment audit, and D4 measures cross-model extraction parity before any swap. |
| **Relationship state (incl. honorific register)** | **YES — the new claim this proposal stakes.** | Explicit typed state (vk_rel_state) moved only by cited consolidation transitions, rendered into the compiled context as values/shapes. The state itself cannot leak through a swap because no model re-derives it per turn. What CAN leak is the *rendering* — which is the adapter's job and D1's gate (register bands would have caught all three historical failures). |
| **Boundaries** | **PARTIALLY — hard invariants yes, calibration no.** | Never-deny-AI / NEVER MANIPULATE / crisis lines: verbatim in `core.safety` inside the cached prefix + the 138-invariant executable suite (recovered to repo in M0) + helpline-trigger rate as a named compliance axis on every swap. Escalation *calibration* (when exactly to surface helplines) is measured model-specific (16.7% vs 0% over-trigger both observed) ⇒ it belongs to the adapter and to D3's boundary-*style* probes, not to a portability claim. |
| **Behavioral policy** (turn length, question rate, tag use) | **NO — not lifted; gated.** | `charm-luna` (0/144 tags against an explicit instruction) proves instruction ≠ compliance and the gap is model-specific. Mechanism: per-model adapter derivation (§7) + D1 deterministic bands as an eligibility gate. The router refuses models whose adapter cannot hold the bands; it does not pretend prompting fixes them. |
| **Relationship stance** (warmth, personhood, humour) | **NO — explicitly not claimed.** | The most damaged layer under swap (34–4) and the one ANCHOR says memory scaffolds don't move. Mechanism is selection, not lift: D5 charm parity at n≥300 is a hard gate; a model that cannot carry stance is ineligible regardless of price. Revisit-condition logged: activation steering / persona vectors the moment an open-weight model clears the charm bar (identity.md §4). |
| **Voice / timbre** | **PARTIALLY — architecturally separated, gate is the mechanism.** | Voice stays decoupled from the brain (already true); canonical accepted-clip set + speaker embedding as reference (never a vendor voice ID — RESEARCH §3.8); D6 familiar-listener gate (§10 Q5). |

**The pre-registered bet, stated falsifiably:** the lifted layers
(taste, memory, relationship state, hard boundaries) should shrink the
machine-fingerprint gap on *relational content* even though stance/lexicon
remain model-bound. If they don't move D2 at all, the lift claim fails —
reversal condition in §12.

---

## 6. Relationship state: the WE-store, register, and how it moves

**What replaces `stageFor` (answer to §6 Q10 is embedded here):** dimensions,
each with its evidence type and update rule, all cited, all able to regress:

| dimension | state or derived | moves when (evidence) | direction |
|---|---|---|---|
| `honorific` | **state** (explicit, never re-derived per turn — the shift is subconscious in humans; a per-turn re-derivation is noisier than the people it models) | consolidation observes: user's own pronoun usage over ≥2 sessions, explicit invitation, or rupture | both — rupture or formality lapse can step tu→tum |
| `warmth` / `trust` | state, slow scalars | cited transitions only; bounded step per week (no single conversation moves trust >0.1) | both |
| `cs_ratio` + `cs_on_stress` | derived (rolling) + learned flag | recomputed each consolidation from *their* tokens; `cs_on_stress` set only after ≥3 observed stress episodes agree | n/a |
| `repair_state` | state machine none→open→repairing→repaired | rupture detected (affect + conflict shape) opens; repair requires *their* signal, not her assumption | regress on re-rupture |
| `ritual_density` | derived | vk_rituals cadence math | both |
| shared language | vk_facts kind='phrase' (lifted, with `feel`) | mention across ≥3 weeks bumps identity-durable rank (RANK rationale KEEP) | decay by need-probability |

Message count appears nowhere. 90 messages in one evening ≠ 90 across a month;
the event log's session structure is what the dimensions are computed from.

**The WE-store** (settles §6 Q2, since verification killed all prior art):

- **WE-episodes** are not a separate store — they are episodes/facts with
  `perspective='we'`, kept non-lossy at the raw layer (per-turn speaker
  attribution lives in vk_events.role — Zep proved the storage is cheap; the
  typing at the derived layer is ours).
- **Dyadic patterns** (vk_we_patterns) are a distinct class from facts,
  retrieved by **moment-shape, not topic**: the retriever computes the current
  moment's tags (silence length shape, hour, affect trajectory, post-rupture
  flag — all computable in code from the tail) and pulls patterns whose
  `moment_tags` overlap. This is how WE-retrieval privileges participation
  **without violating pull-only**: patterns are injected as background shapes
  ("context only, never raise unprompted" label), they change how she is with
  him, never give her a line or a topic to raise. The user's turn is always
  the trigger; she cannot open with a WE-callback the moment didn't ask for.
- **Companion-self-state** is three different things and mixing them was
  ZifaMem's mistake: (a) who she is = **authored canon** (repo, versioned);
  (b) what she's carrying right now = **transient by design** — inner.ts
  thread mechanics KEEP (TAU 9h, sleptBetween kill, retire-once-voiced),
  storage lifted server-side, each thread event-sourced as `kind='inner_state'`
  events so the interior is replayable and exportable; (c) what she's told
  this user about herself = **vk_self_facts**, persistent and cited. No
  fourth "persistent companion mood memory" exists — a feeling that outlives
  its cause is unrepresentable, which is the charter (G1–G8 promoted to spec
  text, enforced in the consolidator's write-path: REFS_USER / EVENT_SHAPED
  rejection carried over).

**How register moves through the stack:** vk_rel_state.honorific → compiled
into `snap.rel` as a value ("register: tum, edging tu since <era>") → the
**adapter** owns rendering it in the model's actual output (this is exactly
the split the ceiling law forces: the state is portable, the rendering is
per-model and gated by D1's register bands and the india-schema probes in D3).

---

## 7. Model router + swap-test hooks

**Router, not failover chain.** `vk_models` (§2.11) encodes every measured
constraint as data: prefix-cache (cache-9x), billing class (credits-partner's
silent-card-billing trap becomes a hard eligibility column, not a memory),
per-lane effort map (4/5 EMPTY on the wrong tier), max_tokens semantics (xAI
visible-only vs GPT total), residency (DPDP anticipation, logged as
anticipation per safety-reg §5.8). **Eligibility = adapter exists AND
fingerprint gate passed AND billing class allowed.** No beat-routing —
rejected with evidence (`reasoning-live`: misclassification lands on the
crisis turn); re-opening it requires new evidence, per decisions.md
discipline. The offline `critical` crisis path is above the router: crisis
replies survive total network failure, unchanged.

**Adapter-derivation protocol (settles §6 Q4 — the economics):**

1. Fixed probe battery, deterministic metrics only: 2,000 turns across the
   standard beat mix; measure D1 surface stats (words/turn vs 20.5 band,
   question rate vs 1-in-3 ceiling, media-tag rate, register markers,
   romanized-Hinglish integrity, bubble distribution).
2. Grid over adapter parameters (length-directive strength ×3, tag-instruction
   placement ×2, bracket policy ×2, effort tier per lane): ≤12 configs, but
   D1 is a script, not a judge — generation is the only cost.
3. Best config → one judged D5 pass at n≥300, dual judges, both orders,
   agreement-only (the KEEP methodology) → gate_status written.

**Cost envelope, pre-registered:** generation ≈ 24k turns × ~$0.002/turn ≈
$50–80; judging ≈ 600 judgments ≈ $30–60; ≤ 2 engineer-days scripted end to
end. **Envelope: ≤ $200 compute + 2 days per candidate model.** Reversal: if
a real derivation exceeds ~5× this envelope (i.e. approaches a
charm-grok-scale bake-off), the router's option value collapses as Q4 warns —
then the roster freezes at 2–3 deeply-gated models and the router's job
narrows to failover + compliance, logged as a decision with that evidence.

**Swap-test hooks, built in from M1:**

- Every turn logs `{manifest_hash, snapshot_ver, model_id, adapter_id}` to
  `meera_tel` (area `route`). Any production turn is replayable:
  `scripts/replay.mjs` recompiles the identical bytes from the stored
  snapshot and runs any candidate — D2's "identical compiled contexts" is a
  query, not a rig.
- The sham arm is an assignment-table label only; arms share compiler,
  snapshot, adapter framework — the only differing byte is the model slug at
  dispatch, which is what makes sham vs swap a clean contrast.
- D0 backtest fixtures (grok/luna/azure archives) live in `evals/archives/`;
  the battery must flag all three before it is trusted (validity gate KEEP).
- D2 classifier harness reads pairs keyed by manifest_hash so held-out splits
  are by conversation, not turn (leakage rule KEEP).
- Helpline-trigger rate is a named axis in every gate report (compliance, not
  charm — safety-reg §5.6).

---

## 8. India schema placement

Adopted from india.md §7 with the placement decision RESEARCH §3.2 requires:
**dynamic India state is embedded in the relationship layer, not beside it.**

- `honorific_register`, `code_switch_baseline` + `direction_on_stress` →
  columns of vk_rel_state (§2.5) — they are the India-specific instantiation
  of the closeness dimensions, inputs to the same transition machinery, not a
  second competing closeness metric.
- `kin_graph` → vk_kin, role-labeled (chachi/mausi/bua distinct), fictive vs
  blood marked, joined to vk_facts person nodes.
- `care_ritual_state` → vk_rituals (khana_khaya cadence, gone-rote flag — the
  consolidator flags hollow repetition so a care act never becomes a script).
- `festival_calendar_state` → authored region-keyed calendar file in the repo
  (shared data, culture-index pattern) × per-user vk_profile.home_region +
  religion_obs (opt-in, DPDP-sensitive flagged) + last-acknowledged in
  vk_rituals.
- `topical_currency_log` → vk_currency (freshness-tracked pool; pull-only).
- Static profile → vk_profile; `sensitive_keys` marks DPDP-sensitive fields
  for export labeling and consent handling.
- **Input side (new build):** the user's own code-switching is a signal to
  read — the consolidator computes cs_ratio from *their* tokens per episode
  and only ever sets `cs_on_stress` from ≥3 agreeing stress episodes, because
  the literature shows both directions exist and guessing wrong is a concrete
  misread. All fields render as values/shapes; no scripted lines anywhere
  (`recited-prompt`).

---

## 9. Safety and regulatory mechanisms

- **Forget (all 7 layers KEEP, generalized to derived state):** strict marker
  parse, no salvage; whole-wipe structurally excluded from generated-marker
  vocabulary; hard delete of vk_events in scope; **citation-join delete**:
  `delete from <every projection> where citations && (deleted ids)` — the
  event-sourcing dividend: derived-state deletion is exact, not
  keyword-guessed; legacy uncited rows deleted on any plausibly-covering
  scope (over-deletion safe); vk_forget suppression terms checked pre-upsert
  against name AND body; client window prune; photo/telemetry purge on the
  same terms; **receipt after delete** — "haan, hata diya" is sent only once
  the transaction commits; the live voice lane still says honestly that it
  cannot delete mid-call. Forget scope keys on device_id AND user_id when
  signed in, closing the portability gap safety-reg §5.2 names.
- **Correction vs forget are different verbs:** supersede (bi-temporal) is
  for "that changed"; forget is for "erase it." Supersede keeps history;
  forget destroys it, both timelines, citations and all.
- **Export (the clearest named gap):** `api/export.js` — creates a
  vk_export_job, background pass serializes vk_events + all projections +
  citations + vk_derivations for the identity (device + linked user) into a
  JSON bundle behind a short-lived signed URL (Supabase storage, existing
  bucket pattern). Sensitive-flagged fields labeled. Satisfies DPDP access
  now and portability if it resolves to required.
- **Session clock:** vk_sessions ticked by every API call; a server check
  fires AI-disclosure at 3h continuous use (NY: all users; CA: minors — one
  timer, per-tier copy), break reminders, and the dependency circuit-breaker
  cadence. **Identity-compatible by design (settles §6 Q8):** the notice is
  rendered as an app-voice system chip in the UI, not spoken by her — the app
  discloses, she never performs the timer; but never-deny-AI means she owns
  it plainly if asked. Fires are event-sourced (`kind='clock'`) so compliance
  is auditable. Independent of conversation content by construction.
- **Age tier:** vk_profile.age_tier, engine-readable (safety-reg §5.4).
  Default posture per §10 Q9: verified-adult-only for India launch;
  `unverified` structurally receives the minor-safe configuration (stricter
  clock, no engagement mechanics, no romantic escalation) rather than adult
  defaults — the schema encodes both so the owner's company-defining call
  changes a config, not the architecture.
- **Retention:** DPDP-anticipating: scheduled inactive-account erasure with
  the 48-hour pre-erasure notice (medium-confidence figure, flagged);
  user-initiated forget stays immediate (a right exercised, not a scheduled
  purge); 1-year processing-log floor applies to meera_diag/tel only, and
  telemetry stays forget-integrated (TELEMETRY rule 3) — the two obligations
  don't collide because diag rows reference content by id, not copy.
- **Swap governance:** vk_models.gate_status + vk_derivations give the
  auditable what-changed-and-why record FTC 6(b) points at, which is also
  just the program's own decision discipline in table form.

---

## 10. Explicit answers to RESEARCH.md §6

**Q1 — D2 target and what failure means.** Pre-register: baseline D2 on the
current stack vs each candidate first (expect 90–97% per Idiosyncrasies).
Phase C exit target: **D2 ≤ 65% held-out accuracy on relational-content
probes** (memory/taste/relationship-state turns), with D1 surface features
regressed out (adapter-controllable length/tag features are not the claim;
stance residue is). 50% is NOT the claim — machine indistinguishability is
explicitly out of scope (passive-relational claim only); D2 is the continuous
progress metric, D5+cohort carry the product claim. **Reversal condition,
pre-registered:** if three successive engine milestones (M2, M3, M4 exits)
each move D2 <2pp toward chance on the same candidate pair, the lift claim is
falsified for the stance layer; the company claim narrows to
"gate-and-adapter" (identity survives because the router only admits models
that pass the battery, not because state lifts it) — which triggers the
decisions.md `relational-state` reversal review.

**Q2 — WE-store schema.** §6 above. Companion-self-state is not one type:
authored canon (repo) + transient carried feeling (charter mechanics,
event-sourced but decaying by design) + persistent cited self-facts.
WE-episodes are perspective-typed derived records over non-lossy
speaker-attributed events; dyadic patterns are a distinct cited class
retrieved by moment-shape; pull-only is preserved because retrieval is
triggered by the user's turn's computed moment-tags and injected as
background shapes, never as content she raises.

**Q3 — memory carry-over vs character invariance.** Run the cheap vignette
pre-study in M1 (n≥300 judged vignette pairs, two judge families, ~$200:
vary memory-continuity vs character-continuity in matched companion vignettes,
measure perceived-same-person). Budget default while it runs, from the
Strohminger prior and the repo's own evidence (users grieved *personality*
change at Replika even when features didn't change): **60% of eval budget to
D1/D3/D5 (character), 40% to D4 (memory)**. The pre-study result reallocates
±20 points; either way D4 keeps a floor because ANCHOR's weakest measured
axis was user-state recall.

**Q3a — correction-on-retrieval.** Product-grounds policy (the
reconsolidation rationale is withdrawn, per §7): when retrieval would surface
a superseded fact, the compiler injects the current row plus a one-time
`corrected:` tag naming what changed ("job: Infosys → Razorpay, told <era>");
she states updates, never silently substitutes (trust invariant). The old
trace remains retrievable (bi-temporal), visible in export, and drops from
retrieval priority after the correction has been voiced once (tracked like
retire-once-voiced). **Forget beats supersede:** an explicit forget destroys
both rows and their citations — honest forget covers derived and historical
state alike.

**Q4 — adapter economics.** Protocol and envelope in §7: ≤$200 compute +
≤2 engineer-days per candidate, deterministic D1 doing the heavy lifting,
one judged D5 pass at the end. Reversal at ~5× envelope → frozen 2–3 model
roster, router demoted to failover+compliance, logged with the evidence.

**Q5 — voice continuity without the owner bottleneck.** Three-stage gate:
(1) canonical speaker embedding distance as cheap pre-filter only (the Hz
lesson: numbers already misled once); (2) a trained familiar-judge panel —
5 judges, ≥2h exposure to her canonical clip set, judging register lines
blind — as the scalable gate once panel-vs-owner agreement reaches κ≥0.8 on
a 40-clip calibration set; (3) the owner remains final authority until that
κ is measured, and always for new register-line classes. D6 explicitly
measures the unlitigated question — voice identity across an LLM swap with
TTS held constant — because `realtime-azure` suggests generation-time
coupling; it is measured, not assumed.

**Q6 — the forgetting profile as product spec.** Decay is authored config in
the repo (versioned, owner-signed — the same authored-beats-generated
principle applied to transience): identity-kind rows (person/place/
preference/phrase/self) don't decay; episodic/event rows decay by
need-probability with a 60-day half-life default (carried from RANK's
measured-adjacent shape); safety-tagged never decay-eligible; decay lowers
retrieval priority only. Interaction with honest-forget: decayed ≠ forgotten
— on a probe she is honestly fuzzy ("yaad dila na"), never claims deletion;
deletion happens only via forget or DPDP retention erasure (48h notice).
Perfect recall is declined as a target on the record (surveillance reading,
Richards & Frankland).

**Q7 — disclosure of real production swaps.** Default: **disclose, always** —
silence sits inside the covert line the program forbids, and NEVER MANIPULATE
is an input, not a feature. Mechanism: an in-product plainly-worded note at
swap time (app voice, like the session clock — not performed by her), after
the candidate has passed the full gate. Copy is written against the measured
hazard that change-machinery framing itself harms (mention alone: mourning
d=0.40) — factual, no loss-framing, with the debrief-+2-weeks question from
the cohort pricing whether disclosure timing needs revisiting. The consent
posture at signup includes that models under her may change and that she is
the continuity — so a swap disclosure confirms the promise rather than
breaking one.

**Q8 — session clock placement.** §9: server-side (vk_sessions, ticked by
API traffic, event-sourced fires), surfaced app-voice, one timer driving
disclosure/breaks/dependency-circuit-breaker with per-jurisdiction and
per-age-tier cadence config. Identity-compatible because she never performs
it and never denies it.

**Q9 — age-tier for India.** Recommend **verified-adult-only at India launch**
(DigiLocker-based verification path per DPDP Rule 10), because §9(2)'s
addictive-pattern prohibition is a product-design rule a companion app cannot
satisfy for minors by policy alone. The schema encodes the alternative
(structurally different minor experience) so the owner's call is a config
change: `age_tier` gates engagement mechanics, clock cadence, and content
classes at compile time. `unverified` = minor-safe defaults, not adult
defaults.

**Q10 — what replaces stageFor.** §6 table: explicit dimensions (honorific,
warmth, trust, repair state machine, ritual density, cs baseline) each with
typed evidence, cited transitions, bounded step sizes, and regression built
in; derived quantities recomputed, never stored as vibes; message count
appears nowhere.

---

## 11. Build plan

Ordered milestones; every milestone ends with its output logged to `context/`
before the next starts (program law). Estimated at the actual team size (one
owner + agents); weeks are working estimates, not commitments.

| M | weeks | delivers | exit gate |
|---|---|---|---|
| **M0** | 0–1 | **Recover `verify-v3.mjs` (138 invariants) + `parsetest.bundle.mjs` into `evals/` under version control** — repo-audit's single most urgent defect, and nothing else starts first. D0 archive fixtures committed. | 138/138 + 14/14 pass on incumbent; CI wired. |
| **M1** | 1–3 | vk_events + dual-write + backfill (migration §2 steps a–c). Compiler v1 with manifest, budgets, shape-linter, eviction order; `check-prompt-budget` extended. Turn-level route/manifest telemetry. Vignette pre-study (Q3) launched. | Compiled output parity vs legacy assembly (diff = declared deltas only); **prod cached% ≥ 99% held for 7 days** (cache-9x proof); D1 bands unchanged on incumbent. |
| **M2** | 3–6 | Consolidator v1 (episodes + bi-temporal facts + self-facts), citation enforcement layers 1–4, forget generalized to citation-join, legacy-row re-derivation begins. Measured consolidation cost replaces §4 estimates. | Zero uncited consolidation writes possible (schema test); entailment refutation <2% on 2-week sample; forget-then-probe suite 100% suppression incl. derived rows; cost within 3× envelope. |
| **M3** | 6–9 | WE-store + rel-state + transitions + India tables; embeddings wired (semantic-recall closed); moment-shape retriever; compiler snap.rel block live. | "kaam stress → office pressure" recall test set passes; pull-only invariants hold (0 unprompted raises in n=300 replay turns); honorific never re-derived per turn (code audit + probe). |
| **M4** | 9–12 | Router + vk_models + adapter-derivation protocol run on 2 candidates; D0–D2 executed. | D0 flags all three archives; adapter derivation lands inside the $200/2-day envelope (or reversal logged); baseline D2 published and Phase C target pre-registered in context/. |
| **M5** | 12–14 | Export op; session clock; age-tier gating; retention scheduler. | Export round-trips (import into empty DB reproduces compiled context byte-identically); clock fires at 3h in staging; invariant suite still 138/138. |
| **M6** | 14–16 | Full D0–D6 on the best candidate; fingerprint-gap report; cohort protocol pre-registration package. | Offline exit gate per swap-test.md §3, or an honest failure report — a halted run is a valid negative result. |

**File ownership (new/changed):** `db/schema.sql` (append vk_* DDL),
`scripts/migrate-events.mjs`, `scripts/check-citations.mjs`,
`scripts/check-migration.mjs`, `scripts/replay.mjs`,
`src/engine/compiler.ts`, `src/engine/relstate.ts`, `src/engine/router.ts`,
`api/consolidate.js`, `api/export.js`, `api/clock.js`, `api/route.js`
(vk_models CRUD, owner-only), `evals/` (verify-v3, parsetest, D-battery,
archives), `docs/adapters/<model>.md` (per-model adapter + derivation
record).

**Kept / lifted / rebuilt (repo-audit verdicts, consumed by milestone):**
KEEP untouched — liveCall audio floor, scene wake model, parseBubbles,
offline crisis path, telemetry substrate, judging methodology, taste table,
charter mechanics, culture pull-only, media catalogs, budget-gate pattern,
device-scoped deletion pattern. LIFT — persona monolith → core blocks +
adapter (M1); inner storage → server + event-sourced (M3); herLife →
vk_self_facts (M2); phrase/feel → vk_facts (M2); graph rank ideas
(feel-asymmetry, staleNote, matched/background labels) → retriever (M3);
opRemember pipeline shape + 4 invariants → consolidator (M2); assembly →
compiler (M1). REBUILD — stageFor → §6 (M3); regex facts → consolidator
(M2); keyword recall → embeddings (M3); failover chain → router (M4).
Replaced code is logged in context/, never silently deleted (standing
constraint).

---

## 12. Failure modes, and what evidence would show this design is wrong

1. **The ceiling law beats the lift claim.** Evidence: M2/M3/M4 exits each
   move D2 <2pp toward chance (pre-registered in Q1). Meaning: authored
   state + compiler + adapters do not lift even the relational-content
   fingerprint; ANCHOR generalizes to us. Consequence: claim narrows to
   gate-and-adapter; `relational-state` decision's reversal review fires.
   This is the honest headline risk and it is priced, not hidden.
2. **The citation law starves consolidation.** Multi-episode inferences may
   resist clean citation; if derived-fact coverage on a fixed transcript set
   drops >20% vs the current extractor, the law is costing recall. Response:
   inference-class derivations requiring ≥2 citations (already the WE rule)
   rather than loosening to zero — if coverage still can't recover, that is
   evidence the citation constraint as specced is too strong, and the
   fallback (citations advisory + 100% entailment audit) gets logged as a
   correction with the measured coverage numbers.
3. **Snapshot churn breaks cache-9x.** If prod cached% drops below ~95%
   (vs 99.8 measured), the snap blocks are moving too often — evidence the
   per-conversation-freeze design failed. Response: move snap blocks below
   the breakpoint (pay tail tokens, keep prefix pure) and re-measure; the
   M1 gate exists to catch this before it costs 9×.
4. **Consolidation cost/latency at scale.** >3× the $0.003/user-day envelope,
   or session passes overrunning Vercel function limits. Response: tier by
   activity (weekly-only for low-activity users), chunk per-session spans;
   if it still blows the envelope the offline-pass architecture itself is
   wrong for this team size — a finding worth logging, since RESEARCH §8
   says nobody has priced it.
5. **Rebuild non-determinism gets mistaken for dishonest forget.** The claim
   is scoped in §0 (deletion is SQL, not LLM replay); the forget-then-probe
   suite (M2 gate) is the standing proof. If any probe ever recovers
   deleted-derived content, that is a design-falsifying bug, ship-blocking,
   not tunable.
6. **Free-tier daily budgets** (`free-tts-daily` lesson): Azure
   DeploymentNotFound spikes or credit exhaustion turn consolidation into
   silent memory loss. Response encoded: fallback lane KEEP, pending-span
   bookkeeping means a missed pass is late, never lost; alarm on fallback
   rate >15%.
7. **Session clock damages personhood.** If staging cohort D30 retention
   diffs measurably against a clock-off arm (consented, of course), the
   identity-compatible rendering failed; redesign the surface, not the timer
   — the timer is law in three jurisdictions.
8. **The WE-retriever violates pull-only in practice.** Evidence: any
   unprompted WE-raise in the n=300 replay audit (M3 gate). The moment-shape
   matcher is code, so the fix is structural, and the gate exists because
   pull-only is the pattern every measured success in this repo shares.

What would show the *whole* design wrong rather than a component: the swap
test, run on the full stack after M6, still shows high excess detection at
the cohort stage — identity cannot be lifted above the model at acceptable
cost — which is the company's own pre-registered reversal condition, and this
architecture's job is to make that experiment cheap, controlled, and honest
enough that the answer, either way, is a finding.
