import assert from 'node:assert/strict';
import {prepareProviderRevisionBinding,verifyProviderRevision} from '../../api/_dialogue/provider-revision.js';
import {mkdirSync,writeFileSync} from 'node:fs';
import { runOwnedCorrectionCandidate, CORRECTION_DATASET_SQL, CORRECTION_JOB_READ_SQL, CORRECTION_CURRENT_AUTHORITY_SQL } from '../../api/_replica-correction-candidate.js';
import { OWNED_RUNTIME_CONTEXT_SQL, loadOwnedRuntimeContext } from '../../api/_replica-runtime.js';
import { FEEDBACK_DATASET_REVIEW_SQL, buildFeedbackDatasetDefinition } from '../../api/_replica-feedback-dataset.js';
import { encryptTurnExemplar, exemplarTextHash } from '../../api/_replica-feedback-crypto.js';
import { renderPrivateCorrectionCandidate } from '../../api/_replica-correction-artifact.js';
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
function fixture(options={}){
  const runtime=runtimeRow(), initial=JSON.stringify(runtime), jobs=[], candidates=[], spends=[], pairReads=[], errors=[];
  const budget={budget_id:ENV.AZURE_REPLICA_BUDGET_ID,limit_microusd:1_000_000,spent_microusd:0,reserved_microusd:0,state:'active'};
  let writes=0, authorityReads=0, providerCalls=0, serial=91000;
  const dataset={dataset_id:DATASET,replica_id:RID,owner_user_id:OWNER,status:'draft',source_set_hash:built.source_set_hash,definition:built.definition,readiness:built.readiness};
  const owned=p=>p[0]===RID&&p[1]===OWNER;
  const exactJob=p=>jobs.find(j=>j.job_id===p[0]&&j.replica_id===p[1]&&j.owner_user_id===p[2]);
  function authority(p){
    authorityReads++;
    assert.deepEqual(p.slice(0,6),[RID,OWNER,REPLICA_POLICY_VERSION,DATASET,built.source_set_hash,CAP]);
    assert.deepEqual(JSON.parse(p[6]),runtime.profile_definition);assert.deepEqual(JSON.parse(p[7]),runtime.calibration_definition);
    assert.deepEqual(JSON.parse(p[8]),rows);assert.deepEqual(JSON.parse(p[9]),[]);
    return options.refuseAuthorityAt!==authorityReads;
  }
  const db=async(sql,p=[])=>{
    if(!sqlInventory.has(sha256Hex(sql)))sqlInventory.set(sha256Hex(sql),{sha256:sha256Hex(sql),sql,parameters:structuredClone(p)});
    try{
      if(sql===OWNED_RUNTIME_CONTEXT_SQL)return owned(p)?[structuredClone(runtime)]:[];
      if(sql===FEEDBACK_DATASET_REVIEW_SQL)return owned(p)?[{capability_id:CAP,profile_version:7,calibration_version:3,
        feedback_rows:rows,assignments:[],saved_dataset:{dataset_id:DATASET},checked_at:'2026-09-08T00:00:00Z'}]:[];
      if(sql===CORRECTION_DATASET_SQL)return owned(p)&&p[2]===DATASET?[dataset]:[];
      if(sql===CORRECTION_JOB_READ_SQL)return owned(p)?jobs.filter(j=>j.dataset_id===p[2]).slice(-1):[];
      if(sql.includes('select * from vy_replica_correction_candidate_job')&&sql.includes('job_id=$4::uuid'))
        return owned(p)?jobs.filter(j=>j.dataset_id===p[2]&&j.job_id===p[3]):[];
      if(sql===CORRECTION_CURRENT_AUTHORITY_SQL)return authority(p)?[{dataset_id:DATASET,capability_id:CAP}]:[];
      if(sql.includes('select * from vy_replica_correction_candidate_job')&&sql.includes('model_commitment=$4'))
        return jobs.filter(j=>owned(p)&&j.dataset_id===p[2]&&j.model_commitment===p[3]&&j.protocol===p[4]);
      if(sql.includes('select f.feedback_id,f.turn_id')&&sql.includes('original_reply')){
        assert.equal(p[1],OWNER);pairReads.push(p[0]);
        const row=rows.find(r=>r.feedback_id===p[0]);assert.ok(row&&encrypted.has(p[0]));
        return[{...row,replica_id:RID,owner_user_id:OWNER,original_reply:`Original response ${row.feedback_id}`,
          reason_codes:['wrong_wording'],...encrypted.get(p[0])}];
      }
      if(sql.startsWith('insert into vy_replica_correction_candidate_job')){
        assert.equal(owned(p),true);assert.equal(p[2],DATASET);assert.equal(p[6],built.source_set_hash);
        if(jobs.some(j=>j.dataset_id===p[2]&&j.model_commitment===p[5]&&j.protocol===p[4]))return[];
        writes++;const job={job_id:p[3],dataset_id:p[2],replica_id:p[0],owner_user_id:p[1],protocol:p[4],model_commitment:p[5],source_set_hash:p[6],state:'preparing'};
        jobs.push(job);return[{...job}];
      }
      if(sql.includes('insert into vy_provider_budget')){writes++;return[{...budget}];}
      if(sql.includes('insert into vy_provider_spend')){
        writes++;assert.equal(p[0],budget.budget_id);assert.equal(p[2],'claim_extraction');assert.equal(p[9],1200);
        assert.ok(budget.spent_microusd+budget.reserved_microusd+p[10]<=budget.limit_microusd);
        const spend={reservation_id:uid(++serial),budget_id:p[0],request_hash:p[7],reserved_microusd:p[10],state:'reserved'};
        spends.push(spend);budget.reserved_microusd+=p[10];return[{...spend}];
      }
      if(sql.includes('update vy_provider_spend')){
        writes++;const spend=spends.find(s=>s.reservation_id===p[0]&&s.budget_id===p[1]&&s.request_hash===p[2]);assert.ok(spend);
        if(sql.includes("set state='in_flight'")){assert.equal(spend.state,'reserved');spend.state='in_flight';return[{...spend}];}
        if(sql.includes("set state='settled'")){assert.ok(['in_flight','reconcile_required'].includes(spend.state));
          spend.state='settled';spend.actual_input_units=p[3];spend.actual_output_units=p[4];spend.actual_microusd=p[5];
          budget.spent_microusd+=p[5];budget.reserved_microusd-=spend.reserved_microusd;return[{...budget}];}
        if(sql.includes("set state='released'")){assert.ok(['reserved','in_flight'].includes(spend.state));spend.state='released';budget.reserved_microusd-=spend.reserved_microusd;return[{...budget}];}
        if(sql.includes("set state='reconcile_required'")){assert.equal(spend.state,'in_flight');spend.state='reconcile_required';return[];}
      }
      if(sql.includes('insert into vy_replica_candidate')){
        assert.equal(sql.startsWith('with candidate_admission as ('),true);assert.equal(p.length,20);
        if(!authority(p.slice(10)))return[];
        writes++;assert.deepEqual(p.slice(0,2),[RID,OWNER]);assert.equal(p[3],DATASET);assert.equal(p[4],CAP);
        const candidate={candidate_id:p[2],dataset_id:p[3],replica_id:p[0],owner_user_id:p[1],base_capability_id:p[4],kind:p[5],target_layers:p[6],artifact_sha256:p[7],base_model_commitment:p[8],build_manifest_hash:p[9],status:'draft'};
        candidates.push(candidate);return[{...candidate}];
      }
      if(sql.includes('update vy_replica_correction_candidate_job')){
        const gated=sql.startsWith('with authority as (');
        if(gated&&!authority(p.slice(0,10)))return[];
        const job=gated?jobs.find(j=>j.job_id===p[10]&&owned(p)):exactJob(p);assert.ok(job);writes++;
        if(sql.includes("set state='running'")){assert.equal(job.state,'preparing');job.state='running';job.request_hash=p[11];job.reservation_id=p[12];}
        else if(sql.includes("set state='response_recorded'")){assert.equal(job.state,'running');job.state='response_recorded';job.proposal=p[3]?JSON.parse(p[3]):null;job.usage=JSON.parse(p[4]);}
        else if(sql.includes('set artifact=')){assert.equal(job.state,'response_recorded');job.artifact=JSON.parse(p[11]);job.artifact_sha256=p[12];job.build_manifest=JSON.parse(p[13]);job.build_manifest_hash=p[14];}
        else if(sql.includes('set candidate_id=')){assert.equal(job.state,'response_recorded');const candidate=candidates.find(c=>c.candidate_id===p[11]&&c.dataset_id===job.dataset_id);assert.ok(candidate);assert.equal(candidate.artifact_sha256,job.artifact_sha256);job.candidate_id=p[11];job.state='draft';}
        else if(sql.includes('set state=$4')){assert.ok(!['retired','draft','abstained'].includes(job.state));job.state=p[3];job.failure_code=p[4];}
        else throw new Error('unrecognized job mutation');
        return[{job_id:job.job_id}];
      }
      throw new Error(`unrecognized fixture SQL: ${sql.slice(0,100)}`);
    }catch(error){errors.push(error);throw error;}
  };
  const revision=options.strict?prepareProviderRevisionBinding({expectedResponseModel:'gpt-4.1-mini-2025-04-14',endpoint:'https://raghavsharma1729-compan-resource.services.ai.azure.com',deployment:'gpt-4.1-mini',baselineSnapshotHash:ENV.AZURE_CORRECTION_BASE_MODEL_COMMITMENT}):null;
  function adapter(model='fixture-model') {return{...(revision?{revision_binding:revision}:{}),family:'claim_extraction',name:'azure-correction-strategy',version:CORRECTION_REQUEST_SCHEMA,model,
    billing:{meter:'azure_foundry_tokens',max_output_tokens:1200},async generate({plan}){
      providerCalls++;assert.equal(plan.dispatch_allowed,false);
      const evidence=JSON.parse(plan.request.messages[1].content).evidence;
      assert.deepEqual(new Set(evidence.map(e=>e.feedback_id)),new Set(train.map(e=>e.feedback_id)));
      for(const item of built.definition.examples.filter(e=>e.split!=='train')){
        assert.equal(pairReads.includes(item.feedback_id),false);
        if(plaintext.has(item.feedback_id))assert.equal(JSON.stringify(plan.request).includes(plaintext.get(item.feedback_id)),false);
      }
      if(options.providerError)throw new Error('fixture transport outcome unknown');
      if(options.measuredRefusal)throw Object.assign(new Error('correction_azure_output_invalid'),{
        code:'correction_azure_output_invalid',measured_usage:{input_tokens:100,output_tokens:25}});
      const output=proposed();
      // Distinct policy avoids the existing same-artifact registry dedupe;
      // this case isolates exact job lookup across model commitments.
      if(model==='model-b')output.selections[0].strategy_id='reflective_arc';
      return{...(revision&&!options.missingIdentity?{provider_identity:verifyProviderRevision({model:'gpt-4.1-mini-2025-04-14',system_fingerprint:'fp_fixture47'},revision)}:{}),output:options.invalidProposal?{selections:[{strategy_id:'invented',supporting_feedback_ids:support}]}:output,usage:{input_tokens:100,output_tokens:25}};
    }};}
  return{db,adapter,jobs,candidates,spends,budget,pairReads,errors,run:(model='fixture-model',owner=OWNER)=>runOwnedCorrectionCandidate(db,owner,input,{adapter:adapter(model),env:ENV}),
    get writes(){return writes;},get providerCalls(){return providerCalls;},assertUnchanged(){assert.equal(JSON.stringify(runtime),initial);assert.deepEqual(errors,[]);}};
}
let groups=0;
async function test(name,run){await run();console.log(`PASS ${++groups}: ${name}`);}
const refused=f=>assert.rejects(f,{code:'correction_candidate_not_completed'});
await test('real worker registers a renderable private draft without changing active person',async()=>{
  const f=fixture(),result=await f.run();assert.equal(result.state,'draft');assert.equal(result.active_changed,false);assert.equal(f.providerCalls,1);
  assert.equal(f.candidates.length,1);assert.equal(f.spends[0].state,'settled');assert.equal(f.budget.reserved_microusd,0);
  const job=f.jobs[0];assert.equal(hash(job.artifact),job.artifact_sha256);assert.equal(hash(job.build_manifest),job.build_manifest_hash);
  const runtime=await loadOwnedRuntimeContext(f.db,OWNER,RID),rendered=renderPrivateCorrectionCandidate(runtime,job.artifact);
  assert.equal(rendered.runtime_eligible,false);assert.match(rendered.core,/Experimental candidate behavior shapes/);assert.equal(job.artifact.owner_approved,false);
  assert.equal(new Set(f.pairReads).size,32);f.assertUnchanged();
});
await test('ambiguous model error holds funds and replay does not dispatch again',async()=>{
  const f=fixture({providerError:true});await refused(()=>f.run());assert.equal(f.jobs[0].state,'unknown');assert.equal(f.spends[0].state,'reconcile_required');
  assert.ok(f.budget.reserved_microusd>0);const result=await f.run();assert.equal(result.job_id,f.jobs[0].job_id);assert.equal(f.providerCalls,1);assert.equal(f.candidates.length,0);f.assertUnchanged();
});
await test('adapter refusal retains measured usage and settles without another request',async()=>{
  const f=fixture({measuredRefusal:true});await refused(()=>f.run());assert.equal(f.jobs[0].state,'failed');
  assert.deepEqual(f.jobs[0].usage,{input_tokens:100,output_tokens:25});assert.equal(f.spends[0].state,'settled');
  await f.run();assert.equal(f.providerCalls,1);assert.equal(f.candidates.length,0);f.assertUnchanged();
});
await test('semantic refusal retains measured usage and settles before failing proposal',async()=>{
  const f=fixture({invalidProposal:true});await refused(()=>f.run());assert.equal(f.jobs[0].state,'failed');
  assert.deepEqual(f.jobs[0].usage,{input_tokens:100,output_tokens:25});assert.equal(f.spends[0].state,'settled');assert.equal(f.spends[0].actual_input_units,100);
  assert.equal(f.budget.reserved_microusd,0);assert.equal(f.budget.spent_microusd,80);await f.run();assert.equal(f.providerCalls,1);assert.equal(f.candidates.length,0);f.assertUnchanged();
});
await test('authority loss at atomic admission and final predispatch read prevents provider call',async()=>{
  for(const refuseAuthorityAt of [1,2]){const f=fixture({refuseAuthorityAt});await refused(()=>f.run());
    assert.equal(f.providerCalls,0);assert.equal(f.spends[0].state,'released');assert.equal(f.budget.reserved_microusd,0);assert.equal(f.candidates.length,0);f.assertUnchanged();}
});
await test('authority loss at candidate admission refuses registration after accounting',async()=>{
  const f=fixture({refuseAuthorityAt:4});await refused(()=>f.run());assert.equal(f.providerCalls,1);assert.equal(f.candidates.length,0);
  assert.equal(f.spends[0].state,'settled');assert.equal(f.jobs[0].state,'failed');f.assertUnchanged();
});
await test('same model replay returns exact job after another model made a later job',async()=>{
  const f=fixture(),a=await f.run('model-a'),b=await f.run('model-b'),again=await f.run('model-a');
  assert.notEqual(a.job_id,b.job_id);assert.equal(again.job_id,a.job_id);assert.equal(f.providerCalls,2);assert.equal(f.spends.length,2);f.assertUnchanged();
});
await test('foreign owner cannot write, read private pairs, or call provider',async()=>{
  const f=fixture();await assert.rejects(()=>f.run('fixture-model',uid(99999)),{code:'correction_candidate_runtime_unavailable'});
  assert.equal(f.writes,0);assert.equal(f.pairReads.length,0);assert.equal(f.providerCalls,0);f.assertUnchanged();
});
await test('strict correction persists revision in hash-bound manifest; missing identity spends but cannot register',async()=>{
  const good=fixture({strict:true});await good.run('gpt-4.1-mini');
  assert.equal(good.jobs[0].build_manifest.provider_identity.response_model,'gpt-4.1-mini-2025-04-14');
  assert.equal(good.jobs[0].build_manifest.provider_revision_binding.baseline_snapshot_hash,ENV.AZURE_CORRECTION_BASE_MODEL_COMMITMENT);
  assert.equal(hash(good.jobs[0].build_manifest),good.jobs[0].build_manifest_hash);good.assertUnchanged();
  const bad=fixture({strict:true,missingIdentity:true});await refused(()=>bad.run('gpt-4.1-mini'));
  assert.equal(bad.spends[0].state,'settled');assert.equal(bad.candidates.length,0);assert.equal(bad.jobs[0].state,'failed');
  await bad.run('gpt-4.1-mini');assert.equal(bad.providerCalls,1);bad.assertUnchanged();
});
await test('strict configuration requires adapter binding before any database or provider action',async()=>{
  const f=fixture();await assert.rejects(()=>runOwnedCorrectionCandidate(f.db,OWNER,input,{adapter:f.adapter(),
    env:{...ENV,AZURE_FOUNDRY_EXPECTED_RESPONSE_MODEL:'gpt-4.1-mini-2025-04-14'}}),{code:'correction_candidate_provider_binding_required'});
  assert.equal(f.writes,0);assert.equal(f.providerCalls,0);
});
console.log(`${groups} correction candidate worker groups passed; offline control flow only.`);
if(process.argv.includes('--write-sql-inventory')){
 const folder=new URL('../../scratchpad/correction37-proof/',import.meta.url);mkdirSync(folder,{recursive:true});
 writeFileSync(new URL('sql-inventory.json',folder),JSON.stringify({schema:'vyakti.correction37-sql-inventory.v1',
  scope:'Exact executed production SQL shapes with synthetic fixture parameters. No SQL parser/database proof.',
  queries:[...sqlInventory.values()]},null,2));
 console.log(`Wrote ${sqlInventory.size} synthetic-parameter SQL shapes for separate parser review.`);
}
