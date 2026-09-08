import { replicaRequest, ReplicaApiError } from "./replicaApi";
import type { ReplicaRuntimeStatus } from "./types";

export async function readRuntimeStatus(token: string, replicaId: string): Promise<ReplicaRuntimeStatus> {
  const data = await replicaRequest<{ runtime: ReplicaRuntimeStatus }>(
    token,
    `/api/replica-runtime?replica_id=${encodeURIComponent(replicaId)}`,
  );
  const status=data.runtime;
  if(status?.private_selection!==undefined&&(typeof status.private_selection!=='boolean'
    || (status.private_selection&&(status.exposure!=='owner_private_text'||typeof status.private_candidate!=='boolean'
      || !Array.isArray(status.blockers)||status.blockers.length>32||status.blockers.some(item=>typeof item!=='string')
      || (status.active ? typeof status.capability_id!=='string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(status.capability_id)
        || status.blockers.length!==0 : status.capability_id!==null))))) {
    throw new ReplicaApiError('Private conversation readiness could not be verified',502,{});
  }
  return data.runtime;
}

export async function activateRuntime(token: string, replicaId: string): Promise<ReplicaRuntimeStatus> {
  const data = await replicaRequest<{ runtime: ReplicaRuntimeStatus }>(token, "/api/replica-runtime", {
    method: "POST",
    body: JSON.stringify({ op: "activate", replica_id: replicaId }),
  });
  return data.runtime;
}
