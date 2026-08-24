import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProviderConsentSource,
  finalizeProviderConsentSource,
  getPendingProviderConsentSource,
  issueOwnedProviderConsent,
  latestOwnedProviderConsent,
  providerConsentName,
  providerConsentStatementHash,
  renderProviderConsentStatement,
  PROVIDER_CONSENT_POLICY_VERSION,
  PROVIDER_CONSENT_TEMPLATE_VERSION,
} from "../../api/_replica-provider-consent.js";
import {
  decryptProviderConsentName,
  encryptProviderConsentName,
} from "../../api/_replica-provider-consent-crypto.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const PCID = "30000000-0000-4000-8000-000000000003";
const SOURCE = "40000000-0000-4000-8000-000000000004";
const SHA = "a".repeat(64);
const env = {
  AZURE_PERSONAL_VOICE_ENABLED: "true",
  AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED: "true",
  AZURE_PERSONAL_VOICE_ENDPOINT: "https://vyakti.cognitiveservices.azure.com",
  AZURE_PERSONAL_VOICE_TTS_ENDPOINT: "https://centralindia.tts.speech.microsoft.com",
  AZURE_PERSONAL_VOICE_KEY: "test-key-that-is-long-enough",
  AZURE_PERSONAL_VOICE_PROJECT_ID: "vyakti-personal-voice",
  AZURE_PERSONAL_VOICE_COMPANY_NAME: "Vyakti Labs",
  AZURE_PERSONAL_VOICE_BASE_MODEL: "DragonHD-2026-07",
  SUPABASE_URL: "https://private.example",
  REPLICA_PROVIDER_CONSENT_KEK_ID: "provider-consent-kek-v1",
  REPLICA_PROVIDER_CONSENT_KEK_B64: Buffer.alloc(32, 37).toString("base64"),
};
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

const name = providerConsentName("  Raghav   Sharma  ");
const statement = renderProviderConsentStatement(name, env.AZURE_PERSONAL_VOICE_COMPANY_NAME);
ok("Microsoft en-US statement is rendered exactly with normalized first and last name",
  name === "Raghav Sharma" && statement === "I Raghav Sharma am aware that recordings of my voice will be used by Vyakti Labs to create and use a synthetic version of my voice.");
ok("the statement has a stable lowercase SHA-256 commitment", /^[0-9a-f]{64}$/.test(providerConsentStatementHash(statement)));
assert.throws(() => providerConsentName("Raghav"), /provider_consent_full_name_invalid/);
assert.throws(() => providerConsentName("Raghav <script> Sharma"), /provider_consent_full_name_invalid/);
assert.throws(() => renderProviderConsentStatement("Raghav Sharma", "Vyakti Labs", "hi-IN"), /locale_unsupported/);
ok("single names markup and unpinned statement locales fail closed", true);

const binding = {
  provider_consent_id: PCID,
  replica_id: RID,
  owner_user_id: OWNER,
  provider: "azure_personal_voice",
  template_version: PROVIDER_CONSENT_TEMPLATE_VERSION,
  statement_sha256: providerConsentStatementHash(statement),
};
const sealed = encryptProviderConsentName(name, binding, env);
const resealed = encryptProviderConsentName(name, binding, env);
ok("full name is envelope-encrypted with randomized per-row material",
  sealed.algorithm === "AES-256-GCM" && sealed.ciphertext_b64 !== resealed.ciphertext_b64 && !JSON.stringify(sealed).includes(name));
ok("the exact consent binding decrypts the full name", decryptProviderConsentName(sealed, binding, env) === name);
assert.throws(() => decryptProviderConsentName(sealed, { ...binding, replica_id: SOURCE }, env), /binding_invalid/);
assert.throws(() => decryptProviderConsentName(sealed, binding, { ...env, REPLICA_PROVIDER_CONSENT_KEK_ID: "other-key-v1" }), /key_unavailable/);
ok("ciphertext cannot move across a replica or key generation", true);

await assert.rejects(issueOwnedProviderConsent(async () => [], OWNER, RID, { full_name: name }, {
  providerConsentId: PCID,
  env: { ...env, AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED: "false" },
}), /approval_required/);
ok("provider challenge issuance itself requires recorded Azure limited-access approval", true);

let issueSql = "";
let issueParams;
const issued = await issueOwnedProviderConsent(async (sql, params) => {
  issueSql = sql;
  issueParams = params;
  return [{
    provider_consent_id: params[2], replica_id: params[0], owner_user_id: params[1],
    provider: "azure_personal_voice", policy_version: params[7],
    provider_policy_version: params[8], template_version: params[9], locale: params[3],
    statement_sha256: params[4], state: "issued", source_id: null, attempt: 1,
    algorithm: params[10], key_id: params[11], nonce_b64: params[12], ciphertext_b64: params[13],
    auth_tag_b64: params[14], wrapped_dek_b64: params[15], wrap_nonce_b64: params[16],
    wrap_auth_tag_b64: params[17], aad_sha256: params[18], failure_code: "",
    issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString(),
    uploaded_at: null, accepted_at: null, revoked_at: null, updated_at: new Date().toISOString(),
  }];
}, OWNER, RID, { full_name: name, locale: "en-US" }, { providerConsentId: PCID, env });
ok("eligible owner receives the exact ephemeral statement", issued.statement === statement && issued.provider_consent_id === PCID);
ok("issuance rechecks verified adult self ownership and all four training capabilities",
  /r\.owner_user_id=\$2/.test(issueSql) && /age_verified_at is not null/.test(issueSql) &&
  /identity_verified_at is not null/.test(issueSql) && /liveness_verified_at is not null/.test(issueSql) &&
  /array\['capture','storage','biometric','training'\]/.test(issueSql));
ok("the daily attempt ceiling and one-live-provider-challenge arbiter are server-side",
  /attempts\.n<5/.test(issueSql) && /state in \('issued','uploaded'\)/.test(issueSql));
ok("neither full name nor rendered statement is sent to PostgreSQL",
  !issueSql.includes(name) && !issueSql.includes(statement) && !JSON.stringify(issueParams).includes(name) &&
  !JSON.stringify(issueParams).includes(statement));
ok("provider and template policy versions are immutable inputs",
  issueParams.includes(PROVIDER_CONSENT_POLICY_VERSION) && issueParams.includes(PROVIDER_CONSENT_TEMPLATE_VERSION));

let statusCalls = 0;
const uploaded = await latestOwnedProviderConsent(async () => {
  statusCalls++;
  if (statusCalls === 1) return [];
  return [{ ...issued, statement: undefined, owner_user_id: OWNER, state: "uploaded" }];
}, OWNER, RID, { env });
ok("status never replays the spoken phrase after private upload", uploaded.state === "uploaded" && !("statement" in uploaded));

let sourceSql = "";
const source = await createProviderConsentSource(async (sql, params) => {
  sourceSql = sql;
  return [{
    source_id: params[3], replica_id: params[0], owner_user_id: params[1], kind: "audio",
    capture_mode: "provider_consent", storage_bucket: params[4], object_path: params[5],
    mime: params[6], byte_size: params[7], duration_ms: params[8], sha256: params[9],
    state: "pending_upload", contains_third_parties: false, rejection_code: "",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }];
}, OWNER, RID, PCID, {
  mime: "audio/wav", byte_size: 320_000, duration_ms: 10_000, sha256: SHA,
  contains_third_parties: false,
}, { sourceId: SOURCE });
ok("provider consent receives an opaque private source path and dedicated capture mode",
  source.object_path === `${OWNER}/${RID}/${SOURCE}/original` && source.capture_mode === "provider_consent");
ok("source creation binds owner replica challenge and current granular rights",
  /pc\.owner_user_id=\$2/.test(sourceSql) && /pc\.provider_consent_id=\$3/.test(sourceSql) &&
  /array\['storage','biometric','training'\]/.test(sourceSql));
await assert.rejects(createProviderConsentSource(async () => [], OWNER, RID, PCID, {
  mime: "audio/webm", byte_size: 10, duration_ms: 10_000, sha256: SHA, contains_third_parties: false,
}), /wav_or_mp3/);
await assert.rejects(createProviderConsentSource(async () => [], OWNER, RID, PCID, {
  mime: "audio/wav", byte_size: 10, duration_ms: 10_000, sha256: SHA, contains_third_parties: true,
}), /only_owner/);
await assert.rejects(createProviderConsentSource(async () => [], OWNER, RID, PCID, {
  mime: "audio/wav", byte_size: 10, duration_ms: 2_000, sha256: SHA, contains_third_parties: false,
}), /duration_invalid/);
ok("browser-only codecs third parties and implausible duration are refused before storage", true);

let pendingSql = "";
const pending = await getPendingProviderConsentSource(async (sql) => {
  pendingSql = sql;
  return [source];
}, OWNER, RID, PCID, SOURCE);
ok("retry lookup is bound to the exact owner replica provider consent and source tuple",
  pending.source_id === SOURCE && /s\.owner_user_id=\$2/.test(pendingSql) &&
  /pc\.provider_consent_id=\$3/.test(pendingSql) && /s\.source_id=\$4/.test(pendingSql));

const finalizeSql = [];
const finalizeParams = [];
let finalizeCalls = 0;
const finalized = await finalizeProviderConsentSource(async (sql, params) => {
  finalizeSql.push(sql);
  finalizeParams.push(params);
  finalizeCalls++;
  if (finalizeCalls === 1) return [source];
  return [{
    source: { ...source, state: "quarantined" },
    provider_consent: { ...issued, owner_user_id: OWNER, state: "uploaded", source_id: SOURCE },
  }];
}, OWNER, RID, PCID, SOURCE, { byteSize: 320_000, mime: "audio/wav" }, { env });
ok("finalize moves verified storage metadata to provider quarantine", finalized.source.state === "quarantined" && finalized.provider_consent.state === "uploaded");
ok("provider evidence finalization never enters the generic processing DAG",
  !finalizeSql.join("\n").includes("vy_replica_processing_job") && !finalizeSql.join("\n").includes("'integrity'"));
ok("hash duration and speaker verification remain explicitly pending after object metadata checks",
  JSON.stringify(finalizeParams).includes("pending_server_verification") &&
  JSON.stringify(finalizeParams).includes("pending_server_probe"));

const migration = readFileSync(join(ROOT, "db/migrations/033_replica_provider_consent.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const sourceRoute = readFileSync(join(ROOT, "api/replica-source.js"), "utf8");
const sourceErasureCore = readFileSync(join(ROOT, "api/_replica-source-erasure.js"), "utf8");
const consentCore = readFileSync(join(ROOT, "api/_replica-consent.js"), "utf8");
const endpoint = readFileSync(join(ROOT, "api/replica-provider-consent.js"), "utf8");
ok("migration is accepted by the production one-statement splitter", splitSql(migration).length === 4);
ok("provider consent schema has encrypted fields composite ownership and a one-live challenge arbiter",
  /vy_replica_provider_consent_crypto_shape/.test(migration) &&
  /foreign key \(source_id, replica_id, owner_user_id\)/.test(migration) &&
  /where state in \('issued','uploaded'\)/.test(migration));
ok("canonical schema includes migration 033", schema.includes("vy_replica_provider_consent_live_ix") && schema.includes("'provider_consent'"));
ok("generic source finalization cannot bypass the provider-specific transition",
  sourceRoute.includes("use_provider_consent_finalize"));
ok("source erasure first revokes and detaches provider evidence before the restrictive FK delete",
  /provider_consent as \([\s\S]*set source_id=null,state='revoked'/.test(sourceErasureCore) &&
  sourceErasureCore.indexOf("provider_consent as (") < sourceErasureCore.indexOf("delete from vy_replica_source"));
ok("capture biometric or training withdrawal immediately revokes provider consent",
  /provider_consents as \([\s\S]*update vy_replica_provider_consent set state = 'revoked'/.test(consentCore) &&
  /'biometric' = any\(\$3::text\[\]\)/.test(consentCore));
ok("HTTP boundary derives ownership from bearer auth and exposes no client owner id",
  endpoint.includes("requireUser(req)") && endpoint.includes("user.id") && !endpoint.includes("body.owner_user_id"));
ok("the provider endpoint and responses are explicitly non-cacheable", endpoint.includes('Cache-Control", "no-store'));

console.log(`\n${checks} provider consent checks passed`);
