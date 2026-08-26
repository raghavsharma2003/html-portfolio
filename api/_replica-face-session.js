import { createHash, randomBytes } from "node:crypto";
import { clientChallenge } from "./_replica-liveness.js";
import { replicaId } from "./_replica.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MIN_FACE_IDENTITY_SCORE = 0.9;
const SAFE_FACE_RESULT_KEYS = new Set([
  "request_id", "reference_sha256", "provider_accepted", "terminal", "passed",
  "liveness_passed", "identity_match", "identity_score", "provider_digest",
  "verify_image_hash", "failure_code", "model_version",
]);

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

function leaseHash(token) {
  if (typeof token !== "string" || token.length < 32) fail("strong_face_session_lease_required", 500);
  return createHash("sha256").update(`replica-face-session-lease/v1:${token}`).digest("hex");
}

function brokerContract(broker) {
  if (!broker || typeof broker.create !== "function" || typeof broker.result !== "function" ||
      typeof broker.delete !== "function" || !String(broker.name || "") || !String(broker.version || "") ||
      !String(broker.modelVersion || "")) {
    fail("face_session_broker_required", 503);
  }
  return broker;
}

function cleanupBrokerContract(broker) {
  if (!broker || typeof broker.delete !== "function" || typeof broker.cleanup !== "function" ||
      !String(broker.name || "") || !String(broker.version || "") || !String(broker.modelVersion || "")) {
    fail("face_session_cleanup_broker_required", 503);
  }
  return broker;
}

function exactDevice(value) {
  const id = String(value || "");
  if (!UUID.test(id)) fail("face_session_device_id_invalid", 400);
  return id;
}

function contentFreeFaceResult(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((key) => SAFE_FACE_RESULT_KEYS.has(key)) &&
    !/(?:auth[_-]?token|session[_-]?handle|media[_-]?url|person[_-]?name|message)/i.test(JSON.stringify(value));
}

function validatedCreatedSession(created, claim, broker) {
  const value = Object.freeze({
    sessionHandle: String(created?.sessionHandle || ""),
    referenceSha256: String(created?.referenceSha256 || "").toLowerCase(),
    modelVersion: String(created?.modelVersion || ""),
    sessionExpiresAt: String(created?.sessionExpiresAt || ""),
  });
  const expiry = new Date(value.sessionExpiresAt);
  if (!value.sessionHandle || value.sessionHandle.length > 4_096 || !SHA256.test(value.referenceSha256) ||
      value.referenceSha256 !== claim.identityReference.sha256 || value.modelVersion !== broker.modelVersion ||
      Number.isNaN(expiry.getTime()) || expiry.toISOString() !== value.sessionExpiresAt) {
    fail("face_session_create_result_invalid", 503);
  }
  return value;
}

function normalizedTerminalFaceResult(result, claim, broker) {
  const score = Number(result?.identity_score);
  const referenceSha = String(result?.reference_sha256 || "").toLowerCase();
  const digest = String(result?.provider_digest || "").toLowerCase();
  const verifyHash = String(result?.verify_image_hash || "").toLowerCase();
  const livenessPassed = result?.liveness_passed === true;
  const identityMatch = result?.identity_match === true;
  const passed = result?.passed === true;
  const platformMatch = identityMatch && score >= MIN_FACE_IDENTITY_SCORE;
  if (!contentFreeFaceResult(result) || result?.terminal !== true ||
      result?.request_id !== `${claim.challengeId}:${claim.faceSessionAttempt}` ||
      referenceSha !== claim.identityReference.sha256 || result?.model_version !== broker.modelVersion ||
      result?.provider_accepted !== true || typeof result?.passed !== "boolean" ||
      typeof result?.liveness_passed !== "boolean" || typeof result?.identity_match !== "boolean" ||
      !Number.isFinite(score) || score < 0 || score > 1 ||
      passed !== (livenessPassed && platformMatch) ||
      (passed && (!SHA256.test(digest) || verifyHash !== claim.identityReference.sha256))) {
    fail("face_session_terminal_result_invalid", 503);
  }
  const failureCode = passed ? "" : String(result?.failure_code || "face_session_failed")
    .toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 80) || "face_session_failed";
  return Object.freeze({
    request_id: `${claim.challengeId}:${claim.faceSessionAttempt}`,
    reference_sha256: claim.identityReference.sha256,
    provider_accepted: true,
    terminal: true,
    passed,
    liveness_passed: livenessPassed,
    identity_match: identityMatch,
    identity_score: score,
    provider_digest: passed ? digest : "",
    verify_image_hash: passed ? verifyHash : "",
    failure_code: failureCode,
    model_version: broker.modelVersion,
  });
}

function claimFromRow(row, leaseToken, clientDeviceId) {
  return Object.freeze({
    leaseToken,
    challengeId: row.challenge_id,
    replicaId: row.replica_id,
    ownerUserId: row.owner_user_id,
    faceSessionAttempt: Number(row.face_session_attempt),
    faceSessionState: row.face_session_state,
    sessionHandle: row.face_session_handle || "",
    clientDeviceId,
    identityReference: Object.freeze({
      sourceId: row.identity_source_id,
      mime: row.identity_mime,
      byteSize: Number(row.identity_byte_size),
      sha256: row.identity_sha256,
      objectPath: row.identity_object_path,
    }),
  });
}

export async function leaseOwnedFaceSessionStart(db, ownerUserId, id, challenge, clientDeviceId, broker, options = {}) {
  brokerContract(broker);
  const rid = replicaId(id);
  const cid = replicaId(challenge);
  const device = exactDevice(clientDeviceId);
  const leaseToken = options.leaseToken || randomBytes(32).toString("hex");
  const leaseMs = Math.max(60_000, Math.min(300_000, Number(options.leaseMs || 240_000)));
  const rows = await db(
    `with eligible as (
       select ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.face_session_attempt,ch.face_session_state,
              ids.source_id identity_source_id,ids.mime identity_mime,ids.byte_size identity_byte_size,
              ids.sha256 identity_sha256,ids.object_path identity_object_path
         from vy_replica_liveness_challenge ch
         join vy_replica r on r.replica_id=ch.replica_id and r.owner_user_id=ch.owner_user_id
         join vy_replica_identity_case ic on ic.identity_case_id=ch.identity_case_id
          and ic.replica_id=ch.replica_id and ic.owner_user_id=ch.owner_user_id
         join vy_replica_source ids on ids.source_id=ic.source_id and ids.replica_id=ic.replica_id
          and ids.owner_user_id=ic.owner_user_id
         join vy_replica_biometric_verification_grant g on g.challenge_id=ch.challenge_id
          and g.replica_id=ch.replica_id and g.owner_user_id=ch.owner_user_id
        where ch.challenge_id=$1::uuid and ch.replica_id=$2::uuid and ch.owner_user_id=$3::uuid
          and ch.state='issued' and ch.expires_at>now()+interval '2 minutes'
          and ch.face_session_state='not_started'
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and ic.state='evidence_ready' and ic.adult_evidence=true and ic.document_authentic=true
          and ic.document_current=true and ic.face_reference_ready=true and ic.credential_expires_at>now()
          and ids.state='quarantined' and ids.capture_mode='identity_document'
          and ids.kind='image' and ids.mime in ('image/jpeg','image/png') and ids.sha256=ic.source_sha256
          and g.state='active' and g.expires_at>now()
        for update of ch
     ), leased as (
       update vy_replica_liveness_challenge ch set face_session_state='issuing',
               face_session_attempt=ch.face_session_attempt+1,face_session_lease_token_hash=$4,
              face_session_leased_at=now(),face_session_lease_expires_at=now()+($5::integer*interval '1 millisecond'),
              updated_at=now()
         from eligible e where ch.challenge_id=e.challenge_id
       returning ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.face_session_attempt,ch.face_session_state
     ) select l.*,e.identity_source_id,e.identity_mime,e.identity_byte_size,e.identity_sha256,e.identity_object_path
         from leased l join eligible e on e.challenge_id=l.challenge_id`,
    [cid, rid, ownerUserId, leaseHash(leaseToken), leaseMs],
  );
  return rows[0] ? claimFromRow(rows[0], leaseToken, device) : null;
}

async function recoverableOwnedFaceSession(db, ownerUserId, id, challenge, clientDeviceId) {
  const device = exactDevice(clientDeviceId);
  const rows = await db(
    `select ch.*,ids.source_id identity_source_id,ids.mime identity_mime,
            ids.byte_size identity_byte_size,ids.sha256 identity_sha256,ids.object_path identity_object_path
       from vy_replica_liveness_challenge ch
       join vy_replica r on r.replica_id=ch.replica_id and r.owner_user_id=ch.owner_user_id
       join vy_replica_identity_case ic on ic.identity_case_id=ch.identity_case_id
        and ic.replica_id=ch.replica_id and ic.owner_user_id=ch.owner_user_id
       join vy_replica_source ids on ids.source_id=ic.source_id and ids.replica_id=ic.replica_id
        and ids.owner_user_id=ic.owner_user_id
       join vy_replica_biometric_verification_grant g on g.challenge_id=ch.challenge_id
        and g.replica_id=ch.replica_id and g.owner_user_id=ch.owner_user_id
      where ch.challenge_id=$1::uuid and ch.replica_id=$2::uuid and ch.owner_user_id=$3::uuid
        and ch.state='issued' and ch.expires_at>now() and ch.face_session_state='ready'
        and ch.face_session_handle<>'' and ch.face_session_expires_at>now()+interval '30 seconds'
        and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
        and ic.state='evidence_ready' and ic.adult_evidence=true and ic.document_authentic=true
        and ic.document_current=true and ic.face_reference_ready=true and ic.credential_expires_at>now()
        and ids.state='quarantined' and ids.capture_mode='identity_document'
        and ids.kind='image' and ids.mime in ('image/jpeg','image/png')
        and ids.sha256=ic.source_sha256 and ids.sha256=ch.face_session_reference_sha256
        and g.state='active' and g.expires_at>now()
      limit 1`,
    [replicaId(challenge), replicaId(id), ownerUserId],
  );
  if (!rows[0] || rows[0].face_session_state !== "ready") return null;
  return Object.freeze({ row: rows[0], claim: claimFromRow(rows[0], "face-session-response-recovery", device) });
}

async function releaseStart(db, claim, code) {
  await db(
    `update vy_replica_liveness_challenge set face_session_state='not_started',
       face_session_lease_token_hash='',face_session_leased_at=null,face_session_lease_expires_at=null,
       failure_code=$6,updated_at=now()
      where challenge_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and face_session_attempt=$4::int4
        and face_session_state='issuing' and face_session_lease_token_hash=$5`,
    [claim.challengeId, claim.replicaId, claim.ownerUserId, claim.faceSessionAttempt,
      leaseHash(claim.leaseToken), String(code || "face_session_start_failed").slice(0, 80)],
  );
}

export async function completeFaceSessionStart(db, claim, created, broker) {
  const session = validatedCreatedSession(created, claim, broker);
  const rows = await db(
    `with settled as (
       update vy_replica_liveness_challenge ch set face_session_state='ready',face_session_handle=$6,
              face_session_handle_hash=$7,face_session_reference_sha256=$8,face_session_model_version=$9,
              face_session_expires_at=$10::timestamptz,face_session_issued_at=now(),face_session_result='{}'::jsonb,
              face_session_lease_token_hash='',face_session_leased_at=null,face_session_lease_expires_at=null,
              failure_code='',updated_at=now()
        where ch.challenge_id=$1::uuid and ch.replica_id=$2::uuid and ch.owner_user_id=$3::uuid and ch.face_session_attempt=$4::int4
          and ch.face_session_state='issuing' and ch.face_session_lease_token_hash=$5
          and ch.face_session_lease_expires_at>now() and $10::timestamptz<=ch.expires_at
          and $10::timestamptz>now()+interval '30 seconds'
          and ch.state='issued' and ch.expires_at>now()
          and exists (
            select 1 from vy_replica r where r.replica_id=ch.replica_id
              and r.owner_user_id=ch.owner_user_id and r.subject_mode='self'
              and r.lifecycle not in ('revoked','purging')
          )
          and exists (
            select 1 from vy_replica_identity_case ic join vy_replica_source ids
              on ids.source_id=ic.source_id and ids.replica_id=ic.replica_id
              and ids.owner_user_id=ic.owner_user_id
             where ic.identity_case_id=ch.identity_case_id and ic.replica_id=ch.replica_id
               and ic.owner_user_id=ch.owner_user_id and ic.state='evidence_ready'
               and ic.adult_evidence=true and ic.document_authentic=true and ic.document_current=true
               and ic.face_reference_ready=true and ic.credential_expires_at>now()
               and ids.state='quarantined' and ids.sha256=$8
          )
          and exists (
            select 1 from vy_replica_biometric_verification_grant g
             where g.challenge_id=ch.challenge_id and g.replica_id=ch.replica_id
               and g.owner_user_id=ch.owner_user_id and g.state='active' and g.expires_at>now()
          )
        returning ch.*
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'liveness.face_session.issue','liveness_challenge',challenge_id::text,
              $11,'allowed',jsonb_build_object('model_version',$9,'reference_sha256',$8) from settled
     ) select * from settled`,
    [claim.challengeId, claim.replicaId, claim.ownerUserId, claim.faceSessionAttempt,
      leaseHash(claim.leaseToken), session.sessionHandle,
      createHash("sha256").update(session.sessionHandle).digest("hex"),
      session.referenceSha256, session.modelVersion, session.sessionExpiresAt, broker.version],
  );
  if (!rows[0]) fail("face_session_start_settlement_lost", 409);
  return clientChallenge(rows[0]);
}

async function quarantineCreatedSessionForDeletion(db, claim, created, broker, code) {
  const session = validatedCreatedSession(created, claim, broker);
  const rows = await db(
    `update vy_replica_liveness_challenge set face_session_state='expired_deleting',face_session_handle=$6,
       face_session_handle_hash=$7,face_session_reference_sha256=$8,face_session_model_version=$9,
       face_session_expires_at=$10::timestamptz,face_session_issued_at=coalesce(face_session_issued_at,now()),
       face_session_lease_token_hash='',face_session_leased_at=null,face_session_lease_expires_at=null,
       failure_code=$11,updated_at=now()
      where challenge_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and face_session_attempt=$4::int4
        and face_session_state='issuing' and face_session_lease_token_hash=$5
      returning challenge_id`,
    [claim.challengeId, claim.replicaId, claim.ownerUserId, claim.faceSessionAttempt,
      leaseHash(claim.leaseToken), session.sessionHandle,
      createHash("sha256").update(session.sessionHandle).digest("hex"), session.referenceSha256,
      session.modelVersion, session.sessionExpiresAt, String(code || "face_session_settlement_failed").slice(0, 80)],
  );
  return Boolean(rows[0]);
}

async function trackedCreatedSession(db, claim, created) {
  const handle = String(created?.sessionHandle || "");
  if (!handle) return null;
  const rows = await db(
    `select * from vy_replica_liveness_challenge
      where challenge_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and face_session_attempt=$4::int4
        and face_session_handle_hash=$5 limit 1`,
    [claim.challengeId, claim.replicaId, claim.ownerUserId, claim.faceSessionAttempt,
      createHash("sha256").update(handle).digest("hex")],
  );
  return rows[0] || null;
}

export async function startOwnedFaceSession(db, ownerUserId, id, challenge, clientDeviceId, broker, options = {}) {
  const activeBroker = brokerContract(broker);
  const claim = await leaseOwnedFaceSessionStart(db, ownerUserId, id, challenge, clientDeviceId, activeBroker, options);
  if (!claim) {
    const recoverable = await recoverableOwnedFaceSession(db, ownerUserId, id, challenge, clientDeviceId);
    if (!recoverable) fail("face_session_not_authorized_or_already_started");
    if (typeof activeBroker.resume !== "function") fail("face_session_resume_unavailable", 503);
    const resumed = await activeBroker.resume(recoverable.claim);
    const session = validatedCreatedSession(resumed, recoverable.claim, activeBroker);
    const handleHash = createHash("sha256").update(session.sessionHandle).digest("hex");
    if (handleHash !== recoverable.row.face_session_handle_hash ||
        session.sessionExpiresAt !== new Date(recoverable.row.face_session_expires_at).toISOString()) {
      fail("face_session_resume_binding_invalid", 503);
    }
    const confirmed = await recoverableOwnedFaceSession(db, ownerUserId, id, challenge, clientDeviceId);
    if (!confirmed || confirmed.row.face_session_handle_hash !== handleHash) {
      fail("face_session_resume_authorization_lost");
    }
    return Object.freeze({ challenge: clientChallenge(confirmed.row), quickLinkUrl: resumed.quickLinkUrl });
  }
  let created;
  try { created = await activeBroker.create(claim); }
  catch (error) {
    if (error?.ambiguous !== true) await releaseStart(db, claim, error?.code || error?.message);
    throw error;
  }
  try {
    const challengeView = await completeFaceSessionStart(db, claim, created, activeBroker);
    return Object.freeze({ challenge: challengeView, quickLinkUrl: created.quickLinkUrl });
  } catch (error) {
    let tracked;
    try { tracked = await trackedCreatedSession(db, claim, created); }
    catch { throw error; }
    if (tracked) {
      if (tracked.face_session_state === "ready") {
        return Object.freeze({ challenge: clientChallenge(tracked), quickLinkUrl: created.quickLinkUrl });
      }
      throw error;
    }
    let deleted = false;
    try {
      await activeBroker.delete({ ...claim, sessionHandle: created.sessionHandle });
      deleted = true;
    } catch {}
    if (deleted) await releaseStart(db, claim, "face_session_settlement_failed").catch(() => {});
    else await quarantineCreatedSessionForDeletion(
      db, claim, created, activeBroker, "face_session_settlement_failed",
    ).catch(() => {});
    throw error;
  }
}

export async function leaseOwnedFaceSessionPoll(db, ownerUserId, id, challenge, broker, options = {}) {
  brokerContract(broker);
  const leaseToken = options.leaseToken || randomBytes(32).toString("hex");
  const leaseMs = Math.max(30_000, Math.min(180_000, Number(options.leaseMs || 60_000)));
  const rows = await db(
    `with eligible as (
       select ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.face_session_attempt,ch.face_session_state,
              case when ch.face_session_state in ('ready','polling') and ch.face_session_expires_at<=now()
                then 'expired_deleting' else ch.face_session_state end desired_state,
              ch.face_session_handle,ids.source_id identity_source_id,ids.mime identity_mime,
              ids.byte_size identity_byte_size,ids.sha256 identity_sha256,ids.object_path identity_object_path
         from vy_replica_liveness_challenge ch
         join vy_replica_identity_case ic on ic.identity_case_id=ch.identity_case_id
          and ic.replica_id=ch.replica_id and ic.owner_user_id=ch.owner_user_id
         join vy_replica_source ids on ids.source_id=ic.source_id and ids.replica_id=ic.replica_id
          and ids.owner_user_id=ic.owner_user_id
        where ch.challenge_id=$1::uuid and ch.replica_id=$2::uuid and ch.owner_user_id=$3::uuid
          and (ch.face_session_state in ('ready','passed_deleting','failed_deleting','expired_deleting')
            or (ch.face_session_state='polling' and ch.face_session_lease_expires_at<=now()))
          and ch.face_session_handle<>'' and ids.sha256=ch.face_session_reference_sha256
        for update of ch
     ), leased as (
       update vy_replica_liveness_challenge ch
          set face_session_state=case when e.desired_state='ready' then 'polling' else e.desired_state end,
              face_session_lease_token_hash=$4,face_session_leased_at=now(),
              face_session_lease_expires_at=now()+($5::integer*interval '1 millisecond'),updated_at=now()
         from eligible e where ch.challenge_id=e.challenge_id
       returning ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.face_session_attempt,ch.face_session_state,
                 ch.face_session_handle
     ) select l.*,e.identity_source_id,e.identity_mime,e.identity_byte_size,e.identity_sha256,e.identity_object_path
         from leased l join eligible e on e.challenge_id=l.challenge_id`,
    [replicaId(challenge), replicaId(id), ownerUserId, leaseHash(leaseToken), leaseMs],
  );
  return rows[0] ? claimFromRow(rows[0], leaseToken, "00000000-0000-4000-8000-000000000000") : null;
}

async function settlePending(db, claim) {
  const rows = await db(
    `update vy_replica_liveness_challenge set face_session_state='ready',face_session_lease_token_hash='',
       face_session_leased_at=null,face_session_lease_expires_at=null,updated_at=now()
      where challenge_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and face_session_attempt=$4::int4
        and face_session_state='polling' and face_session_lease_token_hash=$5
      returning *`,
    [claim.challengeId, claim.replicaId, claim.ownerUserId, claim.faceSessionAttempt, leaseHash(claim.leaseToken)],
  );
  if (!rows[0]) fail("face_session_poll_settlement_lost");
  return clientChallenge(rows[0]);
}

async function settleTerminal(db, claim, result, broker) {
  const normalized = normalizedTerminalFaceResult(result, claim, broker);
  const passed = normalized.passed;
  const state = passed ? "passed_deleting" : "failed_deleting";
  const failure = normalized.failure_code;
  const rows = await db(
    `update vy_replica_liveness_challenge set face_session_state=$6,face_session_result=$7::jsonb,
       face_session_terminal_at=now(),failure_code=$8,updated_at=now()
      where challenge_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and face_session_attempt=$4::int4
        and face_session_state='polling' and face_session_lease_token_hash=$5
      returning *`,
    [claim.challengeId, claim.replicaId, claim.ownerUserId, claim.faceSessionAttempt,
      leaseHash(claim.leaseToken), state, JSON.stringify(normalized), failure],
  );
  if (!rows[0]) fail("face_session_terminal_settlement_lost");
  return rows[0];
}

async function releasePoll(db, claim, code) {
  await db(
    `update vy_replica_liveness_challenge set face_session_state='ready',face_session_lease_token_hash='',
       face_session_leased_at=null,face_session_lease_expires_at=null,failure_code=$6,updated_at=now()
      where challenge_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and face_session_attempt=$4::int4
        and face_session_state='polling' and face_session_lease_token_hash=$5`,
    [claim.challengeId, claim.replicaId, claim.ownerUserId, claim.faceSessionAttempt,
      leaseHash(claim.leaseToken), String(code || "face_session_poll_failed").slice(0, 80)],
  );
}

async function settleDeleted(db, claim) {
  const passed = claim.faceSessionState === "passed_deleting";
  const failed = claim.faceSessionState === "failed_deleting";
  const finalState = passed ? "passed_deleted" : failed ? "failed_deleted" : "expired_deleted";
  const rows = await db(
    `with settled as (
       update vy_replica_liveness_challenge ch set face_session_state=$6,face_session_handle='',
              face_session_provider_deleted_at=now(),face_session_lease_token_hash='',face_session_leased_at=null,
              face_session_lease_expires_at=null,state=case when $6 in ('failed_deleted','expired_deleted') then 'failed' else state end,
              updated_at=now()
        where ch.challenge_id=$1::uuid and ch.replica_id=$2::uuid and ch.owner_user_id=$3::uuid and ch.face_session_attempt=$4::int4
          and ch.face_session_state=$7 and ch.face_session_lease_token_hash=$5
        returning ch.*
     ), grant_done as (
       update vy_replica_biometric_verification_grant g
          set state='consumed',consumed_at=now()
         from settled s where $6 in ('failed_deleted','expired_deleted') and g.challenge_id=s.challenge_id
           and g.replica_id=s.replica_id and g.owner_user_id=s.owner_user_id and g.state='active'
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'liveness.face_session.delete','liveness_challenge',challenge_id::text,
              face_session_model_version,'allowed',jsonb_build_object('terminal_state',$6) from settled
     ) select * from settled`,
    [claim.challengeId, claim.replicaId, claim.ownerUserId, claim.faceSessionAttempt,
      leaseHash(claim.leaseToken), finalState, claim.faceSessionState],
  );
  if (!rows[0]) fail("face_session_delete_settlement_lost");
  return clientChallenge(rows[0]);
}

async function releaseDelete(db, claim, code) {
  await db(
    `update vy_replica_liveness_challenge set face_session_lease_token_hash='',face_session_leased_at=null,
       face_session_lease_expires_at=null,failure_code=$6,updated_at=now()
      where challenge_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and face_session_attempt=$4::int4
        and face_session_state=$7 and face_session_lease_token_hash=$5`,
    [claim.challengeId, claim.replicaId, claim.ownerUserId, claim.faceSessionAttempt,
      leaseHash(claim.leaseToken), String(code || "face_session_delete_failed").slice(0, 80), claim.faceSessionState],
  );
}

export async function leaseNextFaceSessionCleanup(db, broker, options = {}) {
  cleanupBrokerContract(broker);
  const leaseToken = options.leaseToken || randomBytes(32).toString("hex");
  const leaseMs = Math.max(30_000, Math.min(180_000, Number(options.leaseMs || 60_000)));
  const rows = await db(
    `with candidate as (
       select ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.face_session_attempt,
              ch.face_session_state,ch.face_session_handle,ch.face_session_reference_sha256
         from vy_replica_liveness_challenge ch
        where ch.face_session_handle<>'' and (
          ch.face_session_state in ('passed_deleting','failed_deleting','expired_deleting') or
          (ch.face_session_state in ('ready','polling') and ch.face_session_expires_at<=now())
        ) and (ch.face_session_lease_token_hash='' or ch.face_session_lease_expires_at<=now())
        order by ch.updated_at limit 1 for update of ch skip locked
     ), leased as (
       update vy_replica_liveness_challenge ch set
              face_session_state=case when c.face_session_state in ('ready','polling')
                then 'expired_deleting' else c.face_session_state end,
              face_session_lease_token_hash=$1,face_session_leased_at=now(),
              face_session_lease_expires_at=now()+($2::integer*interval '1 millisecond'),updated_at=now()
         from candidate c where ch.challenge_id=c.challenge_id
       returning ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.face_session_attempt,
                 ch.face_session_state,ch.face_session_handle,ch.face_session_reference_sha256
     ) select * from leased`,
    [leaseHash(leaseToken), leaseMs],
  );
  const row = rows[0];
  if (!row) return null;
  return Object.freeze({
    leaseToken,
    challengeId: row.challenge_id,
    replicaId: row.replica_id,
    ownerUserId: row.owner_user_id,
    faceSessionAttempt: Number(row.face_session_attempt),
    faceSessionState: row.face_session_state,
    sessionHandle: row.face_session_handle,
    identityReference: Object.freeze({ sha256: row.face_session_reference_sha256 }),
  });
}

export async function deleteOwnedFaceSessionNow(db, ownerUserId, id, challenge, broker, options = {}) {
  const activeBroker = cleanupBrokerContract(broker);
  const cid = challenge ? replicaId(challenge) : null;
  const leaseToken = options.leaseToken || randomBytes(32).toString("hex");
  const leaseMs = Math.max(30_000, Math.min(90_000, Number(options.leaseMs || 60_000)));
  const rows = await db(
    `update vy_replica_liveness_challenge ch set face_session_lease_token_hash=$4,
            face_session_leased_at=now(),face_session_lease_expires_at=now()+($5::integer*interval '1 millisecond'),
            updated_at=now()
      where ($1::uuid is null or ch.challenge_id=$1::uuid) and ch.replica_id=$2::uuid and ch.owner_user_id=$3::uuid
        and ch.face_session_handle<>''
        and ch.face_session_state in ('passed_deleting','failed_deleting','expired_deleting')
        and (ch.face_session_lease_token_hash='' or ch.face_session_lease_expires_at<=now())
      returning ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.face_session_attempt,
                ch.face_session_state,ch.face_session_handle,ch.face_session_reference_sha256`,
    [cid, replicaId(id), ownerUserId, leaseHash(leaseToken), leaseMs],
  );
  const row = rows[0];
  if (!row) return null;
  const claim = Object.freeze({
    leaseToken,
    challengeId: row.challenge_id,
    replicaId: row.replica_id,
    ownerUserId: row.owner_user_id,
    faceSessionAttempt: Number(row.face_session_attempt),
    faceSessionState: row.face_session_state,
    sessionHandle: row.face_session_handle,
    identityReference: Object.freeze({ sha256: row.face_session_reference_sha256 }),
  });
  try {
    await activeBroker.delete(claim, { timeoutMs: options.providerTimeoutMs || 45_000 });
    return settleDeleted(db, claim);
  } catch (error) {
    await releaseDelete(db, claim, error?.code || error?.message);
    throw error;
  }
}

export async function runFaceSessionCleanupSweep(options = {}) {
  const db = options.db;
  const broker = cleanupBrokerContract(options.broker);
  if (typeof db !== "function") fail("face_session_database_required", 500);
  const lease = options.lease || leaseNextFaceSessionCleanup;
  const maxJobs = Math.max(1, Math.min(8, Number(options.maxJobs || 2)));
  const timeBudgetMs = Math.max(20_000, Math.min(120_000, Number(options.timeBudgetMs || 100_000)));
  const now = typeof options.now === "function" ? options.now : Date.now;
  const deadline = now() + timeBudgetMs;
  const hasCallBudget = () => now() <= deadline - 48_000;
  const summary = {
    leased: 0, deleted: 0, retried: 0, providerScanned: 0,
    providerExpiredDeleted: 0, providerCleanupSkipped: false, ambiguousReconciled: 0,
  };
  while (summary.leased < maxJobs && hasCallBudget()) {
    const claim = await lease(db, broker);
    if (!claim) break;
    summary.leased += 1;
    try {
      await broker.delete(claim);
      await settleDeleted(db, claim);
      summary.deleted += 1;
    } catch (error) {
      await releaseDelete(db, claim, error?.code || error?.message);
      summary.retried += 1;
    }
  }
  let providerCleanupConfirmed = false;
  let providerCleanupCutoff = "";
  if (hasCallBudget()) {
    const cleanup = await broker.cleanup();
    summary.providerScanned = Number(cleanup?.scanned || 0);
    summary.providerExpiredDeleted = Number(cleanup?.deleted || 0);
    providerCleanupCutoff = String(cleanup?.scanStartedAt || "");
    const cutoff = new Date(providerCleanupCutoff);
    if (Number.isNaN(cutoff.getTime()) || cutoff.toISOString() !== providerCleanupCutoff ||
        cutoff.getTime() > now() + 120_000) fail("face_session_cleanup_cutoff_invalid", 503);
    providerCleanupConfirmed = true;
  } else {
    summary.providerCleanupSkipped = true;
  }
  if (!providerCleanupConfirmed) return Object.freeze(summary);
  const reconciled = await db(
    `with stale as (
       update vy_replica_liveness_challenge set face_session_state='expired_deleted',state='failed',
              face_session_provider_deleted_at=now(),face_session_lease_token_hash='',face_session_leased_at=null,
              face_session_lease_expires_at=null,failure_code='ambiguous_session_expired_and_swept',updated_at=now()
        where face_session_state='issuing' and face_session_handle=''
          and expires_at<=$1::timestamptz and face_session_lease_expires_at is not null
          and face_session_lease_expires_at+interval '12 minutes'<=$1::timestamptz
        returning challenge_id,replica_id,owner_user_id,face_session_state,face_session_model_version
     ), swept as (
       update vy_replica_liveness_challenge ch set
              face_session_state=case
                when ch.face_session_state='passed_deleting' then 'passed_deleted'
                when ch.face_session_state='failed_deleting' then 'failed_deleted'
                else 'expired_deleted' end,
              state=case when ch.face_session_state='passed_deleting' then ch.state else 'failed' end,
              face_session_handle='',face_session_provider_deleted_at=now(),
              face_session_lease_token_hash='',face_session_leased_at=null,face_session_lease_expires_at=null,
              failure_code=case when ch.face_session_state='passed_deleting' then ch.failure_code
                else 'provider_session_expired_and_swept' end,updated_at=now()
        where ch.face_session_handle<>''
          and ch.face_session_state in (
            'ready','polling','passed_deleting','failed_deleting','expired_deleting'
          ) and ch.face_session_expires_at+interval '2 minutes'<=$1::timestamptz
        returning ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.face_session_state,ch.face_session_model_version
     ), expired_items as (
       select * from stale union all select * from swept where face_session_state<>'passed_deleted'
     ), grants as (
       update vy_replica_biometric_verification_grant g set state='expired'
        from expired_items s where g.challenge_id=s.challenge_id and g.replica_id=s.replica_id
          and g.owner_user_id=s.owner_user_id and g.state='active'
     ), audit_items as (
       select * from stale union all select * from swept
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'liveness.face_session.resource_cleanup','liveness_challenge',
              challenge_id::text,case when face_session_model_version='' then 'resource-cleanup/v1'
                else face_session_model_version end,'allowed',
              jsonb_build_object('terminal_state',face_session_state,'scan_started_at',$1::timestamptz)
         from audit_items
     ) select challenge_id from audit_items`,
    [providerCleanupCutoff],
  );
  summary.ambiguousReconciled = reconciled.length;
  return Object.freeze(summary);
}

export async function pollOwnedFaceSession(db, ownerUserId, id, challenge, broker, options = {}) {
  const activeBroker = brokerContract(broker);
  let claim = await leaseOwnedFaceSessionPoll(db, ownerUserId, id, challenge, activeBroker, options);
  if (!claim) fail("face_session_not_ready");
  if (claim.faceSessionState === "polling") {
    try {
      const result = await activeBroker.result(claim);
      if (result.terminal !== true) return settlePending(db, claim);
      const terminal = await settleTerminal(db, claim, result, activeBroker);
      claim = Object.freeze({ ...claim, faceSessionState: terminal.face_session_state });
    }
    catch (error) {
      await releasePoll(db, claim, error?.code || error?.message);
      throw error;
    }
  }
  try { await activeBroker.delete(claim); }
  catch (error) {
    await releaseDelete(db, claim, error?.code || error?.message);
    throw error;
  }
  return settleDeleted(db, claim);
}
