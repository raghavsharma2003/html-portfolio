import {createHash} from 'node:crypto';
import {createPrivateVoiceStore,privateVoiceError,privateVoiceSampleConfig,privateVoiceHash} from '../../api/_private-voice-store.js';
import {createOpenChatterboxPreviewProvider} from '../../api/_voice/providers/open-chatterbox-preview.js';
import {probeEnrollmentWav} from '../../api/_audio/wav.js';
import {readPrivateReplicaObject,writeImmutableReplicaArtifact,deleteReplicaObject} from '../../api/_replica-storage.js';
import {protectReplicaStream} from '../../api/_provenance/delivery.js';
import {PROVENANCE_POLICY} from '../../api/_provenance/contracts.js';
import {createAzureProtectionAdapters} from '../../api/_provenance/providers/azure-protection.js';
import {createPrivateVoiceLedger} from '../../api/_provenance/private-voice-ledger.js';
import {ratings} from '../internal-voice/contract.mjs';
import {createExecutionStore,SQL,one} from './store.mjs';
import {createPrivateLifecycle} from './lifecycle.mjs';
import {revokeDeletingPrivateVoice} from '../../api/_private-voice-erasure.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw privateVoiceError(code);};
const locator=r=>({storageBucket:r.output_storage_bucket,objectPath:r.output_object_path});
function wav(pcm){const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);
 h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(24000,24);h.writeUInt32LE(48000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);
 h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}
export function createPrivateVoiceRuntime({db,env=process.env,fetchImpl=fetch,now=Date.now,lifecycle:providedLifecycle,
 providerFactory=createOpenChatterboxPreviewProvider,protectionFactory=createAzureProtectionAdapters,
 storage={read:readPrivateReplicaObject,write:writeImmutableReplicaArtifact,delete:deleteReplicaObject},allowTestAdapters=false}={}){
 const store=createPrivateVoiceStore({db,now}),execution=createExecutionStore(db,now),active=new Map();
 const lifecycle=providedLifecycle||createPrivateLifecycle({db,env,fetchImpl,now});
 async function execute(owner,input){let row;
  try{
   row=await execution.claim(owner,input);if(!row)return;
   row=await execution.start(row);const started=now();
   if(privateVoiceHash(row.config)!==privateVoiceHash(privateVoiceSampleConfig()))fail('private_voice_config_changed');
   await lifecycle.controller.assertSupervisorReady();
   let current=await execution.check(row);
   const ref=current.snapshot;
   const signal=AbortSignal.timeout(540000);
   const object=await storage.read({storageBucket:ref.storage_bucket,objectPath:ref.object_path},{fetchImpl,maxBytes:20971520,timeoutMs:30000,signal});
   const probe=probeEnrollmentWav(object.body);
   if(!['audio/wav','audio/x-wav'].includes(object.mime)||object.body.length!==Number(ref.byte_size)||sha(object.body)!==row.reference_sha256||
    probe.durationMs<5000||probe.durationMs>90000||Math.abs(probe.durationMs-Number(ref.duration_ms))>2)fail('private_voice_reference_changed');
   await execution.check(row);
   await execution.renew(row);
   const provider=providerFactory({env,fetchImpl,allocation:lifecycle.allocation(row)});
   const synthesized=await provider.synthesizePreview({requestId:row.run_id,text:row.config.text,languageId:'hi',seed:row.config.seed,style:row.config.style,
    reference:{bytes:object.body,sha256:row.reference_sha256,durationMs:probe.durationMs,languageMode:'unknown',languageEvidenceScope:'unverified'},signal});
   if(synthesized.receipt?.modelArm!=='hindi_v3'||synthesized.receipt.modelCommitment!==row.config.model_commitment||synthesized.receipt.perthWatermarkVerified!==true||
    synthesized.receipt.referenceSha256!==row.reference_sha256||!synthesized.disclosureText)fail('private_voice_synthesis_binding_invalid');
   await execution.renew(row);
   current=await execution.check(row);
   const ledger=createPrivateVoiceLedger(db,row);
   const protection=protectionFactory({db,env,fetchImpl,persistManifest:input=>ledger.persistManifest(input)});
   const protectedAudio=await protectReplicaStream({authorization:{request:{generationId:row.run_id,replicaId:row.replica_id,ownerUserId:row.owner_user_id,
    purpose:'private_voice_sample',channel:'studio_preview',policyVersion:PROVENANCE_POLICY,traceId:row.run_id},privateRun:current,
    privateArtifact:{artifact_id:row.artifact_id,replica_id:row.replica_id,owner_user_id:row.owner_user_id,source_id:row.source_id,sha256:row.reference_sha256,stage:'enhance'}},
    sourceStream:synthesized.stream,format:synthesized.format,adapters:{...protection,ledger},
    disclosureEvidence:{renderedText:synthesized.renderedText,renderer:`${provider.name}@${provider.modelCommitment}`},
    disclosureText:synthesized.disclosureText,signal,now:new Date(now()),allowTestAdapters});
   const chunks=[];let size=0;for await(const value of protectedAudio.stream){size+=value.length;if(size>4608000)fail('private_voice_output_oversized');chunks.push(Buffer.from(value));}
   const receipt=await protectedAudio.completion,pcm=Buffer.concat(chunks);
   if(!pcm.length||receipt.generation_id!==row.run_id)fail('private_voice_protection_binding_invalid');
   const bytes=wav(pcm),hash=sha(bytes);
   await execution.check(row);
   await storage.write({...locator(row),body:bytes,mime:'audio/wav',ifNoneMatch:'*',expectedSha256:hash},{fetchImpl,maxBytes:5000000,timeoutMs:30000,signal,
    beforeWriteRequest:async()=>{await execution.check(row);await execution.write(row);}});
   await execution.settle(row,hash,receipt,{total_ms:now()-started,model_elapsed_ms:synthesized.receipt.elapsedMs,
    duration_ms:pcm.length/48,real_time_factor:synthesized.receipt.realTimeFactor,first_audible_ms:null});
  }catch(error){if(row)await execution.fail(row,error).catch(()=>{});}
  finally{active.delete(input.run_id);}
 }
 function kick(owner,input){if(!active.has(input.run_id)){const task=new Promise(resolve=>setImmediate(resolve)).then(()=>execute(owner,input));active.set(input.run_id,task);}}
 return {store,execution,lifecycle,active,kick,
  async candidates(owner,input){return {enabled:true,...await store.candidates(owner,input)};},
  async generate(owner,input){const admitted=await store.admit(owner,input);kick(owner,input);return admitted;},
  async status(owner,input){const run=await store.status(owner,input);if(['queued','claimed','running'].includes(run.state))kick(owner,input);return {run};},
  async audio(owner,input){const row=await execution.require(owner,input);if(row.state!=='ready'||!row.output_sha256||row.output_deleted_at)fail('private_voice_audio_unavailable');
   const object=await storage.read(locator(row),{fetchImpl,maxBytes:5000000,timeoutMs:20000});
   if(object.mime!=='audio/wav'||sha(object.body)!==row.output_sha256)fail('private_voice_audio_changed');
   const latest=await execution.require(owner,input);if(latest.state!=='ready'||latest.output_deleted_at||latest.output_sha256!==row.output_sha256)fail('private_voice_audio_unavailable');return object.body;},
  async rate(owner,input){let parsed;try{parsed=ratings(input.ratings);}catch{throw privateVoiceError('private_voice_ratings_invalid',400);}
   const row=await execution.require(owner,input);one(await db(SQL.rate,[row.replica_id,owner,row.source_id,row.artifact_id,row.run_id,JSON.stringify(parsed)]));return {run:await store.status(owner,input)};},
  async revoke(owner,input){await store.revoke(owner,input);const row=(await db('select window_id from vy_private_voice_run where replica_id=$1::uuid and owner_user_id=$2::uuid and run_id=$3::uuid',[input.replica_id,owner,input.run_id]))[0];
   if(row?.window_id)await lifecycle.controller.close(row.window_id,'cancelled').catch(()=>{});
   await execution.cleanup(storage.delete).catch(()=>{});return {run:await store.status(owner,input)};},
  async maintenance(){await revokeDeletingPrivateVoice(db);return execution.cleanup(storage.delete);},
 };
}
