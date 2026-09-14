import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import { runOwnedCorrectionCandidate, CORRECTION_DATASET_SQL, CORRECTION_JOB_READ_SQL, CORRECTION_CURRENT_AUTHORITY_SQL } from '../../api/_replica-correction-candidate.js';
import { OWNED_RUNTIME_CONTEXT_SQL, loadOwnedRuntimeContext } from '../../api/_replica-runtime.js';
import { FEEDBACK_DATASET_REVIEW_SQL, buildFeedbackDatasetDefinition } from '../../api/_replica-feedback-dataset.js';
import { encryptTurnExemplar, exemplarTextHash } from '../../api/_replica-feedback-crypto.js';
import { buildPrivateCorrectionArtifact, renderPrivateCorrectionCandidate } from '../../api/_replica-correction-artifact.js';
import { CORRECTION_REQUEST_SCHEMA } from '../../api/_replica-correction-request.js';
import { REPLICA_POLICY_VERSION } from '../../api/_replica.js';
import { canonicalJson, sha256Hex } from '../../api/_provenance/contracts.js';

// Executes the real worker, crypto, dataset builder, renderer, registration and
// meter with a stateful SQL fixture. It does not parse SQL, prove DB isolation,
// call Azure, or establish candidate quality. Unrecognized SQL always fails.
const uid = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RID=uid(90001), OWNER=uid(90002), CAP=uid(90003), DATASET=uid(90004);
const ENV={ REPLICA_FEEDBACK_KEK_ID:'fixture-kek-v1', REPLICA_FEEDBACK_KEK_B64:Buffer.alloc(32,7).toString('base64'),
  AZURE_CORRECTION_BASE_MODEL_COMMITMENT:'a'.repeat(64), AZURE_REPLICA_BUDGET_ID:'fixture-correction',
  AZURE_REPLICA_APP_BUDGET_USD:'1', AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS:'0.4', AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS:'1.6' };
const hash=value=>sha256Hex(canonicalJson(value));
const sqlInventory=new Map();
const rows=[], encrypted=new Map(), plaintext=new Map();
let index=0;
for(let session=1;session<=12;session++) for(let item=0;item<16;item++) {
  const n=++index, correction=`Private correction ${n}: pehle ek chhoti observation.`;
  const row={feedback_id:uid(n),turn_id:uid(20000+n),session_id:uid(10000+session),revision:1,
    profile_version:7,calibration_version:3,capability_id:CAP,
    prompt_hash:sha256Hex(`Synthetic qualification prompt ${n}`),learner_input_sha256:sha256Hex(`Synthetic qualification question ${n}`),
    ratings:{wording:item<4?'off':'exact',behavior:item<4?'close':'exact',relationship:item<4?'close':'exact',memory:item<4?'close':'exact',delivery:item<4?'close':'exact'},
    ratings_hash:sha256Hex(`rating ${n}`),response_hash:sha256Hex(`response ${n}`),
    correction_hash:item<4?exemplarTextHash(correction):null,source_generation_id:null};
  rows.push(row);
  if(item<4){plaintext.set(row.feedback_id,correction); encrypted.set(row.feedback_id,encryptTurnExemplar(correction,
    {feedback_id:row.feedback_id,replica_id:RID,turn_id:row.turn_id,text_sha256:row.correction_hash},ENV));}
}
const built=buildFeedbackDatasetDefinition(rows,[],{replica_id:RID,capability_id:CAP,profile_version:7,calibration_version:3});
assert.equal(built.readiness.ready_for_candidate_dataset,true);
assert.equal(built.definition.examples.filter(e=>e.split==='train'&&e.kind==='preference').length,32);
const train=built.definition.examples.filter(e=>e.split==='train'&&e.kind==='preference');
const first=train[0], different=train.find(e=>e.session_commitment!==first.session_commitment);
const support=[first.feedback_id,train.find(e=>e.feedback_id!==first.feedback_id&&e.session_commitment===first.session_commitment).feedback_id,different.feedback_id];
const proposed=()=>({selections:[{strategy_id:'compact_observation',supporting_feedback_ids:support}]});
const input={replica_id:RID,dataset_id:DATASET,expected_source_set_hash:built.source_set_hash};
function runtimeRow(){return{replica_id:RID,owner_user_id:OWNER,subject_person_id:uid(90005),agent_id:uid(90006),
  subject_mode:'self',lifecycle:'active',policy_version:REPLICA_POLICY_VERSION,agent_status:'active',
  age_verified_at:'2026-08-24T00:00:00Z',identity_verified_at:'2026-08-24T00:00:00Z',liveness_verified_at:'2026-08-24T00:00:00Z',identity_expires_at:'2031-08-24T00:00:00Z',
  capability_id:CAP,capability_state:'active',runtime_policy:REPLICA_POLICY_VERSION,qualification_hash:'b'.repeat(64),
  voice_profile_id:uid(90007),genome_version:3,profile_version:7,calibration_version:3,provider:'fixture',provider_ref:'fixture-private',model:'fixture-voice',voice_status:'ready',capabilities:{},genome_status:'approved',
  profile_status:'approved',profile_definition:{identity:{self_name:'Asha'},speech:{languages:['Hinglish']},behavior:{turn_shape:'brief'}},
  calibration_status:'approved',calibration_definition:{schema:'vyakti.calibration.v1',builder:'calibration-builder/v1',strategies:[]},
  consent_id:uid(90008),consent_scope:'inference',consent_policy:REPLICA_POLICY_VERSION,consent_expires_at:'2031-08-24T00:00:00Z'};}

import {qualifyOwnedCandidate,loadOwnedCandidateQualificationReceipt,QUALIFICATION_RECEIPT_SQL,QUALIFICATION_CURRENT_AUTHORITY_SQL,QUALIFICATION_COMPARISON_AUTHORITY_SQL} from '../../api/_replica-candidate-qualification-service.js';
import {blindAssignmentHash,candidateRequiredLayers,CANDIDATE_QUALIFICATION_PROTOCOL} from '../../api/_replica-candidate-qualification.js';
import {prepareProviderRevisionBinding,verifyProviderRevision} from '../../api/_dialogue/provider-revision.js';
import {AZURE_DIALOGUE_API_VERSION,azureDialogueProtocol} from '../../api/_dialogue/providers/azure-foundry.js';
import {DIALOGUE_PROMPT} from '../../api/_dialogue/contracts.js';
import {createCandidateEvaluationHandler} from '../../api/replica-candidate-eval.js';
import {AuthError} from '../../api/_auth-core.js';
import {recordOwnedCandidateJudgment} from '../../api/_replica-candidate-eval.js';
import {compileReplicaRuntimeCore} from '../../api/_replica-runtime.js';
// Executes service, canonical commitments, revision verification, blinding decode,
// qualification statistics and writer. This fixture does not parse SQL or prove isolation.
const CID=uid(92001),RUN=uid(92002),JOB=uid(92003),runHash='c'.repeat(64);
const qualifiedInput={replica_id:RID,candidate_id:CID};
const testRows=built.definition.examples.filter(e=>e.split==='test');
const expectedBinding=prepareProviderRevisionBinding({expectedResponseModel:'gpt-4.1-mini-2025-04-14',endpoint:'https://raghavsharma1729-compan-resource.services.ai.azure.com/',deployment:'gpt-4.1-mini',baselineSnapshotHash:ENV.AZURE_CORRECTION_BASE_MODEL_COMMITMENT});
const identity=verifyProviderRevision({model:expectedBinding.expected_response_model,system_fingerprint:'fp_qualificationfixture'},expectedBinding);
const TERRA_ENV={AZURE_REPLICA_BUDGET_ID:'fixture-terra-budget',AZURE_REPLICA_APP_BUDGET_USD:'1',
 AZURE_FOUNDRY_DIALOGUE_RATE_MODEL:'gpt-5.6-terra',AZURE_FOUNDRY_DIALOGUE_EXPECTED_RESPONSE_MODEL:'gpt-5.6-terra-2026-07-09',
 AZURE_FOUNDRY_DIALOGUE_INPUT_USD_PER_MTOKENS:'2',AZURE_FOUNDRY_DIALOGUE_OUTPUT_USD_PER_MTOKENS:'12'};
function fixture(options={}){
 const runtime=runtimeRow(),initial=JSON.stringify(runtime),records=[],errors=[];let inserts=0,reads=0,reconciles=0;
 const rt={replica:{replica_id:RID},capability:{capability_id:CAP},personProfile:{definition:runtime.profile_definition},calibration:{definition:runtime.calibration_definition}};
 const {artifact}=buildPrivateCorrectionArtifact(rt,{status:'proposed',owner_approved:false,runtime_eligible:false,source_set_hash:built.source_set_hash,selections:[{scenario_id:'delivery.turn_shape',strategy_id:'compact_observation'}]});
 const manifest={artifact_sha256:hash(artifact),source_set_hash:built.source_set_hash,base_model_commitment:ENV.AZURE_CORRECTION_BASE_MODEL_COMMITMENT};
 const revision=options.terra?prepareProviderRevisionBinding({expectedResponseModel:'gpt-5.6-terra-2026-07-09',endpoint:'https://raghavsharma1729-compan-resource.services.ai.azure.com/',deployment:'gpt-5.6-terra',baselineSnapshotHash:ENV.AZURE_CORRECTION_BASE_MODEL_COMMITMENT}):expectedBinding;
 const providerIdentity=options.terra?verifyProviderRevision({model:revision.expected_response_model,system_fingerprint:null},revision):identity;
 const deployment=options.terra?'gpt-5.6-terra':'gpt-4.1-mini',protocol=options.terra?azureDialogueProtocol(deployment,TERRA_ENV):null;
 const candidate={candidate_id:CID,dataset_id:DATASET,replica_id:RID,owner_user_id:OWNER,status:'draft',run_state:options.collecting?'collecting':'complete',kind:'prompt_policy',target_layers:['delivery'],
  profile_version:7,calibration_version:3,base_capability_id:CAP,eval_run_id:RUN,run_commitment:runHash,dataset_source_set_hash:built.source_set_hash,
  materialization_job_id:JOB,materialization_protocol:'vyakti.private-text-materialization.v2',model_commitment:hash({protocol:'vyakti.private-text-materialization.v2',name:'azure-foundry-structured-output',version:`${AZURE_DIALOGUE_API_VERSION}:${DIALOGUE_PROMPT}${protocol?':'+protocol.version:''}`,model:deployment,base_model_commitment:ENV.AZURE_CORRECTION_BASE_MODEL_COMMITMENT,revision_binding:revision}),candidate_core_hash:hash(renderPrivateCorrectionCandidate(rt,artifact).core),baseline_hash:hash(compileReplicaRuntimeCore(runtime.profile_definition,runtime.calibration_definition)),total:testRows.length*2,
  artifact_sha256:hash(artifact),materialized_artifact:hash(artifact),build_manifest_hash:hash(manifest),materialized_manifest:hash(manifest),base_model_commitment:ENV.AZURE_CORRECTION_BASE_MODEL_COMMITMENT,
  artifact,build_manifest:manifest,item_examples:testRows.flatMap(e=>['baseline','candidate'].map(role=>({feedback_id:e.feedback_id,role,session_commitment:e.session_commitment}))),identities:Array.from({length:testRows.length*2},()=>structuredClone(providerIdentity))};
 const assignments=testRows.map(e=>({example_id:e.feedback_id,state:'submitted'}));
 const observations=testRows.flatMap((e,n)=>candidateRequiredLayers('prompt_policy').map(d=>({run_commitment:runHash,example_id:e.feedback_id,session_commitment:e.session_commitment,presentation_order:n%2?'ba':'ab',assignment_hash:blindAssignmentHash(runHash,e.feedback_id,n%2?'ba':'ab'),dimension:d,position_winner:options.baselineWins?(n%2?'b':'a'):(n%2?'a':'b')})));
 const dataset={dataset_id:DATASET,replica_id:RID,owner_user_id:OWNER,status:'draft',source_set_hash:built.source_set_hash,definition:built.definition,readiness:built.readiness};
 function authority(p){
  assert.equal(p.length,21);assert.deepEqual(p.slice(0,6),[RID,OWNER,REPLICA_POLICY_VERSION,DATASET,built.source_set_hash,CAP]);
  assert.deepEqual(JSON.parse(p[6]),runtime.profile_definition);assert.deepEqual(JSON.parse(p[7]),runtime.calibration_definition);assert.deepEqual(JSON.parse(p[8]),rows);assert.deepEqual(JSON.parse(p[9]),[]);
  assert.deepEqual(p.slice(10,18),[CID,RUN,runHash,candidate.artifact_sha256,candidate.build_manifest_hash,candidate.base_model_commitment,candidate.model_commitment,candidate.baseline_hash]);assert.deepEqual(JSON.parse(p[18]),candidate.identities);assert.equal(p[19],candidate.candidate_core_hash);assert.deepEqual(JSON.parse(p[20]),candidate.item_examples);
  return !options.authorityLost;
 }
 const db=async(sql,p=[])=>{
  if(!sqlInventory.has(sha256Hex(sql)))sqlInventory.set(sha256Hex(sql),{sha256:sha256Hex(sql),sql,parameters:structuredClone(p)});
  try{
   if(sql===QUALIFICATION_RECEIPT_SQL){reads++;assert.equal(p[0],RID);assert.equal(p[2],CID);return p[1]===OWNER&&!options.incomplete?[structuredClone(candidate)]:[];}
   if(sql===OWNED_RUNTIME_CONTEXT_SQL){assert.deepEqual(p,[RID,OWNER,REPLICA_POLICY_VERSION]);return[structuredClone(runtime)];}
   if(sql===FEEDBACK_DATASET_REVIEW_SQL){assert.deepEqual(p,[RID,OWNER,REPLICA_POLICY_VERSION]);return[{capability_id:CAP,profile_version:7,calibration_version:3,feedback_rows:rows,assignments:[],saved_dataset:{dataset_id:DATASET}}];}
   if(sql===CORRECTION_DATASET_SQL){assert.deepEqual(p,[RID,OWNER,DATASET]);return[dataset];}
   if(sql.startsWith(`with authority as (${QUALIFICATION_COMPARISON_AUTHORITY_SQL}), ready as (`)){
    reconciles++;assert.ok(sql.includes('count(*)=r.assignment_count'));assert.ok(sql.includes("count(*) filter(where x.state='submitted')=count(*)"));
    if(!authority(p)||assignments.length!==testRows.length||!assignments.length||assignments.some(a=>a.state!=='submitted'))return[];
    candidate.run_state='complete';return[{eval_run_id:RUN}];
   }
   if(sql.startsWith('with authority as (')&&sql.includes('from vy_replica_candidate_qualification q')){
    assert.equal(sql.startsWith(`with authority as (${QUALIFICATION_CURRENT_AUTHORITY_SQL})`),true);assert.equal(p[21],CANDIDATE_QUALIFICATION_PROTOCOL);
    if(!authority(p.slice(0,21))||candidate.run_state!=='complete')return[];
    const binding=JSON.parse(p[22]);return records.filter(r=>hash(r.metrics.binding)===hash(binding)).slice(-1);
   }
   if(sql.startsWith('select r.run_commitment,a.example_id')){assert.deepEqual(p,[RUN,OWNER]);return structuredClone(options.noObservations?[]:observations);}
   if(sql.startsWith('with qualification_admission as (')){
    const shifted=QUALIFICATION_CURRENT_AUTHORITY_SQL.replace(/\$(\d+)/g,(_,n)=>`$${Number(n)+10}`);assert.ok(sql.startsWith(`with qualification_admission as (${shifted}), `));assert.equal(p.length,31);
    assert.deepEqual(p.slice(0,2),[CID,OWNER]);assert.equal(p[3],CANDIDATE_QUALIFICATION_PROTOCOL);assert.equal(p[9],built.source_set_hash);
    if(!authority(p.slice(10))||candidate.run_state!=='complete')return[];
    inserts++;const existing=records.find(r=>r.test_set_hash===p[4]&&r.observation_hash===p[5]);if(existing)return[existing];
    const r={qualification_id:p[2],candidate_id:CID,owner_user_id:OWNER,protocol_version:p[3],test_set_hash:p[4],observation_hash:p[5],observation_count:p[6],metrics:JSON.parse(p[7]),verdict:p[8]};records.push(r);return[r];
   }
   throw Error(`unrecognized qualification fixture SQL ${sha256Hex(sql)}`);
  }catch(e){errors.push(e);throw e;}
 };
 return{db,candidate,observations,options,records,assignments,get reconciles(){return reconciles;},get inserts(){return inserts;},get reads(){return reads;},run:(input=qualifiedInput,owner=OWNER)=>qualifyOwnedCandidate(db,owner,input),read:()=>loadOwnedCandidateQualificationReceipt(db,OWNER,qualifiedInput),check(){assert.deepEqual(errors,[]);assert.equal(JSON.stringify(runtime),initial);}};
}
let groups=0;async function test(name,run){await run();console.log(`PASS ${++groups}: ${name}`);}
await test('complete blinded owner preferences cannot qualify without independent safety evidence',async()=>{
 const f=fixture();const r=await f.run();assert.equal(r.verdict,'inconclusive');assert.equal(r.active_changed,false);assert.ok(r.checks.inconclusive.includes('fraud_policy_safety_sample_insufficient'));assert.ok(r.checks.inconclusive.includes('false_memory_safety_sample_insufficient'));
 const binding=f.records[0].metrics.binding;assert.equal(binding.candidate_id,CID);assert.equal(binding.eval_run_id,RUN);assert.equal(binding.run_commitment,runHash);assert.equal(binding.dataset_source_set_hash,built.source_set_hash);assert.deepEqual(binding.provider_identity,identity);assert.equal(binding.materialization_job_id,JOB);assert.equal(f.records[0].observation_count,testRows.length*6);
 assert.equal(f.records[0].metrics.dimensions.delivery.candidate_wins,testRows.length);f.check();
});
await test('Terra v2 qualification reconstructs the exact rate-bound model commitment with explicit absent fingerprint',async()=>{
 const saved=Object.fromEntries(Object.keys(TERRA_ENV).map(key=>[key,process.env[key]]));
 try{
  Object.assign(process.env,TERRA_ENV);const f=fixture({terra:true});const r=await f.run();
  assert.equal(r.verdict,'inconclusive');const provider=f.records[0].metrics.binding.provider_identity;
  assert.equal(provider.schema,'vyakti.azure-reported-revision.v2');assert.equal(provider.fingerprint_status,'not_provided');assert.equal(provider.system_fingerprint,null);f.check();
 }finally{for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
await test('replay returns the same persisted qualification; concurrent equivalent calls dedupe',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.run(),f.run()]);assert.equal(a.qualification_id,b.qualification_id);assert.equal(f.records.length,1);const before=f.inserts;const c=await f.run();assert.equal(c.qualification_id,a.qualification_id);assert.equal(f.inserts,before);f.check();
});
await test('client-supplied pass, safety counts and observations cannot manufacture evidence',async()=>{
 const f=fixture({noObservations:true});const r=await f.run({...qualifiedInput,verdict:'pass',observations:[{winner:'candidate'}],safety_suites:{fraud_policy:{trials:99999,candidate_failures:0,baseline_failures:0}},admission:{sql:'select true',params:[]}});
 assert.equal(r.verdict,'inconclusive');assert.equal(f.records[0].observation_count,0);assert.ok(r.checks.inconclusive.includes('delivery_sample_insufficient'));f.check();
});
await test('non-owner and incomplete comparison refuse before qualification writes',async()=>{
 for(const [f,owner] of [[fixture(),uid(99999)],[fixture({incomplete:true}),OWNER]]){await assert.rejects(()=>f.run(qualifiedInput,owner),{code:'qualification_comparison_incomplete'});assert.equal(f.inserts,0);f.check();}
});
await test('artifact, manifest, source, missing identity and cross-response revision mutations refuse',async()=>{
 for(const mutate of [c=>c.artifact.fixture='changed',c=>c.build_manifest.source_set_hash='f'.repeat(64),c=>c.materialized_artifact='f'.repeat(64),c=>c.materialized_manifest='f'.repeat(64),c=>c.materialization_protocol='vyakti.private-text-materialization.v1',c=>c.identities.pop(),c=>c.item_examples.pop(),c=>c.item_examples[0].feedback_id=train[0].feedback_id,c=>c.item_examples[0].role='candidate',c=>c.profile_version++,c=>c.calibration_version++,c=>c.base_capability_id=uid(333),c=>c.baseline_hash='f'.repeat(64),c=>c.candidate_core_hash='f'.repeat(64),c=>c.model_commitment='f'.repeat(64),c=>c.identities[0].system_fingerprint='fp_changed']){
  const f=fixture();mutate(f.candidate);await assert.rejects(()=>f.run());assert.equal(f.inserts,0);f.check();
 }
});
await test('tampered blind mapping and held-out session evidence refuse qualification',async()=>{
 for(const mutate of [o=>o.assignment_hash='f'.repeat(64),o=>o.session_commitment='f'.repeat(64),o=>o.example_id=train[0].feedback_id]){const f=fixture();mutate(f.observations[0]);await assert.rejects(()=>f.run());assert.equal(f.inserts,0);f.check();}
});
await test('authority lost after observations prevents SQL qualification admission',async()=>{
 const f=fixture();const db=async(sql,p)=>{if(sql.startsWith('with qualification_admission as ('))f.options.authorityLost=true;return f.db(sql,p);};await assert.rejects(()=>qualifyOwnedCandidate(db,OWNER,qualifiedInput),{code:'candidate_qualification_not_recorded'});assert.equal(f.records.length,0);f.check();
});
await test('a measured preference regression is fail even though safety is missing',async()=>{
 const f=fixture({baselineWins:true});const r=await f.run();assert.equal(r.verdict,'fail');assert.ok(r.checks.failures.includes('delivery_target_not_improved'));assert.equal(r.active_changed,false);f.check();
});
await test('final vote reconciles in a separate call; replay after interruption preserves the vote',async()=>{
 const assignment=uid(93001),commitment=blindAssignmentHash(runHash,testRows[0].feedback_id,'ab');
 const dimensions=candidateRequiredLayers('prompt_policy'),ratings=Object.fromEntries(dimensions.map(d=>[d,'b']));
 let saved=null,interrupt=true,reconciles=0;const events=[];
 const db=async(sql,p)=>{
  if(!sqlInventory.has(sha256Hex(sql)))sqlInventory.set(sha256Hex(sql),{sha256:sha256Hex(sql),sql,parameters:structuredClone(p)});
  if(sql.startsWith('select r.required_dimensions')){events.push('read');assert.deepEqual(p,[assignment,RID,OWNER,commitment]);return[{required_dimensions:dimensions}];}
  if(sql.startsWith('with eligible as (')){
   events.push('vote');assert.deepEqual(p.slice(0,4),[assignment,RID,OWNER,commitment]);
   assert.ok(sql.includes('select eval_run_id from submitted'));assert.ok(!sql.includes('with progress as'));
   const vote=JSON.parse(p[4]).map(({dimension,position_winner})=>({dimension,position_winner}));
   if(saved&&hash(saved)!==hash(vote))return[];
   saved=vote;return[{eval_run_id:RUN}];
  }
  if(sql.startsWith('with progress as (')){
   events.push('reconcile');assert.deepEqual(p,[RUN,RID,OWNER]);assert.ok(saved);reconciles++;
   if(interrupt){interrupt=false;throw Error('fixture reconcile transport interruption');}
   return[{completed:32,total:32,complete:true}];
  }
  throw Error(`unrecognized judgment fixture SQL ${sha256Hex(sql)}`);
 };
 const input={replica_id:RID,assignment_id:assignment,assignment_hash:commitment,ratings};
 await assert.rejects(()=>recordOwnedCandidateJudgment(db,OWNER,input),/fixture reconcile transport interruption/);
 const prior=hash(saved),result=await recordOwnedCandidateJudgment(db,OWNER,input);
 assert.deepEqual(events,['read','vote','reconcile','read','vote','reconcile']);assert.equal(hash(saved),prior);assert.equal(reconciles,2);assert.equal(result.complete,true);assert.equal(result.progress.completed,32);
 await assert.rejects(()=>recordOwnedCandidateJudgment(db,OWNER,{...input,ratings:{...ratings,delivery:'a'}}),{code:'candidate_eval_judgment_conflict'});assert.equal(reconciles,2);assert.equal(hash(saved),prior);
});
function response(){return{code:null,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},end(){return this;}};}
await test('actual HTTP wrapper rejects unauthenticated and malformed qualification before SQL',async()=>{
 for(const mode of ['unauthenticated','malformed']){
  let sqlCalls=0;const handler=createCandidateEvaluationHandler({db:async()=>{sqlCalls++;throw Error('SQL forbidden');},auth:async()=>{if(mode==='unauthenticated')throw new AuthError('auth_required');return{id:OWNER};},rate:()=>true});
  const res=response();await handler({method:'POST',headers:{},body:{op:'qualify',...qualifiedInput,...(mode==='malformed'?{candidate_id:'not-a-uuid'}:{})}},res);
  assert.equal(res.code,mode==='unauthenticated'?401:400);assert.equal(sqlCalls,0);assert.equal(res.headers['Cache-Control'],'no-store');
 }
});
await test('actual HTTP wrapper uses verified session owner and ignores forged qualification evidence',async()=>{
 const f=fixture({noObservations:true}),params=[],handler=createCandidateEvaluationHandler({db:async(sql,p)=>{params.push(p);return f.db(sql,p);},auth:async()=>({id:OWNER}),rate:()=>true});
 const fake={owner_user_id:uid(99999),owner:uid(99998),verdict:'pass',safety_suites:{fraud_policy:{trials:99999,candidate_failures:0,baseline_failures:0}},observations:[{winner:'candidate'}]};
 const res=response();await handler({method:'POST',headers:{},body:{op:'qualify',...qualifiedInput,...fake}},res);
 assert.equal(res.code,200);assert.equal(res.body.qualification.verdict,'inconclusive');assert.equal(res.body.qualification.active_changed,false);assert.equal(f.records[0].observation_count,0);assert.deepEqual(params[0],[RID,OWNER,CID]);
 const status=response();await handler({method:'POST',headers:{},body:{op:'qualification_status',...qualifiedInput,...fake}},status);
 assert.equal(status.code,200);assert.equal(status.body.qualification.qualification_id,res.body.qualification.qualification_id);assert.equal(JSON.stringify(params).includes(uid(99999)),false);f.check();
});
await test('collecting fully voted status is read-only; explicit qualify repairs once and replays receipt',async()=>{
 const f=fixture({collecting:true});
 const handler=createCandidateEvaluationHandler({db:f.db,auth:async()=>({id:OWNER}),rate:()=>true});
 const status=response();await handler({method:'POST',headers:{},body:{op:'qualification_status',...qualifiedInput}},status);
 assert.equal(status.code,200);assert.deepEqual(status.body.qualification,{available:false,active_changed:false});assert.equal(f.reconciles,0);assert.equal(f.inserts,0);assert.equal(f.candidate.run_state,'collecting');
 const result=await f.run();assert.equal(result.available,true);assert.equal(result.verdict,'inconclusive');assert.equal(f.reconciles,1);assert.equal(f.candidate.run_state,'complete');assert.equal(f.records.length,1);
 assert.equal((await f.run()).qualification_id,result.qualification_id);assert.equal(f.reconciles,1);assert.equal(f.records.length,1);f.check();
});
await test('recovery refuses lost authority, pending vote and missing assignment before any qualification record',async()=>{
 for(const mode of ['authority','pending','missing']){
  const f=fixture({collecting:true});if(mode==='authority')f.options.authorityLost=true;if(mode==='pending')f.assignments[0].state='pending';if(mode==='missing')f.assignments.pop();
  await assert.rejects(()=>f.run(),{code:'qualification_votes_incomplete_or_changed'});assert.equal(f.reconciles,1);assert.equal(f.inserts,0);assert.equal(f.records.length,0);assert.equal(f.candidate.run_state,'collecting');f.check();
 }
});
console.log(`${groups} qualification service groups passed; synthetic control flow only, no actual SQL or quality proof.`);
if(process.argv.includes('--write-sql-inventory')){const folder=new URL('../../scratchpad/qualification44-proof/',import.meta.url);mkdirSync(folder,{recursive:true});writeFileSync(new URL('sql-inventory.json',folder),JSON.stringify({schema:'vyakti.qualification44-sql-inventory.v1',scope:'Executed production SQL with synthetic fixture parameters; separate database proof required.',queries:[...sqlInventory.values()]},null,2));}
