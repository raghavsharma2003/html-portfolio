// GET /api/replica-activity?replica_id=… — everything in flight and everything
// recently finished, across every lane, in one shape. Gurukul WS-AF.
//
// Thin by construction: cors, rate limit, auth, dispatch, error shape. Every
// decision lives in api/_replica-activity.js where an eval can reach it with a
// fake db — `dead-writers`, and the fact that this environment has no database,
// so logic in a handler is logic no eval can ever run.
//
// READ ONLY. There is no POST here on purpose. Every act this surface offers
// (retry an upload, re-mine a file, check a channel again) already has an
// endpoint that owns its consent gates and its audit row, and a second door
// into those operations would be a second place for the gates to drift. The
// surface reports and links; it does not mutate.
//
// The rate limit is higher than the platform's usual 20/min because this
// endpoint is POLLED. It is also why `next_poll_ms` comes back on every
// response: the SERVER decides the interval, and it returns null the moment
// nothing is in flight so the client can stop asking.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { ActivityError, readReplicaActivity } from "./_replica-activity.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!allow(ipOf(req), "replica_activity", 60)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_activity_user", 120)) return res.status(429).json({ error: "slow_down" });

    const view = await readReplicaActivity(q, user.id, req.query?.replica_id, {
      env: process.env,
      unchangedPolls: Number(req.query?.unchanged || 0),
    });
    // A replica that is not the caller's answers exactly as a replica that does
    // not exist. Ownership is decided by the SQL predicate in the read, never
    // by a branch here.
    if (!view) return res.status(404).json({ error: "replica_not_found" });
    return res.status(200).json(view);
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof ActivityError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "replica_activity_failure" : String(error.code || error.message),
    });
  }
}
