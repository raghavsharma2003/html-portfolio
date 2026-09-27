import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fixture} from '../azure-voice-app/controller.test.mjs';
import {commitment} from '../azure-voice-app/controller.mjs';
import {wav,signedResponse,signedRuntimeStatus} from '../internal-voice/fixtures.mjs';
import {createFakeProtectionAdapters} from '../../api/_provenance/providers/fake.js';
import {createPrivateVoiceRuntime} from './runtime.mjs';
import {createPrivateVoiceServer} from './server.mjs';
import {createPrivateVoiceProxy} from '../../api/_private-voice-proxy.js';
import {readPrivateReplicaObject,writeImmutableReplicaArtifact} from '../../api/_replica-storage.js';
import {leaseNextSourceErasure,renewSourceErasureLease,completeSourceErasure} from '../../api/_replica-source-erasure.js';
import {createPrivateLifecycle,LIFE_SQL} from './lifecycle.mjs';
import {SQL,AUTHORITY} from './store.mjs';
import {PRIVATE_LEDGER_SQL} from '../../api/_provenance/private-voice-ledger.js';
import {GPU_WINDOW_SQL} from '../../api/_gpu-allocation-budget.js';
import {VOICE_APP_SQL} from '../../api/_voice/allocation-boundary.js';
import {PRIVATE_VOICE_RECENT_SQL,PRIVATE_VOICE_CANDIDATES_SQL,PRIVATE_VOICE_READ_SQL,PRIVATE_VOICE_ADMIT_SQL,PRIVATE_VOICE_REVOKE_SQL,
 privateVoiceHash,PRIVATE_VOICE_STATEMENT_SET} from '../../api/_private-voice-store.js';
const owner='11111111-1111-4111-8111-111111111111',replica='22222222-2222-4222-8222-222222222222';
const source='33333333-3333-4333-8333-333333333333',artifact='44444444-4444-4444-8444-444444444444';
const other='55555555-5555-4555-8555-555555555555',sha=x=>createHash('sha256').update(x).digest('hex');
// Synthetic transport credentials in this test process only. Never read a
// retained credential or call an actual Azure/Storage/Neon endpoint.
process.env.AZURE_REPLICA_STORAGE_ACCOUNT='privatevoicetest';
process.env.AZURE_REPLICA_STORAGE_CONTAINER='replica-private';
process.env.AZURE_REPLICA_STORAGE_ACCOUNT_KEY=Buffer.alloc(32,7).toString('base64');
const bucket='azureblob:privatevoicetest:replica-private';

// This models SQL results, not Postgres parsing, types, locking or FKs.
// All production handler/store/worker/controller/provider code executes.
async function setup(options={}){
 const f=fixture(),now=f.options.now,iso=()=>new Date(now()).toISOString(),ref=wav();
 const runs=new Map(),windows=new Map(),blobs=new Map(),blocks=new Map(),calls=[],storageCalls=[];let authority=true,reserved=0,staleSupervisor=false;
 const snapshot={owner_user_id:owner,replica_id:replica,source_id:source,artifact_id:artifact,artifact_sha256:sha(ref),
  source_sha256:sha(ref),artifact_manifest_hash:'a'.repeat(64),byte_size:ref.length,duration_ms:5000,
  storage_bucket:bucket,object_path:`${owner}/${replica}/${source}/derived/reference.wav`,mime:'audio/wav',
  job_id:randomUUID(),job_revision:1,job_manifest_hash:'b'.repeat(64),authority_epoch:'0',capture_consent_id:randomUUID(),
  capture_receipt_hash:'c'.repeat(64),storage_consent_id:randomUUID(),storage_receipt_hash:'d'.repeat(64)};
 const current=r=>r&&authority&&!r.revoked_at&&Date.parse(r.expires_at)>now();
 const owned=(p,i=2)=>{const r=runs.get(p[i]);return r&&r.replica_id===p[0]&&r.owner_user_id===p[1]?r:null;};
 const fenced=p=>{const r=owned(p,4);return current(r)&&r.source_id===p[2]&&r.artifact_id===p[3]&&r.state==='running'&&r.lease_token_hash===p[5]&&Date.parse(r.lease_expires_at)>now()?r:null;};
 const result=r=>r?[structuredClone(r)]:[];
 const db=async(sql,p=[])=>{
  if(sql===PRIVATE_VOICE_RECENT_SQL){const r=[...runs.values()].reverse().find(r=>r.replica_id===p[0]&&r.owner_user_id===p[1]&&!r.revoked_at&&Date.parse(r.expires_at)>now()&&!(["revoked","expired"].includes(r.state)));return r?[{run_id:r.run_id}]:[];}
  if(sql===PRIVATE_VOICE_CANDIDATES_SQL)return authority&&p[0]===replica&&p[1]===owner&&(!p[2]||p[2]===source)&&(!p[3]||p[3]===artifact)?[{snapshot:structuredClone(snapshot)}]:[];
  if(sql===PRIVATE_VOICE_READ_SQL){const r=owned(p);if(!r)return [];const w=windows.get(r.window_id);return result({...r,window_state:w?.state,resource_released_at:w?.resource_released_at});}
  if(sql===PRIVATE_VOICE_ADMIT_SQL){if(!authority||runs.has(p[4]))return [];const r={run_id:p[4],replica_id:p[0],owner_user_id:p[1],source_id:p[2],artifact_id:p[3],request_hash:p[5],snapshot_hash:p[6],snapshot:JSON.parse(p[7]),receipt:JSON.parse(p[8]),receipt_hash:p[9],config:JSON.parse(p[10]),config_hash:p[11],expires_at:p[12],created_at:iso(),state:'queued',reference_sha256:snapshot.artifact_sha256,text_sha256:JSON.parse(p[10]).text_sha256,output_storage_bucket:bucket,output_object_path:`${owner}/${replica}/${source}/derived/private-voice/${p[4]}.wav`};runs.set(r.run_id,r);return result(r);}
  if(sql===SQL.claim){const r=owned(p);if(!current(r)||r.window_id||!(r.state==='queued'||r.state==='claimed'&&Date.parse(r.lease_expires_at)<=now()))return [];
   Object.assign(r,{state:'claimed',lease_token_hash:p[3],lease_expires_at:new Date(now()+600000).toISOString()});return result(r);}
  if(sql===SQL.start){const r=owned(p,4);if(!current(r)||r.state!=='claimed'||r.lease_token_hash!==p[5])return [];r.state='running';return result(r);}
  if(sql===SQL.check||sql===`with ${AUTHORITY} select * from authorized`)return result(fenced(p));
  if(sql===SQL.renew){const r=fenced(p);if(r)r.lease_expires_at=new Date(Math.min(Date.parse(r.expires_at),now()+600000)).toISOString();return result(r);}
  if(sql===SQL.write){const r=fenced(p);if(r){r.output_write_not_after=new Date(now()+90000).toISOString();r.lease_expires_at=new Date(Math.min(Date.parse(r.expires_at),Math.max(Date.parse(r.lease_expires_at),now()+120000))).toISOString();}return result(r);}
  if(sql===SQL.settle){const r=fenced(p);if(!r||r.protection?.state!=='sealed'||r.output_deleted_at||Date.parse(r.output_write_not_after)<=now())return [];
   assert.deepEqual(r.protection.receipt,JSON.parse(p[7]));Object.assign(r,{state:'ready',output_sha256:p[6],output_receipt:JSON.parse(p[7]),metrics:JSON.parse(p[8]),lease_expires_at:iso()});return result(r);}
  if(sql===SQL.fail){const r=owned(p);if(r&&!r.revoked_at&&r.lease_token_hash===p[3]&&['claimed','running'].includes(r.state)){r.state=r.window_id||r.output_write_not_after?'unknown':'failed';r.error_code=p[4];r.lease_expires_at=iso();return result(r);}return [];}
  if(sql===SQL.stale){const r=owned(p);if(r?.state==='running'&&Date.parse(r.lease_expires_at)<=now()){r.state='unknown';r.error_code='private_voice_worker_expired';}return [];}
  if(sql===PRIVATE_VOICE_REVOKE_SQL){const r=owned(p);if(!r)return [];r.state='revoked';r.revoked_at=iso();const w=windows.get(r.window_id);if(w?.state==='open')w.state='closing';return result(r);}
  if(sql.startsWith('select window_id from vy_private_voice_run'))return result(owned(p));
  if(sql===SQL.rate){const r=owned(p,4);if(!current(r)||r.state!=='ready'||r.output_deleted_at)return [];r.ratings=JSON.parse(p[5]);return result(r);}
  if(sql===SQL.cleanup)return [...runs.values()].filter(r=>(r.revoked_at||Date.parse(r.expires_at)<=now()||['failed','unknown'].includes(r.state))&&!r.output_deleted_at&&Date.parse(r.lease_expires_at||0)<=now()&&Date.parse(r.output_write_not_after||0)<=now()&&(!r.window_id||windows.get(r.window_id)?.resource_released_at)).map(r=>structuredClone(r));
  if(sql===SQL.deleted){const r=runs.get(p[0]);if(!r||r.owner_user_id!==p[1]||r.output_object_path!==p[2])return [];r.output_deleted_at=iso();return result(r);}
  if(sql===LIFE_SQL.lookup)return result([...runs.values()].find(r=>r.window_id===p[0]));
  if(sql===GPU_WINDOW_SQL.reserve){if(options.budgetDenied||reserved+p[6]>p[1])return [];reserved+=p[6];const w={window_id:randomUUID(),budget_id:p[0],resource_sha256:p[2],revision_sha256:p[3],request_sha256:p[4],contract_sha256:p[5],reserved_microusd:p[6],max_allocation_seconds:p[7],provider_request_sha256:p[8],accounting_basis:p[9],state:'reserved'};windows.set(w.window_id,w);return result(w);}
  if(sql===GPU_WINDOW_SQL.existing)return result([...windows.values()].find(w=>w.budget_id===p[0]&&w.request_sha256===p[1]));
  if(sql===LIFE_SQL.bind){const r=fenced(p),w=windows.get(p[6]);if(!r||r.window_id||w?.state!=='reserved')return [];
   r.window_id=w.window_id;r.children=JSON.parse(p[10]);r.allocation_plan=JSON.parse(p[9]);Object.assign(w,r.allocation_plan,{state:'open',allocation_state:'in_flight',begun_at:iso(),dispatch_deadline_at:new Date(now()+420000).toISOString(),activation_state:'not_started',deactivation_state:'not_started'});return result(r);}
  if(sql===LIFE_SQL.activate||sql===LIFE_SQL.dispatch){const r=fenced(p),w=windows.get(r?.window_id);if(!w||w.state!=='open')return [];
   if(sql===LIFE_SQL.activate){if(w.activation_state!=='not_started')return [];w.activation_state='claimed';}else{if(w.activation_state!=='claimed'||w.activation_dispatched_at)return [];w.activation_dispatched_at=iso();}return result(w);}
  if(sql===LIFE_SQL.consume){const r=fenced(p),w=windows.get(r?.window_id);const c=r?.children.find(c=>c.child_id===p[6]);
   if(!w||w.state!=='open'||w.activation_state!=='acknowledged'||Date.parse(w.dispatch_deadline_at)<=now()||staleSupervisor||!c||c.consumed_at||c.operation!==p[7]||c.body_sha256!==p[8]||w.broker_origin!==p[9]||w.runtime_origin!==p[10])return [];
   c.consumed_at=iso();return [{dispatch_not_after:w.dispatch_deadline_at}];}
  if(sql.startsWith('select *,now()::text as server_now'))return [{...await f.options.lifecycleStore.getSupervisorLease(),...(staleSupervisor?{lease_expires_at:new Date(now()-1)}:{})}];
  if(sql===VOICE_APP_SQL.get)return result(windows.get(p[0]));
  if(sql===VOICE_APP_SQL.activationResult){const w=windows.get(p[0]);if(w?.activation_state!=='claimed')return [];w.activation_state=p[1];return result(w);}
  if(sql===VOICE_APP_SQL.revoke){const w=windows.get(p[0]);if(w?.state==='open')w.state='closing';return result(w);}
  if(sql===VOICE_APP_SQL.claim){const w=windows.get(p[0]);if(w?.state!=='closing'||w.deactivation_state!=='not_started')return [];w.state='close_claimed';w.deactivation_state='claimed';return result(w);}
  if(sql===VOICE_APP_SQL.deactivateDispatch){const w=windows.get(p[0]);if(!w||w.deactivation_dispatched_at)return [];w.deactivation_dispatched_at=iso();return result(w);}
  if(sql===VOICE_APP_SQL.deactivationResult){const w=windows.get(p[0]);w.deactivation_state=p[1];return result(w);}
  if(sql===VOICE_APP_SQL.observe){const w=windows.get(p[0]);w.state=p[1];w.observation=JSON.parse(p[2]);return result(w);}
  if(sql===GPU_WINDOW_SQL.releaseResource){const w=windows.get(p[0]);w.resource_released_at=iso();return result(w);}
  if(sql===GPU_WINDOW_SQL.uncertain||sql===GPU_WINDOW_SQL.release)return [];
  for(const [op,statement] of Object.entries(PRIVATE_LEDGER_SQL))if(sql===statement){const r=fenced(p);if(!r)return [];
   if(op==='open'){if(r.protection)return [];r.protection={state:'open',open:JSON.parse(p[6]),segments:[]};}
   if(op==='append'){const receipt=JSON.parse(p[6]);if(r.protection.state!=='open'||r.protection.segments.length!==receipt.sequence)return [];r.protection.segments.push(receipt);}
   if(op==='manifest')r.protection.manifest=JSON.parse(p[6]);
   if(op==='seal'){if(r.protection.segments.length!==p[8])return [];r.protection.state='sealed';r.protection.receipt=JSON.parse(p[6]);}
   if(op==='abort')r.protection={...r.protection,state:'aborted'};return result(r);}
  if(sql.includes("to_regclass('public.vy_private_voice_run')"))return [{private_voice_present:false}];
  throw Error(`unmodeled SQL: ${sql.slice(0,95)}`);
 };
 f.options.policy.budget_id='gpu-private-tests';
 const env={VYAKTI_PRIVATE_VOICE_MODE:'account-private',VYAKTI_MODEL_SERVING:'azure_only',AZURE_VOICE_APP_ENABLED:'true',
  AZURE_OPEN_VOICE_ORIGIN:f.plan.broker_origin,OPEN_VOICE_HMAC_SECRET:'ab'.repeat(32),OPEN_VOICE_MODEL_ARM:'hindi_v3',
  AZURE_VOICE_APP_PLAN_JSON:JSON.stringify(f.plan),AZURE_VOICE_APP_POLICY_JSON:JSON.stringify(f.options.policy),
  AZURE_VOICE_APP_APPROVAL_SHA256:commitment({plan:f.plan,policy:f.options.policy}),AZURE_VOICE_APP_BUDGET_ID:f.options.policy.budget_id,
  IDENTITY_ENDPOINT:'http://127.0.0.1/token',IDENTITY_HEADER:'test-only',SUPABASE_URL:'https://auth.test',SUPABASE_KEY:'test-only'};
 let lifecycle,transportHook=options.hook;
 const fetchImpl=async(url,init)=>{
  const u=new URL(url);if(u.hostname==='127.0.0.1')return Response.json({access_token:'test-only'});
  if(u.hostname==='privatevoicetest.blob.core.windows.net'){
   const path=decodeURIComponent(u.pathname.slice('/replica-private/'.length)),method=init.method||'GET',comp=u.searchParams.get('comp');storageCalls.push({method,comp});
   if(method==='GET'){const bytes=path===snapshot.object_path?ref:blobs.get(path);return bytes?new Response(bytes,{headers:{'content-type':'audio/wav','content-length':String(bytes.length),etag:'test-etag'}}):new Response(null,{status:404});}
   if(method==='PUT'&&comp==='block'){blocks.set(u.searchParams.get('blockid'),Buffer.from(init.body));return new Response(null,{status:201});}
   if(method==='PUT'&&comp==='blocklist'){assert.equal(init.headers['If-None-Match'],'*');if(blobs.has(path))return new Response(null,{status:412});
    const ids=[...Buffer.from(init.body).toString().matchAll(/<Latest>([^<]+)<\/Latest>/g)].map(m=>m[1]);blobs.set(path,Buffer.concat(ids.map(id=>blocks.get(id))));
    if(options.nearLeaseExpiry)f.time(60000);
    if(options.writeUnknown)throw Error('synthetic lost blob acknowledgement');return new Response(null,{status:201});}
   throw Error('unmodeled synthetic blob request');
  }
  if(u.hostname==='auth.test')return init.headers.Authorization==='Bearer good'?Response.json({id:owner}):init.headers.Authorization==='Bearer other'?Response.json({id:other}):new Response(null,{status:401});
  if(u.hostname==='management.azure.com'){if(options.armUnknown&&init.method==='POST'&&u.pathname.endsWith('/activate'))throw Error('synthetic lost ARM acknowledgement');return f.options.fetch(url,init);}
  const operation=u.pathname==='/v1/runtime-status'?'status':'synthesize';
  if(transportHook)await transportHook(operation,{runs,authority:value=>{authority=value;}});
  const consume={window_id:init.headers['X-Vyakti-Allocation-Window'],child_id:init.headers['X-Vyakti-Allocation-Child'],operation,body_sha256:sha(init.body),broker_origin:f.plan.broker_origin,runtime_origin:f.plan.runtime_origin};
  calls.push({operation,body:JSON.parse(init.body),consume});await lifecycle.consume(consume);
  if(options.providerFailure&&operation==='synthesize')throw Error('synthetic provider timeout');
  return (operation==='status'?signedRuntimeStatus(url,init):signedResponse(url,init)).response;
 };
 lifecycle=createPrivateLifecycle({db,env,fetchImpl,now});
 const storage={
  read:readPrivateReplicaObject,
  async write(input,opts){if(options.nearLeaseExpiry)f.time(590000);return writeImmutableReplicaArtifact(input,{...opts,beforeWriteRequest:async request=>{
   await opts.beforeWriteRequest(request);if(options.revokeBeforeWrite)authority=false;}});},
  async delete(locator){blobs.delete(locator.objectPath);},
 };
 const runtime=createPrivateVoiceRuntime({db,env,fetchImpl,now,lifecycle,storage,allowTestAdapters:true,protectionFactory:()=>{
  const {adapters}=createFakeProtectionAdapters();if(options.protectionFailure)adapters.watermark.embed=async()=>{throw Error('synthetic watermark failure');};return adapters;
 }});
 const server=createPrivateVoiceServer({env,runtime,fetchImpl});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const request=async(input={},token='good',method='POST')=>{
  const url=method==='GET'?`${origin}/api/private-voice?${new URLSearchParams(input)}`:`${origin}/api/private-voice`;
  const r=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:method==='POST'?JSON.stringify(input):undefined});
  return {status:r.status,body:r.headers.get('content-type')==='audio/wav'?Buffer.from(await r.arrayBuffer()):await r.json()};
 };
 const generate=async(run_id=randomUUID(),extra={})=>request({action:'generate',replica_id:replica,source_id:source,artifact_id:artifact,run_id,
  expected_snapshot_hash:privateVoiceHash(snapshot),statement_set:PRIVATE_VOICE_STATEMENT_SET,attestations:{own_voice_private_use:true},...extra});
 return {runtime,server,request,generate,runs,windows,blobs,calls,storageCalls,f,env,db,lifecycle,snapshot,
  stop:async()=>{await Promise.all(runtime.active.values());await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});},
  drain:()=>Promise.all(runtime.active.values()),authority:value=>{authority=value;},supervisorStale:()=>{staleSupervisor=true;}};
}

test('private HTTP -> actual worker/controller/provider/protection -> saved WAV, rate, replay refusal, withdrawal',async()=>{
 const t=await setup();try{
  assert.equal((await t.request({replica_id:replica},'bad','GET')).status,401);
  const c=await t.request({replica_id:replica},'good','GET');assert.equal(c.body.candidates.length,1);assert.equal(JSON.stringify(c.body).includes('storage_bucket'),false);
  const accepted=await t.generate();assert.equal(accepted.status,202,JSON.stringify(accepted));const id=accepted.body.run.run_id;await t.drain();
  const row=t.runs.get(id);assert.equal(row.state,'ready',JSON.stringify(row));assert.equal(row.protection.state,'sealed');assert.ok(row.protection.segments.length>0);
  assert.equal(t.storageCalls.filter(c=>c.method==='PUT'&&c.comp==='blocklist').length,1);assert.ok(t.storageCalls.filter(c=>c.method==='GET').length>=2);
  assert.equal(t.calls.filter(c=>c.operation==='synthesize').length,1);const call=t.calls.find(c=>c.operation==='synthesize');
  assert.equal(call.body.language_id,'hi');assert.equal(call.body.model_arm,'hindi_v3');assert.equal(call.body.cfg_weight,0);assert.equal(call.body.text_segment_count,1);
  assert.ok(call.body.disclosure_text);assert.equal(row.receipt.identity_claim_allowed,false);
  const audio=await t.request({replica_id:replica,run_id:id,action:'audio'},'good','GET');assert.equal(audio.status,200);assert.equal(sha(audio.body),row.output_sha256);
  for(const action of ['status','audio'])assert.notEqual((await t.request({replica_id:replica,run_id:id,action},'other','GET')).status,200);
  for(const action of ['rate','revoke'])assert.notEqual((await t.request({replica_id:replica,run_id:id,action, ...(action==='rate'?{ratings:{owner_likeness:3,naturalness:3,indian_accent:3,pronunciation:3}}:{})},'other')).status,200);
  const rated=await t.request({action:'rate',replica_id:replica,run_id:id,ratings:{owner_likeness:2,naturalness:3,indian_accent:4,pronunciation:5}});assert.equal(rated.body.run.ratings.owner_likeness,2);
  await t.generate(id);await t.drain();assert.equal(t.calls.length,2);await assert.rejects(t.lifecycle.consume(call.consume));
  await t.request({action:'revoke',replica_id:replica,run_id:id});assert.notEqual((await t.request({replica_id:replica,run_id:id,action:'audio'},'good','GET')).status,200);
  t.f.time(90001);await t.runtime.maintenance();assert.equal(t.blobs.size,0);
 }finally{await t.stop();}
});
for(const mode of ['providerFailure','writeUnknown','armUnknown','protectionFailure','revokeBeforeWrite'])test(`${mode} never settles ready or automatically replays`,async()=>{
 const t=await setup({[mode]:true});try{const accepted=await t.generate();assert.equal(accepted.status,202);const id=accepted.body.run.run_id;await t.drain();
  assert.equal(t.runs.get(id).state,'unknown',JSON.stringify(t.runs.get(id)));const count=t.calls.length;
  assert.equal(t.calls.filter(c=>c.operation==='synthesize').length,mode==='armUnknown'?0:1);
  assert.equal(t.blobs.size,mode==='writeUnknown'?1:0);
  if(mode==='writeUnknown')assert.equal(t.runs.get(id).protection.state,'sealed');
  if(mode==='protectionFailure')assert.equal(t.runs.get(id).protection.state,'aborted');
  await t.request({action:'status',replica_id:replica,run_id:id},'good','GET');await t.drain();assert.equal(t.calls.length,count);
  assert.notEqual((await t.request({action:'audio',replica_id:replica,run_id:id},'good','GET')).status,200);
 }finally{await t.stop();}
});
test('scope, settings, attestation and snapshot tampering fail before dispatch',async()=>{
 const t=await setup();try{for(const extra of [{language_id:'en'},{owner_user_id:other},{text:'injected'},{attestations:{own_voice_private_use:false}},{expected_snapshot_hash:'f'.repeat(64)},{source_id:other}])assert.notEqual((await t.generate(randomUUID(),extra)).status,202);
  assert.deepEqual((await t.request({replica_id:replica},'other','GET')).body.candidates,[]);assert.equal(t.calls.length,0);
 }finally{await t.stop();}
});
test('missing supervisor and cost admission refusal produce no synthesis',async()=>{
 for(const mode of ['supervisor','budget']){const t=await setup({budgetDenied:mode==='budget'});try{if(mode==='supervisor')t.supervisorStale();const a=await t.generate();await t.drain();assert.notEqual(t.runs.get(a.body.run.run_id).state,'ready');assert.equal(t.calls.length,0);}finally{await t.stop();}}
});
test('source withdrawal immediately before broker child consumption wins',async()=>{
 const t=await setup({hook:async(operation,state)=>{if(operation==='synthesize')state.authority(false);}});try{const a=await t.generate();await t.drain();assert.notEqual(t.runs.get(a.body.run.run_id).state,'ready');assert.equal(t.blobs.size,0);}finally{await t.stop();}
});
test('grant expiry refuses playback',async()=>{
 const t=await setup();try{const a=await t.generate();await t.drain();const id=a.body.run.run_id;assert.equal(t.runs.get(id).state,'ready');t.f.time(86400001);
  assert.equal((await t.request({action:'status',replica_id:replica,run_id:id},'good','GET')).body.run.state,'expired');
  assert.notEqual((await t.request({action:'audio',replica_id:replica,run_id:id},'good','GET')).status,200);
 }finally{await t.stop();}
});
test('queued admission with lost kick recovers by HTTP poll; expired running lease does not replay',async()=>{
 const t=await setup();try{const run_id=randomUUID(),input={replica_id:replica,source_id:source,artifact_id:artifact,run_id,
  expected_snapshot_hash:privateVoiceHash(t.snapshot),statement_set:PRIVATE_VOICE_STATEMENT_SET,attestations:{own_voice_private_use:true}};
  await t.runtime.store.admit(owner,input);assert.equal(t.calls.length,0);
  const status=await t.request({action:'status',replica_id:replica,run_id},'good','GET');assert.equal(status.status,200);await t.drain();assert.equal(t.runs.get(run_id).state,'ready');
  const before=t.calls.length,row=t.runs.get(run_id);row.state='running';row.lease_expires_at=new Date(t.f.options.now()-1).toISOString();
  await t.request({action:'status',replica_id:replica,run_id},'good','GET');await t.drain();assert.equal(row.state,'unknown');assert.equal(t.calls.length,before);
 }finally{await t.stop();}
});
test('lease replacement between synthesis and protection refuses finalization',async()=>{
 const t=await setup({hook:async(operation,{runs})=>{if(operation==='synthesize'){const row=[...runs.values()][0];row.lease_token_hash='f'.repeat(64);}}});
 try{const accepted=await t.generate();await t.drain();assert.notEqual(t.runs.get(accepted.body.run.run_id).state,'ready');assert.equal(t.blobs.size,0);}finally{await t.stop();}
});
test('Vercel proxy preserves bearer to exact CPU origin and keeps authentication distinct from disabled',async()=>{
 const invoke=async(env,requireUser,fetchImpl)=>{let status,body;const headers={};
  const res={setHeader:(k,v)=>{headers[k]=v;},status:s=>{status=s;return res;},json:b=>{body=b;},send:b=>{body=JSON.parse(b);}};
  await createPrivateVoiceProxy({env,requireUser,fetchImpl})({method:'GET',url:`/api/private-voice?replica_id=${replica}`,headers:{authorization:'Bearer test-session'}},res);return {status,body,headers};};
 const env={VYAKTI_PRIVATE_VOICE_MODE:'account-private',VYAKTI_PRIVATE_VOICE_ORIGIN:'https://cpu.test.azurecontainerapps.io'};
 const good=await invoke(env,async()=>({id:owner}),async(url,init)=>{assert.equal(url.origin,env.VYAKTI_PRIVATE_VOICE_ORIGIN);assert.equal(url.pathname,'/api/private-voice');assert.equal(init.headers.Authorization,'Bearer test-session');assert.equal(init.redirect,'error');return Response.json({enabled:true,candidates:[]});});
 assert.equal(good.status,200);assert.equal(good.headers['Cache-Control'],'private, no-store');
 const denied=await invoke(env,async()=>{throw Object.assign(Error(),{status:401,code:'private_voice_session_invalid'});},()=>{throw Error('must not proxy');});assert.equal(denied.status,401);assert.equal(denied.body.enabled,undefined);
 assert.equal((await invoke({},()=>{throw Error('disabled');},()=>{throw Error('disabled');})).status,404);
 assert.equal((await invoke({...env,VYAKTI_PRIVATE_VOICE_ORIGIN:'https://attacker.invalid'},async()=>({id:owner}),()=>{throw Error('must not proxy');})).status,503);
});
test('source erasure catalog guard preserves pre-migration SQL and fences every private lease/write/window',async()=>{
 for(const present of [false,true]){const seen=[];const db=async(sql)=>{seen.push(sql);return sql.includes('to_regclass')?[{private_voice_present:present}]:[];};
  await leaseNextSourceErasure(db);const lease={source:{sourceId:source,replicaId:replica,ownerUserId:owner},leaseToken:'x'.repeat(40)};
  await assert.rejects(renewSourceErasureLease(db,lease));await assert.rejects(completeSourceErasure(db,lease));
  const statements=seen.filter(s=>!s.includes('to_regclass'));
  if(!present)assert.ok(statements.every(s=>!s.includes('vy_private_voice_run')));
  else{const gated=statements.filter(s=>s.includes('pv.lease_expires_at>now()'));assert.equal(gated.length,3);
   for(const statement of gated){assert.ok(statement.includes('pv.output_write_not_after>now()'));assert.ok(statement.includes('vw.resource_released_at is null'));assert.ok(statement.includes('pv.owner_user_id=s.owner_user_id'));}
   assert.ok(statements.some(s=>s.includes('pv.output_storage_bucket bucket,pv.output_object_path path')));
   assert.ok(statements.some(s=>s.includes("set state='revoked'")));}
 }
});
test('Docker positive file list includes every static runtime import and excludes secret config',()=>{
 const root=resolve(import.meta.dirname,'../..'),docker=readFileSync(resolve(root,'services/private-voice/Dockerfile'),'utf8');
 const bundled=new Set([...docker.matchAll(/COPY \["([^"]+)"/g)].map(m=>m[1]));const visited=new Set();
 const walk=path=>{if(visited.has(path))return;visited.add(path);const sourceText=readFileSync(resolve(root,path),'utf8');
  for(const match of sourceText.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)){const next=relative(root,resolve(root,dirname(path),match[1])).replaceAll('\\','/');
   assert.ok(bundled.has(next),`missing packaged runtime dependency ${next}`);walk(next);}};
 walk('services/private-voice/server.mjs');assert.ok(!bundled.has('api/_config.js'));assert.ok(!docker.includes('COPY . '));
});
test('near-expiry write renews run authority through upload verification without dropping its erasure horizon',async()=>{
 const t=await setup({nearLeaseExpiry:true});try{const a=await t.generate();await t.drain();const row=t.runs.get(a.body.run.run_id);
  assert.equal(row.state,'ready',row.error_code);assert.ok(Date.parse(row.output_write_not_after)>t.f.options.now());assert.ok(row.output_sha256);
 }finally{await t.stop();}
});

test('an owned run is discoverable without browser storage and discovery never synthesizes',async()=>{
 const t=await setup();try{
  const accepted=await t.generate();await t.drain();const before=t.calls.length;
  const c=await t.request({replica_id:replica},'good','GET');
  assert.equal(c.status,200);assert.equal(c.body.resume_run_id,accepted.body.run.run_id);assert.equal(t.calls.length,before);
  assert.deepEqual(await t.db(PRIVATE_VOICE_RECENT_SQL,[replica,other]),[]);
  await t.request({action:'revoke',replica_id:replica,run_id:accepted.body.run.run_id});
  assert.equal((await t.request({replica_id:replica},'good','GET')).body.resume_run_id,null);
 }finally{await t.stop();}
});
