import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../azure-voice-app/controller.test.mjs';
import {createInternalVoiceRuntime} from './runtime.mjs';
import {createBlobStore} from './blob-store.mjs';
import {authorizeOwner,sha,SCOPE,ratings} from './contract.mjs';
import {commitment} from '../azure-voice-app/controller.mjs';
import {wav,signedResponse,signedRuntimeStatus} from './fixtures.mjs';
const owner='11111111-1111-4111-8111-111111111111',replica='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
function blobTransport(){
  const blobs=new Map();let version=0,unknown=false;
  return{blobs,unknown:()=>{unknown=true;},request:async(name,options={})=>{
    const row=blobs.get(name),method=options.method||'GET';
    if(method==='GET')return row?new Response(row.bytes,{headers:{etag:row.etag}}):new Response(null,{status:404});
    if(method==='DELETE'){blobs.delete(name);return new Response(null,{status:202});}
    if(options.headers['If-None-Match']==='*'&&row||options.headers['If-Match']&&options.headers['If-Match']!==row?.etag)return new Response(null,{status:412});
    blobs.set(name,{bytes:Buffer.from(options.body),etag:`"${++version}"`});
    if(unknown){unknown=false;throw new Error('synthetic lost acknowledgement');}return new Response(null,{status:201});
  }};
}
async function setup({failSynthesis=false,modelArm='general'}={}){
  const f=fixture(),ref=wav(),transport=blobTransport(),grant={authorization_id:'44444444-4444-4444-8444-444444444444',scope:SCOPE,owner_user_id:owner,replica_id:replica,
    reference_sha256:sha(ref),identity_claim_allowed:false,release_eligible:false,training_allowed:false,purposes:['reference_processing','zero_shot_synthesis','private_playback','owner_ratings'],expires_at:new Date(f.options.now()+3600000).toISOString()};
  const env={VYAKTI_INTERNAL_VOICE_MODE:'owner-only',VYAKTI_MODEL_SERVING:'azure_only',VYAKTI_INTERNAL_VOICE_OWNER_USER_ID:owner,VYAKTI_INTERNAL_VOICE_REPLICA_ID:replica,
    VYAKTI_INTERNAL_VOICE_AUTHORIZATION_JSON:JSON.stringify(grant),VYAKTI_INTERNAL_VOICE_AUTHORIZATION_SHA256:sha(JSON.stringify(grant)),
    AZURE_VOICE_APP_PLAN_JSON:JSON.stringify(f.plan),AZURE_VOICE_APP_POLICY_JSON:JSON.stringify(f.options.policy),AZURE_VOICE_APP_APPROVAL_SHA256:commitment({plan:f.plan,policy:f.options.policy}),
    AZURE_VOICE_APP_ENABLED:'true',AZURE_OPEN_VOICE_ORIGIN:f.plan.broker_origin,OPEN_VOICE_HMAC_SECRET:'ab'.repeat(32),OPEN_VOICE_MODEL_ARM:modelArm};
  const store=createBlobStore({owner,grant},transport.request);await store.prime(ref);await store.update(s=>{s.reference={sha256:sha(ref),duration_ms:5000};return true;});
  await store.heartbeat(await f.options.lifecycleStore.getSupervisorLease());
  const brokerCalls=[];let runtime;
  runtime=createInternalVoiceRuntime({env,store,now:f.options.now,getToken:f.options.getToken,fetchImpl:async(url,init)=>{
    if(new URL(url).hostname==='management.azure.com')return f.options.fetch(url,init);
    brokerCalls.push({url,body:Buffer.from(init.body)});
    const operation=new URL(url).pathname==='/v1/runtime-status'?'status':'synthesize';
    const consumed=await runtime.consume({window_id:init.headers['X-Vyakti-Allocation-Window'],child_id:init.headers['X-Vyakti-Allocation-Child'],operation,
      body_sha256:sha(init.body),broker_origin:f.plan.broker_origin,runtime_origin:f.plan.runtime_origin});assert.equal(consumed.authorized,true);
    if(operation==='synthesize'&&failSynthesis)throw new Error('synthetic provider uncertain');
    return(operation==='status'?signedRuntimeStatus(url,init):signedResponse(url,init)).response;
  }});
  return{runtime,store,env,f,brokerCalls,transport};
}
test('owner mode refuses global self-test flag, other users, and caller-selected replicas',async()=>{
  const{env}=await setup();assert.equal(authorizeOwner(env,{id:owner},replica),owner);
  assert.throws(()=>authorizeOwner({...env,REPLICA_SELF_TEST_MODE:'true'},{id:owner},replica));
  assert.throws(()=>authorizeOwner({...env,REPLICA_SELF_TEST_ACCESS:'all_authenticated'},{id:owner},replica));
  assert.throws(()=>authorizeOwner(env,{id:replica},replica));assert.throws(()=>authorizeOwner(env,{id:owner},owner));
  assert.throws(()=>ratings({owner_likeness:5}));
});
test('real provider + real controller + Blob CAS yields private WAV, one attempt, ratings and revoke using synthetic transports',async()=>{
  const{runtime,store,f,brokerCalls}=await setup();await Promise.all([runtime.generate({id:owner},replica,id),runtime.generate({id:owner},replica,id)]);await Promise.all(runtime.active.values());
  const row=await store.run(id);assert.equal(row.state,'ready',JSON.stringify(row));assert.equal(row.window.state,'terminal_observed');
  assert.equal(row.receipt.release_eligible,false);assert.equal(row.receipt.identity_claim_allowed,false);assert.equal(row.receipt.perthWatermarkVerified,true);
  assert.equal(brokerCalls.length,2);assert.equal(f.calls.filter(x=>x.method==='POST').length,2);
  const output=await runtime.audio({id:owner},replica,id);assert.equal(output.toString('ascii',0,4),'RIFF');assert.equal(sha(output),row.output_sha256);
  await runtime.generate({id:owner},replica,id);await Promise.all(runtime.active.values());assert.equal(brokerCalls.length,2);
  await assert.rejects(runtime.generate({id:owner},replica,'55555555-5555-4555-8555-555555555555'),/attempt_limit/);
  const values={owner_likeness:2,naturalness:3,indian_accent:4,pronunciation:5};assert.deepEqual((await runtime.rate({id:owner},replica,id,values)).run.ratings,values);
  const child=row.window.children.find(x=>x.consumed_at);await assert.rejects(runtime.consume({window_id:row.window.window_id,child_id:child.child_id,operation:child.operation,body_sha256:child.body_sha256,broker_origin:f.plan.broker_origin,runtime_origin:f.plan.runtime_origin}));
  await runtime.revoke({id:owner},replica,id);await assert.rejects(runtime.audio({id:owner},replica,id));
});
test('ambiguous synthesis retains attempt and reservation without automatic replay',async()=>{
  const{runtime,store,brokerCalls}=await setup({failSynthesis:true});await runtime.generate({id:owner},replica,id);await Promise.all(runtime.active.values());
  assert.equal((await store.run(id)).state,'unknown');assert.ok((await store.read()).reserved_microusd>0);
  await runtime.generate({id:owner},replica,id);await Promise.all(runtime.active.values());assert.equal(brokerCalls.length,2);
});
test('Hindi v3 uses its real provider arm, one Hindi utterance and disclosure',async()=>{
  const{runtime,store,brokerCalls}=await setup({modelArm:'hindi_v3'});await runtime.generate({id:owner},replica,id);await Promise.all(runtime.active.values());
  const row=await store.run(id);assert.equal(row.state,'ready',JSON.stringify(row));assert.equal(row.model_arm,'hindi_v3');
  const request=JSON.parse(brokerCalls[1].body);assert.equal(request.model_arm,'hindi_v3');assert.equal(request.language_id,'hi');assert.equal(request.disclosure_language_id,'hi');assert.ok(request.disclosure_text);assert.equal(request.text_segment_count,1);
});
test('expired grant and stale supervisor prevent a model dispatch',async()=>{
  const{runtime,f,brokerCalls}=await setup();f.time(3600001);await assert.rejects(runtime.generate({id:owner},replica,id),/expired/);assert.equal(brokerCalls.length,0);
  const g=await setup();g.f.time(30001);await g.runtime.generate({id:owner},replica,id);await Promise.all(g.runtime.active.values());assert.equal(g.brokerCalls.length,0);assert.equal(g.f.calls.length,0);
});
test('Blob conditional updates serialize competing claims; unknown write is retained',async()=>{
  const transport=blobTransport(),store=createBlobStore({},transport.request);
  const claim=()=>store.update(s=>{if(s.claimed)return false;s.claimed=true;return true;});const results=await Promise.all([claim(),claim()]);assert.equal(results.filter(Boolean).length,1);
  transport.unknown();await assert.rejects(store.update(s=>{s.unknown=true;return true;}));assert.equal((await store.read()).unknown,true);
});
