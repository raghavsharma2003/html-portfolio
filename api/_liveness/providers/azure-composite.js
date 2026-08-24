import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../../_provenance/contracts.js";
import { createSignedReplicaRead } from "../../_replica-storage.js";

const PROTOCOL = "vyakti-azure-liveness-broker/v1";
const MAX_RESPONSE_BYTES = 65_536;

function fail(code, status = 503) {
  throw Object.assign(new Error(code), { code, status });
}

function endpoint(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { fail("azure_liveness_endpoint_required"); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      ![".azurecontainerapps.io", ".azurewebsites.net"].some((suffix) => hostname.endsWith(suffix)) ||
      url.pathname.replace(/\/+$/, "") !== "/v1/liveness/verify") {
    fail("azure_liveness_endpoint_invalid");
  }
  return url.toString();
}

function secret(value) {
  let key;
  try { key = Buffer.from(String(value || ""), "base64"); } catch { key = Buffer.alloc(0); }
  if (key.length !== 32) fail("azure_liveness_hmac_key_required");
  return key;
}

function pinnedVersion(value) {
  const version = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._+-]{4,95}$/i.test(version) || /latest|preview-head/i.test(version))
    fail("azure_liveness_version_must_be_pinned");
  return version;
}

export function azureCompositeLivenessConfig(env = process.env) {
  if (String(env.AZURE_COMPOSITE_LIVENESS_ENABLED || "").toLowerCase() !== "true")
    fail("azure_liveness_disabled");
  if (String(env.AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED || "").toLowerCase() !== "true")
    fail("azure_face_liveness_approval_required");
  return Object.freeze({
    endpoint: endpoint(env.AZURE_COMPOSITE_LIVENESS_ENDPOINT),
    hmacKey: secret(env.AZURE_COMPOSITE_LIVENESS_HMAC_KEY_B64),
    version: pinnedVersion(env.AZURE_COMPOSITE_LIVENESS_VERSION),
  });
}

function signature(key, body) {
  return createHmac("sha256", key).update(body).digest("hex");
}

function safeSignature(value) {
  const raw = String(value || "").replace(/^sha256=/, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.alloc(0);
}

async function boundedResponseText(response) {
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
      fail("azure_liveness_response_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

export function createAzureCompositeLivenessVerifier(options = {}) {
  const config = azureCompositeLivenessConfig(options.env || process.env);
  const fetchImpl = options.fetchImpl || fetch;
  const signRead = options.signRead || ((path) => createSignedReplicaRead(path, { expiresIn: 120 }));
  const descriptor = Object.freeze({
    name: "azure_face_speech_composite",
    version: config.version,
    family: "azure_ai",
  });
  return Object.freeze({
    ...descriptor,
    async verify(claim) {
      const signed = await signRead(claim.source.objectPath);
      const payload = canonicalJson({
        protocol: PROTOCOL,
        request_id: `${claim.challengeId}:${claim.attempt}`,
        challenge_id: claim.challengeId,
        replica_id: claim.replicaId,
        source_id: claim.sourceId,
        phrase: claim.phrase,
        phrase_hash: claim.phraseHash,
        media: {
          url: signed.url,
          expires_at: signed.expires_at,
          sha256: claim.source.sha256,
          byte_size: claim.source.byteSize,
          mime: claim.source.mime,
        },
        verifier_version: config.version,
      });
      let response;
      try {
        response = await fetchImpl(config.endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "X-Vyakti-Protocol": PROTOCOL,
            "X-Vyakti-Signature": `sha256=${signature(config.hmacKey, payload)}`,
          },
          body: payload,
          signal: AbortSignal.timeout(120_000),
        });
      } catch { fail("azure_liveness_unreachable"); }
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_RESPONSE_BYTES) fail("azure_liveness_response_too_large");
      const body = await boundedResponseText(response);
      if (!response.ok) fail(`azure_liveness_http_${response.status}`, response.status >= 500 ? 503 : 409);
      const expected = Buffer.from(signature(config.hmacKey, body), "hex");
      const actual = safeSignature(response.headers.get("x-vyakti-response-signature"));
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail("azure_liveness_response_signature_invalid");
      let result;
      try { result = JSON.parse(body); } catch { fail("azure_liveness_response_invalid"); }
      if (result?.request_id !== `${claim.challengeId}:${claim.attempt}` ||
          String(result?.input_sha256 || "").toLowerCase() !== claim.source.sha256) {
        fail("azure_liveness_response_binding_invalid");
      }
      return Object.freeze({
        providerFamily: descriptor.name,
        verifierVersion: descriptor.version,
        inputSha256: String(result.input_sha256).toLowerCase(),
        recognizedText: String(result.recognized_text || ""),
        faceLivenessScore: result.face_liveness_score,
        faceIdentityScore: result.face_identity_score,
        speakerContinuityScore: result.speaker_continuity_score,
        syntheticRiskScore: result.synthetic_risk_score,
        captureBinding: result.capture_binding === true,
        singleSpeaker: result.single_speaker === true,
        providerAccepted: result.provider_accepted === true,
      });
    },
  });
}
