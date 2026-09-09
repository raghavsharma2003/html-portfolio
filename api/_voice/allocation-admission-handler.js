import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {consumeVoiceAllocationChild} from './allocation-boundary.js';
const PROTOCOL='vyakti-open-voice/v1',PATH='/api/voice-allocation-admission';
const digest=b=>createHash('sha256').update(b).digest('hex');
const sig=(key,parts)=>createHmac('sha256',key).update(parts.join('\n')).digest('base64url');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createVoiceAllocationAdmissionHandler({db,env=process.env,now=()=>Date.now()}={}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 const raw=env.OPEN_VOICE_HMAC_SECRET||'';
 const key=/^[0-9a-f]{64,}$/i.test(raw)?Buffer.from(raw,'hex'):Buffer.from(raw,'base64url');
 const nonce=req.headers?.['x-vyakti-nonce']||'';
 const reply=(status,data)=>{
  const bytes=Buffer.from(JSON.stringify(data));
  res.setHeader('Content-Type','application/json');
  if(key.length>=32)res.setHeader('X-Vyakti-Response-Signature',sig(key,[PROTOCOL,'response',PATH,nonce,String(status),digest(bytes)]));
  return res.status(status).send(bytes);
 };
 if(req.method!=='POST')return reply(405,{error:'method_refused'});
 if(env.AZURE_VOICE_APP_ENABLED!=='true'||key.length<32)return reply(503,{error:'voice_allocation_not_configured'});
 try{
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>4096)return reply(413,{error:'request_size_invalid'});chunks.push(chunk);}
  const bytes=Buffer.concat(chunks),timestamp=req.headers['x-vyakti-timestamp'];
  if(!bytes.length||req.headers['x-vyakti-protocol']!==PROTOCOL||!/^[A-Za-z0-9_-]{20,64}$/.test(nonce)||!Number.isFinite(Date.parse(timestamp))||Math.abs(now()-Date.parse(timestamp))>60000||req.headers['x-vyakti-content-sha256']!==digest(bytes)||!same(req.headers['x-vyakti-signature'],sig(key,[PROTOCOL,'POST',PATH,timestamp,nonce,digest(bytes)])))return reply(401,{error:'transport_binding_invalid'});
  const input=JSON.parse(bytes.toString('utf8'));
  if(Object.keys(input).sort().join(',')!=='body_sha256,broker_origin,child_id,operation,runtime_origin,window_id')return reply(400,{error:'request_binding_invalid'});
  return reply(200,await consumeVoiceAllocationChild(db,input));
 }catch{return reply(409,{error:'voice_allocation_child_refused'});}
};}
