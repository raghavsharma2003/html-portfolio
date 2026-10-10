import { randomUUID } from 'node:crypto';
import {prepareProviderRevisionBinding,verifyProviderRevision,assertSameReportedRevision} from './_dialogue/provider-revision.js';
import { canonicalJson,sha256Hex } from './_provenance/contracts.js';
import { buildFeedbackDatasetDefinition,FEEDBACK_DATASET_REVIEW_SQL } from './_replica-feedback-dataset.js';
import { loadOwnedFeedbackLearningExample } from './_replica-feedback.js';
import { loadOwnedRuntimeContext,OWNED_RUNTIME_CONTEXT_SQL } from './_replica-runtime.js';
import { REPLICA_POLICY_VERSION } from './_replica.js';
import { registerOwnedCandidate } from './_replica-candidate-qualification.js';
import { prepareCorrectionStrategyRequest,validateCorrectionStrategyProposal,CORRECTION_REQUEST_SCHEMA } from './_replica-correction-request.js';
import { buildPrivateCorrectionArtifact } from './_replica-correction-artifact.js';
import { foundryBudgetConfig,reserveFoundrySpend,beginFoundrySpend,settleFoundrySpend,
  markFoundrySpendUncertain,releaseFoundrySpendBeforeCall } from './_provider-budget.js';
const hash=value=>sha256Hex(canonicalJson(value));
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const parsed=value=>typeof value==='string'?JSON.parse(value):value;
export const CORRECTION_CANDIDATE_PROTOCOL='vyakti.correction-candidate.v2';
const uuid=value=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))fail('correction_candidate_id_invalid',400);return value.toLowerCase();};
function scope(input){return{replica_id:uuid(input?.replica_id),dataset_id:uuid(input?.dataset_id)};}
function receipt(row){return row?{job_id:row.job_id,replica_id:row.replica_id,dataset_id:row.dataset_id,state:row.state,
  candidate_id:row.state==='draft'?row.candidate_id:null,created_at:row.created_at,updated_at:row.updated_at,
  active_changed:false}:null;}

export const CORRECTION_DATASET_SQL=`select d.* from vy_replica_feedback_dataset d
 join vy_replica r on r.replica_id=d.replica_id and r.owner_user_id=d.owner_user_id
 where d.replica_id=$1::uuid and d.owner_user_id=$2::uuid and d.dataset_id=$3::uuid
 and d.status='draft' and r.lifecycle='active' and r.subject_mode='self'`;
export const CORRECTION_JOB_READ_SQL=`select j.* from vy_replica_correction_candidate_job j
 join vy_replica r on r.replica_id=j.replica_id and r.owner_user_id=j.owner_user_id
 where j.replica_id=$1::uuid and j.owner_user_id=$2::uuid and j.dataset_id=$3::uuid
 order by j.created_at desc,j.job_id desc limit 1`;
export async function readOwnedCorrectionCandidate(db,owner,input){const s=scope(input);return receipt((await db(CORRECTION_JOB_READ_SQL,[s.replica_id,owner,s.dataset_id]))[0]);}
async function completedReceipt(db,owner,b,jobId){return receipt((await db(`select * from vy_replica_correction_candidate_job
 where replica_id=$1::uuid and owner_user_id=$2::uuid and dataset_id=$3::uuid and job_id=$4::uuid`,
 [b.replica_id,owner,b.dataset_id,jobId]))[0]);}

export const CORRECTION_CURRENT_AUTHORITY_SQL=`with runtime as (${OWNED_RUNTIME_CONTEXT_SQL}),
 evidence as (${FEEDBACK_DATASET_REVIEW_SQL})
 select d.dataset_id,runtime.capability_id from vy_replica_feedback_dataset d,runtime,evidence
 where d.dataset_id=$4::uuid and d.replica_id=$1::uuid and d.owner_user_id=$2::uuid
 and d.status='draft' and d.source_set_hash=$5 and runtime.capability_id=$6::uuid
 and runtime.profile_definition=$7::jsonb and runtime.calibration_definition=$8::jsonb
 and evidence.capability_id=runtime.capability_id
 and evidence.saved_dataset->>'dataset_id'=d.dataset_id::text
 and evidence.feedback_rows @> $9::jsonb and $9::jsonb @> evidence.feedback_rows
 and jsonb_array_length(evidence.feedback_rows)=jsonb_array_length($9::jsonb)
 and evidence.assignments @> $10::jsonb and $10::jsonb @> evidence.assignments
 and jsonb_array_length(evidence.assignments)=jsonb_array_length($10::jsonb)`;
export const CORRECTION_JOB_INSERT_SQL=`insert into vy_replica_correction_candidate_job
 (job_id,dataset_id,replica_id,owner_user_id,source_set_hash,protocol,model_commitment,state)
 select $4::uuid,d.dataset_id,d.replica_id,d.owner_user_id,d.source_set_hash,$5,$6,'preparing'
 from vy_replica_feedback_dataset d join vy_replica r on r.replica_id=d.replica_id and r.owner_user_id=d.owner_user_id
 where d.replica_id=$1::uuid and d.owner_user_id=$2::uuid and d.dataset_id=$3::uuid
 and d.status='draft' and d.source_set_hash=$7 and r.lifecycle='active'
 on conflict (dataset_id,model_commitment,protocol) do nothing returning *`;
export const CORRECTION_JOB_VERSION_READ_SQL=`select * from vy_replica_correction_candidate_job
 where replica_id=$1::uuid and owner_user_id=$2::uuid and dataset_id=$3::uuid and model_commitment=$4 and protocol=$5`;
export function authorityParams(b,owner){return[b.replica_id,owner,REPLICA_POLICY_VERSION,b.dataset_id,b.dataset.source_set_hash,
 b.runtime.capability.capability_id,JSON.stringify(b.runtime.personProfile.definition),JSON.stringify(b.runtime.calibration.definition),
 JSON.stringify(b.feedbackRows),JSON.stringify(b.assignments)];}

export async function basis(db,owner,input){
 const s=scope(input);
 const runtime=await loadOwnedRuntimeContext(db,owner,s.replica_id);
 if(!runtime)fail('correction_candidate_runtime_unavailable');
 const reviewed=(await db(FEEDBACK_DATASET_REVIEW_SQL,[s.replica_id,owner,REPLICA_POLICY_VERSION]))[0];
 if(!reviewed?.capability_id)fail('correction_candidate_review_changed');
 const feedbackRows=parsed(reviewed.feedback_rows),assignments=parsed(reviewed.assignments);
 const built=buildFeedbackDatasetDefinition(feedbackRows,assignments,{replica_id:s.replica_id,
   capability_id:reviewed.capability_id,profile_version:reviewed.profile_version,calibration_version:reviewed.calibration_version});
 const rows=await db(CORRECTION_DATASET_SQL,[s.replica_id,owner,s.dataset_id]),dataset=rows[0];
 if(!dataset||parsed(reviewed.saved_dataset)?.dataset_id!==s.dataset_id
   ||!built.readiness.ready_for_candidate_dataset||built.source_set_hash!==input.expected_source_set_hash
   ||dataset.source_set_hash!==built.source_set_hash)fail('correction_candidate_review_changed');
 const definition=parsed(dataset.definition),readiness=parsed(dataset.readiness);
 if(hash(definition)!==dataset.source_set_hash||definition.capability_id!==runtime.capability.capability_id
   ||definition.profile_version!==runtime.personProfile.version||definition.calibration_version!==runtime.calibration.version)
   fail('correction_candidate_baseline_changed');
 return{...s,runtime,dataset,definition,feedbackRows,assignments,snapshot:{definition,readiness,source_set_hash:dataset.source_set_hash}};
}

// One synchronous authenticated worker invocation owns one durable job. An
// uncertain or previously started job is read back, never dispatched again.
export async function runOwnedCorrectionCandidate(db,owner,input,{adapter,env=process.env,signal}={}){
 scope(input);if(typeof input.expected_source_set_hash!=='string'||!/^[a-f0-9]{64}$/.test(input.expected_source_set_hash))fail('correction_candidate_review_required',400);
 if(adapter?.name!=='azure-correction-strategy'||adapter.family!=='claim_extraction'||adapter.billing?.meter!=='azure_foundry_tokens'
   ||adapter.billing.max_output_tokens!==1200||typeof adapter.generate!=='function')fail('correction_candidate_adapter_unavailable',503);
 // This pin is operator-provisioned from actual baseline deployment evidence.
 // A deployment name alone is not an immutable base-model commitment.
 const baseModelCommitment=env.AZURE_CORRECTION_BASE_MODEL_COMMITMENT;
 if(typeof baseModelCommitment!=='string'||!/^[a-f0-9]{64}$/.test(baseModelCommitment))fail('correction_candidate_base_model_pin_required',503);
 const strict=Boolean(env.AZURE_FOUNDRY_EXPECTED_RESPONSE_MODEL||adapter.revision_binding);
 let revisionBinding=null;
 if(strict){
   const supplied=adapter.revision_binding;
   if(!supplied)fail('correction_candidate_provider_binding_required',503);
   revisionBinding=prepareProviderRevisionBinding({expectedResponseModel:env.AZURE_FOUNDRY_EXPECTED_RESPONSE_MODEL||supplied?.expected_response_model,
     endpoint:supplied?.endpoint,deployment:adapter.model,baselineSnapshotHash:baseModelCommitment});
   if(hash(revisionBinding)!==hash(supplied))fail('correction_candidate_provider_binding_changed',503);
 }
 const b=await basis(db,owner,input);
 const modelCommitment=hash({name:adapter.name,version:adapter.version,model:adapter.model,base_model_commitment:baseModelCommitment,
   ...(revisionBinding?{provider_revision_binding:revisionBinding}:{})});
 const inserted=await db(CORRECTION_JOB_INSERT_SQL,
 [b.replica_id,owner,b.dataset_id,randomUUID(),CORRECTION_CANDIDATE_PROTOCOL,modelCommitment,b.dataset.source_set_hash]);
 if(!inserted[0])return receipt((await db(CORRECTION_JOB_VERSION_READ_SQL,
   [b.replica_id,owner,b.dataset_id,modelCommitment,CORRECTION_CANDIDATE_PROTOCOL]))[0]);
 const job=inserted[0];let reservation=null,providerStarted=false,settled=false,recorded=false;
 async function state(next,code){await db(`update vy_replica_correction_candidate_job set state=$4,failure_code=$5,updated_at=now()
 where job_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and state not in ('retired','draft','abstained')`,
 [job.job_id,b.replica_id,owner,next,code]);}
 try{
   const pairs=[];
   for(const example of b.definition.examples.filter(row=>row.split==='train'&&row.kind==='preference')){
     signal?.throwIfAborted();
     const pair=await loadOwnedFeedbackLearningExample(db,owner,example.feedback_id,env);
     if(!pair)fail('correction_candidate_evidence_changed');pairs.push(pair);
   }
   const spendEnv=adapter.billing.budget_env||env;
   const rates=foundryBudgetConfig(spendEnv);
   const plan=prepareCorrectionStrategyRequest(b.snapshot,pairs,{model:adapter.model,...rates});
   // Include schema framing in reserved input units without adding it to the
   // actual conversational messages or changing the provider request.
   const budgetMessages=[...plan.request.messages,{role:'system',content:JSON.stringify(plan.request.response_format)}];
   reservation=await reserveFoundrySpend(db,{operation:'claim_extraction',requestKey:`correction:${job.job_id}:${plan.request_hash}`,
     adapter,messages:budgetMessages,env:spendEnv});
   if(!reservation)fail('correction_candidate_budget_required',503);
   const fresh=await basis(db,owner,input);
   if(hash(fresh.runtime.personProfile.definition)!==hash(b.runtime.personProfile.definition)
     ||hash(fresh.runtime.calibration.definition)!==hash(b.runtime.calibration.definition))fail('correction_candidate_baseline_changed');
   signal?.throwIfAborted();
   const started=await db(`with authority as (${CORRECTION_CURRENT_AUTHORITY_SQL})
    update vy_replica_correction_candidate_job j set state='running',request_hash=$12,reservation_id=$13::uuid,updated_at=now()
    from authority where j.job_id=$11::uuid and j.replica_id=$1::uuid and j.owner_user_id=$2::uuid
    and j.state='preparing' and authority.dataset_id=j.dataset_id returning j.job_id`,
    [...authorityParams(b,owner),job.job_id,plan.request_hash,reservation.reservation_id]);
   if(!started[0])fail('correction_candidate_start_changed');
   await beginFoundrySpend(db,reservation);signal?.throwIfAborted();
   if(!(await db(CORRECTION_CURRENT_AUTHORITY_SQL,authorityParams(b,owner)))[0])fail('correction_candidate_dispatch_authority_changed');
   signal?.throwIfAborted();
   providerStarted=true;
   const response=await adapter.generate({plan,signal});
   // The bounded adapter supplies measured usage even when semantic shape
   // validation fails. Persist and settle those units before refusing output.
   let proposal=null,proposalError=null;
   try{proposal=validateCorrectionStrategyProposal(plan,b.definition,response.output);}catch(error){proposalError=error;}
   const responseRows=await db(`update vy_replica_correction_candidate_job set state='response_recorded',proposal=$4::jsonb,usage=$5::jsonb,updated_at=now()
    where job_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and state='running' returning job_id`,
    [job.job_id,b.replica_id,owner,proposal?JSON.stringify(proposal):null,JSON.stringify(response.usage)]);
   recorded=Boolean(responseRows[0]);
   await settleFoundrySpend(db,reservation,response.usage);settled=true;
   if(!recorded)fail('correction_candidate_response_authority_changed');
   if(revisionBinding){
     const identity=verifyProviderRevision({model:response.provider_identity?.response_model,
       system_fingerprint:response.provider_identity?.system_fingerprint},revisionBinding,response.usage);
     assertSameReportedRevision(identity,response.provider_identity);
   }
   if(proposalError)throw proposalError;
   const latest=await basis(db,owner,input);
   if(hash(latest.runtime.personProfile.definition)!==hash(b.runtime.personProfile.definition)
     ||hash(latest.runtime.calibration.definition)!==hash(b.runtime.calibration.definition))fail('correction_candidate_baseline_changed');
   if(proposal.status==='abstained'){await state('abstained','');return completedReceipt(db,owner,b,job.job_id);}
   const {artifact,artifact_sha256}=buildPrivateCorrectionArtifact(latest.runtime,proposal);
   const manifest={schema:'vyakti.correction-build.v1',job_id:job.job_id,source_set_hash:plan.source_set_hash,
     request_hash:plan.request_hash,catalog_hash:plan.catalog_hash,model_commitment:modelCommitment,
     base_model_commitment:baseModelCommitment,artifact_sha256,owner_approved:false,
     ...(revisionBinding?{provider_revision_binding:revisionBinding,provider_identity:response.provider_identity}:{})};
   const manifestHash=hash(manifest);
   const saved=await db(`with authority as (${CORRECTION_CURRENT_AUTHORITY_SQL})
    update vy_replica_correction_candidate_job j set artifact=$12::jsonb,artifact_sha256=$13,
    build_manifest=$14::jsonb,build_manifest_hash=$15,updated_at=now() from authority
    where j.job_id=$11::uuid and j.replica_id=$1::uuid and j.owner_user_id=$2::uuid and j.state='response_recorded'
    and authority.dataset_id=j.dataset_id returning j.job_id`,
    [...authorityParams(b,owner),job.job_id,JSON.stringify(artifact),artifact_sha256,JSON.stringify(manifest),manifestHash]);
   if(!saved[0])fail('correction_candidate_artifact_changed');
   const candidate=await registerOwnedCandidate(db,owner,{replica_id:b.replica_id,dataset_id:b.dataset_id,
     base_capability_id:latest.runtime.capability.capability_id,kind:'prompt_policy',target_layers:['overall'],
     artifact_sha256,base_model_commitment:baseModelCommitment,build_manifest_hash:manifestHash},
     {sql:CORRECTION_CURRENT_AUTHORITY_SQL,params:authorityParams(b,owner)});
   const completed=await db(`with authority as (${CORRECTION_CURRENT_AUTHORITY_SQL})
    update vy_replica_correction_candidate_job j set candidate_id=$12::uuid,state='draft',updated_at=now()
    from vy_replica_candidate c,authority
    where j.job_id=$11::uuid and j.replica_id=$1::uuid and j.owner_user_id=$2::uuid and j.state='response_recorded'
    and c.candidate_id=$12::uuid and c.dataset_id=j.dataset_id and c.replica_id=j.replica_id and c.owner_user_id=j.owner_user_id and c.status='draft'
    and c.artifact_sha256=j.artifact_sha256 and c.build_manifest_hash=j.build_manifest_hash
    and authority.dataset_id=j.dataset_id and authority.capability_id=c.base_capability_id
    returning j.job_id`,[...authorityParams(b,owner),job.job_id,candidate.candidate_id]);
   if(!completed[0])fail('correction_candidate_registration_changed');
   return completedReceipt(db,owner,b,job.job_id);
 }catch(error){
   // A parsed Azure refusal or malformed model content can still carry valid
   // measured usage. Account for that evidence instead of discarding it.
   const knownUsage=error?.measured_usage;
   if(providerStarted&&!settled&&reservation&&Number.isSafeInteger(knownUsage?.input_tokens)&&knownUsage.input_tokens>=0
     &&Number.isSafeInteger(knownUsage?.output_tokens)&&knownUsage.output_tokens>=0
     &&Number.isSafeInteger(knownUsage.input_tokens+knownUsage.output_tokens)&&knownUsage.input_tokens+knownUsage.output_tokens>0){
     try{
       const savedUsage=await db(`update vy_replica_correction_candidate_job set state='response_recorded',proposal=$4::jsonb,usage=$5::jsonb,updated_at=now()
        where job_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and state='running' returning job_id`,
        [job.job_id,b.replica_id,owner,null,JSON.stringify(knownUsage)]);
       recorded=Boolean(savedUsage[0]);await settleFoundrySpend(db,reservation,knownUsage);settled=true;
     }catch{/* preserve known usage when recorded and keep reservation held */}
   }
   // Never retry after transport ambiguity. A response/usage receipt survives
   // settlement failure for operator reconciliation without another model call.
   if(reservation&&!settled){
     if(providerStarted){try{await markFoundrySpendUncertain(db,reservation,'correction_candidate_uncertain');}catch{/* held, no retry */}}
     else{try{await releaseFoundrySpendBeforeCall(db,reservation,'correction_candidate_not_dispatched');}catch{/* retain debt */}}
   }
   try{await state(providerStarted&&!settled?(recorded?'accounting_pending':'unknown'):'failed',
     typeof error?.code==='string'&&/^[a-z0-9_]{1,100}$/.test(error.code)?error.code:'correction_candidate_failed');}catch{/* durable prior state remains */}
   throw Object.assign(new Error('correction_candidate_not_completed'),{code:'correction_candidate_not_completed',status:503});
 }
}
