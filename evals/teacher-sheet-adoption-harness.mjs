// Offline fault injection for the live harness itself; no SQL/provider calls.
import assert from 'node:assert/strict';
import {runTeacherSheetAdoptionSqlChecks as run,withAdoptionSqlDiagnostics} from './teacher-sheet-adoption-live.mjs';
let count=0;const check=async(name,fn)=>{await fn();console.log('PASS '+name);count++;};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const verifyManifest=manifest=>{
  assert.deepEqual(Object.keys(manifest).sort(),['ownerUserIds','personIds','replicaIds','voiceProfileIds','sourceIds','sheetIds','agentIds'].sort());
  for(const ids of Object.values(manifest)){assert(Array.isArray(ids));for(const id of ids)assert(UUID.test(id));}
  assert.equal(manifest.replicaIds.length,4);assert.equal(manifest.sheetIds.length,7);
};
await check('SQL diagnostics preserve the original error and report types without parameter values',async()=>{
  const original=Object.assign(new Error('inconsistent types deduced for parameter $6'),{code:'42P08',detail:'text versus character varying'});
  const query=withAdoptionSqlDiagnostics(async()=>{throw original;},()=> 'execute:runtime_activation');
  await assert.rejects(()=>query('private SQL text',['private-string',4,['secret-suite'],null,true]),error=>{
    assert.equal(error,original);
    assert.deepEqual(error.adoptionSqlDiagnostic,{label:'execute:runtime_activation',parameterTypes:['string','number','array:string','null','boolean'],parameterIndex:6,conflictingTypes:['text','character varying']});
    assert(!JSON.stringify(error.adoptionSqlDiagnostic).includes('private'));
    assert(!JSON.stringify(error.adoptionSqlDiagnostic).includes('secret'));
    return true;
  });
});
await check('SQL diagnostics omit arbitrary server message and detail text',async()=>{
  const original=Object.assign(new Error('sensitive row payload'),{code:'42P08',detail:'text versus private_owner_name'});
  const query=withAdoptionSqlDiagnostics(async()=>{throw original;},()=> 'execute:runtime_status');
  await assert.rejects(()=>query('not emitted'),error=>{
    assert.deepEqual(error.adoptionSqlDiagnostic,{label:'execute:runtime_status',parameterTypes:[]});return true;
  });
});
await check('missing manifest persistence refuses before any database call',async()=>{
  let called=false;await assert.rejects(()=>run({db:async()=>{called=true;}}),error=>error.failedStage==='fixture-manifest'&&error.fixtureWritesStarted===false);
  assert.equal(called,false);
});
await check('wrong database target has a structured prewrite failure and no cleanup mutation',async()=>{
  let recorded=false;const queries=[];
  await assert.rejects(()=>run({onFixtureManifest:async manifest=>{verifyManifest(manifest);recorded=true;},db:async sql=>{
    assert(recorded);queries.push(sql);return[{name:'wrong-database'}];
  }}),error=>error.failedStage==='verify-database-target'&&error.primaryFailure.stage==='verify-database-target'&&error.targetVerified===false&&error.fixtureWritesStarted===false&&error.cleanupFailure===null);
  assert.deepEqual(queries,['select current_database() as name']);
});
await check('a failing manifest callback remains the original prewrite error',async()=>{
  const failure=Object.assign(new Error('synthetic manifest failure'),{code:'MANIFEST_UNAVAILABLE'});
  await assert.rejects(()=>run({onFixtureManifest:async()=>{throw failure;},db:async()=>{throw Error('must not call');}}),error=>error===failure&&error.failedStage==='fixture-manifest');
});
await check('cleanup failure cannot overwrite the original assertion or its stage',async()=>{
  const primary=Object.assign(new Error('synthetic EXPLAIN failure'),{code:'TEST_PRIMARY'});
  const cleanup=Object.assign(new Error('synthetic cleanup failure'),{code:'TEST_CLEANUP'});
  await assert.rejects(()=>run({onFixtureManifest:verifyManifest,db:async sql=>{
    if(sql==='select current_database() as name')return[{name:'vyakti_expert_integration_20260906'}];
    if(sql.startsWith('EXPLAIN '))throw primary;
    throw cleanup;
  }}),error=>error===primary&&error.failedStage==='capture-actual-statements'&&error.primaryFailure.code==='TEST_PRIMARY'&&error.cleanupFailure.code==='TEST_CLEANUP'&&error.cleanupFailure.stage==='discover-runtime-agents'&&error.adoptionFixtureCleanupVerified===false);
});
await check('successful cleanup of an early failure records exact zero and only ID manifests',async()=>{
  const primary=Object.assign(new Error('synthetic EXPLAIN failure'),{code:'TEST_PRIMARY'});let manifests=0;
  await assert.rejects(()=>run({onFixtureManifest:manifest=>{verifyManifest(manifest);manifests++;},db:async sql=>{
    if(sql==='select current_database() as name')return[{name:'vyakti_expert_integration_20260906'}];
    if(sql.startsWith('EXPLAIN '))throw primary;
    if(sql.includes('count(*)'))return[{n:0}];
    return[];
  }}),error=>error===primary&&error.cleanupFailure===null&&error.adoptionFixtureCleanupVerified===true&&error.remainingFixtureRows===0&&error.fixtureWritesStarted===false);
  assert.equal(manifests,2);
});
await check('cleanup explicitly removes owner-scoped readiness rows that have no cascade FK',async()=>{
  const primary=Object.assign(new Error('synthetic EXPLAIN failure'),{code:'TEST_PRIMARY'});
  let manifest,readinessRows=4,removed=false;
  await assert.rejects(()=>run({onFixtureManifest:value=>{manifest=value;},db:async(sql,params)=>{
    if(sql==='select current_database() as name')return[{name:'vyakti_expert_integration_20260906'}];
    if(sql.startsWith('EXPLAIN '))throw primary;
    if(sql.startsWith('delete from vy_replica_readiness')){
      assert(sql.includes('replica_id=any($1::uuid[]) and owner_user_id=$2::uuid'));
      assert.deepEqual(params,[manifest.replicaIds,manifest.ownerUserIds[0]]);readinessRows=0;removed=true;
    }
    if(sql.includes('count(*)'))return[{n:sql.includes('from vy_replica_readiness ')?readinessRows:0}];
    return[];
  }}),error=>error===primary&&error.adoptionFixtureCleanupVerified===true&&error.remainingFixtureRows===0);
  assert(removed);
});
console.log(`${count} adoption harness failure-path groups passed; no SQL proof.`);
