// Prepared root-only development PostgreSQL race. Importing opens no connection.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as store from '../../api/_text-publication-store.js';
import {sha256Hex} from '../../api/_provenance/contracts.js';
import {makeLivePublicationFixture,liveFixtureManifest,seedLivePublicationFixture,cleanupLivePublicationFixture,assertLiveFixtureAbsent} from '../text-publication-store/live-fixtures.mjs';

const DATABASE='vyakti_expert_integration_20260906';
const joinInput=(f,code)=>({public_id:f.pid,expected_disclosure_hash:sha256Hex(store.TEXT_PUBLICATION_DISCLOSURE),is_adult:true,accept_ai_disclosure:true,accept_retention:true,...(code?{access_pass:code}:{})});
const outcome=promise=>promise.then(value=>({value}),error=>({error}));

export async function runTextPublicationAccessPassRace({db,connect,onFixtureManifest,optIn=false,fixtureOps={}}={}){
 assert.equal(optIn,true,'explicit_live_sql_opt_in_required');for(const [name,value] of Object.entries({db,connect,onFixtureManifest}))assert.equal(typeof value,'function',name+'_required');
 const assertFixtureAbsent=fixtureOps.assertAbsent||assertLiveFixtureAbsent,seedFixture=fixtureOps.seed||seedLivePublicationFixture,cleanupFixture=fixtureOps.cleanup||cleanupLivePublicationFixture;
 const f=makeLivePublicationFixture('access-pass-double-redemption'),winnerPassId=randomUUID(),loserPassId=randomUUID();
 const manifest={schema:'text-publication-access-pass-live-race/v1',database:DATABASE,fixture:liveFixtureManifest(f),access_pass_ids:[winnerPassId,loserPassId],issuance_counter_setup:99,plaintext_passes_recorded:false,provider_calls:0,syntheticOnly:true};
 let seedAttempted=false,writer=null,waiter=null,pending=null,failure=null;const blockedWitness={mint:false,redeem:false},observations=[],cleanup=[];
 const query=async(sql,params=[])=>{await db('EXPLAIN '+sql,params);return db(sql,params);};
 const sessionQuery=session=>async(sql,params=[])=>{await session.db('EXPLAIN '+sql,params);return session.db(sql,params);};
 const begin=async session=>{const info=(await session.db('select current_database() name,pg_backend_pid() pid'))[0];assert.equal(info.name,DATABASE);session.pid=Number(info.pid);await session.db('BEGIN');await session.db("set local statement_timeout='10s'");await session.db("set local lock_timeout='7s'");};
 const witness=async stage=>{const start=Date.now();while(Date.now()-start<4500){const rows=await db('select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blocking_pids from pg_stat_activity where pid=any($1::int[]) order by pid',[[writer.pid,waiter.pid]]);observations.push({stage,elapsed_ms:Date.now()-start,states:rows});if(rows.find(row=>Number(row.pid)===waiter.pid)?.blocking_pids?.map(Number).includes(writer.pid)){blockedWitness[stage]=true;return;}await new Promise(resolve=>setTimeout(resolve,25));}assert.fail(stage+'_pg_blocking_pids_witness_required');};
 try{
  await onFixtureManifest(manifest);assert.equal((await db('select current_database() name'))[0]?.name,DATABASE,'exact_development_database_required');
  await assertFixtureAbsent(db,f);seedAttempted=true;await seedFixture(query,f);
  const scope={replica_id:f.rid,sheet_id:f.sheet,context_item_id:f.item,access_mode:'pass'},ready=await store.readTextPublicationReadiness(query,f.owner,scope,{env:f.env});assert.equal(ready.can_publish,true);
  await store.publishTextPublication(query,f.owner,{...scope,publication_id:f.pid,expected_review_hash:ready.selected.review_hash,statement_set:ready.statement_set,attestations:Object.fromEntries(ready.statements.map(s=>[s.id,true]))},{env:f.env});
  await query('update vy_text_publication set access_pass_issued_count=99 where publication_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[f.pid,f.rid,f.owner]);
  writer=await connect();waiter=await connect();await begin(writer);await begin(waiter);
  // The store generates the credential. It remains only in this local variable,
  // outside the manifest, observations and returned receipt.
  const created=await store.createTextPublicationAccessPasses(sessionQuery(writer),f.owner,{replica_id:f.rid,publication_id:f.pid,count:1},{randomUUID:()=>winnerPassId});assert.equal(created.passes.length,1);
  pending=outcome(store.createTextPublicationAccessPasses(sessionQuery(waiter),f.owner,{replica_id:f.rid,publication_id:f.pid,count:1},{randomUUID:()=>loserPassId}));
  await witness('mint');await writer.db('COMMIT');const losingMint=await pending;pending=null;assert.equal(losingMint.error?.code,'text_publication_access_pass_limit_reached');await waiter.db('COMMIT');
  assert.equal(Number((await db('select access_pass_issued_count from vy_text_publication where publication_id=$1::uuid',[f.pid]))[0].access_pass_issued_count),100);
  assert.deepEqual((await db('select pass_id from vy_text_publication_access_pass where publication_id=$1::uuid order by pass_id',[f.pid])).map(row=>row.pass_id),[winnerPassId]);
  const code=created.passes[0].code;assert.match(code,/^[A-Za-z0-9_-]{32}$/);await begin(writer);await begin(waiter);
  const first=await store.joinTextPublication(sessionQuery(writer),f.visitor,joinInput(f,code),{env:f.env});assert(first.session_token);
  pending=outcome(store.joinTextPublication(sessionQuery(waiter),f.other,joinInput(f,code),{env:f.env}));
  await witness('redeem');await writer.db('COMMIT');const second=await pending;pending=null;assert.equal(second.error?.code,'text_publication_access_required');await waiter.db('COMMIT');
  const pass=(await db('select state,visitor_user_id from vy_text_publication_access_pass where pass_id=$1::uuid',[created.passes[0].pass_id]))[0];assert.deepEqual(pass,{state:'claimed',visitor_user_id:f.visitor});
  assert.equal(Number((await db('select count(*) n from vy_text_publication_visitor where publication_id=$1::uuid',[f.pid]))[0].n),1);
 }catch(error){failure={code:error?.code||'UNCLASSIFIED',message:String(error?.message||'failure')};}
 finally{
  if(writer)try{await writer.db('ROLLBACK');}catch{}if(pending)await pending;
  if(waiter)try{await waiter.db('ROLLBACK');}catch{}for(const session of [writer,waiter].filter(Boolean))try{await session.close();}catch{}
  if(seedAttempted)try{cleanup.push(await cleanupFixture(db,f));}catch(error){cleanup.push({error:error?.code||'UNCLASSIFIED'});}
 }
 return{pass:!failure&&blockedWitness.mint&&blockedWitness.redeem&&cleanup.every(row=>!row.error&&row.private_rows_remaining===0),failure,blockedWitness,observations,cleanup,manifest,limitation:'Actual PostgreSQL two-session mint-cap and double-redemption races only when root opts in. Synthetic publication/pass identities; no provider, auth, email, payment, model or cloud call.'};
}
