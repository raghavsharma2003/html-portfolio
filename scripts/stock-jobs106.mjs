import {readFile,open} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {stockJobPlans,runStockJobs} from '../services/voice-stock-comparison/job-plan.mjs';
import {commitment,createAzureJobInspector} from '../services/azure-gpu-job/controller.mjs';
import {createStockCapture} from '../services/voice-stock-comparison/capture.mjs';
import {startStockObserver,guardStockDispatch} from '../services/voice-stock-comparison/observer.mjs';
const [mode,file,approvedHash,journalPath]=process.argv.slice(2);
try{
  const input=JSON.parse(await readFile(resolve(file),'utf8'));
  if(mode==='plan'){console.log(JSON.stringify(stockJobPlans(input),null,2));}
  else if(mode==='run'){
    // Refuse before DB/token imports or opening a one-use journal.
    if(input.enabled!==true||approvedHash!==commitment(input)||!journalPath)throw Error('stock_jobs_disabled');
    if(!/^[a-z][a-z0-9_]{0,62}$/.test(input.expectedDatabase||''))throw Error('stock_expected_database_required');
    const handle=await open(resolve(journalPath),'wx',0o600);
    let db,watcher,finished=false;
    try{
      const {createNeonDb}=await import('../services/replica-processing-worker/db.js');
      const {createGpuJobSupervisor}=await import('../services/azure-gpu-job/supervisor.mjs');
      db=createNeonDb({expectedDatabase:input.expectedDatabase});
      const captureAndCollect=createStockCapture({workspaceId:input.logAnalyticsWorkspaceId,
        getToken:async()=>process.env.AZURE_LOG_ANALYTICS_ACCESS_TOKEN,outputDir:join(dirname(resolve(journalPath)),'stock106-artifacts')});
      watcher=await startStockObserver({file:resolve(file),approvedSha:approvedHash,sourceSha:input.observerSourceSha256,journalPath:resolve(journalPath)+'.observer'});
      const fetchImpl=guardStockDispatch(globalThis.fetch,watcher.assertObserver);
      const result=await runStockJobs(input,{approvedSha256:approvedHash,
        assertObserver:watcher.assertObserver,captureAndCollect,
        makeSupervisor:(plan,policy)=>{
          const config={db,plan,policy,fetchImpl,getToken:async()=>process.env.AZURE_ARM_ACCESS_TOKEN};
          const base=createGpuJobSupervisor(config),inspector=createAzureJobInspector(config);let started;
          return {start:async experiment=>(started=await base.start(experiment)),supervise:async(window,options)=>{
            const result=await base.supervise(window,options);
            // The independent watcher may have recorded terminal first. Recover
            // actual ARM outcome; terminal_observed alone never means success.
            return result.state==='terminal_observed'?inspector.observe(started.execution_name,window):result;
          }};
        },
        journal:async row=>{await handle.writeFile(JSON.stringify(row)+'\n');await handle.sync();},
        sleep:ms=>new Promise(r=>setTimeout(r,ms))});
      console.log(JSON.stringify(result));
      finished=true;
    }finally{if(finished)watcher?.finish();else watcher?.leaveRunning();await handle.close();await db?.close?.();}
  }else throw Error('stock_job_mode_invalid');
}catch(error){console.error(/^stock_[a-z_]+$/.test(error.message||'')?error.message:'stock_job_operation_failed');process.exitCode=1;}
