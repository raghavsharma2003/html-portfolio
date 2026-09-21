// Actual Room, generated compiler, shared gate and SELECT-only reader.
// Fixtures establish control flow only; SQL parser/ownership proof is separate.
import assert from 'node:assert/strict';
import {communicationFromProposal} from '../api/_learner-communication-contract.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFixtureAgent, freshState, fakeDb, fakeMemory, SLUG, ROOM_ID, REPLICA_ID,
  AGENT_ID, OWNER, USER_A, USER_B, PERSON_A, PERSON_B } from './room/fixtures.mjs';
import { roomExpertTextProfile, assertExpertConversation } from '../api/_room-expert-profile.js';
import { ROOM_EXPERT_TEACHER_SQL, readRoomExpertTeacher } from '../api/_room-expert-teacher.js';
import { PUBLIC_ROOM_KNOWLEDGE_SQL } from '../api/_room-knowledge.js';
import { proveRoomExpertTeacherDevelopment } from './room-expert-teacher-development.mjs';

globalThis.fetch = async () => { throw new Error('network_forbidden_in_room_expert_eval'); };
process.env.ROOM_SESSION_SECRET = 'room-expert-synthetic-session-'.repeat(3);
const { roomSay, joinRoom, roomCorrectRememberedThing, roomReclassifyRememberedThing, ROOM_RECALL_TURNS, ROOM_HISTORY_TURNS } = await import('../api/_room-surface.js');
const {ROOM_MEMORY_CORRECT_SQL}=await import('../api/_room-memory-authority.js');
const { dmRecall } = await import('../api/_room.js');
const { dmHistory } = await import('../api/_surface.js');
const fixture = await loadFixtureAgent(fileURLToPath(new URL('../',import.meta.url)));
const engine = fixture.engine;
const CONSENT='e0000000-0000-4000-8000-000000000001', SHEET_ID='e0000000-0000-4000-8000-000000000002';
const FACT_ID='e0000000-0000-4000-8000-000000000003';
const SOURCE='e0000000-0000-4000-8000-000000000004';
const scope={roomId:ROOM_ID,replicaId:REPLICA_ID,ownerUserId:OWNER,agentId:AGENT_ID};
const raw='first step\nsecond step\nthird step\nfourth step\nfinal LARCH-72 label';
let checks=0;
async function check(name,run){await run();console.log(`ok ${++checks} - ${name}`);}
async function setup({profile='lean_v1',remembers=false}={}) {
  const sheet={...fixture.SHEET,consentArtifactId:CONSENT};
  const qa={id:SOURCE,room_id:ROOM_ID,question:'Which exercise label?',answer:'LARCH-72 requires review.',position:1,removed_at:null};
  const state=freshState({publishedQA:[qa]}), underlying=fakeDb(state),memlog=[];
  const row={room_id:ROOM_ID,replica_id:REPLICA_ID,owner_user_id:OWNER,agent_id:AGENT_ID,
    room_published_at:'2026-09-01T00:00:00Z',paused_at:null,lifecycle:'active',slug:SLUG,
    sheet_id:SHEET_ID,version:sheet.version,sheet,status:'published',consent_artifact_id:CONSENT,
    published_at:'2026-09-01T00:00:00Z',sheet_replica_id:REPLICA_ID,sheet_owner_user_id:OWNER};
  const world={row,teacherReads:0,modelCalls:0,state,memlog,qa};
  const db=async(sql,params)=>{
    if(sql===ROOM_EXPERT_TEACHER_SQL){
      underlying.calls.push(sql);world.teacherReads++;
      assert.deepEqual(params,[ROOM_ID,REPLICA_ID,OWNER,AGENT_ID]);
      return world.row ? [world.row] : [];
    }
    return underlying(sql,params);
  };
  db.calls=underlying.calls;
  const env={ROOM_SESSION_SECRET:process.env.ROOM_SESSION_SECRET};
  if(profile!==undefined) env.ROOM_EXPERT_TEXT_PROFILE=profile;
  const memory=fakeMemory(memlog);
  memory.historyStrict=memory.history;
  memory.recallStrict=memory.recall;
  const deps={env,engine,loadAgent:async()=>({module:engine.sheetToModule(sheet),sheet,row:{}}),
    memory,neverRules:[],tableApplied:async()=>false,reply:async(compiled,turns)=>{
      world.modelCalls++;world.compiled=compiled;world.turns=turns;return raw;
    }};
  const joined=await joinRoom(db,{slug:SLUG,authUserId:USER_A,ageAttested:true,memoryConsent:remembers},deps);
  Object.assign(world,{db,env,deps,joined});
  world.say=(args={},patch={})=>roomSay(db,{session:joined.session,message:'Explain the labels.',transcript:[],...args},{...deps,...patch});
  return world;
}

await check('single exact server flag selects coherent profile; absent and conflicting values fail safely',()=>{
  assert.equal(roomExpertTextProfile({}),undefined);
  assert.equal(roomExpertTextProfile({ROOM_EXPERT_TEXT_PROFILE:'lean_v1'}),'lean_v1');
  assert.equal(roomExpertTextProfile({ROOM_EXPERT_TEXT_PROFILE:'lean_v2'}),'lean_v2');
  for(const value of ['',null,false,'lean','lean_v1 ']) assert.throws(()=>roomExpertTextProfile({ROOM_EXPERT_TEXT_PROFILE:value}),{code:'room_expert_text_profile_invalid'});
  for(const patch of [{ROOM_REPLY_LANGUAGE_POLICY:'other'},{ROOM_REPLY_TEXT_PROFILE:'other'}]) assert.throws(()=>roomExpertTextProfile({ROOM_EXPERT_TEXT_PROFILE:'lean_v1',...patch}),{code:'room_expert_text_profile_conflict'});
  assert.equal(roomExpertTextProfile({ROOM_EXPERT_TEXT_PROFILE:'lean_v1',ROOM_REPLY_LANGUAGE_POLICY:'follow_current_user',ROOM_REPLY_TEXT_PROFILE:'expert_answer'}),'lean_v1');
});
await check('v2 actual Room caller preserves current user role and server-only profile selection',async()=>{
  const w=await setup({profile:'lean_v2'});
  const message='Hindi mein samjhao.';
  await w.say({message,profile:'lean_v1',locale:'en'});
  assert.equal(w.modelCalls,1);
  assert.equal(w.compiled.profile,'lean_v2');
  assert(w.compiled.core.includes('APPROVED LANGUAGE DEFAULT JSON'));
  assert.equal(w.compiled.system.includes(message),false);
  assert.deepEqual(w.turns.at(-1),{role:'user',content:message});
  assert(w.teacherReads>=2,'published authority is checked around dispatch');
});
await check('actual Room caller carries scoped source evidence into generated presentation preferences only',async()=>{
 const w=await setup({profile:'lean_v2',remembers:true});
 const body='Please keep the explanation short and use Roman Hinglish.';
 w.deps.memory.recallStrict=async()=>[{id:'1',body,kind:'user',name:'preference',provenance:'user_said',preference_source:body+' What is acceleration?'}];
 await w.say({message:'Explain acceleration.'});
 assert.equal(w.modelCalls,1);
 assert.deepEqual(JSON.parse(w.compiled.system.split('SAVED COMMUNICATION JSON: ')[1].split('\n')[0]),{brevity:'short',language:'hinglish',script:'roman'});
 assert.deepEqual(w.compiled.provenance.communicationPreferenceIds,['1']);
 assert.deepEqual(w.compiled.privateMemoryRecord,[body]);
 assert.equal(w.turns.at(-1).content,'Explain acceleration.');
});
await check('actual Room keeps one multilingual memory with typed fields and current override user role',async()=>{
 const w=await setup({profile:'lean_v2',remembers:true});
 const body='आगे से मुझे हिंदी में छोटे जवाब दिया करें।';
 w.deps.memory.recallStrict=async()=>[{id:'3',body,kind:'user',name:'preference',provenance:'user_said',preference_source:body,
  communication:communicationFromProposal({language:'hindi',script:null,brevity:'short'})}];
 await w.say({message:'For this question, answer in English.'});
 assert.deepEqual(JSON.parse(w.compiled.system.split('SAVED COMMUNICATION JSON: ')[1].split('\n')[0]),{language:'hindi',brevity:'short'});
 assert.equal(w.turns.at(-1).content,'For this question, answer in English.');
 assert.deepEqual(w.compiled.provenance.communicationPreferenceIds,['3']);
 assert.deepEqual(w.compiled.privateMemoryRecord,[body]);
});
await check('actual correction preserves acknowledged one-fact replacement when classification is unavailable and offers real retry',async()=>{
 const w=await setup({profile:'lean_v2',remembers:true});
 const body='अब से मुझे विस्तार से समझाइए।';let writes=0,model=0;
 const query=async(sql,p)=>{if(sql===ROOM_MEMORY_CORRECT_SQL){writes++;assert.equal(p[5],body);return[{fact_id:'52',body,communication_classification:'unclassified'}];}return w.db(sql,p);};
 const deps={...w.deps,roomMemoryLlm:async()=>{model++;throw new Error('unexpected paid call');}};
 const result=await roomCorrectRememberedThing(query,{session:w.joined.session,factId:'51',replacement:body},deps);
 assert.deepEqual(result,{fact:{id:'52',body},communication_classification:'unconfirmed'});
 assert.equal(writes,1);assert.equal(model,0);
 const retry=await roomReclassifyRememberedThing(query,{session:w.joined.session,factId:'52'},deps);
 assert.deepEqual(retry,{communication_classification:'unconfirmed'});assert.equal(writes,1);assert.equal(model,0);
 const route=readFileSync(new URL('../api/room.js',import.meta.url),'utf8');
 assert(route.includes('op === "memory_classify"'));
 assert(route.includes("roomReclassifyRememberedThing(q,{session:body.session,factId:body.fact_id})"));
});
await check('development proof rejects missing or malformed teacher input before any database work or fixture writes',async()=>{
  for(const sheet of [undefined,null,{},[]]){
    let calls=0,records=0;
    await assert.rejects(proveRoomExpertTeacherDevelopment({optIn:true,sheet,db:async()=>{calls++;return[];},recordFixtureIds:async()=>{records++;}}),{code:'expert_teacher_dev_sheet_invalid'});
    assert.equal(calls,0);assert.equal(records,0);
  }
});
await check('conversation exact 20000-unit content budget passes; one extra unit and malformed frames fail',()=>{
  const turns=Array.from({length:5},()=>({role:'user',content:'x'.repeat(4000)}));
  assert.equal(assertExpertConversation(turns),20000);
  assert.throws(()=>assertExpertConversation([...turns,{role:'user',content:'x'}]),{code:'room_expert_conversation_budget_exceeded'});
  for(const bad of [new Array(1),[{role:'system',content:'x'}],[{role:'user',content:'x'.repeat(4001)}]]) assert.throws(()=>assertExpertConversation(bad),{code:'room_expert_conversation_invalid'});
  const tiny=Array.from({length:40},()=>({role:'user',content:'x'}));
  assert.equal(assertExpertConversation(tiny),40);
  assert.throws(()=>assertExpertConversation([...tiny,tiny[0]]),{code:'room_expert_conversation_invalid'});
  assert.equal(ROOM_RECALL_TURNS,30);assert.equal(ROOM_HISTORY_TURNS,30);
  assert.ok(readFileSync(new URL('../api/_azure-surface-reply.js',import.meta.url),'utf8').includes('...turns.slice(-40)'));
});
await check('remembering opt-in snapshots before current log and retains identical previous/current questions exactly twice',async()=>{
  for(const enabled of [true,false]){
    const w=await setup({remembers:true});if(!enabled) delete w.env.ROOM_EXPERT_TEXT_PROFILE;
    const question='Explain the labels.';
    const persisted=[{role:'user',content:question}],order=[];
    const history=async()=>{order.push('history');return persisted.map(row=>({...row}));};
    w.deps.memory.historyStrict=history;w.deps.memory.history=history;
    w.deps.memory.logTurn=async args=>{order.push(args.role);persisted.push({role:args.role==='her'?'assistant':'user',content:args.content});};
    const reply=w.deps.reply;w.deps.reply=async(...args)=>{order.push('model');return reply(...args);};
    await w.say();
    assert.equal(w.turns.filter(row=>row.role==='user'&&row.content===question).length,enabled?2:3);
    assert.deepEqual(order,enabled?['history','me','model','her']:['me','history','model','her']);
    assert.equal(persisted.filter(row=>row.role==='user'&&row.content===question).length,2);
  }
});
await check('failed strict history writes no current user turn and invokes no model',async()=>{
  const w=await setup({remembers:true});w.deps.memory.historyStrict=async()=>{throw new Error('fixture read failed');};
  await assert.rejects(w.say(),{code:'room_expert_history_unavailable'});
  assert.equal(w.modelCalls,0);assert.ok(!w.memlog.some(row=>row.call==='logTurn'));
});
await check('normal remembering Room sends at most 30 prior frames plus one current frame',async()=>{
  const w=await setup({remembers:true});
  w.deps.memory.historyStrict=async(_device,_agent,limit)=>{
    assert.equal(limit,30);return Array.from({length:limit},(_,i)=>({role:i%2?'assistant':'user',content:'prior '+i}));
  };
  await w.say();assert.equal(w.turns.length,31);
  assert.equal(w.turns.at(-1).content,'Explain the labels.');
});
await check('actual default Room ignores request profile and makes no new publication reads',async()=>{
  const w=await setup(); delete w.env.ROOM_EXPERT_TEXT_PROFILE;
  const result=await w.say({expertTextProfile:'lean_v1'});
  assert.equal(w.teacherReads,0); assert.equal(w.compiled.profile,undefined);
  assert.ok(!result.reply.includes('LARCH-72'));
});
await check('invalid server config fails before quota and model dispatch',async()=>{
  for(const patch of [{ROOM_EXPERT_TEXT_PROFILE:'bad'},{ROOM_REPLY_TEXT_PROFILE:'wrong'}]){
    const w=await setup();Object.assign(w.env,patch);
    await assert.rejects(w.say(),{code:patch.ROOM_EXPERT_TEXT_PROFILE?'room_expert_text_profile_invalid':'room_expert_text_profile_conflict'});
    assert.equal(w.modelCalls,0);assert.equal(w.teacherReads,0);
    assert.ok(!w.db.calls.some(sql=>/update vy_room_follower f\s+set month_key/.test(sql)));
  }
});
await check('actual opt-in uses lean compiler, complete parser, scoped publication and public receipt',async()=>{
  const w=await setup();const result=await w.say();
  assert.equal(w.compiled.profile,'lean_v1');assert.equal(w.compiled.provenance.publication.consentBasis,'persisted_sheet_column');
  assert.equal(w.teacherReads,3);assert.equal(w.db.calls.filter(sql=>sql===PUBLIC_ROOM_KNOWLEDGE_SQL).length,3);
  assert.ok(result.reply.endsWith('final LARCH-72 label'));assert.equal(result.gate.applied,true);
  assert.equal(result.knowledge.relation,'provided_to_model');assert.equal(result.knowledge.exact,false);
  assert.deepEqual(result.knowledge.sources.map(row=>row.id),[SOURCE]);
  assert.ok(!JSON.stringify(result).includes(CONSENT));assert.equal(w.memlog.length,0);
  assert.equal((w.compiled.tail.match(/Capability: unavailable/g)??[]).length,2);
});
await check('missing publication, wrong explicit ownership and JSON-only consent refuse before quota/model',async()=>{
  for(const patch of [null,{status:'draft'},{status:'validated'},{paused_at:'2026-09-07T00:00:00Z'},
    {consent_artifact_id:null},{sheet_owner_user_id:USER_B},
    {sheet_replica_id:null,sheet_owner_user_id:OWNER},{version:'different'},{consent_artifact_id:FACT_ID},
    {lifecycle:'revoked'},{agent_id:FACT_ID}]){
    const w=await setup();w.row=patch===null?null:{...w.row,...patch};
    await assert.rejects(w.say());assert.equal(w.modelCalls,0);
    assert.ok(!w.db.calls.some(sql=>/update vy_room_follower f\s+set month_key/.test(sql)));
  }
});
await check('legacy both-null ownership remains eligible under exact Room and replica scope',async()=>{
  const w=await setup();w.row.sheet_replica_id=null;w.row.sheet_owner_user_id=null;
  assert.ok((await w.say()).reply);assert.equal(w.teacherReads,3);
});
await check('publication change before dispatch refuses without model call',async()=>{
  const w=await setup();const original=w.deps.engine.compileExpertText;
  w.deps.engine={...engine,compileExpertText:input=>{
    const compiled=original(input);w.row={...w.row,status:'revoked'};return compiled;
  }};
  await assert.rejects(w.say(),{code:'room_expert_teacher_unavailable'});assert.equal(w.modelCalls,0);
});
await check('publication or follower-consent changes during generation prevent delivery and assistant logging',async()=>{
  for(const change of [w=>{w.row={...w.row,status:'revoked'};},w=>{w.state.followers[0].memory_consent_at=null;},
    w=>{w.row={...w.row,paused_at:'2026-09-07T00:00:00Z'};},
    w=>{w.row={...w.row,status:'validated'};},
    w=>{w.row={...w.row,consent_artifact_id:FACT_ID,sheet:{...w.row.sheet,consentArtifactId:FACT_ID}};},
    w=>{w.row={...w.row,sheet:{...w.row.sheet,strictness:2}};}]){
    const w=await setup({remembers:true});const reply=w.deps.reply;
    w.deps.reply=async(...args)=>{const text=await reply(...args);change(w);return text;};
    await assert.rejects(w.say());assert.equal(w.modelCalls,1);
    assert.ok(!w.memlog.some(row=>row.call==='logTurn'&&row.role==='her'));
  }
});
await check('two consented followers retain private scope through strict callbacks and compiled guard records',async()=>{
  const w=await setup({remembers:true});
  const second=await joinRoom(w.db,{slug:SLUG,authUserId:USER_B,ageAttested:true,memoryConsent:true},w.deps);
  for(const [session,person,other] of [[w.joined.session,PERSON_A,PERSON_B],[second.session,PERSON_B,PERSON_A]]){
    w.deps.memory.recallStrict=async(p,a)=>{assert.equal(p,person);assert.equal(a,AGENT_ID);return[{id:FACT_ID,body:`private preference for ${person}`}];};
    await w.say({session});
    assert.deepEqual(w.compiled.privateMemoryRecord,[`private preference for ${person}`]);
    assert.ok(!w.compiled.system.includes(other));assert.ok(!JSON.stringify(w.compiled.publicKnowledge).includes(person));
  }
});
await check('actual strict recall/history refuse provider failure; default false-empty controls still return arrays',async()=>{
  // The network-blocking fetch above prevents a request even if an env URL exists.
  assert.deepEqual(await dmRecall(PERSON_A,{agentId:AGENT_ID}),[]);
  await assert.rejects(dmRecall(PERSON_A,{agentId:AGENT_ID,strict:true}),{code:'room_expert_recall_unavailable'});
  assert.deepEqual(await dmHistory('synthetic-device',undefined,2,AGENT_ID),[]);
  await assert.rejects(dmHistory('synthetic-device',undefined,2,AGENT_ID,{strict:true}),{code:'room_expert_history_unavailable'});
});
await check('strict memory failure and malformed empty substitute cannot reach a model',async()=>{
  for(const [method,code] of [['recallStrict','room_expert_recall_unavailable'],['historyStrict','room_expert_history_unavailable']]){
    const w=await setup({remembers:true});w.deps.memory[method]=async()=>{throw new Error('fixture provider failure');};
    await assert.rejects(w.say(),{code});assert.equal(w.modelCalls,0);
  }
  const w=await setup({remembers:true});w.deps.memory.recallStrict=async()=>null;
  await assert.rejects(w.say(),{code:'room_expert_recall_unavailable'});assert.equal(w.modelCalls,0);
});
await check('authoritative oversized conversation fails before dispatch without truncation',async()=>{
  const w=await setup({remembers:true});w.deps.memory.historyStrict=async()=>Array.from({length:5},()=>({role:'assistant',content:'x'.repeat(4000)}));
  await assert.rejects(w.say(),{code:'room_expert_conversation_budget_exceeded'});assert.equal(w.modelCalls,0);
});
await check('unsupported execution markers never deliver a misleading pending reply',async()=>{
  for(const marker of ['[search: LARCH-72]','[forget: today]']){
    const w=await setup({remembers:true});w.deps.reply=async()=>marker+'\nPending request.';
    await assert.rejects(w.say(),{code:'room_expert_tool_unavailable'});
    assert.ok(!w.memlog.some(row=>row.call==='logTurn'&&row.role==='her'));
  }
});
await check('complete late segments reach never rules; overlong output fails before partial delivery',async()=>{
  const w=await setup({remembers:true});w.deps.neverRules=[{rule_id:'late-label',pattern:'final LARCH-72 label'}];
  assert.equal((await w.say()).reply,'');assert.ok(!w.memlog.some(row=>row.call==='logTurn'&&row.role==='her'));
  const long=await setup({remembers:true});long.deps.reply=async()=> 'x'.repeat(4001);
  await assert.rejects(long.say(),{code:'expert_answer_text_too_long'});
  assert.ok(!long.memlog.some(row=>row.call==='logTurn'&&row.role==='her'));
});
await check('reader SQL is scoped and read-only; failed read is never an empty publication',async()=>{
  for(const fragment of ['r.room_id=$1::uuid','r.replica_id=$2::uuid','r.owner_user_id=$3::uuid','r.agent_id=$4::uuid',
    "s.status='published'",'s.replica_id is null and s.owner_user_id is null','s.consent_artifact_id is not null']) assert.ok(ROOM_EXPERT_TEACHER_SQL.includes(fragment));
  assert.ok(!/\b(insert|update|delete)\b/i.test(ROOM_EXPERT_TEACHER_SQL));
  await assert.rejects(readRoomExpertTeacher(async()=>{throw new Error('SQL failed');},scope),{code:'room_expert_teacher_read_failed'});
  for(const field of Object.keys(scope)) await assert.rejects(readRoomExpertTeacher(async()=>{throw new Error('must not dispatch');},{...scope,[field]:scope[field]+'\n'}),{code:'room_expert_teacher_scope_invalid'});
  const compilerSource=readFileSync(new URL('../src/engine/compiler.ts',import.meta.url),'utf8');
  assert.ok(!compilerSource.includes('ROOM_EXPERT_TEXT_PROFILE'));
});
console.log(`${checks} Room expert runtime checks passed; no SQL parser or model-quality proof`);
