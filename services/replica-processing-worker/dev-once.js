import { pathToFileURL } from "node:url";
import { createNeonDb } from "./db.js";

/** No adapter import, lease or storage action precedes database verification. */
export async function runDevelopmentOnce(options = {}) {
  const env = options.env || process.env;
  const expected = env.VYAKTI_DEV_DATABASE;
  if (!/^vyakti_expert_integration_[0-9]{8}$/.test(expected || "")) throw new Error("dev_database_name_required");
  if (env.REPLICA_EXPECTED_DATABASE && env.REPLICA_EXPECTED_DATABASE !== expected) throw new Error("dev_database_expectation_conflict");
  if (!["check", "processing", "erasure"].includes(options.mode)) throw new Error("dev_worker_mode_invalid");
  if (options.mode !== "check" && env.VYAKTI_DEV_WORKER !== "1") throw new Error("dev_worker_explicit_opt_in_required");
  if (env.REPLICA_SELF_TEST_MODE === "true") throw new Error("dev_worker_self_test_grants_forbidden");
  const db = (options.createDb || createNeonDb)({ env, expectedDatabase: expected });
  const identity = await db("SELECT current_database() AS name");
  if (identity.length !== 1 || identity[0]?.name !== expected) throw new Error("dev_database_identity_mismatch");
  if (options.mode === "check") return { database: expected, mode: "check", work_started: false };
  const run = options.run || runOne;
  return { database: expected, mode: options.mode, result: await run(options.mode, db, env) };
}

async function runOne(mode, db, env) {
  if (mode === "erasure") {
    const { runSourceErasureSweep } = await import("../../api/_replica-source-erasure.js");
    // Preserve upload authorization, writer grace, lease and storage fences.
    return runSourceErasureSweep({ db, maxJobs: 1, cleanupBatchSize: 1, timeBudgetMs: 10_000 });
  }
  const { composeProcessingAdapters } = await import("../../api/_replica-processing/composition.js");
  const { runNextProcessingJob } = await import("../../api/_replica-processing/runtime.js");
  const composed = composeProcessingAdapters({ env });
  for (const step of ["integrity", "malware_scan", "media_probe"]) {
    if (!composed.capabilities[step]?.available) throw new Error(`dev_worker_capability_missing_${step}`);
  }
  const outcome = await runNextProcessingJob({ db, adapters: composed.adapters,
    artifactStore: composed.storage.artifactStore, resolveInput: composed.resolveInput,
    withMaterializedAudio: composed.withMaterializedAudio, budgetEnv: env,
    leaseMs: 120_000, heartbeatMs: 30_000, maxAttempts: 5,
    signal: AbortSignal.timeout(60_000) });
  // No model recovery/build sweep, synthesized voice or tenant content in report.
  return { outcome: outcome.outcome, step: outcome.step || null, failure_code: outcome.failure_code || null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDevelopmentOnce({ mode: process.argv[2] || "check" }).then((result) => {
    process.stdout.write(JSON.stringify(result) + "\n");
  }).catch((error) => {
    const value = String(error?.code || error?.message || "");
    const code = /^[a-z0-9_:-]{1,120}$/.test(value) ? value : "dev_worker_failed";
    process.stderr.write(JSON.stringify({ error: code }) + "\n");
    process.exitCode = 1;
  });
}
