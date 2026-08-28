import { createHash, randomBytes } from "node:crypto";
import { buildVoiceGenomeDraft } from "./_replica-processing/builders.js";
import { loadAcceptedVoiceGenomeInput } from "./_replica-review.js";

export const VOICE_GENOME_BUILDER_VERSION = "voice-genome-builder/v1";
const MAX_ATTEMPTS = 5;

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

export function modelBuildLeaseHash(token) {
  const value = String(token || "");
  if (value.length < 32) fail("model_build_lease_token_invalid", 500);
  return createHash("sha256").update(`vyakti:model-build-lease:v1:${value}`).digest("hex");
}

function leaseRow(row, leaseToken) {
  if (!row) return null;
  return Object.freeze({
    buildId: row.build_id,
    replicaId: row.replica_id,
    ownerUserId: row.owner_user_id,
    targetVersion: Number(row.target_version),
    builderVersion: row.builder_version,
    sourceSetHash: row.source_set_hash,
    attempt: Number(row.attempt),
    leaseToken,
    leaseExpiresAt: row.lease_expires_at,
  });
}

export async function leaseNextVoiceGenomeBuild(db, options = {}) {
  const leaseToken = options.leaseToken || randomBytes(32).toString("base64url");
  const leaseHash = modelBuildLeaseHash(leaseToken);
  const leaseSeconds = Math.max(60, Math.min(600, Number(options.leaseSeconds || 300)));
  const rows = await db(
    `with candidate as (
       select b.build_id,
              case when b.state in ('leased','building') then 'lease_expired' else b.failure_code end prior_failure
         from vy_replica_model_build b
         join vy_replica r on r.replica_id=b.replica_id and r.owner_user_id=b.owner_user_id
        where b.build_kind='voice_genome' and b.attempt<$3::int4
          and ((b.state in ('queued','retry') and b.next_attempt_at<=now())
            or (b.state in ('leased','building') and b.lease_expires_at<=now()))
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and r.liveness_verified_at is not null and r.identity_expires_at>now()
          and exists (select 1 from vy_replica_consent c where c.replica_id=r.replica_id
            and c.owner_user_id=r.owner_user_id and c.scope='biometric' and c.revoked_at is null
            and (c.expires_at is null or c.expires_at>now()))
          and exists (select 1 from vy_replica_consent c where c.replica_id=r.replica_id
            and c.owner_user_id=r.owner_user_id and c.scope='training' and c.revoked_at is null
            and (c.expires_at is null or c.expires_at>now()))
        order by b.next_attempt_at,b.created_at for update of b skip locked limit 1
     ), leased as (
       update vy_replica_model_build b set state='leased',attempt=b.attempt+1,
              lease_token_hash=$1,leased_at=now(),lease_expires_at=now()+($2::integer*interval '1 second'),
              failure_code=candidate.prior_failure,updated_at=now()
         from candidate where b.build_id=candidate.build_id
       returning b.*
     ) select * from leased`,
    [leaseHash, leaseSeconds, MAX_ATTEMPTS],
  );
  return leaseRow(rows[0], leaseToken);
}

async function startVoiceGenomeBuild(db, lease) {
  const rows = await db(
    `update vy_replica_model_build set state='building',updated_at=now()
      where build_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and build_kind='voice_genome'
        and state='leased' and lease_token_hash=$4 and lease_expires_at>now()
      returning build_id`,
    [lease.buildId, lease.replicaId, lease.ownerUserId, modelBuildLeaseHash(lease.leaseToken)],
  );
  if (!rows[0]) fail("model_build_lease_lost");
}

export async function completeVoiceGenomeBuild(db, lease, draft, input) {
  const evidenceIds = input.evidence.map((row) => row.evidence_id).sort();
  const artifactIds = input.artifacts.map((row) => row.artifact_id).sort();
  const sourceIds = [...new Set(input.evidence.map((row) => row.source_id))].sort();
  const rows = await db(
    `with biometric_consent as materialized (
       select c.consent_id from vy_replica_consent c
        where c.replica_id=$2::uuid and c.owner_user_id=$3::uuid and c.scope='biometric'
          and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
        order by c.granted_at desc limit 1 for update
     ), training_consent as materialized (
       select c.consent_id from vy_replica_consent c
        where c.replica_id=$2::uuid and c.owner_user_id=$3::uuid and c.scope='training'
          and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
        order by c.granted_at desc limit 1 for update
     ), review_lock as materialized (
       select pg_try_advisory_xact_lock(hashtextextended($2::text || ':voice_genome_review',0)) acquired
     ), locked_sources as materialized (
       select s.source_id from vy_replica_source s cross join review_lock
        where review_lock.acquired and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid and s.source_id=any($12::uuid[])
          and s.state='ready' and s.contains_third_parties=false
        for update of s
     ), latest as (
       select distinct on (d.evidence_id) d.evidence_id,d.decision
         from vy_replica_processing_evidence_decision d
        where d.replica_id=$2::uuid and d.owner_user_id=$3::uuid
        order by d.evidence_id,d.created_at desc,d.decision_id desc
     ), artifact_latest as (
       select distinct on (d.artifact_id) d.artifact_id,d.decision
         from vy_replica_processing_artifact_decision d
        where d.replica_id=$2::uuid and d.owner_user_id=$3::uuid
        order by d.artifact_id,d.created_at desc,d.decision_id desc
     ), target as (
       select b.build_id
         from vy_replica_model_build b
         join vy_replica r on r.replica_id=b.replica_id and r.owner_user_id=b.owner_user_id
         cross join biometric_consent biometric
         cross join training_consent training
        where b.build_id=$1::uuid and b.replica_id=$2::uuid and b.owner_user_id=$3::uuid
          and b.build_kind='voice_genome' and b.target_version=$4::int4 and b.builder_version=$5
          and b.source_set_hash=$6 and b.state='building' and b.lease_token_hash=$7
          and b.lease_expires_at>now() and r.subject_mode='self'
          and r.lifecycle not in ('revoked','purging') and r.liveness_verified_at is not null
          and r.identity_expires_at>now() and cardinality($10::uuid[])>0
          and (select count(*) from locked_sources)=cardinality($12::uuid[])
          and not exists (
            select 1 from unnest($10::uuid[]) required(evidence_id)
             where not exists (
               select 1 from vy_replica_processing_evidence e
               join latest l on l.evidence_id=e.evidence_id and l.decision='accepted'
               join vy_replica_source s on s.source_id=e.source_id and s.replica_id=e.replica_id
                and s.owner_user_id=e.owner_user_id and s.state='ready' and s.contains_third_parties=false
                where e.evidence_id=required.evidence_id and e.replica_id=$2::uuid and e.owner_user_id=$3::uuid
                  and lower(e.adapter_family||' '||e.adapter_name||' '||e.adapter_version)
                    !~ '(fake|fixture|test|mock)'
                  and (e.artifact_id is null or exists (
                    select 1 from artifact_latest selected
                     where selected.artifact_id=e.artifact_id and selected.decision='selected'
                  ))
             )
          )
          and (
            select count(*) from vy_replica_processing_evidence e
            join latest l on l.evidence_id=e.evidence_id and l.decision='accepted'
            join vy_replica_source s on s.source_id=e.source_id and s.replica_id=e.replica_id
              and s.owner_user_id=e.owner_user_id and s.state='ready' and s.contains_third_parties=false
            where e.replica_id=$2::uuid and e.owner_user_id=$3::uuid and e.evidence_type=any($13::text[])
              and lower(e.adapter_family||' '||e.adapter_name||' '||e.adapter_version)
                !~ '(fake|fixture|test|mock)'
              and (e.artifact_id is null or exists (
                select 1 from artifact_latest selected
                 where selected.artifact_id=e.artifact_id and selected.decision='selected'
              ))
          )=cardinality($10::uuid[])
          and not exists (
            select 1 from unnest($11::uuid[]) required(artifact_id)
             where not exists (
               select 1 from vy_replica_processing_artifact a
               join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id
                and s.owner_user_id=a.owner_user_id and s.state='ready' and s.contains_third_parties=false
                where a.artifact_id=required.artifact_id and a.replica_id=$2::uuid and a.owner_user_id=$3::uuid
                  and lower(a.adapter_family||' '||a.adapter_name||' '||a.adapter_version)
                    !~ '(fake|fixture|test|mock)'
                  and (a.stage<>'enhance' or exists (
                    select 1 from artifact_latest selected
                     where selected.artifact_id=a.artifact_id and selected.decision='selected'
                  ))
             )
          )
        for update of b,r
     ), genome as (
       insert into vy_replica_voice_genome(replica_id,version,source_set_hash,definition,status)
       select $2::uuid,$4::int4,$6,$8::jsonb,'draft' from target
       on conflict (replica_id,version) do update set source_set_hash=excluded.source_set_hash
        where vy_replica_voice_genome.status='draft'
          and vy_replica_voice_genome.source_set_hash=excluded.source_set_hash
          and vy_replica_voice_genome.definition=excluded.definition
       returning replica_id,version
     ), completed as (
       update vy_replica_model_build b set state='review',manifest_hash=$9,built_at=now(),
              lease_token_hash='',leased_at=null,lease_expires_at=null,failure_code='',updated_at=now()
        where b.build_id=(select build_id from target) and exists (select 1 from genome)
       returning b.build_id,b.replica_id,b.owner_user_id,b.target_version,b.state,b.manifest_hash,b.built_at
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'voice_genome.build','voice_genome',
              target_version::text,'voice-genome/v1','allowed',
              jsonb_build_object('build_id',build_id,'manifest_hash',manifest_hash,
                'evidence_count',cardinality($10::uuid[]),'artifact_count',cardinality($11::uuid[]))
         from completed
     ) select * from completed`,
    [lease.buildId, lease.replicaId, lease.ownerUserId, lease.targetVersion,
      lease.builderVersion, draft.source_set_hash, modelBuildLeaseHash(lease.leaseToken),
      JSON.stringify(draft.definition), draft.manifest_hash, evidenceIds, artifactIds, sourceIds,
      ["media_probe", "speaker_segment", "language_span", "voice_embedding", "voice_measurement", "quality_measurement"]],
  );
  if (!rows[0]) fail("model_build_settlement_denied");
  return rows[0];
}

export function modelBuildRetryDelayMs(attempt) {
  return Math.min(6 * 60 * 60 * 1_000, Math.max(30_000, 30_000 * (2 ** Math.max(0, Number(attempt || 1) - 1))));
}

export async function retryVoiceGenomeBuild(db, lease, error, options = {}) {
  const failureCode = String(error?.code || error?.message || "voice_genome_build_failed")
    .toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 100);
  const terminal = lease.attempt >= MAX_ATTEMPTS;
  const delayMs = Math.max(30_000, Number(options.retryAfterMs || modelBuildRetryDelayMs(lease.attempt)));
  const rows = await db(
    `update vy_replica_model_build set state=$5,failure_code=$6,
            next_attempt_at=case when $5='retry' then now()+($7::bigint*interval '1 millisecond') else next_attempt_at end,
            lease_token_hash='',leased_at=null,lease_expires_at=null,updated_at=now()
      where build_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid
        and state in ('leased','building') and lease_token_hash=$4
      returning build_id,state`,
    [lease.buildId, lease.replicaId, lease.ownerUserId, modelBuildLeaseHash(lease.leaseToken),
      terminal ? "failed" : "retry", failureCode || "voice_genome_build_failed", delayMs],
  );
  if (!rows[0]) fail("model_build_lease_lost");
  return rows[0];
}

export async function buildLeasedVoiceGenome(db, lease) {
  await startVoiceGenomeBuild(db, lease);
  const input = await loadAcceptedVoiceGenomeInput(db, lease.ownerUserId, lease.replicaId);
  if (input.sourceSetHash !== lease.sourceSetHash) fail("model_build_source_set_changed");
  const draft = buildVoiceGenomeDraft({
    version: lease.targetVersion,
    builderVersion: lease.builderVersion,
    evidence: input.evidence,
    artifacts: input.artifacts,
  });
  if (draft.source_set_hash !== lease.sourceSetHash) fail("model_build_source_set_mismatch");
  return completeVoiceGenomeBuild(db, lease, draft, input);
}

export async function runVoiceGenomeBuildSweep({ db, maxJobs = 2, lease = leaseNextVoiceGenomeBuild,
  build = buildLeasedVoiceGenome, retry = retryVoiceGenomeBuild } = {}) {
  if (typeof db !== "function") fail("model_build_db_required", 500);
  const summary = { leased: 0, built: 0, retried: 0, failed: 0 };
  for (let index = 0; index < Math.max(1, Math.min(5, Number(maxJobs || 2))); index++) {
    const claim = await lease(db);
    if (!claim) break;
    summary.leased++;
    try {
      await build(db, claim);
      summary.built++;
    } catch (error) {
      try {
        const settled = await retry(db, claim, error);
        if (settled.state === "failed") summary.failed++;
        else summary.retried++;
      } catch (retryError) {
        if (retryError?.code !== "model_build_lease_lost") throw retryError;
      }
    }
  }
  return Object.freeze(summary);
}
