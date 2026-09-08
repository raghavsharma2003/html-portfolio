// Actual cron handler -> counted llm -> production meter -> guarded Room commit.
// Only DB/HTTP and the source enable flag are test doubles; no real SQL parsing.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
const api=new URL('../../api/',import.meta.url);
const roomUrl=new URL('_room-memory-authority.js',api).href;
const originalRoom=readFileSync(new URL(roomUrl),'utf8');
assert.match(originalRoom,/ROOM_MEMORY_CONSOLIDATION_ENABLED\s*=\s*false/);
const hooks=registerHooks({load(url,context,next){
  if(url===new URL('_db.js',api).href) return {format:'module',shortCircuit:true,
    source:'export const q=(...args)=>globalThis.__roomCallerDb(...args);'};
  if(url===roomUrl) return {format:'module',shortCircuit:true,
    source:originalRoom.replace(/ROOM_MEMORY_CONSOLIDATION_ENABLED\s*=\s*false/,'ROOM_MEMORY_CONSOLIDATION_ENABLED=true')};
  return next(url,context);
}});
const env={VYAKTI_MODEL_SERVING:'azure_only',CONSOLIDATE_ROOM_DEV:'1',
  AZURE_FOUNDRY_ENDPOINT:'https://fixture.services.ai.azure.com',AZURE_FOUNDRY_API_KEY:'synthetic-key',
  AZURE_FOUNDRY_ROOM_MEMORY_MODEL:'gpt-4.1-mini',
  AZURE_FOUNDRY_ROOM_MEMORY_EXPECTED_RESPONSE_MODEL:'gpt-4.1-mini-2025-04-14',
  AZURE_REPLICA_BUDGET_ID:'room-caller-fixture',AZURE_REPLICA_APP_BUDGET_USD:'1',
  AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS:'0.4',AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS:'1.6',
  CONSOLIDATE_SWEEP_SECRET:'synthetic-offline-sweep-secret',CONSOLIDATE_KILL:'0'};
const prior={...process.env},priorFetch=globalThis.fetch;
Object.assign(process.env,env);
const R=await import('../../api/_room-memory-authority.js');
const W=await import('../../api/_room-memory-consolidation.js');
const {strictRoomConsolidationConfig}=await import('../../api/_consolidation-config.js');
const {llm}=await import('../../api/consolidate.js');
const {default:handler}=await import('../../api/consolidate-sweep.js');
const candidate={follower_id:'10000000-0000-4000-8000-000000000001',
  agent_id:'20000000-0000-4000-8000-000000000001',person_id:'30000000-0000-4000-8000-000000000001'};
const row={...candidate,id:'41',memory_epoch:'7',content:'Please explain slowly.'};
const output=JSON.stringify({memories:[{source_id:'41',kind:'relationship',name:'preference',quote:row.content}]});
function fixture(options={}) {
  const s={events:[],consent:true,lease:{run_id:'fixture-run',leased_by:'sweep'},spend:null,writes:0,http:0};
  s.db=async(sql,p=[])=>{
    if(sql===R.ROOM_MEMORY_BATCH_SQL){s.events.push('batch');return s.consent?[{...row}]:[];}
    if(sql===R.ROOM_MEMORY_COMMIT_SQL){s.events.push('commit');if(!s.consent)return[];s.writes++;return[{facts_written:1,observations_written:1}];}
    if(sql===R.ROOM_MEMORY_DISCOVERY_SQL)return[{...candidate,pending_rows:1,oldest_pending_at:'2026-09-08T00:00:00Z'}];
    if(sql===W.ROOM_MEMORY_CLAIM_SQL){
      s.events.push('claim');
      if(s.lease?.leased_by.startsWith('room-memory:')&&!['settled','released'].includes(s.spend?.state))return[];
      s.lease={run_id:p[2],leased_by:'sweep'};return[{person_id:p[1]}];
    }
    if(sql===W.ROOM_MEMORY_RELEASE_SQL){
      s.events.push('release-lease');
      if(s.lease?.leased_by.startsWith('room-memory:')&&!['settled','released'].includes(s.spend?.state))return[];
      s.lease=null;return[{person_id:p[1]}];
    }
    if(sql===W.ROOM_MEMORY_ADMIT_SQL){s.events.push('admit');if(options.leaseLost)return[];
      assert.equal(s.lease.run_id,p[2]);s.lease.leased_by=p[3];return[{person_id:p[1]}];}
    if(sql===W.ROOM_MEMORY_CANCEL_ADMISSION_SQL){s.events.push('cancel-admission');
      assert.equal(s.lease.leased_by,p[3]);assert.equal(s.spend,null);s.lease.leased_by='sweep';return[{person_id:p[1]}];}
    if(sql.includes('insert into vy_provider_budget')){s.events.push('budget');return[];}
    if(sql.includes('insert into vy_provider_spend')){
      s.events.push('reserve');assert.equal(s.lease.leased_by,`room-memory:${p[0]}:${p[7]}`);
      if(options.reserveDenied)return[];
      if(!s.spend||s.spend.request_hash!==p[7])s.spend={reservation_id:'40000000-0000-4000-8000-000000000001',budget_id:p[0],request_hash:p[7],reserved_microusd:p[10],state:'reserved'};
      if(options.reserveUnknown)throw new Error('synthetic_reserve_ack_lost');
      if(options.withdrawBeforeBegin)s.consent=false;
      return[{...s.spend}];
    }
    if(sql.includes("set state='in_flight'")){s.events.push('begin');s.spend.state='in_flight';
      if(options.beginUnknown)throw new Error('synthetic_begin_ack_lost');return[{reservation_id:s.spend.reservation_id,state:s.spend.state}];}
    if(sql.includes('with settled as')){s.events.push('settle');assert.deepEqual(p.slice(3,5),[208,126]);
      assert.equal(p[5],285);if(options.settleUnknown)throw new Error('synthetic_settle_ack_lost');
      s.spend.state='settled';s.spend.actual_microusd=p[5];return[{spent_microusd:p[5],reserved_microusd:0}];}
    if(sql.includes('with released as')){s.events.push('release-spend');if(options.releaseUnknown)throw new Error('synthetic_release_ack_lost');
      s.spend.state='released';return[{reserved_microusd:0}];}
    if(sql.includes("set state='reconcile_required'")){s.events.push('uncertain');s.spend.state='reconcile_required';return[];}
    if(sql.includes('vy_sweep_run')||sql.includes('create table if not exists meera_consolidate_lease'))return[];
    // Incumbent Meera/legacy backlog reads are empty in this authored fixture.
    if(sql.includes('meera_log'))return[];
    throw new Error(`Unexpected offline SQL: ${sql.slice(0,70)}`);
  };
  s.fetch=async(url,init)=>{
    s.events.push('http');s.http++;assert.equal(s.spend.state,'in_flight');
    assert.equal(url,'https://fixture.services.ai.azure.com/openai/v1/chat/completions');
    const body=JSON.parse(init.body);assert.equal(body.model,env.AZURE_FOUNDRY_ROOM_MEMORY_MODEL);
    assert.deepEqual(body.response_format,R.ROOM_MEMORY_RESPONSE_FORMAT);assert.equal(body.max_tokens,1600);
    assert.equal(init.redirect,'error');
    if(options.withdrawDuringAwait)await Promise.resolve().then(()=>{s.consent=false;});
    if(options.networkUnknown)throw new Error('synthetic_network_unknown');
    return new Response(JSON.stringify({model:options.wrongModel?'unexpected-model':env.AZURE_FOUNDRY_ROOM_MEMORY_EXPECTED_RESPONSE_MODEL,
      usage:options.usageUnknown?null:{prompt_tokens:208,completion_tokens:126},
      choices:[{finish_reason:options.incomplete?'length':'stop',message:{content:options.badOutput?'invalid':output}}]}));
  };
  s.run=()=>W.runMeteredRoomMemoryConsolidation(candidate,{queryFn:s.db,llm,runId:'fixture-run',env,fetchImpl:s.fetch});
  s.sweep=async()=>{
    globalThis.__roomCallerDb=s.db;globalThis.fetch=s.fetch;
    let payload,status;
    const res={status(code){status=code;return this;},json(value){payload=value;return this;},end(){return this;}};
    await handler({method:'POST',headers:{'x-sweep-secret':env.CONSOLIDATE_SWEEP_SECRET},body:{dryRun:false,limit:3},socket:{remoteAddress:'127.0.0.1'}},res);
    return{status,payload};
  };
  return s;
}
let checks=0;
async function check(name,fn){await fn();checks++;console.log(`ok ${name}`);}
try {
  await check('dev opt-in and explicit Azure model/revision required before reads',async()=>{
    for(const name of ['CONSOLIDATE_ROOM_DEV','AZURE_FOUNDRY_ROOM_MEMORY_MODEL','AZURE_FOUNDRY_ROOM_MEMORY_EXPECTED_RESPONSE_MODEL','AZURE_FOUNDRY_API_KEY','AZURE_REPLICA_BUDGET_ID']){
      const custom={...env};delete custom[name];assert.throws(()=>strictRoomConsolidationConfig(custom));
    }
    assert.throws(()=>strictRoomConsolidationConfig({...env,AZURE_FOUNDRY_ENDPOINT:'https://example.com'}));
    assert.throws(()=>strictRoomConsolidationConfig({...env,VYAKTI_MODEL_SERVING:'other'}));
    assert.equal(W.roomMemorySweepEnabled({}),false);
    const config=strictRoomConsolidationConfig(env);
    assert.equal(config.url,'https://fixture.services.ai.azure.com/openai/v1/chat/completions');
    assert.equal(config.requestUrl,config.url);assert.equal(new URL(config.requestUrl).search,'');
  });
  await check('actual incumbent cron dispatches strict schema with exact production meter order',async()=>{
    const s=fixture();const r=await s.sweep();assert.equal(r.status,200);assert.equal(r.payload.errored,0);
    assert.equal(s.http,1);assert.equal(s.writes,1);assert.equal(s.spend.actual_microusd,285);assert.equal(s.lease,null);
    assert.deepEqual(s.events.filter(x=>['admit','reserve','begin','http','settle','commit','release-lease'].includes(x)),
      ['admit','reserve','begin','http','settle','commit','release-lease']);
    assert.equal(r.payload.spend.llm_calls,1);assert.equal(r.payload.spend.tokens_in,208);assert.equal(r.payload.spend.tokens_out,126);
  });
  await check('forget during actual caller model await settles usage and writes zero memories',async()=>{
    const s=fixture({withdrawDuringAwait:true}),r=await s.sweep();
    assert.equal(r.payload.results[0].skipped,'memory_authority_changed');assert.equal(s.writes,0);
    assert.equal(s.spend.state,'settled');assert.equal(s.lease,null);
  });
  await check('withdraw before begin releases reservation without HTTP',async()=>{
    const s=fixture({withdrawBeforeBegin:true});await assert.rejects(s.run,/room_memory_authority_changed/);
    assert.equal(s.http,0);assert.equal(s.spend.state,'released');assert(!s.events.includes('begin'));
  });
  for(const [flag,error] of [['reserveUnknown','reserve_ack_lost'],['beginUnknown','begin_ack_lost'],['releaseUnknown','release_ack_lost']])
    await check(`${flag} retains exact Room admission for reconciliation`,async()=>{
      const s=fixture({[flag]:true,withdrawBeforeBegin:flag==='releaseUnknown'});await assert.rejects(s.run,new RegExp(error));
      assert.equal(s.http,0);assert.match(s.lease.leased_by,/^room-memory:room-caller-fixture:[a-f0-9]{64}$/);
      assert.deepEqual(await s.db(W.ROOM_MEMORY_RELEASE_SQL,[]),[]);assert.deepEqual(await s.db(W.ROOM_MEMORY_CLAIM_SQL,[]),[]);
    });
  for(const [flag,error] of [['wrongModel','response_model_mismatch'],['incomplete','response_incomplete'],['badOutput','JSON']])
    await check(`${flag} settles known usage and refuses memory`,async()=>{
      const s=fixture({[flag]:true});await assert.rejects(s.run,new RegExp(error));assert.equal(s.spend.state,'settled');assert.equal(s.writes,0);
    });
  for(const flag of ['networkUnknown','usageUnknown','settleUnknown'])
    await check(`${flag} holds reconciliation without memory`,async()=>{
      const s=fixture({[flag]:true});await assert.rejects(s.run);assert.equal(s.spend.state,'reconcile_required');assert.equal(s.writes,0);
    });
  await check('settled same-run exact source/model request is never dispatched twice',async()=>{
    const s=fixture();await s.run();s.lease.leased_by='sweep';await assert.rejects(s.run,/already_settled/);assert.equal(s.http,1);
  });
  await check('confirmed before-call release permits a later claimed sweep after temporary pause',async()=>{
    const options={withdrawBeforeBegin:true},s=fixture(options);
    await assert.rejects(s.run,/room_memory_authority_changed/);const oldHash=s.spend.request_hash;
    assert.equal(s.spend.state,'released');assert.equal(s.http,0);
    await s.db(W.ROOM_MEMORY_RELEASE_SQL,[]);options.withdrawBeforeBegin=false;s.consent=true;
    await s.db(W.ROOM_MEMORY_CLAIM_SQL,[candidate.agent_id,candidate.person_id,'next-run']);
    await W.runMeteredRoomMemoryConsolidation(candidate,{queryFn:s.db,llm,runId:'next-run',env,fetchImpl:s.fetch});
    assert.notEqual(s.spend.request_hash,oldHash);assert.equal(s.http,1);assert.equal(s.writes,1);
  });
  await check('lost sweep lease refuses admission before reserving or calling',async()=>{
    const s=fixture({leaseLost:true});await assert.rejects(s.run,/lease_changed/);assert.equal(s.spend,null);assert.equal(s.http,0);
  });
  await check('acknowledged budget denial cancels exact empty admission without trapping Room',async()=>{
    const s=fixture({reserveDenied:true});await assert.rejects(s.run,/provider_budget_reservation_denied/);
    assert.equal(s.spend,null);assert.equal(s.http,0);assert.equal(s.lease.leased_by,'sweep');
    assert.equal((await s.db(W.ROOM_MEMORY_RELEASE_SQL,[])).length,1);assert.equal(s.lease,null);
  });
  await check('Room lease SQL binds exact meter scope and leaves legacy lease statements intact',()=>{
    for(const sql of [W.ROOM_MEMORY_CLAIM_SQL,W.ROOM_MEMORY_RELEASE_SQL]){
      assert.match(sql,/s\.operation='claim_extraction'/);assert.match(sql,/s\.provider_family='consolidation'/);
      assert.match(sql,/s\.provider_name='azure-foundry-room-memory'/);assert.match(sql,/s\.budget_id \|\| ':' \|\| s\.request_hash/);
      assert.match(sql,/s\.state in \('settled','released'\)/);
    }
    const sweep=readFileSync(new URL('consolidate-sweep.js',api),'utf8');
    assert.match(sweep,/agentId !== MEERA_AGENT_ID \? ROOM_MEMORY_CLAIM_SQL/);
    assert.match(sweep,/agentId !== MEERA_AGENT_ID \? ROOM_MEMORY_RELEASE_SQL/);
  });
  console.log(`Room consolidation caller: ${checks} controls passed (offline DB/HTTP doubles; SQL unparsed)`);
} finally {
  globalThis.fetch=priorFetch;delete globalThis.__roomCallerDb;
  for(const name of Object.keys(process.env))if(!(name in prior))delete process.env[name];
  Object.assign(process.env,prior);hooks.deregister();
}
