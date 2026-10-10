import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  completeIdentityCase,
  createIdentityEvidenceVerdict,
  expireIdentityEvidence,
  identityLeaseHash,
  identityRetryDelayMs,
  leaseNextIdentityCase,
  revokeOwnedIdentityCase,
  runIdentityVerificationSweep,
  submitOwnedIdentityCase,
} from "../../api/_replica-identity.js";
import {
  azureCompositeIdentityConfig,
  createAzureCompositeIdentityVerifier,
} from "../../api/_identity/providers/azure-composite.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const SOURCE = "30000000-0000-4000-8000-000000000003";
const CASE = "40000000-0000-4000-8000-000000000004";
const SHA = "a".repeat(64);
const TOKEN = "identity-verification-lease-token-more-than-thirty-two-bytes";
const VERSION = "document-intelligence-2024-11-30+fraud-review-v1";
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

const attestations = {
  is_my_government_id: true,
  document_contains_only_me: true,
  identity_and_age_verification_only: true,
  no_model_training: true,
  erase_after_verification: true,
};
await assert.rejects(submitOwnedIdentityCase(async () => [], OWNER, RID, {
  source_id: SOURCE, attestations: { ...attestations, no_model_training: false },
}), /identity_attestations_required/);
await assert.rejects(submitOwnedIdentityCase(async () => [], OWNER, RID, {
  source_id: SOURCE, attestations: { ...attestations, extra: true },
}), /identity_attestations_required/);
ok("all five narrow identity statements are exact and fail closed", true);

let submitSql = "";
let submitParams = [];
const submitted = await submitOwnedIdentityCase(async (sql, params) => {
  submitSql = sql;
  submitParams = params;
  return [{
    identity_case_id: params[3], replica_id: params[0], owner_user_id: params[1], source_id: params[2],
    policy_version: "replica-self-v1", state: "submitted", attempt: 0, source_sha256: SHA,
    adult_evidence: false, document_authentic: false, document_current: false,
    face_reference_ready: false, credential_expires_at: null, failure_code: "",
    consented_at: params[5], verified_at: null, revoked_at: null,
    created_at: params[5], updated_at: params[5],
  }];
}, OWNER, RID, { source_id: SOURCE, attestations }, {
  identityCaseId: CASE, now: new Date("2026-08-24T00:00:00.000Z"), nonce: "f".repeat(48),
});
ok("owner can submit one opaque government-ID case without returning verifier internals",
  submitted.identity_case_id === CASE && !("source_sha256" in submitted));
ok("submission accepts only a private quarantined self-only image or PDF with capture and storage rights",
  /s\.state='quarantined'/.test(submitSql) && /s\.capture_mode='identity_document'/.test(submitSql) &&
  /s\.kind in \('image','document'\)/.test(submitSql) &&
  /s\.contains_third_parties=false/.test(submitSql) && /array\['capture','storage'\]/.test(submitSql));
ok("source fingerprint is selected from the owner-scoped database rather than trusted from the browser",
  /owned\.sha256/.test(submitSql) && submitParams.length === 8 && !submitParams.includes(SHA));
ok("daily rate and one-live-case arbiters are enforced transactionally",
  /attempts\.n<\$7/.test(submitSql) &&
  /state in \('submitted','verifying','evidence_ready','verified'\)/.test(submitSql));
ok("the stored consent is a one-way randomized receipt and not the attestation text",
  /^[0-9a-f]{64}$/.test(submitParams[4]) && !JSON.stringify(submitParams).includes("government_id"));

const claim = {
  identityCaseId: CASE,
  replicaId: RID,
  ownerUserId: OWNER,
  sourceId: SOURCE,
  attempt: 2,
  verifierName: "azure_identity_composite",
  verifierVersion: VERSION,
  source: {
    kind: "image", mime: "image/jpeg", byteSize: 1234, sha256: SHA,
    storageBucket: "vyakti-replica-private", objectPath: `${OWNER}/${RID}/${SOURCE}/original`,
  },
};
const positive = {
  providerFamily: claim.verifierName,
  verifierVersion: claim.verifierVersion,
  inputSha256: SHA,
  providerAccepted: true,
  extractionConfidence: 0.99,
  authenticityScore: 0.995,
  portraitConfidence: 0.98,
  documentAuthentic: true,
  documentCurrent: true,
  adultEvidence: true,
  faceReferenceReady: true,
  credentialExpiresAt: "2031-08-24T00:00:00.000Z",
};
const verdict = createIdentityEvidenceVerdict(claim, positive, { now: new Date("2026-08-24T00:00:00.000Z") });
ok("evidence readiness requires authentic current adult ID and a usable face reference",
  verdict.passed && verdict.result.document_authentic && verdict.result.face_reference_ready);
ok("durable identity evidence contains decisions hashes and scores but no DOB name number image or embedding",
  !/(date_of_birth|document_number|name|portrait_image|embedding|address)/i.test(JSON.stringify(verdict.result)) &&
  /^[0-9a-f]{64}$/.test(verdict.result.evidence_digest));

const negativeCases = [
  ["identity_provider_rejected", { providerAccepted: false }],
  ["identity_extraction_low_confidence", { extractionConfidence: 0.5 }],
  ["identity_document_authenticity_failed", { documentAuthentic: false }],
  ["identity_document_expired", { documentCurrent: false }],
  ["adult_age_not_verified", { adultEvidence: false }],
  ["identity_face_reference_unavailable", { faceReferenceReady: false }],
];
for (const [code, delta] of negativeCases) {
  const failed = createIdentityEvidenceVerdict(claim, { ...positive, ...delta }, { now: new Date("2026-08-24T00:00:00.000Z") });
  assert.equal(failed.passed, false);
  assert.equal(failed.failureCode, code);
}
ok("OCR alone cannot pass and no weak signal is averaged over a failed trust gate", true);
assert.throws(() => createIdentityEvidenceVerdict(claim, { ...positive, inputSha256: "b".repeat(64) }), /input_hash_mismatch/);
assert.throws(() => createIdentityEvidenceVerdict(claim, { ...positive, verifierVersion: "moving-latest" }), /binding_mismatch/);
ok("source substitution and moving verifier bundles fail before settlement", true);

const key = Buffer.alloc(32, 61);
const env = {
  AZURE_COMPOSITE_IDENTITY_ENABLED: "true",
  AZURE_IDENTITY_REVIEW_PATH_APPROVED: "true",
  AZURE_COMPOSITE_IDENTITY_ENDPOINT: "https://vyakti-verify.azurecontainerapps.io/v1/identity/verify",
  AZURE_COMPOSITE_IDENTITY_HMAC_KEY_B64: key.toString("base64"),
  AZURE_COMPOSITE_IDENTITY_VERSION: VERSION,
};
assert.throws(() => azureCompositeIdentityConfig({ ...env, AZURE_IDENTITY_REVIEW_PATH_APPROVED: "false" }), /review_path_required/);
assert.throws(() => azureCompositeIdentityConfig({ ...env, AZURE_COMPOSITE_IDENTITY_VERSION: "models-latest" }), /must_be_pinned/);
assert.throws(() => azureCompositeIdentityConfig({ ...env, AZURE_COMPOSITE_IDENTITY_ENDPOINT: "https://attacker.invalid/v1/identity/verify" }), /endpoint_invalid/);
ok("production identity adapter requires an approved review path pinned bundle key and Azure-hosted endpoint", true);

const brokerResult = {
  request_id: `${CASE}:2`, input_sha256: SHA, provider_accepted: true,
  extraction_confidence: 0.99, authenticity_score: 0.995, portrait_confidence: 0.98,
  document_authentic: true, document_current: true, adult_evidence: true,
  face_reference_ready: true, credential_expires_at: positive.credentialExpiresAt,
};
const brokerBody = JSON.stringify(brokerResult);
const brokerSignature = createHmac("sha256", key).update(brokerBody).digest("hex");
let brokerRequest;
const provider = createAzureCompositeIdentityVerifier({
  env,
  signRead: async () => ({ url: "https://private.example/id?token=opaque", expires_at: "2026-08-24T00:02:00.000Z" }),
  fetchImpl: async (_url, init) => {
    brokerRequest = init;
    return new Response(brokerBody, { status: 200, headers: { "x-vyakti-response-signature": `sha256=${brokerSignature}` } });
  },
});
const providerResult = await provider.verify(claim);
const requestSignature = createHmac("sha256", key).update(brokerRequest.body).digest("hex");
ok("broker receives one short-lived private capability and a request signed over exact case source and threshold",
  brokerRequest.headers["X-Vyakti-Signature"] === `sha256=${requestSignature}` &&
  brokerRequest.body.includes("token=opaque") && brokerRequest.body.includes('"minimum_age":18') &&
  providerResult.inputSha256 === SHA);
const unsigned = createAzureCompositeIdentityVerifier({
  env,
  signRead: async () => ({ url: "https://private.example/id?token=opaque", expires_at: "2026-08-24T00:02:00.000Z" }),
  fetchImpl: async () => new Response(brokerBody, { status: 200, headers: { "x-vyakti-response-signature": `sha256=${"0".repeat(64)}` } }),
});
await assert.rejects(unsigned.verify(claim), /signature_invalid/);
ok("a successful network response without the exact broker HMAC is not evidence", true);

ok("identity lease capabilities are one-way domain-separated hashes",
  /^[0-9a-f]{64}$/.test(identityLeaseHash(TOKEN)) && !identityLeaseHash(TOKEN).includes(TOKEN));
let leaseSql = "";
const leased = await leaseNextIdentityCase(async (sql) => {
  leaseSql = sql;
  return [{
    identity_case_id: CASE, replica_id: RID, owner_user_id: OWNER, source_id: SOURCE, attempt: 2,
    kind: "image", mime: "image/jpeg", byte_size: 1234, sha256: SHA,
    storage_bucket: "vyakti-replica-private", object_path: `${OWNER}/${RID}/${SOURCE}/original`,
  }];
}, { name: claim.verifierName, version: claim.verifierVersion, verify() {} }, { leaseToken: TOKEN });
ok("one atomic lease rechecks live self ownership exact quarantined source and appends an attempt",
  leased.attempt === 2 && /s\.sha256=c\.source_sha256/.test(leaseSql) &&
  /s\.capture_mode='identity_document'/.test(leaseSql) &&
  /r\.subject_mode='self'/.test(leaseSql) && /insert into vy_replica_identity_verification_attempt/.test(leaseSql));
ok("expired work is reclaimed without storing the raw lease", /failure_code='lease_expired'/.test(leaseSql) && !leaseSql.includes(TOKEN));

let completeSql = "";
let completeParams = [];
const completion = await completeIdentityCase(async (sql, params) => {
  completeSql = sql;
  completeParams = params;
  return [{ identity_case_id: CASE, state: "evidence_ready" }];
}, { ...leased, leaseToken: TOKEN }, verdict);
ok("settlement binds live lease source hash verifier version and running attempt",
  completion.state === "evidence_ready" && /c\.lease_expires_at>now\(\)/.test(completeSql) &&
  /s\.sha256=\$14/.test(completeSql) && /a\.verifier_version=\$16/.test(completeSql));
ok("identity evidence sets adult age only and deliberately does not pre-set identity or liveness",
  /age_verified_at=coalesce/.test(completeSql) && !/identity_verified_at=coalesce/.test(completeSql) &&
  !/liveness_verified_at=coalesce/.test(completeSql) && !/select 1 from revoked/.test(completeSql));
ok("attempt audit receives only the fixed content-free result", JSON.stringify(completeParams).includes(verdict.result.evidence_digest) &&
  !/(date_of_birth|document_number|name|address)/i.test(JSON.stringify(completeParams)) &&
  /c\.state='failed'/.test(completeSql) && /set state='deleting'/.test(completeSql));

let revokeSql = "";
const revoked = await revokeOwnedIdentityCase(async (sql) => {
  revokeSql = sql;
  return [{ ...submitted, owner_user_id: OWNER, state: "revoked", revoked_at: "2026-08-24T01:00:00.000Z" }];
}, OWNER, RID, CASE);
ok("owner revocation clears every identity gate fails linked live challenges and queues exact source erasure",
  revoked.state === "revoked" && /age_verified_at=null,identity_verified_at=null,liveness_verified_at=null/.test(revokeSql) &&
  /identity_evidence_revoked/.test(revokeSql) && /set state='deleting'/.test(revokeSql) &&
  /vy_replica_runtime_capability/.test(revokeSql) && /vy_replica_runtime_session/.test(revokeSql) &&
  /vy_replica_generation/.test(revokeSql) && /c\.scope='biometric'/.test(revokeSql) &&
  /verification_lease_token_hash=''/.test(revokeSql) && /vy_replica_liveness_verification_attempt/.test(revokeSql));

let expirySql = "";
const expiredCount = await expireIdentityEvidence(async (sql) => {
  expirySql = sql;
  return [{ expired_count: 2 }];
});
ok("credential expiry is an independent kill switch even when the verifier is disabled",
  expiredCount === 2 && /identity_expires_at=null/.test(expirySql) &&
  /vy_replica_runtime_capability/.test(expirySql) && /vy_replica_runtime_session/.test(expirySql) &&
  /identity_document_expired/.test(expirySql) && /vy_replica_liveness_verification_attempt/.test(expirySql));
ok("unfinished identity proofing has a hard 24-hour raw-evidence retention ceiling",
  /c\.created_at<=now\(\)-interval '24 hours'/.test(expirySql) &&
  /failure_code='identity_case_expired'/.test(expirySql) && /a\.outcome='running'/.test(expirySql));

const work = [claim, { ...claim, identityCaseId: "50000000-0000-4000-8000-000000000005" },
  { ...claim, identityCaseId: "60000000-0000-4000-8000-000000000006" }];
const summary = await runIdentityVerificationSweep({
  db: async () => [], verifier: { ...provider, async verify(item) {
    if (item.identityCaseId.startsWith("6")) throw Object.assign(new Error("offline"), { code: "provider_unreachable" });
    return item.identityCaseId.startsWith("5") ? { ...positive, documentAuthentic: false } : positive;
  } }, maxJobs: 3,
  lease: async () => work.shift() || null,
  complete: async () => undefined,
  retry: async () => undefined,
});
ok("one worker pass can ready fail and retry independent owner cases",
  summary.evidence_ready === 1 && summary.failed === 1 && summary.retried === 1 &&
  identityRetryDelayMs(99) === 6 * 60 * 60 * 1000);
const revokedRace = await runIdentityVerificationSweep({
  db: async () => [], verifier: { ...provider, async verify() { throw new Error("late provider failure"); } }, maxJobs: 1,
  lease: async () => claim,
  retry: async () => { throw Object.assign(new Error("lost"), { code: "identity_verification_lease_lost" }); },
});
ok("an identity withdrawal racing provider work is discarded without failing the scheduled worker",
  revokedRace.discarded === 1 && revokedRace.retried === 0);

const migration = readFileSync(join(ROOT, "db/migrations/040_replica_identity_proofing.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const endpoint = readFileSync(join(ROOT, "api/replica-identity.js"), "utf8");
const liveness = readFileSync(join(ROOT, "api/_replica-liveness-verification.js"), "utf8");
ok("migration is splitter-safe and canonical schema mirrors owner source attempt and liveness bindings",
  splitSql(migration).length >= 9 && schema.includes("vy_replica_identity_verification_attempt") &&
  migration.includes("vy_replica_liveness_identity_case_fk"));
ok("HTTP authority comes only from bearer identity and responses are non-cacheable",
  endpoint.includes("requireUser(req)") && endpoint.includes("user.id") && !endpoint.includes("body.owner_user_id") &&
  endpoint.includes('Cache-Control", "no-store'));
ok("identity evidence withdrawal attempts immediate provider-session deletion with durable pending fallback",
  endpoint.includes("deleteOwnedFaceSessionNow") && endpoint.includes("configuredFaceSessionErasureBroker") &&
  endpoint.includes("provider_session_erasure") && endpoint.indexOf("revokeOwnedIdentityCase") <
    endpoint.indexOf("deleteOwnedFaceSessionNow(q"));
ok("liveness now requires exact evidence-ready ID but no longer circularly requires identity beforehand",
  /ic\.state='evidence_ready'/.test(liveness) && /ids\.sha256=ic\.source_sha256/.test(liveness) &&
  !/r\.identity_verified_at is not null/.test(liveness) && /identity_verified_at=coalesce/.test(liveness));

console.log(`\n${checks} identity proofing checks passed`);
