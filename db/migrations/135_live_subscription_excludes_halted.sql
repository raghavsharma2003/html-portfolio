-- Migration 135 - starting a new mandate after a halted or cancelled one
-- (WS-R132). WS-R125's own "second reader" trigger (migration 130's header,
-- restated: "if a SECOND reader ever needs to tell paused from halted...
-- that is the point to widen the CHECK... and stop deriving it") reached
-- ITS OWN limit here: `mandate_state` already tells a halted mandate from a
-- merely paused one, but the two "ONE LIVE SUBSCRIPTION" partial unique
-- indexes (078's `vy_room_subscription_follower_live_ix`, 095's
-- `vy_creator_subscription_replica_live_ix`) still key off `state` ALONE,
-- and `KIND_TO_STATE` (api/_payments.js) maps `subscription.halted` to
-- `state = 'paused'` on purpose (that map's own header: "a halted
-- subscription is not this platform's decision to make final") - so a
-- halted mandate's row counts as "live" forever, `startFollowerSubscription`/
-- `startCreatorSubscription`'s own existing-live lookup always finds it, and
-- (per `context/rejected.md#ws-r125-halted-mandate-start-new-button-would-
-- have-been-a-silent-no-op`) the dead reference is all a follower or
-- creator could ever get back.
--
-- ── ONE STATEMENT PER REQUEST, IDEMPOTENT, NO DO BLOCKS ────────────────────
-- 009's law, restated by every migration since (078/091/095/099/130's own
-- headers, verbatim rationale, binding here for the identical reason).
-- Postgres has no `create or replace index` form, so each index below is
-- `drop index if exists` followed by its own `create unique index if not
-- exists` as a SEPARATE statement - running this migration twice is a
-- no-op the second time, and a partial run that dropped an index but died
-- before recreating it is recovered by simply running the file again.
--
-- ── THE PREDICATE WIDENS, THE COLUMN NEVER DOES ────────────────────────────
-- `state`'s own closed list is untouched by this migration - `applyWebhook`'s
-- tier-flip predicate, `ownerRevenue`'s counts and `evals/room-doors`'s own
-- fixture matches all keep reading it exactly as before. Only the partial
-- index's WHERE clause grows a second condition, `and mandate_state not in
-- ('halted','cancelled')` - a subscription now counts as "live" (blocks a
-- second row for the same follower/replica) only when BOTH its lifecycle
-- `state` is non-terminal AND its bank-side mandate itself has not given up
-- or been revoked. A subscription whose mandate is merely `'paused'`
-- (`state` stays `'paused'` too, `KIND_TO_STATE`'s own mapping) is still
-- "live" here on purpose - Razorpay's own FAQ (migration 130's own
-- citation) is what makes a customer-paused mandate resumable by the
-- customer alone, so this platform still treats it as one continuing
-- subscription rather than inviting a second one to race it.
--
-- No FK, no new column, no CHECK change - this migration touches nothing but
-- the two indexes' own WHERE clauses.

drop index if exists vy_room_subscription_follower_live_ix;

create unique index if not exists vy_room_subscription_follower_live_ix
  on vy_room_subscription (follower_id)
  where state in ('created','authenticated','active','paused')
    and mandate_state not in ('halted','cancelled');

drop index if exists vy_creator_subscription_replica_live_ix;

create unique index if not exists vy_creator_subscription_replica_live_ix
  on vy_creator_subscription (replica_id)
  where state in ('created','authenticated','active','paused')
    and mandate_state not in ('halted','cancelled');
