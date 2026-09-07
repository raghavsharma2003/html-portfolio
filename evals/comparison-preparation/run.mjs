// Consumed synthetic control flow, never SQL parser or voice acceptance.
import assert from 'node:assert/strict';
import {stableUuid,sha256Hex} from '../../api/_replica-processing/contracts.js';
import {COMPARISON_STEPS,comparisonPreparationReadiness,assertComparisonVoiceEvidence} from '../../api/_replica-processing/comparison.js';
import {getIssuedVoiceProfile} from '../../api/_voice-identity/issued-contract.js';
import {assertProcessingPurpose} from '../../api/_replica-processing/purpose.js';
import {assertDependencies,nextProcessingSteps} from '../../api/_replica-processing/pipeline.js';
import {executeProcessingJob} from '../../api/_replica-processing/worker.js';
import {runNextProcessingJob} from '../../api/_replica-processing/runtime.js';
import {createFakeProcessingAdapters} from '../../api/_replica-processing/providers/fake.js';
import {createComparisonDispatch,COMPARISON_DISPATCH_CLAIM_SQL} from '../../api/_replica-processing/comparison-dispatch.js';
import {comparisonPreparationInput,authorizeOwnedComparisonPreparation,COMPARISON_PREPARATION_SNAPSHOT_SQL,COMPARISON_PREPARATION_AUTHORIZE_SQL,COMPARISON_PREPARATION_READ_SQL} from '../../api/_comparison-preparation.js';
import {processingCompletionReceipt} from '../../api/_replica-processing/queue.js';
import {sourceUploadInput} from '../../api/_replica-source.js';
import {commitProcessingOutput} from '../../api/_replica-processing/repository.js';
globalThis.fetch=async()=>{throw Error('offline_network_forbidden');};
let count=0;const test=async(name,fn)=>{await fn();console.log(`ok ${++count} - ${name}`);};
const id=s=>stableUuid('comparison-control:'+s),owner=id('owner'),rid=id('replica'),sid=id('source'),pid=id('preparation');
const source={source_id:sid,replica_id:rid,owner_user_id:owner,purpose:'comparison_reference',capture_mode:'upload',kind:'audio',
 state:'processing',mime:'audio/wav',byte_size:24000,duration_ms:24000,sha256:'a'.repeat(64),contains_third_parties:false,
 storage_bucket:'synthetic-only',object_path:`${owner}/${rid}/${sid}/original`};
const prep={preparation_id:pid,receipt_sha256:'b'.repeat(64),state:'running'};
const job=step=>({job_id:id(step),replica_id:rid,owner_user_id:owner,source_id:sid,step,revision:1,state:'leased',attempt:1,comparison_preparation_id:pid});
const attestations={recording_is_only_me:true,process_for_private_comparison:true,no_training_or_public_voice_permission:true};
function fixture(step='diarize',options={}){
 const events=[],leased={job:job(step),leaseToken:'lease-token-'.repeat(4)};
 let active=true,claim=false;
 const db=async(sql,p)=>{events.push(sql===COMPARISON_DISPATCH_CLAIM_SQL?'claim':sql.startsWith('update')?'write':'authority');
  if(sql===COMPARISON_DISPATCH_CLAIM_SQL){if(!active||claim)return[];claim=true;return[{step}];}
  if(sql.startsWith('update vy_replica_comparison_dispatch'))return[{step}];
  if(sql.startsWith('update'))return[];
  return active?[prep]:[];};
 const meter={kind:'azure-container-infrastructure/v1',reserve:async()=>{events.push('reserve');return{receipt_sha256:'c'.repeat(64)};},
  begin:async()=>{events.push('begin');if(options.beginLoss)throw Error('synthetic_begin_response_lost');},
  settle:async()=>{events.push('settle');return{accounted:true,receipt_sha256:'d'.repeat(64)};},
  markUncertain:async()=>events.push('uncertain'),releaseBeforeBegin:async()=>events.push('release')};
 return {events,leased,db,meter,revoke:()=>{active=false;},dispatch:createComparisonDispatch({db,leased,source,preparation:prep,meter:options.noMeter?null:meter})};
}
await test('explicit exact processing choices are distinct and mandatory',()=>{
 assert(comparisonPreparationInput({preparation_id:pid,source_id:sid,attestations}));
 for(const a of [{}, {...attestations,process_for_private_comparison:false},{...attestations,extra:true}])assert.throws(()=>comparisonPreparationInput({preparation_id:pid,source_id:sid,attestations:a}));
});
await test('generic source create cannot request comparison purpose without server branch',()=>{
 const i={...source,upload_intent_id:pid};assert.throws(()=>sourceUploadInput(i));assert.equal(sourceUploadInput(i,{comparisonPreparation:true}).purpose,'comparison_reference');
 assert.throws(()=>sourceUploadInput({...i,byte_size:33554433},{comparisonPreparation:true}));
});
await test('seven-stage comparison graph excludes transcription and preserves ordinary graph',()=>{
 assert.equal(nextProcessingSteps('enhance',[],source).join(),'voice_quality');assert.equal(nextProcessingSteps('enhance',['separate']).join(),'transcribe');
 assert.throws(()=>assertProcessingPurpose(source,'transcribe'));assertDependencies('voice_quality',COMPARISON_STEPS.slice(0,-1),source);
 assert.throws(()=>assertDependencies('voice_quality',['enhance'],source));
});
await test('measured overlong recording cannot enter any model stage',()=>{
 assert.throws(()=>assertProcessingPurpose({...source,duration_ms:60001},'diarize'));assert.throws(()=>assertProcessingPurpose({...source,duration_ms:null},'diarize'));
});
await test('real worker refuses unmetered model before adapter or private fetch',async()=>{
 const f=fixture('diarize',{noMeter:true});let calls=0;
 const adapter={family:'diarization',name:'synthetic',version:'v1',diarize:async()=>{calls++;return{};}};
 const result=await executeProcessingJob({job:f.leased.job,source,adapters:{diarize:adapter},completedSteps:COMPARISON_STEPS.slice(0,3),comparison:f.dispatch});
 assert.equal(result.failure_code,'comparison_gpu_accounting_unavailable');assert.equal(calls,0);assert(!f.events.includes('reserve'));
});
await test('revocation before dispatch prevents reservation and claim',async()=>{
 const f=fixture();f.revoke();await assert.rejects(()=>f.dispatch.billing.beforeProviderRequest({operation:'diarize',requestSha256:'e'.repeat(64)}));assert(!f.events.includes('reserve'));
});
await test('same dispatch cannot pass a second provider start',async()=>{
 const f=fixture();await f.dispatch.billing.beforeProviderRequest({operation:'diarize',requestSha256:'e'.repeat(64)});
 await assert.rejects(()=>f.dispatch.billing.beforeProviderRequest({operation:'diarize',requestSha256:'e'.repeat(64)}));
 assert.equal(f.events.filter(e=>e==='begin').length,1);
});
await test('lost begin acknowledgement stays uncertain with no release or retry',async()=>{
 const f=fixture('diarize',{beginLoss:true});let error;try{await f.dispatch.billing.beforeProviderRequest({operation:'diarize',requestSha256:'e'.repeat(64)});}catch(e){error=e;}
 const failure=await f.dispatch.failStage(error);assert.equal(failure.code,'comparison_dispatch_reconciliation_required');assert.equal(failure.retryable,false);assert(f.events.includes('uncertain'));assert(!f.events.includes('release'));
});
await test('settled synthetic meter still cannot defeat revoked completion',async()=>{
 const f=fixture();await f.dispatch.billing.beforeProviderRequest({operation:'diarize',requestSha256:'e'.repeat(64)});
 await f.dispatch.billing.afterProviderResponse({request_sha256:'e'.repeat(64),response_sha256:'f'.repeat(64)});f.revoke();
 await assert.rejects(()=>f.dispatch.completeStage({evidence:[]}));assert.equal(f.events.filter(e=>e==='settle').length,1);
});
await test('native stages produce purpose-bound immutable receipts without model budget',async()=>{
 const f=fixture('integrity',{noMeter:true}),result=await executeProcessingJob({job:f.leased.job,source,adapters:createFakeProcessingAdapters(),completedSteps:[],comparison:f.dispatch});
 assert.equal(result.outcome,'complete');const receipt=processingCompletionReceipt(result.result);
 assert.equal(receipt.preparation_id,pid);assert.equal(receipt.preparation_receipt_sha256,prep.receipt_sha256);assert.deepEqual(receipt.next_steps,['malware_scan']);
 assert.throws(()=>processingCompletionReceipt({...result.result,next_steps:['transcribe']}));
});
await test('actual grant writer binds real snapshot and refuses changed insertion',async()=>{
 const binding={source_id:sid,source_sha256:source.sha256};let seen;
 await assert.rejects(()=>authorizeOwnedComparisonPreparation(async(sql,p)=>{
  if(sql===COMPARISON_PREPARATION_READ_SQL)return[];if(sql===COMPARISON_PREPARATION_SNAPSHOT_SQL)return[{binding}];
  assert.equal(sql,COMPARISON_PREPARATION_AUTHORIZE_SQL);seen=JSON.parse(p[6]);return[];
 },owner,rid,{preparation_id:pid,source_id:sid,attestations}),e=>e.code==='comparison_preparation_changed');
 assert.equal(seen.source_sha256,source.sha256);assert.deepEqual(seen.attestations,attestations);
});
await test('actual runtime lease branch stops unavailable GPU and records failed preparation',async()=>{
 let provider=0,failedPrep=false;
 const j=job('diarize');const db=async(sql,p)=>{
  if(sql.includes('with candidate as'))return[j];
  if(sql.startsWith('select s.source_id'))return[source];
  if(sql.startsWith('select step'))return COMPARISON_STEPS.slice(0,3).map(step=>({step}));
  if(sql.includes('select p.* from source'))return[prep];
  if(sql.startsWith('update vy_replica_comparison_preparation')){failedPrep=true;return[];}
  if(sql.includes('with settled as'))return[j];throw Error('unexpected_runtime_query');
 };
 const result=await runNextProcessingJob({db,adapters:{diarize:{family:'diarization',name:'synthetic',version:'v1',diarize:async()=>{provider++;}}}});
 assert.equal(result.failure_code,'comparison_gpu_accounting_unavailable');assert.equal(provider,0);assert(failedPrep);
});
await test('completion SQL is actual caller with purpose and settled dispatch predicates',async()=>{
 const f=fixture('integrity',{noMeter:true}),out=await executeProcessingJob({job:f.leased.job,source,adapters:createFakeProcessingAdapters(),completedSteps:[],comparison:f.dispatch});
 let sql;await commitProcessingOutput(async(s)=>{sql=s;return[{job_id:f.leased.job.job_id}];},{jobId:f.leased.job.job_id,leaseToken:f.leased.leaseToken,output:out});
 assert(sql.includes('comparison_replica_guard'));assert(sql.includes("cd.state='settled'"));assert(sql.includes('comparison_completed'));
});
await test('public readiness cannot claim configured GPU accounting',()=>{const r=comparisonPreparationReadiness();assert.equal(r.available,false);assert.equal(r.waiting_on,'us');assert.equal(r.can_prepare,false);});
await test('compatible declared revisions remain required and historical VAD absence is refused',()=>{
 const revisions={...getIssuedVoiceProfile().speaker.expected_candidate_revisions},artifact=id('artifact'),hash='a'.repeat(64);
 const records=[{evidence_type:'voice_measurement',value:{input_set:[{artifact_id:artifact,sha256:hash}],measurements:{model_revisions:revisions}}},
 ...[['speechbrain-ecapa-voxceleb','speechbrain-ecapa',192],['speechbrain-xvector-voxceleb','speechbrain-xvector',512]].map(([family,model,length])=>({evidence_type:'voice_embedding',artifact_id:artifact,input_sha256:hash,value:{family,model_revision:revisions[model],vector:Array(length).fill(.01)}}))];
 assertComparisonVoiceEvidence(records);const missing=structuredClone(records);delete missing[0].value.measurements.model_revisions['silero-vad'];assert.throws(()=>assertComparisonVoiceEvidence(missing));
 const wrong=structuredClone(records);wrong[1].value.vector.pop();assert.throws(()=>assertComparisonVoiceEvidence(wrong));
});
console.log(`${count} offline comparison controls passed; no real SQL/provider/voice acceptance`);
