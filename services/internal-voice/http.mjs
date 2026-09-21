import {fail,safeError,configuredOwner} from './contract.mjs';
export async function readBody(req,limit=8192){
  if(req.body!==undefined){const text=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(Buffer.byteLength(text)>limit)fail('internal_voice_request_oversized',413);return JSON.parse(text);}
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)fail('internal_voice_request_oversized',413);chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString());
}
export function createInternalVoiceHandler({runtime,requireUser,env=process.env}){return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
    try{configuredOwner(env);}catch{return res.status(404).json({enabled:false});}
    const user=await requireUser(req),url=new URL(req.url,'http://internal');
    if(req.method==='GET'){
      const replica=url.searchParams.get('replica_id'),id=url.searchParams.get('run_id'),action=url.searchParams.get('action');
      if(action==='audio'||action==='reference'){const bytes=await runtime.audio(user,replica,id,action==='reference');res.setHeader('Content-Type','audio/wav');return res.status(200).send(bytes);}
      if(action)fail('internal_voice_action_invalid',400);
      return res.status(200).json(await runtime.status(user,replica,id));
    }
    if(req.method!=='POST')fail('internal_voice_method_invalid',405);
    const body=await readBody(req),{action,replica_id,run_id}=body;
    if(action==='generate')return res.status(202).json(await runtime.generate(user,replica_id,run_id));
    if(action==='rate')return res.status(200).json(await runtime.rate(user,replica_id,run_id,body.ratings));
    if(action==='revoke')return res.status(200).json(await runtime.revoke(user,replica_id,run_id));
    fail('internal_voice_action_invalid',400);
  }catch(e){return res.status(e.status||409).json({error:safeError(e)});}
};}
