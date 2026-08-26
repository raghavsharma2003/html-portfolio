import { createHash, randomBytes } from "node:crypto";
import { REPLICA_POLICY_VERSION, replicaId } from "./_replica.js";
import { canonicalJson } from "./_provenance/contracts.js";

export const ACCOUNT_ATTESTATION_SCOPES = Object.freeze([
  "capture",
  "transcription",
  "storage",
]);

export const VERIFIED_MODEL_SCOPES = Object.freeze(["training", "inference"]);
export const VERIFIED_MODEL_STATEMENT_SET = "verified-model-consent/v1";
export const VERIFIED_MODEL_ATTESTATIONS = Object.freeze([
  "private_self_replica_only",
  "authorize_biometric_voice_modeling",
  "authorize_private_training",
  "authorize_disclosed_inference",
  "understand_synthetic_disclosure_and_watermarking",
  "understand_revocation_stops_use_and_deletes_copies",
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

export function verifiedModelAttestations(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (Object.keys(input).length !== VERIFIED_MODEL_ATTESTATIONS.length ||
      VERIFIED_MODEL_ATTESTATIONS.some((key) => input[key] !== true)) {
    fail("all verified model consent statements are required", 409);
  }
  return Object.freeze(Object.fromEntries(VERIFIED_MODEL_ATTESTATIONS.map((key) => [key, true])));
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
  const canonicalPayload = {
    receipt_format: "vyakti-consent-v1",
    canonicalization: "vyakti-canonical-json/v1",
    hash_algorithm: "sha256",
    statement_set: "self-replica-enrollment-v1",
    ...payload,
  };
  return {
    hash: createHash("sha256").update(canonicalJson(canonicalPayload)).digest("hex"),
    grantedAt: at,
    metadata: {
      ...canonicalPayload,
    },
  };
}


export function makeVerifiedModelConsentReceipt({ ownerUserId, replica, scopes, attestations, basis, now = new Date(), nonce } = {}) {
  const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const payload = Object.freeze({
    receipt_format: "vyakti-consent-v1",
    canonicalization: "vyakti-canonical-json/v1",
    hash_algorithm: "sha256",
    statement_set: VERIFIED_MODEL_STATEMENT_SET,
    owner_user_id: String(ownerUserId),
    replica_id: replicaId(replica),
    scopes: [...scopes].sort(),
    method: "live_challenge",
    policy_version: REPLICA_POLICY_VERSION,
    verification_basis: {
      consent_id: String(basis?.consent_id || ""),
      receipt_hash: String(basis?.receipt_hash || ""),
      granted_at: new Date(basis?.granted_at).toISOString(),
    },
    granted_at: at,
    nonce: nonce || randomBytes(24).toString("hex"),
    attestations,
  });
  if (!/^[0-9a-f]{48}$/.test(payload.nonce)) fail("verified model consent nonce invalid", 500);
  if (!/^[0-9a-f-]{36}$/i.test(payload.verification_basis.consent_id) ||
      !/^[0-9a-f]{64}$/.test(payload.verification_basis.receipt_hash)) {
    fail("verified biometric consent basis required", 409);
  }
  return Object.freeze({
    hash: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
    grantedAt: at,
    payload,
  });
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
    receipt_hash: row.receipt_hash,
    statement_set: row.metadata?.statement_set || null,
  };
}

const CONSENT_RETURNING = `consent_id, replica_id, scope, method, policy_version,
  granted_at, expires_at, revoked_at, receipt_hash, metadata`;

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
        where replica_id = $1::uuid and owner_user_id = $2::uuid
          and subject_mode = 'self'
          and policy_version = $7
          and lifecycle not in ('revoked','purging')
     ), revoked as (
       update vy_replica_consent
          set revoked_at = coalesce(revoked_at, $6::timestamptz)
        where replica_id = $1::uuid and owner_user_id = $2::uuid
          and scope = any($3::text[]) and revoked_at is null
          and exists (select 1 from owned)
     ), granted as (
       insert into vy_replica_consent
         (replica_id, owner_user_id, scope, method, policy_version,
          receipt_hash, granted_at, expires_at, metadata)
       select owned.replica_id, $2::uuid, requested.scope, 'account_attestation',
              owned.policy_version, $4, $6::timestamptz,
              $6::timestamptz + interval '1 year', $5::jsonb
         from owned cross join unnest($3::text[]) as requested(scope)
       returning ${CONSENT_RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'consent.grant', 'consent_batch', $4,
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
      where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid
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
      where replica_id = $1::uuid and owner_user_id = $2::uuid
      order by granted_at desc limit 100`,
    [replicaId(id), ownerUserId],
  );
  return rows.map(clientConsent);
}

export async function grantVerifiedModelConsent(db, ownerUserId, id, input, options = {}) {
  const rid = replicaId(id);
  const scopes = consentScopes(input?.scopes, "verified");
  if (scopes.length !== VERIFIED_MODEL_SCOPES.length ||
      VERIFIED_MODEL_SCOPES.some((scope) => !scopes.includes(scope))) {
    fail("verified ceremony grants only training and inference together", 409);
  }
  const attestations = verifiedModelAttestations(input?.attestations);
  const basisRows = await db(
    `select c.consent_id,c.receipt_hash,c.granted_at
       from vy_replica r
       join vy_replica_consent c on c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
      where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
        and r.policy_version=$3 and r.lifecycle not in ('revoked','purging')
        and r.age_verified_at is not null and r.identity_verified_at is not null
        and r.liveness_verified_at is not null and r.identity_expires_at>now()
        and c.scope='biometric' and c.method='live_challenge'
        and c.policy_version=r.policy_version and c.revoked_at is null
        and (c.expires_at is null or c.expires_at>now())
      order by c.granted_at desc limit 1`,
    [rid, ownerUserId, REPLICA_POLICY_VERSION],
  );
  const basis = basisRows[0];
  if (!basis) fail("current verified biometric consent is required", 409);
  const receipt = makeVerifiedModelConsentReceipt({
    ownerUserId,
    replica: rid,
    scopes,
    attestations,
    basis,
    now: options.now,
    nonce: options.nonce,
  });
  const rows = await db(
    `with owned as (
       select r.replica_id,r.policy_version
         from vy_replica r
         join vy_replica_consent basis on basis.consent_id=$4::uuid
          and basis.replica_id=r.replica_id and basis.owner_user_id=r.owner_user_id
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
          and r.policy_version=$8 and r.lifecycle not in ('revoked','purging')
          and r.age_verified_at is not null and r.identity_verified_at is not null
          and r.liveness_verified_at is not null and r.identity_expires_at>now()
          and basis.scope='biometric' and basis.method='live_challenge'
          and basis.policy_version=r.policy_version and basis.receipt_hash=$5
          and basis.revoked_at is null and (basis.expires_at is null or basis.expires_at>now())
     ), revoked as (
       update vy_replica_consent set revoked_at=coalesce(revoked_at,$7::timestamptz)
        where replica_id=$1::uuid and owner_user_id=$2::uuid and scope=any($3::text[])
          and revoked_at is null and exists (select 1 from owned)
     ), granted as (
       insert into vy_replica_consent
         (replica_id,owner_user_id,scope,method,policy_version,receipt_hash,
          evidence_source_id,granted_at,expires_at,metadata)
       select owned.replica_id,$2::uuid,requested.scope,'live_challenge',owned.policy_version,$6,null,
              $7::timestamptz,$7::timestamptz + case when requested.scope='inference'
                then interval '30 days' else interval '180 days' end,$9::jsonb
         from owned cross join unnest($3::text[]) requested(scope)
       returning ${CONSENT_RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select $1::uuid,$2::uuid,'consent.verified_model_grant','consent_batch',$6,$8,'allowed',
              jsonb_build_object('scope_count',cardinality($3::text[]),'basis_consent_id',$4)
        where exists (select 1 from granted)
     ) select * from granted order by scope`,
    [rid, ownerUserId, scopes, basis.consent_id, basis.receipt_hash, receipt.hash,
      receipt.grantedAt, REPLICA_POLICY_VERSION, JSON.stringify(receipt.payload)],
  );
  if (!rows.length) fail("verified consent basis changed; verify again", 409);
  return rows.map(clientConsent);
}

export async function revokeOwnedConsent(db, ownerUserId, id, value) {
  const rid = replicaId(id);
  const scopes = consentScopes(value, "verified");
  const rows = await db(
    `with revoked as (
       update vy_replica_consent
          set revoked_at = coalesce(revoked_at, now())
        where replica_id = $1::uuid and owner_user_id = $2::uuid
          and scope = any($3::text[]) and revoked_at is null
          and exists (
            select 1 from vy_replica r where r.replica_id = $1 and r.owner_user_id = $2
          )
       returning ${CONSENT_RETURNING}
     ), paused as (
       update vy_replica set
         lifecycle = case when lifecycle in ('active','ready','calibrating') then 'paused' else 'consent_pending' end,
         updated_at = now()
       where replica_id = $1::uuid and owner_user_id = $2::uuid and exists (select 1 from revoked)
     ), sources as (
       update vy_replica_source set state = 'deleting', updated_at = now()
        where replica_id = $1::uuid and owner_user_id = $2::uuid
          and state <> 'deleting' and exists (select 1 from revoked)
          and ('storage' = any($3::text[]) or 'capture' = any($3::text[]))
     ), provider_consents as (
       update vy_replica_provider_consent set state = 'revoked',
              revoked_at = coalesce(revoked_at, now()), updated_at = now()
        where replica_id = $1::uuid and owner_user_id = $2::uuid and state <> 'revoked'
          and exists (select 1 from revoked)
          and ('storage' = any($3::text[]) or 'capture' = any($3::text[])
               or 'biometric' = any($3::text[]) or 'training' = any($3::text[]))
     ), identity_cases as (
       update vy_replica_identity_case c set state='revoked',revoked_at=coalesce(revoked_at,now()),
              lease_token_hash='',leased_at=null,lease_expires_at=null,updated_at=now()
        where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.state<>'revoked'
          and exists (select 1 from revoked)
          and ('storage'=any($3::text[]) or 'capture'=any($3::text[]) or 'biometric'=any($3::text[]))
       returning c.identity_case_id,c.source_id
     ), identity_sources as (
       update vy_replica_source s set state='deleting',updated_at=now()
        where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
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
        where g.replica_id=$1::uuid and g.owner_user_id=$2::uuid and g.state='active'
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
        where replica_id = $1::uuid and status in ('proposed','approved')
          and exists (select 1 from revoked)
          and ('storage' = any($3::text[]) or 'capture' = any($3::text[]))
     ), genomes as (
       update vy_replica_voice_genome set status = 'retired'
        where replica_id = $1::uuid and status <> 'retired' and exists (select 1 from revoked)
          and ('storage' = any($3::text[]) or 'capture' = any($3::text[])
               or 'biometric' = any($3::text[]) or 'training' = any($3::text[]))
     ), profiles as (
       update vy_replica_profile set status = 'retired'
        where replica_id = $1::uuid and status <> 'retired' and exists (select 1 from revoked)
          and ('storage' = any($3::text[]) or 'capture' = any($3::text[])
               or 'training' = any($3::text[]))
     ), voices as (
       update vy_replica_voice_profile set status = 'deleting', updated_at = now()
        where replica_id = $1::uuid and status <> 'deleting'
          and exists (select 1 from revoked)
          and ('storage' = any($3::text[]) or 'biometric' = any($3::text[])
               or 'training' = any($3::text[]) or 'inference' = any($3::text[]))
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'consent.revoke', 'consent_batch', $4, 'allowed',
              jsonb_build_object('scope_count', cardinality($3::text[]))
        where exists (select 1 from revoked)
     )
     select * from revoked order by scope`,
    [rid, ownerUserId, scopes, REPLICA_POLICY_VERSION],
  );
  return rows.map(clientConsent);
}
