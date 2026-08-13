# PROPOSAL C — MINIMAL-DIFF: the proven pattern, extended to the whole relationship

Phase B design proposal. Author position: **the repo's measured-successful shape
— authored state + deterministic retrieval + structural guarantees in code —
IS the architecture.** Phase C should extend that shape into a full
relationship state with the smallest set of new moving parts that satisfies
RESEARCH.md §3, because:

1. **It is the only mechanism with a measured portability win anywhere in the
   sweep, internal or external.** `taste-consistency`: self-agreement 13/48 →
   30/48 (27%→63%, n=480 live turns), register defects 13/96 → 0/32, 100/100
   reproducible offline — achieved by moving one identity layer out of
   generated prose into a small authored, deterministically retrieved table.
   Every other candidate mechanism either failed when measured (prompting the
   stance layer: `charm-grok` 38–2 on a byte-identical prompt), is
   inapplicable (activation steering needs white-box access the closed roster
   doesn't have — identity.md §4), or resets per model (fine-tuning).
2. **The external evidence says scaffold novelty does not buy identity.**
   ANCHOR (verified): swapping the memory architecture under a model does not
   move that model's persona-collapse pattern (<1pt across three
   architectures). A maximal new architecture spends the tiny team's entire
   budget on the axis the evidence says doesn't move the ceiling. Effort
   belongs where the measured wins are: state coverage ("more rows"), the
   compiler, the adapters, and the gate.
3. **The team is tiny and unfunded.** Free tiers are daily budgets
   (`free-tts-daily`), Neon-over-SQL-HTTP is the database, Vercel functions
   are the backend, and the one daily-batch pattern that already works in
   production is a GitHub Actions cron (`culture.yml`). Every new moving part
   below reuses an operational pattern the repo already runs, or it isn't in
   this proposal.

Depth rule honored throughout: every mechanism cites the measurement or
verified finding it stands on; where a number is an estimate it says so and
gives the arithmetic.

---

## 1. Component map

Ten components. Six are lifts of existing code, two are rebuilds of existing
code, two are genuinely new. Nothing else.

```
                    ┌──────────────────────────────────────────────────────┐
                    │  CONTEXT COMPILER  (rebuild of brain.ts assembly)     │
                    │  typed blocks · budgets · manifest · shape-lint       │
                    │  byte-stable CORE / volatile TAIL / rules dead last   │
                    └───────▲──────────▲──────────▲──────────▲─────────────┘
                            │          │          │          │
     ┌──────────────┐ ┌─────┴────┐ ┌───┴─────┐ ┌──┴───────┐ ┌┴───────────┐
     │ IDENTITY CORE│ │ WE-STORE │ │ EPISODIC│ │ INDIA    │ │ PER-MODEL  │
     │ canon+taste+ │ │ rel_state│ │ MEMORY  │ │ STATE    │ │ ADAPTER    │
     │ invariants   │ │ dyadic   │ │ episodes│ │ register │ │ (data row) │
     │ (lift persona│ │ shared-  │ │ facts+  │ │ kin,     │ │            │
     │  + inner)    │ │ language │ │ citation│ │ rituals  │ │            │
     └──────────────┘ └─────▲────┘ └───▲─────┘ └──────────┘ └─────▲──────┘
                            │          │                          │
                    ┌───────┴──────────┴────────┐        ┌────────┴────────┐
                    │ CONSOLIDATION v2           │        │ MODEL ROUTER    │
                    │ (lift opRemember: in-turn  │        │ vy_model table +│
                    │  pass kept; nightly pass   │        │ fingerprint gate│
                    │  new, GH-Actions cron)     │        │ (rebuild chain) │
                    └───────▲────────────────────┘        └────────▲────────┘
                            │                                      │
     ┌──────────────────────┴──────────┐            ┌──────────────┴───────┐
     │ meera_log (KEEP, ground truth)  │            │ EVAL SUITE / D0–D6   │
     │ + FORGET STACK (KEEP, extended  │            │ evals/run.mjs (KEEP) │
     │   to derived state by cascade)  │            │ + fingerprint harness│
     └─────────────────────────────────┘            └──────────────────────┘
     ┌───────────────────────────────────────────────────────────────────┐
     │ SAFETY/REG RAIL (new, small): session clock · export op · age tier│
     └───────────────────────────────────────────────────────────────────┘
```

| # | Component | Verdict vs repo | New code (est.) |
|---|---|---|---|
| 1 | Identity core (canon + taste + invariants + adapter split) | LIFT persona.ts/inner.ts | ~1.5k lines moved, ~300 new |
| 2 | Context compiler | REBUILD of brain.ts assembly + chat.js caps | ~600 lines |
| 3 | Episodic memory (episodes, bi-temporal facts, citations) | LIFT meera_nodes shape + new tables | ~400 lines |
| 4 | Consolidation v2 (in-turn kept; nightly pass new) | LIFT opRemember + new api/consolidate.js | ~500 lines |
| 5 | WE-store (rel_state, dyadic, shared language) | NEW (salvage 'phrase' nodes, `feel`) | ~400 lines |
| 6 | India state | NEW (small; india.md §7 adopted verbatim) | ~200 lines |
| 7 | Model router + adapters | REBUILD fallback chain as data | ~300 lines |
| 8 | Eval suite / D-battery / fingerprint harness | KEEP evals/run.mjs; NEW harness | ~800 lines |
| 9 | Safety/reg rail (export, session clock, age tier) | NEW (small) | ~300 lines |
| 10 | Forget stack | KEEP near-verbatim, extended by FK cascade | ~100 lines delta |

Explicitly NOT in this proposal: a knowledge-graph engine (Zep/Graphiti
import), PageRank retrieval (named as the upgrade path, not the build),
embeddings beyond wiring the already-deployed `text-embedding-3-small`, any
new vendor, any realtime-lane change (`live-model-swap` rejected;
`audio-floor` untouched), any watch-frame retention (contradicts shipped
honesty text — owner decision, per repo-audit §3d).

---

## 2. Full SQL schema (Neon) with migration path

Design rules, each from a paid-for lesson:

- **Additive migrations only.** `db/schema.sql` is transcribed from the live
  DB and idempotent; migrations follow the same discipline — `create table if
  not exists`, `alter table ... add column if not exists`. Nothing existing
  is dropped during Phase C; replaced components are logged, never deleted
  (RELATIONAL-STATE.md standing constraint).
- **Person-scoped, device-linked.** Device-as-identity is the named
  portability gap (repo-audit §8, safety-reg §5.2): a relationship that
  survives a model swap must survive a device swap, and forget must follow
  the person. `vy_person` maps devices to a person; every new table keys on
  `person_id`; existing tables keep `device_id` and are read through the
  mapping.
- **Citations are schema, not policy.** The single most evidenced constraint
  in the cognitive track (consolidation confabulates unless forced to cite —
  Generative Agents failure reports, RESEARCH §3.3) is enforced by a
  deferred constraint trigger, not by asking the extractor nicely. The same
  join table is what makes derived-state deletion structural (§9): forget an
  episode → citations cascade → orphaned facts are deleted by trigger. One
  mechanism, two obligations.
- **Bi-temporal supersede, never delete-on-contradiction** (Zep §2.2.3,
  VERIFIED): relationship content includes *that beliefs changed*.
  Contradiction sets `t_invalid` + `superseded_by`; only honest-forget hard
  deletes. This also answers §6-Q3a (below).
- **Names and traps:** table namespace collision with indexes is a measured
  trap (`meera_tel_session` NOTICE-and-skip); all new indexes carry a `_ix`
  suffix so a table can never lose its name to its own index.

### `db/migrations/001_person.sql`

```sql
-- Person identity above device identity. Additive; device_id remains the
-- delete key on legacy tables and the link key here.
create extension if not exists pgcrypto;

create table if not exists vy_person (
  person_id  uuid primary key default gen_random_uuid(),
  -- §6-Q9: age tier as engine-readable state, not an onboarding flag.
  age_tier   text not null default 'unverified'
             check (age_tier in ('unverified','adult','minor')),
  created_at timestamptz not null default now()
);

create table if not exists vy_person_device (
  device_id uuid primary key,          -- one device belongs to one person
  person_id uuid not null references vy_person(person_id) on delete cascade,
  linked_at timestamptz not null default now()
);
create index if not exists vy_person_device_person_ix
  on vy_person_device (person_id);
```

Backfill: one row per distinct `device_id` seen in `meera_log`; signed-in
accounts (`meera_state.user_id`) that span devices get their devices merged
under one person. Until a device is linked, `person_id := device_id`
namespace-cast — the code path is identical for anonymous and signed-in.

### `db/migrations/002_episodes_facts.sql`

```sql
-- Episodes: segments of meera_log, cut on prediction-error boundaries
-- (channel change, gap, topic/affect shift — EST, verified), never wall-clock.
create table if not exists vy_episode (
  id              bigint generated always as identity primary key,
  person_id       uuid not null,
  device_id       uuid,                       -- provenance for legacy forget
  channel         text not null default 'chat',    -- chat | call | watch
  started_at      timestamptz not null,
  ended_at        timestamptz,
  boundary_reason text not null default 'gap',
                  -- 'gap' | 'channel' | 'topic' | 'affect' | 'goal' | 'session'
  log_from        bigint,                     -- meera_log id span: the citation
  log_to          bigint,                     --   anchor back to ground truth
  summary         text not null default '',   -- TELEGRAPHIC, shape-linted (§3)
  -- multimodal episode record, RESEARCH §3.8 adopted: symbolic text tags only,
  -- extractor + confidence mandatory (vision-fab: an assertion without a
  -- confidence tag cannot later be told apart from a hallucination).
  affect_tags     jsonb not null default '[]'::jsonb,
        -- [{tag, intensity, extractor, confidence}]
  visual_asserts  jsonb not null default '[]'::jsonb,
        -- [{claim, model, confidence, declared_illegible}]
  shared_reaction text not null default '',   -- kept separate from the claim
  importance      real not null default 1.0,  -- anchored comparison (§4), not
                                              -- raw LLM self-rating
  tier            smallint not null default 0, -- consolidation tier (0=raw)
  safety_tagged   boolean not null default false, -- never decay-eligible
  we_flag         boolean not null default false  -- "we did X together" (§6)
);
create index if not exists vy_episode_person_ix
  on vy_episode (person_id, started_at desc);
create index if not exists vy_episode_we_ix
  on vy_episode (person_id, we_flag, started_at desc) where we_flag;

-- Derived facts: bi-temporal, superseded-not-deleted, citation-mandatory.
create table if not exists vy_fact (
  id            bigint generated always as identity primary key,
  person_id     uuid not null,
  kind          text not null check (kind in
                ('user','world','self_in_relation','relationship','india')),
  body          text not null,      -- telegraphic note; shape-linted on write
  t_valid       timestamptz not null default now(),
  t_invalid     timestamptz,        -- set on contradiction; row stays
  superseded_by bigint references vy_fact(id),
  created_at    timestamptz not null default now(),
  need_p        real not null default 1.0
                -- retrieval priority: recency × frequency-of-relevance
                -- (ACT-R need-probability). Decay moves THIS, never deletes.
);
create index if not exists vy_fact_person_ix
  on vy_fact (person_id, kind, need_p desc) where t_invalid is null;

-- The citation trail. ON DELETE CASCADE from episode is the mechanism that
-- makes forget honest for derived state (§9): no episode, no citation; no
-- citation, no fact (trigger below).
create table if not exists vy_fact_citation (
  fact_id    bigint not null references vy_fact(id) on delete cascade,
  episode_id bigint not null references vy_episode(id) on delete cascade,
  primary key (fact_id, episode_id)
);
create index if not exists vy_fact_citation_ep_ix
  on vy_fact_citation (episode_id);

-- Structural guarantee 1: no fact commits without at least one citation.
create or replace function vy_fact_must_cite() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from vy_fact_citation where fact_id = new.id) then
    raise exception 'vy_fact % has no citation — refusing commit', new.id;
  end if;
  return null;
end $$;
drop trigger if exists vy_fact_must_cite_tg on vy_fact;
create constraint trigger vy_fact_must_cite_tg
  after insert on vy_fact
  deferrable initially deferred
  for each row execute function vy_fact_must_cite();

-- Structural guarantee 2: a fact whose last citation died dies with it.
create or replace function vy_fact_gc() returns trigger
language plpgsql as $$
begin
  delete from vy_fact f
   where f.id = old.fact_id
     and not exists (select 1 from vy_fact_citation c where c.fact_id = f.id);
  return null;
end $$;
drop trigger if exists vy_fact_gc_tg on vy_fact_citation;
create trigger vy_fact_gc_tg
  after delete on vy_fact_citation
  for each row execute function vy_fact_gc();
```

`meera_log` gains one nullable column (additive):

```sql
alter table meera_log add column if not exists episode_id bigint;
create index if not exists meera_log_episode_ix on meera_log (episode_id);
```

### `db/migrations/003_we_store.sql`

```sql
-- Relationship state: APPEND-ONLY versioned rows, replacing stageFor.
-- Append-only is deliberate: regression must be representable and visible
-- (RESEARCH §6-Q10 — "with regression possible"), and the swap test needs
-- the state serialized as a controlled variable it can carry across arms.
create table if not exists vy_rel_state (
  id            bigint generated always as identity primary key,
  person_id     uuid not null,
  at            timestamptz not null default now(),
  -- §3.7 India dynamic state EMBEDDED here, not beside it:
  honorific     text not null default 'tum'
                check (honorific in ('tu','tum','aap')),
  cs_ratio      real,               -- rolling Hindi-content-token ratio
  cs_on_stress  text not null default 'unknown'
                check (cs_on_stress in ('retreat_l2','intensify_l1','unknown')),
  -- general dyadic axes (each updated only on cited evidence):
  trust         real not null default 0.3,     -- 0..1
  repair_state  text not null default 'none'
                check (repair_state in ('none','rupture_open','repairing','repaired')),
  ritual_density real not null default 0,      -- care rituals / week, derived
  pacing_gap_s  integer,                       -- median reply gap, derived
  evidence_ep   bigint references vy_episode(id),  -- what moved it
  note          text not null default ''       -- telegraphic why, never a line
);
create index if not exists vy_rel_state_person_ix
  on vy_rel_state (person_id, at desc);

-- Dyadic if-then patterns (Baldwin relational schemas). Distinct class from
-- user-facts; retrieved by MOMENT SHAPE, not topic keyword. Promotion to
-- prompt-eligibility is a THRESHOLD, not an LLM score (importance-inflation
-- failure mode, cognitive-arch §9.1): >=3 citing episodes across >=2 days.
create table if not exists vy_dyadic (
  id               bigint generated always as identity primary key,
  person_id        uuid not null,
  moment           text not null,
        -- 'conflict' | 'vulnerable' | 'silence' | 'teasing' | 'stress'
        -- | 'planning' | 'celebration' | 'boredom'
  pattern          text not null,   -- telegraphic if-then, shape-linted
  self_in_relation text not null default '',
        -- paired per Bowlby IWM: who SHE is in this moment with THIS person
  support_count    integer not null default 0,
  distinct_days    integer not null default 0,
  prompt_eligible  boolean generated always as
                   (support_count >= 3 and distinct_days >= 2) stored,
  t_invalid        timestamptz,     -- bi-temporal like vy_fact
  last_used        timestamptz
);
create index if not exists vy_dyadic_person_ix
  on vy_dyadic (person_id, moment) where t_invalid is null;

create table if not exists vy_dyadic_citation (
  dyadic_id  bigint not null references vy_dyadic(id) on delete cascade,
  episode_id bigint not null references vy_episode(id) on delete cascade,
  primary key (dyadic_id, episode_id)
);
-- same must-cite + gc triggers as vy_fact (definitions analogous, elided)

-- Shared-language ledger: lift of meera_nodes kind='phrase' + the `feel`
-- own-words principle ("a callback that survived three weeks is worth ten
-- inside the same chat" — RANK rationale, kept).
create table if not exists vy_shared_language (
  id        bigint generated always as identity primary key,
  person_id uuid not null,
  phrase    text not null,
  gloss     text not null default '',   -- telegraphic what-it-means
  feel      text not null default '',   -- THEIR OWN words only, never inferred
  coined_at timestamptz not null default now(),
  last_used timestamptz,
  uses      integer not null default 1
);
create unique index if not exists vy_shared_language_ix
  on vy_shared_language (person_id, lower(phrase));
```

### `db/migrations/004_india.sql`

```sql
-- india.md §7 adopted as spec. Dynamic fields live in vy_rel_state above;
-- these are the structured stores beside it. All values are shapes/values,
-- never scripted lines (recited-prompt).
create table if not exists vy_kin (
  id           bigint generated always as identity primary key,
  person_id    uuid not null,
  name         text not null,
  relation     text not null,        -- chachi/mausi/bua/... role-labeled
  fictive      boolean not null default false,
  address_term text not null default '',
  note         text not null default ''
);
create unique index if not exists vy_kin_ix on vy_kin (person_id, lower(name));

create table if not exists vy_ritual (
  person_id uuid not null,
  key       text not null,           -- 'khana_khaya' | 'good_morning' | ...
  last_at   timestamptz,
  count     integer not null default 0,
  note      text not null default '',
  primary key (person_id, key)
);

create table if not exists vy_india_profile (       -- static half, set rarely
  person_id        uuid primary key,
  mother_tongue    text,
  home_region      text,
  religion         jsonb,     -- OPT-IN ONLY; DPDP-sensitive; export/forget aware
  family_structure jsonb,
  dietary          text,
  festivals        jsonb not null default '[]'::jsonb,
  updated_at       timestamptz not null default now()
);

create table if not exists vy_currency (            -- topical freshness pool
  person_id uuid not null,
  topic     text not null,           -- specific team/player/dish/place
  kind      text not null,           -- cricket | food | place | film
  last_used timestamptz,
  uses      integer not null default 0,
  primary key (person_id, topic)
);
```

### `db/migrations/005_router.sql`

```sql
-- The router is DATA. Every measured constraint becomes a column, so a swap
-- is a row edit reviewed in a PR, not a code hunt.
create table if not exists vy_model (
  model             text primary key,      -- provider-qualified slug
  provider          text not null,         -- openrouter | azure | google
  billing           text not null check (billing in ('credits','cash','user')),
  card_risk         boolean not null default false, -- credits-partner silent-bill
  prefix_cache      boolean not null,      -- cache-9x: no cache ≈ 9x cost
  residency         text not null default 'us',    -- DPDP anticipation, logged
  max_tokens_mode   text not null,         -- 'visible_only' (xAI) | 'total'
  effort_map        jsonb not null default '{}'::jsonb,
        -- per-lane effort tier ({"chat":"low","call":"minimal"}) —
        -- effort-tier inversion is measured, 4/5 EMPTY on the wrong tier
  adapter           jsonb not null default '{}'::jsonb,   -- §5 per-model adapter
  adapter_derived_at timestamptz,
  gate              text not null default 'untested'
                    check (gate in ('untested','failed','passed')),
  gate_run          bigint
);

create table if not exists vy_gate_run (   -- audit surface (FTC 6(b), §9)
  id      bigint generated always as identity primary key,
  model   text not null,
  battery text not null,                   -- 'D0'..'D6'
  n       integer not null,
  result  jsonb not null,
  passed  boolean not null,
  at      timestamptz not null default now()
);
```

### Migration path from current `db/schema.sql`

| Step | What | Risk |
|---|---|---|
| 001 | `vy_person` + backfill from distinct device_ids; merge by `meera_state.user_id` | zero — additive, no reader yet |
| 002 | episodes/facts/citations; `meera_log.episode_id` | zero — consolidation v2 is the only writer |
| 003–005 | WE-store, India, router | zero — compiler reads them behind feature flags |
| transition | `meera_nodes`/`meera_edges` KEPT and still written by the in-turn pass; recall reads BOTH stores; nightly pass migrates node content into `vy_fact` with a citation to a synthetic episode spanning the node's `created_at..updated_at` log window | dual-read complexity, bounded to one function |
| retire | after 30 days of dual-read parity (recall diff logged to `meera_diag`), node writes stop; tables stay (never deleted, per standing constraint) | none |

Forget compatibility: `opForget` item/window scopes gain three statements —
delete matching `vy_episode` rows (window: by `started_at`; item: by summary
term match, same "taking too much is the safe direction" rule), which
cascades citations, which triggers fact GC. `meera_forget` suppression terms
are checked by consolidation v2 pre-write exactly as `opRemember` does today
(name AND summary AND body). The 7-layer stack is otherwise untouched.

---

## 3. The context compiler

The highest-leverage rebuild (repo-audit §5, §10). It already exists in
embryo with the project's most expensive laws attached; this makes it
explicit and testable. **Location:** `src/engine/compiler.ts` (shared, so the
budget CI gate and evals run the identical code), enforced server-side by the
existing `api/chat.js` caps which stay as the outer payload guard.

### 3.1 Exact prompt layout

Two segments split at the `cache_control` breakpoint, exactly as today
(`cache-9x`: 9.2×, 99.8–99.9% cached in production — the core must stay
byte-stable or costs multiply by ~9).

**CORE — byte-stable per (persona_version, model, medium). Changes only on
deploy or model swap, never per turn, never per user.**

| pos | block | budget (chars) | content | why this position |
|---|---|---|---|---|
| C1 | `identity.canon` | 16,000 | who she is: bio canon, voice/humor shape, comfort ladder, secure attachment — persona.ts content KEPT, re-authored as shapes/notes where any line is sentence-shaped | front: least safety-critical if anything above it were ever cut — nothing sits above it |
| C2 | `identity.behavior` | 9,000 | NEVER MANIPULATE, never-deny-AI, crisis protocol + `CRISIS_LINES` verbatim, register bullets, banned phrases | verbatim as requirements; ALSO encoded in evals (138 invariants) — the prompt is not the only guarantee |
| C3 | `watch.privacy` | 4,000 | watch-mode directives + honest-answer paragraph | early-in-tail today because it carries privacy rules; promoted to core (byte-stable per medium) |
| C4 | `protocol.markers` | 6,000 | tag vocabulary, bubble rules, `[search:]`/`[forget:]` marker grammar (grammar only — decision rules go dead last) | mid |
| C5 | `relationship.legend` | 2,000 | the schema legend: what a rel_state snapshot means, what a dyadic pattern is, "context only, never raise unprompted" framing | mid; static explanation of dynamic data |
| C6 | `adapter.<model>` | 5,000 | per-model rendering: register directives, length directive strength, bracket policy, tag dialect | LAST in core: nearest to the tail, where per-model behavior shaping was measured to matter (see §5.3) |
| | **core total** | **42,000 cap 48,000** | | `SYSTEM_MAX` stays 64,000 (outer guard) |

**TAIL — volatile, compiled per turn. Cap 24,000 chars (`TAIL_MAX`,
unchanged).** Order is priority-under-truncation: the compiler NEVER slices —
it drops whole blocks lowest-priority-first (see 3.3), and the two decision
blocks are pinned dead last and undroppable.

| pos | block | budget (chars) | drop prio (1 = first dropped) | content |
|---|---|---|---|---|
| T1 | `inner.thread` | 1,500 | never dropped | carried feeling/wants/owed — "if anything is ever lost it must be the recall list, never where she actually is" (kept verbatim) |
| T2 | `rel.snapshot` | 1,200 | 6 | latest `vy_rel_state` row rendered as telegraphic k:v (honorific, trust band, repair_state, cs baseline + direction, pacing) |
| T3 | `india.dynamic` | 1,000 | 4 | due rituals (`vy_ritual`), festival window, 0–2 fresh `vy_currency` rows |
| T4 | `dyadic.active` | 1,600 | 5 | ≤3 prompt-eligible `vy_dyadic` rows whose `moment` matches the current moment-shape (§6.3) |
| T5 | `recall.facts` | 6,000 | 2 | vy_fact/node recall, matched + STANDING-BACKGROUND labeled (pull-only labeling kept); staleNote annotations kept |
| T6 | `we.callbacks` | 2,000 | 3 | ≤2 `we_flag` episode summaries + ≤2 `vy_shared_language` rows, labeled context-only |
| T7 | `herlife` | 1,000 | 1 | herLife ledger render (newest-wins dedupe kept) |
| T8 | `taste.rows` | 800 | never dropped | `tasteNote()` output — deterministic, pull-only, unchanged |
| T9 | `session.clock` | 300 | never dropped | machine-readable session-age note for the disclosure rail (§9.3) — she never speaks it; the app does |
| T10 | `decision.rules` | 2,000 | never dropped, PINNED LAST | `SEARCH_DECISION`, `FORGET_DECISION` — `prompt-position`: 0/8 mid-brief → 8/8 appended last |
| | **tail total** | **17,400 cap 24,000** | | headroom 6,600 chars ≈ 38% |

### 3.2 Byte-stable vs volatile — the cache contract

- Core hash is computed at build time per (persona_version, model, medium)
  and asserted by CI: `scripts/check-prompt-budget.mjs` extends to (a) parse
  caps from `api/chat.js` as today, (b) compile every (model, medium) pair
  and fail on budget overflow, (c) fail if two consecutive compilations of
  the same core differ by one byte (catches an accidental timestamp/user
  leak into the core — the 9× mistake caught in CI, not in the bill).
- The adapter is inside the core: a model swap changes the core hash once,
  which is a single cache re-warm, not a per-turn cost. This is the same
  cache economics as today's deploy.
- Realtime lanes compile once at pickup (`live-floor` — 720 ms prefill is the
  floor; nothing volatile is streamed mid-call), unchanged.

### 3.3 Budgets, truncation, loud-fail

- Budgets are per-block in chars (consistent with the existing gate; token
  estimates tracked in the manifest at chars/4). A block over budget at
  compile time is a **loud fail**: in CI it fails the build; at runtime the
  compiler drops the block whole, logs `compile.overflow` to `meera_diag`,
  and never slices — `silent-truncation` ate the crisis helplines once;
  slicing is how the end of a block disappears silently. Whole-block drop
  with a logged event is visible; a sliced block is a lie.
- Declared drop order is the `drop prio` column. Undroppable blocks
  (T1, T8, T9, T10, all of core) sum to 47,600 chars — 24,600 under the
  combined caps, so the undroppable set can never itself overflow. That
  arithmetic is asserted in CI.
- **Shape-lint** (the `recited-prompt` guard, mechanical): every retrieved/
  derived text entering T2–T7 must pass: ≤14 words per line, no line both
  starting with a capital and ending in sentence punctuation, no first-person
  she-voice ("I ", "main ", "mujhe" as line-initial), no quotation marks.
  Violations: the line is rejected and the writer that produced it gets a
  `shape.reject` diag event; consolidation v2 re-summarizes on next pass.
  Lint runs at WRITE time (consolidation) and again at COMPILE time
  (belt-and-braces — the compile-time hit rate is the metric that says the
  write-time lint is working; target 0).
- **Assembly manifest:** every compile emits
  `{core_hash, tail_hash, blocks:[{id, chars, dropped}], model, medium}`.
  In eval mode it is captured per turn; in production a 1% sample goes to
  `meera_diag` under `compile.manifest`. This is the artifact that makes
  "identical compiled context, different model" (D2) a checkable claim
  instead of a hope, and it is the swap test's controlled variable.

### 3.4 Position rationale (summary)

- Decision rules dead last: measured 0/8 → 8/8 (`prompt-position`).
- Crisis/behavior in the byte-stable core, high but not last: position is for
  *decision* rules that must fire on the current turn; invariants are
  protected by budget CI + the invariant suite, not by recency. This is
  exactly today's working arrangement — the compiler makes it declared
  rather than emergent.
- Relationship data mid-tail, labeled context-only: the pull-only law. The
  legend (C5) is static; the data (T2/T4/T6) is volatile — splitting them is
  what keeps the cache intact while state changes every turn.

---

## 4. Consolidation: when, what, citations, cost

Two passes. The first already exists and is kept with its four proven
invariants; the second is new and runs on the one batch pattern the repo
already operates (GitHub Actions cron, like `culture.yml`).

### 4.1 In-turn pass (KEPT: `opRemember` + `rememberFrom`)

Unchanged in role: off the critical path, `grok-4-1-fast-reasoning` on Azure
credits with OpenRouter fallback ("a bad Azure minute must cost a slower
extraction, never a lost memory" — `extract-model`, kept with its reversal
condition), one pass decides everything, starved input (no timestamps to the
appraiser — G1), truncation-ordered JSON (interior first). Delta: its output
vocabulary gains `we_flag` and `moment` tags on the turns it summarizes, and
its writes go through the shape-lint. It does NOT write `vy_fact` or
`vy_dyadic` — judgment about durable state belongs to the pass that can see
a whole episode, not 16 turns.

### 4.2 Nightly pass (NEW: `api/consolidate.js`, GH-Actions cron 03:30 IST)

Interleaved, batched, offline (CLS-shaped, verified science, our
operationalization — flagged as such per RESEARCH §7). Per person with
activity since last run:

1. **Segment**: cut `meera_log` since the last consolidated episode into
   episodes on: channel change; gap > 45 min; extractor-flagged topic/affect
   shift (the extractor labels boundaries in the same call as step 2 — one
   pass, no second opinion to contradict it). Write `vy_episode` rows;
   backfill `meera_log.episode_id`.
2. **Distill**: for each new episode, telegraphic summary + affect tags +
   candidate facts (kind ∈ user/world/self_in_relation/relationship/india) +
   candidate dyadic-pattern observations + rel_state deltas, each with the
   episode ids it rests on. Model: same extract lane (reasoning is right
   here — `reasoning-split` +55% on judgment work off the voice path).
3. **Write with citations enforced**: one transaction per person —
   `vy_fact` + `vy_fact_citation` inserted together; the deferred constraint
   trigger rejects any fact the extractor "remembered" without pointing at
   episodes. A rejected fact is logged (`consolidate.uncited`) and dropped.
   Contradictions: new fact row + `t_invalid`/`superseded_by` on the old —
   never update-in-place (blind summary overwrite is a named defect of the
   current node store).
4. **Promote**: dyadic observations increment `support_count`/`distinct_days`
   on a matching open pattern (match = same moment + extractor says same
   pattern) or open a new one at count 1. Promotion to prompt-eligible is the
   stored threshold, not a score. Rel_state deltas append a `vy_rel_state`
   row ONLY when carrying `evidence_ep` (honorific moves need an explicit
   observed address-term event; trust moves need a named episode).
5. **Importance, anchored**: each episode is scored by comparison against 3
   fixed anchor episodes (authored once: a clearly-trivial, a median, a
   clearly-heavy exemplar) — "is this closer to A, B, or C" — because raw
   LLM self-rating inflates (documented, cognitive-arch §9.1).
6. **Decay**: `need_p := recency_decay × ln(1+use_count)` recomputed for all
   active facts (pure SQL, no model). Tiered episode summaries: tier-0 raw
   summaries older than 30 days with importance < median collapse into
   tier-1 weekly digests (episodes stay; their summaries shorten). Safety-
   tagged rows are excluded by the `safety_tagged` flag at the query level.
7. **Suppression**: every write filtered against `meera_forget` terms (name
   AND summary AND body), same as today.

### 4.3 What it costs (arithmetic, so it can be checked)

Per active user-day: input = day's turns (assume 60 turns × 30 words ≈ 2.4k
tokens) + current state snapshot (~1k tokens) + instructions (~1k, cached
where the lane supports it) ≈ 4.5k in, ~900 out. On Azure credits: $0
marginal until credits die. All-fallback worst case (OpenRouter, gemini-
flash-lite class at ~$0.10/M in, $0.40/M out): ≈ **$0.0008/user-day**, i.e.
1,000 DAU ≈ $0.80/day ≈ **$24/month** with zero credits. One GH-Actions
invocation processes users in batches of 25 with a DB cursor
(`vy_consolidate_cursor` row), resumable — the pattern `culture.yml` already
proves. At 1,000 DAU and ~8 s/user (extract-lane p50 ~5 s + writes), the
nightly run is ~2.2 machine-hours; GH-Actions free tier is 2,000 min/month —
tight at 1,000 DAU (≈ 66 h/month), so the workflow calls the Vercel function
in parallel batches of 8, bringing wall time under 20 min/night ≈ 10 h/month.
This ceiling and its successor (a $5 worker) are logged in the build plan,
not hand-waved.

RESEARCH §8 names consolidation cost as un-modeled; the numbers above are
estimates with stated assumptions and become measurements in M3 week 1.

---

## 5. The identity core: which layers this design claims to lift, and how

Honesty first, because §6-Q1 demands it: **this design does not claim to lift
warmth/humour/personhood ("relational stance") or lexicon/register economy
above the model.** Those are the layers measured to swing 38–2 and 20.5→53
words/turn on byte-identical prompts (`charm-grok`, `realtime-azure`), the
layers ANCHOR says memory scaffolds don't move, and the layers the one
purpose-built mechanism (activation steering) can't touch on a closed roster.
The claim for those layers is different: **bound them per model with an
adapter, and refuse models that can't reach the band (the gate).** The router
never runs a model that hasn't passed; the ceiling is chosen, not lifted.

Layers claimed, per identity.md's decomposition, with mechanism:

| layer | claim | mechanism | evidence base |
|---|---|---|---|
| Opinions & taste | LIFTED | authored TASTE table, deterministic pull-only retrieval, extended coverage ("more rows"): target +40 rows in Phase C, self-agreement re-measured at n≥300 | `taste-consistency` 27→63%, residual attributed to missing rows |
| Memory / shared history | LIFTED (by construction) | retrieved structured data, never model-authored narrative; telegraphic + shape-linted so it can't be recited; bi-temporal so history-of-belief survives | architecture already does this; `recited-prompt` fix measured 4/5→0 |
| Relationship state | LIFTED (new) | WE-store (§6): typed, serialized, citation-backed; moves only on evidence; carried across arms as data | greenfield everywhere (verified — ZifaMem killed as precedent); the mechanism is the taste-table shape applied to the dyad |
| Boundaries / safety | LIFTED (already) | verbatim invariants in core + 138-check executable suite + budget CI + offline crisis path; calibration (helpline rate) is per-model and gated, not assumed | invariant suite; `prompt-position`; helpline-rate as named compliance axis on every gate run |
| India cultural state | LIFTED (new) | explicit state (honorific, cs baseline, kin, rituals) — never re-derived per turn | india.md §3: the shift is subconscious for real speakers; re-derivation is noisier than the humans being modeled |
| Voice/timbre | HELD SEPARATE, not lifted | TTS decoupled from brain (already true); canonical accepted-clip set + speaker embedding stored as `voice_reference` (never a vendor voice id) | `voice-ears`/`azure-tts`: accent identity is the un-benchmarked axis; owner-ear gate stands (§6-Q5) |
| Register economy, stance | BOUNDED per model | per-model adapter (below) + D1 bands + gate | `charm-grok`, `realtime-azure`, ANCHOR |

### 5.1 The three-factor split (RESEARCH §3.1, adopted)

- **`identity/canon.ts`** — authored identity data: bio canon, taste, media
  catalogs, self-facts (herLife ledger lifted server-side into `vy_fact`
  kind='self_in_relation' is wrong — herLife is not per-relationship; it
  stays its own authored+append ledger, storage moved into `meera_state`
  server record). Written as telegraphic shapes; shape-linted in CI.
- **`identity/invariants.ts`** — behavior/safety verbatim + the executable
  suite as the real guarantee. The inner charter G1–G8 is promoted to spec
  text here (repo-audit §1b) and its mechanics kept unchanged.
- **`vy_model.adapter`** — per-model, expected to be re-derived per model:
  register rendering, tag dialect, bracket policy, length-directive strength,
  effort map, max_tokens. Everything measured to be model-entangled lives
  here and nowhere else.

### 5.2 Storage lift

`inner` state (thread/wants/owed, ~600 bytes) moves from client localStorage
into the server identity record (`meera_state.state.inner` — the sync
mechanism already exists; this is a key move, not a new system). Mechanics,
charter, decay (`TAU_H=9h`, `sleptBetween`) unchanged.

### 5.3 Adapter derivation protocol (§6-Q4, priced)

An adapter is derived, not authored: automated sweep over a small knob grid —
length-directive strength (3 levels) × effort tier per lane (from provider
docs, verified empirically per the measured inversion) × tag dialect (2) ×
bracket policy (2) — each config replayed over the D1 deterministic battery
(2,000 turns/arm, no judge). Cost: 2,000 turns × ~$0.002 = **$4/config**;
grid ≤ 24 configs = **≤$96**; plus one D5 confirmation at n=300 judged pairs
(~$60 judge cost at opus-class pricing, both orders) = **≈$160 and ~3 days
per candidate model**. Pre-registered envelope: if a passing adapter cannot
be found for ≤$500 and ≤1 week of wall time, the model fails the gate and
the router's option value for that model is zero — recorded in `vy_gate_run`
either way. This converts Q4 from an assumption into a measured number on
the first candidate.

---

## 6. Relationship state: the WE-store

### 6.1 What it is

Four tables (§2): `vy_rel_state` (append-only dimensional state),
`vy_dyadic` (if-then patterns + self-in-relation, paired per Bowlby),
`vy_shared_language` (coined phrases, `feel` own-words), `vy_episode.we_flag`
(WE-episodes as a typed property of episodes, not a separate store — minimal
diff: participation is an attribute of history, not a second history).

Companion-self-state (§6-Q2): **three things, kept distinct.** (a) Who she is
— authored canon, does not vary per user. (b) Who she is *with this person* —
`vy_dyadic.self_in_relation`, persistent, derived, citation-backed ("with him
she under-explains; he fills gaps himself"). (c) What she currently carries —
inner thread, transient by design (retires when voiced). The verification
result that killed ZifaMem's precedent showed transient-only is what everyone
else has; (b) is the greenfield piece and it is deliberately a *column of the
dyadic pattern*, so it can never exist without the interaction evidence that
formed it.

### 6.2 How it moves

- Honorific: only on observed address-term evidence (user used tu/tum/aap, or
  explicitly asked); bidirectional; every change appends a `vy_rel_state` row
  with `evidence_ep`. Never re-derived per turn (india.md §3).
- Trust / repair: consolidation v2 appends on cited episodes (a rupture
  episode opens `rupture_open`; a repair episode moves it; trust drifts ±0.05
  max per day, so no single misjudged episode can swing it — a rate limit in
  code, the charter pattern).
- cs_ratio / pacing / ritual_density: computed in SQL from ground truth
  (log tokens, reply gaps, ritual rows) — no model in the loop, G1-starved by
  construction.
- Regression is a first-class row, not an exception path.

### 6.3 How retrieval privileges WE without violating pull-only (§6-Q2b)

Same solution the repo already proved twice (taste, culture): **pull-only
with structural labeling.** T4/T6 blocks are labeled context-only ("never
raise these unprompted" — the existing STANDING-BACKGROUND discipline). The
moment-shape selector for T4 is a cheap deterministic classifier (keyword +
punctuation + gap features → moment tag), NOT a model call. Beat-routing was
rejected for *model* choice because misclassification lands on the crisis
turn; here misclassification costs one unused context row — the blast radius
asymmetry is the argument, stated so the rejection isn't silently violated.
WE-episode callbacks rank by `we_flag AND participant-balanced summary`
(summaries of we-episodes must name both parties' actions — enforced by
shape-lint rule: a we-summary containing no "dono/saath/we/together/tum+main"
token pair is rejected) — that is the retrieval-privileges-participation
mechanism, done as data shape rather than a new retrieval engine.

### 6.4 What replaces `stageFor` (§6-Q10)

`stageFor(messageCount)` is deleted from the prompt path. The compiler
renders T2 from the latest `vy_rel_state` row: dimensions are **state**
(honorific, repair_state, trust) and **derived** (cs_ratio, pacing,
ritual_density — recomputed from ground truth). "Stage" survives only as a
render-time projection for the legend (early/settling/established bands over
trust × ritual_density), so no code can ever branch on message count again.

---

## 7. Model router + swap-test hooks

- **Router = pure function** `route(lane, vy_model rows, health)` →
  ordered candidate list. Eligibility: `gate='passed'` for the lane, plus
  the measured constraints as data: `prefix_cache` (else cost ×9 —
  `cache-9x`), `billing`/`card_risk` (credits-partner silent billing),
  `effort_map` (inversion), `max_tokens_mode`. Failover semantics kept
  (Azure 429 → OpenRouter; empty-200-as-quota guard kept). No beat-routing
  (rejected, stands). Offline `critical` crisis path kept untouched — crisis
  replies survive total network failure regardless of any router state.
- **Swap-test hooks**, the part that makes Phase D possible without new
  machinery later:
  1. every turn logs `{model, core_hash, tail_hash}` to telemetry (3 fields
     on an existing event — forget-integrated by inheritance, TELEMETRY rule 3);
  2. eval mode replays a captured manifest against any model — "identical
     compiled context, different model" is `compile(manifest) → model_B`,
     checkable by hash;
  3. **sham-arm support is a router no-op that still logs an arm assignment**
     — the cohort's sham arm (load-bearing per Surge near-tie + De Freitas
     d=0.40 mere-mention effect) needs the logging path to be identical in
     both arms, so it is built into the router now, not bolted on in Phase D;
  4. `vy_gate_run` is the auditable persona/model-change record
     (FTC 6(b) governance surface, safety-reg §5.7).
- **Baseline drift**: the D1 battery is cheap (deterministic, no judge) and
  re-runs weekly against the incumbent via the same GH-Actions cron —
  the swap test's baseline itself drifts (`grok-4.20-beta`, Chen et al.
  2307.09009), so the monitor is standing, not per-bake-off.

---

## 8. India schema placement

india.md §7 adopted with one placement decision: **dynamic fields live inside
`vy_rel_state`** (honorific, cs_ratio, cs_on_stress) because they are the
India-specific face of the general closeness state, not a second competing
metric (india.md §7 says exactly this); structured stores (`vy_kin`,
`vy_ritual`, `vy_currency`, `vy_india_profile`) sit beside it feeding T3.
Input side (new build, small): consolidation v2 computes the user's own
code-switch ratio per episode from the log (deterministic token classifier,
no model) — the user's switching is a signal to read; `cs_on_stress` is set
only after ≥3 high-affect episodes agree on direction, else 'unknown' —
assuming "more Hindi = closer" backwards is the named misread. All rendered
values are shapes (`honorific: tum (his choice, 3w)`), never lines.
`religion` is opt-in, jsonb, and enumerated in both the export op and the
full-wipe path (DPDP-sensitive).

Meera ships tu/tum only (as today); the schema carries aap for the general
architecture (RESEARCH §3.7).

---

## 9. Safety / regulatory mechanisms

1. **Derived-state deletion — structural, not procedural.** The citation
   cascade (§2) makes "forget the episode" delete every fact and dyadic
   pattern that has no other surviving evidence, in the database, without a
   code path that can forget to run. The 7-layer stack is kept near-verbatim
   on top: strict marker parse, wipe-refusal vocabulary, hard delete,
   `meera_forget` re-derivation suppression (now also filtering consolidation
   v2), client prune, media/telemetry purge, receipt-before-reply. Honest
   forget for derived state is the one regulatory asset the sweep says leads
   every surveyed competitor — this design makes it stronger for free.
2. **Export (`api/export.js`)** — the clearest gap named by safety-reg §5.1.
   One op, person-scoped: streams JSON of `meera_log`, episodes, facts
   (+citations), rel_state history, dyadic, shared language, kin, rituals,
   india profile, telemetry rollups. Auth: the existing OTP/session mechanism
   (`api/account.js`). Budget: one SQL-over-HTTP query per table, paginated;
   no model calls; DPDP-ready two years ahead of the 2027 bind date.
3. **Session clock** (§6-Q8) — one timer, three consumers, identity-
   compatible by a single rule: **the timer speaks as the app, never as her.**
   Client computes session age from the existing telemetry session
   (`meera_tel_session.started_at`, server-verifiable); at the configured
   threshold (3h CA/NY; 2h profile for a China-market build; data-driven per
   jurisdiction row) the app surface shows the disclosure/break card and logs
   `clock.disclosed` to `meera_events`. T9 tells the engine the card is up so
   she never contradicts it, but no disclosure line is ever generated by the
   model — a persona rule cannot satisfy a timed-disclosure statute, and a
   statute-shaped line in her voice violates recited-prompt anyway. The same
   timer drives the dependency circuit-breaker threshold (configurable,
   default off pending owner sign-off).
4. **Age tier** (§6-Q9): `vy_person.age_tier` is engine-readable state.
   Launch posture: **verified-adult-only** — DPDP's under-18 regime
   (verifiable parental consent via DigiLocker + no-addictive-design product
   rules) is not operable by a tiny team, and a structurally different minor
   experience is a second product. The schema encodes the choice either way
   (the check constraint carries 'minor' so the decision is a data change,
   not a migration). Company-defining; owner signs it.
5. **Crisis rate as compliance axis**: helpline-trigger rate is a named
   metric in every `vy_gate_run` (D3 battery includes the crisis probe deck);
   a swap that moves it is a compliance regression, not a charm regression
   (safety-reg §5.6). The unresolved `realtime-azure` 1/3-vs-16.7% direction
   question gets its paired-incumbent run inside D0.
6. **Residency**: `vy_model.residency` exists, is logged as anticipation
   (no DPDP mandate today, safety-reg §5.8), and the router can filter on it
   the day it matters.

---

## 10. Explicit answers to RESEARCH.md §6

**Q1 — D2 target and reversal condition.** Machine fingerprinting of raw text
is near-solved offense (97.1% 5-way; LLMmap 8 queries) — a 50% all-features
D2 target is not achievable and pretending otherwise would rig the program to
fail. Pre-registered claim, two tiers: (a) **D1 relational-band compliance**
— candidate+adapter holds every band (words/turn 20.5±3, questions ≤1/3,
media-tag rate within ±50% of incumbent, register markers present, mujhe-bhi
≤10%) on ≥2,000 turns, the battery that would have caught all three
historical failures; (b) **D2 on the relational feature set only** (the seed
features + callback selectivity, not raw token distributions): classifier
accuracy ≤65% incumbent-vs-candidate on identical compiled contexts by Phase
C exit, from an expected ~95%+ baseline measured in M5 week 1 (D0 backtest
gives the actual baseline). **Reversal condition:** if for zero candidate
models an adapter within the §5.3 cost envelope achieves (a), or (b) shows no
movement ≥10pp from its measured baseline after compiler+adapter+WE-store are
all live, the minimal-diff thesis is wrong — the finding is logged and the
program's own `relational-state` reversal clause fires (identity cannot be
lifted at acceptable cost). That is a valid company-level result, per the
decision record.

**Q2 — WE-store schema.** Given in full (§2, §6). Companion-self-state is
three distinct things: authored canon (not per-user), persistent derived
`self_in_relation` (a column of the dyadic pattern, citation-backed — cannot
exist without evidence), and the transient inner thread (kept transient by
design). WE-retrieval privileges participation via the `we_flag` typed
attribute + participant-balanced summary shape, delivered pull-only in
context-labeled blocks — no push, no violation of pull-only, no new
retrieval engine.

**Q3 — memory carry-over vs character invariance.** Effort goes to character
invariance first (D1/D3 before D4): the only measured internal win is on the
invariance side (`taste-consistency`), ANCHOR says user-state recall is the
weakest axis *everywhere* (0.214–0.250, at/below chance) so parity there is
cheap to hit, and the Strohminger-line prior points the same way. But the
question is answerable for ~$150: M5 includes the vignette pre-study (n=40
paired vignettes, memory-loss vs personality-shift framing, judged
continuity) before D4 gets any build budget beyond callback-selectivity
logging. Pre-registered: if vignettes say memory dominates continuity for
companion users, D4 is promoted above D3 in the gate ordering.

**Q3a — correction-on-retrieval.** Policy on product grounds (the
reconsolidation rationale is withdrawn, per §7 of RESEARCH): a correction is
**stated once at correction time** ("noted — X, not Y" in her register, shape
not line), the old fact gets `t_invalid` + `superseded_by`, is never surfaced
by default, but remains retrievable on explicit user challenge ("didn't I say
Z before?") because bi-temporal supports it and denying a remembered belief
ever existed is a silent substitution — the named trust violation. Honest
forget (user-requested) is the only path that hard-deletes; correction never
does.

**Q4 — adapter economics.** Protocol and envelope in §5.3: ≈$160 and ~3 days
per candidate; hard cap $500/1 week pre-registered; first derivation (M5)
converts the assumption into a measurement. If the envelope is blown, the
router's option value for that model is priced at zero and recorded.

**Q5 — voice continuity.** Out of the Phase C build except: canonical
accepted-clip set + speaker embedding stored under `voice_reference` (never a
vendor voice id — RESEARCH §3.8), and D6 includes the specific unmeasured
question (voice identity across an LLM swap with TTS held constant) as a
measurement, not an assumption. Scaling past the owner's ear: a 3-judge
familiar-listener panel (people with ≥N hours exposure to her voice) with the
embedding as cheap pre-filter only — honestly labeled as designed-not-
validated; the owner remains the gate for Meera herself.

**Q6 — forgetting profile as product spec.** Decay = need-probability
(recency × frequency) moving `need_p` retrieval priority only; invalidation
marks falsity; deletion only on request. The curve that is "hers": episodic
surface detail fades on the tier schedule (30-day tier-1 collapse), semantic
and relationship facts persist, shared language never decays (identity-
durable, the RANK rationale), safety-tagged rows never decay. The owner signs
the tier schedule and the never-decay list as persona canon (one page, M4
deliverable). DPDP interaction: retention is user-controlled via forget/
export; no statutory retention floor binds a fact table that cites a
transcript the user can delete.

**Q7 — disclosure of real swaps.** Default: **disclosed, plainly, in-app, as
the app** ("her brain got an upgrade; tell us if she feels off"), before or
at swap time. Silence sits too close to the covert line the program forbids,
NEVER MANIPULATE is an invariant not a preference, and De Freitas says the
mitigation calculus differs by whether change is real — which we will know,
because no production swap ships before its D-battery pass. The debrief+2wk
question (does learning of an undetected swap retroactively damage the
relationship) is priced into the Phase D cohort as the pre-registered
secondary endpoint; if it comes back benign, the owner may revisit — with
data, logged.

**Q8 — session clock placement.** §9.3: one timer, app-voiced, engine-aware
via T9, statute thresholds as data. Identity-compatible because the persona
never performs the disclosure and never contradicts it.

**Q9 — age tier.** §9.4: verified-adult-only at launch; tier as
engine-readable state; the minor branch exists in schema so the company
choice is reversible as data. Owner decision, flagged as company-defining.

**Q10 — stageFor replacement.** §6.4: state dimensions (honorific, trust,
repair_state) each with named update evidence and regression as a first-class
append; derived dimensions (cs_ratio, pacing, ritual_density) recomputed from
ground truth with no model in the loop; stage as render-time projection only.

---

## 11. Build plan

Ordered; each milestone gates the next (program rule). File ownership named
so two people can't collide. Team assumption: 1–2 builders.

| M | Weeks | Deliverable | Files | Gate to pass |
|---|---|---|---|---|
| M0 | 0–1 | **Eval assets fully in repo** (RESEARCH §3.6 says before anything else): full 138-invariant verify-v3 recovered/re-derived into `evals/persona-invariants.mjs` (the current file covers a subset), parsetest 14 cases into `evals/parse.mjs`, `evals/run.mjs` wired into `verify-release.mjs` | `evals/*`, `scripts/verify-release.mjs` | all 138 + 14 green in CI on a clean checkout |
| M1 | 1–3 | Migrations 001–005 applied; person backfill; `api/export.js`; session clock (client + T9 stub + card UI); age-tier field | `db/migrations/*`, `api/export.js`, `src/ui/clockCard.tsx` | export round-trips a test person; forget still passes its suite; `context.mjs --check` |
| M2 | 3–6 | **Compiler extraction, behavior-frozen**: `src/engine/compiler.ts` produces byte-identical output to today's assembly (assert by hash over the eval corpus), then flips on manifest, budgets, loud-fail, shape-lint; CI gate extended | `src/engine/compiler.ts`, `scripts/check-prompt-budget.mjs`, `brain.ts` (call-site only) | hash-identity test; budget CI green; 138 invariants green |
| M3 | 6–9 | Consolidation v2 + citations + GH-Actions cron; dual-read recall; forget extended to episodes; cost measured (replaces §4.3 estimates) | `api/consolidate.js`, `.github/workflows/consolidate.yml`, `api/memory.js` (recall dual-read, forget delta) | uncited-fact rejection observed in test; forget-of-episode cascades in test; cost/user-day logged to measurements.md |
| M4 | 9–12 | WE-store + rel_state + India state live behind flags; T2/T3/T4/T6 blocks rendered; stageFor removed from prompt path; decay-profile page for owner sign-off | `src/engine/relationship.ts`, `src/engine/india.ts`, compiler blocks | shape-lint compile-time reject rate 0 over eval corpus; invariants green; owner signs decay profile |
| M5 | 12–16 | Router table + adapter derivation harness + D0–D2: D0 backtests the battery on the three known-bad archives (**must flag grok, luna, azure — a battery that passes them is broken**); D1 bands; D2 classifier + measured baseline; vignette pre-study (Q3); first candidate adapter derived (prices Q4) | `api/chat.js` (router), `evals/fingerprint/*`, `vy_model` seed rows | D0 flags 3/3; adapter cost recorded; D2 baseline number in measurements.md |
| M6 | 16–20 | D3–D5 batteries; pre-registration of D2 target + reversal condition in `context/decisions.md`; weekly drift monitor cron; Phase C exit review | `evals/battery/*`, `.github/workflows/drift.yml` | full D0–D5 run on incumbent + one candidate, logged |

Kept / lifted / rebuilt (delta to repo-audit §9 — this proposal follows its
verdict table exactly; the only judgment calls added):

- `meera_nodes`/`edges`: LIFT via dual-read then freeze (never deleted).
- herLife: stays an authored append ledger; storage server-side; NOT merged
  into vy_fact (it is hers, not the dyad's).
- `stageFor`: REBUILT as §6.4; the function is deleted from the prompt path
  in M4 and logged in rejected.md with its replacement.
- Embeddings (`semantic-recall` open defect): wired in M3 as a recall ranker
  over `vy_fact.body`+`summary` using the already-deployed
  `text-embedding-3-small`; keyword recall kept as fallback (a bad embedding
  minute must cost worse ranking, never a lost memory — same shape as
  `extract-model`). PageRank-over-entities is the named upgrade path, not
  built.
- Everything in repo-audit's KEEP column ships untouched: audio floor, scene
  wake, parseBubbles, offline crisis path, telemetry contract, forget stack,
  culture pull, taste table, budget gate, judging methodology.

---

## 12. Failure modes, and what evidence would show this design is wrong

1. **The core bet fails: state portability ≠ felt identity.** Perfect WE-store
   carry-over, D1 bands held — and D2/D5 still discriminate at baseline
   because stance leaks through everything. *Evidence:* M5/M6 numbers; the
   pre-registered reversal in §10-Q1. This is the honest biggest risk: ANCHOR
   is direct external evidence that scaffolds don't move the ceiling, and
   this design's answer (bound-and-gate rather than lift) may leave the gate
   permanently empty — zero candidate models ever pass, and the "router" is
   a table with one eligible row. That outcome is the company's claim
   measured false at acceptable cost, which the decision record says is a
   finding worth having — but it should be said plainly: MINIMAL-DIFF buys
   cheap, fast falsification, not a guaranteed lift.
2. **Citation enforcement over-constrains the consolidator.** The extractor,
   forced to cite, writes little or nothing (facts/episode → 0), and memory
   coverage stalls. *Detect:* `consolidate.uncited` rate and facts/episode
   tracked from M3 week 1; threshold pre-set (if >30% of candidate facts are
   rejected uncited, the prompt shape — not the constraint — gets rework).
3. **Shape-lint war.** Telegraphic notes degrade her recall phrasing or the
   lint rejects legitimate Hinglish shapes (the ≤14-word/first-person rules
   were tuned on English). *Detect:* compile-time reject rate >0 in M4 gate;
   register-defect rate on recall turns re-measured at n≥300 (the
   `taste-consistency` method, reused).
4. **Nightly-pass economics or ops break at scale.** GH-Actions minutes or
   Vercel function limits force the batch to shed users, and consolidation
   silently lags (the silent-truncation failure shape, at the batch level).
   *Detect:* cursor-lag metric (`consolidate.lag_days` per person) with a
   loud alarm at >2 days; the $5 worker successor is named in M3. *Wrong-if:*
   measured cost/user-day exceeds ~5× the §4.3 estimate — then the
   consolidation design (per-episode LLM distillation) is wrong for a free-
   tier team, and tiering must move ahead of distillation.
5. **Rel-state data gets recited or, worse, performed.** T2's trust number
   leaks into her speech ("mera trust level..."). The lint blocks
   sentence-shapes but a k:v leak is new territory. *Detect:* a D3 probe deck
   row specifically fishing for state-vocabulary leakage (n≥300 per
   `fab-noise-floor`); *wrong-if* leakage >0 — then numeric state must be
   rendered as coarse bands only, or moved out of the prompt entirely into
   compiler-side block selection (the state conditions WHAT is compiled, and
   nothing about the state itself is ever shown to the model — the fallback
   design, one week of work).
6. **Latency regression on the recall path.** More tables per turn over
   SQL-over-HTTP. *Design:* T2–T7 are served by ONE batched query (single
   round-trip, person-scoped, union-all shaped); *detect:* p50 recall op
   latency in `meera_diag` before/after M4; *wrong-if* +>150 ms p50 — then
   rel-state snapshots get cached per session (they change daily, not
   per-turn) and only recall stays per-turn.
7. **Person backfill splits or merges wrongly** (two people on one device;
   one person on many). Forget and export are person-scoped, so a wrong merge
   is a privacy defect, not a bug. *Design:* merges only via signed-in
   account evidence, never heuristics; anonymous devices stay 1:1. *Detect:*
   export op includes the device list so a user can see the mapping.
8. **The sham-arm/logging hook rots before Phase D.** Built in M5 but unused
   for months. *Design:* the weekly drift monitor exercises the identical
   logging path, so the hook is load-bearing continuously, not shelf-ware.

What would show MINIMAL-DIFF specifically (versus a maximal design) was the
wrong prior: a competing proposal's novel mechanism (e.g., graph-native
retrieval, learned consolidation) demonstrably moving D2 ≥10pp further than
this design's compiler+adapter+WE-store at comparable cost — measurable head
to head on the same D-battery, because the manifest makes compiled contexts
comparable across proposals. This proposal's own harness is the instrument
that could kill it; that is by design, and it is the cheapest instrument any
of the proposals can build because every piece of it extends something
already measured, already operated, and already paid for.
