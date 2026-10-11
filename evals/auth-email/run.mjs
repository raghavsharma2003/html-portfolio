import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../api/_provenance/contracts.js";
import { encryptAuthEmailPayload, decryptAuthEmailPayload } from "../../api/_auth-email-crypto.js";
import {
  AUTH_EMAIL_ADMIT_SQL, AUTH_EMAIL_CLAIM_PREPARATION_SQL, AUTH_EMAIL_COMPLETE_PREPARATION_SQL,
  AUTH_EMAIL_RELEASE_PREPARATION_SQL, AUTH_EMAIL_RECORD_PREPARATION_UNCERTAIN_SQL,
  AUTH_EMAIL_READ_SQL, AUTH_EMAIL_CLAIM_DISPATCH_SQL,
  AUTH_EMAIL_RETRY_DISPATCH_SQL,
  AUTH_EMAIL_RECORD_PENDING_SQL, AUTH_EMAIL_RECORD_TERMINAL_SQL, AUTH_EMAIL_RECORD_RECONCILE_SQL,
  AUTH_EMAIL_EXPIRE_SQL, AUTH_EMAIL_FORGET_SQL, AUTH_EMAIL_SWEEP_ROWS_SQL,
  admitAuthEmail, claimAuthEmailPreparation, recordAuthEmailTerminal, forgetAuthEmailAccount, authEmailSqlCases,
} from "../../api/_auth-email-store.js";
import {
  authEmailAzureConfig, approvedAuthEmailRedirect, generateSupabaseAuthEmailLink, signAcsAuthEmailRequest,
  sendAzureAuthEmail, readAzureAuthEmail, validateAcsOperationLocation, validateAuthEmailPayload,
} from "../../api/_auth-email-azure.js";
import { requestVyaktiAuthEmail, runAuthEmailSweep } from "../../api/_auth-email.js";
import { authEmail174Plan, runAuthEmail174Development } from "../../scripts/auth-email174-development.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const REQUEST = "10000000-0000-4000-8000-000000000174";
const OWNER = "20000000-0000-4000-8000-000000000174";
const EMAIL = "owner@example.test";
const REDIRECT = "https://vyakti-replica-lab.vercel.app/studio";
const TOKEN = "c".repeat(64);
const KEY = Buffer.alloc(32, 74);
const ENV = { VYAKTI_AUTH_EMAIL_KEK_ID: "auth-email-fixture", VYAKTI_AUTH_EMAIL_KEK_B64: KEY.toString("base64") };
const CONFIG = { endpoint: "https://vyakti-auth.communication.azure.com", supabase: "https://fixture.supabase.co",
  sender: "donotreply@fixture.azurecomm.net", accessKey: Buffer.alloc(32, 19), serviceRole: "fixture-service-role-not-real-1234567890",
  allowedOrigins: ["https://vyakti-replica-lab.vercel.app"] };
const CONFIG_ENV = {
  VYAKTI_AUTH_EMAIL_PROVIDER: "azure_communication_email",
  VYAKTI_AUTH_EMAIL_ENDPOINT: CONFIG.endpoint,
  VYAKTI_AUTH_EMAIL_ACCESS_KEY_B64: CONFIG.accessKey.toString("base64"),
  VYAKTI_AUTH_EMAIL_SENDER: CONFIG.sender,
  VYAKTI_AUTH_EMAIL_ALLOWED_ORIGINS: CONFIG.allowedOrigins[0],
  VYAKTI_AUTH_EMAIL_KEK_ID: ENV.VYAKTI_AUTH_EMAIL_KEK_ID,
  VYAKTI_AUTH_EMAIL_KEK_B64: ENV.VYAKTI_AUTH_EMAIL_KEK_B64,
  SUPABASE_URL: CONFIG.supabase,
  SUPABASE_SERVICE_ROLE_KEY: CONFIG.serviceRole,
  VERCEL_URL: "vyakti-preview-abc123.vercel.app",
};

let checks = 0;
const ok = (name) => console.log(`ok ${++checks} - ${name}`);
const requestInput = (patch = {}) => ({ request_id: REQUEST, email: EMAIL, redirect_url: REDIRECT, ...patch });

function fakeDb(options = {}) {
  let record = null, sequence = 0;
  const calls = [];
  const copy = () => record && structuredClone(record);
  const db = async (sql, params) => {
    calls.push({ sql, params: structuredClone(params) });
    if (sql === AUTH_EMAIL_ADMIT_SQL) {
      if (record) return record.request_hash === params[1] && record.email_hash === params[2]
        && record.redirect_url === params[3] && record.redirect_hash === params[4] ? [copy()] : [];
      if (options.cap) throw Object.assign(new Error("maximum value reached for sequence vy_auth_email_pilot_slot_seq"), { code: "2200H" });
      sequence += 1;
      record = { request_id: params[0], pilot_slot: sequence, request_hash: params[1], email_hash: params[2], redirect_url: params[3], redirect_hash: params[4],
        owner_user_id: null, state: "admitted", payload_envelope: null, payload_hash: null, acs_operation_id: params[0], repeatability_first_sent: params[5],
        operation_location: null, provider_status: null, attempt_count: 0, last_error_code: "", expires_at: params[6], payload_erased_at: null, created_at: params[5], updated_at: params[5],
        preparation_token_hash: null, preparation_lease_expires_at: null };
      return [copy()];
    }
    if (!record) return [];
    if (sql === AUTH_EMAIL_CLAIM_PREPARATION_SQL) {
      if (record.state !== "admitted") return [];
      record.state = "preparing"; record.preparation_token_hash = params[2]; record.preparation_lease_expires_at = new Date(Date.now() + 120000).toISOString(); return [copy()];
    }
    if (sql === AUTH_EMAIL_COMPLETE_PREPARATION_SQL) {
      if (record.state !== "preparing" || record.preparation_token_hash !== params[2]) return [];
      Object.assign(record, { state: "prepared", owner_user_id: params[3], payload_envelope: JSON.parse(params[4]), payload_hash: params[5], preparation_token_hash: null, preparation_lease_expires_at: null }); return [copy()];
    }
    if (sql === AUTH_EMAIL_RELEASE_PREPARATION_SQL) { record.state = "admitted"; record.preparation_token_hash = null; record.preparation_lease_expires_at = null; record.last_error_code = params[3]; return [copy()]; }
    if (sql === AUTH_EMAIL_RECORD_PREPARATION_UNCERTAIN_SQL) { record.state = "reconcile_required"; record.preparation_token_hash = null; record.preparation_lease_expires_at = null; record.last_error_code = params[3]; return [copy()]; }
    if (sql === AUTH_EMAIL_READ_SQL) return record.request_hash === params[1] ? [copy()] : [];
    if (sql === AUTH_EMAIL_CLAIM_DISPATCH_SQL) { if (record.state !== "prepared") return []; record.state = "dispatching"; record.attempt_count += 1; if (typeof options.clock === "function") record.updated_at = new Date(options.clock()).toISOString(); return [copy()]; }
    if (sql === AUTH_EMAIL_RETRY_DISPATCH_SQL) { if (record.state !== "pending" || record.provider_status !== "NotStarted" || record.attempt_count >= 2) return []; if (options.capRetry) throw Object.assign(new Error("maximum value reached for sequence vy_auth_email_pilot_slot_seq"), { code: "2200H" }); sequence += 1; record.state = "dispatching"; record.attempt_count += 1; record.retry_pilot_slot = sequence; if (typeof options.clock === "function") record.updated_at = new Date(options.clock()).toISOString(); return [copy()]; }
    if (sql === AUTH_EMAIL_RECORD_PENDING_SQL) { Object.assign(record, { state: "pending", operation_location: params[2], provider_status: params[3] }); return [copy()]; }
    if (sql === AUTH_EMAIL_RECORD_TERMINAL_SQL) { if (!["dispatching", "pending", "reconcile_required"].includes(record.state)) return []; Object.assign(record, { state: params[2], provider_status: params[3], last_error_code: params[4], payload_envelope: null, payload_hash: null, payload_erased_at: new Date().toISOString() }); return [copy()]; }
    if (sql === AUTH_EMAIL_RECORD_RECONCILE_SQL) { record.state = "reconcile_required"; record.last_error_code = params[2]; return [copy()]; }
    if (sql === AUTH_EMAIL_EXPIRE_SQL) { if (options.expire && record.payload_envelope) { record.state = "expired"; record.payload_envelope = null; record.payload_hash = null; return [{ request_id: record.request_id }]; } return []; }
    if (sql === AUTH_EMAIL_FORGET_SQL) { if (record.owner_user_id === params[0]) { const id = record.request_id; record = null; return [{ request_id: id }]; } return []; }
    if (sql === AUTH_EMAIL_SWEEP_ROWS_SQL) return record && record.attempt_count > 0 && ["dispatching", "pending", "reconcile_required"].includes(record.state) ? [copy()] : [];
    throw new Error("unexpected_sql");
  };
  return { db, calls, state: () => copy(), mutate: (change) => { change(record); } };
}

const emailHash = sha256Hex(EMAIL), redirectHash = sha256Hex(REDIRECT);
const payload = { schema: "vyakti.auth-email-payload/v1", email: EMAIL, action_link: "https://fixture.supabase.co/auth/v1/verify?token=" + TOKEN,
  email_otp: "123456", verification_type: "magiclink" };
const payloadHash = sha256Hex(canonicalJson(payload));
const binding = { request_id: REQUEST, email_hash: emailHash, redirect_hash: redirectHash, payload_hash: payloadHash };
const envelope = encryptAuthEmailPayload(payload, binding, ENV);
assert.deepEqual(decryptAuthEmailPayload(envelope, binding, ENV), payload);
assert.throws(() => decryptAuthEmailPayload(envelope, { ...binding, redirect_hash: "d".repeat(64) }, ENV), /auth_email/);
assert(!JSON.stringify(envelope).includes(EMAIL) && !JSON.stringify(envelope).includes("123456"));
ok("encrypted outbox payload is bound to request, email and redirect with no plaintext recipient or token");

assert.equal(approvedAuthEmailRedirect(REDIRECT, CONFIG), REDIRECT);
assert.equal(approvedAuthEmailRedirect("https://vyakti-replica-lab.vercel.app/r/physics?lang=hi", CONFIG), "https://vyakti-replica-lab.vercel.app/r/physics?lang=hi");
assert.equal(approvedAuthEmailRedirect("https://vyakti-replica-lab.vercel.app/r/physics/?lang=hi", CONFIG), "https://vyakti-replica-lab.vercel.app/r/physics/?lang=hi");
for (const bad of ["https://evil.vercel.app/studio", "https://vyakti-replica-lab.vercel.app/admin", "http://vyakti-replica-lab.vercel.app/studio"])
  assert.equal(approvedAuthEmailRedirect(bad, CONFIG), null);
ok("Azure lane accepts only an exact configured origin and approved Studio or Room path");

const deploymentConfig = await authEmailAzureConfig(CONFIG_ENV);
assert.deepEqual(deploymentConfig.allowedOrigins, [CONFIG.allowedOrigins[0], "https://vyakti-preview-abc123.vercel.app"]);
const canonicalConfig = await authEmailAzureConfig({ ...CONFIG_ENV, VYAKTI_AUTH_EMAIL_ALLOWED_ORIGINS: `${CONFIG.allowedOrigins[0]}/` });
assert.equal(canonicalConfig.allowedOrigins[0], CONFIG.allowedOrigins[0]);
assert.equal(approvedAuthEmailRedirect("https://vyakti-preview-abc123.vercel.app/studio", deploymentConfig), "https://vyakti-preview-abc123.vercel.app/studio");
assert.equal(approvedAuthEmailRedirect("https://unrelated-preview.vercel.app/studio", deploymentConfig), null);
for (const bad of ["https://vyakti-preview-abc123.vercel.app", "vyakti-preview-abc123.vercel.app/path", "*.vercel.app",
  "vyakti-preview-abc123.vercel.app.evil.test", "bad-.vercel.app", "user@vyakti-preview-abc123.vercel.app", "vyakti-preview-abc123.vercel.app:443"]) {
  await assert.rejects(authEmailAzureConfig({ ...CONFIG_ENV, VERCEL_URL: bad }), /auth_email_provider_unavailable/);
}
ok("only the trusted path-free VERCEL_URL hostname adds the current exact Preview origin");

const linkResponse = { action_link: `${CONFIG.supabase}/auth/v1/verify?token=${TOKEN}&type=signup&redirect_to=${encodeURIComponent(REDIRECT)}`,
  email_otp: "123456", hashed_token: TOKEN, verification_type: "signup", redirect_to: REDIRECT, id: OWNER, email: EMAIL };
const generated = await generateSupabaseAuthEmailLink(CONFIG, { email: EMAIL, redirect_url: REDIRECT }, async () => new Response(JSON.stringify(linkResponse), { status: 200 }));
assert.equal(generated.owner_user_id, OWNER); assert.equal(generated.email_otp, "123456");
validateAuthEmailPayload(CONFIG, { schema: "vyakti.auth-email-payload/v1", email: EMAIL, action_link: generated.action_link,
  email_otp: generated.email_otp, verification_type: generated.verification_type }, { email_hash: emailHash, redirect_url: REDIRECT });
await assert.rejects(generateSupabaseAuthEmailLink(CONFIG, { email: EMAIL, redirect_url: REDIRECT }, async () => new Response(JSON.stringify({ ...linkResponse, redirect_to: "https://evil.invalid/studio" }), { status: 200 })), /auth_email_link_response_invalid/);
ok("Supabase Admin link response is server-only and exact-bound before mail preparation");

const signed = signAcsAuthEmailRequest({ method: "POST", url: `${CONFIG.endpoint}/emails:send?api-version=2023-03-31`, body: "{}", accessKey: CONFIG.accessKey, date: 0 });
assert.match(signed.Authorization, /^HMAC-SHA256 SignedHeaders=/); assert(!JSON.stringify(signed).includes(CONFIG.accessKey.toString("base64")));
assert.equal(validateAcsOperationLocation(CONFIG, `https://evil.invalid/emails/operations/${REQUEST}?api-version=2023-03-31`, REQUEST), null);
ok("ACS HMAC and operation polling bind exact host, operation and API version without exposing the key");

let sentBody, sentHeaders;
const send = await sendAzureAuthEmail(CONFIG, { ...payload, operation_id: REQUEST, repeatability_first_sent: "2026-10-10T00:00:00.000Z" }, async (_url, init) => {
  sentBody = JSON.parse(init.body); sentHeaders = init.headers;
  return new Response("", { status: 202, headers: { "operation-location": `${CONFIG.endpoint}/emails/operations/${REQUEST}?api-version=2023-03-31`, "retry-after": "3" } });
});
assert.equal(sentBody.recipients.to.length, 1); assert.equal(sentBody.recipients.to[0].address, EMAIL);
assert.equal(sentHeaders["Operation-Id"], REQUEST); assert.equal(sentHeaders["Repeatability-Request-ID"], REQUEST); assert.equal(send.retry_after_seconds, 3);
ok("native ACS request has one recipient and stable operation and repeatability identifiers");

let providerSends = 0, linkCalls = 0, status = "Running";
const fixture = fakeDb();
const options = { config: CONFIG, env: ENV, now: Date.parse("2026-10-10T00:00:00.000Z"),
  generateLink: async () => { linkCalls += 1; return { ...generated }; },
  sendEmail: async (_config, input) => { providerSends += 1; assert.equal(input.operation_id, REQUEST); return { state: "pending", operation_location: `${CONFIG.endpoint}/emails/operations/${REQUEST}?api-version=2023-03-31` }; },
  readEmail: async () => ({ status }),
};
options.clock = () => options.now;
const first = await requestVyaktiAuthEmail(fixture.db, requestInput(), options);
assert.equal(first.state, "accepted"); assert.equal(linkCalls, 1); assert.equal(providerSends, 1); assert.equal(fixture.state().state, "pending");
const replay = await requestVyaktiAuthEmail(fixture.db, requestInput(), options);
assert.equal(replay.state, "accepted"); assert.equal(linkCalls, 1); assert.equal(providerSends, 1);
status = "Succeeded"; const complete = await requestVyaktiAuthEmail(fixture.db, requestInput(), options);
assert.equal(complete.state, "succeeded"); assert.equal(fixture.state().payload_envelope, null);
ok("same request generates and sends once, polls safely, and scrubs payload at terminal success");

const terminalFence = fakeDb();
await requestVyaktiAuthEmail(terminalFence.db, requestInput(), { ...options, generateLink: async () => ({ ...generated }),
  sendEmail: async () => ({ state: "pending", operation_location: `${CONFIG.endpoint}/emails/operations/${REQUEST}?api-version=2023-03-31` }),
  readEmail: async () => ({ status: "Running" }) });
const storeRequest = { request_id: REQUEST, email_hash: emailHash, redirect_hash: redirectHash, redirect_url: REDIRECT };
await recordAuthEmailTerminal(terminalFence.db, storeRequest, "succeeded", "Succeeded");
const staleTerminal = await recordAuthEmailTerminal(terminalFence.db, storeRequest, "failed", "Failed", "auth_email_delivery_failed");
assert.equal(staleTerminal.state, "succeeded"); assert.equal(terminalFence.state().state, "succeeded");
terminalFence.mutate(row => { row.state = "expired"; });
const expiredTerminal = await recordAuthEmailTerminal(terminalFence.db, storeRequest, "succeeded", "Succeeded");
assert.equal(expiredTerminal.state, "expired"); assert.equal(terminalFence.state().state, "expired");
ok("terminal and expired delivery states cannot be overwritten by concurrent stale polls");

let preparationRelease, preparationStarted;
const preparationGate = new Promise(resolve => { preparationRelease = resolve; });
const preparationStartedGate = new Promise(resolve => { preparationStarted = resolve; });
const preparationRace = fakeDb(); let preparationLinkCalls = 0;
const preparationOptions = { ...options,
  generateLink: async () => { preparationLinkCalls += 1; preparationStarted(); await preparationGate; return { ...generated }; },
  sendEmail: async () => ({ state: "pending", operation_location: `${CONFIG.endpoint}/emails/operations/${REQUEST}?api-version=2023-03-31` }),
  readEmail: async () => ({ status: "Running" }) };
const preparationWinner = requestVyaktiAuthEmail(preparationRace.db, requestInput(), preparationOptions);
await preparationStartedGate;
await assert.rejects(requestVyaktiAuthEmail(preparationRace.db, requestInput(), preparationOptions), /auth_email_link_generation_uncertain/);
assert.equal(preparationLinkCalls, 1); assert.equal(preparationRace.state().state, "preparing");
preparationRelease(); await preparationWinner;
ok("a concurrent preparing-row reader retains the same request instead of reporting provider acceptance");

let lateNow = options.now, lateSends = 0;
const late = fakeDb();
await assert.rejects(requestVyaktiAuthEmail(late.db, requestInput(), {
  ...options, clock: () => lateNow,
  generateLink: async () => { lateNow += 6 * 60 * 1000; return { ...generated }; },
  sendEmail: async () => { lateSends += 1; throw new Error("must_not_send"); },
  readEmail: async () => ({ status: "NotStarted" }),
}), /auth_email_retry_horizon_elapsed/);
assert.equal(lateSends, 0); assert.equal(late.state().state, "reconcile_required");
ok("repeatability age is read from a fresh clock immediately before ACS dispatch");

let initialRelease, initialStarted;
const initialGate = new Promise(resolve => { initialRelease = resolve; });
const initialStartedGate = new Promise(resolve => { initialStarted = resolve; });
const initialRace = fakeDb(); let initialRaceSends = 0;
const initialRaceOptions = { ...options, generateLink: async () => ({ ...generated }), readEmail: async () => ({ status: "NotStarted" }),
  sendEmail: async () => { initialRaceSends += 1; initialStarted(); await initialGate; return { state: "pending", operation_location: `${CONFIG.endpoint}/emails/operations/${REQUEST}?api-version=2023-03-31` }; } };
const initialWinner = requestVyaktiAuthEmail(initialRace.db, requestInput(), initialRaceOptions);
await initialStartedGate;
await assert.rejects(requestVyaktiAuthEmail(initialRace.db, requestInput(), initialRaceOptions), /auth_email_delivery_uncertain/);
assert.equal(initialRaceSends, 1); assert.equal(initialRace.state().attempt_count, 1);
await assert.rejects(requestVyaktiAuthEmail(initialRace.db, requestInput(), initialRaceOptions), /auth_email_delivery_uncertain/);
assert.equal(initialRaceSends, 1); assert.equal(initialRace.state().state, "dispatching");
initialRelease(); await initialWinner;

let retryPhase = "initial", retryRelease, retryStarted, retryNow = options.now;
const retryGate = new Promise(resolve => { retryRelease = resolve; });
const retryStartedGate = new Promise(resolve => { retryStarted = resolve; });
const retryRace = fakeDb({ clock: () => retryNow }); let retryRaceSends = 0;
const retryRaceOptions = { ...options, clock: () => retryNow, generateLink: async () => ({ ...generated }), readEmail: async () => ({ status: "NotStarted" }),
  sendEmail: async () => { retryRaceSends += 1; if (retryPhase === "initial") throw Object.assign(new Error("lost"), { ambiguous: true }); retryStarted(); await retryGate; return { state: "pending", operation_location: `${CONFIG.endpoint}/emails/operations/${REQUEST}?api-version=2023-03-31` }; } };
await assert.rejects(requestVyaktiAuthEmail(retryRace.db, requestInput(), retryRaceOptions), /auth_email_delivery_uncertain/);
retryPhase = "retry"; retryNow += 31_000;
const retryWinner = requestVyaktiAuthEmail(retryRace.db, requestInput(), retryRaceOptions);
await retryStartedGate;
await assert.rejects(requestVyaktiAuthEmail(retryRace.db, requestInput(), retryRaceOptions), /auth_email_delivery_uncertain/);
assert.equal(retryRaceSends, 2); assert.equal(retryRace.state().attempt_count, 2);
retryRelease(); await retryWinner;
ok("only the initial or retry dispatch claim winner can call ACS");

await assert.rejects(requestVyaktiAuthEmail(fixture.db, requestInput({ email: "other@example.test" }), options), /auth_email_request_conflict/);
assert.equal(linkCalls, 1); assert.equal(providerSends, 1);
ok("request UUID is exactly bound to recipient and redirect before any provider replay");

let ambiguousSends = 0;
let ambiguousNow = options.now;
const ambiguous = fakeDb({ clock: () => ambiguousNow });
const ambiguousOptions = { ...options, generateLink: async () => ({ ...generated }), readEmail: async () => ({ status: "NotStarted" }),
  sendEmail: async () => { ambiguousSends += 1; throw Object.assign(new Error("lost"), { code: "auth_email_delivery_ambiguous", ambiguous: true }); } };
await assert.rejects(requestVyaktiAuthEmail(ambiguous.db, requestInput(), { ...ambiguousOptions, clock: () => ambiguousNow }), /auth_email_delivery_uncertain/);
assert.equal(ambiguous.state().state, "dispatching");
const fourMinutes = ambiguousOptions.now + 4 * 60 * 1000;
ambiguousNow = fourMinutes;
await assert.rejects(requestVyaktiAuthEmail(ambiguous.db, requestInput(), { ...ambiguousOptions, now: fourMinutes, clock: () => ambiguousNow }), /auth_email_delivery_uncertain/);
assert.equal(ambiguousSends, 2); assert.equal(ambiguous.state().attempt_count, 2);
const sixMinutes = ambiguousOptions.now + 6 * 60 * 1000;
await assert.rejects(requestVyaktiAuthEmail(ambiguous.db, requestInput(), { ...ambiguousOptions, now: sixMinutes, clock: () => sixMinutes }), /auth_email_retry_horizon_elapsed/);
assert.equal(ambiguousSends, 2); assert.equal(ambiguous.state().state, "reconcile_required");
ok("ambiguous retry reuses one token and operation inside five minutes, then refuses outside the horizon");

let capNow = options.now;
const retryCapped = fakeDb({ capRetry: true, clock: () => capNow });
await assert.rejects(requestVyaktiAuthEmail(retryCapped.db, requestInput(), { ...ambiguousOptions, clock: () => capNow }), /auth_email_delivery_uncertain/);
const oneMinute = ambiguousOptions.now + 60_000;
capNow = oneMinute;
await assert.rejects(requestVyaktiAuthEmail(retryCapped.db, requestInput(), { ...ambiguousOptions, now: oneMinute, clock: () => capNow }), /auth_email_pilot_cap_reached/);
assert.equal(retryCapped.state().attempt_count, 1);
ok("the same 50-slot global cap covers resend attempts as well as initial recipients");

const uncertainLink = fakeDb(); let uncertainLinkCalls = 0;
const uncertainLinkOptions = { ...options, generateLink: async () => {
  uncertainLinkCalls += 1; throw Object.assign(new Error("lost"), { code: "auth_email_link_generation_uncertain", ambiguous: true });
} };
await assert.rejects(requestVyaktiAuthEmail(uncertainLink.db, requestInput(), uncertainLinkOptions), { code: "auth_email_link_generation_uncertain" });
await assert.rejects(requestVyaktiAuthEmail(uncertainLink.db, requestInput(), uncertainLinkOptions), /auth_email_link_generation_uncertain/);
assert.equal(uncertainLinkCalls, 1); assert.equal(uncertainLink.state().state, "reconcile_required");
ok("ambiguous link generation is fenced permanently and never creates a second mailed token");

const abandonedPreparation = fakeDb();
await admitAuthEmail(abandonedPreparation.db, { request_id: REQUEST, email_hash: emailHash, redirect_hash: redirectHash, redirect_url: REDIRECT }, options.now);
await claimAuthEmailPreparation(abandonedPreparation.db, { request_id: REQUEST, email_hash: emailHash, redirect_hash: redirectHash, redirect_url: REDIRECT });
abandonedPreparation.mutate(row => { row.preparation_lease_expires_at = new Date(options.now - 1).toISOString(); });
let abandonedLinkCalls = 0;
await assert.rejects(requestVyaktiAuthEmail(abandonedPreparation.db, requestInput(), { ...options, generateLink: async () => { abandonedLinkCalls += 1; return generated; } }), /auth_email_link_generation_uncertain/);
assert.equal(abandonedLinkCalls, 0); assert.equal(abandonedPreparation.state().state, "preparing");
ok("an abandoned preparation refuses after its lease and never regenerates a possibly issued token");

const capped = fakeDb({ cap: true });
await assert.rejects(admitAuthEmail(capped.db, { request_id: REQUEST, email_hash: emailHash, redirect_hash: redirectHash, redirect_url: REDIRECT }, Date.now()), /auth_email_pilot_cap_reached/);
ok("global sequence exhaustion refuses beyond the conservative 50-message pilot without cost claims");

await forgetAuthEmailAccount(ambiguous.db, OWNER);
assert.equal(ambiguous.state(), null);
ok("authenticated account forgetting deletes its owned encrypted auth-email rows");

const sweepFixture = fakeDb();
status = "Running";
await requestVyaktiAuthEmail(sweepFixture.db, requestInput(), options);
const swept = await runAuthEmailSweep(sweepFixture.db, { ...options, readEmail: async () => ({ status: "Succeeded" }) });
assert.equal(swept.checked, 1); assert.equal(swept.succeeded, 1); assert.equal(sweepFixture.state().payload_envelope, null);
ok("bounded sweep polls pending delivery and terminal cleanup erases encrypted payload");

for (const test of authEmailSqlCases()) {
  assert(!test.sql.includes(";"), `${test.name}: one statement`);
  const max = Math.max(0, ...[...test.sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1])));
  assert.equal(max, test.params.length, `${test.name}: complete typed parameter inventory`);
}
assert.equal(authEmailSqlCases().length, 14);
ok("fourteen exact one-statement SQL shapes have complete parser parameters");

const migration = readFileSync(join(ROOT, "db/migrations/174_vyakti_auth_email_outbox.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const account = readFileSync(join(ROOT, "api/account.js"), "utf8");
const retained = readFileSync(join(ROOT, "api/_replica-erasure-retained.js"), "utf8");
assert(migration.includes("maxvalue 50 no cycle")
  && migration.includes("retry_pilot_slot bigint unique") && schema.includes("retry_pilot_slot bigint unique")
  && AUTH_EMAIL_RETRY_DISPATCH_SQL.includes("retry_pilot_slot=nextval('vy_auth_email_pilot_slot_seq')"));
assert(account.includes("await forgetAuthEmailAccount(q, user.id)") && retained.includes("vy_auth_email_outbox"));
assert(account.indexOf('refused(res, "otp_send_dest"') < account.indexOf("requestVyaktiAuthEmail(q"));
ok("schema mirror, account forgetting, per-destination throttle order and per-replica retention are wired");

const dark = fakeDb();
assert.equal(await requestVyaktiAuthEmail(dark.db, requestInput(), { config: null }), null); assert.equal(dark.calls.length, 0);
ok("provider flag dark preserves the existing Supabase email caller with zero outbox work");

const developmentPlan = await authEmail174Plan();
assert.equal(developmentPlan.database, "vyakti_expert_integration_20260906");
assert.equal(developmentPlan.ddl.length, 5); assert.equal(developmentPlan.explains.length, 14);
let developmentCalls = 0;
await assert.rejects(runAuthEmail174Development({ q: async () => { developmentCalls += 1; throw new Error("must_not_query"); },
  expectedMigrationSha256: "0".repeat(64), writeReceipt: async () => { throw new Error("must_not_write"); } }), /migration174_hash_mismatch/);
assert.equal(developmentCalls, 0);
await assert.rejects(runAuthEmail174Development({ q: async sql => { developmentCalls += 1; assert.equal(sql, "select current_database() as name"); return [{ name: "neondb" }]; },
  expectedMigrationSha256: developmentPlan.migrationSha256, writeReceipt: async () => { throw new Error("must_not_write"); } }), /exact_development_database_required/);
assert.equal(developmentCalls, 1);
ok("development migration helper is plan-only by default and refuses wrong hash or database before DDL");

console.log(`PASS ${checks} auth-email groups; offline fakes only, no DB, Supabase, Azure, email, user or key call`);
