import { randomBytes } from "node:crypto";
import { sha256Hex } from "./_replica-processing/contracts.js";
import { REPLICA_POLICY_VERSION } from "./_replica.js";
import { createVoiceEraser } from "./_voice/registry.js";

const MIN_LEASE_MS = 30_000;
const MAX_LEASE_MS = 300_000;
const DEFAULT_LEASE_MS = 90_000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;

export function voiceErasureLeaseTokenHash(token) {
  if (typeof token !== "string" || token.length < 32) throw new Error("strong voice erasure lease token required");
  return sha256Hex(`replica-voice-erasure-lease:v1:${token}`);
}

function leasedProfile(row) {
  return Object.freeze({
    voiceProfileId: row.voice_profile_id,
    replicaId: row.replica_id,
    ownerUserId: row.owner_user_id,
    provider: row.provider,
    providerRef: row.provider_ref,
    attempt: Number(row.erasure_attempts),
    leaseExpiresAt: row.erasure_lease_expires_at,
  });
}

export async function leaseNextVoiceErasure(db, options = {}) {
  const token = options.token || randomBytes(32).toString("base64url");
  const leaseMs = Math.max(MIN_LEASE_MS, Math.min(MAX_LEASE_MS, Number(options.leaseMs || DEFAULT_LEASE_MS)));
  const rows = await db(
    `with candidate as (
       select vp.voice_profile_id,vp.erasure_attempts previous_attempt,
              vp.erasure_lease_token_hash previous_lease
         from vy_replica_voice_profile vp
        where vp.status='deleting' and (
          (vp.erasure_lease_token_hash='' and vp.erasure_next_attempt_at<=now()) or
          (vp.erasure_lease_token_hash<>'' and vp.erasure_lease_expires_at<=now())
        )
        order by vp.erasure_next_attempt_at,vp.updated_at
        for update skip locked limit 1
     ), expired as (
       update vy_replica_voice_erasure_attempt a
          set outcome='retry',failure_code='lease_expired',finished_at=now()
         from candidate c
        where c.previous_lease<>'' and a.voice_profile_id=c.voice_profile_id
          and a.attempt=c.previous_attempt and a.outcome='running'
     ), leased as (
       update vy_replica_voice_profile vp
          set erasure_attempts=vp.erasure_attempts+1,erasure_lease_token_hash=$1,
              erasure_leased_at=now(),
              erasure_lease_expires_at=now()+($2::integer*interval '1 millisecond'),
              erasure_last_error_code='',updated_at=now()
         from candidate c where vp.voice_profile_id=c.voice_profile_id
       returning vp.voice_profile_id,vp.replica_id,vp.owner_user_id,vp.provider,
                 vp.provider_ref,vp.erasure_attempts,vp.erasure_lease_expires_at
     ), attempted as (
       insert into vy_replica_voice_erasure_attempt
         (voice_profile_id,replica_id,owner_user_id,attempt,outcome)
       select voice_profile_id,replica_id,owner_user_id,erasure_attempts,'running' from leased
       on conflict (voice_profile_id,attempt) do nothing
     ) select * from leased`,
    [voiceErasureLeaseTokenHash(token), leaseMs],
  );
  if (!rows[0]) return null;
  return Object.freeze({ profile: leasedProfile(rows[0]), leaseToken: token });
}

function requireSettlement(rows) {
  if (!rows[0]) throw Object.assign(new Error("voice erasure lease lost"), { code: "lost_voice_erasure_lease" });
  return true;
}

export async function completeVoiceErasure(db, lease) {
  const rows = await db(
    `with removed as (
       delete from vy_replica_voice_profile vp
        where vp.voice_profile_id=$1 and vp.replica_id=$2 and vp.owner_user_id=$3
          and vp.status='deleting' and vp.erasure_lease_token_hash=$4
          and vp.erasure_lease_expires_at>now()
       returning vp.voice_profile_id,vp.replica_id,vp.owner_user_id,vp.provider_consent_id,
                 vp.provider,vp.erasure_attempts
     ), attempted as (
       update vy_replica_voice_erasure_attempt a
          set outcome='complete',failure_code='',finished_at=now()
         from removed r where a.voice_profile_id=r.voice_profile_id
          and a.attempt=r.erasure_attempts and a.outcome='running'
     ), revoked_consent as (
       update vy_replica_provider_consent pc set state='revoked',
              revoked_at=coalesce(revoked_at,now()),updated_at=now()
         from removed r where pc.provider_consent_id=r.provider_consent_id
          and pc.replica_id=r.replica_id and pc.owner_user_id=r.owner_user_id
          and pc.state in ('uploaded','accepted')
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'voice_profile.delete.complete','voice_profile',
              voice_profile_id::text,$5,'allowed',jsonb_build_object(
                'provider',provider,'attempts',erasure_attempts,'worker','reconciler')
         from removed
     ) select voice_profile_id from removed`,
    [lease.profile.voiceProfileId, lease.profile.replicaId, lease.profile.ownerUserId,
      voiceErasureLeaseTokenHash(lease.leaseToken), REPLICA_POLICY_VERSION],
  );
  return requireSettlement(rows);
}

export async function retryVoiceErasure(db, lease, input = {}) {
  const retryAfterMs = Math.max(30_000, Math.min(MAX_RETRY_MS, Number(input.retryAfterMs || 30_000)));
  const failureCode = normalizeVoiceErasureFailure(input.error || input.failureCode);
  const rows = await db(
    `with retried as (
       update vy_replica_voice_profile vp
          set erasure_next_attempt_at=now()+($5::integer*interval '1 millisecond'),
              erasure_lease_token_hash='',erasure_leased_at=null,erasure_lease_expires_at=null,
              erasure_last_error_code=$6,failure_code=$6,updated_at=now()
        where vp.voice_profile_id=$1 and vp.replica_id=$2 and vp.owner_user_id=$3
          and vp.status='deleting' and vp.erasure_lease_token_hash=$4
          and vp.erasure_lease_expires_at>now()
       returning vp.voice_profile_id,vp.erasure_attempts
     ), attempted as (
       update vy_replica_voice_erasure_attempt a
          set outcome='retry',failure_code=$6,finished_at=now()
         from retried r where a.voice_profile_id=r.voice_profile_id
          and a.attempt=r.erasure_attempts and a.outcome='running'
     ) select voice_profile_id from retried`,
    [lease.profile.voiceProfileId, lease.profile.replicaId, lease.profile.ownerUserId,
      voiceErasureLeaseTokenHash(lease.leaseToken), retryAfterMs, failureCode],
  );
  return requireSettlement(rows);
}

export function voiceErasureRetryDelayMs(attempt) {
  const safeAttempt = Math.max(1, Math.min(30, Number(attempt) || 1));
  return Math.min(MAX_RETRY_MS, 30_000 * (2 ** (safeAttempt - 1)));
}

export function normalizeVoiceErasureFailure(error) {
  const code = String(error?.code || error || "");
  if (code.includes("unreachable") || code.includes("timeout")) return "provider_unreachable";
  if (/http_(401|403)/.test(code)) return "provider_auth_failed";
  if (code.includes("http_429")) return "provider_rate_limited";
  if (/http_4\d\d/.test(code) || code.includes("ref_invalid")) return "provider_delete_rejected";
  if (code === "voice_provider_unavailable") return "provider_adapter_unavailable";
  return "provider_delete_failed";
}

export async function runVoiceErasureSweep(options) {
  const db = options?.db;
  if (typeof db !== "function") throw new Error("voice erasure database required");
  const lease = options.lease || leaseNextVoiceErasure;
  const complete = options.complete || completeVoiceErasure;
  const retry = options.retry || retryVoiceErasure;
  const providerFactory = options.providerFactory || ((name) => createVoiceEraser(name));
  const maxJobs = Math.max(1, Math.min(8, Number(options.maxJobs || 4)));
  const timeBudgetMs = Math.max(10_000, Math.min(240_000, Number(options.timeBudgetMs || 200_000)));
  const started = Date.now();
  const summary = { leased: 0, completed: 0, retried: 0 };

  while (summary.leased < maxJobs && Date.now() - started < timeBudgetMs) {
    const claimed = await lease(db, { leaseMs: DEFAULT_LEASE_MS });
    if (!claimed) break;
    summary.leased += 1;
    try {
      const provider = providerFactory(claimed.profile.provider);
      await provider.deleteVoice(claimed.profile.providerRef);
      await complete(db, claimed);
      summary.completed += 1;
    } catch (error) {
      await retry(db, claimed, {
        error,
        retryAfterMs: voiceErasureRetryDelayMs(claimed.profile.attempt),
      });
      summary.retried += 1;
    }
  }
  return Object.freeze(summary);
}
