import type { Replica } from "./types";

export class ReplicaApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function replicaRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof data?.error === "string"
      ? data.error
      : typeof data?.source?.rejection_code === "string" && data.source.rejection_code
        ? `Source rejected: ${data.source.rejection_code}`
        : `request failed (${response.status})`;
    throw new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
  }
  return data as T;
}

export async function listReplicas(token: string): Promise<Replica[]> {
  const data = await replicaRequest<{ replicas: Replica[] }>(token, "/api/replica");
  return Array.isArray(data.replicas) ? data.replicas : [];
}

export async function readReplica(token: string, id: string): Promise<Replica> {
  const data = await replicaRequest<{ replica: Replica }>(
    token,
    `/api/replica?replica_id=${encodeURIComponent(id)}`,
  );
  return data.replica;
}

export async function createReplica(token: string, displayName: string): Promise<Replica> {
  const data = await replicaRequest<{ replica: Replica }>(token, "/api/replica", {
    method: "POST",
    body: JSON.stringify({ op: "create", display_name: displayName }),
  });
  return data.replica;
}

export async function revokeReplica(
  token: string,
  id: string,
): Promise<{ replica: Replica; erasure: string }> {
  return replicaRequest(token, "/api/replica", {
    method: "POST",
    body: JSON.stringify({ op: "revoke", replica_id: id }),
  });
}
