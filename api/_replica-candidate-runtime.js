import {canonicalJson,sha256Hex} from './_provenance/contracts.js';
import {compileReplicaRuntimeCore} from './_replica-runtime.js';
import {renderPrivateCorrectionCandidate} from './_replica-correction-artifact.js';
import {materializationModel} from './_replica-candidate-materializer.js';
import {verifyProviderRevision,assertSameReportedRevision} from './_dialogue/provider-revision.js';
const hash=value=>sha256Hex(canonicalJson(value));
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

// Activation is an external owner attestation. Never relabel or modify the
// experimental artifact that was actually compared.
export function candidateRuntimeCore(runtime,question=""){
 const b=runtime?.candidateBinding;
 if(!b){
  if(runtime?.capability?.candidate_binding_required)fail('candidate_runtime_binding_unavailable');
  return compileReplicaRuntimeCore(runtime.personProfile.definition,runtime.calibration.definition,question);
 }
 if(b.exposure!=='owner_private_text')fail('candidate_runtime_exposure_not_authorized');
 if(!['qualified','experimental'].includes(b.selection_kind))fail('candidate_runtime_selection_not_authorized');
 if(runtime.capability.candidate_binding_required!==true||!b.activation_id||!b.candidate_id||!b.base_capability_id
  ||!digest(b.artifact_sha256)||!digest(b.build_manifest_hash)||!digest(b.core_hash)
  ||hash(b.artifact)!==b.artifact_sha256)fail('candidate_runtime_binding_changed');
 const baseline={...runtime,capability:{...runtime.capability,capability_id:b.base_capability_id}};
 // Verify the exact static core that was materialized and qualified before
 // deriving the v2 question projection from the same bound artifact.
 const rendered=renderPrivateCorrectionCandidate(baseline,b.artifact);
 if(rendered.core.length>6000||hash(rendered.core)!==b.core_hash)fail('candidate_runtime_core_changed');
 return question?renderPrivateCorrectionCandidate(baseline,b.artifact,question).core:rendered.core;
}

export function assertCandidateGenerator(runtime,generator){
 const b=runtime.candidateBinding;
 candidateRuntimeCore(runtime);
 if(!b)return;
 const model=materializationModel(generator,{AZURE_CORRECTION_BASE_MODEL_COMMITMENT:b.base_model_commitment});
 if(model.commitment!==b.model_commitment||hash(generator.revision_binding)!==hash(b.provider_revision_binding))
  fail('candidate_runtime_model_changed');
 const receipt=verifyProviderRevision({model:b.provider_identity?.response_model,
  system_fingerprint:b.provider_identity?.system_fingerprint},generator.revision_binding);
 assertSameReportedRevision(receipt,b.provider_identity);
}

export function assertCandidateResponse(runtime,generator,generated){
 if(!runtime.candidateBinding)return;
 assertCandidateGenerator(runtime,generator);
 const receipt=verifyProviderRevision({model:generated?.provider_identity?.response_model,
  system_fingerprint:generated?.provider_identity?.system_fingerprint},generator.revision_binding,generated?.usage);
 assertSameReportedRevision(receipt,generated.provider_identity);
 assertSameReportedRevision(runtime.candidateBinding.provider_identity,receipt);
}

export function assertCandidateRuntimeUnchanged(before,after,question=""){
 if(!after||after.capability.capability_id!==before.capability.capability_id
  ||hash(after.candidateBinding)!==hash(before.candidateBinding)
  ||candidateRuntimeCore(after,question)!==candidateRuntimeCore(before,question))fail('candidate_runtime_authority_changed');
}
