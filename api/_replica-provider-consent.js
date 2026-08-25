import { createHash, randomUUID } from "node:crypto";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import { clientSource, privateObjectPath, sourceUploadInput, verifyStoredObject } from "./_replica-source.js";
import { REPLICA_STORAGE_BUCKET } from "./_replica-storage.js";
import { azurePersonalVoiceConfig } from "./_voice/providers/azure-personal-voice.js";
import {
  decryptProviderConsentName,
  encryptProviderConsentName,
} from "./_replica-provider-consent-crypto.js";

export const PROVIDER_CONSENT_POLICY_VERSION = "azure-personal-voice/2026-01-01";
export const PROVIDER_CONSENT_TEMPLATE_VERSION = "microsoft-personal-voice-consent/en-US/v1";
export const PROVIDER_CONSENT_LOCALE = "en-US";

const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .''’-]{0,78}[\p{L}\p{M}.]$/u;
const AZURE_AUDIO_MIMES = new Set(["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"]);
const MAX_PROVIDER_CONSENT_BYTES = 30 * 1024 * 1024;

function fail(code, status = 400) {
  throw Object.assign(new Error(code), { code, status });
}

export function providerConsentName(value) {
  const name = String(value || "").normalize("NFC").replace(/\s+/gu, " ").trim();
  const length = Array.from(name).length;
  if (length < 2 || length > 80 || name.split(" ").length < 2 || !NAME.test(name))
    fail("provider_consent_full_name_invalid");
  return name;
}

export function renderProviderConsentStatement(name, companyName, locale = PROVIDER_CONSENT_LOCALE) {
  if (locale !== PROVIDER_CONSENT_LOCALE) fail("provider_consent_locale_unsupported");
  const voiceTalentName = providerConsentName(name);
  const company = String(companyName || "").normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!company || Array.from(company).length > 80) fail("provider_consent_company_invalid", 503);
  return `I ${voiceTalentName} am aware that recordings of my voice will be used by ${company} to create and use a synthetic version of my voice.`;
}

export function providerConsentStatementHash(statement) {
  return createHash("sha256").update(String(statement), "utf8").digest("hex");
}

function cryptoBinding(row) {
  return {
    provider_consent_id: row.provider_consent_id,
    replica_id: row.replica_id,
    owner_user_id: row.owner_user_id,
    provider: row.provider,
    template_version: row.template_version,
    statement_sha256: row.statement_sha256,
  };
}

function clientProviderConsent(row, env = process.env) {
  if (!row) return null;
  const result = {
    provider_consent_id: row.provider_consent_id,
    replica_id: row.replica_id,
    provider: row.provider,
    policy_version: row.provider_policy_version,
    template_version: row.template_version,
    locale: row.locale,
    statement_sha256: row.statement_sha256,
    state: row.state,
    attempt: Number(row.attempt),
    source_id: row.source_id || null,
    failure_code: row.failure_code || "",
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    uploaded_at: row.uploaded_at || null,
    accepted_at: row.accepted_at || null,
    updated_at: row.updated_at,
  };
  if (row.state === "issued" && new Date(row.expires_at).getTime() > Date.now()) {
    const name = decryptProviderConsentName(row, cryptoBinding(row), env);
    const config = azurePersonalVoiceConfig(env);
    const statement = renderProviderConsentStatement(name, config.companyName, row.locale);
    if (providerConsentStatementHash(statement) !== row.statement_sha256)
      fail("provider_consent_statement_binding_invalid", 409);
    result.statement = statement;
  }
  return result;
}

const RETURNING = `provider_consent_id,replica_id,owner_user_id,provider,policy_version,
  provider_policy_version,template_version,locale,statement_sha256,state,source_id,attempt,
  algorithm,key_id,encode(nonce,'base64') as nonce_b64,
  encode(ciphertext,'base64') as ciphertext_b64,encode(auth_tag,'base64') as auth_tag_b64,
  encode(wrapped_dek,'base64') as wrapped_dek_b64,encode(wrap_nonce,'base64') as wrap_nonce_b64,
  encode(wrap_auth_tag,'base64') as wrap_auth_tag_b64,aad_sha256,failure_code,
  issued_at,expires_at,uploaded_at,accepted_at,revoked_at,updated_at`;

export async function issueOwnedProviderConsent(db, ownerUserId, id, value, options = {}) {
  const rid = replicaId(id);
  const config = azurePersonalVoiceConfig(options.env || process.env);
  const name = providerConsentName(value?.full_name);
  const locale = String(value?.locale || PROVIDER_CONSENT_LOCALE).trim();
  const statement = renderProviderConsentStatement(name, config.companyName, locale);
  const statementHash = providerConsentStatementHash(statement);
  const consentId = options.providerConsentId || randomUUID();
  replicaId(consentId);
  const binding = {
    provider_consent_id: consentId,
    replica_id: rid,
    owner_user_id: ownerUserId,
    provider: "azure_personal_voice",
    template_version: PROVIDER_CONSENT_TEMPLATE_VERSION,
    statement_sha256: statementHash,
  };
  const encrypted = encryptProviderConsentName(name, binding, options.env || process.env);
  const rows = await db(
    `with owned as (
       select r.replica_id,r.policy_version
         from vy_replica r
        where r.replica_id=$1 and r.owner_user_id=$2 and r.subject_mode='self'
          and r.policy_version=$8 and r.lifecycle not in ('revoked','purging')
          and r.age_verified_at is not null and r.identity_verified_at is not null
          and r.liveness_verified_at is not null and r.identity_expires_at>now()
          and not exists (
            select 1 from unnest(array['capture','storage','biometric','training']::text[]) required(scope)
             where not exists (
               select 1 from vy_replica_consent c
                where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
                  and c.scope=required.scope and c.policy_version=r.policy_version
                  and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
             )
          )
     ), attempts as (
       select count(*)::integer as n from vy_replica_provider_consent
        where replica_id=$1 and owner_user_id=$2 and provider='azure_personal_voice'
          and issued_at>now()-interval '24 hours'
     ), expired as (
       update vy_replica_provider_consent set state='expired',updated_at=now()
        where replica_id=$1 and owner_user_id=$2 and provider='azure_personal_voice'
          and state='issued' and expires_at<=now() and exists(select 1 from owned)
       returning provider_consent_id
     ), issued as (
       insert into vy_replica_provider_consent
         (provider_consent_id,replica_id,owner_user_id,provider,policy_version,
          provider_policy_version,template_version,locale,statement_sha256,attempt,
          algorithm,key_id,nonce,ciphertext,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,aad_sha256,expires_at)
       select $3,owned.replica_id,$2,'azure_personal_voice',owned.policy_version,
              $9,$10,$4,$5,attempts.n+1,$11,$12,decode($13,'base64'),decode($14,'base64'),
              decode($15,'base64'),decode($16,'base64'),decode($17,'base64'),decode($18,'base64'),$19,
              now()+interval '10 minutes'
         from owned cross join attempts cross join (select count(*) from expired) cleared
        where attempts.n<5 and not exists (
          select 1 from vy_replica_provider_consent pc where pc.replica_id=$1
            and pc.owner_user_id=$2 and pc.provider='azure_personal_voice'
            and pc.state in ('issued','uploaded')
        )
       returning ${RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select $1,$2,'provider_consent.issue','provider_consent',provider_consent_id::text,
              $8,'allowed',jsonb_build_object('provider','azure_personal_voice','locale',$4,'attempt',attempt)
         from issued
     ) select * from issued`,
    [rid, ownerUserId, consentId, locale, statementHash, null, null, REPLICA_POLICY_VERSION,
      PROVIDER_CONSENT_POLICY_VERSION, PROVIDER_CONSENT_TEMPLATE_VERSION, encrypted.algorithm,
      encrypted.key_id, encrypted.nonce_b64, encrypted.ciphertext_b64, encrypted.auth_tag_b64,
      encrypted.wrapped_dek_b64, encrypted.wrap_nonce_b64, encrypted.wrap_auth_tag_b64,
      encrypted.aad_sha256],
  );
  return clientProviderConsent(rows[0], options.env || process.env);
}

export async function latestOwnedProviderConsent(db, ownerUserId, id, options = {}) {
  const rid = replicaId(id);
  await db(
    `update vy_replica_provider_consent set state='expired',updated_at=now()
      where replica_id=$1 and owner_user_id=$2 and provider='azure_personal_voice'
        and state='issued' and expires_at<=now()`,
    [rid, ownerUserId],
  );
  const rows = await db(
    `select ${RETURNING} from vy_replica_provider_consent
      where replica_id=$1 and owner_user_id=$2 and provider='azure_personal_voice'
      order by issued_at desc limit 1`,
    [rid, ownerUserId],
  );
  return clientProviderConsent(rows[0], options.env || process.env);
}

const SOURCE_RETURNING = `source_id,replica_id,owner_user_id,kind,capture_mode,storage_bucket,
  object_path,mime,byte_size,duration_ms,sha256,state,contains_third_parties,rejection_code,
  created_at,updated_at`;
const SOURCE_SELECT = `s.source_id,s.replica_id,s.owner_user_id,s.kind,s.capture_mode,s.storage_bucket,
  s.object_path,s.mime,s.byte_size,s.duration_ms,s.sha256,s.state,s.contains_third_parties,
  s.rejection_code,s.created_at,s.updated_at`;

function providerConsentUpload(value) {
  const input = sourceUploadInput({ ...value, kind: "audio" });
  if (!AZURE_AUDIO_MIMES.has(input.mime)) fail("provider_consent_audio_must_be_wav_or_mp3");
  if (input.byteSize > MAX_PROVIDER_CONSENT_BYTES) fail("provider_consent_audio_too_large");
  if (input.containsThirdParties) fail("provider_consent_must_contain_only_owner", 409);
  const durationMs = Number(value?.duration_ms);
  if (!Number.isInteger(durationMs) || durationMs < 5_000 || durationMs > 90_000)
    fail("provider_consent_duration_invalid");
  return { ...input, durationMs };
}

export async function createProviderConsentSource(db, ownerUserId, id, consent, value, options = {}) {
  const rid = replicaId(id);
  const pcid = replicaId(consent);
  const input = providerConsentUpload(value);
  const sourceId = options.sourceId || randomUUID();
  replicaId(sourceId);
  const path = privateObjectPath(ownerUserId, rid, sourceId);
  const provenance = JSON.stringify({
    declaration: "client_sha256",
    sha256_status: "pending_server_verification",
    duration_status: "client_declared_pending_server_probe",
    provider_consent_id: pcid,
    provider: "azure_personal_voice",
    template_version: PROVIDER_CONSENT_TEMPLATE_VERSION,
    filename_retained: false,
  });
  const rows = await db(
    `with challenge as (
       select pc.provider_consent_id,pc.replica_id,r.policy_version
         from vy_replica_provider_consent pc
         join vy_replica r on r.replica_id=pc.replica_id and r.owner_user_id=pc.owner_user_id
        where pc.provider_consent_id=$3 and pc.replica_id=$1 and pc.owner_user_id=$2
          and pc.provider='azure_personal_voice' and pc.state='issued' and pc.expires_at>now()
          and pc.source_id is null and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
     ), capture as (
       select c.consent_id from vy_replica_consent c join challenge ch on ch.replica_id=c.replica_id
        where c.owner_user_id=$2 and c.scope='capture' and c.policy_version=ch.policy_version
          and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
        order by c.granted_at desc limit 1
     ), gates as (
       select 1 from challenge ch where not exists (
         select 1 from unnest(array['storage','biometric','training']::text[]) required(scope)
          where not exists (
            select 1 from vy_replica_consent c where c.replica_id=ch.replica_id
              and c.owner_user_id=$2 and c.scope=required.scope and c.policy_version=ch.policy_version
              and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
          )
       )
     ), inserted as (
       insert into vy_replica_source
         (source_id,replica_id,owner_user_id,consent_id,kind,capture_mode,storage_bucket,
          object_path,mime,byte_size,duration_ms,sha256,contains_third_parties,provenance)
       select $4,challenge.replica_id,$2,capture.consent_id,'audio','provider_consent',$5,
              $6,$7,$8,$9,$10,false,$11::jsonb from challenge cross join capture cross join gates
       returning ${SOURCE_RETURNING}
     ), attached as (
       update vy_replica_provider_consent pc set source_id=inserted.source_id,updated_at=now()
        from inserted where pc.provider_consent_id=$3
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select $1,$2,'provider_consent.upload.create','source',source_id::text,
              (select policy_version from challenge),'allowed',
              jsonb_build_object('provider','azure_personal_voice','byte_size',byte_size)
         from inserted
     ) select * from inserted`,
    [rid, ownerUserId, pcid, sourceId, REPLICA_STORAGE_BUCKET, path, input.mime,
      input.byteSize, input.durationMs, input.sha256, provenance],
  );
  return rows[0] || null;
}

export async function getPendingProviderConsentSource(db, ownerUserId, id, consent, source) {
  const rows = await db(
    `select ${SOURCE_SELECT} from vy_replica_source s
      join vy_replica_provider_consent pc on pc.source_id=s.source_id and pc.replica_id=s.replica_id
       and pc.owner_user_id=s.owner_user_id
      join vy_replica r on r.replica_id=s.replica_id and r.owner_user_id=s.owner_user_id
      where s.replica_id=$1 and s.owner_user_id=$2 and s.source_id=$4
        and pc.provider_consent_id=$3 and pc.provider='azure_personal_voice'
        and pc.state='issued' and pc.expires_at>now() and s.capture_mode='provider_consent'
        and s.state='pending_upload' and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
      limit 1`,
    [replicaId(id), ownerUserId, replicaId(consent), replicaId(source)],
  );
  return rows[0] || null;
}

export async function finalizeProviderConsentSource(
  db,
  ownerUserId,
  id,
  consent,
  source,
  objectInfo,
  options = {},
) {
  const rid = replicaId(id);
  const pcid = replicaId(consent);
  const sid = replicaId(source);
  const pending = await getPendingProviderConsentSource(db, ownerUserId, rid, pcid, sid);
  if (!pending) return null;
  const verdict = verifyStoredObject(pending, objectInfo);
  const sourceState = verdict.ok ? "quarantined" : "rejected";
  const consentState = verdict.ok ? "uploaded" : "failed";
  const facts = JSON.stringify({
    storage_metadata_verified: verdict.ok,
    sha256_status: "pending_server_verification",
    duration_status: "client_declared_pending_server_probe",
  });
  const rows = await db(
    `with eligible as (
       select s.source_id from vy_replica_source s
        join vy_replica_provider_consent pc on pc.source_id=s.source_id and pc.replica_id=s.replica_id
         and pc.owner_user_id=s.owner_user_id
       where s.replica_id=$1 and s.owner_user_id=$2 and s.source_id=$4
         and s.capture_mode='provider_consent' and s.state='pending_upload'
         and pc.provider_consent_id=$3 and pc.state='issued' and pc.expires_at>now()
     ), updated_source as (
       update vy_replica_source s set state=$5,rejection_code=$6,updated_at=now(),
              provenance=provenance||$7::jsonb
        from eligible e where s.source_id=e.source_id returning s.*
     ), updated_consent as (
       update vy_replica_provider_consent pc set state=$8,failure_code=$6,
              uploaded_at=case when $8='uploaded' then now() else null end,updated_at=now()
        from updated_source s where pc.provider_consent_id=$3 and pc.replica_id=$1
          and pc.owner_user_id=$2 and pc.source_id=s.source_id returning pc.*
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select $1,$2,'provider_consent.upload.finalize','provider_consent',
              provider_consent_id::text,$9,case when $8='uploaded' then 'allowed' else 'denied' end,
              jsonb_build_object('provider','azure_personal_voice','reason_code',$6)
         from updated_consent
     ) select row_to_json(s) source,row_to_json(pc) provider_consent
         from updated_source s cross join updated_consent pc`,
    [rid, ownerUserId, pcid, sid, sourceState, verdict.code, facts, consentState,
      REPLICA_POLICY_VERSION],
  );
  if (!rows[0]) return null;
  return {
    source: rows[0].source,
    provider_consent: clientProviderConsent(rows[0].provider_consent, options.env || process.env),
  };
}

export { clientProviderConsent, clientSource };
