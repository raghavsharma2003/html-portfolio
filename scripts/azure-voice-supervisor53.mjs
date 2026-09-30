// Run in a separately supervised Azure CPU Job BEFORE the owner canary.
// This process performs no GPU/model calls; the callback owns exact ARM cleanup.
const origin=new URL(process.env.AZURE_VOICE_SUPERVISOR_ORIGIN||'http://invalid');
if(origin.protocol!=='https:'||!origin.hostname.endsWith('.azurecontainerapps.io')||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw Error('supervisor_origin_invalid');
const secret=process.env.CRON_SECRET,source=process.env.AZURE_VOICE_SUPERVISOR_SOURCE_SHA256;
if(!secret||! /^[0-9a-f]{64}$/.test(source||''))throw Error('supervisor_configuration_missing');
const end=Date.now()+960000;
let failures=0;
while(Date.now()<end){
 try{
  const r=await fetch(`${origin.origin}/api/voice-allocation-supervise`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'X-Vyakti-Supervisor-Source':source},redirect:'error',signal:AbortSignal.timeout(90000)});
  await r.body?.cancel();if(!r.ok)throw Error('callback_refused');failures=0;
 }catch{failures++;console.error('voice_supervisor_observation_unknown');}
 if(failures>=3)process.exitCode=1;
 await new Promise(resolve=>setTimeout(resolve,10000));
}
