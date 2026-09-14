import { replicaRequest } from "./replicaApi";
import type { PersonModelStatus, ReplicaClaim, ReplicaProfileSummary } from "./types";

export async function readPersonModel(token: string, replicaId: string): Promise<PersonModelStatus> {
  const data = await replicaRequest<{ person_model: PersonModelStatus }>(
    token,
    `/api/replica-person-model?replica_id=${encodeURIComponent(replicaId)}`,
  );
  return data.person_model;
}

export async function decideClaim(
  token: string,
  replicaId: string,
  claimId: string,
  decision: "accepted" | "rejected" | "superseded",
  reasonCode: string,
) {
  return replicaRequest<{ decision: { decision_id: string; claim_id: string; decision: string; reason_code: string; created_at: string } }>(
    token,
    "/api/replica-person-model",
    { method: "POST", body: JSON.stringify({ op: "decide_claim", replica_id: replicaId, claim_id: claimId, decision, reason_code: reasonCode }) },
  );
}

export async function buildPersonProfile(token: string, replicaId: string): Promise<ReplicaProfileSummary> {
  const data = await replicaRequest<{ profile: ReplicaProfileSummary }>(token, "/api/replica-person-model", {
    method: "POST",
    body: JSON.stringify({ op: "build_profile", replica_id: replicaId }),
  });
  return data.profile;
}

export async function approvePersonProfile(token: string, replicaId: string, version: number): Promise<ReplicaProfileSummary> {
  const data = await replicaRequest<{ profile: ReplicaProfileSummary }>(token, "/api/replica-person-model", {
    method: "POST",
    body: JSON.stringify({ op: "approve_profile", replica_id: replicaId, version }),
  });
  return data.profile;
}

export type { ReplicaClaim };
