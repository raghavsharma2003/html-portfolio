// WS-R153. Thin fetch wrapper over api/replica-vibe.js, the same shape
// personModelApi.ts already uses for a different owner-bearer door — one
// function per op, `replicaRequest`'s own bearer/JSON/error handling reused
// rather than re-implemented.
import { replicaRequest } from "./replicaApi";

export type VibeDim = 0 | 1 | 2 | 3 | 4;

export interface ReplicaVibe {
  vibe_id: string;
  replica_id: string;
  owner_user_id: string;
  version: number;
  warmth: VibeDim;
  energy: VibeDim;
  humour: VibeDim;
  directness: VibeDim;
  formality: VibeDim;
  note: string;
  created_at: string;
  superseded_at?: string | null;
}

export interface ReplicaVibeState {
  vibe: ReplicaVibe | null;
  history: readonly ReplicaVibe[];
}

export async function readReplicaVibe(token: string, replicaId: string): Promise<ReplicaVibeState> {
  const data = await replicaRequest<ReplicaVibeState>(token, "/api/replica-vibe", {
    method: "POST",
    body: JSON.stringify({ op: "get", replica_id: replicaId }),
  });
  return { vibe: data.vibe ?? null, history: data.history ?? [] };
}

export async function setReplicaVibe(
  token: string,
  replicaId: string,
  dims: { warmth: VibeDim; energy: VibeDim; humour: VibeDim; directness: VibeDim; formality: VibeDim; note?: string },
): Promise<ReplicaVibe> {
  const data = await replicaRequest<{ vibe: ReplicaVibe }>(token, "/api/replica-vibe", {
    method: "POST",
    body: JSON.stringify({ op: "set", replica_id: replicaId, ...dims }),
  });
  return data.vibe;
}

export async function revertReplicaVibe(token: string, replicaId: string, toVersion: number): Promise<ReplicaVibe> {
  const data = await replicaRequest<{ vibe: ReplicaVibe }>(token, "/api/replica-vibe", {
    method: "POST",
    body: JSON.stringify({ op: "revert", replica_id: replicaId, to_version: toVersion }),
  });
  return data.vibe;
}
