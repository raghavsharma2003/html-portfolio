-- Migration 078 - the durable ledger and the provider seam for Vyakti Rooms
-- money (WS-R11). Two revenue lines, per the Rooms plan: the CREATOR pays for
-- capacity and assurance (Build free, Room, Studio, Institute - a Phase 2
-- concern, no table here); the FOLLOWER pays for the relationship, INR
-- 299-599 a month, set by the creator inside that band, unlimited within fair
-- use. Platform take 25%, shown as one number.
--
-- Payments are Phase 1 work. This migration is Phase 0: the tables so Phase 1
-- can turn a real provider on with an env var, and nothing here spends money -
-- `PAYMENTS_PROVIDER` defaults to `none` (api/_payments.js) and every write
-- through it is refused, named, before any provider is ever called.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since and binding here for the same
-- reason: Neon's SQL-over-HTTP endpoint accepts exactly ONE statement per
-- body, db/migrations/apply.mjs runs them individually with no transaction,
-- and an apply interrupted halfway must be recoverable by running this same
-- file again. Constraints use the idempotent drop-then-add pair, 076's shape.
--
-- ── no foreign keys on owner_user_id / person_id ───────────────────────────
-- 009's convention, restated by every owner/person-keyed table since: the
-- binding is a WHERE clause, not a constraint, checked at read time by the
-- application rather than by Postgres. `room_id` DOES carry a real FK with ON
-- DELETE CASCADE on every table below, on 071's own precedent (vy_room_thread,
-- vy_room_follower): a subscription or a priced room that outlived the room it
-- names is not a follower relationship with anyone, and the cascade is kept
-- even though the erasure job below also deletes these rows BY NAME ahead of
-- the room delete - "relying on a cascade means relying on an FK nobody
-- re-checks" (071's own words, restated rather than re-argued).
--
-- ── the erasure lanes, decided here rather than discovered later ──────────
--
--   vy_room_price        OWNER lane. Carries owner_user_id, no person column,
--   vy_creator_payout     so scripts/relcheck.mjs's reach walk requires both
--                         deleted BY NAME in api/_replica-full-erasure.js, and
--                         both are. vy_creator_payout has no room_id (a payout
--                         is a roll-up across every room an owner has), so its
--                         erasure scope is owner_user_id alone - the one
--                         imprecision this migration ships with, logged in
--                         context/decisions.md rather than silently accepted:
--                         an owner erasing ONE of several replicas would also
--                         clear payout rows earned by a DIFFERENT, still-live
--                         replica of theirs. No creator in this product has
--                         more than one live replica today; the reversal
--                         condition is the day one does.
--
--   vy_room_subscription  PERSON lane, but NOT wiped by the account-wide
--                         "forget everything" pass the way a Room membership
--                         is. A UPI Autopay mandate keeps debiting a real bank
--                         account whether or not this table still names it;
--                         deleting the pointer is not privacy, it is losing
--                         the only local record of a live financial
--                         obligation. So it is filed in api/memory.js's
--                         PERSON_TABLES (lane "relational", satisfying
--                         scripts/relcheck.mjs's manifest-coverage check,
--                         which is honest: this IS a record of a person) with
--                         `wipeWhere: "state in ('cancelled','expired')"` -
--                         the whole-wipe loop can only ever remove a
--                         subscription that has already reached a terminal
--                         state, exactly api/_room-surface.js's
--                         "a predicate on the write is a guarantee" discipline
--                         applied to money instead of a message cap. A live
--                         one survives an account wipe as the one honest
--                         record that a mandate may still be charging someone
--                         who asked this platform to forget them - which is a
--                         product problem for Phase 1's provider-cancel flow
--                         to close, not one a blind delete may paper over.
--
--   vy_payment_event      Reached ONLY by cascade, from vy_room_subscription
--                         and from vy_room, never deleted by name and never
--                         listed anywhere: it has neither an owner_user_id nor
--                         a person_id column (it is addressed by room_id and
--                         subscription_id only, the way a real payment
--                         processor's own ledger is), so neither
--                         scripts/relcheck.mjs check can see it and neither is
--                         asked to. It is an APPEND-ONLY ledger of what money
--                         moved and when; nothing above ever mutates a row in
--                         it, only the two cascades ever remove one.

-- ── the price ────────────────────────────────────────────────────────────
--
-- One row per room. The band (299-599) is a CHECK here and the same two
-- numbers as JS constants in api/_payments.js (ROOM_PRICE_MIN_INR,
-- ROOM_PRICE_MAX_INR) - mirrored rather than read from the database on every
-- request, `api/_room-publish.js`'s ROOM_FREE_CAP_MIN/MAX precedent exactly:
-- a bad value returns a named reason before the database is ever asked.
--
-- `platform_take_bp` is a column, not a constant, on the same argument
-- migration 071 makes for `free_monthly_messages`: "a product decision that
-- lives in a deployed constant moves by deploy." Basis points (2500 = 25.00%)
-- rather than a fraction, so the CHECK bound is an integer range with no
-- floating-point rounding question anywhere near it.
create table if not exists vy_room_price (
  price_id           uuid primary key default gen_random_uuid(),
  room_id            uuid not null references vy_room(room_id) on delete cascade,
  owner_user_id      uuid not null,
  follower_price_inr integer not null default 299,
  currency           text not null default 'INR',
  platform_take_bp   integer not null default 2500,
  updated_at         timestamptz not null default now()
);

-- One price per room. Idempotent on the room, the way vy_room_replica_ix is
-- idempotent on the replica: a second "set price" for the same room is an
-- update, never a second row racing the first for which one a subscriber sees.
create unique index if not exists vy_room_price_room_ix on vy_room_price (room_id);

-- The owner's own read (the Money strip) is scoped here without a join.
create index if not exists vy_room_price_owner_ix on vy_room_price (owner_user_id, room_id);

alter table vy_room_price drop constraint if exists vy_room_price_band;
alter table vy_room_price add constraint vy_room_price_band
  check (follower_price_inr >= 299 and follower_price_inr <= 599);

alter table vy_room_price drop constraint if exists vy_room_price_currency;
alter table vy_room_price add constraint vy_room_price_currency
  check (currency = 'INR');

alter table vy_room_price drop constraint if exists vy_room_price_take_bp;
alter table vy_room_price add constraint vy_room_price_take_bp
  check (platform_take_bp >= 0 and platform_take_bp <= 10000);

-- ── the subscription ─────────────────────────────────────────────────────
--
-- `provider_subscription_ref` is a REFERENCE, never a secret - the API key
-- that could act on it lives behind api/_channel-secrets.js's backend seam,
-- copied wholesale rather than duplicated (see api/_payments.js's header).
-- Nullable until the provider call that mints it returns; a row may exist in
-- state 'created' with no ref for the single request that is still in flight.
--
-- `state` is the provider's own subscription lifecycle (Razorpay Subscriptions
-- API, fetched 2026-09-03: created -> authenticated -> active, with
-- pending/halted folding back to active on the provider's side and never
-- becoming a state of ours - see api/_payments.js for the full mapping note).
-- `paused`/`cancelled`/`expired` are terminal or reversible exactly as the
-- provider's are. This table never invents a state the provider did not send.
create table if not exists vy_room_subscription (
  subscription_id         uuid primary key default gen_random_uuid(),
  room_id                 uuid not null references vy_room(room_id) on delete cascade,
  person_id               uuid not null,
  follower_id             uuid not null references vy_room_follower(follower_id) on delete cascade,
  provider                text not null,
  provider_subscription_ref text,
  state                   text not null default 'created',
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table vy_room_subscription drop constraint if exists vy_room_subscription_provider_check;
alter table vy_room_subscription add constraint vy_room_subscription_provider_check
  check (provider in ('razorpay','fake'));

alter table vy_room_subscription drop constraint if exists vy_room_subscription_state_check;
alter table vy_room_subscription add constraint vy_room_subscription_state_check
  check (state in ('created','authenticated','active','paused','cancelled','expired'));

-- THE TIER FLIP'S OTHER HALF. api/_room-surface.js's cap predicate already
-- reads `f.tier <> 'free'` to skip the free-cap UPDATE; this table is what a
-- webhook flips that column FROM, in the SAME statement that lands this row's
-- own state change (api/_payments.js's `applyProviderEvent` - a CTE chain,
-- 009/074's own "a predicate on the write is a guarantee" applied to a second
-- table in one request, `_provider-budget.js`'s multi-CTE shape one file
-- over). No trigger: a trigger is a rule nobody reading the write can see.
create index if not exists vy_room_subscription_room_person_ix
  on vy_room_subscription (room_id, person_id);

-- The webhook's own lookup, and its idempotency guard's other half (the
-- ledger below is idempotent on the EVENT; this is what a webhook's "which
-- subscription does this event mean" resolves against). Partial because a ref
-- is absent for the one request still creating it.
create unique index if not exists vy_room_subscription_provider_ref_ix
  on vy_room_subscription (provider, provider_subscription_ref)
  where provider_subscription_ref is not null;

-- ONE LIVE SUBSCRIPTION PER FOLLOWER. Partial on the non-terminal states, so a
-- follower who cancelled and comes back may start a second row - the same
-- shape vy_room_follower_person_ix enforces one membership rather than one
-- membership EVER.
create unique index if not exists vy_room_subscription_follower_live_ix
  on vy_room_subscription (follower_id)
  where state in ('created','authenticated','active','paused');

-- ── the ledger ───────────────────────────────────────────────────────────
--
-- APPEND-ONLY. Nothing above this line ever UPDATEs a vy_payment_event row;
-- `state` transitions live on vy_room_subscription, this table only ever
-- grows. `amount_inr` is whole rupees, matching `follower_price_inr` - the
-- provider's own amounts are paise and are divided by 100 the moment a
-- webhook is parsed, never stored as paise here.
--
-- THE SPLIT IS COMPUTED ONCE, on the INSERT, from the price row's
-- `platform_take_bp` AT THAT MOMENT - never re-derived from a later read of
-- vy_room_price, which a creator may have changed since. `platform_take_inr +
-- creator_share_inr = amount_inr` is a CHECK, not a hope: a rounding bug in
-- the split arithmetic fails the write loudly instead of quietly shorting
-- somebody's payout by a few paise, forever, silently.
create table if not exists vy_payment_event (
  event_id            uuid primary key default gen_random_uuid(),
  provider             text not null,
  provider_event_ref   text not null,
  room_id              uuid not null references vy_room(room_id) on delete cascade,
  subscription_id      uuid not null references vy_room_subscription(subscription_id) on delete cascade,
  kind                 text not null,
  amount_inr           integer not null default 0,
  platform_take_inr    integer not null default 0,
  creator_share_inr    integer not null default 0,
  received_at          timestamptz not null default now(),
  signature_verified   boolean not null,
  payload_hash         text not null
);

alter table vy_payment_event drop constraint if exists vy_payment_event_provider_check;
alter table vy_payment_event add constraint vy_payment_event_provider_check
  check (provider in ('razorpay','fake'));

-- Razorpay's own subscription webhook event names (Subscriptions Webhook
-- Events, fetched 2026-09-03) plus payment.failed, the one payment-level event
-- this ledger cares about. No event this platform did not ask the provider to
-- send may ever become a row - an unrecognised `kind` is a refusal in
-- api/_payments.js, never a permissive CHECK relaxed to let it through.
alter table vy_payment_event drop constraint if exists vy_payment_event_kind_check;
alter table vy_payment_event add constraint vy_payment_event_kind_check
  check (kind in (
    'subscription.authenticated','subscription.activated','subscription.charged',
    'subscription.completed','subscription.cancelled','subscription.paused',
    'subscription.resumed','subscription.pending','subscription.halted',
    'payment.failed'
  ));

alter table vy_payment_event drop constraint if exists vy_payment_event_amounts_nonneg;
alter table vy_payment_event add constraint vy_payment_event_amounts_nonneg
  check (amount_inr >= 0 and platform_take_inr >= 0 and creator_share_inr >= 0);

-- THE ARITHMETIC GUARANTEE. See the header: this is the constraint that makes
-- a silent split rounding error unrepresentable rather than merely unlikely.
alter table vy_payment_event drop constraint if exists vy_payment_event_split_sums;
alter table vy_payment_event add constraint vy_payment_event_split_sums
  check (platform_take_inr + creator_share_inr = amount_inr);

-- A ROW WITH A FALSE SIGNATURE MAY NOT EXIST. api/_payments.js never attempts
-- this insert unless the webhook's HMAC already checked out; this constraint
-- is what makes "insert the event, note that verification failed" structurally
-- impossible rather than a discipline the caller has to remember - the exact
-- shape migration 076's `vy_replica_drift_report_measured_shape` uses for "a
-- fake number must be unrepresentable, not merely unproduced."
alter table vy_payment_event drop constraint if exists vy_payment_event_signature_verified;
alter table vy_payment_event add constraint vy_payment_event_signature_verified
  check (signature_verified = true);

alter table vy_payment_event drop constraint if exists vy_payment_event_payload_hash;
alter table vy_payment_event add constraint vy_payment_event_payload_hash
  check (payload_hash ~ '^[0-9a-f]{64}$');

-- THE IDEMPOTENCY GUARANTEE. A provider retries a webhook it did not get a 200
-- for; `on conflict (provider, provider_event_ref) do nothing` in
-- api/_payments.js is what makes a replay a no-op rather than a second split
-- applied to the same rupee.
create unique index if not exists vy_payment_event_provider_ref_ix
  on vy_payment_event (provider, provider_event_ref);

create index if not exists vy_payment_event_subscription_ix
  on vy_payment_event (subscription_id, received_at desc);

-- The owner's revenue view and the payout roll-up both ask "this room's
-- events this period" without a join through the subscription table.
create index if not exists vy_payment_event_room_ix
  on vy_payment_event (room_id, received_at desc);

-- ── the payout roll-up ───────────────────────────────────────────────────
--
-- One row per owner per period. `gross_inr = take_inr + tds_inr + net_inr` is
-- the same arithmetic guarantee as the ledger's split, one level up: the
-- platform's cut, the tax withheld, and what actually reaches the creator's
-- bank account must sum to what followers paid, or the roll-up SQL has a bug
-- it cannot hide behind a plausible-looking row.
create table if not exists vy_creator_payout (
  payout_id      uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  period_start   timestamptz not null,
  period_end     timestamptz not null,
  gross_inr      integer not null default 0,
  take_inr       integer not null default 0,
  net_inr        integer not null default 0,
  tds_inr        integer not null default 0,
  state          text not null default 'pending',
  created_at     timestamptz not null default now()
);

alter table vy_creator_payout drop constraint if exists vy_creator_payout_state_check;
alter table vy_creator_payout add constraint vy_creator_payout_state_check
  check (state in ('pending','paid'));

alter table vy_creator_payout drop constraint if exists vy_creator_payout_amounts_nonneg;
alter table vy_creator_payout add constraint vy_creator_payout_amounts_nonneg
  check (gross_inr >= 0 and take_inr >= 0 and net_inr >= 0 and tds_inr >= 0);

alter table vy_creator_payout drop constraint if exists vy_creator_payout_sums;
alter table vy_creator_payout add constraint vy_creator_payout_sums
  check (gross_inr = take_inr + tds_inr + net_inr);

alter table vy_creator_payout drop constraint if exists vy_creator_payout_period_order;
alter table vy_creator_payout add constraint vy_creator_payout_period_order
  check (period_end > period_start);

-- Idempotent on (owner, period): re-running the monthly sweep for a period it
-- already rolled up is a no-op, `on conflict (owner_user_id, period_start,
-- period_end) do nothing` in api/_payments.js.
create unique index if not exists vy_creator_payout_period_ix
  on vy_creator_payout (owner_user_id, period_start, period_end);

-- The follower's own status read (`followerSubscriptionStatus`: latest row
-- for this follower in ANY state, ordered by created_at) cannot use
-- vy_room_subscription_follower_live_ix, which is partial on the live states,
-- so it sequential-scanned under EXPLAIN on the live database at the merge.
-- One full index on (follower_id, created_at desc) serves it and the live
-- lookup alike. Added at the WS-R11 merge, applied live in the same pass.
create index if not exists vy_room_subscription_follower_ix
  on vy_room_subscription (follower_id, created_at desc);
