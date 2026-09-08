import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import * as engine from '../api/_engine.gen.js';
import {createTextPublicationVisitorHandler} from '../api/_text-publication-runtime.js';
import {gateReply,hasGate,honestyContextFor} from '../api/_surface.js';
import {compileNeverRules} from '../api/_never-rules.js';
import * as store from '../api/_text-publication-store.js';
import * as memory from '../api/_text-publication-memory.js';
import {encryptPublicationText,publicationTextBinding} from '../api/_text-publication-crypto.js';
import {sha256Hex} from '../api/_provenance/contracts.js';
import {fixture,id,owner,rid,pid,visitor,other,env,h} from './text-publication-store/fixtures.mjs';
globalThis.fetch=()=>{throw Error('external_fetch_forbidden');};
let passed=0;const check=async(name,run)=>{await run();passed++;console.log('ok '+name);};
// Explicit control-flow stub only. It cannot prove SQL semantics or lock races.
function v2Fixture(){
 const f=fixture(),extraCalls=[];
 const db=async(sql,args)=>{
  extraCalls.push(sql);
  if(sql===store.TEXT_PUBLICATION_MEMORY_SCHEMA_SQL)return [{available:true}];
  if(sql===store.TEXT_PUBLICATION_JOIN_V2_SQL){
   const old=f.visitors.get(args[9]),previous=BigInt(old?.memory_epoch??0);
   if(previous!==BigInt(args[13]))return [];
   const enabled=args[14],epoch=previous+((old?.memory_enabled??false)!==enabled?1n:0n);
   const v={publication_id:pid,replica_id:rid,owner_user_id:owner,visitor_user_id:args[9],session_epoch:old?.session_epoch??0,question_count:old?.question_count??0,
    admission:JSON.parse(args[10]),admission_hash:args[11],expires_at:args[12],memory_enabled:enabled,memory_epoch:String(epoch),memory_policy_hash:args[15]};
   f.visitors.set(args[9],v);return [structuredClone(v)];
  }
  if(sql===store.TEXT_PUBLICATION_SET_MEMORY_SQL){
   const v=f.visitors.get(args[9]);if(!v||String(v.memory_epoch)!==args[12]||v.admission_hash!==args[11])return [];
   Object.assign(v,{memory_enabled:args[13],memory_epoch:String(BigInt(v.memory_epoch)+1n),memory_policy_hash:args[14],admission:null,admission_hash:null,expires_at:null});return [structuredClone(v)];
  }
  if(sql===store.TEXT_PUBLICATION_MEMORY_HISTORY_SQL){
   const v=f.visitors.get(args[9]);if(!v||v.admission_hash!==args[11])return [];
   return [{publication_id:pid,exchanges:[...f.requests.values()].filter(r=>r.visitor_user_id===args[9]&&r.state==='complete'&&r.memory_epoch===v.memory_epoch).slice(-3)}];
  }
  const rows=await f.db(sql,args);
  if(sql===store.TEXT_PUBLICATION_PUBLISH_SQL&&rows.length)f.pubs.get(pid).version=JSON.parse(args[11]).scope===store.TEXT_PUBLICATION_V2_STATEMENT_SET?2:1;
  if(sql===store.TEXT_PUBLICATION_ADMIT_SQL&&rows.length)Object.assign(f.requests.get(args[12]),{memory_epoch:args[16],memory_refs:JSON.parse(args[17]),memory_refs_hash:args[18]});
  return rows;
 };
 const publish=async()=>{const r=await store.readTextPublicationReadiness(db,owner,{...f.selection,allow_memory:true},{env});return store.publishTextPublication(db,owner,{...f.selection,publication_id:pid,expected_review_hash:r.selected.review_hash,statement_set:r.statement_set,attestations:Object.fromEntries(r.statements.map(s=>[s.id,true]))},{env});};
 const join=async(remember,epoch=String(f.visitors.get(visitor)?.memory_epoch??0))=>store.joinTextPublication(db,visitor,{public_id:pid,expected_disclosure_hash:sha256Hex(store.TEXT_PUBLICATION_DISCLOSURE),is_adult:true,accept_ai_disclosure:true,accept_retention:true,remember,expected_memory_epoch:epoch,expected_memory_policy_hash:memory.PUBLICATION_MEMORY_POLICY_HASH},{env});
 const complete=async(session,requestId,question,answer)=>{
  const i={public_id:pid,session_token:session,request_id:requestId,question};
  const admitted=await store.admitTextPublicationRequest(db,visitor,i,{env});
  const provider={family:'azure',name:'azure-foundry-structured-output',version:'v1',model:'fixture',prompt_hash:'a'.repeat(64)};
  const reservation={reservation_id:id(90),budget_id:'fixture',state:'reserved',reserved_microusd:500,request_hash:h({operation:'dialogue',request_key:'text-publication:'+requestId,provider_family:provider.family,provider_name:provider.name,provider_version:provider.version,model:provider.model})};
  const c=await store.claimTextPublicationRequest(db,visitor,{...i,provider,reservation},{env});
  await store.completeTextPublicationRequest(db,visitor,{...i,dispatch_token:c.dispatch_token,answer,raw_output:{reply:answer},gate:{gated:true,finding_count:0},billing_state:'settled'},{env});
  return admitted;
 };
 return {...f,db,publish,join,complete,extraCalls};
}
await check('owner v2 is explicit; v1 terms and statements remain memory-free',async()=>{
 const old=fixture();await old.publish();assert.equal(old.pubs.get(pid).terms.memory,false);
 const f=v2Fixture();await f.publish();const p=f.pubs.get(pid);assert.equal(p.version,2);assert.equal(p.receipt.scope,'account-material-publication/v2');assert.equal(p.terms.memory,memory.PUBLICATION_MEMORY_MODE);
});
await check('initial opt-in needs exact server policy and epoch',async()=>{
 const f=v2Fixture();await f.publish();assert.equal((await store.readTextPublicationMemorySettings(f.db,visitor,{public_id:pid})).memory.enabled,false);
 await assert.rejects(()=>f.join(true,'9'));memory.validateMemoryChoice({remember:true,expected_memory_epoch:'0',expected_memory_policy_hash:memory.PUBLICATION_MEMORY_POLICY_HASH});
 for(const epoch of [1,'-1','1e3','01','9223372036854775808','0\n','1\r'])assert.throws(()=>memory.validateMemoryChoice({remember:true,expected_memory_epoch:epoch,expected_memory_policy_hash:memory.PUBLICATION_MEMORY_POLICY_HASH}));
});
await check('returning visitor recalls same scoped exchange across admission renewal',async()=>{
 const f=v2Fixture();await f.publish();const j=await f.join(true);await f.complete(j.session_token,id(40),'Explain in Hindi.','हम हिंदी में बात कर सकते हैं।');
 const renewed=await f.join(true),i={public_id:pid,session_token:renewed.session_token,request_id:id(41),question:'What language did I ask for?'};
 const a=await store.admitTextPublicationRequest(f.db,visitor,i,{env});assert.equal(a.compilerInput.privateContinuity.exchanges.length,1);assert.equal(a.compilerInput.privateContinuity.exchanges[0].question,'Explain in Hindi.');
 await assert.rejects(()=>store.admitTextPublicationRequest(f.db,other,{...i,request_id:id(42)},{env}));
});
await check('memory off reads no history and stores empty provenance; later opt-in is not retroactive',async()=>{
 const f=v2Fixture();await f.publish();const j=await f.join(false);await f.complete(j.session_token,id(43),'Private old question','Old answer');
 assert(!f.extraCalls.includes(store.TEXT_PUBLICATION_MEMORY_HISTORY_SQL));assert.equal(f.requests.get(id(43)).memory_epoch,null);assert.deepEqual(f.requests.get(id(43)).memory_refs,[]);
 const changed=await store.setTextPublicationMemory(f.db,visitor,{public_id:pid,session_token:j.session_token,remember:true,expected_memory_epoch:'0',expected_memory_policy_hash:memory.PUBLICATION_MEMORY_POLICY_HASH},{env});
 const renewed=await f.join(true,changed.memory.epoch);const a=await store.admitTextPublicationRequest(f.db,visitor,{public_id:pid,session_token:renewed.session_token,request_id:id(44),question:'Hello'},{env});assert.deepEqual(a.compilerInput.privateContinuity.exchanges,[]);
});
await check('epoch revoke withholds old text but preserves an idempotent operation receipt',async()=>{
 const f=v2Fixture();await f.publish();const j=await f.join(true);await f.complete(j.session_token,id(45),'Remember this','Recorded response');
 const changed=await store.setTextPublicationMemory(f.db,visitor,{public_id:pid,session_token:j.session_token,remember:false,expected_memory_epoch:j.memory.epoch,expected_memory_policy_hash:memory.PUBLICATION_MEMORY_POLICY_HASH},{env});
 await assert.rejects(()=>store.readTextPublicationRequest(f.db,visitor,{public_id:pid,session_token:j.session_token,request_id:id(45)},{env}));
 const renewed=await f.join(false,changed.memory.epoch),i={public_id:pid,session_token:renewed.session_token,request_id:id(45),question:'Remember this'};
 const replay=await store.admitTextPublicationRequest(f.db,visitor,i,{env});assert.equal(replay.created,false);assert.equal(replay.request.state,'withdrawn');assert.equal(replay.request.answer,undefined);assert.equal(replay.request.billing_state,'settled');
});
function encryptedRow(requestId,question,answer){const row={request_id:requestId,publication_id:pid,owner_user_id:owner,replica_id:rid,visitor_user_id:visitor,memory_epoch:'1',state:'complete',gate_sidecar:{gated:true},question_hash:sha256Hex(question),answer_hash:sha256Hex(answer)};return {...row,question_envelope:encryptPublicationText(question,publicationTextBinding(row,'question',row.question_hash),env),answer_envelope:encryptPublicationText(answer,publicationTextBinding(row,'answer',row.answer_hash),env)};}
const decode=rows=>memory.decodePublicationContinuity(rows,{publication:{publication_id:pid,owner_user_id:owner,replica_id:rid},visitor,epoch:'1',env});
await check('real encrypted envelopes reject tampering, foreign scope and unapproved answers',()=>{
 const row=encryptedRow(id(50),'नाम क्या है?','यह एक AI उत्तर है।');assert.equal(decode([row]).exchanges.length,1);
 for(const changed of [{visitor_user_id:other},{publication_id:other},{owner_user_id:other},{replica_id:other},{memory_epoch:'2'},{gate_sidecar:{gated:false}},{question_hash:'f'.repeat(64)},{answer_envelope:{...row.answer_envelope,ciphertext:'AAAA'}}])assert.throws(()=>decode([{...row,...changed}]));
});
await check('whole-exchange window is newest, bounded and never silently empty on oversize',()=>{
 assert.equal(decode([encryptedRow(id(55),'क'.repeat(100),'ख'.repeat(2700))]).exchanges.length,1);
 const old=encryptedRow(id(51),'x'.repeat(1499),'a'),recent=encryptedRow(id(52),'y'.repeat(1499),'b');assert.equal(decode([old,recent]).exchanges.length,2);
 const newest=encryptedRow(id(53),'z'.repeat(999),'c');const result=decode([old,recent,newest]);assert.deepEqual(result.exchanges.map(r=>r.requestId),[id(52),id(53)]);
 assert.throws(()=>decode([encryptedRow(id(54),'x'.repeat(2000),'y'.repeat(1001))]),/budget_exceeded/);
});
await check('claim, completion and content read share current epoch and prior-hash predicates',()=>{
 for(const sql of [store.TEXT_PUBLICATION_CLAIM_SQL,store.TEXT_PUBLICATION_COMPLETE_SQL,store.TEXT_PUBLICATION_AUTHORIZED_READ_SQL]){
  assert(sql.includes(memory.PUBLICATION_MEMORY_REQUEST_GUARD));assert(sql.includes('prior.visitor_user_id=h.visitor_user_id'));assert(sql.includes("prior.question_hash=ref->>'question_hash'"));assert(sql.includes('h.memory_epoch=v.memory_epoch'));
  assert(!sql.replace(memory.PUBLICATION_MEMORY_REQUEST_GUARD,'true').includes('h.memory_epoch=v.memory_epoch'));
 }
});
await check('forget, unpublish, account forget and expiry retain scoped erasure callers',()=>{
 for(const sql of [store.TEXT_PUBLICATION_FORGET_SQL,store.TEXT_PUBLICATION_UNPUBLISH_SQL,store.TEXT_PUBLICATION_EXPIRE_SQL,store.TEXT_PUBLICATION_CLEANUP_SQL])assert(sql.includes("memory_refs='[]'::jsonb"));
 assert(store.TEXT_PUBLICATION_ACCOUNT_FORGET_SQL.includes('memory_enabled=false'));
 const migration=readFileSync(new URL('../db/migrations/153_publication_visitor_continuity.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n').trim();
 assert(readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n').includes(migration));
});
for(const revoke of [false,true])await check(`actual v2 runtime ${revoke?'withholds after opted-out paid call':'compiles private continuity into one metered reply'}`,async()=>{
 const f=v2Fixture();await f.publish();const j=await f.join(true);await f.complete(j.session_token,id(60),'Explain in Hindi.','हिंदी में समझाते हैं।');
 let generated=0,settled=0;const provider={family:'azure',name:'azure-foundry-structured-output',version:'v1',model:'fixture'};
 const reservation={reservation_id:id(91),budget_id:'fixture',state:'reserved',reserved_microusd:500,request_hash:h({operation:'dialogue',request_key:'text-publication:'+id(61),provider_family:provider.family,provider_name:provider.name,provider_version:provider.version,model:provider.model})};
 const handler=createTextPublicationVisitorHandler({db:f.db,store,engine,env,requireUser:async()=>({id:visitor}),gateReply,hasGate,honestyContextFor,compileNeverRules,loadNeverRules:async()=>[],
  resolveGenerator:async()=>({...provider,billing:{meter:'azure_foundry_tokens'},generate:async({prompt})=>{generated++;assert.equal(prompt.schema,'account_material_publication/v2');assert(prompt.messages[0].content.includes('Explain in Hindi.'));return {output:{reply:'हम हिंदी में जारी रख सकते हैं।',delivery:{mode:'grounded',pace:'natural',intensity:0.3,language_hint:'hi-IN',nonverbals:[]}},usage:{input_tokens:100,output_tokens:12}};}}),
  budget:{foundryBudgetConfig(){},reserveFoundrySpend:async()=>reservation,beginFoundrySpend:async()=>{},settleFoundrySpend:async()=>{settled++;if(revoke)await store.setTextPublicationMemory(f.db,visitor,{public_id:pid,session_token:j.session_token,remember:false,expected_memory_epoch:j.memory.epoch,expected_memory_policy_hash:memory.PUBLICATION_MEMORY_POLICY_HASH},{env});},releaseFoundrySpendBeforeCall:async()=>{throw Error('already paid must not release');},markFoundrySpendUncertain:async()=>{}},
 });
 const req=Object.assign(new EventEmitter(),{method:'POST',body:{op:'ask',public_id:pid,session_token:j.session_token,request_id:id(61),question:'Can we continue in that language?'}});
 const res=Object.assign(new EventEmitter(),{status(code){this.code=code;return this;},json(body){this.body=body;this.writableEnded=true;return this;}});
 await handler(req,res);assert.equal(generated,1);assert.equal(settled,1);
 if(revoke){assert(res.code>=400);assert.equal(res.body.request?.answer,undefined);}else{assert.equal(res.code,201);assert.equal(res.body.request.answer,'हम हिंदी में जारी रख सकते हैं।');}
});
await check('oversize remembered exchange becomes a readable blocked receipt with no provider retry',async()=>{
 const f=v2Fixture();await f.publish();const j=await f.join(true);await f.complete(j.session_token,id(65),'x'.repeat(2000),'y'.repeat(1500));
 let providerAttempts=0;
 const handler=createTextPublicationVisitorHandler({db:f.db,store,engine,env,requireUser:async()=>({id:visitor}),gateReply,hasGate,honestyContextFor,compileNeverRules,loadNeverRules:async()=>[],
  resolveGenerator:async()=>{providerAttempts++;throw Error('must not resolve provider');},budget:{foundryBudgetConfig(){throw Error('must not reserve');}}});
 const input={op:'ask',public_id:pid,session_token:j.session_token,request_id:id(66),question:'Next question'};
 const req=Object.assign(new EventEmitter(),{method:'POST',body:input}),res=Object.assign(new EventEmitter(),{status(code){this.code=code;return this;},json(body){this.body=body;this.writableEnded=true;return this;}});
 await handler(req,res);assert.equal(res.code,409);assert.equal(res.body.error,'text_publication_memory_budget_exceeded');assert.equal(providerAttempts,0);
 const read=await store.readTextPublicationRequest(f.db,visitor,input,{env});assert.equal(read.state,'blocked');assert.equal(read.billing_state,'not_started');assert.equal(read.answer,undefined);
 const replay=await store.admitTextPublicationRequest(f.db,visitor,input,{env});assert.equal(replay.created,false);assert.equal(replay.request.state,'blocked');
});
console.log(JSON.stringify({passed,scope:'offline JS/crypto and structural SQL guards only; actual SQL, concurrency, browser and Azure quality unverified',provider_calls:0}));
