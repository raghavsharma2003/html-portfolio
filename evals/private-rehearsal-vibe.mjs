// Synthetic control flow through the real private store and compiler. The SQL
// cases exported below are for separate actual EXPLAIN; this fixture is not a
// PostgreSQL parser, a concurrent-transaction witness or model-quality proof.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
import * as store from '../api/_private-text-rehearsal-store.js';
import * as engine from '../api/_engine.gen.js';
import {createPrivateTextRehearsalHandler} from '../api/_private-text-rehearsal.js';
import {setReplicaVibe,revertReplicaVibe} from '../api/_replica-vibe.js';
import {canonicalJson,sha256Hex} from '../api/_provenance/contracts.js';
import {privateTextFixture,syntheticPrivateTextEnv} from './private-text-rehearsal-store.mjs';
import {PRIVATE_VOICE_CANDIDATE_CTES} from '../api/_private-voice-store.js';
import {COMPARISON_PREPARATION_SNAPSHOT_SQL} from '../api/_comparison-preparation.js';
import {MODERN_AUTHORITY_SNAPSHOT_SQL} from '../api/_liveness/issued-authority.js';

const hash=value=>sha256Hex(canonicalJson(value));
const STYLE={warmth:3,energy:4,humour:1,directness:3,formality:1};
const style=(version=1,dials=STYLE)=>({vibe_id:randomUUID(),version,...dials});
function fixture(saved=style()){
 const f=privateTextFixture(),requests=new Map(),queries=[],options={env:syntheticPrivateTextEnv()};
 f.row.sheet={sheetKind:'person',name:'Synthetic Priya',identityWho:'A product designer',personValues:['care'],personNeverSay:['invent a credential'],personTalk:{register:'mixed',scriptBaseline:'roman-hinglish'}};
 f.row.saved_vibe=saved;
 f.row.style_revision=saved?.vibe_id??null;
 const setStyle=next=>{f.row.saved_vibe=next;f.row.style_revision=next?.vibe_id??null;};
 const hooks={beforeWrite:null};
 const input={replica_id:f.rid,sheet_id:f.sheet,context_item_id:f.item};
 const db=async(sql,p)=>{
  queries.push({sql,params:structuredClone(p)});
  if(sql===store.PRIVATE_TEXT_CHOICES_SQL)return p[0]===f.rid&&p[1]===f.owner?[{replica_id:f.rid,lifecycle:f.row.lifecycle,drafts:[],context_items:[]}]:[];
  if(sql===store.PRIVATE_TEXT_SELECTION_SQL)return p[0]===f.rid&&p[1]===f.owner&&p[2]===f.sheet&&p[3]===f.item?[structuredClone(f.row)]:[];
  if(sql===store.PRIVATE_TEXT_REQUEST_READ_SQL){const r=requests.get(p[2]);return r&&r.replica_id===p[0]&&r.owner_user_id===p[1]?[structuredClone(r)]:[];}
  if([store.PRIVATE_TEXT_ADMIT_SQL,store.PRIVATE_TEXT_CLAIM_SQL,store.PRIVATE_TEXT_COMPLETE_SQL].includes(sql)){
   hooks.beforeWrite?.(sql,p);
   const snapshot=JSON.parse(p[6]);
   if(p[0]!==f.rid||p[1]!==f.owner||String(p[5])!==String(f.row.private_text_epoch)
     ||(snapshot.style_revision??null)!==(f.row.style_revision??null)
     ||canonicalJson(snapshot.vibe??null)!==canonicalJson(f.row.saved_vibe??null)
     ||canonicalJson(JSON.parse(p[7]))!==canonicalJson(f.row.sheet))return [];
   if(sql===store.PRIVATE_TEXT_ADMIT_SQL){
    requests.set(p[2],{request_id:p[2],replica_id:p[0],owner_user_id:p[1],consent_id:p[9],receipt_hash:p[10],live_receipt_hash:p[10],request_hash:p[14],question_hash:p[15],snapshot_hash:p[16],snapshot,sheet_id:snapshot.sheet_id,context_item_id:snapshot.context_item_id,source_id:p[3],authority_epoch:p[5],receipt_metadata:JSON.parse(p[13]),expires_at:p[12],consent_scope:store.PRIVATE_TEXT_SCOPE,consent_method:'account_attestation',consent_policy:'replica-self-v1',state:'admitted',billing_state:'not_started',question_envelope:JSON.parse(p[17]),gate_sidecar:JSON.parse(p[18]),created_at:p[11]});
   }else{
    const row=requests.get(p[2]);if(!row)return [];
    if(sql===store.PRIVATE_TEXT_CLAIM_SQL){if(row.state!=='admitted')return [];Object.assign(row,{state:'dispatched',dispatch_token_hash:p[9],reservation_id:p[10],budget_id:p[11],spend_request_hash:p[12],provider:JSON.parse(p[13]),billing_state:'reserved',spend_state:'reserved'});}
    else{if(row.state!=='dispatched'||row.dispatch_token_hash!==p[9]||row.spend_state!==p[15])return [];Object.assign(row,{state:'complete',answer_envelope:JSON.parse(p[10]),answer_hash:p[11],raw_envelope:JSON.parse(p[12]),raw_hash:p[13],gate_sidecar:{...row.gate_sidecar,...JSON.parse(p[14])},billing_state:p[15]});}
   }
   return [{request_id:p[2]}];
  }
  throw Error('unexpected SQL in synthetic private-style fixture');
 };
 const ready=()=>store.readPrivateTextReadiness(db,f.owner,input,options);
 const askFrom=r=>({...input,request_id:randomUUID(),expected_snapshot_hash:r.selected.snapshot_hash,question:'What perspective would you bring?',statement_set:store.PRIVATE_TEXT_STATEMENT_SET,attestations:Object.fromEntries(store.PRIVATE_TEXT_STATEMENTS.map(s=>[s.id,true]))});
 const ask=async()=>askFrom(await ready());
 const admit=q=>store.admitPrivateTextRehearsal(db,f.owner,q,options);
 const provider={family:'dialogue',name:'azure-foundry-structured-output',version:'synthetic-v1',model:'synthetic-never-called',prompt_hash:'a'.repeat(64)};
 const reservation=q=>({reservation_id:randomUUID(),budget_id:'synthetic-private-style',state:'reserved',request_hash:hash({operation:'dialogue',request_key:'private-text-rehearsal:'+q.request_id,provider_family:provider.family,provider_name:provider.name,provider_version:provider.version,model:provider.model})});
 const claim=q=>store.claimPrivateTextRehearsal(db,f.owner,{...q,reservation:reservation(q),provider},options);
 const finish=async(q,c)=>{requests.get(q.request_id).spend_state='settled';return store.completePrivateTextRehearsal(db,f.owner,{...q,dispatch_token:c.dispatch_token,answer:'A synthetic saved answer.',raw_output:{reply:'A synthetic saved answer.'},gate:{gated:true},billing_state:'settled'},options);};
 return {f,db,queries,requests,input,options,ready,askFrom,ask,admit,claim,finish,setStyle,hooks};
}

export async function privateRehearsalVibeExplainCases(){
 const cases=[];
 for(const saved of [null,style()]){
  const x=fixture(saved),q=await x.ask();await x.admit(q);const c=await x.claim(q);await x.finish(q,c);
  for(const name of ['PRIVATE_TEXT_SELECTION_SQL','PRIVATE_TEXT_ADMIT_SQL','PRIVATE_TEXT_CLAIM_SQL','PRIVATE_TEXT_COMPLETE_SQL']){
   const call=x.queries.find(v=>v.sql===store[name]);assert(call,name);cases.push({name:name+(saved?'_vibe':'_absent'),...call});
  }
 }
 // Capture the real private write statements without executing them.
 for(const op of ['set','revert']){
  const owner=randomUUID(),rid=randomUUID();
  const db=async(sql,params)=>{
   if(sql.startsWith('select replica_id from vy_replica'))return [{replica_id:rid}];
   cases.push({name:'VIBE_'+op.toUpperCase()+'_SQL',sql,params});return [{vibe_id:randomUUID(),replica_id:rid,owner_user_id:owner,version:2,...STYLE}];
  };
  if(op==='set')await setReplicaVibe(db,owner,{replica_id:rid,...STYLE});
  else await revertReplicaVibe(db,owner,{replica_id:rid,to_version:1});
 }
 return cases;
}

export async function runPrivateRehearsalVibeChecks(){
 let n=0;const check=async(name,fn)=>{await fn();console.log(`ok ${++n} - ${name}`);};
 await check('saved style version reaches the actual person compiler and stays subordinate to boundaries',async()=>{
  const x=fixture(),q=await x.ask(),a=await x.admit(q),compiled=engine.compilePrivateExpertRehearsal(a.compilerInput);
  assert.deepEqual(a.compilerInput.vibe,x.f.row.saved_vibe);
  assert(compiled.system.includes(engine.renderVibe(STYLE)));
  assert(compiled.tail.indexOf('No automatic learning')>compiled.tail.indexOf(engine.renderVibe(STYLE)));
  assert(compiled.tail.includes('cannot change facts, identity, relationship boundaries, declared language or safety rules'));
  assert(compiled.system.includes('roman-hinglish'));assert.deepEqual(compiled.privateMemoryRecord,[]);
  assert.deepEqual(x.requests.get(q.request_id).snapshot.vibe,x.f.row.saved_vibe);
  assert.equal(x.requests.get(q.request_id).snapshot.style_revision,x.f.row.saved_vibe.vibe_id);
  assert.equal((await x.ready()).selected.vibe,undefined);
  assert.equal((await x.ready()).selected.style_revision,undefined);
 });
 await check('request-body style, note and foreign replica cannot replace server-selected dials',async()=>{
  const x=fixture(),q={...await x.ask(),vibe:{...STYLE,warmth:0,note:'PROMPT_INJECTION_CANARY'},owner_user_id:randomUUID()};
  const a=await x.admit(q),compiled=engine.compilePrivateExpertRehearsal(a.compilerInput);
  assert.equal(a.compilerInput.vibe.warmth,3);assert(!compiled.system.includes('PROMPT_INJECTION_CANARY'));
  await assert.rejects(()=>store.admitPrivateTextRehearsal(x.db,randomUUID(),{...q,request_id:randomUUID()},x.options),{code:'rehearsal_authority_unavailable'});
  await assert.rejects(()=>x.admit({...q,request_id:randomUUID(),replica_id:randomUUID()}),{code:'rehearsal_authority_unavailable'});
  assert.equal(x.requests.size,1);
 });
 await check('no saved style preserves legacy snapshot and prompt bytes for person and teacher',async()=>{
  for(const kind of ['person','teacher']){
   const x=fixture(null);if(kind==='teacher')x.f.row.sheet={name:'Synthetic teacher',identityWho:'A maths teacher',subjectDomain:'maths'};
   const q=await x.ask(),a=await x.admit(q),snapshot=x.requests.get(q.request_id).snapshot;
   assert(!Object.hasOwn(snapshot,'vibe'));assert(!Object.hasOwn(snapshot,'style_revision'));assert(!Object.hasOwn(a.compilerInput,'vibe'));
   const compiled=engine.compilePrivateExpertRehearsal(a.compilerInput);
   assert.deepEqual(engine.compilePrivateExpertRehearsal({...a.compilerInput,vibe:null}),compiled);
   assert(!compiled.system.includes('YOUR OWN VIBE'));
   assert.equal(q.expected_snapshot_hash,hash({owner_user_id:x.f.owner,replica_id:x.f.rid,policy_version:'replica-self-v1',...snapshot}));
  }
 });
 await check('malformed persisted dials and compiler dials refuse instead of silently using defaults',async()=>{
  const x=fixture(),q=await x.ask(),a=await x.admit(q);
  for(const bad of [-1,5,1.5,'3',null]){
   assert.throws(()=>engine.compilePrivateExpertRehearsal({...a.compilerInput,vibe:{...STYLE,warmth:bad}}),{code:'private_rehearsal_vibe_invalid'});
   x.f.row.saved_vibe={...style(),warmth:bad};const r=await x.ready();assert.equal(r.can_ask,false);assert.equal(r.state,'unavailable');assert.equal(r.blockers[0].responsibility,'platform');
  }
 });
 await check('style change, same-dial new revision and profile correction each reject old readiness before admission',async()=>{
  for(const change of [x=>x.setStyle(style(2,{...STYLE,warmth:1})),x=>x.setStyle(style(2)),x=>x.f.row.sheet.personValues=['accuracy']]){
   const x=fixture(),q=await x.ask();change(x);await assert.rejects(()=>x.admit(q),{code:'rehearsal_inputs_changed'});assert.equal(x.requests.size,0);
  }
 });
 await check('first saved style invalidates an earlier no-style readiness selection',async()=>{
  const x=fixture(null),q=await x.ask();x.setStyle(style());await assert.rejects(()=>x.admit(q),{code:'rehearsal_inputs_changed'});
 });
 await check('style revision before dispatch and after generation withholds the stale answer',async()=>{
  const x=fixture(),q=await x.ask();await x.admit(q);x.setStyle(style(2));await assert.rejects(()=>x.claim(q),{code:'rehearsal_inputs_changed'});
  const y=fixture(),fresh=await y.ask();await y.admit(fresh);const c=await y.claim(fresh);y.setStyle(style(2));
  await assert.rejects(()=>y.finish(fresh,c),{code:'rehearsal_inputs_changed'});assert.equal(y.requests.get(fresh.request_id).answer_envelope,undefined);
 });
 await check('completed reply and parent history become unavailable after a saved style correction',async()=>{
  const x=fixture(),q=await x.ask();await x.admit(q);await x.finish(q,await x.claim(q));
  x.setStyle(style(2,{...STYLE,directness:1}));
  const replay=await store.readPrivateTextRehearsal(x.db,x.f.owner,q,x.options);assert.equal(replay.state,'blocked');assert.equal(replay.answer,undefined);
  const next={...await x.ask(),parent_request_id:q.request_id};next.attestations.authorize_private_text_followup=true;
  await assert.rejects(()=>x.admit(next),{code:'rehearsal_parent_unavailable'});
  const corrected=await x.admit(await x.ask());assert.equal(corrected.compilerInput.vibe.directness,1);assert.deepEqual(corrected.compilerInput.history,[]);
 });
 await check('actual private handler passes only the admitted saved style to the provider prompt',async()=>{
  const x=fixture(),q=await x.ask(),before=structuredClone(x.f.row.sheet),req=new EventEmitter(),res=new EventEmitter();let generated=0;
  Object.assign(req,{method:'POST',body:{...q,op:'ask',vibe:{...STYLE,warmth:0}}});
  Object.assign(res,{writableEnded:false,status(code){this.code=code;return this;},json(value){this.body=value;this.writableEnded=true;return this;}});
  const handler=createPrivateTextRehearsalHandler({db:x.db,requireUser:async()=>({id:x.f.owner}),store,engine,env:x.options.env,
   hasGate:()=>true,honestyContextFor:()=>({}),loadNeverRules:async()=>[],compileNeverRules:()=>[],gateReply:(_,text)=>({gated:true,text,findings:[]}),
   budget:{foundryBudgetConfig:()=>({}),reserveFoundrySpend:async()=>({reservation_id:randomUUID(),budget_id:'synthetic-private-style',state:'reserved',request_hash:hash({operation:'dialogue',request_key:'private-text-rehearsal:'+q.request_id,provider_family:'dialogue',provider_name:'azure-foundry-structured-output',provider_version:'synthetic-v1',model:'synthetic-never-called'})}),beginFoundrySpend:async()=>{},settleFoundrySpend:async()=>{x.requests.get(q.request_id).spend_state='settled';},markFoundrySpendUncertain:async()=>{throw Error('unexpected uncertain spend');}},
   resolveGenerator:async()=>({family:'dialogue',name:'azure-foundry-structured-output',version:'synthetic-v1',model:'synthetic-never-called',billing:{meter:'azure_foundry_tokens'},generate:async({prompt})=>{
    generated++;assert(prompt.messages[0].content.includes(engine.renderVibe(STYLE)));
    return {output:{reply:'A synthetic saved answer.',delivery:{mode:'grounded',pace:'natural',intensity:0.3,language_hint:'en-IN',nonverbals:[]}},usage:{input_tokens:1,output_tokens:1}};
   }})});
  await handler(req,res);assert.equal(res.code,201,JSON.stringify(res.body));assert.equal(generated,1);assert.equal(res.body.rehearsal.can_voice,false);assert.deepEqual(x.f.row.sheet,before);
  assert(x.queries.every(({sql})=>!sql.includes('insert into vy_replica_vibe')&&!sql.includes('update vy_teacher_sheet')));
 });
 await check('captured SQL binds style selection and all private writes to both owner and replica',async()=>{
  const cases=await privateRehearsalVibeExplainCases();assert.equal(cases.length,10);
  for(const c of cases.filter(c=>c.name.startsWith('PRIVATE_TEXT_'))){
   assert(c.sql.includes('v.replica_id=r.replica_id and v.owner_user_id=r.owner_user_id'));
   if(!c.name.startsWith('PRIVATE_TEXT_SELECTION')){assert(c.sql.includes("is not distinct from ($7::jsonb->'vibe')"));assert(c.sql.includes("(r.metadata->>'private_text_style_revision') is not distinct from ($7::jsonb->>'style_revision')"));assert(c.sql.includes('and r.private_text_epoch=$6::bigint'));}
  }
  for(const c of cases.filter(c=>c.name.startsWith('VIBE_'))){
   assert(c.sql.includes('where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid'));
   assert(c.sql.includes('from owned o where v.replica_id=o.replica_id and v.owner_user_id=o.owner_user_id'));
   if(c.name==='VIBE_REVERT_SQL')assert(c.sql.includes('and exists(select 1 from target)'));
  }
 });
 await check('style writers preserve the shared voice/comparison/liveness epoch and existing provenance',async()=>{
  // These three real consumers bind the shared epoch. The style statements may
  // change only their own metadata key, never that epoch or identity columns.
  for(const sql of [PRIVATE_VOICE_CANDIDATE_CTES,COMPARISON_PREPARATION_SNAPSHOT_SQL,MODERN_AUTHORITY_SNAPSHOT_SQL]){
   assert(sql.includes('r.private_text_epoch'));assert(!sql.includes('private_text_style_revision'));
  }
  const scopedWrite=sql=>{
   const assignments=sql.match(/update vy_replica r set ([\s\S]*?)\n\s*where/)?.[1];
   assert.match(assignments||'',/^metadata=r\.metadata\|\|jsonb_build_object\('private_text_style_revision',\$[34]::uuid::text\)$/);
   assert(sql.includes("jsonb_typeof(r.metadata)='object'"));
   assert(!sql.includes('private_text_epoch'));
  };
  for(const c of (await privateRehearsalVibeExplainCases()).filter(c=>c.name.startsWith('VIBE_'))){
   scopedWrite(c.sql);
   // This is the rejected implementation: prove the regression control fails.
   assert.throws(()=>scopedWrite(c.sql.replace('set metadata=','set private_text_epoch=r.private_text_epoch+1, metadata=')));
   const parameter=c.name==='VIBE_SET_SQL'?3:4;
   assert(c.sql.includes(`'private_text_style_revision',$${parameter}::uuid::text`));
   assert(c.sql.includes(`select $${parameter}::uuid,`));
  }
 });
 await check('legacy saved style works until its first scoped revision; malformed or stale markers fail closed',async()=>{
  const legacy=fixture();delete legacy.f.row.style_revision;
  const q=await legacy.ask(),a=await legacy.admit(q);assert(a.compilerInput.vibe);assert(!Object.hasOwn(legacy.requests.get(q.request_id).snapshot,'style_revision'));
  legacy.setStyle(style(2));await assert.rejects(()=>legacy.claim(q),{code:'rehearsal_inputs_changed'});
  for(const marker of ['',randomUUID(),'malformed']){
   const x=fixture();x.f.row.style_revision=marker;const r=await x.ready();assert.equal(r.state,'unavailable');assert.equal(r.blockers[0].code,'rehearsal_saved_style_unavailable');
  }
  const x=fixture(),old=await x.ask();await x.admit(old);
  // Simulates a pre-marker deployment replacing style without its marker.
  x.f.row.saved_vibe=style(2);
  const r=await x.ready();assert.equal(r.can_ask,false);assert.equal(r.blockers[0].responsibility,'platform');
  await assert.rejects(()=>store.readPrivateTextRehearsal(x.db,x.f.owner,old,x.options),{code:'rehearsal_read_unavailable'});
 });
 await check('interposed style revisions refuse admit claim and completion without changing the shared epoch',async()=>{
  for(const stage of ['ADMIT','CLAIM','COMPLETE']){
   const x=fixture(),q=await x.ask(),before=x.f.row.private_text_epoch;let c;
   if(stage!=='ADMIT')await x.admit(q);if(stage==='COMPLETE')c=await x.claim(q);
   x.hooks.beforeWrite=sql=>{if(sql===store[`PRIVATE_TEXT_${stage}_SQL`]){x.hooks.beforeWrite=null;x.setStyle(style(2));}};
   const action=stage==='ADMIT'?()=>x.admit(q):stage==='CLAIM'?()=>x.claim(q):()=>x.finish(q,c);
   const code={ADMIT:'rehearsal_admission_blocked',CLAIM:'rehearsal_dispatch_unavailable',COMPLETE:'rehearsal_commit_blocked'}[stage];
   await assert.rejects(action,{code});assert.equal(x.f.row.private_text_epoch,before);assert.equal(x.requests.get(q.request_id)?.answer_envelope,undefined);
  }
 });
 console.log(`${n} private saved-style groups passed; synthetic store/provider fixtures and actual compiler, no live SQL/model quality claim.`);
 return {passed:n};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runPrivateRehearsalVibeChecks();
