import { timingSafeEqual } from "node:crypto";
import {
  capabilitySummary,
  composeProcessingAdapters,
  requeueRecoveredProcessingJobs,
} from "./composition.js";
import { runNextProcessingJob } from "./runtime.js";

// THE THING THAT DRAINS THE QUEUE
// ---------------------------------------------------------------------------
// `api/_replica-source.js` enqueues an `integrity` job for every uploaded audio
// source and parks the source at `quarantined`. `runNextProcessingJob` is a
// complete lease-execute-settle runner. Between those two, until this file,
// there was nothing: no caller, no cron, no consumer. One real 32.9 MB upload
// sat at `integrity/queued` from the moment it was accepted, never leased, and
// every screen showed it as being worked on.
//
// This is `aliveness-was-unreachable-not-meera-bound` in its purest form. Both
// ends were finished and correct. The defect was the absence of a caller, which
// is the one defect that no amount of reading either end can reveal.
//
// WHAT THIS IS NOT. It is not the intended production consumer. That is the
// Azure Container Apps Job in `services/replica-processing-worker/`, which has
// ClamAV and ffprobe in its image and a 15 minute replica timeout, and it is
// not deployed. This endpoint is the consumer that exists, on the platform this
// product actually runs on, and it is deliberately honest about the fact that
// a serverless function cannot do everything that container can: see
// `composeProcessingAdapters`, which gives every step it cannot serve a named
// unavailability rather than a fabricated pass.
//
// LEASE SEMANTICS AND THE WALL CLOCK. `maxDuration` is 300s; the lease is 15
// minutes. That asymmetry is intentional and it is the safe direction. If the
// platform kills this function mid-stage, the job stays leased until the lease
// expires, and `leaseNextProcessingJob` then re-leases it and records
// `lease_expired` on the abandoned attempt. A lease SHORTER than the runtime
// would be the dangerous direction: two workers on one job.

/** Jobs per invocation. Bounded because one invocation holding a lease it
 *  cannot finish is worse than a shallower drain that runs again in 5 minutes. */
const DEFAULT_JOBS_PER_RUN = 3;
const RUN_BUDGET_MS = 270_000;
const RESERVE_MS = 30_000;

function bounded(value, fallback, min, max) {
  const number = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return fallback;
  return number;
}

export function authorizedProcessingSweep(req, env = process.env) {
  const expected = Buffer.from(String(env.CRON_SECRET || ""));
  const actual = Buffer.from(String(req?.headers?.authorization || "").replace(/^Bearer\s+/i, ""));
  return expected.length >= 24 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Drain a bounded number of jobs, and report what happened in codes only.
 *
 * Exported so an eval can drive it with a fake db and a fake clock. The handler
 * below is only auth plus wiring; everything worth testing is in here.
 */
export async function runProcessingSweep(options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now;
  const maxJobs = bounded(options.maxJobs ?? env.PROCESSING_JOBS_PER_RUN, DEFAULT_JOBS_PER_RUN, 1, 10);
  const budgetMs = bounded(options.budgetMs ?? env.PROCESSING_RUN_BUDGET_MS, RUN_BUDGET_MS, 10_000, 290_000);
  const db = options.db;
  const composed = options.composed || composeProcessingAdapters({ env, config: options.config, fetchImpl: options.fetchImpl });
  const capabilities = capabilitySummary(composed.capabilities);

  // Recover anything that only stopped because a capability was missing and is
  // not missing any more. Never allowed to sink the run: a requeue failure
  // must not stop the drain of jobs that are already queued.
  let recovered = { requeued: 0, steps: [] };
  try {
    recovered = await requeueRecoveredProcessingJobs(db, composed.capabilities);
  } catch {
    recovered = { requeued: 0, steps: [], failed: true };
  }

  const started = now();
  const outcomes = [];
  for (let count = 0; count < maxJobs; count++) {
    if (now() - started > budgetMs - RESERVE_MS) break;
    const outcome = await runNextProcessingJob({
      db,
      adapters: composed.adapters,
      artifactStore: composed.storage.artifactStore,
      budgetEnv: env,
      leaseMs: bounded(options.leaseMs, 900_000, 60_000, 900_000),
      maxAttempts: 5,
      signal: options.signal,
    });
    outcomes.push(Object.freeze({
      outcome: outcome.outcome,
      step: outcome.step || null,
      failure_code: outcome.failure_code || null,
      next_steps: outcome.next_steps || null,
    }));
    if (outcome.outcome === "idle") break;
  }

  return Object.freeze({
    // Content-free by construction. Step names, outcome names and capability
    // codes only: never a job id, a tenant, an object path, or anything read
    // out of a recording.
    processed: outcomes.filter((entry) => entry.outcome !== "idle").length,
    requeued: recovered.requeued,
    capabilities,
    outcomes: Object.freeze(outcomes),
  });
}

