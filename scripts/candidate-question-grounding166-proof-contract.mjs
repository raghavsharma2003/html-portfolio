// Source preparation only. Importing this module performs no database or provider work.
import {ACTIVATION_CANDIDATE_SQL,ACTIVATION_ELIGIBLE_SQL,ACTIVATION_COMMIT_SQL} from '../api/_replica-candidate-activation.js';
import {QUALIFICATION_RECEIPT_SQL,QUALIFICATION_COMPARISON_AUTHORITY_SQL,QUALIFICATION_CURRENT_AUTHORITY_SQL} from '../api/_replica-candidate-qualification-service.js';
import {MATERIALIZATION_AUTHORITY_SQL} from '../api/_replica-candidate-materializer.js';
import {CORRECTION_JOB_INSERT_SQL,CORRECTION_JOB_VERSION_READ_SQL,CORRECTION_CANDIDATE_PROTOCOL} from '../api/_replica-correction-candidate.js';
import {REPLICA_POLICY_VERSION} from '../api/_replica.js';

export function proofStatements({replicaId,ownerId,datasetId,capabilityId,currentCapabilityId,newCapabilityId,candidateId,
  correctionJobId,qualificationId,evalRunId,sourceSetHash,artifactHash,manifestHash,baseModelHash,
  modelHash,baselineHash,candidateCoreHash,runCommitment}) {
 const profile=JSON.stringify({identity:{self_name:'Proof owner'},knowledge:[]});
 const calibration=JSON.stringify({strategies:[]});
 const identities=JSON.stringify([{response_model:'proof-model',system_fingerprint:'proof-fingerprint'}]);
 const items=JSON.stringify([]);
 const authority=[replicaId,ownerId,REPLICA_POLICY_VERSION,datasetId,sourceSetHash,capabilityId,profile,calibration,'[]','[]'];
 const qualification=[...authority,candidateId,evalRunId,runCommitment,artifactHash,manifestHash,baseModelHash,
  modelHash,baselineHash,identities,candidateCoreHash,items];
 const history={activation_id:qualificationId,new_capability_id:newCapabilityId,prior_capability_id:currentCapabilityId,
  target_capability_id:capabilityId,replica_id:replicaId,owner_user_id:ownerId,action:'activate',exposure:'owner_private_text',
  selection_kind:'qualified',candidate_id:candidateId,dataset_id:datasetId,qualification_id:qualificationId,
  qualification_binding:{schema:'vyakti.candidate-qualification-binding.v2'},artifact_snapshot:{},profile_definition:JSON.parse(profile),
  calibration_definition:JSON.parse(calibration),core_hash:candidateCoreHash,model_commitment:modelHash,
  base_model_commitment:baseModelHash,provider_revision_binding:{},provider_identity:{}};
 return [
  {name:'correction_job_v2_insert',sql:CORRECTION_JOB_INSERT_SQL,params:[replicaId,ownerId,datasetId,correctionJobId,CORRECTION_CANDIDATE_PROTOCOL,modelHash,sourceSetHash]},
  {name:'correction_job_v2_read',sql:CORRECTION_JOB_VERSION_READ_SQL,params:[replicaId,ownerId,datasetId,modelHash,CORRECTION_CANDIDATE_PROTOCOL]},
  {name:'materialization_v2_authority',sql:MATERIALIZATION_AUTHORITY_SQL,params:[...authority,candidateId,artifactHash,manifestHash,baseModelHash,correctionJobId]},
  {name:'qualification_v2_receipt',sql:QUALIFICATION_RECEIPT_SQL,params:[replicaId,ownerId,candidateId]},
  {name:'qualification_v2_comparison_authority',sql:QUALIFICATION_COMPARISON_AUTHORITY_SQL,params:qualification},
  {name:'qualification_v2_current_authority',sql:QUALIFICATION_CURRENT_AUTHORITY_SQL,params:qualification},
  {name:'activation_v2_candidate',sql:ACTIVATION_CANDIDATE_SQL,params:[replicaId,ownerId,candidateId]},
  {name:'activation_v2_eligible',sql:ACTIVATION_ELIGIBLE_SQL,params:[replicaId,ownerId,REPLICA_POLICY_VERSION,capabilityId,currentCapabilityId,JSON.stringify(history)]},
  {name:'activation_v2_commit',sql:ACTIVATION_COMMIT_SQL,params:[replicaId,ownerId,REPLICA_POLICY_VERSION,capabilityId,currentCapabilityId,JSON.stringify(history)]},
 ];
}

export const actualProofRequirements=Object.freeze([
 'Run EXPLAIN only against the isolated development database with synthetic UUIDs and 64-character hashes. Do not COMMIT, dispatch a provider, or mutate production.',
 'Prove correction_job_v2_insert can coexist with an incumbent v1 job for the same dataset and model commitment because protocol is part of the existing unique key.',
 'EXPLAIN the exact qualification receipt/comparison/current-authority SQL. Separately exercise the service checks that require materialization v2 and artifact v2 before qualification v2 and binding v2 can be recorded.',
 'EXPLAIN the expanded activation SQL, whose predicates require materialization v2, qualification v2 and qualification-binding v2. A separate rolled-back fixture execution must prove an otherwise matching v1 row returns no activation authority row.',
 'Roll back any seeded fixture rows, confirm fixture absence, and close every connection. Source fixtures do not establish SQL correctness.',
]);
