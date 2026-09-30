import type { ActivityJob, ActivityView, NextActionKind } from "./activityApi";
import type { ReplicaRuntimeStatus, ReplicaSource } from "./types";

export const WORKER_PICKUP_WINDOW_MS = 5 * 60_000;
export const WORKER_DELAY_GRACE_MS = 60_000;
export const RUNNING_STALE_AFTER_MS = 10 * 60_000;
export const IDLE_RECONCILE_MS = 60_000;

type TimingTone = "active" | "delayed" | "stale" | "complete" | "owner";

export interface ActivityTiming {
  tone: TimingTone;
  ownerLabel: "Waiting on us" | "Your turn" | "Complete";
  detail: string;
  phase: string;
  observedRange: string;
  nextCheck: string;
  background: string;
  returnGuidance: string;
}

export interface PresentedAction {
  kind: NextActionKind;
  label: string;
  owner: "you" | "platform";
}

function instant(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsed(ms: number): string {
  const safe = Math.max(0, ms);
  const minutes = Math.floor(safe / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours} ${hours === 1 ? "hour" : "hours"} ${remainder} minutes`;
}

function clock(at: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

function returnFromServerTimestamp(
  timestamp: string | null | undefined,
  now: number,
  returnAfterMs: number,
  overdue: string,
): string {
  const beganAt = instant(timestamp);
  if (beganAt == null) {
    return "The server has not supplied a usable start time yet. Use the next server check above.";
  }
  const returnAt = beganAt + returnAfterMs;
  if (returnAt <= now) return overdue;
  return `A useful time to return is around ${clock(returnAt)}. This is the high end of a recent range, not a deadline.`;
}

function automaticCheck(nextPollMs: number | null | undefined): string {
  if (nextPollMs == null) return "Automatic checks pause until this job can move again.";
  const seconds = Math.max(1, Math.ceil(nextPollMs / 1000));
  if (seconds < 60) return `Next server check in about ${seconds} seconds.`;
  const minutes = Math.ceil(seconds / 60);
  return `Next server check in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

function laneRange(job: ActivityJob): { observed: string; returnAfterMs: number | null } {
  if (job.lane === "upload_processing") {
    if (job.state === "queued") {
      return {
        observed: "Worker pickup normally happens within five minutes. Recent source preparation then took about 5 to 15 minutes; long media can take longer.",
        returnAfterMs: 20 * 60_000,
      };
    }
    return {
      observed: "Recent production source runs took about 5 to 15 minutes after worker pickup. Long media can take longer.",
      returnAfterMs: 15 * 60_000,
    };
  }
  if (job.lane === "voice_model_build") {
    if (job.state === "queued") {
      return {
        observed: "Worker pickup normally happens within five minutes. Recent voice drafts then built in about 1 to 3 minutes.",
        returnAfterMs: 8 * 60_000,
      };
    }
    return {
      observed: "Recent production voice drafts built in about 1 to 3 minutes after pickup.",
      returnAfterMs: 3 * 60_000,
    };
  }
  if (job.lane === "mirror_finetune") {
    return {
      observed: "No completion range has been measured for call learning on this deployment.",
      returnAfterMs: null,
    };
  }
  return {
    observed: "No reliable completion range has been measured for this kind of work yet.",
    returnAfterMs: null,
  };
}

function activeReturnGuidance(job: ActivityJob, now: number, returnAfterMs: number | null): string {
  if (returnAfterMs == null) return "There is no honest finish time to show yet. Use the next server check above.";
  const started = instant(job.started_at) ?? instant(job.updated_at) ?? now;
  const returnAt = started + returnAfterMs;
  if (returnAt <= now) {
    return "This is past the recent timing window. We are still checking; no new upload or button press is needed.";
  }
  return `A useful time to return is around ${clock(returnAt)}. This is a recent range, not a deadline.`;
}

/**
 * Time copy is derived only from timestamps the activity endpoint returned.
 * It reports missed pickup or a stale server update, never an invented ETA.
 */
export function presentActivityTiming(
  job: ActivityJob,
  now = Date.now(),
  nextPollMs: number | null | undefined = null,
): ActivityTiming {
  const started = instant(job.started_at) ?? instant(job.updated_at) ?? now;
  const updated = instant(job.updated_at) ?? started;
  const finished = instant(job.finished_at) ?? updated;
  const runningFor = elapsed(now - started);
  const quietFor = elapsed(now - updated);

  if (job.state === "done" || job.state === "cancelled") {
    return {
      tone: "complete",
      ownerLabel: "Complete",
      detail: `Finished ${elapsed(now - finished)} ago.`,
      phase: job.state === "done" ? "Finished" : "Cancelled",
      observedRange: "This work has finished, so an estimate is no longer needed.",
      nextCheck: "No more server checks are needed for this job.",
      background: "Nothing is running in the background for this job.",
      returnGuidance: "You can continue now.",
    };
  }
  if (job.state === "waiting_on_you") {
    return {
      tone: "owner",
      ownerLabel: "Your turn",
      detail: `Ready for you. Last updated ${quietFor} ago.`,
      phase: job.state_reason || "Waiting for your action",
      observedRange: "The platform cannot continue until the named action is completed.",
      nextCheck: "Automatic checks resume after your action.",
      background: "Nothing is progressing silently while this waits for you.",
      returnGuidance: "This is ready for your action now.",
    };
  }
  const range = laneRange(job);
  if (job.state === "queued") {
    if (now - started >= WORKER_PICKUP_WINDOW_MS + WORKER_DELAY_GRACE_MS) {
      return {
        tone: "delayed",
        ownerLabel: "Waiting on us",
        detail: `Queued for ${runningFor}. This is past the normal five-minute pickup window; we are still checking automatically.`,
        phase: job.state_reason || "Waiting for a worker",
        observedRange: range.observed,
        nextCheck: automaticCheck(nextPollMs),
        background: "This continues on the server. You may close, reload, or leave this page without restarting it.",
        returnGuidance: activeReturnGuidance(job, now, range.returnAfterMs),
      };
    }
    return {
      tone: "active",
      ownerLabel: "Waiting on us",
      detail: `Queued for ${runningFor}.`,
      phase: job.state_reason || "Waiting for a worker",
      observedRange: range.observed,
      nextCheck: automaticCheck(nextPollMs),
      background: "This continues on the server. You may close, reload, or leave this page without restarting it.",
      returnGuidance: activeReturnGuidance(job, now, range.returnAfterMs),
    };
  }
  if (job.state === "running") {
    if (now - updated >= RUNNING_STALE_AFTER_MS) {
      return {
        tone: "stale",
        ownerLabel: "Waiting on us",
        detail: `Running for ${runningFor}. No server update for ${quietFor}; we are still checking automatically.`,
        phase: job.state_reason || "Running on the server",
        observedRange: range.observed,
        nextCheck: automaticCheck(nextPollMs),
        background: "The server owns this work. You may close, reload, or leave this page without restarting it.",
        returnGuidance: activeReturnGuidance(job, now, range.returnAfterMs),
      };
    }
    return {
      tone: "active",
      ownerLabel: "Waiting on us",
      detail: `Running for ${runningFor}. Last server update ${quietFor} ago.`,
      phase: job.state_reason || "Running on the server",
      observedRange: range.observed,
      nextCheck: automaticCheck(nextPollMs),
      background: "The server owns this work. You may close, reload, or leave this page without restarting it.",
      returnGuidance: activeReturnGuidance(job, now, range.returnAfterMs),
    };
  }
  return {
    tone: "stale",
    ownerLabel: "Waiting on us",
    detail: `Stopped after ${runningFor}. Last server update ${quietFor} ago.`,
    phase: job.state_reason || "Stopped",
    observedRange: "A stopped job has no completion estimate.",
    nextCheck: "Automatic checks cannot finish a stopped job.",
    background: "Nothing is progressing silently for this job.",
    returnGuidance: "Use the named recovery action. Keep the existing upload unless the source itself is named as unusable.",
  };
}

const SOURCE_INPUT_PROBLEM = [
  /does not match the file that was sent/i,
  /scan found something harmful/i,
  /has no audio track/i,
];

/**
 * The activity wire predates ownership on recovery actions and can label any
 * failed upload "upload again". The UI refuses that instruction unless the
 * server's own reason names a problem in the bytes. Platform failures keep the
 * existing source and say that plainly.
 */
export function presentActivityAction(job: ActivityJob): PresentedAction {
  if (job.lane === "upload_processing" && job.next_action.kind === "fix_input") {
    if (SOURCE_INPUT_PROBLEM.some((pattern) => pattern.test(job.state_reason))) {
      return { kind: "fix_input", label: "Choose a different recording", owner: "you" };
    }
    return {
      kind: "wait",
      label: "Keep this recording. No re-upload is needed; this is waiting on us.",
      owner: "platform",
    };
  }
  return {
    kind: job.next_action.kind,
    label: job.next_action.label,
    owner: job.state === "waiting_on_you" || job.next_action.kind === "fix_input" ? "you" : "platform",
  };
}

export function activityRevision(view: ActivityView | null): string {
  if (!view) return "";
  return view.jobs.map((job) => [
    job.job_id,
    job.state,
    job.updated_at ?? "",
    job.progress?.done ?? -1,
    job.progress?.total ?? -1,
  ].join(":" )).join("|");
}

export function shouldReconcileActivity(view: ActivityView | null, journeyPending: boolean): boolean {
  return Boolean(journeyPending && view && !view.in_flight);
}

export interface CloneMilestone {
  label: string;
  done: boolean;
  detail: string;
}

export interface CloneProgressPresentation {
  completed: number;
  milestoneLabel: string;
  milestones: CloneMilestone[];
  canTest: boolean;
  next: { title: string; detail: string; action: string; step: "feed" | "meet" };
  primarySourceId: string | null;
  timing: {
    phase: string;
    observedRange: string;
    nextCheck: string;
    background: string;
    returnGuidance: string;
  };
}

function activeSource(source: ReplicaSource): boolean {
  return (source.kind === "audio" || source.kind === "video")
    && source.state !== "rejected"
    && source.state !== "deleting";
}

/** One primary recording, one exact processing rollup, one voice draft. */
export function presentCloneProgress(
  sources: ReplicaSource[],
  runtimeStatus: ReplicaRuntimeStatus | null,
  activityView: ActivityView | null,
  now = Date.now(),
): CloneProgressPresentation {
  const candidates = sources.filter(activeSource);
  // A supporting upload is never an implicit primary voice. Falling back to
  // the first audio/video source made a replacement or a deleted primary look
  // as if it were still building, and could bind progress to the wrong source.
  // The server-owned voice_role pointer is the only authority here.
  const primary = candidates.find((source) => source.voice_role === "primary") ?? null;
  const sourceJob = primary
    ? activityView?.jobs.find((job) => job.job_id === `upload_processing:${primary.source_id}`) ?? null
    : null;
  const buildJob = activityView?.jobs.find((job) => job.lane === "voice_model_build"
    && (job.state === "queued" || job.state === "running" || job.state === "waiting_on_you")) ?? null;
  const hasSource = Boolean(primary);
  const sourceReady = primary?.state === "ready" || sourceJob?.state === "done";
  const hasVoice = Boolean(runtimeStatus?.versions.voice_genome)
    && (runtimeStatus?.voice_genome_status === "draft" || runtimeStatus?.voice_genome_status === "approved");
  const progress = sourceJob?.progress;

  const sourceDetail = !hasSource
    ? "Add one clear recording to begin."
    : "Primary recording received.";
  const preparedDetail = sourceReady
    ? "All source checks are complete."
    : progress
      ? `${progress.done} of ${progress.total} source checks complete.`
      : sourceJob?.state === "queued" || sourceJob?.state === "running"
        ? "Received. No source check has finished yet."
        : sourceJob?.state_reason || "Waiting for the source status from the server.";
  const voiceDetail = hasVoice
    ? "The private voice draft is ready to test."
    : buildJob?.state_reason || (sourceReady
      ? "The source is ready. Waiting for the voice build to start."
      : "The voice build starts after the primary recording is prepared.");
  const milestones = [
    { label: "Primary recording added", done: hasSource, detail: sourceDetail },
    { label: "Recording prepared", done: sourceReady, detail: preparedDetail },
    { label: "Voice draft built", done: hasVoice, detail: voiceDetail },
  ];
  const completed = milestones.filter((milestone) => milestone.done).length;

  const activeTiming = sourceJob && !sourceReady
    ? presentActivityTiming(sourceJob, now, activityView?.next_poll_ms)
    : buildJob && sourceReady && !hasVoice
      ? presentActivityTiming(buildJob, now, activityView?.next_poll_ms)
      : null;

  const next = !hasSource
    ? { title: "Add one clear recording", detail: "A phone recording or audio file is enough to begin.", action: "Add a recording", step: "feed" as const }
    : !sourceReady
      ? { title: "We are preparing your recording", detail: preparedDetail, action: "View live status", step: "feed" as const }
      : !hasVoice
        ? { title: "We are building your voice draft", detail: voiceDetail, action: "View build status", step: "feed" as const }
        : { title: "Your voice draft is ready", detail: "Test it in Hindi, Hinglish, or English. Setup completion does not claim voice quality.", action: "Test your clone", step: "meet" as const };

  const timing = activeTiming
    ? {
      phase: activeTiming.phase,
      observedRange: activeTiming.observedRange,
      nextCheck: activeTiming.nextCheck,
      background: activeTiming.background,
      returnGuidance: activeTiming.returnGuidance,
    }
    : !hasSource
      ? {
        phase: "Waiting for a primary recording",
        observedRange: "Processing does not begin until a recording is added.",
        nextCheck: "No server check is scheduled yet.",
        background: "Nothing is running in the background yet.",
        returnGuidance: "Add a recording whenever you are ready.",
      }
      : !sourceReady
        ? {
          phase: primary?.state === "quarantined" ? "Waiting for source preparation to begin" : "Preparing the primary recording",
          observedRange: "Recent production source runs took about 5 to 15 minutes after worker pickup. Long media can take longer.",
          nextCheck: "The server checks this source hand-off about once a minute.",
          background: "This continues on the server. You may close, reload, or leave this page without restarting it.",
          returnGuidance: returnFromServerTimestamp(
            primary?.created_at,
            now,
            20 * 60_000,
            "This source is past the recent worker-pickup and preparation window. We are still checking; no new upload is needed.",
          ),
        }
      : sourceReady && !hasVoice
        ? {
          phase: "Handing the prepared recording to the voice builder",
          observedRange: "Worker pickup normally happens within five minutes. Recent production voice drafts then built in about 1 to 3 minutes.",
          nextCheck: "The server checks this hand-off about once a minute.",
          background: "This continues on the server. You may close, reload, or leave this page without restarting it.",
          returnGuidance: returnFromServerTimestamp(
            primary?.updated_at,
            now,
            8 * 60_000,
            "This voice hand-off is past the recent worker-pickup and build window. We are still checking; no new upload is needed.",
          ),
        }
        : {
          phase: "Ready to test",
          observedRange: "Source preparation and the current voice build are complete.",
          nextCheck: "No setup check is pending.",
          background: "Nothing else must finish before a private preview.",
          returnGuidance: "You can meet the clone now.",
        };

  return {
    completed,
    milestoneLabel: `${completed} of ${milestones.length} milestones complete`,
    milestones,
    canTest: hasVoice,
    next,
    primarySourceId: primary?.source_id ?? null,
    timing,
  };
}
