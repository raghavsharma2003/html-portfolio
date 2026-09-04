-- Migration 099 - the reminder ledger, and "renewed unasked" made real
-- (WS-R37). The Phase gate card (WS-R30, migration 093) has shown this
-- number as an honest, hardcoded zero since it was built: no reminder
-- mechanism existed, so nothing could be measured. This migration builds the
-- mechanism as a ROW FIRST, per this workstream's own law 1 - the reminder
-- IS the row, sent or not, and a sweep reads it rather than a live response.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since (078's, 091's and 095's own
-- headers, verbatim rationale, binding here for the identical reason).
--
-- ── THE SHAPE: one table, three subject kinds, mutually exclusive columns ──
--
-- `vy_renewal_reminder` answers one question for every subscription table
-- this platform has: "has this subject already been reminded about THIS
-- period's end, on THIS channel?" `subject_kind`/`subject_id` are the
-- generic key the primary key is built from (subject_id is the natural,
-- already-unique key each subscription table's own live-subscription index
-- already enforces: `follower_id` for a follower's vy_room_subscription,
-- `replica_id` for a creator's vy_creator_subscription, `org_id` for a
-- Suite's vy_org_subscription), and the typed columns beside it
-- (room_id/person_id/follower_id, owner_user_id/replica_id, org_id) are
-- WS-R33's own precedent (vy_payment_event_one_lane, migration 095): a row
-- names exactly one lane, never two, never none, enforced by a CHECK rather
-- than a discipline the write has to remember.
--
-- ── the erasure lanes, decided here rather than discovered later ──────────
--
--   subject_kind = 'follower'   PERSON lane. Carries person_id AND room_id
--                                (this workstream's own brief, law 1), so it
--                                is filed in api/memory.js's PERSON_TABLES
--                                (key "person_id", wipeWhere restricting a
--                                whole-account wipe to follower rows only,
--                                vy_room_subscription's own `wipeWhere`
--                                shape one migration over) and reached by
--                                `roomExport`/`roomForget`'s own explicit,
--                                room-scoped statement (WS-R27's convention:
--                                content-free, but a record of when this
--                                creator's AI reminded this follower, so it
--                                is exported as a COUNT and forgotten by
--                                name). Carries `room_id references
--                                vy_room(room_id) on delete cascade` AND
--                                `follower_id references vy_room_follower
--                                (follower_id) on delete cascade`, 078's own
--                                double-FK shape, so it is cleared out
--                                automatically the day either root goes.
--
--   subject_kind = 'creator'    OWNER lane. Carries owner_user_id (no
--                                person column), so it is reached BY NAME in
--                                api/_replica-full-erasure.js on
--                                vy_creator_subscription's own 095 precedent,
--                                never through PERSON_TABLES. No FK on
--                                owner_user_id/replica_id (009's convention,
--                                restated by every owner-keyed table since).
--
--   subject_kind = 'org'        Reached ONLY by cascade, from vy_org -
--                                vy_org_subscription's own 091 precedent
--                                restated: a Suite survives every one of its
--                                members' own erasure (091's header: "an org
--                                with no admin is a state the ops board
--                                names, never deleted by a person's wipe"),
--                                so a reminder about a Suite's own seats
--                                survives with it and is never reached by an
--                                owner's erasure job.
--
-- ── CANCEL IS A FIRST-CLASS OP (law 5), AND IT IS A NEW LOCAL FLAG ─────────
--
-- "The subscription moves to cancelled at period end through the seam (the
-- provider's cancel at cycle end), the Room or seat keeps working until
-- period_end." A provider's own cancel-at-cycle-end call does not flip its
-- webhook state to 'cancelled' until the period actually ends - `state`
-- keeps meaning exactly what it always has, "a fact the provider confirmed"
-- (078's own header), so the tier-flip predicate below it stays untouched.
-- `cancel_at_period_end` is therefore a SEPARATE, LOCAL flag on each of the
-- three subscription tables: a subject who cancels keeps their access AND
-- keeps getting excluded from the reminder due-select for the remainder of
-- this period, without this migration ever touching what `state` means or
-- when the tier column flips.
create table if not exists vy_renewal_reminder (
  reminder_id    uuid not null default gen_random_uuid(),
  subject_kind   text not null,
  subject_id     uuid not null,
  room_id        uuid references vy_room(room_id) on delete cascade,
  person_id      uuid,
  follower_id    uuid references vy_room_follower(follower_id) on delete cascade,
  owner_user_id  uuid,
  replica_id     uuid,
  org_id         uuid references vy_org(org_id) on delete cascade,
  period_end     timestamptz not null,
  channel        text not null,
  sent_at        timestamptz,
  reason         text not null default '',
  created_at     timestamptz not null default now(),
  primary key (subject_kind, subject_id, period_end, channel)
);

alter table vy_renewal_reminder drop constraint if exists vy_renewal_reminder_subject_kind_check;
alter table vy_renewal_reminder add constraint vy_renewal_reminder_subject_kind_check
  check (subject_kind in ('creator', 'follower', 'org'));

-- The channels this migration's own workstream brief names, law 3: an
-- in-app card everywhere, web push and Telegram for followers where a
-- pointer exists, and NO email row shape at all - grepped for an SMTP path
-- in this repo before writing this migration and found none, so a creator's
-- only channel is the studio card (`channel = 'in_app'`), never a fifth
-- value this table would otherwise have to carry meaning nothing could ever
-- send through.
alter table vy_renewal_reminder drop constraint if exists vy_renewal_reminder_channel_check;
alter table vy_renewal_reminder add constraint vy_renewal_reminder_channel_check
  check (channel in ('in_app', 'web_push', 'telegram'));

-- THE ONE-LANE GUARANTEE. vy_payment_event_one_lane's own "structurally
-- impossible, not merely undesired" discipline (095), applied to which
-- subject a reminder names instead of which lane a payment belongs to.
alter table vy_renewal_reminder drop constraint if exists vy_renewal_reminder_one_lane;
alter table vy_renewal_reminder add constraint vy_renewal_reminder_one_lane
  check (
    (subject_kind = 'follower'
       and room_id is not null and person_id is not null and follower_id is not null
       and owner_user_id is null and replica_id is null and org_id is null)
    or
    (subject_kind = 'creator'
       and owner_user_id is not null and replica_id is not null
       and room_id is null and person_id is null and follower_id is null and org_id is null)
    or
    (subject_kind = 'org'
       and org_id is not null
       and room_id is null and person_id is null and follower_id is null
       and owner_user_id is null and replica_id is null)
  );

-- roomExport's own count-shape read and the account-wide whole-wipe both ask
-- "this person's rows in this room", never a scan of the whole table.
create index if not exists vy_renewal_reminder_room_person_ix
  on vy_renewal_reminder (room_id, person_id)
  where room_id is not null;

-- The owner-lane erasure job's own read, vy_creator_subscription's own
-- (owner_user_id, replica_id) index shape (095) restated for this table.
create index if not exists vy_renewal_reminder_owner_replica_ix
  on vy_renewal_reminder (owner_user_id, replica_id)
  where owner_user_id is not null;

-- The Suite money card's own future read, vy_payment_event_org_ix's shape
-- (095) restated for this table.
create index if not exists vy_renewal_reminder_org_ix
  on vy_renewal_reminder (org_id)
  where org_id is not null;
-- Added at the merge (2026-09-04): `recordAndSend` marks `sent_at` and
-- `reason` by `reminder_id` alone, and the composite primary key cannot
-- serve that lookup (the live EXPLAIN showed a sequential scan).
create unique index if not exists vy_renewal_reminder_id_ix
  on vy_renewal_reminder (reminder_id);

-- ── the due-select's own index need ────────────────────────────────────────
--
-- `dueReminders` (api/_renewals.js) reads each subscription table for
-- "active, not already flagged to cancel, period ending in the next 7
-- days" - none of the three tables carried an index on `current_period_end`
-- before this migration (078/091/095 each indexed the provider ref and the
-- live-subscription partial uniqueness, never the date the due-select
-- actually filters on), so this is the index that keeps that read a scan of
-- the DUE rows rather than of the whole table.
create index if not exists vy_room_subscription_due_ix
  on vy_room_subscription (state, current_period_end)
  where current_period_end is not null;
create index if not exists vy_org_subscription_due_ix
  on vy_org_subscription (state, current_period_end)
  where current_period_end is not null;
create index if not exists vy_creator_subscription_due_ix
  on vy_creator_subscription (state, current_period_end)
  where current_period_end is not null;

-- THE CANCEL FLAG. See this migration's own header for why it is separate
-- from `state`. Idempotent column add, 095's own `alter table ... add
-- column if not exists` shape.
alter table vy_room_subscription add column if not exists cancel_at_period_end boolean not null default false;
alter table vy_org_subscription add column if not exists cancel_at_period_end boolean not null default false;
alter table vy_creator_subscription add column if not exists cancel_at_period_end boolean not null default false;
