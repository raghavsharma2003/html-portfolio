// Narrow verification consent never authorizes the ordinary enrollment DAG.
import { REPLICA_POLICY_VERSION } from "../_replica.js";
import {assertComparisonPurpose,comparisonAuthoritySql} from './comparison.js';
export const LIVE_INTAKE_PURPOSE = "live-challenge-intake/v1";
export const LIVE_INTAKE_STEPS = Object.freeze(["integrity", "malware_scan"]);

export function assertProcessingPurpose(source, step) {
  assertComparisonPurpose(source,step);
  if (source?.capture_mode === "live_challenge" &&
      (source.state !== "quarantined" || source.kind !== "video" || !LIVE_INTAKE_STEPS.includes(step))) {
    throw Object.assign(new Error("live challenge permits only quarantined integrity and malware intake"), {
      code: "live_challenge_processing_forbidden", retryable: false,
    });
  }
}

function alias(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("invalid internal SQL alias");
  return value;
}

// Internal aliases only. Used at lease, fresh context and commit, so old queued
// or leased jobs cannot bypass a new planner by executing their previous DAG.
export function processingPurposeSql(source = "s", job = "j") {
  alias(source); alias(job);
  return `((${source}.purpose<>'comparison_reference' or ${comparisonAuthoritySql(source,job)}) and (${source}.capture_mode <> 'live_challenge' or (
    ${source}.state='quarantined' and ${source}.kind='video'
    and ${job}.step in ('integrity','malware_scan')
    and exists (
      select 1 from vy_replica_liveness_challenge intake_ch
      join vy_replica intake_r on intake_r.replica_id=intake_ch.replica_id and intake_r.owner_user_id=intake_ch.owner_user_id
      join vy_replica_biometric_verification_grant intake_g on intake_g.challenge_id=intake_ch.challenge_id
        and intake_g.replica_id=intake_ch.replica_id and intake_g.owner_user_id=intake_ch.owner_user_id
      join vy_replica_consent intake_c on intake_c.consent_id=${source}.consent_id
        and intake_c.replica_id=${source}.replica_id and intake_c.owner_user_id=${source}.owner_user_id
      where intake_ch.source_id=${source}.source_id and intake_ch.replica_id=${source}.replica_id
        and intake_ch.owner_user_id=${source}.owner_user_id and intake_ch.state='uploaded'
        and intake_ch.expires_at>now()
        and intake_r.subject_mode='self' and intake_r.lifecycle not in ('revoked','purging')
        and intake_ch.policy_version=intake_r.policy_version
        and intake_r.policy_version='${REPLICA_POLICY_VERSION.replaceAll("'", "''")}'
        and intake_g.state='active' and intake_g.expires_at>now()
        and intake_c.scope='capture' and intake_c.policy_version=intake_r.policy_version
        and intake_c.revoked_at is null and (intake_c.expires_at is null or intake_c.expires_at>now())
        and exists (select 1 from vy_replica_consent intake_storage
          where intake_storage.replica_id=${source}.replica_id and intake_storage.owner_user_id=${source}.owner_user_id
            and intake_storage.scope='storage' and intake_storage.policy_version=intake_r.policy_version
            and intake_storage.revoked_at is null and (intake_storage.expires_at is null or intake_storage.expires_at>now()))
    )
  )))`;
}

// The result and current completed attempt must agree. A legacy complete flag,
// a prior revision, fake adapter, or a receipt for replaced bytes is insufficient.
export function liveIntakeReceiptsSql(source = "s") {
  alias(source);
  return `not exists (
    select 1 from unnest(array['integrity','malware_scan']::text[]) intake_required(step)
    where not exists (
      select 1 from vy_replica_processing_job intake_j
      join vy_replica_processing_attempt intake_a on intake_a.job_id=intake_j.job_id
        and intake_a.attempt=intake_j.attempt and intake_a.outcome='complete'
      where intake_j.source_id=${source}.source_id and intake_j.replica_id=${source}.replica_id
        and intake_j.owner_user_id=${source}.owner_user_id and intake_j.step=intake_required.step
        and intake_j.state='complete' and intake_j.revision=(
          select max(intake_latest.revision) from vy_replica_processing_job intake_latest
          where intake_latest.source_id=${source}.source_id and intake_latest.replica_id=${source}.replica_id
            and intake_latest.owner_user_id=${source}.owner_user_id and intake_latest.step in ('integrity','malware_scan'))
        and intake_j.result->>'purpose'='${LIVE_INTAKE_PURPOSE}'
        and intake_j.result->>'step'=intake_j.step
        and intake_j.result->>'verified_input_sha256'=${source}.sha256
        and intake_j.result->'artifact_ids'='[]'::jsonb and intake_j.result->'evidence_ids'='[]'::jsonb
        and intake_j.result->'next_steps'=case when intake_j.step='integrity' then '["malware_scan"]'::jsonb else '[]'::jsonb end
        and intake_j.result->>'manifest_hash' ~ '^[0-9a-f]{64}$'
        and intake_j.result->>'manifest_hash'=intake_a.result_manifest_hash
        and ((intake_j.step='integrity' and intake_a.adapter_family='integrity'
              and intake_a.adapter_name='server-private-byte-verifier' and intake_a.adapter_version='sha256-v1')
          or (intake_j.step='malware_scan' and intake_a.adapter_family='malware'
              and intake_a.adapter_name in ('clamav-local-fd','clamav-stream')
              and intake_a.adapter_version<>'' and intake_a.adapter_version !~* '(fake|fixture|mock|test)'))
    )
  )`;
}
