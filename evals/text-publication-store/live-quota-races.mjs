// Preparation only: no default DB, connection, provider, credentials or autorun.
// Root's protected launcher must pin this file and its full reviewed import closure.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as store from '../../api/_text-publication-store.js';
import {
 makeLivePublicationFixture,liveFixtureManifest,assertLiveFixtureAbsent,
 seedLivePublicationFixture,cleanupLivePublicationFixture,publishLiveFixture,
 joinLiveFixture,liveQuestionInput,liveReservation,LIVE_PROVIDER,LIVE_SEED_SQL,
} from './live-fixtures.mjs';

const DATABASE='vyakti_expert_integration_20260906';
const hash=x=>createHash('sha256').update(x).digest('hex');
const outcome=p=>p.then(value=>({value}),error=>({error}));
const safeError=e=>({code:/^[A-Za-z0-9_]{1,100}$/.test(e?.code||'')?e.code:'UNCLASSIFIED',frames:String(e?.stack||'').split('\n').map(x=>x.match(/live-quota-races\.mjs:\d+:\d+/)?.[0]).filter(Boolean)});
const resolved=r=>{if(r.error)throw r.error;return r.value;};
function refused(r,codes){assert(r.error,'deterministic_refusal_required');assert(codes.includes(r.error.code),'unexpected_refusal_code');}
function noSqlErrors(errors){assert.equal(errors.length,0,'sql_exception_invalidates_quota_race');}
async function checked(errors,db,sql,params=[]){try{return await db(sql,params);}catch(error){errors.push({sql_sha256:hash(sql),...safeError(error)});throw error;}}
function dispatchBarrier(){let signal;const promise=new Promise(resolve=>{signal=resolve;});return{promise,signal};}
async function awaitTargetDispatch(barrier,finished,timeoutMs=30000){
 let timer;
 try{
  const result=await Promise.race([barrier.promise.then(()=> 'dispatched'),finished.then(()=> 'finished-before-target'),new Promise(resolve=>{timer=setTimeout(()=>resolve('setup-timeout'),timeoutMs);})]);
  assert.equal(result,'dispatched',result==='setup-timeout'?'target_sql_setup_timeout':'target_sql_not_dispatched');
 }finally{clearTimeout(timer);}
}

export async function runTextPublicationQuotaSqlRaces({db,connect,onFixtureManifest,optIn}={}){
 assert.equal(optIn,true,'explicit_live_sql_opt_in_required');
 for(const [key,value] of Object.entries({db,connect,onFixtureManifest}))assert.equal(typeof value,'function',key+'_required');
 const labels=['same-request-admission','visitor-final-slot','publication-final-slot','exclusive-request-claim','publication-budget-final-slot'];
 const fixtures=Object.fromEntries(labels.map(label=>[label,makeLivePublicationFixture('quota-'+label)]));
 const manifest={schema:'text-publication-quota-races/v1',database:DATABASE,fixtures:Object.values(fixtures).map(liveFixtureManifest),
  scenarios:labels,sqlHashes:Object.fromEntries(['ADMIT','AUTHORIZED_READ','CLAIM'].map(k=>[k,hash(store['TEXT_PUBLICATION_'+k+'_SQL'])])),setupTimeoutMs:30000,blockingWitnessTimeoutMs:4500,idleTransactionTimeoutMs:60000,
  syntheticBoundaryCounters:{visitor:19,publication:199,publication_committed_microusd:999500,reservation_microusd:500},
  declaration:'Synthetic SQL boundary counters and reservations; no historical traffic, real spend, authentication or model call is claimed.',retiredOpaqueIdsRemain:true};
 const checks=[],diagnostics=[],sqlErrors=[],cleanup=[],seeded=[],sessions=[];
 let stage='manifest',verified=false,failure=null,writer=null,waiter=null,pending=null;
 const query=async(sql,params=[])=>{await checked(sqlErrors,db,'EXPLAIN '+sql,params);return checked(sqlErrors,db,sql,params);};
 const opts=f=>({env:f.env});
 const admit=(q,f,session,index=0,visitor=f.visitor)=>store.admitTextPublicationRequest(q,visitor,liveQuestionInput(f,session,index),opts(f));
 const claim=(q,f,session,index=0)=>store.claimTextPublicationRequest(q,f.visitor,{...liveQuestionInput(f,session,index),reservation:liveReservation(f,index),provider:LIVE_PROVIDER},opts(f));
 async function begin(session){
  const [row]=await session.db('select current_database() name,pg_backend_pid() pid');assert.equal(row?.name,DATABASE,'dedicated_database_mismatch');
  await session.db('BEGIN');await session.db("set local idle_in_transaction_session_timeout='60s'");await session.db("set local statement_timeout='10s'");await session.db("set local lock_timeout='7s'");return Number(row.pid);
 }
 function pinned(session,d,barrier=null){return async(sql,params=[])=>{
  const sqlHash=hash(sql),phase=value=>{if(d){d.active_sql_sha256=sqlHash;d.active_phase=value;d.query_events.push({elapsed_ms:Date.now()-d.started_at,sql_sha256:sqlHash,phase:value});}};
  phase('explain');await checked(sqlErrors,session.db,'EXPLAIN '+sql,params);phase('execute');
  if(barrier&&sqlHash===d.target_sql_sha256){d.target_dispatched_ms=Date.now()-d.started_at;barrier.signal();}
  const rows=await checked(sqlErrors,session.db,sql,params);phase('complete');return rows;
 };}
 async function witness(d,a,b){
  const start=Date.now();
  while(Date.now()-start<4500&&d.pending==='pending'){
   const states=await db('select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blocking_pids from pg_stat_activity where pid=any($1::int[]) order by pid',[[a,b]]);
   d.observations.push({elapsed_ms:Date.now()-start,states});
   if(states.find(r=>Number(r.pid)===b)?.blocking_pids?.map(Number).includes(a)){d.blocked_witness=true;d.blocked_sql_sha256=d.active_sql_sha256;return;}
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.fail('pg_blocking_pids_witness_required');
 }
 async function race(label,hold,wait,verify){
  stage=label;const a=await begin(writer),b=await begin(waiter);assert.notEqual(a,b,'distinct_pinned_sessions_required');
  const held=await hold(pinned(writer));noSqlErrors(sqlErrors);
  const target=label.includes('claim')||label.includes('budget')?store.TEXT_PUBLICATION_AUTHORIZED_READ_SQL:store.TEXT_PUBLICATION_ADMIT_SQL;
  const d={stage:label,pids:{writer:a,waiter:b},pending:'pending',started_at:Date.now(),target_sql_sha256:hash(target),blocked_witness:false,observations:[],query_events:[]};diagnostics.push(d);
  const barrier=dispatchBarrier();
  pending=outcome(wait(pinned(waiter,d,barrier))).then(result=>{d.pending=result.error?'rejected':'resolved';if(result.error)d.code=safeError(result.error).code;return result;});
  await awaitTargetDispatch(barrier,pending);d.witness_started_ms=Date.now()-d.started_at;
  await witness(d,a,b);
  assert.equal(d.blocked_sql_sha256,d.target_sql_sha256,'actual_store_lock_witness_required');
  await writer.db('COMMIT');const result=await pending;pending=null;noSqlErrors(sqlErrors);
  assert.equal(Number((await waiter.db('select pg_backend_pid() pid'))[0].pid),b,'waiter_must_remain_pinned');
  await waiter.db('COMMIT');await verify(result,held,d);noSqlErrors(sqlErrors);checks.push(label);
 }
 async function counts(f){
  const [p]=await db('select question_count,committed_microusd from vy_text_publication where publication_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[f.pid,f.rid,f.owner]);assert(p);
  const visitors=await db('select visitor_user_id,question_count from vy_text_publication_visitor where publication_id=$1::uuid order by visitor_user_id',[f.pid]);
  const requests=await db('select request_id,state,reservation_id,dispatch_token_hash from vy_text_publication_request where publication_id=$1::uuid order by request_id',[f.pid]);
  const retired=await db('select id,kind from vy_text_publication_id_ledger where id=any($1::uuid[]) order by id',[f.requests]);
  return {questions:Number(p.question_count),committed:Number(p.committed_microusd),visitors:Object.fromEntries(visitors.map(v=>[v.visitor_user_id,Number(v.question_count)])),requests,retired};
 }
 async function seedReservation(f,index){
  const v=liveReservation(f,index),p=LIVE_PROVIDER;
  await query(LIVE_SEED_SQL.spend,[v.reservation_id,f.budgetId,p.family,p.name,p.version,p.model,v.request_hash]);
  await query('update vy_provider_budget set reserved_microusd=reserved_microusd+500 where budget_id=$1',[f.budgetId]);
 }
 async function assertUnspent(f,n){
  const rows=await db('select state,actual_microusd from vy_provider_spend where reservation_id=any($1::uuid[]) and budget_id=$2',[f.reservations,f.budgetId]);assert.equal(rows.length,n);
  for(const row of rows){assert.equal(row.state,'reserved');assert(row.actual_microusd===null||Number(row.actual_microusd)===0);}
  const [budget]=await db('select reserved_microusd,spent_microusd from vy_provider_budget where budget_id=$1',[f.budgetId]);assert.equal(Number(budget.reserved_microusd),500*n);assert.equal(Number(budget.spent_microusd),0);
 }
 try{
  await onFixtureManifest(manifest);assert.equal((await db('select current_database() name'))[0]?.name,DATABASE,'exact_development_database_required');verified=true;
  stage='all-fixture-absence';for(const f of Object.values(fixtures))await assertLiveFixtureAbsent(db,f);
  for(const f of Object.values(fixtures)){stage='seed-'+f.label;seeded.push(f);await seedLivePublicationFixture(query,f);await publishLiveFixture(query,f);}
  for(let n=0;n<2;n++){const c=await connect();assert.equal(typeof c?.db,'function');assert.equal(typeof c?.close,'function');sessions.push(c);}[writer,waiter]=sessions;
  {
   const f=fixtures['same-request-admission'],session=await joinLiveFixture(query,f);
   await race('same-request-admission',q=>admit(q,f,session),q=>admit(q,f,session),async(result,held)=>{
    assert.equal(held.created,true);const replay=resolved(result);assert.equal(replay.created,false);assert.equal(replay.compilerInput,null);assert.equal(replay.request.request_id,f.requests[0]);
    const c=await counts(f);assert.equal(c.questions,1);assert.equal(c.visitors[f.visitor],1);assert.equal(c.requests.length,1);assert.equal(c.requests[0].state,'admitted');assert.deepEqual(c.retired,[{id:f.requests[0],kind:'request'}]);assert.equal(c.committed,0);await assertUnspent(f,0);
   });
  }
  {
   const f=fixtures['visitor-final-slot'],session=await joinLiveFixture(query,f);
   // Declared counter boundary, not a claim that19 real requests were served.
   await query('update vy_text_publication_visitor set question_count=19 where publication_id=$1::uuid and visitor_user_id=$2::uuid',[f.pid,f.visitor]);
   await query('update vy_text_publication set question_count=19 where publication_id=$1::uuid',[f.pid]);
   await race('visitor-final-slot',q=>admit(q,f,session,0),q=>admit(q,f,session,1),async(result,held)=>{
    assert.equal(held.created,true);refused(result,['text_publication_admission_blocked']);
    const c=await counts(f);assert.equal(c.questions,20);assert.equal(c.visitors[f.visitor],20);assert.deepEqual(c.requests.map(r=>r.request_id),[f.requests[0]]);assert.deepEqual(c.retired,[{id:f.requests[0],kind:'request'}]);await assertUnspent(f,0);
   });
  }
  {
   const f=fixtures['publication-final-slot'],a=await joinLiveFixture(query,f),b=await joinLiveFixture(query,f,f.other);
   await query('update vy_text_publication set question_count=199 where publication_id=$1::uuid',[f.pid]);
   await race('publication-final-slot',q=>admit(q,f,a,0),q=>admit(q,f,b,1,f.other),async(result,held)=>{
    assert.equal(held.created,true);refused(result,['text_publication_admission_blocked']);
    const c=await counts(f);assert.equal(c.questions,200);assert.equal(c.visitors[f.visitor],1);assert.equal(c.visitors[f.other],0);assert.deepEqual(c.requests.map(r=>r.request_id),[f.requests[0]]);assert.deepEqual(c.retired,[{id:f.requests[0],kind:'request'}]);await assertUnspent(f,0);
   });
  }
  {
   const f=fixtures['exclusive-request-claim'],session=await joinLiveFixture(query,f);await admit(query,f,session);await seedReservation(f,0);
   await race('exclusive-request-claim',q=>claim(q,f,session),q=>claim(q,f,session),async(result,held)=>{
    assert.match(held.dispatch_token,/^[0-9a-f]{64}$/);refused(result,['text_publication_dispatch_unavailable','text_publication_dispatch_blocked']);
    const c=await counts(f);assert.equal(c.questions,1);assert.equal(c.visitors[f.visitor],1);assert.equal(c.committed,500);assert.equal(c.requests.length,1);assert.equal(c.requests[0].state,'dispatched');assert.equal(c.requests[0].reservation_id,f.reservations[0]);assert.equal(c.requests[0].dispatch_token_hash,hash(held.dispatch_token));await assertUnspent(f,1);
   });
  }
  {
   const f=fixtures['publication-budget-final-slot'],session=await joinLiveFixture(query,f);await admit(query,f,session,0);await admit(query,f,session,1);
   await seedReservation(f,0);await seedReservation(f,1);
   // Seed both reservations before starting either pinned claim. The witnessed
   // blocker must belong to the real store, not the fixture budget UPDATE.
   const [p]=await db('select terms from vy_text_publication where publication_id=$1::uuid',[f.pid]);const terms=typeof p.terms==='string'?JSON.parse(p.terms):p.terms;assert.equal(Number(terms.budget_microusd),1000000);
   await query('update vy_text_publication set committed_microusd=999500 where publication_id=$1::uuid',[f.pid]);
   await race('publication-budget-final-slot',q=>claim(q,f,session,0),q=>claim(q,f,session,1),async(result,held)=>{
    assert.match(held.dispatch_token,/^[0-9a-f]{64}$/);refused(result,['text_publication_dispatch_blocked']);
    const c=await counts(f);assert.equal(c.questions,2);assert.equal(c.visitors[f.visitor],2);assert.equal(c.committed,1000000);assert.equal(c.requests.length,2);
    const winner=c.requests.find(r=>r.request_id===f.requests[0]),loser=c.requests.find(r=>r.request_id===f.requests[1]);assert.equal(winner.state,'dispatched');assert.equal(winner.dispatch_token_hash,hash(held.dispatch_token));assert.equal(winner.reservation_id,f.reservations[0]);assert.equal(loser.state,'admitted');assert.equal(loser.reservation_id,null);assert.equal(loser.dispatch_token_hash,null);await assertUnspent(f,2);
   });
  }
 }catch(error){const active=diagnostics.at(-1);failure={stage,...safeError(error),...(active&&{before_cleanup:{pending:active.pending,active_phase:active.active_phase,active_sql_sha256:active.active_sql_sha256,target_sql_sha256:active.target_sql_sha256,target_dispatched_ms:active.target_dispatched_ms??null}})};}
 finally{
  if(writer)try{await writer.db('ROLLBACK');}catch(error){cleanup.push({phase:'writer-rollback',...safeError(error)});}if(pending)await pending;
  for(const session of sessions){try{await session.db('ROLLBACK');}catch(error){cleanup.push({phase:'rollback',...safeError(error)});}try{await session.close();}catch(error){cleanup.push({phase:'close',...safeError(error)});}}
  if(verified)for(const f of seeded)try{cleanup.push({fixture:f.pid,result:await cleanupLivePublicationFixture(db,f)});}catch(error){cleanup.push({fixture:f.pid,...safeError(error)});}
 }
 return {schema:manifest.schema,pass:!failure&&!sqlErrors.length&&checks.length===labels.length&&cleanup.length===labels.length&&cleanup.every(r=>!r.code&&r.result?.private_rows_remaining===0),passed:checks.length,checks,failure,sqlErrors,diagnostics,cleanup,manifest,
  limitation:'Prepared real PostgreSQL acceptance. Counter boundaries and reservations are synthetic; no provider dispatch, billing settlement, owner authentication or real visitor load. Two dedicated sessions plus observer required. Opaque retired IDs retained and counted separately.'};
}

export async function runTextPublicationQuotaPreparationChecks(){
 const controls=[];let dbCalls=0;
 const forbidden=async()=>{throw Error('unexpected_connection');};
 await assert.rejects(()=>runTextPublicationQuotaSqlRaces({optIn:false,db:async()=>{dbCalls++;},connect:forbidden,onFixtureManifest:forbidden}));assert.equal(dbCalls,0);controls.push('explicit-opt-in');
 const wrong=await runTextPublicationQuotaSqlRaces({optIn:true,db:async sql=>{dbCalls++;assert.equal(sql,'select current_database() name');return[{name:'wrong'}];},connect:forbidden,onFixtureManifest:async m=>{assert.equal(m.fixtures.length,5);assert(!JSON.stringify(m).includes('KEK'));}});assert.equal(wrong.pass,false);assert.equal(dbCalls,1);assert.equal(wrong.cleanup.length,0);controls.push('wrong-database-no-mutation');
 dbCalls=0;const collision=await runTextPublicationQuotaSqlRaces({optIn:true,db:async sql=>{dbCalls++;return sql==='select current_database() name'?[{name:DATABASE}]:[{replicas:1}];},connect:forbidden,onFixtureManifest:async()=>{}});assert.equal(collision.pass,false);assert.equal(dbCalls,2);assert.equal(collision.cleanup.length,0);controls.push('collision-no-cleanup');
 dbCalls=0;const noManifest=await runTextPublicationQuotaSqlRaces({optIn:true,db:async()=>{dbCalls++;},connect:forbidden,onFixtureManifest:async()=>{throw Object.assign(Error('synthetic'),{code:'SYNTHETIC_MANIFEST'});}});assert.equal(noManifest.pass,false);assert.equal(dbCalls,0);assert.equal(noManifest.cleanup.length,0);controls.push('manifest-before-db');
 assert.throws(()=>refused({error:{code:'text_publication_admission_uncertain'}},['text_publication_admission_blocked']),/unexpected_refusal_code/);controls.push('uncertain-is-not-refusal');
 for(const code of ['55P03','40P01','23514','42601']){const errors=[];await assert.rejects(()=>checked(errors,async()=>{throw Object.assign(Error('synthetic'),{code});},'synthetic'),{code});assert.equal(errors[0].code,code);assert.throws(()=>noSqlErrors(errors),/sql_exception_invalidates_quota_race/);controls.push(code);}
 const never=new Promise(()=>{}),a=dispatchBarrier();let setupDone=false;const setup=new Promise(resolve=>setTimeout(()=>{setupDone=true;a.signal();resolve();},20));
 await awaitTargetDispatch(a,never,100);assert.equal(setupDone,true);await setup;controls.push('target-dispatch-after-setup');
 await assert.rejects(()=>awaitTargetDispatch(dispatchBarrier(),Promise.resolve(),100),/target_sql_not_dispatched/);controls.push('early-completion-refuses');
 await assert.rejects(()=>awaitTargetDispatch(dispatchBarrier(),never,10),/target_sql_setup_timeout/);controls.push('setup-timeout-refuses');
 return {passed:controls.length,controls,noDatabaseCalls:true};
}
