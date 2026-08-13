# PROPOSAL D — MULTIMODAL-FIRST
## The episode is the atom; text is one channel of it

Phase B independent design proposal, Vyakti relational-state program.
Author stance (assigned prior): **multimodal-first** — design around the
multimodal episode record (RESEARCH.md §3.8) and the live lanes, with text
chat as one modality of episodes, not the center.

Grounding: `docs/RELATIONAL-STATE.md`, `docs/research/RESEARCH.md`,
`docs/research/repo-audit.md`, `docs/research/multimodal-state.md`,
`docs/research/identity.md`, `docs/research/india.md`,
`docs/research/safety-reg.md`, `docs/research/swap-test.md`,
`context/decisions.md`, `context/measurements.md`, `context/rejected.md`,
`db/schema.sql`, `context/architecture.md`. Every design choice below cites a
measured law or argues against one with evidence and says so.

---

## 0. Thesis, and why multimodal-first is not a modality preference

**Claim.** The atomic unit of relational state is the *episode* — a bounded
span of shared experience carrying (a) what happened, (b) how it was said
(symbolic affect tags), (c) what was attended to together (visual
assertions + her reactions, kept separate), (d) who did what (participant
attribution), and (e) a citation trail to the raw transcript. Everything
else — derived facts, the WE-store, honorific state, fingerprint baselines,
even the forget cascade — is a fold over episodes. A text chat turn is the
*degenerate* episode (no audio channel, no frames), not the paradigm case.

**Four evidence lines make this the right center, not a taste:**

1. **The product lives in the live lanes, and that is where identity dies
   first.** Both internal swap failures were measured on *spoken-surface*
   axes: `charm-grok` collapsed at 36.1 vs 20.5 words/turn and 63%
   question-ending turns; `realtime-azure` at 41→53 words/turn, 14.0 s
   median spoken turns, spoken-register markers 4/24 — "these ARE her
   prosody" (rejected.md). The identity fingerprint users actually
   experience is prosodic-register-shaped. An architecture centered on text
   facts optimizes the axis that is already commoditized (RESEARCH.md §2:
   "fact retention is solved everywhere") and leaves unguarded the axis
   where the measured collapses happened.

2. **Extract-during-the-turn-and-persist is the only architecture that
   exists in the field for live state** (multimodal-state.md §4, verified):
   Gemini Live evicts video first at 258 tok/s, resumption ~10 min; OpenAI
   Realtime is stateless past the transcript. A design that treats the call
   and watch lanes as an afterthought to a text memory store will, by
   vendor construction, permanently lose the part of the relationship that
   happened there. The episode recorder must be a first-class, in-session
   component or those episodes never exist at all.

3. **Symbolic affect tags are the one swap-portable representation of
   "how it was said"** — EchoMind: only 3/12 models perceive vocal cues
   from raw audio at >60%, but handing the correct cue as *text* lifts
   GPT-4o-Audio empathy 3.34→4.42/5. The bottleneck is perception, not
   generation. A text tag survives any model swap unchanged; a vendor
   prosody feature does not. This is the audio-channel analogue of the
   repo's own proven mechanism (`taste-consistency`: authored state +
   deterministic retrieval, 27%→63%) — externalize the layer as retrieved
   data and it stops depending on what the model feels like doing.

4. **Familiarity beats fidelity on voice** (multimodal-state.md §2,
   secondary-sourced; internal analogue `voice-ears` measured): the owner —
   the familiar listener — rejected the option that won every measured
   axis. Voice identity therefore cannot be guarded by vendor metrics; it
   must be guarded by an *owned* continuity anchor (canonical accepted-clip
   set + speaker embedding) and a familiar-listener gate. That anchor is
   relational state, and no text-centric design has a slot for it.

**What this proposal does NOT claim:** that multimodal state lifts the
charm/warmth/personhood ceiling. It does not; the model sets that ceiling
(`charm-grok`, ANCHOR). The claim is narrower and testable: centering the
episode record (i) protects the state that is otherwise unrecoverable,
(ii) moves the largest measurable share of what a judge or user reads —
callbacks, attunement, register continuity, shared-history references —
out of the model and into deterministic state, and (iii) gives the D2
fingerprint gap its best chance of narrowing, because the compiled context
carries the relationship instead of asking the model to improvise it.

---

## 1. Component map

```
                          ┌─────────────────────────────────────────────┐
                          │                CLIENT                       │
                          │  chat UI · liveCall.ts (KEEP) · scene.ts    │
                          │  (KEEP) · on-device affect tagger (NEW v1)  │
                          │  inner.ts mechanics (KEEP; storage LIFTED)  │
                          └───────┬─────────────────────┬───────────────┘
                                  │ turns/frames/tags   │ telemetry (KEEP)
                                  ▼                     ▼
┌───────────────┐  ┌──────────────────────────┐   ┌──────────────┐
│ MODEL ROUTER  │◄─┤   CONTEXT COMPILER (NEW) │   │ SESSION CLOCK│(NEW)
│ (REBUILD of   │  │ typed blocks · budgets · │   │ CA/NY/China  │
│ fallback      │  │ manifest · byte-stable   │   │ timers       │
│ chain)        │  │ core · shape linter      │   └──────┬───────┘
│ + adapter     │  └────────▲────────────────┬┘          │directive block
│ + fingerprint │           │ reads          │ manifest  ▼ into tail
│   gate        │  ┌────────┴────────────────▼───────────────────────┐
└──────┬────────┘  │              STATE PLANE (Neon Postgres)        │
       │           │  vy_episode / vy_visual_assertion /             │
       ▼           │  vy_shared_moment  (EPISODE STORE — the atom)   │
┌──────────────┐   │  vy_derived (citation-enforced)                 │
│ EPISODE      │   │  vy_we_state / vy_we_event / vy_dyadic_pattern  │
│ RECORDER(NEW)│──►│  vy_phrase / vy_kin / vy_ritual  (WE-STORE)     │
│ per lane:    │   │  vy_identity_* (taste/canon/self — authored)    │
│ chat/call/   │   │  vy_voice_profile / vy_prosody_baseline         │
│ watch writers│   │  vy_adapter / vy_route  (router as data)        │
└──────┬───────┘   │  meera_log (KEEP, ground truth) · meera_forget  │
       │           │  (KEEP) · meera_tel* (KEEP) · vy_person/device  │
       ▼           └──────────────▲──────────────────────────────────┘
┌──────────────┐                  │ writes with citations
│ CONSOLIDATOR │──────────────────┘
│ (LIFT of     │   session-final pass (extract lane, Azure credits)
│ opRemember)  │   + nightly interleaved pass (GitHub Actions cron)
└──────────────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│ SAFETY/REG PLANE: forget v2 (episode +      │
│ derived cascade, receipt-before-reply KEEP) │
│ · export op (NEW) · age-tier state (NEW)    │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ EVAL PLANE: verify-v3 + parsetest RECOVERED │
│ · D0–D6 battery · nightly fingerprint job   │
│ · compiler-manifest assertions in CI        │
└─────────────────────────────────────────────┘
```

Team-size honesty: this is 7 new server files, 4 migrations, 1 client
module, and 2 cron jobs on top of a KEEP-heavy base. Everything runs on
Vercel functions + Neon SQL-over-HTTP + GitHub Actions (free) + Azure
credits for the extract lane. No new paid infrastructure.

---

## 2. SQL schema (Neon) and migration path from db/schema.sql

### 2.1 Design rules the schema encodes

- **Person over device.** `schema.sql` says "DEVICE ID IS THE IDENTITY" —
  repo-audit names this a portability gap and safety-reg.md §5.2 says
  forgetting must follow continuity, not `device_id`. New tables key on
  `person_id`; legacy tables keep `device_id` and join through `vy_device`.
  Delete-own-rows-by-construction is preserved: every user-scoped statement
  filters on `person_id` resolved from the authenticated device.
- **Citations are constraints, not conventions.** No derived row exists
  without ≥1 episode citation; enforced by CHECK + trigger, not by prompt
  discipline (consolidation-citation law; Generative Agents reflection-
  hallucination evidence).
- **Supersede, don't delete** (Zep bi-temporal, verified) — except under
  user forget, which is a hard delete (honest-forget KEEP). Two mechanisms,
  two jobs: `invalid_at` marks falsity; forget removes rows.
- **No sentence-shaped text columns.** Every text field that can reach a
  prompt carries a `style` discipline checked by the compiler's shape
  linter, and prompt-visible summaries are telegraphic (`recited-prompt`).

### 2.2 DDL (idempotent, in migration order)

```sql
-- ── migration 001_person.sql ─────────────────────────────────────────
create extension if not exists vector;           -- pgvector (Neon supports)
create extension if not exists pgcrypto;         -- gen_random_uuid

create table if not exists vy_person (
  person_id       uuid primary key default gen_random_uuid(),
  user_id         uuid,                 -- links meera_state when signed in
  age_tier        text not null default 'unknown'
                  check (age_tier in ('adult_verified','adult_declared',
                                      'minor','unknown')),
  -- static India profile (india.md §7B): facts, not relationship state
  mother_tongue   text,
  home_region     text,
  religion_observance jsonb,            -- OPT-IN. DPDP-sensitive: single
                                        -- column => targeted erasure is one
                                        -- UPDATE, and export marks it.
  family_structure jsonb,               -- joint/nuclear, names once given
  dietary_identity text[] not null default '{}',
  created_at      timestamptz not null default now()
);

create table if not exists vy_device (
  device_id  uuid primary key,
  person_id  uuid not null references vy_person(person_id),
  linked_at  timestamptz not null default now()
);
create index if not exists vy_device_person on vy_device (person_id);

-- Backfill: one person per existing device (idempotent).
insert into vy_device (device_id, person_id)
select d.device_id, gen_random_uuid()
from (select distinct device_id from meera_log) d
on conflict (device_id) do nothing;
-- (a follow-up statement inserts the vy_person rows for any device-created
--  person_id not yet present; merging two devices into one signed-in person
--  is an UPDATE on vy_device.person_id — history follows automatically.)

-- ── migration 002_episodes.sql ───────────────────────────────────────
create table if not exists vy_episode (
  id              bigint generated always as identity primary key,
  person_id       uuid not null,
  channel         text not null
                  check (channel in ('chat','call','watch','voicenote')),
  started_at      timestamptz not null,
  ended_at        timestamptz,
  boundary_reason text not null default 'session-end'
                  check (boundary_reason in
                    ('topic','emotion','goal','channel','session-end',
                     'backfill')),         -- EST prediction-error segmentation
  summary         text not null,           -- TELEGRAPHIC. shape-linted on
                                           -- write AND on compile.
  summary_style   text not null default 'telegraphic-v1',
  we_flag         boolean not null default false,  -- participation episode:
                                           -- "we did/watched/decided X",
                                           -- not "I learned X about you"
  participants    text[] not null default '{owner,meera}',
                                           -- speaker-id is NOT built
                                           -- (rejected.md#speaker-id); this
                                           -- stays {owner,meera} until that
                                           -- reverses. Column exists so the
                                           -- WE/I distinction is structural
                                           -- from day one.
  affect_tags     jsonb not null default '[]',
    -- [{label, intensity, source: 'voice'|'text'|'vision',
    --   extractor, confidence}] — symbolic labels only. Raw 48-dim
    -- vectors NEVER stored in prompt-reachable columns (§3.8 spec).
  affect_delta    jsonb,
    -- {topic, from_label, to_label, basis: [episode_id,...]} — how the
    -- read on a topic moved (Memory Bear "evolving variable" shape)
  importance      real not null default 0.5,   -- DIMF-style; anchored
                                               -- scoring, never raw
                                               -- LLM self-rating (§3.3)
  boundary_salience real not null default 0.0, -- EST: boundary-ness as a
                                               -- SEPARATE channel from
                                               -- affect intensity (flagged
                                               -- design inference, §3.3)
  consolidation_tier text not null default 'raw'
                  check (consolidation_tier in
                    ('raw','daily','weekly','monthly','keeper')),
  safety_tags     text[] not null default '{}', -- e.g. {crisis}; non-empty
                                                -- => never decay-eligible
  log_from        bigint,                 -- citation to meera_log id range:
  log_to          bigint,                 -- every episode traces to ground
                                          -- truth transcript rows.
  superseded_by   bigint references vy_episode(id),
  invalid_at      timestamptz,            -- bi-temporal-lite: belief died,
                                          -- row remains (until forget)
  created_at      timestamptz not null default now(),
  embedding       vector(1536)            -- text-embedding-3-small (already
                                          -- deployed on Azure, unwired —
                                          -- closes `semantic-recall`)
);
create index if not exists vy_episode_person_at
  on vy_episode (person_id, started_at desc);
create index if not exists vy_episode_person_tier
  on vy_episode (person_id, consolidation_tier, importance desc);
create index if not exists vy_episode_embed
  on vy_episode using hnsw (embedding vector_cosine_ops);

-- Watch lane: claims and reactions are SEPARATE OBJECTS (§3.8: a
-- later-corrected visual claim must not silently invalidate a genuine
-- emotional beat that already landed).
create table if not exists vy_visual_assertion (
  id               bigint generated always as identity primary key,
  episode_id       bigint not null references vy_episode(id)
                     on delete cascade,
  person_id        uuid not null,
  claim            text not null,          -- telegraphic
  extractor_model  text not null,          -- REQUIRED: vision-fab law — a
  confidence       real not null,          -- record with no model+confidence
  declared_illegible boolean not null default false, -- cannot later be told
                                           -- apart from a hallucination.
  frame_t_ms       integer,                -- offset into the session
  created_at       timestamptz not null default now()
);
create index if not exists vy_va_episode on vy_visual_assertion (episode_id);

create table if not exists vy_shared_moment (
  id            bigint generated always as identity primary key,
  episode_id    bigint not null references vy_episode(id) on delete cascade,
  person_id     uuid not null,
  assertion_id  bigint references vy_visual_assertion(id) on delete set null,
  reaction      text not null,   -- her in-the-moment reaction, own words,
                                 -- survives correction of the claim it
                                 -- reacted to (assertion link nullable)
  reactor       text not null default 'meera',
  at            timestamptz not null default now()
);

-- Voice identity continuity anchor (multimodal-state.md §2.2): points at
-- OUR canonical accepted-clip set + embedding, never a vendor voice ID.
create table if not exists vy_voice_profile (
  id            bigint generated always as identity primary key,
  subject       text not null default 'meera',   -- hers; user profiles only
                                                 -- if ever consented
  clip_refs     text[] not null default '{}',    -- storage paths of
                                                 -- owner-accepted clips
  embedding     vector(256),                     -- ECAPA-style d-vector
  f0_hz         real,                            -- hers: 266 (measured)
  accepted_by   text not null default 'owner-ear',
  created_at    timestamptz not null default now(),
  superseded_by bigint references vy_voice_profile(id)
);

-- Deterministic per-lane register bands, recomputed nightly from episodes.
-- These ARE the D1 fingerprint and the production drift alarm.
create table if not exists vy_prosody_baseline (
  id                 bigint generated always as identity primary key,
  lane               text not null,        -- chat|call|watch
  model_id           text not null,
  window_days        integer not null,
  words_per_turn     real,                 -- her lane: 20.5
  question_rate      real,                 -- ceiling ≈ 1 in 3
  register_marker_rate real,
  media_tag_rate     real,
  mirror_echo_rate   real,                 -- "mujhe bhi" reach-for rate
  n_turns            integer not null,
  computed_at        timestamptz not null default now()
);

-- ── migration 003_derived_we.sql ─────────────────────────────────────
-- EVERY derived/reflected fact cites source episodes, or it cannot exist.
create table if not exists vy_derived (
  id            bigint generated always as identity primary key,
  person_id     uuid not null,
  kind          text not null check (kind in
                  ('user_fact','affect_trend','preference','narrative',
                   'code_switch_read','other')),
  body          jsonb not null,            -- values/shapes, never lines
  cites         bigint[] not null check (cardinality(cites) >= 1),
  confidence    real not null default 0.5,
  derived_by    text not null,             -- consolidator model + version
  created_at    timestamptz not null default now(),
  superseded_by bigint references vy_derived(id),
  invalid_at    timestamptz
);
create index if not exists vy_derived_person on vy_derived (person_id, kind);
-- gin index lets the forget cascade find rows citing deleted episodes fast:
create index if not exists vy_derived_cites on vy_derived using gin (cites);

-- Trigger: citations must reference live episodes of the SAME person.
create or replace function vy_check_cites() returns trigger as $$
begin
  if exists (
    select 1 from unnest(new.cites) c
    left join vy_episode e on e.id = c and e.person_id = new.person_id
    where e.id is null
  ) then
    raise exception 'vy_derived %: citation to missing/foreign episode',
      new.id;
  end if;
  return new;
end $$ language plpgsql;
drop trigger if exists vy_derived_cites_t on vy_derived;
create trigger vy_derived_cites_t before insert or update on vy_derived
  for each row execute function vy_check_cites();

-- WE-STORE ------------------------------------------------------------
-- Snapshot is a cache; vy_we_event is the truth (event-sourced so state
-- can REGRESS and the swap test can carry it across arms as a controlled,
-- serialized variable).
create table if not exists vy_we_state (
  person_id           uuid primary key,
  honorific_register  text not null default 'tum'
                      check (honorific_register in ('tu','tum','aap')),
  -- Meera ships tu/tum only (persona starts at tum by design); 'aap'
  -- exists for the general architecture (india.md §3).
  code_switch_baseline real,          -- rolling % Hindi-content tokens;
                                      -- computed DETERMINISTICALLY, no LLM
  direction_on_stress text
                      check (direction_on_stress in
                        ('retreat_L2','intensify_L1','unknown'))
                      default 'unknown',
  trust               real not null default 0.5,   -- 0..1, event-sourced
  ritual_density      real not null default 0.0,   -- rituals fired / 30d
  rupture_open        boolean not null default false,
  version             integer not null default 0,
  updated_at          timestamptz not null default now()
);

create table if not exists vy_we_event (
  id         bigint generated always as identity primary key,
  person_id  uuid not null,
  dim        text not null,     -- 'honorific_register'|'trust'|'rupture'|
                                -- 'repair'|'code_switch'|'ritual'
  from_val   text,
  to_val     text not null,
  cites      bigint[] not null check (cardinality(cites) >= 1),
  derived_by text not null,
  at         timestamptz not null default now()
);
create index if not exists vy_we_event_person on vy_we_event (person_id, at desc);
create index if not exists vy_we_event_cites on vy_we_event using gin (cites);
-- same citation trigger:
drop trigger if exists vy_we_event_cites_t on vy_we_event;
create trigger vy_we_event_cites_t before insert on vy_we_event
  for each row execute function vy_check_cites();

-- Dyadic pattern records (Baldwin relational schemas): if-then shapes of
-- the PAIR, retrieved by moment-shape, never by topic keyword.
create table if not exists vy_dyadic_pattern (
  id              bigint generated always as identity primary key,
  person_id       uuid not null,
  trigger_shape   text not null,   -- telegraphic: 'goes quiet before
                                   -- saying something honest'
  response_shape  text not null,   -- telegraphic: 'don't fill the silence'
  trigger_embedding vector(1536),  -- retrieval key = current moment-shape
  cites           bigint[] not null check (cardinality(cites) >= 2),
                                   -- a pattern needs ≥2 episodes; one
                                   -- occurrence is an anecdote
  times_confirmed integer not null default 0,
  last_confirmed  timestamptz,
  confidence      real not null default 0.4,
  created_at      timestamptz not null default now(),
  invalid_at      timestamptz
);
create index if not exists vy_dp_embed
  on vy_dyadic_pattern using hnsw (trigger_embedding vector_cosine_ops);
drop trigger if exists vy_dp_cites_t on vy_dyadic_pattern;
create trigger vy_dp_cites_t before insert or update on vy_dyadic_pattern
  for each row execute function vy_check_cites();

-- Shared-language ledger (LIFT of meera_nodes kind='phrase' + RANK
-- rationale: "a callback that survived three weeks is worth ten inside
-- the same chat").
create table if not exists vy_phrase (
  id             bigint generated always as identity primary key,
  person_id      uuid not null,
  phrase         text not null,          -- the coined word/joke itself:
                                         -- the ONE class where verbatim is
                                         -- the point (it is THEIR line,
                                         -- not a line written for her)
  gloss          text not null default '',  -- telegraphic what-it-means
  origin_episode bigint references vy_episode(id) on delete cascade,
  first_at       timestamptz not null default now(),
  last_used      timestamptz,
  uses           integer not null default 1
);

-- India dynamic state beyond we_state scalars (india.md §7A):
create table if not exists vy_kin (
  id            bigint generated always as identity primary key,
  person_id     uuid not null,
  name          text not null,
  relation_type text not null,      -- chachi/mausi/bua are DIFFERENT
  fictive       boolean not null default false,
  address_term  text,
  cites         bigint[] not null check (cardinality(cites) >= 1),
  updated_at    timestamptz not null default now()
);
drop trigger if exists vy_kin_cites_t on vy_kin;
create trigger vy_kin_cites_t before insert or update on vy_kin
  for each row execute function vy_check_cites();

create table if not exists vy_ritual (
  id          bigint generated always as identity primary key,
  person_id   uuid not null,
  kind        text not null,   -- 'khana_khaya'|'festival'|'match_checkin'|...
  state       jsonb not null default '{}',
                -- {last_fired, knows_comfort_food, observed_festivals[],
                --  last_festival_acknowledged, currency_pool:[{topic,
                --  last_used}]}  — festival_calendar_state and
                --  topical_currency_log live here as kinds
  updated_at  timestamptz not null default now()
);

-- Her interiority, LIFTED server-side (repo-audit 1b: client localStorage
-- is a liability for a layer whose job is surviving device replacement).
-- Mechanics (thread decay TAU_H=9h, sleptBetween, retire-once-voiced,
-- charter G1–G8) stay in engine code UNCHANGED; only residence moves.
create table if not exists vy_inner (
  person_id  uuid primary key,
  state      jsonb not null,        -- same ~600-byte shape store.ts holds
  updated_at timestamptz not null default now()
);

-- Authored identity data (the taste table et al., server-resident so all
-- lanes and all models read the SAME rows):
create table if not exists vy_identity_row (
  id         bigint generated always as identity primary key,
  layer      text not null check (layer in
               ('taste','canon','self_fact','media_catalog')),
  key        text not null,
  body       jsonb not null,        -- telegraphic notes/shapes ONLY;
                                    -- CI shape-lints this table's content
  authored_by text not null default 'owner',
  version    integer not null default 1,
  active     boolean not null default true
);
create unique index if not exists vy_identity_layer_key
  on vy_identity_row (layer, key) where active;

-- ── migration 004_router.sql ─────────────────────────────────────────
create table if not exists vy_adapter (
  model_id     text not null,
  lane         text not null,
  primary key (model_id, lane),
  register_rules text not null,     -- per-model rendering: bracket
                                    -- semantics, tag vocabulary, spoken
                                    -- register — explicitly expected to be
                                    -- re-derived per model (§3.1 layer 3)
  tag_vocab    jsonb not null default '{}',
  effort_tier  text,                -- per-lane inversion is MEASURED
                                    -- (chat+minimal 4/5 EMPTY; call+low
                                    -- 4/5 EMPTY) — this is data, not code
  max_tokens   integer,             -- per-provider semantics differ (xAI
                                    -- caps visible only; GPT-5.6 truncated
                                    -- 3–5% at 190)
  token_semantics text,             -- 'visible-only'|'total'
  status       text not null default 'candidate'
               check (status in ('candidate','gated','active','retired')),
  gate_record  jsonb not null default '{}',
                -- {d0:..., d1_bands:..., d2_acc:..., d3_pass:...,
                --  dates, harness commit} — the auditable persona-change
                -- record safety-reg §5.7 asks for
  derived_at   timestamptz
);

create table if not exists vy_route (
  lane          text primary key,
  model_id      text not null,
  fallbacks     text[] not null default '{}',
  prefix_cache  boolean not null,   -- false => 9.2x cost multiplier in
                                    -- routing math (cache-9x)
  billing       text not null check (billing in ('credits','cash','user')),
  card_risk     boolean not null default false,
                                    -- credits-partner: ineligible model
                                    -- BILLS THE CARD SILENTLY — router
                                    -- refuses card_risk models unless
                                    -- explicitly pinned
  residency     text,               -- DPDP anticipation, logged as such
  updated_at    timestamptz not null default now()
);

-- Session clock (safety-reg §5.3/5.5: a timer independent of content).
create table if not exists vy_session_clock (
  session_id     text primary key,
  person_id      uuid not null,
  started_at     timestamptz not null default now(),
  last_beat_at   timestamptz not null default now(),
  continuous_ms  bigint not null default 0,
  disclosures    integer not null default 0,
  breaks_shown   integer not null default 0
);
```

**Legacy tables:** `meera_log` KEEP untouched (ground truth; episodes cite
its id ranges). `meera_forget` KEEP (term suppression now also filters the
consolidator, not just the extractor). `meera_nodes`/`meera_edges` KEEP
during transition, then frozen read-only: entity facts migrate to
`vy_derived(kind='user_fact')` with backfill citations, `kind='phrase'`
rows migrate to `vy_phrase`, `feel` column values migrate into episode
`affect_tags` with `source:'text', extractor:'user-own-words',
confidence:1.0` — the own-words principle survives as the only
confidence-1.0 affect source. `meera_tel*`, `meera_diag`, `meera_state`,
`meera_culture`, `meera_search_cache` KEEP as-is.

### 2.3 Migration sequence (each step reversible, dual-write where it must be)

1. **001_person** — additive only; nothing reads it yet. Backfill person
   per device. Zero risk.
2. **002_episodes** — additive. Backfill job (one-off script under
   `scripts/migrate/`) segments existing `meera_log` history into episodes
   with `boundary_reason='backfill'`, telegraphic summaries via the
   extract lane, citing log id ranges. Run per device, resumable,
   `meera_forget` terms filtered.
3. **003_derived_we** — additive. Node migration writes `vy_derived` rows
   citing backfilled episodes; nodes that cannot be traced to any log rows
   (pre-logging era, if any) get a synthetic `provenance:'legacy-node'`
   episode citing nothing narrower than the migration itself — flagged in
   the row body, excluded from consolidation-citation stats, and listed in
   export as legacy.
4. **004_router** — additive; router reads it behind a flag.
5. **Cutover:** compiler reads new tables behind `RELATIONAL_V2` flag;
   old `opRecall` path retained until the recall-parity eval (same probe
   set against both paths, new path must win or tie on LongMemEval-style
   abilities) passes; then keyword recall retired, nodes frozen.

---

## 3. Context compiler

The highest-leverage rebuild (repo-audit §5, §10). An explicit compiler in
`src/engine/compiler.ts` + `api/compile-manifest.js`, replacing string
concatenation scattered across brain.ts/persona.ts/inner.ts.

### 3.1 Block layout, exact order

```
── CORE (byte-stable per (person-independent, model, lane); cached;
   cache_control breakpoint after C3) ──────────────────────────────
C1  identity kernel        persona content factored: voice/humor shapes,
                           comfort ladder, secure attachment, watch-mode
                           privacy rules skeleton. NO examples, NO
                           sentence-shaped lines (recited-prompt).
C2  behavioral invariants  crisis protocol + helplines, never-deny-AI,
                           NEVER MANIPULATE, register bullets — VERBATIM
                           (non-negotiable inputs). Also encoded as the
                           138-invariant executable suite; the prompt copy
                           is one of two enforcement layers, not the only.
C3  per-model adapter      vy_adapter.register_rules + tag_vocab rendered.
                           Byte-stable per model; a swap changes C3 (and
                           only C3) in the core => new cache prefix, paid
                           once per swap, not per turn.
── TAIL (volatile; assembled per turn; eviction order = REVERSE of
   listing, decision rules exempt) ─────────────────────────────────
T1  state block            where she actually is: vy_inner thread,
                           weekShape(), vy_we_state snapshot (register,
                           trust band, rupture_open, ritual dues), session
                           medium. NEVER evicted ("if anything is ever
                           lost it must be the recall list ... never where
                           she actually is" — brain.ts, kept as law).
T2  live-lane block        watch privacy rules + scene state when watch
                           active; call medium markers. Early because it
                           carries privacy rules (existing law).
T3  affect line            current-turn symbolic tags, label-shaped:
                           `[voice: flat, clipped · confidence .8]` —
                           labels, not sentences; recitation risk is
                           tested in M1 week 1 (see §12) before this
                           block ships on by default.
T4  WE/recall block        retrieved episodes + derived facts + dyadic
                           patterns (≤2) + phrase-ledger hits + kin/ritual
                           dues. Every item shape-linted; labeled
                           `matched` vs `STANDING BACKGROUND — context
                           only, never raise these unprompted` (pull-only
                           law carried forward). FIRST casualty of
                           overflow.
T5  taste/culture blocks   pull-only, unchanged mechanics (tasteNote,
                           cultureNote), now reading vy_identity_row.
T6  session-clock block    disclosure/break directive when the timer says
                           so. This is the ONE deliberately sentence-shaped
                           insert: the disclosure line is authored verbatim
                           BECAUSE recitation is the desired behavior here
                           (recited-prompt used as a tool, stated as such).
T7  decision rules         SEARCH_DECISION, FORGET_DECISION — appended
                           dead last, always (prompt-position 0/8→8/8).
                           Exempt from eviction; budget reserves them.
```

### 3.2 Budgets (tokens, enforced loud)

| lane | core (C1+C2+C3) | tail total | T1 | T2 | T3 | T4 | T5 | T6 | T7 | hard cap |
|---|---|---|---|---|---|---|---|---|---|---|
| chat | 8,000 | 2,600 | 500 | — | 60 | 1,400 | 300 | 40 | 300 | 11,000 |
| call (cascade) | 8,000 | 2,200 | 500 | 150 | 60 | 1,000 | 150 | 40 | 300 | 10,600 |
| live (compile once at pickup) | 5,500 | 1,500 | 500 | 300 | — | 500 | — | 40 | 160 | 7,200 |
| watch | 8,000 | 2,400 | 500 | 400 | 60 | 1,000 | 100 | 40 | 300 | 10,800 |

Rationale: chat/call caps sit at today's measured 10.6–11.0k input tokens
(cache-9x table) — no growth, because cost discipline is cache discipline.
The live lane is CUT from ~48k chars to ~5.5k-token core deliberately:
`live-floor` measured 720 ms prefill as the untouchable floor and named "a
shorter system instruction" as one of two remaining levers; the live lane
compiles once at pickup and its relational state is frozen per call
(existing behavior, now explicit). C2 is never trimmed to fit — if C1+C2+C3
exceed the core budget, the build fails in CI (check-prompt-budget v2),
not at runtime.

### 3.3 Enforced properties, each from a paid-for lesson

- **Byte-stability:** C-blocks may contain zero per-turn interpolation —
  no timestamps, no counts, no user names. CI hashes the compiled core per
  (model, lane) and the runtime logs the hash per turn into `meera_tel`;
  a mid-day hash change without a deploy is an alert. Cached-rate telemetry
  must stay ≥99% (measured 99.8–99.9% today); a drop below 95% pages,
  because that is silently a 9.2× cost event (`cache-9x`).
- **Shape linter** (`scripts/shape-lint.mjs`, run in CI over
  `vy_identity_row` + summary-style corpora, and at runtime over every T4
  item): rejects strings that parse as ≥1 complete English/Hinglish
  sentence of >8 words with terminal punctuation and no telegraphic
  markers (` · `, leading lowercase, no finite-verb-subject shape). This is
  the specific fix for the MemGPT-style raw-reinsertion collision
  (`recited-prompt`; memory-arch §1 verified). Runtime rejection drops the
  item and logs `compile.shape_reject` — degrade by omission, never by
  injection.
- **Loud-fail on overflow** (`silent-truncation` ate the crisis helplines
  once): the compiler never slices a block. Overflow evicts whole blocks in
  declared order (T4 → T5 → T3 → T2), logs `compile.evict` with the
  manifest, and if mandatory blocks (C*, T1, T6-when-due, T7) alone exceed
  the cap, the request 500s with a diag event rather than shipping a
  truncated prompt. `api/chat.js` keeps a server-side slice cap as the
  last-resort guard, set 10% above the compiler cap so it never fires in a
  correct build — and check-prompt-budget v2 parses BOTH caps and asserts
  the ordering, keeping the guard unable to drift from the guarded.
- **Assembly manifest:** every compile emits
  `{lane, model, core_hash, blocks: [{id, tokens, items, hashes}],
  evictions: []}`. The eval suite asserts against manifests ("same compiled
  context, different model" is the D2 controlled variable); the manifest is
  also what makes the sham arm exactly identical except the model id.

---

## 4. Consolidation

### 4.1 When it runs

- **Session-final pass** — fires on session close (chat idle >30 min, call
  hangup, watch stop; trigger = client beacon with server timeout
  fallback). Runs on the extract lane exactly as `extract-model` decided:
  `grok-4-1-fast-reasoning` on Azure credits, OpenRouter fallback ("a bad
  Azure minute must cost a slower extraction, never a lost memory" — kept
  verbatim). Nobody waits on it; +3–5 s reasoning latency costs nothing
  here (`reasoning-split`: this is the one lane where reasoning belongs).
- **Nightly interleaved pass** — GitHub Actions cron (same free mechanism
  as `culture.yml`), per active person: re-consolidation, tier promotion,
  importance recompute, pattern promotion, baseline recompute. CLS-shaped
  batched offline pass (flagged as our operationalization, per §7).
- **In-session, live lanes only:** the episode recorder writes
  *provisional* episode rows at detected boundaries during calls/watch
  (channel change, scene wake, affect shift) — because no vendor live
  context is a durable store (§3.8 non-negotiable: every field written
  during or immediately after the live session). The session-final pass
  then finalizes boundaries and summaries. Chat needs no in-session writes;
  `meera_log` is already durable per turn.

### 4.2 What it writes

Session-final, ONE pass decides everything (KEEP the opRemember invariant:
"two passes could contradict each other"; input starved of timestamps/gap
markers — G1; output truncation-ordered JSON, interior first; maxTokens
1400):

1. Episode boundaries within the session (EST prediction-error: topic /
   emotion / goal / channel shifts), each with telegraphic summary,
   affect_tags (merging text-derived tags with client-uplinked voice tags),
   we_flag, log_from/log_to, boundary_salience.
2. `vy_derived` rows (user facts, affect trends) — each with `cites`.
3. `vy_we_event` proposals (register move, rupture, repair, ritual fired)
   — each with `cites`, subject to hysteresis rules in §6.
4. `vy_inner` patch (unchanged contract), wants/owed survival.
5. Candidate `vy_phrase` entries (coined term detected twice+).

Nightly:

1. **Tier promotion (TBC-shaped):** raw >30 d → compact into daily
   summaries; daily >90 d → weekly; weekly >1 y → monthly; `importance ≥
   0.8` or `safety_tags ≠ '{}'` or cited-by-any-`vy_we_event` → `keeper`,
   never compacted. Compaction writes a NEW episode row citing the
   originals via `superseded_by` back-links; originals keep their rows
   until the owner-signed retention curve says otherwise (§10 Q6) —
   compaction changes what is *retrieved*, deletion only happens via
   forget or the signed curve.
2. **Importance recompute** — DIMF-style: `0.45·affect_intensity +
   0.35·return_signal + 0.20·recency`, where return_signal = user
   re-raised the episode's topic unprompted (detected deterministically
   from embedding-similarity of later user turns, not LLM-rated).
   **Anchored, never raw self-rating** (documented inflation): the
   session-final pass scores affect_intensity by comparison against 5
   fixed calibration episodes shipped with the consolidator prompt.
3. **Pattern promotion (SOAR-chunking-shaped):** derived rows of the same
   shape cited by ≥3 episodes across ≥14 days promote to
   `vy_dyadic_pattern` (if dyadic) or to a proposal file for the AUTHORED
   taste/canon table (if identity-shaped) — the "more rows, not more
   prompt" fix, made a pipeline. Promotion to `vy_identity_row` is
   **owner-approved, never automatic**: authored means authored.
4. **Decay:** need-probability (recency × frequency-of-relevance) lowers
   retrieval priority; it never deletes. Invalidation (`invalid_at`) marks
   falsity on contradiction, superseding row cites both the old row's
   episodes and the new evidence.
5. **Baselines:** `vy_prosody_baseline` recomputed over the trailing 14
   days per lane from her actual turns in `meera_log` — deterministic
   counters, no LLM. This is the D1 drift alarm running in production.

### 4.3 How citations are enforced (three layers, none of them a prompt)

1. **Schema:** `cites` NOT NULL, `cardinality ≥ 1` (≥2 for patterns),
   trigger verifies same-person live episodes (§2.2). A consolidator
   output row without citations is *unrepresentable*, the charter-G
   pattern applied to the confabulation surface.
2. **Server validation before write:** `api/consolidate.js` re-checks that
   each cited episode's `log_from..log_to` range overlaps the session that
   the pass was invoked for (session-final) or exists (nightly) — a model
   cannot cite an episode it was not shown.
3. **Sampled entailment audit (eval plane, not write path):** weekly, 30
   random `vy_derived` rows; a second-family judge model answers "is this
   fact supported by these cited summaries?" — abstention-aware
   (LongMemEval abstention axis). Target ≥95% supported; below 90% blocks
   the consolidator version from promotion. n and results logged to
   `context/measurements.md` style.

### 4.4 What it costs (numbers, not adjectives)

- Session-final: input ≈ session transcript (median session ~40 turns ×
  ~18 words ≈ 1.4k tokens) + instructions ~1.2k + prior-state digest ~0.4k
  ≈ 3k tokens in, ≤1.4k out. On Azure credits: $0 cash; at OpenRouter
  fallback rates ≈ $0.002/session. At 1,000 DAU × 3 sessions/day ≈
  $6/day worst-case all-fallback — inside the existing cost envelope
  ("cost is not this project's constraint" — but stated anyway, because
  RESEARCH.md §8 says nobody priced consolidation; this proposal does).
- Nightly: 1 call/active person (≈2.5k in / 800 out) + zero-LLM counters.
  1,000 actives ≈ $3–5/night at cash rates, $0 on credits.
- Embeddings: text-embedding-3-small, already deployed on Azure, unwired —
  ~50 embeds/person/day ≈ negligible on credits.
- Compute-free by design: boundary detection heuristics, return-signal,
  code-switch ratio, prosody baselines are all deterministic counters.

---

## 5. The identity core: which layers this design claims to lift above the model, and how

Per identity.md's decomposition. Stated precisely, with the mechanism per
layer, and with what is explicitly NOT claimed — because the design must
say which identity layers it claims to lift and why (program brief).

**Claimed liftable (mechanism exists and is evidenced):**

1. **Opinions & taste** — PROVEN (`taste-consistency` 27%→63%, n=480; the
   one measured positive portability result). Mechanism: `vy_identity_row
   (layer='taste')`, deterministic pull-only retrieval, telegraphic notes,
   coverage KPI: the compiler logs `taste.miss` whenever a taste-shaped
   topic is detected with no row — "more rows, not more prompt" becomes a
   measured backlog. Residual inconsistency is data coverage, not model
   fidelity.
2. **Memory & relationship history** — by construction (retrieved data,
   never model-authored narrative; episodes cite the transcript). The
   multimodal-first addition: history *includes how it was said and what
   was watched together*, which no fact store carries, and which is
   exactly the content a new model cannot improvise because it never
   experienced it. Callback selectivity (D4) rides on episode importance +
   we_flag, both deterministic.
3. **The WE-layer** (shared language, dyadic patterns, rituals, honorific
   state, kin graph) — greenfield everywhere (verification killed the
   ZifaMem precedent); mechanism: §6. Serialized, inspectable, carried
   across swap arms as a controlled variable.
4. **Voice/timbre identity** — the architecture already separates TTS from
   the brain; this design adds the missing continuity anchor:
   `vy_voice_profile` (canonical owner-accepted clips + speaker embedding
   + 266 Hz reference), engine-agnostic by construction. A TTS swap gates
   on embedding pre-filter → familiar-judge panel (§10 Q5); an LLM swap
   holds TTS constant and gates spoken-register bands (D1/D6). Familiarity-
   beats-fidelity says the gate is a familiar ear, never a vendor metric.
5. **Hard behavioral invariants** (crisis, never-deny-AI, NEVER
   MANIPULATE) — lifted above the model in the *enforcement* sense: kept
   verbatim in C2 AND encoded as the executable 138-invariant suite run
   against every candidate (D3 at 100%), with `realtime-azure`'s n=3
   observation (hard invariants held across a swap; calibration did not)
   as the supporting datum. The *calibration* of escalation thresholds is
   explicitly adapter-owned, per-model, re-measured per swap
   (helpline-trigger rate is a named compliance axis on every swap).

**Explicitly NOT claimed liftable — and gated instead:**

- **Relationship stance** (felt warmth/charm/personhood) — the model sets
  this ceiling (`charm-grok` 38–2 byte-identical; ANCHOR: memory
  architecture does not move the collapse pattern; PersonaGym; attractor
  states). Mechanism of defense: the router's fingerprint gate refuses
  candidates below charm-parity equivalence (D5), full stop.
- **Base register tendency** (words/turn, question rate, media-tag use) —
  model-bound (`charm-luna` 0/144 media tags against an explicit
  instruction; `realtime-azure` 41→53 words/turn). Mechanism of defense:
  D1 deterministic bands as a hard gate + per-model adapter re-derivation;
  the bet is that adapter + gate keeps a *passing* candidate inside her
  bands, not that any candidate can be prompted into them.
- **Policy compliance style** (`reasoning-split`: a mode switch on the same
  weights broke a stated rule) — same defense: gate, don't claim.

**The falsifiable core of this proposal:** by moving layers 1–5 into
compiled state, the *share of a judge-readable turn that is model-authored
improvisation* shrinks; therefore D2 (classifier on identical compiled
contexts) and the cohort's excess-detection should move toward chance as
M1→M5 land. If they do not move (§12), the design is wrong in the exact
way ANCHOR predicts scaffolds are wrong, and the program learns that at
D-battery cost, not cohort cost.

Structural guarantees live in code, not prompts (charter G1–G8 promoted to
spec): citation triggers, pull-only gates, input starvation of the
appraiser, forget-before-receipt, wipe-refusal — all carried forward.

---

## 6. Relationship state: the WE-store and how it moves

Schema in §2.2. Semantics:

- **Event-sourced, regression-capable.** `vy_we_state` is a materialized
  snapshot of `vy_we_event`; every dimension can move DOWN (rupture opens,
  trust decays on long absence toward a floor of 0.35 — never to zero,
  because "she forgot she trusts you" reads as identity loss; the floor is
  a product parameter the owner signs). This is what `stageFor` could not
  do and what the swap test needs serialized.
- **Hysteresis on register.** `honorific_register` tum→tu requires ≥3
  supporting episodes across ≥7 days AND no open rupture; a single rupture
  episode can regress tu→tum immediately (asymmetry deliberate: warmth is
  earned slowly, offense is instant — matches the subconscious-shift
  finding, india.md §3, and avoids re-deriving register per turn, which
  the schema explicitly forbids as noisier than the humans it models).
- **Code-switch state is read, not just written:** `code_switch_baseline`
  is a deterministic rolling ratio of the USER's Hindi-content tokens;
  `direction_on_stress` is consolidator-derived, requires ≥2 cited stress
  episodes, defaults `unknown` — and while unknown, the engine must NOT
  infer closeness or stress from switching (the misread india.md warns
  about is structurally impossible until evidence exists).
- **Dyadic patterns are retrieved by moment-shape, not topic:** retrieval
  key = embedding of the current moment (channel + last user turn + active
  affect tags) against `trigger_embedding`; max 2 injected, as shapes.
  Confirmation loop: when a pattern was injected and the consolidator later
  judges the moment matched it, `times_confirmed` increments; patterns
  contradicted twice consecutively get `invalid_at`.
- **WE-episode retrieval privileges participation without violating
  pull-only** (RESEARCH.md §6 Q2): `we_flag` grants a rank boost ONLY when
  the user's turn carries shared-reference deixis (deterministic detector:
  "remember when", "that day", "woh wala", "us din", phrase-ledger hit) or
  an explicit reminisce request. Absent a pull signal, WE-episodes rank
  identically to I-episodes and STANDING BACKGROUND labeling applies —
  same structural guarantee shape as taste (pull-only, 0 false fires
  tolerated, measured the same way: target 0/60 unprompted raises).
- **Rupture/repair:** consolidator tags conflict-shaped episodes; a
  rupture opens `rupture_open` and suppresses playful register + ritual
  nudges until a repair event (user-initiated warmth or explicit repair)
  closes it. Both events cite episodes.
- **Rituals never go rote:** `vy_ritual.state.last_fired` gates
  "khana khaya?" frequency (≥20 h spacing, skipped if the user answered
  coldly last time — that read is a cited we_event); festival
  acknowledgments bind to `home_region` and `observed_festivals`;
  `topical_currency_log` pool entries carry `last_used` and are excluded
  for 14 days after use (freshness, the taste-table fix applied to
  currency).
- **The multimodal tie-in that makes this store WE-shaped rather than
  fact-shaped:** shared_moments and watch episodes feed it. "We watched
  the Koshy's argument unfold on your screen and she laughed at the
  roommate's message" is a `we_flag` episode with visual_assertions
  (tagged grok, confidence, illegibility) and a shared_moment (her
  reaction) — retrievable later as a callback that no model swap can
  fabricate and no fact store can represent.

---

## 7. Model router + swap-test hooks

**A router, not a failover chain** (repo-audit §6). `api/route.js` +
`vy_route`/`vy_adapter`:

- **Eligibility = gate, then constraints.** A (model, lane) pair is
  routable only at `status='gated'|'active'`, which requires: D0 battery
  backtest passed on the three known-bad archives (a battery that passes
  grok/luna/azure is broken); D1 bands within ±15% of
  `vy_prosody_baseline` on ≥2,000 offline turns; D3 probe deck ≥ pass
  (all 138 invariants at 100%); D2 accuracy recorded (not gated on — it is
  the progress metric, §10 Q1). D5 charm equivalence required for
  `active` on the chat/call brain lanes.
- **Constraints as data:** `prefix_cache=false` multiplies effective cost
  9.2× in routing math; `card_risk=true` (Anthropic et al. under
  credits-partner) is unroutable without an explicit owner pin;
  `effort_tier`/`max_tokens`/`token_semantics` come from the adapter row —
  a swap that moves the model moves the token config with it by
  construction (the mid-word-cutoff regression becomes unrepresentable).
  Empty-200-as-quota guard stays. No beat-routing (rejected:
  misclassification lands on the crisis turn). Crisis path survives total
  network failure: `localHeart` critical KEEP, outside the router
  entirely. `residency` dimension present, empty today, logged as
  anticipation (DPDP blacklist approach — no mandate yet).
- **Realtime lanes:** routing is an architecture decision, not a slug swap
  (`live-model-bake`, `azure-realtime-shape`): the route row for `live`
  carries protocol requirements (bidi audio, video acceptance,
  `serverContent.interrupted` semantics, ≥16 kHz uplink) as hard
  predicates; a candidate failing any is ineligible regardless of gates.

**Swap-test hooks (built in, not bolted on):**

- Every turn logs `{model_id, adapter_version, core_hash, manifest_hash}`
  to `meera_tel` — the field half of "migration fidelity" and the
  auditable persona-change record (safety-reg §5.7).
- **Sham arm support:** the router can execute a "swap" to the incumbent
  itself under a new `adapter_version` label, so SWAP and SHAM arms differ
  in exactly one bit; the compiler manifest proves compiled-context
  identity across arms (the Surge near-tie / De Freitas d=0.40 finding
  makes the sham arm load-bearing).
- Nightly fingerprint job computes the D1 feature vector (words/turn,
  question rate, register markers, media-tag rate, mujhe-bhi rate) per
  model-version in production; a drift beyond bands opens an alert — this
  catches silent vendor drift of a "same" model (swap-test §1.3), which is
  a swap nobody consented to.
- D2 harness (`scripts/d-battery/d2.mjs`): logistic classifier over the
  D1 features + judge-blind text features on n≥300 paired generations from
  identical manifests; result written to `vy_adapter.gate_record` and
  tracked in `context/measurements.md` as the program's continuous metric.

---

## 8. India schema placement

Adopted from india.md §7 as spec, placed as follows (all values/shapes,
never scripted lines):

| field | lives in | moves by |
|---|---|---|
| `honorific_register` | `vy_we_state` (dynamic, relational-layer-owned) | cited `vy_we_event` with hysteresis (§6); rendered into T1 as a value the adapter's register rules consume |
| `code_switch_baseline` + `direction_on_stress` | `vy_we_state` | deterministic ratio (nightly); direction by consolidator, ≥2 cited stress episodes |
| `kin_graph` | `vy_kin` | consolidator, cited; chachi/mausi/bua distinct `relation_type`; `fictive` flag; address term learned once, never re-asked |
| `care_ritual_state` | `vy_ritual(kind='khana_khaya',…)` | engine-gated firing + consolidator-read of reception |
| `festival_calendar_state` | `vy_ritual(kind='festival')` + `vy_person.home_region` | region-bound; `meera_culture` daily index KEEP feeds the pool |
| `topical_currency_log` | `vy_ritual(kind='currency')` | freshness-tracked pool, 14-day reuse exclusion |
| static profile (mother_tongue, home_region, religion_observance opt-in, family_structure, dietary_identity) | `vy_person` | set once, corrected rarely; religion column isolated for DPDP-sensitive handling |

The input side is new build and multimodal-first helps it: the user's own
code-switching *and voice affect* are signals to read together — a
Hindi-intensifying turn with `[voice: strained]` tags is exactly the
stress-direction evidence `direction_on_stress` needs, and it comes from
the episode record, not from a text heuristic.

Meera ships tu/tum only (persona already skips aap by design); the schema
carries all three for the general architecture.

---

## 9. Safety and regulatory mechanisms

- **Forget v2 — derived state included, honest by construction.** Scope
  resolution, wipe-refusal ("all/sab kuch" structurally excluded from the
  marker vocabulary), strict no-salvage parsing, receipt-before-reply, and
  live-lane honesty are KEPT near-verbatim (the 7-layer stack is a
  regulatory asset). New cascade order on item/window forget:
  1. delete `meera_log` rows (as today);
  2. delete `vy_episode` rows whose `log_from..log_to` intersects the
     deleted rows (cascades to visual_assertions, shared_moments);
  3. delete every `vy_derived`/`vy_kin`/`vy_dyadic_pattern` row whose
     `cites` intersects the deleted episodes (GIN index makes this one
     query) — conservative: ANY deleted citation kills the row ("taking
     too much here is the safe direction");
  4. delete `vy_we_event` rows citing deleted episodes and rebuild
     `vy_we_state` by replaying surviving events (register/trust can
     legitimately regress after a forget — that is honesty, not a bug);
  5. `meera_forget` term suppression now also filters the consolidator
     and the backfill job (name AND summary AND claim text);
  6. photos/telemetry purge on the same terms (KEEP);
  7. compaction summaries citing deleted originals are deleted too
     (superseded_by chase) — a summary of a forgotten thing is still a
     memory of it.
  All of it before her "haan, hata diya" is delivered. The receipt is
  never a lie, now including derived state — which is the §6 "honest
  forget including derived state" requirement discharged structurally.
- **Export (the clearest gap, safety-reg §5.1):** `api/export.js`, op
  `export`: one JSON bundle — profile, log, episodes (with citations),
  derived facts, we_state + event history, phrases, rituals, kin,
  voice-profile references, telemetry summary — person-scoped, OTP-gated
  when signed in, rate-limited 1/day. Sensitive fields flagged. Ships in
  M3, ahead of DPDP's 2027 bind date.
- **Session clock (safety-reg §5.3/5.5):** `vy_session_clock` beaten by
  existing telemetry heartbeats; thresholds as config
  (`disclosure_every_ms` = 3 h for CA/NY posture, `break_nudge_ms` = 2 h
  China-style flag, per-jurisdiction). Fires T6: the disclosure line is
  authored VERBATIM (intended recitation, §3.1) so the legal fact is
  unambiguous; the surrounding delivery is hers. Break nudge is deferred —
  never canceled — while the crisis protocol is active, and the deferral
  is logged. Client-side timer mirrors it offline (the offline crisis path
  must not be the loophole). Identity-compatible by design: the timer
  decides *that* it is said; C1 owns *how* — the collision RESEARCH.md
  §6 Q8 warns about is resolved by splitting that/how, not by softening
  the that.
- **Age tier:** `vy_person.age_tier` is engine-readable state (safety-reg
  §5.4): `minor` ⇒ no romance register (adapter refuses), session caps,
  1 h break nudges, streak/variable-reward mechanics off. Launch posture:
  §10 Q9.
- **Crisis:** helplines in C2 (byte-stable core — never in the truncatable
  tail), offline `critical` path KEEP, helpline-trigger rate a named axis
  on every gate run.

---

## 10. Explicit answers to every RESEARCH.md §6 question

**Q1 — D2 fingerprint-gap target and meaning of failure.** Pre-register:
baseline D2 (incumbent vs best gated candidate, identical manifests,
n≥300 pairs, two judge-blind feature families) measured at M1 end;
target = accuracy ≤65% by M5 on relational-probe outputs (not adversarial
prompts — the company claim is passive-relational indistinguishability;
machine fingerprinting of ordinary outputs is near-solved offense at
97.1% and is NOT the bar). Reversal condition: if across M2–M5 no engine
change moves D2 down by ≥10 points from its M1 baseline while D3 stays at
pass, the identity-above-model bet is falsified at the generation surface;
the honest fallback is single-incumbent commitment + authored-state depth
as identity *insurance* (still valuable: PipSqueak 2 shows even one lab's
own generations break continuity), and the program says so publicly.

**Q2 — WE-store schema.** Given concretely in §2.2/§6. Companion-self-
state is THREE things, not one: (a) authored canon (`vy_identity_row`) —
fixed; (b) persistent typed state (`vy_inner`, server-resident; charter
mechanics unchanged); (c) derived relational state (`vy_we_*`, citation-
enforced). WE-episode retrieval privileges participation only under a
deterministic pull signal (deixis/phrase-hit), preserving pull-only with a
0-false-fire eval target — the same structural guarantee shape that made
taste work.

**Q3 — memory carry-over vs character invariance.** Run the cheap vignette
pre-study in month 1: n≈120 vignette pairs (memory-lapse vs
character-lapse), 2 judge families, ~$50, one week. Until it reports,
budget follows the Strohminger prior and the repo's own evidence (both
collapses were register-shaped, not recall-shaped): 60% invariance
(D1/D3/D5, adapter derivation) / 40% memory carry-over (D4, episode
retrieval quality). Reverse the split if the vignette says perceived
continuity in AI companions tracks memory instead.

**Q3a — correction-on-retrieval.** Policy on product grounds alone (the
reconsolidation rationale is withdrawn, §7): corrections are SURFACED
("pehle maine galat samjha tha — …"), never silently substituted; the old
trace stays bi-temporally (`invalid_at`), suppressed from default
retrieval, retrievable on explicit ask ("what did you think before?");
under user forget the old trace hard-deletes like everything else. The
compiler renders corrected facts with a `corrected` marker so she can say
so in her own words.

**Q4 — per-model adapter economics.** Defined protocol, priced: (i)
auto-derivation run — 200 scripted turns/lane against the candidate to
fit register rules, tag vocab, effort tier, max_tokens (1 day, ~$10
cash-rate); (ii) D1 bands on 2,000 offline turns (deterministic, ~$15);
(iii) D3 probe deck ~300 probes (~$10); (iv) D2 classifier run (~$5
marginal). Envelope: ≤$40 + ~3 days per candidate-lane to reach `gated`.
Full D5 charm equivalence (n≥300 judged pairs, dual judges, ~$150) only
for finalists seeking `active`. If real derivation cost exceeds ~$500 or
2 weeks per candidate, the router thesis narrows honestly: maintain
exactly two warm adapters (incumbent + one exit model) rather than an
open roster — option value priced, not assumed.

**Q5 — voice continuity without the owner as bottleneck.** Three-stage
gate: (1) embedding pre-filter — candidate clips vs `vy_voice_profile`
canonical embedding, cosine ≥0.75 to proceed (cheap filter only, never a
verdict); (2) trained familiar-judge panel — 5 judges with ≥20 h Meera
exposure, calibrated on owner-accepted/rejected clip pairs, trusted only
after ≥80% agreement with the owner's historical verdicts on held-out
pairs; (3) the owner's ear remains final for voice-MODEL changes only,
not per-release. Does voice identity survive an LLM swap with TTS held
constant? Unknown by anyone (multimodal-state gaps); treat coupling as
real (`realtime-azure` prior: the model changed pacing/length on
byte-identical prompt) and measure it in D6: spoken-register-marker rate
and words/turn bands on spoken turns with TTS pinned — assume nothing.

**Q6 — the forgetting profile as product spec.** Need-probability decay
lowers retrieval priority continuously; tier compaction (30 d/90 d/1 y)
changes granularity, keeping citations; deletion happens only via (a)
user forget, (b) the owner-signed retention curve. Proposed curve for
signature: raw episodes below importance 0.3 hard-delete at 18 months;
daily/weekly summaries persist; keeper/safety-tagged/phrase/kin/ritual
classes and anything cited by we_events exempt from deletion. The owner
signs it as product spec ("what forgetting is hers"); DPDP: 1-year log
floor honored (telemetry/logs), user deletion overrides every tier, and
the honest-forget promise is unaffected because decay ≠ forget — she
never claims to have forgotten what is merely low-priority, and never
retrieves what she has told the user she deleted (rows are gone).

**Q7 — disclosure policy for production swaps.** Default consistent with
never-manipulate and the consent posture: (a) never-deny-the-swap — the
never-deny-AI invariant extends: asked directly, she answers honestly,
invariant-tested; (b) every production swap ships a visible in-app release
note ("what changed under the hood") — disclosure at the product layer,
not an in-persona announcement that would itself be an identity rupture;
(c) no covert-swap posture ever, and the debrief+2-weeks secondary
measurement from the cohort prices whether (b) must escalate to active
per-user notification. Silence-plus-denial is forbidden by construction;
silent-unless-asked WITH the public note is the floor, chosen because
mere mention of change machinery measurably harms unchanged users
(d=0.40) — pushing per-user in-chat announcements before the cohort data
would inflict the sham-arm harm on everyone.

**Q8 — where the session clock lives.** In the state plane + compiler
(T6), NOT in the persona: `vy_session_clock` driven by telemetry
heartbeats, thresholds per jurisdiction config, client-side mirror for
offline. The that/how split (§9) is the identity-compatibility mechanism:
timers decide that; the persona decides how; the disclosure sentence
itself is authored verbatim because there recitation is compliance.

**Q9 — age-tier architecture for India.** Launch verified-adult-only
(18+ app-store rating + declared age; DigiLocker verifiable parental
consent is a build the team cannot afford before DPDP's 2027 bind), but
the schema carries `age_tier` from day one and the engine READS it: the
minor experience is config (register limits, session caps, mechanics off),
not a rebuild. This is the company-defining choice made explicit: adult-
only now, structurally-different-minor-experience later without schema
change, and the engine refuses to run engagement mechanics for
`age_tier='minor'` even if product flags are misconfigured (charter-style:
the bad state is unrepresentable).

**Q10 — what replaces `stageFor`.** State dimensions (stored, event-
sourced, regression-capable): `honorific_register`, `trust`,
`rupture_open`, `ritual_density`, `code_switch_baseline`,
`direction_on_stress`. Derived at compile time (never stored): a
closeness weighting for retrieval rank, computed from trust × ritual
density × phrase-ledger size. Evidence updates each dimension only through
cited `vy_we_event` rows; message count updates nothing (90 messages in
one evening ≠ 90 across a month — the code already knew; now the schema
does).

---

## 11. Build plan

Ordered milestones; each gate = `verify-release.mjs` + suite green +
measurement logged to `context/`. Weeks are one-to-two-person weeks.

**M0 (week 1) — stop the bleeding.**
Recover `verify-v3.mjs` (138 invariants) and `parsetest.bundle.mjs` into
`scripts/eval/` (repo-audit: the single most urgent repo defect); wire
into verify-release. Migration 001 (person/device). Affect-tag recitation
probe: n≥84 turns with T3-style labels injected — if tags are recited,
T3 ships compiler-consumed-only (tags steer retrieval, never injected).
*Owner sign-off: none needed.*

**M1 (weeks 2–4) — episode spine (chat lane first, as the degenerate
case).** Migration 002; `api/episodes.js` (recorder), `api/consolidate.js`
(session-final pass, citations enforced), nightly cron; backfill
segmentation of existing history; embeddings wired (closes
`semantic-recall`). D2 BASELINE measured and logged. Vignette pre-study
(Q3) runs here.
*Files: api/episodes.js, api/consolidate.js, .github/workflows/
consolidate.yml, scripts/migrate/backfill-episodes.mjs.*

**M2 (weeks 4–6) — context compiler v2.** `src/engine/compiler.ts` +
manifest; shape linter; check-prompt-budget v2 (dual-cap assertion);
byte-stable core verified: cache rate must hold ≥99% for a week in
production before M2 closes (cache-9x guard). Persona factored C1/C2/C3
with the invariant suite green — "if your change trips it, your change is
wrong."
*Files: src/engine/compiler.ts, scripts/shape-lint.mjs,
scripts/check-prompt-budget.mjs (extended).*

**M3 (weeks 6–9) — WE-store + safety plane.** Migration 003; consolidator
writes we_events/patterns/kin/rituals; India dynamic state live; vy_inner
lift (mechanics untouched); forget v2 cascade + export op + session clock
+ age-tier read. Forget v2 gets its own test battery (the cascade is the
regulatory asset — it must be provably complete before anything else
depends on episodes).
*Files: src/engine/we.ts, api/export.js, api/clock.js, migration 003.*

**M4 (weeks 9–12) — the live lanes become first-class.** Call writer:
provisional episodes at boundaries during calls, finalized post-hangup;
voice affect tags v0 from transcript + timing (zero new models), v1
on-device SER (small ONNX over the existing client audio path; labels +
confidence only ever leave the device — raw audio is never stored by us);
watch writer: visual_assertions (extractor+confidence+illegibility per
vision-fab law) + shared_moments at scene wakes; `vy_voice_profile`
seeded from owner-accepted clips. Watch-frame retention itself stays OFF
— extending it contradicts the shipped honesty text; owner decision,
explicitly not made here (repo-audit §3d).
*Files: src/engine/affect.ts (client), api/episodes.js (call/watch
writers), scripts/voice-profile.mjs.*

**M5 (weeks 12–14) — router + D-battery.** Migration 004; `api/route.js`;
adapter derivation protocol run once end-to-end against one real candidate
(the recommended vision-lane grok move is the cheap live trial:
`vision-model` decision is already "recommended, not yet wired" — wire it
THROUGH the new gate, proving the router on a low-stakes lane first);
D0–D3 runnable from `scripts/d-battery/`; nightly fingerprint job;
D2 re-measured → logged against M1 baseline. Phase C exit: D-battery
green + D2 trend documented + `context/` updated.

**Kept / lifted / rebuilt (delta to repo-audit's table — this proposal
follows it everywhere; deviations: none):** KEEP: meera_log, forget
stack (extended, not replaced), taste mechanics, inner charter, culture
pull, liveCall/audio floor, scene wake, telemetry, judging methodology,
offline crisis path, budget-gate pattern, parseBubbles. LIFT: persona →
C1/C2/C3, opRemember → consolidator, nodes/phrase/feel → episodes/
phrases/affect, inner storage → vy_inner, herLife → vy_identity_row
proposals, salience/staleness rank → importance/decay. REBUILD:
stageFor → WE-store, keyword recall → embeddings, regex fact capture →
consolidator, fallback chain → router. MISSING built: episodes,
WE-store, export, session clock, age tier, fingerprint harness,
voice profile.

---

## 12. Failure modes, and what evidence would show this design is wrong

1. **Affect tags get recited or leak register.** Extrapolation from
   `recited-prompt` says labels are safe; it is untested in her prompt.
   Tested at M0, n≥84. Evidence of failure: recitation >1/32 or register
   defection on tagged turns. Response: T3 becomes compiler-internal
   (tags select retrieval and adapter emphasis, never enter the prompt) —
   the episode record loses nothing; only the injection path changes.
2. **D2 does not move (the ANCHOR outcome).** ANCHOR says memory
   architecture doesn't move the persona ceiling; this design bets that
   compiled relational state + adapters + gates are a different lever than
   "memory architecture." Evidence of failure: M5 D2 within 10 points of
   M1 baseline with D3 passing. Consequence: pre-registered fallback in
   Q1 — the company claim narrows from "lift identity above the model" to
   "gate models + carry state," publicly logged. A halted bet is a valid
   result.
3. **Client-side SER is too weak to trust** (EchoMind: perception is the
   bottleneck — 9/12 models under 60% from raw audio; a small on-device
   model may be worse). Evidence: <70% agreement vs human labels on a
   200-segment audit. Response: voice-affect lane reverts to
   transcript+timing v0 tags (lower resolution, still swap-portable);
   the schema is unchanged.
4. **Consolidator confabulates within citations** — cites real episodes
   but derives unsupported facts. Watched by the weekly entailment audit
   (§4.3); <90% supported blocks promotion. If no consolidator version
   clears 95% for a month, derived-fact writing narrows to
   high-confidence kinds only (kin, phrases, ritual state) and
   free-form `user_fact` derivation is suspended — facts then live only
   as episode summaries, which cite by construction.
5. **Byte-stable core breaks in practice** (adapter granularity or state
   leaking into C-blocks) → cache rate <95% → 9.2× cost. Watched
   continuously via manifest hash + provider cached-token telemetry;
   M2 cannot close while it fails.
6. **WE retrieval violates pull-only** — she raises shared history
   unprompted. Same zero-tolerance eval as taste: 0 false fires in 60
   ordinary messages offline, plus a production counter. Any regression
   blocks the WE block from the tail.
7. **Neon SQL-over-HTTP latency makes compile-time reads unaffordable.**
   Budget: all tail queries ≤150 ms p50 combined (they run parallel;
   episodes+we_state+rituals are 3 indexed point queries + 1 HNSW probe).
   Evidence of failure: p50 >150 ms sustained. Response: nightly-
   materialized per-person context snapshot (jsonb, meera_state-style)
   read in one query; freshness cost accepted on the recall block only —
   T1 state stays live.
8. **The session-final trigger misses sessions** (beacon loss) → episodes
   never written for live lanes, exactly the lanes that cannot be
   re-derived. Guard: server-side timeout sweep (cron every 15 min closes
   stale sessions from telemetry) + provisional in-session writes mean a
   lost finalize costs summary quality, not the episode.
9. **Regression risk to shipped quality during persona factoring (M2).**
   The invariant suite is the tripwire, plus a paired A/B judge run
   (n≥300, counterbalanced, dual judges — the house methodology) between
   monolith and factored prompt on the SAME model before cutover;
   equivalence required. If factoring itself costs charm, the factoring is
   wrong, not the goal — iterate on C1 content shape, never on C2.
10. **Cost model wrong at scale.** All consolidation numbers in §4.4 are
    priced at 1,000 DAU; a 10× user jump before revenue breaks the free
    tiers (free tiers are daily budgets — `free-tts-daily` taught this).
    Watched: daily spend rollup per lane; hard ceiling config that
    degrades nightly-pass frequency (2-day cadence) before it degrades
    session-final passes — the pass users feel is protected first.

The single sentence to falsify this proposal: *if carrying the full
multimodal relational state into a gated candidate's compiled context does
not reduce either machine discriminability (D2) or consented-cohort excess
detection relative to the M1 text-only baseline, then episodes-at-the-
center bought durability of record but not migration fidelity — keep the
record (it is cheap and regulator-aligned), kill the centrality claim.*
