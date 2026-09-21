import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import { runOwnedCorrectionCandidate, CORRECTION_DATASET_SQL, CORRECTION_JOB_READ_SQL, CORRECTION_CURRENT_AUTHORITY_SQL } from '../../api/_replica-correction-candidate.js';
import { OWNED_RUNTIME_CONTEXT_SQL, loadOwnedRuntimeContext, compileReplicaRuntimeCore } from '../../api/_replica-runtime.js';
import { FEEDBACK_DATASET_REVIEW_SQL, buildFeedbackDatasetDefinition } from '../../api/_replica-feedback-dataset.js';
import { encryptTurnExemplar, exemplarTextHash } from '../../api/_replica-feedback-crypto.js';
import { renderPrivateCorrectionCandidate, buildPrivateCorrectionArtifact } from '../../api/_replica-correction-artifact.js';
import { CORRECTION_REQUEST_SCHEMA } from '../../api/_replica-correction-request.js';
import { REPLICA_POLICY_VERSION } from '../../api/_replica.js';
import { canonicalJson, sha256Hex } from '../../api/_provenance/contracts.js';

// Executes the real worker, crypto, dataset builder, renderer, registration and
// meter with a stateful SQL fixture. It does not parse SQL, prove DB isolation,
// call Azure, or establish candidate quality. Unrecognized SQL always fails.
const uid = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RID=uid(90001), OWNER=uid(90002), CAP=uid(90003), DATASET=uid(90004);
const ENV={ REPLICA_EVAL_KEK_ID:'fixture-eval-v1', REPLICA_EVAL_KEK_B64:Buffer.alloc(32,9).toString('base64'), REPLICA_FEEDBACK_KEK_ID:'fixture-kek-v1', REPLICA_FEEDBACK_KEK_B64:Buffer.alloc(32,7).toString('base64'),
  AZURE_CORRECTION_BASE_MODEL_COMMITMENT:'a'.repeat(64), AZURE_REPLICA_BUDGET_ID:'fixture-correction',
  AZURE_REPLICA_APP_BUDGET_USD:'1', AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS:'0.4', AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS:'1.6' };
const hash=value=>sha256Hex(canonicalJson(value));
const sqlInventory=new Map();
const rows=[], encrypted=new Map(), plaintext=new Map();
let index=0;
for(let session=1;session<=12;session++) for(let item=0;item<16;item++) {
  const n=++index, learner_input=`Learner question ${n}: coefficient aur subscript kaise alag rakhen?`, correction=`Private correction ${n}: pehle ek chhoti observation.`;
  const row={feedback_id:uid(n),turn_id:uid(20000+n),session_id:uid(10000+session),revision:1,
    profile_version:7,calibration_version:3,capability_id:CAP,
    ratings:{wording:item<4?'off':'exact',behavior:item<4?'close':'exact',relationship:item<4?'close':'exact',memory:item<4?'close':'exact',delivery:item<4?'close':'exact'},
    ratings_hash:sha256Hex(`rating ${n}`),prompt_hash:hash({learner_input}),learner_input_sha256:sha256Hex(learner_input),learner_input,response_hash:sha256Hex(`response ${n}`),
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
  profile_status:'approved',profile_definition:{identity:{self_name:'Asha'},speech:{languages:['Hinglish']},behavior:{turn_shape:'brief'},knowledge:[
   ...Array.from({length:12},(_,i)=>({key:`geometry_${i}`,statement:`Geometry lesson ${i} concerns triangles and angles.`})),
   {key:'chemistry_sn1_rate_law',statement:'For an SN1 reaction, rate depends only on substrate concentration.'}]},
  calibration_status:'approved',calibration_definition:{schema:'vyakti.calibration.v1',builder:'calibration-builder/v1',strategies:[]},
  consent_id:uid(90008),consent_scope:'inference',consent_policy:REPLICA_POLICY_VERSION,consent_expires_at:'2031-08-24T00:00:00Z'};}

import {startOwnedMaterialization,advanceOwnedMaterialization,readOwnedMaterialization,MATERIALIZATION_AUTHORITY_SQL,MATERIALIZATION_QUESTION_SQL,MATERIALIZATION_STATUS_SQL,heldOutExamples,materializationQuestionCores} from '../../api/_replica-candidate-materializer.js';
import {CALIBRATION_SCENARIOS} from '../../api/_replica-calibration.js';
import {prepareProviderRevisionBinding,verifyProviderRevision} from '../../api/_dialogue/provider-revision.js';
import {decryptEvaluationText} from '../../api/_replica-candidate-eval-crypto.js';
import {compileDialoguePrompt} from '../../api/_dialogue/contracts.js';
const CANDIDATE=uid(90009),CORRECTION=uid(90010);
const held=heldOutExamples(built.definition),materialInput={...input,candidate_id:CANDIDATE};
const revisionBinding=prepareProviderRevisionBinding({expectedResponseModel:'gpt-4.1-mini-2025-04-14',endpoint:'https://raghavsharma1729-compan-resource.services.ai.azure.com/',deployment:'gpt-4.1-mini',baselineSnapshotHash:ENV.AZURE_CORRECTION_BASE_MODEL_COMMITMENT});
async function fixture(options={}){
 const runtime=runtimeRow(),initial=JSON.stringify(runtime),jobs=[],items=[],spends=[],packs=[],errors=[];
 let calls=0,serial=95000,authorityReads=0;
 const budget={budget_id:ENV.AZURE_REPLICA_BUDGET_ID,limit_microusd:1_000_000,spent_microusd:0,reserved_microusd:0,state:'active'};
 const dataset={dataset_id:DATASET,replica_id:RID,owner_user_id:OWNER,status:'draft',source_set_hash:built.source_set_hash,definition:built.definition,readiness:built.readiness};
 const owned=p=>p[0]===RID&&p[1]===OWNER;
 let candidate,correction,candidateCoreHash;
 function authority(p){
  authorityReads++;assert.deepEqual(p.slice(0,6),[RID,OWNER,REPLICA_POLICY_VERSION,DATASET,built.source_set_hash,CAP]);
  assert.deepEqual(JSON.parse(p[6]),runtime.profile_definition);assert.deepEqual(JSON.parse(p[7]),runtime.calibration_definition);
  assert.deepEqual(JSON.parse(p[8]),rows);assert.deepEqual(JSON.parse(p[9]),[]);
  assert.deepEqual(p.slice(10,15),[CANDIDATE,candidate.artifact_sha256,candidate.build_manifest_hash,candidate.base_model_commitment,CORRECTION]);
  return !options.erased&&options.refuseAuthorityAt!==authorityReads;
 }
 const db=async(sql,p=[])=>{
  if(!sqlInventory.has(sha256Hex(sql)))sqlInventory.set(sha256Hex(sql),{sha256:sha256Hex(sql),sql,parameters:structuredClone(p)});
  try{
   if(sql===OWNED_RUNTIME_CONTEXT_SQL)return owned(p)?[structuredClone(runtime)]:[];
   if(sql===FEEDBACK_DATASET_REVIEW_SQL)return owned(p)?[{capability_id:CAP,profile_version:7,calibration_version:3,feedback_rows:rows,assignments:[],saved_dataset:{dataset_id:DATASET}}]:[];
   if(sql===CORRECTION_DATASET_SQL)return owned(p)&&p[2]===DATASET?[dataset]:[];
   if(sql===MATERIALIZATION_STATUS_SQL){assert.deepEqual(p,[RID,OWNER,DATASET,CANDIDATE]);return jobs.map(j=>({...j,present:items.length,completed:items.filter(i=>i.state==='complete').length}));}
   if(sql===MATERIALIZATION_QUESTION_SQL){assert.deepEqual(p.slice(1,3),[RID,OWNER]);const e=held.find(e=>e.feedback_id===p[0]);assert.ok(e);assert.deepEqual(p.slice(3),[e.revision,e.response_hash,e.ratings_hash,e.correction_hash]);const r=rows.find(r=>r.feedback_id===e.feedback_id);return options.missingQuestion?[]:[{content:`Held SN1 question ${e.feedback_id}?`,turn_id:e.turn_id,session_id:r.session_id}];}
   if(sql.startsWith('select c.*,d.source_set_hash')){assert.deepEqual(p,[CANDIDATE,DATASET,RID,OWNER]);return[candidate];}
   if(sql.startsWith('select j.* from vy_replica_correction_candidate_job')){assert.deepEqual(p,[CANDIDATE,DATASET,RID,OWNER]);return[correction];}
   if(sql===MATERIALIZATION_AUTHORITY_SQL)return authority(p)?[{dataset_id:DATASET,capability_id:CAP,candidate_id:CANDIDATE}]:[];
   if(sql.includes('insert into vy_provider_budget'))return[{...budget}];
   if(sql.includes('insert into vy_provider_spend')){
    assert.equal(p[0],budget.budget_id);assert.equal(p[2],'dialogue');assert.equal(p[9],700);
    assert.ok(!spends.some(s=>s.request_hash===p[7]));assert.ok(budget.spent_microusd+budget.reserved_microusd+p[10]<=budget.limit_microusd);
    const s={reservation_id:uid(++serial),budget_id:p[0],request_hash:p[7],reserved_microusd:p[10],state:'reserved'};spends.push(s);budget.reserved_microusd+=p[10];return[{...s}];
   }
   if(sql.includes('update vy_provider_spend')){
    const s=spends.find(s=>s.reservation_id===p[0]&&s.budget_id===p[1]&&s.request_hash===p[2]);assert.ok(s);
    if(sql.includes("set state='in_flight'")){assert.equal(s.state,'reserved');s.state='in_flight';return[{...s}];}
    if(sql.includes("set state='settled'")){assert.ok(['in_flight','reconcile_required'].includes(s.state));s.state='settled';s.actual_input_units=p[3];s.actual_output_units=p[4];s.actual_microusd=p[5];budget.spent_microusd+=p[5];budget.reserved_microusd-=s.reserved_microusd;return[{...budget}];}
    if(sql.includes("set state='released'")){assert.ok(['reserved','in_flight'].includes(s.state));s.state='released';budget.reserved_microusd-=s.reserved_microusd;return[{...budget}];}
    if(sql.includes("set state='reconcile_required'")){assert.equal(s.state,'in_flight');s.state='reconcile_required';return[];}
   }
   if(sql.startsWith('with materializer_admission as (')){
    assert.equal(p.length,27);if(!authority(p.slice(12))||options.refusePackage)return[];
    assert.deepEqual(p.slice(0,4),[OWNER,CANDIDATE,DATASET,RID]);assert.equal(p[6],built.source_set_hash);
    const assignments=JSON.parse(p[10]),assets=JSON.parse(p[11]);assert.equal(assignments.length,held.length);assert.equal(assets.length,held.length*3);
    const pack={eval_run_id:p[4],assignments,assets};packs.push(pack);return[{eval_run_id:p[4],state:'collecting',assignment_count:p[9]}];
   }
   if(sql.startsWith('with authority as (')){
    if(!authority(p.slice(0,15)))return[];
    if(sql.includes('insert into vy_replica_candidate_materialization\n')){
     assert.equal(p.length,23);assert.equal(p[22],candidateCoreHash);
     if(jobs.length)return[];
     const j={job_id:p[15],replica_id:RID,owner_user_id:OWNER,dataset_id:DATASET,candidate_id:CANDIDATE,protocol:p[16],model_commitment:p[17],source_set_hash:built.source_set_hash,baseline_hash:p[18],artifact_sha256:candidate.artifact_sha256,manifest_hash:candidate.build_manifest_hash,blind_seed:p[19],total:p[20],state:'preparing',candidate_core_hash:p[22]};jobs.push(j);
     items.push(...JSON.parse(p[21]).map(i=>({...i,job_id:j.job_id,replica_id:RID,owner_user_id:OWNER,state:'pending'})));return items.map(i=>({item_id:i.item_id}));
    }
    const j=jobs[0];assert.ok(j);
    if(sql.includes("j set state='working'")){
     assert.deepEqual(p.slice(15),[j.protocol,j.model_commitment,j.baseline_hash,candidateCoreHash]);
     // Emulate the persisted-row equality, including SQL NULL refusing equality.
     // The supplied hash is independently rendered, never copied from this row.
     assert.ok(sql.includes('j.candidate_core_hash=$19'));
     if(j.state!=='preparing'||j.candidate_core_hash!==p[18])return[];
     assert.ok(sql.includes('intact.replica_id=j.replica_id and intact.owner_user_id=j.owner_user_id)=j.total'));
     if(items.filter(i=>i.job_id===j.job_id&&i.replica_id===j.replica_id&&i.owner_user_id===j.owner_user_id).length!==j.total)return[];
     j.state='working';return[{...j}];
    }
    if(sql.includes('update vy_replica_candidate_materialization_item i')){
     const i=items.find(i=>i.item_id===p[15]&&i.job_id===p[16]);assert.ok(i);
     if(sql.includes("set state='running'")){assert.equal(i.state,'claimed');i.state='running';i.reservation_id=p[17];return[{item_id:i.item_id}];}
     if(sql.includes("set state='complete'")){assert.equal(i.state,'response_recorded');i.state='complete';i.output_asset=JSON.parse(p[17]);return[{item_id:i.item_id}];}
    }
    assert.equal(p[15],j.job_id);
    if(sql.includes("set state='preparing'")){assert.equal(j.state,'working');j.state='preparing';return[];}
    if(sql.includes("set state='packing'")){assert.equal(p.length,18);assert.equal(p[17],candidateCoreHash);assert.ok(sql.includes('j.candidate_core_hash=$18'));if(j.state!=='working'||j.candidate_core_hash!==p[17])return[];j.state='packing';j.package=JSON.parse(p[16]);return[{job_id:j.job_id}];}
    if(sql.includes("set state='ready'")){assert.equal(p.length,18);assert.equal(p[17],candidateCoreHash);assert.ok(sql.includes('j.candidate_core_hash=$18'));if(j.state!=='packing'||j.candidate_core_hash!==p[17]||j.package.eval_run_id!==p[16])return[];j.state='ready';return[{job_id:j.job_id}];}
   }
   if(sql.startsWith('select * from vy_replica_candidate_materialization_item')){assert.deepEqual(p,[jobs[0].job_id,RID,OWNER]);return structuredClone(items);}
   if(sql.startsWith('select provider_identity from vy_replica_candidate_materialization_item')){assert.deepEqual(p,[jobs[0].job_id,RID,OWNER]);return items.filter(i=>i.state==='complete').slice(0,1);}
   if(sql.startsWith('update vy_replica_candidate_materialization_item')){
    if(sql.includes("set state='claimed'")){assert.deepEqual(p,[jobs[0].job_id,RID,OWNER]);const i=items.find(i=>i.state==='pending');if(!i)return[];i.state='claimed';return[{...i}];}
    const i=items.find(i=>i.item_id===p[0]&&i.job_id===p[1]&&i.owner_user_id===p[2]);assert.ok(i);
    if(sql.includes("set state='response_recorded'")){assert.equal(i.state,'running');i.state='response_recorded';i.usage=JSON.parse(p[3]);i.provider_identity=JSON.parse(p[4]);return[{item_id:i.item_id}];}
    if(sql.includes('set usage=')){i.usage=JSON.parse(p[3]);return[];}
    if(sql.includes('set state=$4')){assert.notEqual(i.state,'complete');i.state=p[3];return[];}
   }
   if(sql.startsWith('update vy_replica_candidate_materialization set state=$4')){assert.deepEqual(p.slice(0,3),[jobs[0].job_id,RID,OWNER]);jobs[0].state=p[3];return[];}
   throw Error(`unrecognized fixture SQL ${sha256Hex(sql)}`);
  }catch(e){errors.push(e);throw e;}
 };
 const loaded=await loadOwnedRuntimeContext(db,OWNER,RID),scenario=CALIBRATION_SCENARIOS.find(s=>[s.left.id,s.right.id].includes('compact_observation'));
 assert.ok(scenario);
 const art=buildPrivateCorrectionArtifact(loaded,{status:'proposed',owner_approved:false,runtime_eligible:false,source_set_hash:built.source_set_hash,selections:[{scenario_id:scenario.scenario_id,strategy_id:'compact_observation'}]});
 candidateCoreHash=hash(renderPrivateCorrectionCandidate(loaded,art.artifact).core);
 const manifest={artifact_sha256:art.artifact_sha256,base_model_commitment:ENV.AZURE_CORRECTION_BASE_MODEL_COMMITMENT,source_set_hash:built.source_set_hash};
 candidate={candidate_id:CANDIDATE,dataset_id:DATASET,replica_id:RID,owner_user_id:OWNER,kind:'prompt_policy',status:'draft',artifact_sha256:art.artifact_sha256,build_manifest_hash:hash(manifest),base_model_commitment:ENV.AZURE_CORRECTION_BASE_MODEL_COMMITMENT,dataset_source_set_hash:built.source_set_hash};
 correction={job_id:CORRECTION,candidate_id:CANDIDATE,artifact:art.artifact,build_manifest:manifest,state:'draft'};
 const adapter={family:'dialogue',name:'azure-foundry-structured-output',version:'fixture-v1',model:'gpt-4.1-mini',revision_binding:revisionBinding,billing:{meter:'azure_foundry_tokens',max_output_tokens:700,
  ...(options.terraRates?{budget_env:{AZURE_REPLICA_BUDGET_ID:ENV.AZURE_REPLICA_BUDGET_ID,AZURE_REPLICA_APP_BUDGET_USD:'1',AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS:'2',AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS:'12'}}:{})},async generate({prompt}){
  assert.ok(prompt.messages[0].content.includes("Turn language precedence:") && prompt.messages[0].content.includes("Learner diagnosis shape:"));
  calls++;const text=JSON.stringify(prompt);assert.ok(!text.includes('Original response'));for(const v of plaintext.values())assert.ok(!text.includes(v));
  const message=prompt.messages.at(-1).content;assert.ok(held.some(e=>message===`Held SN1 question ${e.feedback_id}?`));
  assert.ok(prompt.messages[0].content.includes('knowledge.chemistry_sn1_rate_law: For an SN1 reaction'));
  assert.ok(!prompt.messages[0].content.includes('knowledge.geometry_11:'));
  if(options.pause)await options.pause;
  if(options.unknown)throw Error('fixture outcome unknown');
  if(options.refusal)throw Object.assign(Error('fixture refusal'),{measured_usage:{input_tokens:100,output_tokens:25}});
  const provider_identity={...verifyProviderRevision({model:revisionBinding.expected_response_model,system_fingerprint:options.changeFingerprint&&calls>1?'fp_changed':'fp_fixture'},revisionBinding)};
  if(options.badModel)provider_identity.response_model='alias';
  return{provider_identity,usage:{input_tokens:100,output_tokens:25},output:options.invalid?{reply:''}:{reply:`${text.includes('Experimental candidate behavior shapes')?'Candidate':'Baseline'} answer ${message}`,delivery:{mode:'grounded',pace:'natural',intensity:0.3,language_hint:'Hinglish',nonverbals:[]}}};
 }};
 return{options,db,jobs,items,packs,spends,budget,adapter,candidate,errors,get calls(){return calls;},get authorityReads(){return authorityReads;},start:()=>startOwnedMaterialization(db,OWNER,materialInput,{adapter,env:ENV}),advance:()=>advanceOwnedMaterialization(db,OWNER,materialInput,{adapter,env:ENV}),read:()=>readOwnedMaterialization(db,OWNER,materialInput),unchanged(){assert.equal(JSON.stringify(runtime),initial);assert.equal(candidate.status,'draft');assert.deepEqual(errors,[]);}};
}
let groups=0;
async function test(name,run){await run();console.log(`PASS ${++groups}: ${name}`);}
await test('dense paired prompts receive byte-identical whole knowledge lines under one reserved budget',async()=>{
 const exact=(prefix,ending,length=480)=>prefix+'x'.repeat(length-prefix.length-ending.length)+ending;
 const knowledge=[...Array.from({length:12},(_,i)=>({key:`geometry_${i}`,statement:`Geometry fact ${i}.`})),
  ...Array.from({length:12},(_,i)=>({key:`chemistry_sn1_${i}`,
   statement:exact(`SN1 condition ${i}. `,` Complete SN1 condition ${i}.`)}))];
 assert.ok(knowledge.every(({statement})=>statement.length<=500));
 const runtime={replica:{replica_id:RID},capability:{capability_id:CAP},personProfile:{definition:{identity:{self_name:'Asha'},knowledge}},
  calibration:{definition:{schema:'vyakti.calibration.v1',builder:'calibration-builder/v1',strategies:[]}}};
 const scenario=CALIBRATION_SCENARIOS.find(s=>[s.left.id,s.right.id].includes('compact_observation'));
 const artifact=buildPrivateCorrectionArtifact(runtime,{status:'proposed',owner_approved:false,runtime_eligible:false,
  source_set_hash:built.source_set_hash,selections:[{scenario_id:scenario.scenario_id,strategy_id:'compact_observation'}]}).artifact;
 assert.ok(renderPrivateCorrectionCandidate(runtime,artifact).core.length<=6000);
 const question='Explain the SN1 conditions';
 const cores=materializationQuestionCores({runtime,artifact},question);
 const lines=core=>core.split('\n').filter(line=>line.startsWith('knowledge.'));
 const ordinary=compileReplicaRuntimeCore(runtime.personProfile.definition,runtime.calibration.definition,question);
 assert.ok(lines(ordinary).length>lines(cores.baseline).length);
 assert.deepEqual(lines(cores.baseline),lines(cores.candidate));assert.ok(lines(cores.baseline).length>0);
 for(const line of lines(cores.baseline))assert.match(line,/Complete SN1 condition \d+\.$/);
 const baselinePrompt=compileDialoguePrompt({core:cores.baseline,message:question});
 const candidatePrompt=compileDialoguePrompt({core:cores.candidate,message:question});
 assert.deepEqual(lines(baselinePrompt.messages[0].content),lines(cores.baseline));
 assert.deepEqual(lines(candidatePrompt.messages[0].content),lines(cores.candidate));
});
await test('actual worker completes paired held-out generation, encrypted blind assets and no activation',async()=>{
 const f=await fixture();const started=await f.start();assert.equal(started.total,held.length*2);assert.ok(started.total>=60);assert.equal(f.calls,0);
 assert.equal((await f.start()).job_id,started.job_id);
 for(let i=0;i<started.total;i++){const r=await f.advance();assert.equal(r.completed,i+1);assert.equal(r.active_changed,false);}
 const ready=await f.advance();assert.equal(ready.state,'ready');assert.equal(f.calls,started.total);assert.equal(f.packs.length,1);
 assert.equal(f.spends.length,started.total);assert.ok(f.spends.every(s=>s.state==='settled'));assert.equal(f.budget.reserved_microusd,0);
 const pack=f.packs[0];
 for(const a of pack.assignments){
  const outputs={};for(const asset of pack.assets.filter(x=>x.assignment_id===a.assignment_id)){
   outputs[asset.role]=decryptEvaluationText(asset,{run_id:pack.eval_run_id,assignment_id:a.assignment_id,asset_id:asset.asset_id,replica_id:RID,owner_user_id:OWNER,example_id:a.example_id,role:asset.role,output_sha256:asset.output_sha256},ENV);
  }
  assert.equal(outputs.context,`Held SN1 question ${a.example_id}?`);
  assert.equal(outputs.a,`${a.presentation_order==='ab'?'Baseline':'Candidate'} answer ${outputs.context}`);
  assert.equal(outputs.b,`${a.presentation_order==='ab'?'Candidate':'Baseline'} answer ${outputs.context}`);
 }
 await f.advance();assert.equal(f.calls,started.total);f.unchanged();
});
await test('materializer reservation and settlement use adapter-scoped Terra rates',async()=>{
 const f=await fixture({terraRates:true});await f.start();await f.advance();
 assert.equal(f.spends[0].actual_microusd,500);assert.equal(f.budget.spent_microusd,500);f.unchanged();
});
await test('concurrent advances claim one item; held replay never repeats provider dispatch',async()=>{
 let release;const pause=new Promise(r=>release=r);const f=await fixture({pause});await f.start();const pending=f.advance();
 for(let n=0;n<100&&f.calls===0;n++)await new Promise(r=>setImmediate(r));assert.equal(f.calls,1);
 const other=await f.advance();assert.equal(other.state,'held');assert.equal(f.calls,1);release();await pending;assert.equal(f.calls,1);f.unchanged();
});
await test('unknown provider outcome holds accounting and never retries',async()=>{
 const f=await fixture({unknown:true});await f.start();await assert.rejects(()=>f.advance(),/fixture outcome unknown/);
 assert.equal((await f.read()).state,'held');assert.equal(f.spends[0].state,'reconcile_required');assert.ok(f.budget.reserved_microusd>0);
 await f.advance();await f.start();assert.equal(f.calls,1);f.unchanged();
});
await test('semantic and measured refusal settle usage before terminal refusal',async()=>{
 for(const options of [{invalid:true},{refusal:true}]){const f=await fixture(options);await f.start();await assert.rejects(()=>f.advance());assert.equal((await f.read()).state,'failed');assert.equal(f.spends[0].state,'settled');assert.equal(f.spends[0].actual_input_units,100);assert.equal(f.budget.reserved_microusd,0);await f.advance();assert.equal(f.calls,1);f.unchanged();}
});
await test('authority failure at final predispatch read refunds without calling model',async()=>{
 const f=await fixture();await f.start();f.options.refuseAuthorityAt=f.authorityReads+3;await assert.rejects(()=>f.advance(),{code:'materialization_dispatch_authority_changed'});assert.equal(f.calls,0);assert.equal(f.spends[0].state,'released');assert.equal(f.budget.reserved_microusd,0);f.unchanged();
});
await test('fingerprint drift settles second response and refuses paired package',async()=>{
 const f=await fixture({changeFingerprint:true});await f.start();await f.advance();await assert.rejects(()=>f.advance(),{code:'provider_pair_revision_mismatch'});assert.equal(f.spends[1].state,'settled');assert.equal(f.packs.length,0);f.unchanged();
});
await test('dated model identity mismatch retains measured spend',async()=>{
 const f=await fixture({badModel:true});await f.start();await assert.rejects(()=>f.advance(),{code:'provider_revision_response_model_mismatch'});assert.equal(f.spends[0].state,'settled');f.unchanged();
});
await test('missing question refuses before persistence; missing item cannot become ready',async()=>{
 const absent=await fixture({missingQuestion:true});await assert.rejects(()=>absent.start(),{code:'materialization_question_changed'});assert.equal(absent.jobs.length,0);assert.equal(absent.calls,0);absent.unchanged();
 const f=await fixture();await f.start();f.items.pop();assert.equal((await f.read()).state,'held');assert.equal((await f.read()).can_advance,false);
 // Invoke the worker: UI status alone must not be the dispatch barrier.
 assert.equal((await f.advance()).state,'held');assert.equal(f.calls,0);assert.equal(f.spends.length,0);assert.equal(f.packs.length,0);assert.equal(f.jobs[0].state,'preparing');f.unchanged();
});
for(const [label,savedHash] of [['legacy null',null],['tampered digest','f'.repeat(64)]]){
 await test(`${label} candidate core refuses resume before even the baseline item`,async()=>{
  const f=await fixture();await f.start();
  assert.match(f.jobs[0].candidate_core_hash,/^[a-f0-9]{64}$/);
  assert.notEqual(f.jobs[0].candidate_core_hash,savedHash);
  assert.equal(f.items[0].role,'baseline');assert.ok(f.items.every(i=>i.state==='pending'));
  f.jobs[0].candidate_core_hash=savedHash;
  const before=structuredClone(f.items),budgetBefore=structuredClone(f.budget);
  // Exercise the actual worker and repeat its saved-job path. A baseline prompt
  // alone does not contain the candidate delta, so prompt-hash checking alone
  // would miss this stale candidate core and spend on the first baseline item.
  if(savedHash===null){
   const heldStatus=await f.advance();assert.equal(heldStatus.state,'held');assert.equal(heldStatus.can_advance,false);
   assert.equal((await f.start()).state,'held');assert.equal((await f.advance()).state,'held');
  }else{
   await assert.rejects(()=>f.advance(),{code:'materialization_resume_authority_changed'});
   assert.equal((await f.start()).job_id,f.jobs[0].job_id);
   await assert.rejects(()=>f.advance(),{code:'materialization_resume_authority_changed'});
  }
  assert.equal(f.calls,0);assert.equal(f.spends.length,0);assert.equal(f.packs.length,0);
  assert.equal(f.jobs.length,1);assert.equal(f.jobs[0].state,'preparing');
  assert.equal(f.jobs[0].candidate_core_hash,savedHash);
  assert.deepEqual(f.items,before);assert.deepEqual(f.budget,budgetBefore);f.unchanged();
 });
}
await test('source erasure blocks further dispatch and package admission guard is authoritative',async()=>{
 const f=await fixture();await f.start();f.options.erased=true;await assert.rejects(()=>f.advance(),{code:'materialization_resume_authority_changed'});assert.equal(f.calls,0);assert.equal(f.packs.length,0);f.unchanged();
 const p=await fixture({refusePackage:true});await p.start();for(let n=0;n<p.items.length;n++)await p.advance();await assert.rejects(()=>p.advance(),{code:'candidate_eval_package_not_persisted'});assert.equal(p.packs.length,0);assert.equal((await p.read()).state,'failed');p.unchanged();
});
await test('baseline revision binding cannot be replaced by deployment alias',async()=>{
 const f=await fixture();f.adapter.revision_binding={...revisionBinding,expected_response_model:'gpt-4.1-mini'};await assert.rejects(()=>f.start());assert.equal(f.calls,0);assert.equal(f.jobs.length,0);f.unchanged();
});
console.log(`${groups} materializer worker groups passed; synthetic control flow, not SQL, provider or quality proof.`);
if(process.argv.includes('--write-sql-inventory')){
 const folder=new URL('../../scratchpad/materializer41-proof/',import.meta.url);mkdirSync(folder,{recursive:true});
 writeFileSync(new URL('sql-inventory.json',folder),JSON.stringify({schema:'vyakti.materializer41-sql-inventory.v1',scope:'Exact executed production SQL with synthetic fixture parameters; requires separate actual database proof.',queries:[...sqlInventory.values()]},null,2));
}
