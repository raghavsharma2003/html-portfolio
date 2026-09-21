-- Migration 095 - the Suite's money end to end, and the creator tier charge
-- the seat exemption predicate (091, WS-R28's `seatCoversCreatorTier`) was
-- built for and never had a caller (WS-R33). Two things land here:
--
--   1. `vy_creator_subscription` - what a CREATOR pays the platform for
--      capacity (the Rooms plan's Room/Studio tiers, INR 4,999 / 19,999 a
--      month; api/_payments.js's own header names this as "a Phase 2
--      concern, no table here" before this migration - it is Phase 2 now).
--      Owner-lane, NOT person-lane: this is a record of what the OWNER pays
--      for their own capacity, not a record of a relationship with any
--      person. Reached BY NAME in api/_replica-full-erasure.js on 078's own
--      `vy_room_price` precedent (owner_user_id, no person column), never
--      through api/memory.js's PERSON_TABLES manifest.
--
--   2. `vy_payment_event` grows what a SUITE's own seat charge needs to land
--      in the SAME ledger a follower subscription lands in: `org_id`
--      (nullable, the workstream brief's own words: "no FK per the
--      manifest? vy_org is not a person/agent/replica table, so an FK ON
--      DELETE SET NULL is fine, say so" - true, and this migration follows
--      it, ON DELETE SET NULL rather than CASCADE for the identical reason
--      091's own header gives `vy_room.org_id`: a Suite's own deletion must
--      never silently take its payment history with it) and
--      `org_subscription_id` (nullable, FK CASCADE to `vy_org_subscription`,
--      the row this event is ABOUT - `subscription_id`'s own role for a
--      follower event, restated for the org lane, since a single FK column
--      cannot point at two different parent tables at once and dropping
--      `subscription_id`'s existing FK to widen it would strip referential
--      integrity from a lane three workstreams already depend on). Both
--      `room_id` and `subscription_id` (the follower-lane columns) become
--      NULLABLE for the same reason: a Suite's seat charge has neither a
--      Room nor a follower subscription to name. A CHECK constraint makes
--      the two lanes MUTUALLY EXCLUSIVE at the database level - a payment
--      event names exactly one of {a follower's Room, a Suite}, never both
--      and never neither - `vy_payment_event_signature_verified`'s own
--      "structurally impossible, not merely undesired" discipline applied
--      to which lane a row belongs to instead of whether its signature
--      checked out.
--
-- ── A DELIBERATE SCOPE CUT, NAMED RATHER THAN HIDDEN ───────────────────────
--
-- A creator-tier charge writes NO `vy_payment_event` row. The ledger's
-- `platform_take_inr`/`creator_share_inr` columns exist to record a REVENUE
-- SPLIT with a creator; a creator's own subscription to the platform is not
-- revenue shared with anyone, it is 100% platform revenue, and inventing a
-- split for a row that has no second party to split with would be exactly
-- the kind of fabricated precision this codebase's own laws forbid
-- (`context/rejected.md`'s no-fake-numbers law). `vy_creator_subscription`'s
-- own `state` column is therefore the only record of a creator-tier
-- payment; api/_payments.js's webhook branch for this lane is a plain state
-- UPDATE, not an INSERT. Logged with its reversal condition in
-- context/decisions.md: the day this product needs a reconciliation history
-- for creator-tier charges (accounting, disputes), add a dedicated
-- append-only ledger shaped like `vy_payment_event` but scoped by
-- `owner_user_id`/`replica_id` rather than retrofitting a three-way lane
-- onto a table already carrying two.
--
-- A SUITE's own seat revenue is likewise NOT distributed to the Suite's
-- attached creators' own payouts in this migration - `platform_take_inr`
-- equals the full `amount_inr` for a Suite ledger row, `creator_share_inr`
-- is 0. Distributing a Suite's aggregate seat charge across N attached
-- creators (pro-rated how - equally, by seat tenure, by follower count?) is
-- a real product decision nobody has made; this migration does not invent
-- one. See context/decisions.md for the reversal condition.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since (078's and 091's own
-- headers, verbatim rationale, binding here for the identical reason).

-- ── the creator tier subscription ───────────────────────────────────────
--
-- `plan` is 'room' or 'studio' (the Rooms plan's two priced creator tiers;
-- 'institute' is sold to a Suite, never charged to one creator directly, so
-- it is deliberately absent from this table's own CHECK even though
-- `vy_org_subscription.plan` already carries it one table over).
-- `price_inr` is captured on the row rather than re-read from a constant at
-- billing time, migration 078's own "the split is computed once" discipline
-- applied to a price instead of a split: a future price change must not
-- silently reprice a subscription someone already started.
create table if not exists vy_creator_subscription (
  subscription_id            uuid primary key default gen_random_uuid(),
  owner_user_id               uuid not null,
  replica_id                   uuid not null,
  plan                         text not null,
  price_inr                    integer not null,
  currency                     text not null default 'INR',
  state                        text not null default 'created',
  provider                     text not null,
  provider_subscription_ref    text,
  current_period_start         timestamptz,
  current_period_end           timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

alter table vy_creator_subscription drop constraint if exists vy_creator_subscription_plan_check;
alter table vy_creator_subscription add constraint vy_creator_subscription_plan_check
  check (plan in ('room', 'studio'));

alter table vy_creator_subscription drop constraint if exists vy_creator_subscription_price_check;
alter table vy_creator_subscription add constraint vy_creator_subscription_price_check
  check (price_inr > 0);

alter table vy_creator_subscription drop constraint if exists vy_creator_subscription_currency_check;
alter table vy_creator_subscription add constraint vy_creator_subscription_currency_check
  check (currency = 'INR');

-- Same closed lifecycle every subscription table in this codebase shares
-- (078's vy_room_subscription, 091's vy_org_subscription) - this table never
-- invents a state the provider did not send.
alter table vy_creator_subscription drop constraint if exists vy_creator_subscription_state_check;
alter table vy_creator_subscription add constraint vy_creator_subscription_state_check
  check (state in ('created', 'authenticated', 'active', 'paused', 'cancelled', 'expired'));

alter table vy_creator_subscription drop constraint if exists vy_creator_subscription_provider_check;
alter table vy_creator_subscription add constraint vy_creator_subscription_provider_check
  check (provider in ('razorpay', 'fake'));

-- ONE LIVE SUBSCRIPTION PER REPLICA. Partial on the non-terminal states,
-- vy_room_subscription_follower_live_ix's own shape (078): a creator who
-- cancelled and comes back may start a second row.
create unique index if not exists vy_creator_subscription_replica_live_ix
  on vy_creator_subscription (replica_id)
  where state in ('created', 'authenticated', 'active', 'paused');

-- The webhook's own lookup, vy_room_subscription_provider_ref_ix's shape:
-- partial because a ref is absent for the one request still creating it.
create unique index if not exists vy_creator_subscription_provider_ref_ix
  on vy_creator_subscription (provider, provider_subscription_ref)
  where provider_subscription_ref is not null;

-- `readCreatorTier`'s own "latest subscription for this owner+replica" read,
-- and the owned-handle lookup every sibling table in this file uses.
create index if not exists vy_creator_subscription_owner_replica_ix
  on vy_creator_subscription (owner_user_id, replica_id, created_at desc);

-- ── the ledger grows a Suite lane ───────────────────────────────────────
--
-- Both follower-lane columns become nullable; a Suite event has neither.
-- Running this twice is a no-op (dropping an already-absent NOT NULL
-- constraint is not an error) - 009's idempotence law applied to a column
-- alteration instead of a table or index creation.
alter table vy_payment_event alter column room_id drop not null;
alter table vy_payment_event alter column subscription_id drop not null;

alter table vy_payment_event add column if not exists org_id uuid references vy_org(org_id) on delete set null;
alter table vy_payment_event add column if not exists org_subscription_id uuid references vy_org_subscription(subscription_id) on delete cascade;

-- THE TWO LANES ARE MUTUALLY EXCLUSIVE. A row names a follower's Room+
-- subscription, XOR a Suite's own org+subscription - never both, never
-- neither. See this file's header for why this is a CHECK rather than a
-- discipline the write has to remember.
alter table vy_payment_event drop constraint if exists vy_payment_event_one_lane;
alter table vy_payment_event add constraint vy_payment_event_one_lane
  check (
    (room_id is not null and subscription_id is not null and org_id is null and org_subscription_id is null)
    or
    (room_id is null and subscription_id is null and org_id is not null and org_subscription_id is not null)
  );

-- The Suite's own revenue read (ownerRevenue's sibling, the Suite money
-- card's "seats used / seats paid / next charge" line) asks "this org's
-- events", never grouped across Suites.
create index if not exists vy_payment_event_org_ix
  on vy_payment_event (org_id, received_at desc)
  where org_id is not null;
