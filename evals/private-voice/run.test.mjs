import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPrivateVoiceStore,requirePrivateVoiceRun,privateVoiceSampleConfig,privateVoiceHash,PRIVATE_VOICE_ADMIT_SQL,PRIVATE_VOICE_CANDIDATES_SQL,PRIVATE_VOICE_READ_SQL} from '../../api/_private-voice-store.js';
import {createPrivateVoiceHandler} from '../../api/_private-voice-handler.js';
import {privateVoiceErasureFence} from '../../api/_private-voice-erasure.js';
import {fixture,OWNER,OTHER,RID,SID,AID,RUN,NOW} from './fixtures.mjs';
const storeFor=f=>createPrivateVoiceStore({db:f.db,now:()=>NOW});
const call=async(handler,method,body,query='')=>{
 let result;const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(body){result={status:this.statusCode,body,headers:this.headers};return result;}};
 await handler({method,url:'/api/internal-voice'+query,body},res);return result;
};
const env={VYAKTI_INTERNAL_VOICE_MODE:'account-private',VYAKTI_MODEL_SERVING:'azure_only'};

test('real handler uses verified user ID and hides candidate storage locators',async()=>{
 const f=fixture(),h=createPrivateVoiceHandler({db:f.db,requireUser:async()=>({id:OWNER}),env,now:()=>NOW});
 const result=await call(h,'GET',undefined,`?replica_id=${RID}&owner_user_id=${OTHER}`);
 assert.equal(result.status,200);assert.equal(result.body.candidates.length,1);
 assert(!JSON.stringify(result.body).includes('object_path'));assert(!JSON.stringify(result.body).includes('replica-private'));
 assert.equal(f.state.calls[0].params[1],OWNER);
 const bad=createPrivateVoiceHandler({db:f.db,requireUser:async()=>({id:OTHER}),env,now:()=>NOW});
 assert.deepEqual((await call(bad,'GET',undefined,`?replica_id=${RID}`)).body.candidates,[]);
});
test('missing session and legacy global self-test fail before database calls',async()=>{
 for(const [user,settings] of [[null,env],[{id:OWNER},{...env,REPLICA_SELF_TEST_MODE:'true'}],[{id:OWNER},{...env,REPLICA_SELF_TEST_ACCESS:'owner'}]]){
   const f=fixture(),h=createPrivateVoiceHandler({db:f.db,requireUser:async()=>user,env:settings});
   const result=await call(h,'GET',undefined,`?replica_id=${RID}`);assert([401,404].includes(result.status));assert.equal(f.state.calls.length,0);
 }
});
test('handler admits one fixed private sample, without invoking provider or creating verification',async()=>{
 const f=fixture(),h=createPrivateVoiceHandler({db:f.db,requireUser:async()=>({id:OWNER}),env,now:()=>NOW});
 const result=await call(h,'POST',f.input);assert.equal(result.status,202);assert.equal(result.body.run.state,'queued');
 const row=f.state.rows.get(RUN);assert.equal(row.config.model_arm,'hindi_v3');assert.equal(row.config.conditioning.effectiveCfgWeight,0);
 assert.equal(row.config.conditioning.referenceLanguageEvidenceScope,'unverified');assert.equal(row.config.style.cfgWeight,0.78);
 assert.equal(row.config.text,privateVoiceSampleConfig().text);assert.equal(row.receipt.attestations.own_voice_private_use,true);
 assert.equal(row.config.identity_claim_allowed,false);assert.equal(row.config.training_allowed,false);
 assert(f.state.calls.every(c=>!/insert into vy_replica_(?:consent|generation|voice_genome)|update vy_replica set/.test(c.sql)));
 assert(!JSON.stringify(result).includes('output_object_path'));
});
test('owner/text/model/locator overrides and absent explicit self-use are rejected',async()=>{
 for(const override of [{owner_user_id:OTHER},{text:'other'},{style:{}},{object_path:'other'},{model_arm:'general'},{attestations:{own_voice_private_use:false}}]){
   const f=fixture();await assert.rejects(storeFor(f).admit(OWNER,{...f.input,...override}),/private_voice_/);assert.equal(f.state.rows.size,0);
 }
});
test('same UUID is idempotent and changed payload cannot reuse it',async()=>{
 const f=fixture(),store=storeFor(f);assert.equal((await store.admit(OWNER,f.input)).created,true);
 assert.equal((await store.admit(OWNER,f.input)).created,false);assert.equal(f.state.calls.filter(c=>c.sql===PRIVATE_VOICE_ADMIT_SQL).length,1);
 await assert.rejects(store.admit(OWNER,{...f.input,expected_snapshot_hash:'1'.repeat(64)}),/private_voice_request_conflict/);
});
test('concurrent same-ID requests converge on one row',async()=>{
 const f=fixture(),store=storeFor(f);await Promise.all([store.admit(OWNER,f.input),store.admit(OWNER,f.input)]);
 assert.equal(f.state.rows.size,1);
});
test('snapshot/source change and disappeared authority prevent admission',async()=>{
 for(const change of [f=>{f.state.snapshot.artifact_sha256='0'.repeat(64);},f=>{f.state.live=false;}]){
   const f=fixture();change(f);await assert.rejects(storeFor(f).admit(OWNER,f.input),/private_voice_/);assert.equal(f.state.rows.size,0);
 }
 const f=fixture();f.state.beforeQuery=sql=>{if(sql===PRIVATE_VOICE_ADMIT_SQL)f.state.live=false;};
 await assert.rejects(storeFor(f).admit(OWNER,f.input),/private_voice_admission_changed/);assert.equal(f.state.rows.size,0);
});
test('CPU authority rechecks current source/receipts and forbids cross-owner reference reads',async()=>{
 const f=fixture();await storeFor(f).admit(OWNER,f.input);
 const authorized=await requirePrivateVoiceRun(f.db,OWNER,f.input,{now:()=>NOW});assert.equal(authorized.reference.sha256,'b'.repeat(64));
 await assert.rejects(requirePrivateVoiceRun(f.db,OTHER,f.input,{now:()=>NOW}),/private_voice_request_unavailable/);
 f.state.live=false;await assert.rejects(requirePrivateVoiceRun(f.db,OWNER,f.input,{now:()=>NOW}),/private_voice_authority_changed/);
});
test('withdrawal between authority reads wins and expiration blocks playback authority',async()=>{
 const f=fixture();await storeFor(f).admit(OWNER,f.input);
 let reads=0;f.state.beforeQuery=sql=>{if(sql===PRIVATE_VOICE_READ_SQL&&++reads===2)f.state.rows.get(RUN).revoked_at=new Date(NOW).toISOString();};
 await assert.rejects(requirePrivateVoiceRun(f.db,OWNER,f.input,{now:()=>NOW}),/private_voice_request_unavailable/);
 f.state.beforeQuery=null;f.state.rows.get(RUN).revoked_at=null;
 await assert.rejects(requirePrivateVoiceRun(f.db,OWNER,f.input,{now:()=>NOW+86400001}),/private_voice_request_unavailable/);
});
test('receipt/config tampering cannot become CPU authority',async()=>{
 const f=fixture();await storeFor(f).admit(OWNER,f.input);f.state.rows.get(RUN).config.style.cfgWeight=1;
 await assert.rejects(requirePrivateVoiceRun(f.db,OWNER,f.input,{now:()=>NOW}),/private_voice_receipt_invalid/);
});
test('revoke preserves deletion locator and closes admission, repeat dispatch refuses',async()=>{
 const f=fixture(),store=storeFor(f);await store.admit(OWNER,f.input);const before=f.state.rows.get(RUN).output_object_path;
 assert.equal((await store.revoke(OWNER,f.input)).state,'revoked');assert.equal(f.state.rows.get(RUN).output_object_path,before);
 await assert.rejects(store.admit(OWNER,f.input),/private_voice_request_unavailable/);
});
test('SQL capture has typed selectors, exact lineage and current permission predicates, without public review fences',async()=>{
 const f=fixture();await storeFor(f).admit(OWNER,f.input);
 const admitted=f.state.calls.find(c=>c.sql===PRIVATE_VOICE_ADMIT_SQL);assert.equal(admitted.params.length,13);
 assert.deepEqual(admitted.params.slice(0,5),[RID,OWNER,SID,AID,RUN]);assert.equal(privateVoiceHash(JSON.parse(admitted.params[7])),admitted.params[6]);
 for(const marker of ["s.state='ready'","s.contains_third_parties=false","cc.scope='capture'","c.scope='storage'","a.stage='enhance'","pa.result_manifest_hash","for update of s nowait","for update of r nowait"])
   assert(PRIVATE_VOICE_CANDIDATES_SQL.includes(marker),marker);
 assert(!/identity_verified_at|liveness_verified_at|artifact_decision|voice_genome/.test(PRIVATE_VOICE_CANDIDATES_SQL));
});
test('erasure fences active writes/windows and includes planned output even before upload receipt',()=>{
 const root=new URL('../../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
 const fence=privateVoiceErasureFence();assert(fence.includes('pv.output_write_not_after>now()'));assert(fence.includes('pv.lease_expires_at>now()'));assert(fence.includes('resource_released_at is null'));
 const source=read('api/_replica-source-erasure.js');assert.equal((source.match(/privateVoiceErasureFence\('s'\)/g)||[]).length,3);
 assert(source.includes('select pv.output_storage_bucket bucket,pv.output_object_path path'));
 assert(read('api/_replica-source.js').includes('private_voice_closing as'));
 assert(read('api/_replica-full-erasure.js').includes('delete from vy_private_voice_run'));
 const migration=read('db/migrations/171_private_voice_request.sql');assert(migration.includes('on delete cascade'));assert(migration.includes('output_object_path=owner_user_id::text'));
 assert(read('db/schema.sql').includes(migration.trim()));
});
