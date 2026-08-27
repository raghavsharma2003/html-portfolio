import {
  CAPABILITY_ABSENCE_CODES,
  capabilitySummary,
  composeProcessingAdapters,
  requeueRecoveredProcessingJobs,
} from "../../api/_replica-processing/composition.js";
import { runNextProcessingJob } from "../../api/_replica-processing/runtime.js";
import { CLAMD_CONFIG_PATH, refreshSignatures, startClamd } from "./clamav.js";
import { createNeonDb } from "./db.js";

// THE CONTAINER THAT OWNS THE STEPS A SERVERLESS FUNCTION CANNOT DO
// ---------------------------------------------------------------------------
// One scheduled Azure Container Apps Job execution: lease a bounded number of
// jobs, run them, settle them, exit. Idle cost is zero because nothing is
// running between executions.
//
// This used to build its adapter set by hand, calling the Azure voice-evidence
// and Azure Speech factories directly and unguarded. Both of those factories
// validate their config in the constructor and THROW when it is absent, and
// there is no Azure Speech resource on this subscription. So the process died
// building its adapters, before it leased anything, and the two steps this
// container exists to provide - `malware_scan` and `media_probe`, which need
// `clamdscan` and `ffprobe` on the PATH - would never have run. The image
// would have been correct and the job would have done nothing.
//
// It now composes through `composeProcessingAdapters`, the same function the
// Vercel sweep uses. That is not tidiness. It is the only way the container and
// the sweep can agree on what a step's absence is called, and it is what makes
// `requeueRecoveredProcessingJobs` below able to pick up the jobs the sweep
// failed for a capability this container has.

/** The steps this container exists to serve. If it cannot serve these, the
 *  image is wrong and the execution must say so rather than quietly behaving
 *  like the serverless runtime it was deployed to replace. */
const REQUIRED_STEPS = Object.freeze(["integrity", "malware_scan", "media_probe"]);

/** Steps that require clamd during this execution. `integrity` is included
 *  because completing it deterministically enqueues `malware_scan`, and the
 *  same bounded run immediately leases that child job. Looking only at the
 *  initial queue made the worker skip daemon startup, complete integrity, and
 *  then fail its newly-created scan with `clamav_daemon_unavailable`. */
const SCANNER_START_STEPS = Object.freeze(["integrity", "malware_scan"]);

function boundedInteger(value, fallback, min, max, code) {
  const number = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(code);
  return number;
}

/**
 * Is there anything for this container to do, and does any of it need clamd?
 *
 * Counts queued and retry-due jobs, plus the jobs that are `failed` on a
 * capability absence this container can now satisfy, because those are exactly
 * what `requeueRecoveredProcessingJobs` is about to put back. Missing them here
 * would make the first execution after a deploy exit as idle and leave the
 * recovery to the next one.
 */
export async function pendingWork(db, capabilities, options = {}) {
  const liveSteps = Object.keys(capabilities).filter((step) => capabilities[step]?.available);
  if (!liveSteps.length) return Object.freeze({ total: 0, steps: Object.freeze([]), needsScanner: false });
  const rows = await db(
    `select distinct step from vy_replica_processing_job j
      where j.step = any($1::text[])
        and ( (j.state in ('queued','retry') and j.next_attempt_at <= now())
              or (j.state = 'leased' and j.lease_expires_at <= now())
              or (j.state = 'failed' and j.failure_code = any($2::text[])) )
        and exists (
          select 1 from vy_replica_source s
           where s.source_id = j.source_id and s.replica_id = j.replica_id
             and s.owner_user_id = j.owner_user_id
             and s.state in ('quarantined','processing'))
      limit 20`,
    [liveSteps, [...CAPABILITY_ABSENCE_CODES]],
    options.timeoutMs || 30_000,
  );
  const steps = [...new Set(rows.map((row) => String(row.step)))].sort();
  return Object.freeze({
    total: steps.length,
    steps: Object.freeze(steps),
    needsScanner: steps.some((step) => SCANNER_START_STEPS.includes(step)),
  });
}

async function main() {
  const maxJobs = boundedInteger(process.env.PROCESSING_JOBS_PER_RUN, 4, 1, 20, "processing_jobs_per_run_invalid");
  const maxRuntimeMs = boundedInteger(process.env.PROCESSING_RUN_BUDGET_MS, 3_300_000, 60_000, 3_500_000, "processing_run_budget_invalid");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("processing-run-budget")), maxRuntimeMs);
  const db = createNeonDb();

  // Composed WITHOUT the scanner first, only to learn what work is waiting.
  // `clamdscan` is on the PATH in this image, so the capability report already
  // says `malware_scan` is available; the daemon behind it is started below,
  // and only if the queue makes it worth starting.
  const composed = composeProcessingAdapters({ clamdConfigPath: CLAMD_CONFIG_PATH });
  const capabilities = capabilitySummary(composed.capabilities);

  const missingRequired = REQUIRED_STEPS.filter((step) => !composed.capabilities[step]?.available);
  if (missingRequired.length) {
    // Content-free: step names and capability codes only.
    throw Object.assign(new Error("worker_missing_required_capability"), {
      code: `worker_missing_required_capability:${missingRequired.join(",")}`,
    });
  }

  const report = { capabilities, processed: 0, requeued: 0, clamd_ready_ms: null, outcomes: [] };
  try {
    const pending = await pendingWork(db, composed.capabilities);
    if (!pending.total) {
      report.idle = true;
      return report;
    }
    if (pending.needsScanner) {
      await refreshSignatures();
      const clamd = await startClamd();
      report.clamd_ready_ms = clamd.readyMs;
    }

    // Put back what stopped only because this container was not deployed yet.
    // Fenced to capability-absence codes on steps that are live right here, so
    // a real malware hit or a digest mismatch can never be resurrected by it.
    try {
      const recovered = await requeueRecoveredProcessingJobs(db, composed.capabilities);
      report.requeued = recovered.requeued;
    } catch {
      report.requeue_failed = true;
    }

    const started = Date.now();
    for (let count = 0; count < maxJobs && Date.now() - started < maxRuntimeMs - 20_000; count++) {
      const outcome = await runNextProcessingJob({
        db,
        adapters: composed.adapters,
        artifactStore: composed.storage.artifactStore,
        resolveInput: composed.resolveInput,
        withMaterializedAudio: composed.withMaterializedAudio,
        budgetEnv: process.env,
        leaseMs: 3_600_000,
        maxAttempts: 5,
        signal: controller.signal,
      });
      report.outcomes.push({
        outcome: outcome.outcome,
        step: outcome.step || null,
        failure_code: outcome.failure_code || null,
      });
      if (outcome.outcome === "idle") break;
    }
    report.processed = report.outcomes.filter((entry) => entry.outcome !== "idle").length;
    return report;
  } finally {
    clearTimeout(timer);
  }
}

main().then((report) => {
  // Content-free operational signal only. Never log job, tenant, object,
  // model vector, transcript, audio, or provider request identifiers.
  process.stdout.write(`${JSON.stringify(report)}\n`);
}).catch((error) => {
  process.stderr.write(`${JSON.stringify({ error: String(error?.code || error?.message || "processing_worker_failed").slice(0, 160) })}\n`);
  process.exitCode = 1;
});
