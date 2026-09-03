// The Room's money, owner side (WS-R11).
//
//   GET  /api/payments?replica_id=…                this room's price + revenue
//   POST /api/payments {op:"set_price", price_inr}  set the follower price
//
// Thin by construction, api/room-publish.js's own shape: cors, rate limit,
// auth, dispatch, error shape. Every decision lives in api/_payments.js,
// where a fake `db` can reach it.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import { PaymentsError, getRoomPrice, setRoomPrice, ownerRevenue } from "./_payments.js";

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
        return res.status(200).json({ price: null, revenue });
      }
      const revenue = await ownerRevenue(q, user.id, replicaId);
      return res.status(200).json({ price, revenue });
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

    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof PaymentsError) {
      return res.status(error.status).json({ error: error.code, ...(error.details ? { details: error.details } : {}) });
    }
    console.error("[payments] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "payments_failure" });
  }
}
