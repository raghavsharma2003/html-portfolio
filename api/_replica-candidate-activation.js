import {randomUUID} from 'node:crypto';
import {canonicalJson,sha256Hex} from './_provenance/contracts.js';
import {loadOwnedRuntimeContext,loadOwnedRuntimeRevision,compileReplicaRuntimeCore,OWNED_RUNTIME_REVISION_SQL} from './_replica-runtime.js';
import {renderPrivateCorrectionCandidate} from './_replica-correction-artifact.js';
import {candidateActivationProofSql} from './_replica-candidate-activation-authority.js';
import {candidateRuntimeCore} from './_replica-candidate-runtime.js';
import {prepareProviderRevisionBinding,assertSameReportedRevision} from './_dialogue/provider-revision.js';
import {REPLICA_POLICY_VERSION,replicaId} from './_replica.js';
const hash=v=>sha256Hex(canonicalJson(v)),parse=v=>typeof v==='string'?JSON.parse(v):v;
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
export const ACTIVATION_CURRENT_SQL=`select coalesce(pc.capability_id,c.capability_id) as capability_id,c.capability_id as base_capability_id,
 coalesce(pc.candidate_binding_required,c.candidate_binding_required) as candidate_binding_required,t.prior_capability_id,h.candidate_id,h.selection_kind
 from vy_replica_runtime_capability c join vy_replica r on r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id
 left join vy_replica_owner_private_selection p on p.replica_id=c.replica_id and p.owner_user_id=c.owner_user_id
 left join vy_replica_runtime_capability pc on pc.capability_id=p.capability_id and pc.replica_id=c.replica_id and pc.owner_user_id=c.owner_user_id
 left join vy_replica_candidate_runtime_transition t on t.new_capability_id=pc.capability_id and t.replica_id=c.replica_id and t.owner_user_id=c.owner_user_id
 left join vy_replica_candidate_activation h on h.new_capability_id=pc.capability_id and h.replica_id=c.replica_id and h.owner_user_id=c.owner_user_id
 where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.state='active' and r.lifecycle='active'`;
export const ACTIVATION_CANDIDATE_SQL=`select c.*,q.qualification_id,q.verdict,q.metrics,j.artifact,m.candidate_core_hash
 from vy_replica_candidate c join lateral (select qa.* from vy_replica_candidate_qualification qa
  where qa.candidate_id=c.candidate_id and qa.replica_id=c.replica_id and qa.owner_user_id=c.owner_user_id
  and qa.protocol_version='vyakti.candidate-qualification.v2' order by qa.created_at desc,qa.qualification_id desc limit 1) q on true
 join vy_replica_candidate_materialization m on m.candidate_id=c.candidate_id and m.dataset_id=c.dataset_id and m.replica_id=c.replica_id and m.owner_user_id=c.owner_user_id
 join vy_replica_correction_candidate_job j on j.job_id=m.correction_job_id and j.candidate_id=c.candidate_id and j.replica_id=c.replica_id and j.owner_user_id=c.owner_user_id
 where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.candidate_id=$3::uuid`;
export const ACTIVATION_HISTORY_SQL=`select * from vy_replica_candidate_activation
 where new_capability_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid`;

const proposalColumns=`activation_id uuid,new_capability_id uuid,prior_capability_id uuid,target_capability_id uuid,replica_id uuid,owner_user_id uuid,
 action text,exposure text,selection_kind text,candidate_id uuid,dataset_id uuid,qualification_id uuid,qualification_binding jsonb,artifact_snapshot jsonb,
 profile_definition jsonb,calibration_definition jsonb,core_hash text,model_commitment text,base_model_commitment text,provider_revision_binding jsonb,provider_identity jsonb`;
// The proposal is constructed exclusively below from owned stored receipts.
// Browser fields never reach jsonb_to_record as a proposal or SQL fragment.
const selection=`with locked as (select r.* from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid for update),
 revision as (${OWNED_RUNTIME_REVISION_SQL}),proposal as (select * from jsonb_to_record($6::jsonb) as h(${proposalColumns})),
 eligible as (select h.*,bc.capability_id as base_capability_id,tc.agent_id,tc.subject_person_id,tc.voice_profile_id,tc.genome_version,tc.profile_version,tc.calibration_version,tc.policy_version,
 tc.qualification_hash as prior_qualification_hash from locked r join vy_replica_runtime_capability cc
 on cc.replica_id=r.replica_id and cc.owner_user_id=r.owner_user_id and cc.capability_id=$5::uuid
 join vy_replica_runtime_capability bc on bc.replica_id=r.replica_id and bc.owner_user_id=r.owner_user_id and bc.state='active'
 left join vy_replica_owner_private_selection ps on ps.replica_id=r.replica_id and ps.owner_user_id=r.owner_user_id
 join revision rv on rv.replica_id=r.replica_id join vy_replica_runtime_capability tc on tc.capability_id=rv.capability_id
 cross join proposal h where h.replica_id=r.replica_id and h.owner_user_id=r.owner_user_id and h.prior_capability_id=cc.capability_id
 and h.target_capability_id=tc.capability_id and h.exposure='owner_private_text'
 and ((h.action='reset' and ps.capability_id=cc.capability_id)
  or (h.action<>'reset' and cc.state in ('active','private') and ((ps.capability_id=cc.capability_id and ps.base_capability_id=bc.capability_id)
   or (ps.capability_id is null and cc.capability_id=bc.capability_id))))
 and tc.profile_version=bc.profile_version and tc.calibration_version=bc.calibration_version and tc.genome_version=bc.genome_version
 and tc.voice_profile_id=bc.voice_profile_id
 and ((h.action='reset' and tc.capability_id=bc.capability_id and h.candidate_id is null)
 or (h.action in ('activate','experiment') and tc.capability_id=bc.capability_id and not cc.candidate_binding_required)
 or (h.action='rollback' and tc.state in ('active','private') and tc.candidate_binding_required=(h.candidate_id is not null)
 and exists(select 1 from vy_replica_candidate_runtime_transition tr where tr.new_capability_id=cc.capability_id
 and tr.replica_id=r.replica_id and tr.owner_user_id=r.owner_user_id and tr.prior_capability_id=tc.capability_id)))
 and (${candidateActivationProofSql('h','tc','r')}))`;
export const ACTIVATION_ELIGIBLE_SQL=selection+' select new_capability_id from eligible';
export const ACTIVATION_COMMIT_SQL=selection+`, created as (
 insert into vy_replica_runtime_capability(capability_id,replica_id,owner_user_id,agent_id,subject_person_id,voice_profile_id,genome_version,
 profile_version,calibration_version,qualification_hash,policy_version,state,candidate_binding_required)
 select e.new_capability_id,e.replica_id,e.owner_user_id,e.agent_id,e.subject_person_id,e.voice_profile_id,e.genome_version,e.profile_version,
 e.calibration_version,e.prior_qualification_hash,e.policy_version,'private',e.candidate_id is not null from eligible e
 returning capability_id,replica_id,owner_user_id), selected as (
 insert into vy_replica_owner_private_selection(replica_id,owner_user_id,capability_id,base_capability_id)
 select e.replica_id,e.owner_user_id,e.new_capability_id,e.base_capability_id from eligible e join created c on c.capability_id=e.new_capability_id
 on conflict(replica_id,owner_user_id) do update set capability_id=excluded.capability_id,base_capability_id=excluded.base_capability_id,updated_at=now()
 where vy_replica_owner_private_selection.capability_id=$5::uuid
 returning capability_id), transitioned as (
 insert into vy_replica_candidate_runtime_transition(new_capability_id,prior_capability_id,replica_id,owner_user_id,action)
 select e.new_capability_id,e.prior_capability_id,e.replica_id,e.owner_user_id,e.action from eligible e join selected c on c.capability_id=e.new_capability_id
 returning new_capability_id), recorded as (
 insert into vy_replica_candidate_activation(activation_id,new_capability_id,prior_capability_id,target_capability_id,replica_id,owner_user_id,
 action,exposure,selection_kind,candidate_id,dataset_id,qualification_id,qualification_binding,artifact_snapshot,profile_definition,calibration_definition,
 core_hash,model_commitment,base_model_commitment,provider_revision_binding,provider_identity)
 select e.activation_id,e.new_capability_id,e.prior_capability_id,e.target_capability_id,e.replica_id,e.owner_user_id,e.action,e.exposure,e.selection_kind,e.candidate_id,
 e.dataset_id,e.qualification_id,e.qualification_binding,e.artifact_snapshot,e.profile_definition,e.calibration_definition,e.core_hash,
 e.model_commitment,e.base_model_commitment,e.provider_revision_binding,e.provider_identity from eligible e join transitioned t on t.new_capability_id=e.new_capability_id
 returning new_capability_id), verified as materialized (
 select public.vy_replica_candidate_selection_result((select count(*) from created),(select count(*) from selected),
  (select count(*) from transitioned),(select count(*) from recorded),(select new_capability_id from recorded)) as new_capability_id)
 select new_capability_id from verified where new_capability_id is not null`;

function initialHistory(runtime,owner,current,action){return{activation_id:randomUUID(),new_capability_id:randomUUID(),prior_capability_id:current.capability_id,
 target_capability_id:runtime.capability.capability_id,replica_id:runtime.replica.replica_id,owner_user_id:owner,action,exposure:'owner_private_text',selection_kind:'baseline',
 candidate_id:null,dataset_id:null,qualification_id:null,qualification_binding:null,artifact_snapshot:null,
 profile_definition:runtime.personProfile.definition,calibration_definition:runtime.calibration.definition,
 core_hash:hash(compileReplicaRuntimeCore(runtime.personProfile.definition,runtime.calibration.definition)),model_commitment:null,
 base_model_commitment:null,provider_revision_binding:null,provider_identity:null};}
async function activationProposal(db,owner,input,current,action='activate'){
 const runtime=await loadOwnedRuntimeContext(db,owner,input.replica_id);if(!runtime)fail('candidate_runtime_unavailable');
 if(current.candidate_binding_required)fail('candidate_restore_baseline_before_comparison');
 const row=(await db(ACTIVATION_CANDIDATE_SQL,[input.replica_id,owner,input.candidate_id]))[0];
 if(!row)fail('candidate_qualification_missing');
 if(action==='activate'&&(row.verdict!=='pass'||row.status!=='qualified'))fail('candidate_qualification_not_passed');
 if(action==='experiment'&&(row.verdict!=='inconclusive'||row.status!=='evaluating'))fail('candidate_experiment_not_eligible');
 const metrics=parse(row.metrics),binding=metrics?.binding,artifact=parse(row.artifact);
 if(binding?.schema!=='vyakti.candidate-qualification-binding.v2'||binding.candidate_id!==input.candidate_id
  ||row.base_capability_id!==runtime.capability.capability_id||hash(artifact)!==row.artifact_sha256)fail('candidate_comparison_changed');
 const rendered=renderPrivateCorrectionCandidate(runtime,artifact);
 if(rendered.core.length>6000||hash(rendered.core)!==row.candidate_core_hash||binding.candidate_core_hash!==row.candidate_core_hash)fail('candidate_compared_core_changed');
 assertSameReportedRevision(binding.provider_identity,binding.provider_identity);
 const revision=prepareProviderRevisionBinding({expectedResponseModel:binding.provider_identity.response_model,
  endpoint:'https://raghavsharma1729-compan-resource.services.ai.azure.com',deployment:'gpt-4.1-mini',baselineSnapshotHash:binding.base_model_commitment});
 if(revision.binding_hash!==binding.provider_identity.binding_hash)fail('candidate_provider_binding_changed');
 return{...initialHistory(runtime,owner,current,action),selection_kind:action==='experiment'?'experimental':'qualified',candidate_id:row.candidate_id,dataset_id:row.dataset_id,
  qualification_id:row.qualification_id,qualification_binding:binding,artifact_snapshot:artifact,core_hash:row.candidate_core_hash,
  model_commitment:binding.model_commitment,base_model_commitment:binding.base_model_commitment,provider_revision_binding:revision,provider_identity:binding.provider_identity};
}
async function rollbackProposal(db,owner,input,current){
 if(!current.prior_capability_id)fail('candidate_rollback_unavailable');
 const target=await loadOwnedRuntimeRevision(db,owner,input.replica_id,current.prior_capability_id);if(!target)fail('candidate_rollback_authority_changed');
 candidateRuntimeCore(target);
 const initial=initialHistory(target,owner,current,'rollback');if(!target.capability.candidate_binding_required)return initial;
 const previous=(await db(ACTIVATION_HISTORY_SQL,[current.prior_capability_id,input.replica_id,owner]))[0];
 if(!previous)fail('candidate_rollback_authority_changed');
 return{...previous,...initial,selection_kind:previous.selection_kind,candidate_id:previous.candidate_id,dataset_id:previous.dataset_id,qualification_id:previous.qualification_id,
  qualification_binding:parse(previous.qualification_binding),artifact_snapshot:parse(previous.artifact_snapshot),core_hash:previous.core_hash,
  model_commitment:previous.model_commitment,base_model_commitment:previous.base_model_commitment,
  provider_revision_binding:parse(previous.provider_revision_binding),provider_identity:parse(previous.provider_identity)};
}
async function resetProposal(db,owner,input,current){
 if(current.capability_id===current.base_capability_id)fail('candidate_reset_unavailable');
 const target=await loadOwnedRuntimeContext(db,owner,input.replica_id);
 if(!target||target.capability.capability_id!==current.base_capability_id||target.capability.candidate_binding_required)fail('candidate_reset_authority_changed');
 return initialHistory(target,owner,current,'reset');
}
const proposalFor=action=>action==='reset'?resetProposal:action==='rollback'?rollbackProposal:activationProposal;
const params=(h,current)=>[h.replica_id,h.owner_user_id,REPLICA_POLICY_VERSION,h.target_capability_id,current.capability_id,JSON.stringify(h)];
export async function readOwnedCandidateActivation(db,owner,input){
 const rid=replicaId(input.replica_id),cid=input.candidate_id==null?null:replicaId(input.candidate_id),current=(await db(ACTIVATION_CURRENT_SQL,[rid,owner]))[0];
 const status={replica_id:rid,candidate_id:cid,active_capability_id:current?.capability_id||null,current_candidate_id:current?.candidate_id||null,
  selection_kind:current?(current.candidate_binding_required?current.selection_kind||null:'baseline'):null,
  can_activate:false,qualification_id:null,can_experiment:false,experimental_qualification_id:null,
  rollback_target_capability_id:current?.prior_capability_id||null,can_rollback:false,blockers:[]};
 status.reset_target_capability_id=current&&current.capability_id!==current.base_capability_id?current.base_capability_id:null;
 status.can_reset=false;
 if(!current){status.blockers.push('candidate_runtime_unavailable');return status;}
 for(const action of ['activate','experiment','rollback','reset'])try{
  if(!cid&&['activate','experiment'].includes(action))continue;
  const h=await proposalFor(action)(db,owner,{replica_id:rid,candidate_id:cid},current,action);
  const eligible=(await db(ACTIVATION_ELIGIBLE_SQL,params(h,current))).length===1;
  if(action==='activate'){status.can_activate=eligible;status.qualification_id=h.qualification_id;}
  else if(action==='experiment'){status.can_experiment=eligible;status.experimental_qualification_id=h.qualification_id;}
  else if(action==='reset')status.can_reset=eligible;else status.can_rollback=eligible;
  if(!eligible)status.blockers.push(action==='rollback'?'candidate_rollback_authority_changed':'candidate_authority_changed');
 }catch(e){if(e.status!==409)throw e;if((action!=='rollback'||current.prior_capability_id)&&(action!=='reset'||status.reset_target_capability_id))status.blockers.push(e.code);}
 return status;
}
export async function changeOwnedCandidateActivation(db,owner,input){
 if(!['activate','experiment','rollback','reset'].includes(input.op))fail('candidate_activation_op_invalid');
 const rid=replicaId(input.replica_id),cid=['rollback','reset'].includes(input.op)&&input.candidate_id==null?null:replicaId(input.candidate_id),expected=replicaId(input.expected_capability_id);
 const current=(await db(ACTIVATION_CURRENT_SQL,[rid,owner]))[0];if(!current||current.capability_id!==expected)fail('candidate_active_version_changed');
 const h=await proposalFor(input.op)(db,owner,{replica_id:rid,candidate_id:cid},current,input.op);
 if(['activate','experiment'].includes(input.op)&&h.qualification_id!==replicaId(input.qualification_id))fail('candidate_qualification_changed');
 if(['rollback','reset'].includes(input.op)&&h.target_capability_id!==replicaId(input.target_capability_id))fail(input.op==='reset'?'candidate_reset_target_changed':'candidate_rollback_target_changed');
 let committed;
 try{committed=await db(ACTIVATION_COMMIT_SQL,params(h,current));}
 catch(error){
  if(error?.code==='40001'&&/(?:^|: )candidate_private_selection_write_conflict$/.test(String(error.message)))fail('candidate_selection_changed');
  throw error;
 }
 if(committed.length!==1)fail('candidate_activation_authority_changed');
 return readOwnedCandidateActivation(db,owner,{replica_id:rid,candidate_id:cid});
}
