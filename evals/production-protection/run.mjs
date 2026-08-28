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

// This check used to be `!/print\(|logging\./` — no output statement of any
// kind. That proxy broke the moment the service needed to say WHY an unexpected
// failure happened, and a generic 503 with no diagnostic is undebuggable in
// production. So the invariant is now tested directly instead of by proxy:
// every output statement in the service is enumerated, and none of them may
// mention audio, a request body, or anything derived from one.
const prints = [...service.matchAll(/^\s*(print\(.*|logging\..*|logger\..*|.*access_log=True.*)$/gm)].map((m) => m[1]);
const PAYLOAD_WORDS = /pcm|audio|body|payload|message|manifest|waveform|samples|token_hash|secret|chunk|bits/i;
// What matters is what FLOWS, not what is spelled: a constant tag may say
// "audio-protection", but no interpolated expression and no bare argument may
// name anything derived from a request. So constant string literals are dropped
// and their f-string interpolations are kept.
function dataBearing(line) {
  const interpolated = [...line.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const outsideLiterals = line.replace(/f?"[^"]*"|f?'[^']*'/g, " ");
  return [...interpolated, outsideLiterals].join(" ");
}
ok("every output statement in the service is enumerated and data-free",
  prints.length > 0 && prints.every((line) => !PAYLOAD_WORDS.test(dataBearing(line))));
ok("the only diagnostic emitted names exception classes and code locations, never values",
  /def _diagnostic/.test(service) &&
  /type\(cause\)\.__name__/.test(service) &&
  /tb_lineno/.test(service) &&
  // no str(error), no repr, no args: a message can carry caller data
  !/str\(error\)|repr\(error\)|error\.args/.test(service));
ok("access logs stay disabled and no request body is ever read into a log", !/access_log=True/.test(service) && !/print\(.*await request/.test(service));

// An UNDEPLOYED or unreachable protection service must be a named 503 on every
// path, never a crash and never a silent degrade. The route side of this was
// fixed already; these assert the client and registry side is equally legible,
// because "no audio at all" and "audio without a watermark" are the same bug
// class and only the first one is safe.
function absence(name, env, fetchImpl) {
  let thrown = null;
  try {
    const built = createAzureProtectionAdapters({ db, env, fetchImpl: fetchImpl || mockFetch });
    return { built, thrown: null };
  } catch (error) { thrown = error; }
  return { built: null, thrown };
}

for (const [label, patch, code] of [
  ["origin", { AZURE_AUDIO_PROTECTION_ORIGIN: "" }, "audio_protection_origin_required"],
  ["transport secret", { AZURE_AUDIO_PROTECTION_HMAC_SECRET: "" }, "audio_protection_hmac_secret_required"],
  ["watermark token secret", { REPLICA_WATERMARK_TOKEN_SECRET: "" }, "watermark_token_secret_required"],
  ["commitment secret", { REPLICA_COMMITMENT_SECRET: "" }, "replica_commitment_secret_required"],
]) {
  const { thrown } = absence(label, { ...ENV, ...patch });
  ok(`an absent ${label} is a named 503, not a crash`,
    thrown?.code === code && thrown?.status === 503 && thrown instanceof Error);
}

const unreachable = createAzureProtectionAdapters({ db, env: ENV, fetchImpl: async () => { throw new TypeError("fetch failed"); } });
await assert.rejects(unreachable.signer.sign({ bytes: Uint8Array.from([1]), purpose: "vyakti-generation-receipt-v1" }),
  (error) => error.code === "audio_protection_unreachable" && error.status === 503);
ok("a protection service that is not deployed at all is audio_protection_unreachable, a named 503", true);

const notReady = createAzureProtectionAdapters({ db, env: ENV, fetchImpl: async (url, init) => {
  const path = new URL(url).pathname;
  // What app.py's own /healthz and its catch-all actually answer before the
  // AudioSeal models, the Key Vault key or the certificate chain are present.
  return signedResponse(path, new Headers(init.headers).get("x-vyakti-nonce"), 503, { error: "audio_protection_failed" });
} });
await assert.rejects(notReady.signer.sign({ bytes: Uint8Array.from([1]), purpose: "vyakti-generation-receipt-v1" }),
  (error) => error.code === "audio_protection_failed" && error.status === 503);
ok("a deployed but unready protection service keeps its own error name through the client", true);

const garbled = createAzureProtectionAdapters({ db, env: ENV, fetchImpl: async (url, init) => {
  const path = new URL(url).pathname;
  const nonce = new Headers(init.headers).get("x-vyakti-nonce");
  const body = Buffer.from("<html>502 Bad Gateway</html>");
  const signature = hmac([PROTOCOL, "response", path, nonce, "502", sha256Hex(body)].join("\n"));
  return new Response(body, { status: 502, headers: { "X-Vyakti-Response-Signature": signature } });
} });
await assert.rejects(garbled.signer.sign({ bytes: Uint8Array.from([1]), purpose: "vyakti-generation-receipt-v1" }),
  (error) => error.code === "audio_protection_response_invalid" && error.status === 503);
ok("an ingress error page in place of the service is a named 503, not a parse crash", true);

let registryError = null;
try { createProductionProtectionAdapters({ db, env: {}, fetchImpl: mockFetch }); }
catch (error) { registryError = error; }
ok("the registry surfaces a named, 503-shaped failure with no fake fallback",
  registryError?.code === "audio_protection_origin_required" && registryError?.status === 503);

let unnamedError = null;
try { createProductionProtectionAdapters({ db: null, env: ENV, fetchImpl: mockFetch }); }
catch (error) { unnamedError = error; }
ok("even an unnamed construction failure becomes a named 503", Boolean(unnamedError?.code) && unnamedError?.status === 503);

// The two invariants that must survive every deployment decision, asserted
// against the shipped source rather than assumed from the README.
ok("the service refuses to return audio whose watermark it cannot itself detect and decode",
  /confidence_value < app\.state\.detector_threshold or decoded_bits != bits/.test(service) &&
  /raise ServiceError\("audioseal_self_verification_failed", 503\)/.test(service));
ok("the disclosure is the provider's rendered speech, and unproven disclosure blocks every byte",
  /isSyntheticAudioDisclosure\(text\)/.test(
    readFileSync(join(ROOT, "api/_provenance/providers/azure-protection.js"), "utf8")) &&
  /renderedText\.startsWith\(`\$\{text\} `\)/.test(
    readFileSync(join(ROOT, "api/_provenance/providers/azure-protection.js"), "utf8")) &&
  /assertDisclosureProof\(disclosureResult\?\.proof, disclosureText\)/.test(
    readFileSync(join(ROOT, "api/_provenance/delivery.js"), "utf8")));

console.log(`\n${checks} production protection checks passed`);
