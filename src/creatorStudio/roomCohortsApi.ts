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

// WS-R154 ("RelationOS in the Room"). The five stage words `stageForDims`
// (`src/engine/relstate.ts`) can ever return — mirrored here as a union
// rather than imported (this workstream's own `api/_room-relstate.js`
// header states the reason one boundary over: the studio's own TS build
// never imports `api/`, and `src/engine` is a separate bundle this file
// does not otherwise reach).
export type RoomRelStage = "new" | "warming" | "settled" | "close" | "deep";

export interface RoomRelStageCount {
  stage: RoomRelStage;
  n: number;
}

export interface RoomCohortReport {
  cohorts: RoomCohort[];
  verdict: RoomCohortVerdictLine;
  // n>=5 floored server side (`api/_room-relstate.js`'s own
  // `roomRelStateStageCounts`) — a bucket below the floor is simply ABSENT
  // from this array, never a zero or a rounded number. Always present as an
  // array (possibly empty), never undefined — `readOwnedRoomCohorts`'s own
  // best-effort `.catch(() => [])`.
  relstate_stage_counts: RoomRelStageCount[];
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
