import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {createInternalVoiceRuntime} from './runtime.mjs';
import {createInternalVoiceHandler} from './http.mjs';
import {createVoiceAllocationAdmissionHandler} from '../../api/_voice/allocation-admission-handler.js';
import {bearerToken} from '../../api/_auth-core.js';
import {fail,safeError} from './contract.mjs';
export function createInternalVoiceServer({env=process.env,runtime=createInternalVoiceRuntime({env}),fetchImpl=fetch}={}){
  const requireUser=async req=>{
    const token=bearerToken(req);if(!token)fail('internal_voice_session_required',401);
    const origin=new URL(env.SUPABASE_URL);if(origin.protocol!=='https:'||!env.SUPABASE_KEY)fail('internal_voice_auth_unconfigured',503);
    const response=await fetchImpl(new URL('/auth/v1/user',origin),{headers:{apikey:env.SUPABASE_KEY,Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok){await response.body?.cancel();fail('internal_voice_session_invalid',401);}
    const text=await response.text();if(text.length>65536)fail('internal_voice_session_invalid',401);const user=JSON.parse(text);if(!user?.id)fail('internal_voice_session_invalid',401);return user;
  };
  const handler=createInternalVoiceHandler({runtime,requireUser,env});
  const admission=createVoiceAllocationAdmissionHandler({env,consume:input=>runtime.consume(input)});
  return createServer(async(req,res)=>{
    res.status=code=>{res.statusCode=code;return res;};res.send=value=>res.end(value);res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    try{const path=new URL(req.url,'http://internal').pathname;
      if(path==='/healthz'&&req.method==='GET')return res.status(200).json({service:'internal-owner-voice',gpu_probed:false});
      if(path==='/api/voice-allocation-admission')return await admission(req,res);
      if(path==='/api/internal-voice')return await handler(req,res);
      return res.status(404).json({error:'not_found'});
    }catch(e){if(!res.headersSent)res.status(e.status||500).json({error:safeError(e)});else res.end();}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const runtime=createInternalVoiceRuntime();
  if(process.argv[2]==='prime')process.stdout.write(`${JSON.stringify(await runtime.prime())}\n`);
  else if(process.argv[2]===undefined||process.argv[2]==='serve'){
    const server=createInternalVoiceServer({runtime});server.requestTimeout=30000;server.headersTimeout=15000;server.listen(Number(process.env.PORT||8080),'0.0.0.0');
  }else fail('internal_voice_command_invalid');
}
