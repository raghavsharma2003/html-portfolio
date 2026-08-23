import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  createPendingSource,
  getPendingSource,
  listOwnedSources,
  finalizeOwnedSource,
  markOwnedSourceDeleting,
  completeOwnedSourceDeletion,
  clientSource,
} from "./_replica-source.js";
import {
  ReplicaStorageError,
  ensurePrivateReplicaBucket,
  createSignedReplicaUpload,
  replicaObjectInfo,
  deleteReplicaObject,
} from "./_replica-storage.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
};

const uploadResponse = (source, upload) => ({
  source: clientSource(source),
  upload: {
    method: upload.method,
    url: upload.url,
    headers: { ...upload.headers, "content-type": source.mime },
    expires_at: upload.expires_at,
  },
});

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "replica_source", 45)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_source_user", 60)) return res.status(429).json({ error: "slow_down" });
    const body = req.body || {};

    if (body.op === "create_upload") {
      await ensurePrivateReplicaBucket();
      const source = await createPendingSource(q, user.id, body.replica_id, body);
      if (!source) return res.status(409).json({ error: "capture_and_storage_consent_required" });
      const upload = await createSignedReplicaUpload(source.object_path);
      return res.status(201).json(uploadResponse(source, upload));
    }
    if (body.op === "retry_upload") {
      await ensurePrivateReplicaBucket();
      const source = await getPendingSource(q, user.id, body.replica_id, body.source_id);
      if (!source) return res.status(404).json({ error: "pending_source_not_found" });
      const upload = await createSignedReplicaUpload(source.object_path);
      return res.status(200).json(uploadResponse(source, upload));
    }
    if (body.op === "finalize") {
      const pending = await getPendingSource(q, user.id, body.replica_id, body.source_id);
      if (!pending) return res.status(404).json({ error: "pending_source_not_found" });
      // Live evidence has a stricter atomic transition that binds the file to
      // its unexpired randomized phrase. It must never enter quarantine via
      // the generic evidence route.
      if (pending.capture_mode === "live_challenge") {
        return res.status(409).json({ error: "use_liveness_finalize" });
      }
      const info = await replicaObjectInfo(pending.object_path);
      const source = await finalizeOwnedSource(q, user.id, body.replica_id, body.source_id, info);
      return source
        ? res.status(source.state === "quarantined" ? 200 : 409).json({ source: clientSource(source) })
        : res.status(409).json({ error: "source_state_changed" });
    }
    if (body.op === "list") {
      return res.status(200).json({ sources: await listOwnedSources(q, user.id, body.replica_id) });
    }
    if (body.op === "delete") {
      const source = await markOwnedSourceDeleting(q, user.id, body.replica_id, body.source_id);
      if (!source) return res.status(404).json({ error: "source_not_found" });
      try {
        await deleteReplicaObject(source.object_path);
        const deleted = await completeOwnedSourceDeletion(q, user.id, body.replica_id, body.source_id);
        return res.status(deleted ? 200 : 202).json({
          source_id: source.source_id,
          erasure: deleted ? "complete" : "pending",
          rebuild_required: true,
        });
      } catch (error) {
        if (!(error instanceof ReplicaStorageError)) throw error;
        // The manifest stays in the unusable `deleting` state. A retry is safe
        // because Supabase object removal is idempotent.
        return res.status(202).json({
          source_id: source.source_id,
          erasure: "pending",
          rebuild_required: true,
        });
      }
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof ReplicaStorageError) {
      return res.status(error.status).json({ error: error.code });
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "source_failure" : error.message });
  }
}
