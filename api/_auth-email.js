import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import { encryptAuthEmailPayload, decryptAuthEmailPayload } from "./_auth-email-crypto.js";
import {
  admitAuthEmail, claimAuthEmailPreparation, completeAuthEmailPreparation, readAuthEmail,
  releaseAuthEmailPreparation, recordAuthEmailPreparationUncertain,
  claimAuthEmailDispatch, retryAuthEmailDispatch, recordAuthEmailPending, recordAuthEmailTerminal, recordAuthEmailReconcile,
  expireAuthEmailPayloads, authEmailSweepRows,
} from "./_auth-email-store.js";
import {
  authEmailAzureConfig, approvedAuthEmailRedirect, generateSupabaseAuthEmailLink,
  sendAzureAuthEmail, readAzureAuthEmail, validateAcsOperationLocation, validateAuthEmailPayload,
} from "./_auth-email-azure.js";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const REPEATABILITY_MS = 5 * 60 * 1000;
const fail = (code, status = 503) => { throw Object.assign(new Error(code), { code, status }); };
const publicState = (row) => ({ request_id: row.request_id, state: ["succeeded", "failed", "expired"].includes(row.state) ? row.state : "accepted" });

function binding(row) {
  return { request_id: row.request_id, email_hash: row.email_hash, redirect_hash: row.redirect_hash, payload_hash: row.payload_hash };
}

async function prepare(db, request, row, config, options) {
  const claim = await claimAuthEmailPreparation(db, request);
  if (!claim) return readAuthEmail(db, request);
  let generated;
  try {
    generated = await (options.generateLink || generateSupabaseAuthEmailLink)(config,
      { email: request.email, redirect_url: request.redirect_url }, options.fetchImpl);
    const payload = { schema: "vyakti.auth-email-payload/v1", email: request.email,
      action_link: generated.action_link, email_otp: generated.email_otp, verification_type: generated.verification_type };
    const payloadHash = sha256Hex(canonicalJson(payload));
    const envelope = encryptAuthEmailPayload(payload, { request_id: row.request_id, email_hash: row.email_hash,
      redirect_hash: row.redirect_hash, payload_hash: payloadHash }, options.env);
    return await completeAuthEmailPreparation(db, request, claim.token, generated.owner_user_id, envelope, payloadHash);
  } catch (cause) {
    if (cause?.definitive) {
      await releaseAuthEmailPreparation(db, request, claim.token, cause?.code || "auth_email_link_generation_failed").catch(() => {});
    } else {
      await recordAuthEmailPreparationUncertain(db, request, claim.token,
        cause?.code || "auth_email_link_generation_uncertain").catch(() => {});
    }
    throw cause;
  } finally {
    if (generated) {
      generated.action_link = "";
      generated.email_otp = "";
    }
  }
}

async function dispatch(db, request, row, config, options, now) {
  if (row.state === "prepared") row = await claimAuthEmailDispatch(db, request) || await readAuthEmail(db, request);
  if (row.state !== "dispatching") return row;
  const firstSent = new Date(row.repeatability_first_sent).getTime();
  if (!Number.isFinite(firstSent) || now - firstSent > REPEATABILITY_MS) {
    return await recordAuthEmailReconcile(db, request, "auth_email_retry_horizon_elapsed") || row;
  }
  const payload = decryptAuthEmailPayload(row.payload_envelope, binding(row), options.env);
  try {
    validateAuthEmailPayload(config, payload, request);
    const sent = await (options.sendEmail || sendAzureAuthEmail)(config, {
      ...payload, operation_id: row.acs_operation_id, repeatability_first_sent: row.repeatability_first_sent,
    }, options.fetchImpl);
    return await recordAuthEmailPending(db, request, sent.operation_location, "Running");
  } catch (cause) {
    if (cause?.definitive) return recordAuthEmailTerminal(db, request, "failed", "Failed", "auth_email_delivery_failed");
    if (cause?.ambiguous) return row;
    throw cause;
  } finally {
    payload.email = ""; payload.action_link = ""; payload.email_otp = "";
  }
}

async function poll(db, request, row, config, options) {
  if (!["dispatching", "pending", "reconcile_required"].includes(row.state)) return row;
  const location = validateAcsOperationLocation(config, row.operation_location, row.acs_operation_id);
  if (!location) fail("auth_email_provider_response_invalid");
  let result;
  try { result = await (options.readEmail || readAzureAuthEmail)(config,
    { operation_id: row.acs_operation_id, operation_location: location }, options.fetchImpl); }
  catch (cause) { if (cause?.ambiguous) return row; throw cause; }
  const current = Number.isFinite(options.clockNow) ? options.clockNow : Date.now();
  if (result.status === "NotStarted" && current - new Date(row.repeatability_first_sent).getTime() > REPEATABILITY_MS) {
    return await recordAuthEmailReconcile(db, request, "auth_email_retry_horizon_elapsed") || row;
  }
  if (result.status === "Succeeded") return recordAuthEmailTerminal(db, request, "succeeded", "Succeeded");
  if (result.status === "Failed") return recordAuthEmailTerminal(db, request, "failed", "Failed", "auth_email_delivery_failed");
  return row.state === "reconcile_required" ? row : recordAuthEmailPending(db, request, location, result.status);
}

/** Returns null while the provider flag is dark; account.js then uses its unchanged Supabase mail path. */
export async function requestVyaktiAuthEmail(db, input, options = {}) {
  if (typeof db !== "function") fail("auth_email_store_unavailable");
  const config = options.config === undefined ? await authEmailAzureConfig(options.env) : options.config;
  if (config === null) return null;
  if (!config) fail("auth_email_provider_unavailable");
  const email = String(input?.email || "").trim().toLowerCase();
  if (!EMAIL.test(email)) fail("auth_email_request_invalid", 400);
  const redirect_url = approvedAuthEmailRedirect(input?.redirect_url, config);
  if (!redirect_url) fail("auth_email_redirect_invalid", 400);
  const request = {
    request_id: input?.request_id,
    email,
    email_hash: sha256Hex(email),
    redirect_url,
    redirect_hash: sha256Hex(redirect_url),
  };
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  await expireAuthEmailPayloads(db);
  let row = await admitAuthEmail(db, request, now);
  if (row.state === "admitted" || row.state === "preparing") row = await prepare(db, request, row, config, options);
  if (row.state === "pending" && row.provider_status === "NotStarted") {
    const age = now - new Date(row.repeatability_first_sent).getTime();
    row = age <= REPEATABILITY_MS ? await retryAuthEmailDispatch(db, request) || row
      : await recordAuthEmailReconcile(db, request, "auth_email_retry_horizon_elapsed") || row;
  }
  row = await dispatch(db, request, row, config, options, now);
  if (Number(row.attempt_count) > 0) row = await poll(db, request, row, config, { ...options, clockNow: now });
  if (row.state === "preparing" && now >= new Date(row.preparation_lease_expires_at).getTime()) {
    fail("auth_email_link_generation_uncertain", 409);
  }
  if (row.state === "failed") fail("auth_email_delivery_failed");
  if (row.state === "expired") fail("auth_email_request_expired", 409);
  if (row.state === "reconcile_required") fail(row.last_error_code || "auth_email_delivery_uncertain", 409);
  return publicState(row);
}

export async function runAuthEmailSweep(db, options = {}) {
  if (typeof db !== "function") fail("auth_email_store_unavailable");
  const expired = await expireAuthEmailPayloads(db);
  const config = options.config === undefined ? await authEmailAzureConfig(options.env) : options.config;
  if (!config) return { disabled: true, expired: expired.length, checked: 0, succeeded: 0, failed: 0 };
  const rows = await authEmailSweepRows(db, options.limit);
  let succeeded = 0, failed = 0;
  for (const row of rows) {
    const request = { request_id: row.request_id, request_hash: row.request_hash, email_hash: row.email_hash,
      redirect_hash: row.redirect_hash, redirect_url: row.redirect_url };
    const next = await poll(db, request, row, config, options).catch(() => row);
    if (next.state === "succeeded") succeeded += 1;
    if (next.state === "failed") failed += 1;
  }
  return { disabled: false, expired: expired.length, checked: rows.length, succeeded, failed };
}
