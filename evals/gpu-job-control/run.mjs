import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isolatedJobPlan,inspectJobSnapshot,executionObservation,createAzureJobInspector,deploymentTemplate,commitment,recoverStartedExecution,windowExecutionTemplate,normalizeObservedJobTemplate,normalizeObservedJobConfiguration} from '../../services/azure-gpu-job/controller.mjs';
import {createGpuJobSupervisor,JOB_SQL as J} from '../../services/azure-gpu-job/supervisor.mjs';
import {GPU_WINDOW_SQL as Q} from '../../api/_gpu-allocation-budget.js';
globalThis.fetch=()=>{throw Error('network_forbidden');};
const clone=v=>structuredClone(v),hash=c=>c.repeat(64);
const prefix='/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/fixture';
const input={jobId:prefix+'/providers/Microsoft.App/jobs/probe',environmentId:prefix+'/providers/Microsoft.App/managedEnvironments/gpu',
 image:'fixture.azurecr.io/evidence@sha256:'+hash('a'),workloadProfileName:'gpu-t4',replicaTimeout:120};
const plan=isolatedJobPlan(input);
const resource={id:plan.job_id,type:'Microsoft.App/jobs',properties:{...clone(plan.properties),provisioningState:'Succeeded'}};
const environment={id:input.environmentId,properties:{workloadProfiles:[{name:'gpu-t4',workloadProfileType:'Consumption-GPU-NC8as-T4'}]}};
const execution=status=>({id:plan.job_id+'/executions/probe-one',name:'probe-one',properties:{status,startTime:'2026-09-08T00:00:00Z',
 ...(status==='Succeeded'?{endTime:'2026-09-08T00:00:10Z'}:{}),template:clone(plan.properties.template)}});
let n=0;async function test(name,fn){await fn();console.log(`ok ${++n} ${name}`);}
function fixture({startStatus=200,stopStatus=200,missing=false,pages=false,now=Date.parse('2026-09-08T00:05:00Z')}={}) {
 let row=null,reserved=0,post=0,stops=0,current=null;
 const calls=[];
 const db=async(sql,p)=>{
  calls.push(sql);
  if(sql===Q.reserve){if(row)return[];row={window_id:'11111111-1111-4111-8111-111111111111',budget_id:p[0],resource_sha256:p[2],revision_sha256:p[3],request_sha256:p[4],contract_sha256:p[5],reserved_microusd:p[6],max_allocation_seconds:p[7],provider_request_sha256:p[8],accounting_basis:p[9],state:'reserved'};reserved=p[6];return[{...row}];}
  if(sql===Q.existing)return row?[{...row}]:[];
  if(sql===Q.begin){if(row.state!=='reserved')return[];row.state='in_flight';row.begun_at='2026-09-08T00:00:00Z';return[{...row}];}
  if(sql===Q.uncertain){row.state='uncertain';return[];}
  if(sql===J.bind){Object.assign(row,{azure_job_id:p[3],job_configuration_sha256:p[4],job_runtime_seconds:p[5],job_control_state:'start_claimed',job_prestart_inventory:JSON.parse(p[6]),job_start_requested_at:'2026-09-08T00:00:00.123456Z',job_execution_template_sha256:p[7]});return[{...row}];}
  if(sql===J.started){Object.assign(row,{azure_execution_name:p[3],job_control_state:'running'});return[{...row}];}
  if(sql===J.unknown){row.job_control_state='start_unknown';return[{...row}];}
  if(sql===J.recover){if(row.azure_execution_name)return[];Object.assign(row,{azure_execution_name:p[2],job_recovery_sha256:p[3],job_control_state:'running'});return[{...row}];}
  if(sql===J.read)return[{...row}];
  if(sql===J.stop){row.job_control_state='stop_requested';return[{...row}];}
  if(sql===J.observed){if(row.job_control_state==='terminal_observed')return[];row.job_control_state=p[2];return[{...row}];}
  throw Error('unexpected_query');
 };
 const fetchImpl=async(url,options)=>{
  assert(url.startsWith('https://management.azure.com'+prefix));assert.equal(options.redirect,'error');
  if(url.includes('/start?')){post++;assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),windowExecutionTemplate(plan,row.window_id));
   assert.equal(row.job_control_state,'start_claimed');assert.equal(row.state,'in_flight');assert.equal(row.accounting_basis,'planning_estimate');
   current=execution('Running');current.properties.template=JSON.parse(options.body);return new Response(startStatus===200?JSON.stringify(current):'',{status:startStatus});}
  if(url.includes('/stop?')){assert.equal(row.azure_execution_name,'probe-one');stops++;if(stopStatus===200){const template=current.properties.template;current=execution('Succeeded');current.properties.template=template;}return new Response('',{status:stopStatus});}
  if(url.includes('/executions?'))return Response.json({value:missing?[]:Array.isArray(current)?current:current?[current]:[],nextLink:pages?'https://attacker.invalid/':null});
  if(url.includes('/managedEnvironments/'))return Response.json(environment);
  return Response.json(resource);
 };
 const policy={budgetId:'gpu-fixture',limitMicrousd:250000,rateMicrousdPerSecond:462,planningHeadroomSeconds:180,approvalSha256:hash('b'),configurationSha256:plan.configuration_sha256};
 const supervisor=createGpuJobSupervisor({db,plan,policy,getToken:async()=>'synthetic-token',fetchImpl,now:()=>now});
 return {supervisor,db,fetchImpl,policy,state:()=>({row,reserved,post,stops,calls}),setCurrent:v=>{current=v;}};
}
await test('manual pinned one-replica no-retry template is rendered without deployment',()=>{
 const t=deploymentTemplate(plan);assert.equal(t.resources[0].properties.configuration.replicaRetryLimit,0);
 assert.equal(t.resources[0].properties.configuration.manualTriggerConfig.parallelism,1);assert(plan.properties.template.containers[0].image.includes('@sha256:'));
});
await test('wrong resource, image, parallelism and GPU profile refuse',()=>{
 assert(inspectJobSnapshot(plan,resource,environment));
 for(const mutate of [r=>r.id+='x',r=>r.properties.template.containers[0].image+='x',r=>r.properties.configuration.manualTriggerConfig.parallelism=2]){
  const r=clone(resource);mutate(r);assert.throws(()=>inspectJobSnapshot(plan,r,environment));
 }
 const env=clone(environment);env.properties.workloadProfiles[0].workloadProfileType='Consumption';assert.throws(()=>inspectJobSnapshot(plan,resource,env));
});
await test('rehashed arbitrary command cannot become approved plan',()=>{
 const p=clone(plan);p.properties.template.containers[0].command=['sh'];p.template_sha256=commitment(p.properties.template);p.configuration_sha256=commitment(p.properties);
 assert.throws(()=>deploymentTemplate(p),/plan_invalid/);
});
await test('read-only inspector has no activation capability',async()=>{
 let calls=0;const i=createAzureJobInspector({plan,getToken:async()=>{calls++;return'x';}});
 await assert.rejects(i.start(),/bound_unproven/);assert.equal(calls,0);
});
await test('approved estimate is explicit and distinct from text budget',()=>{
 const f=fixture();assert.equal(f.supervisor.estimate.reserved_microusd,138600);assert.equal(f.supervisor.estimate.hard_invoice_cap,false);
 assert.throws(()=>createGpuJobSupervisor({db:f.db,plan,policy:{...f.policy,budgetId:'text-fixture'},getToken:async()=>''}),/budget_required/);
});
await test('durable reservation and claim precede one exact start POST',async()=>{
 const f=fixture(),r=await f.supervisor.start(hash('c'));assert.equal(r.execution_name,'probe-one');assert.equal(f.state().post,1);assert.equal(f.state().reserved,138600);
 await assert.rejects(f.supervisor.start(hash('c')));assert.equal(f.state().post,1);
});
await test('202 start stays unknown with held funds and no implicit retry',async()=>{
 const f=fixture({startStatus:202});await assert.rejects(f.supervisor.start(hash('c')),/outcome_unknown/);
 assert.equal(f.state().row.job_control_state,'start_unknown');assert.equal(f.state().reserved,138600);assert.equal(f.state().post,1);
});
await test('202 recovery persists unique identity before named stop and is idempotent',async()=>{
 const f=fixture({startStatus:202});await assert.rejects(f.supervisor.start(hash('c')));
 const id=f.state().row.window_id;
 const v=await f.supervisor.supervise(id,{cancel:true});assert.equal(v.terminal,true);
 assert.equal(f.state().post,1);assert.equal(f.state().stops,1);assert(f.state().row.job_recovery_sha256);
 assert(f.state().calls.indexOf(J.recover)<f.state().calls.indexOf(J.stop));
 await f.supervisor.supervise(id,{cancel:true});assert.equal(f.state().post,1);assert.equal(f.state().stops,1);
 assert.equal(f.state().reserved,138600);
});
await test('unknown start can recover after supervisor process replacement',async()=>{
 const f=fixture({startStatus:202});await assert.rejects(f.supervisor.start(hash('c')));
 const restored=createGpuJobSupervisor({db:f.db,plan,policy:f.policy,getToken:async()=>'synthetic',fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-09-08T00:05:00Z')});
 assert.equal((await restored.supervise(f.state().row.window_id,{cancel:true})).terminal,true);
});
await test('ambiguous, stale, future, wrong-template and missing starts never guessed',async()=>{
 for(const kind of ['ambiguous','stale','future','template','missing','old']){
  const f=fixture({startStatus:202});await assert.rejects(f.supervisor.start(hash('c')));
  const one=execution('Running');one.properties.template=windowExecutionTemplate(plan,f.state().row.window_id);
  if(kind==='ambiguous')f.setCurrent([one,{...clone(one),id:plan.job_id+'/executions/second',name:'second'}]);
  if(kind==='stale'){one.properties.startTime='2026-09-07T23:59:59Z';f.setCurrent(one);}
  if(kind==='future'){one.properties.startTime='2026-09-08T01:00:00Z';f.setCurrent(one);}
  if(kind==='template'){one.properties.template.containers[0].image+='x';f.setCurrent(one);}
  if(kind==='missing')f.setCurrent(null);
  if(kind==='old')f.state().row.job_prestart_inventory=[{id:one.id,name:one.name}];
  await assert.rejects(f.supervisor.supervise(f.state().row.window_id,{cancel:true}));
  assert.equal(f.state().stops,0);assert.equal(f.state().post,1);assert.equal(f.state().reserved,138600);
 }
});
await test('another actor shared-template execution cannot bind our unknown start',async()=>{
 const f=fixture({startStatus:202});await assert.rejects(f.supervisor.start(hash('c')));f.setCurrent(execution('Running'));
 await assert.rejects(f.supervisor.supervise(f.state().row.window_id,{cancel:true}),/template_mismatch/);assert.equal(f.state().stops,0);
});
await test('changed current policy cannot expand original persisted recovery interval',async()=>{
 const f=fixture({startStatus:202});await assert.rejects(f.supervisor.start(hash('c')));
 const late=execution('Running');late.properties.template=windowExecutionTemplate(plan,f.state().row.window_id);late.properties.startTime='2026-09-08T00:05:01Z';f.setCurrent(late);
 const changed=createGpuJobSupervisor({db:f.db,plan,policy:{...f.policy,planningHeadroomSeconds:400,limitMicrousd:300000},getToken:async()=>'synthetic',fetchImpl:f.fetchImpl});
 await assert.rejects(changed.supervise(f.state().row.window_id,{cancel:true}),/outside_window/);assert.equal(f.state().stops,0);
});
await test('legacy unknown row without prestart evidence refuses recovery',async()=>{
 const f=fixture({startStatus:202});await assert.rejects(f.supervisor.start(hash('c')));f.state().row.job_prestart_inventory=null;
 await assert.rejects(f.supervisor.supervise(f.state().row.window_id),/inventory_unavailable/);assert.equal(f.state().stops,0);
});
await test('unobserved ARM defaults remain rejected pending actual metadata',()=>{
 const changed=clone(resource);changed.properties.configuration.unobservedFutureOption=null;
 assert.throws(()=>inspectJobSnapshot(plan,changed,environment),/configuration_drift/);
});
await test('retained real GET evidence permits only five exact observed defaults',async()=>{
 const bytes=await readFile(new URL('./fixtures/arm-defaults34.json',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'5ef543bfe1e73281bef54e875202a4c34ac4d9191b6596f9f76c8c6f02ab3825');
 const receipt=JSON.parse(bytes);assert.equal(receipt.arm_writes,0);assert.equal(receipt.cloud_key_reads,0);
 const observed=new Map(receipt.observations.map(v=>[v.path,v]));
 const paths=['configuration.dapr','configuration.eventTriggerConfig','configuration.identitySettings','template.initContainers','template.volumes'];
 const r=clone(resource);
 for(const path of paths){const [scope,key]=path.split('.'),v=observed.get(path);assert.equal(v.state,'empty');r.properties[scope][key]=v.value;}
 assert(inspectJobSnapshot(plan,r,environment));
 assert.equal(r.properties.configuration.dapr,null,'normalizer does not mutate input');
 assert.deepEqual(r.properties.configuration.identitySettings,[]);
});
await test('every observed optional default rejects nonmatching or active alternatives',()=>{
 const locations=[['configuration','dapr'],['configuration','eventTriggerConfig'],['configuration','identitySettings'],['template','initContainers'],['template','volumes']];
 for(const [scope,key] of locations){
  const values=key==='identitySettings'?[null,{},false,'',[{identity:'system',lifecycle:'All'}]]:[[],{},false,'',[{name:'unexpected'}],{enabled:true}];
  for(const value of values){const r=clone(resource);r.properties[scope][key]=value;assert.throws(()=>inspectJobSnapshot(plan,r,environment),/configuration_drift/);}
 }
});
await test('required trigger and execution fields are never normalized away',()=>{
 for(const mutate of [r=>r.properties.configuration.manualTriggerConfig=null,r=>r.properties.configuration.scheduleTriggerConfig={},
  r=>r.properties.template.containers[0].command=null,r=>r.properties.template.containers[0].args=[],
  r=>r.properties.template.containers[0].resources.ephemeralStorage='1Gi',r=>r.properties.configuration.identitySettings=[{}]]){
  const r=clone(resource);mutate(r);assert.throws(()=>inspectJobSnapshot(plan,r,environment));
 }
});
await test('marked execution observation and recovery share narrow template normalization',async()=>{
 const f=fixture({startStatus:202});await assert.rejects(f.supervisor.start(hash('c')));
 const row=f.state().row,one=execution('Running');one.properties.template=windowExecutionTemplate(plan,row.window_id);
 one.properties.template.initContainers=null;one.properties.template.volumes=null;
 assert.equal(recoverStartedExecution(plan,row,[one]).execution_name,'probe-one');
 assert.equal(executionObservation(plan,'probe-one',[one],row.window_id).terminal,false);
 one.properties.template.containers[0].env=[];
 assert.throws(()=>recoverStartedExecution(plan,row,[one]),/template_mismatch/);
 assert.throws(()=>executionObservation(plan,'probe-one',[one],row.window_id),/template_mismatch/);
});
await test('unknown null fields remain visible in both normalization shapes',()=>{
 assert.deepEqual(normalizeObservedJobTemplate({containers:[],future:null}),{containers:[],future:null});
 assert.deepEqual(normalizeObservedJobConfiguration({future:null}),{future:null});
});
await test('actual target35 defaults retain CPU memory identity and marker boundaries',async()=>{
 const evidence=JSON.parse(await readFile(new URL('./fixtures/arm-target35.json',import.meta.url),'utf8'));
 const observed=evidence.events.find(e=>e.event==='target_resource_details');
 assert.equal(observed.containers[0].cpu_matches,true);assert.equal(observed.containers[0].memory_matches,true);
 assert.equal(observed.containers[0].env_present,false);
 assert.equal(observed.target.defaults['configuration.scheduleTriggerConfig'].value,null);
 assert.equal(observed.target.registries[0].identity.value,'');
 assert.equal(observed.target.containers[0].optional.ephemeralStorage.value,'');
 const r=clone(resource);r.properties.configuration.scheduleTriggerConfig=null;
 r.properties.configuration.registries[0].identity='';
 const c=r.properties.template.containers[0];c.resources.ephemeralStorage='';delete c.env;
 assert(inspectJobSnapshot(plan,r,environment));assert(!Object.hasOwn(c,'env'));
 for(const mutate of [r=>r.properties.template.containers[0].resources.cpu=4,
  r=>r.properties.template.containers[0].resources.memory='32Gi',
  r=>r.properties.template.containers[0].resources.ephemeralStorage=null,
  r=>r.properties.template.containers[0].resources.future=null,
  r=>r.properties.template.containers[0].env=null,
  r=>r.properties.configuration.registries[0].identity=null,
  r=>r.properties.configuration.registries[0].identity='system',
  r=>r.properties.configuration.scheduleTriggerConfig={cronExpression:'* * * * *'}]){
  const bad=clone(r);mutate(bad);assert.throws(()=>inspectJobSnapshot(plan,bad,environment));
 }
 const one=execution('Running'),wid='12345678-1234-4234-8234-123456789012';
 one.properties.template=windowExecutionTemplate(plan,wid);
 one.properties.template.containers[0].resources.ephemeralStorage='';
 assert.equal(executionObservation(plan,'probe-one',[one],wid).terminal,false);
 delete one.properties.template.containers[0].env;
 assert.throws(()=>executionObservation(plan,'probe-one',[one],wid),/template_mismatch/);
});
await test('36 actual execution-only defaults preserve marker and reject active alternatives',async()=>{
 const receipt=JSON.parse(await readFile(new URL('./fixtures/arm-execution36.json',import.meta.url),'utf8'));
 assert.equal(receipt.status,'Failed');assert.deepEqual(receipt.template_defaults.initContainers.value,[]);
 assert.equal(receipt.containers[0].image_type,'ContainerImage');assert.equal(receipt.containers[0].env_entries[0].marker_value_matches,true);
 const wid='d78bb973-8fc7-49e7-b464-21ab7b46c079',one=execution('Failed');
 one.properties.template=windowExecutionTemplate(plan,wid);one.properties.template.initContainers=[];
 one.properties.template.containers[0].imageType='ContainerImage';
 const result=executionObservation(plan,'probe-one',[one],wid);assert.equal(result.terminal,true);assert.equal(result.provider_end_time_present,false);assert.equal(result.accounted,false);
 for(const endTime of [null,'invalid','2020-01-01T00:00:00Z']){const bad=clone(one);bad.properties.endTime=endTime;assert.equal(executionObservation(plan,'probe-one',[bad],wid).terminal,false);}
 for(const mutate of [e=>e.properties.template.initContainers=[{name:'init'}],e=>e.properties.template.containers[0].imageType='CloudBuild',
  e=>e.properties.template.containers[0].imageType=null,e=>delete e.properties.template.containers[0].env,
  e=>e.properties.template.containers[0].resources.cpu=4,e=>e.properties.template.containers[0].future=null]){
  const bad=clone(one);mutate(bad);assert.throws(()=>executionObservation(plan,'probe-one',[bad],wid),/template_mismatch/);
 }
 const job=clone(resource);job.properties.template.initContainers=[];assert.throws(()=>inspectJobSnapshot(plan,job,environment));
 delete job.properties.template.initContainers;job.properties.template.containers[0].imageType='ContainerImage';assert.throws(()=>inspectJobSnapshot(plan,job,environment));
});
await test('server deadline supervision stops named execution then observes terminal',async()=>{
 const f=fixture(),r=await f.supervisor.start(hash('c')),v=await f.supervisor.supervise(r.window_id);
 assert.equal(f.state().stops,1);assert.equal(v.terminal,true);assert.equal(v.accounting_state,'accounting_pending');assert.equal(f.state().reserved,138600);
});
await test('202 stop remains pending and keeps reservation',async()=>{
 const f=fixture({stopStatus:202}),r=await f.supervisor.start(hash('c')),v=await f.supervisor.supervise(r.window_id);
 assert.equal(v.state,'stop_pending');assert.equal(v.terminal,false);assert.equal(f.state().reserved,138600);
});
await test('terminal observation cannot regress under later stale poll',async()=>{
 const f=fixture(),r=await f.supervisor.start(hash('c'));await f.supervisor.supervise(r.window_id);f.setCurrent(execution('Running'));
 const result=await f.supervisor.supervise(r.window_id);assert.equal(result.terminal,true);assert.equal(f.state().stops,1);
 assert(!J.observed.includes("'terminal_observed') returning"));
});
await test('missing execution is unknown, never success',()=>{
 const v=executionObservation(plan,'probe-one',[]);assert.equal(v.state,'unknown');assert.equal(v.terminal,false);
});
await test('pagination and malicious continuation refuse before start',async()=>{
 const f=fixture({pages:true});await assert.rejects(f.supervisor.start(hash('c')),/list_incomplete/);assert.equal(f.state().post,0);
});
await test('forged execution template or name cannot stop another resource',async()=>{
 const f=fixture(),bad=execution('Running');bad.properties.template.containers[0].image+='x';f.setCurrent(bad);
 const i=createAzureJobInspector({plan,getToken:async()=>'synthetic',fetchImpl:f.fetchImpl});
 await assert.rejects(i.stop('probe-one'),/template_mismatch/);await assert.rejects(i.stop('../other'),/name_invalid/);assert.equal(f.state().stops,0);
});
console.log(`${n} synthetic ARM/DB groups passed; no cloud, GPU, SQL or spend executed`);
