import {voiceAppArmToken} from '../_voice/allocation-runtime.js';
import {canonicalJson,sha256Hex} from '../_provenance/contracts.js';
const hash=x=>sha256Hex(canonicalJson(x));
const fail=()=>{throw Object.assign(Error('processing_gpu_metadata_unverified'),{code:'processing_gpu_metadata_unverified'});};
// Metadata GETs only. This module cannot activate, probe health, or stop a GPU.
export function createProcessingGpuObserver({env=process.env,getToken=()=>voiceAppArmToken(env),fetchImpl=fetch,clock=Date.now}={}){
 return async function observe(plan){
  const token=await getToken();if(typeof token!=='string'||!token||/[\r\n]/.test(token))fail();
  const base=plan.resource_id;
  if(!/^\/subscriptions\/c60a32f6-c812-4c0e-bc42-b6431ee90b8f\/resourceGroups\/vyakti-voice\/providers\/Microsoft.App\/containerapps\/vyakti-voice-evidence$/i.test(base))fail();
  async function get(path){
   if(path!==base&&!path.startsWith(`${base}/revisions`))fail();
   const response=await fetchImpl(`https://management.azure.com${path}?api-version=2025-07-01`,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000)});
   if(response.status!==200){await response.body?.cancel();fail();}
   const reader=response.body?.getReader();if(!reader)fail();let n=0;const chunks=[];
   try{for(;;){const{done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>1048576)fail();chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
   try{return JSON.parse(Buffer.concat(chunks));}catch{fail();}
  }
  async function list(path){const page=await get(path);if(!Array.isArray(page.value)||page.nextLink||page.value.length>20)fail();return page.value;}
  const app=await get(base),p=app.properties;
  if(app.id?.toLowerCase()!==base.toLowerCase()||!p||!p.configuration||!p.template)fail();
  const image=p.template.containers?.[0]?.image;
  if(p.template.containers?.length!==1||typeof image!=='string'||!image.endsWith(`@sha256:${plan.image_sha256}`))fail();
  const commitment=hash({configuration:p.configuration,template:p.template});
  if(commitment!==plan.revision_sha256)fail();
  const revisions=await list(`${base}/revisions`);if(!revisions.length)fail();const observed=[];const names=new Set();
  for(const revision of revisions){
   const name=revision.name;
   if(typeof name!=='string'||!/^vyakti-voice-evidence--[a-zA-Z0-9-]+$/.test(name)||names.has(name)||revision.id?.toLowerCase()!==`${base}/revisions/${name}`.toLowerCase()||typeof revision.properties?.active!=='boolean')fail();
   names.add(name);
   // Any currently active foreign template makes admission and release unknown.
   if(revision.properties.active&&hash(revision.properties.template)!==hash(p.template))fail();
   const replicas=await list(`${base}/revisions/${name}/replicas`),ids=new Set();
   for(const replica of replicas){if(typeof replica.id!=='string'||!replica.id.toLowerCase().startsWith(`${base}/revisions/${name}/replicas/`.toLowerCase())||ids.has(replica.id))fail();ids.add(replica.id);}
   observed.push({name,active:revision.properties.active,replicas:replicas.length});
  }
  return {kind:'azure-shared-evidence-observation/v1',resource_id:base,revision_sha256:commitment,image_sha256:plan.image_sha256,observed_at_ms:clock(),revisions:observed};
 };
}
