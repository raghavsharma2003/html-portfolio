import {referenceFromAuthority} from './reference-evidence.js';
export {referenceFromAuthority} from './reference-evidence.js';
import {COMPARISON_CANDIDATE_CTES,validateComparisonReferenceReceipt} from '../_comparison-reference.js';
import { randomInt, randomUUID } from 'node:crypto';
import { REPLICA_POLICY_VERSION } from '../_replica.js';
import { BIOMETRIC_VERIFICATION_ATTESTATIONS, clientChallenge } from '../_replica-liveness.js';
import { canonicalJson, sha256Hex } from '../_replica-processing/contracts.js';
import { liveIntakeReceiptsSql } from '../_replica-processing/purpose.js';
import { livenessVerificationLeaseHash } from '../_replica-liveness-verification.js';
import { getIssuedVoiceBank, getIssuedVoiceProfile } from '../_voice-identity/issued-contract.js';
import { buildModernCaptureContract, validateModernCaptureContract, bindModernCaptureLease,
  captureContractError, MODERN_CAPTURE_PROFILE } from './issued-contract.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
export const MODERN_AUTHORITY_STATEMENT_SET = 'modern-capture-authority/v1';
export const SELECTED_COMPARISON_ATTESTATIONS = Object.freeze([
  'selected_reference_is_my_voice', 'compare_this_capture_to_selected_reference',
  'comparison_is_private_verification_only',
]);
const fail = (part, status = 409) => { throw captureContractError(part, status); };
const json = value => canonicalJson(value);
function id(value) { if (typeof value !== 'string' || value.length!==36 || !UUID.test(value)) fail('binding_invalid',400); return value; }
function attest(value, keys) {
  if (!value || Object.getPrototypeOf(value)!==Object.prototype ||
      Reflect.ownKeys(value).length!==keys.length || keys.some(key=>
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)||{},'value') || value[key]!==true))
    fail('explicit_consent_required',400);
  return Object.fromEntries(keys.map(key=>[key,true]));
}
async function query(db, sql, params) {
  if (typeof db!=='function') fail('database_unavailable',503);
  // NOWAIT is deliberate: a conflicting authority writer is a refusal, never a
  // stale snapshot that becomes eligible after waiting. Never retry issuance.
  try { const rows=await db(sql,params); if (!Array.isArray(rows)) fail('database_result_invalid',503); return rows; }
  catch (error) {
    if (error?.code==='55P03') fail('authority_busy');
    throw error;
  }
}

// All source writers/revocation use source -> replica order. Review mutations
// take the same advisory lock. No provider work occurs while these locks live.
// The receipt pins existing records; it does not turn a genome into enrollment
// authority or turn an unreviewed row into accepted reference evidence.
const AUTHORITY_CTES = `source_gate as materialized (
 select s.* from vy_replica_source s where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
 order by s.source_id for update of s nowait
), owned as materialized (
 select r.* from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
 and (select count(*) from source_gate)>0 and r.subject_mode='self'
 and r.lifecycle not in ('revoked','purging') and r.policy_version='${REPLICA_POLICY_VERSION}'
 and r.primary_selection_id=$4::uuid for update of r nowait
), review_gate as materialized (
 select pg_try_advisory_xact_lock(hashtextextended(replica_id::text || ':voice_genome_review',0)) acquired from owned
), challenge_gate as materialized (
 select ch.* from vy_replica_liveness_challenge ch where ch.replica_id=$1::uuid and ch.owner_user_id=$2::uuid
 and exists(select 1 from owned) order by ch.challenge_id for update of ch nowait
), identity_case as materialized (
 select ic.* from vy_replica_identity_case ic join owned r using(replica_id,owner_user_id)
 join source_gate ids on ids.source_id=ic.source_id and ids.sha256=ic.source_sha256 and ids.state='quarantined'
 where ic.state='evidence_ready' and ic.adult_evidence=true and ic.document_authentic=true
 and ic.document_current=true and ic.face_reference_ready=true and ic.credential_expires_at>now()
 order by ic.verified_at desc,ic.identity_case_id limit 1 for update of ic nowait
), consents as materialized (
 select c.* from vy_replica_consent c join owned r using(replica_id,owner_user_id)
 where c.scope in ('capture','storage') and c.policy_version=r.policy_version and c.revoked_at is null
 and (c.expires_at is null or c.expires_at>now()) for update of c nowait
), capture_consent as (
 select consent_id from consents where scope='capture' order by granted_at desc,consent_id limit 1
), storage_consent as (
 select consent_id from consents where scope='storage' order by granted_at desc,consent_id limit 1
), primary_source as (
 select s.* from source_gate s join vy_replica_voice_reference v using(replica_id,owner_user_id,source_id)
 where s.source_id=$3::uuid and s.state='ready' and s.kind in ('audio','video')
 and s.capture_mode in ('upload','import','derived') and s.contains_third_parties=false
 and not (s.capture_mode='derived' and s.provenance->>'purpose'='mirror_window')
), selected_artifact as (
 select a.*,d.decision_id from vy_replica_processing_artifact a join primary_source s using(source_id,replica_id,owner_user_id)
 join lateral (select decision_id,decision from vy_replica_processing_artifact_decision d
 where d.artifact_id=a.artifact_id and d.replica_id=a.replica_id and d.owner_user_id=a.owner_user_id
 order by created_at desc,decision_id desc limit 1) d on d.decision='selected'
 where a.stage='enhance' and a.mime in ('audio/wav','audio/x-wav')
 and a.adapter_family || ' ' || a.adapter_name || ' ' || a.adapter_version !~* '(fake|fixture|mock|test)'
), current_job as (
 select j.job_id from vy_replica_processing_job j join primary_source s using(source_id,replica_id,owner_user_id)
 where j.step='voice_quality' and j.state='complete' and j.revision=(select max(j2.revision)
 from vy_replica_processing_job j2 where j2.source_id=j.source_id and j2.replica_id=j.replica_id
 and j2.owner_user_id=j.owner_user_id and j2.step='voice_quality')
), reference_evidence as (
 select e.*,d.decision_id from vy_replica_processing_evidence e join primary_source s using(source_id,replica_id,owner_user_id)
 join current_job j on j.job_id=e.created_by_job_id
 join lateral (select decision_id,decision from vy_replica_processing_evidence_decision d
 where d.evidence_id=e.evidence_id and d.replica_id=e.replica_id and d.owner_user_id=e.owner_user_id
 order by created_at desc,decision_id desc limit 1) d on d.decision='accepted'
 where (select count(*) from selected_artifact)=1 and (
 (e.evidence_type='voice_embedding' and exists(select 1 from selected_artifact a
 where a.artifact_id=e.artifact_id and a.sha256=e.input_sha256)) or
 (e.evidence_type='voice_measurement' and exists(select 1 from selected_artifact a
 where e.value->'input_set' @> jsonb_build_array(jsonb_build_object('artifact_id',a.artifact_id,'sha256',a.sha256)))))
 and e.adapter_family='voice-analysis' and e.adapter_name='speechbrain-independent-speaker-evidence'
 and e.adapter_version='vyakti-voice-evidence-v2'
), ordinary_authority as (
 select jsonb_build_object('replica_id',r.replica_id,'owner_user_id',r.owner_user_id,'subject_person_id',r.subject_person_id,
 'policy_version',r.policy_version,'authority_epoch',r.private_text_epoch,'reference_authority_epoch',r.reference_authority_epoch,
 'primary_source_id',s.source_id,'primary_source_sha256',s.sha256,'primary_selection_id',r.primary_selection_id,
 'identity_case_id',ic.identity_case_id,'identity_source_id',ic.source_id,'identity_source_sha256',ic.source_sha256,
 'capture_consent_id',cc.consent_id,'storage_consent_id',sc.consent_id,
 'artifact_id',a.artifact_id,'artifact_sha256',a.sha256,'artifact_decision_id',a.decision_id,
 'evidence_pins',(select jsonb_agg(jsonb_build_object('evidence_id',e.evidence_id,'record_hash',e.record_hash,
 'decision_id',e.decision_id) order by e.evidence_id) from reference_evidence e)) binding,
 (select jsonb_agg(to_jsonb(e) order by e.evidence_id) from reference_evidence e) reference_rows,
 to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') server_now
 from owned r cross join primary_source s cross join identity_case ic cross join capture_consent cc
 cross join storage_consent sc cross join selected_artifact a
 where (select acquired from review_gate)=true and (select count(*) from reference_evidence)=3
), comparison_candidate as materialized (
 with ${COMPARISON_CANDIDATE_CTES.replaceAll('$3::uuid','null::uuid')}
 select * from candidates
), purpose_authority as (
 select c.binding || jsonb_build_object('subject_person_id',r.subject_person_id,
 'reference_authority_epoch',r.reference_authority_epoch,
 'identity_case_id',ic.identity_case_id,'identity_source_id',ic.source_id,'identity_source_sha256',ic.source_sha256,
 'reference_authority_kind','private_comparison_reference','comparison_reference_id',h.reference_id,
 'comparison_reference_receipt_hash',h.receipt_hash) binding,c.reference_rows,
 to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') server_now,
 to_jsonb(h) comparison_receipt
 from comparison_candidate c join vy_replica_comparison_reference h
 on h.artifact_id=c.artifact_id and h.source_id=c.source_id and h.replica_id=$1::uuid and h.owner_user_id=$2::uuid
 cross join owned r cross join identity_case ic
 where h.state='selected' and h.expires_at>now() and h.confirmed_at is not null and h.audition_response_at is not null
 and h.receipt_payload->'binding'=c.binding and c.source_id=$3::uuid
 and (select acquired from review_gate)=true
), authority as (
 select * from purpose_authority
 union all
 select ordinary_authority.*,null::jsonb comparison_receipt from ordinary_authority
 where not exists(select 1 from vy_replica_comparison_reference h where h.replica_id=$1::uuid
 and h.owner_user_id=$2::uuid and h.state='selected')
)`;

export const MODERN_AUTHORITY_SNAPSHOT_SQL = `with ${AUTHORITY_CTES} select authority.*,
 coalesce((select jsonb_agg(jsonb_build_object('id',challenge_id,'state',state,'updated_at',updated_at)
 order by challenge_id) from challenge_gate),'[]'::jsonb) issuance_fence
 from authority`;
export const MODERN_AUTHORITY_ISSUE_SQL = `with ${AUTHORITY_CTES}, eligible as materialized (
 select * from authority where binding=$5::jsonb
 and $6::jsonb->'binding'=jsonb_set(binding,'{reference_authority_epoch}',to_jsonb((binding->>'reference_authority_epoch')::bigint+1))
 and coalesce((select jsonb_agg(jsonb_build_object('id',challenge_id,'state',state,'updated_at',updated_at)
 order by challenge_id) from challenge_gate),'[]'::jsonb)=$8::jsonb
 and ($6::jsonb->'envelope'->'contract'->>'issuedAt')::timestamptz<=clock_timestamp()
 and ($6::jsonb->'envelope'->'contract'->>'expiresAt')::timestamptz>clock_timestamp()
 and ($6::jsonb->'envelope'->'contract'->>'expiresAt')::timestamptz>
     ($6::jsonb->'envelope'->'contract'->>'issuedAt')::timestamptz
 and ($6::jsonb->'envelope'->'contract'->>'expiresAt')::timestamptz<=
     ($6::jsonb->'envelope'->'contract'->>'issuedAt')::timestamptz+interval '10 minutes'
 and not exists(select 1 from challenge_gate ch where (ch.state in ('uploaded','verifying') or ch.face_session_state in
 ('issuing','ready','polling','passed_deleting','failed_deleting','expired_deleting')))
 and (select count(*) from challenge_gate where issued_at>now()-interval '24 hours')<10
), expired as (
 update vy_replica_liveness_challenge ch set state='expired',updated_at=now()
 where ch.replica_id=$1::uuid and ch.owner_user_id=$2::uuid and ch.state='issued'
 and exists(select 1 from eligible)
 returning ch.challenge_id,ch.source_id
), expired_grants as (
 update vy_replica_biometric_verification_grant g set state='expired'
 where g.replica_id=$1::uuid and g.owner_user_id=$2::uuid and g.state='active'
 and g.challenge_id in(select challenge_id from expired) returning g.challenge_id
), issued as (
 insert into vy_replica_liveness_challenge(challenge_id,replica_id,owner_user_id,phrase,phrase_hash,
 policy_version,identity_case_id,attempt,issued_at,expires_at)
 select ($6::jsonb->'envelope'->'contract'->>'challengeId')::uuid,$1::uuid,$2::uuid,
 $6::jsonb->'envelope'->>'phrase',$6::jsonb->'envelope'->'contract'->>'phraseSha256',binding->>'policy_version',
 (binding->>'identity_case_id')::uuid,1+(select count(*)::int from challenge_gate where issued_at>now()-interval '24 hours'),
 ($6::jsonb->'envelope'->'contract'->>'issuedAt')::timestamptz,
 ($6::jsonb->'envelope'->'contract'->>'expiresAt')::timestamptz from eligible
 cross join (select count(*) from expired) cleared
 cross join (select count(*) from expired_grants) grants_cleared
 returning *
), issuance_epoch as (
 update vy_replica r set reference_authority_epoch=r.reference_authority_epoch+1
 where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and exists(select 1 from issued)
 returning r.replica_id
), granted as (
 insert into vy_replica_biometric_verification_grant(grant_id,challenge_id,replica_id,owner_user_id,
 statement_set,receipt_hash,receipt_payload,granted_at,expires_at)
 select ($6::jsonb->'envelope'->'contract'->>'comparisonConsentId')::uuid,challenge_id,replica_id,owner_user_id,
 '${MODERN_AUTHORITY_STATEMENT_SET}',$7,$6::jsonb,issued_at,expires_at from issued
 where exists(select 1 from issuance_epoch) returning challenge_id
), expired_sources as (
 update vy_replica_source s set state='deleting',updated_at=now()
 where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.source_id in(select source_id from expired)
 and s.state in ('pending_upload','quarantined','rejected') returning s.source_id
), audit as (
 insert into vy_replica_audit(replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
 select replica_id,owner_user_id,'liveness.modern.issue','liveness_challenge',challenge_id::text,
 policy_version,'allowed',jsonb_build_object('receipt_hash',$7,'profile','modern-shared-capture/v1') from issued
 where exists(select 1 from granted)
) select issued.* from issued join granted using(challenge_id)`;

export const MODERN_AUTHORITY_RECEIPT_SQL = `select g.receipt_payload,g.receipt_hash
 from vy_replica_biometric_verification_grant g
 where g.replica_id=$1::uuid and g.owner_user_id=$2::uuid and g.challenge_id=$3::uuid
 and g.statement_set='${MODERN_AUTHORITY_STATEMENT_SET}' and g.state='active' and g.expires_at>now()`;

export const MODERN_AUTHORITY_LOAD_SQL = `with ${AUTHORITY_CTES}, current_capture as materialized (
 select ch.challenge_id from vy_replica_liveness_challenge ch
 join vy_replica_biometric_verification_grant g using(challenge_id,replica_id,owner_user_id)
 join source_gate s on s.source_id=ch.source_id
 where ch.replica_id=$1::uuid and ch.owner_user_id=$2::uuid and ch.challenge_id=$6::uuid
 and ch.state='verifying' and ch.expires_at>now() and ch.policy_version=(select binding->>'policy_version' from authority)
 and ch.identity_case_id=(select (binding->>'identity_case_id')::uuid from authority)
 and ch.verification_lease_token_hash=$7 and ch.verification_lease_expires_at>now()
 and ch.verification_lease_expires_at=($8::jsonb->>'leaseExpiresAt')::timestamptz
 and ch.issued_at=($10::jsonb->'envelope'->'contract'->>'issuedAt')::timestamptz
 and ch.expires_at=($10::jsonb->'envelope'->'contract'->>'expiresAt')::timestamptz
 and ch.verification_attempt=($8::jsonb->>'attempt')::int and ch.verifier=$8::jsonb->>'verifierName'
 and ch.phrase_hash=$8::jsonb->>'phraseHash' and ch.phrase=$8::jsonb->>'phrase'
 and ch.source_id=($8::jsonb->>'sourceId')::uuid and s.kind='video' and s.capture_mode='live_challenge'
 and s.state='quarantined' and s.contains_third_parties=false
 and s.consent_id=(select (binding->>'capture_consent_id')::uuid from authority)
 and s.sha256=$8::jsonb->'source'->>'sha256' and s.mime=$8::jsonb->'source'->>'mime'
 and s.byte_size=($8::jsonb->'source'->>'byteSize')::bigint
 and s.storage_bucket=$8::jsonb->'source'->>'storageBucket' and s.object_path=$8::jsonb->'source'->>'objectPath'
 and exists(select 1 from source_gate ids where ids.source_id=($8::jsonb->'identityReference'->>'sourceId')::uuid
 and ids.sha256=$8::jsonb->'identityReference'->>'sha256' and ids.mime=$8::jsonb->'identityReference'->>'mime'
 and ids.kind=$8::jsonb->'identityReference'->>'kind' and ids.byte_size=($8::jsonb->'identityReference'->>'byteSize')::bigint
 and ids.storage_bucket=$8::jsonb->'identityReference'->>'storageBucket' and ids.object_path=$8::jsonb->'identityReference'->>'objectPath')
 and ${liveIntakeReceiptsSql()}
 and ch.face_session_state='passed_deleted' and ch.face_session_provider_deleted_at is not null
 and ch.face_session_result->>'passed'='true' and ch.face_session_result->>'liveness_passed'='true'
 and ch.face_session_result->>'identity_match'='true'
 and ch.face_session_reference_sha256=(select binding->>'identity_source_sha256' from authority)
 and ch.face_session_model_version=$8::jsonb->'officialFaceProof'->>'modelVersion'
 and ch.face_session_result->>'provider_digest'=$8::jsonb->'officialFaceProof'->>'providerDigest'
 and ch.face_session_result->>'identity_score'=$8::jsonb->'officialFaceProof'->>'identityScore'
 and $8::jsonb->'officialFaceProof'->>'providerDeleted'='true'
 and $8::jsonb->'officialFaceProof'->>'livenessPassed'='true'
 and $8::jsonb->'officialFaceProof'->>'identityMatch'='true'
 and ch.face_session_reference_sha256=$8::jsonb->'officialFaceProof'->>'referenceSha256'
 and exists(select 1 from vy_replica_liveness_verification_attempt va where va.challenge_id=ch.challenge_id
 and va.replica_id=ch.replica_id and va.owner_user_id=ch.owner_user_id and va.attempt=ch.verification_attempt
 and va.outcome='running' and va.verifier=ch.verifier and va.verifier_version=$8::jsonb->>'verifierVersion')
 and g.statement_set='${MODERN_AUTHORITY_STATEMENT_SET}' and g.state='active' and g.expires_at>now()
 and g.receipt_hash=$9 and g.receipt_payload=$10::jsonb
 and g.grant_id=($10::jsonb->'envelope'->'contract'->>'comparisonConsentId')::uuid
 and g.granted_at=ch.issued_at and g.expires_at=ch.expires_at
 for update of ch,g nowait
) select a.* from authority a where a.binding=$5::jsonb and exists(select 1 from current_capture)`;

export const MODERN_COMPARISON_DESCRIPTOR_SQL = `select s.source_id,r.primary_selection_id,s.sha256,s.created_at,
 r.replica_id,r.owner_user_id,r.private_text_epoch,r.reference_authority_epoch,cc.consent_id capture_consent_id,sc.consent_id storage_consent_id
 from vy_replica r join vy_replica_voice_reference v using(replica_id,owner_user_id)
 join vy_replica_source s using(replica_id,owner_user_id,source_id)
 join lateral (select c.consent_id from vy_replica_consent c where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
 and c.scope='capture' and c.policy_version=r.policy_version and c.revoked_at is null
 and (c.expires_at is null or c.expires_at>now()) order by c.granted_at desc,c.consent_id limit 1) cc on true
 join lateral (select c.consent_id from vy_replica_consent c where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
 and c.scope='storage' and c.policy_version=r.policy_version and c.revoked_at is null
 and (c.expires_at is null or c.expires_at>now()) order by c.granted_at desc,c.consent_id limit 1) sc on true
 where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
 and r.lifecycle not in ('revoked','purging') and r.policy_version='${REPLICA_POLICY_VERSION}'
 and s.state='ready' and s.kind in ('audio','video') and s.contains_third_parties=false
 and s.capture_mode in ('upload','import','derived')
 and not (s.capture_mode='derived' and s.provenance->>'purpose'='mirror_window')
 and not exists(select 1 from unnest(array['capture','storage']::text[]) required(scope)
 where not exists(select 1 from vy_replica_consent c where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
 and c.scope=required.scope and c.policy_version=r.policy_version and c.revoked_at is null
 and (c.expires_at is null or c.expires_at>now())))`;

function comparisonSnapshot(b) {
  return sha256Hex({schema:'selected-voice-comparison-preview/v1',replica_id:b.replica_id,owner_user_id:b.owner_user_id,
    primary_source_id:b.primary_source_id,primary_source_sha256:b.primary_source_sha256,
    primary_selection_id:b.primary_selection_id,authority_epoch:String(b.authority_epoch),
    reference_authority_epoch:String(b.reference_authority_epoch),
    capture_consent_id:b.capture_consent_id,storage_consent_id:b.storage_consent_id});
}

export async function getOwnedModernComparisonDescriptor(db,ownerUserId,replicaId) {
  const rows=await query(db,MODERN_COMPARISON_DESCRIPTOR_SQL,[id(replicaId),id(ownerUserId)]);
  if (rows.length>1) fail('comparison_descriptor_ambiguous',503);
  const row=rows[0];
  if (!row) return null;
  if (!UUID.test(row.source_id||'') || !UUID.test(row.primary_selection_id||'') || !SHA.test(row.sha256||'') ||
      !Number.isFinite(Date.parse(row.created_at))) fail('comparison_descriptor_invalid',503);
  return Object.freeze({statement_set:MODERN_CAPTURE_PROFILE.comparisonStatementSet,
    primary_source_id:row.source_id,primary_selection_id:row.primary_selection_id,source_sha256:row.sha256,
    comparison_snapshot_sha256:comparisonSnapshot({...row,primary_source_id:row.source_id,primary_source_sha256:row.sha256,
      authority_epoch:row.private_text_epoch}),
    source_label:null,source_created_at:new Date(row.created_at).toISOString(),locales:['en-IN','hi-IN'],available:true,code:''});
}


function validatePurposeReference(row) {
  if (row.binding?.reference_authority_kind!=='private_comparison_reference') return;
  const h=row.comparison_receipt,p=validateComparisonReferenceReceipt(h);
  if (h.state!=='selected' || Date.parse(h.expires_at)<=Date.now() ||
      row.binding.comparison_reference_id!==h.reference_id || row.binding.comparison_reference_receipt_hash!==h.receipt_hash ||
      Object.entries(p.binding).some(([key,value])=>json(row.binding[key])!==json(value))) fail('reference_receipt_changed');
}

export async function issueOwnedModernChallenge(db, ownerUserId, replicaId, input={}) {
  const scope=[id(replicaId),id(ownerUserId),id(input.expected_primary_source_id),id(input.expected_primary_selection_id)];
  const biometric=attest(input.attestations,BIOMETRIC_VERIFICATION_ATTESTATIONS);
  const comparisonAttestations=attest(input.comparison_attestations,SELECTED_COMPARISON_ATTESTATIONS);
  const bank=getIssuedVoiceBank(input.locale);
  if (!SHA.test(input.expected_primary_source_sha256||'') || !SHA.test(input.expected_comparison_snapshot_sha256||'')) fail('binding_invalid',400);
  const row=(await query(db,MODERN_AUTHORITY_SNAPSHOT_SQL,scope))[0];
  if (!row) fail('authority_unavailable');
  if (row.binding?.primary_source_sha256!==input.expected_primary_source_sha256) fail('selection_changed');
  if (comparisonSnapshot(row.binding)!==input.expected_comparison_snapshot_sha256) fail('comparison_preview_changed');
  validatePurposeReference(row);
  const reference=referenceFromAuthority(row),b=row.binding;
  if (!Number.isSafeInteger(b.reference_authority_epoch) || b.reference_authority_epoch<0 ||
      b.reference_authority_epoch>=Number.MAX_SAFE_INTEGER) fail('authority_epoch_invalid',503);
  const challengeId=randomUUID(),comparisonConsentId=randomUUID(),issuedAt=row.server_now;
  const comparison={statement_set:MODERN_CAPTURE_PROFILE.comparisonStatementSet,challenge_id:challengeId,
    consent_id:comparisonConsentId,owner_user_id:ownerUserId,replica_id:replicaId,
    primary_source_id:b.primary_source_id,primary_selection_id:b.primary_selection_id,
    primary_source_sha256:b.primary_source_sha256,reference_evidence_sha256:sha256Hex(reference),
    comparison_snapshot_sha256:input.expected_comparison_snapshot_sha256,
    attestations:comparisonAttestations,granted_at:issuedAt};
  const envelope=buildModernCaptureContract({challengeId,replicaId,ownerUserId,comparisonConsentId,
    subjectPersonId:b.subject_person_id,identityCaseId:b.identity_case_id,identitySourceSha256:b.identity_source_sha256,
    primarySourceId:b.primary_source_id,primarySourceSha256:b.primary_source_sha256,primarySelectionId:b.primary_selection_id,
    captureConsentId:b.capture_consent_id,storageConsentId:b.storage_consent_id,
    referenceEvidenceSha256:sha256Hex(reference),comparisonReceiptSha256:sha256Hex(comparison),
    locale:input.locale,sentenceItemId:bank.items[randomInt(bank.items.length)].id,
    nonce:Array.from({length:6},()=>String(randomInt(10))).join(' '),issuedAt,
    expiresAt:new Date(Date.parse(issuedAt)+600000).toISOString()});
  const receipt={statement_set:MODERN_AUTHORITY_STATEMENT_SET,
    binding:{...b,reference_authority_epoch:b.reference_authority_epoch+1},biometric_attestations:biometric,
    comparison,envelope,expected_contract_sha256:envelope.contractSha256};
  if (!Array.isArray(row.issuance_fence)) fail('issuance_fence_unavailable',503);
  const result=await query(db,MODERN_AUTHORITY_ISSUE_SQL,[...scope,json(b),json(receipt),sha256Hex(receipt),json(row.issuance_fence)]);
  if (!result[0]) fail('issuance_conflict');
  return clientChallenge(result[0]);
}

export function createModernCaptureAuthorityLoader({db,now=Date.now}={}) {
  return async lease=> {
    const ids=[id(lease?.replicaId),id(lease?.ownerUserId),id(lease?.challengeId)];
    const row=(await query(db,MODERN_AUTHORITY_RECEIPT_SQL,ids))[0];
    const receipt=row?.receipt_payload;
    if (!receipt || row.receipt_hash!==sha256Hex(receipt) || receipt.statement_set!==MODERN_AUTHORITY_STATEMENT_SET)
      fail('authority_unavailable',503);
    const issued=bindModernCaptureLease(validateModernCaptureContract(receipt.envelope,receipt.expected_contract_sha256,now()),lease);
    const c=issued.contract,b=receipt.binding;
    attest(receipt.biometric_attestations,BIOMETRIC_VERIFICATION_ATTESTATIONS);
    attest(receipt.comparison?.attestations,SELECTED_COMPARISON_ATTESTATIONS);
    if (sha256Hex(receipt.comparison)!==c.comparisonReceiptSha256 ||
        receipt.comparison.statement_set!==MODERN_CAPTURE_PROFILE.comparisonStatementSet ||
        receipt.comparison.consent_id!==c.comparisonConsentId || receipt.comparison.challenge_id!==c.challengeId ||
        receipt.comparison.owner_user_id!==c.ownerUserId || receipt.comparison.replica_id!==c.replicaId ||
        receipt.comparison.primary_source_id!==c.primarySourceId || receipt.comparison.primary_selection_id!==c.primarySelectionId ||
        receipt.comparison.primary_source_sha256!==c.primarySourceSha256 || receipt.comparison.reference_evidence_sha256!==c.referenceEvidenceSha256 ||
        receipt.comparison.granted_at!==c.issuedAt ||
        !Number.isSafeInteger(b?.reference_authority_epoch) || b.reference_authority_epoch<1 ||
        receipt.comparison.comparison_snapshot_sha256!==comparisonSnapshot({...b,reference_authority_epoch:b.reference_authority_epoch-1}) ||
        Object.entries({replica_id:c.replicaId,owner_user_id:c.ownerUserId,subject_person_id:c.subjectPersonId,
          identity_case_id:c.identityCaseId,identity_source_sha256:c.identitySourceSha256,
          primary_source_id:c.primarySourceId,primary_source_sha256:c.primarySourceSha256,primary_selection_id:c.primarySelectionId,
          capture_consent_id:c.captureConsentId,storage_consent_id:c.storageConsentId}).some(([k,v])=>b?.[k]!==v) ||
        lease.identityReference?.sourceId!==b.identity_source_id) fail('receipt_binding_mismatch');
    const scope=[c.replicaId,c.ownerUserId,c.primarySourceId,c.primarySelectionId];
    const fresh=(await query(db,MODERN_AUTHORITY_LOAD_SQL,[...scope,json(b),c.challengeId,
      livenessVerificationLeaseHash(lease.leaseToken),json(lease),row.receipt_hash,json(receipt)]))[0];
    if (!fresh) fail('authority_withdrawn');
    if (json(fresh.binding)!==json(b)) fail('authority_changed');
    validatePurposeReference(fresh);
    const reference=referenceFromAuthority(fresh);
    if (sha256Hex(reference)!==c.referenceEvidenceSha256) fail('reference_mismatch');
    return Object.freeze({envelope:issued,expectedHash:receipt.expected_contract_sha256,reference});
  };
}
