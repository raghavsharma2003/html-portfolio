import assert from 'node:assert/strict';
import {createReplicaSourceHandler} from '../../api/replica-source.js';
import {stableUuid,sha256Hex} from '../../api/_replica-processing/contracts.js';
import {COMPARISON_PREPARATION_READ_SQL,COMPARISON_PREPARATION_SNAPSHOT_SQL,COMPARISON_PREPARATION_AUTHORIZE_SQL,withdrawOwnedComparisonPreparation,COMPARISON_PREPARATION_WITHDRAW_SQL} from '../../api/_comparison-preparation.js';
import {REPLICA_POLICY_VERSION} from '../../api/_replica.js';
import {setOwnedPrimaryVoiceSource,listOwnedSources} from '../../api/_replica-source.js';
const id=s=>stableUuid('comparison-upload:'+s),owner=id('owner'),rid=id('replica'),pid=id('preparation');
let source,grant,created=0,queued=0,uploads=0,authCalls=0,checks=0;
const db=async(sql,p)=>{
 if(sql.includes('pending_budget')){assert.equal(p[1],owner);if(source)return[{...source,intent_replayed:true}];created++;
  source={source_id:p[2],replica_id:rid,owner_user_id:owner,consent_id:id('capture'),kind:p[3],capture_mode:p[11],storage_bucket:p[4],object_path:p[5],mime:p[6],byte_size:p[7],sha256:p[8],contains_third_parties:p[9],provenance:JSON.parse(p[10]),purpose:p[14],upload_intent_id:p[15],language_hint:p[16],state:'pending_upload',created_at:new Date().toISOString()};return[source];}
 if(sql===COMPARISON_PREPARATION_READ_SQL)return grant?[grant]:[];
 if(sql===COMPARISON_PREPARATION_SNAPSHOT_SQL)return[{binding:{replica_id:rid,owner_user_id:owner,source_id:source.source_id,source_sha256:source.sha256,byte_size:source.byte_size,mime:source.mime,capture_consent_id:id('capture'),storage_consent_id:id('storage'),policy_version:REPLICA_POLICY_VERSION,authority_epoch:0,max_duration_ms:60000,max_evidence_dispatches:4}}];
 if(sql===COMPARISON_PREPARATION_AUTHORIZE_SQL){grant={preparation_id:pid,replica_id:rid,owner_user_id:owner,source_id:source.source_id,receipt:JSON.parse(p[6]),receipt_sha256:p[7],state:'authorized',expires_at:new Date(Date.now()+86400000).toISOString()};return[grant];}
 if(sql.includes('select p.* from source'))return grant?.state==='authorized'?[grant]:[];
 if(sql.startsWith('update vy_replica_source s')){assert.equal(p[1],owner);source.upload_authorization_expires_at=new Date(Date.now()+7200000).toISOString();return[source];}
 if(sql.startsWith('select')&&sql.includes('vy_replica_source')){assert.equal(p[1],owner);return source?[source]:[];}
 if(sql.startsWith('with updated as')){assert(sql.includes('comparison_preparation_id'));assert(sql.includes('private_text_epoch'));assert.equal(p[1],owner);
  if(grant?.state!=='authorized')return[];source.state='quarantined';queued++;return[source];}
 throw Error('unexpected_upload_sql:'+sql.slice(0,70));
};
const handler=createReplicaSourceHandler({db,auth:async()=>{authCalls++;return{id:owner};},rate:()=>true,
 storage:{ensurePrivateReplicaBucket:async()=>{assert(grant,'grant_before_storage');},createSignedReplicaUpload:async()=>{uploads++;assert.equal(grant.state,'authorized');return{method:'PUT',url:'https://synthetic.invalid/no-request',headers:{},expires_at:new Date(Date.now()+3600000).toISOString()};},replicaObjectInfo:async()=>({byteSize:source.byte_size,mime:source.mime,objectId:'synthetic'})}});
const call=async body=>{const result={};const res={setHeader(){},status(n){result.status=n;return this;},json(v){result.body=v;return this;},end(){return this;}};
 await handler({method:'POST',headers:{},body},res);return result;};
const body={op:'create_upload',replica_id:rid,purpose:'comparison_reference',preparation_id:pid,upload_intent_id:pid,kind:'audio',mime:'audio/wav',byte_size:24,sha256:sha256Hex('synthetic'),contains_third_parties:false,language_hint:'hi',owner_user_id:id('spoofed-owner'),
 attestations:{recording_is_only_me:true,process_for_private_comparison:true,no_training_or_public_voice_permission:true}};
let result=await call({...body,attestations:{}});assert.equal(result.status,400);assert.equal(created,0);checks++;
result=await call(body);assert.equal(result.status,201);assert.equal(created,1);assert.equal(grant.owner_user_id,owner);assert.equal(uploads,1);assert.equal(queued,0);checks++;
result=await call(body);assert.equal(result.status,200);assert.equal(created,1);assert.equal(result.body.replayed,true);checks++;
result=await call({op:'finalize',replica_id:rid,source_id:source.source_id});assert.equal(result.status,200);assert.equal(queued,1);assert.equal(source.state,'quarantined');checks++;
assert.equal(authCalls,4);
// Real withdrawal function receives the late row on fresh read after a
// simulated first-statement invisible concurrent admission. It must re-revoke.
let writes=0,reads=0;
const withdrawn=await withdrawOwnedComparisonPreparation(async(sql)=>{
 if(sql===COMPARISON_PREPARATION_WITHDRAW_SQL){writes++;return[];}
 assert.equal(sql,COMPARISON_PREPARATION_READ_SQL);reads++;return[{...grant,state:writes===1?'authorized':'revoked'}];
},owner,rid,pid);assert.equal(writes,2);assert.equal(reads,2);assert.equal(withdrawn.state,'revoked');checks++;
console.log(`${checks} actual upload/finalize/withdraw caller controls passed with synthetic auth/storage/SQL; no external requests`);
// Record the actual statement, then exercise its explicit admission predicate
// with a synthetic row evaluator. Real pointer/epoch CAS still needs PostgreSQL.
let selectionSql,primary='original',epoch=7;
const selectionDb=async(sql)=>{selectionSql=sql;
 if(source.purpose==='comparison_reference'&&sql.includes("and s.purpose<>'comparison_reference'"))return[];
 primary=source.source_id;epoch++;return[source];};
assert.equal(await setOwnedPrimaryVoiceSource(selectionDb,owner,rid,source.source_id),null);
assert.equal(primary,'original');assert.equal(epoch,7);
await selectionDb(selectionSql.replace("and s.purpose<>'comparison_reference'",''));
assert.equal(primary,source.source_id);assert.equal(epoch,8,'retained removed-predicate negative must rotate the synthetic pointer');
source.purpose='memory';assert(await setOwnedPrimaryVoiceSource(selectionDb,owner,rid,source.source_id));
let listSql;await listOwnedSources(async sql=>{listSql=sql;return[];},owner,rid);
assert(listSql.includes("and s.purpose<>'comparison_reference'"));
console.log('1 ordinary primary-purpose boundary control passed, including removed-predicate negative; SQL execution unproven');
