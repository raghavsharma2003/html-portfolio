import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  createPendingSource,
  getOwnedSource,
  getPendingSource,
  listOwnedSources,
  finalizeOwnedSource,
  markOwnedSourceDeleting,
  clientSource,
} from "./_replica-source.js";
import {
  ReplicaStorageError,
  REPLICA_STORAGE_WRITE_BUCKET,
  ensurePrivateReplicaBucket,
  createSignedReplicaUpload,
  replicaObjectInfo,
} from "./_replica-storage.js";
import { bootstrapSelfTestReplica } from "./_replica-processing/self-test.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
};

const uploadResponse = (source, upload) => ({
  source: clientSource(source),
  upload: {
    method: upload.method,
    url: upload.url,
    headers: { ...upload.headers, "content-type": source.mime },
    ...(upload.resumable ? {
      resumable: {
        ...upload.resumable,
        metadata: { ...upload.resumable.metadata, contentType: source.mime },
      },
    } : {}),
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
      // Internal owner testing skips only the ceremony: the environment is
      // triple-gated, the authenticated owner must match its UUID allowlist,
      // and the SQL independently requires an owned self-mode replica. The
      // upload, quarantine, scanner, evidence and model-build gates below are
      // unchanged.
      await bootstrapSelfTestReplica(q, {
        ownerUserId: user.id,
        replicaId: body.replica_id,
        env: process.env,
      });
      await ensurePrivateReplicaBucket(REPLICA_STORAGE_WRITE_BUCKET);
      const source = await createPendingSource(q, user.id, body.replica_id, body);
      if (!source) return res.status(409).json({ error: "capture_and_storage_consent_required" });
      const upload = await createSignedReplicaUpload({ storageBucket: source.storage_bucket, objectPath: source.object_path });
      return res.status(201).json(uploadResponse(source, upload));
    }
    if (body.op === "retry_upload") {
      const source = await getPendingSource(q, user.id, body.replica_id, body.source_id);
      if (!source) return res.status(404).json({ error: "pending_source_not_found" });
      await ensurePrivateReplicaBucket(source.storage_bucket);
      const upload = await createSignedReplicaUpload({ storageBucket: source.storage_bucket, objectPath: source.object_path });
      return res.status(200).json(uploadResponse(source, upload));
    }
    if (body.op === "finalize") {
      const pending = await getPendingSource(q, user.id, body.replica_id, body.source_id);
      if (!pending) {
        // Finalize is commonly retried after a connection timeout. Return the
        // exact owner-scoped terminal/current source instead of claiming that
        // a real source does not exist. In particular, a MIME rejection must
        // stay a MIME rejection rather than cascading into the misleading
        // `pending_source_not_found` seen by the owner.
        const existing = await getOwnedSource(q, user.id, body.replica_id, body.source_id);
        if (!existing) return res.status(404).json({ error: "source_not_found" });
        const source = clientSource(existing);
        if (["quarantined", "processing", "ready"].includes(existing.state)) {
          return res.status(200).json({ source });
        }
        return res.status(409).json({
          error: existing.rejection_code || `source_${existing.state || "not_pending"}`,
          source,
        });
      }
      // Live evidence has a stricter atomic transition that binds the file to
      // its unexpired randomized phrase. It must never enter quarantine via
      // the generic evidence route.
      if (pending.capture_mode === "live_challenge") {
        return res.status(409).json({ error: "use_liveness_finalize" });
      }
      if (pending.capture_mode === "provider_consent") {
        return res.status(409).json({ error: "use_provider_consent_finalize" });
      }
      const info = await replicaObjectInfo({ storageBucket: pending.storage_bucket, objectPath: pending.object_path });
      const source = await finalizeOwnedSource(q, user.id, body.replica_id, body.source_id, info);
      return source
        ? res.status(source.state === "quarantined" ? 200 : 409).json({
            ...(source.rejection_code ? { error: source.rejection_code } : {}),
            source: clientSource(source),
          })
        : res.status(409).json({ error: "source_state_changed" });
    }
    if (body.op === "list") {
      return res.status(200).json({ sources: await listOwnedSources(q, user.id, body.replica_id) });
    }
    if (body.op === "delete") {
      const source = await markOwnedSourceDeleting(q, user.id, body.replica_id, body.source_id);
      if (!source) return res.status(404).json({ error: "source_not_found" });
      // Physical deletion is always handled by the durable reconciler. It
      // enumerates and removes every exact derived object before allowing the
      // source row and its lineage manifests to disappear.
      return res.status(202).json({
        source_id: source.source_id,
        erasure: "pending",
        rebuild_required: true,
      });
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
