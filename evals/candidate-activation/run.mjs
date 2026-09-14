import assert from 'node:assert/strict';
import {changeOwnedCandidateActivation,readOwnedCandidateActivation,ACTIVATION_CURRENT_SQL,ACTIVATION_CANDIDATE_SQL,ACTIVATION_HISTORY_SQL,ACTIVATION_ELIGIBLE_SQL,ACTIVATION_COMMIT_SQL} from '../../api/_replica-candidate-activation.js';
import {OWNED_RUNTIME_CONTEXT_SQL,OWNED_RUNTIME_REVISION_SQL,CANDIDATE_RUNTIME_REVISION_BINDING_SQL} from '../../api/_replica-runtime.js';
import {CANDIDATE_RUNTIME_BINDING_SQL} from '../../api/_replica-candidate-binding-store.js';
import {buildPrivateCorrectionArtifact,renderPrivateCorrectionCandidate} from '../../api/_replica-correction-artifact.js';
import {prepareProviderRevisionBinding,verifyProviderRevision} from '../../api/_dialogue/provider-revision.js';
import {canonicalJson,sha256Hex} from '../../api/_provenance/contracts.js';
import {REPLICA_POLICY_VERSION} from '../../api/_replica.js';

// Actual service/renderer/provider-contract code with explicit stateful SQL
// fixtures. Fixture admission is not PostgreSQL parsing or race evidence.
const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const RID=id(1),OWNER=id(2),BASE=id(3),CID=id(4),DID=id(5),QID=id(6);
const hash=v=>sha256Hex(canonicalJson(v));
function baseRow(){return{replica_id:RID,owner_user_id:OWNER,subject_person_id:id(7),agent_id:id(8),subject_mode:'self',lifecycle:'active',policy_version:REPLICA_POLICY_VERSION,
  age_verified_at:'2026-09-01T00:00:00Z',identity_verified_at:'2026-09-01T00:00:00Z',liveness_verified_at:'2026-09-01T00:00:00Z',identity_expires_at:'2031-09-01T00:00:00Z',
  agent_status:'active',capability_id:BASE,capability_state:'active',candidate_binding_required:false,runtime_policy:REPLICA_POLICY_VERSION,qualification_hash:'a'.repeat(64),
  voice_profile_id:id(9),genome_version:1,profile_version:1,calibration_version:1,provider:'fixture',provider_ref:'fixture-only',model:'fixture-only',voice_status:'ready',capabilities:{},genome_status:'approved',
  profile_status:'approved',profile_definition:{identity:{self_name:'Asha'},speech:{languages:['Hindi','Hinglish','English']},behavior:{turn_shape:'brief'}},
  calibration_status:'approved',calibration_definition:{schema:'vyakti.calibration.v1',strategies:[]},consent_id:id(10),consent_scope:'inference',consent_policy:REPLICA_POLICY_VERSION,consent_expires_at:'2031-09-01T00:00:00Z'};}
function fixture({experimental=false,withhold=false,unknownAfterCommit=false,atomicCasFailure=false,knownCasFailure=false,terra=false}={}){
 const base=baseRow(),originalBase=structuredClone(base),caps=new Map([[BASE,base]]),history=new Map(),transitions=new Map(),trace=[],errors=[];
 const casError=Object.assign(Error(knownCasFailure?'neon 400: 40001: candidate_private_selection_write_conflict':'fixture atomic activation CAS assertion'),{code:'40001'});
 const runtime={replica:{replica_id:RID},capability:{capability_id:BASE},personProfile:{definition:base.profile_definition},calibration:{definition:base.calibration_definition}};
 const built=buildPrivateCorrectionArtifact(runtime,{status:'proposed',owner_approved:false,runtime_eligible:false,source_set_hash:'b'.repeat(64),
  selections:[{scenario_id:'delivery.turn_shape',strategy_id:'compact_observation',supporting_feedback_ids:[id(21),id(22),id(23)]}]});
 const core=renderPrivateCorrectionCandidate(runtime,built.artifact).core;
 const revision=prepareProviderRevisionBinding({expectedResponseModel:terra?'gpt-5.6-terra-2026-07-09':'gpt-4.1-mini-2025-04-14',endpoint:'https://raghavsharma1729-compan-resource.services.ai.azure.com/',deployment:terra?'gpt-5.6-terra':'gpt-4.1-mini',baselineSnapshotHash:'c'.repeat(64)});
 const provider=verifyProviderRevision({model:revision.expected_response_model,system_fingerprint:terra?null:'fp_fixture1'},revision);
 const binding={schema:'vyakti.candidate-qualification-binding.v2',candidate_id:CID,dataset_id:DID,base_capability_id:BASE,
  artifact_sha256:built.artifact_sha256,build_manifest_hash:'d'.repeat(64),base_model_commitment:'c'.repeat(64),model_commitment:'e'.repeat(64),
  candidate_core_hash:hash(core),provider_identity:provider};
 const candidate={candidate_id:CID,dataset_id:DID,replica_id:RID,owner_user_id:OWNER,qualification_id:QID,
  status:experimental?'evaluating':'qualified',verdict:experimental?'inconclusive':'pass',metrics:{binding,failures:[],inconclusive:experimental?['fraud_policy_safety_sample_insufficient']:[]},
  base_capability_id:BASE,artifact:built.artifact,artifact_sha256:built.artifact_sha256,candidate_core_hash:hash(core)};
 // "active" here is the effective owner selection, never the global SQL state.
 let active=BASE,global=BASE,pointer=null,commitCalls=0,sourceValid=true;
 const publicSnapshots=new Map([[BASE,originalBase]]);
 const own=p=>p[0]===RID&&p[1]===OWNER;
 function eligible(p){
  assert.equal(p.length,6);const h=JSON.parse(p[5]);assert.equal(h.replica_id,p[0]);assert.equal(h.owner_user_id,p[1]);assert.equal(h.target_capability_id,p[3]);assert.equal(h.prior_capability_id,p[4]);
  assert.equal(h.exposure,'owner_private_text');
  if(withhold||!own(p)||p[4]!==active||!caps.has(h.target_capability_id))return null;
  if(h.action==='reset'){
   if(!pointer||h.target_capability_id!==global||!sourceValid||caps.get(global).capability_state!=='active')return null;
   assert.equal(h.selection_kind,'baseline');assert.equal(h.candidate_id,null);
  }else if(h.action==='rollback'){
   if(transitions.get(active)!==h.target_capability_id)return null;
   if(caps.get(h.target_capability_id).candidate_binding_required&&(!history.has(h.target_capability_id)||h.candidate_id!==CID))return null;
  }else{
   if(caps.get(active).candidate_binding_required||h.target_capability_id!==BASE||h.qualification_id!==candidate.qualification_id)return null;
   if(h.selection_kind==='qualified'&&(candidate.status!=='qualified'||candidate.verdict!=='pass'||candidate.metrics.inconclusive.length))return null;
   if(h.selection_kind==='experimental'&&(candidate.status!=='evaluating'||candidate.verdict!=='inconclusive'||!candidate.metrics.inconclusive.length))return null;
   if(candidate.metrics.failures.length)return null;
   assert.equal(h.core_hash,candidate.candidate_core_hash);assert.deepEqual(h.artifact_snapshot,candidate.artifact);assert.deepEqual(h.qualification_binding,candidate.metrics.binding);
  }
  assert.deepEqual(h.profile_definition,caps.get(h.target_capability_id).profile_definition);assert.deepEqual(h.calibration_definition,caps.get(h.target_capability_id).calibration_definition);
  return h;
 }
 const db=async(sql,p)=>{
  trace.push(sql);
  try{
   if(sql===ACTIVATION_CURRENT_SQL){if(!own(p))return[];const cap=caps.get(active),h=history.get(active);return[{capability_id:active,base_capability_id:global,candidate_binding_required:cap.candidate_binding_required,
    prior_capability_id:transitions.get(active)||null,candidate_id:h?.candidate_id||null,selection_kind:h?.selection_kind||null}];}
   if(sql===ACTIVATION_CANDIDATE_SQL)return own(p)&&p[2]===CID?[structuredClone(candidate)]:[];
   if(sql===OWNED_RUNTIME_CONTEXT_SQL)return own(p)&&sourceValid?[structuredClone(caps.get(global))]:[];
   if(sql===OWNED_RUNTIME_REVISION_SQL)return own(p)&&caps.has(p[3])?[structuredClone(caps.get(p[3]))]:[];
   if(sql===CANDIDATE_RUNTIME_BINDING_SQL||sql===CANDIDATE_RUNTIME_REVISION_BINDING_SQL)return own(p)&&history.has(p[2])?[structuredClone(history.get(p[2]))]:[];
   if(sql===ACTIVATION_HISTORY_SQL)return p[1]===RID&&p[2]===OWNER&&history.has(p[0])?[structuredClone(history.get(p[0]))]:[];
   if(sql===ACTIVATION_ELIGIBLE_SQL){const h=eligible(p);return h?[{new_capability_id:h.new_capability_id}]:[];}
   if(sql===ACTIVATION_COMMIT_SQL){commitCalls++;const h=eligible(p);if(!h)return[];
    // A database statement error rolls back every CTE write atomically. This
    // fixture models that boundary; it does not prove the SQL assertion works.
    if(atomicCasFailure||knownCasFailure)throw casError;
    assert.notEqual(h.new_capability_id,active);assert.notEqual(h.new_capability_id,h.target_capability_id);assert(!caps.has(h.new_capability_id));
    const next={...structuredClone(caps.get(h.target_capability_id)),capability_id:h.new_capability_id,capability_state:'private',candidate_binding_required:h.candidate_id!==null};
    caps.set(h.new_capability_id,next);transitions.set(h.new_capability_id,active);history.set(h.new_capability_id,structuredClone(h));active=h.new_capability_id;
    pointer={replica_id:RID,owner_user_id:OWNER,capability_id:active,base_capability_id:global};
    if(unknownAfterCommit)throw Object.assign(Error('fixture response lost'),{code:'ECONNRESET'});
    return[{new_capability_id:active}];
   }
   throw Error('unexpected SQL fixture statement');
  }catch(error){if(error.code!=='ECONNRESET'&&error!==casError)errors.push(error);throw error;}
 };
 const input=(op=experimental?'experiment':'activate')=>({replica_id:RID,candidate_id:CID,op,expected_capability_id:active,qualification_id:candidate.qualification_id,target_capability_id:op==='reset'?global:transitions.get(active)||BASE});
 return{db,candidate,caps,history,transitions,trace,errors,input,get active(){return active;},get pointer(){return pointer;},get commitCalls(){return commitCalls;},
  read:()=>readOwnedCandidateActivation(db,OWNER,{replica_id:RID,candidate_id:CID}),change:value=>changeOwnedCandidateActivation(db,OWNER,value||input()),
  invalidateSource(){sourceValid=false;},
  replaceGlobal(){assert.notEqual(active,global);caps.get(global).capability_state='superseded';publicSnapshots.set(global,structuredClone(caps.get(global)));
   global=id(100);const next={...structuredClone(base),capability_id:global,capability_state:'active',profile_version:2,
    profile_definition:{...structuredClone(base.profile_definition),behavior:{turn_shape:'current approved baseline'}}};
   caps.set(global,next);publicSnapshots.set(global,structuredClone(next));return global;},
  clean:()=>{assert.deepEqual(errors,[]);for(const [key,value]of publicSnapshots)assert.deepEqual(caps.get(key),value,'public capabilities must stay unchanged by private selection');
   assert.deepEqual([...caps.values()].filter(c=>c.capability_state==='active').map(c=>c.capability_id),[global]);}};
}
let count=0;
async function test(name,run){await run();console.log(`PASS ${++count}: ${name}`);}
await test('strict qualification activates a distinct immutable capability',async()=>{
 const f=fixture(),status=await f.read();assert.equal(status.can_activate,true);assert.equal(status.can_experiment,false);
 await f.change();assert.notEqual(f.active,BASE);assert.equal(f.caps.get(BASE).capability_state,'active');assert.equal(f.caps.get(f.active).capability_state,'private');assert.equal(f.caps.get(f.active).candidate_binding_required,true);
 assert.deepEqual(f.pointer,{replica_id:RID,owner_user_id:OWNER,capability_id:f.active,base_capability_id:BASE});
 assert.equal(f.history.get(f.active).selection_kind,'qualified');assert.equal(f.history.get(f.active).artifact_snapshot.owner_approved,false);assert.equal(f.commitCalls,1);f.clean();
});
await test('explicit Terra v2 qualification with reported fingerprint absence remains activatable',async()=>{
 const f=fixture({terra:true});await f.change();const stored=f.history.get(f.active);
 assert.equal(stored.provider_revision_binding.schema,'vyakti.azure-reported-revision.v2');
 assert.equal(stored.provider_revision_binding.deployment,'gpt-5.6-terra');
 assert.equal(stored.provider_identity.fingerprint_status,'not_provided');assert.equal(stored.provider_identity.system_fingerprint,null);
 assert.match(ACTIVATION_COMMIT_SQL,/gpt-5\.6-terra-2026-07-09/);assert.match(ACTIVATION_COMMIT_SQL,/jsonb_typeof/);f.clean();
});
await test('inconclusive can be experimental but never strictly qualified',async()=>{
 const f=fixture({experimental:true}),status=await f.read();assert.equal(status.can_activate,false);assert.equal(status.can_experiment,true);
 await assert.rejects(()=>f.change(f.input('activate')),{code:'candidate_qualification_not_passed'});assert.equal(f.commitCalls,0);
 await f.change();assert.equal(f.history.get(f.active).selection_kind,'experimental');assert.equal(f.candidate.verdict,'inconclusive');assert.equal(f.candidate.status,'evaluating');f.clean();
});
await test('a passed candidate cannot enter the inconclusive experimental branch',async()=>{
 const f=fixture();await assert.rejects(()=>f.change(f.input('experiment')),{code:'candidate_experiment_not_eligible'});assert.equal(f.commitCalls,0);assert.equal(f.active,BASE);f.clean();
});
await test('known failed candidate is refused for both activation kinds',async()=>{
 const f=fixture({experimental:true});f.candidate.verdict='fail';f.candidate.status='rejected';
 for(const op of ['activate','experiment'])await assert.rejects(()=>f.change(f.input(op)));
 assert.equal(f.commitCalls,0);assert.equal(f.active,BASE);f.clean();
});
await test('stale active capability and qualification receipts cause no write',async()=>{
 const f=fixture();await assert.rejects(()=>f.change({...f.input(),expected_capability_id:id(90)}),{code:'candidate_active_version_changed'});
 await assert.rejects(()=>f.change({...f.input(),qualification_id:id(91)}),{code:'candidate_qualification_changed'});assert.equal(f.commitCalls,0);f.clean();
});
await test('legacy qualification bindings remain stored but cannot activate under question-aware semantics',async()=>{
 const f=fixture();f.candidate.metrics.binding.schema='vyakti.candidate-qualification-binding.v1';
 await assert.rejects(()=>f.change(),{code:'candidate_comparison_changed'});assert.equal(f.commitCalls,0);f.clean();
 assert.match(ACTIVATION_CANDIDATE_SQL,/candidate-qualification\.v2/);
 assert.match(ACTIVATION_COMMIT_SQL,/candidate-qualification-binding\.v2/);
 assert.match(ACTIVATION_COMMIT_SQL,/private-text-materialization\.v2/);
});
await test('changed artifact and compared core are rejected before commit',async()=>{
 const artifact=fixture();artifact.candidate.artifact.profile_hash='f'.repeat(64);
 await assert.rejects(()=>artifact.change(),{code:'candidate_comparison_changed'});assert.equal(artifact.commitCalls,0);artifact.clean();
 const core=fixture();core.candidate.candidate_core_hash='f'.repeat(64);
 await assert.rejects(()=>core.change(),{code:'candidate_compared_core_changed'});assert.equal(core.commitCalls,0);core.clean();
});
await test('withheld SQL authority cannot become an accepted activation',async()=>{
 const f=fixture({withhold:true}),status=await f.read();assert.equal(status.can_activate,false);
 await assert.rejects(()=>f.change(),{code:'candidate_activation_authority_changed'});assert.equal(f.commitCalls,1);assert.equal(f.active,BASE);assert.equal(f.history.size,0);f.clean();
});
await test('rollback creates a new private baseline while public capability remains active',async()=>{
 const f=fixture({experimental:true});await f.change();const experiment=f.active;assert.equal((await f.read()).can_rollback,true);
 const statusWithoutCandidate=await readOwnedCandidateActivation(f.db,OWNER,{replica_id:RID});assert.equal(statusWithoutCandidate.can_rollback,true);
 const request=f.input('rollback');delete request.candidate_id;
 await f.change(request);assert.notEqual(f.active,BASE);assert.notEqual(f.active,experiment);assert.equal(f.caps.get(f.active).candidate_binding_required,false);
 assert.equal(f.caps.get(BASE).capability_state,'active');assert.equal(f.caps.get(experiment).capability_state,'private');assert.equal(f.caps.get(f.active).capability_state,'private');
 assert.equal(f.pointer.base_capability_id,BASE);assert.equal(f.pointer.capability_id,f.active);assert.equal(f.history.get(f.active).selection_kind,'baseline');assert.equal(f.history.get(f.active).target_capability_id,BASE);assert.equal(f.transitions.get(f.active),experiment);f.clean();
});
await test('wrong owner cannot inspect current capability or attempt commit',async()=>{
 const f=fixture(),status=await readOwnedCandidateActivation(f.db,id(99),{replica_id:RID,candidate_id:CID});assert.equal(status.active_capability_id,null);
 await assert.rejects(()=>changeOwnedCandidateActivation(f.db,id(99),f.input()),{code:'candidate_active_version_changed'});assert.equal(f.commitCalls,0);f.clean();
});
await test('lost write response is not retried; replay with old capability refuses',async()=>{
 const f=fixture({unknownAfterCommit:true}),request=f.input();await assert.rejects(()=>f.change(request),{code:'ECONNRESET'});
 assert.equal(f.commitCalls,1);assert.notEqual(f.active,BASE);await assert.rejects(()=>f.change(request),{code:'candidate_active_version_changed'});
 assert.equal(f.commitCalls,1);assert.equal((await f.read()).active_capability_id,f.active);f.clean();
});
await test('atomic CAS assertion propagates once without mutation or service retry',async()=>{
 const f=fixture({atomicCasFailure:true}),beforeCaps=structuredClone([...f.caps]),beforePointer=f.pointer;
 await assert.rejects(()=>f.change(),{code:'40001',message:'fixture atomic activation CAS assertion'});
 assert.equal(f.commitCalls,1);assert.equal(f.trace.filter(sql=>sql===ACTIVATION_COMMIT_SQL).length,1);
 assert.equal(f.active,BASE);assert.equal(f.pointer,beforePointer);assert.deepEqual([...f.caps],beforeCaps);
 assert.equal(f.history.size,0);assert.equal(f.transitions.size,0);f.clean();
});
await test('reset recovers stale private selection onto current public AI without candidate history',async()=>{
 for(const previousState of ['private','paused','revoked']){
  const f=fixture({experimental:true});await f.change();const oldPrivate=f.active;
  f.caps.get(oldPrivate).capability_state=previousState;f.history.delete(oldPrivate);
  const oldSnapshot=structuredClone(f.caps.get(oldPrivate)),newGlobal=f.replaceGlobal();
  assert.equal(f.pointer.base_capability_id,BASE);
  const status=await readOwnedCandidateActivation(f.db,OWNER,{replica_id:RID});
  assert.equal(status.can_reset,true);assert.equal(status.reset_target_capability_id,newGlobal);
  const request=f.input('reset');delete request.candidate_id;await f.change(request);
  assert.notEqual(f.active,oldPrivate);assert.notEqual(f.active,newGlobal);
  assert.equal(f.pointer.base_capability_id,newGlobal);assert.equal(f.pointer.capability_id,f.active);
  const cap=f.caps.get(f.active),h=f.history.get(f.active);
  assert.equal(cap.capability_state,'private');assert.equal(cap.candidate_binding_required,false);assert.equal(cap.profile_version,2);
  assert.equal(h.action,'reset');assert.equal(h.selection_kind,'baseline');assert.equal(h.candidate_id,null);
  assert.equal(h.target_capability_id,newGlobal);assert.equal(h.prior_capability_id,oldPrivate);
  assert.deepEqual(f.caps.get(oldPrivate),oldSnapshot);assert.equal(f.commitCalls,2);f.clean();
 }
});
await test('reset rejects stale target, wrong owner and withdrawn current source without writing',async()=>{
 const f=fixture({experimental:true});await f.change();f.replaceGlobal();
 const request=f.input('reset');delete request.candidate_id;
 const beforeCaps=structuredClone([...f.caps]),beforePointer=structuredClone(f.pointer),writes=f.commitCalls;
 await assert.rejects(()=>f.change({...request,target_capability_id:BASE}),{code:'candidate_reset_target_changed'});
 await assert.rejects(()=>changeOwnedCandidateActivation(f.db,id(99),request),{code:'candidate_active_version_changed'});
 f.invalidateSource();await assert.rejects(()=>f.change(request),{code:'candidate_reset_authority_changed'});
 assert.equal(f.commitCalls,writes);assert.deepEqual([...f.caps],beforeCaps);assert.deepEqual(f.pointer,beforePointer);f.clean();
});
await test('known atomic selection conflict becomes 409 with one write and no mutation',async()=>{
 const f=fixture({knownCasFailure:true}),beforeCaps=structuredClone([...f.caps]),beforePointer=f.pointer;
 await assert.rejects(()=>f.change(),{code:'candidate_selection_changed',status:409});
 assert.equal(f.commitCalls,1);assert.equal(f.trace.filter(sql=>sql===ACTIVATION_COMMIT_SQL).length,1);
 assert.equal(f.active,BASE);assert.equal(f.pointer,beforePointer);assert.deepEqual([...f.caps],beforeCaps);
 assert.equal(f.history.size,0);assert.equal(f.transitions.size,0);f.clean();
});
console.log(`${count} activation service groups passed; fixture control flow only, no SQL/provider execution.`);
