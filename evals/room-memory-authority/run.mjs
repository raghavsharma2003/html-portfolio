// Control-flow and await-race proof only. These doubles do NOT parse PostgreSQL.
// Root must run the exported exact statements against the development database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {communicationFromProposal,validCommunication,COMMUNICATION_PROPOSAL_SCHEMA,COMMUNICATION_EXTRACTION_RULE} from '../../api/_learner-communication-contract.js';
import {
 ROOM_MEMORY_BATCH_SQL,ROOM_MEMORY_COMMIT_SQL,ROOM_MEMORY_LOG_SQL,
 ROOM_MEMORY_RECALL_SQL,ROOM_MEMORY_HISTORY_SQL,ROOM_MEMORY_DISCOVERY_SQL,
 ROOM_MEMORY_CONSOLIDATION_ENABLED,ROOM_MEMORY_RESPONSE_FORMAT,ROOM_MEMORY_NAME_TAXONOMY,runRoomMemoryConsolidation,
 roomMemoryAdapter,validateRoomMemoryProposal,
} from '../../api/_room-memory-authority.js';

const env={VYAKTI_MODEL_SERVING:'azure_only',AZURE_ENDPOINT:'https://fixture.services.ai.azure.com',AZURE_API_KEY:'offline-sentinel'};
const candidate={follower_id:'10000000-0000-4000-8000-000000000001',agent_id:'20000000-0000-4000-8000-000000000001',person_id:'30000000-0000-4000-8000-000000000001'};
const source={...candidate,memory_epoch:'7',id:'41',content:'Please explain slowly. I am preparing for JEE next year.',device_id:'40000000-0000-4000-8000-000000000001',at:'2026-09-08T15:00:00.000Z'};
const proposal={memories:[{source_id:'41',kind:'relationship',name:'preference',quote:'Please explain slowly.'},{source_id:'41',kind:'user',name:'goal',quote:'I am preparing for JEE next year.'}]};
let checks=0;
const check=(name,fn)=>Promise.resolve().then(fn).then(()=>{checks++;process.stdout.write(`ok ${name}\n`);});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function store(){
 const state={follower:{...source,consent:true},rows:[{...source}],writes:[],calls:[]};
 state.query=async(sql,params)=>{
   state.calls.push({sql,params});
   if(sql===ROOM_MEMORY_BATCH_SQL) return state.rows.map(r=>({...r}));
   if(sql===ROOM_MEMORY_COMMIT_SQL){
     const [id,epoch,agent,person,raw,derived]=params;
     const f=state.follower,expected=JSON.parse(raw);
     if(!f || !f.consent || f.follower_id!==id || f.memory_epoch!==epoch || f.agent_id!==agent || f.person_id!==person
       || expected.some(x=>!state.rows.some(r=>r.id===x.id&&r.content===x.content&&!r.consumed))) return [];
     const memories=JSON.parse(derived);
     state.writes.push({episode:'91',facts:memories,observations:memories.filter(v=>v.kind==='relationship')});
     for(const r of state.rows) r.consumed=true;
     return [{episode_id:'91',facts_written:memories.length,observations_written:1,sources_consumed:expected.length}];
   }
   throw new Error('unexpected statement');
 };return state;
}
await check('admitted source capability still requires the runtime scheduler gates',()=>assert.equal(ROOM_MEMORY_CONSOLIDATION_ENABLED,true));
await check('preference recall retains learner source under same episode and authority rather than trusting arbitrary fact text',()=>{
 for(const fragment of ['v.kind,v.name,v.provenance','l.episode_id=e.id','l.room_memory_follower_id=f.follower_id','l.room_memory_epoch=f.memory_epoch','l.agent_id=f.agent_id','l.speaker_person_id=f.person_id',"l.role='me'", "v.name='preference'", "v.kind='user'", "v.provenance='user_said'",'position(v.body in l.content)>0','as preference_source']) assert(ROOM_MEMORY_RECALL_SQL.includes(fragment),fragment);
});
await check('durable facts and relational observations use one atomic commit after model await',async()=>{
 const s=store(),gate=deferred(),entered=deferred();
 const job=runRoomMemoryConsolidation(candidate,{queryFn:s.query,env,model:async(messages,max)=>{
   assert.equal(max,1600);assert.deepEqual(JSON.parse(messages[1].content),[{id:'41',content:source.content}]);
   entered.resolve();return gate.promise;
 }});
 await entered.promise;assert.equal(s.calls.length,1);assert.deepEqual(s.writes,[]);
 gate.resolve(proposal);const out=await job;
 assert.equal(out.facts_written,2);assert.equal(out.observations_written,1);
 assert.equal(s.calls.length,2);assert.equal(s.calls[1].sql,ROOM_MEMORY_COMMIT_SQL);
 assert.deepEqual(s.calls[1].params.slice(0,4),[candidate.follower_id,'7',candidate.agent_id,candidate.person_id]);
});
for(const [name,withdraw] of [
 ['forget during model await',s=>{s.follower=null;s.rows=[];}],
 ['disable during model await',s=>{s.follower.consent=false;s.follower.memory_epoch='8';}],
 ['disable then enable ABA during model await',s=>{s.follower.memory_epoch='9';}],
 ['delete then rejoin ABA during model await',s=>{s.follower.follower_id='10000000-0000-4000-8000-000000000002';}],
 ['source deleted during model await',s=>{s.rows=[];}],
 ['source corrected during model await',s=>{s.rows[0].content='Please do not remember the prior message.';}],
 ['other sweep commits during model await',s=>{s.rows[0].consumed=true;}],
 ['other Room cannot grant authority to this batch',s=>{s.follower.follower_id='10000000-0000-4000-8000-000000000099';}],
]) await check(name,async()=>{
 const s=store(),gate=deferred(),entered=deferred();
 const job=runRoomMemoryConsolidation(candidate,{queryFn:s.query,env,model:()=>{entered.resolve();return gate.promise;}});
 await entered.promise;withdraw(s);gate.resolve(proposal);
 assert.equal((await job).skipped,'memory_authority_changed');assert.deepEqual(s.writes,[]);
});
await check('provider failure cannot advance cursor or write partial facts',async()=>{
 const s=store();await assert.rejects(runRoomMemoryConsolidation(candidate,{queryFn:s.query,env,model:async()=>{throw new Error('provider_failed');}}),/provider_failed/);
 assert.equal(s.calls.length,1);assert.deepEqual(s.writes,[]);
});
await check('invented citations and paraphrases cannot write',async()=>{
 for(const bad of [{...proposal.memories[0],source_id:'42'},{...proposal.memories[0],quote:'The learner trusts me completely.'}]){
   const s=store();await assert.rejects(runRoomMemoryConsolidation(candidate,{queryFn:s.query,env,model:async()=>({memories:[bad]})}),/proposal_invalid/);
   assert.equal(s.calls.length,1);assert.deepEqual(s.writes,[]);
 }
});
await check('empty extraction consumes only an authorized batch without fabricated memory',async()=>{
 const s=store();const out=await runRoomMemoryConsolidation(candidate,{queryFn:s.query,env,model:async()=>({memories:[]})});
 assert.equal(out.facts_written,0);assert.deepEqual(s.writes[0].facts,[]);
});
await check('provider policy refuses before private source read',async()=>{
 for(const bad of [{...env,VYAKTI_MODEL_SERVING:'legacy'},{...env,AZURE_ENDPOINT:'https://example.com'},{...env,AZURE_API_KEY:''}]){
 const s=store();await assert.rejects(runRoomMemoryConsolidation(candidate,{queryFn:s.query,env:bad,model:async()=>proposal}));assert.equal(s.calls.length,0);
 }
});
await check('raw writer and returning history/recall carry immutable follower and epoch',async()=>{
 const calls=[];const db=async(sql,params)=>{calls.push({sql,params});return sql===ROOM_MEMORY_LOG_SQL?[{id:'42'}]:[];};
 const adapter=roomMemoryAdapter(db,source);
 await adapter.openEpisode();assert.equal(calls.length,0);
 assert.deepEqual(await adapter.logTurn({device:source.device_id,role:'her',content:'A reply'}),{persisted:true});
 await adapter.history(source.device_id);await adapter.recall();
 assert.deepEqual(calls.map(c=>c.sql),[ROOM_MEMORY_LOG_SQL,ROOM_MEMORY_HISTORY_SQL,ROOM_MEMORY_RECALL_SQL]);
 for(const c of calls)assert.deepEqual(c.params.slice(0,4),[candidate.follower_id,'7',candidate.agent_id,candidate.person_id]);
 assert.throws(()=>roomMemoryAdapter(db,{...source,memory_epoch:undefined}),/authority_unavailable/);
});
await check('atomic SQL retains all source and lifecycle predicates, with learner-only derivation',()=>{
 for(const sql of [ROOM_MEMORY_COMMIT_SQL,ROOM_MEMORY_LOG_SQL]){
   for(const token of ['for update of p','for update of r','for update of f','f.memory_epoch=$2::bigint',"p.lifecycle not in ('revoked','purging')"]) assert.ok(sql.includes(token),token);
 }
 for(const sql of [ROOM_MEMORY_DISCOVERY_SQL,ROOM_MEMORY_BATCH_SQL,ROOM_MEMORY_COMMIT_SQL]){
   assert.ok(sql.includes("l.role='me'"));assert.ok(sql.includes('l.room_memory_follower_id=f.follower_id'));assert.ok(sql.includes('l.room_memory_epoch=f.memory_epoch'));
 }
 assert.ok(ROOM_MEMORY_COMMIT_SQL.includes('for update of l'));assert.ok(ROOM_MEMORY_COMMIT_SQL.includes('x.content=l.content'));
 assert.ok(ROOM_MEMORY_COMMIT_SQL.includes('from valid f returning'));assert.ok(ROOM_MEMORY_COMMIT_SQL.includes('position(v.quote in s.content)>0'));
 assert.ok(!ROOM_MEMORY_RECALL_SQL.includes("interval '12 hours'"));
});
await check('schema mirror and erasure trigger preserve source identity',()=>{
 const ddl=readFileSync(new URL('../../db/migrations/159_room_memory_authority.sql',import.meta.url),'utf8');
 const schema=readFileSync(new URL('../../db/schema.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 assert.ok(schema.includes(ddl.replace(/\r\n/g,'\n').trim()));
 assert.equal((ddl.match(/references vy_room_follower\(follower_id\) on delete cascade/g)||[]).length,2);
 for(const token of ['new.memory_epoch := old.memory_epoch + 1','delete from vy_fact','delete from vy_observation','before delete on vy_room_follower'])assert.ok(ddl.includes(token));
 const surface=readFileSync(new URL('../../api/_room-surface.js',import.meta.url),'utf8');
 const forget=surface.slice(surface.indexOf('async function roomForgetCore'));
 assert.ok(forget.indexOf('await db(ROOM_MEMORY_REVOKE_SQL')<forget.indexOf('await threadDeviceSet'));
});
await check('duplicate selections rejected before committing',()=>assert.throws(()=>validateRoomMemoryProposal({memories:[proposal.memories[0],proposal.memories[0]]},[source]),/proposal_invalid/));
await check('both returning reads independently bind lifecycle; removing any join or lifecycle predicate is caught',()=>{
 const required=[
  'join vy_room r on r.room_id=f.room_id and r.agent_id=f.agent_id',
  'join vy_replica p on p.replica_id=r.replica_id and p.owner_user_id=r.owner_user_id and p.agent_id=r.agent_id',
  'r.published_at is not null','r.paused_at is null',
  "p.lifecycle not in ('revoked','purging')",'p.revoked_at is null',
 ];
 const guarded=sql=>required.every(token=>sql.includes(token));
 for(const sql of [ROOM_MEMORY_RECALL_SQL,ROOM_MEMORY_HISTORY_SQL]){
  assert.ok(guarded(sql));
  for(const token of required) assert.equal(guarded(sql.replace(token,'')),false,token);
 }
});
await check('SQL duplicate proposal refusal gates the atomic write even without JS validation',()=>{
 const hasDuplicateGuard=sql=>{
  const valid=sql.slice(sql.indexOf('), valid as materialized ('),sql.indexOf('), episode as ('));
  return /and not exists\(select 1 from proposals group by source_id,quote having count\(\*\)>1\)/.test(valid);
 };
 assert.ok(hasDuplicateGuard(ROOM_MEMORY_COMMIT_SQL));
 assert.equal(hasDuplicateGuard(ROOM_MEMORY_COMMIT_SQL.replace('group by source_id,quote having count(*)>1','group by source_id,quote having count(*)>2')),false);
 assert.equal(hasDuplicateGuard(ROOM_MEMORY_COMMIT_SQL.replace('and not exists(select 1 from proposals group by source_id,quote having count(*)>1)','')),false);
});
await check('strict transport schema uses exact existing enums and required fields without unsupported bounds',()=>{
 const format=ROOM_MEMORY_RESPONSE_FORMAT;
 assert.equal(format.type,'json_schema');assert.equal(format.json_schema.strict,true);
 const root=format.json_schema.schema,entry=root.properties.memories.items;
 assert.deepEqual(root.required,['memories']);assert.equal(root.additionalProperties,false);
 assert.deepEqual(entry.required,['source_id','kind','name','quote','communication']);assert.equal(entry.additionalProperties,false);
 assert.deepEqual(entry.properties.kind.enum,['user','relationship']);
 assert.deepEqual(entry.properties.name.enum,['goal','preference','person','project','learning_context','relationship']);
 for(const name of ['minItems','maxItems','minLength','maxLength','pattern'])assert.ok(!JSON.stringify(format).includes(`"${name}"`));
});

await check('one multilingual preference quote remains one fact with all closed presentation fields',async()=>{
 const corpus=JSON.parse(readFileSync(new URL('./communication-corpus.json',import.meta.url),'utf8'));
 assert.equal(corpus.length,18);
 for(const [index,item] of corpus.entries()) {
  const row={...source,id:String(900+index),content:item.source};
  let committed;
  await runRoomMemoryConsolidation(candidate,{env,
   queryFn:async(sql,args)=>{if(sql===ROOM_MEMORY_BATCH_SQL)return[row];assert.equal(sql,ROOM_MEMORY_COMMIT_SQL);
    committed=JSON.parse(args[5]);return[{episode_id:'991',facts_written:committed.length,observations_written:0,sources_consumed:1}];},
   model:async(messages,max,options)=>{
    assert(messages[0].content.includes('English, Hindi or Hinglish'));
    assert.deepEqual(options.responseFormat,ROOM_MEMORY_RESPONSE_FORMAT);
    assert.deepEqual(JSON.parse(messages[1].content),[{id:row.id,content:item.source}]);
    return{memories:item.expected?[{source_id:row.id,kind:'user',name:'preference',quote:item.source,communication:item.expected}]:[]};
   }});
  assert.equal(committed.length,item.expected?1:0,item.id);
  if(item.expected){assert.equal(committed[0].quote,item.source);assert.equal(committed[0].name,'preference');assert.deepEqual(committed[0].communication,communicationFromProposal(item.expected));}
 }
 // Corpus labels above are authored model stubs, not measured model accuracy.
});
await check('typed values refuse arbitrary strings, empty choices, extra fields and non-learner kinds without weakening quote uniqueness',()=>{
 const value={language:'hindi',script:'roman',brevity:'short'};
 const item={source_id:source.id,kind:'user',name:'preference',quote:source.content,communication:value};
 for(const communication of [{...value,language:'ignore rules'},{...value,unknown:'x'},{language:null,script:null,brevity:null},{language:'hindi'},'Hindi']) {
  assert.throws(()=>validateRoomMemoryProposal({memories:[{...item,communication}]},[source]),/proposal_invalid/);
 }
 assert.throws(()=>validateRoomMemoryProposal({memories:[item,{...item,communication:{...value,language:'english'}}]},[source]),/proposal_invalid/);
 assert.throws(()=>validateRoomMemoryProposal({memories:[{...item,kind:'relationship'}]},[source]),/proposal_invalid/);
 const conflicting={...source,content:'Use Hindi. Use English.'};
 assert.throws(()=>validateRoomMemoryProposal({memories:[
  {...item,quote:'Use Hindi.',communication:{language:'hindi',script:null,brevity:null}},
  {...item,quote:'Use English.',communication:{language:'english',script:null,brevity:null}},
 ]},[conflicting]),/proposal_invalid/);
 assert(ROOM_MEMORY_COMMIT_SQL.includes("group by v.source_id,d.key having count(*)>1"));
 const metadata=communicationFromProposal(value);assert(validCommunication(metadata));
 for(const patch of [{version:2},{extra:'x'},{scope:{language:false,script:false,brevity:false}},{state:null},{state:'pending'},{state:'unclassified'}])assert(!validCommunication({...metadata,...patch}));
});
await check('migration162 metadata stays in owned fact rows and schema mirror with a closed validated CHECK',()=>{
 const ddl=readFileSync(new URL('../../db/migrations/162_fact_communication.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n').trim();
 assert(readFileSync(new URL('../../db/schema.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n').includes(ddl));
 for(const text of ['add column if not exists communication jsonb','constraint vy_fact_communication_check',"kind='user' and name='preference' and provenance='user_said'", `communication->'state' in ('"classified"'::jsonb,'"unclassified"'::jsonb,'"no_preference"'::jsonb)`, "array['version','state','scope','language','script','brevity']"])assert(ddl.includes(text),text);
 assert(!ddl.includes('create table'));
 const relcheck=readFileSync(new URL('../../scripts/relcheck.mjs',import.meta.url),'utf8');
 assert(relcheck.includes('vy_fact_communication_check'));assert(relcheck.includes('convalidated'));
});
await check('name taxonomy is telegraphic and varied desired labels remain exactly grounded',()=>{
 assert.ok(ROOM_MEMORY_NAME_TAXONOMY.includes('preference=learner-chosen recurring method/routine/format or like/dislike'));
 assert.ok(ROOM_MEMORY_NAME_TAXONOMY.includes('project=explicitly named or bounded ongoing undertaking with intended outcome, excluding methods/routines/subject practice'));
 assert.ok(ROOM_MEMORY_NAME_TAXONOMY.includes('named third party=person'));
 assert.ok(ROOM_MEMORY_NAME_TAXONOMY.includes('quoted claim about learner=not self-report, skip unsupported trait label'));
 assert.ok(!ROOM_MEMORY_NAME_TAXONOMY.includes('\n'));
 const cases=[
  {id:'501',language:'Hindi',attribution:'self',negated:false,name:'preference',quote:'मैं हर शाम रिवीजन के लिए फ्लैशकार्ड चुनता हूँ।'},
  {id:'502',language:'Hinglish',attribution:'self',negated:false,name:'preference',quote:'Chemistry ke liye main flashcards use karta hoon.'},
  {id:'503',language:'English',attribution:'self',negated:false,name:'project',quote:'My ongoing project is named Project Aurora, with a demo due in October.'},
  {id:'504',language:'English',attribution:'self',negated:false,name:'learning_context',quote:'I need step-by-step support while learning organic chemistry reactions.'},
  {id:'505',language:'Hinglish',attribution:'self',negated:true,name:'preference',quote:'Mujhe long English-only explanations bilkul pasand nahi hain.'},
  {id:'506',language:'Hindi',attribution:'third_party',negated:false,name:'person',quote:'रिया अपनी परीक्षा के लिए हर रविवार फ्लैशकार्ड बनाती है।'},
  {id:'507',language:'Hinglish',attribution:'quoted_claim',negated:false,name:null,quote:'Mere tutor ne kaha, "tum visual learner ho".'},
 ];
 const rows=cases.map(v=>({...source,id:v.id,content:v.quote}));
 const memories=cases.filter(v=>v.name).map(v=>({source_id:v.id,kind:'user',name:v.name,quote:v.quote}));
 const validated=validateRoomMemoryProposal({memories},rows);
 assert.deepEqual(validated.map(v=>v.name),cases.filter(v=>v.name).map(v=>v.name));
 assert.equal(validated.find(v=>v.source_id==='505').quote,cases.find(v=>v.id==='505').quote);
 assert.ok(!validated.some(v=>v.source_id==='507'));
});
await check('actual79 grounded quotes with invented enums remain rejected; response schema reaches model options',async()=>{
 const retained=JSON.parse(readFileSync(new URL('./canary79-enum-failure.json',import.meta.url),'utf8'));
 const output=JSON.parse(retained.raw_output);
 const row={...source,id:'8504',content:output.memories.map(v=>v.quote).join('\n')};
 for(const item of output.memories){assert.equal(item.source_id,row.id);assert.ok(row.content.includes(item.quote));}
 assert.throws(()=>validateRoomMemoryProposal(retained.raw_output,[row]),/proposal_invalid/);
 let reads=0;
 await assert.rejects(runRoomMemoryConsolidation(candidate,{env,
  queryFn:async(sql)=>{assert.equal(sql,ROOM_MEMORY_BATCH_SQL);reads++;return[row];},
  model:async(messages,maxTokens,options)=>{
   assert.equal(maxTokens,1600);assert.deepEqual(options.responseFormat,ROOM_MEMORY_RESPONSE_FORMAT);
   assert.ok(messages[0].content.includes(ROOM_MEMORY_NAME_TAXONOMY));
   return retained.raw_output;
  },
 }),/proposal_invalid/);
 assert.equal(reads,1);
});

await check('durable scoped dimensions use source chronology and retain tombstones beyond recent candidates',()=>{
 assert.match(ROOM_MEMORY_RECALL_SQL,/select distinct on \(dimension\)/);
 assert.match(ROOM_MEMORY_RECALL_SQL,/communication->'scope'->dimension='true'::jsonb/);
 assert.match(ROOM_MEMORY_RECALL_SQL,/order by dimension,source_created_at desc,source_id desc nulls last,id desc/);
 assert.match(ROOM_MEMORY_RECALL_SQL,/order by s.source_created_at desc,s.source_id desc nulls last,s.id desc/);
 assert.match(ROOM_MEMORY_RECALL_SQL,/select distinct on \(s.id\)/);
 assert.match(ROOM_MEMORY_RECALL_SQL,/select id from recent union select id from dimension_support/);
 assert.match(ROOM_MEMORY_RECALL_SQL,/'created_at',l.at/);
});
await check('depth semantics are explicit in actual schema and held-out multilingual expected values survive normalization',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/communication-depth212.json',import.meta.url),'utf8'));
 const schema=COMMUNICATION_PROPOSAL_SCHEMA.anyOf.find(v=>v.type==='object');
 assert.match(schema.properties.brevity.description,/length OR explanation depth/);
 assert.match(schema.properties.brevity.description,/without a word meaning long/);
 assert.match(COMMUNICATION_EXTRACTION_RULE,/Assess all three dimensions independently/);
 assert.match(COMMUNICATION_EXTRACTION_RULE,/never infer its value from dislike/);
 for(const [index,item] of fixture.cases.entries()){
  // These are human-authored expected outputs, NOT an offline classifier.
  assert.ok(!COMMUNICATION_EXTRACTION_RULE.includes(item.source));
  const record={...source,id:String(10000+index),content:item.source};
  const output={memories:[{source_id:record.id,kind:'user',name:'preference',quote:item.source,communication:item.expected}]};
  const result=validateRoomMemoryProposal(JSON.stringify(output),[record]);
  assert.deepEqual(result[0].communication??null,communicationFromProposal(item.expected));
 }
 const item=fixture.cases.find(v=>v.id==='hi-depth'),record={...source,content:item.source};
 const output={memories:[{source_id:record.id,kind:'user',name:'preference',quote:item.source,communication:item.expected}]};
 let optionsSeen=false;
 await runRoomMemoryConsolidation(candidate,{env,queryFn:async sql=>sql===ROOM_MEMORY_BATCH_SQL?[record]:[{fact_count:1}],
  model:async(messages,maxTokens,options)=>{
   assert.ok(messages[0].content.includes(COMMUNICATION_EXTRACTION_RULE));
   assert.deepEqual(options.responseFormat.json_schema.schema.properties.memories.items.properties.communication,COMMUNICATION_PROPOSAL_SCHEMA);
   optionsSeen=true;return JSON.stringify(output);
  }});
 assert.ok(optionsSeen);
});
process.stdout.write(`${checks} controls passed; no SQL or provider calls.\n`);
