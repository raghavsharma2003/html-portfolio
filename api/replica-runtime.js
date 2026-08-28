// Authenticated private-replica runtime control plane.
// GET  ?replica_id=...                  -> public-safe readiness/status
// POST {op:"activate",replica_id}       -> issue immutable capability
// POST {op:"open_session",...}          -> owner-only private session
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  activateOwnedRuntime,
  openOwnedRuntimeSession,
  ownedRuntimeStatus,
} from "./_replica-runtime.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "replica_runtime", 40)) return res.status(429).json({ error: "slow_down" });
  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_runtime_user", 80)) return res.status(429).json({ error: "slow_down" });
    if (req.method === "GET") {
      const runtime = await ownedRuntimeStatus(q, user.id, req.query?.replica_id);
      return runtime ? res.status(200).json({ runtime }) : res.status(404).json({ error: "replica_not_found" });
    }
    const body = req.body || {};
    if (body.op === "activate") {
      const activated = await activateOwnedRuntime(q, user.id, body.replica_id);
      if (!activated) return res.status(404).json({ error: "replica_not_found" });
      const runtime = await ownedRuntimeStatus(q, user.id, body.replica_id);
      return res.status(200).json({ runtime });
    }
    if (body.op === "open_session") {
      const session = await openOwnedRuntimeSession(q, user.id, body);
      return session ? res.status(201).json({ session }) : res.status(409).json({ error: "runtime_inactive" });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "replica_runtime_failure" : String(error.code || error.message),
      ...(status < 500 && error?.details ? { details: error.details } : {}),
    });
  }
}
