// Synthetic control-flow proof only. The exported SQL still needs actual
// PostgreSQL parsing and root's witnessed concurrency acceptance before release.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {issueOwnedModernChallenge,createModernCaptureAuthorityLoader,getOwnedModernComparisonDescriptor,referenceFromAuthority,
 MODERN_COMPARISON_DESCRIPTOR_SQL,MODERN_AUTHORITY_SNAPSHOT_SQL,MODERN_AUTHORITY_ISSUE_SQL,
 MODERN_AUTHORITY_RECEIPT_SQL,MODERN_AUTHORITY_LOAD_SQL,SELECTED_COMPARISON_ATTESTATIONS} from '../../api/_liveness/issued-authority.js';
import {BIOMETRIC_VERIFICATION_ATTESTATIONS} from '../../api/_replica-liveness.js';
import {sha256Hex} from '../../api/_replica-processing/contracts.js';
import {configuredLivenessVerifier} from '../../api/_liveness/registry.js';
import {modernCaptureReadiness} from '../../api/_liveness/capture-readiness.js';
import {fixture,descriptorRow,leaseFor,clone,uid,NOW} from './fixtures.mjs';
import {prepareModernAuthoritySqlCases,addSnapshotBarrier,withoutReferenceEpochAdvance} from './sql-cases.mjs';
globalThis.fetch=async()=>{throw Error('outbound_forbidden');};
let n=0;const check=async(name,fn)=>{await fn();console.log(`ok ${++n} - ${name}`);};
const truth=keys=>Object.fromEntries(keys.map(k=>[k,true]));
async function prepared(f=fixture()) {
 const descriptor=await getOwnedModernComparisonDescriptor(async(sql,p)=>{
  assert.equal(sql,MODERN_COMPARISON_DESCRIPTOR_SQL);assert.deepEqual(p,[uid(1),uid(2)]);return[descriptorRow(f)];
 },uid(2),uid(1));
 return {f,descriptor,input:{locale:'hi-IN',expected_primary_source_id:uid(3),expected_primary_selection_id:uid(5),
  expected_primary_source_sha256:f.binding.primary_source_sha256,expected_comparison_snapshot_sha256:descriptor.comparison_snapshot_sha256,
  attestations:truth(BIOMETRIC_VERIFICATION_ATTESTATIONS),comparison_attestations:truth(SELECTED_COMPARISON_ATTESTATIONS)}};
}
async function issued(prep,commitResult=true) {
 prep ||= await prepared();
 let receipt,params;const calls=[];
 const response=await issueOwnedModernChallenge(async(sql,p)=>{
  calls.push(sql);if(sql===MODERN_AUTHORITY_SNAPSHOT_SQL)return[prep.f];
  assert.equal(sql,MODERN_AUTHORITY_ISSUE_SQL);params=p;receipt=JSON.parse(p[5]);
  assert.equal(sha256Hex(receipt),p[6]);assert.deepEqual(JSON.parse(p[4]),prep.f.binding);
  assert.deepEqual(JSON.parse(p[7]),prep.f.issuance_fence);
  const c=receipt.envelope.contract;
  assert.equal(receipt.binding.reference_authority_epoch,prep.f.binding.reference_authority_epoch+1);
  if(commitResult) prep.f={...prep.f,binding:clone(receipt.binding)};
  return commitResult?[{challenge_id:c.challengeId,replica_id:c.replicaId,phrase:receipt.envelope.phrase,
   state:'issued',attempt:1,issued_at:c.issuedAt,expires_at:c.expiresAt}]:[];
 },uid(2),uid(1),prep.input);
 return {receipt,response,params,calls,prep};
}
function loaderDb(state,{fresh=true,transformReceipt=x=>x,transformFresh=x=>x,onRead=()=>{}}={}) {
 const stored=transformReceipt(clone(state.receipt));
 return async(sql,p)=>{onRead(sql,p);
  if(sql===MODERN_AUTHORITY_RECEIPT_SQL)return[{receipt_payload:stored,receipt_hash:sha256Hex(stored)}];
  assert.equal(sql,MODERN_AUTHORITY_LOAD_SQL);assert.equal(p[8],sha256Hex(stored));
  assert.deepEqual(JSON.parse(p[4]),state.prep.f.binding);
  return fresh?[transformFresh(clone(state.prep.f))]:[];
 };
}
const state=await issued();
await check('actual issuer reads authority then persists one immutable receipt with exact independent hash',()=>{
 assert.deepEqual(state.calls,[MODERN_AUTHORITY_SNAPSHOT_SQL,MODERN_AUTHORITY_ISSUE_SQL]);
 assert.equal(state.receipt.envelope.contract.comparisonReceiptSha256,sha256Hex(state.receipt.comparison));
 assert.equal(state.response.state,'issued');assert(!JSON.stringify(state.receipt).includes('vector'));
 assert(!JSON.stringify(state.response).includes('receipt'));assert(!JSON.stringify(state.response).includes('evidence'));
});
await check('real registry calls persisted loader before any media/provider and never invents a verdict',async()=>{
 let reads=0,derivations=0;
 const env={REPLICA_LIVENESS_VERIFIER:'azure_face_speech_composite',AZURE_COMPOSITE_LIVENESS_ENABLED:'true',
  AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED:'true',AZURE_COMPOSITE_LIVENESS_ENDPOINT:'https://synthetic.azurecontainerapps.io/v1/liveness/verify',
  AZURE_COMPOSITE_LIVENESS_HMAC_KEY_B64:Buffer.alloc(32,3).toString('base64'),AZURE_COMPOSITE_LIVENESS_VERSION:'synthetic-v2'};
 const verifier=configuredLivenessVerifier({env,db:loaderDb(state,{onRead:()=>reads++}),now:()=>NOW,
  evidence:{derive:async()=>{derivations++;throw Error('synthetic_derivation_boundary');}},speech:{}});
 await assert.rejects(()=>verifier.verify(leaseFor(state.receipt)),/synthetic_derivation_boundary/);
 assert(reads>=4);assert.equal(derivations,1);assert.equal(modernCaptureReadiness().ready,false);
});
await check('persisted exact scope reload succeeds without any transport',async()=>{
 const actual=await createModernCaptureAuthorityLoader({db:loaderDb(state),now:()=>NOW})(leaseFor(state.receipt));
 assert.equal(actual.expectedHash,state.receipt.expected_contract_sha256);
 assert.equal(sha256Hex(actual.reference),state.receipt.envelope.contract.referenceEvidenceSha256);
});
for(const field of ['expected_primary_source_sha256','expected_comparison_snapshot_sha256'])await check(`preview mismatch refuses before mutation: ${field}`,async()=>{
 const prep=await prepared();prep.input[field]='0'.repeat(64);let writes=0;
 await assert.rejects(()=>issueOwnedModernChallenge(async(sql)=>{if(sql!==MODERN_AUTHORITY_SNAPSHOT_SQL)writes++;return[prep.f];},uid(2),uid(1),prep.input),/selection_changed|comparison_preview_changed/);
 assert.equal(writes,0);
});
for(const field of ['capture_consent_id','storage_consent_id','authority_epoch','reference_authority_epoch','primary_selection_id'])await check(`same reference cannot reuse consent across ${field}`,async()=>{
 const prep=await prepared();prep.f.binding[field]=field.endsWith('epoch')?8:uid(90);
 await assert.rejects(()=>issueOwnedModernChallenge(async()=>[prep.f],uid(2),uid(1),prep.input),/comparison_preview_changed/);
});
for(const key of [...BIOMETRIC_VERIFICATION_ATTESTATIONS,...SELECTED_COMPARISON_ATTESTATIONS])await check(`explicit false ${key} refuses before SQL`,async()=>{
 const prep=await prepared();const group=key in prep.input.attestations?'attestations':'comparison_attestations';prep.input[group][key]=false;
 await assert.rejects(()=>issueOwnedModernChallenge(()=>{throw Error('db_must_not_run');},uid(2),uid(1),prep.input),/explicit_consent_required/);
});
await check('accessor attestations cannot execute caller code',async()=>{
 const prep=await prepared();Object.defineProperty(prep.input.comparison_attestations,SELECTED_COMPARISON_ATTESTATIONS[0],{get(){throw Error('getter_must_not_run');}});
 await assert.rejects(()=>issueOwnedModernChallenge(()=>{throw Error('db_must_not_run');},uid(2),uid(1),prep.input),/explicit_consent_required/);
});
await check('failed eligibility is a named conflict; replacement SQL cannot swallow failed insert',async()=>{
 await assert.rejects(async()=>issued(await prepared(),false),/issuance_conflict/);
 const text=MODERN_AUTHORITY_ISSUE_SQL;
 assert(text.indexOf('), expired as (')<text.indexOf('), issued as ('));
 assert(text.includes('and exists(select 1 from eligible)'));
 assert(text.includes('cross join (select count(*) from expired_grants) grants_cleared'));
 assert(!text.includes('on conflict do nothing'));
});
for(const field of ['replicaId','ownerUserId','challengeId','phrase','phraseHash','sourceId'])await check(`wrong lease ${field} refuses`,async()=>{
 const lease=leaseFor(state.receipt);lease[field]=field==='phrase'||field==='phraseHash'?'altered':uid(91);
 let reads=0;const db=loaderDb(state,{onRead:(sql,p)=>{reads++;if(sql===MODERN_AUTHORITY_LOAD_SQL)assert.equal(JSON.parse(p[7])[field],lease[field]);},fresh:false});
 await assert.rejects(()=>createModernCaptureAuthorityLoader({db,now:()=>NOW})(lease),/lease_mismatch|authority_withdrawn/);
 assert(reads<=2);
});
await check('expired receipt refuses before locked authority read',async()=>{
 let reads=0;await assert.rejects(()=>createModernCaptureAuthorityLoader({db:loaderDb(state,{onRead:()=>reads++}),now:()=>NOW+600000})(leaseFor(state.receipt)),/expired/);assert.equal(reads,1);
});
await check('legacy and missing stored receipts are never upgraded',async()=>{
 await assert.rejects(()=>createModernCaptureAuthorityLoader({db:async()=>[],now:()=>NOW})(leaseFor(state.receipt)),/authority_unavailable/);
 await assert.rejects(()=>createModernCaptureAuthorityLoader({db:loaderDb(state,{transformReceipt:r=>({...r,statement_set:'biometric-verification-consent/v1'})}),now:()=>NOW})(leaseFor(state.receipt)),/authority_unavailable/);
});
for(const field of ['expected_contract_sha256','biometric_attestations','comparison','binding'])await check(`rehashed bad persisted ${field} refuses`,async()=>{
 const change=r=>{if(field==='expected_contract_sha256')r[field]='f'.repeat(64);
  if(field==='biometric_attestations')r[field]={};if(field==='comparison')r.comparison.primary_source_id=uid(92);
  if(field==='binding')r.binding.subject_person_id=uid(92);return r;};
 await assert.rejects(()=>createModernCaptureAuthorityLoader({db:loaderDb(state,{transformReceipt:change}),now:()=>NOW})(leaseFor(state.receipt)),/commitment_mismatch|explicit_consent_required|receipt_binding_mismatch/);
});
await check('withdrawal at locked recheck prevents reference return',async()=>{
 await assert.rejects(()=>createModernCaptureAuthorityLoader({db:loaderDb(state,{fresh:false}),now:()=>NOW})(leaseFor(state.receipt)),/authority_withdrawn/);
});
await check('actual loader independently rejects post-review epoch even if a DB wrapper returns a row',async()=>{
 await assert.rejects(()=>createModernCaptureAuthorityLoader({db:loaderDb(state,{transformFresh:f=>{
  f.binding.reference_authority_epoch++;return f;}}),now:()=>NOW})(leaseFor(state.receipt)),/authority_changed/);
});
await check('changed private evidence value with old immutable hash refuses',async()=>{
 await assert.rejects(()=>createModernCaptureAuthorityLoader({db:loaderDb(state,{transformFresh:f=>{f.reference_rows.find(e=>e.evidence_type==='voice_embedding').value.vector[0]=.8;return f;}}),now:()=>NOW})(leaseFor(state.receipt)),/reference_record_mismatch/);
});
await check('historical missing VAD provenance cannot be inferred from expected model profile',()=>{
 const f=fixture({omitVad:true});
 assert.throws(()=>referenceFromAuthority(f),/reference_revision_unavailable/);
});
await check('SQL errors remain errors and NOWAIT conflict is explicitly busy',async()=>{
 const p=await prepared();for(const code of ['42703','40P01','55P03'])await assert.rejects(()=>issueOwnedModernChallenge(async()=>{throw Object.assign(Error('database_error'),{code});},uid(2),uid(1),p.input),e=>e.code===(code==='55P03'?'liveness_issued_capture_authority_busy':code));
});
await check('descriptor does not leak receipt IDs, vectors or turn serving readiness on',async()=>{
 const p=await prepared();const text=JSON.stringify(p.descriptor);assert(!text.includes('consent_id'));assert(!text.includes('vector'));
 assert.equal(p.descriptor.available,true);assert.equal(modernCaptureReadiness().ready,false);
 assert.equal(await getOwnedModernComparisonDescriptor(async()=>[],uid(2),uid(1)),null);
});
await check('ambiguous descriptor result refuses and historical schema declares one primary per replica',async()=>{
 const row=descriptorRow(fixture());
 await assert.rejects(()=>getOwnedModernComparisonDescriptor(async()=>[row,row],uid(2),uid(1)),/comparison_descriptor_ambiguous/);
 const schema=readFileSync(new URL('../../db/migrations/reconciliation/local-voice-20260906/3f646e2920969077-066_replica_primary_voice_source.sql',import.meta.url),'utf8');
 assert(/replica_id\s+uuid primary key/.test(schema));
});
await check('all eight actual authority/review callers export parameterized SQL without execution',async()=>{
 const proof=await prepareModernAuthoritySqlCases();assert.equal(proof.execution,'not-run');assert.equal(proof.cases.length,8);
 assert(proof.cases.every(c=>c.sha256===sha256Hex(c.sql)&&Array.isArray(c.params)));
 assert.equal(proof.receipt.binding.reference_authority_epoch,proof.fixture.binding.reference_authority_epoch+1);
 assert(!proof.migration.sql.includes('private_text_epoch'));
 for(const c of proof.cases.filter(c=>c.name.startsWith('review_')||c.name==='issue')){
  const vulnerable=withoutReferenceEpochAdvance(c.sql);
  assert(!vulnerable.includes('set reference_authority_epoch=r.reference_authority_epoch+1'));
  assert.notEqual(sha256Hex(vulnerable),c.sha256);
 }
 for(const c of proof.cases.filter(c=>['authority_snapshot','authority_load','issue','review_evidence'].includes(c.name))){
  const barrier=addSnapshotBarrier(c.sql);assert.equal(barrier.original_sha256,c.sha256);
  assert(barrier.sql.includes(`pg_advisory_xact_lock($${barrier.parameter}::bigint)`));
  assert(barrier.sql.includes('and (select count(*) from snapshot_barrier)=1 order by s.source_id'));
 }
});
await check('existing SQL erasure ownership cascade and source evidence cleanup remain present',()=>{
 const schema=readFileSync(new URL('../../db/schema.sql',import.meta.url),'utf8');
 assert(schema.includes('vy_replica_biometric_verification_grant'));assert(schema.includes('receipt_payload'));
 assert(schema.includes('references vy_replica_liveness_challenge(challenge_id,replica_id,owner_user_id) on delete cascade'));
 const revoke=readFileSync(new URL('../../api/_replica-consent.js',import.meta.url),'utf8');
 assert(revoke.includes("update vy_replica_biometric_verification_grant g set state='revoked'"));
 const erase=readFileSync(new URL('../../api/_replica-source-erasure.js',import.meta.url),'utf8');
 assert(erase.includes('delete from vy_replica_processing_evidence e using target t'));
});
console.log(`${n} offline modern issued authority controls passed; no SQL execution, provider call or identity acceptance`);
