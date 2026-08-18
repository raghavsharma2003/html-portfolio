-- Migration 009 — the agent layer: one relational OS, many AI people.
-- Contract: docs/SPEC-AGENT-LAYER.md §2 (what is agent-scoped), §4 (surface
-- identity), §6 (this file's shape and safety).
--
-- Idempotent, one statement per request (see 001/008 headers). Neon's
-- SQL-over-HTTP endpoint accepts exactly ONE statement per body and
-- db/migrations/apply.mjs runs them individually with no transaction, so
-- EVERY statement below is independently re-runnable and an apply interrupted
-- halfway is recovered by running this same file again — never by manual
-- repair. No DO blocks and no functions: apply.mjs's splitter is deliberately
-- small and does not handle them.
--
-- THE FIXED CONSTANT. Meera's agent id is
--
--     a0000000-0000-4000-8000-000000000001
--
-- mirrored in db/schema.sql and (when it exists) src/engine/agents/registry.ts,
-- asserted equal by scripts/verify-agent-id.mjs — the same mirrored-not-imported
-- pattern as OPERATIONAL_CORE_CAP, which is checked by
-- scripts/check-prompt-budget.mjs. SPEC §6's illustrative string
-- ('a0000000-0000-4000-8000-00000000meer') is not valid hex and cannot be
-- stored in a uuid column; this is the v4-shaped replacement — version nibble
-- 4, variant nibble 8, and readable as "agent one" so the second agent is
-- visibly ...0002.
--
-- ── the add-column sequence, and one deliberate deviation from §6 ──────────
--
-- §6 sketches: add column / update / set default / set not null / index. This
-- file swaps the middle two — add column / SET DEFAULT / update / set not null.
-- Both orders are idempotent; only this one is race-free. There are no
-- transactions here, so with the §6 order a live INSERT landing between the
-- backfill UPDATE and the SET DEFAULT writes a fresh NULL and the SET NOT NULL
-- then fails against production traffic. With the default installed first, no
-- new NULL can appear, so the backfill is monotone and the NOT NULL cannot
-- lose a race. (Setting a default never touches existing rows, so the backfill
-- is still required.)
--
-- The default is what keeps every existing call site correct while the code is
-- migrated: a writer that does not yet know about agents files Meera's rows,
-- exactly as it does today. §6 removes it in migration 010, after the
-- agent-scope predicate is proven, so a forgotten call site fails loudly
-- instead of silently filing another agent's memory under Meera.
--
-- ── the composite primary keys, and the compat index §6 does not mention ───
--
-- vy_rel_state / vy_ritual / vy_currency / vy_india_profile move to composite
-- PKs. That is the one non-additive act here and it is safe only because the
-- four tables hold ZERO rows in production — MEASURED at apply time
-- (2026-08-18: 0 / 0 / 0 / 0), not assumed. Re-check before ever re-deriving
-- this file against another database; if any is non-zero the drop-and-recreate
-- must become a copy-through-temp.
--
-- What §6 does NOT account for: a PK is also the ON CONFLICT arbiter. Ten
-- live upsert sites name the OLD key explicitly and would stop resolving the
-- moment the PK became composite —
--
--   on conflict (person_id)          api/memory.js:1503 (rebuildRelState — NOT
--                                      .catch()-swallowed: this one lives in
--                                      the forget cascade, so it would turn a
--                                      whole-wipe into a hard error and break
--                                      the G-E5 property outright)
--                                    api/consolidate.js:726, :820, :1055, :1085
--                                    src/engine/relstate.ts:599
--                                    src/engine/india.ts:341 (vy_india_profile)
--   on conflict (person_id, key)     src/engine/india.ts:154   (vy_ritual)
--   on conflict (person_id, topic)   api/memory.js:535,
--                                    src/engine/india.ts:199   (vy_currency)
--
-- The §6 column default does not help: a default fills a value, it does not
-- create an index for an arbiter to infer. Seven of the ten are
-- .catch()-swallowed, which means the failure mode is not an error anyone sees
-- — it is `relstate-zero-rows` a second time, writers silently not writing.
--
-- So each composite PK is paired with a UNIQUE INDEX ON THE OLD KEY, kept as
-- a compatibility shim for exactly as long as the §6 default is kept and
-- dropped by the same migration 010 that drops the default and migrates the
-- call sites. It costs nothing today and forecloses nothing: it constrains
-- only "two agents holding rel_state for the same person", and §9 says Phase E
-- deliberately does not ship a second persona. It must NOT survive into a
-- two-agent world, which is why its removal is tied to the same migration.
--
-- ── vy_surface_identity ────────────────────────────────────────────────────
--
-- §4: no agent_id, on purpose. Identity resolution is agent-independent — the
-- same human, whoever they are talking to — and the agent enters at retrieval,
-- not at identification. vy_tg_person is NOT dropped: another workstream still
-- reads it, and the backfill below is additive and idempotent.

-- ── the agent registry ─────────────────────────────────────────────────────

create table if not exists vy_agent (
  agent_id        uuid primary key,
  slug            text not null unique,
  display_name    text not null,
  persona_version text not null default '',
  register        jsonb not null default '{}'::jsonb,
  status          text not null default 'active'
                  check (status in ('active','paused','retired')),
  created_at      timestamptz not null default now()
);

-- Meera, seeded idempotently. persona_version is left at '' deliberately: it
-- is part of the CORE cache key and belongs to the persona module
-- (src/engine/agents/*, WS-AGENT-PERSONA), so pinning a value here would be a
-- second source of truth that drifts. `register` mirrors §3's AgentModule
-- register block — Hinglish, latin script, Hindi T–V honorifics.
insert into vy_agent (agent_id, slug, display_name, register, status)
values (
  'a0000000-0000-4000-8000-000000000001',
  'meera',
  'Meera',
  '{"script":"latin","honorificSystem":"hi-TV"}'::jsonb,
  'active'
)
on conflict (agent_id) do nothing;

-- ── surface identity (§4) ──────────────────────────────────────────────────

create table if not exists vy_surface_identity (
  surface         text not null,     -- 'telegram'|'discord'|'whatsapp'|'web'
  surface_user_id text not null,
  person_id       uuid not null,
  handle          text not null default '',
  linked_at       timestamptz not null default now(),
  primary key (surface, surface_user_id)
);

create index if not exists vy_surface_identity_person_ix
  on vy_surface_identity (person_id);

-- Backfill from the Telegram binding. Additive: vy_tg_person stays in place
-- and stays authoritative for the code that still reads it.
insert into vy_surface_identity (surface, surface_user_id, person_id, handle, linked_at)
  select 'telegram', tg_user_id::text, person_id, username, linked_at
    from vy_tg_person
  on conflict do nothing;

-- ── agent_id on every agent-scoped table (§2) ──────────────────────────────
--
-- Index naming follows the repo's _ix law rather than §6's `<t>_agent_person`
-- sketch: tables and indexes share one namespace in Postgres and an index that
-- claims a table's name makes a later `create table if not exists` SKIP with a
-- NOTICE instead of an error (the measured meera_tel_session incident,
-- db/schema.sql:189-196).

-- vy_episode
alter table vy_episode add column if not exists agent_id uuid;
alter table vy_episode alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_episode set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_episode alter column agent_id set not null;
create index if not exists vy_episode_agent_person_ix on vy_episode (agent_id, person_id);

-- vy_fact
alter table vy_fact add column if not exists agent_id uuid;
alter table vy_fact alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_fact set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_fact alter column agent_id set not null;
create index if not exists vy_fact_agent_person_ix on vy_fact (agent_id, person_id);

-- vy_rel_state
alter table vy_rel_state add column if not exists agent_id uuid;
alter table vy_rel_state alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_rel_state set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_rel_state alter column agent_id set not null;
create index if not exists vy_rel_state_agent_person_ix on vy_rel_state (agent_id, person_id);

-- vy_rel_event
alter table vy_rel_event add column if not exists agent_id uuid;
alter table vy_rel_event alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_rel_event set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_rel_event alter column agent_id set not null;
create index if not exists vy_rel_event_agent_person_ix on vy_rel_event (agent_id, person_id);

-- vy_pattern
alter table vy_pattern add column if not exists agent_id uuid;
alter table vy_pattern alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_pattern set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_pattern alter column agent_id set not null;
create index if not exists vy_pattern_agent_person_ix on vy_pattern (agent_id, person_id);

-- vy_phrase
alter table vy_phrase add column if not exists agent_id uuid;
alter table vy_phrase alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_phrase set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_phrase alter column agent_id set not null;
create index if not exists vy_phrase_agent_person_ix on vy_phrase (agent_id, person_id);

-- vy_ritual
alter table vy_ritual add column if not exists agent_id uuid;
alter table vy_ritual alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_ritual set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_ritual alter column agent_id set not null;
create index if not exists vy_ritual_agent_person_ix on vy_ritual (agent_id, person_id);

-- vy_currency
alter table vy_currency add column if not exists agent_id uuid;
alter table vy_currency alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_currency set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_currency alter column agent_id set not null;
create index if not exists vy_currency_agent_person_ix on vy_currency (agent_id, person_id);

-- vy_kin
alter table vy_kin add column if not exists agent_id uuid;
alter table vy_kin alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_kin set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_kin alter column agent_id set not null;
create index if not exists vy_kin_agent_person_ix on vy_kin (agent_id, person_id);

-- vy_india_profile
alter table vy_india_profile add column if not exists agent_id uuid;
alter table vy_india_profile alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_india_profile set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_india_profile alter column agent_id set not null;
create index if not exists vy_india_profile_agent_person_ix on vy_india_profile (agent_id, person_id);

-- vy_taste_candidate
alter table vy_taste_candidate add column if not exists agent_id uuid;
alter table vy_taste_candidate alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_taste_candidate set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_taste_candidate alter column agent_id set not null;
create index if not exists vy_taste_candidate_agent_person_ix on vy_taste_candidate (agent_id, person_id);

-- vy_shared_moment
alter table vy_shared_moment add column if not exists agent_id uuid;
alter table vy_shared_moment alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_shared_moment set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_shared_moment alter column agent_id set not null;
create index if not exists vy_shared_moment_agent_person_ix on vy_shared_moment (agent_id, person_id);

-- vy_visual_assertion
alter table vy_visual_assertion add column if not exists agent_id uuid;
alter table vy_visual_assertion alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_visual_assertion set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_visual_assertion alter column agent_id set not null;
create index if not exists vy_visual_assertion_agent_person_ix on vy_visual_assertion (agent_id, person_id);

-- vy_embedding
alter table vy_embedding add column if not exists agent_id uuid;
alter table vy_embedding alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_embedding set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_embedding alter column agent_id set not null;
create index if not exists vy_embedding_agent_person_ix on vy_embedding (agent_id, person_id);

-- vy_derivation
alter table vy_derivation add column if not exists agent_id uuid;
alter table vy_derivation alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_derivation set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_derivation alter column agent_id set not null;
create index if not exists vy_derivation_agent_person_ix on vy_derivation (agent_id, person_id);

-- vy_session
alter table vy_session add column if not exists agent_id uuid;
alter table vy_session alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_session set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_session alter column agent_id set not null;
create index if not exists vy_session_agent_person_ix on vy_session (agent_id, person_id);

-- vy_group_member
alter table vy_group_member add column if not exists agent_id uuid;
alter table vy_group_member alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_group_member set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_group_member alter column agent_id set not null;
create index if not exists vy_group_member_agent_person_ix on vy_group_member (agent_id, person_id);

-- The last three agent-scoped tables carry no person_id column, so their index
-- pairs agent_id with the column the table is actually read by. Same law, same
-- shape, different second column — an index on a column that does not exist is
-- not a stricter reading of §6, it is a migration that does not apply.

-- vy_group  (read by id; the room is the unit)
alter table vy_group add column if not exists agent_id uuid;
alter table vy_group alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_group set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_group alter column agent_id set not null;
create index if not exists vy_group_agent_ix on vy_group (agent_id, id);

-- vy_group_turn  (read by room, newest first)
alter table vy_group_turn add column if not exists agent_id uuid;
alter table vy_group_turn alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_group_turn set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_group_turn alter column agent_id set not null;
create index if not exists vy_group_turn_agent_ix on vy_group_turn (agent_id, group_id);

-- vy_disclosure_grant  (read by recipient — api/_disclosure.js's grant branch)
alter table vy_disclosure_grant add column if not exists agent_id uuid;
alter table vy_disclosure_grant alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_disclosure_grant set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_disclosure_grant alter column agent_id set not null;
create index if not exists vy_disclosure_grant_agent_ix on vy_disclosure_grant (agent_id, granted_to);

-- ── composite primary keys (§6) ────────────────────────────────────────────
--
-- drop-then-add is the idempotent pair, the same shape 008a uses for its check
-- constraint: re-running drops the constraint it just added and adds it back.
-- An apply interrupted BETWEEN the two leaves the table momentarily without a
-- PK and is recovered by running the file again — which is the house law, not
-- an exception to it. The compat unique index on the old key follows each pair
-- (see the header): it is what keeps the ten ON CONFLICT arbiters resolving,
-- and migration 010 drops it together with the column default.

alter table vy_rel_state drop constraint if exists vy_rel_state_pkey;
alter table vy_rel_state add constraint vy_rel_state_pkey primary key (agent_id, person_id);
create unique index if not exists vy_rel_state_person_compat_ix on vy_rel_state (person_id);

alter table vy_ritual drop constraint if exists vy_ritual_pkey;
alter table vy_ritual add constraint vy_ritual_pkey primary key (agent_id, person_id, key);
create unique index if not exists vy_ritual_person_compat_ix on vy_ritual (person_id, key);

alter table vy_currency drop constraint if exists vy_currency_pkey;
alter table vy_currency add constraint vy_currency_pkey primary key (agent_id, person_id, topic);
create unique index if not exists vy_currency_person_compat_ix on vy_currency (person_id, topic);

alter table vy_india_profile drop constraint if exists vy_india_profile_pkey;
alter table vy_india_profile add constraint vy_india_profile_pkey primary key (agent_id, person_id);
create unique index if not exists vy_india_profile_person_compat_ix on vy_india_profile (person_id);
