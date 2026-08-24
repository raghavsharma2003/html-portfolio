import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../../_provenance/contracts.js";
import { createSignedReplicaRead } from "../../_replica-storage.js";

const PROTOCOL = "vyakti-azure-identity-broker/v1";
const MAX_RESPONSE_BYTES = 65_536;

function fail(code, status = 503) {
  throw Object.assign(new Error(code), { code, status });
}

function checkedEndpoint(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { fail("azure_identity_endpoint_required"); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      ![".azurecontainerapps.io", ".azurewebsites.net"].some((suffix) => hostname.endsWith(suffix)) ||
      url.pathname.replace(/\/+$/, "") !== "/v1/identity/verify") {
    fail("azure_identity_endpoint_invalid");
  }
  return url.toString();
}

function checkedKey(value) {
  let key;
  try { key = Buffer.from(String(value || ""), "base64"); } catch { key = Buffer.alloc(0); }
  if (key.length !== 32) fail("azure_identity_hmac_key_required");
  return key;
}

function pinnedVersion(value) {
  const version = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._+-]{4,95}$/i.test(version) || /latest|preview-head/i.test(version))
    fail("azure_identity_version_must_be_pinned");
  return version;
}

export function azureCompositeIdentityConfig(env = process.env) {
  if (String(env.AZURE_COMPOSITE_IDENTITY_ENABLED || "").toLowerCase() !== "true")
    fail("azure_identity_disabled");
  if (String(env.AZURE_IDENTITY_REVIEW_PATH_APPROVED || "").toLowerCase() !== "true")
    fail("azure_identity_review_path_required");
  return Object.freeze({
    endpoint: checkedEndpoint(env.AZURE_COMPOSITE_IDENTITY_ENDPOINT),
    hmacKey: checkedKey(env.AZURE_COMPOSITE_IDENTITY_HMAC_KEY_B64),
    version: pinnedVersion(env.AZURE_COMPOSITE_IDENTITY_VERSION),
  });
}

function signature(key, body) {
  return createHmac("sha256", key).update(body).digest("hex");
}

function signatureBytes(value) {
  const raw = String(value || "").replace(/^sha256=/, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.alloc(0);
}

async function boundedText(response) {
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
      fail("azure_identity_response_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

export function createAzureCompositeIdentityVerifier(options = {}) {
  const config = azureCompositeIdentityConfig(options.env || process.env);
  const fetchImpl = options.fetchImpl || fetch;
  const signRead = options.signRead || ((path) => createSignedReplicaRead(path, { expiresIn: 120 }));
  const descriptor = Object.freeze({ name: "azure_identity_composite", version: config.version });
  return Object.freeze({
    ...descriptor,
    async verify(claim) {
      const signed = await signRead(claim.source.objectPath);
      const body = canonicalJson({
        protocol: PROTOCOL,
        request_id: `${claim.identityCaseId}:${claim.attempt}`,
        identity_case_id: claim.identityCaseId,
        replica_id: claim.replicaId,
        source_id: claim.sourceId,
        minimum_age: 18,
        document: {
          url: signed.url,
          expires_at: signed.expires_at,
          sha256: claim.source.sha256,
          byte_size: claim.source.byteSize,
          mime: claim.source.mime,
        },
        verifier_version: config.version,
        broker_nonce: randomBytes(16).toString("hex"),
        broker_issued_at: new Date().toISOString(),
      });
      let response;
      try {
        response = await fetchImpl(config.endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "X-Vyakti-Protocol": PROTOCOL,
            "X-Vyakti-Signature": `sha256=${signature(config.hmacKey, body)}`,
          },
          body,
          signal: AbortSignal.timeout(120_000),
        });
      } catch { fail("azure_identity_unreachable"); }
      if (Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES)
        fail("azure_identity_response_too_large");
      const rawBody = await boundedText(response);
      if (!response.ok) fail(`azure_identity_http_${response.status}`, response.status >= 500 ? 503 : 409);
      const expected = Buffer.from(signature(config.hmacKey, rawBody), "hex");
      const actual = signatureBytes(response.headers.get("x-vyakti-response-signature"));
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        fail("azure_identity_response_signature_invalid");
      let result;
      try { result = JSON.parse(rawBody); } catch { fail("azure_identity_response_invalid"); }
      if (result?.request_id !== `${claim.identityCaseId}:${claim.attempt}` ||
          String(result?.input_sha256 || "").toLowerCase() !== claim.source.sha256) {
        fail("azure_identity_response_binding_invalid");
      }
      return Object.freeze({
        providerFamily: descriptor.name,
        verifierVersion: descriptor.version,
        inputSha256: String(result.input_sha256).toLowerCase(),
        providerAccepted: result.provider_accepted === true,
        extractionConfidence: result.extraction_confidence,
        authenticityScore: result.authenticity_score,
        portraitConfidence: result.portrait_confidence,
        documentAuthentic: result.document_authentic === true,
        documentCurrent: result.document_current === true,
        adultEvidence: result.adult_evidence === true,
        faceReferenceReady: result.face_reference_ready === true,
        credentialExpiresAt: result.credential_expires_at,
      });
    },
  });
}
