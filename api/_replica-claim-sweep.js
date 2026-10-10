import { extractOwnedClaims } from "./_replica-claims.js";
import {
  acknowledgeClaimExtractionEvidence,
  deferClaimExtractionJob,
  leaseNextClaimExtractionJob,
} from "./_replica-claim-queue.js";
import { reconcileClaimRelationalMaterializations } from "./_experience-compiler/relational-materializer.js";
import { reconcileUnsafePersonProfiles } from "./_person-model.js";

function retryDelay(attempt) {
  return Math.min(6 * 60 * 60_000, 30_000 * (2 ** Math.min(8, Math.max(0, Number(attempt || 1) - 1))));
}

function errorCode(error) {
  return String(error?.code || error?.message || "claim_extraction_failed")
    .replace(/[^a-z0-9_.:-]/gi, "_")
    .slice(0, 120) || "claim_extraction_failed";
}

function readinessCode(error) {
  const blockers = Array.isArray(error?.details?.blockers) ? error.details.blockers.map(String).sort() : [];
  return blockers.length ? `claim_waiting:${blockers.join("+")}`.slice(0, 120) : "claim_waiting:readiness";
}

/**
 * Bounded scheduled worker. It leases durable rows and calls the paid
 * extractor only after the same owner, consent, speaker and evidence gates as
 * the owner route. No call request awaits this function.
 */
export async function runClaimExtractionSweep(options = {}) {
  const db = options.db;
  const extractor = options.extractor;
  if (typeof db !== "function") throw new Error("claim extraction sweep database required");
  if (!extractor || typeof extractor.extract !== "function") throw new Error("claim extraction sweep extractor required");
  const lease = options.lease || leaseNextClaimExtractionJob;
  const extract = options.extract || extractOwnedClaims;
  const acknowledge = options.acknowledge || acknowledgeClaimExtractionEvidence;
  const defer = options.defer || deferClaimExtractionJob;
  const maxJobs = Math.max(1, Math.min(4, Number(options.maxJobs || 2)));
  const timeBudgetMs = Math.max(5_000, Math.min(240_000, Number(options.timeBudgetMs || 50_000)));
  const started = Date.now();
  const summary = { leased: 0, completed: 0, continued: 0, waiting: 0, retried: 0, busy: 0 };

  while (summary.leased < maxJobs && Date.now() - started < timeBudgetMs) {
    const claimed = await lease(db);
    if (!claimed) break;
    summary.leased += 1;
    try {
      const run = await extract(db, claimed.ownerUserId, claimed.replicaId, extractor, options.signal);
      if (!run) {
        await defer(db, claimed, { failureCode: "claim_replica_unavailable", waiting: true, delayMs: 6 * 60 * 60_000 });
        summary.waiting += 1;
        continue;
      }
      if (run.state !== "complete") {
        await defer(db, claimed, { failureCode: "claim_extraction_already_running", delayMs: 2 * 60_000 });
        summary.busy += 1;
        continue;
      }
      const settled = await acknowledge(db, {
        jobId: claimed.jobId,
        replicaId: claimed.replicaId,
        ownerUserId: claimed.ownerUserId,
        evidenceIds: run.input_evidence_ids,
        leaseToken: claimed.leaseToken,
      });
      if (settled?.state === "complete") summary.completed += 1;
      else summary.continued += 1;
    } catch (error) {
      if (error?.code === "claim_extraction_not_ready") {
        await defer(db, claimed, { failureCode: readinessCode(error), waiting: true, delayMs: 30 * 60_000 });
        summary.waiting += 1;
        continue;
      }
      if (error?.code === "claim_extractor_unavailable") {
        await defer(db, claimed, {
          failureCode: "claim_extractor_unavailable",
          waiting: true,
          delayMs: 30 * 60_000,
        });
        summary.waiting += 1;
        continue;
      }
      const reconcile = error?.code === "provider_spend_reconciliation_required";
      await defer(db, claimed, {
        failureCode: errorCode(error),
        waiting: reconcile,
        delayMs: reconcile ? 6 * 60 * 60_000 : retryDelay(claimed.attempt),
      });
      if (reconcile) summary.waiting += 1;
      else summary.retried += 1;
    }
  }
  const reconcile = options.reconcile || reconcileClaimRelationalMaterializations;
  const relational = Date.now() - started < timeBudgetMs
    ? await reconcile(db, { limit: 20 })
    : { scanned: 0, materialized: 0, retracted: 0, deferred: 0 };
  const profileReconcile = options.profileReconcile || reconcileUnsafePersonProfiles;
  const person_profiles = Date.now() - started < timeBudgetMs
    ? await profileReconcile(db, { limit: 20 })
    : { retired: 0 };
  return Object.freeze({ ...summary, relational, person_profiles, time_budget_reached: Date.now() - started >= timeBudgetMs });
}
