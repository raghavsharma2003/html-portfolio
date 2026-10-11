import { replicaRequest } from "./replicaApi";
import type { ClaimExtractionRun, ClaimExtractionStatus } from "./types";

export async function readClaimExtraction(token: string, replicaId: string): Promise<ClaimExtractionStatus> {
  const data = await replicaRequest<{ extraction: ClaimExtractionStatus }>(
    token,
    `/api/replica-claims?replica_id=${encodeURIComponent(replicaId)}`,
  );
  return data.extraction;
}

export async function extractClaims(token: string, replicaId: string): Promise<ClaimExtractionRun> {
  const data = await replicaRequest<{ run: ClaimExtractionRun }>(token, "/api/replica-claims", {
    method: "POST",
    body: JSON.stringify({ op: "extract", replica_id: replicaId }),
  });
  return data.run;
}
