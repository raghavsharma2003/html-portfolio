import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compileStockComparison,payloadTemplate,scoringManifest,requireExecutableComparison,sha} from './plan.mjs';
import {stockJobPlans,runStockJobs,BASE_IMAGES,WORKLOAD} from '../../services/voice-stock-comparison/job-plan.mjs';
import {isolatedJobPlan,inspectJobSnapshot,commitment,windowExecutionTemplate,GPU_PROBE} from '../../services/azure-gpu-job/controller.mjs';
import {assertStockObserver,guardStockDispatch} from '../../services/voice-stock-comparison/observer.mjs';
import {stockLogQuery,createStockCapture} from '../../services/voice-stock-comparison/capture.mjs';
const root=new URL('../../',import.meta.url),stock=resolve(process.argv[2]);
globalThis.fetch=()=>{throw Error('network_forbidden');};
const corpus=JSON.parse(readFileSync(new URL('prompts.v1.json',import.meta.url),'utf8')),audio=readFileSync(stock);
const plan=compileStockComparison(corpus,audio);let n=0;
async function test(name,fn){await fn();console.log(`ok ${++n} ${name}`);}
const verified=async({job,started,planSha256})=>({kind:'stock106-verified-job-artifacts/v1',windowId:started.window_id,
 planSha256,arm:job.arm,outputs:6,manifestSha256:job.manifestSha256,captureSha256:'d'.repeat(64)});
const run=(envelope,options)=>runStockJobs(envelope,{assertObserver:async()=>{},captureAndCollect:verified,...options});
await test('six texts and twelve matched n1 cells, full source, no guessed transcript',()=>{
 assert.equal(plan.cells.length,12);assert.equal(plan.reference.durationSeconds,26.6125);assert.equal(plan.reference.transcript,null);
 for(const p of plan.prompts){const cells=plan.cells.filter(c=>c.promptId===p.id);assert.equal(cells[0].textSha256,cells[1].textSha256);assert.equal(cells[0].seed,cells[1].seed);}
});
await test('reference mutation and mismatched authored spans refuse',()=>{
 const bad=Buffer.from(audio);bad[bad.length-1]^=1;assert.throws(()=>compileStockComparison(corpus,bad),/reference_changed/);
 const c=structuredClone(corpus);c.prompts[2].languageSpans[0].text='changed';assert.throws(()=>compileStockComparison(c,audio),/spans_invalid/);
});
await test('scoring has no owner likeness values or fictitious outputs',()=>{
 const s=scoringManifest(plan);assert.equal(s.excludedAxis.id,'owner_likeness');assert.equal(s.humanRatingsCollected,0);
 assert(s.cells.every(c=>c.ratings===null&&c.opaqueOutputId===null));
 assert.throws(()=>requireExecutableComparison({...plan,executionAllowed:true}),/durable_admission_missing/);
 assert.equal(payloadTemplate(plan,plan.cells.at(-1).cellId).third_party_policy_receipt_sha256,null);
});
const prefix='/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/fixture';
const input={contract:'vyakti-stock-job-provision-input/v1',planSha256:plan.planSha256,jobs:['chatterbox','voxcpm2'].map((arm,i)=>({arm,baseImage:BASE_IMAGES[arm],
 image:`fixture.azurecr.io/stock-${arm}@sha256:${String(i+1).repeat(64)}`,manifestSha256:String(i+3).repeat(64),
 jobId:`${prefix}/providers/Microsoft.App/jobs/vyakti-stock106-${arm}`,environmentId:`${prefix}/providers/Microsoft.App/managedEnvironments/gpu`,workloadProfileName:'gpu-t4'}))};
const envelope=stockJobPlans(input);
await test('two fixed Manual job plans inherit zero retry and no arbitrary command/env',()=>{
 assert.equal(envelope.enabled,false);
 for(const j of envelope.jobs){assert.deepEqual(j.plan.properties.template.containers[0].command,['python','/opt/vyakti-stock/entrypoint.py']);assert.equal(j.plan.properties.configuration.replicaRetryLimit,0);
 assert.deepEqual(windowExecutionTemplate(j.plan,'00000106-0000-4000-a000-000000000002').containers[0].env,[{name:'VYAKTI_GPU_WINDOW_ID',value:'00000106-0000-4000-a000-000000000002'}]);}
 const probe=isolatedJobPlan({...input.jobs[0],replicaTimeout:120});assert.deepEqual(probe.properties.template.containers[0].command,['python','-c',GPU_PROBE]);assert(!Object.hasOwn(probe,'workload'));
 assert.throws(()=>isolatedJobPlan({...input.jobs[0],replicaTimeout:900,workload:'arbitrary'}),/workload_invalid/);
});
await test('recomputed hash cannot admit an arbitrary stock command',()=>{
 const j=structuredClone(envelope.jobs[0].plan);j.properties.template.containers[0].command=['python','-c','print(1)'];j.configuration_sha256=commitment(j.properties);j.template_sha256=commitment(j.properties.template);
 assert.throws(()=>inspectJobSnapshot(j,{},{}),/plan_invalid/);
});
const enabled={...envelope,enabled:true,planSha256:plan.planSha256,admission:{kind:'reviewed-stock-job-admission/v1',planSha256:plan.planSha256,approvalSha256:'a'.repeat(64),maximumReservationMicrousd:3000000},
 policies:envelope.jobs.map(j=>({configurationSha256:j.plan.configuration_sha256,approvalSha256:'a'.repeat(64),planningHeadroomSeconds:360,
   rateMicrousdPerSecond:500,limitMicrousd:3000000,budgetId:'gpu-stock106-fixture'}))};
await test('disabled envelope refuses before supervisor construction',async()=>{
 let calls=0;await assert.rejects(run(envelope,{approvedSha256:commitment(envelope),makeSupervisor:()=>calls++}),/disabled/);assert.equal(calls,0);
});
await test('combined reservation over admission bound refuses before any start',async()=>{
 const bad=structuredClone(enabled);bad.admission.maximumReservationMicrousd=1;
 let starts=0;await assert.rejects(run(bad,{approvedSha256:commitment(bad),journal:async()=>{},sleep:async()=>{},makeSupervisor:()=>starts++}),/budget_exceeded/);assert.equal(starts,0);
});
await test('second job only starts after successful terminal observation; failed/unknown no retry',async()=>{
 for(const state of ['Succeeded','Failed']){const events=[];
 const result=run(enabled,{approvedSha256:commitment(enabled),journal:async row=>events.push(row.kind+':'+row.arm),sleep:async()=>{},
 makeSupervisor:job=>({start:async()=>({window_id:job.job_id}),supervise:async()=>({terminal:true,state})})});
 if(state==='Failed'){await assert.rejects(result,/terminal_success_unproved/);assert.equal(events.filter(e=>e.startsWith('started')).length,1);}
 else {assert.equal((await result).completed.length,2);assert(events.indexOf('artifacts_verified:chatterbox')<events.indexOf('start_intent:voxcpm2'));}}
 let starts=0;await assert.rejects(run(enabled,{approvedSha256:commitment(enabled),journal:async()=>{},sleep:async()=>{},
 makeSupervisor:()=>({start:async()=>{starts++;throw Error('gpu_start_outcome_unknown');}})}),/outcome_unknown/);assert.equal(starts,1);
});
await test('post-start journal, supervision, sleep and deadline failures attempt exact cleanup; no arm2',async()=>{
 for(const failure of ['journal','supervise','sleep','deadline']){
  let starts=0,cancels=0,time=0;
  await assert.rejects(run(enabled,{approvedSha256:commitment(enabled),now:()=>failure==='deadline'?(time+=1260001):0,
   journal:async row=>{if(failure==='journal'&&row.kind==='started')throw Error('fixture_journal');},
   sleep:async()=>{throw Error('fixture_sleep');},makeSupervisor:()=>({
    start:async()=>{starts++;return {window_id:'known'};},supervise:async(id,options)=>{assert.equal(id,'known');if(options?.cancel){cancels++;return {terminal:false,state:'unknown'};}
      if(failure==='supervise')throw Error('fixture_supervise');return {terminal:false};}})}));
  assert.equal(starts,1);assert.equal(cancels,1);
 }
});
await test('missing artifact capture blocks arm2 after terminal success and never reruns synthesis',async()=>{
 for(const capture of [async()=>{throw Error('truncated');},async()=>({outputs:5})]){
  let starts=0;await assert.rejects(run(enabled,{approvedSha256:commitment(enabled),journal:async()=>{},sleep:async()=>{},captureAndCollect:capture,
   makeSupervisor:()=>({start:async()=>{starts++;return {window_id:'one'};},supervise:async()=>({terminal:true,state:'Succeeded'})})}));assert.equal(starts,1);
 }
});
await test('fresh source-bound live observer required at actual ARM dispatch; stale/dead/future refuse',async()=>{
 const options={pid:106,sourceSha:'a',approvedSha:'b',now:100000,isAlive:()=>{}},message={kind:'watching',pid:106,sourceSha:'a',approvedSha:'b',at:99000,expires:2000000};
 assertStockObserver(message,options);
 for(const patch of [{at:80000},{at:100001},{sourceSha:'x'},{approvedSha:'x'},{kind:'unknown'},{expires:100001}])assert.throws(()=>assertStockObserver({...message,...patch},options));
 assert.throws(()=>assertStockObserver(message,{...options,isAlive:()=>{throw Error('dead');}}),/not_alive/);
 let sent=0;const guarded=guardStockDispatch(async()=>sent++,async remaining=>{assert.equal(remaining,1500000);throw Error('watcher_failed');});
 await assert.rejects(guarded('https://management.azure.com/subscriptions/a/jobs/b/start?api-version=x',{method:'POST'}),/watcher_failed/);assert.equal(sent,0);
 await guarded('https://management.azure.com/read',{method:'GET'});assert.equal(sent,1);
});
await test('log capture rejects foreign execution and malformed workspace before transport',()=>{
 assert.throws(()=>stockLogQuery('owner-app','owner-execution'));
 assert.throws(()=>stockLogQuery('vyakti-stock106-chatterbox','vyakti-stock106-voxcpm2-1'));
 assert.throws(()=>stockLogQuery('vyakti-stock106-chatterbox','vyakti-stock106-chatterbox-1" | take 1'));
 assert.throws(()=>createStockCapture({workspaceId:'https://foreign.invalid',getToken:async()=>''}));
 assert(stockLogQuery('vyakti-stock106-chatterbox','vyakti-stock106-chatterbox-1').includes('take 12001'));
});
const temp=mkdtempSync(join(tmpdir(),'vyakti-stock106-')),contexts=join(temp,'contexts');
await test('actual overlay preparation copies exact stock/runtime bytes without build/download',()=>{
 const p=spawnSync(process.execPath,['scripts/prepare-stock-jobs106.mjs','--reference',stock,'--out',contexts],{cwd:root,encoding:'utf8'});assert.equal(p.status,0,p.stderr);
 for(const arm of ['chatterbox','voxcpm2']){assert.deepEqual(readFileSync(join(contexts,arm,'stock.wav')),audio);const docker=readFileSync(join(contexts,arm,'Dockerfile'),'utf8');assert(docker.startsWith('FROM '+BASE_IMAGES[arm]));assert(!/^RUN |pip |apt-|wget|curl/m.test(docker));}
});
await test('Python runtime, bounded artifact and no-retry controls',()=>{
 const p=spawnSync('python',['evals/voice-stock-comparison/runtime-controls.py',contexts],{cwd:root,encoding:'utf8'});assert.equal(p.status,0,p.stderr||p.stdout);console.log(p.stdout.trim());
});
await test('actual capture caller carries exact execution through authenticated-response fixture and full collector',async()=>{
 const arm='chatterbox',contextPath=join(contexts,arm),fixtureLog=readFileSync(join(contextPath,'cpu-fixture.log'),'utf8');
 const job={...envelope.jobs[0],contextPath,manifestSha256:sha(readFileSync(join(contextPath,'manifest.json')))};
 const started={window_id:'00000106-0000-4000-a000-000000000002',execution_name:'vyakti-stock106-chatterbox-fixture'};
 let calls=0;
 const capture=createStockCapture({workspaceId:'00000106-0000-4000-a000-000000000003',getToken:async()=> 'fixture-token',outputDir:join(temp,'capture'),
  fetchImpl:async(url,options)=>{calls++;assert(url.startsWith('https://api.loganalytics.azure.com/'));assert.equal(options.headers.Authorization,'Bearer fixture-token');
   assert(JSON.parse(options.body).query.includes(started.execution_name));return new Response(JSON.stringify({tables:[{columns:[{name:'log'}],rows:fixtureLog.trim().split('\n').map(line=>[line])}]}),{status:200});}});
 const receipt=await capture({job,started,planSha256:plan.planSha256});assert.equal(calls,1);assert.equal(receipt.outputs,6);assert.equal(receipt.windowId,started.window_id);
 assert.equal(JSON.parse(readFileSync(receipt.resultPath,'utf8')).results.length,6);
 const bad=createStockCapture({workspaceId:'00000106-0000-4000-a000-000000000003',getToken:async()=> 'fixture-token',outputDir:join(temp,'badcapture'),
  fetchImpl:async()=>new Response(JSON.stringify({tables:[{columns:[{name:'unscoped'}],rows:[]}]}),{status:200})});
 await assert.rejects(bad({job,started,planSha256:plan.planSha256}),/projection_invalid/);
});
console.log(JSON.stringify({groups:n,modelCalls:0,cloudCalls:0,temporaryContexts:contexts}));
