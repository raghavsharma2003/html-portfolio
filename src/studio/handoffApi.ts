// Handoff - the creator's side (WS-R20). `checkinsApi.ts`'s own pattern one
// file over: owns no decision, every rule lives in api/_handoff.js.
import { replicaRequest } from "./replicaApi";

export interface HandoffConfig {
  enabled: boolean;
  monthly_cap: number;
}

export interface HandoffCounts {
  drafted: number;
  sent: number;
  answered: number;
  withdrawn: number;
}

export interface HandoffQueueItem {
  handoff_id: string;
  thread_id: string | null;
  payload_text: string;
  policy_version: number;
  sent_at: string;
}

export interface HandoffQueue {
  counts: HandoffCounts;
  next: HandoffQueueItem | null;
}

export class HandoffApiError extends Error {
  status: number;
  code: string;
  constructor(code: string, status: number) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function post<T>(token: string, body: Record<string, unknown>): Promise<T> {
  return replicaRequest<T>(token, "/api/handoff", { method: "POST", body: JSON.stringify(body) }).catch((e: any) => {
    const code = typeof e?.data?.error === "string" ? e.data.error : (e?.message || "handoff_failure");
    throw new HandoffApiError(code, Number(e?.status || 500));
  });
}

export const getHandoffConfig = (token: string, replicaId: string) =>
  post<HandoffConfig>(token, { op: "config_get", replica_id: replicaId });

export const setHandoffConfig = (token: string, replicaId: string, enabled: boolean, monthlyCap: number) =>
  post<HandoffConfig>(token, { op: "config_set", replica_id: replicaId, enabled, monthly_cap: monthlyCap });

export const loadHandoffQueue = (token: string, replicaId: string) =>
  post<HandoffQueue>(token, { op: "queue", replica_id: replicaId });

export const answerHandoff = (token: string, replicaId: string, handoffId: string, replyText: string) =>
  post<{ handoff_id: string; state: string; answered_at: string }>(token, {
    op: "answer",
    replica_id: replicaId,
    handoff_id: handoffId,
    reply_text: replyText,
  });
