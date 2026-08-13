-- Migration 005 — router, gate audit, session clock (SPEC.md §2.6).
--
-- Idempotent, additive only, one statement per request (see 001 header).
-- vy_model and vy_gate_run are NOT user data (no person_id): they are the
-- router roster and the append-only FTC 6(b) audit — outside forget/export.
-- vy_session IS person-keyed and inside both.

create table if not exists vy_model (
  model             text primary key,
  provider          text not null,
  billing           text not null check (billing in ('credits','cash','user')),
  card_risk         boolean not null default false,  -- credits-partner trap
  prefix_cache      boolean not null,                -- cache-9x as data
  residency         text not null default 'us',      -- DPDP anticipation
  max_tokens_mode   text not null,                   -- visible_only|total
  effort_map        jsonb not null default '{}'::jsonb,  -- measured inversion
  adapter           jsonb not null default '{}'::jsonb,
  adapter_derived_at timestamptz,
  gate              text not null default 'untested'
                    check (gate in ('untested','failed','passed'))
);

create table if not exists vy_gate_run (   -- append-only audit (FTC 6(b))
  id      bigint generated always as identity primary key,
  model   text not null,
  battery text not null,                   -- D0..D6 | adapter-derivation
  n       integer not null,
  result  jsonb not null,
  passed  boolean not null,
  at      timestamptz not null default now()
);

create table if not exists vy_session (    -- session clock substrate
  session_id     text primary key,
  person_id      uuid not null,
  started_at     timestamptz not null default now(),
  last_activity  timestamptz not null default now(),
  continuous_ms  bigint not null default 0,   -- resets on 30-min gaps
  disclosures    integer not null default 0,
  last_disclosure_at timestamptz
);
