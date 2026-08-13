-- Migration 003 — WE-store and rel-state (SPEC.md §2.4).
--
-- Idempotent, additive only, one statement per request (see 001 header).

-- Every rel-state movement is a cited event; the snapshot is a cache
-- REBUILT BY REPLAY after any forget (fixes B's flagship hole, per D).
create table if not exists vy_rel_event (
  id         bigint generated always as identity primary key,
  person_id  uuid not null,
  dim        text not null,
             -- honorific|trust|rupture|repair|ritual|code_switch|pacing
  from_v     text,
  to_v       text not null,
  direction  text not null check (direction in ('advance','regress','reset','init')),
  note       text not null default '',   -- telegraphic why, never a line
  citations  bigint[] not null,
  at         timestamptz not null default now(),
  constraint vy_rel_event_cited check (cardinality(citations) >= 1)
);

create index if not exists vy_rel_event_person_ix on vy_rel_event (person_id, at desc);

create index if not exists vy_rel_event_cit_ix on vy_rel_event using gin (citations);

create table if not exists vy_rel_state (      -- materialized snapshot (cache)
  person_id     uuid primary key,
  honorific     text not null default 'tum'
                check (honorific in ('tu','tum','aap')),
  cs_ratio      real,
  cs_on_stress  text not null default 'unknown'
                check (cs_on_stress in ('retreat_l2','intensify_l1','unknown')),
  trust         real not null default 0.3,     -- ±0.05/day rate limit IN CODE
  rupture_open  boolean not null default false,
  repair_state  text not null default 'none'
                check (repair_state in ('none','open','repairing','repaired')),
  ritual_density real not null default 0,      -- derived, SQL only
  pacing_gap_s  integer,                       -- derived, SQL only
  snapshot_ver  integer not null default 0,    -- bumps ONLY at consolidation
  updated_at    timestamptz not null default now()
);

-- Dyadic if-then patterns (Baldwin). Promotion is a stored threshold,
-- never an LLM score (importance-inflation made unrepresentable).
create table if not exists vy_pattern (
  id               bigint generated always as identity primary key,
  person_id        uuid not null,
  moment           text not null,
        -- conflict|vulnerable|silence|teasing|stress|planning|celebration|boredom
  if_shape         text not null,   -- telegraphic, shape-linted
  then_note        text not null,   -- telegraphic guidance, never a line
  self_in_relation text not null default '',
        -- Bowlby IWM: who SHE is in this moment with THIS person — a COLUMN
        -- of the pattern, so it cannot exist without interaction evidence
  citations        bigint[] not null,
  support_count    integer not null default 0,
  distinct_days    integer not null default 0,
  prompt_eligible  boolean generated always as
                   (support_count >= 3 and distinct_days >= 2) stored,
  times_contradicted integer not null default 0,
  t_invalid        timestamptz,
  last_used        timestamptz,
  created_at       timestamptz not null default now(),
  constraint vy_pattern_needs_two check (cardinality(citations) >= 2)
             -- one instance is an anecdote (Generative-Agents failure)
);

create index if not exists vy_pattern_person_ix
  on vy_pattern (person_id, moment) where t_invalid is null;

create index if not exists vy_pattern_cit_ix on vy_pattern using gin (citations);

-- Shared-language ledger. THE one class where verbatim storage is the
-- point: it is THEIR line, not a line written for her (argued recited-
-- prompt exception, from D).
create table if not exists vy_phrase (
  id             bigint generated always as identity primary key,
  person_id      uuid not null,
  phrase         text not null,
  gloss          text not null default '',
  feel           text not null default '',   -- own words only
  origin_episode bigint,                     -- coining episode (edge, no FK)
  coined_at      timestamptz not null default now(),
  last_used      timestamptz,
  uses           integer not null default 1
);

create unique index if not exists vy_phrase_ix
  on vy_phrase (person_id, lower(phrase));
