-- Migration 004 — India state, embeddings, audits (SPEC.md §2.5).
--
-- Idempotent, additive only, one statement per request (see 001 header).
-- Storage math (§2.5): embeddings dominate — embed episodes and facts only,
-- delete embeddings of tier-compacted episodes. Neon free tier ≈ ~30
-- user-years; named successor Neon Launch at cohort start.

-- India tables ALL carry citations (fixes C's waived-law flaw).
create table if not exists vy_kin (
  id           bigint generated always as identity primary key,
  person_id    uuid not null,
  name         text not null,
  relation     text not null,        -- chachi/mausi/bua role-labeled
  fictive      boolean not null default false,
  address_term text not null default '',
  citations    bigint[] not null,
  updated_at   timestamptz not null default now(),
  constraint vy_kin_cited check (cardinality(citations) >= 1)
);

create unique index if not exists vy_kin_ix on vy_kin (person_id, lower(name));

create index if not exists vy_kin_cit_ix on vy_kin using gin (citations);

create table if not exists vy_ritual (
  person_id  uuid not null,
  key        text not null,           -- khana_khaya|good_morning|match_checkin
  last_at    timestamptz,             -- freshness = data, not prompt pleading
  count      integer not null default 0,
  cold_last  boolean not null default false,  -- reception read, cited event
  citations  bigint[] not null default '{}',  -- establishing episodes
  primary key (person_id, key)
);

create table if not exists vy_currency (
  person_id uuid not null,
  topic     text not null,
  kind      text not null,            -- cricket|food|place|film|festival
  last_used timestamptz,              -- 14-day reuse exclusion (freshness)
  uses      integer not null default 0,
  citations bigint[] not null default '{}',
  primary key (person_id, topic)
);

create table if not exists vy_india_profile (
  person_id        uuid primary key,
  mother_tongue    text,
  home_region      text,
  religion         jsonb,             -- OPT-IN ONLY; DPDP-sensitive
  family_structure jsonb,
  dietary          text,
  sensitive_consent jsonb not null default '{}'::jsonb,  -- per-field receipts
  updated_at       timestamptz not null default now()
);

-- Embeddings: halfvec + person-filtered EXACT SCAN (§0.3). No HNSW.
create extension if not exists vector;

create table if not exists vy_embedding (
  owner_kind text not null check (owner_kind in ('episode','fact','pattern')),
  owner_id   bigint not null,
  person_id  uuid not null,
  v          halfvec(1536) not null,  -- text-embedding-3-small: deployed on
                                      -- Azure, unwired — this wires it and
                                      -- closes `semantic-recall`
  at         timestamptz not null default now(),
  primary key (owner_kind, owner_id)
);

create index if not exists vy_embedding_person_ix
  on vy_embedding (person_id, owner_kind);

-- Derivation audit (B): the FTC 6(b) record and the consolidation
-- bookkeeping are the same table.
create table if not exists vy_derivation (
  id           bigint generated always as identity primary key,
  person_id    uuid not null,
  model        text not null,
  prompt_hash  text not null,
  input_from   bigint not null,       -- meera_log id span the run may cite
  input_to     bigint not null,       -- episodes must map inside this window
  wrote        jsonb not null,        -- [{table,id}]
  audit_status text not null default 'unaudited'
               check (audit_status in ('unaudited','entailed','refuted')),
  at           timestamptz not null default now()
);
