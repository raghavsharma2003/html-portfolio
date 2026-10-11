import { createHash, randomBytes, randomUUID } from "node:crypto";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";

export const IDENTITY_EVIDENCE_POLICY = Object.freeze({
  version: "vyakti-identity-evidence/v1",
  statementSet: "identity-proofing-consent/v1",
  minimumAge: 18,
  extractionConfidenceMin: 0.95,
  authenticityScoreMin: 0.98,
  portraitConfidenceMin: 0.95,
  maxAttemptsPerDay: 3,
});

const REQUIRED_ATTESTATIONS = Object.freeze([
  "is_my_government_id",
  "document_contains_only_me",
  "identity_and_age_verification_only",
  "no_model_training",
  "erase_after_verification",
]);
const SAFE_RESULT_KEYS = new Set([
  "policy_version", "provider_family", "verifier_version", "input_sha256",
  "provider_accepted", "extraction_confidence", "authenticity_score", "portrait_confidence",
  "document_authentic", "document_current", "adult_evidence", "face_reference_ready",
  "credential_expires_at", "evidence_digest", "passed",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

function boundedScore(value, code) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1) fail(code, 503);
  return Math.round(score * 1_000_000) / 1_000_000;
}

function exactAttestations(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (Object.keys(input).length !== REQUIRED_ATTESTATIONS.length ||
      !REQUIRED_ATTESTATIONS.every((key) => input[key] === true)) {
    fail("identity_attestations_required", 400);
  }
  return Object.freeze(Object.fromEntries(REQUIRED_ATTESTATIONS.map((key) => [key, true])));
}

function isoDate(value, code) {
  const raw = String(value || "");
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime()) || date.toISOString() !== raw) fail(code, 503);
  return date.toISOString();
}

function isContentFree(result) {
  return result && typeof result === "object" && !Array.isArray(result) &&
    Object.keys(result).length === SAFE_RESULT_KEYS.size &&
    Object.keys(result).every((key) => SAFE_RESULT_KEYS.has(key)) &&
    !/"(?:name|date_of_birth|document_number|address|transcript|portrait_image|embedding|media_url|provider_ref)"\s*:/i
      .test(JSON.stringify(result));
}

export function identityLeaseHash(token) {
  if (typeof token !== "string" || token.length < 32) fail("strong_identity_lease_token_required", 500);
  return createHash("sha256").update(`replica-identity-lease:v1:${token}`).digest("hex");
}

function consentReceipt(ownerUserId, rid, sourceId, options = {}) {
  const consentedAt = options.now instanceof Date
    ? options.now.toISOString()
    : new Date(options.now || Date.now()).toISOString();
  const nonce = String(options.nonce || randomBytes(24).toString("hex"));
  if (!/^[0-9a-f]{48}$/.test(nonce)) fail("identity_consent_nonce_invalid", 500);
  const payload = {
    receipt_format: "vyakti-consent-v1",
    statement_set: IDENTITY_EVIDENCE_POLICY.statementSet,
    owner_user_id: ownerUserId,
    replica_id: rid,
    source_id: sourceId,
    policy_version: REPLICA_POLICY_VERSION,
    consented_at: consentedAt,
    nonce,
  };
  return Object.freeze({
    hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    consentedAt,
  });
}

export function clientIdentityCase(row) {
  if (!row) return null;
  return {
    identity_case_id: row.identity_case_id,
    replica_id: row.replica_id,
    source_id: row.source_id,
    state: row.state,
    attempt: Number(row.attempt),
    adult_evidence: Boolean(row.adult_evidence),
    document_authentic: Boolean(row.document_authentic),
    document_current: Boolean(row.document_current),
    face_reference_ready: Boolean(row.face_reference_ready),
    credential_expires_at: row.credential_expires_at || null,
    failure_code: row.failure_code || "",
    consented_at: row.consented_at,
    verified_at: row.verified_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const RETURNING = `identity_case_id,replica_id,owner_user_id,source_id,policy_version,state,attempt,
  source_sha256,adult_evidence,document_authentic,document_current,face_reference_ready,
  credential_expires_at,failure_code,consented_at,verified_at,revoked_at,created_at,updated_at`;

export async function submitOwnedIdentityCase(db, ownerUserId, id, value, options = {}) {
  const rid = replicaId(id);
  const sourceId = replicaId(value?.source_id);
  exactAttestations(value?.attestations);
  const caseId = options.identityCaseId || randomUUID();
  if (!UUID.test(caseId)) fail("identity_case_id_invalid", 500);
  const receipt = consentReceipt(ownerUserId, rid, sourceId, options);
  const rows = await db(
    `with owned as (
       select r.replica_id,r.policy_version,r.subject_person_id,s.source_id,s.sha256
         from vy_replica r join vy_replica_source s on s.replica_id=r.replica_id
          and s.owner_user_id=r.owner_user_id
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
          and r.lifecycle not in ('revoked','purging') and s.source_id=$3::uuid
          and s.state='quarantined' and s.capture_mode='identity_document'
          and s.kind in ('image','document') and s.mime in ('image/jpeg','image/png','application/pdf')
          and s.contains_third_parties=false
          and not exists (
            select 1 from unnest(array['capture','storage']::text[]) required(scope)
             where not exists (
               select 1 from vy_replica_consent c where c.replica_id=r.replica_id
                and c.owner_user_id=r.owner_user_id and c.scope=required.scope
                and c.policy_version=r.policy_version and c.revoked_at is null
                and (c.expires_at is null or c.expires_at>now())
             )
          )
     ), attempts as (
       select count(*)::integer n from vy_replica_identity_case
        where replica_id=$1::uuid and owner_user_id=$2::uuid and created_at>now()-interval '24 hours'
     ), inserted as (
       insert into vy_replica_identity_case
         (identity_case_id,replica_id,owner_user_id,source_id,policy_version,
          consent_receipt_hash,source_sha256,consented_at)
       select $4::uuid,owned.replica_id,$2::uuid,owned.source_id,owned.policy_version,$5,owned.sha256,$6::timestamptz
         from owned cross join attempts where attempts.n<$7 and not exists (
           select 1 from vy_replica_identity_case c where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid
             and c.state in ('submitted','verifying','evidence_ready','verified')
         )
       returning ${RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'identity.case.submit','identity_case',identity_case_id::text,
              policy_version,'allowed',jsonb_build_object('statement_set',$8::text,'source_kind','government_id')
         from inserted
     ) select * from inserted`,
    [rid, ownerUserId, sourceId, caseId, receipt.hash, receipt.consentedAt,
      IDENTITY_EVIDENCE_POLICY.maxAttemptsPerDay, IDENTITY_EVIDENCE_POLICY.statementSet],
  );
  return clientIdentityCase(rows[0]);
}

export async function latestOwnedIdentityCase(db, ownerUserId, id) {
  const rows = await db(
    `select ${RETURNING} from vy_replica_identity_case
      where replica_id=$1::uuid and owner_user_id=$2::uuid order by created_at desc limit 1`,
    [replicaId(id), ownerUserId],
  );
  return clientIdentityCase(rows[0]);
}

export function createIdentityEvidenceVerdict(claim, raw, options = {}) {
  const providerFamily = String(raw?.providerFamily || "").trim();
  const verifierVersion = String(raw?.verifierVersion || "").trim();
  const inputSha256 = String(raw?.inputSha256 || "").trim().toLowerCase();
  if (providerFamily !== claim.verifierName || verifierVersion !== claim.verifierVersion)
    fail("identity_verifier_binding_mismatch", 503);
  if (!SHA256.test(inputSha256) || inputSha256 !== claim.source.sha256)
    fail("identity_input_hash_mismatch", 503);
  const extractionConfidence = boundedScore(raw?.extractionConfidence, "identity_extraction_score_invalid");
  const authenticityScore = boundedScore(raw?.authenticityScore, "identity_authenticity_score_invalid");
  const portraitConfidence = boundedScore(raw?.portraitConfidence, "identity_portrait_score_invalid");
  const credentialExpiresAt = isoDate(raw?.credentialExpiresAt, "identity_credential_expiry_invalid");
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const providerAccepted = raw?.providerAccepted === true;
  const documentAuthentic = raw?.documentAuthentic === true &&
    authenticityScore >= IDENTITY_EVIDENCE_POLICY.authenticityScoreMin;
  const documentCurrent = raw?.documentCurrent === true && new Date(credentialExpiresAt).getTime() > now.getTime();
  const adultEvidence = raw?.adultEvidence === true;
  const faceReferenceReady = raw?.faceReferenceReady === true &&
    portraitConfidence >= IDENTITY_EVIDENCE_POLICY.portraitConfidenceMin;
  const passed = providerAccepted &&
    extractionConfidence >= IDENTITY_EVIDENCE_POLICY.extractionConfidenceMin &&
    documentAuthentic && documentCurrent && adultEvidence && faceReferenceReady;
  const failureCode = passed ? "" :
    !providerAccepted ? "identity_provider_rejected" :
    extractionConfidence < IDENTITY_EVIDENCE_POLICY.extractionConfidenceMin ? "identity_extraction_low_confidence" :
    !documentAuthentic ? "identity_document_authenticity_failed" :
    !documentCurrent ? "identity_document_expired" :
    !adultEvidence ? "adult_age_not_verified" :
    "identity_face_reference_unavailable";
  const digestPayload = {
    policy_version: IDENTITY_EVIDENCE_POLICY.version,
    provider_family: providerFamily,
    verifier_version: verifierVersion,
    input_sha256: inputSha256,
    extraction_confidence: extractionConfidence,
    authenticity_score: authenticityScore,
    portrait_confidence: portraitConfidence,
    document_authentic: documentAuthentic,
    document_current: documentCurrent,
    adult_evidence: adultEvidence,
    face_reference_ready: faceReferenceReady,
    credential_expires_at: credentialExpiresAt,
  };
  const evidenceDigest = createHash("sha256").update(JSON.stringify(digestPayload)).digest("hex");
  const result = Object.freeze({
    ...digestPayload,
    provider_accepted: providerAccepted,
    evidence_digest: evidenceDigest,
    passed,
  });
  if (!isContentFree(result)) fail("identity_result_contains_sensitive_data", 500);
  return Object.freeze({ passed, failureCode, result });
}

export async function leaseNextIdentityCase(db, verifier, options = {}) {
  if (typeof db !== "function") fail("identity_database_required", 500);
  const provider = String(verifier?.name || "").trim();
  const version = String(verifier?.version || "").trim();
  if (!provider || !version || typeof verifier?.verify !== "function") fail("identity_verifier_required", 503);
  const leaseToken = options.leaseToken || randomBytes(32).toString("hex");
  const leaseMs = Math.max(30_000, Math.min(300_000, Number(options.leaseMs || 180_000)));
  const rows = await db(
    `with candidate as (
       select c.identity_case_id,c.replica_id,c.owner_user_id,c.attempt
         from vy_replica_identity_case c
         join vy_replica r on r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id
         join vy_replica_source s on s.source_id=c.source_id and s.replica_id=c.replica_id
          and s.owner_user_id=c.owner_user_id
        where ((c.state='submitted' and c.next_attempt_at<=now()) or
               (c.state='verifying' and (c.lease_expires_at is null or c.lease_expires_at<=now())))
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and s.state='quarantined' and s.sha256=c.source_sha256
          and s.capture_mode='identity_document' and s.kind in ('image','document')
          and s.contains_third_parties=false
        order by c.next_attempt_at,c.created_at limit 1 for update of c skip locked
     ), expired as (
       update vy_replica_identity_verification_attempt a
          set outcome='retry',failure_code='lease_expired',finished_at=now()
         from candidate c where a.identity_case_id=c.identity_case_id and a.attempt=c.attempt
          and a.outcome='running'
     ), leased as (
       update vy_replica_identity_case c set state='verifying',attempt=c.attempt+1,
              verifier=$2,verifier_version=$3,lease_token_hash=$1,leased_at=now(),
              lease_expires_at=now()+($4::integer*interval '1 millisecond'),updated_at=now()
         from candidate x where c.identity_case_id=x.identity_case_id
       returning c.*
     ), attempted as (
       insert into vy_replica_identity_verification_attempt
         (identity_case_id,replica_id,owner_user_id,attempt,verifier,verifier_version,outcome)
       select identity_case_id,replica_id,owner_user_id,attempt,$2,$3,'running' from leased
     ) select l.*,s.kind,s.mime,s.byte_size,s.sha256,s.storage_bucket,s.object_path
         from leased l join vy_replica_source s on s.source_id=l.source_id
          and s.replica_id=l.replica_id and s.owner_user_id=l.owner_user_id`,
    [identityLeaseHash(leaseToken), provider, version, leaseMs],
  );
  const row = rows[0];
  if (!row) return null;
  return Object.freeze({
    leaseToken,
    identityCaseId: row.identity_case_id,
    replicaId: row.replica_id,
    ownerUserId: row.owner_user_id,
    sourceId: row.source_id,
    attempt: Number(row.attempt),
    verifierName: provider,
    verifierVersion: version,
    source: Object.freeze({
      kind: row.kind,
      mime: row.mime,
      byteSize: Number(row.byte_size),
      sha256: row.sha256,
      storageBucket: row.storage_bucket,
      objectPath: row.object_path,
    }),
  });
}

function settled(rows, code) {
  if (!rows?.[0]) fail(code, 409);
  return rows[0];
}

export async function completeIdentityCase(db, claim, verdict) {
  if (!isContentFree(verdict?.result) || verdict.result.passed !== verdict.passed)
    fail("identity_verdict_invalid", 500);
  const result = verdict.result;
  const state = verdict.passed ? "evidence_ready" : "failed";
  const rows = await db(
    `with target as (
       select c.identity_case_id,c.replica_id,c.owner_user_id,c.source_id,c.attempt
         from vy_replica_identity_case c
         join vy_replica r on r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id
         join vy_replica_source s on s.source_id=c.source_id and s.replica_id=c.replica_id
          and s.owner_user_id=c.owner_user_id
         join vy_replica_identity_verification_attempt a on a.identity_case_id=c.identity_case_id
          and a.attempt=c.attempt and a.outcome='running'
        where c.identity_case_id=$1 and c.replica_id=$2 and c.owner_user_id=$3 and c.attempt=$4
          and c.state='verifying' and c.lease_token_hash=$5 and c.lease_expires_at>now()
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and s.state='quarantined' and s.sha256=$14 and s.sha256=c.source_sha256
          and s.contains_third_parties=false and c.verifier=$15 and a.verifier=$15
          and c.verifier_version=$16 and a.verifier_version=$16
        for update of c
     ), completed as (
       update vy_replica_identity_case c set state=$6,adult_evidence=$7::bool,document_authentic=$8::bool,
              document_current=$9::bool,face_reference_ready=$10::bool,credential_expires_at=$11::timestamptz,
              evidence_digest=$12,result=$13::jsonb,failure_code=$17,
              verified_at=case when $6='evidence_ready' then now() else null end,
              lease_token_hash='',leased_at=null,lease_expires_at=null,updated_at=now()
         from target t where c.identity_case_id=t.identity_case_id returning c.*
     ), failed_source as (
       update vy_replica_source s set state='deleting',updated_at=now()
        from completed c where c.state='failed' and s.source_id=c.source_id
          and s.replica_id=c.replica_id and s.owner_user_id=c.owner_user_id
     ), replica as (
       update vy_replica r set age_verified_at=coalesce(age_verified_at,now()),
              identity_expires_at=$11::timestamptz,updated_at=now()
         from completed c where c.state='evidence_ready' and r.replica_id=c.replica_id
          and r.owner_user_id=c.owner_user_id returning r.subject_person_id
     ), person as (
       update vy_person p set age_tier='adult_verified'
         from replica r where p.person_id=r.subject_person_id
     ), attempted as (
       update vy_replica_identity_verification_attempt a set outcome=$6,failure_code=$17,
              result=$13::jsonb,finished_at=now()
         from completed c where a.identity_case_id=c.identity_case_id and a.attempt=c.attempt
          and a.outcome='running'
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'identity.case.verify','identity_case',identity_case_id::text,
              $18,case when state='evidence_ready' then 'allowed' else 'denied' end,
              jsonb_build_object('reason_code',$17,'evidence_policy',$18) from completed
     ) select identity_case_id,state from completed`,
    [claim.identityCaseId, claim.replicaId, claim.ownerUserId, claim.attempt,
      identityLeaseHash(claim.leaseToken), state, result.adult_evidence,
      result.document_authentic, result.document_current, result.face_reference_ready,
      result.credential_expires_at, result.evidence_digest, JSON.stringify(result), result.input_sha256,
      result.provider_family, result.verifier_version, verdict.failureCode, IDENTITY_EVIDENCE_POLICY.version],
  );
  return settled(rows, "identity_verification_settlement_failed");
}

export async function retryIdentityCase(db, claim, input = {}) {
  const retryAfterMs = Math.max(30_000, Math.min(MAX_RETRY_MS, Number(input.retryAfterMs || 30_000)));
  const code = String(input.failureCode || input.error?.code || "identity_verifier_unavailable")
    .toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 80) || "identity_verifier_unavailable";
  const rows = await db(
    `with retried as (
       update vy_replica_identity_case c set state='submitted',failure_code=$7,
              next_attempt_at=now()+($6::integer*interval '1 millisecond'),lease_token_hash='',
              leased_at=null,lease_expires_at=null,updated_at=now()
        where c.identity_case_id=$1::uuid and c.replica_id=$2::uuid and c.owner_user_id=$3::uuid and c.attempt=$4::int4
          and c.state='verifying' and c.lease_token_hash=$5 and c.lease_expires_at>now()
       returning c.identity_case_id,c.attempt
     ), attempted as (
       update vy_replica_identity_verification_attempt a set outcome='retry',failure_code=$7,finished_at=now()
        from retried r where a.identity_case_id=r.identity_case_id and a.attempt=r.attempt
          and a.outcome='running'
     ) select identity_case_id from retried`,
    [claim.identityCaseId, claim.replicaId, claim.ownerUserId, claim.attempt,
      identityLeaseHash(claim.leaseToken), retryAfterMs, code],
  );
  return settled(rows, "identity_verification_lease_lost");
}

export async function revokeOwnedIdentityCase(db, ownerUserId, id, identityCaseId) {
  const rows = await db(
    `with revoked as (
       update vy_replica_identity_case c set state='revoked',revoked_at=coalesce(revoked_at,now()),
              lease_token_hash='',leased_at=null,lease_expires_at=null,updated_at=now()
        where c.identity_case_id=$3 and c.replica_id=$1::uuid and c.owner_user_id=$2::uuid
          and c.state<>'revoked' returning c.*
     ), challenges as (
       update vy_replica_liveness_challenge ch set state='failed',failure_code='identity_evidence_revoked',
              face_session_state=case
                when ch.face_session_handle<>'' and ch.face_session_state not in
                  ('passed_deleted','failed_deleted','expired_deleted') then 'expired_deleting'
                else ch.face_session_state end,
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        from revoked c where ch.identity_case_id=c.identity_case_id
          and ch.state in ('issued','uploaded','verifying')
       returning ch.challenge_id,ch.verification_attempt
     ), liveness_attempts as (
       update vy_replica_liveness_verification_attempt a set outcome='failed',
              failure_code='identity_evidence_revoked',finished_at=now()
        from challenges ch where a.challenge_id=ch.challenge_id
          and a.attempt=ch.verification_attempt and a.outcome='running'
     ), verification_grants as (
       update vy_replica_biometric_verification_grant g set state='revoked',revoked_at=now()
        where g.state='active' and exists (
          select 1 from vy_replica_liveness_challenge ch join revoked c on c.identity_case_id=ch.identity_case_id
           where g.challenge_id=ch.challenge_id and g.replica_id=ch.replica_id and g.owner_user_id=ch.owner_user_id
        )
     ), challenge_sources as (
       update vy_replica_source s set state='deleting',updated_at=now()
        from vy_replica_liveness_challenge ch join revoked c on c.identity_case_id=ch.identity_case_id
        where s.source_id=ch.source_id and s.replica_id=ch.replica_id and s.owner_user_id=ch.owner_user_id
          and s.state<>'deleting'
     ), source as (
       update vy_replica_source s set state='deleting',updated_at=now()
        from revoked c where s.source_id=c.source_id and s.replica_id=c.replica_id
          and s.owner_user_id=c.owner_user_id
     ), replica as (
       update vy_replica r set age_verified_at=null,identity_verified_at=null,liveness_verified_at=null,
              identity_expires_at=null,
              lifecycle=case when lifecycle in ('revoked','purging') then lifecycle else 'enrolling' end,
              updated_at=now() from revoked c where r.replica_id=c.replica_id
          and r.owner_user_id=c.owner_user_id returning r.subject_person_id
     ), person as (
       update vy_person p set age_tier='unverified'
        from replica r where p.person_id=r.subject_person_id
     ), capabilities as (
       update vy_replica_runtime_capability c set state='revoked',revoked_at=coalesce(revoked_at,now())
        where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.state in ('active','paused')
          and exists (select 1 from replica)
     ), sessions as (
       update vy_replica_runtime_session s set state='revoked',ended_at=coalesce(ended_at,now()),updated_at=now()
        where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.state='active'
          and exists (select 1 from replica)
     ), generations as (
       update vy_replica_generation g set state='aborted',failure_code='identity_evidence_revoked',updated_at=now()
        where g.replica_id=$1::uuid and g.owner_user_id=$2::uuid and g.state in ('authorized','streaming')
          and exists (select 1 from replica)
     ), consent as (
       update vy_replica_consent c set revoked_at=coalesce(revoked_at,now())
        where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.scope='biometric' and c.revoked_at is null
          and exists (select 1 from replica)
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'identity.case.revoke','identity_case',identity_case_id::text,
              policy_version,'allowed',jsonb_build_object('source_erasure_queued',true) from revoked
     ) select ${RETURNING} from revoked`,
    [replicaId(id), ownerUserId, replicaId(identityCaseId)],
  );
  return clientIdentityCase(rows[0]);
}

export function identityRetryDelayMs(attempt) {
  const safe = Math.max(1, Math.min(30, Number(attempt) || 1));
  return Math.min(MAX_RETRY_MS, 30_000 * (2 ** (safe - 1)));
}

export async function expireIdentityEvidence(db) {
  const rows = await db(
    `with credential_expired as (
       update vy_replica_identity_case c set state='expired',failure_code='identity_document_expired',
              lease_token_hash='',leased_at=null,lease_expires_at=null,updated_at=now()
        where c.state in ('evidence_ready','verified') and c.credential_expires_at<=now()
       returning c.identity_case_id,c.replica_id,c.owner_user_id,c.source_id
     ), stale as (
       update vy_replica_identity_case c set state='expired',failure_code='identity_case_expired',
              lease_token_hash='',leased_at=null,lease_expires_at=null,updated_at=now()
        where c.state in ('submitted','verifying','evidence_ready','failed')
          and c.created_at<=now()-interval '24 hours'
          and not (c.state='evidence_ready' and c.credential_expires_at<=now())
       returning c.identity_case_id,c.replica_id,c.owner_user_id,c.source_id
     ), expired as (
       select * from credential_expired union all select * from stale
     ), attempts as (
       update vy_replica_identity_verification_attempt a
          set outcome='failed',failure_code='identity_case_expired',finished_at=now()
        where a.outcome='running' and a.identity_case_id in (select identity_case_id from stale)
     ), challenges as (
       update vy_replica_liveness_challenge ch set state='failed',failure_code='identity_document_expired',
              face_session_state=case
                when ch.face_session_handle<>'' and ch.face_session_state not in
                  ('passed_deleted','failed_deleted','expired_deleted') then 'expired_deleting'
                else ch.face_session_state end,
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
         where ch.identity_case_id in (select identity_case_id from expired)
           and ch.state in ('issued','uploaded','verifying')
        returning ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.source_id,ch.verification_attempt
     ), liveness_attempts as (
       update vy_replica_liveness_verification_attempt a set outcome='failed',
              failure_code='identity_document_expired',finished_at=now()
        from challenges ch where a.challenge_id=ch.challenge_id
          and a.attempt=ch.verification_attempt and a.outcome='running'
     ), verification_grants as (
       update vy_replica_biometric_verification_grant g set state='expired'
        from challenges ch where g.challenge_id=ch.challenge_id and g.replica_id=ch.replica_id
          and g.owner_user_id=ch.owner_user_id and g.state='active'
     ), challenge_sources as (
       update vy_replica_source s set state='deleting',updated_at=now()
        from challenges ch where ch.source_id is not null and s.source_id=ch.source_id
          and s.replica_id=ch.replica_id and s.owner_user_id=ch.owner_user_id
          and s.state in ('pending_upload','quarantined','rejected')
     ), source as (
       update vy_replica_source s set state='deleting',updated_at=now()
        where s.source_id in (select source_id from expired where source_id is not null)
     ), replica as (
       update vy_replica r set age_verified_at=null,identity_verified_at=null,liveness_verified_at=null,
              identity_expires_at=null,
              lifecycle=case when lifecycle in ('revoked','purging') then lifecycle else 'paused' end,
              updated_at=now()
        where exists (select 1 from expired c where c.replica_id=r.replica_id
          and c.owner_user_id=r.owner_user_id)
       returning r.replica_id,r.owner_user_id,r.subject_person_id
     ), capabilities as (
       update vy_replica_runtime_capability c set state='revoked',revoked_at=coalesce(revoked_at,now())
        where exists (select 1 from replica r where r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id)
          and c.state in ('active','paused')
     ), sessions as (
       update vy_replica_runtime_session s set state='revoked',ended_at=coalesce(ended_at,now()),updated_at=now()
        where exists (select 1 from replica r where r.replica_id=s.replica_id and r.owner_user_id=s.owner_user_id)
          and s.state='active'
     ), generations as (
       update vy_replica_generation g set state='aborted',failure_code='identity_document_expired',updated_at=now()
        where exists (select 1 from replica r where r.replica_id=g.replica_id and r.owner_user_id=g.owner_user_id)
          and g.state in ('authorized','streaming')
     ), consent as (
       update vy_replica_consent c set revoked_at=coalesce(revoked_at,now())
        where exists (select 1 from replica r where r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id)
          and c.scope='biometric' and c.revoked_at is null
     ), person as (
       update vy_person p set age_tier='unverified'
        where exists (select 1 from replica r where r.subject_person_id=p.person_id)
     ) select count(*)::integer expired_count from expired`,
  );
  return Number(rows?.[0]?.expired_count || 0);
}

export async function runIdentityVerificationSweep(options = {}) {
  const { db, verifier } = options;
  if (typeof db !== "function" || !verifier) fail("identity_worker_configuration_required", 500);
  const lease = options.lease || leaseNextIdentityCase;
  const complete = options.complete || completeIdentityCase;
  const retry = options.retry || retryIdentityCase;
  const expire = options.expire || expireIdentityEvidence;
  const maxJobs = Math.max(1, Math.min(4, Number(options.maxJobs || 2)));
  const summary = { expired: await expire(db), leased: 0, evidence_ready: 0, failed: 0, retried: 0, discarded: 0 };
  while (summary.leased < maxJobs) {
    const claim = await lease(db, verifier);
    if (!claim) break;
    summary.leased += 1;
    try {
      const raw = await verifier.verify(claim);
      const verdict = createIdentityEvidenceVerdict(claim, raw);
      await complete(db, claim, verdict);
      if (verdict.passed) summary.evidence_ready += 1;
      else summary.failed += 1;
    } catch (error) {
      try {
        await retry(db, claim, { error, retryAfterMs: identityRetryDelayMs(claim.attempt) });
        summary.retried += 1;
      } catch (retryError) {
        if (retryError?.code !== "identity_verification_lease_lost") throw retryError;
        summary.discarded += 1;
      }
    }
  }
  return Object.freeze(summary);
}
