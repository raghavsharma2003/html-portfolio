import assert from 'node:assert/strict';
import ts from 'typescript';
import {sha256Hex} from '../../api/_replica-processing/contracts.js';
import {processingCompletionReceipt} from '../../api/_replica-processing/queue.js';
import {readFileSync} from 'node:fs';
import {freshFixture,selectedFresh,issuanceFixture} from './fixtures.mjs';
import {uid,authorize} from '../comparison-reference/fixtures.mjs';
import * as store from '../../api/_comparison-reference.js';
import {getOwnedModernComparisonDescriptor,issueOwnedModernChallenge,MODERN_COMPARISON_DESCRIPTOR_SQL,MODERN_AUTHORITY_SNAPSHOT_SQL} from '../../api/_liveness/issued-authority.js';
let n=0;const check=async(name,fn)=>{await fn();console.log(`ok ${++n} - ${name}`);};globalThis.fetch=()=>{throw Error('provider_forbidden');};
await check('fresh completed evidence is discoverable with no ordinary primary selection',async()=>{const f=freshFixture();assert.equal(f.state.candidate.binding.primary_selection_id,null);
 const d=await store.comparisonReferenceOptions(f.db,uid(2),uid(1));assert.equal(d.options.length,1);assert.equal(d.options[0].purpose,'comparison_reference');assert.equal(d.options[0].preparation_id,uid(40));assert.equal(d.capture_ready,false);});
for(const key of ['state','expires_at','owner_user_id','source_id','receipt_sha256','completed_receipt_sha256'])await check(`fresh ${key} drift refuses before consent or private access`,async()=>{const f=freshFixture(),p=f.state.candidate.preparation;
 p[key]=key==='expires_at'?'2000-01-01':key==='state'?'revoked':key.endsWith('_id')?uid(99):'e'.repeat(64);
 await assert.rejects(()=>store.comparisonReferenceOptions(f.db,uid(2),uid(1)),/comparison_preparation_changed/);assert(!f.state.calls.some(c=>c.sql===store.COMPARISON_AUTHORIZE_SQL));});
await check('rehash of completion cannot substitute a missing evidence member',async()=>{const f=freshFixture();const c=f.state.candidate,p=c.preparation;p.completed_receipt=processingCompletionReceipt({...p.completed_receipt,evidence_ids:[]});p.completed_receipt_sha256=p.completed_receipt.manifest_hash;c.binding.comparison_completed_receipt_hash=p.completed_receipt_sha256;
 await assert.rejects(()=>store.comparisonReferenceOptions(f.db,uid(2),uid(1)),/comparison_completed_receipt_invalid/);});
await check('rehashed false preparation consent cannot become a fresh candidate',async()=>{const f=freshFixture(),c=f.state.candidate,p=c.preparation;
 p.receipt.attestations.process_for_private_comparison=false;p.receipt_sha256=sha256Hex(p.receipt);c.binding.comparison_preparation_receipt_hash=p.receipt_sha256;
 await assert.rejects(()=>store.comparisonReferenceOptions(f.db,uid(2),uid(1)),/comparison_preparation_changed/);});
await check('foreign owner cannot discover prepared reference or private receipt',async()=>{const f=await selectedFresh();assert.equal((await store.comparisonReferenceOptions(f.db,uid(99),uid(1))).options.length,0);
 await assert.rejects(()=>store.readComparisonReference(f.db,uid(99),uid(1),uid(10)),/comparison_reference_not_found/);});
await check('completed preparation uses explicit use, audition and owner confirmation, not training mutation',async()=>{const f=await selectedFresh(),h=f.state.rows.get(uid(10));assert.equal(h.state,'selected');assert.equal(h.receipt_payload.binding.primary_selection_id,null);
 assert(!f.state.calls.some(c=>/update vy_replica_voice_reference|insert into vy_replica_model_build/.test(c.sql)));});
await check('descriptor binds selected reference UUID instead of ordinary primary UUID',async()=>{const a=await issuanceFixture();assert.equal(a.descriptor.primary_selection_id,uid(10));assert.equal(a.descriptor.selection_kind,'private_comparison_reference');
 assert(!JSON.stringify(a.descriptor).includes('vector'));assert.equal((await issueOwnedModernChallenge(a.db,uid(2),uid(1),a.input)).state,'issued');assert.equal(a.writes(),1);});
await check('ordinary primary UUID cannot issue fresh selected comparison',async()=>{const a=await issuanceFixture();await assert.rejects(()=>issueOwnedModernChallenge(a.db,uid(2),uid(1),{...a.input,expected_primary_selection_id:uid(6)}),/comparison_preview_changed/);assert.equal(a.writes(),0);});
await check('withdrawal of preparation between preview and issuance refuses before mutation',async()=>{const a=await issuanceFixture();a.row.preparation.state='revoked';await assert.rejects(()=>issueOwnedModernChallenge(a.db,uid(2),uid(1),a.input),/comparison_preparation_changed/);assert.equal(a.writes(),0);});
await check('selected stale record cannot silently fall back to ordinary descriptor',async()=>{const a=await issuanceFixture();assert.equal(await getOwnedModernComparisonDescriptor(async()=>[{...a.descriptorRow,binding:null}],uid(2),uid(1)),null);assert(MODERN_COMPARISON_DESCRIPTOR_SQL.includes('from ordinary where not exists(select 1 from selected)'));});
await check('actual generated SQL uses outer source/job correlations and completion constraints',()=>{const q=store.COMPARISON_OPTIONS_SQL;assert(q.includes('s.source_id=outer_source.source_id'));assert(q.includes('j.job_id=outer_job.job_id'));
 assert(q.includes("outer_source.purpose<>'comparison_reference' or prepared.preparation_id is not null"));assert(q.includes("j.result=cp.completed_receipt"));assert(q.includes('join current_job j on j.source_id=s.source_id'));
 assert(MODERN_AUTHORITY_SNAPSHOT_SQL.includes("s.purpose<>'comparison_reference'"));assert(MODERN_AUTHORITY_SNAPSHOT_SQL.includes('selected.reference_id=$4::uuid'));
});
const journey=readFileSync(new URL('../../src/studio/CloneVerificationJourney.tsx',import.meta.url),'utf8');
const segment=journey.split('// stage-model:start')[1].split('// stage-model:end')[0],model={};
new Function('exports',ts.transpileModule(segment,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(model);
const facts={replica:{lifecycle:'enrolling',age_verified:false,identity_verified:false,liveness_verified:false},sources:[],consents:['capture','storage'].map(scope=>({scope,revoked_at:null,expires_at:null})),review:null,comparisonSourceId:uid(3)};
for(const [name,patch,wanted] of [
 ['fresh selection without ordinary primary/transcription reaches identity document',{},'identity_document'],
 ['private selection with age evidence reaches live capture',{replica:{...facts.replica,age_verified:true}},'liveness'],
 ['private identity completion never enters ordinary training without ordinary primary',{replica:{...facts.replica,age_verified:true,identity_verified:true,liveness_verified:true},consents:[...facts.consents,{scope:'biometric'}]},'primary_source'],
 ['revoked clone blocks private path',{replica:{...facts.replica,lifecycle:'revoked'}},'stopped'],
 ['missing storage prevents private path',{consents:[{scope:'capture'}]},'source_permission'],
 ['self-test identity remains blocked',{review:{self_test_mode:true}},'self_test_blocked'],
 ['no server-selected comparison preserves ordinary permission requirements',{comparisonSourceId:null},'source_permission'],
])await check(name,()=>assert.equal(model.deriveCloneVerificationStage({...facts,...patch}),wanted));
console.log(`${n} dedicated preparation/comparison seam controls passed; synthetic callbacks, no SQL/provider execution`);
