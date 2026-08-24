import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../../_provenance/contracts.js";
import { createSignedReplicaRead } from "../../_replica-storage.js";

const PROTOCOL = "vyakti-azure-liveness-session-broker/v1";
const MAX_RESPONSE_BYTES = 65_536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code, status = 503) {
  throw Object.assign(new Error(code), { code, status });
}

function exactKey(value, code) {
  const encoded = String(value || "");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) fail(code);
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) fail(code);
  return key;
}

function exactOrigin(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { fail("azure_face_session_origin_required"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname.replace(/\/+$/, "") ||
      ![".azurecontainerapps.io", ".azurewebsites.net"].some((suffix) => host.endsWith(suffix))) {
    fail("azure_face_session_origin_invalid");
  }
  return url.origin;
}

function pinned(value, code) {
  const output = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._+-]{4,95}$/i.test(output) || /latest|preview-head/i.test(output)) fail(code);
  return output;
}

export function azureFaceSessionConfig(env = process.env, options = {}) {
  if (options.allowDisabledForDeletion !== true &&
      String(env.AZURE_FACE_SESSION_BROKER_ENABLED || "").toLowerCase() !== "true")
    fail("azure_face_session_disabled");
  if (options.allowDisabledForDeletion !== true &&
      String(env.AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED || "").toLowerCase() !== "true")
    fail("azure_face_liveness_approval_required");
  if (String(env.AZURE_FACE_DEDICATED_RESOURCE || "").toLowerCase() !== "true")
    fail("azure_face_dedicated_resource_required");
  return Object.freeze({
    origin: exactOrigin(env.AZURE_FACE_SESSION_BROKER_ORIGIN),
    hmacKey: exactKey(env.AZURE_FACE_SESSION_BROKER_HMAC_KEY_B64, "azure_face_session_hmac_key_required"),
    deviceKey: exactKey(env.AZURE_FACE_DEVICE_CORRELATION_HMAC_KEY_B64, "azure_face_device_key_required"),
    version: pinned(env.AZURE_FACE_SESSION_BROKER_VERSION, "azure_face_session_version_required"),
    modelVersion: pinned(env.AZURE_FACE_LIVENESS_MODEL_VERSION, "azure_face_liveness_model_version_required"),
  });
}

function signature(key, body) {
  return createHmac("sha256", key).update(body).digest("hex");
}

function signatureBytes(value) {
  const raw = String(value || "").replace(/^sha256=/i, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.alloc(0);
}

async function boundedText(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) fail("azure_face_session_response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      fail("azure_face_session_response_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

function uuidFromDigest(digest) {
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function faceDeviceCorrelationId(ownerUserId, clientDeviceId, key) {
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(clientDeviceId || "")) ||
      !Buffer.isBuffer(key) || key.length !== 32) fail("azure_face_device_binding_invalid", 400);
  const digest = createHmac("sha256", key)
    .update(`vyakti-face-device/v1:${ownerUserId}:${clientDeviceId}`)
    .digest();
  return uuidFromDigest(digest);
}

function exactIso(value, code) {
  const raw = String(value || "");
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime()) || date.toISOString() !== raw) fail(code);
  return raw;
}

export function createAzureFaceSessionBroker(options = {}) {
  const config = azureFaceSessionConfig(options.env || process.env, options);
  const fetchImpl = options.fetchImpl || fetch;
  const signRead = options.signRead || ((path) => createSignedReplicaRead(path, { expiresIn: 120 }));
  async function call(path, payload, request = {}) {
    let lastError;
    const attempts = Math.max(1, Math.min(2, Number(request.attempts || 2)));
    const timeoutMs = Math.max(5_000, Math.min(90_000, Number(request.timeoutMs || 90_000)));
    for (let attempt = 0; attempt < attempts; attempt++) {
      const body = canonicalJson({
        ...payload,
        broker_nonce: randomBytes(16).toString("hex"),
        broker_issued_at: new Date().toISOString(),
      });
      try {
        const response = await fetchImpl(`${config.origin}${path}`, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "X-Vyakti-Protocol": PROTOCOL,
            "X-Vyakti-Signature": `sha256=${signature(config.hmacKey, body)}`,
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const raw = await boundedText(response);
        const expected = Buffer.from(signature(config.hmacKey, raw), "hex");
        const actual = signatureBytes(response.headers.get("x-vyakti-response-signature"));
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
          fail("azure_face_session_response_signature_invalid");
        if (!response.ok) {
          const error = Object.assign(new Error(`azure_face_session_http_${response.status}`), {
            code: `azure_face_session_http_${response.status}`,
            status: response.status >= 500 ? 503 : 409,
            ambiguous: response.status >= 500 || (path === "/v1/liveness/session" && response.status === 409),
          });
          if (response.status < 500) throw error;
          lastError = error;
          continue;
        }
        let result;
        try { result = JSON.parse(raw); } catch { fail("azure_face_session_response_invalid"); }
        return result;
      } catch (error) {
        if (error?.ambiguous === false || (error?.code || "").startsWith("azure_face_session_http_4")) throw error;
        lastError = Object.assign(error instanceof Error ? error : new Error("azure_face_session_unreachable"), {
          code: error?.code || "azure_face_session_unreachable",
          status: 503,
          ambiguous: true,
        });
      }
    }
    throw lastError || Object.assign(new Error("azure_face_session_unreachable"), {
      code: "azure_face_session_unreachable", status: 503, ambiguous: true,
    });
  }
  function base(claim) {
    return {
      protocol: PROTOCOL,
      request_id: `${claim.challengeId}:${claim.faceSessionAttempt}`,
      challenge_id: claim.challengeId,
      replica_id: claim.replicaId,
      verifier_version: config.version,
    };
  }
  return Object.freeze({
    name: "azure_face_liveness_quicklink",
    version: config.version,
    modelVersion: config.modelVersion,
    async create(claim) {
      const signed = await signRead(claim.identityReference.objectPath);
      const result = await call("/v1/liveness/session", {
        ...base(claim),
        device_correlation_id: faceDeviceCorrelationId(claim.ownerUserId, claim.clientDeviceId, config.deviceKey),
        identity_reference: {
          url: signed.url,
          expires_at: signed.expires_at,
          sha256: claim.identityReference.sha256,
          byte_size: claim.identityReference.byteSize,
          mime: claim.identityReference.mime,
        },
      }, { attempts: 1, timeoutMs: 90_000 });
      try {
        let link;
        try { link = new URL(String(result?.quick_link_url || "")); }
        catch { fail("azure_face_quick_link_invalid"); }
        const expiresAt = exactIso(result?.session_expires_at, "azure_face_session_expiry_invalid");
        if (result?.request_id !== `${claim.challengeId}:${claim.faceSessionAttempt}` ||
            String(result?.reference_sha256 || "").toLowerCase() !== claim.identityReference.sha256 ||
            result?.provider_accepted !== true || result?.model_version !== config.modelVersion ||
            link.origin !== "https://liveness.face.azure.com" || !UUID.test(link.searchParams.get("s")) ||
            !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(result?.session_handle || "")) ||
            String(result.session_handle).length > 4_096) fail("azure_face_session_response_binding_invalid");
        return Object.freeze({
          requestId: result.request_id,
          referenceSha256: claim.identityReference.sha256,
          modelVersion: config.modelVersion,
          sessionHandle: result.session_handle,
          sessionExpiresAt: expiresAt,
          quickLinkUrl: link.toString(),
        });
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error("azure_face_session_response_invalid"), {
          ambiguous: true,
        });
      }
    },
    async resume(claim) {
      const result = await call("/v1/liveness/resume", {
        ...base(claim),
        session_handle: claim.sessionHandle,
      });
      let link;
      try { link = new URL(String(result?.quick_link_url || "")); }
      catch { fail("azure_face_quick_link_invalid"); }
      const expiresAt = exactIso(result?.session_expires_at, "azure_face_session_expiry_invalid");
      if (result?.request_id !== `${claim.challengeId}:${claim.faceSessionAttempt}` ||
          String(result?.reference_sha256 || "").toLowerCase() !== claim.identityReference.sha256 ||
          result?.provider_accepted !== true || result?.model_version !== config.modelVersion ||
          result?.session_handle !== claim.sessionHandle ||
          link.origin !== "https://liveness.face.azure.com" || !UUID.test(link.searchParams.get("s"))) {
        fail("azure_face_session_resume_binding_invalid");
      }
      return Object.freeze({
        requestId: result.request_id,
        referenceSha256: claim.identityReference.sha256,
        modelVersion: config.modelVersion,
        sessionHandle: result.session_handle,
        sessionExpiresAt: expiresAt,
        quickLinkUrl: link.toString(),
      });
    },
    async result(claim) {
      const result = await call(
        "/v1/liveness/result",
        { ...base(claim), session_handle: claim.sessionHandle },
        { attempts: 1, timeoutMs: 45_000 },
      );
      if (result?.request_id !== `${claim.challengeId}:${claim.faceSessionAttempt}` ||
          String(result?.reference_sha256 || "").toLowerCase() !== claim.identityReference.sha256 ||
          result?.provider_accepted !== true || result?.model_version !== config.modelVersion ||
          typeof result?.terminal !== "boolean") fail("azure_face_result_binding_invalid");
      return Object.freeze(result);
    },
    async delete(claim, request = {}) {
      const result = await call(
        "/v1/liveness/delete",
        { ...base(claim), session_handle: claim.sessionHandle },
        { attempts: 1, timeoutMs: request.timeoutMs || 45_000 },
      );
      if (result?.request_id !== `${claim.challengeId}:${claim.faceSessionAttempt}` ||
          String(result?.reference_sha256 || "").toLowerCase() !== claim.identityReference.sha256 ||
          result?.provider_deleted !== true) fail("azure_face_delete_binding_invalid");
      return true;
    },
    async cleanup() {
      const requestId = `cleanup:${randomUUID()}`;
      const result = await call("/v1/liveness/cleanup", {
        protocol: PROTOCOL,
        verifier_version: config.version,
        request_id: requestId,
      }, { attempts: 1, timeoutMs: 45_000 });
      if (result?.request_id !== requestId || result?.provider_accepted !== true ||
          result?.cleanup_api_version !== "v1.2-preview.1" ||
          result?.exhaustive !== true ||
          !Number.isSafeInteger(result?.sessions_scanned) || result.sessions_scanned < 0 ||
          !Number.isSafeInteger(result?.expired_sessions_deleted) || result.expired_sessions_deleted < 0 ||
          result.expired_sessions_deleted > result.sessions_scanned) fail("azure_face_cleanup_response_invalid");
      return Object.freeze({
        scanned: result.sessions_scanned,
        deleted: result.expired_sessions_deleted,
        scanStartedAt: exactIso(result.scan_started_at, "azure_face_cleanup_cutoff_invalid"),
      });
    },
  });
}

export function createAzureFaceSessionErasureBroker(options = {}) {
  const broker = createAzureFaceSessionBroker({ ...options, allowDisabledForDeletion: true });
  return Object.freeze({
    name: broker.name,
    version: broker.version,
    modelVersion: broker.modelVersion,
    delete: broker.delete,
    cleanup: broker.cleanup,
  });
}
