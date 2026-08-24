import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import { REPLICA_STORAGE_BUCKET } from "./_replica-storage.js";
import { decryptProviderConsentName } from "./_replica-provider-consent-crypto.js";
import {
  PROVIDER_CONSENT_LOCALE,
  PROVIDER_CONSENT_POLICY_VERSION,
  PROVIDER_CONSENT_TEMPLATE_VERSION,
  providerConsentStatementHash,
  renderProviderConsentStatement,
} from "./_replica-provider-consent.js";
import { canonicalJson, sha256Hex, stableUuid } from "./_replica-processing/contracts.js";
import { azurePersonalVoiceConfig } from "./_voice/providers/azure-personal-voice.js";
import { clientVoiceProfile } from "./_voice/contracts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const WAV_MIMES = new Set(["audio/wav", "audio/x-wav"]);

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

function genomeVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) fail("voice_genome_version_required", 400);
  return version;
}

function consentCryptoBinding(row) {
  return {
    provider_consent_id: row.provider_consent_id,
    replica_id: row.replica_id,
    owner_user_id: row.owner_user_id,
    provider: row.provider,
    template_version: row.template_version,
    statement_sha256: row.statement_sha256,
  };
}

function privatePath(row, derived = false) {
  const prefix = `${row.owner_user_id}/${row.replica_id}/${row.source_id}/`;
  const path = String(row.object_path || "");
  if (row.storage_bucket !== REPLICA_STORAGE_BUCKET || !path.startsWith(prefix) || path.includes("://") ||
      (derived ? !path.includes("/derived/") : !path.endsWith("/original"))) {
    fail("voice_enrollment_private_lineage_invalid");
  }
  return path;
}

export function selectAzureEnrollmentArtifacts(rows) {
  const candidates = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!UUID.test(String(row.artifact_id || "")) || !UUID.test(String(row.source_id || "")) ||
        !SHA256.test(String(row.sha256 || "")) || row.stage !== "enhance" ||
        !WAV_MIMES.has(String(row.mime || "").toLowerCase()) || row.contains_third_parties === true ||
        ["rejected", "deleting"].includes(row.source_state) ||
        /fake|fixture|mock|test/i.test(`${row.adapter_name || ""}:${row.adapter_version || ""}`)) {
      continue;
    }
    privatePath(row, true);
    const durationMs = Number(row.duration_ms);
    if (!Number.isInteger(durationMs) || durationMs < 5_000 || durationMs > 90_000) continue;
    candidates.push({ ...row, duration_ms: durationMs });
  }
  candidates.sort((left, right) =>
    String(left.source_id).localeCompare(String(right.source_id)) ||
    String(left.artifact_id).localeCompare(String(right.artifact_id))
  );
  const selected = [];
  const sources = new Set();
  let total = 0;
  for (const candidate of candidates) {
    if (sources.has(candidate.source_id) || selected.length >= 10 || total + candidate.duration_ms > 90_000) continue;
    selected.push(candidate);
    sources.add(candidate.source_id);
    total += candidate.duration_ms;
    if (total >= 60_000) break;
  }
  if (total < 30_000 || total > 90_000) fail("voice_enrollment_approved_audio_duration_insufficient");
  return Object.freeze(selected.map((row) => Object.freeze(row)));
}

const ENROLLMENT_SQL = `select r.replica_id,r.owner_user_id,r.policy_version,
  vg.version genome_version,vg.source_set_hash,vg.definition genome_definition,
  pc.provider_consent_id,pc.provider,pc.provider_policy_version,pc.template_version,pc.locale,
  pc.statement_sha256,pc.algorithm,pc.key_id,encode(pc.nonce,'base64') nonce_b64,
  encode(pc.ciphertext,'base64') ciphertext_b64,encode(pc.auth_tag,'base64') auth_tag_b64,
  encode(pc.wrapped_dek,'base64') wrapped_dek_b64,encode(pc.wrap_nonce,'base64') wrap_nonce_b64,
  encode(pc.wrap_auth_tag,'base64') wrap_auth_tag_b64,pc.aad_sha256,
  pcs.source_id consent_source_id,pcs.storage_bucket consent_storage_bucket,
  pcs.object_path consent_object_path,pcs.mime consent_mime,pcs.byte_size consent_byte_size,
  pcs.duration_ms consent_duration_ms,pcs.sha256 consent_sha256,
  coalesce((select jsonb_agg(jsonb_build_object(
    'artifact_id',a.artifact_id,'source_id',a.source_id,'replica_id',a.replica_id,
    'owner_user_id',a.owner_user_id,'stage',a.stage,'storage_bucket',a.storage_bucket,
    'object_path',a.object_path,'mime',a.mime,'byte_size',a.byte_size,'duration_ms',a.duration_ms,
    'sha256',a.sha256,'adapter_name',a.adapter_name,'adapter_version',a.adapter_version,
    'source_state',s.state,'contains_third_parties',s.contains_third_parties
  ) order by a.source_id,a.artifact_id)
  from jsonb_array_elements_text(coalesce(vg.definition#>'{references,enrollment_artifact_ids}','[]'::jsonb)) wanted(id)
  join vy_replica_processing_artifact a on a.artifact_id=wanted.id::uuid
    and a.replica_id=r.replica_id and a.owner_user_id=r.owner_user_id
  join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id
    and s.owner_user_id=a.owner_user_id),'[]'::jsonb) artifacts
 from vy_replica r
 join vy_replica_voice_genome vg on vg.replica_id=r.replica_id and vg.version=$3 and vg.status='approved'
 join lateral (select x.* from vy_replica_provider_consent x
   where x.replica_id=r.replica_id and x.owner_user_id=r.owner_user_id
     and x.provider='azure_personal_voice' and x.state='uploaded'
     and x.policy_version=r.policy_version and x.provider_policy_version=$4
     and x.template_version=$5 and x.locale=$6
   order by x.uploaded_at desc limit 1) pc on true
 join vy_replica_source pcs on pcs.source_id=pc.source_id and pcs.replica_id=r.replica_id
   and pcs.owner_user_id=r.owner_user_id and pcs.capture_mode='provider_consent'
   and pcs.kind='audio' and pcs.state='quarantined' and pcs.contains_third_parties=false
 where r.replica_id=$1 and r.owner_user_id=$2 and r.subject_mode='self'
   and r.policy_version=$7 and r.lifecycle not in ('revoked','purging')
   and r.age_verified_at is not null and r.identity_verified_at is not null and r.liveness_verified_at is not null
   and not exists (
     select 1 from unnest(array['capture','storage','biometric','training']::text[]) required(scope)
      where not exists (select 1 from vy_replica_consent c where c.replica_id=r.replica_id
        and c.owner_user_id=r.owner_user_id and c.scope=required.scope and c.policy_version=r.policy_version
        and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
   ) limit 1`;

export async function loadOwnedAzureVoiceEnrollment(db, ownerUserId, id, version) {
  const rows = await db(ENROLLMENT_SQL, [replicaId(id), ownerUserId, genomeVersion(version),
    PROVIDER_CONSENT_POLICY_VERSION, PROVIDER_CONSENT_TEMPLATE_VERSION, PROVIDER_CONSENT_LOCALE,
    REPLICA_POLICY_VERSION]);
  return rows[0] || null;
}

export async function latestOwnedApprovedVoiceGenome(db, ownerUserId, id) {
  const rows = await db(
    `select vg.version from vy_replica_voice_genome vg
      join vy_replica r on r.replica_id=vg.replica_id and r.owner_user_id=$2
      where vg.replica_id=$1 and vg.status='approved' and r.subject_mode='self'
        and r.lifecycle not in ('revoked','purging') order by vg.version desc limit 1`,
    [replicaId(id), ownerUserId],
  );
  return rows[0] ? Number(rows[0].version) : null;
}

function normalizedSignedRead(value) {
  const url = String(value?.url || "");
  if (!/^https:\/\//.test(url) || !url.includes("token=")) fail("voice_enrollment_signed_read_invalid", 503);
  return url;
}

export async function materializeAzureVoiceEnrollment(enrollment, signRead, env = process.env) {
  if (!enrollment || typeof signRead !== "function") fail("voice_enrollment_not_ready");
  const config = azurePersonalVoiceConfig(env);
  const voiceTalentName = decryptProviderConsentName(enrollment, consentCryptoBinding(enrollment), env);
  const statement = renderProviderConsentStatement(voiceTalentName, config.companyName, enrollment.locale);
  if (providerConsentStatementHash(statement) !== enrollment.statement_sha256)
    fail("voice_enrollment_statement_binding_invalid");
  if (!UUID.test(String(enrollment.consent_source_id || "")) ||
      !SHA256.test(String(enrollment.consent_sha256 || "")) ||
      !WAV_MIMES.has(String(enrollment.consent_mime || "").toLowerCase())) {
    fail("voice_enrollment_consent_artifact_invalid");
  }
  const consentRow = {
    owner_user_id: enrollment.owner_user_id,
    replica_id: enrollment.replica_id,
    source_id: enrollment.consent_source_id,
    storage_bucket: enrollment.consent_storage_bucket,
    object_path: enrollment.consent_object_path,
  };
  privatePath(consentRow, false);
  const consentDuration = Number(enrollment.consent_duration_ms);
  if (!Number.isInteger(consentDuration) || consentDuration < 5_000 || consentDuration > 90_000)
    fail("voice_enrollment_consent_duration_invalid");
  const artifacts = selectAzureEnrollmentArtifacts(enrollment.artifacts);
  const commitment = sha256Hex(canonicalJson({
    protocol: "vyakti-azure-voice-enrollment/v1",
    replica_id: enrollment.replica_id,
    genome_version: Number(enrollment.genome_version),
    genome_source_set_hash: enrollment.source_set_hash,
    provider_consent_id: enrollment.provider_consent_id,
    consent_sha256: enrollment.consent_sha256,
    statement_sha256: enrollment.statement_sha256,
    locale: enrollment.locale,
    artifacts: artifacts.map((row) => ({ artifact_id: row.artifact_id, source_id: row.source_id,
      sha256: row.sha256, duration_ms: row.duration_ms })),
    provider_policy_version: enrollment.provider_policy_version,
    model: config.model,
  }));
  const [consentRead, ...artifactReads] = await Promise.all([
    signRead(enrollment.consent_object_path),
    ...artifacts.map((row) => signRead(row.object_path)),
  ]);
  return Object.freeze({
    enrollmentCommitment: commitment,
    voiceProfileId: stableUuid(`voice-profile/v1:${commitment}`),
    providerConsentId: enrollment.provider_consent_id,
    input: Object.freeze({
      replicaId: enrollment.replica_id,
      genomeVersion: Number(enrollment.genome_version),
      idempotencyKey: stableUuid(`azure-personal-voice-enrollment/v1:${commitment}`),
      consent: Object.freeze({
        sourceId: enrollment.consent_source_id,
        signedReadUrl: normalizedSignedRead(consentRead),
        sha256: enrollment.consent_sha256,
        mime: String(enrollment.consent_mime).toLowerCase(),
        durationMs: consentDuration,
        locale: enrollment.locale,
        voiceTalentName,
      }),
      references: Object.freeze(artifacts.map((row, index) => Object.freeze({
        sourceId: row.source_id,
        signedReadUrl: normalizedSignedRead(artifactReads[index]),
        sha256: row.sha256,
        mime: String(row.mime).toLowerCase(),
        durationMs: row.duration_ms,
      }))),
    }),
  });
}

const PROFILE_SELECT = `vp.voice_profile_id,vp.replica_id,vp.genome_version,vp.provider,vp.model,
  vp.provider_ref,vp.capabilities,vp.status,vp.failure_code,vp.enrollment_commitment,
  vp.provider_consent_id,vp.created_at,vp.updated_at`;

export async function getOwnedVoiceProfile(db, ownerUserId, id, version = null) {
  const rid = replicaId(id);
  const requested = version == null ? null : genomeVersion(version);
  const rows = await db(
    `select ${PROFILE_SELECT} from vy_replica_voice_profile vp
      join vy_replica r on r.replica_id=vp.replica_id and r.owner_user_id=vp.owner_user_id
      where vp.replica_id=$1 and vp.owner_user_id=$2 and vp.provider='azure_personal_voice'
        and ($3::integer is null or vp.genome_version=$3)
      order by vp.created_at desc limit 1`,
    [rid, ownerUserId, requested],
  );
  return rows[0] || null;
}

export async function persistCreatedVoiceProfile(db, ownerUserId, prepared, result, config) {
  if (!prepared || !result?.providerRef || !["creating", "ready"].includes(result.state))
    fail("voice_provider_result_invalid", 503);
  const capabilities = JSON.stringify({
    synthesis: true,
    streaming: true,
    format: "pcm_s16le_24000_mono",
    enrollment_protocol: "vyakti-azure-voice-enrollment/v1",
  });
  const rows = await db(
    `with eligible as (
       select r.replica_id,r.owner_user_id,vg.version genome_version
        from vy_replica r join vy_replica_voice_genome vg on vg.replica_id=r.replica_id
          and vg.version=$4 and vg.status='approved'
        join vy_replica_provider_consent pc on pc.provider_consent_id=$5
          and pc.replica_id=r.replica_id and pc.owner_user_id=r.owner_user_id
          and pc.provider='azure_personal_voice' and pc.state='uploaded'
        where r.replica_id=$1 and r.owner_user_id=$2 and r.subject_mode='self'
          and r.lifecycle not in ('revoked','purging') and r.policy_version=$11
          and not exists (
            select 1 from unnest(array['capture','storage','biometric','training']::text[]) required(scope)
             where not exists (select 1 from vy_replica_consent c where c.replica_id=r.replica_id
               and c.owner_user_id=r.owner_user_id and c.scope=required.scope and c.policy_version=r.policy_version
               and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
          )
     ), inserted as (
       insert into vy_replica_voice_profile
         (voice_profile_id,replica_id,owner_user_id,genome_version,provider,model,provider_ref,
          capabilities,status,enrollment_commitment,provider_consent_id)
       select $3,e.replica_id,e.owner_user_id,e.genome_version,'azure_personal_voice',$6,$7,
              $8::jsonb,$9,$10,$5 from eligible e
       on conflict (replica_id,provider,enrollment_commitment) where enrollment_commitment<>''
       do update set provider_ref=excluded.provider_ref,model=excluded.model,
         capabilities=excluded.capabilities,status=excluded.status,failure_code='',
         provider_consent_id=excluded.provider_consent_id,updated_at=now()
       returning ${PROFILE_SELECT.replaceAll("vp.", "")}
     ), accepted as (
       update vy_replica_provider_consent pc set state='accepted',accepted_at=coalesce(accepted_at,now()),
              updated_at=now() from inserted vp where pc.provider_consent_id=vp.provider_consent_id
         and pc.replica_id=vp.replica_id and pc.owner_user_id=$2 and pc.state in ('uploaded','accepted')
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select $1,$2,'voice_profile.create','voice_profile',voice_profile_id::text,$11,'allowed',
              jsonb_build_object('provider','azure_personal_voice','genome_version',genome_version,'status',status)
         from inserted
     ) select * from inserted`,
    [prepared.input.replicaId, ownerUserId, prepared.voiceProfileId, prepared.input.genomeVersion,
      prepared.providerConsentId, config.model, result.providerRef, capabilities, result.state,
      prepared.enrollmentCommitment, REPLICA_POLICY_VERSION],
  );
  return rows[0] || null;
}

export async function updateOwnedVoiceProfileStatus(db, ownerUserId, profile, status) {
  if (!profile || !["creating", "ready", "failed", "missing"].includes(status))
    fail("voice_profile_status_invalid", 400);
  const next = status === "missing" ? "failed" : status;
  const rows = await db(
    `with updated as (
       update vy_replica_voice_profile vp set status=$4,
              failure_code=case when $4='failed' then $5 else '' end,updated_at=now()
        where vp.voice_profile_id=$3 and vp.replica_id=$1 and vp.owner_user_id=$2
          and vp.status in ('creating','ready')
          and exists(select 1 from vy_replica r where r.replica_id=vp.replica_id
            and r.owner_user_id=vp.owner_user_id)
       returning ${PROFILE_SELECT.replaceAll("vp.", "")}
     ) select * from updated`,
    [profile.replica_id, ownerUserId, profile.voice_profile_id, next,
      status === "missing" ? "provider_profile_missing" : status === "failed" ? "provider_profile_failed" : ""],
  );
  return rows[0] || profile;
}

export async function markOwnedVoiceProfileDeleting(db, ownerUserId, id, profileId) {
  const pid = replicaId(profileId);
  const rows = await db(
    `with target as (
       update vy_replica_voice_profile vp set status='deleting',updated_at=now()
        where vp.voice_profile_id=$3 and vp.replica_id=$1 and vp.owner_user_id=$2
          and vp.status in ('creating','ready','failed')
       returning ${PROFILE_SELECT.replaceAll("vp.", "")}
     ), capabilities as (
       update vy_replica_runtime_capability c set state='revoked',revoked_at=coalesce(revoked_at,now())
        from target t where c.replica_id=t.replica_id and c.owner_user_id=$2 and c.voice_profile_id=t.voice_profile_id
          and c.state='active'
     ), sessions as (
       update vy_replica_runtime_session s set state='revoked',ended_at=coalesce(ended_at,now()),updated_at=now()
        from target t where s.replica_id=t.replica_id and s.owner_user_id=$2 and s.state='active'
     ), generations as (
       update vy_replica_generation g set state='aborted',failure_code='voice_profile_deleted',updated_at=now()
        from target t where g.replica_id=t.replica_id and g.owner_user_id=$2
          and g.voice_profile_id=t.voice_profile_id and g.state in ('authorized','streaming')
     ) select * from target`,
    [replicaId(id), ownerUserId, pid],
  );
  return rows[0] || null;
}

export async function completeOwnedVoiceProfileDeletion(db, ownerUserId, profile) {
  const rows = await db(
    `with target as (
       select voice_profile_id,replica_id,owner_user_id,provider_consent_id
         from vy_replica_voice_profile where voice_profile_id=$3 and replica_id=$1
          and owner_user_id=$2 and status='deleting' for update
     ), generations as (
       delete from vy_replica_generation g using target t
        where g.voice_profile_id=t.voice_profile_id and g.replica_id=t.replica_id
          and g.owner_user_id=t.owner_user_id
     ), candidates as (
       delete from vy_replica_candidate c using target t
        where exists (select 1 from vy_replica_runtime_capability rc
          where rc.capability_id=c.base_capability_id and rc.voice_profile_id=t.voice_profile_id
            and rc.replica_id=t.replica_id and rc.owner_user_id=t.owner_user_id)
     ), capabilities as (
       delete from vy_replica_runtime_capability c using target t
        where c.voice_profile_id=t.voice_profile_id and c.replica_id=t.replica_id
          and c.owner_user_id=t.owner_user_id
     ), removed as (
       delete from vy_replica_voice_profile vp using target t
        where vp.voice_profile_id=t.voice_profile_id and vp.replica_id=t.replica_id
          and vp.owner_user_id=t.owner_user_id
       returning t.voice_profile_id,t.replica_id,t.provider_consent_id
     ), revoked_consent as (
       update vy_replica_provider_consent pc set state='revoked',
              revoked_at=coalesce(revoked_at,now()),updated_at=now()
        from removed r where pc.provider_consent_id=r.provider_consent_id
          and pc.replica_id=r.replica_id and pc.owner_user_id=$2 and pc.state='accepted'
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,$2,'voice_profile.delete.complete','voice_profile',voice_profile_id::text,
              $4,'allowed',jsonb_build_object('provider','azure_personal_voice') from removed
     ) select voice_profile_id from removed`,
    [profile.replica_id, ownerUserId, profile.voice_profile_id, REPLICA_POLICY_VERSION],
  );
  return Boolean(rows[0]);
}

export { clientVoiceProfile };
