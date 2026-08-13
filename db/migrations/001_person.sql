-- Migration 001 — person layer (SPEC.md §2.2).
--
-- Person over device: vy_person maps devices to a person; every new table
-- keys on person_id; legacy tables keep device_id and are read through the
-- mapping. Until a device is linked, person_id := device_id cast — one code
-- path for anonymous and signed-in. Merges only via signed-in account
-- evidence (meera_state.user_id), never heuristics.
--
-- Idempotent, additive only. Applied statement-by-statement over SQL-HTTP by
-- db/migrations/apply.mjs (Neon accepts exactly one statement per request),
-- so every statement here must be independently safe to re-run — an
-- interrupted apply resumes by running the whole file again.
--
-- Index naming: every new index carries the _ix suffix. Tables and indexes
-- share one namespace in Postgres (the meera_tel_session incident,
-- db/schema.sql) — an index must never claim a name a table could want.

create extension if not exists pgcrypto;

create table if not exists vy_person (
  person_id  uuid primary key default gen_random_uuid(),
  age_tier   text not null default 'unverified'
             check (age_tier in ('unverified','adult_verified','minor')),
  created_at timestamptz not null default now()
);

create table if not exists vy_person_device (
  device_id uuid primary key,
  person_id uuid not null references vy_person(person_id) on delete cascade,
  linked_at timestamptz not null default now()
);

create index if not exists vy_person_device_person_ix
  on vy_person_device (person_id);
