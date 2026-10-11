-- Migration 170 (WS-R167): the owner's own continuity in Meet.
--
-- The ONLY schema gap: `vy_replica_consent.scope` has no value meaning "keep
-- extracted memory of our private Meet conversation" - the closest existing
-- scope, 'inference', already gates whether Meet answers at all, and
-- overloading it would make "answer me" and "remember me" the same toggle,
-- which is not what law 4 (Meet's own honest "It remembers" control,
-- mirroring `vy_room_follower.memory_consent_at`'s own separation from a
-- Room's publish gate) asks for. This is the exact, already-proven pattern
-- `db/migrations/141_private_text_rehearsal.sql` used to add
-- 'private_text_rehearsal' as an eleventh scope: widen the CHECK, add
-- nothing else.
--
-- No new table, no new column on any agent/replica/owner/person-keyed table
-- (009's convention), no FK. `vy_episode`, `vy_fact`, `vy_observation`,
-- `meera_log`, `vy_rel_state` and `vy_rel_event` already carry everything
-- api/_room-memory-authority.js's new owner path and api/_room-relstate.js's
-- existing `fetchRoomRelBundle` need, scoped by the SAME (agent_id,
-- person_id) pair WS-R154 proved is already 1:1 with one replica's own dyad
-- (context/decisions.md#ws-r154-no-migration-165 has the citation chain this
-- migration reuses for the owner's own dyad instead of a follower's; the
-- owner IS `vy_replica.subject_person_id`, the person this replica models).
--
-- The "epoch" a Room follower gets from `vy_room_follower.memory_epoch`'s own
-- trigger (never resurrecting a message sent while memory was off) is
-- reproduced here with NO new column at all: every owner-memory query
-- requires `meera_log.at > (the latest 'memory'-scope revoke timestamp on
-- this replica, or -infinity)`, computed from this ALREADY-append-only
-- table. See context/decisions.md#ws-r167-owner-memory-epoch-is-a-consent-window.
alter table vy_replica_consent drop constraint if exists vy_replica_consent_scope_check;

alter table vy_replica_consent add constraint vy_replica_consent_scope_check check (scope in (
  'capture','transcription','biometric','training',
  'inference','storage','sharing','api','telephony',
  'model_improvement','private_text_rehearsal','memory'
));
