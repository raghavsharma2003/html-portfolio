// readinessApi.ts — the client half of `/api/readiness`, following the
// existing *Api.ts pattern (activityApi.ts, contextLockerApi.ts).
//
// This is the ONLY file in the readiness surface that knows a route or a JSON
// key. Same reason activityApi.ts gives: when a UI spreads its wire knowledge
// across a component tree, the day the backend answers a slightly different
// shape you find out by reading a blank screen.
//
// ── the one thing this file must never do ────────────────────────────────
// COMPUTE A NUMBER. Not a rounding, not a fallback, not a "0 if missing". The
// server decides what is measured and what is not, and a client that filled a
// gap with a default would be the fastest possible route back to a fake
// number (DESIGN-LAW §1). `value: null` arrives as null and renders as words.
import { replicaRequest } from "./replicaApi";

export type ReadinessPartId =
  | "knows_your_material"
  | "sounds_like_you"
  | "thinks_like_you"
  | "knows_what_not_to_say"
  | "up_to_date";

export interface ReadinessAction {
  code: string;
  label: string;
  /** Which wizard step the anchor lives on, so a jump can change step first. */
  step: "feed" | "meet" | "deploy";
  anchor: string;
}

export interface ReadinessPart {
  id: ReadinessPartId;
  label: string;
  /** null means NOT MEASURED. It never means zero. */
  value: number | null;
  measured: boolean;
  /** The sample behind the number, or the sample so far when unmeasured. */
  n: number | null;
  /** How it was measured, in one sentence. Shown on tap and on hover. */
  method: string;
  measured_at: string | null;
  /** The honest sentence under the number, measured or not. */
  detail: string;
  /** A code naming WHICH instrument is missing. Null when measured. */
  reason: string | null;
  action: ReadinessAction | null;
}

export interface ReadinessBlocker {
  part: ReadinessPartId | null;
  code: "not_measured_yet" | "below_part_floor" | "below_overall_floor";
}

export interface Readiness {
  policy_version: string;
  computed_at: string;
  /** null until every part has a value. Never a partial mean. */
  overall: number | null;
  min_part: number | null;
  unmeasured_count: number;
  parts: ReadinessPart[];
  floors: { overall: number; part: number };
  publish_locked: boolean;
  blockers: ReadinessBlocker[];
  weakest_part: ReadinessPartId | null;
  suggested_action: ReadinessAction | null;
  inputs_hash: string;
}

export async function readReadiness(token: string, replicaId: string): Promise<Readiness> {
  const data = await replicaRequest<{ readiness: Readiness }>(
    token,
    `/api/readiness?replica_id=${encodeURIComponent(replicaId)}`,
  );
  return data.readiness;
}

// ── WS-R101: the recall run ─────────────────────────────────────────────
//
// The door's own result, not a fresh `Readiness` screen — the write and the
// read stay two requests (`api/readiness.js`'s own header states why), so a
// caller that wants the updated part re-reads with `readReadiness` right
// after this resolves, `ReadinessPanel.tsx`'s own `load()` reused rather than
// a second copy of it here.
export interface RecallRunResult {
  run_id: string;
  score: number;
  n: number;
  method: string;
  computed_at: string;
  set_hash: string;
}

export async function measureRecallNow(token: string, replicaId: string): Promise<RecallRunResult> {
  const data = await replicaRequest<{ recall_run: RecallRunResult }>(token, "/api/readiness", {
    method: "POST",
    body: JSON.stringify({ op: "measure_now", replica_id: replicaId }),
  });
  return data.recall_run;
}
