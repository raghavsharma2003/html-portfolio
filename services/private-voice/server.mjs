import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {bearerToken} from '../../api/_auth-core.js';
import {createVoiceAllocationAdmissionHandler} from '../../api/_voice/allocation-admission-handler.js';
import {createPrivateVoiceHandler,privateVoiceCode} from '../../api/_private-voice-handler.js';
import {privateVoiceError} from '../../api/_private-voice-store.js';
import {createPrivateVoiceRuntime} from './runtime.mjs';
export function createDatabase(env=process.env,fetchImpl=fetch){
 let url;try{url=new URL(env.NEON_URL);}catch{throw privateVoiceError('private_voice_database_unconfigured',503);}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname.endsWith('.neon.tech'))throw privateVoiceError('private_voice_database_unconfigured',503);
 return async(query,params=[])=>{const response=await fetchImpl(`https://${url.hostname}/sql`,{method:'POST',headers:{'Neon-Connection-String':env.NEON_URL,'Content-Type':'application/json'},body:JSON.stringify({query,params}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok){await response.body?.cancel();throw privateVoiceError('private_voice_database_unavailable',503);}const value=await response.json();if(!Array.isArray(value.rows))throw privateVoiceError('private_voice_database_response_invalid',503);return value.rows;};
}
export function createPrivateVoiceServer({env=process.env,runtime,fetchImpl=fetch}={}){
 const requireUser=async req=>{const token=bearerToken(req);if(!token)throw privateVoiceError('private_voice_session_required',401);
  let origin;try{origin=new URL(env.SUPABASE_URL);}catch{throw privateVoiceError('private_voice_auth_unconfigured',503);}
  if(origin.protocol!=='https:'||origin.username||origin.password||!env.SUPABASE_KEY)throw privateVoiceError('private_voice_auth_unconfigured',503);
  const response=await fetchImpl(new URL('/auth/v1/user',origin),{headers:{apikey:env.SUPABASE_KEY,Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok){await response.body?.cancel();throw privateVoiceError('private_voice_session_invalid',401);}const text=await response.text();
  if(text.length>65536)throw privateVoiceError('private_voice_session_invalid',401);return JSON.parse(text);
 };
 const handler=createPrivateVoiceHandler({runtime,requireUser,env});
 const admission=createVoiceAllocationAdmissionHandler({env,consume:input=>runtime.lifecycle.consume(input)});
 const server=createServer(async(req,res)=>{
  res.status=code=>{res.statusCode=code;return res;};res.send=value=>res.end(value);res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  try{const path=new URL(req.url,'http://private').pathname;
   if(path==='/healthz'&&req.method==='GET')return res.status(200).json({service:'private-account-voice',gpu_probed:false});
   if(path==='/api/private-voice')return await handler(req,res);
   if(path==='/api/voice-allocation-admission')return await admission(req,res);
   if(path==='/api/voice-allocation-supervise'&&req.method==='POST'){
    const actual=Buffer.from(req.headers.authorization||''),expected=Buffer.from(`Bearer ${env.CRON_SECRET||''}`);
    if(!env.CRON_SECRET||actual.length!==expected.length||!timingSafeEqual(actual,expected))return res.status(401).json({error:'unauthorized'});
    if(env.AZURE_VOICE_APP_SUPERVISOR_ENABLED!=='true'||req.headers['x-vyakti-supervisor-source']!==runtime.lifecycle.policy.supervisor_source_sha256)return res.status(409).json({error:'private_voice_supervisor_binding_invalid'});
    const result=await runtime.lifecycle.supervise();await runtime.maintenance();return res.status(200).json(result);
   }
   return res.status(404).json({error:'not_found'});
  }catch(e){if(!res.headersSent)res.status(e.status||503).json({error:privateVoiceCode(e)});else res.end();}
 });server.requestTimeout=30000;server.headersTimeout=15000;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const runtime=createPrivateVoiceRuntime({db:createDatabase()});
 createPrivateVoiceServer({runtime}).listen(Number(process.env.PORT||8080),'0.0.0.0');
}
