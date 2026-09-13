import { replicaRequest, ReplicaApiError } from "./replicaApi";
import type { ReplicaDialogueTurn, ReplicaDialogueHistory, PrivateConversationSource } from "./types";

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
      || (answer.has_continuity !== undefined && typeof answer.has_continuity !== "boolean")
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
  recallPrevious = false,
): Promise<ReplicaDialogueTurn> {
  const data = await replicaRequest<{ turn: ReplicaDialogueTurn }>(token, "/api/replica-dialogue", {
    method: "POST",
    body: JSON.stringify({
      replica_id: replicaId,
      channel: "private_chat",
      message,
      recall_previous: recallPrevious,
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(traceId ? { trace_id: traceId } : {}),
    }),
  });
  if(data.turn?.has_continuity !== undefined && typeof data.turn.has_continuity !== "boolean") invalidHistory();
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

// WS-R167: the owner's own continuity in Meet. Same op names and response
// shapes api/room.js already exposes for a Room follower, over the owner's
// own dyad. Every function here validates the server's own answer shape
// before returning it, the same discipline readDialogueHistory above uses.

export type MeetMemoryFact = {
  id: string;
  body: string;
  kind: "user" | "relationship";
  name: string;
  created_at: string;
  communication_classification: string;
};

export type MeetRelState = {
  has_state: boolean;
  memory_on: boolean;
  honorific?: string;
  trust?: number;
  rupture_open?: boolean;
  repair_state?: string;
  last_honorific_move_at?: string | null;
  last_rupture_move_at?: string | null;
  warm_episodes_since_rupture?: number;
};

function invalidMemory(): never { throw new ReplicaApiError("Memory could not be verified", 502, {}); }

export async function readMeetMemoryStatus(token: string, replicaId: string): Promise<boolean> {
  const data = await replicaRequest<{ memory_on: boolean }>(token, "/api/replica-dialogue", {
    method: "POST", body: JSON.stringify({ op: "memory_status", replica_id: replicaId }),
  });
  if (typeof data.memory_on !== "boolean") invalidMemory();
  return data.memory_on;
}

export async function setMeetMemoryOn(token: string, replicaId: string, on: boolean): Promise<boolean> {
  const data = await replicaRequest<{ memory_on: boolean }>(token, "/api/replica-dialogue", {
    method: "POST", body: JSON.stringify({ op: "memory_toggle", replica_id: replicaId, on }),
  });
  if (typeof data.memory_on !== "boolean") invalidMemory();
  return data.memory_on;
}

export async function readMeetMemoryFacts(token: string, replicaId: string): Promise<MeetMemoryFact[]> {
  const data = await replicaRequest<{ facts: MeetMemoryFact[] }>(token, "/api/replica-dialogue", {
    method: "POST", body: JSON.stringify({ op: "memory_facts", replica_id: replicaId }),
  });
  if (!Array.isArray(data.facts)) invalidMemory();
  for (const f of data.facts) if (!f || typeof f.id !== "string" || typeof f.body !== "string") invalidMemory();
  return data.facts;
}

export async function correctMeetMemoryFact(token: string, replicaId: string, factId: string, replacement: string): Promise<MeetMemoryFact> {
  const data = await replicaRequest<{ fact: { id: string; body: string }; communication_classification: string }>(token, "/api/replica-dialogue", {
    method: "POST", body: JSON.stringify({ op: "memory_correct", replica_id: replicaId, fact_id: factId, replacement }),
  });
  if (!data.fact || typeof data.fact.id !== "string" || typeof data.fact.body !== "string") invalidMemory();
  return { id: data.fact.id, body: data.fact.body, kind: "user", name: "", created_at: new Date().toISOString(), communication_classification: data.communication_classification };
}

export async function forgetMeetMemoryFact(token: string, replicaId: string, factId: string): Promise<void> {
  const data = await replicaRequest<{ forgotten: boolean }>(token, "/api/replica-dialogue", {
    method: "POST", body: JSON.stringify({ op: "memory_forget", replica_id: replicaId, fact_id: factId }),
  });
  if (data.forgotten !== true) invalidMemory();
}

export async function readMeetRelState(token: string, replicaId: string): Promise<MeetRelState> {
  const data = await replicaRequest<MeetRelState>(token, "/api/replica-dialogue", {
    method: "POST", body: JSON.stringify({ op: "relstate", replica_id: replicaId }),
  });
  if (typeof data.has_state !== "boolean" || typeof data.memory_on !== "boolean") invalidMemory();
  return data;
}

export async function resetMeetRelState(token: string, replicaId: string): Promise<{ reset: boolean; reason?: string }> {
  const data = await replicaRequest<{ reset: boolean; reason?: string }>(token, "/api/replica-dialogue", {
    method: "POST", body: JSON.stringify({ op: "relstate_reset", replica_id: replicaId }),
  });
  if (typeof data.reset !== "boolean") invalidMemory();
  return data;
}

export async function readPrivateConversationSources(token:string, replicaId:string, turnId:string, signal?:AbortSignal):Promise<PrivateConversationSource[]> {
  const data=await replicaRequest<{sources:PrivateConversationSource[]}>(token,"/api/replica-dialogue",{
    method:"POST",signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20_000)]):AbortSignal.timeout(20_000),
    body:JSON.stringify({op:"continuity_sources",replica_id:replicaId,turn_id:turnId}),
  });
  if(!Array.isArray(data.sources)||data.sources.length>3)invalidHistory();
  const ids=new Set<string>();
  for(const item of data.sources){
    if(!item||!uuid(item.turn_id)||ids.has(item.turn_id)||typeof item.question!=="string"||item.question.length>400
      ||typeof item.reply!=="string"||item.reply.length>400||!Number.isFinite(Date.parse(item.created_at)))invalidHistory();
    ids.add(item.turn_id);
  }
  return data.sources;
}
