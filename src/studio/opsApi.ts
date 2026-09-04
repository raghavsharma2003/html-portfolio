// opsApi.ts - the client half of `/api/ops` (WS-R21). One file owns the
// route and the JSON keys, `driftWatchApi.ts`'s own house style.
//
// COMPUTE NOTHING here. Every number arrives already decided by
// `api/_ops.js`; this file only types the response and calls the route.
import { replicaRequest } from "./replicaApi";

export interface OpsRoom {
  room_id: string;
  slug: string;
  display_name: string;
  published: boolean;
  followers_total: number;
  followers_paid: number;
  joined_last_7d: number;
  messages_last_24h: number;
  at_cap_this_month: number;
  voice_seconds_this_month: number;
  active_check_ins: number;
  deliveries_last_24h: Record<string, number>;
  pulse_opt_ins: number;
  latest_pulse_week: string | null;
  subscriptions: {
    created: number;
    authenticated: number;
    active: number;
    paused: number;
    cancelled: number;
    expired: number;
  };
  revenue_this_month_inr: number;
  drift_state: "steady" | "moved" | "not_measured" | "no_report";
  drift_computed_at: string | null;
}

export type SweepOutcome = "running" | "ok" | "partial" | "failed" | "never_ran";
export type SweepStaleness = "fresh" | "stale" | "never_ran" | "unscheduled" | "unknown_schedule";

export interface OpsSweep {
  sweep: string;
  path: string | null;
  schedule: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_outcome: SweepOutcome;
  last_error_code: string;
  counts: Record<string, number | boolean>;
  staleness: SweepStaleness;
}

export interface OpsOverview {
  generated_at: string;
  rooms: OpsRoom[];
  sweeps: OpsSweep[];
}

export async function readOpsOverview(token: string): Promise<OpsOverview> {
  return replicaRequest<OpsOverview>(token, "/api/ops");
}
