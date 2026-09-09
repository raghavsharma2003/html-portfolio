import {randomUUID} from 'node:crypto';
import {createGpuAllocationMeter} from '../_gpu-allocation-budget.js';
import {canonicalJson,sha256Hex} from '../_provenance/contracts.js';
import {leaseTokenHash} from './queue.js';
import {processingPurposeSql} from './purpose.js';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const HASH=/^[0-9a-f]{64}$/;
export const PROCESSING_GPU_STAGES=Object.freeze(['diarize','separate','enhance','voice_quality']);
const fail=code=>{throw Object.assign(new Error(code),{code,status:503,retryable:false});};
const hash=x=>sha256Hex(canonicalJson(x));
// No preview-inference grants are invented for source processing. Recheck the
// actual uploaded source's capture and storage authority, purpose and lease.
const AUTH=`select s.source_id from vy_replica_processing_job j
 join vy_replica_source s on s.source_id=j.source_id and s.replica_id=j.replica_id and s.owner_user_id=j.owner_user_id
 join vy_replica r on r.replica_id=s.replica_id and r.owner_user_id=s.owner_user_id
 where j.job_id=$1::uuid and j.source_id=$2::uuid and j.replica_id=$3::uuid and j.owner_user_id=$4::uuid
 and j.revision=$5::int4 and j.step=$6 and j.state='leased' and j.lease_token_hash=$7 and j.lease_expires_at>now()
 and s.sha256=$8 and s.state in ('quarantined','processing') and s.capture_mode='upload' and s.purpose<>'comparison_reference'
 and r.lifecycle not in ('revoked','purging') and ${processingPurposeSql()}
 and exists(select 1 from vy_replica_consent c where c.consent_id=s.consent_id and c.replica_id=s.replica_id
 and c.owner_user_id=s.owner_user_id and c.scope='capture' and c.policy_version=r.policy_version
 and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
 and exists(select 1 from vy_replica_consent c where c.replica_id=s.replica_id and c.owner_user_id=s.owner_user_id
 and c.scope='storage' and c.policy_version=r.policy_version and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))`;
export const PROCESSING_GPU_SQL=Object.freeze({
 authorize:AUTH,
 bind:`with eligible as materialized (${AUTH} for update of j,s,r), begun as (
 update vy_gpu_allocation_window set state='in_flight',begun_at=now()
 where window_id=$9::uuid and budget_id=$10 and request_sha256=$11 and state='reserved' and exists(select 1 from eligible) returning window_id
 ), parent as (insert into vy_processing_gpu_lifecycle(window_id,resource_id,revision_sha256,origin,contract_sha256,state,admission_deadline_at)
 select window_id,$12,$13,$14,$15,'open',to_timestamp($16::double precision/1000.0) from begun returning window_id)
 insert into vy_processing_gpu_authority(window_id,source_id,replica_id,owner_user_id,revision,source_sha256)
 select window_id,$2::uuid,$3::uuid,$4::uuid,$5::int4,$8 from parent returning window_id`,
 claim:`with eligible as materialized (${AUTH} for update of j,s,r), parent as materialized (
 select l.window_id from vy_processing_gpu_lifecycle l join vy_processing_gpu_authority a using(window_id)
 join vy_gpu_allocation_window w using(window_id) where l.window_id=$9::uuid and l.state='open' and l.admission_deadline_at>now()
 and a.source_id=$2::uuid and a.replica_id=$3::uuid and a.owner_user_id=$4::uuid and a.revision=$5::int4 and a.source_sha256=$8
 and w.state='in_flight' and exists(select 1 from eligible) for update of l
 ) insert into vy_processing_gpu_child(window_id,job_sha256,operation,request_sha256,state)
 select window_id,$10,$6,$11,'claimed' from parent on conflict do nothing returning window_id`,
 poll:`with eligible as materialized (${AUTH}) select l.window_id from vy_processing_gpu_lifecycle l
 join vy_processing_gpu_authority a using(window_id) join vy_processing_gpu_child c using(window_id)
 where l.window_id=$9::uuid and l.state='open' and l.admission_deadline_at>now() and a.source_id=$2::uuid
 and a.replica_id=$3::uuid and a.owner_user_id=$4::uuid and a.revision=$5::int4 and a.source_sha256=$8
 and c.job_sha256=$10 and c.request_sha256=$11 and c.state='claimed' and exists(select 1 from eligible)`,
 response:`update vy_processing_gpu_child set state='response_received',response_sha256=$4,response_at=now()
 where window_id=$1::uuid and job_sha256=$2 and request_sha256=$3 and state='claimed' returning window_id`,
 close:`update vy_processing_gpu_lifecycle set state='closed',closed_at=coalesce(closed_at,now())
 where window_id=$1::uuid and state='open' returning window_id`,
 due:`select l.*,w.resource_sha256 from vy_processing_gpu_lifecycle l join vy_gpu_allocation_window w using(window_id)
 where l.resource_id=$1 and l.contract_sha256=$2 and w.resource_released_at is null
 and (l.state='closed' or (l.state='open' and l.admission_deadline_at<=now())) order by l.created_at limit 10`,
 release:`with resource_lock as materialized (select pg_advisory_xact_lock(hashtextextended($2::text,0))), closed as materialized (
 select l.window_id from vy_processing_gpu_lifecycle l join vy_gpu_allocation_window w using(window_id) cross join resource_lock
 where l.window_id=$1::uuid and w.resource_sha256=$2 and l.resource_id=$3 and l.revision_sha256=$4 and l.contract_sha256=$5
 and l.state in ('closed','natural_zero_observed') and l.closed_at<=to_timestamp($6::double precision/1000.0)
 and w.state in ('in_flight','uncertain','accounting_pending') and not exists(select 1 from vy_processing_gpu_child c where c.window_id=l.window_id and c.state='claimed')
 for update of l,w
 ), observed as (update vy_processing_gpu_lifecycle l set state='natural_zero_observed',observation=$7::jsonb from closed c where l.window_id=c.window_id returning l.window_id)
 update vy_gpu_allocation_window w set resource_released_at=coalesce(resource_released_at,now()),resource_release_sha256=coalesce(resource_release_sha256,$8)
 from observed o where w.window_id=o.window_id returning w.window_id`,
});
export function processingGpuPlan(env={}, {recovery=false}={}){
 let p;try{p=JSON.parse(env.AZURE_PROCESSING_GPU_PLAN_JSON||'null');}catch{fail('processing_gpu_plan_invalid');}
 if(!p||p.kind!=='azure-shared-evidence/v1'||p.resource_id!=='/subscriptions/c60a32f6-c812-4c0e-bc42-b6431ee90b8f/resourceGroups/vyakti-voice/providers/Microsoft.App/containerapps/vyakti-voice-evidence'
 || !/^vyakti-voice-evidence--[a-zA-Z0-9-]+$/.test(p.active_revision_name||'')||!HASH.test(p.active_revision_template_sha256||'')
 || !HASH.test(p.revision_sha256||'')||!HASH.test(p.contract_sha256||'')||!HASH.test(p.image_sha256||'')
 ||!Number.isSafeInteger(p.reservation_estimate_microusd)||p.reservation_estimate_microusd<=0
 ||!Number.isSafeInteger(p.planning_allocation_seconds)||p.planning_allocation_seconds<60||p.planning_allocation_seconds>3600
 ||!Number.isSafeInteger(p.dispatch_seconds)||p.dispatch_seconds<60||p.planning_allocation_seconds-p.dispatch_seconds<360
 ||!Number.isSafeInteger(p.rate_microusd_per_second)||p.rate_microusd_per_second<=0
 ||!Number.isSafeInteger(p.contingency_multiplier)||p.contingency_multiplier<1||p.contingency_multiplier>10
 ||p.reservation_estimate_microusd!==p.rate_microusd_per_second*p.contingency_multiplier*p.planning_allocation_seconds
 ||p.hard_invoice_cap!==false||!Number.isSafeInteger(p.expires_at_ms)||(!recovery&&p.expires_at_ms<=Date.now()))fail('processing_gpu_plan_invalid');
 let origin;try{origin=new URL(p.origin);}catch{fail('processing_gpu_plan_invalid');}
 if(origin.protocol!=='https:'||origin.hostname!=='vyakti-voice-evidence.internal.purpletree-6dea69e2.centralindia.azurecontainerapps.io'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password||origin.port)fail('processing_gpu_plan_invalid');
 if((!recovery&&env.AZURE_PROCESSING_GPU_ENABLED!=='1')||env.VYAKTI_MODEL_SERVING!=='azure_only')fail('processing_gpu_disabled');
 return Object.freeze({...p,origin:origin.origin});
}
export function createProcessingGpuAdmission({db,env=process.env,clock=Date.now,meterFactory=createGpuAllocationMeter,observe}={}){
 const parents=new Map();const runNonce=randomUUID();let stopped=false;
 const requirePlan=()=>processingGpuPlan(env);
 async function forStage({leased,source}){
  if(!PROCESSING_GPU_STAGES.includes(leased.job.step))return null;
  const p=requirePlan();if(stopped)fail('processing_gpu_run_closed');
  const job=leased.job,args=[job.job_id,source.source_id,source.replica_id,source.owner_user_id,job.revision,job.step,leaseTokenHash(leased.leaseToken),source.sha256];
  if(args.slice(0,4).some(x=>!UUID.test(x||'')))fail('processing_gpu_source_invalid');
  const authorize=async()=>{if((await db(PROCESSING_GPU_SQL.authorize,args)).length!==1)fail('processing_gpu_authority_changed');};
  await authorize();
  const sourceKey=hash({source:source.source_id,replica:source.replica_id,owner:source.owner_user_id,revision:job.revision,sha256:source.sha256});
  let parent=parents.get(sourceKey);
  if(!parent){
   if(typeof observe!=='function')fail('processing_gpu_observer_required');
   const metadata=await observe(p);
   if(metadata?.resource_id!==p.resource_id||metadata.revision_sha256!==p.revision_sha256||metadata.image_sha256!==p.image_sha256)fail('processing_gpu_deployment_changed');
   await authorize();
   const deadline=Math.min(p.expires_at_ms,clock()+p.dispatch_seconds*1000);
   const controller={kind:'azure-shared-evidence-controller/v1',async authorizeWindow({request_sha256}){await authorize();return {...p,request_sha256,resource_sha256:sha256Hex(p.resource_id),kind:'azure-shared-evidence/v1'};}};
   const limit=Number(env.AZURE_PROCESSING_GPU_LIMIT_MICROUSD);
   const meter=meterFactory({db,budgetId:env.AZURE_PROCESSING_GPU_BUDGET_ID,limitMicrousd:limit,controller});
   const request=hash({kind:'ordinary-source-evidence/v1',sourceKey,runNonce,contract:p.contract_sha256});
   const reservation=await meter.reserve({request_sha256:request,preparation_id:null,job_id:sourceKey,step:'whole_source',max_dispatches:1});
   if(reservation.recovered)fail('processing_gpu_allocation_already_claimed');
   // Begin and durable authority are one statement: no invisible begun parent.
   const rows=await db(PROCESSING_GPU_SQL.bind,[...args,reservation.window_id,reservation.budget_id,reservation.request_sha256,p.resource_id,p.revision_sha256,p.origin,p.contract_sha256,deadline]);
   if(rows.length!==1){await meter.releaseBeforeBegin(reservation);fail('processing_gpu_authority_changed');}
   parent={reservation,meter,p,deadline};parents.set(sourceKey,parent);
  }
  const jobHash=hash({job:job.job_id,revision:job.revision});let requestHash=null;
  const boundary=async()=>{if(stopped||clock()>=parent.deadline)fail('processing_gpu_deadline');await authorize();};
  return Object.freeze({
   assertProviderOrigin(origin){if(origin!==parent.p.origin)fail('processing_gpu_origin_mismatch');},
   deadlineSignal(){const remaining=parent.deadline-clock();if(remaining<=0||stopped)fail('processing_gpu_deadline');return AbortSignal.timeout(remaining);},
   async beforePrivateRead(){await boundary();},
   async beforeProviderRequest({operation,requestSha256}){
    if(operation!==job.step||requestHash||!HASH.test(requestSha256||''))fail('processing_gpu_child_invalid');
    await boundary();const rows=await db(PROCESSING_GPU_SQL.claim,[...args,parent.reservation.window_id,jobHash,requestSha256]);
    if(rows.length!==1)fail('processing_gpu_child_already_claimed');requestHash=requestSha256;
   },
   async beforeProviderPoll(){await boundary();if(!requestHash||!(await db(PROCESSING_GPU_SQL.poll,[...args,parent.reservation.window_id,jobHash,requestHash])).length)fail('processing_gpu_authority_changed');},
   async afterProviderResponse(response){if(response.request_sha256!==requestHash||!HASH.test(response.response_sha256||''))fail('processing_gpu_response_invalid');
    if((await db(PROCESSING_GPU_SQL.response,[parent.reservation.window_id,jobHash,requestHash,response.response_sha256])).length!==1)fail('processing_gpu_response_unknown');},
  });
 }
 async function closeAll(){stopped=true;const results=await Promise.allSettled([...parents.values()].map(async p=>{await db(PROCESSING_GPU_SQL.close,[p.reservation.window_id]);await p.meter.markUncertain(p.reservation);}));if(results.some(x=>x.status==='rejected'))fail('processing_gpu_close_uncertain');}
 return Object.freeze({forStage,closeAll});
}
// Trusted metadata observer only. A natural zero observation never means a
// deactivated exclusive allocation or a settled invoice. No ARM mutation here.
export async function releaseNaturallyIdleProcessingGpu({db,plan,observation,clock=Date.now}){
 if(observation?.kind!=='azure-shared-evidence-observation/v1'||observation.resource_id!==plan.resource_id||observation.revision_sha256!==plan.revision_sha256
 ||observation.image_sha256!==plan.image_sha256||!Number.isSafeInteger(observation.observed_at_ms)||clock()-observation.observed_at_ms<0||clock()-observation.observed_at_ms>30000
 ||!Array.isArray(observation.revisions)||!observation.revisions.length||observation.revisions.some(r=>!r.name||r.replicas!==0))fail('processing_gpu_natural_zero_required');
 const due=await db(PROCESSING_GPU_SQL.due,[plan.resource_id,plan.contract_sha256]);let released=0;
 for(const row of due){await db(PROCESSING_GPU_SQL.close,[row.window_id]);const proof=canonicalJson(observation);released+=(await db(PROCESSING_GPU_SQL.release,[row.window_id,sha256Hex(plan.resource_id),plan.resource_id,plan.revision_sha256,plan.contract_sha256,observation.observed_at_ms,proof,sha256Hex(proof)])).length;}
 return {released,accounted:false,monetary_liability:'held',forced_deactivation:false};
}
