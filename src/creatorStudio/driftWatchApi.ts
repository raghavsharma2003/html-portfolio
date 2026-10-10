// driftWatchApi.ts — the client half of `/api/drift-watch`, following
// readinessApi.ts's own pattern (the *Api.ts house style: one file per
// surface owns the route and the JSON keys, nothing else does).
//
// The same rule readinessApi.ts states applies here with the same force:
// COMPUTE NOTHING. `score`, `percent_of_ceiling` and `trend` arrive already
// decided or arrive null, and null means NOT MEASURED — never zero, never a
// client-side fallback.
import { replicaRequest } from "./replicaApi";
import type { ReadinessAction } from "./readinessApi";

export type DriftState = "steady" | "moved" | "not_measured";

export interface DriftTrendPoint {
  at: string;
  mean: number;
}

export interface DriftWatch {
  policy_version: string;
  computed_at: string;
  state: DriftState;
  /** Codes, not sentences: "no_fidelity_row", "no_owner_ceiling",
   *  "model_commitment_changed", "score_dropped". Copy for them lives here,
   *  in the studio, where the copy gate can read it. */
  reasons: string[];
  /** null means NOT MEASURED. It never means zero. */
  score: number | null;
  score_computed_at: string | null;
  ceiling: number | null;
  /** The same scale api/readiness.js's "sounds like you" uses: a percent of
   *  THIS owner's own ceiling, never a shared constant. */
  percent_of_ceiling: number | null;
  /** Real measured points only, last 30 days, ascending by date. Never
   *  interpolated and never padded to a fixed length. */
  trend: DriftTrendPoint[];
  last_model_change_at: string | null;
  last_model_commitment: string | null;
  prosody_anchor_stale: boolean;
  prosody_anchor_reason: string | null;
  action: ReadinessAction | null;
}

export async function readDriftWatch(token: string, replicaId: string): Promise<DriftWatch> {
  const data = await replicaRequest<{ drift: DriftWatch }>(
    token,
    `/api/drift-watch?replica_id=${encodeURIComponent(replicaId)}`,
  );
  return data.drift;
}
