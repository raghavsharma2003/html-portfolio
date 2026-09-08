import {ReplicaApiError,replicaRequest} from "./replicaApi";

export const COMPARISON_USE_KEYS=["use_existing_voice_evidence","comparison_only","understand_reference_withdrawal"] as const;
export type ComparisonUseKey=typeof COMPARISON_USE_KEYS[number];
export type ComparisonOption={artifact_id:string;source_id:string;source_created_at:string;duration_ms:number|null;mime:"audio/wav"|"audio/x-wav";snapshot_hash:string};
export type ComparisonOptions={replica_id:string;state:"available"|"unavailable";options:ComparisonOption[];next_cursor:string|null;current_reference:ComparisonReference|null;statement_set:"private-comparison-reference/v1";statements:{id:ComparisonUseKey;text:string}[];capture_ready:false};
export type ComparisonReference={replica_id:string;reference_id:string;state:"review"|"selected"|"revoked"|"expired";created_at:string;expires_at:string|null;artifact_id?:string;source_id?:string;source_created_at?:string;duration_ms?:number|null;snapshot_hash?:string;can_audition?:boolean;can_confirm?:boolean;changed?:boolean};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const comparisonId=(v:unknown):v is string=>typeof v==="string"&&v.length===36&&UUID.test(v);
const hash=(v:unknown):v is string=>typeof v==="string"&&v.length===64&&/^[0-9a-f]{64}$/.test(v);
const date=(v:unknown):v is string=>typeof v==="string"&&Number.isFinite(Date.parse(v));
const invalid=()=>new ReplicaApiError("The comparison response could not be verified.",503);
const deadline=(signal:AbortSignal,ms=20000)=>AbortSignal.any([signal,AbortSignal.timeout(ms)]);
const path=(replicaId:string,op:string,referenceId?:string)=>`/api/replica-comparison-reference?${new URLSearchParams({op,replica_id:replicaId,...(referenceId?{reference_id:referenceId}:{})})}`;

export async function getComparisonOptions(token:string,replicaId:string,signal:AbortSignal,cursor:string|null=null):Promise<ComparisonOptions>{
 const d=await replicaRequest<ComparisonOptions>(token,path(replicaId,"options")+(cursor?`&cursor=${encodeURIComponent(cursor)}`:""),{signal:deadline(signal)});
 if(d?.replica_id!==replicaId||d.statement_set!=="private-comparison-reference/v1"||d.capture_ready!==false||
  (d.next_cursor!==null&&!comparisonId(d.next_cursor))||!Array.isArray(d.options)||d.options.length>16||!Array.isArray(d.statements)||d.statements.length!==3||
  COMPARISON_USE_KEYS.some((id,i)=>d.statements[i]?.id!==id||typeof d.statements[i]?.text!=="string")||
  d.state!==(d.options.length?"available":"unavailable")||d.options.some(o=>!comparisonId(o.artifact_id)||!comparisonId(o.source_id)||
    !date(o.source_created_at)||!hash(o.snapshot_hash)||!["audio/wav","audio/x-wav"].includes(o.mime)||
    (o.duration_ms!==null&&(!Number.isFinite(o.duration_ms)||o.duration_ms<=0))))throw invalid();
 if(d.current_reference!==null){if(!comparisonId(d.current_reference?.reference_id))throw invalid();validateComparisonReference(d.current_reference,replicaId,d.current_reference.reference_id);if(!["selected","expired"].includes(d.current_reference.state))throw invalid();}
 return d;
}
export function validateComparisonReference(d:ComparisonReference,replicaId:string,referenceId:string):ComparisonReference{
 if(d?.replica_id!==replicaId||d.reference_id!==referenceId||!["review","selected","revoked","expired"].includes(d.state)||!date(d.created_at)||
   (d.expires_at!==null&&!date(d.expires_at))||(["review","selected"].includes(d.state)&&d.expires_at===null)||
   (d.can_audition!==undefined&&typeof d.can_audition!=="boolean")||(d.can_confirm!==undefined&&typeof d.can_confirm!=="boolean")||
   (d.can_audition&&(!comparisonId(d.artifact_id)||!comparisonId(d.source_id)||!date(d.source_created_at)||(d.duration_ms!==null&&(!Number.isFinite(d.duration_ms)||Number(d.duration_ms)<=0))||!hash(d.snapshot_hash)||d.changed===true||!["review","selected"].includes(d.state)))||
   (d.can_confirm&&(!d.can_audition||d.state!=="review"))||(["revoked","expired"].includes(d.state)&&(d.can_audition||d.can_confirm)))throw invalid();
 return d;
}
export async function getComparisonReference(token:string,replicaId:string,referenceId:string,signal:AbortSignal){
 return validateComparisonReference(await replicaRequest<ComparisonReference>(token,path(replicaId,"status",referenceId),{signal:deadline(signal)}),replicaId,referenceId);
}
type Mutation={op:"authorize";artifact_id:string;expected_snapshot_hash:string;attestations:Record<ComparisonUseKey,true>}|
 {op:"confirm";expected_snapshot_hash:string;confirm_this_is_my_voice:true}|{op:"withdraw"};
export async function writeComparisonReference(token:string,replicaId:string,referenceId:string,input:Mutation,signal:AbortSignal){
 return validateComparisonReference(await replicaRequest<ComparisonReference>(token,"/api/replica-comparison-reference",{
  method:"POST",signal:deadline(signal),body:JSON.stringify({...input,replica_id:replicaId,reference_id:referenceId}),
 }),replicaId,referenceId);
}
export async function getComparisonAudio(token:string,replicaId:string,referenceId:string,signal:AbortSignal):Promise<Blob>{
 const bounded=deadline(signal,45000),response=await fetch(path(replicaId,"audition",referenceId),{headers:{Authorization:`Bearer ${token}`},signal:bounded,cache:"no-store"});
 bounded.throwIfAborted();
 if(!response.ok){try{await response.body?.cancel();}catch{/* No response body is displayed. */}throw new ReplicaApiError("The private recording could not be opened.",response.status);}
 const mime=response.headers.get("Content-Type")?.split(";")[0];
 if(!["audio/wav","audio/x-wav"].includes(mime||"")||response.status!==200||!response.body){await response.body?.cancel();throw invalid();}
 const declared=Number(response.headers.get("Content-Length"));
 if(!Number.isSafeInteger(declared)||declared<1||declared>67108864){await response.body.cancel();throw invalid();}
 const reader=response.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
 try{while(true){const chunk=await reader.read();bounded.throwIfAborted();if(chunk.done)break;size+=chunk.value.byteLength;if(size>declared||size>67108864)throw invalid();chunks.push(new Uint8Array(chunk.value));}
  if(size!==declared)throw invalid();bounded.throwIfAborted();return new Blob(chunks,{type:mime});
 }catch(error){try{await reader.cancel();}catch{/* Keep the original failure. */}throw error;}finally{reader.releaseLock();}
}
