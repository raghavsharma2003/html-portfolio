import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAzureProtectionAdapters, azureProtectionConfig } from "../../api/_provenance/providers/azure-protection.js";
import { createProductionProtectionAdapters } from "../../api/_provenance/registry.js";
import { canonicalJson, sha256Hex } from "../../api/_provenance/contracts.js";
import { createReplicaProvenanceHandler } from "../../api/_replica-provenance.js";
import { SYNTHETIC_AUDIO_DISCLOSURE, VOICE_PCM_FORMAT } from "../../api/_voice/contracts.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GENERATION = "80000000-0000-4000-8000-000000000008";
const TRANSPORT = Buffer.alloc(32, 17).toString("base64url");
const TOKEN = Buffer.alloc(32, 23).toString("base64url");
const COMMITMENT = Buffer.alloc(32, 31).toString("base64url");
const ENV = {
  AZURE_AUDIO_PROTECTION_ORIGIN: "https://protector.internal",
  AZURE_AUDIO_PROTECTION_HMAC_SECRET: TRANSPORT,
  REPLICA_WATERMARK_TOKEN_SECRET: TOKEN,
  REPLICA_COMMITMENT_SECRET: COMMITMENT,
};
const PROTOCOL = "vyakti-audio-protection/v1";
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

function hmac(value) {
  return createHmac("sha256", Buffer.from(TRANSPORT, "base64url")).update(value).digest("base64url");
}

function signedResponse(path, nonce, status, payload, bad = false) {
  const body = Buffer.from(canonicalJson(payload));
  const signature = hmac([PROTOCOL, "response", path, nonce, String(status), sha256Hex(body)].join("\n"));
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json", "X-Vyakti-Response-Signature": bad ? `${signature}x` : signature },
  });
}

const calls = [];
const mockFetch = async (url, init) => {
  const path = new URL(url).pathname;
  const body = Buffer.from(init.body);
  const headers = new Headers(init.headers);
  const timestamp = headers.get("x-vyakti-timestamp");
  const nonce = headers.get("x-vyakti-nonce");
  const bodyHash = sha256Hex(body);
  const expected = hmac([PROTOCOL, "POST", path, timestamp, nonce, bodyHash].join("\n"));
  assert.equal(headers.get("x-vyakti-protocol"), PROTOCOL);
  assert.equal(headers.get("x-vyakti-content-sha256"), bodyHash);
  assert.equal(headers.get("x-vyakti-signature"), expected);
  const payload = JSON.parse(body);
  calls.push({ path, payload });
  if (path === "/v1/watermark") {
    const pcm = Buffer.from(payload.pcm_base64, "base64");
    return signedResponse(path, nonce, 200, {
      audio_base64: pcm.toString("base64"),
      output_sha256: sha256Hex(pcm),
      token_hash: payload.token_hash,
      detector_policy_hash: "d".repeat(64),
      embedded: true,
      streaming: true,
      verification_confidence: 0.97,
      message_verified: true,
    });
  }
  if (path === "/v1/c2pa") {
    const manifest = Buffer.alloc(128, 73);
    return signedResponse(path, nonce, 200, {
      manifest_base64: manifest.toString("base64"),
      manifest_hash: sha256Hex(manifest),
      signer_key_id: "https://vault.vault.azure.net/keys/c2pa/version",
      signature_algorithm: "ES256",
      signature: "s".repeat(86),
    });
  }
  if (path === "/v1/sign") return signedResponse(path, nonce, 200, {
    algorithm: "ES256",
    key_id: "https://vault.vault.azure.net/keys/c2pa/version",
    signature: "s".repeat(86),
  });
  throw new Error(`unexpected path ${path}`);
};

assert.throws(() => azureProtectionConfig({}), /audio_protection_origin_required/);
ok("production protection refuses missing configuration", true);
assert.throws(() => azureProtectionConfig({ ...ENV, AZURE_AUDIO_PROTECTION_ORIGIN: "http://protector.internal" }), /audio_protection_origin_invalid/);
ok("production protection requires an exact HTTPS origin", true);
assert.throws(() => azureProtectionConfig({ ...ENV, REPLICA_WATERMARK_TOKEN_SECRET: "short" }), /watermark_token_secret_required/);
ok("watermark and commitment domains require 256-bit secrets", true);
assert.throws(() => azureProtectionConfig({ ...ENV, REPLICA_PROTECTION_MAX_PCM_BYTES: "NaN" }), /audio_protection_max_pcm_invalid/);
ok("invalid memory ceilings cannot silently disable PCM bounds", true);

const dbCalls = [];
const db = async (sql, params) => {
  dbCalls.push({ sql, params });
  if (/insert into vy_replica_c2pa_manifest/i.test(sql)) return [{ generation_id: GENERATION }];
  return [];
};
const adapters = createAzureProtectionAdapters({ db, env: ENV, fetchImpl: mockFetch });
const production = createProductionProtectionAdapters({ db, env: ENV, fetchImpl: mockFetch });
ok("production registry composes real protection with the Neon ledger", production.ledger.name === "neon-provenance-ledger" && !Object.values(production).some((item) => item.testOnly));

const source = (async function* () { yield Uint8Array.from([1, 2, 3, 4]); })();
await assert.rejects(adapters.disclosure.prepend({
  stream: source, text: SYNTHETIC_AUDIO_DISCLOSURE, evidence: { renderedText: "hello" },
}), /provider_disclosure_evidence_missing/);
ok("missing provider-rendered disclosure cannot be papered over downstream", true);
const disclosed = await adapters.disclosure.prepend({
  stream: source,
  text: SYNTHETIC_AUDIO_DISCLOSURE,
  evidence: { renderedText: `${SYNTHETIC_AUDIO_DISCLOSURE} hello`, renderer: "provider@version" },
});
ok("exact provider disclosure is accepted without double rendering", disclosed.stream === source && disclosed.proof.embedded === true);

const tokenA = await adapters.tokenIssuer.issue({ generationId: GENERATION, replicaId: "10000000-0000-4000-8000-000000000001", policyVersion: "p1" });
const tokenB = await adapters.tokenIssuer.issue({ generationId: GENERATION, replicaId: "10000000-0000-4000-8000-000000000001", policyVersion: "p1" });
ok("watermark message is deterministic and generation-domain bound", Buffer.from(tokenA.message).equals(Buffer.from(tokenB.message)) && tokenA.tokenHash === tokenB.tokenHash && tokenA.message.byteLength === 2);
const other = await adapters.tokenIssuer.issue({ generationId: "80000000-0000-4000-8000-000000000009", replicaId: "10000000-0000-4000-8000-000000000001", policyVersion: "p1" });
ok("different generations receive unlinkable watermark tokens", other.tokenHash !== tokenA.tokenHash);

const pcm = Uint8Array.from([0, 0, 1, 0, 2, 0, 3, 0]);
const marked = await adapters.watermark.embed({
  stream: (async function* () { yield pcm; })(),
  format: VOICE_PCM_FORMAT,
  message: tokenA.message,
  tokenHash: tokenA.tokenHash,
  generationId: GENERATION,
});
const markedBytes = [];
for await (const chunk of marked.stream) markedBytes.push(Buffer.from(chunk));
ok("AudioSeal response is HMAC-authenticated and exact-length bound", Buffer.concat(markedBytes).equals(Buffer.from(pcm)) && marked.proof.outputSha256 === sha256Hex(pcm));
ok("watermark request binds generation, token and canonical PCM", calls.find((call) => call.path === "/v1/watermark")?.payload.generation_id === GENERATION);

const manifest = await adapters.contentCredentials.createManifest({
  generationId: GENERATION,
  assetHash: sha256Hex(pcm),
  assetFormat: VOICE_PCM_FORMAT,
  assetBytes: pcm,
});
ok("C2PA request and proof bind the exact protected bytes", manifest.assetHash === sha256Hex(pcm) && /^[0-9a-f]{64}$/.test(manifest.manifestHash));
ok("C2PA sidecar is persisted only against a streaming generation", /g\.state='streaming'/i.test(dbCalls[0].sql) && dbCalls[0].params[0] === GENERATION && dbCalls[0].params[2] === manifest.manifestHash);
ok("protection service receives no owner, replica, prompt or provider id", !/owner|replica_id|prompt|provider_ref/i.test(JSON.stringify(calls)));

const signature = await adapters.signer.sign({ bytes: new TextEncoder().encode("receipt"), purpose: "vyakti-generation-receipt-v1" });
ok("receipt signing is delegated to the Key Vault-backed service", signature.algorithm === "ES256" && signature.keyId.includes("vault.azure.net"));

const tampered = createAzureProtectionAdapters({ db, env: ENV, fetchImpl: async (url, init) => {
  const path = new URL(url).pathname;
  return signedResponse(path, new Headers(init.headers).get("x-vyakti-nonce"), 200, { algorithm: "ES256", key_id: "key", signature: "s".repeat(86) }, true);
} });
await assert.rejects(tampered.signer.sign({ bytes: Uint8Array.from([1, 2]), purpose: "vyakti-generation-receipt-v1" }), /audio_protection_response_signature_invalid/);
ok("a forged or transit-modified protection response is rejected", true);

function responseFixture() {
  return {
    statusCode: 0, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}
const manifestBytes = Buffer.alloc(128, 73);
const envelopeBytes = Buffer.from(canonicalJson({ schema: "vyakti.generation-receipt.v1", signed: true, padding: "p".repeat(96) }));
const publicDb = async (sql) => /encode\(m\.manifest_bytes/i.test(sql)
  ? [{ manifest_base64: manifestBytes.toString("base64"), manifest_sha256: sha256Hex(manifestBytes) }]
  : [{ generation_id: GENERATION, manifest_sha256: sha256Hex(manifestBytes), envelope_sha256: sha256Hex(envelopeBytes), signed_envelope_base64: envelopeBytes.toString("base64"), issued_at: "2026-08-24T00:00:00Z" }];
const publicHandler = createReplicaProvenanceHandler({ db: publicDb });
const receiptResponse = responseFixture();
await publicHandler({ query: { generation_id: GENERATION } }, receiptResponse);
ok("content-free public receipt exposes exact signed bytes without replica identity", receiptResponse.statusCode === 200 && receiptResponse.body.signed_envelope_base64 && !/owner|replica_id/i.test(JSON.stringify(receiptResponse.body)));
const manifestResponse = responseFixture();
await publicHandler({ query: { generation_id: GENERATION, kind: "manifest" } }, manifestResponse);
ok("public sidecar is served only through the sealed-receipt join", manifestResponse.statusCode === 200 && Buffer.from(manifestResponse.body).equals(manifestBytes));

const migration = readFileSync(join(ROOT, "db/migrations/043_replica_c2pa_manifest.sql"), "utf8");
ok("C2PA migration is independently idempotent and split-safe", splitSql(migration).length === 4 && /create table if not exists/i.test(migration));
ok("content-free sidecar deliberately survives private replica erasure", !/references vy_replica|foreign key/i.test(migration));
ok("manifest bytes are strictly bounded in the database", /octet_length\(manifest_bytes\) between 64 and 1048576/i.test(migration));
ok("exact canonical signed envelope survives for independent verification", /vy_replica_generation_receipt_envelope/.test(migration) && /envelope_canonical/.test(migration) && !/references vy_replica/i.test(migration));

const service = readFileSync(join(ROOT, "services/audio-protection/app.py"), "utf8");
const requirements = readFileSync(join(ROOT, "services/audio-protection/requirements.txt"), "utf8");
const dockerfile = readFileSync(join(ROOT, "services/audio-protection/Dockerfile"), "utf8");
ok("service pins official AudioSeal and C2PA SDK releases", /audioseal==0\.2\.0/.test(requirements) && /c2pa-python==0\.37\.6/.test(requirements));
ok("service loads the official streaming watermark model", /AudioSeal\.load_generator\(MODEL_NAME\)/.test(service) && /watermarker\.streaming\(batch_size=1\)/.test(service));
ok("every generated watermark is detector-verified with the exact 16-bit message", /detector\.detect_watermark\(result\)/.test(service) && /decoded_bits != bits/.test(service) && /audioseal_self_verification_failed/.test(service));
ok("service makes CUDA a production readiness requirement", /audio_protection_cuda_required/.test(service) && /AUDIO_PROTECTION_REQUIRE_CUDA/.test(service));
ok("C2PA is external, asset-bound and Key Vault signed", /builder\.set_no_embed\(\)/.test(service) && /CryptographyClient/.test(service) && /SignatureAlgorithm\.es256/.test(service));
ok("transport authenticates request content and signs response content", /transport_signature_invalid/.test(service) && /X-Vyakti-Response-Signature/.test(service));
ok("authenticated request nonces are single-use within the replay window", /transport_replay_denied/.test(service) && /seen_nonces/.test(service));
ok("container is non-root and disables request access logs", /USER 10001:10001/.test(dockerfile) && /--no-access-log/.test(dockerfile));
ok("service contains no PCM or body logging path", !/print\(|logging\.|logger\.|access_log=True/.test(service));

console.log(`\n${checks} production protection checks passed`);
