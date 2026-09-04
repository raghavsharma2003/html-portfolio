// pulseApi.ts — fetch wrapper for `/api/pulse`, the *Api.ts pattern
// (see roomCohortsApi.ts, roomPublishApi.ts). WS-R17.
import { replicaRequest } from "./replicaApi";

export interface PulseBucket {
  topic_id: string;
  label: string;
  follower_count: number;
}

export type PulseStatus = "ready" | "not_enough_optins" | "no_topic_at_floor";

export interface PulseTopic {
  topic_id: string;
  label: string;
}

export interface PulseReport {
  week_start: string | null;
  total_optin: number;
  status: PulseStatus;
  buckets: PulseBucket[];
  topics: PulseTopic[];
}

/** Thrown with the server's own code, `RoomCohortsApiError`'s own shape one
 *  file over — a caller already handling that type handles this the same
 *  way (401/403 -> re-auth, anything else -> a named reason on screen). */
export class PulseApiError extends Error {
  status: number;
  code: string;

  constructor(code: string, status: number) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function readPulse(token: string, replicaId: string): Promise<PulseReport | null> {
  try {
    return await replicaRequest<PulseReport>(token, `/api/pulse?replica_id=${encodeURIComponent(replicaId)}`);
  } catch (e: any) {
    if (e?.status === 404) return null;
    const code = typeof e?.data?.error === "string" ? e.data.error : (e?.message || "pulse_failure");
    throw new PulseApiError(code, Number(e?.status || 500));
  }
}

export async function setPulseTopics(token: string, replicaId: string, topics: string[]): Promise<PulseTopic[]> {
  try {
    const result = await replicaRequest<{ topics: PulseTopic[] }>(token, "/api/pulse", {
      method: "POST",
      body: JSON.stringify({ op: "set_topics", replica_id: replicaId, topics }),
    });
    return result.topics;
  } catch (e: any) {
    const code = typeof e?.data?.error === "string" ? e.data.error : (e?.message || "pulse_failure");
    throw new PulseApiError(code, Number(e?.status || 500));
  }
}
