// Handoff - the follower's side (WS-R20). `roomCheckinsApi.ts`'s own pattern
// one file over: owns no decision, every rule lives in api/_handoff.js.
export class RoomHandoffApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export interface HandoffMine {
  handoff_id: string;
  thread_id: string | null;
  state: "drafted" | "sent" | "answered" | "withdrawn";
  payload_text: string;
  sent_at: string | null;
  answered_at: string | null;
  reply_text: string;
  created_at: string;
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RoomHandoffApiError(String(data?.error || `handoff_request_failed_${response.status}`), response.status);
  return data as T;
}

/** The verbatim payload screen's own text and hash - PURE, no request is
 *  sent until `sendHandoff` is called with exactly what this returned. */
export const draftHandoff = (
  session: string,
  pick: { threadId?: string | null; messageIndexes?: number[]; note?: string },
) =>
  post<{ payload_text: string; payload_sha256: string; thread_id: string | null }>({
    op: "draft",
    session,
    thread_id: pick.threadId ?? null,
    message_indexes: pick.messageIndexes ?? null,
    note: pick.note ?? null,
  });

export const sendHandoff = (session: string, payloadText: string, payloadSha256: string, threadId: string | null) =>
  post<{ handoff_id: string; state: string; sent_at: string }>({
    op: "send",
    session,
    payload_text: payloadText,
    payload_sha256: payloadSha256,
    thread_id: threadId,
  });

export const withdrawHandoff = (session: string, handoffId: string) =>
  post<{ handoff_id: string; state: string }>({ op: "withdraw", session, handoff_id: handoffId });

export const myHandoffs = (session: string) =>
  post<{ handoffs: HandoffMine[] }>({ op: "mine", session }).then((r) => r.handoffs);
