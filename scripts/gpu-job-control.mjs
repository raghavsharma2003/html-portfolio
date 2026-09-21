import {readFile,writeFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {isolatedJobPlan,deploymentTemplate,createAzureJobInspector} from '../services/azure-gpu-job/controller.mjs';

// Operator CLI, not a public API. plan makes no requests. inspect/observe use
// GET. stop requires the exact named execution and an append-only local receipt.
const [mode,configPath,argument,journalPath] = process.argv.slice(2);
try {
  if (!['plan','inspect','observe','stop','start'].includes(mode) || !configPath) throw Error('gpu_job_usage_invalid');
  const plan = isolatedJobPlan(JSON.parse(await readFile(resolve(configPath),'utf8')));
  if (mode === 'plan') {
    if (!argument) throw Error('gpu_plan_output_required');
    await writeFile(resolve(argument),JSON.stringify({plan,deployment:deploymentTemplate(plan)},null,2)+'\n',{flag:'wx'});
    console.log('gpu_job_plan_written_activation_unavailable');
  } else {
    const inspector = createAzureJobInspector({plan,getToken:async()=>process.env.AZURE_ARM_ACCESS_TOKEN});
    if (mode === 'start') await inspector.start();
    let result;
    if (mode === 'stop') {
      if (!journalPath) throw Error('gpu_stop_journal_required');
      const file = await open(resolve(journalPath),'ax',0o600);
      try {
        await file.writeFile(JSON.stringify({event:'stop_requested',job_id:plan.job_id,execution:argument,at:new Date().toISOString()})+'\n');
        await file.sync();
        result = await inspector.stop(argument);
        await file.writeFile(JSON.stringify({event:'stop_observed',...result,at:new Date().toISOString()})+'\n');
        await file.sync();
      } finally { await file.close(); }
    } else if (mode === 'inspect') result=await inspector.inspect();
    else if (mode === 'observe') result=await inspector.observe(argument);
    console.log(JSON.stringify(result));
  }
} catch(error) {
  // Never print provider payloads, tokens, raw exceptions or private config.
  console.error(/^gpu_[a-z0-9_]+$/.test(error.message||'')?error.message:'gpu_job_operation_failed');
  process.exitCode=1;
}
