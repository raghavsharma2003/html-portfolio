// Actual cron handler -> counted llm -> production meter -> guarded Room commit.
// Only DB/HTTP are test doubles; no real SQL parsing.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
const api=new URL('../../api/',import.meta.url);
const hooks=registerHooks({load(url,context,next){
  if(url===new URL('_db.js',api).href) return {format:'module',shortCircuit:true,
    source:'export const q=(...args)=>globalThis.__roomCallerDb(...args);'};
  return next(url,context);
}});
const env={VYAKTI_MODEL_SERVING:'azure_only',CONSOLIDATE_ROOM_DEV:'1',
  AZURE_FOUNDRY_ENDPOINT:'https://fixture.services.ai.azure.com',AZURE_FOUNDRY_API_KEY:'synthetic-key',
  AZURE_FOUNDRY_ROOM_MEMORY_MODEL:'gpt-4.1-mini',
  AZURE_FOUNDRY_ROOM_MEMORY_EXPECTED_RESPONSE_MODEL:'gpt-4.1-mini-2025-04-14',
  AZURE_REPLICA_BUDGET_ID:'room-caller-fixture',AZURE_REPLICA_APP_BUDGET_USD:'1',
  AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS:'0.4',AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS:'1.6',
  CONSOLIDATE_SWEEP_SECRET:'synthetic-offline-sweep-secret',CONSOLIDATE_KILL:'0',
  CONSOLIDATE_SWEEP_MODE:'room_only',CONSOLIDATE_SWEEP_LIVE:'1',CONSOLIDATE_ROOM_PERSON_LIMIT:'1'};
const prior={...process.env},priorFetch=globalThis.fetch;
Object.assign(process.env,env);
const R=await import('../../api/_room-memory-authority.js');
const W=await import('../../api/_room-memory-consolidation.js');
const C=await import('../../api/_room-memory-reclassification.js');
const {strictRoomConsolidationConfig}=await import('../../api/_consolidation-config.js');
const {llm}=await import('../../api/consolidate.js');
const {default:handler}=await import('../../api/consolidate-sweep.js');
const candidate={follower_id:'10000000-0000-4000-8000-000000000001',
  agent_id:'20000000-0000-4000-8000-000000000001',person_id:'30000000-0000-4000-8000-000000000001'};
const row={...candidate,id:'41',memory_epoch:'7',content:'Please explain slowly.'};
const ownerCandidate={replica_id:'50000000-0000-4000-8000-000000000001',
  owner_user_id:'60000000-0000-4000-8000-000000000001',
  agent_id:'70000000-0000-4000-8000-000000000001',person_id:'80000000-0000-4000-8000-000000000001'};
const ownerRow={...ownerCandidate,id:'41',content:'Please explain slowly.'};
const output=JSON.stringify({memories:[{source_id:'41',kind:'relationship',name:'preference',quote:row.content}]});
function fixture(options={}) {
  const s={events:[],consent:true,lease:{run_id:'fixture-run',leased_by:'sweep'},spend:null,writes:0,http:0};
  s.db=async(sql,p=[])=>{
    if(sql===W.ROOM_MEMORY_SWEEP_READINESS_SQL){s.events.push('readiness');return [{schema_ready:options.schemaReady!==false,budget_ready:options.budgetReady!==false}];}
    if(sql.includes("insert into vy_sweep_run")&&sql.includes('returning run_id')){s.events.push('heartbeat-start');return[{run_id:p[0],outcome:'running'}];}
    if(sql.includes('update vy_sweep_run')&&sql.includes('returning run_id')){s.events.push('heartbeat-finish');return[{run_id:p[0],outcome:p[1],finished_at:new Date().toISOString()}];}
    if(sql.includes('delete from vy_sweep_run')){s.events.push('heartbeat-prune');return[];}
    if(sql===R.ROOM_MEMORY_BATCH_SQL){s.events.push('batch');return s.consent?[{...row,follower_id:p[0],agent_id:p[1],person_id:p[2]}]:[];}
    if(sql===R.ROOM_MEMORY_COMMIT_SQL){s.events.push('commit');if(!s.consent)return[];s.writes++;return[{facts_written:1,observations_written:1}];}
    if(sql===R.OWNER_MEMORY_BATCH_SQL){s.events.push('owner-batch');return s.consent?[{...ownerRow,replica_id:p[0]}]:[];}
    if(sql===R.OWNER_MEMORY_COMMIT_SQL){s.events.push('owner-commit');if(!s.consent)return[];s.writes++;return[{facts_written:1,observations_written:0}];}
    if(sql===R.ROOM_MEMORY_DISCOVERY_SQL){s.events.push('room-discovery');return Array.from({length:options.discoveryCount||1},(_,i)=>
      ({...candidate,person_id:`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,pending_rows:1,
        oldest_pending_at:`2026-09-0${8+i}T00:00:00Z`}));}
    if(sql===R.OWNER_MEMORY_DISCOVERY_SQL){
      if(!options.ownerCandidate)return[];
      s.events.push('owner-discovery');return[{...ownerCandidate,pending_rows:1,oldest_pending_at:'2026-09-01T00:00:00Z'}];
    }
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
    if(sql.includes('create table if not exists meera_consolidate_lease')){s.events.push('runtime-ddl');return[];}
    if(sql.includes('coalesce(pd.person_id')&&sql.includes('from meera_log l')){s.events.push('legacy-discovery');return[];}
    if(sql.includes('vy_sweep_run'))return[];
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
      choices:[{finish_reason:options.incomplete?'length':'stop',message:{content:options.badOutput?'invalid':options.outputOverride??output}}]}));
  };
  s.run=()=>W.runMeteredRoomMemoryConsolidation(candidate,{queryFn:s.db,llm,runId:'fixture-run',env,fetchImpl:s.fetch});
  s.runOwner=(customEnv=env)=>W.runMeteredOwnerMemoryConsolidation(ownerCandidate,
    {queryFn:s.db,llm,runId:'fixture-run',env:customEnv,fetchImpl:s.fetch});
  s.sweep=async()=>{
    globalThis.__roomCallerDb=s.db;globalThis.fetch=s.fetch;
    let payload,status;
    const res={status(code){status=code;return this;},json(value){payload=value;return this;},end(){return this;}};
    await handler({method:'POST',headers:{'x-sweep-secret':env.CONSOLIDATE_SWEEP_SECRET},body:{dryRun:false,limit:3},socket:{remoteAddress:'127.0.0.1'}},res);
    return{status,payload};
  };
  return s;
}
const reclassificationCandidate={...candidate,memory_epoch:'7'};
const reclassificationSnapshot={...candidate,memory_epoch:'7',fact_id:'51',fact_body:row.content,
  fact_name:'preference',episode_id:'61',source_id:row.id,source_content:row.content,
  fact_communication:{version:1,state:'unclassified',scope:{language:true,script:false,brevity:true},
    language:null,script:null,brevity:null}};
function reclassificationFixture(options={}){
  const s=fixture(options);s.lease=null;s.reclassificationReads=0;s.reclassificationWrites=0;
  const readSnapshot=async()=>{
    s.events.push('reclassification-read');s.reclassificationReads++;
    if(options.noJob)return[];
    if(options.metadataDriftAt===s.reclassificationReads)return[{...reclassificationSnapshot,
      fact_communication:{...reclassificationSnapshot.fact_communication,
        scope:{...reclassificationSnapshot.fact_communication.scope,script:true}}}];
    if(options.driftAt===s.reclassificationReads)return[{...reclassificationSnapshot,
      fact_body:`${row.content} changed`,source_content:`${row.content} changed`}];
    return[{...reclassificationSnapshot}];
  };
  const prepareRequest=snapshot=>({messages:[
    {role:'system',content:'fixture closed communication classifier'},
    {role:'user',content:JSON.stringify([{id:snapshot.source_id,content:snapshot.source_content}])},
  ],responseFormat:R.ROOM_MEMORY_RESPONSE_FORMAT,maxTokens:R.ROOM_MEMORY_MAX_OUTPUT_TOKENS});
  const validateProposal=(raw,snapshot)=>{
    assert.equal(snapshot.fact_id,reclassificationSnapshot.fact_id);
    return JSON.parse(raw).memories;
  };
  const commitProposal=async(proposal,snapshot)=>{
    s.events.push('reclassification-cas');s.reclassificationWrites++;
    assert.equal(snapshot.fact_name,'preference');assert.equal(snapshot.fact_communication.state,'unclassified');assert.equal(proposal.length,1);
    return{classification:'classified',facts_written:1};
  };
  const queryFn=async(sql,params)=>{
    if(sql.includes('insert into vy_provider_spend'))s.reclassificationProviderVersion=params[5];
    return s.db(sql,params);
  };
  s.reclassify=()=>W.runMeteredRoomMemoryReclassification(reclassificationCandidate,
    {queryFn,llm,runId:'reclassification-run',env,fetchImpl:s.fetch,
      readSnapshot,prepareRequest,validateProposal,commitProposal});
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
    assert.equal(W.roomMemorySweepEnabled({...env,CONSOLIDATE_SWEEP_MODE:'legacy'}),false);
    assert.equal(W.roomMemoryPersonLimit({...env,CONSOLIDATE_ROOM_PERSON_LIMIT:'1'}),1);
    assert.throws(()=>W.roomMemoryPersonLimit({...env,CONSOLIDATE_ROOM_PERSON_LIMIT:'11'}),/person_limit_invalid/);
    const config=strictRoomConsolidationConfig(env);
    assert.equal(config.url,'https://fixture.services.ai.azure.com/openai/v1/chat/completions');
    assert.equal(config.requestUrl,config.url);assert.equal(new URL(config.requestUrl).search,'');
  });
  await check('Room-only cron checks readiness and dispatches exact production meter order',async()=>{
    const s=fixture();const r=await s.sweep();assert.equal(r.status,200);assert.equal(r.payload.errored,0);
    assert.equal(s.http,1);assert.equal(s.writes,1);assert.equal(s.spend.actual_microusd,285);assert.equal(s.lease,null);
    assert.deepEqual(s.events.filter(x=>['heartbeat-start','readiness','room-discovery','admit','reserve','begin','http','settle','commit','release-lease','heartbeat-finish'].includes(x)),
      ['heartbeat-start','readiness','room-discovery','admit','reserve','begin','http','settle','commit','release-lease','heartbeat-finish']);
    assert(!s.events.includes('legacy-discovery'));assert(!s.events.includes('runtime-ddl'));
    assert.equal(r.payload.spend.llm_calls,1);assert.equal(r.payload.spend.tokens_in,208);assert.equal(r.payload.spend.tokens_out,126);
  });
  await check('Room-only readiness failure writes no lease and dispatches no provider',async()=>{
    const s=fixture({budgetReady:false}),r=await s.sweep();assert.equal(r.status,503);
    assert.equal(r.payload.error,'room_memory_budget_unavailable');assert.equal(s.http,0);assert.equal(s.writes,0);
    assert.deepEqual(s.events,['heartbeat-start','readiness','heartbeat-finish','heartbeat-prune']);
  });
  await check('Room-only sweep dispatches an owner candidate through the shared metered wrapper',async()=>{
    const s=fixture({ownerCandidate:true,discoveryCount:0});
    // `discoveryCount:0` needs an explicit empty Room result in this fixture.
    const original=s.db;
    s.db=async(sql,p)=>sql===R.ROOM_MEMORY_DISCOVERY_SQL?[]:original(sql,p);
    const r=await s.sweep();
    assert.equal(r.status,200);assert.equal(r.payload.errored,0);assert.equal(r.payload.results[0].lane,'owner');
    assert.equal(s.http,1);assert.equal(s.writes,1);assert.equal(s.spend.state,'settled');assert.equal(s.lease,null);
    assert(s.events.includes('owner-discovery'));assert(s.events.includes('owner-batch'));assert(s.events.includes('owner-commit'));
    assert(!s.events.includes('batch'));assert(!s.events.includes('commit'));
  });
  await check('owner memory refuses unavailable provider configuration before private source reads',async()=>{
    const s=fixture();
    const unavailable={...env};delete unavailable.AZURE_FOUNDRY_API_KEY;
    await assert.rejects(s.runOwner(unavailable),/room_memory_foundry_binding_required/);
    assert.equal(s.http,0);assert.equal(s.writes,0);assert(!s.events.includes('owner-batch'));
  });
  await check('owner memory budget denial restores the exact lease without a provider call or fact',async()=>{
    const s=fixture({reserveDenied:true});
    await assert.rejects(s.runOwner(),/provider_budget_reservation_denied/);
    assert.equal(s.http,0);assert.equal(s.writes,0);assert.equal(s.spend,null);assert.equal(s.lease.leased_by,'sweep');
  });
  await check('first-preview Room cap remains one even when caller asks for three',async()=>{
    const s=fixture({discoveryCount:2}),r=await s.sweep();assert.equal(r.status,200);
    assert.equal(r.payload.candidates_seen,2);assert.equal(r.payload.processed,1);assert.equal(s.http,1);
    assert.equal(r.payload.results.length,1);assert.equal(r.payload.results[0].agent,candidate.agent_id);
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
  await check('corrected-fact reclassification uses one metered call and exact source checks around it',async()=>{
    const s=reclassificationFixture(),result=await s.reclassify();
    assert.deepEqual(result,{classification:'classified',facts_written:1});
    assert.equal(s.reclassificationReads,3);assert.equal(s.reclassificationWrites,1);
    assert.equal(s.http,1);assert.equal(s.spend.state,'settled');assert.equal(s.lease,null);
    assert.equal(s.reclassificationProviderVersion,
      `${env.AZURE_FOUNDRY_ROOM_MEMORY_EXPECTED_RESPONSE_MODEL}:room-memory/reclassification-v1`);
    assert.deepEqual(s.events.filter(event=>['reclassification-read','claim','admit','reserve','begin','http','settle','reclassification-cas','release-lease'].includes(event)),
      ['reclassification-read','claim','admit','reserve','reclassification-read','begin','http','settle','reclassification-read','reclassification-cas','release-lease']);
  });
  await check('no eligible corrected fact returns honest unclassified state without lease or spend',async()=>{
    const s=reclassificationFixture({noJob:true}),result=await s.reclassify();
    assert.deepEqual(result,{classification:'unclassified',skipped:'no_job'});
    assert.deepEqual(s.events,['reclassification-read']);assert.equal(s.http,0);assert.equal(s.spend,null);
  });
  await check('corrected metadata drift before begin releases reservation and skips provider and CAS',async()=>{
    const s=reclassificationFixture({metadataDriftAt:2});await assert.rejects(s.reclassify(),/authority_changed/);
    assert.equal(s.http,0);assert.equal(s.spend.state,'released');assert.equal(s.reclassificationWrites,0);assert.equal(s.lease,null);
  });
  await check('corrected source drift before CAS preserves settled usage and skips CAS',async()=>{
    const s=reclassificationFixture({driftAt:3});await assert.rejects(s.reclassify(),/authority_changed/);
    assert.equal(s.http,1);assert.equal(s.spend.state,'settled');assert.equal(s.reclassificationWrites,0);assert.equal(s.lease,null);
  });
  await check('ambiguous corrected-fact begin retains admission and never dispatches',async()=>{
    const s=reclassificationFixture({beginUnknown:true});await assert.rejects(s.reclassify(),/begin_ack_lost/);
    assert.equal(s.http,0);assert.equal(s.reclassificationWrites,0);assert.equal(s.spend.state,'in_flight');
    assert.match(s.lease.leased_by,/^room-memory:room-caller-fixture:[a-f0-9]{64}$/);
  });
  await check('Room lease SQL binds exact meter scope and leaves legacy lease statements intact',()=>{
    for(const sql of [W.ROOM_MEMORY_CLAIM_SQL,W.ROOM_MEMORY_RELEASE_SQL]){
      assert.match(sql,/s\.operation='claim_extraction'/);assert.match(sql,/s\.provider_family='consolidation'/);
      assert.match(sql,/s\.provider_name='azure-foundry-room-memory'/);assert.match(sql,/s\.budget_id \|\| ':' \|\| s\.request_hash/);
      assert.match(sql,/s\.state in \('settled','released'\)/);
    }
    const sweep=readFileSync(new URL('consolidate-sweep.js',api),'utf8');
    assert.match(sweep,/roomOnly \? ROOM_MEMORY_CLAIM_SQL/);
    assert.match(sweep,/roomOnly \? ROOM_MEMORY_RELEASE_SQL/);
    assert.match(sweep,/if\(roomOnly\) await assertRoomMemorySweepReady\(q\);/);
    assert.match(sweep,/else await ensureSchema\(\);/);
    assert.match(sweep,/if \(roomOnly\)[\s\S]*?runMeteredRoomMemoryConsolidation\(c,[\s\S]*?continue;/);
  });
  await check('actual correction service reclassifies one fact through meter and exact ten-parameter CAS without duplicate logs',async()=>{
    const quote='आगे से मुझे हिंदी में छोटे जवाब दिया करें।';
    const s=fixture({outputOverride:JSON.stringify({memories:[{source_id:'41',kind:'user',name:'preference',quote,
      communication:{language:'hindi',script:null,brevity:'short'}}]})});
    s.lease=null;
    const snapshot={...reclassificationSnapshot,fact_body:quote,source_content:quote};
    let current=structuredClone(snapshot),cas=0;
    const query=async(sql,p)=>{
      if(sql===R.ROOM_MEMORY_RECLASSIFY_READ_SQL){assert.deepEqual(p,[candidate.follower_id,'7',candidate.agent_id,candidate.person_id,'51']);return current.fact_communication.state==='unclassified'?[structuredClone(current)]:[];}
      if(sql===R.ROOM_MEMORY_RECLASSIFY_COMMIT_SQL){
        cas++;assert.equal(p.length,10);assert.deepEqual(p.slice(4,6),['51',quote]);
        assert.deepEqual(JSON.parse(p[6]),snapshot.fact_communication);assert.deepEqual(p.slice(7,9),['61','41']);
        current.fact_communication=JSON.parse(p[9]);
        return[{fact_id:'51',body:quote,communication:current.fact_communication}];
      }
      return s.db(sql,p);
    };
    const result=await C.reclassifyRoomMemory(query,reclassificationCandidate,'51',{env,llm,fetchImpl:s.fetch,runId:'actual-correction'});
    assert.equal(result.classification,'classified');assert.deepEqual(result.fact,{id:'51',body:quote});
    assert.equal(cas,1);assert.equal(s.http,1);assert.equal(s.spend.state,'settled');
    assert.equal(current.fact_communication.language,'hindi');assert.equal(current.fact_communication.brevity,'short');
    const repeated=await C.reclassifyRoomMemory(query,reclassificationCandidate,'51',{env,llm,fetchImpl:s.fetch,runId:'repeated-correction'});
    assert.equal(repeated.skipped,'no_job');assert.equal(s.http,1);assert.equal(cas,1);
    assert(!R.ROOM_MEMORY_RECLASSIFY_COMMIT_SQL.includes('insert into'));
    for(const token of ['v.body=$6::text','v.communication=$7::jsonb','e.id=$8::bigint','l.id=$9::bigint',"v.communication->>'state'='unclassified'",'v.superseded_by is null'])assert(R.ROOM_MEMORY_RECLASSIFY_COMMIT_SQL.includes(token),token);
  });
  await check('corrected projection clears removed dimensions and refuses fabricated sources before CAS',()=>{
    const empty=C.correctedCommunication({memories:[]},reclassificationSnapshot);
    assert.equal(empty.state,'no_preference');assert.deepEqual(empty.scope,reclassificationSnapshot.fact_communication.scope);
    assert.equal(empty.language,null);assert.equal(empty.brevity,null);
    const changed=C.correctedCommunication({memories:[{source_id:'41',kind:'user',name:'preference',quote:row.content,
      communication:{language:'english',script:null,brevity:null}}]},reclassificationSnapshot);
    assert.equal(changed.state,'classified');assert.equal(changed.language,'english');assert.equal(changed.brevity,null);
    assert.equal(changed.scope.brevity,true,'removed original brevity blocks older fallback');
    assert.throws(()=>C.correctedCommunication({memories:[{source_id:'other',kind:'user',name:'preference',quote:row.content,
      communication:{language:'english',script:null,brevity:null}}]},reclassificationSnapshot),/proposal_invalid/);
  });
  console.log(`Room consolidation caller: ${checks} controls passed (offline DB/HTTP doubles; SQL unparsed)`);
} finally {
  globalThis.fetch=priorFetch;delete globalThis.__roomCallerDb;
  for(const name of Object.keys(process.env))if(!(name in prior))delete process.env[name];
  Object.assign(process.env,prior);hooks.deregister();
}
