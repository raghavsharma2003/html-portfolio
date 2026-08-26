import { createHash, randomBytes } from "node:crypto";
import { REPLICA_POLICY_VERSION } from "./_replica.js";
import { canonicalJson } from "./_provenance/contracts.js";

export const LIVENESS_VERIFICATION_POLICY = Object.freeze({
  version: "vyakti-liveness-composite/v2",
  phraseSimilarityMin: 0.9,
  faceIdentityMin: 0.9,
  speakerContinuityMin: 0.85,
  syntheticRiskMax: 0.02,
  biometricConsentDays: 90,
});

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;
const SAFE_RESULT_KEYS = new Set([
  "policy_version", "provider_family", "verifier_version", "input_sha256", "phrase_hash",
  "phrase_similarity", "random_code_match", "official_face_liveness_passed",
  "official_face_identity_match", "official_face_identity_score", "official_face_model_version",
  "official_face_provider_digest", "official_face_reference_sha256",
  "speaker_continuity_score", "synthetic_risk_score", "single_speaker", "capture_binding", "passed",
]);

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

function finiteScore(value, code) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1) fail(code, 503);
  return Math.round(score * 1_000_000) / 1_000_000;
}

function normalizedSpeech(value) {
  const input = String(value || "").normalize("NFKC").toLocaleLowerCase("en-IN");
  if (!input || input.length > 2_000) fail("liveness_transcript_invalid", 503);
  return input
    .replace(/(?<=\p{N})[\s,._-]+(?=\p{N})/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function tokenF1(reference, recognized) {
  const expected = reference.split(" ");
  const actual = recognized.split(" ");
  const available = new Map();
  for (const token of actual) available.set(token, (available.get(token) || 0) + 1);
  let matched = 0;
  for (const token of expected) {
    const count = available.get(token) || 0;
    if (count > 0) {
      matched += 1;
      available.set(token, count - 1);
    }
  }
  const precision = matched / Math.max(1, actual.length);
  const recall = matched / Math.max(1, expected.length);
  return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
}

export function scoreLivenessPhrase(phrase, recognizedText) {
  const reference = normalizedSpeech(phrase);
  const recognized = normalizedSpeech(recognizedText);
  const expectedCode = reference.match(/(?:^|\s)(\d{6})(?:\s|$)/)?.[1] || "";
  if (!expectedCode) fail("liveness_phrase_code_missing", 500);
  const randomCodeMatch = recognized.includes(expectedCode);
  const characterSimilarity = 1 - levenshtein(reference, recognized) / Math.max(reference.length, recognized.length, 1);
  const similarity = Math.max(0, Math.min(1, 0.55 * tokenF1(reference, recognized) + 0.45 * characterSimilarity));
  return Object.freeze({
    similarity: Math.round(similarity * 1_000_000) / 1_000_000,
    randomCodeMatch,
  });
}

export function livenessVerificationLeaseHash(token) {
  if (typeof token !== "string" || token.length < 32) fail("strong_liveness_lease_token_required", 500);
  return createHash("sha256").update(`replica-liveness-lease:v1:${token}`).digest("hex");
}

function resultIsContentFree(result) {
  return result && typeof result === "object" && !Array.isArray(result) &&
    Object.keys(result).every((key) => SAFE_RESULT_KEYS.has(key)) &&
    !/"(?:transcript|embedding|provider_ref|media_url|recognized_text)"\s*:/i.test(JSON.stringify(result));
}

export function createLivenessVerdict(challenge, source, raw) {
  const expectedProvider = String(challenge?.verifierName || "").trim();
  const expectedVersion = String(challenge?.verifierVersion || "").trim();
  const providerFamily = String(raw?.providerFamily || expectedProvider).trim();
  const verifierVersion = String(raw?.verifierVersion || expectedVersion).trim();
  const inputSha256 = String(raw?.inputSha256 || "").trim().toLowerCase();
  const sourceSha256 = String(source?.sha256 || "").trim().toLowerCase();
  const phraseHash = createHash("sha256").update(String(challenge?.phrase || "")).digest("hex");
  if (!providerFamily || providerFamily.length > 64 || !verifierVersion || verifierVersion.length > 96)
    fail("liveness_verifier_identity_invalid", 503);
  if ((expectedProvider && providerFamily !== expectedProvider) || (expectedVersion && verifierVersion !== expectedVersion))
    fail("liveness_verifier_binding_mismatch", 503);
  if (!SHA256.test(inputSha256) || inputSha256 !== sourceSha256) fail("liveness_input_hash_mismatch", 503);
  if (phraseHash !== String(challenge?.phraseHash || "").toLowerCase()) fail("liveness_phrase_binding_invalid", 500);
  if (source?.kind !== "video") fail("liveness_video_required", 409);

  const phrase = scoreLivenessPhrase(challenge.phrase, raw?.recognizedText);
  const official = challenge?.officialFaceProof;
  const officialReferenceSha = String(official?.referenceSha256 || "").toLowerCase();
  const officialDigest = String(official?.providerDigest || "").toLowerCase();
  const officialModel = String(official?.modelVersion || "");
  const faceLivenessPassed = official?.livenessPassed === true;
  const faceIdentityMatch = official?.identityMatch === true;
  const faceIdentityScore = finiteScore(official?.identityScore, "liveness_identity_score_invalid");
  if (!SHA256.test(officialReferenceSha) || officialReferenceSha !== challenge?.identityReference?.sha256 ||
      !SHA256.test(officialDigest) || !officialModel || official?.providerDeleted !== true) {
    fail("official_face_evidence_binding_invalid", 503);
  }
  const speakerContinuityScore = finiteScore(raw?.speakerContinuityScore, "liveness_speaker_score_invalid");
  const syntheticRiskScore = finiteScore(raw?.syntheticRiskScore, "liveness_synthetic_score_invalid");
  const captureBinding = raw?.captureBinding === true;
  const singleSpeaker = raw?.singleSpeaker === true;
  const providerAccepted = raw?.providerAccepted === true;
  const passed = providerAccepted && phrase.randomCodeMatch &&
    phrase.similarity >= LIVENESS_VERIFICATION_POLICY.phraseSimilarityMin &&
    faceLivenessPassed && faceIdentityMatch && faceIdentityScore >= LIVENESS_VERIFICATION_POLICY.faceIdentityMin &&
    speakerContinuityScore >= LIVENESS_VERIFICATION_POLICY.speakerContinuityMin &&
    syntheticRiskScore <= LIVENESS_VERIFICATION_POLICY.syntheticRiskMax && singleSpeaker && captureBinding;
  const failureCode = passed ? "" :
    !providerAccepted ? "verifier_rejected" :
    !phrase.randomCodeMatch ? "random_code_mismatch" :
    phrase.similarity < LIVENESS_VERIFICATION_POLICY.phraseSimilarityMin ? "phrase_mismatch" :
    !faceLivenessPassed ? "face_liveness_failed" :
    !faceIdentityMatch || faceIdentityScore < LIVENESS_VERIFICATION_POLICY.faceIdentityMin ? "face_identity_mismatch" :
    !singleSpeaker ? "multiple_speakers" :
    speakerContinuityScore < LIVENESS_VERIFICATION_POLICY.speakerContinuityMin ? "speaker_continuity_failed" :
    syntheticRiskScore > LIVENESS_VERIFICATION_POLICY.syntheticRiskMax ? "synthetic_media_risk" :
    "capture_binding_failed";
  const result = Object.freeze({
    policy_version: LIVENESS_VERIFICATION_POLICY.version,
    provider_family: providerFamily,
    verifier_version: verifierVersion,
    input_sha256: inputSha256,
    phrase_hash: phraseHash,
    phrase_similarity: phrase.similarity,
    random_code_match: phrase.randomCodeMatch,
    official_face_liveness_passed: faceLivenessPassed,
    official_face_identity_match: faceIdentityMatch,
    official_face_identity_score: faceIdentityScore,
    official_face_model_version: officialModel,
    official_face_provider_digest: officialDigest,
    official_face_reference_sha256: officialReferenceSha,
    speaker_continuity_score: speakerContinuityScore,
    synthetic_risk_score: syntheticRiskScore,
    single_speaker: singleSpeaker,
    capture_binding: captureBinding,
    passed,
  });
  if (!resultIsContentFree(result)) fail("liveness_result_contains_sensitive_data", 500);
  return Object.freeze({ passed, failureCode, result });
}

export async function leaseNextLivenessVerification(db, verifier, options = {}) {
  if (typeof db !== "function") fail("liveness_database_required", 500);
  const provider = String(verifier?.name || "").trim();
  const version = String(verifier?.version || "").trim();
  if (!provider || !version || typeof verifier?.verify !== "function") fail("liveness_verifier_required", 503);
  const leaseToken = options.leaseToken || randomBytes(32).toString("hex");
  const leaseMs = Math.max(30_000, Math.min(300_000, Number(options.leaseMs || 180_000)));
  const rows = await db(
    `with candidate as (
       select ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.verification_attempt
         from vy_replica_liveness_challenge ch
         join vy_replica r on r.replica_id=ch.replica_id and r.owner_user_id=ch.owner_user_id
         join vy_replica_source s on s.source_id=ch.source_id and s.replica_id=ch.replica_id
          and s.owner_user_id=ch.owner_user_id
         join vy_replica_identity_case ic on ic.identity_case_id=ch.identity_case_id
          and ic.replica_id=ch.replica_id and ic.owner_user_id=ch.owner_user_id
         join vy_replica_source ids on ids.source_id=ic.source_id and ids.replica_id=ic.replica_id
          and ids.owner_user_id=ic.owner_user_id
        where ((ch.state='uploaded' and ch.verification_next_attempt_at<=now()) or
               (ch.state='verifying' and (ch.verification_lease_expires_at is null or ch.verification_lease_expires_at<=now())))
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and r.age_verified_at is not null
          and s.state='quarantined' and s.capture_mode='live_challenge' and s.kind='video'
          and s.contains_third_parties=false
          and ic.state='evidence_ready' and ic.adult_evidence=true and ic.document_authentic=true
          and ic.document_current=true and ic.face_reference_ready=true and ic.credential_expires_at>now()
          and ids.state='quarantined' and ids.sha256=ic.source_sha256
          and ch.face_session_state='passed_deleted' and ch.face_session_provider_deleted_at is not null
          and ch.face_session_result->>'passed'='true'
          and ch.face_session_result->>'liveness_passed'='true'
          and ch.face_session_result->>'identity_match'='true'
          and ch.face_session_reference_sha256=ids.sha256
          and exists (
            select 1 from vy_replica_biometric_verification_grant g
             where g.challenge_id=ch.challenge_id and g.replica_id=ch.replica_id
               and g.owner_user_id=ch.owner_user_id and g.state='active' and g.expires_at>now()
          )
        order by ch.verification_next_attempt_at,ch.issued_at limit 1 for update of ch skip locked
     ), expired as (
       update vy_replica_liveness_verification_attempt a set outcome='retry',failure_code='lease_expired',finished_at=now()
        from candidate c where a.challenge_id=c.challenge_id and a.attempt=c.verification_attempt
          and a.outcome='running'
     ), leased as (
       update vy_replica_liveness_challenge ch set state='verifying',verifier=$2,
              verification_attempt=ch.verification_attempt+1,verification_lease_token_hash=$1,
              verification_leased_at=now(),verification_lease_expires_at=now()+($4::integer*interval '1 millisecond'),
              updated_at=now()
        from candidate c where ch.challenge_id=c.challenge_id
       returning ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.source_id,ch.phrase,ch.phrase_hash,
                 ch.identity_case_id,ch.verification_attempt,ch.verification_lease_expires_at,
                 ch.face_session_state,ch.face_session_provider_deleted_at,ch.face_session_model_version,
                 ch.face_session_reference_sha256,ch.face_session_result
     ), attempted as (
       insert into vy_replica_liveness_verification_attempt
         (challenge_id,replica_id,owner_user_id,attempt,verifier,verifier_version,outcome)
       select challenge_id,replica_id,owner_user_id,verification_attempt,$2,$3,'running' from leased
     )
     select l.*,s.kind,s.mime,s.byte_size,s.sha256,s.storage_bucket,s.object_path,
            ids.source_id identity_source_id,ids.kind identity_kind,ids.mime identity_mime,
            ids.byte_size identity_byte_size,ids.sha256 identity_sha256,
            ids.storage_bucket identity_storage_bucket,ids.object_path identity_object_path,
            l.face_session_state,l.face_session_provider_deleted_at,l.face_session_model_version,
            l.face_session_reference_sha256,l.face_session_result
       from leased l join vy_replica_source s on s.source_id=l.source_id and s.replica_id=l.replica_id
        and s.owner_user_id=l.owner_user_id
       join vy_replica_identity_case ic on ic.identity_case_id=l.identity_case_id
        and ic.replica_id=l.replica_id and ic.owner_user_id=l.owner_user_id
       join vy_replica_source ids on ids.source_id=ic.source_id and ids.replica_id=ic.replica_id
        and ids.owner_user_id=ic.owner_user_id`,
    [livenessVerificationLeaseHash(leaseToken), provider, version, leaseMs],
  );
  const row = rows[0];
  if (!row) return null;
  return Object.freeze({
    leaseToken,
    challengeId: row.challenge_id,
    replicaId: row.replica_id,
    ownerUserId: row.owner_user_id,
    sourceId: row.source_id,
    phrase: row.phrase,
    phraseHash: row.phrase_hash,
    attempt: Number(row.verification_attempt),
    verifierName: provider,
    verifierVersion: version,
    leaseExpiresAt: row.verification_lease_expires_at,
    source: Object.freeze({
      kind: row.kind,
      mime: row.mime,
      byteSize: Number(row.byte_size),
      sha256: row.sha256,
      storageBucket: row.storage_bucket,
      objectPath: row.object_path,
    }),
    identityReference: Object.freeze({
      sourceId: row.identity_source_id,
      kind: row.identity_kind,
      mime: row.identity_mime,
      byteSize: Number(row.identity_byte_size),
      sha256: row.identity_sha256,
      storageBucket: row.identity_storage_bucket,
      objectPath: row.identity_object_path,
    }),
    officialFaceProof: Object.freeze({
      livenessPassed: row.face_session_result?.liveness_passed === true,
      identityMatch: row.face_session_result?.identity_match === true,
      identityScore: Number(row.face_session_result?.identity_score),
      modelVersion: row.face_session_model_version,
      providerDigest: row.face_session_result?.provider_digest,
      referenceSha256: row.face_session_reference_sha256,
      providerDeleted: Boolean(row.face_session_provider_deleted_at),
    }),
  });
}

function requireSettlement(rows, code) {
  if (!rows?.[0]) fail(code, 409);
  return rows[0];
}

function makeLivenessConsentReceipt(lease, verdict, options = {}) {
  const grantedAt = options.now instanceof Date
    ? options.now.toISOString()
    : new Date(options.now || Date.now()).toISOString();
  const nonce = String(options.nonce || randomBytes(24).toString("hex"));
  if (!/^[0-9a-f]{48}$/.test(nonce)) fail("liveness_consent_nonce_invalid", 500);
  const statementSet = "liveness-biometric-consent/v1";
  const payload = {
    receipt_format: "vyakti-consent-v1",
    canonicalization: "vyakti-canonical-json/v1",
    hash_algorithm: "sha256",
    statement_set: statementSet,
    owner_user_id: lease.ownerUserId,
    replica_id: lease.replicaId,
    challenge_id: lease.challengeId,
    evidence_source_id: lease.sourceId,
    phrase_hash: lease.phraseHash,
    input_sha256: verdict.result.input_sha256,
    verifier_policy: LIVENESS_VERIFICATION_POLICY.version,
    scope: "biometric",
    method: "live_challenge",
    policy_version: REPLICA_POLICY_VERSION,
    granted_at: grantedAt,
    nonce,
  };
  return Object.freeze({
    hash: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
    grantedAt,
    metadata: Object.freeze(payload),
  });
}

export async function completeLivenessVerification(db, lease, verdict, options = {}) {
  if (!resultIsContentFree(verdict?.result) || verdict.result.passed !== verdict.passed)
    fail("liveness_verdict_invalid", 500);
  const consent = makeLivenessConsentReceipt(lease, verdict, options);
  const rows = await db(
    `with target as (
       select ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.source_id,ch.verification_attempt
         from vy_replica_liveness_challenge ch
         join vy_replica r on r.replica_id=ch.replica_id and r.owner_user_id=ch.owner_user_id
         join vy_replica_source s on s.source_id=ch.source_id and s.replica_id=ch.replica_id
          and s.owner_user_id=ch.owner_user_id
         join vy_replica_liveness_verification_attempt a on a.challenge_id=ch.challenge_id
          and a.attempt=ch.verification_attempt and a.outcome='running'
         join vy_replica_identity_case ic on ic.identity_case_id=ch.identity_case_id
          and ic.replica_id=ch.replica_id and ic.owner_user_id=ch.owner_user_id
         join vy_replica_source ids on ids.source_id=ic.source_id and ids.replica_id=ic.replica_id
          and ids.owner_user_id=ic.owner_user_id
        where ch.challenge_id=$1 and ch.replica_id=$2 and ch.owner_user_id=$3
          and ch.state='verifying' and ch.verification_attempt=$4
          and ch.verification_lease_token_hash=$5 and ch.verification_lease_expires_at>now()
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and r.age_verified_at is not null
          and s.state='quarantined' and s.capture_mode='live_challenge' and s.kind='video'
          and s.contains_third_parties=false and s.sha256=$16
          and ch.verifier=$17 and a.verifier=$17 and a.verifier_version=$18
          and ic.state='evidence_ready' and ic.adult_evidence=true and ic.document_authentic=true
          and ic.document_current=true and ic.face_reference_ready=true and ic.credential_expires_at>now()
          and ids.state='quarantined' and ids.sha256=ic.source_sha256 and ids.sha256=$19
          and ch.face_session_state='passed_deleted' and ch.face_session_provider_deleted_at is not null
          and ch.face_session_result->>'passed'='true' and ch.face_session_reference_sha256=ids.sha256
          and exists (
            select 1 from vy_replica_biometric_verification_grant g
             where g.challenge_id=ch.challenge_id and g.replica_id=ch.replica_id
               and g.owner_user_id=ch.owner_user_id and g.state='active' and g.expires_at>now()
          )
        for update of ch
     ), challenge as (
       update vy_replica_liveness_challenge ch set state=$6,consumed_at=now(),failure_code=$7,
              verifier_result=$8::jsonb,verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        from target t where ch.challenge_id=t.challenge_id returning ch.*
     ), source as (
       update vy_replica_source s set state='deleting',
              rejection_code=$7,provenance=provenance||$9::jsonb,updated_at=now()
        from challenge ch where s.source_id=ch.source_id and s.replica_id=ch.replica_id
          and s.owner_user_id=ch.owner_user_id returning s.source_id
     ), identity_case as (
       update vy_replica_identity_case ic set state='verified',updated_at=now()
        from challenge ch where $6='passed' and ic.identity_case_id=ch.identity_case_id
          and ic.replica_id=ch.replica_id and ic.owner_user_id=ch.owner_user_id
       returning ic.identity_case_id,ic.replica_id,ic.owner_user_id,ic.source_id,ic.credential_expires_at
     ), identity_source as (
       update vy_replica_source ids set state='deleting',updated_at=now()
        from identity_case ic where ids.source_id=ic.source_id and ids.replica_id=ic.replica_id
          and ids.owner_user_id=ic.owner_user_id
     ), verification_grant as (
       update vy_replica_biometric_verification_grant g set state='consumed',consumed_at=now()
        from challenge ch where g.challenge_id=ch.challenge_id and g.replica_id=ch.replica_id
          and g.owner_user_id=ch.owner_user_id and g.state='active'
     ), replica as (
       update vy_replica r set identity_verified_at=coalesce(identity_verified_at,now()),
              liveness_verified_at=coalesce(liveness_verified_at,now()),
              identity_expires_at=ic.credential_expires_at,updated_at=now()
        from challenge ch join identity_case ic on ic.identity_case_id=ch.identity_case_id
        where $6='passed' and r.replica_id=ch.replica_id and r.owner_user_id=ch.owner_user_id
          and r.age_verified_at is not null
       returning r.replica_id,r.owner_user_id
     ), revoked as (
       update vy_replica_consent c set revoked_at=coalesce(revoked_at,now())
        from replica r where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
          and c.scope='biometric' and c.revoked_at is null
     ), consent as (
       insert into vy_replica_consent
         (replica_id,owner_user_id,scope,method,policy_version,receipt_hash,evidence_source_id,
          granted_at,expires_at,metadata)
       select r.replica_id,r.owner_user_id,'biometric','live_challenge',$10,$11,ch.source_id,
              $12::timestamptz,$12::timestamptz+($13::integer*interval '1 day'),$14::jsonb
         from replica r join challenge ch on ch.replica_id=r.replica_id
       returning consent_id
     ), attempted as (
       update vy_replica_liveness_verification_attempt a set outcome=$6,failure_code=$7,
              result=$8::jsonb,finished_at=now()
        from challenge ch where a.challenge_id=ch.challenge_id and a.attempt=ch.verification_attempt
          and a.outcome='running'
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'liveness.verify','liveness_challenge',challenge_id::text,
              $10,case when $6='passed' then 'allowed' else 'denied' end,
              jsonb_build_object('reason_code',$7,'verifier_policy',$15::text) from challenge
     ) select challenge_id,state from challenge`,
    [lease.challengeId, lease.replicaId, lease.ownerUserId, lease.attempt,
      livenessVerificationLeaseHash(lease.leaseToken), verdict.passed ? "passed" : "failed",
      verdict.failureCode, JSON.stringify(verdict.result), JSON.stringify({
        sha256_status: "verified_by_liveness_worker",
        liveness_policy: LIVENESS_VERIFICATION_POLICY.version,
      }), REPLICA_POLICY_VERSION, consent.hash, consent.grantedAt,
      LIVENESS_VERIFICATION_POLICY.biometricConsentDays, JSON.stringify(consent.metadata),
      LIVENESS_VERIFICATION_POLICY.version, verdict.result.input_sha256,
      verdict.result.provider_family, verdict.result.verifier_version, lease.identityReference.sha256],
  );
  return requireSettlement(rows, "liveness_verification_settlement_failed");
}

export async function retryLivenessVerification(db, lease, input = {}) {
  const retryAfterMs = Math.max(30_000, Math.min(MAX_RETRY_MS, Number(input.retryAfterMs || 30_000)));
  const code = String(input.failureCode || input.error?.code || "liveness_verifier_unavailable")
    .toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 80) || "liveness_verifier_unavailable";
  const rows = await db(
    `with retried as (
       update vy_replica_liveness_challenge ch set state='uploaded',failure_code=$7,
              verification_next_attempt_at=now()+($6::integer*interval '1 millisecond'),
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        where ch.challenge_id=$1::uuid and ch.replica_id=$2::uuid and ch.owner_user_id=$3::uuid
          and ch.state='verifying' and ch.verification_attempt=$4::int4
          and ch.verification_lease_token_hash=$5 and ch.verification_lease_expires_at>now()
       returning ch.challenge_id,ch.verification_attempt
     ), attempted as (
       update vy_replica_liveness_verification_attempt a set outcome='retry',failure_code=$7,finished_at=now()
        from retried r where a.challenge_id=r.challenge_id and a.attempt=r.verification_attempt
          and a.outcome='running'
     ) select challenge_id from retried`,
    [lease.challengeId, lease.replicaId, lease.ownerUserId, lease.attempt,
      livenessVerificationLeaseHash(lease.leaseToken), retryAfterMs, code],
  );
  return requireSettlement(rows, "liveness_verification_lease_lost");
}

export function livenessRetryDelayMs(attempt) {
  const safe = Math.max(1, Math.min(30, Number(attempt) || 1));
  return Math.min(MAX_RETRY_MS, 30_000 * (2 ** (safe - 1)));
}

export async function expireLivenessEvidence(db) {
  const rows = await db(
    `with expired as (
       update vy_replica_liveness_challenge ch set state='expired',failure_code='liveness_consent_expired',
              face_session_state=case
                when ch.face_session_handle<>'' and ch.face_session_state in ('ready','polling')
                  then 'expired_deleting' else ch.face_session_state end,
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        where (
          (ch.state='issued' and ch.expires_at<=now()) or
          (ch.state='uploaded' and not exists (
            select 1 from vy_replica_biometric_verification_grant g where g.challenge_id=ch.challenge_id
              and g.replica_id=ch.replica_id and g.owner_user_id=ch.owner_user_id
              and g.state='active' and g.expires_at>now()
          )) or
          (ch.state='verifying' and ch.verification_lease_expires_at<=now() and not exists (
            select 1 from vy_replica_biometric_verification_grant g where g.challenge_id=ch.challenge_id
              and g.replica_id=ch.replica_id and g.owner_user_id=ch.owner_user_id
              and g.state='active' and g.expires_at>now()
          ))
        )
        returning ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.source_id,ch.verification_attempt
     ), grants as (
       update vy_replica_biometric_verification_grant g set state='expired'
        from expired e where g.challenge_id=e.challenge_id and g.replica_id=e.replica_id
          and g.owner_user_id=e.owner_user_id and g.state='active'
     ), sources as (
       update vy_replica_source s set state='deleting',updated_at=now()
        from expired e where e.source_id is not null and s.source_id=e.source_id
          and s.replica_id=e.replica_id and s.owner_user_id=e.owner_user_id
          and s.state in ('pending_upload','quarantined','rejected')
     ), attempts as (
       update vy_replica_liveness_verification_attempt a set outcome='failed',
              failure_code='liveness_consent_expired',finished_at=now()
        from expired e where a.challenge_id=e.challenge_id and a.attempt=e.verification_attempt
          and a.outcome='running'
     ) select count(*)::integer expired_count from expired`,
  );
  return Number(rows?.[0]?.expired_count || 0);
}

export async function runLivenessVerificationSweep(options = {}) {
  const db = options.db;
  const verifier = options.verifier;
  if (typeof db !== "function" || !verifier) fail("liveness_worker_configuration_required", 500);
  const lease = options.lease || leaseNextLivenessVerification;
  const complete = options.complete || completeLivenessVerification;
  const retry = options.retry || retryLivenessVerification;
  const expire = options.expire || expireLivenessEvidence;
  const maxJobs = Math.max(1, Math.min(4, Number(options.maxJobs || 2)));
  const summary = { expired: await expire(db), leased: 0, passed: 0, failed: 0, retried: 0, discarded: 0 };
  while (summary.leased < maxJobs) {
    const claimed = await lease(db, verifier);
    if (!claimed) break;
    summary.leased += 1;
    try {
      const raw = await verifier.verify(claimed);
      const verdict = createLivenessVerdict(claimed, claimed.source, raw);
      await complete(db, claimed, verdict);
      if (verdict.passed) summary.passed += 1;
      else summary.failed += 1;
    } catch (error) {
      try {
        await retry(db, claimed, { error, retryAfterMs: livenessRetryDelayMs(claimed.attempt) });
        summary.retried += 1;
      } catch (retryError) {
        if (retryError?.code !== "liveness_verification_lease_lost") throw retryError;
        summary.discarded += 1;
      }
    }
  }
  return Object.freeze(summary);
}
