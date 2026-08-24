import { createHash, randomBytes } from "node:crypto";
import { REPLICA_POLICY_VERSION, replicaId } from "./_replica.js";

export const ACCOUNT_ATTESTATION_SCOPES = Object.freeze([
  "capture",
  "transcription",
  "storage",
]);

const ALL_SCOPES = new Set([
  ...ACCOUNT_ATTESTATION_SCOPES,
  "biometric",
  "training",
  "inference",
  "sharing",
  "api",
  "telephony",
  "model_improvement",
]);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

export function consentScopes(value, method = "account_attestation") {
  if (!Array.isArray(value) || value.length < 1 || value.length > ALL_SCOPES.size) {
    fail("scopes must be a non-empty array");
  }
  const scopes = [...new Set(value.map((scope) => String(scope || "").trim()))].sort();
  if (scopes.some((scope) => !ALL_SCOPES.has(scope))) fail("unsupported consent scope");
  if (method === "account_attestation") {
    const allowed = new Set(ACCOUNT_ATTESTATION_SCOPES);
    if (scopes.some((scope) => !allowed.has(scope))) {
      fail("live verification is required for this consent scope", 409);
    }
  }
  return scopes;
}

export function accountAttestations(value) {
  const input = value && typeof value === "object" ? value : {};
  const required = ["is_self", "is_adult", "has_source_rights", "understands_synthetic_disclosure"];
  if (required.some((key) => input[key] !== true)) fail("all self-replica attestations are required", 409);
  return Object.fromEntries(required.map((key) => [key, true]));
}

export function makeConsentReceipt({ ownerUserId, replica, scopes, method, attestations, now = new Date(), nonce } = {}) {
  const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const payload = {
    owner_user_id: String(ownerUserId),
    replica_id: replicaId(replica),
    scopes: [...scopes].sort(),
    method,
    policy_version: REPLICA_POLICY_VERSION,
    granted_at: at,
    nonce: nonce || randomBytes(24).toString("hex"),
    attestations,
  };
  const canonical = JSON.stringify(payload);
  return {
    hash: createHash("sha256").update(canonical).digest("hex"),
    grantedAt: at,
    metadata: {
      receipt_format: "vyakti-consent-v1",
      statement_set: "self-replica-enrollment-v1",
      attestations,
    },
  };
}

export function clientConsent(row) {
  return {
    consent_id: row.consent_id,
    replica_id: row.replica_id,
    scope: row.scope,
    method: row.method,
    policy_version: row.policy_version,
    granted_at: row.granted_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
  };
}

const CONSENT_RETURNING = `consent_id, replica_id, scope, method, policy_version,
  granted_at, expires_at, revoked_at`;

export async function grantAccountConsent(db, ownerUserId, id, input, options = {}) {
  const rid = replicaId(id);
  const scopes = consentScopes(input?.scopes, "account_attestation");
  const attestations = accountAttestations(input?.attestations);
  const receipt = makeConsentReceipt({
    ownerUserId,
    replica: rid,
    scopes,
    method: "account_attestation",
    attestations,
    now: options.now,
    nonce: options.nonce,
  });
  const rows = await db(
    `with owned as (
       select replica_id, policy_version from vy_replica
        where replica_id = $1 and owner_user_id = $2
          and subject_mode = 'self'
          and policy_version = $7
          and lifecycle not in ('revoked','purging')
     ), revoked as (
       update vy_replica_consent
          set revoked_at = coalesce(revoked_at, $6::timestamptz)
        where replica_id = $1 and owner_user_id = $2
          and scope = any($3::text[]) and revoked_at is null
          and exists (select 1 from owned)
     ), granted as (
       insert into vy_replica_consent
         (replica_id, owner_user_id, scope, method, policy_version,
          receipt_hash, granted_at, expires_at, metadata)
       select owned.replica_id, $2, requested.scope, 'account_attestation',
              owned.policy_version, $4, $6::timestamptz,
              $6::timestamptz + interval '1 year', $5::jsonb
         from owned cross join unnest($3::text[]) as requested(scope)
       returning ${CONSENT_RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1, $2, 'consent.grant', 'consent_batch', $4,
              $7, 'allowed', jsonb_build_object('scope_count', cardinality($3::text[]))
        where exists (select 1 from granted)
     )
     select * from granted order by scope`,
    [rid, ownerUserId, scopes, receipt.hash, JSON.stringify(receipt.metadata), receipt.grantedAt, REPLICA_POLICY_VERSION],
  );
  if (!rows.length) return [];

  // This repairable state transition is deliberately separate from the
  // append-only receipt statement. A crash can leave the replica in
  // consent_pending, but it cannot create consent without a receipt; the next
  // grant/list operation can safely advance it again.
  await db(
    `update vy_replica r set lifecycle = 'enrolling', updated_at = now()
      where r.replica_id = $1 and r.owner_user_id = $2
        and r.lifecycle in ('draft','consent_pending')
        and not exists (
          select 1 from unnest(array['capture','storage']::text[]) required(scope)
           where not exists (
             select 1 from vy_replica_consent c
              where c.replica_id = r.replica_id and c.owner_user_id = r.owner_user_id
                and c.scope = required.scope and c.policy_version = r.policy_version
                and c.revoked_at is null and (c.expires_at is null or c.expires_at > now())
           )
        )`,
    [rid, ownerUserId],
  );
  return rows.map(clientConsent);
}

export async function listOwnedConsent(db, ownerUserId, id) {
  const rows = await db(
    `select ${CONSENT_RETURNING} from vy_replica_consent
      where replica_id = $1 and owner_user_id = $2
      order by granted_at desc limit 100`,
    [replicaId(id), ownerUserId],
  );
  return rows.map(clientConsent);
}

export async function revokeOwnedConsent(db, ownerUserId, id, value) {
  const rid = replicaId(id);
  const scopes = consentScopes(value, "verified");
  const rows = await db(
    `with revoked as (
       update vy_replica_consent
          set revoked_at = coalesce(revoked_at, now())
        where replica_id = $1 and owner_user_id = $2
          and scope = any($3::text[]) and revoked_at is null
          and exists (
            select 1 from vy_replica r where r.replica_id = $1 and r.owner_user_id = $2
          )
       returning ${CONSENT_RETURNING}
     ), paused as (
       update vy_replica set
         lifecycle = case when lifecycle in ('active','ready','calibrating') then 'paused' else 'consent_pending' end,
         updated_at = now()
       where replica_id = $1 and owner_user_id = $2 and exists (select 1 from revoked)
     ), sources as (
       update vy_replica_source set state = 'deleting', updated_at = now()
        where replica_id = $1 and owner_user_id = $2
          and state <> 'deleting' and exists (select 1 from revoked)
          and ('storage' = any($3::text[]) or 'capture' = any($3::text[]))
     ), provider_consents as (
       update vy_replica_provider_consent set state = 'revoked',
              revoked_at = coalesce(revoked_at, now()), updated_at = now()
        where replica_id = $1 and owner_user_id = $2 and state <> 'revoked'
          and exists (select 1 from revoked)
          and ('storage' = any($3::text[]) or 'capture' = any($3::text[])
               or 'biometric' = any($3::text[]) or 'training' = any($3::text[]))
     ), identity_cases as (
       update vy_replica_identity_case c set state='revoked',revoked_at=coalesce(revoked_at,now()),
              lease_token_hash='',leased_at=null,lease_expires_at=null,updated_at=now()
        where c.replica_id=$1 and c.owner_user_id=$2 and c.state<>'revoked'
          and exists (select 1 from revoked)
          and ('storage'=any($3::text[]) or 'capture'=any($3::text[]) or 'biometric'=any($3::text[]))
       returning c.identity_case_id,c.source_id
     ), identity_sources as (
       update vy_replica_source s set state='deleting',updated_at=now()
        where s.replica_id=$1 and s.owner_user_id=$2
          and (s.source_id in (select source_id from identity_cases) or s.source_id in (
            select ch.source_id from vy_replica_liveness_challenge ch
             where ch.identity_case_id in (select identity_case_id from identity_cases)
          ))
     ), identity_challenges as (
       update vy_replica_liveness_challenge ch set state='failed',failure_code='identity_consent_revoked',
              face_session_state=case
                when ch.face_session_handle<>'' and ch.face_session_state not in
                  ('passed_deleted','failed_deleted','expired_deleted') then 'expired_deleting'
                else ch.face_session_state end,
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        where ch.identity_case_id in (select identity_case_id from identity_cases)
          and ch.state in ('issued','uploaded','verifying')
       returning ch.challenge_id,ch.verification_attempt
     ), liveness_attempts as (
       update vy_replica_liveness_verification_attempt a set outcome='failed',
              failure_code='identity_consent_revoked',finished_at=now()
        from identity_challenges ch where a.challenge_id=ch.challenge_id
          and a.attempt=ch.verification_attempt and a.outcome='running'
     ), biometric_verification_grants as (
       update vy_replica_biometric_verification_grant g set state='revoked',revoked_at=now()
        where g.replica_id=$1 and g.owner_user_id=$2 and g.state='active'
          and exists (select 1 from revoked)
          and ('storage'=any($3::text[]) or 'capture'=any($3::text[]) or 'biometric'=any($3::text[]))
     ), identity_replica as (
       update vy_replica r set age_verified_at=null,identity_verified_at=null,liveness_verified_at=null,
              identity_expires_at=null,updated_at=now() where r.replica_id=$1 and r.owner_user_id=$2
          and exists (select 1 from identity_cases)
       returning r.subject_person_id
     ), identity_person as (
       update vy_person p set age_tier='unverified'
        where exists (select 1 from identity_replica r where r.subject_person_id=p.person_id)
     ), claims as (
       update vy_replica_claim set status = 'superseded', updated_at = now()
        where replica_id = $1 and status in ('proposed','approved')
          and exists (select 1 from revoked)
          and ('storage' = any($3::text[]) or 'capture' = any($3::text[]))
     ), genomes as (
       update vy_replica_voice_genome set status = 'retired'
        where replica_id = $1 and status <> 'retired' and exists (select 1 from revoked)
          and ('storage' = any($3::text[]) or 'capture' = any($3::text[])
               or 'biometric' = any($3::text[]) or 'training' = any($3::text[]))
     ), profiles as (
       update vy_replica_profile set status = 'retired'
        where replica_id = $1 and status <> 'retired' and exists (select 1 from revoked)
          and ('storage' = any($3::text[]) or 'capture' = any($3::text[])
               or 'training' = any($3::text[]))
     ), voices as (
       update vy_replica_voice_profile set status = 'deleting', updated_at = now()
        where replica_id = $1 and status <> 'deleting'
          and exists (select 1 from revoked)
          and ('storage' = any($3::text[]) or 'biometric' = any($3::text[])
               or 'training' = any($3::text[]) or 'inference' = any($3::text[]))
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, policy, outcome, facts)
       select $1, $2, 'consent.revoke', 'consent_batch', $4, 'allowed',
              jsonb_build_object('scope_count', cardinality($3::text[]))
        where exists (select 1 from revoked)
     )
     select * from revoked order by scope`,
    [rid, ownerUserId, scopes, REPLICA_POLICY_VERSION],
  );
  return rows.map(clientConsent);
}
