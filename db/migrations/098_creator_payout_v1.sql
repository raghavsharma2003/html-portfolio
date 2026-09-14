-- Migration 098 - the creator payout as a product (WS-R36): a monthly
-- statement a creator can read, a payout that reaches a provider, and the
-- Suite distribution rule migration 095's own header left as an open item
-- ("Suite seat revenue is... NOT distributed to the Suite's attached
-- creators' own payout figures").
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since (078/091/095's own headers,
-- verbatim rationale, binding here for the identical reason): Neon's
-- SQL-over-HTTP endpoint accepts exactly ONE statement per body, and an
-- apply interrupted halfway must be recoverable by running this same file
-- again.
--
-- ── LAW 2: TDS_RATE_BP is a named constant, not a tax opinion ─────────────
-- See api/_payments.js's own TDS_RATE_BP_DEFAULT and TDS_DISCLOSURE_SENTENCE
-- for the section the operator believes applies and the standing instruction
-- that the owner must confirm it with an accountant before the first real
-- payout. Nothing in this migration changes that default (078's own
-- no-fake-numbers reasoning for it is restated there, not re-argued here).
--
-- ── LAW 3: the Suite seat share is a flat per-attached-Room formula, never
--    a re-derivation of the Suite's own ledger ────────────────────────────
-- `suite_share_inr` is captured ON THE PAYOUT ROW at build time
-- (api/_payments.js's `runPayoutRollup`), read fresh from `vy_room.org_id`
-- and that Suite's own ACTIVE `vy_org_subscription.price_per_seat_inr` at
-- the moment the payout is built - never re-read later, migration 078's own
-- "the split is computed once, never re-derived from a later read"
-- discipline applied to a third money line. This is a DIFFERENT choice from
-- fanning out a share of what a Suite's own `vy_payment_event` rows actually
-- collected: context/decisions.md#ws-r33-suite-seat-revenue-not-distributed-to-creators's
-- own reversal condition names that alternative, and it does not fit here
-- either - a Suite pays ONE subscription for N seats, so there is no
-- per-attached-Room AMOUNT COLLECTED to divide, only a flat per-seat PRICE
-- known ahead of any billing event. `SUITE_SEAT_SHARE_BP` is a named
-- constant with its own reversal condition in api/_payments.js: the day a
-- Suite wants a different split, this becomes a per-org column rather than
-- one platform-wide basis-point figure.
--
-- ── LAW 4: no bank detail is ever stored here ──────────────────────────────
-- `vy_creator_payout_account.fund_account_ref` is a REFERENCE the provider
-- issued (RazorpayX's own Fund Account id) after the creator's bank-detail
-- exchange happened entirely on the provider's own side - the same "a live
-- credential... structurally cannot sit in a table the routing path selects,
-- joins and logs" argument api/_channel-secrets.js makes for a creator's bot
-- token, applied here to a bank account instead of an API key. One row per
-- (owner, provider): an owner who is on `fake` in staging and `razorpay` in
-- production keeps both references on file rather than overwriting one with
-- the other.
--
-- ── LAW 5: the state machine is a closed set, one transition each ─────────
-- built -> pending_account | queued -> sent -> settled | failed. Every arrow
-- is exactly ONE UPDATE whose WHERE names the state(s) it leaves -
-- api/_payments.js's own `applyWebhook` tier-flip precedent, restated for a
-- payout instead of a subscription. `failed` is retried by an OPERATOR op
-- only, never a sweep - api/_ops.js's `OPS_OWNER_USER_IDS` gate, this
-- workstream's own new op in api/payments.js.
--
-- ── the erasure lane ────────────────────────────────────────────────────
--
--   vy_creator_payout_account   OWNER lane (owner_user_id, no person
--                                column), deleted BY NAME in
--                                api/_replica-full-erasure.js on
--                                vy_creator_payout's own precedent (078),
--                                folded into that table's existing
--                                "owner_room_payments" receipt class rather
--                                than a new one: a fund account reference is
--                                a detail of the Room's money, not a
--                                different kind of record.

alter table vy_creator_payout add column if not exists suite_share_inr integer not null default 0;
alter table vy_creator_payout add column if not exists provider_payout_ref text;

alter table vy_creator_payout drop constraint if exists vy_creator_payout_state_check;
alter table vy_creator_payout add constraint vy_creator_payout_state_check
  check (state in ('built','pending_account','queued','sent','settled','failed'));

alter table vy_creator_payout alter column state set default 'built';

-- THE ARITHMETIC GUARANTEE, widened. `gross_inr = take_inr + tds_inr +
-- net_inr` (vy_creator_payout_sums, unchanged by this migration) already
-- holds with suite_share_inr folded into gross_inr and net_inr by
-- api/_payments.js's own query - see that file's comment for the algebra.
-- This CHECK is the second, independent guarantee: no component may ever be
-- negative, suite_share_inr included.
alter table vy_creator_payout drop constraint if exists vy_creator_payout_amounts_nonneg;
alter table vy_creator_payout add constraint vy_creator_payout_amounts_nonneg
  check (gross_inr >= 0 and take_inr >= 0 and net_inr >= 0 and tds_inr >= 0 and suite_share_inr >= 0);

-- A Suite's own share can never exceed the whole of what a payout claims to
-- be worth - a structural sanity check on top of the query that computes it,
-- the same "unrepresentable, not merely unproduced" discipline
-- vy_payment_event_signature_verified uses one migration family over.
alter table vy_creator_payout drop constraint if exists vy_creator_payout_suite_share_bound;
alter table vy_creator_payout add constraint vy_creator_payout_suite_share_bound
  check (suite_share_inr <= gross_inr);

-- The operator's own failed list (`retryFailedPayout`'s read, wired through
-- api/payments.js's `retry_failed_payout` op, gated by OPS_OWNER_USER_IDS):
-- partial, on the one state an operator ever needs to find across every
-- owner at once.
create index if not exists vy_creator_payout_failed_ix
  on vy_creator_payout (created_at)
  where state = 'failed';

-- The owner's own statement list read (`payoutStatements`): every payout for
-- one owner, newest period first. The existing vy_creator_payout_period_ix
-- unique index (owner_user_id, period_start, period_end) could already serve
-- this as a backward scan; this one is added anyway on vy_org_created_by_ix's
-- own "cheap and it will be needed, named for the exact query it serves"
-- reasoning rather than relying on planner behaviour nobody here has
-- EXPLAINed yet.
create index if not exists vy_creator_payout_owner_list_ix
  on vy_creator_payout (owner_user_id, period_start desc);

-- ── the fund account reference ──────────────────────────────────────────
create table if not exists vy_creator_payout_account (
  account_id        uuid primary key default gen_random_uuid(),
  owner_user_id     uuid not null,
  provider          text not null,
  fund_account_ref  text not null,
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table vy_creator_payout_account drop constraint if exists vy_creator_payout_account_provider_check;
alter table vy_creator_payout_account add constraint vy_creator_payout_account_provider_check
  check (provider in ('razorpay','fake'));

alter table vy_creator_payout_account drop constraint if exists vy_creator_payout_account_ref_shape;
alter table vy_creator_payout_account add constraint vy_creator_payout_account_ref_shape
  check (length(fund_account_ref) > 0 and length(fund_account_ref) <= 200);

-- One live reference per (owner, provider): registering a second time for
-- the SAME provider replaces the first (api/_payments.js's `registerFundAccount`
-- upserts on this exact pair), never races a second row for it.
create unique index if not exists vy_creator_payout_account_owner_provider_ix
  on vy_creator_payout_account (owner_user_id, provider);
