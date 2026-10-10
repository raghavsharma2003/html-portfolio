import {randomUUID} from 'node:crypto';
import {createVoiceLifecycleStore,loadDueVoiceWindows} from '../../api/_voice/allocation-boundary.js';
import {createSupervisedVoiceAppController,commitment} from '../azure-voice-app/controller.mjs';
import {voiceAppArmToken} from '../../api/_voice/allocation-runtime.js';
import {createGpuAllocationMeter} from '../../api/_gpu-allocation-budget.js';
import {privateVoiceError,requirePrivateVoiceRun} from '../../api/_private-voice-store.js';
import {AUTHORITY,args,one} from './store.mjs';

const fail=code=>{throw privateVoiceError(code,503);};
export const LIFE_SQL={
 bind:`with ${AUTHORITY}, begun as (
 update vy_gpu_allocation_window w set state='in_flight',begun_at=now()
 where window_id=$7::uuid and budget_id=$8 and request_sha256=$9 and state='reserved'
 and exists(select 1 from authorized where window_id is null) returning window_id,begun_at
 ), parent as (
 insert into vy_voice_app_lifecycle(window_id,app_id,revision_name,configuration_sha256,template_sha256,contract_sha256,broker_origin,runtime_origin,state,dispatch_deadline_at)
 select window_id,$10::jsonb->>'app_id',$10::jsonb->>'revision_name',$10::jsonb->>'configuration_sha256',
 $10::jsonb->>'template_sha256',$10::jsonb->>'contract_sha256',$10::jsonb->>'broker_origin',$10::jsonb->>'runtime_origin',
 'open',begun_at+interval '420 seconds' from begun returning window_id
 ) update vy_private_voice_run h set window_id=p.window_id,allocation_plan=$10::jsonb,children=$11::jsonb,updated_at=now()
 from parent p,authorized a where h.run_id=a.run_id returning h.window_id`,
 lookup:`select * from vy_private_voice_run where window_id=$1::uuid`,
 activate:`with ${AUTHORITY} update vy_voice_app_lifecycle l set activation_state='claimed'
 from authorized a where l.window_id=a.window_id and l.state='open' and l.activation_state='not_started' and l.dispatch_deadline_at>now() returning l.window_id`,
 dispatch:`with ${AUTHORITY} update vy_voice_app_lifecycle l set activation_dispatched_at=now()
 from authorized a where l.window_id=a.window_id and l.state='open' and l.activation_state='claimed'
 and l.activation_dispatched_at is null and l.dispatch_deadline_at>now() returning l.window_id`,
 consume:`with ${AUTHORITY}, current_window as materialized (
 select a.run_id,l.window_id,l.dispatch_deadline_at from authorized a
 join vy_voice_app_lifecycle l on l.window_id=a.window_id join vy_gpu_allocation_window w on w.window_id=l.window_id
 join vy_voice_app_supervisor_lease h on h.app_id=l.app_id and h.contract_sha256=l.contract_sha256
 where l.state='open' and l.activation_state='acknowledged' and l.dispatch_deadline_at>now() and w.state='in_flight'
 and l.broker_origin=$10 and l.runtime_origin=$11 and h.revision_sha256=w.revision_sha256
 and h.source_sha256=$12 and h.heartbeat_at<=now() and h.heartbeat_at>now()-interval '30 seconds' and h.lease_expires_at>now()
 and exists(select 1 from jsonb_array_elements(a.children) c where c->>'child_id'=$7 and c->>'operation'=$8
 and c->>'body_sha256'=$9 and c->>'consumed_at' is null) for update of l
 ) update vy_private_voice_run r set children=(select jsonb_agg(case when c->>'child_id'=$7 then
 c||jsonb_build_object('consumed_at',now()) else c end order by ord) from jsonb_array_elements(r.children) with ordinality v(c,ord))
 from current_window w where r.run_id=w.run_id returning w.dispatch_deadline_at::text dispatch_not_after`,
 heartbeat:`insert into vy_voice_app_supervisor_lease(app_id,contract_sha256,revision_sha256,source_sha256,heartbeat_at,lease_expires_at)
 values($1,$2,$3,$4,now(),now()+interval '30 seconds') on conflict(app_id) do update set contract_sha256=excluded.contract_sha256,
 revision_sha256=excluded.revision_sha256,source_sha256=excluded.source_sha256,heartbeat_at=now(),lease_expires_at=now()+interval '30 seconds'`,
};
export function createPrivateLifecycle({db,env=process.env,fetchImpl=fetch,now=Date.now,controller:injected}={}){
 let plan,policy;try{plan=JSON.parse(env.AZURE_VOICE_APP_PLAN_JSON);policy=JSON.parse(env.AZURE_VOICE_APP_POLICY_JSON);}catch{fail('private_voice_lifecycle_unconfigured');}
 if(env.VYAKTI_MODEL_SERVING!=='azure_only'||env.OPEN_VOICE_MODEL_ARM!=='hindi_v3'||env.AZURE_VOICE_APP_ENABLED!=='true'||
 commitment({plan,policy})!==env.AZURE_VOICE_APP_APPROVAL_SHA256||plan.broker_origin!==env.AZURE_OPEN_VOICE_ORIGIN||
 policy.budget_id!==env.AZURE_VOICE_APP_BUDGET_ID)fail('private_voice_lifecycle_binding_invalid');
 const base=createVoiceLifecycleStore(db,plan);
 const lookup=async id=>one(await db(LIFE_SQL.lookup,[id]));
 const fenced=async(id,sql)=>{const r=await lookup(id);await requirePrivateVoiceRun(db,r.owner_user_id,r,{now});return(await db(sql,args(r))).length===1;};
 const lifecycle={...base,
  async getWindow(id){const row=await lookup(id);if(commitment(row.allocation_plan)!==commitment(plan))fail('private_voice_window_plan_changed');
   return {...await base.getWindow(id),...(plan.revision_template_sha256?{revision_template_sha256:row.allocation_plan.revision_template_sha256}:{})};},
  claimActivation:id=>fenced(id,LIFE_SQL.activate),authorizeActivationDispatch:id=>fenced(id,LIFE_SQL.dispatch)};
 const controller=injected||createSupervisedVoiceAppController({plan,policy,lifecycleStore:lifecycle,fetchImpl,now,getToken:()=>voiceAppArmToken(env,fetchImpl)});
 const meter=createGpuAllocationMeter({db,budgetId:policy.budget_id,limitMicrousd:policy.limit_microusd,controller});
 return {plan,policy,controller,lifecycle,
 allocation(row){return {
  async assertReady(){await meter.assertReady();await controller.assertSupervisorReady();},
  async runTransaction(operations,work,scope){
   if(!Array.isArray(operations)||operations.length>32||operations.filter(o=>o.operation==='synthesize').length!==1||
    operations.some(o=>!['status','synthesize'].includes(o.operation)||!/^[a-f0-9]{64}$/.test(o.body_sha256||''))||
    scope.model_arm!=='hindi_v3'||scope.language_id!=='hi'||scope.reference_sha256!==row.reference_sha256||scope.text_sha256!==row.text_sha256)
    fail('private_voice_dispatch_binding_invalid');
   await requirePrivateVoiceRun(db,row.owner_user_id,row,{now});one(await db(`with ${AUTHORITY} select * from authorized`,args(row)));
   await controller.assertExclusiveTarget();
   const request=commitment({run_id:row.run_id,receipt_hash:row.receipt_hash,operations,scope});
   const reservation=await meter.reserve({request_sha256:request,preparation_id:row.run_id,job_id:row.run_id,step:'private-voice',max_dispatches:1});
   if(reservation.recovered)fail('private_voice_allocation_replay');
   const children=operations.map((o,ordinal)=>({...o,ordinal,child_id:randomUUID(),consumed_at:null}));let bound=false;
   try{
    one(await db(LIFE_SQL.bind,[...args(row),reservation.window_id,reservation.budget_id,reservation.request_sha256,JSON.stringify(plan),JSON.stringify(children)]));bound=true;
    await controller.activate(reservation.window_id);const issued=new Set();
    return await work({headers(index){if(!Number.isInteger(index)||!children[index]||issued.has(index))fail('private_voice_child_replayed');issued.add(index);
     return {'X-Vyakti-Allocation-Window':reservation.window_id,'X-Vyakti-Allocation-Child':children[index].child_id};}});
   }finally{
    // An uncertain bind may already have begun. Only SQL's reserved predicate can refund it.
    await controller.close(reservation.window_id,'transaction_finished').catch(()=>{});
    await meter.markUncertain(reservation).catch(()=>{});
    if(!bound)await meter.releaseBeforeBegin(reservation).catch(()=>{});
   }
  },
 };},
 async consume(input){
  if(Object.keys(input||{}).sort().join(',')!=='body_sha256,broker_origin,child_id,operation,runtime_origin,window_id'||
   !/^[a-f0-9-]{36}$/.test(input.window_id||'')||!/^[a-f0-9-]{36}$/.test(input.child_id||'')||!/^[a-f0-9]{64}$/.test(input.body_sha256||'')||!['status','synthesize'].includes(input.operation))fail('private_voice_child_invalid');
  const r=await lookup(input.window_id);await requirePrivateVoiceRun(db,r.owner_user_id,r,{now});
  const result=one(await db(LIFE_SQL.consume,[...args(r),input.child_id,input.operation,input.body_sha256,input.broker_origin,input.runtime_origin,policy.supervisor_source_sha256]));
  return {authorized:true,window_id:input.window_id,child_id:input.child_id,operation:input.operation,body_sha256:input.body_sha256,dispatch_not_after:new Date(result.dispatch_not_after).toISOString()};
 },
 async supervise(){
  const rows=await loadDueVoiceWindows(db,plan);for(const row of rows)await controller.supervisorTick(row.window_id);
  await db(LIFE_SQL.heartbeat,[plan.app_id,plan.contract_sha256,commitment({revision_name:plan.revision_name,configuration_sha256:plan.configuration_sha256,template_sha256:plan.template_sha256}),policy.supervisor_source_sha256]);
  return {observed:rows.length,accounted:false};
 },
 };
}
