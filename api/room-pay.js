// The Room's money, follower side (WS-R11).
//
//   POST /api/room-pay {op:"subscribe", session}   start or resume a subscription
//   POST /api/room-pay {op:"status",    session}   this follower's tier + state
//
// Thin by construction, api/room.js's own shape: cors, rate limit, dispatch,
// error shape. Every decision lives in api/_payments.js, where a fake `db`
// can reach it. THE SCOPE COMES OFF THE SESSION, never off the body -
// api/room.js's own rule for `thread`/`export`/`forget`, restated here: a
// `room` or `person` field in the body would be a field a client could set.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import { RoomError } from "./_room-surface.js";
import { PaymentsError, startFollowerSubscription, followerSubscriptionStatus } from "./_payments.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "room_pay_ip", 30)) return res.status(429).json({ error: "slow_down" });

  const body = req.body || {};
  const op = String(body.op || "");

  try {
    if (op === "subscribe") {
      const started = await startFollowerSubscription(q, { session: body.session });
      obsBestEffort("room_pay.subscribe", { state: started.state });
      return res.status(200).json(started);
    }

    if (op === "status") {
      return res.status(200).json(await followerSubscriptionStatus(q, { session: body.session }));
    }

    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof RoomError) return res.status(error.status).json({ error: error.code });
    if (error instanceof PaymentsError) {
      return res.status(error.status).json({ error: error.code, ...(error.details ? { details: error.details } : {}) });
    }
    console.error("[room-pay] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "room_pay_failure" });
  }
}
