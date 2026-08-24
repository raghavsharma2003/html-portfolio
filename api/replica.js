// Authenticated owner-only replica lifecycle endpoint.
// GET  /api/replica                 -> list mine
// GET  /api/replica?replica_id=...  -> get mine
// POST /api/replica {op:create, display_name}
// POST /api/replica {op:revoke, replica_id}
// POST /api/replica {op:erasure_status, erasure_request_id}
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  createSelfReplica,
  getOwnedReplica,
  listOwnedReplicas,
  requestOwnedReplicaErasure,
} from "./_replica.js";
import { getReplicaErasureStatus } from "./_replica-full-erasure.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "replica", 30)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_user", 60)) return res.status(429).json({ error: "slow_down" });

    if (req.method === "GET") {
      const id = req.query?.replica_id;
      if (!id) return res.status(200).json({ replicas: await listOwnedReplicas(q, user.id) });
      const replica = await getOwnedReplica(q, user.id, id);
      return replica ? res.status(200).json({ replica }) : res.status(404).json({ error: "replica_not_found" });
    }

    const body = req.body || {};
    if (body.op === "create") {
      const replica = await createSelfReplica(q, user.id, body.display_name);
      return res.status(201).json({ replica });
    }
    if (body.op === "revoke") {
      const result = await requestOwnedReplicaErasure(q, user.id, body.replica_id);
      return result
        ? res.status(200).json({ ...result, erasure: "pending" })
        : res.status(404).json({ error: "replica_not_found" });
    }
    if (body.op === "erasure_status") {
      const status = await getReplicaErasureStatus(q, user.id, body.erasure_request_id);
      return status
        ? res.status(200).json({ erasure: status })
        : res.status(404).json({ error: "erasure_request_not_found" });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "replica_failure" : error.message });
  }
}
