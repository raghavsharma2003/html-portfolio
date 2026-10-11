import {configuredOwner,authorizeOwner,fail,safeError} from '../services/internal-voice/contract.mjs';
import {readBody} from '../services/internal-voice/http.mjs';
export function createInternalVoiceProxy({requireUser,env=process.env,fetchImpl=fetch}){return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
    try{configuredOwner(env);}catch{return res.status(404).json({enabled:false});}
    const user=await requireUser(req),url=new URL(req.url,'http://internal');
    if(!['GET','POST'].includes(req.method))fail('internal_voice_method_invalid',405);
    const body=req.method==='POST'?await readBody(req):null;
    authorizeOwner(env,user,body?.replica_id||url.searchParams.get('replica_id'));
    const origin=new URL(env.VYAKTI_INTERNAL_VOICE_ORIGIN||'http://invalid');
    if(origin.protocol!=='https:'||!origin.hostname.endsWith('.azurecontainerapps.io')||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash)fail('internal_voice_service_unconfigured',503);
    const target=new URL('/api/internal-voice',origin);target.search=url.search;
    const response=await fetchImpl(target,{method:req.method,headers:{Authorization:req.headers.authorization,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(25000)});
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>25*1024*1024)fail('internal_voice_response_oversized');chunks.push(Buffer.from(chunk));}
    res.setHeader('Content-Type',response.headers.get('content-type')==='audio/wav'?'audio/wav':'application/json');return res.status(response.status).send(Buffer.concat(chunks));
  }catch(e){return res.status(e.status||503).json({error:safeError(e)});}
};}
