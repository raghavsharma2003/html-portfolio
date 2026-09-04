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
import { configuredFaceSessionErasureBroker } from "./_face-session/registry.js";
import { deleteOwnedFaceSessionNow } from "./_replica-face-session.js";
import { markStep } from "./_funnel.js";

export const config = { maxDuration: 60 };

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
      // WS-R23 (migration 086): INVITES_REQUIRED is read here, the HTTP
      // layer, and passed down as an explicit option so createSelfReplica
      // stays reachable with a fake db and no env mutation in its evals.
      const replica = await createSelfReplica(q, user.id, body.display_name, {
        invitesRequired: process.env.INVITES_REQUIRED === "1",
        inviteCode: body.invite_code,
      });
      return res.status(201).json({ replica });
    }
    if (body.op === "revoke") {
      const result = await requestOwnedReplicaErasure(q, user.id, body.replica_id);
      if (!result) return res.status(404).json({ error: "replica_not_found" });
      // Revocation is committed before this best-effort provider call. A Face
      // outage can therefore delay deletion but can never reactivate the replica;
      // the scheduled erasure path remains the durable retry mechanism.
      let providerSessionErasure = "pending";
      try {
        const broker = configuredFaceSessionErasureBroker();
        const deleted = broker
          ? await deleteOwnedFaceSessionNow(q, user.id, body.replica_id, null, broker, {
            providerTimeoutMs: 12_000,
          })
          : null;
        providerSessionErasure = deleted ? "confirmed" : "pending";
      } catch {
        providerSessionErasure = "pending";
      }
      return res.status(200).json({
        ...result,
        erasure: "pending",
        provider_session_erasure: providerSessionErasure,
      });
    }
    if (body.op === "erasure_status") {
      const status = await getReplicaErasureStatus(q, user.id, body.erasure_request_id);
      return status
        ? res.status(200).json({ erasure: status })
        : res.status(404).json({ error: "erasure_request_not_found" });
    }
    if (body.op === "funnel_mark") {
      // WS-R25 (migration 088). The two studio-only funnel moments -
      // "studio_opened" on the wizard mount, "publish_clicked" on the
      // button, RoomStudio.tsx's own click site. markStep itself refuses an
      // owner mismatch before any write; a bad/unknown step is a 400.
      const mark = await markStep(q, user.id, body.replica_id, body.step);
      return res.status(200).json(mark);
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "replica_failure" : error.message });
  }
}
