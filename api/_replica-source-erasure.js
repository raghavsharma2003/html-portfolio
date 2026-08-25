import { randomBytes } from "node:crypto";
import { REPLICA_POLICY_VERSION } from "./_replica.js";
import { sha256Hex } from "./_replica-processing/contracts.js";
import { REPLICA_STORAGE_BUCKET, deleteReplicaObjects } from "./_replica-storage.js";

const MAX_RETRY_MS = 6 * 60 * 60 * 1000;

export function sourceErasureLeaseTokenHash(token) {
  if (typeof token !== "string" || token.length < 32) throw new Error("strong source erasure lease token required");
  return sha256Hex(`replica-source-erasure-lease:v1:${token}`);
}

function objectPaths(row) {
  const prefix = `${row.owner_user_id}/${row.replica_id}/${row.source_id}/`;
  const objects = [{ bucket: row.storage_bucket, path: row.object_path }, ...(Array.isArray(row.artifacts) ? row.artifacts : [])];
  const paths = [];
  for (const object of objects) {
    const path = String(object?.path || "");
    if (object?.bucket !== REPLICA_STORAGE_BUCKET || !path.startsWith(prefix) || path.includes("://") ||
        (path !== `${prefix}original` && !path.startsWith(`${prefix}derived/`))) {
      throw Object.assign(new Error("source erasure storage lineage invalid"), { code: "storage_lineage_invalid" });
    }
    paths.push(path);
  }
  return Object.freeze([...new Set(paths)].sort());
}

export async function leaseNextSourceErasure(db, options = {}) {
  const token = options.token || randomBytes(32).toString("base64url");
  const leaseMs = Math.max(60_000, Math.min(300_000, Number(options.leaseMs || 240_000)));
  const rows = await db(
    `with candidate as (
       select s.source_id,s.erasure_attempts previous_attempt,s.erasure_lease_token_hash previous_lease
         from vy_replica_source s where s.state='deleting' and (
          (s.erasure_lease_token_hash='' and s.erasure_next_attempt_at<=now()) or
          (s.erasure_lease_token_hash<>'' and s.erasure_lease_expires_at<=now())
          ) and not exists (
            select 1 from vy_replica_liveness_challenge ch where ch.replica_id=s.replica_id
              and ch.owner_user_id=s.owner_user_id and ch.face_session_state in (
                'issuing','ready','polling','passed_deleting','failed_deleting','expired_deleting'
              )
          ) order by s.erasure_next_attempt_at,s.updated_at for update skip locked limit 1
     ), expired as (
       update vy_replica_source_erasure_attempt a
          set outcome='retry',failure_code='lease_expired',finished_at=now()
         from candidate c where c.previous_lease<>'' and a.source_id=c.source_id
          and a.attempt=c.previous_attempt and a.outcome='running'
     ), leased as (
       update vy_replica_source s set erasure_attempts=s.erasure_attempts+1,
              erasure_lease_token_hash=$1,erasure_leased_at=now(),
              erasure_lease_expires_at=now()+($2::integer*interval '1 millisecond'),
              erasure_last_error_code='',updated_at=now()
         from candidate c where s.source_id=c.source_id
       returning s.source_id,s.replica_id,s.owner_user_id,s.storage_bucket,s.object_path,
                 s.erasure_attempts,s.erasure_lease_expires_at,
                 coalesce((select jsonb_agg(jsonb_build_object('bucket',a.storage_bucket,'path',a.object_path)
                   order by a.object_path) from vy_replica_processing_artifact a
                   where a.source_id=s.source_id and a.replica_id=s.replica_id
                     and a.owner_user_id=s.owner_user_id),'[]'::jsonb) artifacts
     ), attempted as (
       insert into vy_replica_source_erasure_attempt
         (source_id,replica_id,owner_user_id,attempt,object_count,outcome)
       select source_id,replica_id,owner_user_id,erasure_attempts,
              1+jsonb_array_length(artifacts),'running' from leased
       on conflict (source_id,attempt) do nothing
     ) select * from leased`,
    [sourceErasureLeaseTokenHash(token), leaseMs],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const claimed = Object.freeze({
    source: Object.freeze({
      sourceId: row.source_id,
      replicaId: row.replica_id,
      ownerUserId: row.owner_user_id,
      paths: Object.freeze([]),
      attempt: Number(row.erasure_attempts),
    }),
    leaseToken: token,
  });
  try {
    return Object.freeze({
      ...claimed,
      source: Object.freeze({ ...claimed.source, paths: objectPaths(row) }),
    });
  } catch (error) {
    await retrySourceErasure(db, claimed, { error, retryAfterMs: MAX_RETRY_MS });
    return null;
  }
}

function requireSettlement(rows, code) {
  if (!rows[0]) throw Object.assign(new Error(code), { code });
  return true;
}

export async function completeSourceErasure(db, lease) {
  const rows = await db(
    `with review_lock as materialized (
       select pg_try_advisory_xact_lock(hashtextextended($2::text || ':voice_genome_review',0)) acquired
     ), target as (
       select s.source_id,s.replica_id,s.owner_user_id,s.erasure_attempts
         from vy_replica_source s cross join review_lock
        where review_lock.acquired and s.source_id=$1 and s.replica_id=$2 and s.owner_user_id=$3
          and s.state='deleting' and s.erasure_lease_token_hash=$4
          and s.erasure_lease_expires_at>now()
           and not exists (select 1 from vy_replica_voice_profile vp
             where vp.replica_id=s.replica_id and vp.owner_user_id=s.owner_user_id)
           and not exists (
             select 1 from vy_replica_liveness_challenge ch where ch.replica_id=s.replica_id
               and ch.owner_user_id=s.owner_user_id and ch.face_session_state in (
                 'issuing','ready','polling','passed_deleting','failed_deleting','expired_deleting'
               )
           )
        for update
     ), provider_consent as (
       update vy_replica_provider_consent pc set source_id=null,state='revoked',
              revoked_at=coalesce(revoked_at,now()),updated_at=now()
         from target t where pc.source_id=t.source_id and pc.replica_id=t.replica_id
          and pc.owner_user_id=t.owner_user_id
     ), identity_binding as (
       select ic.identity_case_id,ic.replica_id,ic.owner_user_id,
              (ic.state='verified' and r.age_verified_at is not null
               and r.identity_verified_at is not null and r.liveness_verified_at is not null
               and r.identity_expires_at>now()) preserve
         from vy_replica_identity_case ic
         join target t on t.source_id=ic.source_id and t.replica_id=ic.replica_id
          and t.owner_user_id=ic.owner_user_id
         join vy_replica r on r.replica_id=ic.replica_id and r.owner_user_id=ic.owner_user_id
     ), preserved_identity as (
       update vy_replica_identity_case ic set source_id=null,updated_at=now()
        from identity_binding b where b.preserve and ic.identity_case_id=b.identity_case_id
       returning ic.identity_case_id
     ), identity_challenge_sources as (
       update vy_replica_source live set state='deleting',updated_at=now()
         from vy_replica_liveness_challenge ch
         join identity_binding b on b.identity_case_id=ch.identity_case_id and not b.preserve
         join target t on t.replica_id=b.replica_id and t.owner_user_id=b.owner_user_id
        where live.source_id=ch.source_id and live.replica_id=ch.replica_id
          and live.owner_user_id=ch.owner_user_id and live.source_id<>t.source_id
     ), identity_cases as (
       delete from vy_replica_identity_case ic using identity_binding b
        where ic.identity_case_id=b.identity_case_id and not b.preserve
          and (select count(*) from identity_challenge_sources)>=0
       returning ic.replica_id,ic.owner_user_id
     ), identity_replica as (
       update vy_replica r set age_verified_at=null,identity_verified_at=null,liveness_verified_at=null,
              identity_expires_at=null,
              lifecycle=case when lifecycle in ('revoked','purging') then lifecycle else 'enrolling' end,
              updated_at=now()
        where exists (select 1 from identity_cases ic where ic.replica_id=r.replica_id
          and ic.owner_user_id=r.owner_user_id)
       returning r.subject_person_id
     ), identity_consent as (
       update vy_replica_consent c set revoked_at=coalesce(revoked_at,now())
        where exists (select 1 from identity_cases ic where ic.replica_id=c.replica_id
          and ic.owner_user_id=c.owner_user_id) and c.scope='biometric' and c.revoked_at is null
     ), identity_person as (
       update vy_person p set age_tier='unverified'
        where exists (select 1 from identity_replica r where r.subject_person_id=p.person_id)
     ), claims as (
       delete from vy_replica_claim c using target t
        where c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and t.source_id=any(c.source_ids)
     ), genomes as (
       update vy_replica_voice_genome g set status='retired',
              source_set_hash='erased:'||$1::text||':'||g.version::text,
              definition=jsonb_build_object('erased',true,'reason','source_erased')
         from target t where g.replica_id=t.replica_id
     ), profiles as (
       update vy_replica_profile p set status='retired',
              source_set_hash='erased:'||$1::text||':'||p.version::text,
              definition=jsonb_build_object('erased',true,'reason','source_erased')
         from target t where p.replica_id=t.replica_id
     ), calibrations as (
       update vy_replica_calibration c set status='retired',
              definition=jsonb_build_object('erased',true,'reason','source_erased')
         from target t where c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
     ), datasets as (
       update vy_replica_feedback_dataset d set status='retired',
              definition=jsonb_build_object('erased',true,'reason','source_erased'),
              readiness=jsonb_build_object('ready',false,'blockers',jsonb_build_array('source_erased'))
         from target t where d.replica_id=t.replica_id and d.owner_user_id=t.owner_user_id
     ), candidates as (
       update vy_replica_candidate c set status='retired',updated_at=now()
         from target t where c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and c.status<>'retired'
      ), builds as (
        update vy_replica_model_build b set state='retired',updated_at=now()
          from target t where b.replica_id=t.replica_id and b.owner_user_id=t.owner_user_id
           and b.state<>'retired'
      ), voice_delivery_policies as (
        delete from vy_replica_voice_delivery_policy p using vy_replica_processing_artifact a,target t
         where p.preview_artifact_id=a.artifact_id and p.replica_id=a.replica_id
           and p.owner_user_id=a.owner_user_id and a.source_id=t.source_id
           and a.replica_id=t.replica_id and a.owner_user_id=t.owner_user_id
      ), voice_preferences as (
        delete from vy_replica_voice_preference p using target t
         where p.replica_id=t.replica_id and p.owner_user_id=t.owner_user_id
           and exists (
             select 1 from vy_replica_generation g
             join vy_replica_processing_artifact a on a.artifact_id=g.preview_artifact_id
              and a.replica_id=g.replica_id and a.owner_user_id=g.owner_user_id
              where g.generation_id in (p.left_generation_id,p.right_generation_id)
                and a.source_id=t.source_id and a.replica_id=t.replica_id
                and a.owner_user_id=t.owner_user_id
           )
      ), preview_generations as (
        delete from vy_replica_generation g using vy_replica_processing_artifact a,target t
         where g.preview_artifact_id=a.artifact_id and g.replica_id=a.replica_id
           and g.owner_user_id=a.owner_user_id and a.source_id=t.source_id
           and a.replica_id=t.replica_id and a.owner_user_id=t.owner_user_id
      ), voice_trials as (
        delete from vy_replica_voice_trial v using target t
         where v.preview_artifact_id in (
           select a.artifact_id from vy_replica_processing_artifact a
            where a.source_id=t.source_id and a.replica_id=t.replica_id and a.owner_user_id=t.owner_user_id
         ) and v.replica_id=t.replica_id and v.owner_user_id=t.owner_user_id
      ), removed as (
        delete from vy_replica_source s using target t
         where s.source_id=t.source_id and s.replica_id=t.replica_id and s.owner_user_id=t.owner_user_id
          and (select count(*) from identity_cases)>=0 and (select count(*) from preserved_identity)>=0
       returning t.source_id,t.replica_id,t.owner_user_id,t.erasure_attempts
     ), attempted as (
       update vy_replica_source_erasure_attempt a set outcome='complete',failure_code='',finished_at=now()
         from removed r where a.source_id=r.source_id and a.attempt=r.erasure_attempts and a.outcome='running'
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'source.delete.complete','source',source_id::text,$5,'allowed',
              jsonb_build_object('derived_models_scrubbed',true,'worker','reconciler') from removed
     ) select source_id from removed`,
    [lease.source.sourceId, lease.source.replicaId, lease.source.ownerUserId,
      sourceErasureLeaseTokenHash(lease.leaseToken), REPLICA_POLICY_VERSION],
  );
  return requireSettlement(rows, "source_erasure_waiting_for_provider");
}

export function normalizeSourceErasureFailure(error) {
  const code = String(error?.code || error || "");
  if (code === "source_erasure_waiting_for_provider") return "provider_voice_erasure_pending";
  if (code === "storage_lineage_invalid") return "storage_lineage_invalid";
  if (code.includes("unreachable")) return "private_storage_unreachable";
  if (code.includes("storage")) return "private_storage_delete_failed";
  return "source_erasure_failed";
}

export async function retrySourceErasure(db, lease, input = {}) {
  const retryAfterMs = Math.max(30_000, Math.min(MAX_RETRY_MS, Number(input.retryAfterMs || 30_000)));
  const failureCode = normalizeSourceErasureFailure(input.error || input.failureCode);
  const rows = await db(
    `with retried as (
       update vy_replica_source s set erasure_next_attempt_at=now()+($5::integer*interval '1 millisecond'),
              erasure_lease_token_hash='',erasure_leased_at=null,erasure_lease_expires_at=null,
              erasure_last_error_code=$6,updated_at=now()
        where s.source_id=$1 and s.replica_id=$2 and s.owner_user_id=$3 and s.state='deleting'
          and s.erasure_lease_token_hash=$4 and s.erasure_lease_expires_at>now()
       returning s.source_id,s.erasure_attempts
     ), attempted as (
       update vy_replica_source_erasure_attempt a set outcome='retry',failure_code=$6,finished_at=now()
         from retried r where a.source_id=r.source_id and a.attempt=r.erasure_attempts and a.outcome='running'
     ) select source_id from retried`,
    [lease.source.sourceId, lease.source.replicaId, lease.source.ownerUserId,
      sourceErasureLeaseTokenHash(lease.leaseToken), retryAfterMs, failureCode],
  );
  return requireSettlement(rows, "lost_source_erasure_lease");
}

export function sourceErasureRetryDelayMs(attempt) {
  const safeAttempt = Math.max(1, Math.min(30, Number(attempt) || 1));
  return Math.min(MAX_RETRY_MS, 30_000 * (2 ** (safeAttempt - 1)));
}

export async function runSourceErasureSweep(options) {
  const db = options?.db;
  if (typeof db !== "function") throw new Error("source erasure database required");
  const lease = options.lease || leaseNextSourceErasure;
  const removeObjects = options.removeObjects || deleteReplicaObjects;
  const complete = options.complete || completeSourceErasure;
  const retry = options.retry || retrySourceErasure;
  const maxJobs = Math.max(1, Math.min(4, Number(options.maxJobs || 2)));
  const timeBudgetMs = Math.max(10_000, Math.min(240_000, Number(options.timeBudgetMs || 120_000)));
  const started = Date.now();
  const summary = { leased: 0, completed: 0, retried: 0 };
  while (summary.leased < maxJobs && Date.now() - started < timeBudgetMs) {
    const claimed = await lease(db, { leaseMs: 240_000 });
    if (!claimed) break;
    summary.leased += 1;
    try {
      await removeObjects(claimed.source.paths);
      await complete(db, claimed);
      summary.completed += 1;
    } catch (error) {
      await retry(db, claimed, { error, retryAfterMs: sourceErasureRetryDelayMs(claimed.source.attempt) });
      summary.retried += 1;
    }
  }
  return Object.freeze(summary);
}
