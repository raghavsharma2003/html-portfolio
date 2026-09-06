// HTTP shape only. Every decision lives in api/_replica-voice-identity.js
// where a fake db can reach it (the api/clone-chat.js over api/_clonechat.js
// convention). Modelled on api/replica-liveness.js, which is the same intake
// with a different verifier behind it.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  cancelOwnedVoiceChallenge,
  clientSource,
  createVoiceChallengeSource,
  finalizeVoiceChallengeSource,
  issueOwnedVoiceChallenge,
  latestOwnedVoiceChallenge,
  voiceIdentityChallengeEnabled,
} from "./_replica-voice-identity.js";
import { getPendingSource } from "./_replica-source.js";
import {
  ReplicaStorageError,
  REPLICA_STORAGE_WRITE_BUCKET,
  createSignedReplicaUpload,
  ensurePrivateReplicaBucket,
  replicaObjectInfo,
} from "./_replica-storage.js";

export const config = { maxDuration: 120 };

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
};

const uploadResponse = (source, challenge, upload) => ({
  challenge,
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
  // Default OFF. Until the main loop sets VOICE_IDENTITY_CHALLENGE=1 this
  // endpoint does not exist as far as any caller is concerned, so the
  // deployed tree keeps exactly the behaviour it has today.
  if (!voiceIdentityChallengeEnabled()) return res.status(404).json({ error: "not_found" });
  if (!allow(ipOf(req), "replica_voice_identity", 30)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_voice_identity_user", 20)) return res.status(429).json({ error: "slow_down" });
    const body = req.body || {};

    if (body.op === "issue") {
      const challenge = await issueOwnedVoiceChallenge(q, user.id, body.replica_id);
      return challenge
        ? res.status(201).json({ challenge })
        : res.status(409).json({ error: "challenge_not_authorized_or_daily_limit" });
    }
    if (body.op === "status") {
      return res.status(200).json({ challenge: await latestOwnedVoiceChallenge(q, user.id, body.replica_id) });
    }
    if (body.op === "cancel") {
      const challenge = await cancelOwnedVoiceChallenge(q, user.id, body.replica_id, body.challenge_id);
      return challenge
        ? res.status(200).json({ challenge })
        : res.status(409).json({ error: "challenge_not_cancellable" });
    }
    if (body.op === "create_upload") {
      await ensurePrivateReplicaBucket(REPLICA_STORAGE_WRITE_BUCKET);
      const source = await createVoiceChallengeSource(q, user.id, body.replica_id, body.challenge_id, body);
      if (!source) return res.status(409).json({ error: "challenge_expired_or_unavailable" });
      const challenge = await latestOwnedVoiceChallenge(q, user.id, body.replica_id);
      const upload = await createSignedReplicaUpload({
        storageBucket: source.storage_bucket,
        objectPath: source.object_path,
      });
      return res.status(201).json(uploadResponse(source, challenge, upload));
    }
    if (body.op === "finalize") {
      const pending = await getPendingSource(q, user.id, body.replica_id, body.source_id);
      if (!pending || pending.capture_mode !== "identity_challenge") {
        return res.status(404).json({ error: "pending_challenge_source_not_found" });
      }
      const info = await replicaObjectInfo({
        storageBucket: pending.storage_bucket,
        objectPath: pending.object_path,
      });
      const finalized = await finalizeVoiceChallengeSource(
        q, user.id, body.replica_id, body.challenge_id, body.source_id,
        { ...info, expectedByteSize: Number(pending.byte_size), expectedMime: pending.mime },
      );
      if (!finalized) return res.status(409).json({ error: "challenge_expired_or_source_mismatch" });
      if (finalized.source.state !== "quarantined") {
        return res.status(409).json({ error: "challenge_source_rejected" });
      }
      return res.status(200).json({
        challenge: finalized.challenge,
        source: clientSource(finalized.source),
      });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof ReplicaStorageError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "voice_identity_failure" : error.message });
  }
}
