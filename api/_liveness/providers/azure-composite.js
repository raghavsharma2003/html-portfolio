import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../../_provenance/contracts.js";
import { createSignedReplicaRead } from "../../_replica-storage.js";

// This transport is intentionally incompatible with the old unbound response.
// The repository broker has no composite route yet; this does not enable one.
export const AZURE_COMPOSITE_LIVENESS_PROTOCOL = "vyakti-azure-liveness-broker/v2";
export const AZURE_COMPOSITE_LIVENESS_OPERATION = "liveness.verify";
const PROTOCOL = AZURE_COMPOSITE_LIVENESS_PROTOCOL;
const OPERATION = AZURE_COMPOSITE_LIVENESS_OPERATION;
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

async function boundedResponseText(response, signal) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(Object.assign(new Error("azure_liveness_timeout"), { code: "azure_liveness_timeout", status: 503 }));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) fail("azure_liveness_response_too_large");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size).toString("utf8");
  } finally {
    signal.removeEventListener("abort", onAbort);
    // Cancellation must not itself turn an over-limit/timeout refusal into an
    // unbounded wait on a malicious or broken response stream.
    void reader.cancel().catch(() => {});
  }
}

export function createAzureCompositeLivenessVerifier(options = {}) {
  const config = azureCompositeLivenessConfig(options.env || process.env);
  const fetchImpl = options.fetchImpl || fetch;
  const signRead = options.signRead || ((locator) => createSignedReplicaRead(locator, { expiresIn: 120 }));
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    fail("azure_liveness_timeout_invalid");
  const descriptor = Object.freeze({
    name: "azure_face_speech_composite",
    version: config.version,
    family: "azure_ai",
  });
  return Object.freeze({
    ...descriptor,
    async verify(claim) {
      const [signed, identitySigned] = await Promise.all([
        signRead(claim.source),
        signRead(claim.identityReference),
      ]);
      // Issue freshness only after private capabilities are ready. Each dispatch
      // gets new randomness even when a DB attempt is retried unchanged.
      const nonce = randomBytes(16).toString("hex");
      const payload = canonicalJson({
        protocol: PROTOCOL,
        operation: OPERATION,
        broker_nonce: nonce,
        broker_issued_at: new Date().toISOString(),
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
        identity_reference: {
          source_id: claim.identityReference.sourceId,
          url: identitySigned.url,
          expires_at: identitySigned.expires_at,
          sha256: claim.identityReference.sha256,
          byte_size: claim.identityReference.byteSize,
          mime: claim.identityReference.mime,
        },
        verifier_version: config.version,
      });
      const requestSha256 = createHash("sha256").update(payload).digest("hex");
      const signal = AbortSignal.timeout(timeoutMs);
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
          signal,
        });
      } catch { fail(signal.aborted ? "azure_liveness_timeout" : "azure_liveness_unreachable"); }
      if (response.redirected || (response.status >= 300 && response.status < 400) ||
          (response.url && response.url !== config.endpoint)) {
        void response.body?.cancel().catch(() => {});
        fail("azure_liveness_redirect_refused");
      }
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_RESPONSE_BYTES) {
        void response.body?.cancel().catch(() => {});
        fail("azure_liveness_response_too_large");
      }
      let body;
      try { body = await boundedResponseText(response, signal); }
      catch (error) {
        // Native fetch may reject its reader before our abort listener wins
        // the race. Preserve the same public timeout contract in either order.
        if (signal.aborted) fail("azure_liveness_timeout");
        throw error;
      }
      if (response.status === 404 || response.status === 501) fail("azure_liveness_operation_unavailable");
      if (!response.ok) fail(`azure_liveness_http_${response.status}`, response.status >= 500 ? 503 : 409);
      const expected = Buffer.from(signature(config.hmacKey, body), "hex");
      const actual = safeSignature(response.headers.get("x-vyakti-response-signature"));
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail("azure_liveness_response_signature_invalid");
      let result;
      try { result = JSON.parse(body); } catch { fail("azure_liveness_response_invalid"); }
      if (!result || typeof result !== "object" || Array.isArray(result) ||
          result.protocol !== PROTOCOL || result.operation !== OPERATION ||
          result.verifier_version !== config.version ||
          result.request_nonce !== nonce || result.request_sha256 !== requestSha256 ||
          result.request_id !== `${claim.challengeId}:${claim.attempt}` ||
          result.input_sha256 !== claim.source.sha256) {
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
