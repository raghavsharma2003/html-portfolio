// The Room's money, owner side (WS-R11; the creator tier read/write, WS-R33;
// the payout statement, fund account and state machine, WS-R36).
//
//   GET  /api/payments?replica_id=…                     this room's price,
//                                                        revenue and the
//                                                        caller's own
//                                                        creator tier state
//   POST /api/payments {op:"set_price", price_inr}       set the follower price
//   POST /api/payments {op:"start_creator_subscription",
//                        plan}                           WS-R33
//   POST /api/payments {op:"payout_statements"}          this owner's own
//                                                        payout list        WS-R36
//   POST /api/payments {op:"payout_statement",
//                        payout_id}                      one statement      WS-R36
//   POST /api/payments {op:"register_fund_account",
//                        fund_account_ref}                a provider-issued
//                                                        reference, never a
//                                                        bank detail        WS-R36
//   POST /api/payments {op:"retry_failed_payout",
//                        payout_id}                      OPERATOR ONLY,
//                                                        404 by name unless
//                                                        OPS_OWNER_USER_IDS  WS-R36
//
// Thin by construction, api/room-publish.js's own shape: cors, rate limit,
// auth, dispatch, error shape. Every decision lives in api/_payments.js and
// api/_creator-tier.js, where a fake `db` can reach it. The operator gate for
// `retry_failed_payout` is checked HERE, in the door, never inside
// `retryFailedPayout` itself - api/_ops.js's own "the check belongs at the
// board's own door, never the board's own function" precedent.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import {
  PaymentsError,
  getRoomPrice,
  setRoomPrice,
  ownerRevenue,
  startCreatorSubscription,
  payoutStatements,
  payoutStatement,
  registerFundAccount,
  retryFailedPayout,
  reconcilePeriod,
} from "./_payments.js";
import { readCreatorTier } from "./_creator-tier.js";
import { OrgError } from "./_org.js";
import { isOpsOwner } from "./_ops.js";
import { cancelCreatorRenewal } from "./_renewals.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

const notFound = (res) => res.status(404).json({ error: "replica_not_found" });

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "payments", 20)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "payments_user", 60)) return res.status(429).json({ error: "slow_down" });

    if (req.method === "GET") {
      const replicaId = req.query?.replica_id;
      if (!replicaId) return res.status(400).json({ error: "replica_id_required" });
      const price = await getRoomPrice(q, user.id, replicaId);
      if (price === null) {
        // Two honest reasons collapse to the same null: no such room, or a
        // room that exists but has never had a price set. `revenue` below
        // disambiguates - it also returns null for "no room" and real zeros
        // for "room, no price yet", so the client tells them apart on
        // whether `revenue` came back at all.
        const revenue = await ownerRevenue(q, user.id, replicaId);
        if (revenue === null) return notFound(res);
        const creator_tier = await readCreatorTier(q, user.id, replicaId);
        return res.status(200).json({ price: null, revenue, creator_tier });
      }
      const revenue = await ownerRevenue(q, user.id, replicaId);
      const creator_tier = await readCreatorTier(q, user.id, replicaId);
      return res.status(200).json({ price, revenue, creator_tier });
    }

    const body = req.body || {};
    const op = String(body.op || "");
    const replicaId = body.replica_id;

    if (op === "set_price") {
      const price = await setRoomPrice(q, user.id, replicaId, body.price_inr);
      if (!price) return notFound(res);
      obsBestEffort("payments.set_price", { price_inr: price.follower_price_inr });
      return res.status(200).json({ price });
    }
    if (op === "start_creator_subscription") {
      const subscription = await startCreatorSubscription(q, { ownerUserId: user.id, replicaId, plan: body.plan });
      obsBestEffort("payments.start_creator_subscription", { plan: body.plan });
      return res.status(200).json({ subscription });
    }
    if (op === "payout_statements") {
      return res.status(200).json({ payouts: await payoutStatements(q, user.id) });
    }
    if (op === "payout_statement") {
      const statement = await payoutStatement(q, user.id, body.payout_id);
      if (!statement) return res.status(404).json({ error: "payout_not_found" });
      return res.status(200).json({ statement });
    }
    if (op === "register_fund_account") {
      const account = await registerFundAccount(q, { ownerUserId: user.id, fundAccountRef: body.fund_account_ref });
      obsBestEffort("payments.register_fund_account", {});
      return res.status(200).json({ account });
    }
    if (op === "retry_failed_payout") {
      // Operator only. 404, never 403, for anyone else - the existence of
      // this op is never disclosed to a caller it is not for, api/ops.js's
      // own law 1 restated for one payment op instead of a whole board.
      if (!isOpsOwner(user.id)) return res.status(404).json({ error: "not_found" });
      const payout = await retryFailedPayout(q, { payoutId: body.payout_id });
      return res.status(200).json({ payout });
    }
    // WS-R42, migration 104. Operator only, 404 by name - `retry_failed_payout`'s
    // own gate, restated. Runs the real reconciliation over one period (the
    // live period: the body's own period_start/period_end when given, else
    // the most recent period this owner-less, platform-wide op can see - the
    // caller's own most recent built payout period, since a period with no
    // payout row yet has nothing to reconcile against).
    if (op === "reconcile") {
      if (!isOpsOwner(user.id)) return res.status(404).json({ error: "not_found" });
      let periodStart = body.period_start;
      let periodEnd = body.period_end;
      if (!periodStart || !periodEnd) {
        const latest = await q(
          `select period_start, period_end from vy_creator_payout order by period_start desc limit 1`,
          [],
        );
        if (!latest[0]) return res.status(404).json({ error: "reconcile_no_period" });
        periodStart = latest[0].period_start;
        periodEnd = latest[0].period_end;
      }
      const result = await reconcilePeriod(q, { periodStart, periodEnd });
      return res.status(200).json({ reconcile: result });
    }
    // WS-R37: cancel at period end, `_renewals.js`'s own seam-through-cancel.
    if (op === "cancel_creator_subscription") {
      const subscription = await cancelCreatorRenewal(q, { ownerUserId: user.id, replicaId });
      obsBestEffort("payments.cancel_creator_subscription", { state: subscription?.state });
      return res.status(200).json({ subscription });
    }

    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof PaymentsError) {
      return res.status(error.status).json({ error: error.code, ...(error.details ? { details: error.details } : {}) });
    }
    if (error instanceof OrgError) {
      return res.status(error.status).json({ error: error.code, ...(error.details ? { details: error.details } : {}) });
    }
    console.error("[payments] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "payments_failure" });
  }
}
