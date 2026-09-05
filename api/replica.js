// Authenticated owner-only replica lifecycle endpoint.
// GET  /api/replica                 -> list mine
// GET  /api/replica?replica_id=...  -> get mine
// POST /api/replica {op:create, display_name}
// POST /api/replica {op:revoke, replica_id}
// POST /api/replica {op:erasure_status, erasure_request_id}
// POST /api/replica {op:set_locale, replica_id, locale}   -- WS-R52, studio chrome only
// POST /api/replica {op:export}                            -- WS-R70, one a day per owner
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  createSelfReplica,
  getOwnedReplica,
  listOwnedReplicas,
  requestOwnedReplicaErasure,
  setOwnedReplicaLocale,
} from "./_replica.js";
import { getReplicaErasureStatus } from "./_replica-full-erasure.js";
import { configuredFaceSessionErasureBroker } from "./_face-session/registry.js";
import { deleteOwnedFaceSessionNow } from "./_replica-face-session.js";
import { markStep } from "./_funnel.js";
import { creatorExport } from "./_creator-export.js";
import { consume } from "./_rate-limit.js";
import {
  creatorPushConfig,
  subscribeCreatorPush,
  revokeCreatorPush,
  CreatorPushError,
} from "./_creator-push.js";

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
      if (!id) {
        // WS-R74 (migration 118). The creator's own "This week on your
        // phone" card reads `configured`/`vapid_public` bundled with the
        // list read - `api/_ops.js`'s own `opsOverview` carrying `push`
        // alongside every other board fact, restated here so the studio's
        // account surface needs no second endpoint.
        return res.status(200).json({ replicas: await listOwnedReplicas(q, user.id), push: creatorPushConfig() });
      }
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
    if (body.op === "set_locale") {
      // WS-R52 (migration 112). The studio's own chrome language, the
      // creator-facing analog of api/_room-surface.js's roomSetLocale --
      // same "invalid value is refused by name" rule, own owner-scoped
      // WHERE clause rather than a shared helper (this table has no
      // session-token layer to read the owner off; requireUser() above
      // already is that layer for the whole endpoint).
      const replica = await setOwnedReplicaLocale(q, user.id, body.replica_id, body.locale);
      if (!replica) return res.status(404).json({ error: "replica_not_found" });
      return res.status(200).json({ replica });
    }
    if (body.op === "export") {
      // WS-R70. No cross-identity input at all — `ownerUserId` comes only
      // from `requireUser(req)` above, never a body-supplied id, so this op
      // always returns the CALLER's own owner-lane data (evals/room-doors/
      // run.mjs's own OP_COVERAGE entry for "export" names this; a
      // dedicated cross-owner-isolation check lives in
      // evals/creator-export/run.mjs). Rate-limited to one a day per owner,
      // the workstream brief's own number: a real export walks dozens of
      // tables, and the gate must fail closed before any of them run.
      const gate = await consume(q, { scope: "creator_export_owner", key: user.id });
      if (!gate.ok) {
        res.setHeader("Retry-After", String(gate.retryAfterSeconds));
        return res.status(429).json({ error: gate.code, retry_after_seconds: gate.retryAfterSeconds });
      }
      const dump = await creatorExport(q, user.id);
      return res.status(200).json(dump);
    }
    if (body.op === "push_subscribe") {
      // WS-R74 (migration 118). `ownerUserId` comes only from
      // `requireUser(req)` above, never a body-supplied id - the same "no
      // cross-identity input" shape `export`'s own op takes two blocks
      // down; a subscribe call can only ever write a row for the CALLER's
      // own id.
      const result = await subscribeCreatorPush(q, user.id, {
        endpoint: body.endpoint,
        p256dh: body.p256dh,
        auth: body.auth,
      });
      return res.status(200).json(result);
    }
    if (body.op === "push_revoke") {
      const result = await revokeCreatorPush(q, user.id, body.endpoint);
      return res.status(200).json(result);
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
    if (error instanceof CreatorPushError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "replica_failure" : error.message });
  }
}
