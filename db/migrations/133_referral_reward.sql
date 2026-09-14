-- Migration 133 - the referral reward (WS-R130). WS-R86 (migration 123)
-- made a follower's referral countable in aggregate, under the n>=5 floor,
-- naming no one - `vy_room_referral(room_id, referrer_hash, created_at)`
-- carries no person column at all, on purpose (that migration's own
-- header). Nothing rewards the referral itself. This migration is the
-- thank-you: a follower whose personal link brought three friends who each
-- completed a first paid month gets one free month, capped at one reward
-- per follower per year.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since (078/090/098/123/126's own
-- headers, verbatim rationale) - binding here for the identical reason:
-- Neon's SQL-over-HTTP endpoint accepts exactly ONE statement per body, and
-- an apply interrupted halfway must be recoverable by running this same
-- file again.
--
-- ── WHY THIS NEEDS A SECOND TABLE `vy_room_referral` DOES NOT HAVE ─────────
--
-- `vy_room_referral` cannot answer "who referred THIS follower" - it was
-- built so nothing could, structurally (a room-aggregate row with no
-- person column, `referrer_hash` the only tie to a follower and one-way).
-- Granting a reward means identifying a SPECIFIC referrer's SPECIFIC
-- subscription to extend, which is a different question in kind from "how
-- many referrals happened this week" - it needs a real, per-follower link,
-- decided once, at the moment a referred follower's own membership starts
-- (`api/_room-surface.js`'s `joinRoom`, the same moment `vy_room_referral`
-- itself is written), never reconstructed later from the hash alone.
-- `vy_room_referral_credit` is that link: ONE row per referred follower
-- (`unique (referred_follower_id)`), naming the referrer's own
-- `follower_id`/`person_id` in this Room, resolved via `pgcrypto`'s
-- `digest()` re-computing `api/_room-surface.js`'s `referralHashFor` against
-- every follower already in this Room and matching the one whose hash
-- equals the `ref` the joiner carried - `pgcrypto` is already
-- `create extension if not exists` in db/schema.sql from migration 001
-- onward (083's own header states the same reuse for `vy_room_handoff`).
-- This table is written ALONGSIDE `vy_room_referral`, never instead of it -
-- the old table still answers the creator-facing aggregate question under
-- the floor; this one answers the money question, and only the reward
-- machinery (`api/_payments.js`) and a follower's own account-page read
-- (`api/_room-surface.js`'s `roomReferralProgress`) ever touch it.
--
-- ── NO FK ON THE IDENTITY COLUMNS, `vy_room_follower_whatsapp_chat`'s OWN
--    PRECEDENT (migration 128) restated ─────────────────────────────────
--
-- `referred_follower_id`/`referrer_follower_id`/`referrer_person_id` carry
-- NO foreign key to `vy_room_follower` or `vy_person` - 009's WHERE-clause-
-- binding law, restated for the identical reason migration 128 gives for
-- `vy_room_follower_whatsapp_chat.person_id`/`follower_id`: a reward already
-- granted is a financial-ledger fact (`vy_receipt`'s own precedent, migration
-- 126's header: "a follower's own receipt is proof they paid real money...
-- forgetting a Room may not also make an accountant's or a parent's copy of
-- that proof retroactively inaccurate"), and an ON DELETE CASCADE from
-- `vy_room_follower` would silently erase that proof the moment EITHER
-- party - referrer or referred - later left the Room or forgot it. `room_id`
-- keeps its real FK with cascade (a reward or a credit link that outlived
-- the Room itself names nothing); erasure reach for the identity columns is
-- the explicit by-name delete in `api/_replica-full-erasure.js`, not a
-- cascade, `vy_room_follower_whatsapp_chat`'s own restated shape exactly.
--
-- ── THE ERASURE LANE ────────────────────────────────────────────────────
--
--   vy_room_referral_credit  PERSON-ADJACENT but deliberately NOT a
--   vy_room_referral_reward  `PERSON_TABLES` (api/memory.js) entry -
--                            `vy_receipt`'s own precedent restated for two
--                            tables instead of one, and for the identical
--                            reason: both are financial/growth-ledger rows
--                            that must survive a person's own "forget
--                            everything" with their NUMBER and their
--                            ROOM intact, only the identity gone. An
--                            account-wide forget NULLS `referrer_person_id`
--                            on both tables (api/memory.js's own explicit
--                            door, right beside `vy_receipt`'s), never
--                            DELETEs the row. The narrow, per-Room
--                            `roomForget` (api/_room-surface.js) does NOT
--                            touch either table at all - `vy_room_
--                            subscription`'s and `vy_receipt`'s own
--                            restraint restated a third time: forgetting
--                            what an AI remembers about a follower is a
--                            different request in kind from forgetting
--                            that money changed hands because of them. A
--                            full REPLICA erasure (a different, stronger
--                            act) DOES delete both tables' rows by name,
--                            child-before-parent ahead of `vy_room`,
--                            in `api/_replica-full-erasure.js`.
--
-- `vy_payment_event`'s own `kind` CHECK is widened to admit
-- `'referral_reward'` - a THIRD kind of row in that ledger besides a real
-- provider webhook event: a zero-amount, platform-authored entry recording
-- the free month itself, `amount_inr = 0` (so `vy_payment_event_split_sums`
-- and `_amounts_nonneg` hold unchanged) and `signature_verified = true`
-- (that CHECK applies to every row regardless of kind; an internally
-- decided grant is not a forged webhook, so this is not a weakening of what
-- the column has always meant - the ledger only ever holds rows this
-- platform trusts). This is what lets the EXISTING, already-proven
-- `api/_payments.js#issueFollowerReceipt` mint the reward's own zero-amount
-- receipt unmodified - `vy_receipt.payment_event_id references vy_payment_
-- event(event_id)` NOT NULL, so a receipt for a reward needs a real ledger
-- row to point at exactly as a receipt for a real charge does, never a
-- second, parallel receipt mechanism.
alter table vy_payment_event drop constraint if exists vy_payment_event_kind_check;
alter table vy_payment_event add constraint vy_payment_event_kind_check check (kind in (
  'subscription.authenticated','subscription.activated','subscription.charged',
  'subscription.completed','subscription.cancelled','subscription.paused',
  'subscription.resumed','subscription.pending','subscription.halted',
  'payment.failed','referral_reward'
));

-- The identity link, written once per referred follower, at join time
-- (`api/_room-surface.js`'s `joinRoom`, the SAME gate `vy_room_referral`'s
-- own write already uses: a genuinely first-ever join, `xmax = 0`, a
-- validated `ref` hash). `unique (referred_follower_id)` is the structural
-- guarantee "one referrer per follower, ever" - the same guarantee the
-- xmax gate already gives in practice, restated here as a constraint
-- rather than only a call-site discipline.
create table if not exists vy_room_referral_credit (
  credit_id             uuid primary key,
  room_id               uuid not null references vy_room(room_id) on delete cascade,
  referred_follower_id  uuid not null,
  referrer_follower_id  uuid not null,
  referrer_person_id    uuid not null,
  created_at            timestamptz not null default now()
);
create unique index if not exists vy_room_referral_credit_referred_ix
  on vy_room_referral_credit (referred_follower_id);
-- The reward machinery's own access path: "every follower this referrer
-- has ever brought" - `api/_payments.js#maybeGrantReferralReward`'s own
-- progress count, and `api/_room-surface.js#roomReferralProgress`'s
-- identical read for the follower's own account page.
create index if not exists vy_room_referral_credit_referrer_ix
  on vy_room_referral_credit (referrer_follower_id);

-- The reward itself. `unique (referrer_follower_id, room_id, year_key)` is
-- THE CAP - the last arbiter under concurrency, per this workstream's own
-- brief: two webhook deliveries racing to grant the third friend's reward
-- can both compute "count reaches three", but only one can ever insert
-- successfully. `year_key` is the SAME financial-year string
-- `api/_receipt.js#financialYearFor` already computes for every receipt
-- (`"2026-27"`), reused rather than a second calendar-year convention
-- invented for this one table - one follower, one room, one reward per
-- financial year.
create table if not exists vy_room_referral_reward (
  reward_id             uuid primary key,
  room_id               uuid not null references vy_room(room_id) on delete cascade,
  referrer_follower_id  uuid not null,
  referrer_person_id    uuid not null,
  granted_at            timestamptz not null default now(),
  period_extended_to    timestamptz not null,
  year_key              text not null,
  reason                text not null default 'referral_reward',
  constraint vy_room_referral_reward_year_key_check check (year_key ~ '^[0-9]{4}-[0-9]{2}$')
);
create unique index if not exists vy_room_referral_reward_cap_ix
  on vy_room_referral_reward (referrer_follower_id, room_id, year_key);
-- `api/_payments.js#reconcilePeriod`'s own new `referral_rewards` line -
-- every reward granted inside one payout period, this Room's own price at
-- read time (`vy_room_price`, no price history for this line, the same
-- limitation `reconcilePeriod`'s own Suite-lane section already states for
-- a different join).
create index if not exists vy_room_referral_reward_room_granted_ix
  on vy_room_referral_reward (room_id, granted_at);
