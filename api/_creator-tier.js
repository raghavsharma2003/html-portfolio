// The creator tier read (WS-R33, migration 095). "A vy_creator_tier read
// (pure over rows) returns covered_by_suite, free, or the plan's tier
// names" - the workstream brief's own words. `creatorTierFromRows` is that
// PURE core: given whether a Suite seat covers this creator and their own
// latest `vy_creator_subscription` row, it decides one label and nothing
// else, no database in scope. `readCreatorTier` is the thin DB-backed
// wrapper the studio and api/payments.js actually call - `api/_org.js`'s
// own "the decision lives where a fake db can reach it" restated one layer
// down: the pure function is what an eval drives directly, the wrapper is
// what a handler calls.
//
// `seatCoversCreatorTier` (api/_org.js, WS-R28) is checked FIRST and wins
// outright - a covered creator's own subscription state, if any, is never
// consulted for the LABEL (though it still exists in the database exactly
// as they left it; being covered does not cancel a subscription, it only
// changes what this read reports and what `startCreatorSubscription`
// refuses).
import { seatCoversCreatorTier } from "./_org.js";

/**
 * Pure. `suiteCovered`: boolean. `subscriptionRow`: the latest
 * `vy_creator_subscription` row for this owner+replica, or null/undefined.
 * Returns one of: "covered_by_suite", "free", or a plan name ("room",
 * "studio").
 */
export function creatorTierFromRows({ suiteCovered, subscriptionRow }) {
  if (suiteCovered) return "covered_by_suite";
  if (subscriptionRow && subscriptionRow.state === "active") return subscriptionRow.plan;
  return "free";
}

function clientCreatorSubscription(row) {
  if (!row) return null;
  return {
    subscription_id: row.subscription_id,
    plan: row.plan,
    price_inr: Number(row.price_inr),
    currency: row.currency,
    state: row.state,
    provider: row.provider,
    current_period_start: row.current_period_start ?? null,
    current_period_end: row.current_period_end ?? null,
    // WS-R37: distinct from `state` on purpose - see api/_renewals.js's own
    // header for why cancelling never flips `state` early.
    cancel_at_period_end: row.cancel_at_period_end === true,
  };
}

/**
 * The studio's own read: "your seat in <Suite> covers this Room" or the
 * creator's real tier state, never more than that - `followerSubscriptionStatus`'s
 * own honesty one file over. Real null when nothing was ever started.
 */
export async function readCreatorTier(db, ownerUserId, replicaId, deps = {}) {
  const suiteCovered = await (deps.seatCoversCreatorTier ?? seatCoversCreatorTier)(db, ownerUserId, replicaId);
  const rows = await db(
    `select subscription_id, plan, price_inr, currency, state, provider, current_period_start, current_period_end,
            cancel_at_period_end
       from vy_creator_subscription
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      order by created_at desc
      limit 1`,
    [String(ownerUserId), String(replicaId)],
  );
  const subscriptionRow = rows[0] || null;
  return {
    tier: creatorTierFromRows({ suiteCovered, subscriptionRow }),
    covered_by_suite: suiteCovered,
    subscription: clientCreatorSubscription(subscriptionRow),
  };
}
