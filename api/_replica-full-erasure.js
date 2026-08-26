import { createHmac, randomBytes } from "node:crypto";
import { sha256Hex } from "./_replica-processing/contracts.js";
import { REPLICA_POLICY_VERSION } from "./_replica.js";

export const REPLICA_ERASURE_RECEIPT_VERSION = "replica-erasure-receipt/v1";
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;

export function replicaErasureLeaseTokenHash(token) {
  if (typeof token !== "string" || token.length < 32) throw new Error("strong replica erasure lease token required");
  return sha256Hex(`replica-full-erasure-lease:v1:${token}`);
}

export function replicaErasureRequestHash(value) {
  const id = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw Object.assign(new Error("valid erasure request id required"), { code: "valid_erasure_request_id_required", status: 400 });
  }
  return sha256Hex(`replica-erasure-request:v1:${id}`);
}

export function createReplicaErasureReceipt(replicaId, ownerUserId, env = process.env, options = {}) {
  let key;
  try { key = Buffer.from(String(env.REPLICA_ERASURE_RECEIPT_KEY_B64 || ""), "base64"); } catch { key = Buffer.alloc(0); }
  if (key.length !== 32) throw Object.assign(new Error("replica erasure receipt key required"), { code: "erasure_receipt_key_required" });
  const retentionDays = Number(env.REPLICA_BACKUP_RETENTION_DAYS);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) {
    throw Object.assign(new Error("replica backup retention policy required"), { code: "backup_retention_policy_required" });
  }
  const nonce = String(options.nonce || randomBytes(32).toString("hex"));
  if (!/^[0-9a-f]{64}$/.test(nonce)) throw new Error("valid erasure receipt nonce required");
  const digest = (kind, value) => createHmac("sha256", key)
    .update(`${REPLICA_ERASURE_RECEIPT_VERSION}:${kind}:${nonce}:${value}`)
    .digest("hex");
  return Object.freeze({
    replicaIdHash: digest("replica", replicaId),
    ownerUserHash: digest("owner", ownerUserId),
    erasureRequestHash: replicaErasureRequestHash(options.erasureRequestId),
    nonce,
    backupExpiresAt: new Date((options.nowMs ?? Date.now()) + retentionDays * 86_400_000).toISOString(),
    deletedClasses: Object.freeze([
      "provider_voice", "provider_face_session", "provider_consent", "private_originals", "private_derivatives",
      "replica_models", "replica_feedback", "replica_runtime", "replica_audit",
      "agent_relational_memory", "agent_identity",
    ]),
  });
}

export async function prepareReplicaErasures(db, options = {}) {
  const limit = Math.max(1, Math.min(20, Number(options.limit || 8)));
  return db(
    `with candidates as (
       select j.job_id,j.replica_id,j.owner_user_id
         from vy_replica_erasure_job j where (
          j.state in ('pending','blocked') or
          (j.state='running' and (j.lease_expires_at is null or j.lease_expires_at<=now()))
         ) order by j.next_attempt_at,j.requested_at limit $1
     ), expired as (
       update vy_replica_erasure_attempt a set outcome='retry',failure_code='lease_expired',finished_at=now()
         from vy_replica_erasure_job j join candidates c on c.job_id=j.job_id
        where j.state='running' and a.job_id=j.job_id and a.attempt=j.attempts and a.outcome='running'
     ), replicas as (
       update vy_replica r set lifecycle='purging',revoked_at=coalesce(revoked_at,now()),updated_at=now()
         from candidates c where r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id
       returning r.replica_id,r.owner_user_id
     ), consents as (
       update vy_replica_consent c set revoked_at=coalesce(revoked_at,now())
         from replicas r where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
      ), provider_consents as (
       update vy_replica_provider_consent c set state='revoked',revoked_at=coalesce(revoked_at,now()),updated_at=now()
          from replicas r where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id and c.state<>'revoked'
      ), face_sessions as (
        update vy_replica_liveness_challenge ch set state='failed',failure_code='replica_revoked',
               face_session_state=case
                 when ch.face_session_handle<>'' and ch.face_session_state not in
                   ('passed_deleted','failed_deleted','expired_deleted') then 'expired_deleting'
                 else ch.face_session_state end,
               verification_lease_token_hash='',verification_leased_at=null,
               verification_lease_expires_at=null,updated_at=now()
          from replicas r where ch.replica_id=r.replica_id and ch.owner_user_id=r.owner_user_id
        returning ch.challenge_id,ch.verification_attempt
      ), liveness_attempts as (
        update vy_replica_liveness_verification_attempt a set outcome='failed',
               failure_code='replica_revoked',finished_at=now()
          from face_sessions ch where a.challenge_id=ch.challenge_id
            and a.attempt=ch.verification_attempt and a.outcome='running'
      ), biometric_verification_grants as (
        update vy_replica_biometric_verification_grant g set state='revoked',revoked_at=now()
          from replicas r where g.replica_id=r.replica_id and g.owner_user_id=r.owner_user_id and g.state='active'
     ), sources as (
       update vy_replica_source s set state='deleting',updated_at=now()
         from replicas r where s.replica_id=r.replica_id and s.owner_user_id=r.owner_user_id
       returning s.source_id
     ), voices as (
       update vy_replica_voice_profile v set status='deleting',updated_at=now()
         from replicas r where v.replica_id=r.replica_id and v.owner_user_id=r.owner_user_id
       returning v.voice_profile_id
     ), capabilities as (
       update vy_replica_runtime_capability c set state='revoked',revoked_at=coalesce(revoked_at,now())
         from replicas r where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
          and c.state in ('active','paused')
     ), sessions as (
       update vy_replica_runtime_session s set state='revoked',ended_at=coalesce(ended_at,now()),updated_at=now()
         from replicas r where s.replica_id=r.replica_id and s.owner_user_id=r.owner_user_id and s.state='active'
     ), generations as (
       update vy_replica_generation g set state='aborted',failure_code='replica_revoked',updated_at=now()
         from replicas r where g.replica_id=r.replica_id and g.owner_user_id=r.owner_user_id
          and g.state in ('authorized','streaming')
     ), jobs as (
       update vy_replica_erasure_job j set state='pending',lease_token_hash='',leased_at=null,
              lease_expires_at=null,next_attempt_at=now(),
               provider_status=coalesce(j.provider_status,'{}'::jsonb)||
                 jsonb_build_object('voice','pending','voice_count',(select count(*) from voices),'face','pending'),
              storage_status=jsonb_build_object('source','pending','count',(select count(*) from sources)),updated_at=now()
         from replicas r where j.replica_id=r.replica_id and j.owner_user_id=r.owner_user_id
       returning j.job_id,j.replica_id
     ) select * from jobs`,
    [limit],
  );
}

function validReplicaAgent(row) {
  if (!row.agent_id) return true;
  const register = row.agent_register && typeof row.agent_register === "object"
    ? row.agent_register
    : (() => { try { return JSON.parse(row.agent_register || "{}"); } catch { return {}; } })();
  return row.agent_slug === `replica-${String(row.replica_id).replaceAll("-", "")}` && register.selfReplica === true;
}

export async function leaseNextReplicaErasure(db, options = {}) {
  const token = options.token || randomBytes(32).toString("base64url");
  const leaseMs = Math.max(60_000, Math.min(300_000, Number(options.leaseMs || 180_000)));
  const rows = await db(
    `with candidate as (
       select j.job_id,j.state previous_state,j.attempts previous_attempt
         from vy_replica_erasure_job j join vy_replica r
          on r.replica_id=j.replica_id and r.owner_user_id=j.owner_user_id
        where r.lifecycle='purging' and j.next_attempt_at<=now() and (
          j.state in ('pending','blocked') or
          (j.state='running' and (j.lease_expires_at is null or j.lease_expires_at<=now()))
         ) and not exists (select 1 from vy_replica_voice_profile v where v.replica_id=j.replica_id)
           and not exists (select 1 from vy_replica_source s where s.replica_id=j.replica_id)
           and not exists (
             select 1 from vy_replica_liveness_challenge ch where ch.replica_id=j.replica_id
               and ch.owner_user_id=j.owner_user_id and ch.face_session_state in (
                 'issuing','ready','polling','passed_deleting','failed_deleting','expired_deleting'
               )
           )
        order by j.next_attempt_at,j.requested_at for update skip locked limit 1
     ), expired as (
       update vy_replica_erasure_attempt a set outcome='retry',failure_code='lease_expired',finished_at=now()
         from candidate c where c.previous_state='running' and a.job_id=c.job_id
          and a.attempt=c.previous_attempt and a.outcome='running'
     ), leased as (
       update vy_replica_erasure_job j set state='running',attempts=j.attempts+1,
              lease_token_hash=$1,leased_at=now(),
              lease_expires_at=now()+($2::integer*interval '1 millisecond'),last_error_code='',updated_at=now()
         from candidate c where j.job_id=c.job_id
       returning j.job_id,j.replica_id,j.owner_user_id,j.attempts,j.lease_expires_at
     ), attempted as (
       insert into vy_replica_erasure_attempt(job_id,attempt,outcome)
       select job_id,attempts,'running' from leased on conflict (job_id,attempt) do nothing
     ) select l.*,r.agent_id,a.slug agent_slug,a.register agent_register
         from leased l join vy_replica r on r.replica_id=l.replica_id and r.owner_user_id=l.owner_user_id
         left join vy_agent a on a.agent_id=r.agent_id`,
    [replicaErasureLeaseTokenHash(token), leaseMs],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const claimed = Object.freeze({
    jobId: row.job_id, replicaId: row.replica_id, ownerUserId: row.owner_user_id,
    agentId: row.agent_id || null, attempt: Number(row.attempts), leaseToken: token,
  });
  if (!validReplicaAgent(row)) {
    await retryReplicaErasure(db, claimed, { error: { code: "agent_binding_unsafe" }, retryAfterMs: MAX_RETRY_MS });
    return null;
  }
  return claimed;
}

function requireSettlement(rows, code) {
  if (!rows[0]) throw Object.assign(new Error(code), { code });
  return rows[0];
}

export async function retryReplicaErasure(db, lease, input = {}) {
  const delayMs = Math.max(30_000, Math.min(MAX_RETRY_MS, Number(input.retryAfterMs || 30_000)));
  const failureCode = normalizeReplicaErasureFailure(input.error || input.failureCode);
  const rows = await db(
    `with retried as (
       update vy_replica_erasure_job j set state='pending',next_attempt_at=now()+($3::integer*interval '1 millisecond'),
              lease_token_hash='',leased_at=null,lease_expires_at=null,last_error_code=$4,updated_at=now()
        where j.job_id=$1::uuid and j.state='running' and j.lease_token_hash=$2 and j.lease_expires_at>now()
       returning j.job_id,j.attempts
     ), attempted as (
       update vy_replica_erasure_attempt a set outcome='retry',failure_code=$4,finished_at=now()
         from retried r where a.job_id=r.job_id and a.attempt=r.attempts and a.outcome='running'
     ) select job_id from retried`,
    [lease.jobId, replicaErasureLeaseTokenHash(lease.leaseToken), delayMs, failureCode],
  );
  requireSettlement(rows, "lost_replica_erasure_lease");
  return failureCode;
}

export function normalizeReplicaErasureFailure(error) {
  const code = String(error?.code || error || "");
  if (code === "agent_binding_unsafe") return code;
  if (code === "erasure_receipt_key_required") return code;
  if (code === "backup_retention_policy_required") return code;
  return "replica_database_purge_failed";
}

export async function completeReplicaErasure(db, lease, receipt) {
  const processor = JSON.stringify({
    provider: "confirmed", storage: "confirmed", database: "confirmed",
    relational: lease.agentId ? "confirmed" : "not_created",
    backup: "expires_under_configured_policy",
  });
  const rows = await db(
    `with target as (
       select j.job_id,j.replica_id,j.owner_user_id,j.attempts,r.agent_id
         from vy_replica_erasure_job j join vy_replica r
          on r.replica_id=j.replica_id and r.owner_user_id=j.owner_user_id
         left join vy_agent a on a.agent_id=r.agent_id
        where j.job_id=$1::uuid and j.replica_id=$2::uuid and j.owner_user_id=$3::uuid and j.state='running'
          and j.lease_token_hash=$4 and j.lease_expires_at>now() and r.lifecycle='purging'
           and not exists (select 1 from vy_replica_voice_profile v where v.replica_id=r.replica_id)
           and not exists (select 1 from vy_replica_source s where s.replica_id=r.replica_id)
           and not exists (
             select 1 from vy_replica_liveness_challenge ch where ch.replica_id=r.replica_id
               and ch.owner_user_id=r.owner_user_id and ch.face_session_state in (
                 'issuing','ready','polling','passed_deleting','failed_deleting','expired_deleting'
               )
           )
          and (r.agent_id is null or (a.slug='replica-'||replace(r.replica_id::text,'-','')
            and a.register->>'selfReplica'='true'))
        for update
     ), turn_legs as (delete from meera_turn_leg x using target t where x.agent_id=t.agent_id),
     turns as (delete from meera_turn x using target t where x.agent_id=t.agent_id),
     raw_logs as (delete from meera_log x using target t where x.agent_id=t.agent_id),
     raw_nodes as (delete from meera_nodes x using target t where x.agent_id=t.agent_id),
     raw_edges as (delete from meera_edges x using target t where x.agent_id=t.agent_id),
     raw_forget as (delete from meera_forget x using target t where x.agent_id=t.agent_id),
     raw_leases as (delete from meera_consolidate_lease x using target t where x.agent_id=t.agent_id),
     group_turns as (delete from vy_group_turn x using target t where x.agent_id=t.agent_id),
     group_members as (delete from vy_group_member x using target t where x.agent_id=t.agent_id),
     disclosure_grants as (delete from vy_disclosure_grant x using target t where x.agent_id=t.agent_id),
     groups as (delete from vy_group x using target t where x.agent_id=t.agent_id),
     life_told as (delete from vy_agent_life_told x using target t where x.agent_id=t.agent_id),
     agent_life as (delete from vy_agent_life x using target t where x.agent_id=t.agent_id),
     self_arcs as (delete from vy_self_arc x using target t where x.agent_id=t.agent_id),
     textures as (delete from vy_rel_texture x using target t where x.agent_id=t.agent_id),
     observations as (delete from vy_observation x using target t where x.agent_id=t.agent_id),
     shared_moments as (delete from vy_shared_moment x using target t where x.agent_id=t.agent_id),
     visual_assertions as (delete from vy_visual_assertion x using target t where x.agent_id=t.agent_id),
     derivations as (delete from vy_derivation x using target t where x.agent_id=t.agent_id),
     embeddings as (delete from vy_embedding x using target t where x.agent_id=t.agent_id),
     facts as (delete from vy_fact x using target t where x.agent_id=t.agent_id),
     rel_events as (delete from vy_rel_event x using target t where x.agent_id=t.agent_id),
     patterns as (delete from vy_pattern x using target t where x.agent_id=t.agent_id),
     phrases as (delete from vy_phrase x using target t where x.agent_id=t.agent_id),
     kin as (delete from vy_kin x using target t where x.agent_id=t.agent_id),
     rituals as (delete from vy_ritual x using target t where x.agent_id=t.agent_id),
     currencies as (delete from vy_currency x using target t where x.agent_id=t.agent_id),
     india_profiles as (delete from vy_india_profile x using target t where x.agent_id=t.agent_id),
     taste as (delete from vy_taste_candidate x using target t where x.agent_id=t.agent_id),
     rel_states as (delete from vy_rel_state x using target t where x.agent_id=t.agent_id),
     sessions as (delete from vy_session x using target t where x.agent_id=t.agent_id),
     episodes as (delete from vy_episode x using target t where x.agent_id=t.agent_id),
     audit as (delete from vy_replica_audit x using target t where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     receipt as (
       insert into vy_replica_deletion_receipt
         (replica_id_hash,owner_user_hash,policy_version,reason,deleted_classes,processor_status,
          backup_expires_at,receipt_version,receipt_nonce,erasure_request_hash)
       select $5,$6,$7,'owner_revocation',$8::text[],$9::jsonb,$10::timestamptz,$11,$12,$13 from target
       on conflict (replica_id_hash) do nothing returning receipt_id
     ), removed_replica as (
       delete from vy_replica r using target t where r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id
       returning t.agent_id
     ), removed_agent as (
       delete from vy_agent a using removed_replica r where a.agent_id=r.agent_id
       returning a.agent_id
     ) select receipt_id from receipt`,
    [lease.jobId, lease.replicaId, lease.ownerUserId, replicaErasureLeaseTokenHash(lease.leaseToken),
      receipt.replicaIdHash, receipt.ownerUserHash, REPLICA_POLICY_VERSION, receipt.deletedClasses,
      processor, receipt.backupExpiresAt, REPLICA_ERASURE_RECEIPT_VERSION, receipt.nonce,
      receipt.erasureRequestHash],
  );
  return requireSettlement(rows, "replica_erasure_completion_failed");
}

export async function runReplicaErasureFinalizer(options) {
  const db = options?.db;
  if (typeof db !== "function") throw new Error("replica erasure database required");
  const lease = options.lease || leaseNextReplicaErasure;
  const complete = options.complete || completeReplicaErasure;
  const retry = options.retry || retryReplicaErasure;
  const receiptFactory = options.receiptFactory || ((claimed) =>
    createReplicaErasureReceipt(claimed.replicaId, claimed.ownerUserId, process.env, {
      erasureRequestId: claimed.jobId,
    }));
  const maxJobs = Math.max(1, Math.min(4, Number(options.maxJobs || 2)));
  const summary = { leased: 0, completed: 0, retried: 0 };
  while (summary.leased < maxJobs) {
    const claimed = await lease(db);
    if (!claimed) break;
    summary.leased += 1;
    try {
      const receipt = receiptFactory(claimed);
      await complete(db, claimed, receipt);
      summary.completed += 1;
    } catch (error) {
      await retry(db, claimed, { error, retryAfterMs: MAX_RETRY_MS });
      summary.retried += 1;
    }
  }
  return Object.freeze(summary);
}

export async function getReplicaErasureStatus(db, ownerUserId, requestId) {
  const id = String(requestId || "").trim().toLowerCase();
  const requestHash = replicaErasureRequestHash(id);
  const rows = await db(
    `select 'pending' state,j.requested_at,j.updated_at,null::timestamptz completed_at,
            null::timestamptz backup_expires_at,j.attempts,
             case when exists (
               select 1 from vy_replica_voice_profile v
                where v.replica_id=j.replica_id and v.owner_user_id=j.owner_user_id
             ) or exists (
               select 1 from vy_replica_liveness_challenge ch
                where ch.replica_id=j.replica_id and ch.owner_user_id=j.owner_user_id
                  and ch.face_session_state in (
                    'issuing','ready','polling','passed_deleting','failed_deleting','expired_deleting'
                  )
             ) then 'pending' else 'confirmed' end provider_state,
            case when exists (
              select 1 from vy_replica_source s
               where s.replica_id=j.replica_id and s.owner_user_id=j.owner_user_id
            ) then 'pending' else 'confirmed' end storage_state,
            '{}'::text[] deleted_classes
       from vy_replica_erasure_job j where j.job_id=$1::uuid and j.owner_user_id=$2::uuid
     union all
     select 'complete' state,r.completed_at requested_at,r.completed_at updated_at,r.completed_at,
            r.backup_expires_at,0 attempts,'confirmed' provider_state,
            'confirmed' storage_state,r.deleted_classes
       from vy_replica_deletion_receipt r where r.erasure_request_hash=$3
     limit 1`,
    [id, ownerUserId, requestHash],
  );
  const row = rows[0];
  if (!row) return null;
  return Object.freeze({
    state: row.state,
    requested_at: row.requested_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    backup_expires_at: row.backup_expires_at,
    attempts: Number(row.attempts || 0),
    provider: row.provider_state === "confirmed" ? "confirmed" : "pending",
    storage: row.storage_state === "confirmed" ? "confirmed" : "pending",
    deleted_classes: Array.isArray(row.deleted_classes) ? row.deleted_classes : [],
  });
}
