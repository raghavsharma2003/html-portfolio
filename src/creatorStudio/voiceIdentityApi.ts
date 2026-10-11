import { replicaRequest } from "./replicaApi";
import { listSources } from "./enrollmentApi";
import type { ReplicaSource, SignedUpload, VoiceIdentityChallenge } from "./types";

/** The frontend half of the WS-R2 seam. Default OFF, so a build without the
 *  variable renders exactly what the deployed studio renders today. */
export function voiceIdentityChallengeUiEnabled(flag: unknown): boolean {
  return flag === "1";
}

const ENDPOINT = "/api/replica-voice-identity";

export async function voiceIdentityStatus(token: string, replicaId: string) {
  const data = await replicaRequest<{ challenge: VoiceIdentityChallenge | null }>(token, ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ op: "status", replica_id: replicaId }),
  });
  return data.challenge;
}

export async function issueVoiceIdentityChallenge(token: string, replicaId: string) {
  const data = await replicaRequest<{ challenge: VoiceIdentityChallenge }>(token, ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ op: "issue", replica_id: replicaId }),
  });
  return data.challenge;
}

export async function cancelVoiceIdentityChallenge(token: string, replicaId: string, challengeId: string) {
  const data = await replicaRequest<{ challenge: VoiceIdentityChallenge }>(token, ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ op: "cancel", replica_id: replicaId, challenge_id: challengeId }),
  });
  return data.challenge;
}

export async function createVoiceIdentityUpload(
  token: string,
  input: {
    replicaId: string;
    challengeId: string;
    role: "capture" | "transcript";
    kind: "audio" | "video";
    mime: string;
    byteSize: number;
    sha256: string;
  },
) {
  return replicaRequest<{
    challenge: VoiceIdentityChallenge;
    source: ReplicaSource;
    upload: SignedUpload;
  }>(token, ENDPOINT, {
    method: "POST",
    body: JSON.stringify({
      op: "create_upload",
      replica_id: input.replicaId,
      challenge_id: input.challengeId,
      role: input.role,
      kind: input.kind,
      mime: input.mime,
      byte_size: input.byteSize,
      sha256: input.sha256,
      contains_third_parties: false,
    }),
  });
}

export async function finalizeVoiceIdentityUpload(
  token: string,
  replicaId: string,
  challengeId: string,
  sourceId: string,
) {
  try {
    return await replicaRequest<{
    challenge: VoiceIdentityChallenge;
    source: ReplicaSource;
  }>(token, ENDPOINT, {
    method: "POST",
    body: JSON.stringify({
      op: "finalize",
      replica_id: replicaId,
      challenge_id: challengeId,
      source_id: sourceId,
    }),
    });
  } catch (error) {
    // A lost response can follow a committed finalize. One readback can
    // confirm upload state; it does not perform or infer identity acceptance.
    const status = (error as { status?: number })?.status;
    if (status !== undefined && status !== 404 && status < 500) throw error;
    try {
      const [challenge, sources] = await Promise.all([
        voiceIdentityStatus(token, replicaId), listSources(token, replicaId),
      ]);
      const source = sources.find((item) => item.source_id === sourceId && item.replica_id === replicaId &&
        item.capture_mode === "identity_challenge" && item.state === "quarantined");
      if (challenge?.challenge_id === challengeId && challenge.replica_id === replicaId &&
          (challenge.state === "issued" || challenge.state === "captured") &&
          new Date(challenge.expires_at).getTime() > Date.now() &&
          [challenge.captured_source_id, challenge.transcript_source_id].includes(sourceId) && source) {
        return { challenge, source };
      }
    } catch { /* An unavailable readback is still an uncertain finalize. */ }
    throw error;
  }
}
