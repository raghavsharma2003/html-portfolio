import { randomBytes } from "node:crypto";
import { PROCESSING_SCHEMA_VERSION, PROCESSING_STAGES, assertSha256, sha256Hex } from "./contracts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function leaseTokenHash(token) {
  if (typeof token !== "string" || token.length < 32) throw new Error("strong lease token required");
  return sha256Hex(`replica-processing-lease:v1:${token}`);
}

function publicJob(row) {
  return {
    job_id: row.job_id,
    replica_id: row.replica_id,
    owner_user_id: row.owner_user_id,
    source_id: row.source_id,
    step: row.step,
    revision: Number(row.revision),
    state: row.state,
    attempt: Number(row.attempt),
    lease_expires_at: row.lease_expires_at,
  };
}

export async function leaseNextProcessingJob(db, options = {}) {
  const token = options.token || randomBytes(32).toString("base64url");
  // A two-hour Sarvam batch and a multi-chunk diarization pass can legitimately
  // outlive the old 15 minute ceiling. The scheduled worker requests the long
  // lease; serverless callers keep their shorter explicit value.
  const leaseMs = Math.max(10_000, Math.min(3_600_000, Number(options.leaseMs || 120_000)));
  const rows = await db(
    `with candidate as (
       select j.job_id, j.state as previous_state, j.attempt as previous_attempt
       from vy_replica_processing_job j
       join vy_replica_source s
         on s.source_id = j.source_id and s.replica_id = j.replica_id
        and s.owner_user_id = j.owner_user_id
        where s.state in ('quarantined','processing') and (
              (j.state in ('queued','retry') and j.next_attempt_at <= now())
           or (j.state = 'leased' and j.lease_expires_at <= now())
        )
        order by j.next_attempt_at, j.created_at
        for update skip locked limit 1
     ), expired as (
       update vy_replica_processing_attempt a
          set outcome = 'retry', failure_code = 'lease_expired', finished_at = now()
         from candidate c
        where c.previous_state = 'leased' and a.job_id = c.job_id
          and a.attempt = c.previous_attempt and a.outcome = 'running'
       returning a.job_id
     ), leased as (
       update vy_replica_processing_job j
          set state = 'leased', attempt = attempt + 1,
              lease_token_hash = $1, leased_at = now(),
              lease_expires_at = now() + ($2::integer * interval '1 millisecond'),
              failure_code = '', updated_at = now()
         from candidate c where j.job_id = c.job_id
       returning j.*
     ), attempted as (
       insert into vy_replica_processing_attempt
         (job_id, attempt, outcome, started_at)
       select job_id, attempt, 'running', now() from leased
       on conflict (job_id, attempt) do nothing
     )
     select * from leased`,
    [leaseTokenHash(token), leaseMs],
  );
  if (!rows[0]) return null;
  return Object.freeze({ job: publicJob(rows[0]), leaseToken: token });
}

export function processingCompletionReceipt(result) {
  if (!result || !PROCESSING_STAGES.includes(result.step)) throw new Error("valid completion step required");
  const artifactIds = [...new Set(result.artifact_ids || [])].sort();
  const evidenceIds = [...new Set(result.evidence_ids || [])].sort();
  for (const id of [...artifactIds, ...evidenceIds]) if (!UUID.test(String(id))) throw new Error("valid result ids required");
  const nextSteps = [...new Set(result.next_steps || [])].sort();
  for (const step of nextSteps) if (!PROCESSING_STAGES.includes(step)) throw new Error("valid next steps required");
  const basis = {
    schema_version: PROCESSING_SCHEMA_VERSION,
    step: result.step,
    artifact_ids: artifactIds,
    evidence_ids: evidenceIds,
    next_steps: nextSteps,
    verified_input_sha256: assertSha256(result.verified_input_sha256, "verified input sha256"),
  };
  return Object.freeze({ ...basis, manifest_hash: sha256Hex(basis) });
}

async function requireSettlement(rows, message) {
  if (!rows[0]) throw Object.assign(new Error(message), { code: "lost_processing_lease" });
  return publicJob(rows[0]);
}

export async function completeProcessingJob(db, input) {
  const receipt = processingCompletionReceipt(input.result);
  if (!input.adapter || !input.adapter.family || !input.adapter.name || !input.adapter.version) {
    throw new Error("completion adapter provenance required");
  }
  const rows = await db(
    `with settled as (
       update vy_replica_processing_job j
          set state = 'complete', result = $3::jsonb, failure_code = '',
              lease_token_hash = '', leased_at = null, lease_expires_at = null,
              updated_at = now()
        where j.job_id = $1::uuid and j.state = 'leased' and j.lease_token_hash = $2
          and j.lease_expires_at > now() and j.step = $8
          and not exists (
            select 1 from jsonb_array_elements_text($3::jsonb -> 'artifact_ids') wanted(id)
             where not exists (
               select 1 from vy_replica_processing_artifact a
                where a.artifact_id = wanted.id::uuid and a.created_by_job_id = j.job_id
                  and a.source_id = j.source_id and a.replica_id = j.replica_id
                  and a.owner_user_id = j.owner_user_id
             )
          )
          and not exists (
            select 1 from jsonb_array_elements_text($3::jsonb -> 'evidence_ids') wanted(id)
             where not exists (
               select 1 from vy_replica_processing_evidence e
                where e.evidence_id = wanted.id::uuid and e.created_by_job_id = j.job_id
                  and e.source_id = j.source_id and e.replica_id = j.replica_id
                  and e.owner_user_id = j.owner_user_id
             )
          )
       returning j.*
     ), attempt as (
       update vy_replica_processing_attempt a
          set outcome = 'complete', result_manifest_hash = $4,
              adapter_family = $5, adapter_name = $6, adapter_version = $7,
              finished_at = now()
         from settled s where a.job_id = s.job_id and a.attempt = s.attempt
     )
     select * from settled`,
    [input.jobId, leaseTokenHash(input.leaseToken), JSON.stringify(receipt), receipt.manifest_hash,
      input.adapter.family, input.adapter.name, input.adapter.version, receipt.step],
  );
  await requireSettlement(rows, "processing lease expired before completion");
  return receipt;
}

export async function retryProcessingJob(db, input) {
  const delayMs = Math.max(1_000, Math.min(3_600_000, Number(input.retryAfterMs)));
  const rows = await db(
    `with settled as (
       update vy_replica_processing_job
          set state = 'retry', result = '{}'::jsonb, failure_code = $3,
              next_attempt_at = now() + ($4::integer * interval '1 millisecond'),
              lease_token_hash = '', leased_at = null, lease_expires_at = null,
              updated_at = now()
        where job_id = $1::uuid and state = 'leased' and lease_token_hash = $2
          and lease_expires_at > now()
       returning *
     ), attempt as (
       update vy_replica_processing_attempt a
          set outcome = 'retry', failure_code = $3, finished_at = now()
         from settled s where a.job_id = s.job_id and a.attempt = s.attempt
     )
     select * from settled`,
    [input.jobId, leaseTokenHash(input.leaseToken), String(input.failureCode || "processing_retry"), delayMs],
  );
  return requireSettlement(rows, "processing lease expired before retry was recorded");
}

export async function stopProcessingJob(db, input) {
  const outcome = input.outcome === "blocked" ? "blocked" : "failed";
  const rows = await db(
    `with settled as (
       update vy_replica_processing_job
          set state = $3, result = '{}'::jsonb, failure_code = $4,
              lease_token_hash = '', leased_at = null, lease_expires_at = null,
              updated_at = now()
        where job_id = $1::uuid and state = 'leased' and lease_token_hash = $2
          and lease_expires_at > now()
       returning *
     ), attempt as (
       update vy_replica_processing_attempt a
          set outcome = $3, failure_code = $4, finished_at = now()
         from settled s where a.job_id = s.job_id and a.attempt = s.attempt
     )
     select * from settled`,
    [input.jobId, leaseTokenHash(input.leaseToken), outcome, String(input.failureCode || "processing_failed")],
  );
  return requireSettlement(rows, "processing lease expired before failure was recorded");
}
