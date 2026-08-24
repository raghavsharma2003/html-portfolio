import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  completeFaceSessionStart,
  deleteOwnedFaceSessionNow,
  leaseOwnedFaceSessionPoll,
  leaseOwnedFaceSessionStart,
  pollOwnedFaceSession,
  runFaceSessionCleanupSweep,
  startOwnedFaceSession,
} from "../../api/_replica-face-session.js";
import {
  azureFaceSessionConfig,
  createAzureFaceSessionBroker,
  faceDeviceCorrelationId,
} from "../../api/_face-session/providers/azure-quicklink.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CHALLENGE = "10000000-0000-4000-8000-000000000001";
const RID = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const DEVICE = "40000000-0000-4000-8000-000000000004";
const ID_SOURCE = "50000000-0000-4000-8000-000000000005";
const ID_SHA = "a".repeat(64);
const DIGEST = "b".repeat(64);
const LEASE = "official-face-session-lease-token-at-least-thirty-two-bytes";
const HMAC_KEY = Buffer.alloc(32, 31);
const DEVICE_KEY = Buffer.alloc(32, 32);
const VERSION = "identity-2026.08.24+1";
const MODEL = "2025-05-20";
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

const env = {
  AZURE_FACE_SESSION_BROKER_ENABLED: "true",
  AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED: "true",
  AZURE_FACE_DEDICATED_RESOURCE: "true",
  AZURE_FACE_SESSION_BROKER_ORIGIN: "https://vyakti-verify.azurecontainerapps.io",
  AZURE_FACE_SESSION_BROKER_HMAC_KEY_B64: HMAC_KEY.toString("base64"),
  AZURE_FACE_DEVICE_CORRELATION_HMAC_KEY_B64: DEVICE_KEY.toString("base64"),
  AZURE_FACE_SESSION_BROKER_VERSION: VERSION,
  AZURE_FACE_LIVENESS_MODEL_VERSION: MODEL,
};

assert.throws(() => azureFaceSessionConfig({ ...env, AZURE_FACE_SESSION_BROKER_ENABLED: "false" }), /disabled/);
assert.throws(() => azureFaceSessionConfig({ ...env, AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED: "false" }), /approval_required/);
assert.throws(() => azureFaceSessionConfig({ ...env, AZURE_FACE_SESSION_BROKER_ORIGIN: "https://attacker.invalid" }), /origin_invalid/);
assert.throws(() => azureFaceSessionConfig({ ...env, AZURE_FACE_SESSION_BROKER_VERSION: "latest" }), /version_required/);
ok("official Face sessions require explicit limited-access approval pinned versions canonical keys and an Azure origin", true);

const correlation = faceDeviceCorrelationId(OWNER, DEVICE, DEVICE_KEY);
ok("provider device correlation is a stable pseudonymous UUID and never the account or browser identifier",
  correlation === faceDeviceCorrelationId(OWNER, DEVICE, DEVICE_KEY) && correlation !== OWNER && correlation !== DEVICE);

const signedReference = {
  url: "https://project.supabase.co/storage/v1/object/sign/private/id?token=opaque",
  expires_at: "2026-08-24T10:02:00.000Z",
};
const serviceResult = {
  request_id: `${CHALLENGE}:1`,
  reference_sha256: ID_SHA,
  provider_accepted: true,
  model_version: MODEL,
  session_expires_at: "2026-08-24T10:05:00.000Z",
  session_handle: `v1.${"A".repeat(16)}.${"B".repeat(40)}.${"C".repeat(22)}`,
  quick_link_url: "https://liveness.face.azure.com/?s=60000000-0000-4000-8000-000000000006&callbackUrl=https%3A%2F%2Fvyakti.example%2Fstudio%3Fliveness%3Dreturn",
};
const responseBody = JSON.stringify(serviceResult);
const responseSignature = createHmac("sha256", HMAC_KEY).update(responseBody).digest("hex");
let outbound;
const adapter = createAzureFaceSessionBroker({
  env,
  signRead: async () => signedReference,
  fetchImpl: async (url, init) => {
    outbound = { url, init };
    return new Response(responseBody, { headers: { "x-vyakti-response-signature": `sha256=${responseSignature}` } });
  },
});
const claim = {
  challengeId: CHALLENGE,
  replicaId: RID,
  ownerUserId: OWNER,
  faceSessionAttempt: 1,
  clientDeviceId: DEVICE,
  identityReference: {
    sourceId: ID_SOURCE,
    mime: "image/jpeg",
    byteSize: 2048,
    sha256: ID_SHA,
    objectPath: `${OWNER}/${RID}/${ID_SOURCE}/original`,
  },
};
const created = await adapter.create(claim);
const expectedRequestSignature = createHmac("sha256", HMAC_KEY).update(outbound.init.body).digest("hex");
ok("adapter sends a signed exact-reference capability and server-derived device correlation to the session endpoint",
  outbound.url.endsWith("/v1/liveness/session") &&
  outbound.init.headers["X-Vyakti-Signature"] === `sha256=${expectedRequestSignature}` &&
  outbound.init.body.includes(ID_SHA) && outbound.init.body.includes(correlation) &&
  outbound.init.body.includes("token=opaque") && created.sessionHandle === serviceResult.session_handle);
ok("only the one-time Azure link leaves the server path while the sealed provider handle stays separate",
  created.quickLinkUrl.startsWith("https://liveness.face.azure.com/") &&
  !created.quickLinkUrl.includes(created.sessionHandle));
const resumed = await adapter.resume({ ...claim, sessionHandle: created.sessionHandle });
ok("a lost create response can recover the same sealed session and one-time link without minting another identity",
  outbound.url.endsWith("/v1/liveness/resume") && resumed.sessionHandle === created.sessionHandle &&
  resumed.quickLinkUrl === created.quickLinkUrl);

const unsigned = createAzureFaceSessionBroker({
  env,
  signRead: async () => signedReference,
  fetchImpl: async () => new Response(responseBody, { headers: { "x-vyakti-response-signature": `sha256=${"0".repeat(64)}` } }),
});
await assert.rejects(unsigned.create(claim), /response_signature_invalid/);
ok("a network-success response without the exact broker HMAC cannot mint a browser bearer link", true);
const conflictBody = JSON.stringify({ error: "idempotency_conflict" });
const conflictSignature = createHmac("sha256", HMAC_KEY).update(conflictBody).digest("hex");
let conflictCalls = 0;
const conflictAdapter = createAzureFaceSessionBroker({
  env,
  signRead: async () => signedReference,
  fetchImpl: async () => {
    conflictCalls += 1;
    return new Response(conflictBody, {
      status: 409,
      headers: { "x-vyakti-response-signature": `sha256=${conflictSignature}` },
    });
  },
});
await assert.rejects(conflictAdapter.create(claim), (error) => error.ambiguous === true);
ok("an ambiguous create conflict is attempted once and remains fenced instead of resetting provider state",
  conflictCalls === 1);

const invalidCreatedBody = JSON.stringify({ ...serviceResult, model_version: "provider-drift" });
const invalidCreatedSignature = createHmac("sha256", HMAC_KEY).update(invalidCreatedBody).digest("hex");
const invalidCreatedAdapter = createAzureFaceSessionBroker({
  env,
  signRead: async () => signedReference,
  fetchImpl: async () => new Response(invalidCreatedBody, {
    headers: { "x-vyakti-response-signature": `sha256=${invalidCreatedSignature}` },
  }),
});
await assert.rejects(invalidCreatedAdapter.create(claim), (error) => error.ambiguous === true);
ok("post-create response validation failure remains ambiguous so a provider session cannot lose its erasure fence", true);

const leaseRow = {
  challenge_id: CHALLENGE,
  replica_id: RID,
  owner_user_id: OWNER,
  face_session_attempt: 1,
  face_session_state: "issuing",
  face_session_handle: "",
  identity_source_id: ID_SOURCE,
  identity_mime: "image/jpeg",
  identity_byte_size: 2048,
  identity_sha256: ID_SHA,
  identity_object_path: `${OWNER}/${RID}/${ID_SOURCE}/original`,
};
let startSql = "";
const leased = await leaseOwnedFaceSessionStart(async (sql) => {
  startSql = sql;
  return [leaseRow];
}, OWNER, RID, CHALLENGE, DEVICE, {
  name: "fake", version: VERSION, modelVersion: MODEL, create() {}, result() {}, delete() {},
}, { leaseToken: LEASE });
ok("one atomic owner lease requires a current self-only ID image and active purpose-limited biometric grant",
  leased.identityReference.sha256 === ID_SHA && /subject_mode='self'/.test(startSql) &&
  /ids\.capture_mode='identity_document'/.test(startSql) && /g\.state='active'/.test(startSql) &&
  /face_session_state='not_started'/.test(startSql) && !startSql.includes(LEASE));
ok("an ambiguous handle-less issuance is never retried into a duplicate provider session",
  !/face_session_lease_expires_at<=now\(\)/.test(startSql));

let completeSql = "";
const completed = await completeFaceSessionStart(async (sql) => {
  completeSql = sql;
  return [{ ...leaseRow, face_session_state: "ready", face_session_expires_at: created.sessionExpiresAt }];
}, leased, created, { version: VERSION, modelVersion: MODEL });
ok("session settlement stores only a sealed handle and its hash under the exact live lease",
  completed.face_session_state === "ready" && /face_session_handle=\$6/.test(completeSql) &&
  /face_session_handle_hash=\$7/.test(completeSql) && /face_session_lease_expires_at>now\(\)/.test(completeSql));

let createDeleted = false;
let call = 0;
const orchestrated = await startOwnedFaceSession(async (_sql) => {
  call += 1;
  if (call === 1) return [leaseRow];
  return [{ ...leaseRow, face_session_state: "ready", face_session_expires_at: created.sessionExpiresAt }];
}, OWNER, RID, CHALLENGE, DEVICE, {
  name: "fake", version: VERSION, modelVersion: MODEL,
  create: async () => created,
  result: async () => ({}),
  delete: async () => { createDeleted = true; },
}, { leaseToken: LEASE });
ok("successful orchestration returns the bearer link without returning the sealed handle in the challenge",
  orchestrated.quickLinkUrl === created.quickLinkUrl && !("face_session_handle" in orchestrated.challenge) && !createDeleted);

const readyRow = {
  ...leaseRow,
  state: "issued",
  face_session_state: "ready",
  face_session_handle: created.sessionHandle,
  face_session_handle_hash: createHash("sha256").update(created.sessionHandle).digest("hex"),
  face_session_reference_sha256: ID_SHA,
  face_session_expires_at: created.sessionExpiresAt,
};
call = 0;
const recovered = await startOwnedFaceSession(async () => {
  call += 1;
  if (call === 1) return [];
  return [readyRow];
}, OWNER, RID, CHALLENGE, DEVICE, {
  name: "fake", version: VERSION, modelVersion: MODEL,
  create: async () => created,
  resume: async () => created,
  result: async () => ({}),
  delete: async () => {},
}, { leaseToken: LEASE });
ok("a settled ready session rechecks current consent and can redeliver a response-lost link",
  call === 3 && recovered.quickLinkUrl === created.quickLinkUrl);

let failedDelete = false;
call = 0;
await assert.rejects(startOwnedFaceSession(async () => {
  call += 1;
  return call === 1 ? [leaseRow] : [];
}, OWNER, RID, CHALLENGE, DEVICE, {
  name: "fake", version: VERSION, modelVersion: MODEL,
  create: async () => created,
  result: async () => ({}),
  delete: async () => { failedDelete = true; },
}, { leaseToken: LEASE }), /settlement_lost/);
ok("if database settlement is lost after provider creation the just-created Azure session is immediately deleted", failedDelete);

const terminal = {
  request_id: `${CHALLENGE}:1`, reference_sha256: ID_SHA, provider_accepted: true,
  terminal: true, passed: true, liveness_passed: true, identity_match: true,
  identity_score: 0.96, provider_digest: DIGEST, verify_image_hash: ID_SHA,
  failure_code: "", model_version: MODEL,
};
const pollRow = {
  ...leaseRow,
  face_session_state: "polling",
  face_session_handle: created.sessionHandle,
};
let pollCalls = 0;
let providerDeleted = false;
const final = await pollOwnedFaceSession(async (sql) => {
  pollCalls += 1;
  if (pollCalls === 1) return [pollRow];
  if (pollCalls === 2) {
    assert.match(sql, /face_session_result=\$7::jsonb/);
    return [{ ...pollRow, face_session_state: "passed_deleting", face_session_result: terminal }];
  }
  assert.match(sql, /face_session_handle=''/);
  assert.match(sql, /face_session_provider_deleted_at=now\(\)/);
  return [{ ...pollRow, face_session_state: "passed_deleted", face_session_handle: "" }];
}, OWNER, RID, CHALLENGE, {
  name: "fake", version: VERSION, modelVersion: MODEL,
  create: async () => ({}), result: async () => terminal,
  delete: async () => { providerDeleted = true; },
}, { leaseToken: LEASE });
ok("a terminal pass is persisted content-free then Azure deletion is confirmed before the face gate opens",
  final.face_session_state === "passed_deleted" && providerDeleted && pollCalls === 3);

let immediateDeleteCalls = 0;
let immediateProviderDeleted = false;
const immediatelyDeleted = await deleteOwnedFaceSessionNow(async (sql) => {
  immediateDeleteCalls += 1;
  if (immediateDeleteCalls === 1) {
    assert.match(sql, /owner_user_id=\$3/);
    return [{ ...pollRow, face_session_state: "expired_deleting" }];
  }
  return [{ ...pollRow, face_session_state: "expired_deleted", face_session_handle: "" }];
}, OWNER, RID, CHALLENGE, {
  name: "fake", version: VERSION, modelVersion: MODEL,
  async delete() { immediateProviderDeleted = true; }, async cleanup() { return {}; },
}, { leaseToken: LEASE });
ok("owner withdrawal attempts immediate provider deletion while retaining durable cleanup fallback",
  immediateProviderDeleted && immediateDeleteCalls === 2 && immediatelyDeleted.face_session_state === "expired_deleted");

let lowScoreCalls = 0;
await assert.rejects(pollOwnedFaceSession(async () => {
  lowScoreCalls += 1;
  return lowScoreCalls === 1 ? [pollRow] : [];
}, OWNER, RID, CHALLENGE, {
  name: "fake", version: VERSION, modelVersion: MODEL,
  create: async () => ({}), result: async () => ({ ...terminal, identity_score: 0.89 }), delete: async () => {},
}, { leaseToken: LEASE }), /terminal_result_invalid/);
ok("platform settlement independently rejects an Azure pass below the fixed high-security identity threshold",
  lowScoreCalls === 2);

let expirySql = "";
await leaseOwnedFaceSessionPoll(async (sql) => {
  expirySql = sql;
  return [];
}, OWNER, RID, CHALLENGE, {
  name: "fake", version: VERSION, modelVersion: MODEL, create() {}, result() {}, delete() {},
}, { leaseToken: LEASE });
ok("expired sessions transition directly to deletion and crashed polls are reclaimable",
  /then 'expired_deleting'/.test(expirySql) && /face_session_lease_expires_at<=now\(\)/.test(expirySql));

const cleanupWork = [
  { ...claim, leaseToken: LEASE, faceSessionState: "expired_deleting", sessionHandle: created.sessionHandle },
  { ...claim, challengeId: "70000000-0000-4000-8000-000000000007", leaseToken: LEASE,
    faceSessionState: "failed_deleting", sessionHandle: created.sessionHandle },
];
const cleanupSettlements = [];
let reconciliationSql = "";
const cleanupSummary = await runFaceSessionCleanupSweep({
  db: async (sql, params) => {
    if (sql.includes("with stale as")) { reconciliationSql = sql; return []; }
    cleanupSettlements.push(params);
    return [{ face_session_state: "expired_deleted" }];
  },
  broker: {
    name: "fake", version: VERSION, modelVersion: MODEL, create() {}, result() {},
    async delete(item) { if (item.challengeId.startsWith("7")) throw Object.assign(new Error("offline"), { code: "provider_offline" }); },
    async cleanup() { return { scanned: 3, deleted: 1, scanStartedAt: new Date().toISOString() }; },
  },
  maxJobs: 2,
  lease: async () => cleanupWork.shift() || null,
});
ok("scheduled cleanup confirms provider deletion and durably releases failures for retry",
  cleanupSummary.leased === 2 && cleanupSummary.deleted === 1 && cleanupSummary.retried === 1 &&
  cleanupSummary.providerScanned === 3 && cleanupSummary.providerExpiredDeleted === 1 && cleanupSettlements.length === 2);
ok("ambiguous issuance is reconciled only after both challenge and issuance lease expiry plus resource-wide cleanup",
  /expires_at<=\$1::timestamptz/.test(reconciliationSql) &&
  /face_session_lease_expires_at\+interval '12 minutes'<=\$1::timestamptz/.test(reconciliationSql));
ok("resource-wide cleanup can close expired sealed-handle rows without inventing a pass and records its scan cutoff",
  /swept as/.test(reconciliationSql) && /face_session_expires_at\+interval '2 minutes'<=\$1::timestamptz/.test(reconciliationSql) &&
  /liveness\.face_session\.resource_cleanup/.test(reconciliationSql));
let unsafeReconciliation = false;
const budgeted = await runFaceSessionCleanupSweep({
  db: async () => { unsafeReconciliation = true; return []; },
  broker: {
    name: "fake", version: VERSION, modelVersion: MODEL,
    async delete() {}, async cleanup() { unsafeReconciliation = true; return { scanned: 0, deleted: 0 }; },
  },
  maxJobs: 1,
  timeBudgetMs: 20_000,
});
ok("a skipped resource cleanup never fabricates deletion for an ambiguous handle-less provider session",
  budgeted.providerCleanupSkipped && budgeted.ambiguousReconciled === 0 && !unsafeReconciliation);

const migration = readFileSync(join(ROOT, "db/migrations/041_replica_face_session.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
ok("migration is one-statement-runner safe and canonical schema carries the official session ledger",
  splitSql(migration).length >= 10 && schema.includes("vy_replica_biometric_verification_grant") &&
  schema.includes("face_session_provider_deleted_at"));
ok("database states never persist one-time quick links and bound handles are cleared only after provider deletion",
  !migration.includes("quick_link") && migration.includes("face_session_handle") && migration.includes("passed_deleted"));
const cron = readFileSync(join(ROOT, "api/replica-face-session-sweep.js"), "utf8");
const ownerEndpoint = readFileSync(join(ROOT, "api/replica-liveness.js"), "utf8");
const vercel = readFileSync(join(ROOT, "vercel.json"), "utf8");
ok("provider deletion continues after browser exit revocation and expiry through a cron-authenticated sweep",
  cron.includes("CRON_SECRET") && cron.includes("runFaceSessionCleanupSweep") &&
  vercel.includes("/api/replica-face-session-sweep"));
ok("interactive Face work has explicit function headroom while withdrawal deletion stays browser-bounded",
  /maxDuration: 240/.test(ownerEndpoint) && /providerTimeoutMs: 12_000/.test(ownerEndpoint) &&
  /request\.timeoutMs \|\| 45_000/.test(readFileSync(
    join(ROOT, "api/_face-session/providers/azure-quicklink.js"), "utf8")));

console.log(`\n${checks} official face-session checks passed`);
