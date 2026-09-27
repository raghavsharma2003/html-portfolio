import {privateVoiceBody,privateVoiceEnabled,privateVoiceCode} from './_private-voice-handler.js';
import {privateVoiceError} from './_private-voice-store.js';
export function createPrivateVoiceProxy({requireUser,env=process.env,fetchImpl=fetch}){return async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  if(!privateVoiceEnabled(env))return res.status(404).json({enabled:false,error:'private_voice_disabled'});
  await requireUser(req);
  if(!['GET','POST'].includes(req.method))throw privateVoiceError('private_voice_method_invalid',405);
  const origin=new URL(env.VYAKTI_PRIVATE_VOICE_ORIGIN||'http://invalid');
  if(origin.protocol!=='https:'||!origin.hostname.endsWith('.azurecontainerapps.io')||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash)
   throw privateVoiceError('private_voice_service_unconfigured',503);
  const target=new URL('/api/private-voice',origin);target.search=new URL(req.url,'http://private').search;
  const body=req.method==='POST'?await privateVoiceBody(req):null;
  const response=await fetchImpl(target,{method:req.method,headers:{Authorization:req.headers.authorization,'Content-Type':'application/json'},
   body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(25000)});
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>5000000)throw privateVoiceError('private_voice_response_oversized');chunks.push(Buffer.from(chunk));}
  res.setHeader('Content-Type',response.headers.get('content-type')==='audio/wav'?'audio/wav':'application/json');return res.status(response.status).send(Buffer.concat(chunks));
 }catch(e){return res.status(e.status||503).json({error:privateVoiceCode(e),blocker_class:'us'});}
};}
