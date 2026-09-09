// Retained-console query follows the already used GPU36 Log Analytics route.
// It reads only the exact admitted job/execution and fixed STOCK106 prefix.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function stockLogQuery(jobName,execution){
 if(!/^vyakti-stock106-(chatterbox|voxcpm2)$/.test(jobName)||!execution.startsWith(jobName+'-')||!/^[A-Za-z0-9_-]{1,128}$/.test(execution))fail('stock_log_execution_invalid');
 return `ContainerAppConsoleLogs_CL | extend job=coalesce(tostring(column_ifexists("ContainerJobName_s", "")),tostring(column_ifexists("JobName_s", "")),tostring(column_ifexists("ContainerAppName_s", ""))), execution=tostring(column_ifexists("JobExecutionName_s", "")), pod=tostring(column_ifexists("ContainerGroupName_s", "")), log=tostring(column_ifexists("Log_s", "")) | where job == "${jobName}" | where execution == "${execution}" or pod == "${execution}" or pod startswith "${execution}-" | where log startswith "VYAKTI_STOCK106 " | project log | take 12001`;
}
export function createStockCapture({workspaceId,getToken,outputDir,fetchImpl=globalThis.fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}){
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(workspaceId||'')||typeof getToken!=='function')fail('stock_log_workspace_required');
 return async({job,started,planSha256})=>{
  if(!job.contextPath||sha(await readFile(join(job.contextPath,'manifest.json')))!==job.manifestSha256)fail('stock_capture_manifest_changed');
  const manifest=JSON.parse(await readFile(join(job.contextPath,'manifest.json'),'utf8'));
  if(manifest.planSha256!==planSha256||manifest.arm!==job.arm)fail('stock_capture_plan_changed');
  const query=stockLogQuery(job.plan.job_id.split('/').at(-1),started.execution_name);
  const request=JSON.stringify({query,timespan:'PT2H'}),url=`https://api.loganalytics.azure.com/v1/workspaces/${workspaceId}/query`;
  await mkdir(outputDir,{recursive:true});
  const logPath=join(outputDir,`${job.arm}.log`),resultPath=join(outputDir,`${job.arm}.json`);
  for(let attempt=0;attempt<12;attempt++){
   const token=await getToken();if(typeof token!=='string'||!token||/[\r\n]/.test(token))fail('stock_log_token_missing');
   const response=await fetchImpl(url,{method:'POST',body:request,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(30000)});
   if(response.status!==200){await response.body?.cancel();fail('stock_log_query_failed');}
   const reader=response.body.getReader();let length=0;const chunks=[];
   try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>32*1024*1024)fail('stock_log_response_oversized');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
   const bytes=Buffer.concat(chunks),body=JSON.parse(bytes);
   const table=body.tables?.[0];
   if(body.error||body.tables?.length!==1||table?.columns?.length!==1||table.columns[0].name!=='log'||table.rows?.length>12000
    ||!Array.isArray(table.rows)||table.rows.some(r=>r.length!==1||typeof r[0]!=='string'))fail('stock_log_projection_invalid');
   const log=table.rows.map(r=>r[0]).join('\n')+'\n';
   // No generation is retried. Only bounded read-only log ingestion polling.
   if(log.includes('"kind":"job_complete"')||log.includes('"kind": "job_complete"')){
    await writeFile(logPath,log,{flag:'wx'});
    const collected=spawnSync('python',[fileURLToPath(new URL('./collect.py',import.meta.url)),job.contextPath,logPath,started.window_id,resultPath],{encoding:'utf8',timeout:30000,windowsHide:true});
    if(collected.status!==0)fail('stock_log_artifact_verification_failed');
    const result=JSON.parse(await readFile(resultPath,'utf8'));
    if(result.results?.length!==6)fail('stock_log_artifact_verification_failed');
    const receipt={kind:'stock106-verified-job-artifacts/v1',windowId:started.window_id,planSha256,arm:job.arm,outputs:6,
      manifestSha256:job.manifestSha256,captureSha256:sha(bytes),querySha256:sha(request),logSha256:sha(log),
      executionName:started.execution_name,workspaceId,capturedAt:now(),resultPath,logPath,readAttempts:attempt+1};
    await writeFile(join(outputDir,`${job.arm}.capture.json`),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    return receipt;
   }
   await sleep(10000);
  }
  fail('stock_log_completion_unavailable');
 };
}
