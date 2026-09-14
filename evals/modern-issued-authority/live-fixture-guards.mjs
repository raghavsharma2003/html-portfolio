import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeLiveAuthorityFixture,liveAuthorityManifest,seedLiveAuthority,cleanupLiveAuthority,LIVE_TABLES,liveLeaseTimestamp,attachLiveCaptureLease} from './live-fixtures.mjs';
import {canonicalJson} from '../../api/_replica-processing/contracts.js';
import {prepareLiveFixtureSqlCases,OLD_ARTIFACT_ABSENCE_SQL} from './live-fixture-sql.mjs';
globalThis.fetch=async()=>{throw Error('no_network');};
const types=JSON.parse(readFileSync(new URL('./live-fixture-id-types.json',import.meta.url)));
const type=(table,column)=>types.rows.find(x=>x.table_name===table&&x.column_name===column)?.data_type;
let n=0;const check=async(name,fn)=>{await fn();console.log(`ok ${++n} - ${name}`);};
const capture=(calls,generated='9007199254740993')=>async(sql,params)=>{calls.push({sql,params});return sql.includes('returning decision_id::text')?[{decision_id:generated}]:[{n:0}];};
await check('retained actual catalog separates artifact bigint from evidence UUID',()=>{
 assert.equal(types.database,'vyakti_expert_integration_20260906');assert.equal(type('vy_person','person_id'),'uuid');
 assert.equal(type('vy_replica_processing_artifact_decision','decision_id'),'bigint');assert.equal(type('vy_replica_processing_evidence_decision','decision_id'),'uuid');
 for(const table of LIVE_TABLES){if(table==='vy_replica_processing_attempt'){assert.equal(type(table,'job_id'),'uuid');assert.equal(type(table,'replica_id'),undefined);continue;}assert.equal(type(table,'replica_id'),'uuid');if(table==='vy_replica_voice_genome'){assert.equal(type(table,'owner_user_id'),undefined);continue;}assert.equal(type(table,'owner_user_id'),'uuid');}
 const migration=readFileSync(new URL('../../db/migrations/044_replica_artifact_selection.sql',import.meta.url),'utf8');assert.match(migration,/decision_id\s+bigint generated always as identity/);
});
await check('all exact fixture query ID casts agree with retained actual catalog',async()=>{
 const p=await prepareLiveFixtureSqlCases();assert.equal(p.cases.length,45);
 for(const c of p.cases){
  const table=c.sql.match(/\b(?:into|from|update)\s+(vy_[a-z_]+)/i)?.[1];assert(table);
  for(const m of c.sql.matchAll(/\b(?:(\w+)\.)?([a-z_]+_id)\s*=\s*(?:any\()?\$\d+::uuid(?:\[\])?/g)){const from=m[1]==='j'?'vy_replica_processing_job':table;assert.equal(type(from,m[2]),'uuid',from+'.'+m[2]);}
  const insert=c.sql.match(/^insert into (vy_[a-z_]+)\s*\(([^)]+)\)\s*values\((.*)\)/i);
  if(insert){const columns=insert[2].split(','),values=insert[3].split(',');for(let i=0;i<columns.length;i++)if(/^\$\d+::uuid$/.test(values[i]?.trim()))assert.equal(type(insert[1],columns[i].trim()),'uuid');}
 }
 assert.match(OLD_ARTIFACT_ABSENCE_SQL,/decision_id=any\(\$1::uuid\[\]\)/);assert.deepEqual(p.negatives.map(x=>x.expected_code),['42883','42703']);
 assert(!p.cases.some(c=>c.sql===OLD_ARTIFACT_ABSENCE_SQL));
});
await check('generated identity omitted from INSERT and checkpointed before next write',async()=>{
 const f=makeLiveAuthorityFixture(),calls=[];assert.equal(f.binding.artifact_decision_id,null);assert.deepEqual(liveAuthorityManifest(f).generated_artifact_decision_ids,[]);
 await seedLiveAuthority(capture(calls),f,async()=>{const last=calls.at(-1);assert.match(last.sql,/artifact_decision\(artifact_id,replica_id,owner_user_id/);assert(!last.sql.includes('override'));assert.equal(f.binding.artifact_decision_id,'9007199254740993');assert.deepEqual(liveAuthorityManifest(f).generated_artifact_decision_ids,['9007199254740993']);calls.push({sql:'DURABLE_CHECKPOINT'});});
 const mark=calls.findIndex(x=>x.sql==='DURABLE_CHECKPOINT');assert(mark>0);assert.match(calls[mark+1].sql,/insert into vy_replica_processing_evidence_decision/);
 assert(liveAuthorityManifest(f).decision_ids.every(x=>/^[a-f0-9-]{36}$/.test(x)));
});
await check('missing durable callback refuses before any insert',async()=>{let calls=0;await assert.rejects(()=>seedLiveAuthority(async()=>{calls++;},makeLiveAuthorityFixture()),/durable_callback_required/);assert.equal(calls,0);});
await check('post-insert manifest failure halts seed and exact predeclared cleanup survives',async()=>{
 const f=makeLiveAuthorityFixture(),calls=[];await assert.rejects(()=>seedLiveAuthority(capture(calls),f,async()=>{throw Error('durable_write_failed');}),/durable_write_failed/);
 assert.match(calls.at(-1).sql,/returning decision_id::text/);const cleanup=[];const counts=await cleanupLiveAuthority(capture(cleanup),f);assert.equal(Object.keys(counts).length,18);assert.equal(counts.vy_replica_model_build,0);assert.equal(counts.vy_replica_voice_genome,0);
 assert.deepEqual(cleanup[0].params,[f.binding.replica_id,f.binding.owner_user_id]);assert.deepEqual(cleanup[1].params,[f.binding.subject_person_id]);
});
await check('non-string unsafe overflow and missing generated IDs refuse',async()=>{
 for(const value of [null,undefined,1,'0','-1','9007199254740993x','9223372036854775808']){let persisted=false;await assert.rejects(()=>seedLiveAuthority(async sql=>sql.includes('returning decision_id::text')?[{decision_id:value}]:[{}],makeLiveAuthorityFixture(),async()=>{persisted=true;}),/generated_artifact_decision_invalid/);assert.equal(persisted,false);}
});
await check('45 query hashes deterministic despite independent fixture UUIDs',async()=>{const a=await prepareLiveFixtureSqlCases(),b=await prepareLiveFixtureSqlCases();assert.deepEqual(a.cases.map(x=>x.sha256),b.cases.map(x=>x.sha256));assert.notDeepEqual(a.cases[0].params,b.cases[0].params);});
await check('retained Date canonicalization negative and exact string microseconds',()=>{
 const raw='2026-09-08 12:34:56.123456+00';
 assert.deepEqual(JSON.parse(canonicalJson({leaseExpiresAt:new Date(raw)})),{leaseExpiresAt:{}});
 assert.equal(new Date(raw).toISOString(),'2026-09-08T12:34:56.123Z');
 for(const s of [raw,'2026-09-08T12:34:56.123456Z','2026-09-08 18:04:56.123456+05:30']){assert.equal(liveLeaseTimestamp(s),s);assert.equal(JSON.parse(canonicalJson({leaseExpiresAt:liveLeaseTimestamp(s)})).leaseExpiresAt,s);}
 for(const value of [new Date(raw),new Date(NaN),null,{},'',123,'not a timestamp'])assert.throws(()=>liveLeaseTimestamp(value),/timestamp_string_required/);
});
await check('actual capture attachment retains SQL text and refuses Date before subsequent writes',async()=>{
 const f=makeLiveAuthorityFixture(),receipt={envelope:{phrase:'Synthetic fixture',contract:{challengeId:f.captureId,phraseSha256:'a'.repeat(64)}}},raw='2026-09-08 12:34:56.123456+00';let writes=0;
 const lease=await attachLiveCaptureLease(async sql=>{writes++;if(sql.includes('returning verification_lease_expires_at')){assert(sql.endsWith('verification_lease_expires_at::text as verification_lease_expires_at'));return[{verification_lease_expires_at:raw}];}return[{}];},f,receipt);
 assert.equal(lease.leaseExpiresAt,raw);assert(writes>1);writes=0;
 await assert.rejects(()=>attachLiveCaptureLease(async()=>{writes++;return[{verification_lease_expires_at:new Date(raw)}];},f,receipt),/timestamp_string_required/);assert.equal(writes,1);
});
console.log(`${n} schema/fixture controls passed; retained catalog source only, no SQL execution`);
