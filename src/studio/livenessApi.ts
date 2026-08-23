import { replicaRequest } from "./replicaApi";
import type { LivenessChallenge, ReplicaSource, SignedUpload } from "./types";

export async function livenessStatus(token: string, replicaId: string) {
  const data = await replicaRequest<{ challenge: LivenessChallenge | null }>(token, "/api/replica-liveness", {
    method: "POST",
    body: JSON.stringify({ op: "status", replica_id: replicaId }),
  });
  return data.challenge;
}

export async function issueLivenessChallenge(token: string, replicaId: string) {
  const data = await replicaRequest<{ challenge: LivenessChallenge }>(token, "/api/replica-liveness", {
    method: "POST",
    body: JSON.stringify({ op: "issue", replica_id: replicaId }),
  });
  return data.challenge;
}

export async function createLivenessUpload(
  token: string,
  input: {
    replicaId: string;
    challengeId: string;
    kind: "audio" | "video";
    mime: string;
    byteSize: number;
    sha256: string;
  },
) {
  return replicaRequest<{
    challenge: LivenessChallenge;
    source: ReplicaSource;
    upload: SignedUpload;
  }>(token, "/api/replica-liveness", {
    method: "POST",
    body: JSON.stringify({
      op: "create_upload",
      replica_id: input.replicaId,
      challenge_id: input.challengeId,
      kind: input.kind,
      mime: input.mime,
      byte_size: input.byteSize,
      sha256: input.sha256,
      contains_third_parties: false,
    }),
  });
}

export async function finalizeLivenessUpload(
  token: string,
  replicaId: string,
  challengeId: string,
  sourceId: string,
) {
  return replicaRequest<{
    challenge: LivenessChallenge;
    source: ReplicaSource;
    verification: "pending";
  }>(token, "/api/replica-liveness", {
    method: "POST",
    body: JSON.stringify({
      op: "finalize",
      replica_id: replicaId,
      challenge_id: challengeId,
      source_id: sourceId,
    }),
  });
}
