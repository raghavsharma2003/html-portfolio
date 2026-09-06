import { replicaRequest } from "./replicaApi";
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
  return replicaRequest<{
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
}
