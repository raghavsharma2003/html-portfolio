import assert from 'node:assert/strict';
import {runLivenessIntakeSqlChecks} from './liveness-intake-live.mjs';
let calls=0;
await assert.rejects(()=>runLivenessIntakeSqlChecks({db:async()=>{calls++;return [];},onFixtureManifest:async()=>{throw Object.assign(Error('manifest'),{code:'MANIFEST_FAILED'});}}),e=>e.failedStage==='fixture-manifest'&&e.primaryFailure.code==='MANIFEST_FAILED'&&!e.intakeFixtureCleanupVerified);
assert.equal(calls,0);
await assert.rejects(()=>runLivenessIntakeSqlChecks({db:async()=>{calls++;return [{name:'wrong-database'}];},onFixtureManifest:async()=>{}}),e=>e.failedStage==='database-identity'&&!e.intakeFixtureCleanupVerified);
assert.equal(calls,1);
for(const breakCleanup of [false,true]){
  const deletes=[],counts=[];let manifest;
  await assert.rejects(()=>runLivenessIntakeSqlChecks({onFixtureManifest:async value=>{manifest=value;},db:async(sql)=>{
    assert(manifest,'manifest precedes every DB operation');
    if(sql==='select current_database() as name')return [{name:'vyakti_expert_integration_20260906'}];
    if(sql.startsWith('insert '))throw Object.assign(Error('synthetic insert failure'),{code:'EXPECTED_INSERT_FAILURE'});
    if(sql.startsWith('delete ')){deletes.push(sql);if(breakCleanup&&deletes.length===1)throw Object.assign(Error('synthetic cleanup failure'),{code:'EXPECTED_CLEANUP_FAILURE'});return [];}
    if(sql.startsWith('select count')){counts.push(sql);return [{n:0}];}
    throw Error('unexpected harness operation');
  }}),e=>e.primaryFailure.code==='EXPECTED_INSERT_FAILURE'&&e.failedStage==='setup'&&
    Boolean(e.cleanupFailure)===breakCleanup&&e.intakeFixtureCleanupVerified===!breakCleanup);
  assert.equal(deletes.length,14);assert.equal(counts.length,14);
  assert.equal(manifest.replicaIds.length,7);assert.equal(manifest.sourceIds.length,14);
  assert.equal(manifest.processingJobIds.length,21);
}
console.log(JSON.stringify({suite:'liveness-intake-harness',groups:4,sqlProof:false}));
