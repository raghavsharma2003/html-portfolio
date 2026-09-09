import assert from 'node:assert/strict';
import {createVoiceAllocationBoundary,VOICE_APP_SQL} from '../api/_voice/allocation-boundary.js';
import {GPU_WINDOW_SQL,releaseObservedGpuResource} from '../api/_gpu-allocation-budget.js';
import {sha256Hex} from '../api/_provenance/contracts.js';
const uuid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,app='/isolated-app',hash='a'.repeat(64);
const plan={app_id:app,revision_name:'revision-one',configuration_sha256:hash,template_sha256:hash,contract_sha256:hash,broker_origin:'https://broker.azurecontainerapps.io',runtime_origin:'https://runtime.internal.azurecontainerapps.io'};
const cap=350000,priorHold=138600;let held=priorHold,spent=0,activate=0,dispatch=0;const windows=[];
// Actual shared meter/boundary functions; independent in-memory DB model. NOT SQL execution.
const db=async(sql,p)=>{
 if(sql===VOICE_APP_SQL.authorize)return[{generation_id:JSON.parse(p[0]).generation_id}];
 if(sql===GPU_WINDOW_SQL.reserve){
  assert.equal(p[1],cap);
  if(held+p[6]>cap||windows.some(w=>w.resource_sha256===p[2]&&!w.resource_released_at))return[];
  held+=p[6];const w={window_id:uuid(windows.length+100),budget_id:p[0],resource_sha256:p[2],revision_sha256:p[3],request_sha256:p[4],contract_sha256:p[5],reserved_microusd:p[6],max_allocation_seconds:p[7],provider_request_sha256:p[8],accounting_basis:p[9],state:'reserved'};windows.push(w);return[w];
 }
 if(sql===GPU_WINDOW_SQL.existing)return windows.filter(w=>w.budget_id===p[0]&&w.request_sha256===p[1]);
 if(sql===VOICE_APP_SQL.bind){const w=windows.find(w=>w.window_id===p[0]);w.state='in_flight';return JSON.parse(p[12]);}
 if(sql===GPU_WINDOW_SQL.uncertain){const w=windows.find(w=>w.window_id===p[0]);w.state='uncertain';return[w];}
 if(sql===GPU_WINDOW_SQL.releaseResource){
  const w=windows.find(w=>w.window_id===p[0]);if(!w?.closed||w.activationUnknown||w.resource_sha256!==p[1])return[];
  w.resource_released_at='observed';return[{window_id:w.window_id}];
 }
 throw Error('unexpected SQL');
};
const observation={app_id:app,revision_name:plan.revision_name,terminal:true,all_replicas_zero:true,all_revisions_inactive:true,revisions:[{active:false,replicas:0}]};
const controller={kind:'azure-supervised-app-controller/v1',assertExclusiveTarget:async()=>{},activate:async()=>{activate++;},
 authorizeWindow:async({request_sha256})=>({kind:'azure-supervised-app/v1',request_sha256,resource_sha256:sha256Hex(app),revision_sha256:hash,contract_sha256:hash,reservation_estimate_microusd:100000,planning_allocation_seconds:900}),
 close:async id=>{windows.find(w=>w.window_id===id).closed=true;return releaseObservedGpuResource({db,windowId:id,appId:app,observation});}};
function boundary(n){return createVoiceAllocationBoundary({db,budgetId:'gpu-product',limitMicrousd:cap,controller,plan,authority:{owner_user_id:uuid(n),replica_id:uuid(n+10),source_id:uuid(n+20),generation_id:uuid(n+30),intent_id:uuid(n+40),intent_attempt:1,lease_token_hash:hash}});}
const ops=[{operation:'status',body_sha256:hash},{operation:'synthesize',body_sha256:hash}];
const scope={language_id:'hi',model_arm:'general',text_sha256:hash,reference_sha256:hash};
for(const n of [1,2])await boundary(n).runTransaction(ops,async()=>{dispatch++;},scope);
assert.equal(activate,2);assert.equal(dispatch,2);assert.equal(held,priorHold+200000);assert.equal(spent,0);
assert.ok(windows.every(w=>w.resource_released_at&&w.state==='uncertain'));
await assert.rejects(boundary(3).runTransaction(ops,async()=>{dispatch++;},scope),/gpu_budget_reservation_refused/);
assert.equal(activate,2);assert.equal(held,338600);
windows[0].activationUnknown=true;
await assert.rejects(releaseObservedGpuResource({db,windowId:windows[0].window_id,appId:app,observation}),/gpu_resource_release_refused/);
assert.ok(GPU_WINDOW_SQL.reserve.includes('pg_advisory_xact_lock(hashtextextended($3::text,0))'));
assert.ok(GPU_WINDOW_SQL.releaseResource.includes('pg_advisory_xact_lock(hashtextextended($2::text,0))'));
assert.ok(GPU_WINDOW_SQL.releaseResource.includes('for update of w,l'));
assert.ok(!/set (?:state|reserved_microusd|actual_microusd|spent_microusd)=/.test(GPU_WINDOW_SQL.releaseResource));
console.log('voice183 real shared meter/boundary exercised twice; resource reuses while338600 monetary hold remains; third exceeds cap; unknown release refused. Synthetic SQL only.');
