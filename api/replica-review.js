import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { ownedReviewStatus, decideOwnedEvidence, getOwnedArtifactAudition, queueOwnedVoiceGenome, selectOwnedVoiceArtifact } from "./_replica-review.js";
import { createSignedReplicaRead } from "./_replica-storage.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "replica_review", 60)) return res.status(429).json({ error: "slow_down" });
  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_review_user", 45)) return res.status(429).json({ error: "slow_down" });
    const body = req.body || {};
    if (body.op === "status") {
      const review = await ownedReviewStatus(q, user.id, body.replica_id);
      return review ? res.status(200).json({ review }) : res.status(404).json({ error: "replica_not_found" });
    }
    if (body.op === "decide") {
      const record = await decideOwnedEvidence(q, user.id, body);
      return record ? res.status(201).json({ decision: record }) : res.status(404).json({ error: "evidence_not_found" });
    }
    if (body.op === "audition_artifact") {
      const artifact = await getOwnedArtifactAudition(q, user.id, body);
      if (!artifact) return res.status(404).json({ error: "artifact_not_found" });
      const signed = await createSignedReplicaRead(artifact.object_path, { expiresIn: 60 });
      return res.status(200).json({ audition: {
        artifact_id: artifact.artifact_id,
        mime: artifact.mime,
        duration_ms: artifact.duration_ms == null ? null : Number(artifact.duration_ms),
        url: signed.url,
        expires_at: signed.expires_at,
      } });
    }
    if (body.op === "select_artifact") {
      const decision = await selectOwnedVoiceArtifact(q, user.id, body);
      return decision ? res.status(201).json({ decision }) : res.status(404).json({ error: "artifact_not_found" });
    }
    if (body.op === "queue_voice_genome") {
      const build = await queueOwnedVoiceGenome(q, user.id, body.replica_id);
      return build ? res.status(201).json({ build }) : res.status(404).json({ error: "replica_not_found" });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "replica_review_failure" : error.message, readiness: error?.details });
  }
}
