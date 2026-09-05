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

// WS-R53 (migration 110). `api/_funnel.js`'s own `tasteTurnsThisWeek` shape,
// typed here unchanged. No `below_floor` - unlike `OpsShareArrivals` above,
// a taste turn has no follower at all, so this count carries no anonymity
// floor (`_funnel.js`'s own header on why).
export interface OpsTasteTurns {
  n: number;
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

// WS-R62 (migration 114). `api/_ops.js`'s own `operatorPushConfig` shape,
// typed here unchanged - this file computes nothing, `opsApi.ts`'s own
// header rule restated. Never the private VAPID key.
export interface OpsPushConfig {
  configured: boolean;
  vapid_public: string | null;
}

// WS-R76 (migration 120). `api/_ops.js`'s own `selfCheckOverview` shape,
// typed here unchanged - this file computes nothing, `opsApi.ts`'s own
// header rule restated. `failing_checks` is a list of the check's own NAMES
// (an env var's name, a table's name, a sweep's name) - never a value.
export interface OpsSelfCheck {
  last_started_at: string | null;
  last_outcome: SweepOutcome;
  staleness: SweepStaleness;
  checked: number;
  passed: number;
  failed: number;
  failing_checks: string[];
}

// WS-R78 (migration 121). `api/_funnel.js`'s own `posterArrivalsThisWeek`
// shape, typed here unchanged - this file computes nothing, `opsApi.ts`'s
// own header rule restated. `OpsShareArrivals`'s own shape, one `via`
// value over.
export interface OpsPosterArrivals {
  n: number | null;
  below_floor: boolean;
  note: string;
}

// WS-R88 (migration 125). `api/_operator-digest.js`'s own `lastOperatorDigest`
// shape, typed here unchanged - this file computes nothing, `opsApi.ts`'s
// own header rule restated. WS-R98 nests `telegram` - `api/_ops.js`'s own
// `digestTelegramOverview` shape, "both channels' last delivery"
// (workstream law #3).
export interface OpsDigestTelegram {
  configured: boolean;
  last_run_at: string | null;
  last_sent_count: number;
}
export interface OpsDigest {
  sent_at: string | null;
  telegram: OpsDigestTelegram;
}

// WS-R86 (migration 123). `api/_funnel.js`'s own `friendArrivalsThisWeek`
// shape, typed here unchanged - `OpsPosterArrivals`'s own shape, one `via`
// value over.
export interface OpsFriendArrivals {
  n: number | null;
  below_floor: boolean;
  note: string;
}

export interface OpsOverview {
  generated_at: string;
  rooms: OpsRoom[];
  sweeps: OpsSweep[];
  // WS-R76 (migration 120).
  self_check: OpsSelfCheck;
  funnel: OpsFunnel;
  phase_gate: OpsPhaseGate;
  // WS-R40 (migration 102).
  share_arrivals_this_week: OpsShareArrivals;
  // WS-R58 (migration 109).
  incidents: OpsIncidents;
  // WS-R53 (migration 110).
  taste_turns_this_week: OpsTasteTurns;
  // WS-R62 (migration 114).
  push: OpsPushConfig;
  // WS-R78 (migration 121).
  poster_arrivals_this_week: OpsPosterArrivals;
  // WS-R88 (migration 125).
  digest: OpsDigest;
  // WS-R85 (migration 122).
  share_kit_arrivals_this_week: OpsShareKitArrivals;
  // WS-R86 (migration 123).
  friend_arrivals_this_week: OpsFriendArrivals;
}

// WS-R85 (migration 122). `api/_funnel.js`'s own `shareKitArrivalsThisWeek`
// shape, typed here unchanged - this file computes nothing, `opsApi.ts`'s
// own header rule restated. One `OpsShareArrivals`-shaped entry per share-
// kit channel, keyed by the same four names `api/_share-kit.js`'s
// `SHARE_KIT_CHANNELS` names.
export interface OpsShareKitArrivals {
  channels: {
    whatsapp: OpsShareArrivals;
    instagram: OpsShareArrivals;
    youtube: OpsShareArrivals;
    telegram: OpsShareArrivals;
  };
}

export async function readOpsOverview(token: string): Promise<OpsOverview> {
  return replicaRequest<OpsOverview>(token, "/api/ops");
}

// WS-R62 (migration 114). The operator's own "Alerts on this phone"
// control - subscribe/revoke are POST ops on the SAME `/api/ops` door the
// overview reads GET from (`api/ops.js`'s own header names the reason: one
// door, one auth gate, never a second endpoint to keep in sync with the
// first one's own 404-by-name law).
export async function subscribeOpsPush(
  token: string,
  endpoint: string,
  p256dh: string,
  auth: string,
): Promise<{ subscribed: boolean }> {
  return replicaRequest<{ subscribed: boolean }>(token, "/api/ops", {
    method: "POST",
    body: JSON.stringify({ op: "push_subscribe", endpoint, p256dh, auth }),
  });
}

export async function revokeOpsPush(token: string, endpoint: string): Promise<{ revoked: boolean }> {
  return replicaRequest<{ revoked: boolean }>(token, "/api/ops", {
    method: "POST",
    body: JSON.stringify({ op: "push_revoke", endpoint }),
  });
}

// WS-R88 (migration 125). "Send a test digest now" - the SAME door, the
// SAME one-door-one-auth-gate reason `subscribeOpsPush`/`revokeOpsPush`'s
// own header names.
export async function sendTestOpsDigest(token: string): Promise<{ pushed: number }> {
  return replicaRequest<{ pushed: number }>(token, "/api/ops", {
    method: "POST",
    body: JSON.stringify({ op: "send_test_digest" }),
  });
}
