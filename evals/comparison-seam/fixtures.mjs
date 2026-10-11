import assert from 'node:assert/strict';
import {sha256Hex} from '../../api/_replica-processing/contracts.js';
import {processingCompletionReceipt} from '../../api/_replica-processing/queue.js';
import {memoryFixture,uid,authorize,bytes} from '../comparison-reference/fixtures.mjs';
import * as store from '../../api/_comparison-reference.js';
import {getOwnedModernComparisonDescriptor,issueOwnedModernChallenge,MODERN_AUTHORITY_SNAPSHOT_SQL,MODERN_AUTHORITY_ISSUE_SQL,MODERN_COMPARISON_DESCRIPTOR_SQL} from '../../api/_liveness/issued-authority.js';
import {BIOMETRIC_VERIFICATION_ATTESTATIONS} from '../../api/_replica-liveness.js';
export function freshFixture(){
 const f=memoryFixture(),c=f.state.candidate,b=c.binding,pid=uid(40);
 const receipt={statement_set:'private-comparison-preparation/v1',policy_version:b.policy_version,attestations:{recording_is_only_me:true,process_for_private_comparison:true,no_training_or_public_voice_permission:true},preparation_id:pid,source_id:b.primary_source_id,replica_id:b.replica_id,owner_user_id:b.owner_user_id,source_sha256:b.primary_source_sha256,
 capture_consent_id:b.capture_consent_id,storage_consent_id:b.storage_consent_id,authority_epoch:b.authority_epoch};
 const rh=sha256Hex(receipt),completed=processingCompletionReceipt({step:'voice_quality',artifact_ids:[],evidence_ids:b.evidence_pins.map(e=>e.evidence_id),next_steps:[],
 verified_input_sha256:b.primary_source_sha256,purpose:'private-comparison-preparation/v1',preparation_id:pid,preparation_receipt_sha256:rh});
 c.preparation={preparation_id:pid,replica_id:b.replica_id,owner_user_id:b.owner_user_id,source_id:b.primary_source_id,state:'prepared',expires_at:c.expires_at,
 receipt,receipt_sha256:rh,completed_receipt:structuredClone(completed),completed_receipt_sha256:completed.manifest_hash};
 Object.assign(b,{primary_selection_id:null,comparison_preparation_id:pid,comparison_preparation_receipt_hash:rh,comparison_completed_receipt_hash:completed.manifest_hash});return f;
}
export async function selectedFresh(){const f=freshFixture();const input=await authorize(f);await store.auditionComparisonReference(f.db,uid(2),input,f.readPrivate);
 const status=await store.readComparisonReference(f.db,uid(2),uid(1),input.reference_id);
 await store.confirmComparisonReference(f.db,uid(2),{...input,expected_snapshot_hash:status.snapshot_hash,confirm_this_is_my_voice:true});return f;}
export async function issuanceFixture(){const f=await selectedFresh(),c=f.state.candidate,h=f.state.rows.get(uid(10));
 const b={...c.binding,primary_selection_id:h.reference_id,subject_person_id:uid(20),identity_case_id:uid(21),identity_source_id:uid(22),identity_source_sha256:'c'.repeat(64),
 reference_authority_epoch:c.observed_epoch,reference_authority_kind:'private_comparison_reference',comparison_reference_id:h.reference_id,comparison_reference_receipt_hash:h.receipt_hash};
 const row={binding:b,reference_rows:c.reference_rows,comparison_receipt:h,preparation:c.preparation,server_now:new Date().toISOString(),issuance_fence:[]};
 const descriptorRow={binding:c.binding,reference_rows:c.reference_rows,comparison_receipt:h,preparation:c.preparation,...b,source_id:c.source_id,
 primary_selection_id:h.reference_id,sha256:b.primary_source_sha256,created_at:c.source_created_at,private_text_epoch:b.authority_epoch};
 const descriptor=await getOwnedModernComparisonDescriptor(async()=>[descriptorRow],uid(2),uid(1));
 const input={expected_primary_source_id:c.source_id,expected_primary_selection_id:h.reference_id,expected_primary_source_sha256:b.primary_source_sha256,
 expected_comparison_snapshot_sha256:descriptor.comparison_snapshot_sha256,locale:'hi-IN',attestations:Object.fromEntries(BIOMETRIC_VERIFICATION_ATTESTATIONS.map(k=>[k,true])),
 comparison_attestations:{selected_reference_is_my_voice:true,compare_this_capture_to_selected_reference:true,comparison_is_private_verification_only:true}};
 let writes=0;const db=async(sql,p)=>{if(sql===MODERN_AUTHORITY_SNAPSHOT_SQL)return[row];assert.equal(sql,MODERN_AUTHORITY_ISSUE_SQL);writes++;
 const saved=JSON.parse(p[5]);assert.equal(saved.binding.primary_selection_id,h.reference_id);assert.equal(saved.binding.comparison_preparation_id,c.preparation.preparation_id);
 return[{challenge_id:saved.envelope.contract.challengeId,replica_id:uid(1),state:'issued',phrase:saved.envelope.phrase,attempt:1,issued_at:row.server_now,expires_at:saved.envelope.contract.expiresAt}];};
 return{f,row,descriptorRow,descriptor,input,db,writes:()=>writes};
}
