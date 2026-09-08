// Synthetic state model. These controls do not parse or execute PostgreSQL.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGpuAllocationMeter,reconcileGpuAllocation,GPU_WINDOW_SQL as Q} from '../../api/_gpu-allocation-budget.js';
import {COMPARISON_COMPLETED_AUTHORITY_SQL,readOwnedCompletedComparisonPreparation} from '../../api/_comparison-preparation.js';
globalThis.fetch=()=>{throw Error('network_forbidden');};
const hash=c=>c.repeat(64),id='12345678-1234-4234-8234-123456789012';
const input={request_sha256:hash('a'),preparation_id:'fixture-p',job_id:'fixture-j',step:'diarize',max_dispatches:1};
let count=0;
async function test(name,fn){await fn();console.log(`ok ${++count} ${name}`);}
function fixture({limit=1000,cost=600,controller=true}={}){
 let reserved=0,spent=0,row=null,calls=0;
 const db=async(sql,p)=>{calls++;
  if(sql===Q.reserve){if(row||spent+reserved+p[6]>limit)return[];
   row={window_id:id,budget_id:p[0],resource_sha256:p[2],revision_sha256:p[3],request_sha256:p[4],contract_sha256:p[5],
    reserved_microusd:p[6],max_allocation_seconds:p[7],provider_request_sha256:p[8],accounting_basis:p[9],state:'reserved'};reserved+=p[6];return[{...row}];}
  if(sql===Q.existing)return row&&row.budget_id===p[0]&&row.request_sha256===p[1]?[{...row}]:[];
  if(!row||p[0]!==row.window_id||p[1]!==row.budget_id||p[2]!==row.request_sha256)return[];
  if(sql===Q.begin){if(row.state!=='reserved')return[];row.state='in_flight';return[{...row}];}
  if(sql===Q.response){if(row.state!=='in_flight')return[];row.state='accounting_pending';return[{...row}];}
  if(sql===Q.uncertain){if(row.state==='in_flight')row.state='uncertain';return[];}
  if(sql===Q.release){if(row.state!=='reserved')return[];row.state='released';reserved-=row.reserved_microusd;return[{}];}
  if(sql===Q.reconcile){if(!['in_flight','uncertain','accounting_pending'].includes(row.state))return[];
   row.state='settled';spent+=p[3];reserved-=row.reserved_microusd;return[{}];}
  throw Error('unexpected_query');
 };
 const ctrl={kind:'azure-finite-allocation-controller/v1',authorizeWindow:async({request_sha256})=>({kind:'azure-finite-allocation/v1',
  request_sha256,resource_sha256:hash('b'),revision_sha256:hash('c'),contract_sha256:hash('d'),upper_bound_microusd:cost,max_allocation_seconds:300})};
 const meter=createGpuAllocationMeter({db,budgetId:'fixture-budget',limitMicrousd:limit,controller:controller?ctrl:undefined});
 return {meter,db,ctrl,state:()=>({row,reserved,spent,calls}),
  verify:r=>({verifyClosedAllocation:async()=>({kind:'azure-closed-allocation-usage/v1',...r,allocation_terminated:true,actual_microusd:400,usage_sha256:hash('e')})})};
}
await test('missing finite allocation fails before DB and reserve',async()=>{
 const f=fixture({controller:false});await assert.rejects(f.meter.assertReady(),/finite_allocation_unavailable/);
 await assert.rejects(f.meter.reserve(input),/finite_allocation_unavailable/);assert.equal(f.state().calls,0);
});
await test('reserve debits whole allocation and repeated same request cannot double charge',async()=>{
 const f=fixture();const a=await f.meter.reserve(input),b=await f.meter.reserve(input);
 assert.equal(a.window_id,b.window_id);assert.equal(f.state().reserved,600);
});
await test('retry cannot release or begin original reserving worker allocation',async()=>{
 const f=fixture(),winner=await f.meter.reserve(input),retry=await f.meter.reserve(input);
 assert.equal(winner.recovered,false);assert.equal(retry.recovered,true);
 await f.meter.releaseBeforeBegin(retry);assert.equal(f.state().reserved,600);
 await assert.rejects(f.meter.begin(retry),/already_started/);
 assert.equal((await f.meter.begin(winner)).dispatch_authorized,true);
});
await test('insufficient shared budget refuses',async()=>{
 const f=fixture({limit:500});await assert.rejects(f.meter.reserve(input),/reservation_refused/);assert.equal(f.state().reserved,0);
});
await test('controller and grant accounting basis cannot be interchanged',async()=>{
 const f=fixture();f.ctrl.kind='azure-supervised-job-controller/v1';
 await assert.rejects(f.meter.reserve(input),/accounting_basis_mismatch/);assert.equal(f.state().calls,0);
});
await test('duplicate begin gives exactly one dispatch permission',async()=>{
 const f=fixture(),r=await f.meter.reserve(input);const results=await Promise.allSettled([f.meter.begin(r),f.meter.begin(r)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.state().reserved,600);
});
await test('lost acknowledgement holds lease and funds without retry or timed release',async()=>{
 const f=fixture(),r=await f.meter.reserve(input);await f.meter.begin(r);await f.meter.markUncertain(r);
 await f.meter.releaseBeforeBegin(r);await assert.rejects(f.meter.begin(r),/already_started/);
 assert.equal(f.state().reserved,600);assert.equal(f.state().row.state,'uncertain');
});
await test('response receipt is accounting pending, never invoice',async()=>{
 const f=fixture(),r=await f.meter.reserve(input);await f.meter.begin(r);
 const result=await f.meter.recordResponse(r,{request_sha256:input.request_sha256,response_sha256:hash('e'),http_status:200,duration_ms:1});
 assert.equal(result.accounted,false);assert.equal(result.accounting_state,'accounting_pending');assert.equal(f.state().reserved,600);assert.equal(f.state().spent,0);
 await f.meter.releaseBeforeBegin(r);assert.equal(f.state().reserved,600);
});
await test('wrong response cannot complete allocation receipt',async()=>{
 const f=fixture(),r=await f.meter.reserve(input);await f.meter.begin(r);
 await assert.rejects(f.meter.recordResponse(r,{request_sha256:hash('f')}),/binding_invalid/);assert.equal(f.state().reserved,600);
});
await test('response hashes bind receipts and missing hash/status is rejected',async()=>{
 const receipts=[];
 for(const responseHash of [hash('e'),hash('f')]){
  const f=fixture(),r=await f.meter.reserve(input);await f.meter.begin(r);
  await assert.rejects(f.meter.recordResponse(r,{request_sha256:input.request_sha256}),/status_invalid/);
  await assert.rejects(f.meter.recordResponse(r,{request_sha256:input.request_sha256,http_status:200}),/commitment_invalid/);
  receipts.push((await f.meter.recordResponse(r,{request_sha256:input.request_sha256,http_status:200,response_sha256:responseHash})).receipt_sha256);
 }
 assert.notEqual(receipts[0],receipts[1]);
});
await test('only reservation before begin releases exactly once',async()=>{
 const f=fixture(),r=await f.meter.reserve(input);await f.meter.releaseBeforeBegin(r);await f.meter.releaseBeforeBegin(r);
 assert.equal(f.state().reserved,0);await assert.rejects(f.meter.begin(r),/already_started/);
});
await test('raw HTTP response cannot reconcile',async()=>{
 const f=fixture(),r=await f.meter.reserve(input);await f.meter.begin(r);
 await assert.rejects(reconcileGpuAllocation({db:f.db,reservation:r,evidence:{duration_ms:10}}),/verifier_unavailable/);assert.equal(f.state().reserved,600);
});
await test('attributable closed allocation settles once',async()=>{
 const f=fixture(),r=await f.meter.reserve(input);await f.meter.begin(r);
 const args={db:f.db,reservation:r,usageVerifier:f.verify(r)};
 assert.equal((await reconcileGpuAllocation(args)).accounted,true);await assert.rejects(reconcileGpuAllocation(args),/reconciliation_refused/);
 assert.equal(f.state().reserved,0);assert.equal(f.state().spent,400);
});
await test('forged revision and nonterminated usage remain held',async()=>{
 for(const change of [{revision_sha256:hash('f')},{allocation_terminated:false}]){
  const f=fixture(),r=await f.meter.reserve(input);await f.meter.begin(r);
  const verifier=f.verify(r),orig=verifier.verifyClosedAllocation;verifier.verifyClosedAllocation=async()=>({...await orig(),...change});
  await assert.rejects(reconcileGpuAllocation({db:f.db,reservation:r,usageVerifier:verifier}));assert.equal(f.state().reserved,600);
 }
});
await test('completed discovery uses new response state and rejects historical settlement',async()=>{
 let calls=0;
 const result=await readOwnedCompletedComparisonPreparation(async(sql,p)=>{
  calls++;assert.equal(sql,COMPARISON_COMPLETED_AUTHORITY_SQL);assert.equal(p.length,4);
  assert(sql.includes("d.state='response_recorded'"));assert(sql.includes("d.state<>'response_recorded'"));
  assert(!sql.includes("d.state='settled'"));return[];
 },id,id,id,id);
 assert.equal(calls,1);assert.equal(result,null);
 const old=COMPARISON_COMPLETED_AUTHORITY_SQL.replaceAll('response_recorded','settled');
 assert(!old.includes("d.state='response_recorded'"));
});
await test('verified overrun records actual cost and pauses further admission SQL',async()=>{
 const f=fixture(),r=await f.meter.reserve(input);await f.meter.begin(r);
 const verifier=f.verify(r),original=verifier.verifyClosedAllocation;
 verifier.verifyClosedAllocation=async()=>({...await original(),actual_microusd:1200});
 assert.equal((await reconcileGpuAllocation({db:f.db,reservation:r,usageVerifier:verifier})).accounted,true);
 assert.equal(f.state().spent,1200);assert.equal(f.state().reserved,0);
 assert(Q.reconcile.includes("w.actual_microusd>w.reserved_microusd then 'paused'"));
});
await test('migration mirror, global resource exclusion and no expiry release query',async()=>{
 const migration=await readFile(new URL('../../db/migrations/147_gpu_allocation_window.sql',import.meta.url),'utf8');
 const schema=await readFile(new URL('../../db/schema.sql',import.meta.url),'utf8');
 assert(schema.replace(/\r/g,'').includes(migration.replace(/\r/g,'')));
 assert(migration.includes('on vy_gpu_allocation_window(resource_sha256)'));
 assert(migration.includes("where state not in ('settled','released')"));
 assert(Q.release.includes("state='reserved'"));assert(!Q.release.includes('now()>'));
 assert(!migration.includes('owner_user_id'));assert(!migration.includes('source_id'));
});
console.log(`${count} offline controls passed; no SQL, cloud or finite-controller acceptance`);
