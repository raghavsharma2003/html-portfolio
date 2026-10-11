// The Room's money, follower side (WS-R11; cancel, WS-R37).
//
//   POST /api/room-pay {op:"subscribe", session}   start or resume a subscription
//   POST /api/room-pay {op:"status",    session}   this follower's tier + state
//   POST /api/room-pay {op:"cancel",    session}   cancel at period end
//
// Thin by construction, api/room.js's own shape: cors, rate limit, dispatch,
// error shape. Every decision lives in api/_payments.js/api/_renewals.js,
// where a fake `db` can reach it. THE SCOPE COMES OFF THE SESSION, never off
// the body - api/room.js's own rule for `thread`/`export`/`forget`, restated
// here: a `room` or `person` field in the body would be a field a client
// could set.
//
// `cancel` lives here rather than on api/room.js because `subscribe`/
// `status` already do - the follower's own subscription state has one HTTP
// door, and adding a second on a different endpoint for the same identity
// scope would be `docs/SURFACES.md`'s "never a second door" restated for a
// payments lane instead of a reply.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import { RoomError, bodyTooLarge, ROOM_DOOR_BODY_CAP_BYTES } from "./_room-surface.js";
import { PaymentsError, startFollowerSubscription, followerSubscriptionStatus } from "./_payments.js";
import { cancelFollowerRenewal } from "./_renewals.js";
import { withDoor } from "./_incidents.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "room_pay_ip", 30)) return res.status(429).json({ error: "slow_down" });

  const body = req.body || {};
  // WS-R89: the one shared cap every POST door checks first.
  if (bodyTooLarge(body, ROOM_DOOR_BODY_CAP_BYTES)) return res.status(413).json({ error: "body_too_large" });
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

    if (op === "cancel") {
      const cancelled = await cancelFollowerRenewal(q, { session: body.session });
      obsBestEffort("room_pay.cancel", { state: cancelled?.state });
      return res.status(200).json({ subscription: cancelled });
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

// WS-R58 (migration 109). See api/room.js's own comment for what this does.
export default withDoor(q, "room-pay.js", handler);
