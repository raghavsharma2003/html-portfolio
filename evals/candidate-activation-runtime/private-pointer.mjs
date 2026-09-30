// Execute real loader/routing functions with scoped fixture DB responses.
// This proves caller separation and no fallback, not SQL predicate semantics.
import assert from 'node:assert/strict';
import {loadOwnedRuntimeContext,loadOwnedPrivateRuntimeContext,OWNED_RUNTIME_CONTEXT_SQL,OWNED_PRIVATE_RUNTIME_CONTEXT_SQL} from '../../api/_replica-runtime.js';
import {assertCandidateRuntimeUnchanged,candidateRuntimeCore} from '../../api/_replica-candidate-runtime.js';
import {createClonePublicAuthorityGuard,CLONE_PUBLIC_AUTHORITY_SQL} from '../../api/_clonechannel.js';
import {readOwnedDialogueHistory,DIALOGUE_HISTORY_SQL} from '../../api/_replica-dialogue-history.js';
const id=n=>`${n}0000000-0000-4000-8000-000000000001`;
const rid=id(1),owner=id(2),globalCap=id(3),privateCap=id(4),session=id(5);
const baseline={replica_id:rid,owner_user_id:owner,subject_person_id:id(6),agent_id:id(7),capability_id:globalCap,
 capability_state:'active',candidate_binding_required:false,profile_definition:{identity:{self_name:'Synthetic expert'}},
 calibration_definition:{strategies:[]},profile_version:1,calibration_version:1,genome_version:1};
let pointer=true,privateAuthority=true;const seen=[];
const db=async(sql,params)=>{
 seen.push(sql);assert.deepEqual(params.slice(0,2),[rid,owner]);
 if(sql===OWNED_RUNTIME_CONTEXT_SQL)return [baseline];
 if(sql===OWNED_PRIVATE_RUNTIME_CONTEXT_SQL)return !privateAuthority?[]:
  [pointer?{...baseline,capability_id:privateCap,capability_state:'private'}:baseline];
 throw Error('UNEXPECTED_QUERY');
};
const global=await loadOwnedRuntimeContext(db,owner,rid),selected=await loadOwnedPrivateRuntimeContext(db,owner,rid);
assert.equal(global.capability.capability_id,globalCap,'global runtime remains on active baseline while private pointer exists');
assert.equal(selected.capability.capability_id,privateCap,'owner runtime resolves independent selected identity');
assert.equal(selected.capability.private_selection,true);
assert.equal(selected.candidateBinding,null,'private baseline does not invent a candidate binding');
assert.equal(candidateRuntimeCore(selected),candidateRuntimeCore(global),'private baseline preserves approved core');
assert.throws(()=>assertCandidateRuntimeUnchanged(global,selected),/authority_changed/,'pointer selection prevents old global owner turn completing');
assert.throws(()=>assertCandidateRuntimeUnchanged(selected,global),/authority_changed/,'pointer change prevents old selected turn completing');
privateAuthority=false;seen.length=0;
assert.equal(await loadOwnedPrivateRuntimeContext(db,owner,rid),null,'missing private authority stays unavailable');
assert.deepEqual(seen,[OWNED_PRIVATE_RUNTIME_CONTEXT_SQL],'missing private evidence never queries global fallback');
assert.equal((await loadOwnedRuntimeContext(db,owner,rid)).capability.capability_id,globalCap,'private outage does not remove global baseline');
const resolved={slug:'synthetic',sheet:{name:'Synthetic'},channel:{channel_id:id(8),replica_id:rid,owner_user_id:owner,agent_id:id(7),kind:'telegram',external_ref:'synthetic'}};
let publicReads=0;
await createClonePublicAuthorityGuard(async sql=>{assert.equal(sql,CLONE_PUBLIC_AUTHORITY_SQL);publicReads++;return [{channel_id:id(8)}];},resolved)();
assert.equal(publicReads,1,'public authority continues checking its global binding independently of selected private pointer');
const row={runtime_active:true,session_id:session,text_only:true,pending:true,latest_request:{trace_id:'pending_old',state:'generating'},billing_candidates:[],exchanges:[{
 turn_id:id(9),question:'Hello',reply:'Hello again.',has_continuity:false,
 delivery:{mode:'warm',pace:'natural',intensity:0.5,language_hint:'English',nonverbals:[]}}]};
const history=await readOwnedDialogueHistory(async sql=>{assert.equal(sql,DIALOGUE_HISTORY_SQL);return [row];},owner,{replica_id:rid,session_id:session});
assert.equal(history.exchanges[0].answer.can_voice,false,'private baseline and immediate-prior history stay text-only');
assert.equal(history.pending,true);assert.equal(history.latest_request.trace_id,'pending_old','uncertain prior request handle remains visible');
pointer=false;privateAuthority=true;
assert.equal((await loadOwnedPrivateRuntimeContext(db,owner,rid)).capability.capability_id,globalCap,'no selection uses global baseline normally');
console.log('8 private-pointer loader/routing/history groups passed with scoped synthetic DB responses; SQL semantics require real proof');
