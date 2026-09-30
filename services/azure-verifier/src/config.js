import { fail } from "./errors.js";

const VERSION = /^[a-z0-9][a-z0-9._+-]{4,95}$/i;

function required(value, code) {
  const output = String(value || "").trim();
  if (!output) fail(code, 500);
  return output;
}

function key(value, code) {
  const encoded = required(value, code);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) fail(code, 500);
  let bytes;
  try { bytes = Buffer.from(encoded, "base64"); } catch { bytes = Buffer.alloc(0); }
  if (bytes.length !== 32 || bytes.toString("base64") !== encoded) fail(code, 500);
  return bytes;
}

function boundedInt(value, fallback, min, max, code) {
  const raw = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(raw) || raw < min || raw > max) fail(code, 500);
  return raw;
}

function boundedFloat(value, min, max, code) {
  const output = Number(value);
  if (!Number.isFinite(output) || output < min || output > max) fail(code, 500);
  return output;
}

function publicOrigin(value) {
  let url;
  try { url = new URL(required(value, "public_app_origin_required")); }
  catch { fail("public_app_origin_required", 500); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname.replace(/\/+$/, "") !== "") fail("public_app_origin_invalid", 500);
  return url.origin;
}

function endpoint(value, suffixes, code, path = "") {
  let url;
  try { url = new URL(required(value, code)); } catch { fail(code, 500); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !suffixes.some((suffix) => host.endsWith(suffix))) fail(code, 500);
  url.pathname = path || url.pathname.replace(/\/+$/, "");
  return url;
}

function pinned(value, code) {
  const version = required(value, code);
  if (!VERSION.test(version) || /latest|preview-head/i.test(version)) fail(code, 500);
  return version;
}

export function loadConfig(env = process.env) {
  // Azure source access is one configured account/container, never a domain allowlist.
  const sourceValue = required(env.VYAKTI_PRIVATE_SOURCE_ORIGIN, "source_origin_required");
  const azureSource = /^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net\/?$/.test(sourceValue);
  if (azureSource && sourceValue !== env.VYAKTI_PRIVATE_SOURCE_ORIGIN) fail("source_origin_required", 500);
  const sourceOrigin = azureSource ? new URL(sourceValue)
    : endpoint(sourceValue, [".supabase.co", ".supabase.net"], "source_origin_required");
  sourceOrigin.pathname = "";
  const sourceAzureContainer = azureSource ? required(env.VYAKTI_PRIVATE_SOURCE_AZURE_CONTAINER, "source_container_required") : "";
  if (azureSource && (sourceAzureContainer !== env.VYAKTI_PRIVATE_SOURCE_AZURE_CONTAINER ||
      !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(sourceAzureContainer) ||
      sourceAzureContainer.includes("--"))) fail("source_container_invalid", 500);
  const reviewEndpoint = endpoint(
    env.AZURE_DOCUMENT_REVIEW_ENDPOINT,
    [".azurecontainerapps.io", ".azurewebsites.net"],
    "document_review_endpoint_required",
    "/v1/document/review",
  );
  const version = pinned(env.VERIFIER_VERSION, "verifier_version_required");
  const livenessEnabled = String(env.AZURE_FACE_LIVENESS_ENABLED || "").toLowerCase() === "true";
  const livenessErasureEnabled = livenessEnabled ||
    String(env.AZURE_FACE_LIVENESS_ERASURE_ENABLED || "").toLowerCase() === "true";
  if (livenessEnabled && String(env.AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED || "").toLowerCase() !== "true")
    fail("face_liveness_approval_required", 500);
  if (livenessErasureEnabled && String(env.AZURE_FACE_DEDICATED_RESOURCE || "").toLowerCase() !== "true")
    fail("face_liveness_dedicated_resource_required", 500);
  return Object.freeze({
    port: boundedInt(env.PORT, 8080, 1, 65_535, "port_invalid"),
    protocol: "vyakti-azure-identity-broker/v1",
    hmacKey: key(env.VYAKTI_BROKER_HMAC_KEY_B64, "broker_hmac_key_required"),
    version,
    sourceOrigin: sourceOrigin.origin,
    sourceProvider: azureSource ? "azure_blob" : "supabase",
    sourceAzureContainer,
    document: Object.freeze({
      endpoint: endpoint(env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, [".cognitiveservices.azure.com"], "document_endpoint_required").origin,
      key: required(env.AZURE_DOCUMENT_INTELLIGENCE_KEY, "document_key_required"),
      apiVersion: "2024-11-30",
      model: "prebuilt-idDocument",
      pollMs: boundedInt(env.DOCUMENT_POLL_MS, 500, 100, 2_000, "document_poll_ms_invalid"),
      maxPolls: boundedInt(env.DOCUMENT_MAX_POLLS, 24, 2, 60, "document_max_polls_invalid"),
    }),
    face: Object.freeze({
      endpoint: endpoint(env.AZURE_FACE_ENDPOINT, [".cognitiveservices.azure.com"], "face_endpoint_required").origin,
      key: required(env.AZURE_FACE_KEY, "face_key_required"),
      apiVersion: "v1.2",
      detectionModel: "detection_03",
      recognitionModel: "recognition_04",
    }),
    liveness: Object.freeze(livenessErasureEnabled ? {
      enabled: livenessEnabled,
      erasureEnabled: true,
      protocol: "vyakti-azure-liveness-session-broker/v1",
      modelVersion: pinned(env.AZURE_FACE_LIVENESS_MODEL_VERSION, "face_liveness_model_version_required"),
      verifyThreshold: boundedFloat(env.AZURE_FACE_VERIFY_CONFIDENCE_THRESHOLD, 0.9, 0.99, "face_verify_threshold_invalid"),
      sessionTtlSeconds: boundedInt(env.AZURE_FACE_LIVENESS_SESSION_TTL_SECONDS, 300, 60, 600, "face_liveness_ttl_invalid"),
      sealKey: key(env.AZURE_LIVENESS_SESSION_SEAL_KEY_B64, "liveness_session_seal_key_required"),
      returnUrl: livenessEnabled
        ? `${publicOrigin(env.VYAKTI_PUBLIC_APP_ORIGIN)}/studio?liveness=return`
        : "",
      quickLinkEndpoint: "https://liveness.face.azure.com/api/quicklink",
      quickLinkOrigin: "https://liveness.face.azure.com",
      cleanupApiVersion: "v1.2-preview.1",
    } : { enabled: false, erasureEnabled: false }),
    review: Object.freeze({
      endpoint: reviewEndpoint.toString(),
      hmacKey: key(env.AZURE_DOCUMENT_REVIEW_HMAC_KEY_B64, "document_review_key_required"),
      version: pinned(env.AZURE_DOCUMENT_REVIEW_VERSION, "document_review_version_required"),
    }),
    limits: Object.freeze({
      requestBytes: 65_536,
      mediaBytes: boundedInt(env.MAX_IDENTITY_BYTES, 52_428_800, 1_048_576, 52_428_800, "max_identity_bytes_invalid"),
      providerBytes: 1_048_576,
      mediaDeadlineMs: 20_000,
      providerDeadlineMs: 30_000,
      totalDeadlineMs: 110_000,
      concurrency: boundedInt(env.MAX_CONCURRENCY, 2, 1, 4, "max_concurrency_invalid"),
    }),
  });
}
