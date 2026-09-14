import { replicaRequest } from "./replicaApi";
import type { ReplicaRuntimeStatus } from "./types";

export async function readRuntimeStatus(token: string, replicaId: string): Promise<ReplicaRuntimeStatus> {
  const data = await replicaRequest<{ runtime: ReplicaRuntimeStatus }>(
    token,
    `/api/replica-runtime?replica_id=${encodeURIComponent(replicaId)}`,
  );
  return data.runtime;
}

export async function activateRuntime(token: string, replicaId: string): Promise<ReplicaRuntimeStatus> {
  const data = await replicaRequest<{ runtime: ReplicaRuntimeStatus }>(token, "/api/replica-runtime", {
    method: "POST",
    body: JSON.stringify({ op: "activate", replica_id: replicaId }),
  });
  return data.runtime;
}
