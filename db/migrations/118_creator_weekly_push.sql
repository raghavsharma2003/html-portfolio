-- Migration 118 - the creator's weekly push (WS-R74).
--
-- Pulse (WS-R35) writes a weekly note and the funnel/cohorts (WS-R21) know
-- the week's numbers, but a creator learns any of it only by opening the
-- studio. WS-R62 (migration 114) built the mechanism for an OPERATOR to get
-- a push on their own phone; this migration is the identical mechanism for
-- a CREATOR, carrying their own Room's counts instead of an ops alert.
--
-- Two tables, two different lanes:
--
--   1. `vy_creator_push_subscription` - the creator's own browser/device
--      subscription. OWNER lane, no room, no follower, no replica_id even -
--      `vy_operator_push_subscription`'s (migration 114) exact shape,
--      restated for a creator instead of a platform operator: endpoint/
--      p256dh/auth, created_at, revoked_at, no FK on owner_user_id (009's
--      convention), unique on (owner_user_id, endpoint) rather than a bare
--      endpoint (114's own law 1: a shared device is not impossible for a
--      creator's team, and scoping uniqueness BY CREATOR is what lets two
--      creators who happen to open the SAME endpoint each hold their own
--      row). One subscription serves every Room this owner has, since the
--      push itself is per-Room (see table 2) but the DEVICE that receives
--      it is the creator's own, not the Room's.
--
--   2. `vy_creator_weekly_push` - the content-free send ledger, one row per
--      Room per ISO week. `vy_room_pulse_week`'s (migration 097) exact
--      shape restated for a send record instead of a computed snapshot:
--      room_id references vy_room(room_id) on delete cascade, no
--      owner_user_id column at all (the owner is reached by joining through
--      vy_room, `vy_room_pulse_week`'s own "room_agg" precedent in
--      api/_creator-export.js). The unique index on (room_id, week_start)
--      IS the idempotency mechanism (workstream law 4): an INSERT ... ON
--      CONFLICT (room_id, week_start) DO NOTHING is what refuses a second
--      push for the same Room in the same week, structurally, the same way
--      migration 099's own composite primary key refuses a second renewal
--      reminder on the same (subject, period, channel). followers_count/
--      messages_count are the two facts the push itself is allowed to
--      carry (workstream law 3) and nothing else - both are aggregate
--      integers, never a name, a message or a follower id, so this row is
--      as content-free as `vy_incident` (migration 109) or `vy_room_pulse_
--      week` (097) before it.
--
-- Idempotent, one statement per request (Neon SQL-over-HTTP), no DO blocks,
-- explicit ::uuid casts on every comparison in the code that reads these
-- tables (api/_creator-push.js).
create table if not exists vy_creator_push_subscription (
  id            uuid primary key,
  owner_user_id uuid not null,
  endpoint      text not null,
  p256dh        text not null,
  auth          text not null,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
create unique index if not exists vy_creator_push_subscription_owner_endpoint_ix
  on vy_creator_push_subscription (owner_user_id, endpoint);
-- The sweep's own read shape: every ACTIVE subscription for one creator.
-- Partial on `revoked_at is null`, `vy_operator_push_subscription_active_ix`'s
-- own precedent (migration 114) restated for the creator lane.
create index if not exists vy_creator_push_subscription_active_ix
  on vy_creator_push_subscription (owner_user_id)
  where revoked_at is null;

create table if not exists vy_creator_weekly_push (
  push_id           uuid primary key,
  room_id           uuid not null references vy_room(room_id) on delete cascade,
  week_start        date not null,
  sent_at           timestamptz not null default now(),
  followers_count    integer not null default 0 check (followers_count >= 0),
  messages_count     integer not null default 0 check (messages_count >= 0),
  headline_included boolean not null default false
);
-- THE dedupe. See this migration's own header, table 2, for the argument:
-- an INSERT ... ON CONFLICT (room_id, week_start) DO NOTHING against this
-- index is the whole "second push in the same week is refused" guarantee,
-- decided by the WHERE (here, the unique constraint), never by an `if` in
-- api/_creator-push.js that a future caller could route around.
create unique index if not exists vy_creator_weekly_push_room_week_ix
  on vy_creator_weekly_push (room_id, week_start);
-- The board's/creator-export's own read shape: most recent sends for one
-- Room, newest first - `vy_room_pulse_week_owner_read_ix`'s own precedent
-- (migration 097) restated for this table.
create index if not exists vy_creator_weekly_push_room_sent_ix
  on vy_creator_weekly_push (room_id, sent_at desc);

-- Added at the WS-R89 merge (2026-09-05): `subscribeCreatorPush` now asks,
-- before the upsert, whether an endpoint is already actively bound to a
-- DIFFERENT owner (`api/_creator-push.js`, WS-R89's replay class). That read
-- is by endpoint alone; the unique index above leads with owner_user_id and
-- cannot serve it, and the live EXPLAIN planned it as a bitmap over every
-- active row through the owner-led partial index. This index is the read's
-- own shape. Idempotent, as every statement in this file is.
create index if not exists vy_creator_push_subscription_endpoint_active_ix
  on vy_creator_push_subscription (endpoint)
  where revoked_at is null;
