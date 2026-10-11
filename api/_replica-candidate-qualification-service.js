import {canonicalJson,sha256Hex} from './_provenance/contracts.js';
import {basis,authorityParams,CORRECTION_CURRENT_AUTHORITY_SQL} from './_replica-correction-candidate.js';
import {loadCandidateOwnerObservations} from './_replica-candidate-eval.js';
import {evaluateCandidateQualification,recordOwnedCandidateQualification,CANDIDATE_QUALIFICATION_PROTOCOL} from './_replica-candidate-qualification.js';
import {assertSameReportedRevision,prepareProviderRevisionBinding,providerRevisionDeployment} from './_dialogue/provider-revision.js';
import {compileReplicaRuntimeCore} from './_replica-runtime.js';
import {AZURE_DIALOGUE_API_VERSION,azureDialogueProtocol} from './_dialogue/providers/azure-foundry.js';
import {DIALOGUE_PROMPT} from './_dialogue/contracts.js';
import {renderPrivateCorrectionCandidate,CORRECTION_ARTIFACT_SCHEMA} from './_replica-correction-artifact.js';
import {MATERIALIZATION_PROTOCOL} from './_replica-candidate-materializer.js';

export const QUALIFICATION_BINDING_SCHEMA='vyakti.candidate-qualification-binding.v2';
const hash=v=>sha256Hex(canonicalJson(v));
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
const uuid=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v))fail('qualification_scope_invalid',400);return v.toLowerCase();};

export const QUALIFICATION_RECEIPT_SQL=`select c.*,r.eval_run_id,r.run_commitment,r.state as run_state,r.dataset_source_set_hash,
 m.job_id as materialization_job_id,m.protocol as materialization_protocol,m.model_commitment,m.baseline_hash,m.candidate_core_hash,m.total,
 m.artifact_sha256 as materialized_artifact,m.manifest_hash as materialized_manifest,
 j.artifact,j.build_manifest,
 (select jsonb_agg(i.provider_identity order by i.sequence) from vy_replica_candidate_materialization_item i
   where i.job_id=m.job_id and i.replica_id=m.replica_id and i.owner_user_id=m.owner_user_id and i.state='complete') as identities,
 (select jsonb_agg(jsonb_build_object('feedback_id',i.feedback_id,'role',i.role,'session_commitment',i.session_commitment) order by i.sequence)
   from vy_replica_candidate_materialization_item i where i.job_id=m.job_id and i.replica_id=m.replica_id
   and i.owner_user_id=m.owner_user_id and i.state='complete') as item_examples
 from vy_replica_candidate c join vy_replica_candidate_materialization m
  on m.candidate_id=c.candidate_id and m.dataset_id=c.dataset_id and m.replica_id=c.replica_id and m.owner_user_id=c.owner_user_id
 join vy_replica_candidate_eval_run r on r.eval_run_id=m.eval_run_id and r.candidate_id=c.candidate_id
  and r.dataset_id=c.dataset_id and r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id
 join vy_replica_correction_candidate_job j on j.job_id=m.correction_job_id and j.candidate_id=c.candidate_id
  and j.dataset_id=c.dataset_id and j.replica_id=c.replica_id and j.owner_user_id=c.owner_user_id
 where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.candidate_id=$3::uuid
 and m.state='ready' and r.state in ('collecting','complete') and j.state='draft'`;

// This fixed server-only predicate is reused by the INSERT. No request can
// supply observations, safety counts, an admission predicate, or a verdict.
export const QUALIFICATION_COMPARISON_AUTHORITY_SQL=`with reviewed as (${CORRECTION_CURRENT_AUTHORITY_SQL}),
 receipt as (${QUALIFICATION_RECEIPT_SQL.replace(/\$3::uuid/g,'$11::uuid')})
 select c.candidate_id,c.eval_run_id from receipt c join reviewed on reviewed.dataset_id=c.dataset_id
 and reviewed.capability_id=c.base_capability_id
 where c.eval_run_id=$12::uuid and c.run_commitment=$13 and c.artifact_sha256=$14
 and c.build_manifest_hash=$15 and c.base_model_commitment=$16 and c.model_commitment=$17
 and c.baseline_hash=$18 and c.identities=$19::jsonb and c.candidate_core_hash=$20 and c.item_examples=$21::jsonb
 and c.materialized_artifact=c.artifact_sha256 and c.materialized_manifest=c.build_manifest_hash
 and c.dataset_source_set_hash=$5`;
export const QUALIFICATION_CURRENT_AUTHORITY_SQL=QUALIFICATION_COMPARISON_AUTHORITY_SQL+" and c.run_state='complete'";

async function context(db,owner,input){
 const rid=uuid(input?.replica_id),cid=uuid(input?.candidate_id);
 const row=(await db(QUALIFICATION_RECEIPT_SQL,[rid,owner,cid]))[0];
 if(!row)fail('qualification_comparison_incomplete');
 const b=await basis(db,owner,{replica_id:rid,dataset_id:row.dataset_id,expected_source_set_hash:row.dataset_source_set_hash});
 const identities=parse(row.identities),artifact=parse(row.artifact),manifest=parse(row.build_manifest);
 const heldout=b.definition.examples.filter(e=>e.split==='test');
 const expectedItems=heldout.flatMap(e=>['baseline','candidate'].map(role=>({feedback_id:e.feedback_id,role,session_commitment:e.session_commitment})));
 const items=parse(row.item_examples),sortItems=items=>items.slice().sort((a,b)=>`${a.feedback_id}:${a.role}`.localeCompare(`${b.feedback_id}:${b.role}`));
 if(heldout.length<30||Number(row.total)!==heldout.length*2||!Array.isArray(items)||hash(sortItems(items))!==hash(sortItems(expectedItems)))
  fail('qualification_heldout_coverage_changed');
 if(!Array.isArray(identities)||identities.length!==Number(row.total)||!identities[0]
  ||identities.some(i=>hash(i)!==hash(identities[0]))||!identities[0].response_model
  ||hash(artifact)!==row.artifact_sha256||hash(manifest)!==row.build_manifest_hash
  ||row.materialized_artifact!==row.artifact_sha256||row.materialized_manifest!==row.build_manifest_hash
  ||manifest.source_set_hash!==row.dataset_source_set_hash||manifest.base_model_commitment!==row.base_model_commitment)
  fail('qualification_receipt_changed');
 for(const identity of identities)assertSameReportedRevision(identities[0],identity);
 const deployment=providerRevisionDeployment(identities[0].response_model,identities[0].schema);
 const revision=prepareProviderRevisionBinding({expectedResponseModel:identities[0].response_model,
  endpoint:'https://raghavsharma1729-compan-resource.services.ai.azure.com/',deployment,baselineSnapshotHash:row.base_model_commitment});
 const protocol=azureDialogueProtocol(deployment);
 const expectedModel=hash({protocol:MATERIALIZATION_PROTOCOL,name:'azure-foundry-structured-output',
  version:`${AZURE_DIALOGUE_API_VERSION}:${DIALOGUE_PROMPT}${protocol?':'+protocol.version:''}`,model:deployment,
  base_model_commitment:row.base_model_commitment,revision_binding:revision});
 if(artifact.schema!==CORRECTION_ARTIFACT_SCHEMA||row.materialization_protocol!==MATERIALIZATION_PROTOCOL
  ||identities[0].binding_hash!==revision.binding_hash||row.model_commitment!==expectedModel
  ||row.base_capability_id!==b.runtime.capability.capability_id||row.profile_version!==b.runtime.personProfile.version
  ||row.calibration_version!==b.runtime.calibration.version
  ||row.candidate_core_hash!==hash(renderPrivateCorrectionCandidate(b.runtime,artifact).core)
  ||row.baseline_hash!==hash(compileReplicaRuntimeCore(b.runtime.personProfile.definition,b.runtime.calibration.definition)))
  fail('qualification_baseline_changed');
 const binding={schema:QUALIFICATION_BINDING_SCHEMA,candidate_id:cid,eval_run_id:row.eval_run_id,
  run_commitment:row.run_commitment,dataset_id:row.dataset_id,dataset_source_set_hash:row.dataset_source_set_hash,
  artifact_sha256:row.artifact_sha256,build_manifest_hash:row.build_manifest_hash,base_model_commitment:row.base_model_commitment,
  base_capability_id:row.base_capability_id,profile_version:row.profile_version,calibration_version:row.calibration_version,
  materialization_job_id:row.materialization_job_id,model_commitment:row.model_commitment,baseline_core_hash:row.baseline_hash,candidate_core_hash:row.candidate_core_hash,
  provider_identity:identities[0]};
 const admission={sql:QUALIFICATION_CURRENT_AUTHORITY_SQL,params:[...authorityParams(b,owner),cid,row.eval_run_id,
  row.run_commitment,row.artifact_sha256,row.build_manifest_hash,row.base_model_commitment,row.model_commitment,row.baseline_hash,JSON.stringify(identities),row.candidate_core_hash,JSON.stringify(items)]};
 return{row,b,binding,admission};
}

// Internal receipt for activation implementers. It is not an approval: activation
// must recheck current authority in its own write and require verdict='pass'.
export async function loadOwnedCandidateQualificationReceipt(db,owner,input){
 const c=await context(db,owner,input);
 return readReceipt(db,c);
}
async function readReceipt(db,c){
 if(c.row.run_state!=='complete')return null;
 const rows=await db(`with authority as (${c.admission.sql}) select q.*
  from vy_replica_candidate_qualification q join authority a on a.candidate_id=q.candidate_id
  where q.candidate_id=$11::uuid and q.owner_user_id=$2::uuid and q.protocol_version=$22
  and q.metrics->'binding'=$23::jsonb order by q.created_at desc,q.qualification_id desc limit 1`,
 [...c.admission.params,CANDIDATE_QUALIFICATION_PROTOCOL,JSON.stringify(c.binding)]);
 return rows[0]||null;
}

export function publicQualification(row){
 if(!row)return{available:false,active_changed:false};
 const metrics=parse(row.metrics);
 return{available:true,qualification_id:row.qualification_id,verdict:row.verdict,active_changed:false,
  checks:{failures:metrics.failures||[],inconclusive:metrics.inconclusive||[]}};
}

export async function qualifyOwnedCandidate(db,owner,input){
 const pending=await context(db,owner,input);
 if(pending.row.run_state!=='complete'){
  // Explicit owner action repairs a committed last vote whose following
  // reconciliation was interrupted. Status reads never perform this write.
  const rows=await db(`with authority as (${QUALIFICATION_COMPARISON_AUTHORITY_SQL}), ready as (
   select r.eval_run_id from vy_replica_candidate_eval_run r join authority a on a.eval_run_id=r.eval_run_id
   join vy_replica_candidate_eval_assignment x on x.eval_run_id=r.eval_run_id and x.candidate_id=r.candidate_id
    and x.replica_id=r.replica_id and x.owner_user_id=r.owner_user_id
   where r.owner_user_id=$2::uuid and r.candidate_id=$11::uuid and r.state in ('collecting','complete')
   group by r.eval_run_id having count(*)=r.assignment_count and count(*)>0
    and count(*) filter(where x.state='submitted')=count(*)
  ) update vy_replica_candidate_eval_run r set state='complete',completed_at=coalesce(r.completed_at,now())
    from ready where r.eval_run_id=ready.eval_run_id returning r.eval_run_id`,pending.admission.params);
  if(!rows[0])fail('qualification_votes_incomplete_or_changed');
 }
 const c=pending.row.run_state==='complete'?pending:await context(db,owner,input);
 const existing=await readReceipt(db,c);
 if(existing)return publicQualification(existing);
 const observations=await loadCandidateOwnerObservations(db,owner,c.row.eval_run_id);
 // No independently persisted safety runner is connected yet. Missing evidence
 // stays inconclusive. Never accept browser counters or convert preference to pass.
 const evaluation=evaluateCandidateQualification(c.b.definition,{candidate_kind:c.row.kind,
  target_layers:c.row.target_layers,run_commitment:c.row.run_commitment,
  dataset_source_set_hash:c.row.dataset_source_set_hash},observations,{});
 evaluation.metrics.binding=c.binding;
 evaluation.observation_hash=hash({observation_hash:evaluation.observation_hash,binding:c.binding});
 return publicQualification(await recordOwnedCandidateQualification(db,owner,c.row.candidate_id,evaluation,c.admission));
}
