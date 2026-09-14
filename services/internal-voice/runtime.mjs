import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createSupervisedVoiceAppController,commitment} from '../azure-voice-app/controller.mjs';
import {createOpenChatterboxPreviewProvider} from '../../api/_voice/providers/open-chatterbox-preview.js';
import {probeEnrollmentWav} from '../../api/_audio/wav.js';
import {voiceAppArmToken} from '../../api/_voice/allocation-runtime.js';
import {createBlobStore} from './blob-store.mjs';
import {createInternalLifecycle} from './lifecycle.mjs';
import {readConfiguration,authorizeOwner,SCOPE,TEXT,UUID,ratings,sha,fail,safeError} from './contract.mjs';

function wav(pcm){
  const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(24000,24);h.writeUInt32LE(48000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);
}
export function createInternalVoiceRuntime({env=process.env,store:providedStore,controller:providedController,providerFactory=createOpenChatterboxPreviewProvider,getToken,fetchImpl=fetch,now=Date.now}={}){
  const config=readConfiguration(env,0),store=providedStore||createBlobStore(config);
  if(env.AZURE_VOICE_APP_ENABLED!=='true'||commitment({plan:config.plan,policy:config.policy})!==env.AZURE_VOICE_APP_APPROVAL_SHA256||config.plan.broker_origin!==env.AZURE_OPEN_VOICE_ORIGIN)
    fail('internal_voice_target_binding_invalid',503);
  const lifecycle=createInternalLifecycle(store,config,now);
  const controller=providedController||createSupervisedVoiceAppController({plan:config.plan,policy:config.policy,lifecycleStore:lifecycle,
    getToken:getToken||(()=>env.VYAKTI_INTERNAL_VOICE_ARM_TOKEN||voiceAppArmToken(env,fetchImpl)),fetchImpl,now});
  const active=new Map();
  const fresh=()=>{if(Date.parse(config.grant.expires_at)<=now())fail('internal_voice_authorization_expired');};
  const owned=(user,replica)=>authorizeOwner(env,user,replica);
  function assertRun(r){fresh();if(!r||r.owner_user_id!==config.owner||r.replica_id!==config.replica||r.authorization_sha256!==config.grantHash||r.revoked_at)fail('internal_voice_run_unavailable',404);return r;}
  async function reference(){const bytes=await store.reference();if(sha(bytes)!==config.grant.reference_sha256)fail('internal_voice_reference_changed');const p=probeEnrollmentWav(bytes);if(p.durationMs<5000||p.durationMs>90000)fail('internal_voice_reference_duration_invalid');return{bytes,durationMs:p.durationMs};}
  const mutateRun=(id,fn)=>store.update(s=>fn(s.runs[id],s));
  function allocation(id){return {
    async assertReady(){assertRun(await store.run(id));await controller.assertSupervisorReady();},
    async runTransaction(operations,work,scope){
      const r=assertRun(await store.run(id));
      if(r.state!=='running'||!Array.isArray(operations)||operations.length>32||operations.filter(o=>o.operation==='synthesize').length!==1||
        operations.some(o=>!['status','synthesize'].includes(o.operation)||!/^[a-f0-9]{64}$/.test(o.body_sha256))||
        scope.model_arm!==config.modelArm||scope.language_id!=='hi'||scope.reference_sha256!==r.reference_sha256||scope.text_sha256!==sha(TEXT))fail('internal_voice_dispatch_binding_invalid');
      await controller.assertExclusiveTarget();
      const requestHash=commitment({run_id:id,authorization_sha256:config.grantHash,operations,scope});
      const grant=await controller.authorizeWindow({request_sha256:requestHash});
      const reserve=grant.reservation_estimate_microusd;
      if(grant.kind!=='azure-supervised-app/v1'||grant.request_sha256!==requestHash||!Number.isSafeInteger(reserve)||reserve<=0||reserve>config.policy.per_allocation_cap_microusd)fail('internal_voice_reservation_invalid');
      const windowId=randomUUID(),begun=now();const children=operations.map((o,ordinal)=>({...o,ordinal,child_id:randomUUID(),consumed_at:null}));
      await mutateRun(id,(row,s)=>{
        assertRun(row);if(row.state!=='running'||row.window||Object.values(s.runs).some(x=>x.window&&x.window.state!=='terminal_observed')||
          s.reserved_microusd+reserve>config.policy.limit_microusd)fail('internal_voice_allocation_unavailable');
        s.reserved_microusd+=reserve;
        row.window={...config.plan,window_id:windowId,resource_sha256:commitment(config.plan.app_id),revision_sha256:commitment({revision_name:config.plan.revision_name,configuration_sha256:config.plan.configuration_sha256,template_sha256:config.plan.template_sha256}),
          state:'open',begun_at:new Date(begun).toISOString(),dispatch_deadline_at:new Date(begun+420000).toISOString(),activation_state:'not_started',deactivation_state:'not_started',
          reservation_estimate_microusd:reserve,accounted:false,request_sha256:requestHash,children};return true;
      });
      try{
        await controller.activate(windowId);
        const issued=new Set();
        return await work({headers(index){if(!Number.isInteger(index)||!children[index]||issued.has(index))fail('internal_voice_child_invalid');issued.add(index);return{'X-Vyakti-Allocation-Window':windowId,'X-Vyakti-Allocation-Child':children[index].child_id};}});
      }finally{
        try{await controller.close(windowId,'transaction_finished');}catch(e){await mutateRun(id,row=>{row.cleanup_error=safeError(e);return true;}).catch(()=>{});}
      }
    },
  };}
  async function execute(id){
    const started=now();let claimed=false;
    try{
      claimed=await mutateRun(id,r=>{assertRun(r);if(r.state!=='queued')return false;r.state='running';r.started_at=new Date(started).toISOString();return true;});
      if(!claimed)return;
      const ref=await reference();assertRun(await store.run(id));
      const provider=providerFactory({env,fetchImpl,allocation:allocation(id)});
      const synthesized=await provider.synthesizePreview({requestId:id,text:TEXT,languageId:'hi',seed:31001,
        reference:{bytes:ref.bytes,sha256:config.grant.reference_sha256,durationMs:ref.durationMs,languageMode:'unknown',languageEvidenceScope:'unverified'},
        style:{exaggeration:.5,cfgWeight:.5,temperature:.8},signal:AbortSignal.timeout(420000)});
      const chunks=[];let size=0;for await(const value of synthesized.stream){size+=value.length;if(size>24*1024*1024)fail('internal_voice_audio_oversized');chunks.push(Buffer.from(value));}
      const pcm=Buffer.concat(chunks);
      if(!pcm.length||pcm.length%2||synthesized.receipt?.outputSha256!==sha(pcm)||synthesized.receipt.perthWatermarkVerified!==true||!synthesized.disclosureText)fail('internal_voice_output_binding_invalid');
      assertRun(await store.run(id));const bytes=wav(pcm);const output=await store.saveAudio(id,bytes);
      await mutateRun(id,r=>{assertRun(r);if(r.state!=='running')fail('internal_voice_attempt_changed');
        r.state='ready';r.output_sha256=output;r.receipt={...synthesized.receipt,scope:SCOPE,identity_scope:'owner_asserted_internal',release_eligible:false,identity_claim_allowed:false};
        r.completed_at=new Date(now()).toISOString();r.metrics={total_ms:now()-started,model_elapsed_ms:synthesized.receipt.elapsedMs,duration_ms:pcm.length/48,real_time_factor:synthesized.receipt.realTimeFactor,first_audible_ms:null};return true;});
    }catch(e){
      if(claimed){await mutateRun(id,r=>{if(!r||r.revoked_at)return false;r.state=r.window?'unknown':'failed';r.error_code=safeError(e);return true;}).catch(()=>{});
        const row=await store.run(id).catch(()=>null);if(row?.revoked_at)await store.eraseAudio(id).catch(()=>{});}
    }finally{active.delete(id);}
  }
  function publicRun(r){
    if(!r)return null;
    const qs=new URLSearchParams({replica_id:config.replica,run_id:r.run_id});
    const state=r.revoked_at?'revoked':r.state==='running'&&Date.parse(r.started_at)+450000<now()?'unknown':r.state;
    return{run_id:r.run_id,state,text:TEXT,language_id:'hi',model_arm:r.model_arm,scope:SCOPE,identity_scope:'owner_asserted_internal',release_eligible:false,
      playback_url:state==='ready'?`/api/internal-voice?action=audio&${qs}`:null,reference_url:`/api/internal-voice?action=reference&${qs}`,
      ratings:r.ratings||null,metrics:r.metrics||null,error_code:r.error_code||null,cleanup_pending:!!r.window&&r.window.state!=='terminal_observed'};
  }
  return {config,store,controller,active,
    async status(user,replica,id){owned(user,replica);const s=await store.read();const r=id?await store.run(id):Object.values(s.runs).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
      return{enabled:true,scope:SCOPE,reference:{label:'Your saved voice recording',duration_ms:s.reference?.duration_ms||null,available:!!s.reference},run:publicRun(r),can_generate:!!s.reference&&Date.parse(config.grant.expires_at)>now()&&Object.keys(s.runs).length<config.maxAttempts};},
    async generate(user,replica,id){owned(user,replica);fresh();if(!UUID.test(id||''))fail('internal_voice_run_invalid',400);
      await mutateRun(id,(r,s)=>{if(r){assertRun(r);return false;}if(!s.reference||s.reference.sha256!==config.grant.reference_sha256)fail('internal_voice_reference_unavailable');if(Object.keys(s.runs).length>=config.maxAttempts)fail('internal_voice_attempt_limit');
        s.runs[id]={run_id:id,owner_user_id:config.owner,replica_id:config.replica,authorization_sha256:config.grantHash,reference_sha256:config.grant.reference_sha256,
          state:'queued',model_arm:config.modelArm,scope:SCOPE,release_eligible:false,expires_at:config.grant.expires_at,created_at:new Date(now()).toISOString()};return true;});
      if(!active.has(id)){const task=new Promise(resolve=>setImmediate(resolve)).then(()=>execute(id));active.set(id,task);}
      return this.status(user,replica,id);
    },
    async rate(user,replica,id,value){owned(user,replica);const parsed=ratings(value);await mutateRun(id,r=>{assertRun(r);if(r.state!=='ready')fail('internal_voice_audio_not_ready');r.ratings=parsed;r.rated_at=new Date(now()).toISOString();return true;});return this.status(user,replica,id);},
    async revoke(user,replica,id){owned(user,replica);await mutateRun(id,r=>{if(!r)fail('internal_voice_run_unavailable',404);r.revoked_at=new Date(now()).toISOString();r.state='revoked';return true;});
      const r=await store.run(id);if(r.window)await controller.close(r.window.window_id,'cancelled').catch(()=>{});await store.eraseAudio(id);return this.status(user,replica,id);},
    async audio(user,replica,id,original=false){owned(user,replica);const r=assertRun(await store.run(id));if(original){const bytes=(await reference()).bytes;assertRun(await store.run(id));return bytes;}if(r.state!=='ready')fail('internal_voice_audio_not_ready');const bytes=await store.audio(id);if(sha(bytes)!==r.output_sha256)fail('internal_voice_audio_changed');assertRun(await store.run(id));return bytes;},
    async prime(){fresh();if(!config.referencePath)fail('internal_voice_reference_path_required');const bytes=readFileSync(config.referencePath);if(sha(bytes)!==config.grant.reference_sha256)fail('internal_voice_reference_changed');const probe=probeEnrollmentWav(bytes);if(probe.durationMs<5000||probe.durationMs>90000)fail('internal_voice_reference_duration_invalid');const reference_sha256=await store.prime(bytes);await store.update(s=>{s.reference={sha256:reference_sha256,duration_ms:probe.durationMs};return true;});return{reference_sha256,bytes:bytes.length};},
    async consume(input){const expected=Object.keys(input||{}).sort().join(',');if(expected!=='body_sha256,broker_origin,child_id,operation,runtime_origin,window_id')fail('internal_voice_child_invalid');
      return store.update(s=>{const r=Object.values(s.runs).find(r=>r.window?.window_id===input.window_id);assertRun(r);const w=r.window,lease=s.supervisor;
        if(r.state!=='running'||w.state!=='open'||w.activation_state!=='acknowledged'||Date.parse(w.dispatch_deadline_at)<=now()||
          input.broker_origin!==config.plan.broker_origin||input.runtime_origin!==config.plan.runtime_origin||
          lease?.app_id!==config.plan.app_id||lease?.revision_sha256!==w.revision_sha256||lease?.contract_sha256!==config.plan.contract_sha256||lease?.source_sha256!==config.policy.supervisor_source_sha256||
          !Number.isFinite(Date.parse(lease.heartbeat_at))||Date.parse(lease.heartbeat_at)>now()||Date.parse(lease.lease_expires_at)-Date.parse(lease.heartbeat_at)!==30000||Date.parse(lease.lease_expires_at)<=now())fail('internal_voice_child_refused');
        const c=w.children.find(c=>c.child_id===input.child_id);if(!c||c.consumed_at||c.operation!==input.operation||c.body_sha256!==input.body_sha256)fail('internal_voice_child_refused');c.consumed_at=new Date(now()).toISOString();
        return{authorized:true,window_id:w.window_id,child_id:c.child_id,operation:c.operation,body_sha256:c.body_sha256,dispatch_not_after:w.dispatch_deadline_at};});},
  };
}
