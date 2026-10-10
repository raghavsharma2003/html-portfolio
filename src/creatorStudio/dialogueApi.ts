import { replicaRequest } from "./replicaApi";
import type { ReplicaDialogueTurn } from "./types";

export async function createDialogueTurn(
  token: string,
  replicaId: string,
  message: string,
  sessionId?: string,
): Promise<ReplicaDialogueTurn> {
  const data = await replicaRequest<{ turn: ReplicaDialogueTurn }>(token, "/api/replica-dialogue", {
    method: "POST",
    body: JSON.stringify({
      replica_id: replicaId,
      channel: "private_chat",
      message,
      ...(sessionId ? { session_id: sessionId } : {}),
    }),
  });
  return data.turn;
}

export async function fetchProtectedTurnVoice(token: string, replicaId: string, turnId: string): Promise<Blob> {
  const response = await fetch("/api/replica-speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      replica_id: replicaId,
      dialogue_turn_id: turnId,
      channel: "private_chat",
      purpose: "private_conversation",
      stream: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(String(data?.error || `protected voice failed (${response.status})`).replaceAll("_", " "));
  }
  return response.blob();
}
