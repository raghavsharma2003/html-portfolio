-- Migration 130 - the UPI Autopay mandate lifecycle (WS-R125).
--
-- WS-R69 verified a mandate's creation and WS-R73 its seat lock. Nothing
-- handled the BANK side until now: a payer pauses or revokes a mandate
-- inside their own UPI app, or Razorpay's own retry ladder gives up and
-- halts it, entirely outside this platform, and today `vy_room_subscription
-- .state`/`vy_creator_subscription.state` only learn about it the next time
-- a charge is attempted and fails. Confirmed straight from Razorpay's own
-- docs (fetched 2026-09-05, `preferred_country=IN` cookie - see this
-- workstream's own citation in context/decisions.md for why that cookie is
-- what makes the India-specific UPI Autopay content render at all):
-- razorpay.com/docs/payments/subscriptions/faqs (dateModified
-- 2026-08-31T07:20:58.370Z), "Your customer can pause Subscriptions
-- authorised via UPI from their UPI app" and "For UPI Subscriptions, you
-- cannot resume a Subscription paused by your customer. If your customer
-- pauses a Subscription, only they can resume it."
--
-- ── ONE STATEMENT PER REQUEST, IDEMPOTENT, NO DO BLOCKS ────────────────────
-- 009's law, restated by every migration since (078/091/095/099's own
-- headers, verbatim rationale, binding here for the identical reason).
--
-- ── A SIBLING COLUMN, NEVER A WIDER `state` CHECK ───────────────────────────
--
-- `context/decisions.md#ws-r69-halted-is-a-derived-read-never-a-stored-value`
-- left `vy_room_subscription.state` alone on purpose (`applyWebhook`'s own
-- tier-flip predicate, `ownerRevenue`'s counts, and `evals/room-doors`'s own
-- fixture matches all read `state` and must keep meaning exactly what they
-- always have) and derived a VIRTUAL `'halted'` reading from the ledger
-- instead, with its own stated reversal condition: "if a SECOND reader ever
-- needs to tell paused from halted... that is the point to widen the CHECK
-- ... and stop deriving it." This workstream is that second reader (the
-- renewal sweep's due-select and the ops board's own count, `api/_renewals
-- .js`/`api/_ops.js`), but rather than widening `vy_room_subscription_state
-- _check`/`vy_creator_subscription_state_check` themselves (which would
-- still force every OTHER reader of `state` - the tier flip chief among
-- them - to learn a fifth non-terminal value it never asked for), this
-- migration adds a SIBLING column instead: `mandate_state`. `state` keeps
-- meaning exactly what it always has; `mandate_state` is the one column
-- that answers "what did the bank-side mandate itself last say", and reads
-- it directly rather than re-deriving it from the ledger on every request.
--
-- `'none'` is the default: a subscription that has never seen a bank-side
-- mandate-lifecycle event (created, authenticated, or only ever charged
-- straight through) is exactly as eligible for a renewal as one whose
-- mandate is confirmed `'active'` - `api/_renewals.js`'s own due-select
-- reads `mandate_state in ('none','active')` for precisely this reason, so
-- a database with no mandate history yet behaves exactly as it did before
-- this migration landed.
--
-- The closed list mirrors the six webhook-carried mandate events this
-- workstream's own brief names (`subscription.paused`, `.resumed`,
-- `.halted`, `.cancelled`, `.completed`, `.pending`) plus `'none'` (never
-- touched) and `'active'` (the target `.resumed` lands on, per Razorpay's
-- own Subscriptions States doc, fetched 2026-09-05, dateModified
-- 2026-08-31T07:20:56.227Z, razorpay.com/docs/payments/subscriptions/states:
-- "It is important to note that once the Subscription moves back to the
-- active state, the previous charges will not be re-attempted.").
--
-- No FK (009's convention for every column this workstream's tables carry
-- that is not itself a room_id), explicit column defaults rather than a
-- backfill statement (both tables are read far more than they are migrated,
-- and every existing row's mandate genuinely has never had one of these six
-- events observed by this platform, so `'none'`/`null` is not a placeholder
-- here, it is the honest answer for every row that already exists).

alter table vy_room_subscription add column if not exists mandate_state text not null default 'none';
alter table vy_room_subscription add column if not exists mandate_state_at timestamptz;

alter table vy_room_subscription drop constraint if exists vy_room_subscription_mandate_state_check;
alter table vy_room_subscription add constraint vy_room_subscription_mandate_state_check
  check (mandate_state in ('none', 'pending', 'active', 'paused', 'halted', 'cancelled', 'completed'));

alter table vy_creator_subscription add column if not exists mandate_state text not null default 'none';
alter table vy_creator_subscription add column if not exists mandate_state_at timestamptz;

alter table vy_creator_subscription drop constraint if exists vy_creator_subscription_mandate_state_check;
alter table vy_creator_subscription add constraint vy_creator_subscription_mandate_state_check
  check (mandate_state in ('none', 'pending', 'active', 'paused', 'halted', 'cancelled', 'completed'));
