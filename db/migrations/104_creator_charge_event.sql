-- Migration 104 - the creator-tier charge ledger (WS-R42, "the money
-- reconciles"). Migration 095's own header, and
-- context/decisions.md#ws-r33-creator-tier-charge-has-no-ledger-row, both
-- name the same reversal condition in the same words: "the day this product
-- needs a reconciliation history for creator-tier charges (a support
-- dispute, an accounting export), add a dedicated append-only ledger shaped
-- like vy_payment_event but scoped by owner_user_id/replica_id rather than
-- retrofitting a third lane onto a table already carrying two." This
-- workstream's whole job is that reconciliation, so this is that day.
--
-- ── WHY A NEW TABLE, NOT A THIRD DISJUNCT ON vy_payment_event_one_lane ────
--
-- This workstream's own brief says "under migration 095's two-lane CHECK,"
-- which reads, on a first pass, like an instruction to widen that CHECK to
-- three. Read literally it would be wrong: `vy_payment_event`'s
-- `platform_take_inr`/`creator_share_inr` columns exist to record a SPLIT,
-- and a creator's own subscription to the platform has no second party to
-- split revenue with - 100% is platform revenue by definition (095's own
-- header, verbatim). Widening the CHECK to a third disjunct would still
-- require every row in that third lane to carry SOME value in both split
-- columns, inventing meaning for them on a row that is not a split - exactly
-- the fabricated-precision failure `context/rejected.md`'s no-fake-numbers
-- law forbids for a proxy metric, applied here to a column's own meaning.
-- `context/decisions.md#ws-r33-payment-event-two-mutually-exclusive-lanes`'s
-- own reversal condition anticipates this exact moment and points at the
-- OTHER entry's reversal condition for what to do about it: build the
-- dedicated table, never the third disjunct. This migration is that table,
-- and reads "under migration 095's two-lane CHECK" as "the owner-lane
-- reasoning migration 095 established," not as "widen that CHECK" - logged
-- with the full argument in context/decisions.md#ws-r42-third-lane-rejected-
-- dedicated-table-built-instead so a future session does not re-open it
-- without reading why it was closed.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since (078/091/095/099's own
-- headers, verbatim rationale, binding here for the identical reason).
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────
--
-- `vy_creator_charge_event` mirrors `vy_payment_event`'s own shape (078) -
-- provider, a provider-issued ref, an amount, a signature-verified flag, a
-- payload hash, a received-at timestamp - but scoped by
-- `owner_user_id`/`replica_id` (owner lane, never person lane, 095's own
-- `vy_creator_subscription` precedent restated) instead of a room+
-- subscription pair, and with NO split columns at all: the whole amount is
-- platform revenue, reported as its own number by `api/_payments.js`'s
-- `reconcile`, never distributed. `amount_inr` is whole rupees, matching
-- `vy_payment_event.amount_inr` (078's own header: "the provider's own
-- amounts are paise and are divided by 100 the moment a webhook is parsed,
-- never stored as paise here") - the SAME conversion `parseWebhookPayload`
-- already performs for the other two lanes, restated for this one rather
-- than reinvented. `subscription_id` carries a real FK CASCADE to
-- `vy_creator_subscription` - `vy_payment_event.subscription_id`'s own
-- precedent for a subscription reference (as opposed to
-- `owner_user_id`/`replica_id`, which per 009 carry no FK: the
-- WHERE-clause-binding convention every owner/replica column in this
-- product follows).
--
-- ── THE IDEMPOTENCY GUARANTEE, THE SAME SHAPE AS 078's ─────────────────────
-- `provider_charge_ref` is Razorpay's own `X-Razorpay-Event-Id` header, the
-- SAME value `api/_payments.js`'s `applyWebhook` already requires and
-- already uses as `vy_payment_event`'s own idempotency key for the other two
-- lanes - never a second identifier invented for this lane. The unique index
-- below is a NEW index on this NEW table (an index cannot span two tables),
-- but it is the identical pattern as `vy_payment_event_provider_ref_ix`
-- (078), restated here rather than literally reused.
--
-- ── WHEN A ROW IS WRITTEN ────────────────────────────────────────────────
-- Only when the webhook event actually represents a landed charge
-- (`subscription.charged` or `subscription.activated`, api/_payments.js's
-- own `CREATOR_CHARGE_KINDS`) with a positive amount - never for
-- `subscription.pending`/`payment.failed`/a pause/a cancellation, which flip
-- `vy_creator_subscription.state` exactly as before but write no charge row.
-- A creator whose Suite seat already covers them (`seatCoversCreatorTier`,
-- WS-R28) never reaches this table at all: `startCreatorSubscription`
-- refuses before any provider call, so no subscription, and therefore no
-- webhook, can ever exist for them - law 1's own words, restated: writes
-- nothing, by construction, not by a check added here.
--
-- ── the erasure lane ────────────────────────────────────────────────────
--
--   vy_creator_charge_event   OWNER lane (owner_user_id, no person column),
--                              deleted BY NAME in
--                              api/_replica-full-erasure.js on
--                              vy_creator_subscription's own precedent (095):
--                              scoped by BOTH replica_id and owner_user_id
--                              directly, exact rather than owner-wide,
--                              deleted CHILD-BEFORE-PARENT ahead of
--                              vy_creator_subscription even though the FK
--                              above would cascade it anyway - "relying on a
--                              cascade means relying on an FK nobody
--                              re-checks" (071's own words, restated here for
--                              the Nth time). Folded into the EXISTING
--                              `owner_creator_tier_subscription` receipt
--                              class (095's own class, not a new one): this
--                              table is billing HISTORY for that same
--                              subscription, not a different kind of record
--                              from it - `owner_room_pulse`'s own "a
--                              combo-bucket folds into the header's class
--                              rather than mints one" precedent, restated.
--                              Not filed in `PERSON_TABLES` (api/memory.js):
--                              `evals/persontables.mjs`'s own `ownerLane()`
--                              rule recognises it by the literal
--                              `owner_user_id` column with no person-side
--                              column beside it, the same rule that already
--                              excludes `vy_creator_subscription` and
--                              `vy_creator_payout`.

create table if not exists vy_creator_charge_event (
  charge_id             uuid primary key default gen_random_uuid(),
  owner_user_id          uuid not null,
  replica_id              uuid not null,
  subscription_id         uuid not null references vy_creator_subscription(subscription_id) on delete cascade,
  provider                text not null,
  provider_charge_ref     text not null,
  amount_inr              integer not null default 0,
  received_at             timestamptz not null default now(),
  signature_verified      boolean not null,
  payload_hash             text not null
);

alter table vy_creator_charge_event drop constraint if exists vy_creator_charge_event_provider_check;
alter table vy_creator_charge_event add constraint vy_creator_charge_event_provider_check
  check (provider in ('razorpay','fake'));

alter table vy_creator_charge_event drop constraint if exists vy_creator_charge_event_amount_nonneg;
alter table vy_creator_charge_event add constraint vy_creator_charge_event_amount_nonneg
  check (amount_inr >= 0);

-- A ROW WITH A FALSE SIGNATURE MAY NOT EXIST. `applyWebhook` never attempts
-- this insert unless the webhook's HMAC already checked out -
-- `vy_payment_event_signature_verified`'s own "structurally impossible, not
-- merely undesired" discipline, restated on this table.
alter table vy_creator_charge_event drop constraint if exists vy_creator_charge_event_signature_verified;
alter table vy_creator_charge_event add constraint vy_creator_charge_event_signature_verified
  check (signature_verified = true);

alter table vy_creator_charge_event drop constraint if exists vy_creator_charge_event_payload_hash;
alter table vy_creator_charge_event add constraint vy_creator_charge_event_payload_hash
  check (payload_hash ~ '^[0-9a-f]{64}$');

-- THE IDEMPOTENCY GUARANTEE - see this file's own header. A provider retries
-- a webhook it did not get a 200 for; `on conflict (provider,
-- provider_charge_ref) do nothing` in api/_payments.js is what makes a
-- replay a no-op rather than a second charge row for the same event.
create unique index if not exists vy_creator_charge_event_provider_ref_ix
  on vy_creator_charge_event (provider, provider_charge_ref);

-- `reconcile`'s own read: every charge for this owner+replica this period -
-- `vy_payment_event_subscription_ix`'s own shape (078), restated here.
create index if not exists vy_creator_charge_event_owner_ix
  on vy_creator_charge_event (owner_user_id, received_at desc);

-- The reconcile's own period scan across every owner - `vy_payment_event`
-- carries no equivalent index (its own reads are always room- or
-- subscription-scoped first), but this ledger's whole reason to exist is a
-- platform-wide "sum every charge in [start, end)" read, so it earns its own
-- index rather than relying on a sequential scan that grows with every
-- creator this product ever signs up.
create index if not exists vy_creator_charge_event_received_ix
  on vy_creator_charge_event (received_at);
