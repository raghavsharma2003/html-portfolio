import { randomBytes } from "node:crypto";
import { sha256Hex } from "./_provenance/contracts.js";

const MAX_RETRY_MS = 6 * 60 * 60 * 1000;

export function claimExtractionLeaseTokenHash(token) {
  const value = String(token || "");
  if (value.length < 32) throw new Error("strong claim extraction lease token required");
  return sha256Hex(`replica-claim-extraction-lease:v1:${value}`);
}

export async function leaseNextClaimExtractionJob(db, options = {}) {
  const token = options.token || randomBytes(32).toString("base64url");
  const leaseMs = Math.max(60_000, Math.min(10 * 60_000, Number(options.leaseMs || 5 * 60_000)));
  const rows = await db(
    `with reconciled as (
       update vy_replica_claim_extraction_queue q
          set state='complete',lease_token_hash='',leased_at=null,lease_expires_at=null,
              last_error_code='',completed_at=now(),updated_at=now()
        where (q.state in ('queued','waiting')
          or (q.state='running' and (q.lease_expires_at is null or q.lease_expires_at<=now())))
          and not exists (
            select 1 from vy_replica_claim_extraction_queue_item i
             where i.job_id=q.job_id and i.replica_id=q.replica_id
               and i.owner_user_id=q.owner_user_id and i.state='pending'
          )
       returning q.job_id
     ), candidate as (
       select q.job_id
         from vy_replica_claim_extraction_queue q
         join vy_replica r on r.replica_id=q.replica_id and r.owner_user_id=q.owner_user_id
        where r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and q.next_attempt_at<=now()
          and (q.state in ('queued','waiting')
            or (q.state='running' and (q.lease_expires_at is null or q.lease_expires_at<=now())))
          and exists (
            select 1 from vy_replica_claim_extraction_queue_item i
             where i.job_id=q.job_id and i.replica_id=q.replica_id
               and i.owner_user_id=q.owner_user_id and i.state='pending'
          )
          and not exists (select 1 from reconciled x where x.job_id=q.job_id)
        order by q.next_attempt_at,q.created_at
        for update of q skip locked limit 1
     ), leased as (
       update vy_replica_claim_extraction_queue q
          set state='running',attempt=q.attempt+1,lease_token_hash=$1,
              leased_at=now(),lease_expires_at=now()+($2::integer*interval '1 millisecond'),
              last_error_code='',completed_at=null,updated_at=now()
         from candidate c where q.job_id=c.job_id
       returning q.job_id,q.replica_id,q.owner_user_id,q.attempt,q.lease_expires_at
     ) select * from leased`,
    [claimExtractionLeaseTokenHash(token), leaseMs],
  );
  const row = rows[0];
  if (!row) return null;
  return Object.freeze({
    jobId: row.job_id,
    replicaId: row.replica_id,
    ownerUserId: row.owner_user_id,
    attempt: Number(row.attempt),
    leaseExpiresAt: row.lease_expires_at,
    leaseToken: token,
  });
}

function cleanFailureCode(value) {
  return String(value || "claim_extraction_failed")
    .replace(/[^a-z0-9_.:-]/gi, "_")
    .slice(0, 120) || "claim_extraction_failed";
}

export async function deferClaimExtractionJob(db, lease, options = {}) {
  const delayMs = Math.max(30_000, Math.min(MAX_RETRY_MS, Number(options.delayMs || 5 * 60_000)));
  const failureCode = cleanFailureCode(options.failureCode);
  const waiting = options.waiting === true;
  const rows = await db(
    `update vy_replica_claim_extraction_queue
        set state=$4,next_attempt_at=now()+($3::integer*interval '1 millisecond'),
            lease_token_hash='',leased_at=null,lease_expires_at=null,
            last_error_code=$5,updated_at=now()
      where job_id=$1::uuid and lease_token_hash=$2 and state='running'
        and lease_expires_at>now()
      returning job_id,state,next_attempt_at,last_error_code`,
    [lease.jobId, claimExtractionLeaseTokenHash(lease.leaseToken), delayMs, waiting ? "waiting" : "queued", failureCode],
  );
  if (!rows[0]) throw Object.assign(new Error("lost_claim_extraction_queue_lease"), { code: "lost_claim_extraction_queue_lease" });
  return rows[0];
}

/**
 * Mark only evidence that a COMPLETE extraction run actually names as input.
 * A worker lease also settles the replica queue. Owner-triggered extraction
 * may acknowledge items, but it never clears a concurrently running worker's
 * lease.
 */
export async function acknowledgeClaimExtractionEvidence(db, input) {
  const evidenceIds = [...new Set((input?.evidenceIds || []).map(String))];
  if (!evidenceIds.length) return null;
  const leaseHash = input.leaseToken ? claimExtractionLeaseTokenHash(input.leaseToken) : "";
  const rows = await db(
    `with target as materialized (
       select q.job_id,q.replica_id,q.owner_user_id,q.state
         from vy_replica_claim_extraction_queue q
        where q.replica_id=$1::uuid and q.owner_user_id=$2::uuid
          and ($4='' or (q.job_id=$3::uuid and q.state='running'
            and q.lease_token_hash=$4 and q.lease_expires_at>now()))
     ), completed_items as (
       update vy_replica_claim_extraction_queue_item i
          set state='complete',completed_at=coalesce(i.completed_at,now())
         from target t
        where i.job_id=t.job_id and i.replica_id=t.replica_id and i.owner_user_id=t.owner_user_id
          and i.evidence_id=any($5::uuid[]) and i.state='pending'
          and exists (
            select 1 from vy_replica_claim_extraction_input x
            join vy_replica_claim_extraction r
              on r.run_id=x.run_id and r.replica_id=x.replica_id and r.owner_user_id=x.owner_user_id
             where x.evidence_id=i.evidence_id and x.replica_id=i.replica_id
               and x.owner_user_id=i.owner_user_id and r.state='complete'
          )
       returning i.job_id,i.evidence_id
     ), remaining as materialized (
       select exists (
         select 1 from vy_replica_claim_extraction_queue_item i join target t on t.job_id=i.job_id
          where i.state='pending' and not exists (
            select 1 from completed_items c
             where c.job_id=i.job_id and c.evidence_id=i.evidence_id
          )
       ) pending
     ), settled as (
       update vy_replica_claim_extraction_queue q
          set state=case when r.pending then 'queued' else 'complete' end,
              next_attempt_at=case when r.pending then now() else q.next_attempt_at end,
              lease_token_hash='',leased_at=null,lease_expires_at=null,
              last_error_code='',completed_at=case when r.pending then null else now() end,
              updated_at=now()
         from target t cross join remaining r
        where q.job_id=t.job_id and ($4<>'' or q.state<>'running')
       returning q.job_id,q.state,q.attempt,q.completed_at,
                 (select count(*)::int from completed_items) completed_items,
                 (select pending from remaining) pending
     ) select * from settled`,
    [input.replicaId, input.ownerUserId, input.jobId || null, leaseHash, evidenceIds],
  );
  if (input.leaseToken && !rows[0]) {
    throw Object.assign(new Error("lost_claim_extraction_queue_lease"), { code: "lost_claim_extraction_queue_lease" });
  }
  return rows[0] || null;
}
