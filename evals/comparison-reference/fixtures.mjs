import {createHash} from 'node:crypto';
import {createEvidenceRecord,sha256Hex,stableUuid} from '../../api/_replica-processing/contracts.js';
import {getIssuedVoiceProfile} from '../../api/_voice-identity/issued-contract.js';
import {REPLICA_POLICY_VERSION} from '../../api/_replica.js';
import * as store from '../../api/_comparison-reference.js';
export const uid=n=>stableUuid(`comparison-reference-synthetic-${n}`);
export const bytes=Buffer.alloc(32044);bytes.write('RIFF',0);bytes.writeUInt32LE(32036,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(32000,40);
// One second of synthetic 440Hz PCM; no owner recording or model output.
for(let i=0;i<16000;i++)bytes.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/16000)*1000),44+2*i);
export function candidateFixture(){
 const sha=createHash('sha256').update(bytes).digest('hex'),revisions=getIssuedVoiceProfile().speaker.expected_candidate_revisions;
 const input_set=[{artifact_id:uid(4),sha256:sha}];
 const base={replica_id:uid(1),owner_user_id:uid(2),source_id:uid(3),created_by_job_id:uid(5),adapter_stage:'voice_quality',
  adapter:{family:'voice-analysis',name:'speechbrain-independent-speaker-evidence',version:'vyakti-voice-evidence-v2',measure(){}},confidence:.8};
 const records=[['speechbrain-ecapa-voxceleb','speechbrain-ecapa',192],['speechbrain-xvector-voxceleb','speechbrain-xvector',512]]
  .map(([family,model,n])=>createEvidenceRecord({...base,artifact_id:uid(4),evidence_type:'voice_embedding',input_sha256:sha,
   value:{family,model_revision:revisions[model],vector:Array(n).fill(.02)}}));
 records.push(createEvidenceRecord({...base,evidence_type:'voice_measurement',input_sha256:sha256Hex({schema_version:'voice-analysis-input-set/v1',inputs:input_set}),value:{input_set,measurements:{model_revisions:revisions}}}));
 const reference_rows=records.map(e=>({...e,span_start_ms:e.span.start_ms,span_end_ms:e.span.end_ms,adapter_family:e.adapter.family,
  adapter_name:e.adapter.name,adapter_version:e.adapter.version,decision_id:null})).sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id));
 const binding={replica_id:uid(1),owner_user_id:uid(2),primary_source_id:uid(3),primary_source_sha256:'b'.repeat(64),primary_selection_id:uid(6),
  policy_version:REPLICA_POLICY_VERSION,authority_epoch:3,capture_consent_id:uid(7),storage_consent_id:uid(8),artifact_id:uid(4),artifact_sha256:sha,
  artifact_byte_size:bytes.length,artifact_mime:'audio/wav',job_id:uid(5),job_revision:1,
  evidence_pins:reference_rows.map(e=>({evidence_id:e.evidence_id,record_hash:e.record_hash,decision_id:null}))};
 return {binding,reference_rows,artifact_id:uid(4),source_id:uid(3),observed_epoch:4,source_created_at:new Date().toISOString(),
  expires_at:new Date(Date.now()+3600000).toISOString(),duration_ms:2000,mime:'audio/wav',byte_size:bytes.length,sha256:sha,
  storage_bucket:'synthetic-private',object_path:'synthetic/reference.wav'};
}
// Explicit SQL dispatcher, not PostgreSQL evidence. The live harness must prove
// predicates, row locks, constraints and erasure independently.
export function memoryFixture(){
 const state={candidate:candidateFixture(),rows:new Map(),calls:[],available:true};
 const db=async(sql,p)=>{
  state.calls.push({sql,p});
  const owns=p[0]===uid(1)&&p[1]===uid(2);
  if(sql===store.COMPARISON_OPTIONS_SQL)return owns&&state.available?[structuredClone(state.candidate)]:[];
  if(sql===store.COMPARISON_CURRENT_SQL)return owns?[...state.rows.values()].filter(h=>h.state==='selected').map(h=>structuredClone(h)):[];
  if(sql===store.COMPARISON_READ_SQL)return owns&&state.rows.has(p[2])?[structuredClone(state.rows.get(p[2]))]:[];
  if(!owns)return[];
  if(sql===store.COMPARISON_AUTHORIZE_SQL){if(state.rows.has(p[3]))return[];const h={reference_id:p[3],replica_id:p[0],owner_user_id:p[1],source_id:uid(3),artifact_id:p[2],state:'review',receipt_payload:JSON.parse(p[4]),receipt_hash:p[7],observed_epoch:p[6],expires_at:JSON.parse(p[4]).expires_at,created_at:new Date().toISOString(),audition_response_at:null};state.rows.set(p[3],h);return[structuredClone(h)];}
  if(sql===store.COMPARISON_AUDITION_SQL){const h=state.rows.get(p[3]);if(!h||h.state==='revoked')return[];h.audition_response_at=new Date().toISOString();return[structuredClone(h)];}
  if(sql===store.COMPARISON_CONFIRM_SQL){const h=state.rows.get(p[3]);if(!h||h.state!=='review')return[];h.state='selected';h.confirmed_at=new Date().toISOString();h.selected_epoch=++state.candidate.observed_epoch;return[structuredClone(h)];}
  if(sql===store.COMPARISON_WITHDRAW_SQL){let h=state.rows.get(p[2]);if(h?.state==='revoked')return[];if(!h){h={reference_id:p[2],replica_id:p[0],owner_user_id:p[1],created_at:new Date().toISOString(),expires_at:null};state.rows.set(p[2],h);}if(h.state==='selected')state.candidate.observed_epoch++;h.state='revoked';h.revoked_at=new Date().toISOString();h.receipt_payload=null;h.receipt_hash=null;return[structuredClone(h)];}
  throw Error('unexpected_sql');
 };
 return {state,db,readPrivate:async()=>({body:bytes,mime:'audio/wav'})};
}
export const attestations=()=>Object.fromEntries(store.COMPARISON_REFERENCE_STATEMENTS.map(s=>[s.id,true]));
export async function authorize(f,reference=uid(10)){
 const options=await store.comparisonReferenceOptions(f.db,uid(2),uid(1));
 const input={replica_id:uid(1),reference_id:reference,artifact_id:uid(4),expected_snapshot_hash:options.options[0].snapshot_hash,attestations:attestations()};
 await store.authorizeComparisonReference(f.db,uid(2),input);return input;
}
