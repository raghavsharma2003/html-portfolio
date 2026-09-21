-- Migration 088 - the creator funnel marks (WS-R25).
--
-- "The promise is a Room in minutes. Nothing measures it." Every timestamp
-- the funnel needs already exists in its own table EXCEPT two: the moment
-- the creator's browser first mounted the studio wizard for a replica, and
-- the moment they clicked Publish (as distinct from when the UPDATE that
-- flips `vy_room.published_at` actually lands - `api/_room-publish.js`'s own
-- gate can refuse that write, so the click and the success are two different
-- instants, and this table only ever means the FORMER). Every other funnel
-- step is read live from vy_replica / vy_replica_source /
-- vy_replica_processing_job / vy_replica_generation / vy_replica_readiness /
-- vy_teacher_sheet / vy_room / vy_room_follower by `api/_funnel.js`, never
-- duplicated into a column here - workstream law #1, "do not add columns to
-- record what a table already knows."
--
-- `step` is a closed two-value enum naming a MOMENT, never a message the
-- creator typed - the same "never a message" discipline every content-free
-- Room table in this file's own header shape already keeps (071's Room
-- tables, 077's `vy_room_follower_day`, 084's `vy_sweep_run`). Written once
-- per (replica_id, step) - first write wins, `on conflict do nothing` at the
-- write site (`api/_funnel.js`'s `markStep`), never overwritten - so a
-- second wizard mount or a second Publish click can never move the number a
-- creator will eventually be told about themselves.
--
-- NO FOREIGN KEY, deleted by name: 009's convention for owner/replica-keyed
-- tables, restated by every migration since (073, 076, 086 among them) -
-- the binding is a WHERE clause, not a constraint, so this table needs no
-- cascade to inherit and would simply outlive the replica if
-- api/_replica-full-erasure.js did not reach it by name, which it does in
-- the same change as this migration. scripts/relcheck.mjs's owner-lane reach
-- walk recognizes it by its plain `owner_user_id` column with no
-- person-shaped sibling (`vy_replica_readiness`'s own precedent, 073),
-- needing no new entry in that script's OWNER_KEYS/EXEMPT maps - the same is
-- true of evals/persontables.mjs's offline mirror (`ownerLane()` there is
-- triggered by the same literal column name).
--
-- Idempotent, ONE STATEMENT PER REQUEST - Neon's SQL-over-HTTP endpoint takes
-- exactly one, so a half-applied run is recovered by running this file
-- again. No DO blocks, no functions. Explicit ::uuid/::text casts on every
-- comparison this migration's own callers make (api/_funnel.js joins
-- evals/sqlcast/surface.mjs's STRICT_SURFACE list in the same change).

create table if not exists vy_replica_funnel_mark (
  replica_id     uuid not null,
  owner_user_id  uuid not null,
  step           text not null,
  at             timestamptz not null default now(),
  primary key (replica_id, step)
);

alter table vy_replica_funnel_mark drop constraint if exists vy_replica_funnel_mark_step_check;
alter table vy_replica_funnel_mark add constraint vy_replica_funnel_mark_step_check
  check (step in ('studio_opened', 'publish_clicked'));

-- The owner-lane read/erasure index: every owner-scoped read
-- (`replicaFunnel`) and `api/_replica-full-erasure.js`'s delete both filter
-- on (owner_user_id, replica_id) together.
create index if not exists vy_replica_funnel_mark_owner_ix
  on vy_replica_funnel_mark (owner_user_id, replica_id);
