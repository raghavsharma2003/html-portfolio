import { replicaRequest } from "./replicaApi";
import type { IdentityCase } from "./types";

const ATTESTATIONS = {
  is_my_government_id: true,
  document_contains_only_me: true,
  identity_and_age_verification_only: true,
  no_model_training: true,
  erase_after_verification: true,
} as const;

export async function identityStatus(token: string, replicaId: string) {
  const data = await replicaRequest<{ identity_case: IdentityCase | null }>(token, "/api/replica-identity", {
    method: "POST",
    body: JSON.stringify({ op: "status", replica_id: replicaId }),
  });
  return data.identity_case;
}

export async function submitIdentityCase(token: string, replicaId: string, sourceId: string) {
  const data = await replicaRequest<{ identity_case: IdentityCase }>(token, "/api/replica-identity", {
    method: "POST",
    body: JSON.stringify({ op: "submit", replica_id: replicaId, source_id: sourceId, attestations: ATTESTATIONS }),
  });
  return data.identity_case;
}

export async function revokeIdentityCase(token: string, replicaId: string, identityCaseId: string) {
  const data = await replicaRequest<{ identity_case: IdentityCase; source_erasure: "pending" }>(token, "/api/replica-identity", {
    method: "POST",
    body: JSON.stringify({ op: "revoke", replica_id: replicaId, identity_case_id: identityCaseId }),
  });
  return data.identity_case;
}
