import {canonicalJson,sha256Hex} from './_provenance/contracts.js';

const hash=/^[0-9a-f]{64}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail=code=>{throw Object.assign(new Error(code),{code,status:503});};
const digest=value=>{if(!hash.test(value||''))fail('gpu_commitment_invalid');return value;};
const amount=value=>{if(!Number.isSafeInteger(value)||value<=0)fail('gpu_reservation_invalid');return value;};

export const GPU_WINDOW_SQL=Object.freeze({
 reserve:`with budget as materialized (
  select budget_id from vy_provider_budget where budget_id=$1 and state='active'
   and limit_microusd=$2 and spent_microusd+reserved_microusd+$7<=limit_microusd for update
 ), inserted as (
  insert into vy_gpu_allocation_window(budget_id,resource_sha256,revision_sha256,request_sha256,contract_sha256,provider_request_sha256,reserved_microusd,max_allocation_seconds,state)
  select budget_id,$3,$4,$5,$6,$9,$7,$8,'reserved' from budget on conflict do nothing returning *
 ), charged as (
  update vy_provider_budget b set reserved_microusd=b.reserved_microusd+w.reserved_microusd,updated_at=now()
  from inserted w where b.budget_id=w.budget_id returning b.budget_id
 ) select w.* from inserted w join charged c using(budget_id)`,
 existing:`select * from vy_gpu_allocation_window where budget_id=$1 and request_sha256=$2`,
 begin:`update vy_gpu_allocation_window set state='in_flight',begun_at=now()
  where window_id=$1::uuid and budget_id=$2 and request_sha256=$3 and state='reserved' returning *`,
 response:`update vy_gpu_allocation_window set state='accounting_pending',response_sha256=$4
  where window_id=$1::uuid and budget_id=$2 and request_sha256=$3 and state='in_flight' returning *`,
 uncertain:`update vy_gpu_allocation_window set state='uncertain'
  where window_id=$1::uuid and budget_id=$2 and request_sha256=$3 and state='in_flight' returning *`,
 release:`with released as (
  update vy_gpu_allocation_window set state='released',finished_at=now()
  where window_id=$1::uuid and budget_id=$2 and request_sha256=$3 and state='reserved'
  returning budget_id,reserved_microusd
 ), returned as (
  update vy_provider_budget b set reserved_microusd=b.reserved_microusd-w.reserved_microusd,updated_at=now()
  from released w where b.budget_id=w.budget_id returning b.budget_id
 ) select * from returned`,
 reconcile:`with settled as (
  update vy_gpu_allocation_window set state='settled',actual_microusd=$4,usage_sha256=$5,finished_at=now()
  where window_id=$1::uuid and budget_id=$2 and request_sha256=$3
  and state in ('in_flight','uncertain','accounting_pending') and $4>=0 and $4<=reserved_microusd
  returning budget_id,reserved_microusd,actual_microusd
 ), charged as (
  update vy_provider_budget b set reserved_microusd=b.reserved_microusd-w.reserved_microusd,
   spent_microusd=b.spent_microusd+w.actual_microusd,updated_at=now(),
   state=case when b.spent_microusd+w.actual_microusd>=b.limit_microusd then 'exhausted' else b.state end
  from settled w where b.budget_id=w.budget_id returning b.budget_id
 ) select * from charged`,
});

// The controller is a trusted server dependency, never request data or an env
// flag. None ships today. Its grant must bound all allocation startup/tail,
// replicas, CPU, memory and ancillary charges and exclude other dispatchers.
// Ordinary Container Apps request timeout and minReplicas=0 do not do that.
export function createGpuAllocationMeter({db,budgetId,limitMicrousd,controller}={}){
 if(typeof db!=='function'||!/^[a-z][a-z0-9_-]{2,63}$/.test(budgetId||''))fail('gpu_budget_configuration_invalid');
 amount(limitMicrousd);
 const requireController=()=>{
  if(controller?.kind!=='azure-finite-allocation-controller/v1'||typeof controller.authorizeWindow!=='function')fail('gpu_finite_allocation_unavailable');
 };
 const params=r=>{
  if(!uuid.test(r?.window_id||'')||r.budget_id!==budgetId)fail('gpu_reservation_invalid');
  return[r.window_id,budgetId,digest(r.request_sha256)];
 };
 return Object.freeze({kind:'azure-container-infrastructure/v1',
  async assertReady(){requireController();},
  async reserve(input){
   requireController();
   const request=digest(input?.request_sha256);
   if(input.max_dispatches!==1)fail('gpu_dispatch_limit_invalid');
   // The content-free key is scoped by work identity without retaining it.
   const key=sha256Hex(canonicalJson({request,preparation:input.preparation_id,job:input.job_id,step:input.step}));
   const grant=await controller.authorizeWindow({request_sha256:key});
   if(grant?.kind!=='azure-finite-allocation/v1'||grant.request_sha256!==key)fail('gpu_finite_allocation_invalid');
   const cost=amount(grant.upper_bound_microusd),seconds=amount(grant.max_allocation_seconds);
   if(seconds>3600)fail('gpu_window_too_long');
   const bindings=[digest(grant.resource_sha256),digest(grant.revision_sha256),key,digest(grant.contract_sha256)];
   let rows=await db(GPU_WINDOW_SQL.reserve,[budgetId,limitMicrousd,...bindings,cost,seconds,request]);
   const recovered=!rows.length;
   if(recovered)rows=await db(GPU_WINDOW_SQL.existing,[budgetId,key]);
   const row=rows[0];
   if(!row||row.provider_request_sha256!==request||row.resource_sha256!==bindings[0]||row.revision_sha256!==bindings[1]||row.contract_sha256!==bindings[3]
    ||Number(row.reserved_microusd)!==cost||Number(row.max_allocation_seconds)!==seconds)fail('gpu_budget_reservation_refused');
   return {...row,recovered,receipt_sha256:sha256Hex(canonicalJson({window_id:row.window_id,budget_id:budgetId,request_sha256:key,contract_sha256:bindings[3],reserved_microusd:cost}))};
  },
  async begin(reservation){
   requireController();
   if(reservation?.recovered===true)fail('gpu_dispatch_already_started');
   const rows=await db(GPU_WINDOW_SQL.begin,params(reservation));
   // An idempotent retry never gives a second dispatch permission. A lost
   // acknowledgement strands funds; it cannot authorize another wake.
   if(rows.length!==1)fail('gpu_dispatch_already_started');
   return {dispatch_authorized:true,window_id:rows[0].window_id};
  },
  async recordResponse(reservation,response){
   if(digest(response?.request_sha256)!==reservation.provider_request_sha256)fail('gpu_response_binding_invalid');
   if(!Number.isInteger(response.http_status)||response.http_status<100||response.http_status>599)fail('gpu_response_status_invalid');
   const commitment=sha256Hex(canonicalJson({window_id:reservation.window_id,request_sha256:response.request_sha256,response_sha256:digest(response.response_sha256),http_status:response.http_status}));
   const rows=await db(GPU_WINDOW_SQL.response,[...params(reservation),commitment]);
   if(rows.length!==1)fail('gpu_response_recording_uncertain');
   return {response_recorded:true,accounting_state:'accounting_pending',accounted:false,receipt_sha256:commitment};
  },
  async markUncertain(reservation){return db(GPU_WINDOW_SQL.uncertain,params(reservation));},
  async releaseBeforeBegin(reservation){if(reservation?.recovered===true)return [];return db(GPU_WINDOW_SQL.release,params(reservation));},
 });
}

// Deliberately separate from the request executor. Raw HTTP timing or a model
// response cannot invoke reconciliation. A trusted attributable Azure usage
// verifier must prove the entire exclusive allocation has terminated.
export async function reconcileGpuAllocation({db,reservation,usageVerifier,evidence}={}){
 if(typeof db!=='function'||typeof usageVerifier?.verifyClosedAllocation!=='function')fail('gpu_usage_verifier_unavailable');
 if(!uuid.test(reservation?.window_id||''))fail('gpu_reservation_invalid');
 const persisted=(await db(GPU_WINDOW_SQL.existing,[reservation.budget_id,digest(reservation.request_sha256)]))[0];
 if(!persisted||persisted.window_id!==reservation.window_id)fail('gpu_reservation_invalid');
 reservation=persisted;
 const verified=await usageVerifier.verifyClosedAllocation({window_id:reservation.window_id,evidence});
 if(verified?.kind!=='azure-closed-allocation-usage/v1'||verified.window_id!==reservation.window_id
  ||verified.resource_sha256!==reservation.resource_sha256||verified.revision_sha256!==reservation.revision_sha256
  ||verified.contract_sha256!==reservation.contract_sha256||verified.allocation_terminated!==true
  ||!Number.isSafeInteger(verified.actual_microusd)||verified.actual_microusd<0)fail('gpu_attributable_usage_required');
 const rows=await db(GPU_WINDOW_SQL.reconcile,[reservation.window_id,reservation.budget_id,digest(reservation.request_sha256),verified.actual_microusd,digest(verified.usage_sha256)]);
 if(rows.length!==1)fail('gpu_reconciliation_refused');
 return {accounting_state:'settled',accounted:true};
}
