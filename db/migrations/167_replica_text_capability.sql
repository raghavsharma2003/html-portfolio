-- Migration 167 — WS-R161, wave twenty-two. Meet opens for any person: a
-- text-first runtime capability, independent of the voice pipeline.
--
-- `api/_replica-runtime.js`'s existing `vy_replica_runtime_capability` binds
-- an approved profile version to an approved calibration, an approved voice
-- genome, a ready voice profile, a passing 7-suite qualification and a
-- passing readiness snapshot (SPEC-GURUKUL SS8.2) — the full Azure pipeline.
-- WS-R158 found the real product gap this closes: a person who has only
-- described themselves (an approved HumanOS person sheet, migration 163)
-- waits on that whole chain for something text never needed
-- (context/rejected.md#ws-r158-meet-does-not-open-automatically-without-the-
-- full-build-promotion-pipeline).
--
-- This table is the HONEST RECORD of the lighter of the two levels this
-- workstream defines: `text_ready` (an approved, valid person sheet; no
-- voice column at all) as a peer of `voice_ready` (the existing table,
-- unchanged), never a relaxation of it — a text-ready capability is
-- BLOCKED by name (`ownedTextCapabilityStatus`/`ensureOwnedTextCapability`
-- in `api/_replica-runtime.js`) from ever standing in for voice.
--
-- No FK on replica_id, owner_user_id, agent_id or subject_person_id (this
-- wave's own law, `db/migrations/009_*`'s original convention restated in
-- `context/rejected.md` and this wave's own `ws-common.md`) — reached
-- explicitly by name in `api/_replica-full-erasure.js` instead, the exact
-- shape `vy_replica_vibe` (migration 164) already proves for an owner-lane
-- table with no declared FK.
--
-- Idempotent, one statement per request (`db/migrations/apply.mjs`'s own
-- splitter runs each of these independently against Neon's SQL-over-HTTP
-- endpoint, which accepts exactly one statement per call).
create table if not exists vy_replica_text_capability (
  capability_id     uuid primary key default gen_random_uuid(),
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  profile_version   integer not null check (profile_version > 0),
  policy_version    text not null,
  state             text not null default 'active' check (state in ('active','revoked')),
  activated_at      timestamptz not null default now(),
  revoked_at        timestamptz
);

-- At most one ACTIVE row per replica — `vy_replica_runtime_one_active_ix`'s
-- own shape (023_replica_runtime.sql) restated for this lighter table.
create unique index if not exists vy_replica_text_capability_one_active_ix
  on vy_replica_text_capability (replica_id)
  where state = 'active';

create index if not exists vy_replica_text_capability_owner_ix
  on vy_replica_text_capability (owner_user_id, replica_id, activated_at desc);
