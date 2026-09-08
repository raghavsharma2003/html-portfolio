import assert from 'node:assert/strict';
import {canonicalJson,sha256Hex} from '../../api/_provenance/contracts.js';
import {candidateRuntimeCore,assertCandidateGenerator,assertCandidateResponse,assertCandidateRuntimeUnchanged} from '../../api/_replica-candidate-runtime.js';
import {buildPrivateCorrectionArtifact,renderPrivateCorrectionCandidate} from '../../api/_replica-correction-artifact.js';
import {materializationModel} from '../../api/_replica-candidate-materializer.js';
import {prepareProviderRevisionBinding,verifyProviderRevision} from '../../api/_dialogue/provider-revision.js';
import {compileDialoguePrompt} from '../../api/_dialogue/contracts.js';
const hash=v=>sha256Hex(canonicalJson(v));
const base={replica:{replica_id:'10000000-0000-4000-8000-000000000001'},capability:{capability_id:'20000000-0000-4000-8000-000000000001'},
 personProfile:{definition:{identity:{self_name:'Synthetic expert'},knowledge:[
  ...Array.from({length:12},(_,i)=>({key:`geometry_${i}`,statement:`Geometry lesson ${i} concerns angles.`})),
  {key:'chemistry_sn1',statement:'SN1 kinetics depend only on substrate concentration.'}
 ]}},calibration:{definition:{strategies:[]}},candidateBinding:null};
const artifact=buildPrivateCorrectionArtifact(base,{status:'proposed',owner_approved:false,runtime_eligible:false,source_set_hash:'a'.repeat(64),
 selections:[{scenario_id:'delivery.turn_shape',strategy_id:'compact_observation'}]}).artifact;
const revision=prepareProviderRevisionBinding({expectedResponseModel:'gpt-4.1-mini-2025-04-14',
 endpoint:'https://raghavsharma1729-compan-resource.services.ai.azure.com',deployment:'gpt-4.1-mini',baselineSnapshotHash:'b'.repeat(64)});
const adapter={family:'dialogue',name:'azure-foundry-structured-output',version:'synthetic-v1',model:'gpt-4.1-mini',
 billing:{meter:'azure_foundry_tokens',max_output_tokens:700},revision_binding:revision,generate(){throw Error('NO_PROVIDER_CALL');}};
const identity=verifyProviderRevision({model:revision.expected_response_model,system_fingerprint:'fp_synthetic'},revision);
const core=renderPrivateCorrectionCandidate(base,artifact).core;
const active={...base,capability:{capability_id:'30000000-0000-4000-8000-000000000001',state:'private',private_selection:true,candidate_binding_required:true},candidateBinding:{
 exposure:'owner_private_text',selection_kind:'qualified',activation_id:'40000000-0000-4000-8000-000000000001',candidate_id:'50000000-0000-4000-8000-000000000001',base_capability_id:base.capability.capability_id,
 artifact,artifact_sha256:hash(artifact),build_manifest_hash:'c'.repeat(64),core_hash:hash(core),base_model_commitment:'b'.repeat(64),
 model_commitment:materializationModel(adapter,{AZURE_CORRECTION_BASE_MODEL_COMMITMENT:'b'.repeat(64)}).commitment,
 provider_revision_binding:revision,provider_identity:identity}};
let groups=0;
const test=(label,fn)=>{fn();console.log(`ok ${++groups} - ${label}`);};
const change=(fn)=>{const copy=structuredClone(active);fn(copy);return copy;};
test('baseline keeps existing core and has no provider revision requirement',()=>{assert.match(candidateRuntimeCore(base),/Synthetic expert/);assertCandidateGenerator(base,{});});
test('private baseline keeps baseline bytes with a distinct immutable capability',()=>{const privateBase={...base,capability:{...base.capability,capability_id:'60000000-0000-4000-8000-000000000001',state:'private',private_selection:true}};
 assert.equal(candidateRuntimeCore(privateBase),candidateRuntimeCore(base));assertCandidateGenerator(privateBase,{});
 assert.throws(()=>assertCandidateRuntimeUnchanged(base,privateBase),/authority_changed/);
 assert.throws(()=>assertCandidateRuntimeUnchanged(privateBase,base),/authority_changed/);});
test('activated artifact renders exactly the compared experimental bytes',()=>{assert.equal(candidateRuntimeCore(active),core);assertCandidateGenerator(active,adapter);
 assert.deepEqual(compileDialoguePrompt({core:candidateRuntimeCore(active),message:'Hello'}),compileDialoguePrompt({core,message:'Hello'}));});
test('question selection changes only ordinary profile knowledge, never the compared candidate core',()=>{
 assert.match(candidateRuntimeCore(base,'Explain SN1 kinetics'),/knowledge\.chemistry_sn1:/);
 assert.doesNotMatch(candidateRuntimeCore(base),/knowledge\.chemistry_sn1:/);
 assert.equal(candidateRuntimeCore(active,'Explain SN1 kinetics'),core);
 assert.throws(()=>candidateRuntimeCore(change(r=>r.candidateBinding=null),'Explain SN1 kinetics'),/binding_unavailable/);
});
test('dense selected candidate refuses before downstream dialogue can cut a reviewed condition',()=>{
 const denseBase=structuredClone(base);
 denseBase.personProfile.definition.knowledge=Array.from({length:12},(_,i)=>({key:`dense_${i}`,
  statement:'Reviewed constraint. '.repeat(22)+'Valid only for this stated condition.'}));
 const denseArtifact=buildPrivateCorrectionArtifact(denseBase,{status:'proposed',owner_approved:false,runtime_eligible:false,source_set_hash:'a'.repeat(64),
  selections:[{scenario_id:'delivery.turn_shape',strategy_id:'compact_observation'}]}).artifact;
 const denseCore=renderPrivateCorrectionCandidate(denseBase,denseArtifact).core;
 assert.ok(denseCore.length>6000);
 const denseActive={...active,personProfile:denseBase.personProfile,candidateBinding:{...active.candidateBinding,
  artifact:denseArtifact,artifact_sha256:hash(denseArtifact),core_hash:hash(denseCore)}};
 assert.throws(()=>candidateRuntimeCore(denseActive,'Explain the constraints'),/candidate_runtime_core_changed/);
});
test('capability marker refuses missing binding instead of baseline fallback',()=>assert.throws(()=>candidateRuntimeCore(change(r=>r.candidateBinding=null)),/binding_unavailable/));
test('missing exposure refuses activation at the actual renderer guard',()=>assert.throws(()=>candidateRuntimeCore(change(r=>delete r.candidateBinding.exposure)),/exposure_not_authorized/));
test('qualified and explicitly experimental selections preserve exact compared core',()=>{for(const selection_kind of ['qualified','experimental'])
 assert.equal(candidateRuntimeCore(change(r=>r.candidateBinding.selection_kind=selection_kind)),core);});
test('missing or unknown selection authority refuses dispatch',()=>{for(const selection_kind of [undefined,'draft','passed',''])
 assert.throws(()=>assertCandidateGenerator(change(r=>r.candidateBinding.selection_kind=selection_kind),adapter),/selection_not_authorized/);});
test('voice and publication exposure never inherit private text approval',()=>{for(const exposure of ['owner_private_voice','public_text','private_call',''])
 assert.throws(()=>assertCandidateGenerator(change(r=>r.candidateBinding.exposure=exposure),adapter),/exposure_not_authorized/);});
test('artifact and compared core commitments cannot change',()=>{for(const field of ['artifact_sha256','core_hash'])assert.throws(()=>candidateRuntimeCore(change(r=>r.candidateBinding[field]='d'.repeat(64))));});
test('baseline changes invalidate experimental rendering',()=>assert.throws(()=>candidateRuntimeCore(change(r=>r.personProfile.definition.identity.self_name='Other')),/baseline_changed/));
test('model and deployment receipt changes refuse dispatch',()=>{assert.throws(()=>assertCandidateGenerator(active,{...adapter,version:'different'}),/model_changed/);
 assert.throws(()=>assertCandidateGenerator(active,{...adapter,revision_binding:null}));});
test('exact paired provider receipt is accepted',()=>assertCandidateResponse(active,adapter,{provider_identity:identity,usage:{input_tokens:1,output_tokens:1}}));
test('changed actual response fingerprint refuses completion',()=>{const changed=verifyProviderRevision({model:revision.expected_response_model,system_fingerprint:'fp_other'},revision);
 assert.throws(()=>assertCandidateResponse(active,adapter,{provider_identity:changed}),/revision_mismatch/);});
test('missing or forged returned revision refuses completion',()=>{assert.throws(()=>assertCandidateResponse(active,adapter,{}));
 assert.throws(()=>assertCandidateResponse(active,adapter,{provider_identity:{...identity,reported_revision_hash:'e'.repeat(64)}}));});
test('withdrawal and capability switch refuse completion',()=>{assert.throws(()=>assertCandidateRuntimeUnchanged(active,null));
 assert.throws(()=>assertCandidateRuntimeUnchanged(active,base));assert.throws(()=>assertCandidateRuntimeUnchanged(active,change(r=>r.candidateBinding.activation_id='other')));
 assertCandidateRuntimeUnchanged(active,structuredClone(active));});
console.log(`${groups} candidate runtime guard groups passed; no provider or database calls`);
