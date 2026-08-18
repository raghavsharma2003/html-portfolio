-- Migration 008a — speaker attribution and episode participants.
-- Contract: docs/design/PROPOSAL-MULTIPARTY-V1.md §4.1 (accepted,
-- context/decisions.md `multiparty-v1-design`).
--
-- Idempotent, additive only, one statement per request (see 001 header).
-- This file is the one that MUST land before any room ingestion code exists:
-- meera_log.speaker_person_id is UNBACKFILLABLE. A room message written
-- without it is permanently unattributable, which makes "delete my turns,
-- leave theirs and hers" impossible at row level for that row, forever
-- (proposal §9, "the one thing that must land first").
--
-- THE BLOCKING GAP (MULTIPARTY.md §6.1, highest-severity reservation).
-- meera_log is keyed by device_id with no per-speaker column
-- (db/schema.sql:39-47). A room has no device uuid, so room turns are written
-- under a SYNTHETIC room device (vy_group.room_device_id, 008b) that appears
-- in nobody's vy_person_device mapping — which means a person's own room turns
-- would survive their own full wipe under today's device-keyed manifest. That
-- is a live data-deletion bug the moment room ingestion runs; it is closed by
-- keying meera_log on speaker_person_id as well (PERSON_TABLES `keys`,
-- api/memory.js). Both halves ship together, in this commit, deliberately.
alter table meera_log add column if not exists speaker_person_id uuid;

alter table meera_log add column if not exists group_id bigint;

create index if not exists meera_log_speaker_ix
  on meera_log (speaker_person_id, id);

create index if not exists meera_log_group_ix
  on meera_log (group_id, id) where group_id is not null;

-- ── episodes become participant-scoped ─────────────────────────────────────
--
-- person_id stays the PRIMARY/REPORTING owner for 1:1 episodes and becomes
-- NULL for room episodes: the manifest's `key: person_id` is documented (§3.3)
-- as selecting "exclusive rows (1:1)", and a room episode with a person_id
-- would be hard-deleted out from under its co-participants by that person's
-- whole-wipe. Loosening a NOT NULL is additive-safe: it cannot break a row
-- that already satisfies it. relcheck asserts the writer honours the split
-- (no episode may carry BOTH person_id and group_id).
alter table vy_episode alter column person_id drop not null;

alter table vy_episode add column if not exists group_id bigint;

-- disclosure_scope: the §2.3 clause-3 axis. 'participants' = the episode's
-- participant set may receive it in any channel; 'participants_1to1' = a DM,
-- which never renders INTO a room even between the same two people (a DM is
-- not a room); 'private' = never leaves its own owner.
-- The DEFAULT is 'participants' per the contract's DDL sketch; the backfill
-- below is what makes clause 3 do real work on the rows that already exist.
alter table vy_episode add column if not exists disclosure_scope text
  not null default 'participants'
  check (disclosure_scope in ('participants','participants_1to1','private'));

-- explicit deny (§2.3 clause 0): presence is not consent to be surfaced.
-- Deny beats every other clause including an explicit grant.
alter table vy_episode add column if not exists disclosure_deny uuid[]
  not null default '{}';

-- participation gains 'group'. drop-then-add is the idempotent pair: rerunning
-- the file drops the constraint it just added and adds it again.
alter table vy_episode drop constraint if exists vy_episode_participation_check;

alter table vy_episode add constraint vy_episode_participation_check
  check (participation in ('we','user','meera','group'));

-- THE ACL ITSELF (§2.1 primitive): "the disclosure ACL of a derived row is the
-- participant set of the episodes it cites." Not a permissions table, not a
-- flag anyone sets — a fact about who was in the room, computed by join,
-- unforgeable by a generated-text step.
--
-- A JOIN TABLE, not an array column, for three reasons that are all load
-- bearing: the filter must be index-backed in BOTH directions ("who was at
-- this episode" at compile time, "which episodes was this person at" for
-- forget/export); `on delete cascade` is not expressible on a bare array; and
-- participant withdrawal (§3.1.2) is a row delete, which is what makes
-- multi-owner forget a delete rather than an array rewrite.
create table if not exists vy_episode_participant (
  episode_id bigint not null references vy_episode(id) on delete cascade,
  person_id  uuid   not null,
  role       text   not null default 'participant'
             check (role in ('participant','addressed','silent_present')),
  primary key (episode_id, person_id)
);

create index if not exists vy_episode_participant_person_ix
  on vy_episode_participant (person_id, episode_id);

-- backfill: every existing 1:1 episode gets exactly one participant row, so
-- the predicate's structural branch is true-by-construction for today's
-- product and the 1:1 lane needs no separate code path (§2.1).
insert into vy_episode_participant (episode_id, person_id)
  select id, person_id from vy_episode where person_id is not null
  on conflict do nothing;

-- RESOLUTION (WS-MPBUILD, flagged): the contract's sketch defaults
-- disclosure_scope to 'participants' and does not say what existing 1:1
-- episodes become. Left at the default, a room whose ACTIVE membership had
-- shrunk to one person would let that person's own DM-sourced rows through the
-- structural branch into the room channel — harmless today (the recipient set
-- is that one person) but it makes clause 3 dead code and it depends on a
-- membership count rather than on a structural fact. Marking pre-existing 1:1
-- episodes 'participants_1to1' resolves it in the direction the §2.2 policy
-- table already states ("your DM → the room: never, without an explicit cited
-- grant") and costs nothing in the 1:1 lane, where clause 3 is inert because
-- it is gated on is_group_channel. Explicit grants still override it — the
-- grant branch sits ABOVE the structural branch, by design (§2.3).
-- Idempotent: it only ever moves rows off the default.
update vy_episode set disclosure_scope = 'participants_1to1'
 where person_id is not null and group_id is null
   and disclosure_scope = 'participants';
