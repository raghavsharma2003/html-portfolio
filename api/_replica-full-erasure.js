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
      // WS-AB. The Context Locker is its own CLASS on the receipt, not a
      // detail of one: it is the only place this platform stores the person's
      // OWN DOCUMENTS in full — a CV, a chat export, an article they saved —
      // and a deletion receipt that did not name them would understate what
      // was held. Additive; the eval asserts membership, never the exact list.
      "owner_context_locker",
      // 058. Named as its own class rather than folded into replica_feedback:
      // a Mirror Call holds the owner's own transcript and the habits mined
      // from it, and a deletion receipt that could not say those were included
      // would be answering a narrower question than the one asked.
      "mirror_call_sessions",
      // 060 (WS-AF). The activity trail is its own class for the same reason
      // the two above are: it is a dated record of what this person handed us
      // and when, video titles included, and a receipt that did not name it
      // would understate what was held.
      "owner_activity_trail",
      // 074 (WS-R4). The review queue is its own class on the same test the
      // three above pass: it holds questions asked of this person's AI, what it
      // answered, and the sentences the person said must never be spoken in
      // their name. A receipt that did not name them would understate what was
      // held. Additive; the eval asserts membership, never the exact list.
      "owner_review_queue",
      // 075 (WS-R5). The interview is its own class and not a detail of
      // `mirror_call_sessions`, because what it holds is different in kind: a
      // Mirror Call transcript is the person talking, an interview answer is
      // the person ANSWERING A QUESTION ABOUT THEMSELVES that this platform
      // chose to ask. A receipt that folded the second into the first would be
      // answering a narrower question than the one asked.
      "owner_interview_answers",
      // 078 (WS-R11). The Room's money is its own class rather than folded
      // into anything above: a price, a subscription reference and a ledger
      // of what moved are a different kind of record than a memory or a
      // consent grant, and a receipt that did not name them would understate
      // what was held. Additive; the eval asserts membership, never the exact
      // list. 098 (WS-R36) folded the provider's own fund account reference
      // into this SAME class rather than a new one - it is a detail of the
      // Room's money, not a different kind of record.
      "owner_room_payments",
      // 079 (WS-R16). Check-in designs, follower schedules and the delivery
      // ledger are their own class rather than folded into `agent_relational_memory`:
      // a schedule and a delivery date are records of a standing arrangement
      // between this AI and a named follower, distinct in kind from a fact or
      // a memory, and a receipt that did not name them would understate what
      // was held. Additive; the eval asserts membership, never the exact list.
      "owner_room_checkins",
      // 080 (WS-R17). Pulse's own class: a follower's opt-in toggle, the
      // creator's topic labels, and the content-free weekly counts derived
      // from both. None of the three is a memory or a payment, so folding
      // them into either existing class would answer a narrower question
      // than the one asked. Additive; the eval asserts membership, never the
      // exact list. 097 (WS-R35) added two more tables to this SAME class
      // (a k-anonymous week header and its combo buckets) rather than a new
      // class of its own - same reasoning, one migration later.
      "owner_room_pulse",
      // 083 (WS-R20). Handoff's own class: a follower's verbatim ask and the
      // creator's verbatim reply to it are a different kind of record than
      // any of the above - the one Room table that deliberately holds
      // words at all (083's own header names the exception) - and a
      // receipt that did not name it would understate what was held.
      // Additive; the eval asserts membership, never the exact list.
      "owner_room_handoff",
      // 091 (WS-R28). A Suite membership is its own class rather than folded
      // into anything above: it names an organisation this owner belonged to
      // and the role they held in it, a different kind of record than a
      // memory, a payment or a schedule, and a receipt that did not name it
      // would understate what was held. The Suite row itself (`vy_org`)
      // deliberately outlives this erasure - see migration 091's header -
      // so this class names only the MEMBERSHIP, never the organisation.
      "owner_org_membership",
      // 095 (WS-R33). A creator's own tier subscription is its own class
      // rather than folded into `owner_room_payments`: it is a record of
      // what the OWNER pays the platform for capacity, distinct in kind
      // from `owner_room_payments`'s record of what FOLLOWERS pay a Room -
      // one is money going out, the other money coming in - and a receipt
      // that did not name it separately would answer a narrower question
      // than the one asked. Additive; the eval asserts membership, never
      // the exact list.
      "owner_creator_tier_subscription",
      // 104 (WS-R42). The creator-tier charge ledger (vy_creator_charge_event)
      // is billing HISTORY for the SAME subscription the class immediately
      // above already names - folded in rather than minting a new class,
      // owner_room_pulse's own "a combo-bucket folds into the header's own
      // class" precedent restated. Deleted by name, see the delete's own
      // comment where it is scoped.
      // 099 (WS-R37). A follower's own renewal-reminder history on this
      // owner's Rooms (`owner_room_payments`'s own reach, one table over)
      // and this owner's own creator-tier reminder history
      // (`owner_creator_tier_subscription`'s own reach, one table over) are
      // named as their own class rather than folded into either: the
      // reminder ledger is a distinct KIND of record from a payment or a
      // subscription state - when this creator's AI reminded someone, and
      // on which channel - and a receipt that did not name it would
      // understate what was held. Additive; the eval asserts membership,
      // never the exact list.
      "owner_room_renewal_reminders",
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
        -- FOR UPDATE OF j,r, never a bare FOR UPDATE: vy_agent is joined LEFT
        -- (a replica may legitimately have no agent yet), and Postgres refuses
        -- FOR UPDATE on the nullable side of an outer join outright — 0A000,
        -- "FOR UPDATE cannot be applied to the nullable side of an outer join",
        -- at PARSE time, so a bare FOR UPDATE here can never execute at all.
        -- The erasure guarantee needs the JOB and the REPLICA rows pinned for
        -- the duration of the purge; "a" is read only for the slug/selfReplica
        -- binding check and is itself deleted by "removed_agent" below, which
        -- takes its own row lock. Locking it here buys nothing.
        for update of j,r
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
     -- WS-R. Step 5 of docs/REPLICA-ERASURE.md says "all remaining
     -- replica-local rows … through database cascades". Walking the LIVE FK
     -- graph found four owner-keyed tables that "delete from vy_replica" does
     -- NOT reach: vy_replica_audit (named above) and these three. 053 and 055
     -- declare replica_id/owner_user_id FK-SHAPED BUT NOT FK on purpose, so
     -- there is no cascade to inherit and the rows simply outlived the replica
     -- — a channel binding, a watched source channel and its ingest runs,
     -- still naming the owner, after the deletion receipt said the replica was
     -- gone. Deleted here rather than given an FK because the erasure job is
     -- the documented owner of ordering, and a new FK would change the
     -- delete-time behaviour of every other path that touches these tables.
     ingest_runs as (delete from vy_ingest_run x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     channel_watches as (delete from vy_channel_watch x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     clone_channels as (delete from vy_clone_channel x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 057's attestation. Added the same day the table was created, because
     -- relcheck's owner-lane reach walk failed the build the moment it
     -- existed: it carries owner_user_id and a channel_url the owner named,
     -- and neither cascade nor manifest covered it. An attestation outliving
     -- the replica is a standing record that this person authorised cloning a
     -- channel — exactly the claim revocation is meant to end.
     channel_attestations as (delete from vy_channel_attestation x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 058's Context Locker (WS-AB). Same shape, same reason, and the text
     -- table is the sharper case: vy_context_item_text holds the OWNER'S OWN
     -- DOCUMENTS in full — a CV, a chat export, whatever they uploaded about
     -- themselves — so a row of it outliving the replica is the person's own
     -- writing standing in this database after the deletion receipt said the
     -- replica was gone. CHILD FIRST, as the runtime chain above is ordered:
     -- the text row is deleted before the item row that names it, so nothing
     -- can strand a body whose item is already gone.
     context_item_texts as (delete from vy_context_item_text x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     context_items as (delete from vy_context_item x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 060's single-video enrollment (WS-AD). FK-SHAPED, NOT FK, same
     -- convention as 053/055/057 above — so there is no cascade to inherit and
     -- these rows would simply outlive the replica. What they hold makes that
     -- unacceptable twice over: the enrollment row names a real YouTube video
     -- the person attested owning, and the window rows are a ranked, timestamped
     -- map of the ten seconds of their own teaching voice this platform judged
     -- best to clone from. CHILD FIRST — the windows name an enrollment, so
     -- nothing can strand a ranking whose enrollment is already gone.
     video_enrollment_windows as (delete from vy_video_enrollment_window x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     video_enrollments as (delete from vy_video_enrollment x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 059's Mirror Call. These five DO cascade from vy_replica (each carries a
     -- composite FK to (replica_id, owner_user_id) ON DELETE CASCADE), so
     -- relcheck's owner-lane reach walk is satisfied without a line here. They
     -- are deleted by name ANYWAY, in this order, for one reason: the erasure
     -- job is the documented owner of ordering, and a Mirror Call row is the
     -- most intimate thing in this lane — a transcript of the person talking to
     -- their own clone, plus the phrase habits mined out of it. Relying on a
     -- cascade for that means relying on an FK nobody re-checks; the day
     -- someone drops the composite constraint to add a column, the rows would
     -- outlive the receipt that said they were gone and NOTHING would report
     -- it. Two independent layers for a harm the next turn does not undo — the
     -- house rule api/_teachersheet.js states in full.
     --
     -- The order is the FK order: the conditioning selection points at a
     -- window, so it goes first.
     mirror_conditioning as (delete from vy_mirror_conditioning x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     mirror_finetune as (delete from vy_mirror_finetune_job x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     mirror_deltas as (delete from vy_mirror_delta x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     mirror_feedback as (delete from vy_mirror_feedback x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- The clone's own turns (migration 060). Ahead of the windows because a
     -- turn points at the window it answered, and on this list at all for the
     -- reason the block above gives: a Mirror Call turn is the clone of a real
     -- person saying words in that person's cloned voice, and relying on a
     -- cascade for it means relying on an FK nobody re-checks.
     mirror_turns as (delete from vy_mirror_turn x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 075's interview (WS-R5). AHEAD of the mirror windows and sessions
     -- because an interview session cascades from vy_mirror_session and an
     -- answer points at a vy_mirror_window: deleting the parents first would
     -- leave these two to a cascade, and the whole point of naming a table here
     -- is not to rely on one. Same 059 argument, and it applies harder: an
     -- interview answer is the ONLY material in this archive where the person
     -- was answering a question about themselves rather than delivering a
     -- lecture, which is exactly the material a deletion receipt is about.
     -- CHILD FIRST — the answer names the session.
     interview_answers as (delete from vy_interview_answer x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     interview_sessions as (delete from vy_interview_session x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     mirror_windows as (delete from vy_mirror_window x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     mirror_sessions as (delete from vy_mirror_session x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 060's activity trail (WS-AF). It carries a composite FK to
     -- (replica_id, owner_user_id) ON DELETE CASCADE, so relcheck's owner-lane
     -- reach walk is satisfied without this line. It is deleted by name anyway,
     -- on 059's precedent and for 059's reason: this table is a dated record of
     -- what a named person handed us and when, including the titles of their own
     -- videos, and relying on a cascade for that means relying on an FK nobody
     -- re-checks. Two independent layers for a harm the next turn does not undo.
     activity as (delete from vy_replica_activity x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 072's voice identity challenge (WS-R2). FK-SHAPED, NOT FK, the same
     -- 009 convention as 053/055/057/058/061 above, so there is no cascade to
     -- inherit and these rows would simply outlive the replica.
     -- scripts/relcheck.mjs's owner-lane reach walk fails the build without
     -- these two lines, which is how they got here. What they hold is the
     -- reason it matters: a challenge row is a dated, numeric verdict on
     -- whether a named person's own voice matched their own recording, and an
     -- attempt row is every time that judgement was made about them. That is
     -- a biometric conclusion about a human being, and it outliving the
     -- deletion receipt would be exactly the standing claim revocation is
     -- meant to end. CHILD FIRST: the attempt names a challenge.
     voice_challenge_attempts as (delete from vy_replica_voice_challenge_attempt x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     voice_challenges as (delete from vy_replica_voice_challenge x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 074's review queue (WS-R4). FK-SHAPED, NOT FK, same convention as
     -- 053/055/057/058/061 above, so there is no cascade to inherit and these
     -- rows would simply outlive the replica. scripts/relcheck.mjs's owner-lane
     -- reach walk fails the build for exactly that, which is why they are here.
     -- What they hold makes it unacceptable independently of the gate: a card
     -- is a question somebody asked this person's AI together with what it
     -- answered, and a never-rule is a standing record of a sentence a named
     -- person did not want said in their name. Both outliving the deletion
     -- receipt is the receipt being false.
     --
     -- CHILD FIRST, as the chains above are ordered: a never-rule names the
     -- card it came from, so nothing can strand a rule whose card is gone.
     review_never_rules as (delete from vy_review_never_rule x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     review_cards as (delete from vy_review_card x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 073's readiness snapshots (WS-R3). Unlike the activity trail above this
     -- one carries NO foreign key at all (009's convention for owner-keyed
     -- tables), so this line is not a second layer, it is the only layer, and
     -- scripts/relcheck.mjs's owner-lane reach walk fails the build without it.
     -- It is also a table worth deleting on its own merits: a readiness history
     -- is a dated record of how well we thought we had learned a named person,
     -- which is exactly the kind of row an erasure that skipped it would leave
     -- behind while reporting success.
     readiness as (delete from vy_replica_readiness x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 088's funnel marks (WS-R25). Same shape as readiness immediately
     -- above and for the same reason: NO foreign key (009's convention),
     -- so this line is not a second layer, it is the only layer, and
     -- scripts/relcheck.mjs's owner-lane reach walk fails the build without
     -- it. Content-free (a step name and a timestamp, never a message), but
     -- still a dated record of what a named person did and when, which is
     -- exactly what an erasure that skipped it would leave behind.
     funnel_marks as (delete from vy_replica_funnel_mark x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 076's drift watch history (WS-R9). Unlike the activity trail above,
     -- and like 073's readiness snapshot immediately above, this table
     -- carries NO foreign key at all (009's convention for owner-keyed
     -- tables), so this line is not a second layer, it is the only layer, and
     -- scripts/relcheck.mjs's owner-lane reach walk fails the build without
     -- it. It is a table worth deleting on its own merits too: a drift report
     -- is a dated record of how closely we thought a named person's clone
     -- still sounded like them, plus the exact commitment hashes of every
     -- voice-model swap that clone lived through, and an erasure that left it
     -- behind would leave exactly the kind of record consent revocation is
     -- meant to end.
     drift_reports as (delete from vy_replica_drift_report x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 071's Room (WS-R1). vy_room carries owner_user_id with no person
     -- column, so relcheck's owner-lane reach walk requires it by name here:
     -- 071 declares replica_id/owner_user_id FK-SHAPED BUT NOT FK on 009's
     -- convention, so there is no cascade to inherit and the room would simply
     -- outlive the replica. What that means concretely is a public address at
     -- /r/<slug> still resolving after the creator revoked the AI it points at.
     --
     -- CHILD FIRST, as every block above is ordered. The two child tables DO
     -- carry room_id references vy_room(room_id) on delete cascade, so the
     -- room delete alone would take them; they are deleted by name anyway, on
     -- 059's precedent and for 059's reason -- relying on a cascade means
     -- relying on an FK nobody re-checks, and the day someone drops it to add a
     -- column these rows outlive the receipt and NOTHING reports it. Keyed on
     -- agent_id rather than room_id because that is the binding the target CTE
     -- already holds, and because it reaches a follower row whose room was
     -- deleted out of order by any future path.
     room_threads as (delete from vy_room_thread x using target t
       where x.agent_id=t.agent_id),
     room_followers as (delete from vy_room_follower x using target t
       where x.agent_id=t.agent_id),
     -- 078 (WS-R11), the Room's money. All four are reached from THIS side by
     -- room_id, never by agent_id: none of them carries an agent binding, and
     -- a room has exactly one agent (vy_room_replica_ix), so the join through
     -- vy_room is exact rather than approximate. Ledger and payout FIRST,
     -- subscription SECOND, room LAST - child before parent, 071's own
     -- ordering restated: vy_payment_event.subscription_id and
     -- vy_room_subscription.room_id both carry real FK CASCADE from this
     -- point down, so these three deletes are a backstop rather than the only
     -- mechanism - "relying on a cascade means relying on an FK nobody
     -- re-checks" (071's own words, one migration over).
     --
     -- vy_creator_payout is the one exception: it has no room_id (a payout is
     -- a roll-up across every room an owner has), so it is scoped by
     -- owner_user_id alone - the imprecision migration 078's own header names
     -- and context/decisions.md logs with its reversal condition.
     payment_events as (delete from vy_payment_event x using target t
       where x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id)),
     room_subscriptions as (delete from vy_room_subscription x using target t
       where x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id)),
     room_prices as (delete from vy_room_price x using target t
       where x.owner_user_id=t.owner_user_id
         and x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id)),
     creator_payouts as (delete from vy_creator_payout x using target t
       where x.owner_user_id=t.owner_user_id),
     -- 098 (WS-R36). The provider's own fund account reference - never a
     -- bank detail, see that migration's own header. Same owner-wide scope
     -- as vy_creator_payout immediately above and the same reasoning: no
     -- column on this table can express a narrower one without changing
     -- what it means (one row per owner+provider, not per replica).
     creator_payout_accounts as (delete from vy_creator_payout_account x using target t
       where x.owner_user_id=t.owner_user_id),
     -- 095 (WS-R33), the creator's own tier subscription. Owner lane, NOT
     -- person lane (this migration's own header restates the argument):
     -- it is a record of what the OWNER pays the platform for capacity, not
     -- a relationship with any person, so it is deleted BY NAME here rather
     -- than through api/memory.js's PERSON_TABLES manifest. Scoped by BOTH
     -- replica_id and owner_user_id directly - unlike vy_creator_payout two
     -- lines up, this table carries its own replica_id column, so it is
     -- exact rather than the owner-wide imprecision that table's own header
     -- names: erasing one replica erases only that replica's own tier
     -- subscription, never a sibling replica's.
     -- 104 (WS-R42). The creator-tier charge ledger. Deleted CHILD-BEFORE-
     -- PARENT, ahead of creator_subscriptions immediately below, even though
     -- the FK on subscription_id would cascade it anyway - "relying on a
     -- cascade means relying on an FK nobody re-checks" (071's own words,
     -- restated for the Nth time). Scoped by BOTH replica_id and
     -- owner_user_id directly, creator_subscriptions' own precedent one line
     -- down: exact, not the owner-wide imprecision vy_creator_payout carries.
     creator_charge_events as (delete from vy_creator_charge_event x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     creator_subscriptions as (delete from vy_creator_subscription x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 099 (WS-R37), the renewal reminder ledger. TWO lanes reached from
     -- THIS side, in the SAME statement, vy_payment_event_one_lane's own
     -- mutually-exclusive-columns shape restated for a delete predicate: the
     -- FOLLOWER lane by room_id via the same vy_room subquery
     -- payment_events/room_subscriptions use three lines up (a reminder
     -- carries no agent binding), and the CREATOR lane by replica_id +
     -- owner_user_id, creator_subscriptions' own scoping one line up. The
     -- Suite lane (subject_kind='org') is deliberately UNREACHED here,
     -- vy_org_subscription's own 091 precedent restated: a Suite's own
     -- reminder history survives an owner's erasure exactly as the Suite
     -- itself does. Carries real FK CASCADE from both vy_room and the
     -- follower roster table for the follower lane, so this delete is a
     -- backstop to that cascade rather than the only mechanism - 071's own
     -- words, restated here for the Nth time.
     renewal_reminders as (delete from vy_renewal_reminder x using target t
       where (x.subject_kind='follower' and x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id))
          or (x.subject_kind='creator' and x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id)),
     -- 086 (WS-R23), creator invites. vy_creator_invite has no room_id and no
     -- replica_id of its own - an invite is redeemed once, before any room
     -- exists, so it is scoped by owner_user_id alone, creator_payouts' own
     -- reasoning one line up. redeemed_by_user_id IS the owner's id once a
     -- code is spent, which is what makes this table OWNER lane rather than
     -- person lane (086's own migration header, restated in
     -- scripts/relcheck.mjs's widened PERSON_COLUMNS): the row is reached
     -- HERE, by name, never through api/memory.js's PERSON_TABLES manifest,
     -- and never through vy_creator_application's operator-only
     -- eraseApplicationsByContact, which is a different table on a different
     -- (pre-signup) lane entirely. An invite this owner never redeemed is
     -- untouched, on purpose: it still belongs to whoever issued it and may
     -- yet be redeemed by someone else.
     creator_invites as (delete from vy_creator_invite x using target t
       where x.redeemed_by_user_id=t.owner_user_id),
     -- 079 (WS-R16), check-ins. All three are reached from THIS side by
     -- room_id, payment_events's own reasoning three lines up: none of them
     -- carries an agent binding, and a room has exactly one agent
     -- (vy_room_replica_ix), so the join through vy_room is exact. Delivery
     -- ledger FIRST, schedule SECOND, design THIRD - child before parent, the
     -- ordering every block above restates. All three also carry real FK
     -- CASCADE from this point down (room_id references vy_room, checkin_id
     -- references vy_room_checkin, design_id/follower_id reference their own
     -- parents), so these three deletes are a backstop rather than the only
     -- mechanism - "relying on a cascade means relying on an FK nobody
     -- re-checks" (071's own words, restated at 078 and here for the third
     -- time).
     checkin_deliveries as (delete from vy_room_checkin_delivery x using target t
       where x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id)),
     checkins as (delete from vy_room_checkin x using target t
       where x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id)),
     checkin_designs as (delete from vy_room_checkin_design x using target t
       where x.owner_user_id=t.owner_user_id
         and x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id)),
     -- 080 (WS-R17), Pulse. All three reached by room_id via the same
     -- subquery the payment_events/room_subscriptions CTEs use two blocks
     -- up, for the identical reason: none of the three carries an agent
     -- binding.
     -- Snapshot and topic FIRST (topic_id cascades from vy_room_pulse_topic,
     -- so deleting topics after snapshots would be backwards for the same
     -- child-before-parent reason 071's own header states), optin with them
     -- since none of the three has a dependency on either of the other two.
     -- All three also carry real FK CASCADE from vy_room, so these deletes
     -- are the backstop 071's words describe rather than the only mechanism.
     pulse_snapshots as (delete from vy_room_pulse_snapshot x using target t
       where x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id)),
     pulse_topics as (delete from vy_room_pulse_topic x using target t
       where x.owner_user_id=t.owner_user_id
         and x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id)),
     pulse_optins as (delete from vy_room_pulse_optin x using target t
       where x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id)),
     -- 097 (WS-R35), Pulse v1. Same room_id-via-vy_room reasoning as the
     -- three blocks just above, one migration later: neither table carries
     -- an agent binding. Combo FIRST (it carries a real FK to the week
     -- header, ON DELETE CASCADE, so deleting the header first would work
     -- too, but child-before-parent is 071's own stated convention and this
     -- delete is a backstop to that cascade either way, not the only
     -- mechanism).
     pulse_v1_combos as (delete from vy_room_pulse_combo x using target t
       where x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id)),
     pulse_v1_weeks as (delete from vy_room_pulse_week x using target t
       where x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id)),
     -- 083 (WS-R20), Handoff. Reached by room_id, the payment_events/
     -- checkins/pulse blocks' own reasoning restated a fourth time: this
     -- table carries no agent binding, and a room has exactly one agent
     -- (vy_room_replica_ix), so the join through vy_room is exact. Carries a
     -- real FK CASCADE from vy_room, so this delete is a backstop rather
     -- than the only mechanism - "relying on a cascade means relying on an
     -- FK nobody re-checks," 071's own words, restated a fourth time.
     handoffs as (delete from vy_room_handoff x using target t
       where x.room_id in (select r2.room_id from vy_room r2
                             where r2.replica_id=t.replica_id and r2.owner_user_id=t.owner_user_id)),
     rooms as (delete from vy_room x using target t
       where x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id),
     -- 091 (WS-R28), Suites v0. Reached by owner_user_id ALONE, creator_
     -- payouts' own reasoning three blocks up restated a second time: a
     -- Suite membership is not this ONE replica's, it is this OWNER's, so it
     -- is out of scope for the replica-keyed joins every block above uses
     -- and is scoped the same imprecise way vy_creator_payout already is
     -- (migration 078's own header, migration 091's own header, both log the
     -- same tradeoff in context/decisions.md: an owner erasing ONE of
     -- several replicas also clears their Suite memberships everywhere).
     -- vy_org itself is deliberately NOT deleted here and carries no
     -- owner_user_id column for exactly that reason - see migration 091's
     -- header: an org survives its last admin's own erasure, on purpose, so
     -- a roster's shared address is never taken down by one person's wipe.
     org_memberships as (delete from vy_org_member x using target t
       where x.owner_user_id=t.owner_user_id),
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
