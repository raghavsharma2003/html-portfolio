// Actual Room runner + actual counted LLM with synthetic config/transport.
// No deployed credentials, DB requests or provider requests are loaded or used.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const configUrl=new URL('../../api/_config.js',import.meta.url).href;
const dbUrl=new URL('../../api/_db.js',import.meta.url).href;
const configEndpoint='https://config-only.services.ai.azure.com';
const configKey='synthetic-config-key';
const emptyExports=['OPENROUTER_KEY','OPENROUTER_RESEARCH_KEY','GOOGLE_KEY','GOOGLE_PAID_KEY','NEON_URL',
 'SUPABASE_URL','SUPABASE_KEY','SUPABASE_SERVICE_ROLE_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET',
 'TELEGRAM_BOT_USERNAME','FCM_PROJECT_ID','FCM_CLIENT_EMAIL','FCM_PRIVATE_KEY','GOOGLE_KEYRING','GOOGLE_KEYS'];
const hooks=registerHooks({
 resolve(specifier,context,next){
  if(specifier.endsWith('_config.js') && new URL(specifier,context.parentURL).href===configUrl) return {url:configUrl,shortCircuit:true};
  return next(specifier,context);
 },
 load(url,context,next){
  if(url===configUrl) return {format:'module',shortCircuit:true,source:
   `export const AZURE_ENDPOINT=${JSON.stringify(configEndpoint)};export const AZURE_KEY=${JSON.stringify(configKey)};`
   +emptyExports.map(name=>`export const ${name}="";`).join('\n')};
  if(url===dbUrl) return {format:'module',shortCircuit:true,source:'export async function q(){throw new Error("unexpected default DB transport");}'};
  return next(url,context);
 }
});
const names=['AZURE_ENDPOINT','AZURE_API_KEY','VYAKTI_MODEL_SERVING'];
const prior=Object.fromEntries(names.map(name=>[name,process.env[name]]));
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('unexpected default network transport');};
delete process.env.AZURE_ENDPOINT;delete process.env.AZURE_API_KEY;
process.env.VYAKTI_MODEL_SERVING='azure_only';
let checks=0;
const check=async(name,fn)=>{await fn();console.log(`ok ${++checks} - ${name}`);};
try {
 const {strictConsolidationConfig}=await import('../../api/_consolidation-config.js');
 const memory=await import('../../api/_room-memory-authority.js');
 const {llm,costSnapshot,costDelta}=await import('../../api/consolidate.js');
 const candidate={follower_id:'10000000-0000-4000-8000-000000000001',agent_id:'20000000-0000-4000-8000-000000000001',person_id:'30000000-0000-4000-8000-000000000001'};
 const row={...candidate,memory_epoch:'7',id:'41',content:'Please explain slowly.'};
 function runOptions(env=process.env,{httpFailure=false}={}){
  const calls={db:[],http:[]};
  const fetchImpl=async(url,init)=>{
   calls.http.push({url,init});
   if(httpFailure)return new Response('',{status:500});
   return Response.json({choices:[{finish_reason:'stop',message:{content:'{"memories":[]}'}}],usage:{prompt_tokens:10,completion_tokens:5}});
  };
  return {calls,fetchImpl,options:{env,
   queryFn:async(sql,params)=>{
    calls.db.push({sql,params});
    if(sql===memory.ROOM_MEMORY_BATCH_SQL)return [row];
    assert.equal(sql,memory.ROOM_MEMORY_COMMIT_SQL);
    return [{episode_id:'91',facts_written:0,observations_written:0,sources_consumed:1}];
   },
   model:(messages,maxTokens,options)=>llm(messages,maxTokens,{...options,fetchImpl}),
  }};
 }
 await check('config-only process environment passes Room preflight and actual Azure dispatch with the same binding',async()=>{
  assert.deepEqual(strictConsolidationConfig(),{url:`${configEndpoint}/chat/completions`,key:configKey});
  const test=runOptions(),before=costSnapshot();
  const result=await memory.runRoomMemoryConsolidation(candidate,test.options);
  assert.equal(result.episode_id,'91');assert.equal(test.calls.db.length,2);assert.equal(test.calls.http.length,1);
  assert.equal(test.calls.http[0].url,`${configEndpoint}/chat/completions`);
  assert.equal(test.calls.http[0].init.headers['api-key'],configKey);
  assert.equal(test.calls.http[0].init.redirect,'error');
  assert.deepEqual(JSON.parse(test.calls.http[0].init.body).response_format,memory.ROOM_MEMORY_RESPONSE_FORMAT);
  const delta=costDelta(before);assert.equal(delta.azure_attempts,1);assert.equal(delta.fallback_attempts,0);
 });
 await check('explicit custom configuration overrides synthetic deployed config consistently',async()=>{
  const env={VYAKTI_MODEL_SERVING:'azure_only',AZURE_ENDPOINT:'https://explicit.services.ai.azure.com',AZURE_API_KEY:'synthetic-explicit-key'};
  const test=runOptions(env);await memory.runRoomMemoryConsolidation(candidate,test.options);
  assert.equal(test.calls.http[0].url,`${env.AZURE_ENDPOINT}/chat/completions`);
  assert.equal(test.calls.http[0].init.headers['api-key'],env.AZURE_API_KEY);
 });
 await check('custom environments never inherit either deployed endpoint or deployed key',async()=>{
  for(const env of [
   {VYAKTI_MODEL_SERVING:'azure_only'},
   {VYAKTI_MODEL_SERVING:'azure_only',AZURE_ENDPOINT:configEndpoint},
   {VYAKTI_MODEL_SERVING:'azure_only',AZURE_API_KEY:'synthetic-explicit-key'},
  ]){
   assert.throws(()=>strictConsolidationConfig(env),e=>e.code==='consolidate_azure_unconfigured');
   const test=runOptions(env);
   await assert.rejects(memory.runRoomMemoryConsolidation(candidate,test.options),e=>e.code==='consolidate_azure_unconfigured');
   await assert.rejects(llm([],5,{env,fetchImpl:test.fetchImpl}),e=>e.code==='consolidate_azure_unconfigured');
   assert.equal(test.calls.db.length,0);assert.equal(test.calls.http.length,0);
  }
 });
 await check('invalid origin and non-Azure Room mode refuse before private source reads',async()=>{
  for(const env of [
   {VYAKTI_MODEL_SERVING:'azure_only',AZURE_ENDPOINT:'https://example.com',AZURE_API_KEY:'synthetic-key'},
   {VYAKTI_MODEL_SERVING:'legacy',AZURE_ENDPOINT:configEndpoint,AZURE_API_KEY:'synthetic-key'},
  ]){
   const test=runOptions(env);await assert.rejects(memory.runRoomMemoryConsolidation(candidate,test.options));
   assert.equal(test.calls.db.length,0);assert.equal(test.calls.http.length,0);
  }
 });
 await check('Foundry-only aliases remain an explicit unmapped configuration',async()=>{
  const env={VYAKTI_MODEL_SERVING:'azure_only',AZURE_FOUNDRY_ENDPOINT:configEndpoint,AZURE_FOUNDRY_API_KEY:'synthetic-foundry-key',AZURE_FOUNDRY_DIALOGUE_MODEL:'gpt-4.1-mini'};
  const test=runOptions(env);await assert.rejects(memory.runRoomMemoryConsolidation(candidate,test.options),e=>e.code==='consolidate_azure_unconfigured');
  assert.equal(test.calls.db.length,0);assert.equal(test.calls.http.length,0);
 });
 await check('Azure dispatch failure cannot try a legacy provider or alter the incumbent model',async()=>{
  const test=runOptions(process.env,{httpFailure:true}),before=costSnapshot();
  await assert.rejects(memory.runRoomMemoryConsolidation(candidate,test.options),e=>e.code==='consolidate_azure_http_failed');
  assert.equal(test.calls.http.length,1);assert.equal(test.calls.db.length,1);
  assert.equal(JSON.parse(test.calls.http[0].init.body).model,'grok-4-1-fast-reasoning');
  const delta=costDelta(before);assert.equal(delta.azure_attempts,1);assert.equal(delta.fallback_attempts,0);
 });
 // The approved migration162 communication backend (7e63071d, from 76f1db59)
 // changed COMMIT and RECALL after the configuration-only frozen84c review.
 // Both hashes below also occur as acknowledged SELECTs in the archived
 // communication162-proof208-1788927832182-result.json rollback receipt.
 // Keep the six unchanged SQL pins and migration159 pin; this is no new SQL proof.
 await check('SQL exports match the approved 84c and communication162 snapshots; migration159 stays frozen',()=>{
  const expected={
   ROOM_MEMORY_BATCH_SQL:'0fa548d63e536c9aba42149c08d91523145514734c706c22725ae266af50df6e',
   ROOM_MEMORY_COMMIT_SQL:'b774b310c033da143d01778688f66226392d0a46b6ce730ab17548b4b9c113fb',
   ROOM_MEMORY_DISCOVERY_SQL:'e4c098229289530e33e266e291c7cbc71e64694e1c697820a056ef818aec6dcc',
   ROOM_MEMORY_FORGET_SQL:'ef6fd4d3710f923b10020882c78440ff3897e424d8923849b5fe6088edb6f996',
   ROOM_MEMORY_HISTORY_SQL:'ab34a8bdb2bea88a3cfd5b51a3c3b742b98ffa9644ae7ebaee3ea35b5bf2f445',
   ROOM_MEMORY_LOG_SQL:'53a5098fe0eeaaf7cb83198f898891052fecb083af4cf732c2d8178ca4920058',
   ROOM_MEMORY_RECALL_SQL:'535906d5ce7b10ed470ca2645db29e46f956f52a95c9cda3ec551c2e47a730b9',
   ROOM_MEMORY_REVOKE_SQL:'0c479845218fc404c6dec4142ac128126e877027285a61957e7a47e62dfcb538',
  };
  const hash=value=>createHash('sha256').update(value).digest('hex');
  for(const [name,digest] of Object.entries(expected))assert.equal(hash(memory[name]),digest,name);
  // Git line endings are not schema changes; pin the canonical LF source.
  const ddl=readFileSync(new URL('../../db/migrations/159_room_memory_authority.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  assert.equal(hash(ddl),'f178a32a07fbc640671787c733850f75451e3bb2de9a41b26632813aab5539e5');
  assert.equal(memory.ROOM_MEMORY_CONSOLIDATION_ENABLED,true);
 });
 await check('communication SQL keeps authority, exact source grounding and current scoped preference support',()=>{
  // Static mutation controls supplement the reviewed byte pins. They do not
  // execute SQL or establish current database schema/transaction behavior.
  const controls=[
   [memory.ROOM_MEMORY_COMMIT_SQL, [
    'f.follower_id=$1::uuid and f.memory_epoch=$2::bigint',
    'f.agent_id=$3::uuid and f.person_id=$4::uuid',
    'f.memory_consent_at is not null and f.age_attested_at is not null',
    'r.published_at is not null and r.paused_at is null',
    "p.lifecycle not in ('revoked','purging') and p.revoked_at is null",
    'for update of p','for update of r','for update of f','for update of l',
    'x.content=l.content',
    'l.room_memory_follower_id=f.follower_id and l.room_memory_epoch=f.memory_epoch',
    'l.agent_id=f.agent_id and l.speaker_person_id=f.person_id',
    "l.role='me' and l.channel='chat' and l.kind='text' and l.episode_id is null",
    '(select count(*) from source)=(select count(*) from expected)',
    'group by source_id,quote having count(*)>1',
    'group by v.source_id,d.key having count(*)>1',
    "v.kind<>'user' or v.name<>'preference' or v.communication->>'state' is distinct from 'classified'",
    'position(v.quote in s.content)>0',
    'from valid f returning id,agent_id,person_id',
    "v.quote,'user_said',1.0,array[e.id],false,v.communication",
   ]],
   [memory.ROOM_MEMORY_RECALL_SQL, [
    'f.follower_id=$1::uuid and f.memory_epoch=$2::bigint and f.agent_id=$3::uuid and f.person_id=$4::uuid',
    'f.memory_consent_at is not null and f.age_attested_at is not null',
    'r.published_at is not null and r.paused_at is null',
    "p.lifecycle not in ('revoked','purging') and p.revoked_at is null",
    'e.agent_id=f.agent_id and e.person_id=f.person_id and v.agent_id=f.agent_id and v.person_id=f.person_id',
    'v.t_invalid is null and v.retracted_at is null and v.superseded_by is null',
    'l.episode_id=e.id and l.room_memory_follower_id=f.follower_id and l.room_memory_epoch=f.memory_epoch',
    'l.agent_id=f.agent_id and l.speaker_person_id=f.person_id',
    'position(v.body in l.content)>0',
    "(values ('language'),('script'),('brevity')) dimensions(dimension)",
    "where communication->'scope'->dimension='true'::jsonb",
    'order by dimension,source_created_at desc,source_id desc nulls last,id desc',
    'select id from scoped order by source_created_at desc,source_id desc nulls last,id desc limit 30',
    'select id from recent union select id from dimension_support',
   ]],
  ];
  for(const [sql,required] of controls){
   const valid=value=>required.every(token=>value.includes(token));
   assert.ok(valid(sql));
   for(const token of required)assert.equal(valid(sql.replaceAll(token,'')),false,`missing guard: ${token}`);
  }
 });
 console.log(`${checks} configuration controls passed; synthetic transports only.`);
} finally {
 hooks.deregister();globalThis.fetch=originalFetch;
 for(const name of names)if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];
}
