import { finiteScore, fail } from "./errors.js";
import { abortAfter, boundedJson } from "./http.js";
import { fetchVerifiedDocument, validateDocumentDescriptor } from "./media.js";
import { openSession, sealSession } from "./seal.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

function exactRequest(payload, config) {
  if (!config.liveness.enabled) fail("face_liveness_disabled");
  if (payload?.protocol !== config.liveness.protocol || payload?.verifier_version !== config.version)
    fail("liveness_session_protocol_binding_invalid", 400);
  const requestId = String(payload?.request_id || "");
  const challengeId = String(payload?.challenge_id || "");
  const replicaId = String(payload?.replica_id || "");
  if (!/^([0-9a-f-]{36}):([1-9]\d*)$/i.test(requestId) || !UUID.test(challengeId) || !UUID.test(replicaId) ||
      !requestId.startsWith(`${challengeId}:`)) fail("liveness_session_request_invalid", 400);
  return { requestId, challengeId, replicaId };
}

function exactDeviceId(value) {
  const id = String(value || "");
  if (!UUID.test(id)) fail("liveness_device_correlation_invalid", 400);
  return id;
}

function clock(options) {
  const value = typeof options.now === "function" ? options.now() : options.now;
  const now = value instanceof Date ? value : new Date(value ?? Date.now());
  if (!Number.isFinite(now.getTime())) fail("verification_clock_invalid", 500);
  return now;
}

function faceUrl(config, path = "") {
  return `${config.face.endpoint}/face/${config.face.apiVersion}/detectLivenessWithVerify-sessions${path}`;
}

function faceHeaders(config) {
  return { "Ocp-Apim-Subscription-Key": config.face.key };
}

async function deleteAzureSession(sessionId, config, options) {
  let response;
  try {
    response = await (options.fetchImpl || fetch)(faceUrl(config, `/${sessionId}`), {
      method: "DELETE",
      headers: faceHeaders(config),
      redirect: "error",
      signal: abortAfter(config.limits.providerDeadlineMs, options.signal),
    });
  } catch { fail("face_liveness_delete_unreachable"); }
  if (response.status !== 204 && response.status !== 404)
    fail(`face_liveness_delete_http_${response.status}`, response.status >= 500 ? 503 : 409);
  return true;
}

async function exchangeQuickLink(authToken, config, options) {
  let response;
  try {
    response = await (options.fetchImpl || fetch)(config.liveness.quickLinkEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      redirect: "error",
      signal: abortAfter(config.limits.providerDeadlineMs, options.signal),
    });
  } catch { fail("face_liveness_quick_link_unreachable"); }
  if (!response.ok) fail(`face_liveness_quick_link_http_${response.status}`, response.status >= 500 ? 503 : 409);
  const result = await boundedJson(response, 8_192, "face_liveness_quick_link_invalid");
  let link;
  try { link = new URL(String(result?.url || ""), config.liveness.quickLinkOrigin); }
  catch { fail("face_liveness_quick_link_invalid"); }
  const sessionKey = link.searchParams.get("s");
  if (link.origin !== config.liveness.quickLinkOrigin || link.pathname !== "/" || link.hash ||
      !UUID.test(sessionKey) || [...link.searchParams.keys()].some((key) => key !== "s"))
    fail("face_liveness_quick_link_invalid");
  link.searchParams.set("callbackUrl", config.liveness.returnUrl);
  return link.toString();
}

function sessionBinding(payload, config, options) {
  const ids = exactRequest(payload, config);
  const value = openSession(payload?.session_handle, config.liveness.sealKey);
  const now = clock(options);
  if (value?.v !== 1 || value.requestId !== ids.requestId || value.challengeId !== ids.challengeId ||
      value.replicaId !== ids.replicaId || value.modelVersion !== config.liveness.modelVersion ||
      !UUID.test(value.sessionId) || !SHA256.test(value.referenceSha256) ||
      !Number.isFinite(Date.parse(value.handleExpiresAt)) || Date.parse(value.handleExpiresAt) <= now.getTime())
    fail("liveness_session_handle_binding_invalid", 400);
  return { ...ids, value, now };
}

export async function createLivenessSession(payload, config, options = {}) {
  const ids = exactRequest(payload, config);
  const now = clock(options);
  const descriptor = validateDocumentDescriptor(payload?.identity_reference, config, now.getTime());
  if (!new Set(["image/jpeg", "image/png"]).has(descriptor.mime)) fail("liveness_reference_image_required", 409);
  const deviceCorrelationId = exactDeviceId(payload?.device_correlation_id);
  const bytes = await fetchVerifiedDocument(descriptor, config, options);
  if (bytes.length < 1_024 || bytes.length > 6 * 1_024 * 1_024) fail("liveness_reference_size_invalid", 409);
  const parameters = {
    livenessOperationMode: "PassiveActive",
    deviceCorrelationId,
    deviceCorrelationIdSetInClient: false,
    enableSessionImage: false,
    authTokenTimeToLiveInSeconds: config.liveness.sessionTtlSeconds,
    livenessModelVersion: config.liveness.modelVersion,
    returnVerifyImageHash: true,
    verifyConfidenceThreshold: config.liveness.verifyThreshold,
  };
  const form = new FormData();
  form.append("Parameters", new Blob([JSON.stringify(parameters)], { type: "application/json" }), "parameters.json");
  form.append("VerifyImage", new Blob([bytes], { type: descriptor.mime }), descriptor.mime === "image/png" ? "reference.png" : "reference.jpg");
  let response;
  try {
    response = await (options.fetchImpl || fetch)(faceUrl(config), {
      method: "POST",
      headers: faceHeaders(config),
      body: form,
      redirect: "error",
      signal: abortAfter(config.limits.providerDeadlineMs, options.signal),
    });
  } catch { fail("face_liveness_session_unreachable"); }
  if (!response.ok) fail(`face_liveness_session_http_${response.status}`, response.status >= 500 ? 503 : 409);
  const created = await boundedJson(response, config.limits.providerBytes, "face_liveness_session_response_invalid");
  const sessionId = String(created?.sessionId || "");
  const authToken = String(created?.authToken || "");
  const references = created?.results?.verifyReferences;
  if (!UUID.test(sessionId) || authToken.length < 32 || authToken.length > 8_192 ||
      created?.status !== "NotStarted" || created?.modelVersion !== config.liveness.modelVersion ||
      !Array.isArray(references) || references.length !== 1 || references[0]?.qualityForRecognition !== "high") {
    if (UUID.test(sessionId)) await deleteAzureSession(sessionId, config, options).catch(() => {});
    fail("face_liveness_session_binding_invalid");
  }
  let quickLink;
  try { quickLink = await exchangeQuickLink(authToken, config, options); }
  catch (error) {
    await deleteAzureSession(sessionId, config, options).catch(() => {});
    throw error;
  }
  const sessionExpiresAt = new Date(now.getTime() + config.liveness.sessionTtlSeconds * 1_000).toISOString();
  const handleExpiresAt = new Date(now.getTime() + 24 * 60 * 60_000).toISOString();
  const handle = sealSession({
    v: 1,
    requestId: ids.requestId,
    challengeId: ids.challengeId,
    replicaId: ids.replicaId,
    referenceSha256: descriptor.expectedHash,
    sessionId,
    modelVersion: config.liveness.modelVersion,
    sessionExpiresAt,
    handleExpiresAt,
  }, config.liveness.sealKey, options);
  return Object.freeze({
    request_id: ids.requestId,
    reference_sha256: descriptor.expectedHash,
    provider_accepted: true,
    model_version: config.liveness.modelVersion,
    session_expires_at: sessionExpiresAt,
    session_handle: handle,
    quick_link_url: quickLink,
  });
}

function safeProviderCode(value) {
  return String(value || "face_liveness_failed").replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 80) || "face_liveness_failed";
}

export async function getLivenessResult(payload, config, options = {}) {
  const binding = sessionBinding(payload, config, options);
  let response;
  try {
    response = await (options.fetchImpl || fetch)(faceUrl(config, `/${binding.value.sessionId}`), {
      method: "GET",
      headers: faceHeaders(config),
      redirect: "error",
      signal: abortAfter(config.limits.providerDeadlineMs, options.signal),
    });
  } catch { fail("face_liveness_result_unreachable"); }
  if (!response.ok) fail(`face_liveness_result_http_${response.status}`, response.status >= 500 ? 503 : 409);
  const result = await boundedJson(response, config.limits.providerBytes, "face_liveness_result_invalid");
  if (result?.sessionId !== binding.value.sessionId || result?.modelVersion !== binding.value.modelVersion)
    fail("face_liveness_result_binding_invalid");
  const attempts = Array.isArray(result?.results?.attempts) ? result.results.attempts : [];
  const references = result?.results?.verifyReferences;
  if (!Array.isArray(references) || references.length !== 1 || references[0]?.qualityForRecognition !== "high")
    fail("face_liveness_reference_binding_invalid");
  const latest = attempts.reduce((best, attempt) => {
    const id = Number(attempt?.attemptId);
    return Number.isSafeInteger(id) && id > Number(best?.attemptId || 0) ? attempt : best;
  }, null);
  if (!latest || ["NotStarted", "Running"].includes(latest.attemptStatus) || ["NotStarted", "Running"].includes(result.status)) {
    return Object.freeze({
      request_id: binding.requestId,
      reference_sha256: binding.value.referenceSha256,
      provider_accepted: true,
      terminal: false,
      model_version: binding.value.modelVersion,
    });
  }
  if (latest.attemptStatus !== "Succeeded") {
    return Object.freeze({
      request_id: binding.requestId,
      reference_sha256: binding.value.referenceSha256,
      provider_accepted: true,
      terminal: true,
      passed: false,
      liveness_passed: false,
      identity_match: false,
      identity_score: 0,
      failure_code: safeProviderCode(latest?.error?.code),
      model_version: binding.value.modelVersion,
    });
  }
  const digest = String(latest?.result?.digest || "").toLowerCase();
  const verifyHash = String(latest?.result?.verifyImageHash || "").toLowerCase();
  const identityScore = finiteScore(latest?.verifyResult?.matchConfidence, "face_liveness_identity_score_invalid");
  if (!SHA256.test(digest) || verifyHash !== binding.value.referenceSha256)
    fail("face_liveness_evidence_binding_invalid");
  const livenessPassed = String(latest?.result?.livenessDecision || "").toLowerCase() === "realface";
  const identityMatch = latest?.verifyResult?.isIdentical === true && identityScore >= config.liveness.verifyThreshold;
  return Object.freeze({
    request_id: binding.requestId,
    reference_sha256: binding.value.referenceSha256,
    provider_accepted: true,
    terminal: true,
    passed: livenessPassed && identityMatch,
    liveness_passed: livenessPassed,
    identity_match: identityMatch,
    identity_score: identityScore,
    provider_digest: digest,
    verify_image_hash: verifyHash,
    failure_code: livenessPassed ? (identityMatch ? "" : "face_identity_mismatch") : "face_liveness_failed",
    model_version: binding.value.modelVersion,
  });
}

export async function deleteLivenessSession(payload, config, options = {}) {
  const binding = sessionBinding(payload, config, options);
  await deleteAzureSession(binding.value.sessionId, config, options);
  return Object.freeze({
    request_id: binding.requestId,
    reference_sha256: binding.value.referenceSha256,
    provider_deleted: true,
  });
}
