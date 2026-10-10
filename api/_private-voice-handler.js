import {privateVoiceError} from './_private-voice-store.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const privateVoiceCode=e=>/^[a-z][a-z0-9_]{2,100}$/.test(e?.code||'')?e.code:'private_voice_operation_failed';
export function privateVoiceEnabled(env){return env.VYAKTI_PRIVATE_VOICE_MODE==='account-private'&&![true,'true'].includes(env.REPLICA_SELF_TEST_MODE)&&!env.REPLICA_SELF_TEST_ACCESS;}
export async function privateVoiceBody(req){
 let body;if(req.body!==undefined){body=typeof req.body==='string'?req.body:JSON.stringify(req.body);}else{
 const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>8192)throw privateVoiceError('private_voice_request_oversized',413);parts.push(Buffer.from(part));}body=Buffer.concat(parts).toString();}
 if(Buffer.byteLength(body)>8192)throw privateVoiceError('private_voice_request_oversized',413);
 try{const parsed=JSON.parse(body);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed;}
 catch{throw privateVoiceError('private_voice_request_invalid',400);}
}
export function createPrivateVoiceHandler({runtime,requireUser,env=process.env}){return async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  if(!privateVoiceEnabled(env))return res.status(404).json({enabled:false,error:'private_voice_disabled'});
  const user=await requireUser(req);if(!UUID.test(user?.id||''))throw privateVoiceError('private_voice_session_invalid',401);
  if(!['GET','POST'].includes(req.method))throw privateVoiceError('private_voice_method_invalid',405);
  const input=req.method==='POST'?await privateVoiceBody(req):Object.fromEntries(new URL(req.url,'http://private').searchParams);
  if(!UUID.test(input.replica_id||''))throw privateVoiceError('private_voice_identifier_invalid',400);
  if(req.method==='GET'&&!input.action){if(Object.keys(input).some(k=>k!=='replica_id'))throw privateVoiceError('private_voice_unexpected_input',400);return res.status(200).json(await runtime.candidates(user.id,input));}
  if(!UUID.test(input.run_id||''))throw privateVoiceError('private_voice_identifier_invalid',400);
  if(input.action!=='generate'&&Object.keys(input).some(k=>!['replica_id','run_id','action',...(input.action==='rate'?['ratings']:[])].includes(k)))throw privateVoiceError('private_voice_unexpected_input',400);
  if(req.method==='POST'&&input.action==='generate')return res.status(202).json(await runtime.generate(user.id,input));
  if(req.method==='GET'&&input.action==='status')return res.status(200).json(await runtime.status(user.id,input));
  if(req.method==='GET'&&input.action==='audio'){const bytes=await runtime.audio(user.id,input);res.setHeader('Content-Type','audio/wav');return res.status(200).send(bytes);}
  if(req.method==='POST'&&input.action==='rate')return res.status(200).json(await runtime.rate(user.id,input));
  if(req.method==='POST'&&input.action==='revoke')return res.status(200).json(await runtime.revoke(user.id,input));
  throw privateVoiceError('private_voice_action_invalid',400);
 }catch(e){const status=Number.isInteger(e.status)?e.status:503;return res.status(status).json({error:privateVoiceCode(e),blocker_class:status===400?'you':'us'});}
};}
