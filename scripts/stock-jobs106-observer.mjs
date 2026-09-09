// Separate CPU process. Survives runner disconnect; discovers exact147 rows by
// immutable experiment digest, then reuses149/150 supervise/recovery/stop.
import {readFile,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createNeonDb} from '../services/replica-processing-worker/db.js';
import {createGpuJobSupervisor} from '../services/azure-gpu-job/supervisor.mjs';
import {commitment} from '../services/azure-gpu-job/controller.mjs';
import {WORKLOAD} from '../services/voice-stock-comparison/job-plan.mjs';
const [file,approvedSha,journalPath]=process.argv.slice(2);
const envelope=JSON.parse(await readFile(file,'utf8'));
if(envelope.enabled!==true||commitment(envelope)!==approvedSha)throw Error('stock_observer_disabled');
if(!/^[a-z][a-z0-9_]{0,62}$/.test(envelope.expectedDatabase||''))throw Error('stock_observer_database_invalid');
const db=createNeonDb({expectedDatabase:envelope.expectedDatabase});
const sourceSha=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const expires=Date.now()+3600000;
const journal=await open(journalPath,'wx',0o600);
const emit=async data=>{const row={...data,pid:process.pid,sourceSha,approvedSha,at:Date.now(),expires};
  await journal.writeFile(JSON.stringify(row)+'\n');await journal.sync();
  if(process.connected)process.send(row,()=>{});};
let stopAfterIdle=false;
process.on('disconnect',()=>{stopAfterIdle=true;});
process.on('message',message=>{if(message?.kind==='runner_finished')stopAfterIdle=true;});
const entries=envelope.jobs.map((job,index)=>({job,policy:envelope.policies[index],
  experiment:commitment({purpose:WORKLOAD,arm:job.arm,plan:envelope.planSha256,manifest:job.manifestSha256,admission:envelope.admission})}));
try{
  while(Date.now()<expires){
    try{
    let pending=false;
    for(const {job,policy,experiment} of entries){
      const rows=await db('select window_id,job_control_state from vy_gpu_allocation_window where budget_id=$1 and provider_request_sha256=$2',[policy.budgetId,experiment]);
      if(rows.length>1)throw Error('stock_observer_multiple_windows');
      for(const row of rows){
        if(row.job_control_state&&row.job_control_state!=='terminal_observed'){
          pending=true;
          const supervisor=createGpuJobSupervisor({db,plan:job.plan,policy,getToken:async()=>process.env.AZURE_ARM_ACCESS_TOKEN});
          await supervisor.supervise(row.window_id,{cancel:Date.now()>=expires-120000});
        }
      }
    }
    await emit({kind:'watching'});
    if(stopAfterIdle&&!pending)break;
    }catch{await emit({kind:'unknown',fundsHeld:true}).catch(()=>{});}
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  await emit({kind:'closed',fundsHeld:true});
}finally{await journal.close();}
