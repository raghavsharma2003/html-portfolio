import {readBody} from '../services/internal-voice/http.mjs';
import {createPrivateVoiceStore,privateVoiceError} from './_private-voice-store.js';

// Integration seam only. Do not register a route until the real CPU queue
// consumer is deployed. JWT verification is provided by the existing server.
export function createPrivateVoiceHandler({db,requireUser,env=process.env,now=Date.now}){
 const store=createPrivateVoiceStore({db,now});
 return async(req,res)=>{
   res.setHeader('Cache-Control','private, no-store');
   try{
     if(env.VYAKTI_INTERNAL_VOICE_MODE!=='account-private'||env.VYAKTI_MODEL_SERVING!=='azure_only'||
       ![undefined,'','false'].includes(env.REPLICA_SELF_TEST_MODE)||env.REPLICA_SELF_TEST_ACCESS)
       throw privateVoiceError('private_voice_disabled',404);
     const user=await requireUser(req);if(!user?.id)throw privateVoiceError('private_voice_sign_in_required',401);
     const url=new URL(req.url,'http://internal');
     if(req.method==='GET'){
       const input=Object.fromEntries(url.searchParams);
       return res.status(200).json(input.run_id?{run:await store.status(user.id,input)}:await store.candidates(user.id,input));
     }
     if(req.method!=='POST')throw privateVoiceError('private_voice_method_invalid',405);
     const body=await readBody(req);
     if(body.action==='generate'){const result=await store.admit(user.id,body);return res.status(result.created?202:200).json(result);}
     if(body.action==='revoke')return res.status(200).json({run:await store.revoke(user.id,body)});
     throw privateVoiceError('private_voice_action_invalid',400);
   }catch(error){
     return res.status(error.status||503).json({error:/^private_voice_[a-z0-9_]+$/.test(error.code||'')?error.code:'private_voice_unavailable'});
   }
 };
}
