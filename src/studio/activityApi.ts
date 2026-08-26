// activityApi.ts — the client half of `/api/replica-activity`, following the
// existing *Api.ts pattern (channelWatchApi.ts, contextLockerApi.ts).
//
// This is the ONLY file in the activity surface that knows a route or a JSON
// key. `mirror-call-contract-unverified` is the reason: when a UI spreads its
// wire knowledge across a component tree, the day the backend answers a
// slightly different shape you find out by reading a blank screen. One module,
// one normalizer, one place to look.
//
// ── the poll loop lives here, not in the component ───────────────────────
// Because the STOP rule is a wire rule, not a render rule. The server is the
// only side that knows whether anything is moving, so it returns
// `next_poll_ms`, and `null` means stop. A component-owned interval would keep
// asking a question whose answer cannot change, which on a serverless deploy is
// a billed invocation every three seconds for as long as the tab is open.
import { replicaRequest } from "./replicaApi";

export type ActivityState =
  | "queued" | "running" | "waiting_on_you" | "done" | "failed" | "blocked" | "cancelled";

export type ActivityLane =
  | "upload_processing" | "channel_video" | "channel_watch"
  | "context_item" | "voice_model_build" | "mirror_finetune" | "erasure";

export type NextActionKind = "none" | "wait" | "review" | "retry" | "fix_input";

export interface ActivityProgress {
  done: number;
  total: number;
  unit: string;
}

export interface ActivityJob {
  /** Namespaced `<lane>:<id>`, unique across lanes. */
  job_id: string;
  /** The lane's own primary key, which is what an action sends back. */
  ref: string;
  lane: ActivityLane;
  /** What this job is ABOUT: the video title, the file name, the recording. */
  subject: string;
  state: ActivityState;
  /** Why it is in that state, in a sentence. Always present for a failure. */
  state_reason: string;
  started_at: string | null;
  updated_at: string | null;
  finished_at: string | null;
  /** null unless a REAL fraction exists. Never a percentage. */
  progress: ActivityProgress | null;
  next_action: { kind: NextActionKind; label: string };
  /** Server-decided. The poller keys on this, never on the state name. */
  in_flight: boolean;
}

export interface ActivityLaneStatus {
  lane: ActivityLane;
  label: string;
  deployed: boolean;
  /** Named, always, when `deployed` is false. */
  missing: string[];
}

export interface ActivityView {
  replica_id: string;
  generated_at: string;
  jobs: ActivityJob[];
  lanes: ActivityLaneStatus[];
  in_flight: boolean;
  /** null means stop polling: nothing can change until the owner acts. */
  next_poll_ms: number | null;
}

export async function fetchActivity(
  token: string,
  replicaId: string,
  unchangedPolls = 0,
  signal?: AbortSignal,
): Promise<ActivityView> {
  const query = `replica_id=${encodeURIComponent(replicaId)}&unchanged=${unchangedPolls}`;
  return replicaRequest<ActivityView>(token, `/api/replica-activity?${query}`, { signal });
}

/** Two views are "the same" when nothing a person would notice has moved.
 *  `generated_at` changes on every response and is deliberately not compared,
 *  because comparing it would reset the backoff on every poll and the backoff
 *  would never happen. */
export function sameActivity(a: ActivityView | null, b: ActivityView | null): boolean {
  if (!a || !b) return false;
  if (a.jobs.length !== b.jobs.length) return false;
  return a.jobs.every((job, i) => {
    const other = b.jobs[i];
    return other
      && other.job_id === job.job_id
      && other.state === job.state
      && other.state_reason === job.state_reason
      && other.updated_at === job.updated_at
      && (other.progress?.done ?? -1) === (job.progress?.done ?? -1);
  });
}
