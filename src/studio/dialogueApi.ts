import { replicaRequest, ReplicaApiError } from "./replicaApi";
import type { ReplicaDialogueTurn, ReplicaDialogueHistory } from "./types";

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function invalidHistory(): never { throw new ReplicaApiError("Conversation history could not be verified", 502, {}); }

export async function readDialogueHistory(token: string, replicaId: string, sessionId?: string, signal?: AbortSignal): Promise<ReplicaDialogueHistory> {
  const data = await replicaRequest<{ history: ReplicaDialogueHistory }>(token,
    `/api/replica-dialogue?replica_id=${encodeURIComponent(replicaId)}${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ""}`,
    { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : undefined });
  const h = data.history;
  if (!h || h.replica_id !== replicaId || (h.session_id !== null && !uuid(h.session_id)) || (sessionId && h.session_id !== sessionId)
    || !Array.isArray(h.exchanges) || h.exchanges.length > 10 || typeof h.pending !== "boolean" || typeof h.billing_pending !== "boolean"
    || (h.session_id === null && (h.exchanges.length > 0 || h.pending || h.billing_pending || h.latest_request !== null))) invalidHistory();
  if (h.latest_request !== null && (!h.latest_request || typeof h.latest_request.trace_id !== "string"
    || !["generating", "complete", "failed", "blocked"].includes(h.latest_request.state))) invalidHistory();
  const ids = new Set<string>();
  for (const item of h.exchanges) {
    const answer = item?.answer;
    if (!item || typeof item.question !== "string" || typeof item.trace_id !== "string" || !answer || !uuid(answer.turn_id)
      || answer.session_id !== h.session_id || typeof answer.reply !== "string" || typeof answer.can_voice !== "boolean"
      || !["settled", "not_metered", "reconcile_required"].includes(String(answer.billing_state)) || typeof answer.created_at !== "string"
      || ids.has(answer.turn_id)) invalidHistory();
    ids.add(answer.turn_id);
  }
  return h;
}

export async function openDialogueSession(token: string, replicaId: string, sessionId: string): Promise<string> {
  if (!uuid(sessionId)) invalidHistory();
  const data = await replicaRequest<{ session: { replica_id: string; session_id: string } }>(token, "/api/replica-dialogue", {
    method: "POST", body: JSON.stringify({ op: "open_session", replica_id: replicaId, session_id: sessionId }),
  });
  if (data.session?.replica_id !== replicaId || data.session.session_id !== sessionId) invalidHistory();
  return sessionId;
}

export async function createDialogueTurn(
  token: string,
  replicaId: string,
  message: string,
  sessionId?: string,
  traceId?: string,
): Promise<ReplicaDialogueTurn> {
  const data = await replicaRequest<{ turn: ReplicaDialogueTurn }>(token, "/api/replica-dialogue", {
    method: "POST",
    body: JSON.stringify({
      replica_id: replicaId,
      channel: "private_chat",
      message,
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(traceId ? { trace_id: traceId } : {}),
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
