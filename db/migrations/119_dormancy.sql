-- Migration 119 - dormancy (WS-R75). India's DPDP Act and plain decency say
-- data kept for a relationship should not outlive the relationship by years.
-- A follower's words have stayed in their private scope forever, since day
-- one - this migration builds the policy as ROWS AND PREDICATES, off by
-- default, so an owner can turn it on with a number they chose.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since (078's, 091's, 095's and
-- 099's own headers, verbatim rationale, binding here for the identical
-- reason).
--
-- ── NO NEW PERSON TABLE ─────────────────────────────────────────────────
--
-- Both columns below ride an EXISTING person-lane row (`vy_room_follower`,
-- already in `api/memory.js`'s `PERSON_TABLES`, agent-scoped, already
-- reached by `roomExport`'s `select *` loop and by `roomForget`'s own
-- explicit, by-name delete). A new table would need its own PERSON_TABLES
-- entry, its own export/forget wiring, its own leak-battery TABLE_ROLES
-- entry - all of it needless, because there is nothing here that is not
-- already a fact about a follower this platform already tracks the erasure
-- reach of. `vy_room.dormancy_days` is the OWNER's own setting, not a
-- person fact at all, and needs no such wiring either.
--
-- ── THE TWO COLUMNS ────────────────────────────────────────────────────
--
--   vy_room.dormancy_days            The creator's own policy switch. NULL
--                                     means off (the default - every Room
--                                     that has never touched this stays
--                                     exactly as it always has: nothing
--                                     expires). When set, a CHECK enforces
--                                     the floor this workstream's own brief
--                                     names (>= 180) so a creator cannot
--                                     configure a relationship's memory to
--                                     evaporate in a matter of weeks.
--
--   vy_room_follower.dormancy_notice_at   NULL until the sweep has warned
--                                     this follower their Room is about to
--                                     forget them. Set once, by the sweep;
--                                     cleared once, by a genuine visit
--                                     (`joinRoom`'s own ON CONFLICT UPDATE,
--                                     `api/_room-surface.js`) - though the
--                                     forget predicate below never actually
--                                     DEPENDS on that clear happening: it
--                                     re-checks `last_seen_at` against
--                                     `dormancy_notice_at` directly, so a
--                                     follower who returns and keeps
--                                     talking (never touching `join` again)
--                                     is provably safe even if the cosmetic
--                                     clear never fires for them.
alter table vy_room add column if not exists dormancy_days integer;

alter table vy_room drop constraint if exists vy_room_dormancy_days_floor;
alter table vy_room add constraint vy_room_dormancy_days_floor
  check (dormancy_days is null or dormancy_days >= 180);

alter table vy_room_follower add column if not exists dormancy_notice_at timestamptz;

-- ── THE SWEEP'S OWN TWO INDEXES ────────────────────────────────────────
--
-- `dormancyNoticeDue` (api/_dormancy.js) reads every follower with no
-- notice yet whose `last_seen_at` is old enough, for every Room with a
-- policy set - migration 099's own "the due-select's own index need" law,
-- restated for a follower scan instead of a subscription scan.
create index if not exists vy_room_follower_dormancy_due_ix
  on vy_room_follower (room_id, last_seen_at)
  where dormancy_notice_at is null;

-- `dormancyForgetDue` reads every follower whose notice is old enough and
-- who has not visited since - a scan of NOTICED followers only, never the
-- whole table.
create index if not exists vy_room_follower_dormancy_notice_ix
  on vy_room_follower (dormancy_notice_at)
  where dormancy_notice_at is not null;
