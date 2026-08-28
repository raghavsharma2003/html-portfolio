import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  clientSource,
  createProviderConsentSource,
  finalizeProviderConsentSource,
  getPendingProviderConsentSource,
  issueOwnedProviderConsent,
  latestOwnedProviderConsent,
} from "./_replica-provider-consent.js";
import {
  createSignedReplicaUpload,
  ensurePrivateReplicaBucket,
  REPLICA_STORAGE_WRITE_BUCKET,
  replicaObjectInfo,
  ReplicaStorageError,
} from "./_replica-storage.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
};

const uploadResponse = (source, providerConsent, upload) => ({
  provider_consent: providerConsent,
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
  if (!allow(ipOf(req), "replica_provider_consent", 24))
    return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_provider_consent_user", 16))
      return res.status(429).json({ error: "slow_down" });
    const body = req.body || {};

    if (body.op === "status") {
      return res.status(200).json({
        provider_consent: await latestOwnedProviderConsent(q, user.id, body.replica_id),
      });
    }
    if (body.op === "issue") {
      const providerConsent = await issueOwnedProviderConsent(q, user.id, body.replica_id, body);
      return providerConsent
        ? res.status(201).json({ provider_consent: providerConsent })
        : res.status(409).json({ error: "provider_consent_not_authorized_or_daily_limit" });
    }
    if (body.op === "create_upload") {
      await ensurePrivateReplicaBucket(REPLICA_STORAGE_WRITE_BUCKET);
      const source = await createProviderConsentSource(
        q,
        user.id,
        body.replica_id,
        body.provider_consent_id,
        body,
      );
      if (!source) return res.status(409).json({ error: "provider_consent_expired_or_unavailable" });
      const providerConsent = await latestOwnedProviderConsent(q, user.id, body.replica_id);
      const upload = await createSignedReplicaUpload({ storageBucket: source.storage_bucket, objectPath: source.object_path });
      return res.status(201).json(uploadResponse(source, providerConsent, upload));
    }
    if (body.op === "retry_upload") {
      const source = await getPendingProviderConsentSource(
        q,
        user.id,
        body.replica_id,
        body.provider_consent_id,
        body.source_id,
      );
      if (!source) return res.status(404).json({ error: "pending_provider_consent_source_not_found" });
      await ensurePrivateReplicaBucket(source.storage_bucket);
      const providerConsent = await latestOwnedProviderConsent(q, user.id, body.replica_id);
      const upload = await createSignedReplicaUpload({ storageBucket: source.storage_bucket, objectPath: source.object_path });
      return res.status(200).json(uploadResponse(source, providerConsent, upload));
    }
    if (body.op === "finalize") {
      const pending = await getPendingProviderConsentSource(
        q,
        user.id,
        body.replica_id,
        body.provider_consent_id,
        body.source_id,
      );
      if (!pending) return res.status(404).json({ error: "pending_provider_consent_source_not_found" });
      const info = await replicaObjectInfo({ storageBucket: pending.storage_bucket, objectPath: pending.object_path });
      const finalized = await finalizeProviderConsentSource(
        q,
        user.id,
        body.replica_id,
        body.provider_consent_id,
        body.source_id,
        info,
      );
      if (!finalized) return res.status(409).json({ error: "provider_consent_source_state_changed" });
      if (finalized.source.state !== "quarantined")
        return res.status(409).json({ error: "provider_consent_source_rejected" });
      return res.status(200).json({
        provider_consent: finalized.provider_consent,
        source: clientSource(finalized.source),
        provider_verification: "pending",
      });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof ReplicaStorageError)
      return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "provider_consent_failure" : error.code || error.message });
  }
}
