import {createGpuAllocationMeter} from '../../api/_gpu-allocation-budget.js';
import {API_VERSION,commitment,createAzureJobInspector,windowExecutionTemplate} from './controller.mjs';

const fail = code => { throw Object.assign(new Error(code),{code}); };
export const JOB_SQL = Object.freeze({
 bind: `update vy_gpu_allocation_window set azure_job_id=$4,job_configuration_sha256=$5,
   job_runtime_seconds=$6,job_control_state='start_claimed',job_prestart_inventory=$7::jsonb,
   job_start_requested_at=now(),job_execution_template_sha256=$8
   where window_id=$1::uuid and budget_id=$2 and request_sha256=$3 and state='in_flight'
   and job_control_state is null returning *`,
 started: `update vy_gpu_allocation_window set azure_execution_name=$4,job_control_state='running'
   where window_id=$1::uuid and budget_id=$2 and request_sha256=$3 and job_control_state='start_claimed' returning *`,
 unknown: `update vy_gpu_allocation_window set job_control_state='start_unknown'
   where window_id=$1::uuid and budget_id=$2 and request_sha256=$3 and job_control_state='start_claimed' returning *`,
 read: `select w.*,w.job_start_requested_at::text as job_start_requested_at,w.begun_at::text as begun_at
   from vy_gpu_allocation_window w where window_id=$1::uuid and budget_id=$2`,
 recover: `update vy_gpu_allocation_window set azure_execution_name=$3,job_recovery_sha256=$4,job_control_state='running'
   where window_id=$1::uuid and budget_id=$2 and azure_execution_name is null
   and job_control_state in ('start_claimed','start_unknown')
   and job_prestart_inventory=$5::jsonb and job_start_requested_at=$6::timestamptz
   and job_configuration_sha256=$7 and job_execution_template_sha256=$8 returning *`,
 stop: `update vy_gpu_allocation_window set job_control_state='stop_requested'
   where window_id=$1::uuid and budget_id=$2 and job_control_state in ('running','stop_pending','stop_requested','observation_unknown') returning *`,
 observed: `update vy_gpu_allocation_window set job_control_state=$3,job_observation_sha256=$4,
   job_terminal_at=case when $3='terminal_observed' then now() else null end
   where window_id=$1::uuid and budget_id=$2 and job_control_state in ('running','stop_requested','stop_pending','observation_unknown') returning *`,
});

// Bounded operational experiment, NOT an absolute invoice cap. The dedicated
// GPU budget must already exist and equal policy.limitMicrousd. Never reuse
// the owner's separately capped text experiment ledger silently.
export function createGpuJobSupervisor({db,plan,policy,getToken,fetchImpl=globalThis.fetch,now=()=>Date.now()}) {
  if (typeof db !== 'function' || !/^gpu-[a-z0-9_-]+$/.test(policy?.budgetId||'')) fail('gpu_experiment_budget_required');
  for (const key of ['limitMicrousd','rateMicrousdPerSecond','planningHeadroomSeconds']) {
    if (!Number.isSafeInteger(policy[key]) || policy[key]<=0) fail('gpu_experiment_policy_invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(policy.approvalSha256||'') || policy.configurationSha256!==plan.configuration_sha256) fail('gpu_experiment_approval_required');
  const seconds=plan.properties.configuration.replicaTimeout+policy.planningHeadroomSeconds;
  if (seconds>3600) fail('gpu_experiment_window_invalid');
  const estimate=seconds*policy.rateMicrousdPerSecond;
  if (!Number.isSafeInteger(estimate)||estimate>policy.limitMicrousd) fail('gpu_experiment_estimate_exceeds_budget');
  const inspector=createAzureJobInspector({plan,getToken,fetchImpl});
  const budget=createGpuAllocationMeter({db,budgetId:policy.budgetId,limitMicrousd:policy.limitMicrousd,
    controller:{kind:'azure-supervised-job-controller/v1',authorizeWindow:async({request_sha256})=>({
      kind:'azure-supervised-job/v1',request_sha256,resource_sha256:commitment(plan.job_id),
      revision_sha256:plan.configuration_sha256,
      contract_sha256:commitment({plan:plan.configuration_sha256,policy}),
      reservation_estimate_microusd:estimate,planning_allocation_seconds:seconds,
    })}});
  const params=r=>[r.window_id,r.budget_id,r.request_sha256];
  async function load(windowId) {
    if (!/^[0-9a-f-]{36}$/.test(windowId||'')) fail('gpu_window_id_invalid');
    const row=(await db(JOB_SQL.read,[windowId,policy.budgetId]))[0];
    if (!row||row.azure_job_id!==plan.job_id||row.job_configuration_sha256!==plan.configuration_sha256) fail('gpu_job_window_binding_invalid');
    return row;
  }
  return Object.freeze({
    estimate: Object.freeze({reserved_microusd:estimate,runtime_seconds:plan.properties.configuration.replicaTimeout,
      planning_headroom_seconds:policy.planningHeadroomSeconds,hard_invoice_cap:false}),
    async start(experimentId) {
      if (!/^[0-9a-f]{64}$/.test(experimentId||'')) fail('gpu_experiment_id_invalid');
      // Read-only preflight before reserving or waking. The approved digest
      // pins command/image/resources. No request-body overrides from callers.
      await inspector.inspect();
      const inventory=await inspector.inventory();
      const reservation=await budget.reserve({request_sha256:experimentId,preparation_id:'gpu-control-probe',
        job_id:plan.job_id,step:'gpu-control-probe',max_dispatches:1});
      if (reservation.recovered) fail('gpu_experiment_already_claimed');
      await budget.begin(reservation);
      const executionTemplate=windowExecutionTemplate(plan,reservation.window_id);
      const bound=await db(JOB_SQL.bind,[...params(reservation),plan.job_id,plan.configuration_sha256,plan.properties.configuration.replicaTimeout,JSON.stringify(inventory),commitment(executionTemplate)]);
      if (bound.length!==1) fail('gpu_job_binding_failed');
      try {
        const token=await getToken();
        if (!token||/[\r\n]/.test(token)) fail('gpu_arm_token_unavailable');
        const response=await fetchImpl(`https://management.azure.com${plan.job_id}/start?api-version=${API_VERSION}`,{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
          headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','x-ms-client-request-id':reservation.window_id},
          body:JSON.stringify(executionTemplate),
        });
        // Azure start is not assumed idempotent. 202 or lost response keeps
        // funds and dispatch ownership; no retry, no inferred execution name.
        if (response.status!==200) fail('gpu_start_outcome_unknown');
        const execution=await response.json();
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(execution.name||'')
          ||execution.id!==`${plan.job_id}/executions/${execution.name}`) fail('gpu_start_binding_invalid');
        const saved=await db(JOB_SQL.started,[...params(reservation),execution.name]);
        if (saved.length!==1) fail('gpu_start_recording_uncertain');
        return {window_id:reservation.window_id,execution_name:execution.name,state:'running',accounting_state:'accounting_pending',...this.estimate};
      } catch {
        await db(JOB_SQL.unknown,params(reservation)).catch(()=>[]);
        await budget.markUncertain(reservation).catch(()=>[]);
        fail('gpu_start_outcome_unknown');
      }
    },
    async supervise(windowId,{cancel=false}={}) {
      let row=await load(windowId);
      if(row.job_control_state==='terminal_observed')return {window_id:windowId,state:'terminal_observed',terminal:true,accounting_state:'accounting_pending'};
      if (!row.azure_execution_name) {
        const recovered=await inspector.recover(row);
        const saved=await db(JOB_SQL.recover,[windowId,policy.budgetId,recovered.execution_name,recovered.recovery_sha256,
          JSON.stringify(row.job_prestart_inventory),row.job_start_requested_at,plan.configuration_sha256,row.job_execution_template_sha256]);
        row=saved[0]||await load(windowId);
        // A competing recovery can be reused only if it bound the same exact
        // execution. Persisted identity always precedes any stop request.
        if(row.azure_execution_name!==recovered.execution_name)fail('gpu_recovery_identity_conflict');
      }
      let observation;
      const begun=Date.parse(row.begun_at);
      if (!Number.isFinite(begun)) fail('gpu_job_begin_time_invalid');
      if (cancel||now()>=begun+row.job_runtime_seconds*1000) {
        await db(JOB_SQL.stop,[windowId,policy.budgetId]);
        observation=await inspector.stop(row.azure_execution_name,row.job_execution_template_sha256?row.window_id:undefined);
      } else observation=await inspector.observe(row.azure_execution_name,row.job_execution_template_sha256?row.window_id:undefined);
      const state=observation.terminal?'terminal_observed':observation.state==='stop_pending'?'stop_pending':observation.state==='unknown'?'observation_unknown':'running';
      const saved=await db(JOB_SQL.observed,[windowId,policy.budgetId,state,commitment(observation)]);
      if (saved.length!==1) fail('gpu_job_observation_not_saved');
      return {window_id:windowId,...observation};
    },
  });
}
