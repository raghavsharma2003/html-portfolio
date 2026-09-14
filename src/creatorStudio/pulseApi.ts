// pulseApi.ts — fetch wrapper for `/api/pulse`, the *Api.ts pattern
// (see roomCohortsApi.ts, roomPublishApi.ts). WS-R17.
import { replicaRequest } from "./replicaApi";

export interface PulseBucket {
  topic_id: string;
  label: string;
  follower_count: number;
}

export type PulseStatus = "ready" | "not_enough_optins" | "no_topic_at_floor";

/** Mirrored constants, WS-R35 (Pulse v1, migration 097). Real source of
 *  truth is `api/_pulse.js`'s `PULSE_MAX_LABELS`/`PULSE_LABEL_MAX_LEN` — the
 *  front end cannot import a server module (`src/studio` never imports from
 *  `api/`, confirmed by grep before adding this), so these two numbers are
 *  mirrored the way this repo already mirrors other cross-boundary
 *  constants (AGENTS.md's own "enrollment sample-rate mirror" example).
 *  Keep them equal to `api/_pulse.js`'s real values or the studio's own
 *  "add a topic" cutoff drifts from what the server will actually accept. */
export const PULSE_MAX_LABELS = 12; // mirror of api/_pulse.js#PULSE_MAX_LABELS
export const PULSE_LABEL_MAX_LEN = 32; // mirror of api/_pulse.js#PULSE_LABEL_MAX_LEN

export interface PulseTopic {
  topic_id: string;
  label: string;
}

/** WS-R35 (Pulse v1, migration 097): a count over a SET of 1-2 labels,
 *  the k-anonymous combination form — `labels.length === 1` reads exactly
 *  like a v0 bucket, `labels.length === 2` is a combination the creator
 *  never asked for directly but that clearing k-anonymity made safe to
 *  publish. */
export interface PulseComboBucket {
  labels: string[];
  follower_count: number;
}

export interface PulseReport {
  week_start: string | null;
  total_optin: number;
  status: PulseStatus;
  buckets: PulseBucket[];
  topics: PulseTopic[];
  // WS-R35 additions, additive only.
  combo_week_start: string | null;
  suppressed: number;
  combo_buckets: PulseComboBucket[];
  note: string;
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
