// Fault injection into harness plumbing; no PostgreSQL calls.
import assert from 'node:assert/strict';
import {runVoiceChallengeFinalizeSqlChecks as run} from './voice-challenge-finalize-live.mjs';
let checks=0;const check=async(name,fn)=>{await fn();console.log('PASS '+name);checks++;};
await check('missing durable manifest refuses before any query',async()=>{
  let queried=false;
  await assert.rejects(()=>run({db:async()=>{queried=true;}}),e=>e.failedStage==='fixture-manifest'&&!e.fixtureWritesStarted);
  assert.equal(queried,false);
});
await check('manifest persists only generated UUIDs before database verification',async()=>{
  let persisted=false;
  await assert.rejects(()=>run({onFixtureManifest:value=>{
    for(const ids of Object.values(value))for(const id of ids)assert(/^[0-9a-f-]{36}$/.test(id));persisted=true;
  },db:async()=>{assert(persisted);return[{name:'wrong-database'}];}}),e=>e.failedStage==='verify-database'&&!e.fixtureWritesStarted&&!e.targetVerified);
});
await check('primary query error is retained when cleanup also fails, and cleanup still attempts every table',async()=>{
  const original=Object.assign(new Error('synthetic execute fault'),{code:'42P08'}),deletes=[];
  await assert.rejects(()=>run({onFixtureManifest:()=>{},db:async sql=>{
    if(sql==='select current_database() as name')return[{name:'vyakti_expert_integration_20260906'}];
    if(sql.startsWith('EXPLAIN '))throw original;
    if(sql.startsWith('delete from ')){deletes.push(sql);throw Object.assign(new Error('synthetic cleanup error'),{code:'08006'});}
    return[{n:0}];
  }}),e=>e===original&&e.primaryFailure.code==='42P08'&&e.cleanupFailure.code==='FIXTURE_CLEANUP_INCOMPLETE'&&e.voiceFinalizeFixtureCleanupVerified===false);
  assert.equal(deletes.length,6);
});
await check('successful early cleanup verifies all six exact owner-scoped tables without masking failure',async()=>{
  const original=Object.assign(new Error('synthetic execute fault'),{code:'42P08'}),counted=[];let manifest;
  await assert.rejects(()=>run({onFixtureManifest:value=>{manifest=value;},db:async(sql,params)=>{
    if(sql==='select current_database() as name')return[{name:'vyakti_expert_integration_20260906'}];
    if(sql.startsWith('EXPLAIN '))throw original;
    assert.deepEqual(params,[manifest.replicaIds,manifest.ownerUserIds[0]]);
    if(sql.startsWith('select count'))counted.push(sql);
    return[{n:0}];
  }}),e=>e===original&&e.voiceFinalizeFixtureCleanupVerified===true&&e.remainingFixtureRows===0&&e.cleanupFailure===null&&!e.fixtureWritesStarted);
  assert.equal(counted.length,6);
});
console.log(`${checks} finalizer harness safety groups passed; no SQL proof.`);
