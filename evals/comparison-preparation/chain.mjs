// Actual lease/runtime/worker/Azure adapter/commit code with synthetic SQL,
// transport, meter and audio-window fixtures. No database, GPU or likeness proof.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {stableUuid,sha256Hex,canonicalJson} from '../../api/_replica-processing/contracts.js';
import {createAzureVoiceEvidenceAdapters} from '../../api/_replica-processing/providers/azure-voice-evidence.js';
import {createFakeProcessingAdapters} from '../../api/_replica-processing/providers/fake.js';
import {runNextProcessingJob} from '../../api/_replica-processing/runtime.js';
import {getIssuedVoiceProfile} from '../../api/_voice-identity/issued-contract.js';
import {wavBytesForSamples} from '../../api/_replica-processing/reference-window.js';
import {COMPARISON_DISPATCH_CLAIM_SQL} from '../../api/_replica-processing/comparison-dispatch.js';
import {COMPARISON_STEPS} from '../../api/_replica-processing/comparison.js';
const id=s=>stableUuid('comparison-chain:'+s),owner=id('owner'),rid=id('replica'),sid=id('source'),pid=id('preparation');
const raw=Buffer.from('SYNTHETIC-NOT-OWNER-AUDIO'),secret=Buffer.alloc(32,71),objects=new Map(),completed=[],artifacts=[],evidence=[],dispatches=new Map(),http=[];
const source={source_id:sid,replica_id:rid,owner_user_id:owner,purpose:'comparison_reference',capture_mode:'upload',kind:'audio',state:'quarantined',
 storage_bucket:'synthetic-only',object_path:`${owner}/${rid}/${sid}/original`,sha256:sha256Hex(raw),byte_size:raw.length,duration_ms:24000,mime:'audio/wav',contains_third_parties:false};
objects.set(source.object_path,raw);
const preparation={preparation_id:pid,receipt_sha256:sha256Hex('synthetic-grant'),state:'running'};
let current;
const db=async(sql,p=[])=>{
 if(sql.includes('with candidate as')){current={job_id:id(COMPARISON_STEPS[completed.length]),source_id:sid,replica_id:rid,owner_user_id:owner,comparison_preparation_id:pid,
   step:COMPARISON_STEPS[completed.length],revision:1,attempt:1,state:'leased'};return[current];}
 if(sql.startsWith('select s.source_id'))return[source];
 if(sql.startsWith('select step'))return completed.map(step=>({step}));
 if(sql.includes('select p.* from source'))return[preparation];
 if(sql.startsWith('select artifact_id'))return artifacts.filter(a=>a.stage===p[3]);
 if(sql.includes("evidence_type='speaker_segment'"))return evidence.filter(e=>e.evidence_type==='speaker_segment').map(e=>({start_ms:e.span.start_ms,end_ms:e.span.end_ms,speaker_key:e.value.speaker_key,confidence:e.confidence,overlap:false}));
 if(sql===COMPARISON_DISPATCH_CLAIM_SQL){if(dispatches.has(p[5]))return[];dispatches.set(p[5],p[7]);return[{step:p[5]}];}
 if(sql.startsWith('update vy_replica_comparison_dispatch'))return[{step:current.step}];
 if(sql.startsWith('with comparison_source_guard')){
  artifacts.push(...JSON.parse(p[2]));evidence.push(...JSON.parse(p[3]));const receipt=JSON.parse(p[4]);
  assert.equal(receipt.purpose,'private-comparison-preparation/v1');assert.equal(receipt.preparation_id,pid);
  assert.equal(receipt.preparation_receipt_sha256,preparation.receipt_sha256);
  completed.push(current.step);source.state=current.step==='voice_quality'?'ready':'processing';
  if(current.step==='voice_quality'){preparation.state='prepared';preparation.completed_receipt=receipt;preparation.completed_receipt_sha256=p[5];}
  return[current];
 }
 if(sql.startsWith('select s.state'))return[{state:source.state}];
 throw Error('unexpected_chain_sql:'+sql.slice(0,60));
};
const sign=(...parts)=>createHmac('sha256',secret).update(parts.join('\n')).digest('base64url');
const resolveInput=async({input})=>{const body=objects.get(input.object_path);assert(body,'exact_fixture_locator');return{body,byteSize:body.length,mime:'audio/wav'};};
const azure=createAzureVoiceEvidenceAdapters({env:{AZURE_VOICE_EVIDENCE_ORIGIN:'https://voice-evidence.internal',AZURE_VOICE_EVIDENCE_HMAC_SECRET:secret.toString('base64url')},resolveInput,
 fetchImpl:async(url,init)=>{
  const path=new URL(url).pathname;if(path==='/healthz'){assert(dispatches.has(current.step),'metered_claim_before_wake');return new Response('{}',{status:200});}
  const req=JSON.parse(init.body),headers=new Headers(init.headers),nonce=headers.get('x-vyakti-nonce');http.push(req.operation);
  assert.equal(headers.get('x-vyakti-signature'),sign('vyakti-voice-evidence/v1','POST',path,headers.get('x-vyakti-timestamp'),nonce,sha256Hex(init.body)));
  let result;if(req.operation==='diarize')result={segments:[{start_ms:0,end_ms:24000,speaker_key:'synthetic-1',confidence:.5,target_likelihood:.5,overlap:false}]};
  if(req.operation==='enhance'){const input=req.inputs[0],body=Buffer.from('synthetic-enhanced');result={candidates:[{variant_key:'synthetic-identity-preserving',audio_base64:body.toString('base64'),sha256:sha256Hex(body),mime:'audio/wav',duration_ms:10000,input_sha256:input.sha256,
    parent_input_key:input.input_key,transform_name:'synthetic-transform',transform_version:'synthetic-v1',parameters:{synthetic:true},quality:{}}]};}
  if(req.operation==='voice_quality')result={embeddings:req.inputs.flatMap(i=>[{input_key:i.input_key,family:'speechbrain-ecapa-voxceleb',vector:Array(192).fill(.01),confidence:.5},
    {input_key:i.input_key,family:'speechbrain-xvector-voxceleb',vector:Array(512).fill(.02),confidence:.5}]),model_revisions:getIssuedVoiceProfile().speaker.expected_candidate_revisions,measurements:{synthetic:true},quality:{synthetic:true},confidence:.5};
  assert(result,'unexpected_provider_operation');const body=Buffer.from(canonicalJson(result));return new Response(body,{status:200,headers:{'x-vyakti-response-signature':sign('vyakti-voice-evidence/v1','response',path,nonce,'200',sha256Hex(body))}});
 }});
const store={async writeImmutable(i){await i.beforeWriteRequest?.();const body=Buffer.from(i.body);assert.equal(sha256Hex(body),i.expectedSha256);if(objects.has(i.objectPath))assert(objects.get(i.objectPath).equals(body));objects.set(i.objectPath,body);return{sha256:sha256Hex(body),byteSize:body.length,mime:i.mime};}};
let settlements=0;
const meter={kind:'azure-container-infrastructure/v1',assertReady:async()=>{},reserve:async()=>({receipt_sha256:sha256Hex('synthetic-reservation')}),begin:async()=>{},
 recordResponse:async()=>{settlements++;return{response_recorded:true,accounting_state:'accounting_pending',accounted:false,receipt_sha256:sha256Hex('synthetic-settlement')};},markUncertain:async()=>{throw Error('unexpected_uncertainty');},releaseBeforeBegin:async()=>{}};
const materialize=async(_,fn)=>fn({extractWindow:async(start,end,{rate=16000}={})=>wavBytesForSamples(Buffer.alloc(Math.round((end-start)*rate/1000)*2,0).map((_,i)=>i%2?0:120),rate)});
for(const step of COMPARISON_STEPS){const result=await runNextProcessingJob({db,adapters:{...createFakeProcessingAdapters(),...azure},artifactStore:store,resolveInput,
 withMaterializedAudio:materialize,comparisonMeter:meter,acquireStorageWriter:async()=>({}),renewStorageWriter:async w=>w,releaseStorageWriter:async()=>true});
 assert.equal(result.outcome,'complete',step+':'+result.failure_code);}
assert.deepEqual(completed,[...COMPARISON_STEPS]);assert.deepEqual(http,['diarize','enhance','voice_quality']);assert.equal(settlements,3);
assert.equal(preparation.state,'prepared');assert.equal(preparation.completed_receipt.evidence_ids.length,4);
assert(!evidence.some(e=>e.evidence_type==='transcript_span'));assert.equal(artifacts.filter(a=>a.stage==='enhance').length,1);
console.log('1 actual seven-stage caller chain passed with synthetic transport/meter/window/SQL; 3 fixture POSTs, no real provider or enrollment');
