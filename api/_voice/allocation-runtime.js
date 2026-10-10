import {createSupervisedVoiceAppController} from '../../services/azure-voice-app/controller.mjs';
import {createVoiceAllocationBoundary,createVoiceLifecycleStore,productionVoiceAllocation,voiceAllocationUnavailable} from './allocation-boundary.js';
import {canonicalJson,sha256Hex} from '../_provenance/contracts.js';
// Azure Container Apps managed-identity protocol. Never logs token material.
export async function voiceAppArmToken(env=process.env,fetchImpl=fetch){
 const url=new URL(env.IDENTITY_ENDPOINT||'http://invalid');
 if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','169.254.169.254'].includes(url.hostname)||!env.IDENTITY_HEADER)voiceAllocationUnavailable();
 url.searchParams.set('resource','https://management.azure.com/');url.searchParams.set('api-version','2019-08-01');
 if(env.AZURE_VOICE_APP_IDENTITY_CLIENT_ID)url.searchParams.set('client_id',env.AZURE_VOICE_APP_IDENTITY_CLIENT_ID);
 const response=await fetchImpl(url,{headers:{'X-IDENTITY-HEADER':env.IDENTITY_HEADER},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok){await response.body?.cancel();voiceAllocationUnavailable();}
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)voiceAllocationUnavailable();chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 const data=JSON.parse(Buffer.concat(chunks));
 if(typeof data.access_token!=='string'||!data.access_token||/[\r\n]/.test(data.access_token))voiceAllocationUnavailable();
 return data.access_token;
}
export function voiceAppRuntime({db,env=process.env,getToken=()=>voiceAppArmToken(env),fetchImpl=fetch}={}){
 if(env.AZURE_VOICE_APP_ENABLED!=='true')return null;
 let plan,policy;try{plan=JSON.parse(env.AZURE_VOICE_APP_PLAN_JSON);policy=JSON.parse(env.AZURE_VOICE_APP_POLICY_JSON);}catch{voiceAllocationUnavailable();}
 if(sha256Hex(canonicalJson({plan,policy}))!==env.AZURE_VOICE_APP_APPROVAL_SHA256||!/^gpu-[a-z0-9_-]+$/.test(env.AZURE_VOICE_APP_BUDGET_ID||''))voiceAllocationUnavailable();
 if(policy.budget_id!==env.AZURE_VOICE_APP_BUDGET_ID)voiceAllocationUnavailable();
 if(plan.broker_origin!==env.AZURE_OPEN_VOICE_ORIGIN)voiceAllocationUnavailable();
 const store=createVoiceLifecycleStore(db,plan);
 const controller=createSupervisedVoiceAppController({plan,policy,getToken,fetchImpl,lifecycleStore:store});
 return {plan,policy,controller,budgetId:env.AZURE_VOICE_APP_BUDGET_ID};
}
export function createProductionVoiceAllocation({db,authority,env=process.env}={}){
 const runtime=voiceAppRuntime({db,env});if(!runtime)return productionVoiceAllocation;
 return createVoiceAllocationBoundary({db,...runtime,limitMicrousd:runtime.policy.limit_microusd,authority});
}
