import { replicaRequest } from "./replicaApi";
import type { EvidenceDecision, ReplicaReview } from "./types";

export async function getReplicaReview(token: string, replicaId: string) {
  const data = await replicaRequest<{ review: ReplicaReview }>(token, "/api/replica-review", {
    method: "POST",
    body: JSON.stringify({ op: "status", replica_id: replicaId }),
  });
  return data.review;
}

export async function decideReplicaEvidence(token: string, input: { replicaId: string; evidenceId: string; decision: EvidenceDecision; reasonCode: string }) {
  await replicaRequest(token, "/api/replica-review", {
    method: "POST",
    body: JSON.stringify({ op: "decide", replica_id: input.replicaId, evidence_id: input.evidenceId, decision: input.decision, reason_code: input.reasonCode }),
  });
}

export async function queueVoiceGenome(token: string, replicaId: string) {
  return replicaRequest<{ build: ReplicaReview["builds"][number] }>(token, "/api/replica-review", {
    method: "POST",
    body: JSON.stringify({ op: "queue_voice_genome", replica_id: replicaId }),
  });
}
