// Purpose boundaries are called at upload, lease, fresh context and commit.
import {getIssuedVoiceProfile} from '../_voice-identity/issued-contract.js';
export const COMPARISON_SOURCE_PURPOSE='comparison_reference';
export const COMPARISON_PREPARATION_PURPOSE='private-comparison-preparation/v1';
export const COMPARISON_STEPS=Object.freeze(['integrity','malware_scan','media_probe','diarize','separate','enhance','voice_quality']);
export const COMPARISON_MODEL_STEPS=Object.freeze(['diarize','separate','enhance','voice_quality']);
export function isComparisonSource(source){return source?.purpose===COMPARISON_SOURCE_PURPOSE||source?.provenance?.purpose===COMPARISON_SOURCE_PURPOSE;}
export function comparisonError(code,status=409){return Object.assign(Error(code),{code,status,retryable:false});}
export function comparisonPreparationReadiness(){return Object.freeze({available:false,waiting_on:'us',code:'comparison_gpu_accounting_unavailable',can_upload:true,can_prepare:false});}
function alias(a){if(!/^[a-z][a-z0-9_]*$/.test(a))throw Error('invalid_internal_alias');return a;}
export function comparisonAuthoritySql(source='s',job=null,options={}){
 alias(source);if(job)alias(job);
 return `exists (select 1 from vy_replica_comparison_preparation cp
 join vy_replica cr on cr.replica_id=cp.replica_id and cr.owner_user_id=cp.owner_user_id
 join vy_replica_consent cc on cc.consent_id=(cp.receipt->>'capture_consent_id')::uuid
 join vy_replica_consent cs on cs.consent_id=(cp.receipt->>'storage_consent_id')::uuid
 where cp.source_id=${source}.source_id and cp.replica_id=${source}.replica_id and cp.owner_user_id=${source}.owner_user_id
 and cp.state in (${options.completed===true?"'prepared'":"'authorized','queued','running'"}) and cp.expires_at>now()
 and cr.subject_mode='self' and cr.lifecycle not in ('revoked','purging') and cr.policy_version=cp.policy_version
 and cr.private_text_epoch=(cp.receipt->>'authority_epoch')::bigint
 and ${source}.purpose='${COMPARISON_SOURCE_PURPOSE}' and ${source}.sha256=cp.receipt->>'source_sha256'
 and ${source}.byte_size=(cp.receipt->>'byte_size')::bigint and ${source}.mime=cp.receipt->>'mime'
 and ${source}.contains_third_parties=false and ${source}.state not in ('deleting','rejected')
 and cc.replica_id=cp.replica_id and cc.owner_user_id=cp.owner_user_id and cc.scope='capture'
 and cs.replica_id=cp.replica_id and cs.owner_user_id=cp.owner_user_id and cs.scope='storage'
 and cc.policy_version=cp.policy_version and cs.policy_version=cp.policy_version
 and cc.revoked_at is null and cs.revoked_at is null
 and (cc.expires_at is null or cc.expires_at>now()) and (cs.expires_at is null or cs.expires_at>now())
 ${job?`and ${job}.comparison_preparation_id=cp.preparation_id and ${job}.revision=1
 and ${job}.step in ('integrity','malware_scan','media_probe','diarize','separate','enhance','voice_quality')
 and (${job}.step in ('integrity','malware_scan','media_probe') or ${source}.duration_ms between 1 and cp.max_duration_ms)` : ''})`;
}
export function assertComparisonPurpose(source,step){if(!isComparisonSource(source))return;
 if(!COMPARISON_STEPS.includes(step))throw comparisonError('comparison_processing_step_forbidden');
 if(!['audio','video'].includes(source.kind)||source.contains_third_parties!==false)throw comparisonError('comparison_source_ineligible');
 if(COMPARISON_MODEL_STEPS.includes(step)&&(!Number.isInteger(source.duration_ms)||source.duration_ms<1||source.duration_ms>60000))throw comparisonError('comparison_duration_out_of_bounds');
}
export function assertComparisonVoiceEvidence(evidence){
 const measured=evidence.filter(e=>e.evidence_type==='voice_measurement');
 const expected=getIssuedVoiceProfile().speaker.expected_candidate_revisions;
 if(measured.length!==1||Object.entries(expected).some(([k,v])=>measured[0].value?.measurements?.model_revisions?.[k]!==v))throw comparisonError('comparison_reference_revision_unavailable',503);
 const inputSet=measured[0].value.input_set;
 if(!Array.isArray(inputSet)||inputSet.length<1||inputSet.length>2)throw comparisonError('comparison_reference_input_set_invalid');
 for(const input of inputSet)for(const [family,model]of Object.entries({'speechbrain-ecapa-voxceleb':'speechbrain-ecapa','speechbrain-xvector-voxceleb':'speechbrain-xvector'})){
  const matching=evidence.filter(e=>e.evidence_type==='voice_embedding'&&e.artifact_id===input.artifact_id&&e.input_sha256===input.sha256&&e.value.family===family);
  if(matching.length!==1||matching[0].value.model_revision!==expected[model])throw comparisonError('comparison_reference_revision_unavailable',503);
  const vector=matching[0].value.vector,wanted=family==='speechbrain-ecapa-voxceleb'?192:512;
  if(!Array.isArray(vector)||vector.length!==wanted||vector.some(v=>!Number.isFinite(v)))throw comparisonError('comparison_reference_embedding_invalid');
 }
}
