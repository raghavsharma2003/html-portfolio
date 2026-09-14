import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { ReplicaStorageError, createSignedReplicaRead } from "./_replica-storage.js";
import {
  clientVoiceProfile,
  completeOwnedVoiceProfileDeletion,
  getOwnedVoiceProfile,
  latestOwnedApprovedVoiceGenome,
  loadOwnedAzureVoiceEnrollment,
  markOwnedVoiceProfileDeleting,
  materializeAzureVoiceEnrollment,
  persistCreatedVoiceProfile,
  updateOwnedVoiceProfileStatus,
} from "./_replica-voice-profile.js";
import { createVoiceEraser, createVoiceProvider } from "./_voice/registry.js";
import { azurePersonalVoiceConfig } from "./_voice/providers/azure-personal-voice.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
};

async function refreshProfile(userId, profile) {
  if (!profile || !["creating", "ready"].includes(profile.status)) return profile;
  const provider = createVoiceProvider(profile.provider, { db: q });
  const status = await provider.getVoiceStatus(profile.provider_ref);
  return updateOwnedVoiceProfileStatus(q, userId, profile, status);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "replica_voice", 18)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_voice_user", 12)) return res.status(429).json({ error: "slow_down" });
    const body = req.body || {};

    if (body.op === "status") {
      const profile = await getOwnedVoiceProfile(q, user.id, body.replica_id, body.genome_version);
      return res.status(200).json({ voice_profile: profile ? clientVoiceProfile(await refreshProfile(user.id, profile)) : null });
    }
    if (body.op === "create") {
      const version = body.genome_version ?? await latestOwnedApprovedVoiceGenome(q, user.id, body.replica_id);
      if (!version) return res.status(409).json({ error: "approved_voice_genome_required" });
      const existing = await getOwnedVoiceProfile(q, user.id, body.replica_id, version);
      if (existing?.status === "ready" || existing?.status === "creating") {
        return res.status(200).json({ voice_profile: clientVoiceProfile(await refreshProfile(user.id, existing)) });
      }
      if (existing?.status === "deleting") return res.status(409).json({ error: "voice_profile_deletion_in_progress" });
      const enrollment = await loadOwnedAzureVoiceEnrollment(q, user.id, body.replica_id, version);
      if (!enrollment) return res.status(409).json({ error: "voice_enrollment_not_ready" });
      const prepared = await materializeAzureVoiceEnrollment(enrollment, (locator) => createSignedReplicaRead(locator));
      const provider = createVoiceProvider("azure_personal_voice", { db: q });
      const result = await provider.createVoice(prepared.input);
      const profile = await persistCreatedVoiceProfile(
        q,
        user.id,
        prepared,
        result,
        azurePersonalVoiceConfig(process.env),
      );
      if (!profile) return res.status(409).json({ error: "voice_enrollment_authority_changed" });
      return res.status(201).json({ voice_profile: clientVoiceProfile(profile) });
    }
    if (body.op === "delete") {
      const profile = await markOwnedVoiceProfileDeleting(q, user.id, body.replica_id, body.voice_profile_id);
      if (!profile) return res.status(404).json({ error: "voice_profile_not_found" });
      try {
        const provider = createVoiceEraser(profile.provider);
        await provider.deleteVoice(profile.provider_ref);
        const deleted = await completeOwnedVoiceProfileDeletion(q, user.id, profile);
        return res.status(deleted ? 200 : 202).json({
          voice_profile_id: profile.voice_profile_id,
          erasure: deleted ? "complete" : "pending",
        });
      } catch {
        return res.status(202).json({
          voice_profile_id: profile.voice_profile_id,
          erasure: "pending",
        });
      }
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof ReplicaStorageError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "voice_profile_failure" : error.code || error.message });
  }
}
