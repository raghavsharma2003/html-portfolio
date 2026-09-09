import {isolatedJobPlan,deploymentTemplate,commitment} from '../azure-gpu-job/controller.mjs';
export const WORKLOAD='synthetic-stock-comparison106-v1';
export const BASE_IMAGES=Object.freeze({
  chatterbox:'vyaktivoiceacr.azurecr.io/open-voice-runtime@sha256:625edc223f7063e744d6463dd7443daeaa7097552997a7a4e47c99888cfa86d8',
  voxcpm2:'vyaktivoiceacr.azurecr.io/voxcpm2-eval@sha256:40df335c38bf98b2eee6bf496c2f7ac9285c6bd572014abc7d7662134436f697',
});
const fail=code=>{throw Object.assign(new Error(code),{code});};

export function stockJobPlans(input){
  if(input?.contract!=='vyakti-stock-job-provision-input/v1'||!Array.isArray(input.jobs)||input.jobs.length!==2
    ||input.jobs.map(j=>j.arm).join(',')!=='chatterbox,voxcpm2')fail('stock_job_input_invalid');
  if(!/^[0-9a-f]{64}$/.test(input.planSha256||''))fail('stock_job_plan_hash_missing');
  const jobs=input.jobs.map(j=>{
    if(j.baseImage!==BASE_IMAGES[j.arm]||j.image===j.baseImage||!/^[0-9a-f]{64}$/.test(j.manifestSha256||''))fail('stock_overlay_required');
    if(!j.jobId?.endsWith(`/vyakti-stock106-${j.arm}`))fail('stock_job_name_invalid');
    const plan=isolatedJobPlan({...j,workload:WORKLOAD,replicaTimeout:900});
    return {arm:j.arm,contextPath:j.contextPath,manifestSha256:j.manifestSha256,plan,deployment:deploymentTemplate(plan)};
  });
  if(jobs[0].plan.job_id===jobs[1].plan.job_id)fail('stock_job_targets_duplicate');
  return {contract:'vyakti-stock-jobs106/v1',planSha256:input.planSha256,enabled:false,jobs,sequence:'serial_terminal_observation_required',
    totalSynthesisCalls:12,retries:0,newTables:0,ownerRoutesChanged:false,
    requirements:{t4Replicas:1,cpu:8,memoryGiB:56,eachJobTimeoutSeconds:900,
      planningHeadroomSecondsPerJob:360,aggregatePlanningAllocationSeconds:2520,
      budgetReservationMicrousd:null,currentRateMicrousdPerSecond:null,hardInvoiceCap:false,
      outputTransport:'bounded_hash_checked_job_log_artifacts',outputCompleteness:'must verify every chunk and job terminal receipt'},
    sourceCommitment:commitment(jobs.map(j=>({arm:j.arm,manifestSha256:j.manifestSha256,configuration:j.plan.configuration_sha256}))),
    admission:null};
}

// No new scheduler/ledger. The caller supplies the existing supervised Job API.
// A started or ambiguously-started arm is never retried. No model-generated result
// can authorize the next Job; only the durable ARM execution observer does so.
export async function runStockJobs(envelope,{approvedSha256,makeSupervisor,journal,sleep,assertObserver,captureAndCollect,now=Date.now}={}){
  if(envelope?.enabled!==true||approvedSha256!==commitment(envelope)||envelope.contract!=='vyakti-stock-jobs106/v1')fail('stock_jobs_disabled');
  if([makeSupervisor,journal,sleep,assertObserver,captureAndCollect].some(fn=>typeof fn!=='function'))fail('stock_job_dependencies_missing');
  if(envelope.jobs?.map(j=>j.arm).join(',')!=='chatterbox,voxcpm2'||!Array.isArray(envelope.policies)||envelope.policies.length!==2)fail('stock_job_sequence_invalid');
  if(!/^[0-9a-f]{64}$/.test(envelope.planSha256||''))fail('stock_job_plan_hash_missing');
  if(!envelope.admission||envelope.admission.kind!=='reviewed-stock-job-admission/v1'||envelope.admission.planSha256!==envelope.planSha256)fail('stock_job_admission_required');
  if(!/^[0-9a-f]{64}$/.test(envelope.admission.approvalSha256||'')
    ||!Number.isSafeInteger(envelope.admission.maximumReservationMicrousd)||envelope.admission.maximumReservationMicrousd<1)fail('stock_job_budget_required');
  let totalReservation=0;
  for(const policy of envelope.policies){
    if(!Number.isSafeInteger(policy.rateMicrousdPerSecond)||policy.rateMicrousdPerSecond<1
      ||!Number.isSafeInteger(policy.limitMicrousd)||policy.limitMicrousd<1||!/^gpu-[a-z0-9_-]+$/.test(policy.budgetId||''))fail('stock_job_budget_required');
    totalReservation+=1260*policy.rateMicrousdPerSecond;
  }
  if(!Number.isSafeInteger(totalReservation)||totalReservation>envelope.admission.maximumReservationMicrousd)fail('stock_job_budget_exceeded');
  const completed=[];
  for(let index=0;index<2;index++){
    const job=envelope.jobs[index],policy=envelope.policies[index];
    const expected=isolatedJobPlan({jobId:job.plan.job_id,environmentId:job.plan.properties.environmentId,
      workloadProfileName:job.plan.properties.workloadProfileName,image:job.plan.properties.template?.containers?.[0]?.image,
      replicaTimeout:900,workload:WORKLOAD});
    if(!job.plan.job_id.endsWith(`/vyakti-stock106-${job.arm}`)||commitment(expected)!==commitment(job.plan)
      ||!/^[0-9a-f]{64}$/.test(job.manifestSha256||''))fail('stock_job_plan_changed');
    if(job.plan.workload!==WORKLOAD||job.plan.properties.configuration.replicaRetryLimit!==0||job.plan.properties.configuration.replicaTimeout!==900
      ||policy.configurationSha256!==job.plan.configuration_sha256||policy.approvalSha256!==envelope.admission.approvalSha256
      ||policy.planningHeadroomSeconds!==360)fail('stock_job_policy_mismatch');
    const supervisor=makeSupervisor(job.plan,policy);
    const experiment=commitment({purpose:WORKLOAD,arm:job.arm,plan:envelope.planSha256,manifest:job.manifestSha256,admission:envelope.admission});
    let started,observed;
    try{
      await assertObserver();
      await journal({kind:'start_intent',arm:job.arm,experiment});
      started=await supervisor.start(experiment);
      await journal({kind:'started',arm:job.arm,...started});
      const stopAt=now()+1260000;
      while(now()<stopAt){
        await assertObserver();
        observed=await supervisor.supervise(started.window_id);
        await journal({kind:'observation',arm:job.arm,...observed});
        if(observed.terminal===true)break;
        await sleep(15000);
      }
      if(observed?.terminal!==true||observed.state!=='Succeeded')fail('stock_job_terminal_success_unproved');
      const capture=await captureAndCollect({job,started,observed,planSha256:envelope.planSha256});
      if(capture?.kind!=='stock106-verified-job-artifacts/v1'||capture.windowId!==started.window_id
        ||capture.planSha256!==envelope.planSha256||capture.arm!==job.arm||capture.outputs!==6
        ||capture.manifestSha256!==job.manifestSha256||!/^[0-9a-f]{64}$/.test(capture.captureSha256||''))fail('stock_job_artifacts_unverified');
      await journal({kind:'artifacts_verified',arm:job.arm,...capture});
      completed.push({arm:job.arm,window_id:started.window_id,observation:observed,capture});
    }finally{
      if(started?.window_id&&observed?.terminal!==true){
        // Known execution cleanup is attempted even if journaling itself fails.
        // The independent watcher continues recovery/observation after this CLI exits.
        try{const cleanup=await supervisor.supervise(started.window_id,{cancel:true});
          await journal({kind:'cleanup_observed',arm:job.arm,...cleanup});
        }catch{await journal({kind:'cleanup_unknown',arm:job.arm,windowId:started.window_id,fundsHeld:true}).catch(()=>{});}
      }
    }
  }
  return {completed,accountingState:'held_pending_attributable_usage',modelQuality:'unscored'};
}
