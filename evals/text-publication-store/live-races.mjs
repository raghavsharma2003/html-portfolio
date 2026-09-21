// Prepared acceptance only. Importing this file opens no connection and runs no SQL.
// Root supplies reviewed development-db adapters and an explicit opt-in. No provider,
// storage, authentication or real owner consent calls are part of this fixture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as store from '../../api/_text-publication-store.js';
import {revokeOwnedConsent} from '../../api/_replica-consent.js';
import {loadNeverRules} from '../../api/_review-queue.js';
import {compileNeverRules,replyViolatesNeverRule} from '../../api/_never-rules.js';
import {
 makeLivePublicationFixture,liveFixtureManifest,seedLivePublicationFixture,
 cleanupLivePublicationFixture,assertLiveFixtureAbsent,publishLiveFixture,joinLiveFixture,liveQuestionInput,
 admitLiveFixture,claimLiveFixture,settleLiveFixture,completeLiveFixture,
} from './live-fixtures.mjs';

const DATABASE='vyakti_expert_integration_20260906';
const sha=value=>createHash('sha256').update(value).digest('hex');
const outcome=promise=>promise.then(value=>({value}),error=>({error}));
const ownerInput=f=>({replica_id:f.rid,publication_id:f.pid});
const visitorInput=f=>({public_id:f.pid});
const terminalCodes=new Set([
 'text_publication_unavailable','text_publication_source_changed',
 'text_publication_request_unavailable','text_publication_session_invalid',
 'text_publication_admission_blocked',
 'text_publication_delivery_blocked','text_publication_output_authority_changed',
 'text_publication_dispatch_unavailable','text_publication_session_expired',
 'text_publication_visitor_unavailable','text_publication_permission_required',
 'text_publication_publish_blocked','text_publication_publication_retired',
 'text_publication_authority_unavailable','text_publication_source_unavailable',
 'text_publication_account_attestation_required',
]);
function mustRefuse(result,codes=terminalCodes){assert(result.error,'expected_authority_refusal');assert(codes.has(result.error.code),'unexpected_authority_refusal_code');}
function mustResolve(result){if(result.error)throw result.error;return result.value;}
function safeError(error){return {code:/^[A-Za-z0-9_]{1,100}$/.test(error?.code||'')?error.code:'UNCLASSIFIED',frames:String(error?.stack||'').split('\n').map(x=>x.match(/live-races\.mjs:\d+:\d+/)?.[0]).filter(Boolean)};}
async function checkedSql(errors,target,sql,params=[],phase='statement'){
 try{return await target(sql,params);}catch(error){errors.push({phase,sql_sha256:sha(sql),...safeError(error)});throw error;}
}
function assertNoSqlErrors(errors){assert.equal(errors.length,0,'sql_exception_invalidates_race');}
function dispatchBarrier(){let signal;const promise=new Promise(resolve=>{signal=resolve;});return{promise,signal};}
async function awaitTargetDispatch(barrier,finished,timeoutMs=30000){
 let timer;
 try{
  const result=await Promise.race([
   barrier.promise.then(()=> 'dispatched'),finished.then(()=> 'finished-before-target'),
   new Promise(resolve=>{timer=setTimeout(()=>resolve('setup-timeout'),timeoutMs);}),
  ]);
  assert.equal(result,'dispatched',result==='setup-timeout'?'target_sql_setup_timeout':'target_sql_not_dispatched');
 }finally{clearTimeout(timer);}
}

export async function runTextPublicationRaceBarrierControls(){
 const never=new Promise(()=>{}),a=dispatchBarrier();let setupDone=false;
 const setup=new Promise(resolve=>setTimeout(()=>{setupDone=true;a.signal();resolve();},20));
 await awaitTargetDispatch(a,never,100);assert.equal(setupDone,true);await setup;
 await assert.rejects(()=>awaitTargetDispatch(dispatchBarrier(),Promise.resolve(),100),/target_sql_not_dispatched/);
 await assert.rejects(()=>awaitTargetDispatch(dispatchBarrier(),never,10),/target_sql_setup_timeout/);
 return{passed:3,controls:['target-dispatch-after-setup','early-completion-refuses','setup-timeout-refuses'],noDatabaseCalls:true};
}

// Portable offline controls exercise the same error recorder and acceptance
// predicate used below. These open no session and do not claim SQL acceptance.
export async function runTextPublicationRaceFailureControls(){
 assert.throws(()=>mustRefuse({error:{code:'text_publication_admission_uncertain'}}),/unexpected_authority_refusal_code/);
 const controls=['uncertain-is-not-authority-refusal'];
 for(const code of ['55P03','40P01','23514','42601']){
  const errors=[];
  await assert.rejects(()=>checkedSql(errors,async()=>{throw Object.assign(Error('synthetic_sql_failure'),{code});},'synthetic statement',[],'offline-control'),{code});
  assert.equal(errors[0].code,code);assert.throws(()=>assertNoSqlErrors(errors),/sql_exception_invalidates_race/);controls.push(code);
 }
 return {passed:controls.length,controls,noDatabaseCalls:true};
}

export async function runTextPublicationSqlRaces({db,connect,onFixtureManifest,optIn}={}){
 assert.equal(optIn,true,'explicit_live_sql_opt_in_required');
 for(const [name,value] of Object.entries({db,connect,onFixtureManifest}))assert.equal(typeof value,'function',name+'_required');
 const labels=[
  'publish-before-unpublish','unknown-unpublish-before-publish','retired-publication-before-publish',
  'join-before-unpublish','admit-before-unpublish','join-before-capture-revoke',
  'admit-before-capture-revoke','join-before-visitor-forget','admit-before-visitor-forget',
  'visitor-forget-before-admit','never-epoch-before-completion','capture-revoke-before-completion',
  'request-retirement-origin','request-retirement-destination',
 ];
 const fixtures=Object.fromEntries(labels.map(label=>[label,makeLivePublicationFixture('race-'+label)]));
 // Capture the actual consent caller's first statement without executing it.
 // This lets the dispatch barrier match an exact SQL hash, not a text heuristic.
 let consentRevokeSql;
 await assert.rejects(()=>revokeOwnedConsent(async sql=>{consentRevokeSql=sql;throw Object.assign(Error('synthetic_sql_capture'),{code:'synthetic_sql_capture'});},fixtures[labels[0]].owner,fixtures[labels[0]].rid,['capture']),{code:'synthetic_sql_capture'});
 assert.equal(typeof consentRevokeSql,'string');
 // The second fixture intentionally attempts the first fixture's predeclared ID.
 // Declare that overlap before any INSERT. The helper owns the unique ID sets.
 const retiredRequest=fixtures['request-retirement-origin'].requests[0];
 const epochPredicate=" and h.dispatch_authority_epoch=($4::jsonb->>'fence_epoch')::bigint";
 assert.equal(store.TEXT_PUBLICATION_COMPLETE_SQL.split(epochPredicate).length,2,'exact_epoch_mutant_required');
 const removedEpochSql=store.TEXT_PUBLICATION_COMPLETE_SQL.replace(epochPredicate,'');
 const manifest={schema:'text-publication-live-races/v1',database:DATABASE,
  fixtures:labels.map(label=>liveFixtureManifest(fixtures[label])),
  intentionalRequestOverlap:{request_id:retiredRequest,origin:fixtures['request-retirement-origin'].pid,destination:fixtures['request-retirement-destination'].pid},
  sqlHashes:Object.fromEntries(['PUBLISH','ADMIT','CLAIM','COMPLETE','UNPUBLISH','FORGET','CLEANUP'].map(k=>[k,sha(store['TEXT_PUBLICATION_'+k+'_SQL'])])),
  consentRevokeSqlSha256:sha(consentRevokeSql),setupTimeoutMs:30000,blockingWitnessTimeoutMs:4500,idleTransactionTimeoutMs:60000,
  negativeControl:{kind:'derived-single-predicate-removal-not-historical-source',baselineSha256:sha(store.TEXT_PUBLICATION_COMPLETE_SQL),mutantSha256:sha(removedEpochSql),removedPredicate:epochPredicate.trim()},
  syntheticOnly:true,noProviderCalls:true,retiredOpaqueIdsRemain:true};
 const checks=[],diagnostics=[],cleanup=[],sessions=[],seeded=[],sqlErrors=[];
 let stage='manifest',failure=null,verified=false,pending=null,writer=null,waiter=null;
 const query=async(sql,params=[])=>{await checkedSql(sqlErrors,db,'EXPLAIN '+sql,params,'explain');return checkedSql(sqlErrors,db,sql,params);};
 async function begin(session){
  // Revalidate before BEGIN or any mutating statement on each dedicated session.
  const row=(await session.db('select current_database() name,pg_backend_pid() pid'))[0];
  assert.equal(row?.name,DATABASE,'dedicated_session_database_mismatch');
  await session.db('BEGIN');await session.db("set local idle_in_transaction_session_timeout='60s'");await session.db("set local statement_timeout='10s'");await session.db("set local lock_timeout='7s'");
  return Number(row.pid);
 }
 async function witness(d,writerPid,waitingPid){
  const start=Date.now();
  while(Date.now()-start<4500&&d.pending==='pending'){
   const rows=await db('select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blocking_pids from pg_stat_activity where pid=any($1::int[]) order by pid',[[writerPid,waitingPid]]);
   // PID and wait fields only: no query text, parameters, session tokens or media.
   d.observations.push({elapsed_ms:Date.now()-start,states:rows});
   if(rows.find(r=>Number(r.pid)===waitingPid)?.blocking_pids?.map(Number).includes(writerPid)){d.blocked_witness=true;d.blocked_sql_sha256=d.active_sql_sha256;return;}
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.fail('pg_blocking_pids_witness_required');
 }
 function sessionQuery(session,diagnostic=null,barrier=null){return async(sql,params=[])=>{
  const sqlHash=sha(sql);
  const phase=value=>{if(diagnostic){diagnostic.active_sql_sha256=sqlHash;diagnostic.active_phase=value;diagnostic.query_events.push({elapsed_ms:Date.now()-diagnostic.started_at,sql_sha256:sqlHash,phase:value});}};
  // Preserve statement rollback semantics while recording the underlying SQL
  // error before any store catch can replace it. No SQL exception is accepted.
  phase('explain');await checkedSql(sqlErrors,session.db,'EXPLAIN '+sql,params,'explain');phase('savepoint');await checkedSql(sqlErrors,session.db,'SAVEPOINT publication_race_statement',[],'savepoint');
  try{
   phase('execute');if(barrier&&sqlHash===diagnostic.target_sql_sha256){diagnostic.target_dispatched_ms=Date.now()-diagnostic.started_at;barrier.signal();}
   const rows=await checkedSql(sqlErrors,session.db,sql,params);phase('release');await checkedSql(sqlErrors,session.db,'RELEASE SAVEPOINT publication_race_statement',[],'savepoint-release');phase('complete');return rows;
  }
  catch(error){await session.db('ROLLBACK TO SAVEPOINT publication_race_statement');await session.db('RELEASE SAVEPOINT publication_race_statement');throw error;}
 };}
 function targetSql(label){
  if(label.endsWith('-before-unpublish'))return store.TEXT_PUBLICATION_UNPUBLISH_SQL;
  if(label.endsWith('-before-publish'))return store.TEXT_PUBLICATION_PUBLISH_SQL;
  if(label.endsWith('-before-capture-revoke'))return consentRevokeSql;
  if(label.endsWith('-before-visitor-forget'))return store.TEXT_PUBLICATION_FORGET_SQL;
  if(label.endsWith('-before-completion'))return store.TEXT_PUBLICATION_AUTHORIZED_READ_SQL;
  if(label==='visitor-forget-before-admit'||label==='retired-request-with-reserved-spend-cannot-reincarnate')return store.TEXT_PUBLICATION_ADMIT_SQL;
  assert.fail('known_race_target_required');
 }
 async function race(label,hold,wait,verify){
  stage=label;const a=await begin(writer),b=await begin(waiter);assert.notEqual(a,b,'two_distinct_backends_required');
  const held=await hold(sessionQuery(writer));
  assertNoSqlErrors(sqlErrors);
  const d={stage:label,pids:{writer:a,waiter:b},pending:'pending',started_at:Date.now(),target_sql_sha256:sha(targetSql(label)),blocked_witness:false,observations:[],query_events:[]};diagnostics.push(d);
  const barrier=dispatchBarrier();
  pending=outcome(wait(sessionQuery(waiter,d,barrier),held)).then(result=>{d.pending=result.error?'rejected':'resolved';if(result.error)d.code=safeError(result.error).code;return result;});
  await awaitTargetDispatch(barrier,pending);d.witness_started_ms=Date.now()-d.started_at;
  await witness(d,a,b);assert.equal(d.blocked_sql_sha256,d.target_sql_sha256,'exact_target_lock_witness_required');await writer.db('COMMIT');const result=await pending;pending=null;
  assertNoSqlErrors(sqlErrors);
  assert.equal(Number((await waiter.db('select pg_backend_pid() pid'))[0].pid),b,'waiter_must_remain_pinned');
  await waiter.db('COMMIT');await verify(result,held,d);checks.push(label);
 }
 async function countPayloads(f,visitor=null){
  const [r]=await db(`select
   (select count(*) from vy_text_publication_visitor v where v.publication_id=$1::uuid and ($2::uuid is null or v.visitor_user_id=$2::uuid) and v.admission is not null) admissions,
   (select count(*) from vy_text_publication_request h where h.publication_id=$1::uuid and ($2::uuid is null or h.visitor_user_id=$2::uuid) and (h.question_envelope is not null or h.answer_envelope is not null or h.raw_envelope is not null)) payloads`,[f.pid,visitor]);
  return {admissions:Number(r.admissions),payloads:Number(r.payloads)};
 }
 async function assertClosed(f,visitor=null){assert.deepEqual(await countPayloads(f,visitor),{admissions:0,payloads:0});}
 async function assertCounter(f,visitor,count){const rows=await db('select question_count from vy_text_publication_visitor where publication_id=$1::uuid and visitor_user_id=$2::uuid',[f.pid,visitor]);assert.equal(rows.length,1);assert.equal(Number(rows[0].question_count),count);}
 async function revoked(f){const p=await store.readOwnedTextPublication(query,f.owner,ownerInput(f));assert.equal(p.state,'revoked');assert.equal(p.can_text,false);await assertClosed(f);}
 async function checkLedger(id,kind){const rows=await db('select kind from vy_text_publication_id_ledger where id=$1::uuid',[id]);assert.deepEqual(rows.map(r=>r.kind),[kind]);}
 try{
  await onFixtureManifest(manifest);
  assert.equal((await db('select current_database() name'))[0]?.name,DATABASE,'exact_development_database_required');verified=true;
  // Every declaration is made before the first fixture mutates the target.
  stage='all-fixture-absence';for(const f of Object.values(fixtures))await assertLiveFixtureAbsent(db,f);
  for(const f of Object.values(fixtures)){stage='seed-'+f.label;seeded.push(f);await seedLivePublicationFixture(query,f);}
  for(let n=0;n<2;n++){const c=await connect();assert.equal(typeof c?.db,'function');assert.equal(typeof c?.close,'function');sessions.push(c);}
  [writer,waiter]=sessions;

  {
   const f=fixtures['publish-before-unpublish'];
   await race('publish-before-unpublish',q=>publishLiveFixture(q,f),q=>store.unpublishTextPublication(q,f.owner,ownerInput(f)),async result=>{mustResolve(result);await revoked(f);await checkLedger(f.pid,'publication');});
  }
  for(const label of ['unknown-unpublish-before-publish','retired-publication-before-publish']){
   const f=fixtures[label];
   await race(label,async q=>{
    const stopped=await store.unpublishTextPublication(q,f.owner,ownerInput(f));assert.equal(stopped.publication_never_created,true);
    if(label.startsWith('retired-'))await q('delete from vy_text_publication where publication_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[f.pid,f.rid,f.owner]);
   },q=>publishLiveFixture(q,f),async result=>{
    if(label.startsWith('retired-')){mustRefuse(result);assert.equal((await db('select publication_id from vy_text_publication where publication_id=$1::uuid',[f.pid])).length,0);}
    else{if(result.error)mustRefuse(result);else assert.equal(result.value.publication.state,'revoked');await revoked(f);}
    await checkLedger(f.pid,'publication');
   });
  }

  // Start each terminal statement before the first join/admission commits. Its
  // first statement snapshot cannot see the new payload; the real fresh cleanup
  // must see it after the source/publication lock wait resolves.
  for(const terminal of ['unpublish','capture-revoke','visitor-forget'])for(const activity of ['join','admit']){
   const label=activity+'-before-'+terminal,f=fixtures[label];await publishLiveFixture(query,f);
   const other=await joinLiveFixture(query,f,f.other);
   const otherInput={...liveQuestionInput(f,other,1),question:'Unrelated visitor fixture question'};
   await store.admitTextPublicationRequest(query,f.other,otherInput,{env:f.env});
   const session=activity==='admit'?await joinLiveFixture(query,f):null;
   await race(label,q=>activity==='join'?joinLiveFixture(q,f):admitLiveFixture(q,f,session),q=>{
    if(terminal==='unpublish')return store.unpublishTextPublication(q,f.owner,ownerInput(f));
    if(terminal==='capture-revoke')return revokeOwnedConsent(q,f.owner,f.rid,['capture']);
    return store.forgetTextPublicationVisitor(q,f.visitor,visitorInput(f));
   },async result=>{
    mustResolve(result);await assertClosed(f,terminal==='visitor-forget'?f.visitor:null);
    if(terminal==='visitor-forget'){
     assert.deepEqual(await countPayloads(f,f.other),{admissions:1,payloads:1});
     await assertCounter(f,f.visitor,activity==='admit'?1:0);
     const joined=await joinLiveFixture(query,f);assert(joined.session_token);
     await assertCounter(f,f.visitor,activity==='admit'?1:0);
    }else await revoked(f);
    if(session)mustRefuse(await outcome(store.readTextPublicationRequest(query,f.visitor,liveQuestionInput(f,session),{env:f.env})));
   });
  }
  {
   const f=fixtures['visitor-forget-before-admit'];await publishLiveFixture(query,f);const session=await joinLiveFixture(query,f);
   await race('visitor-forget-before-admit',q=>store.forgetTextPublicationVisitor(q,f.visitor,visitorInput(f)),q=>admitLiveFixture(q,f,session),async result=>{mustRefuse(result);await assertClosed(f,f.visitor);await assertCounter(f,f.visitor,0);});
  }

  for(const label of ['never-epoch-before-completion','capture-revoke-before-completion']){
   const f=fixtures[label];await publishLiveFixture(query,f);const session=await joinLiveFixture(query,f);await admitLiveFixture(query,f,session);const claim=await claimLiveFixture(query,f,session);await settleLiveFixture(query,f);
   // Actual rule reader/matcher, synthetic candidate answer. This is not a model
   // response or the shared runtime gate acceptance (covered by its own runner).
   const answer='The period is 2 seconds.';let heldCompletionParams=null;
   assert.equal(replyViolatesNeverRule(answer,compileNeverRules(await loadNeverRules(query,f.rid,f.owner))),'');
   // Capture a real, valid completion binding before the authority edit. The
   // named interception happens before COMPLETE executes, and returns no answer.
   // During the race currentRequest's AUTHORIZED_READ can refuse even earlier.
   mustRefuse(await outcome(completeLiveFixture(async(sql,params)=>{
    if(sql===store.TEXT_PUBLICATION_COMPLETE_SQL){heldCompletionParams=structuredClone(params);throw Object.assign(Error('synthetic_completion_boundary'),{code:'synthetic_completion_boundary'});}
    return query(sql,params);
   },f,session,claim)),new Set(['synthetic_completion_boundary']));
   assert(heldCompletionParams,'actual_complete_binding_capture_required');
   await race(label,async q=>{
    if(label.startsWith('capture-'))return revokeOwnedConsent(q,f.owner,f.rid,['capture']);
    // Predeclared synthetic mutation follows the real Never-rule source->replica
    // lock order and epoch advance. The ordinary owner card tap is separate proof.
    await q(`with source_gate as materialized (select source_id from vy_replica_source where replica_id=$1::uuid and owner_user_id=$2::uuid order by source_id for update),
     owned as (update vy_replica set private_text_epoch=private_text_epoch+1 where replica_id=$1::uuid and owner_user_id=$2::uuid and (select count(*) from source_gate)>=0 returning replica_id)
     insert into vy_review_never_rule(rule_id,replica_id,owner_user_id,pattern,reason) select $3::uuid,$1::uuid,$2::uuid,$4,'Synthetic race control' from owned returning rule_id`,[f.rid,f.owner,f.ruleId,answer]);
   },q=>completeLiveFixture(q,f,session,claim),async(result,_held,d)=>{
    mustRefuse(result);
    const [row]=await db('select state,answer_envelope,raw_envelope from vy_text_publication_request where request_id=$1::uuid',[f.requests[0]]);assert(row);assert.notEqual(row.state,'complete');assert.equal(row.answer_envelope,null);assert.equal(row.raw_envelope,null);
    const [spend]=await db('select state from vy_provider_spend where reservation_id=$1::uuid and budget_id=$2',[f.reservations[0],f.budgetId]);assert.equal(spend.state,'settled');
    if(label.startsWith('never-')){
     assert.equal(replyViolatesNeverRule(answer,compileNeverRules(await loadNeverRules(query,f.rid,f.owner))),f.ruleId);
     mustRefuse(await outcome(completeLiveFixture(query,f,session,claim)),new Set(['text_publication_output_authority_changed']));
     // Retain a causal SQL negative: refresh only the transient current epoch,
     // as the old implementation did, and remove only the persisted epoch check.
     // Mutant ciphertext is never read/delivered and the transaction is rolled back.
     assert(heldCompletionParams,'held_actual_complete_sql_required');
     const current=(await db('select private_text_epoch from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[f.rid,f.owner]))[0];
     const params=structuredClone(heldCompletionParams);params[3]=JSON.stringify({...JSON.parse(params[3]),fence_epoch:String(current.private_text_epoch)});
     await begin(writer);
     try{
      const q=sessionQuery(writer);assert.equal((await q(store.TEXT_PUBLICATION_COMPLETE_SQL,params)).length,0);
      assert.equal((await q(removedEpochSql,params)).length,1,'removed_epoch_negative_must_admit_stale_output');
      d.negative_control={baseline_rows:0,removed_epoch_rows:1,mutantSha256:sha(removedEpochSql),rolled_back:false};
     }finally{await writer.db('ROLLBACK');}
     d.negative_control.rolled_back=true;
     const [after]=(await db('select state,answer_envelope,raw_envelope from vy_text_publication_request where request_id=$1::uuid',[f.requests[0]]));assert.equal(after.state,'dispatched');assert.equal(after.answer_envelope,null);assert.equal(after.raw_envelope,null);
     assert.equal((await admitLiveFixture(query,f,session,1)).created,true);
    }else await revoked(f);
   });
  }
  {
   const origin=fixtures['request-retirement-origin'],destination=fixtures['request-retirement-destination'];
   await publishLiveFixture(query,origin);await publishLiveFixture(query,destination);
   const oldSession=await joinLiveFixture(query,origin),newSession=await joinLiveFixture(query,destination);
   await race('retired-request-with-reserved-spend-cannot-reincarnate',async q=>{
    await admitLiveFixture(q,origin,oldSession);const oldClaim=await claimLiveFixture(q,origin,oldSession);
    await q('delete from vy_text_publication where publication_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[origin.pid,origin.rid,origin.owner]);
    return oldClaim;
   },q=>store.admitTextPublicationRequest(q,destination.visitor,{...liveQuestionInput(destination,newSession),request_id:retiredRequest},{env:destination.env}),async result=>{
    mustRefuse(result,new Set(['text_publication_admission_blocked']));await checkLedger(retiredRequest,'request');
    assert.equal((await db('select request_id from vy_text_publication_request where request_id=$1::uuid',[retiredRequest])).length,0);
    await assertCounter(destination,destination.visitor,0);
    const [spend]=await db('select state from vy_provider_spend where reservation_id=$1::uuid and budget_id=$2',[origin.reservations[0],origin.budgetId]);assert.equal(spend.state,'reserved');
    // Old-handler finalization cannot target another incarnation. No provider
    // release is called, and the destination created no dispatch opportunity.
    const failed=await store.failTextPublicationRequest(query,origin.visitor,{...liveQuestionInput(origin,oldSession),failure_code:'synthetic_old_handler',billing_state:'not_started'});assert.equal(failed.state,'withdrawn');
   });
  }
 }catch(error){const active=diagnostics.at(-1);failure={stage,...safeError(error),...(active&&{before_cleanup:{pending:active.pending,active_phase:active.active_phase,active_sql_sha256:active.active_sql_sha256,target_sql_sha256:active.target_sql_sha256,target_dispatched_ms:active.target_dispatched_ms??null}})};}
 finally{
  // Release the holder before waiting for the waiter, including failed witnesses.
  if(writer)try{await writer.db('ROLLBACK');}catch(error){cleanup.push({phase:'writer-rollback',...safeError(error)});}
  if(pending)await pending;
  for(const c of sessions){try{await c.db('ROLLBACK');}catch(error){cleanup.push({phase:'rollback',...safeError(error)});}try{await c.close();}catch(error){cleanup.push({phase:'close',...safeError(error)});}}
  if(verified)for(const f of seeded)try{cleanup.push({fixture:f.pid,result:await cleanupLivePublicationFixture(db,f)});}catch(error){cleanup.push({fixture:f.pid,...safeError(error)});}
 }
 return {schema:manifest.schema,preparedRunner:true,pass:!failure&&!sqlErrors.length&&checks.length===13&&cleanup.length===labels.length&&cleanup.every(x=>!x.code&&x.result?.private_rows_remaining===0),passed:checks.length,checks,failure,sqlErrors,diagnostics,cleanup,manifest,
  limitation:'Requires root execution on the exact isolated development database. Synthetic row/ledger fixtures, real store/consent SQL, two pinned sessions and pg_blocking_pids witnesses. No provider/auth/storage/upload/UI acceptance. Opaque retired IDs remain counted separately. Never-rule mutation is a declared synthetic SQL transition; no owner tap or model quality is claimed.'};
}
