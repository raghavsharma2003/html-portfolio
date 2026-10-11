import { randomBytes } from "node:crypto";
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const uuid = (value) => { const id = String(value || "").toLowerCase(); if (!UUID.test(id)) fail("auth_email_request_invalid", 400); return id; };
const hash = (value) => { const result = String(value || "").toLowerCase(); if (!HASH.test(result)) fail("auth_email_request_invalid", 400); return result; };
const row = (value) => value ? { ...value, payload_envelope: typeof value.payload_envelope === "string" ? JSON.parse(value.payload_envelope) : value.payload_envelope } : null;

export const AUTH_EMAIL_ADMIT_SQL = `with existing as (
 select * from vy_auth_email_outbox where request_id=$1::uuid
),created as (
 insert into vy_auth_email_outbox(request_id,request_hash,email_hash,redirect_url,redirect_hash,
  acs_operation_id,repeatability_first_sent,expires_at)
 select $1::uuid,$2,$3,$4,$5,$1::uuid,$6::timestamptz,$7::timestamptz
 where not exists(select 1 from existing)
 on conflict(request_id) do nothing returning *
)
select * from created
union all
select * from existing where request_hash=$2 and email_hash=$3 and redirect_url=$4 and redirect_hash=$5`;

export const AUTH_EMAIL_CLAIM_PREPARATION_SQL = `update vy_auth_email_outbox
 set state='preparing',preparation_token_hash=$3,preparation_lease_expires_at=now()+interval '2 minutes',
     updated_at=now(),last_error_code=''
 where request_id=$1::uuid and request_hash=$2 and expires_at>now()
   and state='admitted'
 returning *`;

export const AUTH_EMAIL_COMPLETE_PREPARATION_SQL = `update vy_auth_email_outbox
 set state='prepared',owner_user_id=$4::uuid,payload_envelope=$5::jsonb,payload_hash=$6,
     preparation_token_hash=null,preparation_lease_expires_at=null,updated_at=now()
 where request_id=$1::uuid and request_hash=$2 and state='preparing' and preparation_token_hash=$3
 returning *`;

export const AUTH_EMAIL_RELEASE_PREPARATION_SQL = `update vy_auth_email_outbox
 set state='admitted',preparation_token_hash=null,preparation_lease_expires_at=null,
     last_error_code=$4,updated_at=now()
 where request_id=$1::uuid and request_hash=$2 and state='preparing' and preparation_token_hash=$3
 returning *`;

export const AUTH_EMAIL_RECORD_PREPARATION_UNCERTAIN_SQL = `update vy_auth_email_outbox
 set state='reconcile_required',preparation_token_hash=null,preparation_lease_expires_at=null,
     last_error_code=$4,updated_at=now()
 where request_id=$1::uuid and request_hash=$2 and state='preparing' and preparation_token_hash=$3
 returning *`;

export const AUTH_EMAIL_READ_SQL = `select * from vy_auth_email_outbox
 where request_id=$1::uuid and request_hash=$2`;

export const AUTH_EMAIL_CLAIM_DISPATCH_SQL = `update vy_auth_email_outbox
 set state='dispatching',attempt_count=attempt_count+1,updated_at=now(),last_error_code=''
 where request_id=$1::uuid and request_hash=$2 and state='prepared' and expires_at>now()
 returning *`;

export const AUTH_EMAIL_RETRY_DISPATCH_SQL = `update vy_auth_email_outbox
 set state='dispatching',attempt_count=attempt_count+1,
     retry_pilot_slot=nextval('vy_auth_email_pilot_slot_seq'),updated_at=now(),last_error_code=''
 where request_id=$1::uuid and request_hash=$2 and state='pending'
   and provider_status='NotStarted' and attempt_count<2 and expires_at>now()
 returning *`;

export const AUTH_EMAIL_RECORD_PENDING_SQL = `update vy_auth_email_outbox
 set state='pending',operation_location=$3,provider_status=$4,updated_at=now(),last_error_code=''
 where request_id=$1::uuid and request_hash=$2 and state in('dispatching','pending')
 returning *`;

export const AUTH_EMAIL_RECORD_TERMINAL_SQL = `update vy_auth_email_outbox
 set state=$3,provider_status=$4,last_error_code=$5,payload_envelope=null,payload_hash=null,
     payload_erased_at=coalesce(payload_erased_at,now()),preparation_token_hash=null,
     preparation_lease_expires_at=null,updated_at=now()
 where request_id=$1::uuid and request_hash=$2 and $3 in('succeeded','failed')
   and state in('dispatching','pending','reconcile_required')
 returning *`;

export const AUTH_EMAIL_RECORD_RECONCILE_SQL = `update vy_auth_email_outbox
 set state='reconcile_required',last_error_code=$3,updated_at=now()
 where request_id=$1::uuid and request_hash=$2 and state in('dispatching','pending')
 returning *`;

export const AUTH_EMAIL_EXPIRE_SQL = `update vy_auth_email_outbox
 set state='expired',payload_envelope=null,payload_hash=null,payload_erased_at=coalesce(payload_erased_at,now()),
     preparation_token_hash=null,preparation_lease_expires_at=null,updated_at=now(),
     last_error_code=case when last_error_code='' then 'auth_email_request_expired' else last_error_code end
 where expires_at<=now() and state not in('succeeded','failed','expired')
 returning request_id`;

export const AUTH_EMAIL_FORGET_SQL = `delete from vy_auth_email_outbox
 where owner_user_id=$1::uuid returning request_id`;

export const AUTH_EMAIL_SWEEP_ROWS_SQL = `select * from vy_auth_email_outbox
 where state in('dispatching','pending','reconcile_required') and attempt_count>0 and expires_at>now()
 order by updated_at asc,request_id asc limit $1`;

export function authEmailRequestShape(input) {
  const request_id = uuid(input?.request_id);
  const email_hash = hash(input?.email_hash);
  const redirect_hash = hash(input?.redirect_hash);
  const redirect_url = String(input?.redirect_url || "");
  if (redirect_url.length < 12 || redirect_url.length > 2048) fail("auth_email_redirect_invalid", 400);
  const request_hash = sha256Hex(canonicalJson({ schema: "vyakti.auth-email-request/v1", request_id, email_hash, redirect_hash }));
  return { request_id, request_hash, email_hash, redirect_hash, redirect_url };
}

export async function admitAuthEmail(db, input, now = Date.now()) {
  const shaped = authEmailRequestShape(input);
  try {
    const rows = await db(AUTH_EMAIL_ADMIT_SQL, [shaped.request_id, shaped.request_hash, shaped.email_hash,
      shaped.redirect_url, shaped.redirect_hash, new Date(now).toISOString(), new Date(now + 60 * 60 * 1000).toISOString()]);
    if (!rows[0]) fail("auth_email_request_conflict");
    return row(rows[0]);
  } catch (cause) {
    if (cause?.code === "auth_email_request_conflict") throw cause;
    if (cause?.code === "2200H" || /maximum value.*vy_auth_email_pilot_slot_seq/i.test(String(cause?.message || ""))) {
      fail("auth_email_pilot_cap_reached", 503);
    }
    fail("auth_email_store_unavailable", 503);
  }
}

export async function claimAuthEmailPreparation(db, input) {
  const shaped = authEmailRequestShape(input), token = randomBytes(32).toString("base64url"), tokenHash = sha256Hex(token);
  const rows = await db(AUTH_EMAIL_CLAIM_PREPARATION_SQL, [shaped.request_id, shaped.request_hash, tokenHash]);
  return rows[0] ? { row: row(rows[0]), token } : null;
}

export async function completeAuthEmailPreparation(db, input, token, ownerUserId, envelope, payloadHash) {
  const shaped = authEmailRequestShape(input), tokenHash = sha256Hex(String(token || ""));
  if (!UUID.test(String(ownerUserId || "")) || !HASH.test(String(payloadHash || ""))) fail("auth_email_preparation_invalid", 503);
  const rows = await db(AUTH_EMAIL_COMPLETE_PREPARATION_SQL, [shaped.request_id, shaped.request_hash, tokenHash,
    String(ownerUserId).toLowerCase(), JSON.stringify(envelope), payloadHash]);
  if (!rows[0]) fail("auth_email_preparation_changed", 409);
  return row(rows[0]);
}

export async function releaseAuthEmailPreparation(db, input, token, errorCode) {
  const shaped = authEmailRequestShape(input), tokenHash = sha256Hex(String(token || ""));
  const code = /^[a-z0-9_]{1,100}$/u.test(String(errorCode || "")) ? String(errorCode) : "auth_email_link_generation_failed";
  const rows = await db(AUTH_EMAIL_RELEASE_PREPARATION_SQL, [shaped.request_id, shaped.request_hash, tokenHash, code]);
  return row(rows[0]);
}

export async function recordAuthEmailPreparationUncertain(db, input, token, errorCode) {
  const shaped = authEmailRequestShape(input), tokenHash = sha256Hex(String(token || ""));
  const code = /^[a-z0-9_]{1,100}$/u.test(String(errorCode || "")) ? String(errorCode) : "auth_email_link_generation_uncertain";
  const rows = await db(AUTH_EMAIL_RECORD_PREPARATION_UNCERTAIN_SQL, [shaped.request_id, shaped.request_hash, tokenHash, code]);
  return row(rows[0]);
}

export async function readAuthEmail(db, input) {
  const shaped = authEmailRequestShape(input), rows = await db(AUTH_EMAIL_READ_SQL, [shaped.request_id, shaped.request_hash]);
  if (!rows[0]) fail("auth_email_request_conflict");
  return row(rows[0]);
}

export async function claimAuthEmailDispatch(db, input) {
  const shaped = authEmailRequestShape(input), rows = await db(AUTH_EMAIL_CLAIM_DISPATCH_SQL, [shaped.request_id, shaped.request_hash]);
  return row(rows[0]);
}

export async function retryAuthEmailDispatch(db, input) {
  const shaped = authEmailRequestShape(input);
  try {
    const rows = await db(AUTH_EMAIL_RETRY_DISPATCH_SQL, [shaped.request_id, shaped.request_hash]);
    return row(rows[0]);
  } catch (cause) {
    if (cause?.code === "2200H" || /maximum value.*vy_auth_email_pilot_slot_seq/i.test(String(cause?.message || ""))) {
      fail("auth_email_pilot_cap_reached", 503);
    }
    fail("auth_email_store_unavailable", 503);
  }
}

export async function recordAuthEmailPending(db, input, operationLocation, providerStatus = "Running") {
  const shaped = authEmailRequestShape(input);
  const rows = await db(AUTH_EMAIL_RECORD_PENDING_SQL, [shaped.request_id, shaped.request_hash, operationLocation, providerStatus]);
  if (!rows[0]) fail("auth_email_request_changed");
  return row(rows[0]);
}

export async function recordAuthEmailTerminal(db, input, state, providerStatus, errorCode = "") {
  const shaped = authEmailRequestShape(input);
  const rows = await db(AUTH_EMAIL_RECORD_TERMINAL_SQL, [shaped.request_id, shaped.request_hash, state, providerStatus, errorCode]);
  if (rows[0]) return row(rows[0]);
  const current = await readAuthEmail(db, input);
  if (["succeeded", "failed", "expired"].includes(current.state)) return current;
  fail("auth_email_request_changed");
}

export async function recordAuthEmailReconcile(db, input, code) {
  const shaped = authEmailRequestShape(input);
  const rows = await db(AUTH_EMAIL_RECORD_RECONCILE_SQL, [shaped.request_id, shaped.request_hash, String(code || "auth_email_delivery_pending")]);
  return row(rows[0]);
}

export async function expireAuthEmailPayloads(db) {
  return db(AUTH_EMAIL_EXPIRE_SQL, []);
}

export async function forgetAuthEmailAccount(db, ownerUserId) {
  if (!UUID.test(String(ownerUserId || ""))) fail("auth_email_owner_invalid", 400);
  return db(AUTH_EMAIL_FORGET_SQL, [String(ownerUserId).toLowerCase()]);
}

export async function authEmailSweepRows(db, limit = 25) {
  const bounded = Number.isInteger(limit) ? Math.max(1, Math.min(50, limit)) : 25;
  return (await db(AUTH_EMAIL_SWEEP_ROWS_SQL, [bounded])).map(row);
}

/** Exact parser inventory for root's later read-only EXPLAIN pass. */
export function authEmailSqlCases() {
  const request = "10000000-0000-4000-8000-000000000174";
  const owner = "20000000-0000-4000-8000-000000000174";
  const h = "a".repeat(64), token = "b".repeat(64), now = "2026-10-10T00:00:00.000Z";
  const envelope = JSON.stringify({ algorithm: "AES-256-GCM", key_id: "fixture", ciphertext: "fixture" });
  return Object.freeze([
    { name: "admit", sql: AUTH_EMAIL_ADMIT_SQL, params: [request, h, h, "https://fixture.vercel.app/studio", h, now, "2026-10-10T01:00:00.000Z"] },
    { name: "claim_preparation", sql: AUTH_EMAIL_CLAIM_PREPARATION_SQL, params: [request, h, token] },
    { name: "complete_preparation", sql: AUTH_EMAIL_COMPLETE_PREPARATION_SQL, params: [request, h, token, owner, envelope, h] },
    { name: "release_preparation", sql: AUTH_EMAIL_RELEASE_PREPARATION_SQL, params: [request, h, token, "auth_email_link_generation_failed"] },
    { name: "preparation_uncertain", sql: AUTH_EMAIL_RECORD_PREPARATION_UNCERTAIN_SQL, params: [request, h, token, "auth_email_link_generation_uncertain"] },
    { name: "read", sql: AUTH_EMAIL_READ_SQL, params: [request, h] },
    { name: "claim_dispatch", sql: AUTH_EMAIL_CLAIM_DISPATCH_SQL, params: [request, h] },
    { name: "retry_dispatch", sql: AUTH_EMAIL_RETRY_DISPATCH_SQL, params: [request, h] },
    { name: "record_pending", sql: AUTH_EMAIL_RECORD_PENDING_SQL, params: [request, h, "https://fixture.communication.azure.com/emails/operations/10000000-0000-4000-8000-000000000174?api-version=2023-03-31", "Running"] },
    { name: "record_terminal", sql: AUTH_EMAIL_RECORD_TERMINAL_SQL, params: [request, h, "succeeded", "Succeeded", ""] },
    { name: "record_reconcile", sql: AUTH_EMAIL_RECORD_RECONCILE_SQL, params: [request, h, "auth_email_retry_horizon_elapsed"] },
    { name: "expire", sql: AUTH_EMAIL_EXPIRE_SQL, params: [] },
    { name: "forget", sql: AUTH_EMAIL_FORGET_SQL, params: [owner] },
    { name: "sweep_rows", sql: AUTH_EMAIL_SWEEP_ROWS_SQL, params: [25] },
  ]);
}
