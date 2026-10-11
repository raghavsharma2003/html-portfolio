import {createEvidenceRecord,sha256Hex,stableUuid} from '../../api/_replica-processing/contracts.js';
import {getIssuedVoiceProfile} from '../../api/_voice-identity/issued-contract.js';
import {REPLICA_POLICY_VERSION} from '../../api/_replica.js';
export const uid=n=>stableUuid(`modern-issued-authority-offline-${n}`);
export const NOW=Date.parse('2026-09-08T12:00:00.000Z');
export const clone=value=>structuredClone(value);
export function fixture({omitVad=false}={}) {
 const revisions=getIssuedVoiceProfile().speaker.expected_candidate_revisions;
 const inputSet=[{artifact_id:uid(8),sha256:'a'.repeat(64)}];
 const base={replica_id:uid(1),owner_user_id:uid(2),source_id:uid(3),created_by_job_id:uid(9),
  adapter_stage:'voice_quality',adapter:{family:'voice-analysis',name:'speechbrain-independent-speaker-evidence',
  version:'vyakti-voice-evidence-v2',measure(){}},confidence:0.8};
 const values=[['speechbrain-ecapa-voxceleb','speechbrain-ecapa',192],['speechbrain-xvector-voxceleb','speechbrain-xvector',512]];
 const records=values.map(([family,model,dimensions])=>createEvidenceRecord({...base,artifact_id:uid(8),
  evidence_type:'voice_embedding',input_sha256:'a'.repeat(64),value:{family,model_revision:revisions[model],vector:Array(dimensions).fill(.02)}}));
 records.push(createEvidenceRecord({...base,evidence_type:'voice_measurement',
  input_sha256:sha256Hex({schema_version:'voice-analysis-input-set/v1',inputs:inputSet}),
  value:{input_set:inputSet,measurements:{model_revisions:Object.fromEntries(Object.entries(revisions).filter(([key])=>!omitVad||key!=='silero-vad'))}}}));
 const rows=records.map((record,i)=>({...record,span_start_ms:record.span.start_ms,span_end_ms:record.span.end_ms,
  adapter_family:record.adapter.family,adapter_name:record.adapter.name,adapter_version:record.adapter.version,decision_id:uid(100+i)}))
  .sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id));
 const binding={replica_id:uid(1),owner_user_id:uid(2),subject_person_id:uid(4),primary_source_id:uid(3),
  primary_source_sha256:'b'.repeat(64),primary_selection_id:uid(5),identity_case_id:uid(6),identity_source_id:uid(7),
  identity_source_sha256:'c'.repeat(64),capture_consent_id:uid(10),storage_consent_id:uid(11),authority_epoch:7,reference_authority_epoch:3,
  policy_version:REPLICA_POLICY_VERSION,artifact_id:uid(8),artifact_sha256:'a'.repeat(64),artifact_decision_id:uid(12),
  evidence_pins:rows.map(e=>({evidence_id:e.evidence_id,record_hash:e.record_hash,decision_id:e.decision_id}))};
 return {binding,reference_rows:rows,server_now:new Date(NOW).toISOString(),issuance_fence:[]};
}
export function descriptorRow(f) {const b=f.binding;return {...b,source_id:b.primary_source_id,sha256:b.primary_source_sha256,
 private_text_epoch:b.authority_epoch,created_at:new Date(NOW-10000).toISOString()};}
export function leaseFor(receipt) {
 const c=receipt.envelope.contract;
 return {replicaId:c.replicaId,ownerUserId:c.ownerUserId,challengeId:c.challengeId,sourceId:uid(30),
  phrase:receipt.envelope.phrase,phraseHash:c.phraseSha256,attempt:1,leaseToken:'f'.repeat(64),
  leaseExpiresAt:new Date(NOW+180000).toISOString(),verifierName:'azure_face_speech_composite',verifierVersion:'fixture-v2',
  source:{kind:'video',mime:'video/webm',byteSize:12,sha256:'d'.repeat(64),storageBucket:'synthetic-private',objectPath:'synthetic/capture'},
  identityReference:{sourceId:uid(7),kind:'image',mime:'image/png',byteSize:12,sha256:'c'.repeat(64),storageBucket:'synthetic-private',objectPath:'synthetic/id'},
  officialFaceProof:{livenessPassed:true,identityMatch:true,identityScore:.9,modelVersion:'synthetic-version',providerDigest:'e'.repeat(64),referenceSha256:'c'.repeat(64),providerDeleted:true}};
}
