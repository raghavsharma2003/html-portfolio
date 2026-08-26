import { leaseNextProcessingJob, retryProcessingJob, stopProcessingJob } from "./queue.js";
import { commitProcessingOutput } from "./repository.js";
import { executeProcessingJob } from "./worker.js";

const INPUT_STAGE = Object.freeze({ enhance: "separate", transcribe: "enhance", voice_quality: "enhance" });

export async function loadLeasedProcessingContext(db, job) {
  const sources = await db(
    `select s.source_id,s.replica_id,s.owner_user_id,s.kind,s.state,s.storage_bucket,s.object_path,
            s.mime,s.byte_size,s.duration_ms,s.sha256,s.contains_third_parties
       from vy_replica_processing_job j
       join vy_replica_source s on s.source_id=j.source_id and s.replica_id=j.replica_id
        and s.owner_user_id=j.owner_user_id
      where j.job_id=$1::uuid and j.state='leased' and s.state in ('quarantined','processing')`,
    [job.job_id],
  );
  if (!sources[0]) throw Object.assign(new Error("leased processing source unavailable"), { code: "processing_source_unavailable" });
  const completed = await db(
    `select step from vy_replica_processing_job
      where source_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and revision=$4::int4 and state='complete'`,
    [job.source_id, job.replica_id, job.owner_user_id, job.revision],
  );
  const inputStage = INPUT_STAGE[job.step];
  const artifacts = inputStage ? await db(
    `select artifact_id,replica_id,owner_user_id,source_id,stage,variant_key,storage_bucket,
            object_path,mime,byte_size,duration_ms,sha256,input_sha256,manifest_hash
       from vy_replica_processing_artifact
      where source_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and stage=$4
      order by variant_key,artifact_id`,
    [job.source_id, job.replica_id, job.owner_user_id, inputStage],
  ) : [];
  if (inputStage && !artifacts.length) {
    throw Object.assign(new Error("processing input artifact unavailable"), { code: "processing_input_artifact_unavailable" });
  }
  return Object.freeze({
    source: Object.freeze({ ...sources[0], byte_size: Number(sources[0].byte_size), duration_ms: sources[0].duration_ms == null ? null : Number(sources[0].duration_ms) }),
    completedSteps: Object.freeze(completed.map((row) => row.step)),
    inputArtifacts: Object.freeze(artifacts.map((row) => Object.freeze({
      ...row,
      byte_size: Number(row.byte_size),
      duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
    }))),
  });
}

async function settle(db, leased, output) {
  if (output.outcome === "complete") {
    const committed = await commitProcessingOutput(db, {
      jobId: leased.job.job_id,
      leaseToken: leased.leaseToken,
      output,
    });
    return Object.freeze({ outcome: "complete", job_id: leased.job.job_id, step: leased.job.step, next_steps: committed.next_steps });
  }
  if (output.outcome === "retry") {
    await retryProcessingJob(db, {
      jobId: leased.job.job_id,
      leaseToken: leased.leaseToken,
      failureCode: output.failure_code,
      retryAfterMs: output.retry_after_ms,
    });
    return Object.freeze({ outcome: "retry", job_id: leased.job.job_id, step: leased.job.step, failure_code: output.failure_code });
  }
  await stopProcessingJob(db, {
    jobId: leased.job.job_id,
    leaseToken: leased.leaseToken,
    outcome: output.outcome,
    failureCode: output.failure_code,
  });
  return Object.freeze({ outcome: output.outcome, job_id: leased.job.job_id, step: leased.job.step, failure_code: output.failure_code });
}

export async function runNextProcessingJob(options) {
  const leased = await leaseNextProcessingJob(options.db, {
    leaseMs: options.leaseMs || 900_000,
    token: options.leaseToken,
  });
  if (!leased) return Object.freeze({ outcome: "idle" });
  let output;
  try {
    const context = await loadLeasedProcessingContext(options.db, leased.job);
    output = await executeProcessingJob({
      job: leased.job,
      source: context.source,
      adapters: options.adapters,
      artifactStore: options.artifactStore,
      inputArtifacts: context.inputArtifacts,
      completedSteps: context.completedSteps,
      spendDb: options.db,
      budgetEnv: options.budgetEnv,
      maxAttempts: options.maxAttempts || 5,
      signal: options.signal,
    });
  } catch (error) {
    output = Object.freeze({
      outcome: error?.retryable ? "retry" : "failed",
      failure_code: String(error?.code || "processing_context_failed").slice(0, 96),
      retry_after_ms: error?.retryable ? 30_000 : null,
    });
  }
  return settle(options.db, leased, output);
}
