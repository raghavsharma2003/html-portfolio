// Synthetic SQL prerequisites only. No auth users, storage objects, providers,
// enrollment acceptance or automatic invocation. Every inserted ID is declared.
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures.mjs';
import {createEvidenceRecord,createArtifactManifest,sha256Hex} from '../../api/_replica-processing/contracts.js';
import {persistProcessingOutput} from '../../api/_replica-processing/repository.js';

export const LIVE_DATABASE='vyakti_expert_integration_20260906';
export const LIVE_TABLES=Object.freeze(['vy_replica','vy_replica_source','vy_replica_consent','vy_replica_identity_case',
 'vy_replica_voice_reference','vy_replica_processing_job','vy_replica_processing_attempt','vy_replica_processing_artifact',
 'vy_replica_processing_evidence','vy_replica_processing_artifact_decision','vy_replica_processing_evidence_decision',
 'vy_replica_liveness_challenge','vy_replica_biometric_verification_grant','vy_replica_liveness_verification_attempt','vy_replica_audit',
 'vy_replica_model_build','vy_replica_voice_genome']);
export function makeLiveAuthorityFixture() {
 const original=fixture(),map=new Map();
 const remap=value=>{
  if(Array.isArray(value))return value.map(remap);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)]));
  if(typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value)){if(!map.has(value))map.set(value,randomUUID());return map.get(value);}
  return value;
 };
 const f=remap(original);
 f.reference_rows=f.reference_rows.map(e=>{
  if(e.evidence_type==='voice_measurement')e.input_sha256=sha256Hex({schema_version:'voice-analysis-input-set/v1',inputs:e.value.input_set});
  const record=createEvidenceRecord({...e,adapter_stage:'voice_quality',span:null,
   adapter:{family:e.adapter_family,name:e.adapter_name,version:e.adapter_version,measure(){}}});
  return {...e,...record};
 }).sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id));
 f.binding.evidence_pins=f.reference_rows.map(e=>({evidence_id:e.evidence_id,record_hash:e.record_hash,decision_id:e.decision_id}));
 f.captureId=randomUUID();f.enhanceJob=randomUUID();f.intakeJobs=[randomUUID(),randomUUID()];
 f.reviewConsentIds=[randomUUID(),randomUUID()];
 f.nonReferenceRecord=createEvidenceRecord({replica_id:f.binding.replica_id,owner_user_id:f.binding.owner_user_id,
  source_id:f.binding.primary_source_id,created_by_job_id:f.reference_rows[0].created_by_job_id,evidence_type:'speaker_segment',
  input_sha256:f.binding.primary_source_sha256,span:{start_ms:0,end_ms:1000},confidence:.5,value:{speaker_key:'synthetic-1',target_likelihood:.5},
  adapter_stage:'diarize',adapter:{family:'diarization',name:'silero-ecapa-cluster',version:'vyakti-voice-evidence-v1',diarize(){}}});
 // Artifact selection IDs are generated-always BIGINT (migration044), unlike
 // UUID evidence decision IDs. Never carry the in-memory UUID stand-in to SQL.
 f.binding.artifact_decision_id=null;
 f.generatedArtifactDecisionIds=[];f.allocatedChallenges=[];f.allocatedGrants=[];
 f.artifact=createArtifactManifest({artifact_id:f.binding.artifact_id,replica_id:f.binding.replica_id,
  owner_user_id:f.binding.owner_user_id,source_id:f.binding.primary_source_id,created_by_job_id:f.enhanceJob,
  stage:'enhance',variant_key:'identity-preserving',storage_bucket:'synthetic-no-storage',
  object_path:`${f.binding.owner_user_id}/${f.binding.replica_id}/${f.binding.primary_source_id}/derived/reference-v1/enhance-${f.binding.artifact_id}`,
  mime:'audio/wav',byte_size:12,duration_ms:2000,sha256:f.binding.artifact_sha256,input_sha256:f.binding.primary_source_sha256,
  transform_name:'capture-audio',transform_version:'reference-v1',parameter_hash:sha256Hex({synthetic_sql_only:true}),
  adapter_stage:'enhance',adapter:{family:'enhancement',name:'deepfilternet3-dual-candidate',version:'vyakti-voice-evidence-v1',enhance(){}}});
 return f;
}
export function liveAuthorityManifest(f) {
 return {declaration:'Synthetic SQL rows only. No real person enrollment, biometrics, auth, media, provider work or identity acceptance.',
  replica_id:f.binding.replica_id,owner_user_id:f.binding.owner_user_id,person_id:f.binding.subject_person_id,
  source_ids:[f.binding.primary_source_id,f.binding.identity_source_id,f.captureId],
  consent_ids:[f.binding.capture_consent_id,f.binding.storage_consent_id,...f.reviewConsentIds],identity_case_id:f.binding.identity_case_id,
  artifact_id:f.binding.artifact_id,evidence_ids:[...f.reference_rows.map(e=>e.evidence_id),f.nonReferenceRecord.evidence_id],
  decision_ids:f.reference_rows.map(e=>e.decision_id),
  generated_artifact_decision_ids:[...f.generatedArtifactDecisionIds],
  job_ids:[f.enhanceJob,f.reference_rows[0].created_by_job_id,...f.intakeJobs],
  challenge_ids:[...f.allocatedChallenges],grant_ids:[...f.allocatedGrants],primary_selection_id:f.binding.primary_selection_id};
}
export async function assertLiveAuthorityAbsent(db,f) {
 const b=f.binding,manifest=liveAuthorityManifest(f);
 const queries=[
  ['select count(*)::int n from vy_replica where replica_id=$1::uuid or owner_user_id=$2::uuid',[b.replica_id,b.owner_user_id]],
  ['select count(*)::int n from vy_person where person_id=$1::uuid',[b.subject_person_id]],
  ['select count(*)::int n from vy_replica_source where source_id=any($1::uuid[])',[manifest.source_ids]],
  ['select count(*)::int n from vy_replica_processing_evidence where evidence_id=any($1::uuid[])',[manifest.evidence_ids]],
  ['select count(*)::int n from vy_replica_processing_artifact where artifact_id=$1::uuid',[b.artifact_id]],
  ['select count(*)::int n from vy_replica_processing_job where job_id=any($1::uuid[])',[manifest.job_ids]],
  ['select count(*)::int n from vy_replica_processing_attempt where job_id=any($1::uuid[])',[manifest.job_ids]],
  ['select count(*)::int n from vy_replica_identity_case where identity_case_id=$1::uuid',[b.identity_case_id]],
  ['select count(*)::int n from vy_replica_consent where consent_id=any($1::uuid[])',[manifest.consent_ids]],
  ['select count(*)::int n from vy_replica_processing_artifact_decision where replica_id=$1::uuid or owner_user_id=$2::uuid or artifact_id=$3::uuid',[b.replica_id,b.owner_user_id,b.artifact_id]],
  ['select count(*)::int n from vy_replica_processing_evidence_decision where decision_id=any($1::uuid[])',[manifest.decision_ids]],
  ['select count(*)::int n from vy_replica_model_build where replica_id=$1::uuid or owner_user_id=$2::uuid',[b.replica_id,b.owner_user_id]],
  ['select count(*)::int n from vy_replica_voice_genome where replica_id=$1::uuid',[b.replica_id]],
 ];
 for(const [sql,p]of queries){const rows=await db(sql,p);if(rows.length!==1||Number(rows[0].n)!==0)throw Error('live_authority_fixture_preexisting');}
}
export async function seedLiveAuthority(db,f,onGeneratedArtifactDecision) {
 if(typeof onGeneratedArtifactDecision!=='function')throw Error('generated_decision_durable_callback_required');
 const b=f.binding;
 await db('insert into vy_person(person_id) values($1::uuid)',[b.subject_person_id]);
 await db("insert into vy_replica(replica_id,owner_user_id,subject_person_id,display_name,subject_mode,lifecycle,policy_version,primary_selection_id,private_text_epoch,reference_authority_epoch) values($1::uuid,$2::uuid,$3::uuid,'Synthetic comparison SQL only','self','enrolling',$4,$5::uuid,$6::bigint,$7::bigint)",
  [b.replica_id,b.owner_user_id,b.subject_person_id,b.policy_version,b.primary_selection_id,b.authority_epoch,b.reference_authority_epoch]);
 for(const [scope,cid]of [['capture',b.capture_consent_id],['storage',b.storage_consent_id]])await db(
  "insert into vy_replica_consent(consent_id,replica_id,owner_user_id,scope,method,policy_version,receipt_hash,metadata,expires_at) values($1::uuid,$2::uuid,$3::uuid,$4,'manual_review',$5,$6,'{\"synthetic_sql_fixture\":true}'::jsonb,now()+interval '1 day')",
  [cid,b.replica_id,b.owner_user_id,scope,b.policy_version,sha256Hex('synthetic-'+scope)]);
 for(const [sid,kind,mode,mime,sha,state] of [[b.primary_source_id,'audio','upload','audio/wav',b.primary_source_sha256,'ready'],
  [b.identity_source_id,'image','identity_document','image/png',b.identity_source_sha256,'quarantined'],
  [f.captureId,'video','live_challenge','video/webm','d'.repeat(64),'quarantined']])await db(
  "insert into vy_replica_source(source_id,replica_id,owner_user_id,consent_id,kind,capture_mode,storage_bucket,object_path,mime,byte_size,sha256,state,contains_third_parties) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,'synthetic-no-storage',$7,$8,12,$9,$10,false)",
  [sid,b.replica_id,b.owner_user_id,b.capture_consent_id,kind,mode,`${b.owner_user_id}/${b.replica_id}/${sid}/original`,mime,sha,state]);
 await db("insert into vy_replica_identity_case(identity_case_id,replica_id,owner_user_id,source_id,policy_version,consent_receipt_hash,source_sha256,consented_at,state,adult_evidence,document_authentic,document_current,face_reference_ready,credential_expires_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,now(),'evidence_ready',true,true,true,true,now()+interval '1 day')",
  [b.identity_case_id,b.replica_id,b.owner_user_id,b.identity_source_id,b.policy_version,sha256Hex('synthetic-identity-consent'),b.identity_source_sha256]);
 await db('insert into vy_replica_voice_reference(replica_id,owner_user_id,source_id) values($1::uuid,$2::uuid,$3::uuid)',[b.replica_id,b.owner_user_id,b.primary_source_id]);
 for(const [jid,step]of [[f.enhanceJob,'enhance'],[f.reference_rows[0].created_by_job_id,'voice_quality']])await db(
  "insert into vy_replica_processing_job(job_id,replica_id,owner_user_id,source_id,step,state) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'complete')",
  [jid,b.replica_id,b.owner_user_id,b.primary_source_id,step]);
 await persistProcessingOutput(db,{outcome:'complete',artifacts:[f.artifact],evidence:f.reference_rows});
 const selected=await db("insert into vy_replica_processing_artifact_decision(artifact_id,replica_id,owner_user_id,decision,reason_code,reviewer_user_id,metadata) values($1::uuid,$2::uuid,$3::uuid,'selected','owner_voice_match',$3::uuid,'{\"synthetic_sql_fixture\":true}'::jsonb) returning decision_id::text as decision_id",
  [b.artifact_id,b.replica_id,b.owner_user_id]);
 const generated=selected[0]?.decision_id;
 if(selected.length!==1||typeof generated!=='string'||!/^[1-9][0-9]*$/.test(generated)||BigInt(generated)>9223372036854775807n)throw Error('generated_artifact_decision_invalid');
 b.artifact_decision_id=generated;f.generatedArtifactDecisionIds.push(generated);
 // The predeclared owner/replica/artifact scope remains sufficient for exact
 // cleanup if this post-INSERT durable checkpoint is interrupted.
 await onGeneratedArtifactDecision();
 for(const e of f.reference_rows)await db("insert into vy_replica_processing_evidence_decision(decision_id,evidence_id,replica_id,owner_user_id,decision,reason_code,reviewer_user_id,metadata) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'accepted','measurement_verified',$4::uuid,'{\"synthetic_sql_fixture\":true}'::jsonb)",
  [e.decision_id,e.evidence_id,b.replica_id,b.owner_user_id]);
}
export function liveLeaseTimestamp(value) {
 // SQL-over-HTTP retains the full timestamp string. Client's default OID1184
 // Date parser loses microseconds; canonical JSON also turns Date into {}.
 // Keep exact text and refuse objects rather than inventing lost precision.
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('live_authority_lease_timestamp_string_required');
 return value;
}
export async function attachLiveCaptureLease(db,f,receipt) {
 const b=f.binding,c=receipt.envelope.contract;
 const token='synthetic-modern-comparison-'+randomUUID();
 const lease={replicaId:b.replica_id,ownerUserId:b.owner_user_id,challengeId:c.challengeId,sourceId:f.captureId,
  phrase:receipt.envelope.phrase,phraseHash:c.phraseSha256,attempt:1,leaseToken:token,
  verifierName:'azure_face_speech_composite',verifierVersion:'synthetic-sql-v1',
  source:{kind:'video',mime:'video/webm',byteSize:12,sha256:'d'.repeat(64),storageBucket:'synthetic-no-storage',objectPath:`${b.owner_user_id}/${b.replica_id}/${f.captureId}/original`},
  identityReference:{sourceId:b.identity_source_id,kind:'image',mime:'image/png',byteSize:12,sha256:b.identity_source_sha256,storageBucket:'synthetic-no-storage',objectPath:`${b.owner_user_id}/${b.replica_id}/${b.identity_source_id}/original`},
  officialFaceProof:{livenessPassed:true,identityMatch:true,identityScore:1,modelVersion:'synthetic-face-v1',providerDigest:'e'.repeat(64),referenceSha256:b.identity_source_sha256,providerDeleted:true}};
 const rows=await db("update vy_replica_liveness_challenge set state='verifying',source_id=$4::uuid,verification_attempt=1,verifier=$5,verification_lease_token_hash=$6,verification_lease_expires_at=now()+interval '3 minutes',face_session_state='passed_deleted',face_session_provider_deleted_at=now(),face_session_reference_sha256=$7,face_session_model_version=$8,face_session_result=$9::jsonb where challenge_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid returning verification_lease_expires_at::text as verification_lease_expires_at",
  [c.challengeId,b.replica_id,b.owner_user_id,f.captureId,lease.verifierName,sha256Hex(`replica-liveness-lease:v1:${token}`),b.identity_source_sha256,lease.officialFaceProof.modelVersion,
   JSON.stringify({passed:true,liveness_passed:true,identity_match:true,identity_score:1,provider_digest:lease.officialFaceProof.providerDigest})]);
 if(rows.length!==1)throw Error('live_authority_capture_attach_failed');lease.leaseExpiresAt=liveLeaseTimestamp(rows[0].verification_lease_expires_at);
 await db("insert into vy_replica_liveness_verification_attempt(challenge_id,replica_id,owner_user_id,attempt,verifier,verifier_version,outcome) values($1::uuid,$2::uuid,$3::uuid,1,$4,$5,'running')",[c.challengeId,b.replica_id,b.owner_user_id,lease.verifierName,lease.verifierVersion]);
 for(const [index,step]of ['integrity','malware_scan'].entries()){
  const manifest=sha256Hex('synthetic-'+step),jid=f.intakeJobs[index];
  const result={purpose:'live-challenge-intake/v1',step,verified_input_sha256:lease.source.sha256,artifact_ids:[],evidence_ids:[],next_steps:step==='integrity'?['malware_scan']:[],manifest_hash:manifest};
  await db("insert into vy_replica_processing_job(job_id,replica_id,owner_user_id,source_id,step,state,attempt,revision,result) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'complete',1,1,$6::jsonb)",[jid,b.replica_id,b.owner_user_id,f.captureId,step,JSON.stringify(result)]);
  await db("insert into vy_replica_processing_attempt(job_id,attempt,outcome,adapter_family,adapter_name,adapter_version,result_manifest_hash) select j.job_id,1,'complete',$4,$5,$6,$7 from vy_replica_processing_job j where j.job_id=$1::uuid and j.replica_id=$2::uuid and j.owner_user_id=$3::uuid",
   [jid,b.replica_id,b.owner_user_id,step==='integrity'?'integrity':'malware',step==='integrity'?'server-private-byte-verifier':'clamav-stream',step==='integrity'?'sha256-v1':'synthetic-sql-v1',manifest]);
 }
 return lease;
}
export async function countLiveAuthority(db,f) {
 const b=f.binding,counts={};
 for(const table of LIVE_TABLES){const r=table==='vy_replica_processing_attempt'
  ?await db('select count(*)::int n from vy_replica_processing_attempt where job_id=any($1::uuid[])',[liveAuthorityManifest(f).job_ids])
  :table==='vy_replica_voice_genome'?await db('select count(*)::int n from vy_replica_voice_genome where replica_id=$1::uuid',[b.replica_id])
  :await db(`select count(*)::int n from ${table} where replica_id=$1::uuid and owner_user_id=$2::uuid`,[b.replica_id,b.owner_user_id]);if(r.length!==1)throw Error('live_authority_recount_missing');counts[table]=Number(r[0].n);}
 const people=await db('select count(*)::int n from vy_person where person_id=$1::uuid',[b.subject_person_id]);counts.vy_person=Number(people[0]?.n);return counts;
}
export async function cleanupLiveAuthority(db,f) {
 const b=f.binding;
 await db('delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[b.replica_id,b.owner_user_id]);
 await db('delete from vy_person where person_id=$1::uuid',[b.subject_person_id]);
 return countLiveAuthority(db,f);
}
