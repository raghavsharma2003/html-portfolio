import assert from 'node:assert/strict';
import {createVoiceAllocationBoundary,consumeVoiceAllocationChild,VOICE_APP_SQL,productionVoiceAllocation} from '../api/_voice/allocation-boundary.js';
const hash='a'.repeat(64),ids={replica_id:'11111111-1111-4111-8111-111111111111',owner_user_id:'22222222-2222-4222-8222-222222222222',source_id:'33333333-3333-4333-8333-333333333333',generation_id:'44444444-4444-4444-8444-444444444444'};
Object.assign(ids,{intent_id:'66666666-6666-4666-8666-666666666666',intent_attempt:1,lease_token_hash:hash});
const scope={language_id:'hi',model_arm:'general',text_sha256:hash,reference_sha256:hash};
const trace=[];let reservation,children;let consumed=new Set();
const db=async(sql,p)=>{
 if(sql===VOICE_APP_SQL.authorize)return[{generation_id:ids.generation_id}];
 if(sql.includes('insert into vy_gpu_allocation_window')){trace.push('reserve');reservation={window_id:'55555555-5555-4555-8555-555555555555',budget_id:p[0],resource_sha256:p[2],revision_sha256:p[3],request_sha256:p[4],contract_sha256:p[5],reserved_microusd:p[6],max_allocation_seconds:p[7],provider_request_sha256:p[8],accounting_basis:p[9]};return[reservation];}
 if(sql===VOICE_APP_SQL.bind){trace.push('atomic_begin_bind');children=JSON.parse(p[12]);return children;}
 if(sql===VOICE_APP_SQL.consume){if(consumed.has(p[1]))return[];const c=children.find(c=>c.child_id===p[1]&&c.operation===p[2]&&c.body_sha256===p[3]);if(!c)return[];consumed.add(c.child_id);trace.push(c.operation);return[{...c,dispatch_not_after:new Date(Date.now()+60000).toISOString()}];}
 if(sql.includes("set state='uncertain'")){trace.push('held');return[reservation];}
 throw Error('unexpected_sql');
};
const controller={kind:'azure-supervised-app-controller/v1',assertExclusiveTarget:async()=>trace.push('preflight'),activate:async()=>trace.push('activate'),close:async()=>trace.push('close'),authorizeWindow:async({request_sha256})=>({kind:'azure-supervised-app/v1',request_sha256,resource_sha256:hash,revision_sha256:hash,contract_sha256:hash,reservation_estimate_microusd:831600,planning_allocation_seconds:900})};
const plan={app_id:'/isolated',revision_name:'isolated--one',configuration_sha256:hash,template_sha256:hash,contract_sha256:hash,broker_origin:'https://broker.azurecontainerapps.io',runtime_origin:'https://gpu.internal.azurecontainerapps.io'};
const boundary=createVoiceAllocationBoundary({db,budgetId:'gpu-owner-canary',limitMicrousd:1000000,controller,plan,authority:ids});
const operations=[{operation:'status',body_sha256:hash},{operation:'synthesize',body_sha256:hash}];
const value=await boundary.runTransaction(operations,async session=>{
 for(let i=0;i<2;i++){
  const headers=session.headers(i),input={window_id:headers['X-Vyakti-Allocation-Window'],child_id:headers['X-Vyakti-Allocation-Child'],...operations[i],broker_origin:plan.broker_origin,runtime_origin:plan.runtime_origin};
  assert.equal((await consumeVoiceAllocationChild(db,input)).authorized,true);
  await assert.rejects(consumeVoiceAllocationChild(db,input),/voice_allocation_child_refused/);
  assert.throws(()=>session.headers(i),/voice_allocation_not_configured/);
 }
 return'one whole window';
},scope);
assert.equal(value,'one whole window');assert.deepEqual(trace,['preflight','reserve','atomic_begin_bind','activate','status','synthesize','close','held']);
assert.throws(()=>productionVoiceAllocation.assertReady(),/voice_allocation_not_configured/);
await assert.rejects(boundary.runTransaction([{operation:'synthesize',body_sha256:'bad'}],()=>{}),/voice_allocation_not_configured/);
console.log('voice53: single reservation covers readiness+synthesis; duplicate/mismatched children refused; closure retains cost. Synthetic SQL only.');

let activated=0,dispatched=0;
const exhausted=createVoiceAllocationBoundary({db:async(sql,p)=>sql===VOICE_APP_SQL.authorize?[{generation_id:ids.generation_id}]:[],budgetId:'gpu-owner-canary',limitMicrousd:1000000,controller:{...controller,activate:async()=>{activated++;}},plan,authority:ids});
await assert.rejects(exhausted.runTransaction(operations,async()=>{dispatched++;},scope),/gpu_budget_reservation_refused/);
assert.equal(activated,0);assert.equal(dispatched,0);
console.log('voice182 exhausted/held reservation refusal never activates or dispatches; synthetic ledger.');
