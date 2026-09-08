import assert from 'node:assert/strict';
import {isolatedJobPlan,inspectJobSnapshot,executionObservation,createAzureJobInspector,deploymentTemplate,commitment} from '../../services/azure-gpu-job/controller.mjs';
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
  if(sql===J.bind){Object.assign(row,{azure_job_id:p[3],job_configuration_sha256:p[4],job_runtime_seconds:p[5],job_control_state:'start_claimed'});return[{...row}];}
  if(sql===J.started){Object.assign(row,{azure_execution_name:p[3],job_control_state:'running'});return[{...row}];}
  if(sql===J.unknown){row.job_control_state='start_unknown';return[{...row}];}
  if(sql===J.read)return[{...row}];
  if(sql===J.stop){row.job_control_state='stop_requested';return[{...row}];}
  if(sql===J.observed){if(row.job_control_state==='terminal_observed')return[];row.job_control_state=p[2];return[{...row}];}
  throw Error('unexpected_query');
 };
 const fetchImpl=async(url,options)=>{
  assert(url.startsWith('https://management.azure.com'+prefix));assert.equal(options.redirect,'error');
  if(url.includes('/start?')){post++;assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),plan.properties.template);
   assert.equal(row.job_control_state,'start_claimed');assert.equal(row.state,'in_flight');assert.equal(row.accounting_basis,'planning_estimate');
   current=execution('Running');return new Response(startStatus===200?JSON.stringify(current):'',{status:startStatus});}
  if(url.includes('/stop?')){stops++;if(stopStatus===200)current=execution('Succeeded');return new Response('',{status:stopStatus});}
  if(url.includes('/executions?'))return Response.json({value:missing?[]:current?[current]:[],nextLink:pages?'https://attacker.invalid/':null});
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
