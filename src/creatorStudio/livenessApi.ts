import { replicaRequest } from "./replicaApi";
import type { LivenessChallenge, ReplicaSource, SignedUpload } from "./types";

export type BiometricVerificationAttestations = {
  live_face_and_voice_processing: true;
  compare_face_to_my_id: true;
  anti_spoof_and_synthetic_detection: true;
  erase_raw_and_provider_session: true;
  self_only_private_replica: true;
};

const DEVICE_KEY = "meera.device.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stableFaceDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_KEY) || "";
    if (UUID.test(existing)) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export async function livenessStatus(token: string, replicaId: string) {
  const data = await replicaRequest<{ challenge: LivenessChallenge | null }>(token, "/api/replica-liveness", {
    method: "POST",
    body: JSON.stringify({ op: "status", replica_id: replicaId }),
  });
  return data.challenge;
}

export async function issueLivenessChallenge(
  token: string,
  replicaId: string,
  attestations: BiometricVerificationAttestations,
) {
  const data = await replicaRequest<{ challenge: LivenessChallenge }>(token, "/api/replica-liveness", {
    method: "POST",
    body: JSON.stringify({ op: "issue", replica_id: replicaId, attestations }),
  });
  return data.challenge;
}

export async function cancelLivenessChallenge(token: string, replicaId: string, challengeId: string) {
  const data = await replicaRequest<{
    challenge: LivenessChallenge;
    erasure: "pending" | "confirmed" | "not_required";
  }>(token, "/api/replica-liveness", {
    method: "POST",
    body: JSON.stringify({ op: "cancel", replica_id: replicaId, challenge_id: challengeId }),
  });
  return data;
}

export async function startOfficialFaceSession(token: string, replicaId: string, challengeId: string) {
  return replicaRequest<{ challenge: LivenessChallenge; quick_link_url: string }>(token, "/api/replica-liveness", {
    method: "POST",
    signal: AbortSignal.timeout(210_000),
    body: JSON.stringify({
      op: "start_face",
      replica_id: replicaId,
      challenge_id: challengeId,
      device_id: stableFaceDeviceId(),
    }),
  });
}

export async function pollOfficialFaceSession(token: string, replicaId: string, challengeId: string) {
  const data = await replicaRequest<{ challenge: LivenessChallenge }>(token, "/api/replica-liveness", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ op: "poll_face", replica_id: replicaId, challenge_id: challengeId }),
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
