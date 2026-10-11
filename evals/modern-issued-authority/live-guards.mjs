// Offline guards only: injected SQL callbacks, no database/network connections.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha256Hex} from '../../api/_replica-processing/contracts.js';
import {referenceFromAuthority} from '../../api/_liveness/issued-authority.js';
import {runModernIssuedAuthoritySqlChecks,REQUIRED_LIVE_PINS,assertVisibleRaceQuery,closeLiveRaceSessions} from './live.mjs';
import {makeLiveAuthorityFixture,liveAuthorityManifest} from './live-fixtures.mjs';
globalThis.fetch=async()=>{throw Error('no_network');};
const pins=Object.fromEntries(REQUIRED_LIVE_PINS.map(p=>[p,sha256Hex(readFileSync(new URL('../../'+p,import.meta.url)))]));
let n=0;const check=async(name,fn)=>{await fn();console.log(`ok ${++n} - ${name}`);};
const base={allowSyntheticSql:true,expectedSourceSha256:pins,onFixtureManifest:async()=>{},db:async()=>{throw Error('unexpected_db');},openSession:async()=>{throw Error('unexpected_session');}};
const parserSession=()=>({query:async sql=>{
 if(sql==='select current_database() as name')return[{name:'vyakti_expert_integration_20260906'}];
 if(sql.startsWith('EXPLAIN select missing_'))throw Object.assign(Error('synthetic parser negative'),{code:'42703'});
 if(sql==='EXPLAIN select count(*)::int n from vy_replica_processing_attempt where replica_id=$1::uuid and owner_user_id=$2::uuid')throw Object.assign(Error('retained synthetic column negative'),{code:'42703'});
 if(sql==='EXPLAIN select count(*)::int n from vy_replica_processing_artifact_decision where decision_id=any($1::uuid[])')throw Object.assign(Error('retained synthetic type negative'),{code:'42883'});
 return[];
},close:async()=>{}});
await check('no default live execution or implicit opt-in',async()=>{
 await assert.rejects(()=>runModernIssuedAuthoritySqlChecks(),/explicit_synthetic_sql_opt_in_required/);
});
await check('missing reviewed source pin refuses before any DB',async()=>{
 await assert.rejects(()=>runModernIssuedAuthoritySqlChecks({...base,expectedSourceSha256:{}}),/reviewed_source_pin_required/);
});
await check('changed source pin refuses before any DB',async()=>{
 await assert.rejects(()=>runModernIssuedAuthoritySqlChecks({...base,expectedSourceSha256:{...pins,[REQUIRED_LIVE_PINS[0]]:'0'.repeat(64)}}),/reviewed_source_changed/);
});
await check('manifest is mandatory before any fixture or SQL operation',async()=>{
 await assert.rejects(()=>runModernIssuedAuthoritySqlChecks({...base,onFixtureManifest:null}),/durable_fixture_manifest_required/);
});
await check('wrong target performs only database identity read and no cleanup',async()=>{
 let declared=false,calls=0;
 await assert.rejects(()=>runModernIssuedAuthoritySqlChecks({...base,onFixtureManifest:async m=>{declared=true;assert.equal(m.fixtures.length,3);},db:async sql=>{
  assert(declared);calls++;assert.equal(sql,'select current_database() as name');return[{name:'wrong_database'}];
 }}),e=>e.report?.errors[0]?.stage==='database'&&e.report.cleanup.length===0);
 assert.equal(calls,1);
});
await check('missing unapplied144 fails without writes or cleanup',async()=>{
 await assert.rejects(()=>runModernIssuedAuthoritySqlChecks({...base,openSession:async()=>parserSession(),db:async sql=>{
  if(sql==='select current_database() as name')return[{name:'vyakti_expert_integration_20260906'}];
  assert(sql.startsWith('select data_type'));return[];
 }}),e=>e.report?.errors[0]?.assertion==='reviewed_migration144_required'&&e.report.cleanup.length===0);
});
await check('preexisting synthetic ID fails before seed and cannot trigger deletion',async()=>{
 await assert.rejects(()=>runModernIssuedAuthoritySqlChecks({...base,openSession:async()=>parserSession(),db:async sql=>{
  if(sql==='select current_database() as name')return[{name:'vyakti_expert_integration_20260906'}];
  if(sql.startsWith('select data_type'))return[{data_type:'bigint'}];
  assert(sql.startsWith('select count'));return[{n:1}];
 }}),e=>e.report?.errors[0]?.stage==='absence'&&e.report.cleanup.length===0);
});
for(const breakCleanup of [false,true])await check(`failed seed cleans only started declared scope; cleanup failure retained=${breakCleanup}`,async()=>{
 let declared,deleted=[],counts=0;
 const session=parserSession();
 await assert.rejects(()=>runModernIssuedAuthoritySqlChecks({...base,openSession:async()=>session,onFixtureManifest:async m=>{declared=m;},db:async(sql,p)=>{
  assert(declared);
  if(sql==='select current_database() as name')return[{name:'vyakti_expert_integration_20260906'}];
  if(sql.startsWith('select data_type'))return[{data_type:'bigint'}];
  if(sql.startsWith('select count')){counts++;return[{n:0}];}
  if(sql.startsWith('insert'))throw Object.assign(Error('seed interrupted'),{code:'SYNTHETIC_SEED_INTERRUPTED'});
  if(sql.startsWith('delete')){deleted.push({sql,p});assert(p.includes(declared.fixtures[0].replica_id)||p.includes(declared.fixtures[0].person_id));
   if(breakCleanup)throw Object.assign(Error('cleanup interrupted'),{code:'SYNTHETIC_CLEANUP_INTERRUPTED'});return[];}
  throw Error('unexpected_guard_sql');
 }}),e=>e.report?.errors[0]?.stage==='seed'&&e.report.errors.some(x=>x.stage==='cleanup')===breakCleanup);
 assert.equal(deleted.length,breakCleanup?1:2);assert(counts>=30);
});
await check('fresh declared synthetic fixtures build real immutable reference contracts',()=>{
 const a=makeLiveAuthorityFixture(),b=makeLiveAuthorityFixture();assert.notEqual(a.binding.replica_id,b.binding.replica_id);
 assert.equal(referenceFromAuthority(a).embeddings.length,2);assert.equal(referenceFromAuthority(b).embeddings.length,2);
 const m=liveAuthorityManifest(a);assert(m.evidence_ids.includes(a.nonReferenceRecord.evidence_id));assert.equal(m.source_ids.length,3);
});
await check('fixture EXPLAIN refusal precedes absence seed and cleanup',async()=>{
 let writes=0;
 const session=parserSession(),query=session.query;
 session.query=async(sql,p)=>{if(sql.startsWith('EXPLAIN select count(*)::int n from vy_replica where'))throw Object.assign(Error('fixture parser refusal'),{code:'42883'});return query(sql,p);};
 await assert.rejects(()=>runModernIssuedAuthoritySqlChecks({...base,openSession:async()=>session,db:async sql=>{
  if(sql==='select current_database() as name')return[{name:'vyakti_expert_integration_20260906'}];
  if(sql.startsWith('select data_type'))return[{data_type:'bigint'}];writes++;throw Error('must_not_reach_absence_or_write');
 }}),e=>e.report.errors[0].stage==='fixture-explain:absence:1'&&e.report.errors[0].code==='42883'&&e.report.cleanup.length===0);
 assert.equal(writes,0);
});
await check('generated identity checkpoint failure invokes exact started-scope cleanup',async()=>{
 let declared,checkpoints=0;const deletes=[];
 await assert.rejects(()=>runModernIssuedAuthoritySqlChecks({...base,openSession:async()=>parserSession(),onFixtureManifest:async m=>{
  declared=structuredClone(m);if(++checkpoints===2)throw Error('durable_generated_id_interrupted');
 },db:async(sql,p)=>{
  if(sql==='select current_database() as name')return[{name:'vyakti_expert_integration_20260906'}];
  if(sql.startsWith('select data_type'))return[{data_type:'bigint'}];
  if(sql.startsWith('select count'))return[{n:0}];
  if(sql.includes('returning decision_id::text'))return[{decision_id:'9007199254740993'}];
  if(sql.startsWith('delete'))deletes.push(p);
  return[{}];
 }}),e=>e.report.errors[0].stage==='seed'&&e.report.cleanup.length===1&&Object.values(e.report.cleanup[0].counts).every(x=>x===0));
 assert.equal(checkpoints,2);assert.deepEqual(declared.fixtures[0].generated_artifact_decision_ids,['9007199254740993']);
 assert.deepEqual(deletes,[[declared.fixtures[0].replica_id,declared.fixtures[0].owner_user_id],[declared.fixtures[0].person_id]]);
});
await check('truncated activity text preserves exact marker and submitted prefix',()=>{
 const marker='/* modern-authority-race:0123456789abcdef0123456789abcdef */',sql=marker+'\nselect '+ 'x'.repeat(2000);
 assert.equal(assertVisibleRaceQuery(sql.slice(0,1023),sql,marker,1024).activity_query_truncated,true);
 assert.equal(assertVisibleRaceQuery(sql,sql,marker,4096).activity_query_truncated,false);
 assert.throws(()=>assertVisibleRaceQuery(sql.replace('select','delete'),sql,marker,4096),/prefix_mismatch/);
 assert.throws(()=>assertVisibleRaceQuery('/* other */'+sql,sql,marker,4096),/marker_mismatch/);
 assert.throws(()=>assertVisibleRaceQuery(marker,sql,marker,8),/capacity_required/);
});
await check('holder rollback and close failures still await pending and close reader',async()=>{
 const events=[];const holder={query:async()=>{events.push('holder-rollback');throw Object.assign(Error('rollback failed'),{code:'HOLDER_ROLLBACK'});},close:async()=>{events.push('holder-close');throw Object.assign(Error('close failed'),{code:'HOLDER_CLOSE'});}};
 const reader={query:async()=>{events.push('reader-rollback');},close:async()=>{events.push('reader-close');}};
 await assert.rejects(()=>closeLiveRaceSessions({holder,reader,pending:Promise.resolve().then(()=>{events.push('pending');})}),e=>e.code==='LIVE_RACE_CLEANUP_FAILED'&&e.cleanup_errors.map(x=>x.code).join(',')==='HOLDER_ROLLBACK,HOLDER_CLOSE');
 assert(events.includes('pending'));assert.deepEqual(events.filter(x=>x!=='pending'),['holder-rollback','holder-close','reader-rollback','reader-close']);
});
console.log(`${n} offline live-harness guards passed; no SQL, credentials, storage, provider or identity acceptance`);
