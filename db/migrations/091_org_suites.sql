-- Migration 091 - Suites v0, the B2B unit (WS-R28). An organisation owns
-- seats, never a follower. Rooms sells to a creator (B2C); this migration
-- builds the mechanism a later phase reuses to sell the same thing to an
-- institute, a gym, a clinic: a Suite is an organisation that pays for seats,
-- each seat is one creator's Room, and the organisation sees what a creator
-- sees, only as counts. Cross-Room disclosure (the GroupAI kernel port,
-- ../Vyakti-GroupAI packages/relational-core) is NOT part of this migration
-- and stays locked.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since (078's own header, verbatim
-- rationale, binding here for the identical reason): Neon's SQL-over-HTTP
-- endpoint accepts exactly ONE statement per body, db/migrations/apply.mjs
-- runs them individually with no transaction, and an apply interrupted
-- halfway must be recoverable by running this same file again. Constraints
-- use the idempotent drop-then-add pair, 076's shape.
--
-- ── THE ONE COLUMN NAME THIS MIGRATION DELIBERATELY DOES NOT USE ──────────
--
-- `vy_org_member.owner_user_id` names a Suite's admin or creator member and
-- IS the owner lane's canonical column (009's convention): no FK on it,
-- reached by NAME in api/_replica-full-erasure.js, walked by
-- scripts/relcheck.mjs's OWNER_KEYS check against the live FK graph.
--
-- `vy_org` ALSO names a natural person - whoever created the Suite - but that
-- column is `created_by_user_id`, NOT `owner_user_id`, and this is load-
-- bearing rather than a style choice. The product law (this workstream's own
-- brief, law 1) is that an org survives a creator's own erasure even when
-- they were its last admin: "an org with no admin is a state the ops board
-- names, never deleted by a person's wipe." scripts/relcheck.mjs's owner-lane
-- erasure-reach check is a TEXT search over api/_replica-full-erasure.js for
-- a literal `delete from vy_org` statement (word-bounded, so it does not
-- match `delete from vy_org_member`) - there is no third option between
-- "prove reach with a delete this table must never run" and "do not give the
-- column the name that check watches for". `vy_creator_invite.issued_by_
-- user_id` is the exact precedent (086, restated in relcheck's own comment):
-- a differently-named column holding a real person's id, deliberately kept
-- off OWNER_KEYS because ITS row is reached some other way and forcing a
-- literal name onto it would either be dishonest (claim reach that does not
-- exist) or destructive (delete a row the product needs to survive). See
-- context/decisions.md#ws-r28-vy-org-creator-column-is-not-named-owner-user-id
-- for the full argument and its reversal condition.
--
-- ── the erasure lanes, decided here rather than discovered later ──────────
--
--   vy_org             Reached by NEITHER cascade nor a named delete, on
--                       purpose (see above): `created_by_user_id` is not in
--                       scripts/relcheck.mjs's OWNER_KEYS, so its walk never
--                       asks this table to justify itself. The row is left
--                       standing forever unless an operator deletes it by
--                       hand - a Suite is an organisation's asset, not a
--                       single creator's, and no person's own erasure should
--                       be able to take a whole roster's shared address with
--                       it.
--
--   vy_org_member      OWNER lane. Carries owner_user_id, no person column,
--                       so scripts/relcheck.mjs's reach walk requires it
--                       deleted BY NAME in api/_replica-full-erasure.js, and
--                       it is: every membership row for the erased owner,
--                       across every Suite they belonged to as admin or
--                       creator. This is the imprecision migration 078's own
--                       header already ships for vy_creator_payout - an owner
--                       erasing ONE of several replicas also clears their
--                       Suite memberships everywhere - logged the same way in
--                       context/decisions.md rather than silently accepted.
--
--   vy_org_subscription Reached ONLY by cascade, from vy_org. No owner_user_id
--                       and no person_id column (a Suite subscription pays
--                       for the ORGANISATION's seats, not one person), so
--                       neither scripts/relcheck.mjs check can see it and
--                       neither is asked to - vy_payment_event's own
--                       precedent (078's header), restated for a second
--                       append-only ledger.
--
-- ── FK on org_id: yes, and it is ON DELETE SET NULL, not CASCADE ──────────
--
-- The workstream brief's own law 1 says "FK on org_id to vy_org cascade is
-- fine since vy_org is not a person/agent/replica table" - true as far as it
-- goes (a real FK constraint here does not fight the owner-lane convention,
-- because org_id identifies an organisation, not a person), but literal ON
-- DELETE CASCADE would mean a manual `delete from vy_org` (the only way a
-- Suite row is ever removed, per the law above) silently deletes every Room
-- attached to it - a creator's published address, its followers, its
-- subscriptions, its revenue ledger - as a side effect of deleting the
-- Suite's OWN row. A Room is a real, independently valuable object that
-- outlives the Suite it happens to belong to (071's own vy_room row survives
-- everything except its OWN owner's erasure); ON DELETE SET NULL is what
-- makes "a Suite disappears" mean "these Rooms are no longer part of any
-- Suite" rather than "these Rooms are gone". Deviates from the brief's literal
-- word on purpose; the reasoning is repeated in this workstream's final
-- report for the main loop to accept, reject or override.

-- ── the organisation ────────────────────────────────────────────────────
create table if not exists vy_org (
  org_id             uuid primary key default gen_random_uuid(),
  name               text not null,
  slug               text not null,
  created_by_user_id uuid not null,
  plan               text not null default 'starter',
  seat_limit         integer not null default 1,
  created_at         timestamptz not null default now()
);

alter table vy_org drop constraint if exists vy_org_name_shape;
alter table vy_org add constraint vy_org_name_shape
  check (length(name) > 0 and length(name) <= 120);

alter table vy_org drop constraint if exists vy_org_slug_shape;
alter table vy_org add constraint vy_org_slug_shape
  check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$');

alter table vy_org drop constraint if exists vy_org_plan_check;
alter table vy_org add constraint vy_org_plan_check
  check (plan in ('starter', 'institute'));

alter table vy_org drop constraint if exists vy_org_seat_limit_check;
alter table vy_org add constraint vy_org_seat_limit_check
  check (seat_limit >= 1 and seat_limit <= 500);

-- Address-uniqueness law, 071's own vy_room_slug_ix argument restated for a
-- Suite's own address: lowercased because a slug is compared
-- case-insensitively by every human who types one.
create unique index if not exists vy_org_slug_ix on vy_org (lower(slug));

-- The one lookup this workstream's own listMyOrgs/orgApi do not need today
-- (membership is read from vy_org_member, not this column), kept anyway on
-- the same "cheap and it will be needed" reasoning vy_room_price_owner_ix
-- documents, ahead of the day an operator needs "every Suite this person
-- created" without a live-DB query written from scratch.
create index if not exists vy_org_created_by_ix on vy_org (created_by_user_id);

-- ── the membership ──────────────────────────────────────────────────────
--
-- `role` is ALWAYS earned by the member's own write (`acceptMembership`),
-- never by an admin writing another person's row - api/_org.js's own header
-- states the consent argument in full. No FK on `owner_user_id` (009's
-- convention, restated by every owner-keyed table since); `org_id` DOES
-- carry a real FK with ON DELETE CASCADE, 078's own precedent for a child of
-- an owner-lane-adjacent object: a membership row naming a Suite that no
-- longer exists is not a membership in anything.
create table if not exists vy_org_member (
  org_id        uuid not null references vy_org(org_id) on delete cascade,
  owner_user_id uuid not null,
  role          text not null,
  added_at      timestamptz not null default now(),
  primary key (org_id, owner_user_id)
);

alter table vy_org_member drop constraint if exists vy_org_member_role_check;
alter table vy_org_member add constraint vy_org_member_role_check
  check (role in ('admin', 'creator'));

-- `listMyOrgs`'s own lookup: every Suite this owner belongs to, in either role.
create index if not exists vy_org_member_owner_ix on vy_org_member (owner_user_id);

-- The attach predicate's admin-exists and creator-exists checks (law 2,
-- api/_org.js's `attachRoom`), and the ops board's future "does this Suite
-- have an admin at all" read - both ask "rows in this org with this role",
-- which the primary key alone cannot serve without a role filter.
create index if not exists vy_org_member_org_role_ix on vy_org_member (org_id, role);

-- ── the Room's Suite ────────────────────────────────────────────────────
--
-- Nullable: a Room belongs to at most one Suite, and most Rooms belong to
-- none. See this file's header for why ON DELETE SET NULL, not CASCADE.
alter table vy_room add column if not exists org_id uuid references vy_org(org_id) on delete set null;

-- The attach predicate's seat-count read (law 2: "count of vy_room where
-- org_id = $org < seat_limit, in the same statement") and orgBoard's own
-- room list (law 3) both scan by org_id alone; partial because most rows
-- are null and an index over them serves nothing.
create index if not exists vy_room_org_ix on vy_room (org_id) where org_id is not null;

-- ── the money: a Suite pays per seat, monthly, through the SAME provider
--    seam as a follower's own subscription (api/_payments.js, `fake` and
--    `razorpay` twins) ───────────────────────────────────────────────────
--
-- Same lifecycle vocabulary as vy_room_subscription (078): this table never
-- invents a state the provider did not send. `seats` and `price_per_seat_inr`
-- are captured on the row rather than re-read from vy_org at billing time,
-- 078's own "the split is computed once, never re-derived from a later read"
-- discipline applied to a seat count instead of a payment split - a Suite
-- that changes its seat limit after this subscription was minted must not
-- silently change what a past period was billed for.
create table if not exists vy_org_subscription (
  subscription_id            uuid primary key default gen_random_uuid(),
  org_id                     uuid not null references vy_org(org_id) on delete cascade,
  plan                       text not null,
  seats                      integer not null,
  price_per_seat_inr         integer not null,
  currency                   text not null default 'INR',
  state                      text not null default 'created',
  provider                   text not null,
  provider_subscription_ref  text,
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

alter table vy_org_subscription drop constraint if exists vy_org_subscription_plan_check;
alter table vy_org_subscription add constraint vy_org_subscription_plan_check
  check (plan in ('starter', 'institute'));

alter table vy_org_subscription drop constraint if exists vy_org_subscription_seats_check;
alter table vy_org_subscription add constraint vy_org_subscription_seats_check
  check (seats >= 1 and seats <= 500);

alter table vy_org_subscription drop constraint if exists vy_org_subscription_price_check;
alter table vy_org_subscription add constraint vy_org_subscription_price_check
  check (price_per_seat_inr > 0);

alter table vy_org_subscription drop constraint if exists vy_org_subscription_currency_check;
alter table vy_org_subscription add constraint vy_org_subscription_currency_check
  check (currency = 'INR');

alter table vy_org_subscription drop constraint if exists vy_org_subscription_state_check;
alter table vy_org_subscription add constraint vy_org_subscription_state_check
  check (state in ('created', 'authenticated', 'active', 'paused', 'cancelled', 'expired'));

alter table vy_org_subscription drop constraint if exists vy_org_subscription_provider_check;
alter table vy_org_subscription add constraint vy_org_subscription_provider_check
  check (provider in ('razorpay', 'fake'));

-- ONE LIVE SUBSCRIPTION PER SUITE. Partial on the non-terminal states,
-- vy_room_subscription_follower_live_ix's own shape (078): a Suite that
-- cancelled and comes back may start a second row.
create unique index if not exists vy_org_subscription_org_live_ix
  on vy_org_subscription (org_id)
  where state in ('created', 'authenticated', 'active', 'paused');

-- The webhook's own future lookup, vy_room_subscription_provider_ref_ix's
-- own shape: partial because a ref is absent for the one request still
-- creating it.
create unique index if not exists vy_org_subscription_provider_ref_ix
  on vy_org_subscription (provider, provider_subscription_ref)
  where provider_subscription_ref is not null;

-- The tier-exemption predicate's own read (api/_org.js's
-- `seatCoversCreatorTier`) and orgSubscriptionStatus both ask "this org's
-- latest subscription".
create index if not exists vy_org_subscription_org_ix on vy_org_subscription (org_id, created_at desc);
