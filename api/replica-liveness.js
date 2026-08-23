import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  issueOwnedChallenge,
  latestOwnedChallenge,
  createChallengeSource,
  finalizeChallengeSource,
  clientSource,
} from "./_replica-liveness.js";
import { getPendingSource } from "./_replica-source.js";
import {
  ReplicaStorageError,
  ensurePrivateReplicaBucket,
  createSignedReplicaUpload,
  replicaObjectInfo,
} from "./_replica-storage.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
};

const uploadResponse = (source, challenge, upload) => ({
  challenge,
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
  if (!allow(ipOf(req), "replica_liveness", 30)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_liveness_user", 20)) return res.status(429).json({ error: "slow_down" });
    const body = req.body || {};

    if (body.op === "issue") {
      const challenge = await issueOwnedChallenge(q, user.id, body.replica_id);
      return challenge
        ? res.status(201).json({ challenge })
        : res.status(409).json({ error: "challenge_not_authorized_or_daily_limit" });
    }
    if (body.op === "status") {
      return res.status(200).json({ challenge: await latestOwnedChallenge(q, user.id, body.replica_id) });
    }
    if (body.op === "create_upload") {
      await ensurePrivateReplicaBucket();
      const source = await createChallengeSource(q, user.id, body.replica_id, body.challenge_id, body);
      if (!source) return res.status(409).json({ error: "challenge_expired_or_unavailable" });
      const challenge = await latestOwnedChallenge(q, user.id, body.replica_id);
      const upload = await createSignedReplicaUpload(source.object_path);
      return res.status(201).json(uploadResponse(source, challenge, upload));
    }
    if (body.op === "finalize") {
      const pending = await getPendingSource(q, user.id, body.replica_id, body.source_id);
      if (!pending || pending.capture_mode !== "live_challenge") {
        return res.status(404).json({ error: "pending_challenge_source_not_found" });
      }
      const info = await replicaObjectInfo(pending.object_path);
      const finalized = await finalizeChallengeSource(
        q,
        user.id,
        body.replica_id,
        body.challenge_id,
        body.source_id,
        { ...info, expectedByteSize: Number(pending.byte_size), expectedMime: pending.mime },
      );
      if (!finalized) return res.status(409).json({ error: "challenge_expired_or_source_mismatch" });
      if (finalized.source.state !== "quarantined") {
        return res.status(409).json({ error: "challenge_source_rejected" });
      }
      return res.status(200).json({
        challenge: finalized.challenge,
        source: clientSource(finalized.source),
        verification: "pending",
      });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof ReplicaStorageError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "liveness_failure" : error.message });
  }
}
