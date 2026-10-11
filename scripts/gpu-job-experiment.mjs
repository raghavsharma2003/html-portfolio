import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {isolatedJobPlan} from '../services/azure-gpu-job/controller.mjs';
import {createGpuJobSupervisor} from '../services/azure-gpu-job/supervisor.mjs';
import {createNeonDb} from '../services/replica-processing-worker/db.js';

const [mode,policyFile,target]=process.argv.slice(2);
try {
  if (!['start','supervise','cancel'].includes(mode)||!policyFile||!target) throw Error('gpu_experiment_usage_invalid');
  const input=JSON.parse(await readFile(resolve(policyFile),'utf8'));
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(input.expectedDatabase||'')) throw Error('gpu_expected_database_required');
  const supervisor=createGpuJobSupervisor({
    plan:isolatedJobPlan(input.plan),policy:input.policy,
    db:createNeonDb({expectedDatabase:input.expectedDatabase}),getToken:async()=>process.env.AZURE_ARM_ACCESS_TOKEN,
  });
  const result=mode==='start'?await supervisor.start(target):await supervisor.supervise(target,{cancel:mode==='cancel'});
  console.log(JSON.stringify(result));
} catch(error) {
  console.error(/^gpu_[a-z0-9_]+$/.test(error.message||'')?error.message:'gpu_experiment_failed');
  process.exitCode=1;
}
