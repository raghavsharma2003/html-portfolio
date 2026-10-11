import assert from 'node:assert/strict';
import {fixture} from '../services/azure-voice-app/controller.test.mjs';
import {createSupervisedVoiceAppController} from '../services/azure-voice-app/controller.mjs';
import {createVoiceLifecycleStore,createVoiceAllocationBoundary,loadDueVoiceWindows,VOICE_APP_SQL} from '../api/_voice/allocation-boundary.js';
import {GPU_WINDOW_SQL} from '../api/_gpu-allocation-budget.js';
const f=fixture(),plan=f.plan,hash='a'.repeat(64),id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
Object.assign(f.options.policy,{rate_microusd_per_second:100,limit_microusd:700000,per_allocation_cap_microusd:200000});
let held=138600,dispatches=0,failRelease=false;const windows=[];
const supervisor=f.options.lifecycleStore.getSupervisorLease;
// Production controller, store, boundary AND shared meter; simulated DB/ARM only.
const db=async(sql,p)=>{
 if(sql===VOICE_APP_SQL.authorize)return[{generation_id:JSON.parse(p[0]).generation_id}];
 if(sql.includes('select *,now()::text as server_now'))return[await supervisor()];
 if(sql===VOICE_APP_SQL.due)return windows.filter(w=>w.app_id===p[0]&&w.revision_name===p[1]&&w.contract_sha256===p[2]&&w.state==='terminal_observed'&&!w.resource_released_at);
 if(sql===GPU_WINDOW_SQL.reserve){
  if(held+p[6]>p[1]||windows.some(w=>w.resource_sha256===p[2]&&!w.resource_released_at))return[];
  const w={window_id:id(windows.length+100),budget_id:p[0],resource_sha256:p[2],revision_sha256:p[3],request_sha256:p[4],contract_sha256:p[5],reserved_microusd:p[6],max_allocation_seconds:p[7],provider_request_sha256:p[8],accounting_basis:p[9],allocation_state:'reserved'};
  held+=p[6];windows.push(w);return[w];
 }
 if(sql===GPU_WINDOW_SQL.existing)return windows.filter(w=>w.budget_id===p[0]&&w.request_sha256===p[1]);
 const w=windows.find(w=>w.window_id===p[0]);
 if(sql===VOICE_APP_SQL.bind){Object.assign(w,{app_id:p[1],revision_name:p[2],configuration_sha256:p[3],template_sha256:p[4],state:'open',activation_state:'not_started',deactivation_state:'not_started',begun_at:new Date(f.options.now()).toISOString(),dispatch_deadline_at:new Date(f.options.now()+420000).toISOString(),allocation_state:'in_flight'});return JSON.parse(p[12]);}
 if(sql===VOICE_APP_SQL.get)return w?[structuredClone(w)]:[];
 if(sql===VOICE_APP_SQL.activate){if(w.activation_state!=='not_started')return[];w.activation_state='claimed';return[w];}
 if(sql===VOICE_APP_SQL.activationDispatch){if(w.activation_dispatched_at||w.activation_state!=='claimed'||w.state!=='open')return[];w.activation_dispatched_at=true;return[w];}
 if(sql===VOICE_APP_SQL.activationResult){if(w.activation_state!=='claimed')return[];w.activation_state=p[1];return[w];}
 if(sql===VOICE_APP_SQL.revoke){if(w.state==='open')w.state='closing';return[w];}
 if(sql===VOICE_APP_SQL.claim){if(w.state!=='closing'||w.deactivation_state!=='not_started')return[];w.state='close_claimed';w.deactivation_state='claimed';return[w];}
 if(sql===VOICE_APP_SQL.deactivateDispatch){if(w.resource_released_at||w.deactivation_state!=='claimed'||w.deactivation_dispatched_at)return[];w.deactivation_dispatched_at=true;return[w];}
 if(sql===VOICE_APP_SQL.deactivationResult){if(w.resource_released_at||w.deactivation_state!=='claimed')return[];w.deactivation_state=p[1];return[w];}
 if(sql===VOICE_APP_SQL.observe){if(['open','terminal_observed'].includes(w.state))return[];w.state=p[1];w.observation=JSON.parse(p[2]);return[w];}
 if(sql===GPU_WINDOW_SQL.releaseResource){if(failRelease){failRelease=false;throw Error('injected crash after terminal persistence');}if(w.state!=='terminal_observed'||w.deactivation_state!=='acknowledged'||!w.deactivation_dispatched_at||!w.observation.terminal)return[];w.resource_released_at=true;return[w];}
 if(sql===GPU_WINDOW_SQL.uncertain){w.allocation_state='uncertain';return[w];}
 throw Error('unhandled production SQL');
};
let releaseToken,enteredToken;const tokenPaused=new Promise(r=>enteredToken=r),tokenGate=new Promise(r=>releaseToken=r);let pauseOnce=true;
const controller=createSupervisedVoiceAppController({...f.options,lifecycleStore:createVoiceLifecycleStore(db,plan),getToken:async()=>{
 if(pauseOnce&&windows[0]?.deactivation_state==='claimed'){pauseOnce=false;enteredToken();await tokenGate;}
 return 'synthetic-token';
}});
const boundary=n=>createVoiceAllocationBoundary({db,budgetId:'gpu-product',limitMicrousd:700000,controller,plan,authority:{owner_user_id:id(n),replica_id:id(n+10),source_id:id(n+20),generation_id:id(n+30),intent_id:id(n+40),intent_attempt:1,lease_token_hash:hash}});
const ops=[{operation:'status',body_sha256:hash},{operation:'synthesize',body_sha256:hash}],scope={language_id:'hi',model_arm:'general',text_sha256:hash,reference_sha256:hash};
const first=boundary(1).runTransaction(ops,async()=>{dispatches++;f.active(false);},scope);
await tokenPaused;
const overlap=await controller.close(windows[0].window_id);
assert.equal(overlap.terminal,false);assert.equal(windows[0].resource_released_at,undefined);
await assert.rejects(boundary(2).runTransaction(ops,async()=>{dispatches++;},scope),/gpu_budget_reservation_refused/);
assert.equal(dispatches,1);assert.equal(f.ordering.filter(x=>x==='deactivate').length,0);
releaseToken();await first;
assert.equal(windows[0].resource_released_at,true);
await createVoiceLifecycleStore(db,plan).recordObservation(windows[0].window_id,{terminal:false,state:'stale-observer'});
assert.equal(windows[0].state,'terminal_observed');
assert.ok(VOICE_APP_SQL.observe.includes("state not in ('open','terminal_observed')"));assert.equal(f.ordering.filter(x=>x==='deactivate').length,1);
await boundary(2).runTransaction(ops,async()=>{dispatches++;},scope);
assert.equal(dispatches,2);assert.equal(held,498600);assert.ok(windows.every(w=>w.allocation_state==='uncertain'));
assert.deepEqual(f.ordering.filter(x=>['activate','deactivate'].includes(x)),['activate','deactivate','activate','deactivate']);
assert.ok(GPU_WINDOW_SQL.releaseResource.includes("l.deactivation_state='acknowledged'"));
console.log('voice184 shared service: paused old close cannot release or admit second allocation; stop completes before next activation; held498600 unchanged. Synthetic DB/ARM only.');

failRelease=true;
await boundary(3).runTransaction(ops,async()=>{dispatches++;},scope);
const stranded=windows[2];assert.equal(stranded.state,'terminal_observed');assert.equal(stranded.resource_released_at,undefined);
const due=await loadDueVoiceWindows(db,plan);assert.deepEqual(due.map(w=>w.window_id),[stranded.window_id]);
const callsBeforeRecovery=f.calls.length,stopsBeforeRecovery=f.ordering.filter(x=>x==='deactivate').length;
const recovered=await controller.supervisorTick(due[0].window_id);
assert.equal(recovered.recovery,'resource_release_only');assert.equal(stranded.resource_released_at,true);
assert.equal(f.calls.length,callsBeforeRecovery);assert.equal(f.ordering.filter(x=>x==='deactivate').length,stopsBeforeRecovery);
assert.equal(held,678600);assert.equal(stranded.allocation_state,'uncertain');
assert.deepEqual(await loadDueVoiceWindows(db,plan),[]);
assert.ok(VOICE_APP_SQL.due.includes("l.state='terminal_observed' and w.resource_released_at is null"));
console.log('voice185 injected terminal/release crash is recovered through actual scoped due loader and supervisor, zero ARM calls,678600 fixture liability stillheld.');
