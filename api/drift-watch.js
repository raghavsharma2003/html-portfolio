// GET /api/drift-watch?replica_id=… — "still sounds like you", one number,
// a trend, and the last time the voice engine underneath it changed. WS-R9.
//
// Thin by construction, api/readiness.js's own pattern: cors, rate limit,
// auth, one call, error shape. Every decision lives in api/_drift-watch.js
// where an eval can reach it with a fake db.
//
// READ ONLY, and unlike api/readiness.js it stays that way — see
// api/_drift-watch.js's own header for why a monitor with nothing to gate
// should never surprise a browser GET with a write. The durable, alertable
// history is api/drift-watch-sweep.js's job, on its own schedule.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { DriftWatchError, readOwnedDriftWatch, clientDriftWatch } from "./_drift-watch.js";

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
  if (!allow(ipOf(req), "drift_watch", 40)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "drift_watch_user", 80)) return res.status(429).json({ error: "slow_down" });

    const report = await readOwnedDriftWatch(q, user.id, req.query?.replica_id);
    // A replica that is not the caller's answers exactly as a replica that
    // does not exist. Ownership is decided by the SQL predicate inside the
    // read, never by a branch here (api/readiness.js's own rule).
    if (!report) return res.status(404).json({ error: "replica_not_found" });
    return res.status(200).json({ drift: clientDriftWatch(report) });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof DriftWatchError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "drift_watch_failure" : String(error.code || error.message),
    });
  }
}
