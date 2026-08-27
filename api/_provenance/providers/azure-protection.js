import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isSyntheticAudioDisclosure } from "../../_voice/contracts.js";
import { C2PA_STANDARD, DISCLOSURE_SCHEME, canonicalJson, sha256Hex } from "../contracts.js";

const PROTOCOL = "vyakti-audio-protection/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code, status = 503) {
  throw Object.assign(new Error(code), { code, status });
}

function secret(value, code) {
  const raw = String(value || "");
  let bytes;
  try { bytes = /^[0-9a-f]{64,}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64url"); }
  catch { fail(code); }
  if (!bytes || bytes.length < 32) fail(code);
  return bytes;
}

export function azureProtectionConfig(env = process.env) {
  let origin;
  try { origin = new URL(String(env.AZURE_AUDIO_PROTECTION_ORIGIN || "")); }
  catch { fail("audio_protection_origin_required"); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
    fail("audio_protection_origin_invalid");
  const configuredMax = Number(env.REPLICA_PROTECTION_MAX_PCM_BYTES || 33_554_432);
  if (!Number.isSafeInteger(configuredMax) || configuredMax < 1_048_576 || configuredMax > 67_108_864)
    fail("audio_protection_max_pcm_invalid");
  return Object.freeze({
    origin: origin.origin,
    transportSecret: secret(env.AZURE_AUDIO_PROTECTION_HMAC_SECRET, "audio_protection_hmac_secret_required"),
    tokenSecret: secret(env.REPLICA_WATERMARK_TOKEN_SECRET, "watermark_token_secret_required"),
    commitmentSecret: secret(env.REPLICA_COMMITMENT_SECRET, "replica_commitment_secret_required"),
    maxPcmBytes: configuredMax,
  });
}

function hmac(secretBytes, value) {
  return createHmac("sha256", secretBytes).update(value).digest("base64url");
}

function requestSignature(config, method, path, timestamp, nonce, bodyHash) {
  return hmac(config.transportSecret, [PROTOCOL, method, path, timestamp, nonce, bodyHash].join("\n"));
}

function responseSignature(config, path, nonce, status, bodyHash) {
  return hmac(config.transportSecret, [PROTOCOL, "response", path, nonce, String(status), bodyHash].join("\n"));
}

function equalSignature(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length >= 32 && timingSafeEqual(a, b);
}

async function remoteJson(config, path, payload, fetchImpl, signal) {
  const body = Buffer.from(canonicalJson(payload));
  const bodyHash = sha256Hex(body);
  const timestamp = new Date().toISOString();
  const nonce = randomBytes(18).toString("base64url");
  let response;
  try {
    response = await fetchImpl(`${config.origin}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vyakti-Protocol": PROTOCOL,
        "X-Vyakti-Timestamp": timestamp,
        "X-Vyakti-Nonce": nonce,
        "X-Vyakti-Content-SHA256": bodyHash,
        "X-Vyakti-Signature": requestSignature(config, "POST", path, timestamp, nonce, bodyHash),
      },
      body,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
  } catch { fail("audio_protection_unreachable"); }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100_663_296) fail("audio_protection_response_too_large");
  const responseHash = sha256Hex(bytes);
  const expected = responseSignature(config, path, nonce, response.status, responseHash);
  if (!equalSignature(response.headers.get("x-vyakti-response-signature"), expected))
    fail("audio_protection_response_signature_invalid");
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { fail("audio_protection_response_invalid"); }
  if (!response.ok) fail(String(value?.error || `audio_protection_http_${response.status}`), response.status >= 500 ? 503 : 409);
  return value;
}

async function collectPcm(stream, maxBytes, signal) {
  const chunks = [];
  let total = 0;
  for await (const raw of stream) {
    if (signal?.aborted) throw signal.reason || new Error("audio_protection_aborted");
    const chunk = Buffer.from(raw);
    if (!chunk.length || chunk.length % 2) fail("audio_protection_pcm_invalid", 500);
    total += chunk.length;
    if (total > maxBytes) fail("audio_protection_pcm_too_large", 413);
    chunks.push(chunk);
  }
  if (!total) fail("audio_protection_pcm_empty", 500);
  return Buffer.concat(chunks, total);
}

function byteStream(bytes, chunkBytes = 11_520) {
  return (async function* () {
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
      yield new Uint8Array(bytes.subarray(offset, Math.min(bytes.length, offset + chunkBytes)));
    }
  })();
}

function disclosureAdapter() {
  return Object.freeze({
    name: "provider-bound-audible-disclosure",
    version: "1",
    async prepend({ stream, text, evidence }) {
      if (!isSyntheticAudioDisclosure(text) || typeof evidence?.renderedText !== "string" ||
          !evidence.renderedText.startsWith(`${text} `)) {
        fail("provider_disclosure_evidence_missing", 500);
      }
      const proof = Object.freeze({
        scheme: DISCLOSURE_SCHEME,
        text,
        textHash: sha256Hex(text),
        renderer: String(evidence.renderer || "server-controlled-voice-provider"),
        embedded: true,
      });
      return Object.freeze({ stream, proof });
    },
  });
}

export function createAzureProtectionAdapters({ db, env = process.env, fetchImpl = fetch } = {}) {
  if (typeof db !== "function") fail("audio_protection_db_required");
  const config = azureProtectionConfig(env);
  return Object.freeze({
    disclosure: disclosureAdapter(),
    watermark: Object.freeze({
      name: "audioseal-streaming",
      version: "0.2.0",
      async embed({ stream, format, message, tokenHash, signal, generationId }) {
        const pcm = await collectPcm(stream, config.maxPcmBytes, signal);
        const value = await remoteJson(config, "/v1/watermark", {
          generation_id: generationId,
          sample_rate: format.sampleRate,
          channels: format.channels,
          encoding: format.encoding,
          message: Buffer.from(message).toString("base64url"),
          token_hash: tokenHash,
          pcm_base64: pcm.toString("base64"),
        }, fetchImpl, signal);
        const output = Buffer.from(String(value.audio_base64 || ""), "base64");
        if (!output.length || output.length !== pcm.length || sha256Hex(output) !== value.output_sha256)
          fail("audioseal_output_binding_invalid");
        const proof = Object.freeze({
          algorithm: "audioseal",
          version: "0.2.0-streaming",
          embedded: value.embedded === true,
          streaming: value.streaming === true,
          tokenHash: String(value.token_hash || ""),
          detectorPolicyHash: String(value.detector_policy_hash || ""),
          outputSha256: value.output_sha256,
          verificationConfidence: Number(value.verification_confidence),
          messageVerified: value.message_verified === true,
        });
        if (proof.embedded !== true || proof.streaming !== true || proof.tokenHash !== tokenHash ||
            proof.messageVerified !== true || !Number.isFinite(proof.verificationConfidence) ||
            proof.verificationConfidence < 0.5 || proof.verificationConfidence > 1 ||
            !/^[0-9a-f]{64}$/.test(proof.detectorPolicyHash) || !/^[0-9a-f]{64}$/.test(proof.outputSha256)) {
          fail("audioseal_proof_invalid");
        }
        return Object.freeze({ stream: byteStream(output), proof, completion: Promise.resolve(proof) });
      },
    }),
    contentCredentials: Object.freeze({
      name: "c2pa-python-sidecar",
      version: "0.37.6",
      async createManifest({ generationId, assetHash, assetFormat, assetBytes, signal }) {
        if (!UUID.test(String(generationId || "")) || !(assetBytes instanceof Uint8Array) || sha256Hex(assetBytes) !== assetHash)
          fail("c2pa_asset_binding_invalid", 500);
        const value = await remoteJson(config, "/v1/c2pa", {
          generation_id: generationId,
          asset_hash: assetHash,
          sample_rate: assetFormat.sampleRate,
          channels: assetFormat.channels,
          encoding: assetFormat.encoding,
          pcm_base64: Buffer.from(assetBytes).toString("base64"),
        }, fetchImpl, signal);
        const manifest = Buffer.from(String(value.manifest_base64 || ""), "base64");
        if (manifest.length < 64 || manifest.length > 1_048_576 || sha256Hex(manifest) !== value.manifest_hash)
          fail("c2pa_manifest_binding_invalid");
        const stored = await db(
          `insert into vy_replica_c2pa_manifest
             (generation_id,standard,manifest_sha256,manifest_bytes,signer_key_id)
           select g.generation_id,$2,$3,decode($4,'base64'),$5
             from vy_replica_generation g where g.generation_id=$1 and g.state='streaming'
           on conflict (generation_id) do update set generation_id=excluded.generation_id
            where vy_replica_c2pa_manifest.standard=excluded.standard
              and vy_replica_c2pa_manifest.manifest_sha256=excluded.manifest_sha256
              and vy_replica_c2pa_manifest.signer_key_id=excluded.signer_key_id
           returning generation_id`,
          [generationId, C2PA_STANDARD, value.manifest_hash, manifest.toString("base64"), value.signer_key_id],
        );
        if (!stored[0]) fail("c2pa_manifest_persistence_denied");
        return Object.freeze({
          standard: C2PA_STANDARD,
          location: "external",
          assetHash,
          manifestHash: value.manifest_hash,
          signerKeyId: value.signer_key_id,
          signatureAlgorithm: value.signature_algorithm,
          signature: value.signature,
        });
      },
    }),
    signer: Object.freeze({
      name: "azure-key-vault-es256",
      version: "1",
      async sign({ bytes, purpose, signal }) {
        const value = await remoteJson(config, "/v1/sign", {
          purpose: String(purpose || ""),
          payload_base64: Buffer.from(bytes).toString("base64"),
          payload_sha256: sha256Hex(bytes),
        }, fetchImpl, signal);
        if (value.algorithm !== "ES256" || !value.key_id || String(value.signature || "").length < 64)
          fail("key_vault_signature_invalid");
        return Object.freeze({ algorithm: value.algorithm, keyId: value.key_id, signature: value.signature });
      },
    }),
    tokenIssuer: Object.freeze({
      name: "hmac-watermark-token-issuer",
      version: "1",
      async issue({ generationId, replicaId, policyVersion }) {
        const token = createHmac("sha256", config.tokenSecret)
          .update(canonicalJson({ protocol: PROTOCOL, generationId, replicaId, policyVersion }))
          .digest();
        return Object.freeze({ message: new Uint8Array(token.subarray(0, 2)), tokenHash: sha256Hex(token) });
      },
    }),
    replicaCommitter: Object.freeze({
      name: "hmac-replica-commitment",
      version: "1",
      async commit(input) {
        return createHmac("sha256", config.commitmentSecret)
          .update(canonicalJson({ protocol: PROTOCOL, ...input }))
          .digest("hex");
      },
    }),
  });
}
