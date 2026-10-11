-- Migration 108 - Suite attachment HISTORY (WS-R54). Money must be
-- period-true: WS-R42 logged that `reconcilePeriod`'s Suite lane reads a
-- Room's CURRENT `org_id`, so "a Room detached on the 2nd is reconciled as
-- never attached, and a Room attached on the 28th as attached all month"
-- (context/decisions.md#ws-r42-reconcile-suite-lane-uses-current-attachment,
-- read its own reversal condition: this migration is it). This table is the
-- historical record that condition named as the fix, extended past a single
-- "as of period_end" read into a real interval so a Room that moved between
-- two Suites inside one period is answered honestly rather than rounded to
-- whichever Suite it happened to be in at one instant.
--
-- One statement per request, idempotent, no DO blocks, no functions - 009's
-- law, restated by every migration since (078/091/095/099's own headers).
--
-- ── SHAPE ───────────────────────────────────────────────────────────────
--
-- `room_id`/`org_id` carry real FK CASCADE from vy_room and vy_org. This is
-- allowed under 009's own rule because neither is an owner/agent/replica
-- column - they are the SAME two columns `vy_room.org_id` itself already
-- carries a live FK to (migration 091: `alter table vy_room add column ...
-- org_id uuid references vy_org(org_id)`), restated here as a row instead of
-- a single mutable column. No person column, no owner_user_id: this table
-- is a fact about which Suite a Room sat in and when, never about who
-- talked to it - `vy_room_arrival`'s own precedent (migration 102) for a
-- content-free, room-scoped fact table restated for an interval instead of
-- a daily count.
--
-- ── ONE OPEN ROW PER ROOM (law 1) ──────────────────────────────────────
--
-- A partial unique index on `room_id` where `detached_at is null` -
-- `vy_org_subscription_org_live_ix`'s own "at most one row in the LIVE
-- state" shape (091), restated for an attachment interval instead of a
-- subscription state. `attachRoom` and `detachRoom` (api/_org.js) write
-- this table in the SAME statement family as the `vy_room.org_id` flip - a
-- CTE built on the identical UPDATE those two functions already run, with
-- the INSERT (attach) or the closing UPDATE (detach) added as a sibling CTE
-- fed by the first one's own RETURNING - never a second round trip a crash
-- between two separate statements could split, `attachRoom`'s own header
-- law 2 ("a predicate on the write, never a branch above it") applied to a
-- second table instead of a second condition.
create table if not exists vy_room_org_attachment (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references vy_room(room_id) on delete cascade,
  org_id       uuid not null references vy_org(org_id) on delete cascade,
  attached_at  timestamptz not null default now(),
  detached_at  timestamptz
);
create unique index if not exists vy_room_org_attachment_open_ix
  on vy_room_org_attachment (room_id)
  where detached_at is null;
-- `orgBoard`'s own attachment-history read (this Suite's own rows, newest
-- first) and `reconcilePeriod`'s own overlap read (this Room's own rows) -
-- one index each, the shape every sibling org-scoped table already carries
-- (`vy_org_subscription_org_ix`, `vy_renewal_reminder_org_ix`).
create index if not exists vy_room_org_attachment_room_ix
  on vy_room_org_attachment (room_id, attached_at desc);
create index if not exists vy_room_org_attachment_org_ix
  on vy_room_org_attachment (org_id, attached_at desc);

-- ── THE BACKFILL (law 4), one idempotent statement ─────────────────────
--
-- Every Room attached right now gets one open history row, `WHERE NOT
-- EXISTS` so a second run of this file inserts nothing new.
-- `attached_at` = the BEST EVIDENCE this database holds:
-- `vy_room.org_attached_at` (migration 107) where it is set - the exact
-- moment `attachRoom`'s own UPDATE stamped it, the honest signal that
-- column's own header already argues for. For a Room attached before 107
-- existed (`org_attached_at` still null despite `org_id` being set), there
-- is NO earlier signal anywhere in this schema - `updated_at` is touched by
-- publish/pause/price too (107's own header) - so this falls back to
-- `now()`, a KNOWN INEXACTNESS logged with its reversal condition in
-- context/decisions.md: a Room in that second group, reconciled for a
-- period that ended before this migration ran, will show as attached for
-- LESS of that period than it actually was (its true start is unrecorded,
-- not zero).
insert into vy_room_org_attachment (room_id, org_id, attached_at, detached_at)
select r.room_id, r.org_id, coalesce(r.org_attached_at, now()), null
  from vy_room r
 where r.org_id is not null
   and not exists (
     select 1 from vy_room_org_attachment a
      where a.room_id = r.room_id and a.detached_at is null
   );
