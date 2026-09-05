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

// WS-R25 (migration 088). "Minutes to first Room" and "where creators stop" -
// `api/_funnel.js`'s own `funnelSummary` shape, typed here unchanged.
export interface OpsFunnelStall {
  step: string;
  count: number;
}

export interface OpsFunnel {
  minutes_to_first_room: {
    median: number | null;
    p90: number | null;
    n: number;
  };
  stalled_at: OpsFunnelStall[];
}

// WS-R40 (migration 102). `api/_funnel.js`'s own `shareArrivalsThisWeek`
// shape, typed here unchanged - this file computes nothing, `opsApi.ts`'s
// own header rule restated.
export interface OpsShareArrivals {
  n: number | null;
  below_floor: boolean;
  note: string;
}

// WS-R30 (migration 093). `api/_phase-gate.js`'s own `phaseGate` shape, typed
// here unchanged - this file computes nothing, `opsApi.ts`'s own header rule.
export type OpsGateState = "below" | "at_or_above" | "not_enough_data";

export interface OpsConversion {
  pct: number | null;
  n: number;
  eligible: number;
  paying: number;
  threshold_pct: number;
  state: OpsGateState;
  funnel: Record<string, { shown: number; started: number; paid: number }>;
}

export interface OpsRetention {
  pct: number | null;
  n: number;
  joined: number;
  returned: number;
  threshold_pct: number;
  state: OpsGateState;
}

export interface OpsRenewedUnasked {
  count: number;
  n: number;
  creators_total: number;
  threshold: number;
  state: OpsGateState;
  note: string;
}

export interface OpsPhaseGate {
  generated_at: string;
  conversion: OpsConversion;
  retention: OpsRetention;
  renewed_unasked: OpsRenewedUnasked;
  phase2_may_start: boolean;
  summary: string;
}

// WS-R58 (migration 109). `api/_ops.js`'s own `incidentsOverview` shape,
// typed here unchanged - this file computes nothing, `opsApi.ts`'s own
// header rule restated.
export interface OpsIncidentRow {
  kind: string;
  door: string;
  count: number;
}

export interface OpsIncidents {
  by_kind_door: OpsIncidentRow[];
  new_kinds: string[];
}

export interface OpsOverview {
  generated_at: string;
  rooms: OpsRoom[];
  sweeps: OpsSweep[];
  funnel: OpsFunnel;
  phase_gate: OpsPhaseGate;
  // WS-R40 (migration 102).
  share_arrivals_this_week: OpsShareArrivals;
  // WS-R58 (migration 109).
  incidents: OpsIncidents;
}

export async function readOpsOverview(token: string): Promise<OpsOverview> {
  return replicaRequest<OpsOverview>(token, "/api/ops");
}
