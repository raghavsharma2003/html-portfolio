import {ReplicaApiError,replicaRequest} from './replicaApi';
import {comparisonId} from './comparisonReferenceApi';
import type {SignedUpload} from './types';

export const PREPARATION_KEYS=['recording_is_only_me','process_for_private_comparison','no_training_or_public_voice_permission'] as const;
export type PreparationKey=typeof PREPARATION_KEYS[number];
export type Preparation={preparation_id:string;source_id:string|null;state:'authorized'|'queued'|'running'|'prepared'|'revoked'|'expired'|'failed'|'reconciliation_required';expires_at:string;completed_receipt_sha256:string|null;can_voice:false};
export type PreparationReadiness={available:false;waiting_on:'us';code:string;can_upload:true;can_prepare:false};
const invalid=()=>new ReplicaApiError('The recording status could not be verified.',503);
const bounded=(signal:AbortSignal)=>AbortSignal.any([signal,AbortSignal.timeout(20000)]);
function readiness(d:PreparationReadiness){if(!d||d.available!==false||d.waiting_on!=='us'||d.can_upload!==true||d.can_prepare!==false||typeof d.code!=='string')throw invalid();return d;}
export async function readPreparationReadiness(token:string,signal:AbortSignal){const d=await replicaRequest<{readiness:PreparationReadiness}>(token,'/api/replica-comparison-preparation',{method:'POST',signal:bounded(signal),body:JSON.stringify({op:'readiness'})});return readiness(d.readiness);}
export async function preparationRequest(token:string,rid:string,pid:string,op:'status'|'withdraw',signal:AbortSignal){
 const d=await replicaRequest<{preparation:Preparation;readiness:PreparationReadiness}>(token,'/api/replica-comparison-preparation',{method:'POST',signal:bounded(signal),body:JSON.stringify({op,replica_id:rid,preparation_id:pid})});
 readiness(d.readiness);const p=d.preparation;
 if(!p||p.preparation_id!==pid||!comparisonId(pid)||p.can_voice!==false||!['authorized','queued','running','prepared','revoked','expired','failed','reconciliation_required'].includes(p.state)||!Number.isFinite(Date.parse(p.expires_at))||
  (p.source_id===null?p.state!=='revoked':!comparisonId(p.source_id))||(p.state==='prepared'?(Date.parse(p.expires_at)<=Date.now()||!/^[a-f0-9]{64}$/.test(p.completed_receipt_sha256||'')):p.completed_receipt_sha256!==null))throw invalid();
 return d;
}
export async function uploadComparisonRecording(token:string,rid:string,pid:string,file:File,checks:Partial<Record<PreparationKey,boolean>>,signal:AbortSignal){
 if(!comparisonId(rid)||!comparisonId(pid)||!PREPARATION_KEYS.every(k=>checks[k]===true)||file.size<1||file.size>33554432||! /^(audio|video)\//.test(file.type))throw new Error('Choose an audio or video recording up to 32 MB and confirm each permission.');
 signal.throwIfAborted();const bytes=await file.arrayBuffer();signal.throwIfAborted();
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');signal.throwIfAborted();
 type Result={source:{source_id:string;replica_id:string;purpose:string;mime:string};upload:SignedUpload|null;finalized:boolean};
 const created=await replicaRequest<Result>(token,'/api/replica-source',{method:'POST',signal:bounded(signal),body:JSON.stringify({op:'create_upload',replica_id:rid,preparation_id:pid,upload_intent_id:pid,purpose:'comparison_reference',kind:file.type.startsWith('audio/')?'audio':'video',mime:file.type,byte_size:file.size,sha256,contains_third_parties:false,attestations:Object.fromEntries(PREPARATION_KEYS.map(k=>[k,true]))})});
 if(!comparisonId(created.source?.source_id)||created.source.replica_id!==rid||created.source.purpose!=='comparison_reference'||! /^(audio|video)\/[a-zA-Z0-9.+-]+$/.test(created.source.mime)||typeof created.finalized!=='boolean')throw invalid();
 if(!created.finalized){const u=created.upload;if(!u||u.method!=='PUT'||!Number.isFinite(Date.parse(u.expires_at))||Date.parse(u.expires_at)<=Date.now())throw invalid();const url=new URL(u.url);
  if(url.protocol!=='https:'||url.username||url.password||!url.hostname.endsWith('.blob.core.windows.net')||!url.searchParams.get('sig'))throw invalid();
  // This bounded <=32 MiB request uses the existing signed PUT contract. Abort
  // reaches the transport; no detached resumable worker continues after exit.
  const response=await fetch(u.url,{method:'PUT',headers:{...u.headers,'Content-Type':created.source.mime},body:file,signal:AbortSignal.any([signal,AbortSignal.timeout(300000)]),credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store'});
  signal.throwIfAborted();if(!response.ok)throw new Error('The private upload is unconfirmed. Check its status before trying again.');
  const finalized=await replicaRequest<Result>(token,'/api/replica-source',{method:'POST',signal:bounded(signal),body:JSON.stringify({op:'finalize',replica_id:rid,source_id:created.source.source_id,upload_intent_id:pid})});
  if(finalized.source?.source_id!==created.source.source_id||finalized.finalized!==true)throw invalid();
 }
 return preparationRequest(token,rid,pid,'status',signal);
}
