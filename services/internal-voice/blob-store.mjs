import {internalVoiceStorageRequest} from '../../api/_replica-storage.js';
import {UUID,fail,sha} from './contract.mjs';
export const emptyState=()=>({version:1,runs:{},supervisor:null,reserved_microusd:0});
async function body(response,max){
  const chunks=[];let size=0;const reader=response.body?.getReader();if(!reader)fail('internal_voice_storage_body_missing',503);
  try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)fail('internal_voice_storage_oversized',503);chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks);
}
export function createBlobStore(config,request=(name,options)=>internalVoiceStorageRequest(config.owner,config.grant.authorization_id,name,options)){
  async function snapshot(){
    const response=await request('state.json');
    if(response.status===404){await response.body?.cancel();return{state:emptyState(),etag:null};}
    if(response.status!==200)fail('internal_voice_storage_read_failed',503);
    const etag=response.headers.get('etag');if(!etag)fail('internal_voice_storage_etag_missing',503);
    return{state:JSON.parse((await body(response,1024*1024)).toString()),etag};
  }
  const read=async()=>(await snapshot()).state;
  async function update(fn){
    for(let attempt=0;attempt<6;attempt++){
      const{state,etag}=await snapshot();const result=fn(state);
      if(result?.then)fail('internal_voice_store_async_mutation',503);
      const bytes=Buffer.from(JSON.stringify(state));if(bytes.length>1024*1024)fail('internal_voice_state_oversized',503);
      const response=await request('state.json',{method:'PUT',body:bytes,headers:{'x-ms-blob-type':'BlockBlob','Content-Type':'application/json',...(etag?{'If-Match':etag}:{'If-None-Match':'*'})}});
      await response.body?.cancel();
      if(response.status===201)return structuredClone(result);
      if(response.status!==412)fail('internal_voice_storage_write_unknown',503);
    }fail('internal_voice_store_contended',503);
  }
  async function put(name,bytes){const response=await request(name,{method:'PUT',body:bytes,headers:{'x-ms-blob-type':'BlockBlob','Content-Type':'audio/wav','If-None-Match':'*'}});await response.body?.cancel();if(response.status!==201)fail('internal_voice_audio_write_unknown',503);return sha(bytes);}
  async function get(name){const response=await request(name);if(response.status!==200)fail('internal_voice_audio_unavailable',404);return body(response,25*1024*1024);}
  return {read,update,
    run:async id=>{if(!UUID.test(id||''))fail('internal_voice_run_invalid',400);return(await read()).runs[id]||null;},
    heartbeat:lease=>update(s=>{s.supervisor=lease;return lease;}),
    saveAudio:(id,bytes)=>{if(!UUID.test(id))fail('internal_voice_run_invalid');return put(`${id}.wav`,bytes);},
    audio:id=>{if(!UUID.test(id))fail('internal_voice_run_invalid');return get(`${id}.wav`);},
    reference:()=>get('reference.wav'),prime:bytes=>put('reference.wav',bytes),
    async eraseAudio(id){if(!UUID.test(id))fail('internal_voice_run_invalid');const response=await request(`${id}.wav`,{method:'DELETE',headers:{'x-ms-delete-snapshots':'include'}});await response.body?.cancel();if(![202,404].includes(response.status))fail('internal_voice_erasure_pending',503);},
  };
}
