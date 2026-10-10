import {commitment} from '../services/azure-voice-app/controller.mjs';
import {q} from './_db.js';
import {timingSafeEqual} from 'node:crypto';
import {loadDueVoiceWindows} from './_voice/allocation-boundary.js';
import {voiceAppRuntime} from './_voice/allocation-runtime.js';
// Independent CPU schedule, disabled until explicitly deployed and verified.
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'method_refused'});
 const actual=String(req.headers.authorization||''),expected=`Bearer ${process.env.CRON_SECRET||''}`;
 if(!process.env.CRON_SECRET||actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return res.status(401).json({error:'unauthorized'});
 if(process.env.AZURE_VOICE_APP_SUPERVISOR_ENABLED!=='true')return res.status(503).json({error:'voice_allocation_not_configured'});
 try{
  const runtime=voiceAppRuntime({db:q});if(!runtime)return res.status(503).json({error:'voice_allocation_not_configured'});
  if(req.headers['x-vyakti-supervisor-source']!==runtime.policy.supervisor_source_sha256)return res.status(409).json({error:'supervisor_source_mismatch'});
  const rows=await loadDueVoiceWindows(q,runtime.plan);const results=[];let degraded=false;
  for(const row of rows){try{results.push(await runtime.controller.supervisorTick(row.window_id));}catch{degraded=true;results.push({state:'observation_unknown'});}}
  if(degraded){
   await q('update vy_voice_app_supervisor_lease set lease_expires_at=now() where app_id=$1',[runtime.plan.app_id]);
   return res.status(503).json({error:'voice_app_supervision_degraded',accounted:false});
  }
  await q(`insert into vy_voice_app_supervisor_lease(app_id,contract_sha256,revision_sha256,source_sha256,heartbeat_at,lease_expires_at)
  values($1,$2,$3,$4,now(),now()+interval '30 seconds') on conflict(app_id) do update set contract_sha256=excluded.contract_sha256,revision_sha256=excluded.revision_sha256,source_sha256=excluded.source_sha256,heartbeat_at=now(),lease_expires_at=now()+interval '30 seconds'`,
  [runtime.plan.app_id,runtime.plan.contract_sha256,commitment({revision_name:runtime.plan.revision_name,configuration_sha256:runtime.plan.configuration_sha256,template_sha256:runtime.plan.template_sha256}),runtime.policy.supervisor_source_sha256]);
  return res.status(200).json({observations:results,accounted:false});
 }catch{return res.status(503).json({error:'voice_app_supervision_unavailable'});}
}
export const config={maxDuration:180};
