import {candidateRuntimeAuthoritySql} from './_replica-candidate-activation-authority.js';

export const CANDIDATE_RUNTIME_BINDING_SQL=`select h.* from vy_replica_candidate_activation h
 join vy_replica_runtime_capability c on c.capability_id=h.new_capability_id
  and c.replica_id=h.replica_id and c.owner_user_id=h.owner_user_id
 join vy_replica r on r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id
 where h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.new_capability_id=$3::uuid
 and c.state='private' and c.candidate_binding_required and r.lifecycle='active'
 and (${candidateRuntimeAuthoritySql('c','r')})`;
export async function loadOwnedCandidateBinding(db,owner,runtime){
 const rows=await db(CANDIDATE_RUNTIME_BINDING_SQL,[runtime.replica.replica_id,owner,runtime.capability.capability_id]);
 if(rows.length!==1)return null;const h=rows[0],parse=v=>typeof v==='string'?JSON.parse(v):v;
 const qualification=parse(h.qualification_binding);
 return{activation_id:h.activation_id,exposure:h.exposure,selection_kind:h.selection_kind,candidate_id:h.candidate_id,base_capability_id:qualification.base_capability_id,
  artifact_sha256:qualification.artifact_sha256,build_manifest_hash:qualification.build_manifest_hash,
  artifact:parse(h.artifact_snapshot),core_hash:h.core_hash,model_commitment:h.model_commitment,
  base_model_commitment:h.base_model_commitment,provider_revision_binding:parse(h.provider_revision_binding),provider_identity:parse(h.provider_identity)};
}
