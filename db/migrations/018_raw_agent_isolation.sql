-- Migration 018 -- hard agent ownership for the raw RelationalOS substrate.
-- Contract: docs/SPEC-REPLICA-PLATFORM.md, "Raw memory isolation".
--
-- 009 scoped the derived vy_* relationship tables, but the rows they derive
-- from were still keyed only by device. That leaves two structural failures
-- in a multi-agent process:
--
--   * a reader for agent B can retrieve agent A's log/graph/suppression rows;
--   * one agent's episode cursor or consolidation lease can make another
--     agent's outstanding log rows look complete.
--
-- Existing rows all belong to Meera. The fixed id below is the same value
-- pinned by 009 and api/_agentscope.js:
--
--   a0000000-0000-4000-8000-000000000001
--
-- Neon SQL-over-HTTP accepts one statement per request. Every statement below
-- is independently idempotent; an interrupted apply is recovered by running
-- this file again. The default is installed before the backfill so old Meera
-- processes remain write-compatible during a rolling deploy. Shipping writers
-- name agent_id explicitly; a later strict migration may remove these four
-- compatibility defaults once every historical utility/script is migrated.

-- conversation ground truth + its per-agent episode cursor
alter table meera_log add column if not exists agent_id uuid;
alter table meera_log alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update meera_log set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table meera_log alter column agent_id set not null;
create index if not exists meera_log_agent_device_ix
  on meera_log (agent_id, device_id, id);
create index if not exists meera_log_agent_pending_ix
  on meera_log (agent_id, device_id, id) where episode_id is null;

-- graph nodes and edges are relationship memory, never person-global memory
alter table meera_nodes add column if not exists agent_id uuid;
alter table meera_nodes alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update meera_nodes set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table meera_nodes alter column agent_id set not null;
create index if not exists meera_nodes_agent_device_name_ix
  on meera_nodes (agent_id, device_id, name);
create index if not exists meera_nodes_agent_device_salience_ix
  on meera_nodes (agent_id, device_id, salience desc, updated_at desc);

alter table meera_edges add column if not exists agent_id uuid;
alter table meera_edges alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update meera_edges set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table meera_edges alter column agent_id set not null;
create index if not exists meera_edges_agent_device_ix
  on meera_edges (agent_id, device_id, src, dst);

-- A suppression means "this agent must not relearn this term". Widening the
-- unique key is necessary: Meera forgetting a word must neither suppress it
-- for another agent nor prevent that agent from recording its own tombstone.
alter table meera_forget add column if not exists agent_id uuid;
alter table meera_forget alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update meera_forget set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table meera_forget alter column agent_id set not null;
drop index if exists meera_forget_device_term;
create unique index if not exists meera_forget_agent_device_term_ix
  on meera_forget (agent_id, device_id, lower(term));
create index if not exists meera_forget_agent_device_at_ix
  on meera_forget (agent_id, device_id, at desc);

-- The sweep used to create this operational table ad hoc with person_id as
-- its primary key. That serialized different agents unnecessarily and let an
-- agent-A lease hide agent-B work for the same person. Fold it into migration
-- history and re-key it to the actual work unit: (agent, person).
create table if not exists meera_consolidate_lease (
  agent_id  uuid not null default 'a0000000-0000-4000-8000-000000000001'::uuid,
  person_id uuid not null,
  leased_at timestamptz not null default now(),
  leased_by text not null default '',
  run_id    text,
  primary key (agent_id, person_id)
);
alter table meera_consolidate_lease add column if not exists agent_id uuid;
alter table meera_consolidate_lease alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update meera_consolidate_lease set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table meera_consolidate_lease alter column agent_id set not null;
alter table meera_consolidate_lease drop constraint if exists meera_consolidate_lease_pkey;
alter table meera_consolidate_lease add constraint meera_consolidate_lease_pkey
  primary key (agent_id, person_id);
create index if not exists meera_consolidate_lease_expiry_ix
  on meera_consolidate_lease (leased_at);
