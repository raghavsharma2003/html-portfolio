// roomCohortsApi.ts — fetch wrapper for `/api/room-cohorts`, the *Api.ts
// pattern (see roomPublishApi.ts, readinessApi.ts). WS-R12.
import { replicaRequest } from "./replicaApi";

export interface RoomCohort {
  cohort_week: string;
  week_start: string;
  followers_joined: number;
  measurable: boolean;
  not_measurable_until: string | null;
  week6_return_share: number | null;
  paid_conversion_share: number | null;
}

export type RoomCohortVerdict =
  | "not_measurable_yet"
  | "below_25"
  | "between_25_and_40"
  | "above_40";

export interface RoomCohortVerdictLine {
  verdict: RoomCohortVerdict;
  cohort_week: string | null;
  week6_return_share: number | null;
}

export interface RoomCohortReport {
  cohorts: RoomCohort[];
  verdict: RoomCohortVerdictLine;
}

/** Thrown with the server's own code — `RoomPublishApiError`'s own shape one
 *  file over, so a caller already handling that type handles this the same
 *  way (401/403 -> re-auth, anything else -> a named reason on screen). */
export class RoomCohortsApiError extends Error {
  status: number;
  code: string;

  constructor(code: string, status: number) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function readOwnedRoomCohorts(token: string, replicaId: string): Promise<RoomCohortReport | null> {
  try {
    return await replicaRequest<RoomCohortReport>(
      token,
      `/api/room-cohorts?replica_id=${encodeURIComponent(replicaId)}`,
    );
  } catch (e: any) {
    if (e?.status === 404) return null;
    const code = typeof e?.data?.error === "string" ? e.data.error : (e?.message || "room_cohorts_failure");
    throw new RoomCohortsApiError(code, Number(e?.status || 500));
  }
}
