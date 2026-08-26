import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSignedReplicaRead } from "../../api/_replica-storage.js";
import { encryptProviderConsentName } from "../../api/_replica-provider-consent-crypto.js";
import {
  PROVIDER_CONSENT_POLICY_VERSION,
  PROVIDER_CONSENT_TEMPLATE_VERSION,
  providerConsentStatementHash,
  renderProviderConsentStatement,
} from "../../api/_replica-provider-consent.js";
import {
  completeOwnedVoiceProfileDeletion,
  getOwnedVoiceProfile,
  loadOwnedAzureVoiceEnrollment,
  markOwnedVoiceProfileDeleting,
  materializeAzureVoiceEnrollment,
  persistCreatedVoiceProfile,
  selectAzureEnrollmentArtifacts,
  updateOwnedVoiceProfileStatus,
} from "../../api/_replica-voice-profile.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const PCID = "30000000-0000-4000-8000-000000000003";
const CONSENT_SOURCE = "40000000-0000-4000-8000-000000000004";
const SOURCE_A = "50000000-0000-4000-8000-000000000005";
const SOURCE_B = "60000000-0000-4000-8000-000000000006";
const ARTIFACT_A = "70000000-0000-4000-8000-000000000007";
const ARTIFACT_B = "80000000-0000-4000-8000-000000000008";
const PROFILE = "90000000-0000-4000-8000-000000000009";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const CONSENT_SHA = "c".repeat(64);
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
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-for-tests",
  REPLICA_PROVIDER_CONSENT_KEK_ID: "provider-consent-kek-v1",
  REPLICA_PROVIDER_CONSENT_KEK_B64: Buffer.alloc(32, 37).toString("base64"),
};
Object.assign(process.env, env);
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

const storageCalls = [];
const signed = await createSignedReplicaRead(`${OWNER}/${RID}/${CONSENT_SOURCE}/original`, {
  expiresIn: 300,
  fetchImpl: async (url, init) => {
    storageCalls.push({ url, init });
    return new Response(JSON.stringify({ signedURL: `/object/sign/vyakti-replica-private/${OWNER}/${RID}/${CONSENT_SOURCE}/original?token=opaque` }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  },
});
ok("private read capability is short-lived and bound to the Supabase storage origin",
  signed.url.startsWith("https://private.example/storage/v1/object/sign/vyakti-replica-private/") && signed.url.includes("token=opaque"));
ok("signed read is issued server-side with a bounded five-minute expiry",
  storageCalls[0].init.method === "POST" && JSON.parse(storageCalls[0].init.body).expiresIn === 300);
await assert.rejects(createSignedReplicaRead(`${OWNER}/${RID}/${CONSENT_SOURCE}/original`, {
  fetchImpl: async () => new Response(JSON.stringify({ signedURL: "https://attacker.invalid/object/sign/x?token=stolen" }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }),
}), /signed_read_origin_invalid/);
ok("storage cannot redirect a private read capability to another origin", true);

function artifact(overrides = {}) {
  const sourceId = overrides.source_id || SOURCE_A;
  const artifactId = overrides.artifact_id || ARTIFACT_A;
  return {
    artifact_id: artifactId, source_id: sourceId, replica_id: RID, owner_user_id: OWNER,
    stage: "enhance", storage_bucket: "vyakti-replica-private",
    object_path: `${OWNER}/${RID}/${sourceId}/derived/enhancement-v1/enhance/${artifactId}`,
    mime: "audio/wav", byte_size: 620_000, duration_ms: 31_000,
    sha256: overrides.sha256 || SHA_A, adapter_name: "identity-preserving-enhancer",
    adapter_version: "2026-08-24", source_state: "processing", contains_third_parties: false,
    ...overrides,
  };
}

const selected = selectAzureEnrollmentArtifacts([
  artifact(),
  artifact({ artifact_id: "71000000-0000-4000-8000-000000000007", duration_ms: 35_000 }),
  artifact({ artifact_id: ARTIFACT_B, source_id: SOURCE_B, sha256: SHA_B, duration_ms: 32_000,
    object_path: `${OWNER}/${RID}/${SOURCE_B}/derived/enhancement-v1/enhance/${ARTIFACT_B}` }),
  artifact({ artifact_id: "a0000000-0000-4000-8000-00000000000a", source_id: "b0000000-0000-4000-8000-00000000000b",
    adapter_name: "fake-enhancer", object_path: `${OWNER}/${RID}/b0000000-0000-4000-8000-00000000000b/derived/x` }),
]);
ok("selection is deterministic and uses at most one approved enhancement per source",
  selected.length === 2 && selected[0].artifact_id === ARTIFACT_A && selected[1].artifact_id === ARTIFACT_B);
ok("production reference duration stays inside the 30-90 second quality envelope",
  selected.reduce((sum, row) => sum + row.duration_ms, 0) === 63_000);
assert.throws(() => selectAzureEnrollmentArtifacts([artifact({ duration_ms: 12_000 })]), /duration_insufficient/);
assert.throws(() => selectAzureEnrollmentArtifacts([artifact({ contains_third_parties: true })]), /duration_insufficient/);
ok("short and third-party-only artifact sets fail closed", true);

const fullName = "Raghav Sharma";
const statementHash = providerConsentStatementHash(renderProviderConsentStatement(fullName, env.AZURE_PERSONAL_VOICE_COMPANY_NAME));
const binding = {
  provider_consent_id: PCID, replica_id: RID, owner_user_id: OWNER,
  provider: "azure_personal_voice", template_version: PROVIDER_CONSENT_TEMPLATE_VERSION,
  statement_sha256: statementHash,
};
const encrypted = encryptProviderConsentName(fullName, binding, env);
const enrollment = {
  replica_id: RID, owner_user_id: OWNER, policy_version: "replica-self-v1",
  genome_version: 3, source_set_hash: "d".repeat(64), genome_definition: {},
  provider_consent_id: PCID, provider: "azure_personal_voice",
  provider_policy_version: PROVIDER_CONSENT_POLICY_VERSION,
  template_version: PROVIDER_CONSENT_TEMPLATE_VERSION, locale: "en-US", statement_sha256: statementHash,
  ...encrypted,
  consent_source_id: CONSENT_SOURCE, consent_storage_bucket: "vyakti-replica-private",
  consent_object_path: `${OWNER}/${RID}/${CONSENT_SOURCE}/original`, consent_mime: "audio/wav",
  consent_byte_size: 240_000, consent_duration_ms: 12_000, consent_sha256: CONSENT_SHA,
  artifacts: [artifact(), artifact({ artifact_id: ARTIFACT_B, source_id: SOURCE_B, sha256: SHA_B,
    duration_ms: 32_000, object_path: `${OWNER}/${RID}/${SOURCE_B}/derived/enhancement-v1/enhance/${ARTIFACT_B}` })],
};
const signPaths = [];
const prepared = await materializeAzureVoiceEnrollment(enrollment, async (path) => {
  signPaths.push(path);
  return { url: `https://private.example/storage/v1/object/sign/vyakti-replica-private/${path}?token=opaque` };
}, env);
ok("materialization binds exact consent name locale source hashes genome and pinned model",
  prepared.input.consent.voiceTalentName === fullName && prepared.input.consent.locale === "en-US" &&
  prepared.input.genomeVersion === 3 && prepared.input.references.length === 2 && /^[0-9a-f]{64}$/.test(prepared.enrollmentCommitment));
ok("only short-lived reads for the exact consent and approved artifacts are materialized",
  signPaths.length === 3 && signPaths[0] === enrollment.consent_object_path &&
  signPaths.slice(1).every((path) => path.includes("/derived/")));
const rePrepared = await materializeAzureVoiceEnrollment(enrollment, async (path) => ({
  url: `https://private.example/storage/v1/object/sign/vyakti-replica-private/${path}?token=different`,
}), env);
ok("signed token rotation cannot change enrollment or profile identity",
  prepared.enrollmentCommitment === rePrepared.enrollmentCommitment && prepared.voiceProfileId === rePrepared.voiceProfileId &&
  prepared.input.idempotencyKey === rePrepared.input.idempotencyKey);

let loadSql = "";
const loaded = await loadOwnedAzureVoiceEnrollment(async (sql, params) => {
  loadSql = sql;
  assert.deepEqual(params.slice(0, 3), [RID, OWNER, 3]);
  return [enrollment];
}, OWNER, RID, 3);
ok("enrollment load is exact owner replica and approved genome version scoped", loaded === enrollment &&
  /r\.owner_user_id=\$2(?:::uuid)?/.test(loadSql) && /vg\.version=\$3(?:::int4)? and vg\.status='approved'/.test(loadSql));
ok("load requires verified self identity current training rights and uploaded provider evidence",
  /r\.subject_mode='self'/.test(loadSql) && /identity_verified_at is not null/.test(loadSql) &&
  /array\['capture','storage','biometric','training'\]/.test(loadSql) && /x\.state='uploaded'/.test(loadSql));
ok("only VoiceGenome-pinned enrollment artifact ids can become provider inputs",
  loadSql.includes("references,enrollment_artifact_ids") && /a\.artifact_id=wanted\.id::uuid/.test(loadSql));

let persistSql = "";
const persisted = await persistCreatedVoiceProfile(async (sql, params) => {
  persistSql = sql;
  return [{
    voice_profile_id: params[2], replica_id: params[0], genome_version: params[3],
    provider: "azure_personal_voice", model: params[5], provider_ref: params[6],
    capabilities: JSON.parse(params[7]), status: params[8], failure_code: "",
    enrollment_commitment: params[9], provider_consent_id: params[4],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }];
}, OWNER, prepared, { providerRef: "azpv1.opaque", state: "ready" }, { model: env.AZURE_PERSONAL_VOICE_BASE_MODEL });
ok("successful provider result becomes one opaque ready voice profile", persisted.status === "ready" && persisted.voice_profile_id === prepared.voiceProfileId);
ok("persistence atomically rechecks authority accepts provider consent and writes content-free audit",
  /pc\.state='uploaded'/.test(persistSql) && /update vy_replica_provider_consent pc set state='accepted'/.test(persistSql) &&
  /voice_profile\.create/.test(persistSql));
ok("retry upserts only the same enrollment commitment instead of creating a second paid identity",
  /on conflict \(replica_id,provider,enrollment_commitment\)/.test(persistSql));

let profileSql = "";
await getOwnedVoiceProfile(async (sql) => { profileSql = sql; return [persisted]; }, OWNER, RID, 3);
ok("profile status reads retain authenticated tenant ownership", /vp\.owner_user_id=\$2/.test(profileSql));
let statusSql = "";
const refreshed = await updateOwnedVoiceProfileStatus(async (sql) => {
  statusSql = sql;
  return [{ ...persisted, status: "ready" }];
}, OWNER, persisted, "ready");
ok("provider status can update only the exact owned active profile", refreshed.status === "ready" &&
  /vp\.voice_profile_id=\$3/.test(statusSql) && /vp\.owner_user_id=\$2/.test(statusSql));

let deletingSql = "";
const deleting = await markOwnedVoiceProfileDeleting(async (sql) => {
  deletingSql = sql;
  return [{ ...persisted, status: "deleting" }];
}, OWNER, RID, persisted.voice_profile_id);
ok("deletion disables the profile before external cleanup and revokes active runtime authority",
  deleting.status === "deleting" && /set status='deleting'/.test(deletingSql) && /runtime_capability/.test(deletingSql) &&
  /voice_profile_deleted/.test(deletingSql));
let completeSql = "";
const deleted = await completeOwnedVoiceProfileDeletion(async (sql) => {
  completeSql = sql;
  return [{ voice_profile_id: PROFILE }];
}, OWNER, { ...persisted, voice_profile_id: PROFILE });
ok("confirmed provider deletion removes mapping and revokes the no-longer-valid provider consent",
  deleted && /delete from vy_replica_voice_profile/.test(completeSql) && /set state='revoked'/.test(completeSql));

const migration = readFileSync(join(ROOT, "db/migrations/034_replica_voice_enrollment.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const route = readFileSync(join(ROOT, "api/replica-voice.js"), "utf8");
const replicaCore = readFileSync(join(ROOT, "api/_replica.js"), "utf8");
ok("migration is production splitter safe", splitSql(migration).length === 12);
ok("database adds tenant provider-consent genome and commitment bindings",
  migration.includes("vy_replica_voice_profile_owner_fk") && migration.includes("vy_replica_voice_profile_genome_fk") &&
  migration.includes("vy_replica_voice_profile_consent_fk") && migration.includes("vy_replica_voice_enrollment_commitment_ix"));
ok("database permits only one creating or ready provider profile per exact genome",
  /where status in \('creating','ready'\)/.test(migration));
ok("canonical schema contains the voice enrollment migration", schema.includes("vy_replica_voice_one_live_ix"));
ok("HTTP route derives all ownership from bearer auth and returns only whitelisted profiles",
  route.includes("requireUser(req)") && route.includes("clientVoiceProfile") && !route.includes("body.owner_user_id"));
ok("full replica revocation immediately disables provider profiles and consent before erasure",
  /voice_profiles as \([\s\S]*status = 'deleting'/.test(replicaCore) &&
  /provider_consents as \([\s\S]*state = 'revoked'/.test(replicaCore));

console.log(`\n${checks} voice enrollment checks passed`);
