import {PREVIEW_FENCE} from './preview-authority.js';
import {randomUUID} from 'node:crypto';
import {createGpuAllocationMeter,releaseObservedGpuResource} from '../_gpu-allocation-budget.js';
import {canonicalJson,sha256Hex} from '../_provenance/contracts.js';
export function voiceAllocationUnavailable(){throw Object.assign(new Error('voice_allocation_not_configured'),{code:'voice_allocation_not_configured',status:503,blockerClass:'us'});}
export const productionVoiceAllocation=Object.freeze({assertReady:voiceAllocationUnavailable,runTransaction:voiceAllocationUnavailable});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// One DB-derived preview intent owns each allocation. No owner/text policy is supplied by deployment config.
function eligiblePreview(parameter){
 const value=key=>`(${parameter}::jsonb->>'${key}')`;
 return `select g.generation_id from vy_replica_generation g
 join vy_replica r on r.replica_id=g.replica_id and r.owner_user_id=g.owner_user_id
 join vy_replica_source s on s.source_id=${value('source_id')}::uuid and s.replica_id=r.replica_id and s.owner_user_id=r.owner_user_id
 join vy_replica_voice_preview_intent i on i.intent_id=g.preview_intent_id and i.generation_id=g.generation_id
 where r.owner_user_id=${value('owner_user_id')}::uuid and r.replica_id=${value('replica_id')}::uuid
 and g.generation_id=${value('generation_id')}::uuid and i.intent_id=${value('intent_id')}::uuid
 and i.owner_user_id=r.owner_user_id and i.replica_id=r.replica_id
 and i.attempt=${value('intent_attempt')}::int4 and g.preview_intent_attempt=i.attempt
 and i.state='synthesizing' and i.lease_token_hash=${value('lease_token_hash')} and i.lease_expires_at>now()
 and g.preview_text_hash=${value('text_sha256')} and i.text_hash=g.preview_text_hash
 and g.preview_language_id=${value('language_id')} and i.language_id=g.preview_language_id
 and g.preview_language_id in ('hi','en') and g.state in ('authorized','streaming')
 and s.state='ready' and s.contains_third_parties=false and ${PREVIEW_FENCE}
 and exists(select 1 from vy_replica_processing_artifact artifact where artifact.artifact_id=g.preview_artifact_id
 and artifact.source_id=s.source_id and artifact.replica_id=r.replica_id and artifact.owner_user_id=r.owner_user_id
 and artifact.sha256=${value('reference_sha256')}) for update of r,g,s,i`;
}
export function voiceRequestAuthority(authority,scope){
 const request={...authority,text_sha256:scope?.text_sha256,language_id:scope?.language_id,reference_sha256:scope?.reference_sha256};
 if(!authority || !['replica_id','owner_user_id','source_id','generation_id','intent_id'].every(k=>uuid.test(request[k]||'')) ||
 !Number.isSafeInteger(request.intent_attempt)||request.intent_attempt<1 ||
 !['lease_token_hash','text_sha256','reference_sha256'].every(k=>/^[0-9a-f]{64}$/.test(request[k]||'')) ||
 !['hi','en'].includes(request.language_id)||scope?.model_arm!=='general')voiceAllocationUnavailable();
 return Object.freeze(request);
}
export async function authorizeVoiceAllocationRequest(db,authority,scope){
 const request=voiceRequestAuthority(authority,scope);
 const rows=await db(VOICE_APP_SQL.authorize,[JSON.stringify(request)]);
 if(rows.length!==1||rows[0].generation_id!==request.generation_id)throw Object.assign(new Error('voice_allocation_authority_changed'),{code:'voice_allocation_authority_changed',status:409});
 return request;
}
export const VOICE_APP_SQL=Object.freeze({
 authorize:eligiblePreview('$1'),
 bind:`with eligible as materialized (${eligiblePreview('$17')}), begun as (
 update vy_gpu_allocation_window set state='in_flight',begun_at=now()
 where window_id=$1::uuid and budget_id=$14 and request_sha256=$15 and state='reserved' and exists(select 1 from eligible) returning *
 ), parent as (
 insert into vy_voice_app_lifecycle(window_id,app_id,revision_name,configuration_sha256,template_sha256,contract_sha256,broker_origin,runtime_origin,state,dispatch_deadline_at)
 select window_id,$2,$3,$4,$5,$6,$7,$8,'open',begun_at+interval '420 seconds'
 from begun returning window_id
 ), authority as (
 insert into vy_voice_allocation_authority(window_id,replica_id,owner_user_id,source_id,generation_id,reference_sha256,intent_id,intent_attempt,lease_token_hash,text_sha256,language_id)
 select window_id,$9::uuid,$10::uuid,$11::uuid,$12::uuid,$16,($17::jsonb->>'intent_id')::uuid,($17::jsonb->>'intent_attempt')::int4,$17::jsonb->>'lease_token_hash',$17::jsonb->>'text_sha256',$17::jsonb->>'language_id' from parent returning window_id
 ) insert into vy_voice_allocation_child(child_id,window_id,ordinal,operation,body_sha256)
 select c.child_id,a.window_id,c.ordinal,c.operation,c.body_sha256 from authority a,
 jsonb_to_recordset($13::jsonb) as c(child_id uuid,ordinal integer,operation text,body_sha256 text) returning child_id`,
 consume:`with target as materialized (
 select l.window_id,l.dispatch_deadline_at,a.replica_id,a.owner_user_id from vy_voice_app_lifecycle l
 join vy_voice_allocation_authority a using(window_id)
 join vy_gpu_allocation_window w using(window_id)
 join vy_replica r on r.replica_id=a.replica_id and r.owner_user_id=a.owner_user_id
 join vy_replica_generation g on g.generation_id=a.generation_id and g.replica_id=a.replica_id and g.owner_user_id=a.owner_user_id
 join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id and s.owner_user_id=a.owner_user_id
 where l.window_id=$1::uuid and l.state='open' and l.activation_state='acknowledged' and l.dispatch_deadline_at>now()
 and w.state='in_flight'
 and exists(select 1 from vy_voice_app_supervisor_lease h where h.app_id=l.app_id and h.contract_sha256=l.contract_sha256
 and h.revision_sha256=w.revision_sha256 and h.heartbeat_at<=now() and h.heartbeat_at>=now()-interval '30 seconds' and h.lease_expires_at>now())
 and l.broker_origin=$5 and l.runtime_origin=$6
 and ${PREVIEW_FENCE}
 and g.state in ('authorized','streaming') and s.state='ready'
 and exists(select 1 from vy_replica_voice_preview_intent i where i.intent_id=a.intent_id and i.intent_id=g.preview_intent_id
 and i.replica_id=a.replica_id and i.owner_user_id=a.owner_user_id and i.generation_id=g.generation_id
 and i.attempt=a.intent_attempt and g.preview_intent_attempt=i.attempt and i.state='synthesizing'
 and i.lease_token_hash=a.lease_token_hash and i.lease_expires_at>now()
 and i.text_hash=a.text_sha256 and g.preview_text_hash=a.text_sha256
 and i.language_id=a.language_id and g.preview_language_id=a.language_id and a.language_id in ('hi','en'))
 and exists(select 1 from vy_replica_processing_artifact artifact where artifact.artifact_id=g.preview_artifact_id and artifact.source_id=a.source_id and artifact.replica_id=a.replica_id and artifact.owner_user_id=a.owner_user_id and artifact.sha256=a.reference_sha256)
 and r.policy_version='replica-self-v1' and r.age_verified_at is not null
 and r.identity_verified_at is not null and r.liveness_verified_at is not null and r.identity_expires_at>now()
 and s.contains_third_parties=false
 and not exists(select 1 from unnest(array['inference','biometric','training']) required(scope)
 where not exists(select 1 from vy_replica_consent c where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
 and c.scope=required.scope and c.policy_version=r.policy_version and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())))
 for update of l,r
 ) update vy_voice_allocation_child c set consumed_at=now() from target t
 where c.window_id=t.window_id and c.child_id=$2::uuid and c.operation=$3 and c.body_sha256=$4 and c.consumed_at is null returning c.child_id,t.dispatch_deadline_at::text as dispatch_not_after`,
 activate:`update vy_voice_app_lifecycle l set activation_state='claimed' from vy_voice_allocation_authority a
 where l.window_id=$1::uuid and a.window_id=l.window_id and l.state='open' and l.activation_state='not_started'
 and l.dispatch_deadline_at>now() and exists(${eligiblePreview('to_jsonb(a)')}) returning l.window_id`,
 activationDispatch:`update vy_voice_app_lifecycle l set activation_dispatched_at=now() from vy_voice_allocation_authority a
 where l.window_id=$1::uuid and a.window_id=l.window_id and l.state='open' and l.activation_state='claimed'
 and l.activation_dispatched_at is null and l.dispatch_deadline_at>now()
 and exists(${eligiblePreview('to_jsonb(a)')}) returning l.window_id`,
 activationResult:`update vy_voice_app_lifecycle set activation_state=$2 where window_id=$1::uuid and activation_state='claimed'
 and ($2='unknown' or (state='open' and dispatch_deadline_at>now())) returning window_id`,
 get:`select l.*,w.begun_at::text as begun_at,w.state as allocation_state,w.resource_sha256,w.revision_sha256,w.resource_released_at from vy_voice_app_lifecycle l join vy_gpu_allocation_window w using(window_id) where l.window_id=$1::uuid`,
 revoke:`update vy_voice_app_lifecycle set state='closing' where window_id=$1::uuid and state='open' returning *`,
 claim:`update vy_voice_app_lifecycle set state='close_claimed',deactivation_state='claimed'
 where window_id=$1::uuid and state='closing' and deactivation_state='not_started' returning *`,
 deactivateDispatch:`update vy_voice_app_lifecycle l set deactivation_dispatched_at=now() from vy_gpu_allocation_window w
 where l.window_id=$1::uuid and w.window_id=l.window_id and w.resource_released_at is null
 and l.state in ('closing','close_claimed','observation_unknown') and l.deactivation_state='claimed'
 and l.deactivation_dispatched_at is null returning l.window_id`,
 deactivationResult:`update vy_voice_app_lifecycle l set deactivation_state=$2 from vy_gpu_allocation_window w
 where l.window_id=$1::uuid and w.window_id=l.window_id and w.resource_released_at is null and l.deactivation_state='claimed'
 and ($2='unknown' or l.deactivation_dispatched_at is not null) returning l.window_id`,
 observe:`update vy_voice_app_lifecycle set state=$2,observation=$3::jsonb where window_id=$1::uuid and state not in ('open','terminal_observed') returning *`,
 due:`select l.window_id,l.app_id,l.revision_name,l.contract_sha256 from vy_voice_app_lifecycle l
 join vy_gpu_allocation_window w using(window_id)
 where l.app_id=$1 and l.revision_name=$2 and l.contract_sha256=$3
 and ((l.state='terminal_observed' and w.resource_released_at is null)
 or (l.state<>'terminal_observed' and (l.state<>'open' or l.dispatch_deadline_at<=now())))
 order by l.dispatch_deadline_at,l.window_id limit 10`,
});
export function createVoiceLifecycleStore(db,plan){return {
 getSupervisorLease:async()=>(await db(`select *,now()::text as server_now,heartbeat_at::text as heartbeat_at,lease_expires_at::text as lease_expires_at from vy_voice_app_supervisor_lease where app_id=$1 and contract_sha256=$2`,[plan.app_id,plan.contract_sha256]))[0],
 claimActivation:async id=>(await db(VOICE_APP_SQL.activate,[id])).length===1,
 authorizeActivationDispatch:async id=>(await db(VOICE_APP_SQL.activationDispatch,[id])).length===1,
 authorizeDeactivationDispatch:async id=>(await db(VOICE_APP_SQL.deactivateDispatch,[id])).length===1,
 recordDeactivation:async(id,state)=>(await db(VOICE_APP_SQL.deactivationResult,[id,state])).length===1,
 recordActivation:async(id,state)=>(await db(VOICE_APP_SQL.activationResult,[id,state])).length===1,
 getWindow:async id=>(await db(VOICE_APP_SQL.get,[id]))[0],
 revokeAdmission:async id=>db(VOICE_APP_SQL.revoke,[id]),
 claimClose:async id=>(await db(VOICE_APP_SQL.claim,[id])).length===1,
 recordObservation:async(id,o)=>{
  const result=await db(VOICE_APP_SQL.observe,[id,o.terminal?'terminal_observed':'observation_unknown',JSON.stringify(o)]);
  if(o.terminal){
   const stored=(await db(VOICE_APP_SQL.get,[id]))[0];
   if(stored?.state==='terminal_observed'&&!stored.resource_released_at){
    await releaseObservedGpuResource({db,windowId:id,appId:plan.app_id,observation:stored.observation});
   }
  }
  return result;
 },
};}
export async function consumeVoiceAllocationChild(db,input){
 if(!uuid.test(input?.window_id||'')||!uuid.test(input?.child_id||'')||!['status','synthesize'].includes(input.operation)||!/^[0-9a-f]{64}$/.test(input.body_sha256||''))voiceAllocationUnavailable();
 const rows=await db(VOICE_APP_SQL.consume,[input.window_id,input.child_id,input.operation,input.body_sha256,input.broker_origin,input.runtime_origin]);
 if(rows.length!==1)throw Object.assign(new Error('voice_allocation_child_refused'),{code:'voice_allocation_child_refused',status:409});
 return {authorized:true,window_id:input.window_id,child_id:input.child_id,operation:input.operation,body_sha256:input.body_sha256,dispatch_not_after:new Date(rows[0].dispatch_not_after).toISOString()};
}
export function createVoiceAllocationBoundary({db,budgetId,limitMicrousd,controller,plan,authority,policy}={}){
 if(controller?.kind!=='azure-supervised-app-controller/v1'||typeof controller.assertExclusiveTarget!=='function'||typeof controller.close!=='function'||typeof controller.activate!=='function')voiceAllocationUnavailable();
 const meter=createGpuAllocationMeter({db,budgetId,limitMicrousd,controller});
 return Object.freeze({
 async assertReady(){await meter.assertReady();},
 async runTransaction(operations,work,inputScope){
  if(!Array.isArray(operations)||operations.length<1||operations.length>32||operations.filter(o=>o.operation==='synthesize').length!==1||
    operations.some(o=>!['status','synthesize'].includes(o.operation)||!/^[0-9a-f]{64}$/.test(o.body_sha256||''))||typeof work!=='function')voiceAllocationUnavailable();
  const requestAuthority=await authorizeVoiceAllocationRequest(db,authority,inputScope);
  await controller.assertExclusiveTarget();
  const request=sha256Hex(canonicalJson({operations,authority:requestAuthority}));
  const reservation=await meter.reserve({request_sha256:request,preparation_id:requestAuthority.intent_id,job_id:authority.generation_id,step:'whole-voice-app',max_dispatches:1});
  if(reservation.recovered)voiceAllocationUnavailable();
  const children=operations.map((o,ordinal)=>({...o,ordinal,child_id:randomUUID()}));
  try{
   const bound=await db(VOICE_APP_SQL.bind,[reservation.window_id,plan.app_id,plan.revision_name,plan.configuration_sha256,plan.template_sha256,plan.contract_sha256,plan.broker_origin,plan.runtime_origin,authority.replica_id,authority.owner_user_id,authority.source_id,authority.generation_id,JSON.stringify(children),reservation.budget_id,reservation.request_sha256,requestAuthority.reference_sha256,JSON.stringify(requestAuthority)]);
   if(bound.length!==children.length)voiceAllocationUnavailable();
   await controller.activate(reservation.window_id);
   const issued=new Set();
   return await work({headers(index){
    if(!Number.isInteger(index)||!children[index]||issued.has(index))voiceAllocationUnavailable();
    issued.add(index);
    return {'X-Vyakti-Allocation-Window':reservation.window_id,'X-Vyakti-Allocation-Child':children[index].child_id};
   }});
  }finally{
   // Revocation/cleanup is independent of HTTP success; no refund here.
   await controller.close(reservation.window_id,'transaction_finished').catch(()=>{});
   await meter.markUncertain(reservation).catch(()=>{});
  }
 },
 });
}

export async function loadDueVoiceWindows(db,plan){
 const scope=[plan?.app_id,plan?.revision_name,plan?.contract_sha256];
 if(scope.some(value=>typeof value!=='string'||!value))voiceAllocationUnavailable();
 const rows=await db(VOICE_APP_SQL.due,scope);
 if(!Array.isArray(rows)||rows.length>10||rows.some(row=>row.app_id!==scope[0]||row.revision_name!==scope[1]||row.contract_sha256!==scope[2])){
  throw Object.assign(new Error('voice_supervisor_scope_mismatch'),{code:'voice_supervisor_scope_mismatch'});
 }
 return rows;
}
